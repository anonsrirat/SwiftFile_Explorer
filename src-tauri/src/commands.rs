//! Tauri command surface. Every button in the UI maps to one of these.

use crate::db::{Favorite, HistoryEntry, KnownHost, Profile, RecentEntry};
use crate::error::{AppError, AppResult};
use crate::remote_path as rp;
use crate::sftp::{FileStat, ListResult, SearchOptions, SearchResult, TextFile};
use crate::ssh::HostKeyDecision;
use crate::transfer::{TransferSpec, TransferTask};
use crate::{AppPaths, AppState};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub log_file: String,
    pub db_file: String,
    pub webview2: Option<String>,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: state.paths.data_dir.clone(),
        log_file: state.paths.log_file.clone(),
        db_file: state.paths.db_path.clone(),
        webview2: webview2_version(),
    }
}

fn webview2_version() -> Option<String> {
    #[cfg(windows)]
    {
        let keys = [
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ];
        for key in keys {
            let out = std::process::Command::new("reg")
                .args(["query", key, "/v", "pv"])
                .output()
                .ok()?;
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = text.lines().find(|l| l.contains("pv")) {
                    if let Some(value) = line.split_whitespace().last() {
                        return Some(value.to_string());
                    }
                }
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}

// ---------------- settings ----------------

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> crate::settings::Settings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn settings_set(
    state: State<'_, AppState>,
    settings: crate::settings::Settings,
) -> AppResult<crate::settings::Settings> {
    let mut next = settings;
    next.sanitize();
    state.db.save_settings(&next)?;
    *state.settings.write() = next.clone();
    Ok(next)
}

#[tauri::command]
pub fn settings_reset(state: State<'_, AppState>) -> AppResult<crate::settings::Settings> {
    let defaults = crate::settings::Settings::default();
    state.db.save_settings(&defaults)?;
    *state.settings.write() = defaults.clone();
    Ok(defaults)
}

#[tauri::command]
pub fn settings_export(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let settings = state.settings.read().clone();
    let json = serde_json::to_string_pretty(&settings)?;
    std::fs::write(path, json)?;
    Ok(())
}

#[tauri::command]
pub fn settings_import(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<crate::settings::Settings> {
    let raw = std::fs::read_to_string(path)?;
    let mut settings: crate::settings::Settings = serde_json::from_str(&raw).map_err(|e| {
        AppError::new(
            "invalid_settings",
            format!("Not a valid settings file: {e}"),
        )
    })?;
    settings.sanitize();
    state.db.save_settings(&settings)?;
    *state.settings.write() = settings.clone();
    Ok(settings)
}

// ---------------- profiles ----------------

#[tauri::command]
pub fn profiles_list(state: State<'_, AppState>) -> AppResult<Vec<Profile>> {
    state.db.list_profiles()
}

#[tauri::command]
pub fn groups_list(state: State<'_, AppState>) -> AppResult<Vec<crate::db::ServerGroup>> {
    state.db.list_groups()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGroupArgs {
    pub group: crate::db::ServerGroup,
    /// Old name when renaming an existing group.
    #[serde(default)]
    pub previous: Option<String>,
}

#[tauri::command]
pub fn group_save(
    state: State<'_, AppState>,
    args: SaveGroupArgs,
) -> AppResult<Vec<crate::db::ServerGroup>> {
    if args.group.name.trim().is_empty() {
        return Err(AppError::new("invalid_group", "Give the group a name"));
    }
    let group = crate::db::ServerGroup {
        name: args.group.name.trim().to_string(),
        color: args.group.color,
        position: args.group.position,
    };
    state.db.save_group(&group, args.previous.as_deref())?;
    state.db.list_groups()
}

#[tauri::command]
pub fn group_delete(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Vec<crate::db::ServerGroup>> {
    state.db.delete_group(&name)?;
    state.db.list_groups()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProfileArgs {
    pub profile: Profile,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub clear_password: bool,
    #[serde(default)]
    pub clear_passphrase: bool,
}

#[tauri::command]
pub fn profile_save(state: State<'_, AppState>, args: SaveProfileArgs) -> AppResult<Profile> {
    if args.profile.name.trim().is_empty() {
        return Err(AppError::new("invalid_profile", "Give this server a name"));
    }
    if args.profile.host.trim().is_empty() {
        return Err(AppError::new(
            "invalid_profile",
            "The host name cannot be empty",
        ));
    }
    if args.profile.username.trim().is_empty() {
        return Err(AppError::new(
            "invalid_profile",
            "The username cannot be empty",
        ));
    }
    if args.profile.port == 0 {
        return Err(AppError::new(
            "invalid_profile",
            "The port must be between 1 and 65535",
        ));
    }

    let mut profile = args.profile;
    profile.host = profile.host.trim().to_string();
    profile.name = profile.name.trim().to_string();
    if profile.id.trim().is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
    }

    if let Some(password) = args.password.as_ref() {
        if !password.is_empty() || args.clear_password {
            if args.clear_password {
                state.db.delete_secret(&profile.id, "password")?;
            } else {
                let blob = crate::secrets::protect(password)?;
                state.db.set_secret(&profile.id, "password", &blob)?;
            }
        }
    } else if args.clear_password {
        state.db.delete_secret(&profile.id, "password")?;
    }

    if let Some(passphrase) = args.passphrase.as_ref() {
        if args.clear_passphrase {
            state.db.delete_secret(&profile.id, "passphrase")?;
        } else if !passphrase.is_empty() {
            let blob = crate::secrets::protect(passphrase)?;
            state.db.set_secret(&profile.id, "passphrase", &blob)?;
        }
    } else if args.clear_passphrase {
        state.db.delete_secret(&profile.id, "passphrase")?;
    }

    state.db.save_profile(&profile)?;
    Ok(state.db.get_profile(&profile.id)?.unwrap_or(profile))
}

#[tauri::command]
pub async fn profile_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.close_for_profile(&id);
    state.ssh.disconnect(&id).await;
    state.db.delete_profile(&id)
}

#[tauri::command]
pub fn profile_duplicate(state: State<'_, AppState>, id: String) -> AppResult<Profile> {
    let original = state
        .db
        .get_profile(&id)?
        .ok_or_else(|| AppError::not_found("Server not found"))?;
    let mut copy = original.clone();
    copy.id = uuid::Uuid::new_v4().to_string();
    copy.name = format!("{} (copy)", original.name);
    copy.created_at = 0;
    copy.updated_at = 0;
    copy.last_dir = None;
    state.db.save_profile(&copy)?;
    // Duplicating keeps the same credentials (they are tied to the profile id,
    // so re-encrypt the stored secret under the new id when it exists).
    if let Some(blob) = state.db.get_secret_blob(&id, "password")? {
        if let Ok(plain) = crate::secrets::unprotect(&blob) {
            let new_blob = crate::secrets::protect(&plain)?;
            state.db.set_secret(&copy.id, "password", &new_blob)?;
        }
    }
    if let Some(blob) = state.db.get_secret_blob(&id, "passphrase")? {
        if let Ok(plain) = crate::secrets::unprotect(&blob) {
            let new_blob = crate::secrets::protect(&plain)?;
            state.db.set_secret(&copy.id, "passphrase", &new_blob)?;
        }
    }
    state
        .db
        .get_profile(&copy.id)?
        .ok_or_else(|| AppError::msg("Could not duplicate the server"))
}

#[tauri::command]
pub async fn profile_test(
    state: State<'_, AppState>,
    profile: Profile,
    password: Option<String>,
) -> AppResult<TestResult> {
    let started = std::time::Instant::now();
    let mut probe = profile;
    if probe.id.trim().is_empty() {
        probe.id = format!("test-{}", uuid::Uuid::new_v4());
    }
    let ssh = state.ssh.clone();
    let result = ssh.ensure(&probe, password.as_deref()).await;
    // Never leave a probe transport behind.
    ssh.invalidate(&probe.id).await;
    let latency = started.elapsed().as_millis() as u64;
    match result {
        Ok((handle, reused)) => Ok(TestResult {
            ok: true,
            message: "Connected and authenticated".to_string(),
            latency_ms: latency,
            method: Some(probe.auth_method.clone()),
            reused,
            connected: !handle.is_closed(),
        }),
        Err(e) => Ok(TestResult {
            ok: false,
            message: e.message,
            latency_ms: latency,
            method: None,
            reused: false,
            connected: false,
        }),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: u64,
    pub method: Option<String>,
    pub reused: bool,
    pub connected: bool,
}

// ---------------- connections ----------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResponse {
    pub profile_id: String,
    pub session_id: String,
    pub home: String,
    pub reused: bool,
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    profile_id: String,
    password: Option<String>,
) -> AppResult<ConnectResponse> {
    let profile = state
        .db
        .get_profile(&profile_id)?
        .ok_or_else(|| AppError::not_found("Server not found"))?;
    let (_, reused) = state.ssh.ensure(&profile, password.as_deref()).await?;
    let (session_id, home, _) = state.sessions.open(&profile, password.as_deref()).await?;
    let target = profile
        .last_dir
        .clone()
        .or(profile.default_remote_dir.clone())
        .unwrap_or_else(|| home.clone());
    let _ = state.db.touch_recent(&profile.id, &target, &profile.name);
    Ok(ConnectResponse {
        profile_id,
        session_id,
        home,
        reused,
    })
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    state.sessions.close_for_profile(&profile_id);
    state.ssh.disconnect(&profile_id).await;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub profile_id: String,
    pub connected: bool,
}

#[tauri::command]
pub fn connection_state(state: State<'_, AppState>, profile_id: String) -> ConnectionState {
    ConnectionState {
        connected: state.ssh.is_connected(&profile_id),
        profile_id,
    }
}

#[tauri::command]
pub fn host_key_respond(
    state: State<'_, AppState>,
    request_id: String,
    decision: HostKeyDecision,
) -> AppResult<()> {
    state.ssh.verifier().resolve(&request_id, decision)
}

#[tauri::command]
pub fn known_hosts_list(state: State<'_, AppState>) -> AppResult<Vec<KnownHost>> {
    state.db.list_known_hosts()
}

#[tauri::command]
pub fn known_host_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.delete_known_host(id)
}

// ---------------- sessions / files ----------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSession {
    pub session_id: String,
    pub home: String,
}

#[tauri::command]
pub async fn open_session(
    state: State<'_, AppState>,
    profile_id: String,
    password: Option<String>,
) -> AppResult<OpenSession> {
    let profile = state
        .db
        .get_profile(&profile_id)?
        .ok_or_else(|| AppError::not_found("Server not found"))?;
    let (session_id, home, _) = state.sessions.open(&profile, password.as_deref()).await?;
    Ok(OpenSession { session_id, home })
}

#[tauri::command]
pub fn close_session(state: State<'_, AppState>, session_id: String) {
    state.sessions.close(&session_id);
}

#[tauri::command]
pub async fn list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<ListResult> {
    state.sessions.list_dir(&session_id, &path).await
}

#[tauri::command]
pub async fn stat_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<FileStat> {
    state.sessions.stat(&session_id, &path).await
}

#[tauri::command]
pub async fn mkdir(
    state: State<'_, AppState>,
    session_id: String,
    parent: String,
    name: String,
) -> AppResult<String> {
    state.sessions.mkdir(&session_id, &parent, &name).await
}

#[tauri::command]
pub async fn create_file(
    state: State<'_, AppState>,
    session_id: String,
    parent: String,
    name: String,
) -> AppResult<String> {
    state
        .sessions
        .create_file(&session_id, &parent, &name)
        .await
}

#[tauri::command]
pub async fn rename_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    new_name: String,
) -> AppResult<String> {
    state.sessions.rename(&session_id, &path, &new_name).await
}

#[tauri::command]
pub async fn delete_paths(
    state: State<'_, AppState>,
    session_id: String,
    paths: Vec<String>,
    recursive: bool,
) -> AppResult<usize> {
    state.sessions.delete(&session_id, &paths, recursive).await
}

#[tauri::command]
pub async fn chmod_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    mode: u32,
) -> AppResult<()> {
    state.sessions.chmod(&session_id, &path, mode).await
}

#[tauri::command]
pub async fn read_text_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<TextFile> {
    state.sessions.read_text(&session_id, &path).await
}

#[tauri::command]
pub async fn write_text_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    content: String,
    expected_modified: Option<i64>,
    expected_size: Option<u64>,
    force: bool,
) -> AppResult<Option<i64>> {
    state
        .sessions
        .write_text(
            &session_id,
            &path,
            &content,
            expected_modified,
            expected_size,
            force,
        )
        .await
}

#[tauri::command]
pub async fn search_files(
    state: State<'_, AppState>,
    session_id: String,
    root: String,
    options: SearchOptions,
    search_id: Option<String>,
) -> AppResult<SearchResult> {
    state
        .sessions
        .search(&session_id, &root, options, search_id)
        .await
}

#[tauri::command]
pub fn cancel_search(state: State<'_, AppState>, search_id: String) -> bool {
    state.sessions.cancel_search(&search_id)
}

#[tauri::command]
pub fn set_last_dir(state: State<'_, AppState>, profile_id: String, dir: String) -> AppResult<()> {
    state.db.set_last_dir(&profile_id, &dir)?;
    if let Some(profile) = state.db.get_profile(&profile_id)? {
        state.db.touch_recent(&profile_id, &dir, &profile.name)?;
    }
    Ok(())
}

// ---------------- transfers ----------------

#[tauri::command]
pub fn transfer_enqueue(
    state: State<'_, AppState>,
    specs: Vec<TransferSpec>,
) -> AppResult<Vec<TransferTask>> {
    let mut out = Vec::new();
    for spec in specs {
        out.push(state.transfers.enqueue(spec)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn transfer_list(state: State<'_, AppState>) -> Vec<TransferTask> {
    state.transfers.snapshot()
}

#[tauri::command]
pub fn transfer_pause(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.pause(&id)
}

#[tauri::command]
pub fn transfer_resume(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.resume(&id)
}

#[tauri::command]
pub fn transfer_cancel(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.cancel(&id)
}

#[tauri::command]
pub fn transfer_retry(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.retry(&id)
}

#[tauri::command]
pub fn transfer_retry_failed(state: State<'_, AppState>) -> AppResult<()> {
    state.transfers.retry_failed()
}

#[tauri::command]
pub fn transfer_clear_completed(state: State<'_, AppState>) -> AppResult<()> {
    state.transfers.clear_completed()
}

#[tauri::command]
pub fn transfer_history(state: State<'_, AppState>) -> AppResult<Vec<HistoryEntry>> {
    state.db.list_history()
}

#[tauri::command]
pub fn transfer_clear_history(state: State<'_, AppState>) -> AppResult<()> {
    state.db.clear_history()
}

/// Expand local paths (files or folders) into upload jobs.
#[tauri::command]
pub async fn enqueue_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
    overwrite: Option<String>,
    password: Option<String>,
) -> AppResult<usize> {
    let session = state.sessions.get(&session_id)?;
    let mut specs = Vec::new();
    let mut created_dirs = 0usize;

    for local in local_paths {
        let path = std::path::PathBuf::from(&local);
        let meta = tokio::fs::metadata(&path).await?;
        if meta.is_dir() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .ok_or_else(|| AppError::new("invalid_spec", "Unnamed folder"))?;
            let target_root = rp::join(&remote_dir, &name);
            created_dirs += upload_tree(
                &state,
                &session,
                &path,
                &target_root,
                overwrite.clone(),
                password.clone(),
                &mut specs,
            )
            .await?;
        } else {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".into());
            specs.push(TransferSpec {
                kind: "upload".into(),
                profile_id: session.profile_id.clone(),
                dest_profile_id: None,
                local_path: Some(local.clone()),
                remote_path: rp::join(&remote_dir, &name),
                dest_remote_path: None,
                overwrite: overwrite.clone(),
                password: password.clone(),
                size: Some(meta.len()),
            });
        }
    }

    for spec in specs {
        state.transfers.enqueue(spec)?;
    }
    tracing::info!(created_dirs, "queued uploads");
    Ok(created_dirs)
}

async fn upload_tree(
    state: &State<'_, AppState>,
    session: &Arc<crate::sftp::TabSession>,
    local_dir: &std::path::Path,
    remote_dir: &str,
    overwrite: Option<String>,
    password: Option<String>,
    specs: &mut Vec<TransferSpec>,
) -> AppResult<usize> {
    let mut created = 0usize;
    let mut stack = vec![(local_dir.to_path_buf(), remote_dir.to_string())];
    while let Some((local, remote)) = stack.pop() {
        if let Err(e) = session.sftp.create_dir(remote.clone()).await {
            let exists = session.sftp.metadata(remote.clone()).await.is_ok();
            if !exists {
                return Err(AppError::from(e));
            }
        } else {
            created += 1;
        }
        let mut entries = tokio::fs::read_dir(&local).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            let name = entry.file_name().to_string_lossy().to_string();
            let child_local = entry.path();
            let child_remote = rp::join(&remote, &name);
            if file_type.is_dir() {
                stack.push((child_local, child_remote));
            } else if file_type.is_file() {
                let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
                specs.push(TransferSpec {
                    kind: "upload".into(),
                    profile_id: session.profile_id.clone(),
                    dest_profile_id: None,
                    local_path: Some(child_local.to_string_lossy().to_string()),
                    remote_path: child_remote,
                    dest_remote_path: None,
                    overwrite: overwrite.clone(),
                    password: password.clone(),
                    size: Some(size),
                });
            }
        }
    }
    let _ = state;
    Ok(created)
}

#[tauri::command]
pub async fn enqueue_download(
    state: State<'_, AppState>,
    session_id: String,
    remote_paths: Vec<String>,
    local_dir: String,
    overwrite: Option<String>,
) -> AppResult<usize> {
    let session = state.sessions.get(&session_id)?;
    let mut count = 0usize;
    let base = std::path::PathBuf::from(&local_dir);

    for remote in remote_paths {
        let attrs = session.sftp.metadata(rp::normalize(&remote)).await?;
        let name = rp::file_name(&remote);
        if attrs.is_dir() {
            let mut stack = vec![(rp::normalize(&remote), base.join(&name))];
            while let Some((dir, local)) = stack.pop() {
                tokio::fs::create_dir_all(&local).await?;
                let listing = state.sessions.list_dir(&session_id, &dir).await?;
                for entry in listing.entries {
                    let target = local.join(&entry.name);
                    if entry.is_dir && !entry.is_symlink {
                        stack.push((entry.path, target));
                    } else if !entry.is_dir {
                        state.transfers.enqueue(TransferSpec {
                            kind: "download".into(),
                            profile_id: session.profile_id.clone(),
                            dest_profile_id: None,
                            local_path: Some(target.to_string_lossy().to_string()),
                            remote_path: entry.path,
                            dest_remote_path: None,
                            overwrite: overwrite.clone(),
                            password: None,
                            size: Some(entry.size),
                        })?;
                        count += 1;
                    }
                }
            }
        } else {
            state.transfers.enqueue(TransferSpec {
                kind: "download".into(),
                profile_id: session.profile_id.clone(),
                dest_profile_id: None,
                local_path: Some(base.join(&name).to_string_lossy().to_string()),
                remote_path: rp::normalize(&remote),
                dest_remote_path: None,
                overwrite: overwrite.clone(),
                password: None,
                size: Some(attrs.len()),
            })?;
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
pub async fn enqueue_remote_copy(
    state: State<'_, AppState>,
    session_id: String,
    dest_session_id: String,
    paths: Vec<String>,
    dest_dir: String,
    is_move: bool,
    overwrite: Option<String>,
) -> AppResult<usize> {
    let source = state.sessions.get(&session_id)?;
    let dest = state.sessions.get(&dest_session_id)?;
    let same_server = source.profile_id == dest.profile_id;
    let mut count = 0usize;

    for path in paths {
        let normalized = rp::normalize(&path);
        let name = rp::file_name(&normalized);
        let target = rp::join(&dest_dir, &name);
        let attrs = source.sftp.metadata(normalized.clone()).await?;

        if attrs.is_dir() {
            if is_move && same_server && state.settings.read().allow_server_commands {
                // Single server-side move of the whole tree.
                state.transfers.enqueue(TransferSpec {
                    kind: "move_remote".into(),
                    profile_id: source.profile_id.clone(),
                    dest_profile_id: Some(dest.profile_id.clone()),
                    local_path: None,
                    remote_path: normalized,
                    dest_remote_path: Some(target),
                    overwrite: overwrite.clone(),
                    password: None,
                    size: Some(attrs.len()),
                })?;
                count += 1;
                continue;
            }
            let mut stack = vec![(normalized, target)];
            while let Some((dir, dest_root)) = stack.pop() {
                if let Err(e) = dest.sftp.create_dir(dest_root.clone()).await {
                    if dest.sftp.metadata(dest_root.clone()).await.is_err() {
                        return Err(AppError::from(e));
                    }
                }
                for entry in state.sessions.list_dir(&session_id, &dir).await?.entries {
                    let child = rp::join(&dest_root, &entry.name);
                    if entry.is_dir && !entry.is_symlink {
                        stack.push((entry.path, child));
                    } else if !entry.is_dir {
                        state.transfers.enqueue(TransferSpec {
                            kind: if is_move {
                                "move_remote"
                            } else {
                                "copy_remote"
                            }
                            .into(),
                            profile_id: source.profile_id.clone(),
                            dest_profile_id: Some(dest.profile_id.clone()),
                            local_path: None,
                            remote_path: entry.path,
                            dest_remote_path: Some(child),
                            overwrite: overwrite.clone(),
                            password: None,
                            size: Some(entry.size),
                        })?;
                        count += 1;
                    }
                }
            }
        } else {
            state.transfers.enqueue(TransferSpec {
                kind: if is_move {
                    "move_remote"
                } else {
                    "copy_remote"
                }
                .into(),
                profile_id: source.profile_id.clone(),
                dest_profile_id: Some(dest.profile_id.clone()),
                local_path: None,
                remote_path: normalized,
                dest_remote_path: Some(target),
                overwrite: overwrite.clone(),
                password: None,
                size: Some(attrs.len()),
            })?;
            count += 1;
        }
    }
    Ok(count)
}

// ---------------- bookmarks / tabs / logs ----------------

#[tauri::command]
pub fn favorites_list(
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> AppResult<Vec<Favorite>> {
    state.db.list_favorites(profile_id.as_deref())
}

#[tauri::command]
pub fn favorite_add(
    state: State<'_, AppState>,
    profile_id: String,
    path: String,
    label: String,
) -> AppResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    state.db.add_favorite(&id, &profile_id, &path, &label)
}

#[tauri::command]
pub fn favorite_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.remove_favorite(&id)
}

#[tauri::command]
pub fn recent_list(state: State<'_, AppState>) -> AppResult<Vec<RecentEntry>> {
    state.db.list_recent()
}

#[tauri::command]
pub fn recent_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.db.clear_recent()
}

#[tauri::command]
pub fn open_tabs_load(state: State<'_, AppState>) -> Vec<(String, String)> {
    state.db.load_open_tabs()
}

#[tauri::command]
pub fn open_tabs_save(state: State<'_, AppState>, tabs: Vec<(String, String)>) -> AppResult<()> {
    state.db.save_open_tabs(&tabs)
}

#[tauri::command]
pub fn log_tail(state: State<'_, AppState>, lines: usize) -> AppResult<String> {
    let path = &state.paths.log_file;
    let content = std::fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = content.lines().collect();
    let take = lines.clamp(10, 5000);
    let start = all.len().saturating_sub(take);
    Ok(all[start..].join("\n"))
}

#[tauri::command]
pub fn clear_credentials(state: State<'_, AppState>) -> AppResult<i64> {
    state.db.clear_all_secrets()?;
    Ok(state.db.secret_count().unwrap_or(0))
}

#[tauri::command]
pub fn trusted_hosts_clear(state: State<'_, AppState>) -> AppResult<()> {
    for host in state.db.list_known_hosts()? {
        state.db.delete_known_host(host.id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn factory_reset(state: State<'_, AppState>) -> AppResult<()> {
    state.db.reset_all()?;
    let defaults = crate::settings::Settings::default();
    state.db.save_settings(&defaults)?;
    *state.settings.write() = defaults;
    Ok(())
}

#[tauri::command]
pub fn app_paths(state: State<'_, AppState>) -> AppPaths {
    state.paths.clone()
}

#[tauri::command]
pub fn transfer_queue_depth(state: State<'_, AppState>) -> usize {
    state.transfers.active_count()
}

#[tauri::command]
pub fn profile_touch(state: State<'_, AppState>, profile_id: String, dir: String) -> AppResult<()> {
    state.db.set_last_dir(&profile_id, &dir)?;
    Ok(())
}

#[tauri::command]
pub fn debug_counts(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::json!({
        "profiles": state.db.list_profiles().map(|p| p.len()).unwrap_or(0),
        "sessions": state.sessions.count(),
        "activeTransfers": state.transfers.active_count(),
    })
}
