//! SFTP channel sessions and remote file operations.

use crate::db::Profile;
use crate::error::{AppError, AppResult};
use crate::events::Sink;
use crate::remote_path as rp;
use crate::ssh::SshManager;
use dashmap::DashMap;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileAttributes;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

pub const MAX_EDITABLE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: Option<i64>,
    pub mode: Option<u32>,
    pub owner: Option<u32>,
    pub group: Option<u32>,
    pub hidden: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub path: String,
    pub parent: String,
    pub home: String,
    pub entries: Vec<FileEntry>,
    pub at_root: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub mode: Option<u32>,
    pub owner: Option<u32>,
    pub group: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub size: u64,
    pub modified: Option<i64>,
    pub read_only: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub max_size: Option<u64>,
    #[serde(default)]
    pub modified_after: Option<i64>,
    #[serde(default)]
    pub modified_before: Option<i64>,
    #[serde(default = "default_true")]
    pub recursive: bool,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

fn default_true() -> bool {
    true
}

fn default_max_results() -> usize {
    2000
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub search_id: String,
    pub entries: Vec<FileEntry>,
    pub scanned: u64,
    pub truncated: bool,
    pub cancelled: bool,
}

pub struct TabSession {
    pub id: String,
    pub profile_id: String,
    pub sftp: Arc<SftpSession>,
    pub home: String,
    pub opened_at: i64,
}

pub struct SessionManager {
    ssh: Arc<SshManager>,
    sink: Sink,
    sessions: DashMap<String, Arc<TabSession>>,
    searches: DashMap<String, CancellationToken>,
}

/// Open a fresh SFTP channel on the shared SSH transport, retrying once with a
/// new transport if the cached one turns out to be dead.
pub async fn open_sftp(
    ssh: &SshManager,
    profile: &Profile,
    password: Option<&str>,
) -> AppResult<Arc<SftpSession>> {
    let mut last_error = None;
    for attempt in 0..2 {
        let (handle, _) = ssh.ensure(profile, password).await?;
        let channel = match handle.channel_open_session().await {
            Ok(channel) => channel,
            Err(e) => {
                last_error = Some(AppError::new(
                    "ssh_error",
                    format!("Cannot open SSH channel: {e}"),
                ));
                ssh.invalidate(&profile.id).await;
                continue;
            }
        };
        if let Err(e) = channel.request_subsystem(true, "sftp").await {
            last_error = Some(AppError::new(
                "ssh_error",
                format!("Cannot start the SFTP subsystem: {e}"),
            ));
            ssh.invalidate(&profile.id).await;
            continue;
        }
        match SftpSession::new(channel.into_stream()).await {
            Ok(session) => return Ok(Arc::new(session)),
            Err(e) => {
                last_error = Some(AppError::from(e));
                if attempt == 0 {
                    ssh.invalidate(&profile.id).await;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::new("sftp_error", "Could not open an SFTP session")))
}

fn to_millis(attrs: &FileAttributes) -> Option<i64> {
    attrs.mtime.map(|secs| (secs as i64) * 1000)
}

fn entry_from(name: String, path: String, attrs: &FileAttributes) -> FileEntry {
    FileEntry {
        hidden: rp::is_hidden_name(&name),
        name,
        path,
        is_dir: attrs.is_dir(),
        is_symlink: attrs.is_symlink(),
        size: attrs.len(),
        modified: to_millis(attrs),
        mode: attrs.permissions.map(|p| p & 0o7777),
        owner: attrs.uid,
        group: attrs.gid,
    }
}

pub fn format_mode(mode: u32) -> String {
    let mut out = String::new();
    for shift in [6, 3, 0] {
        let bits = (mode >> shift) & 0o7;
        out.push(if bits & 0o4 != 0 { 'r' } else { '-' });
        out.push(if bits & 0o2 != 0 { 'w' } else { '-' });
        out.push(if bits & 0o1 != 0 { 'x' } else { '-' });
    }
    out
}

impl SessionManager {
    pub fn new(ssh: Arc<SshManager>, app: AppHandle) -> Self {
        Self::with_sink(ssh, Arc::new(app))
    }

    pub fn with_sink(ssh: Arc<SshManager>, sink: Sink) -> Self {
        Self {
            ssh,
            sink,
            sessions: DashMap::new(),
            searches: DashMap::new(),
        }
    }

    pub fn get(&self, session_id: &str) -> AppResult<Arc<TabSession>> {
        self.sessions
            .get(session_id)
            .map(|s| s.clone())
            .ok_or_else(|| AppError::new("session_not_found", "This tab's SFTP session is closed"))
    }

    pub async fn open(
        &self,
        profile: &Profile,
        password: Option<&str>,
    ) -> AppResult<(String, String, &'static str)> {
        let sftp = open_sftp(&self.ssh, profile, password).await?;
        let home = sftp
            .canonicalize(".")
            .await
            .unwrap_or_else(|_| "/".to_string());
        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.insert(
            id.clone(),
            Arc::new(TabSession {
                id: id.clone(),
                profile_id: profile.id.clone(),
                sftp,
                home: home.clone(),
                opened_at: chrono::Utc::now().timestamp_millis(),
            }),
        );
        Ok((id, home, "sftp"))
    }

    pub fn count(&self) -> usize {
        self.sessions.len()
    }

    pub fn close(&self, session_id: &str) {
        if let Some((_, session)) = self.sessions.remove(session_id) {
            let sftp = session.sftp.clone();
            tauri::async_runtime::spawn(async move {
                let _ = sftp.close().await;
            });
        }
    }

    pub fn close_for_profile(&self, profile_id: &str) {
        let ids: Vec<String> = self
            .sessions
            .iter()
            .filter(|s| s.profile_id == profile_id)
            .map(|s| s.id.clone())
            .collect();
        for id in ids {
            self.close(&id);
        }
    }

    pub async fn list_dir(&self, session_id: &str, path: &str) -> AppResult<ListResult> {
        let session = self.get(session_id)?;
        let requested = if path.trim().is_empty() {
            session.home.clone()
        } else {
            rp::normalize(path)
        };

        let resolved = match session.sftp.canonicalize(&requested).await {
            Ok(p) => p,
            Err(e) => {
                // realpath can fail on servers that do not implement it fully;
                // fall through to the requested path and let read_dir decide.
                tracing::debug!("canonicalize({requested}) failed: {e}");
                requested.clone()
            }
        };

        let dir =
            session
                .sftp
                .read_dir(resolved.clone())
                .await
                .map_err(|e| match AppError::from(e) {
                    AppError { ref code, .. } if code == "sftp_error" => AppError::new(
                        "not_a_directory",
                        format!("Cannot open {resolved} as a folder"),
                    ),
                    other => other,
                })?;

        let mut entries = Vec::new();
        for entry in dir {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let attrs = entry.metadata();
            entries.push(entry_from(name, entry.path(), &attrs));
        }

        Ok(ListResult {
            parent: rp::parent(&resolved),
            at_root: rp::is_root(&resolved),
            home: session.home.clone(),
            path: resolved,
            entries,
        })
    }

    pub async fn stat(&self, session_id: &str, path: &str) -> AppResult<FileStat> {
        let session = self.get(session_id)?;
        let path = rp::normalize(path);
        let attrs = session
            .sftp
            .symlink_metadata(&path)
            .await
            .map_err(AppError::from)?;
        Ok(FileStat {
            name: rp::file_name(&path),
            path,
            is_dir: attrs.is_dir(),
            is_symlink: attrs.is_symlink(),
            size: attrs.len(),
            modified: to_millis(&attrs),
            mode: attrs.permissions.map(|p| p & 0o7777),
            owner: attrs.uid,
            group: attrs.gid,
        })
    }

    pub async fn mkdir(&self, session_id: &str, parent: &str, name: &str) -> AppResult<String> {
        let session = self.get(session_id)?;
        let name = sanitize_name(name)?;
        let path = rp::join(parent, &name);
        session.sftp.create_dir(path.clone()).await?;
        Ok(path)
    }

    pub async fn create_file(
        &self,
        session_id: &str,
        parent: &str,
        name: &str,
    ) -> AppResult<String> {
        let session = self.get(session_id)?;
        let name = sanitize_name(name)?;
        let path = rp::join(parent, &name);
        let file = session.sftp.create(path.clone()).await?;
        file.close().await?;
        Ok(path)
    }

    pub async fn rename(&self, session_id: &str, path: &str, new_name: &str) -> AppResult<String> {
        let session = self.get(session_id)?;
        let name = sanitize_name(new_name)?;
        let source = rp::normalize(path);
        if rp::is_dangerous_target(&source) {
            return Err(AppError::new(
                "invalid_path",
                "Refusing to rename this location",
            ));
        }
        let target = rp::join(&rp::parent(&source), &name);
        session.sftp.rename(source, target.clone()).await?;
        Ok(target)
    }

    pub async fn delete(
        &self,
        session_id: &str,
        paths: &[String],
        recursive: bool,
    ) -> AppResult<usize> {
        let session = self.get(session_id)?;
        let mut removed = 0usize;
        for path in paths {
            let normalized = rp::normalize(path);
            if rp::is_dangerous_target(&normalized) {
                return Err(AppError::new(
                    "invalid_path",
                    format!("Refusing to delete {normalized}"),
                ));
            }
            removed += self.delete_one(&session, &normalized, recursive).await?;
        }
        Ok(removed)
    }

    async fn delete_one(
        &self,
        session: &Arc<TabSession>,
        path: &str,
        recursive: bool,
    ) -> AppResult<usize> {
        let attrs = session.sftp.symlink_metadata(path).await?;
        if attrs.is_dir() && !attrs.is_symlink() {
            if !recursive {
                session.sftp.remove_dir(path.to_string()).await?;
                return Ok(1);
            }
            // Depth-first, post-order: a directory can only be removed once it is
            // empty. Each directory is pushed twice — first as "to be visited",
            // then again as "remove me" after its children, so the marker is
            // always popped after the subtree.
            let mut stack = vec![(path.to_string(), false)];
            let mut removed = 0;
            while let Some((dir, remove_now)) = stack.pop() {
                if remove_now {
                    session.sftp.remove_dir(dir).await?;
                    removed += 1;
                    continue;
                }
                stack.push((dir.clone(), true));
                let entries = session.sftp.read_dir(dir.clone()).await?;
                let mut names = Vec::new();
                for entry in entries {
                    names.push(entry.file_name());
                }
                for name in names {
                    let child = rp::join(&dir, &name);
                    let child_attrs = session.sftp.symlink_metadata(child.clone()).await?;
                    if child_attrs.is_dir() && !child_attrs.is_symlink() {
                        stack.push((child, false));
                    } else {
                        session.sftp.remove_file(child).await?;
                        removed += 1;
                    }
                }
            }
            Ok(removed)
        } else {
            session.sftp.remove_file(path.to_string()).await?;
            Ok(1)
        }
    }

    pub async fn chmod(&self, session_id: &str, path: &str, mode: u32) -> AppResult<()> {
        let session = self.get(session_id)?;
        let path = rp::normalize(path);
        let current = session.sftp.symlink_metadata(path.clone()).await?;
        let type_bits = current.permissions.unwrap_or(0) & 0o170000;
        let attrs = FileAttributes {
            permissions: Some(type_bits | (mode & 0o7777)),
            ..Default::default()
        };
        session.sftp.set_metadata(path, attrs).await?;
        Ok(())
    }

    pub async fn read_text(&self, session_id: &str, path: &str) -> AppResult<TextFile> {
        let session = self.get(session_id)?;
        let path = rp::normalize(path);
        let attrs = session.sftp.metadata(path.clone()).await?;
        if attrs.is_dir() {
            return Err(AppError::new(
                "is_a_directory",
                "Cannot open a folder in the editor",
            ));
        }
        if attrs.len() > MAX_EDITABLE_BYTES {
            return Err(AppError::new(
                "file_too_large",
                format!(
                    "This file is {} — the built-in editor opens files up to {}",
                    human_size(attrs.len()),
                    human_size(MAX_EDITABLE_BYTES)
                ),
            ));
        }
        let bytes = {
            let mut file = session.sftp.open(path.clone()).await?;
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::with_capacity(attrs.len() as usize);
            file.read_to_end(&mut buf).await?;
            let _ = file.close().await;
            buf
        };
        let (content, encoding) = decode_text(&bytes)?;
        Ok(TextFile {
            path,
            content,
            encoding,
            size: attrs.len(),
            modified: to_millis(&attrs),
            read_only: attrs.permissions.map(|p| p & 0o200 == 0).unwrap_or(false),
        })
    }

    pub async fn write_text(
        &self,
        session_id: &str,
        path: &str,
        content: &str,
        expected_modified: Option<i64>,
        expected_size: Option<u64>,
        force: bool,
    ) -> AppResult<Option<i64>> {
        let session = self.get(session_id)?;
        let path = rp::normalize(path);
        let existing = session.sftp.metadata(path.clone()).await.ok();

        if let Some(current) = existing.as_ref() {
            if !force {
                let current_modified = to_millis(current);
                let size_changed = expected_size.map(|s| s != current.len());
                let time_changed = match (expected_modified, current_modified) {
                    (Some(a), Some(b)) => a != b,
                    _ => false,
                };
                if size_changed.unwrap_or(false) || time_changed {
                    return Err(AppError::new(
                        "conflict",
                        "The remote file changed on the server since you opened it",
                    ));
                }
            }
        }

        let temp = format!("{}.swiftsftp-{}.tmp", path, uuid::Uuid::new_v4());
        {
            let mut file = session.sftp.create(temp.clone()).await?;
            use tokio::io::AsyncWriteExt;
            file.write_all(content.as_bytes()).await?;
            file.flush().await?;
            let _ = file.sync_all().await;
            file.close().await?;
        }

        // Preserve the previous mode when replacing an existing file.
        if let Some(current) = existing.as_ref() {
            if let Some(mode) = current.permissions {
                let attrs = FileAttributes {
                    permissions: Some(mode),
                    ..Default::default()
                };
                let _ = session.sftp.set_metadata(temp.clone(), attrs).await;
            }
        }

        session
            .sftp
            .rename(temp.clone(), path.clone())
            .await
            .inspect_err(|_| {
                let sftp = session.sftp.clone();
                let temp = temp.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = sftp.remove_file(temp).await;
                });
            })?;

        let updated = session.sftp.metadata(path).await.ok();
        Ok(updated.as_ref().and_then(to_millis))
    }

    pub async fn search(
        &self,
        session_id: &str,
        root: &str,
        options: SearchOptions,
        search_id: Option<String>,
    ) -> AppResult<SearchResult> {
        let session = self.get(session_id)?;
        // The UI creates the id so it can show live progress and cancel a search
        // while it is still running; a server-side id is only used as a fallback.
        let search_id = search_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let token = CancellationToken::new();
        self.searches.insert(search_id.clone(), token.clone());

        let mut entries = Vec::new();
        let mut scanned: u64 = 0;
        let mut truncated = false;
        let mut cancelled = false;
        let mut stack = vec![rp::normalize(if root.is_empty() {
            &session.home
        } else {
            root
        })];
        let mut visited_dirs = 0usize;
        let mut last_emit = std::time::Instant::now();

        let query = options.query.trim().to_lowercase();
        let extensions: Vec<String> = options
            .extensions
            .iter()
            .map(|e| {
                let e = e.trim().trim_start_matches('.').to_lowercase();
                e
            })
            .filter(|e| !e.is_empty())
            .collect();

        'walk: while let Some(dir) = stack.pop() {
            if token.is_cancelled() {
                cancelled = true;
                break;
            }
            visited_dirs += 1;
            if visited_dirs > 200_000 {
                truncated = true;
                break;
            }
            let read = match session.sftp.read_dir(dir.clone()).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::debug!("search: cannot read {dir}: {e}");
                    continue;
                }
            };
            for entry in read {
                if token.is_cancelled() {
                    cancelled = true;
                    break 'walk;
                }
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let attrs = entry.metadata();
                scanned += 1;
                let is_dir = attrs.is_dir();
                let path = entry.path();

                if !is_dir {
                    let lower = name.to_lowercase();
                    let name_matches = query.is_empty() || lower.contains(&query);
                    let ext_matches = if extensions.is_empty() {
                        true
                    } else {
                        lower
                            .rsplit_once('.')
                            .map(|(_, ext)| extensions.iter().any(|e| e == ext))
                            .unwrap_or(false)
                    };
                    let size = attrs.len();
                    let modified = to_millis(&attrs);
                    let size_ok = options.min_size.map(|m| size >= m).unwrap_or(true)
                        && options.max_size.map(|m| size <= m).unwrap_or(true);
                    let time_ok = options
                        .modified_after
                        .map(|t| modified.map(|m| m >= t).unwrap_or(false))
                        .unwrap_or(true)
                        && options
                            .modified_before
                            .map(|t| modified.map(|m| m <= t).unwrap_or(false))
                            .unwrap_or(true);
                    let hidden_ok = options.include_hidden || !rp::is_hidden_name(&name);

                    if name_matches && ext_matches && size_ok && time_ok && hidden_ok {
                        entries.push(entry_from(name, path, &attrs));
                        if entries.len() >= options.max_results {
                            truncated = true;
                            break 'walk;
                        }
                    }
                } else if options.recursive && !attrs.is_symlink() {
                    stack.push(path);
                }

                if last_emit.elapsed() >= Duration::from_millis(200) {
                    last_emit = std::time::Instant::now();
                    self.sink.emit_json(
                        "search://progress",
                        serde_json::json!({
                            "searchId": search_id,
                            "scanned": scanned,
                            "found": entries.len(),
                        }),
                    );
                }
            }
        }

        self.searches.remove(&search_id);
        Ok(SearchResult {
            search_id,
            entries,
            scanned,
            truncated,
            cancelled,
        })
    }

    pub fn cancel_search(&self, search_id: &str) -> bool {
        if let Some((_, token)) = self.searches.remove(search_id) {
            token.cancel();
            true
        } else {
            false
        }
    }
}

pub fn sanitize_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("invalid_name", "The name cannot be empty"));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::new(
            "invalid_name",
            "The name cannot contain path separators",
        ));
    }
    if trimmed.chars().any(|c| c == '\0' || c == '\n' || c == '\r') {
        return Err(AppError::new(
            "invalid_name",
            "The name contains invalid characters",
        ));
    }
    if trimmed.len() > 255 {
        return Err(AppError::new("invalid_name", "The name is too long"));
    }
    Ok(trimmed.to_string())
}

pub fn decode_text(bytes: &[u8]) -> AppResult<(String, String)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let s = String::from_utf8(bytes[3..].to_vec())
            .map_err(|_| AppError::new("encoding", "The file is not valid UTF-8 text"))?;
        return Ok((s, "utf-8-bom".into()));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let s = String::from_utf16(&units)
            .map_err(|_| AppError::new("encoding", "The file is not valid UTF-16LE text"))?;
        return Ok((s, "utf-16le".into()));
    }
    if bytes.contains(&0) && !bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err(AppError::new(
            "encoding",
            "This looks like a binary file and cannot be opened in the text editor",
        ));
    }
    let s = String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::new("encoding", "The file is not valid UTF-8 text"))?;
    Ok((s, "utf-8".into()))
}

pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

pub fn system_time_to_millis(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_modes() {
        assert_eq!(format_mode(0o644), "rw-r--r--");
        assert_eq!(format_mode(0o755), "rwxr-xr-x");
        assert_eq!(format_mode(0o000), "---------");
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(sanitize_name("plugins").is_ok());
        assert!(sanitize_name("ชื่อไฟล์ ไทย.txt").is_ok());
        assert!(sanitize_name("").is_err());
        assert!(sanitize_name("..").is_err());
        assert!(sanitize_name("a/b").is_err());
        assert!(sanitize_name("a\nb").is_err());
    }

    #[test]
    fn decodes_text_encodings() {
        let (text, enc) = decode_text("hello".as_bytes()).unwrap();
        assert_eq!(text, "hello");
        assert_eq!(enc, "utf-8");

        let (text, enc) = decode_text(&[0xFF, 0xFE, b'h', 0, b'i', 0]).unwrap();
        assert_eq!(text, "hi");
        assert_eq!(enc, "utf-16le");

        assert!(decode_text(&[0x00, 0x01, 0x02]).is_err());
    }

    #[test]
    fn human_sizes_are_readable() {
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(1536), "1.5 KB");
        assert_eq!(human_size(1024 * 1024), "1.0 MB");
    }
}
