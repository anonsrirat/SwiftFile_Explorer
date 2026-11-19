//! SSH connection manager.
//!
//! One authenticated SSH transport is shared per saved server profile. Tabs,
//! transfers and searches open additional *SFTP channels* over that same
//! transport instead of authenticating again. Host keys are verified against a
//! trust-on-first-use store and any change requires an explicit user decision.

use crate::db::{Db, Profile};
use crate::error::{AppError, AppResult};
use crate::events::Sink;
use crate::secrets;
use dashmap::DashMap;
use parking_lot::Mutex as ParkingMutex;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostKeyDecision {
    AcceptOnce,
    AcceptRemember,
    Reject,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub request_id: String,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub known_fingerprint: Option<String>,
    pub changed: bool,
}

#[derive(Debug)]
pub struct HostKeyChallenge {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub key_text: String,
}

#[derive(Debug)]
pub struct ChallengeMessage {
    pub challenge: HostKeyChallenge,
    pub reply: oneshot::Sender<bool>,
}

pub struct HostKeyVerifier {
    db: Arc<Db>,
    sink: Sink,
    pending: DashMap<String, oneshot::Sender<HostKeyDecision>>,
}

impl HostKeyVerifier {
    pub fn new(db: Arc<Db>, sink: Sink) -> Self {
        Self {
            db,
            sink,
            pending: DashMap::new(),
        }
    }

    pub async fn verify(&self, challenge: &HostKeyChallenge) -> bool {
        let known = self
            .db
            .known_hosts_for(&challenge.host, challenge.port)
            .unwrap_or_default();

        if let Some(entry) = known
            .iter()
            .find(|k| k.algorithm == challenge.algorithm && k.key_b64 == challenge.key_text)
        {
            if entry.fingerprint == challenge.fingerprint {
                tracing::info!(
                    host = %challenge.host,
                    port = challenge.port,
                    "host key matches trusted key"
                );
                return true;
            }
        }

        let known_fingerprint = known
            .iter()
            .find(|k| k.algorithm == challenge.algorithm)
            .map(|k| k.fingerprint.clone());
        let changed = known_fingerprint.is_some();

        self.prompt(challenge, known_fingerprint, changed).await
    }

    async fn prompt(
        &self,
        challenge: &HostKeyChallenge,
        known_fingerprint: Option<String>,
        changed: bool,
    ) -> bool {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.insert(request_id.clone(), tx);

        let prompt = HostKeyPrompt {
            request_id: request_id.clone(),
            host: challenge.host.clone(),
            port: challenge.port,
            algorithm: challenge.algorithm.clone(),
            fingerprint: challenge.fingerprint.clone(),
            known_fingerprint,
            changed,
        };
        self.sink.emit_json(
            "host-key://request",
            serde_json::to_value(&prompt).unwrap_or_default(),
        );

        // The user has two minutes to decide, then the connection is refused.
        match timeout(Duration::from_secs(120), rx).await {
            Ok(Ok(HostKeyDecision::Reject)) | Err(_) => {
                self.pending.remove(&request_id);
                false
            }
            Ok(Ok(decision)) => {
                if decision == HostKeyDecision::AcceptRemember {
                    let _ = self.db.trust_host(
                        &challenge.host,
                        challenge.port,
                        &challenge.algorithm,
                        &challenge.fingerprint,
                        &challenge.key_text,
                    );
                }
                true
            }
            Ok(Err(_)) => false,
        }
    }

    pub fn resolve(&self, request_id: &str, decision: HostKeyDecision) -> AppResult<()> {
        let (_, sender) = self
            .pending
            .remove(request_id)
            .ok_or_else(|| AppError::not_found("This host key prompt is no longer active"))?;
        sender
            .send(decision)
            .map_err(|_| AppError::msg("The connection attempt was already closed"))
    }
}

fn describe_key(key: &PublicKeyOrCertificate) -> (String, String, String) {
    match key {
        PublicKeyOrCertificate::PublicKey { key, .. } => {
            let algorithm = key.algorithm().to_string();
            let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
            let text = key.to_openssh().unwrap_or_default();
            (algorithm, fingerprint, text)
        }
        PublicKeyOrCertificate::Certificate(cert) => {
            let fingerprint = cert.public_key().fingerprint(HashAlg::Sha256).to_string();
            let algorithm = format!("{:?} (certificate)", cert.cert_type());
            (algorithm, fingerprint, String::new())
        }
    }
}

/// The russh client handler. Public because it appears in the `Handle` type
/// returned by `SshManager::ensure`; it cannot be constructed outside this module.
pub struct ClientHandler {
    tx: mpsc::UnboundedSender<ChallengeMessage>,
    host: String,
    port: u16,
}

impl russh::client::Handler for ClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let (algorithm, fingerprint, key_text) = describe_key(server_public_key);
        let (reply, rx) = oneshot::channel();
        let challenge = HostKeyChallenge {
            host: self.host.clone(),
            port: self.port,
            algorithm,
            fingerprint,
            key_text,
        };
        if self.tx.send(ChallengeMessage { challenge, reply }).is_err() {
            return Ok(false);
        }
        Ok(rx.await.unwrap_or(false))
    }
}

pub struct ConnectionInfo {
    pub handle: Arc<russh::client::Handle<ClientHandler>>,
    pub method: String,
    pub connected_at: i64,
    pub fingerprint: Option<String>,
}

pub struct ServerEntry {
    pub profile_id: String,
    pub inner: tokio::sync::Mutex<Option<ConnectionInfo>>,
    pub connected: AtomicBool,
    pub generation: AtomicU64,
    pub last_error: ParkingMutex<Option<String>>,
}

impl ServerEntry {
    fn new(profile_id: &str) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            inner: tokio::sync::Mutex::new(None),
            connected: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            last_error: ParkingMutex::new(None),
        }
    }
}

pub struct SshManager {
    sink: Sink,
    db: Arc<Db>,
    verifier: Arc<HostKeyVerifier>,
    pool: DashMap<String, Arc<ServerEntry>>,
}

impl SshManager {
    pub fn new(app: AppHandle, db: Arc<Db>) -> Self {
        Self::with_sink(Arc::new(app), db)
    }

    pub fn with_sink(sink: Sink, db: Arc<Db>) -> Self {
        let verifier = Arc::new(HostKeyVerifier::new(db.clone(), sink.clone()));
        Self {
            sink,
            db,
            verifier,
            pool: DashMap::new(),
        }
    }

    pub fn verifier(&self) -> Arc<HostKeyVerifier> {
        self.verifier.clone()
    }

    pub fn pool_entry(&self, profile_id: &str) -> Arc<ServerEntry> {
        self.pool
            .entry(profile_id.to_string())
            .or_insert_with(|| Arc::new(ServerEntry::new(profile_id)))
            .clone()
    }

    /// Number of server profiles that currently hold a transport slot.
    pub fn pool_len(&self) -> usize {
        self.pool.len()
    }

    pub fn is_connected(&self, profile_id: &str) -> bool {
        self.pool
            .get(profile_id)
            .map(|e| e.connected.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    fn emit_state(
        &self,
        profile_id: &str,
        connected: bool,
        method: Option<&str>,
        error: Option<&str>,
    ) {
        self.sink.emit_json(
            "connection://state",
            serde_json::json!({
                "profileId": profile_id,
                "connected": connected,
                "method": method,
                "error": error,
            }),
        );
    }

    /// Return a live SSH transport for this profile, connecting if necessary.
    /// Returns `(handle, reused)` where `reused` is true when an existing
    /// authenticated transport was shared.
    pub async fn ensure(
        &self,
        profile: &Profile,
        password: Option<&str>,
    ) -> AppResult<(Arc<russh::client::Handle<ClientHandler>>, bool)> {
        let entry = self.pool_entry(&profile.id);
        let mut guard = entry.inner.lock().await;

        if let Some(info) = guard.as_ref() {
            if !info.handle.is_closed() {
                return Ok((info.handle.clone(), true));
            }
            tracing::warn!(profile = %profile.id, "cached SSH transport is closed, reconnecting");
        }
        *guard = None;
        entry.connected.store(false, Ordering::SeqCst);

        match self.connect(profile, password).await {
            Ok(info) => {
                let handle = info.handle.clone();
                *guard = Some(info);
                entry.connected.store(true, Ordering::SeqCst);
                entry.generation.fetch_add(1, Ordering::SeqCst);
                *entry.last_error.lock() = None;
                self.emit_state(&profile.id, true, Some(&profile.auth_method), None);
                Ok((handle, false))
            }
            Err(e) => {
                *entry.last_error.lock() = Some(e.message.clone());
                self.emit_state(&profile.id, false, None, Some(&e.message));
                Err(e)
            }
        }
    }

    async fn connect(
        &self,
        profile: &Profile,
        password: Option<&str>,
    ) -> AppResult<ConnectionInfo> {
        let timeout_secs = if profile.timeout_secs > 0 {
            profile.timeout_secs as u64
        } else {
            20
        };

        let config = russh::client::Config {
            keepalive_interval: Some(Duration::from_secs(profile.keepalive_secs.max(5) as u64)),
            keepalive_max: 3,
            nodelay: true,
            ..Default::default()
        };

        let (tx, mut rx) = mpsc::unbounded_channel::<ChallengeMessage>();
        let verifier = self.verifier.clone();
        tokio::spawn(async move {
            while let Some(message) = rx.recv().await {
                let ChallengeMessage { challenge, reply } = message;
                let accepted = verifier.verify(&challenge).await;
                let _ = reply.send(accepted);
            }
        });

        let handler = ClientHandler {
            tx,
            host: profile.host.clone(),
            port: profile.port,
        };

        tracing::info!(host = %profile.host, port = profile.port, "connecting SSH transport");
        let connect_fut = russh::client::connect(
            Arc::new(config),
            (profile.host.as_str(), profile.port),
            handler,
        );
        let mut handle = match timeout(Duration::from_secs(timeout_secs), connect_fut).await {
            Ok(Ok(h)) => h,
            Ok(Err(e)) => {
                return Err(AppError::new(
                    "connection_failed",
                    format!(
                        "Cannot connect to {}:{} — {}",
                        profile.host, profile.port, e.message
                    ),
                ))
            }
            Err(_) => {
                return Err(AppError::new(
                    "timeout",
                    format!(
                        "Timed out after {}s while connecting to {}:{}",
                        timeout_secs, profile.host, profile.port
                    ),
                ))
            }
        };

        let method = self.authenticate(&mut handle, profile, password).await?;

        let fingerprint = None; // fingerprint of the accepted host key is reported by the verifier
        Ok(ConnectionInfo {
            handle: Arc::new(handle),
            method,
            connected_at: chrono::Utc::now().timestamp_millis(),
            fingerprint,
        })
    }

    async fn authenticate(
        &self,
        handle: &mut russh::client::Handle<ClientHandler>,
        profile: &Profile,
        password: Option<&str>,
    ) -> AppResult<String> {
        let timeout_secs = if profile.timeout_secs > 0 {
            profile.timeout_secs as u64
        } else {
            20
        };

        let result = match profile.auth_method.as_str() {
            "password" => {
                let secret = match password {
                    Some(p) => p.to_string(),
                    None => self
                        .stored_secret(&profile.id, "password")?
                        .ok_or_else(|| {
                            AppError::new(
                                "credentials_required",
                                format!("A password is required for {}", profile.name),
                            )
                        })?,
                };
                timeout(
                    Duration::from_secs(timeout_secs),
                    handle.authenticate_password(profile.username.clone(), secret),
                )
                .await
                .map_err(|_| AppError::new("timeout", "Authentication timed out"))??
            }
            "key" => {
                let key_path = profile.key_path.clone().ok_or_else(|| {
                    AppError::new("invalid_profile", "No private key file is configured")
                })?;
                let passphrase = match password {
                    Some(p) if !p.is_empty() => Some(p.to_string()),
                    _ => self.stored_secret(&profile.id, "passphrase")?,
                };
                let key = russh::keys::load_secret_key(&key_path, passphrase.as_deref()).map_err(
                    |e| {
                        AppError::new(
                            "key_error",
                            format!("Cannot read private key {key_path}: {e}"),
                        )
                    },
                )?;
                let hash = if key.algorithm().is_rsa() {
                    Some(HashAlg::Sha256)
                } else {
                    None
                };
                let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
                timeout(
                    Duration::from_secs(timeout_secs),
                    handle.authenticate_publickey(profile.username.clone(), key),
                )
                .await
                .map_err(|_| AppError::new("timeout", "Authentication timed out"))??
            }
            "agent" => {
                self.authenticate_agent(handle, profile, timeout_secs)
                    .await?
            }
            other => {
                return Err(AppError::new(
                    "invalid_profile",
                    format!("Unsupported authentication method: {other}"),
                ))
            }
        };

        if result.success() {
            Ok(profile.auth_method.clone())
        } else {
            Err(AppError::new(
                "auth_failed",
                format!(
                    "Authentication failed for {}@{} — check the username, password or key",
                    profile.username, profile.host
                ),
            ))
        }
    }

    async fn authenticate_agent(
        &self,
        handle: &mut russh::client::Handle<ClientHandler>,
        profile: &Profile,
        timeout_secs: u64,
    ) -> AppResult<russh::client::AuthResult> {
        #[cfg(windows)]
        {
            use russh::keys::agent::client::AgentClient;
            let pipe = std::env::var("SWIFTSFTP_AGENT_PIPE")
                .unwrap_or_else(|_| r"\\.\pipe\openssh-ssh-agent".to_string());
            let mut agent = AgentClient::connect_named_pipe(&pipe).await.map_err(|e| {
                AppError::new(
                    "agent_error",
                    format!("Cannot open the Windows OpenSSH agent pipe ({pipe}): {e}"),
                )
            })?;
            let identities = agent.request_identities().await.map_err(|e| {
                AppError::new(
                    "agent_error",
                    format!("The SSH agent did not list identities: {e}"),
                )
            })?;
            if identities.is_empty() {
                return Err(AppError::new(
                    "agent_error",
                    "The SSH agent has no identities loaded (try: ssh-add your-key)",
                ));
            }
            for identity in identities {
                let public = identity.public_key().into_owned();
                let hash = if public.algorithm().is_rsa() {
                    Some(HashAlg::Sha256)
                } else {
                    None
                };
                let attempt = timeout(
                    Duration::from_secs(timeout_secs),
                    handle.authenticate_publickey_with(
                        profile.username.clone(),
                        public,
                        hash,
                        &mut agent,
                    ),
                )
                .await
                .map_err(|_| AppError::new("timeout", "Authentication timed out"))?;
                match attempt {
                    Ok(result) if result.success() => return Ok(result),
                    Ok(_) => continue,
                    Err(e) => {
                        return Err(AppError::new(
                            "agent_error",
                            format!("Agent signing failed: {e}"),
                        ))
                    }
                }
            }
            Err(AppError::new(
                "auth_failed",
                "None of the keys offered by the SSH agent was accepted",
            ))
        }
        #[cfg(not(windows))]
        {
            let _ = (handle, profile, timeout_secs);
            Err(AppError::unsupported(
                "SSH agent authentication is only implemented on Windows builds",
            ))
        }
    }

    fn stored_secret(&self, profile_id: &str, kind: &str) -> AppResult<Option<String>> {
        match self.db.get_secret_blob(profile_id, kind)? {
            Some(blob) => Ok(Some(secrets::unprotect(&blob)?)),
            None => Ok(None),
        }
    }

    pub async fn invalidate(&self, profile_id: &str) {
        if let Some(entry) = self.pool.get(profile_id) {
            let mut guard = entry.inner.lock().await;
            *guard = None;
            entry.connected.store(false, Ordering::SeqCst);
            entry.generation.fetch_add(1, Ordering::SeqCst);
        }
        self.emit_state(profile_id, false, None, None);
    }

    pub async fn disconnect(&self, profile_id: &str) {
        if let Some(entry) = self.pool.get(profile_id) {
            let mut guard = entry.inner.lock().await;
            if let Some(info) = guard.take() {
                let _ = info
                    .handle
                    .disconnect(russh::Disconnect::ByApplication, "", "en")
                    .await;
            }
            entry.connected.store(false, Ordering::SeqCst);
        }
        self.emit_state(profile_id, false, None, None);
    }

    /// Execute a remote command over the shared transport (used for verified
    /// server-side copies). Arguments must already be shell-quoted by the caller.
    pub async fn exec(
        &self,
        profile: &Profile,
        password: Option<&str>,
        command: &str,
        timeout_secs: u64,
    ) -> AppResult<ExecOutput> {
        let (handle, _) = self.ensure(profile, password).await?;
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| AppError::new("ssh_error", format!("Cannot open SSH channel: {e}")))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::new("ssh_error", format!("Cannot start remote command: {e}")))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);

        loop {
            match timeout(
                deadline.saturating_duration_since(tokio::time::Instant::now()),
                channel.wait(),
            )
            .await
            {
                Ok(Some(russh::ChannelMsg::Data { data })) => stdout.extend_from_slice(&data),
                Ok(Some(russh::ChannelMsg::ExtendedData { data, .. })) => {
                    stderr.extend_from_slice(&data)
                }
                Ok(Some(russh::ChannelMsg::ExitStatus { exit_status })) => {
                    exit_code = Some(exit_status)
                }
                Ok(Some(russh::ChannelMsg::Eof))
                | Ok(Some(russh::ChannelMsg::Close))
                | Ok(None) => break,
                Ok(Some(_)) => {}
                Err(_) => {
                    return Err(AppError::new(
                        "timeout",
                        format!("Remote command timed out after {timeout_secs}s: {command}"),
                    ))
                }
            }
        }

        Ok(ExecOutput {
            code: exit_code.unwrap_or(0),
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
        })
    }

    /// Periodically drop dead transports so the UI can show an accurate state.
    pub fn spawn_health_monitor(self: &Arc<Self>) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            loop {
                interval.tick().await;
                for entry in manager.pool.iter() {
                    let alive = match entry.inner.try_lock() {
                        Ok(guard) => guard
                            .as_ref()
                            .map(|info| !info.handle.is_closed())
                            .unwrap_or(false),
                        Err(_) => entry.connected.load(Ordering::SeqCst),
                    };
                    if entry.connected.load(Ordering::SeqCst) != alive {
                        entry.connected.store(alive, Ordering::SeqCst);
                        manager.emit_state(&entry.profile_id, alive, None, None);
                    }
                }
            }
        });
    }
}

#[derive(Debug, Clone)]
pub struct ExecOutput {
    pub code: u32,
    pub stdout: String,
    pub stderr: String,
}

pub fn public_key_fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decisions_round_trip_json() {
        let json = serde_json::to_string(&HostKeyDecision::AcceptRemember).unwrap();
        assert_eq!(json, "\"accept_remember\"");
    }

    #[test]
    fn prompt_serialises_camel_case() {
        let prompt = HostKeyPrompt {
            request_id: "1".into(),
            host: "example.com".into(),
            port: 22,
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:abc".into(),
            known_fingerprint: None,
            changed: false,
        };
        let json = serde_json::to_value(&prompt).unwrap();
        assert_eq!(json["requestId"], "1");
        assert_eq!(json["knownFingerprint"], serde_json::Value::Null);
    }
}
