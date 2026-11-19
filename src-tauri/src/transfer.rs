//! Transfer engine: a bounded worker pool, real byte progress, pause/resume,
//! cancel, retry, temporary destination files with atomic rename, and
//! verification. Nothing is reported complete until the bytes are on disk.

use crate::db::{Db, HistoryEntry, Profile};
use crate::error::{AppError, AppResult};
use crate::events::Sink;
use crate::remote_path as rp;
use crate::settings::Settings;
use crate::sftp::{human_size, open_sftp};
use crate::ssh::SshManager;
use dashmap::DashMap;
use parking_lot::{Mutex as ParkingMutex, RwLock};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Upload,
    Download,
    CopyRemote,
    MoveRemote,
}

impl Kind {
    fn parse(value: &str) -> AppResult<Kind> {
        match value {
            "upload" => Ok(Kind::Upload),
            "download" => Ok(Kind::Download),
            "copy_remote" => Ok(Kind::CopyRemote),
            "move_remote" => Ok(Kind::MoveRemote),
            other => Err(AppError::new(
                "invalid_kind",
                format!("Unknown transfer kind: {other}"),
            )),
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Kind::Upload => "upload",
            Kind::Download => "download",
            Kind::CopyRemote => "copy_remote",
            Kind::MoveRemote => "move_remote",
        }
    }

    fn is_remote_to_remote(&self) -> bool {
        matches!(self, Kind::CopyRemote | Kind::MoveRemote)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Connecting,
    Transferring,
    Paused,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

impl Status {
    fn as_str(&self) -> &'static str {
        match self {
            Status::Queued => "queued",
            Status::Connecting => "connecting",
            Status::Transferring => "transferring",
            Status::Paused => "paused",
            Status::Verifying => "verifying",
            Status::Completed => "completed",
            Status::Failed => "failed",
            Status::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub source: String,
    pub dest: String,
    pub profile_id: String,
    pub dest_profile_id: Option<String>,
    pub size: u64,
    pub transferred: u64,
    pub speed_bps: f64,
    pub status: String,
    pub error: Option<String>,
    pub method: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub attempt: u32,
    pub can_pause: bool,
    pub bytes_per_second_limit: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSpec {
    #[serde(default)]
    pub kind: String,
    pub profile_id: String,
    #[serde(default)]
    pub dest_profile_id: Option<String>,
    #[serde(default)]
    pub local_path: Option<String>,
    #[serde(default)]
    pub remote_path: String,
    #[serde(default)]
    pub dest_remote_path: Option<String>,
    /// `replace` | `skip` | `rename`
    #[serde(default)]
    pub overwrite: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

struct JobSpec {
    id: String,
    kind: Kind,
    name: String,
    profile_id: String,
    dest_profile_id: Option<String>,
    local_path: Option<PathBuf>,
    remote_src: Option<String>,
    remote_dest: Option<String>,
    size: u64,
    overwrite: String,
    password: Option<String>,
    source_label: String,
    dest_label: String,
}

struct TaskHandle {
    spec: JobSpec,
    state: ParkingMutex<TransferTask>,
    cancel: CancellationToken,
    paused: AtomicBool,
    resume: Notify,
}

pub struct TransferManager {
    sink: Sink,
    ssh: Arc<SshManager>,
    db: Arc<Db>,
    settings: Arc<RwLock<Settings>>,
    tasks: DashMap<String, Arc<TaskHandle>>,
    order: ParkingMutex<Vec<String>>,
    queue: ParkingMutex<VecDeque<String>>,
    notify: Arc<Notify>,
    active: AtomicUsize,
    last_emit: AtomicI64,
}

impl TransferManager {
    pub fn new(
        app: AppHandle,
        ssh: Arc<SshManager>,
        db: Arc<Db>,
        settings: Arc<RwLock<Settings>>,
    ) -> Self {
        Self::with_sink(Arc::new(app), ssh, db, settings)
    }

    pub fn with_sink(
        sink: Sink,
        ssh: Arc<SshManager>,
        db: Arc<Db>,
        settings: Arc<RwLock<Settings>>,
    ) -> Self {
        Self {
            sink,
            ssh,
            db,
            settings,
            tasks: DashMap::new(),
            order: ParkingMutex::new(Vec::new()),
            queue: ParkingMutex::new(VecDeque::new()),
            notify: Arc::new(Notify::new()),
            active: AtomicUsize::new(0),
            last_emit: AtomicI64::new(0),
        }
    }

    pub fn start(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            self.clone().dispatch_loop().await;
        });
    }

    async fn dispatch_loop(self: Arc<Self>) {
        loop {
            self.notify.notified().await;
            loop {
                let limit = self.settings.read().max_concurrent_transfers.max(1) as usize;
                if self.active.load(Ordering::SeqCst) >= limit {
                    break;
                }
                let next = self.queue.lock().pop_front();
                let Some(id) = next else { break };
                let Some(task) = self.tasks.get(&id).map(|t| t.clone()) else {
                    continue;
                };
                if task.state.lock().status != Status::Queued.as_str() {
                    continue;
                }
                self.active.fetch_add(1, Ordering::SeqCst);
                let manager = self.clone();
                tauri::async_runtime::spawn(async move {
                    let retry = manager.run_task(task.clone()).await;
                    manager.active.fetch_sub(1, Ordering::SeqCst);
                    if retry {
                        manager.clone().schedule_retry(task);
                    }
                    manager.notify.notify_one();
                    manager.emit();
                });
            }
        }
    }

    pub fn snapshot(&self) -> Vec<TransferTask> {
        let order = self.order.lock().clone();
        order
            .iter()
            .filter_map(|id| self.tasks.get(id).map(|t| t.state.lock().clone()))
            .collect()
    }

    fn emit(&self) {
        let now = chrono::Utc::now().timestamp_millis();
        let last = self.last_emit.load(Ordering::Relaxed);
        if now - last < 80 {
            return;
        }
        self.last_emit.store(now, Ordering::Relaxed);
        self.sink.emit_json(
            "transfer://update",
            serde_json::to_value(self.snapshot()).unwrap_or_default(),
        );
    }

    fn emit_forced(&self) {
        self.last_emit
            .store(chrono::Utc::now().timestamp_millis(), Ordering::Relaxed);
        self.sink.emit_json(
            "transfer://update",
            serde_json::to_value(self.snapshot()).unwrap_or_default(),
        );
    }

    pub fn enqueue(&self, spec: TransferSpec) -> AppResult<TransferTask> {
        let kind = Kind::parse(&spec.kind)?;
        let profile_id = spec.profile_id.clone();
        let dest_profile_id = if kind.is_remote_to_remote() {
            Some(
                spec.dest_profile_id
                    .clone()
                    .unwrap_or_else(|| spec.profile_id.clone()),
            )
        } else {
            None
        };

        let id = uuid::Uuid::new_v4().to_string();
        let overwrite = spec
            .overwrite
            .clone()
            .unwrap_or_else(|| "replace".to_string());

        let (local_path, remote_src, remote_dest, name, source_label, dest_label) = match kind {
            Kind::Upload => {
                let local = spec
                    .local_path
                    .clone()
                    .ok_or_else(|| AppError::new("invalid_spec", "No local file selected"))?;
                let path = PathBuf::from(&local);
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| local.clone());
                (
                    Some(path),
                    None,
                    Some(rp::normalize(&spec.remote_path)),
                    name,
                    local.clone(),
                    spec.remote_path.clone(),
                )
            }
            Kind::Download => {
                let local = spec.local_path.clone().ok_or_else(|| {
                    AppError::new("invalid_spec", "No local destination selected")
                })?;
                let name = rp::file_name(&spec.remote_path);
                (
                    Some(PathBuf::from(&local)),
                    Some(rp::normalize(&spec.remote_path)),
                    None,
                    name,
                    spec.remote_path.clone(),
                    local,
                )
            }
            Kind::CopyRemote | Kind::MoveRemote => {
                let src = rp::normalize(&spec.remote_path);
                let dest = rp::normalize(
                    spec.dest_remote_path
                        .as_deref()
                        .ok_or_else(|| AppError::new("invalid_spec", "No destination folder"))?,
                );
                if rp::is_dangerous_target(&dest) {
                    return Err(AppError::new(
                        "invalid_path",
                        "Refusing to write to this location",
                    ));
                }
                (
                    None,
                    Some(src.clone()),
                    Some(dest.clone()),
                    rp::file_name(&src),
                    src,
                    dest,
                )
            }
        };

        let total = spec.size.unwrap_or(0);
        let task = TransferTask {
            id: id.clone(),
            kind: kind.as_str().to_string(),
            name: name.clone(),
            source: source_label.clone(),
            dest: dest_label.clone(),
            profile_id: profile_id.clone(),
            dest_profile_id: dest_profile_id.clone(),
            size: total,
            transferred: 0,
            speed_bps: 0.0,
            status: Status::Queued.as_str().to_string(),
            error: None,
            method: None,
            created_at: chrono::Utc::now().timestamp_millis(),
            started_at: None,
            finished_at: None,
            attempt: 0,
            can_pause: !(kind == Kind::MoveRemote),
            bytes_per_second_limit: (self.settings.read().speed_limit_kbps as u64) * 1024,
        };

        let handle = Arc::new(TaskHandle {
            spec: JobSpec {
                id: id.clone(),
                kind,
                name,
                profile_id,
                dest_profile_id,
                local_path,
                remote_src,
                remote_dest,
                size: total,
                overwrite,
                password: spec.password.clone(),
                source_label,
                dest_label,
            },
            state: ParkingMutex::new(task.clone()),
            cancel: CancellationToken::new(),
            paused: AtomicBool::new(false),
            resume: Notify::new(),
        });

        self.tasks.insert(id.clone(), handle);
        self.order.lock().push(id.clone());
        self.queue.lock().push_back(id);
        self.notify.notify_one();
        self.emit_forced();
        Ok(task)
    }

    fn set_status(&self, task: &TaskHandle, status: Status) {
        {
            let mut state = task.state.lock();
            state.status = status.as_str().to_string();
            if status == Status::Transferring && state.started_at.is_none() {
                state.started_at = Some(chrono::Utc::now().timestamp_millis());
            }
        }
        self.emit();
    }

    fn set_total(&self, task: &TaskHandle, total: u64) {
        task.state.lock().size = total;
    }

    fn progress(&self, task: &TaskHandle, transferred: u64, speed_bps: f64) {
        {
            let mut state = task.state.lock();
            state.transferred = transferred;
            state.speed_bps = speed_bps;
        }
        self.emit();
    }

    fn set_method(&self, task: &TaskHandle, method: &str) {
        task.state.lock().method = Some(method.to_string());
    }

    fn fail(&self, task: &TaskHandle, error: AppError) {
        let status = if error.code == "cancelled" {
            Status::Cancelled
        } else {
            Status::Failed
        };
        {
            let mut state = task.state.lock();
            state.status = status.as_str().to_string();
            state.error = if status == Status::Cancelled {
                None
            } else {
                Some(error.message.clone())
            };
            state.finished_at = Some(chrono::Utc::now().timestamp_millis());
            state.speed_bps = 0.0;
        }
        let state = task.state.lock().clone();
        self.record_history(&task.spec, &state);
        tracing::warn!(job = %task.spec.id, status = %state.status, error = ?error.message, "transfer finished with a problem");
        self.emit_forced();
    }

    fn succeed(&self, task: &TaskHandle) {
        {
            let mut state = task.state.lock();
            state.status = Status::Completed.as_str().to_string();
            state.transferred = state.size.max(state.transferred);
            state.speed_bps = 0.0;
            state.error = None;
            state.finished_at = Some(chrono::Utc::now().timestamp_millis());
        }
        let state = task.state.lock().clone();
        self.record_history(&task.spec, &state);
        self.emit_forced();
    }

    fn record_history(&self, spec: &JobSpec, state: &TransferTask) {
        let entry = HistoryEntry {
            id: spec.id.clone(),
            name: spec.name.clone(),
            kind: spec.kind.as_str().to_string(),
            source: spec.source_label.clone(),
            dest: spec.dest_label.clone(),
            size: state.size as i64,
            status: state.status.clone(),
            method: state.method.clone(),
            error: state.error.clone(),
            finished_at: chrono::Utc::now().timestamp_millis(),
        };
        if let Err(e) = self.db.add_history(&entry) {
            tracing::warn!("could not store transfer history: {e}");
        }
    }

    /// Runs one attempt. Returns `true` when the job was requeued for an
    /// automatic retry instead of being finished.
    async fn run_task(&self, task: Arc<TaskHandle>) -> bool {
        {
            let mut state = task.state.lock();
            state.attempt += 1;
            state.status = Status::Connecting.as_str().to_string();
            state.started_at = Some(chrono::Utc::now().timestamp_millis());
            state.error = None;
        }
        self.emit_forced();

        let spec = &task.spec;
        let result = match spec.kind {
            Kind::Upload => self.upload(&task).await,
            Kind::Download => self.download(&task).await,
            Kind::CopyRemote => self.remote_copy(&task, false).await,
            Kind::MoveRemote => self.remote_copy(&task, true).await,
        };

        match result {
            Ok(()) => {
                self.succeed(&task);
                false
            }
            Err(e) => self.fail_or_retry(&task, e),
        }
    }

    /// Record a failure, or requeue the job when the "retries" setting allows it
    /// and the error is likely transient. Cancellations are never retried.
    fn fail_or_retry(&self, task: &Arc<TaskHandle>, error: AppError) -> bool {
        if error.code != "cancelled" && retryable(&error.code) {
            let retries = self.settings.read().retry_count;
            let attempt = task.state.lock().attempt;
            if attempt <= retries {
                {
                    let mut state = task.state.lock();
                    state.status = Status::Queued.as_str().to_string();
                    state.error = Some(format!("Attempt {attempt} failed: {}", error.message));
                    state.speed_bps = 0.0;
                    state.transferred = 0;
                }
                tracing::warn!(
                    job = %task.spec.id,
                    attempt,
                    code = %error.code,
                    "transfer failed; retrying automatically"
                );
                self.emit_forced();
                return true;
            }
        }
        self.fail(task, error);
        false
    }

    /// Put a failed job back on the queue after a short backoff. The retry only
    /// happens while this exact handle is still registered, so cancelling or
    /// clearing the row wins the race.
    fn schedule_retry(self: Arc<Self>, task: Arc<TaskHandle>) {
        let id = task.spec.id.clone();
        let attempt = task.state.lock().attempt;
        let backoff = Duration::from_secs(u64::from(attempt.clamp(1, 5)));
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(backoff).await;
            let still_current = self
                .tasks
                .get(&id)
                .map(|t| Arc::ptr_eq(&*t, &task))
                .unwrap_or(false);
            if still_current {
                self.queue.lock().push_back(id);
                self.notify.notify_one();
            }
        });
    }

    async fn profile(&self, id: &str) -> AppResult<Profile> {
        self.db
            .get_profile(id)?
            .ok_or_else(|| AppError::new("profile_not_found", "The saved server no longer exists"))
    }

    async fn wait_if_paused(&self, task: &Arc<TaskHandle>) -> AppResult<()> {
        if task.cancel.is_cancelled() {
            return Err(AppError::cancelled());
        }
        if !task.paused.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.set_status(task, Status::Paused);
        loop {
            tokio::select! {
                _ = task.cancel.cancelled() => return Err(AppError::cancelled()),
                _ = task.resume.notified() => {
                    if !task.paused.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }
        }
        self.set_status(task, Status::Transferring);
        Ok(())
    }

    /// Throttle to the configured speed limit without busy waiting.
    async fn throttle(&self, started: Instant, sent: u64, limit: u64) {
        if limit == 0 {
            return;
        }
        let expected = Duration::from_secs_f64(sent as f64 / limit as f64);
        let elapsed = started.elapsed();
        if expected > elapsed {
            tokio::time::sleep(expected - elapsed).await;
        }
    }

    async fn upload(&self, task: &Arc<TaskHandle>) -> AppResult<()> {
        let spec = &task.spec;
        let profile = self.profile(&spec.profile_id).await?;
        let local_path = spec
            .local_path
            .clone()
            .ok_or_else(|| AppError::new("invalid_spec", "Missing local file"))?;
        let dest = spec
            .remote_dest
            .clone()
            .ok_or_else(|| AppError::new("invalid_spec", "Missing remote destination"))?;

        let metadata = tokio::fs::metadata(&local_path).await?;
        if metadata.is_dir() {
            return Err(AppError::new(
                "invalid_spec",
                "Folders are expanded before upload",
            ));
        }
        self.set_total(task, metadata.len());

        let sftp = open_sftp(&self.ssh, &profile, spec.password.as_deref()).await?;
        let dest = match self
            .resolve_overwrite(&sftp, &dest, &spec.overwrite, task)
            .await?
        {
            Some(dest) => dest,
            None => {
                self.set_method(task, "skipped (destination exists)");
                return Ok(());
            }
        };

        let temp = temp_name(&dest, &spec.id);
        let chunk = self.settings.read().chunk_size();
        let limit = self.settings.read().speed_limit_kbps as u64 * 1024;

        let mut local = tokio::fs::File::open(&local_path).await?;
        let mut remote = sftp
            .open_with_flags(
                temp.clone(),
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await?;

        self.set_status(task, Status::Transferring);
        let uploaded = async {
            let mut buffer = vec![0u8; chunk];
            let mut sent: u64 = 0;
            let started = Instant::now();
            let mut sample_time = Instant::now();
            let mut sample_bytes = 0u64;
            let mut speed = 0.0f64;

            loop {
                self.wait_if_paused(task).await?;
                let read = local.read(&mut buffer).await?;
                if read == 0 {
                    break;
                }
                remote.write_all(&buffer[..read]).await?;
                sent += read as u64;
                sample_bytes += read as u64;
                if sample_time.elapsed() >= Duration::from_millis(400) {
                    speed = sample_bytes as f64 / sample_time.elapsed().as_secs_f64();
                    sample_time = Instant::now();
                    sample_bytes = 0;
                }
                self.progress(task, sent, speed);
                self.throttle(started, sent, limit).await;
            }

            remote.flush().await?;
            let _ = remote.sync_all().await;
            remote.close().await?;
            Ok::<u64, AppError>(sent)
        }
        .await;

        let sent = match uploaded {
            Ok(sent) => sent,
            Err(e) => {
                // Do not leave an orphaned .part file on the server.
                let _ = sftp.remove_file(temp.clone()).await;
                return Err(e);
            }
        };

        self.set_status(task, Status::Verifying);
        let remote_size = sftp.metadata(temp.clone()).await?.len();
        if remote_size != sent {
            let _ = sftp.remove_file(temp.clone()).await;
            return Err(AppError::new(
                "verification_failed",
                format!(
                    "Uploaded {} but the server reports {} — the file was not saved",
                    human_size(sent),
                    human_size(remote_size)
                ),
            ));
        }

        if self.settings.read().verify_checksums && self.settings.read().allow_server_commands {
            match self
                .remote_sha256(&profile, &temp, spec.password.as_deref())
                .await
            {
                Ok(remote_hash) => {
                    let local_hash = sha256_file(&local_path).await?;
                    if remote_hash != local_hash {
                        let _ = sftp.remove_file(temp.clone()).await;
                        tracing::warn!(
                            job = %spec.id,
                            local = %local_hash,
                            remote = %remote_hash,
                            "upload checksum mismatch"
                        );
                        return Err(AppError::new(
                            "checksum_mismatch",
                            format!(
                                "SHA-256 mismatch (local {}…, server {}…) — the uploaded file was discarded",
                                short_hash(&local_hash),
                                short_hash(&remote_hash)
                            ),
                        ));
                    }
                    self.set_method(task, "stream + sha256");
                }
                Err(e) => {
                    tracing::debug!("remote checksum unavailable: {e}");
                    self.set_method(task, "stream + size");
                }
            }
        } else {
            self.set_method(task, "stream + size");
        }

        self.commit(&sftp, &temp, &dest).await?;
        Ok(())
    }

    async fn download(&self, task: &Arc<TaskHandle>) -> AppResult<()> {
        let spec = &task.spec;
        let profile = self.profile(&spec.profile_id).await?;
        let remote_src = spec
            .remote_src
            .clone()
            .ok_or_else(|| AppError::new("invalid_spec", "Missing remote source"))?;
        let local_dest = spec
            .local_path
            .clone()
            .ok_or_else(|| AppError::new("invalid_spec", "Missing local destination"))?;

        let sftp = open_sftp(&self.ssh, &profile, spec.password.as_deref()).await?;
        let attrs = sftp.metadata(remote_src.clone()).await?;
        self.set_total(task, attrs.len());

        // Apply the overwrite policy *before* moving any bytes: "skip" must not
        // cost the whole download and "rename" must never replace an existing
        // file (it used to delete the destination and overwrite it).
        let Some(dest) = resolve_local_overwrite(&local_dest, &spec.overwrite).await? else {
            self.set_method(task, "skipped (destination exists)");
            return Ok(());
        };

        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let temp = local_temp_path(&dest, &spec.id);

        let chunk = self.settings.read().chunk_size();
        let limit = self.settings.read().speed_limit_kbps as u64 * 1024;

        self.set_status(task, Status::Transferring);
        let copied = async {
            let mut remote = sftp.open(remote_src.clone()).await?;
            let mut local = tokio::fs::File::create(&temp).await?;
            let mut buffer = vec![0u8; chunk];
            let mut received: u64 = 0;
            let started = Instant::now();
            let mut sample_time = Instant::now();
            let mut sample_bytes = 0u64;
            let mut speed = 0.0f64;

            loop {
                self.wait_if_paused(task).await?;
                let read = remote.read(&mut buffer).await?;
                if read == 0 {
                    break;
                }
                local.write_all(&buffer[..read]).await?;
                received += read as u64;
                sample_bytes += read as u64;
                if sample_time.elapsed() >= Duration::from_millis(400) {
                    speed = sample_bytes as f64 / sample_time.elapsed().as_secs_f64();
                    sample_time = Instant::now();
                    sample_bytes = 0;
                }
                self.progress(task, received, speed);
                self.throttle(started, received, limit).await;
            }
            local.flush().await?;
            local.sync_all().await?;
            drop(local);
            let _ = remote.close().await;
            Ok::<u64, AppError>(received)
        }
        .await;

        let received = match copied {
            Ok(received) => received,
            Err(e) => {
                // Never leave a partial .part file behind on failure.
                let _ = tokio::fs::remove_file(&temp).await;
                return Err(e);
            }
        };

        self.set_status(task, Status::Verifying);
        let written = tokio::fs::metadata(&temp).await?.len();
        if written != attrs.len() || received != attrs.len() {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(AppError::new(
                "verification_failed",
                format!(
                    "Received {} of {} — the partial file was removed",
                    human_size(written),
                    human_size(attrs.len())
                ),
            ));
        }

        if self.settings.read().verify_checksums && self.settings.read().allow_server_commands {
            match self
                .remote_sha256(&profile, &remote_src, spec.password.as_deref())
                .await
            {
                Ok(remote_hash) => {
                    let local_hash = sha256_file(&temp).await?;
                    if remote_hash != local_hash {
                        let _ = tokio::fs::remove_file(&temp).await;
                        tracing::warn!(
                            job = %spec.id,
                            local = %local_hash,
                            remote = %remote_hash,
                            "download checksum mismatch"
                        );
                        return Err(AppError::new(
                            "checksum_mismatch",
                            format!(
                                "SHA-256 mismatch (server {}…, local {}…) — the downloaded file was discarded",
                                short_hash(&remote_hash),
                                short_hash(&local_hash)
                            ),
                        ));
                    }
                    self.set_method(task, "stream + sha256");
                }
                Err(_) => self.set_method(task, "stream + size"),
            }
        } else {
            self.set_method(task, "stream + size");
        }

        tokio::fs::rename(&temp, &dest).await?;
        Ok(())
    }

    async fn remote_copy(&self, task: &Arc<TaskHandle>, is_move: bool) -> AppResult<()> {
        let spec = &task.spec;
        let src_profile = self.profile(&spec.profile_id).await?;
        let dest_profile = match &spec.dest_profile_id {
            Some(id) if id != &spec.profile_id => Some(self.profile(id).await?),
            _ => None,
        };
        let src_path = spec
            .remote_src
            .clone()
            .ok_or_else(|| AppError::new("invalid_spec", "Missing source path"))?;
        let dest_path = spec
            .remote_dest
            .clone()
            .ok_or_else(|| AppError::new("invalid_spec", "Missing destination path"))?;
        if src_path == dest_path {
            return Err(AppError::new(
                "invalid_spec",
                "Source and destination are identical",
            ));
        }

        let src_sftp = open_sftp(&self.ssh, &src_profile, spec.password.as_deref()).await?;
        let attrs = src_sftp.metadata(src_path.clone()).await?;
        if attrs.is_dir() {
            // Whole-tree operations are executed on the server itself and only
            // with the user's permission to run commands.
            if dest_profile.is_some() || !self.settings.read().allow_server_commands {
                return Err(AppError::new(
                    "invalid_spec",
                    "This folder operation needs server-side command permission (Settings → Security)",
                ));
            }
            if src_sftp.metadata(dest_path.clone()).await.is_ok() {
                return Err(AppError::new(
                    "already_exists",
                    "The destination folder already exists",
                ));
            }
            let command = if is_move {
                format!(
                    "mv -- {} {}",
                    rp::shell_quote(&src_path),
                    rp::shell_quote(&dest_path)
                )
            } else {
                format!(
                    "cp -a -- {} {}",
                    rp::shell_quote(&src_path),
                    rp::shell_quote(&dest_path)
                )
            };
            self.set_status(task, Status::Transferring);
            let out = self
                .ssh
                .exec(&src_profile, spec.password.as_deref(), &command, 3600)
                .await?;
            if out.code != 0 {
                return Err(AppError::new(
                    "server_copy_failed",
                    format!(
                        "The server refused the operation ({}): {}",
                        out.code,
                        out.stderr.trim()
                    ),
                ));
            }
            if src_sftp.metadata(dest_path.clone()).await.is_err() {
                return Err(AppError::new(
                    "verification_failed",
                    "The server reported success but the destination does not exist",
                ));
            }
            self.set_method(
                task,
                if is_move {
                    "server-side move (mv)"
                } else {
                    "server-side copy (cp -a)"
                },
            );
            return Ok(());
        }
        self.set_total(task, attrs.len());

        let same_server = dest_profile.is_none();

        let (dest_sftp, raw_dest) = match dest_profile {
            None => (src_sftp.clone(), dest_path.clone()),
            Some(profile) => {
                let sftp = open_sftp(&self.ssh, &profile, spec.password.as_deref()).await?;
                (sftp, dest_path.clone())
            }
        };

        // Resolve the overwrite policy *before* the rename fast path. A move used
        // to call `rename` straight onto the requested destination, which
        // silently ignored "skip" and "rename" and destroyed the file that was
        // already there.
        let dest = match self
            .resolve_overwrite(&dest_sftp, &raw_dest, &spec.overwrite, task)
            .await?
        {
            Some(dest) => dest,
            None => {
                self.set_method(task, "skipped (destination exists)");
                return Ok(());
            }
        };

        // Fast path: same server and same filesystem → rename.
        if is_move && same_server {
            self.set_status(task, Status::Connecting);
            match src_sftp.rename(src_path.clone(), dest.clone()).await {
                Ok(()) => {
                    self.set_method(task, "server-side rename");
                    self.progress(task, attrs.len(), 0.0);
                    return Ok(());
                }
                Err(e) => {
                    tracing::info!("rename failed ({e}); falling back to copy + delete");
                }
            }
        }

        // Server-side copy: only with the user's explicit permission to run
        // commands, and only with strictly shell-quoted arguments.
        if !is_move && same_server && self.settings.read().allow_server_commands {
            let command = format!(
                "cp -p -- {} {}",
                rp::shell_quote(&src_path),
                rp::shell_quote(&dest)
            );
            match self
                .ssh
                .exec(&src_profile, spec.password.as_deref(), &command, 3600)
                .await
            {
                Ok(out) if out.code == 0 => {
                    let size_ok = dest_sftp
                        .metadata(dest.clone())
                        .await
                        .map(|m| m.len() == attrs.len())
                        .unwrap_or(false);
                    if size_ok {
                        self.set_method(task, "server-side copy (cp)");
                        self.progress(task, attrs.len(), 0.0);
                        return Ok(());
                    }
                    tracing::warn!("server-side copy size mismatch, falling back to streaming");
                    let _ = dest_sftp.remove_file(dest.clone()).await;
                }
                Ok(out) => {
                    tracing::warn!(
                        code = out.code,
                        stderr = %out.stderr,
                        "server-side copy refused, streaming instead"
                    );
                }
                Err(e) => tracing::warn!("server-side copy unavailable: {e}"),
            }
        }

        // Streaming fallback (also the path for cross-server copies).
        self.set_status(task, Status::Transferring);
        let temp = temp_name(&dest, &spec.id);
        let chunk = self.settings.read().chunk_size();
        let mut source = src_sftp.open(src_path.clone()).await?;
        let mut target = dest_sftp
            .open_with_flags(
                temp.clone(),
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await?;
        let mut buffer = vec![0u8; chunk];
        let mut moved: u64 = 0;
        let mut sample_time = Instant::now();
        let mut sample_bytes = 0u64;
        let mut speed = 0.0f64;

        loop {
            self.wait_if_paused(task).await?;
            let read = source.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            target.write_all(&buffer[..read]).await?;
            moved += read as u64;
            sample_bytes += read as u64;
            if sample_time.elapsed() >= Duration::from_millis(400) {
                speed = sample_bytes as f64 / sample_time.elapsed().as_secs_f64();
                sample_time = Instant::now();
                sample_bytes = 0;
            }
            self.progress(task, moved, speed);
        }
        target.flush().await?;
        let _ = target.sync_all().await;
        target.close().await?;
        let _ = source.close().await;

        let written = dest_sftp.metadata(temp.clone()).await?.len();
        if written != attrs.len() {
            let _ = dest_sftp.remove_file(temp.clone()).await;
            return Err(AppError::new(
                "verification_failed",
                "The copy is incomplete; the partial destination was removed",
            ));
        }
        self.set_method(task, "streamed through this computer");
        self.commit(&dest_sftp, &temp, &dest).await?;

        if is_move {
            src_sftp.remove_file(src_path).await?;
            self.set_method(task, "streamed, then source removed");
        }
        Ok(())
    }

    /// Returns `None` when the destination exists and the policy is "skip".
    async fn resolve_overwrite(
        &self,
        sftp: &Arc<SftpSession>,
        dest: &str,
        policy: &str,
        task: &Arc<TaskHandle>,
    ) -> AppResult<Option<String>> {
        let _ = task;
        let exists = sftp.metadata(dest.to_string()).await.is_ok();
        if !exists {
            return Ok(Some(dest.to_string()));
        }
        match policy {
            "skip" => Ok(None),
            "rename" => {
                let parent = rp::parent(dest);
                let name = rp::file_name(dest);
                let (stem, ext) = match name.rfind('.') {
                    Some(idx) if idx > 0 => (name[..idx].to_string(), name[idx..].to_string()),
                    _ => (name.clone(), String::new()),
                };
                for counter in 2..=9999 {
                    let candidate = rp::join(&parent, &format!("{stem} ({counter}){ext}"));
                    if sftp.metadata(candidate.clone()).await.is_err() {
                        return Ok(Some(candidate));
                    }
                }
                Err(AppError::new(
                    "invalid_spec",
                    "Cannot find a free file name",
                ))
            }
            _ => Ok(Some(dest.to_string())),
        }
    }

    async fn commit(&self, sftp: &Arc<SftpSession>, temp: &str, dest: &str) -> AppResult<()> {
        sftp.rename(temp.to_string(), dest.to_string())
            .await
            .map_err(|e| {
                let message = format!("Could not replace the destination file: {e}");
                AppError::new("rename_failed", message)
            })?;
        Ok(())
    }

    async fn remote_sha256(
        &self,
        profile: &Profile,
        path: &str,
        password: Option<&str>,
    ) -> AppResult<String> {
        let command = format!(
            "if command -v sha256sum >/dev/null 2>&1; then sha256sum -- {}; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 -- {}; else exit 127; fi",
            rp::shell_quote(path),
            rp::shell_quote(path)
        );
        let out = self.ssh.exec(profile, password, &command, 3600).await?;
        if out.code != 0 {
            return Err(AppError::new(
                "checksum_unavailable",
                "No SHA-256 tool on the server",
            ));
        }
        parse_sha256(&out.stdout).ok_or_else(|| {
            tracing::debug!(stdout = %out.stdout, stderr = %out.stderr, "unexpected checksum output");
            AppError::new("checksum_unavailable", "Unexpected checksum output")
        })
    }

    pub fn pause(&self, id: &str) -> AppResult<()> {
        let task = self.task(id)?;
        if !task.state.lock().can_pause {
            return Err(AppError::unsupported("This transfer cannot be paused"));
        }
        task.paused.store(true, Ordering::SeqCst);
        self.emit_forced();
        Ok(())
    }

    pub fn resume(&self, id: &str) -> AppResult<()> {
        let task = self.task(id)?;
        task.paused.store(false, Ordering::SeqCst);
        task.resume.notify_waiters();
        self.emit_forced();
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> AppResult<()> {
        let task = self.task(id)?;
        task.cancel.cancel();
        task.paused.store(false, Ordering::SeqCst);
        task.resume.notify_waiters();
        let status = task.state.lock().status.clone();
        if status == Status::Queued.as_str() {
            task.state.lock().status = Status::Cancelled.as_str().to_string();
            task.state.lock().finished_at = Some(chrono::Utc::now().timestamp_millis());
            self.queue.lock().retain(|q| q != id);
            let spec = &task.spec;
            let state = task.state.lock().clone();
            self.record_history(spec, &state);
        }
        self.emit_forced();
        Ok(())
    }

    pub fn retry(&self, id: &str) -> AppResult<()> {
        let task = self.task(id)?;
        {
            let mut state = task.state.lock();
            if !matches!(state.status.as_str(), "failed" | "cancelled" | "completed") {
                return Err(AppError::new(
                    "invalid_state",
                    "Only finished transfers can be retried",
                ));
            }
            state.status = Status::Queued.as_str().to_string();
            state.transferred = 0;
            state.speed_bps = 0.0;
            state.error = None;
            state.finished_at = None;
            state.method = None;
        }
        task.cancel.cancel();
        // Replace the token so the new attempt is not immediately cancelled.
        // TaskHandle owns a plain CancellationToken, so a retried task is
        // re-registered under the same id with a fresh handle.
        let fresh = Arc::new(TaskHandle {
            spec: JobSpec {
                id: task.spec.id.clone(),
                kind: task.spec.kind,
                name: task.spec.name.clone(),
                profile_id: task.spec.profile_id.clone(),
                dest_profile_id: task.spec.dest_profile_id.clone(),
                local_path: task.spec.local_path.clone(),
                remote_src: task.spec.remote_src.clone(),
                remote_dest: task.spec.remote_dest.clone(),
                size: task.spec.size,
                overwrite: task.spec.overwrite.clone(),
                password: task.spec.password.clone(),
                source_label: task.spec.source_label.clone(),
                dest_label: task.spec.dest_label.clone(),
            },
            state: ParkingMutex::new(task.state.lock().clone()),
            cancel: CancellationToken::new(),
            paused: AtomicBool::new(false),
            resume: Notify::new(),
        });
        self.tasks.insert(id.to_string(), fresh);
        self.queue.lock().push_back(id.to_string());
        self.notify.notify_one();
        self.emit_forced();
        Ok(())
    }

    pub fn retry_failed(&self) -> AppResult<()> {
        let failed: Vec<String> = self
            .tasks
            .iter()
            .filter(|t| t.state.lock().status == Status::Failed.as_str())
            .map(|t| t.spec.id.clone())
            .collect();
        for id in failed {
            let _ = self.retry(&id);
        }
        Ok(())
    }

    pub fn clear_completed(&self) -> AppResult<()> {
        let finished: Vec<String> = self
            .tasks
            .iter()
            .filter(|t| {
                matches!(
                    t.state.lock().status.as_str(),
                    "completed" | "cancelled" | "failed"
                )
            })
            .map(|t| t.spec.id.clone())
            .collect();
        for id in finished {
            self.tasks.remove(&id);
        }
        self.order.lock().retain(|id| self.tasks.contains_key(id));
        self.queue.lock().retain(|id| self.tasks.contains_key(id));
        self.emit_forced();
        Ok(())
    }

    fn task(&self, id: &str) -> AppResult<Arc<TaskHandle>> {
        self.tasks
            .get(id)
            .map(|t| t.clone())
            .ok_or_else(|| AppError::not_found("Transfer not found"))
    }

    pub fn active_count(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }
}

fn temp_name(dest: &str, id: &str) -> String {
    let short = &id[..8.min(id.len())];
    format!("{dest}.swiftsftp-{short}.part")
}

/// Parse the SHA-256 line printed by `sha256sum` / `shasum`.
///
/// The hash is the first 64-character hex token on the line. GNU coreutils also
/// prefixes an escaped line with a backslash when the file name contains a
/// backslash or a newline, and a login shell can print a banner before the
/// command output, so neither the first token nor a fixed offset can be trusted.
fn parse_sha256(stdout: &str) -> Option<String> {
    stdout.split_whitespace().find_map(|token| {
        let candidate = token.trim_start_matches('\\');
        if candidate.len() == 64 && candidate.bytes().all(|b| b.is_ascii_hexdigit()) {
            Some(candidate.to_ascii_lowercase())
        } else {
            None
        }
    })
}

/// First 12 characters of a hash, for messages that must stay readable.
fn short_hash(hash: &str) -> &str {
    &hash[..12.min(hash.len())]
}

/// Errors worth retrying automatically: connection trouble, timeouts and I/O
/// hiccups. Deterministic failures (bad path, permissions, checksum mismatch)
/// are never retried, so the queue cannot spin.
fn retryable(code: &str) -> bool {
    !matches!(
        code,
        "cancelled"
            | "invalid_spec"
            | "invalid_path"
            | "invalid_name"
            | "invalid_profile"
            | "invalid_group"
            | "auth_failed"
            | "credentials_required"
            | "permission_denied"
            | "not_found"
            | "already_exists"
            | "checksum_mismatch"
            | "encoding"
            | "file_too_large"
            | "is_a_directory"
            | "profile_not_found"
            | "unsupported"
            | "session_not_found"
    )
}

/// Temporary local name for a download, in the same folder as the destination
/// and unique per job. Appending to the full file name (instead of replacing the
/// extension) also keeps names like `archive.tar.gz` intact.
fn local_temp_path(dest: &std::path::Path, id: &str) -> PathBuf {
    let short = &id[..8.min(id.len())];
    let mut name = dest
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from("download"));
    name.push(format!(".swiftsftp-{short}.part"));
    match dest.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(name),
        _ => PathBuf::from(name),
    }
}

/// Resolve the local destination for a download against the overwrite policy.
/// Returns `None` when the destination exists and the policy is "skip".
async fn resolve_local_overwrite(
    dest: &std::path::Path,
    policy: &str,
) -> AppResult<Option<PathBuf>> {
    if !tokio::fs::try_exists(dest).await.unwrap_or(false) {
        return Ok(Some(dest.to_path_buf()));
    }
    match policy {
        "skip" => Ok(None),
        "rename" => {
            let parent = match dest.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
                _ => PathBuf::from("."),
            };
            let name = dest
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let (stem, ext) = match name.rfind('.') {
                Some(idx) if idx > 0 => (name[..idx].to_string(), name[idx..].to_string()),
                _ => (name.clone(), String::new()),
            };
            for counter in 2..=9999 {
                let candidate = parent.join(format!("{stem} ({counter}){ext}"));
                if !tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
                    return Ok(Some(candidate));
                }
            }
            Err(AppError::new(
                "invalid_spec",
                "Cannot find a free file name",
            ))
        }
        _ => Ok(Some(dest.to_path_buf())),
    }
}

pub async fn sha256_file(path: &std::path::Path) -> AppResult<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 128];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_names_match_frontend_contract() {
        assert_eq!(Status::Queued.as_str(), "queued");
        assert_eq!(Status::Verifying.as_str(), "verifying");
        assert_eq!(Status::Cancelled.as_str(), "cancelled");
    }

    #[test]
    fn parses_kinds_and_rejects_unknown() {
        assert_eq!(Kind::parse("upload").unwrap(), Kind::Upload);
        assert_eq!(Kind::parse("move_remote").unwrap(), Kind::MoveRemote);
        assert!(Kind::parse("nope").is_err());
    }

    #[test]
    fn temp_names_are_unique_per_job() {
        let a = temp_name("/srv/file.txt", "1234abcd-0000-0000-0000-000000000000");
        let b = temp_name("/srv/file.txt", "9999ffff-0000-0000-0000-000000000000");
        assert_ne!(a, b);
        assert!(a.ends_with(".part"));
        assert!(a.starts_with("/srv/file.txt"));
    }

    #[test]
    fn local_temp_names_keep_the_full_file_name() {
        let dest = std::path::Path::new("C:/tmp/archive.tar.gz");
        let a = local_temp_path(dest, "1234abcd-0000-0000-0000-000000000000");
        let b = local_temp_path(dest, "9999ffff-0000-0000-0000-000000000000");
        assert_ne!(a, b);
        assert_eq!(a.parent(), dest.parent());
        let name = a.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("archive.tar.gz.swiftsftp-"), "{name}");
        assert!(name.ends_with(".part"), "{name}");
    }

    #[tokio::test]
    async fn local_overwrite_policy_is_respected() {
        let dir = std::env::temp_dir().join(format!("swiftsftp-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let existing = dir.join("report.txt");
        tokio::fs::write(&existing, b"old").await.unwrap();

        // A free name is used as-is.
        let fresh = dir.join("new.txt");
        assert_eq!(
            resolve_local_overwrite(&fresh, "replace").await.unwrap(),
            Some(fresh.clone())
        );

        // skip → nothing to do
        assert!(resolve_local_overwrite(&existing, "skip")
            .await
            .unwrap()
            .is_none());

        // replace → same path
        assert_eq!(
            resolve_local_overwrite(&existing, "replace").await.unwrap(),
            Some(existing.clone())
        );

        // rename → a numbered sibling, and it must not be an existing file
        let renamed = resolve_local_overwrite(&existing, "rename")
            .await
            .unwrap()
            .unwrap();
        assert_ne!(renamed, existing);
        assert_eq!(renamed.file_name().unwrap(), "report (2).txt");
        assert!(!tokio::fs::try_exists(&renamed).await.unwrap());

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[test]
    fn parses_sha256_output_robustly() {
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        // Plain `sha256sum file`
        assert_eq!(
            parse_sha256(&format!("{hash}  /srv/file.bin\n")),
            Some(hash.to_string())
        );
        // Escaped line (GNU prefixes a backslash when the name has one)
        assert_eq!(
            parse_sha256(&format!("\\{hash}  /srv/we\\ird.bin\n")),
            Some(hash.to_string())
        );
        // A banner before the output must not be mistaken for the hash
        assert_eq!(
            parse_sha256(&format!("Welcome to server\n{hash}  /srv/file.bin\n")),
            Some(hash.to_string())
        );
        // Uppercase output is normalised
        assert_eq!(
            parse_sha256(&format!("{}  f\n", hash.to_uppercase())),
            Some(hash.to_string())
        );
        // Nothing usable
        assert_eq!(parse_sha256(""), None);
        assert_eq!(parse_sha256("sha256sum: /srv/file: No such file"), None);
        assert_eq!(parse_sha256(&"a".repeat(63)), None);
    }

    #[test]
    fn retry_policy_skips_deterministic_errors() {
        assert!(retryable("timeout"));
        assert!(retryable("connection_lost"));
        assert!(retryable("sftp_error"));
        assert!(retryable("verification_failed"));
        assert!(!retryable("cancelled"));
        assert!(!retryable("permission_denied"));
        assert!(!retryable("invalid_spec"));
        assert!(!retryable("checksum_mismatch"));
    }
}
