//! End-to-end tests for the SSH/SFTP core.
//!
//! A real SSH server and a real SFTP subsystem run in-process on `127.0.0.1`
//! (using `russh` + `russh-sftp`), backed by a temporary directory. The tests
//! then drive the *same* code paths the application uses: `SshManager`
//! (transport, host-key verification, password auth), `SessionManager` (listing,
//! file operations, search, text editing) and `TransferManager` (uploads,
//! downloads, remote moves, overwrite policies).
//!
//! Nothing is mocked except the window: events go to a recording sink instead of
//! a webview.

use russh::keys::{Algorithm, HashAlg, PrivateKey};
use russh::server::{Auth, ChannelOpenHandle, Msg, Server as _, Session};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version,
};
use russh_sftp::server::Handler as SftpHandler;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use swiftsftp_lib::db::{Db, Profile};
use swiftsftp_lib::events::{EventSink, Sink};
use swiftsftp_lib::settings::Settings;
use swiftsftp_lib::sftp::{SearchOptions, SessionManager};
use swiftsftp_lib::ssh::SshManager;
use swiftsftp_lib::transfer::{TransferManager, TransferSpec};

const TEST_USER: &str = "tester";
const TEST_PASSWORD: &str = "sftp-test-password";

// ---------------------------------------------------------------- test server

/// Minimal but complete SFTP server backed by a local directory.
struct SftpFs {
    root: PathBuf,
    version: Option<u32>,
    handles: HashMap<String, FsHandle>,
    /// Permissions written through `setstat`. Windows cannot store POSIX modes,
    /// so they are remembered here to make chmod observable.
    modes: HashMap<PathBuf, u32>,
    next_id: u64,
}

enum FsHandle {
    File(std::fs::File),
    Dir { entries: Vec<File>, pos: usize },
}

fn read_at(file: &std::fs::File, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
    #[cfg(windows)]
    {
        std::os::windows::fs::FileExt::seek_read(file, buf, offset)
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::FileExt::read_at(file, buf, offset)
    }
}

fn write_at(file: &std::fs::File, buf: &[u8], offset: u64) -> std::io::Result<usize> {
    #[cfg(windows)]
    {
        std::os::windows::fs::FileExt::seek_write(file, buf, offset)
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::FileExt::write_at(file, buf, offset)
    }
}

fn map_err(error: std::io::Error) -> StatusCode {
    match error.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        std::io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        std::io::ErrorKind::AlreadyExists => StatusCode::Failure,
        _ => StatusCode::Failure,
    }
}

fn ok_status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".to_string(),
        language_tag: "en-US".to_string(),
    }
}

impl SftpFs {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            version: None,
            handles: HashMap::new(),
            modes: HashMap::new(),
            next_id: 0,
        }
    }

    fn insert(&mut self, handle: FsHandle) -> String {
        self.next_id += 1;
        let name = format!("h{}", self.next_id);
        self.handles.insert(name.clone(), handle);
        name
    }

    /// Map a remote path (`/a/b`) onto the sandbox directory.
    fn local(&self, remote: &str) -> PathBuf {
        let mut path = self.root.clone();
        for part in remote.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    if path != self.root {
                        path.pop();
                    }
                }
                other => path.push(other),
            }
        }
        path
    }

    fn attrs(&self, path: &Path, follow: bool) -> Result<FileAttributes, StatusCode> {
        let meta = if follow {
            std::fs::metadata(path)
        } else {
            std::fs::symlink_metadata(path)
        }
        .map_err(map_err)?;

        let mut mode = if meta.is_dir() { 0o040755 } else { 0o100644 };
        if let Some(stored) = self.modes.get(path) {
            mode = (mode & 0o170000) | (stored & 0o7777);
        }
        if meta.permissions().readonly() && mode & 0o200 != 0 {
            mode &= !0o200;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as u32);

        Ok(FileAttributes {
            size: Some(meta.len()),
            uid: Some(1000),
            user: None,
            gid: Some(1000),
            group: None,
            permissions: Some(mode),
            atime: mtime,
            mtime,
        })
    }

    fn attrs_with_id(&self, id: u32, path: &Path, follow: bool) -> Result<Attrs, StatusCode> {
        Ok(Attrs {
            id,
            attrs: self.attrs(path, follow)?,
        })
    }
}

impl SftpHandler for SftpFs {
    type Error = StatusCode;

    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }

    async fn init(
        &mut self,
        version: u32,
        _extensions: HashMap<String, String>,
    ) -> Result<Version, StatusCode> {
        if self.version.is_some() {
            return Err(StatusCode::ConnectionLost);
        }
        self.version = Some(version);
        Ok(Version::new())
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, StatusCode> {
        let mut parts: Vec<&str> = Vec::new();
        for part in path.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                other => parts.push(other),
            }
        }
        // The session "home" is the sandbox root.
        let absolute = format!("/{}", parts.join("/"));
        Ok(Name {
            id,
            files: vec![File::dummy(absolute)],
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let local = self.local(&path);
        self.attrs_with_id(id, &local, true)
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let local = self.local(&path);
        self.attrs_with_id(id, &local, false)
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, StatusCode> {
        let Some(FsHandle::File(file)) = self.handles.get(&handle) else {
            return Err(StatusCode::Failure);
        };
        let meta = file.metadata().map_err(map_err)?;
        let mode = if meta.is_dir() { 0o040755 } else { 0o100644 };
        Ok(Attrs {
            id,
            attrs: FileAttributes {
                size: Some(meta.len()),
                permissions: Some(mode),
                ..Default::default()
            },
        })
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        let path = self.local(&filename);
        let mut options = std::fs::OpenOptions::new();
        options.read(pflags.contains(OpenFlags::READ));
        if pflags.contains(OpenFlags::WRITE) {
            options.write(true);
        }
        if pflags.contains(OpenFlags::CREATE) {
            options.create(true);
        }
        if pflags.contains(OpenFlags::TRUNCATE) {
            options.truncate(true);
        }
        if pflags.contains(OpenFlags::APPEND) {
            options.append(true);
        }
        if pflags.contains(OpenFlags::EXCLUDE) {
            options.create_new(true);
        }
        let file = options.open(&path).map_err(map_err)?;
        Ok(Handle {
            id,
            handle: self.insert(FsHandle::File(file)),
        })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, StatusCode> {
        self.handles.remove(&handle);
        Ok(ok_status(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        let Some(FsHandle::File(file)) = self.handles.get(&handle) else {
            return Err(StatusCode::Failure);
        };
        let mut buffer = vec![0u8; len as usize];
        let read = read_at(file, &mut buffer, offset).map_err(map_err)?;
        if read == 0 {
            return Err(StatusCode::Eof);
        }
        buffer.truncate(read);
        Ok(Data { id, data: buffer })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, StatusCode> {
        let Some(FsHandle::File(file)) = self.handles.get(&handle) else {
            return Err(StatusCode::Failure);
        };
        let mut written = 0usize;
        while written < data.len() {
            let n = write_at(file, &data[written..], offset + written as u64).map_err(map_err)?;
            if n == 0 {
                return Err(StatusCode::Failure);
            }
            written += n;
        }
        Ok(ok_status(id))
    }

    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusCode> {
        let local = self.local(&path);
        if let Some(mode) = attrs.permissions {
            self.modes.insert(local.clone(), mode);
        }
        if let Some(size) = attrs.size {
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(&local)
                .map_err(map_err)?;
            file.set_len(size).map_err(map_err)?;
        }
        Ok(ok_status(id))
    }

    async fn fsetstat(
        &mut self,
        id: u32,
        _handle: String,
        _attrs: FileAttributes,
    ) -> Result<Status, StatusCode> {
        Ok(ok_status(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusCode> {
        let dir = self.local(&path);
        let read = std::fs::read_dir(&dir).map_err(map_err)?;
        let mut entries = vec![
            File::new(".", self.attrs(&dir, true)?),
            File::new("..", self.attrs(&dir, true)?),
        ];
        for entry in read {
            let entry = entry.map_err(map_err)?;
            let child = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let attrs = self.attrs(&child, false)?;
            entries.push(File::new(name, attrs));
        }
        Ok(Handle {
            id,
            handle: self.insert(FsHandle::Dir { entries, pos: 0 }),
        })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, StatusCode> {
        let Some(FsHandle::Dir { entries, pos }) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        if *pos >= entries.len() {
            return Err(StatusCode::Eof);
        }
        let take = 100.min(entries.len() - *pos);
        let files = entries[*pos..*pos + take].to_vec();
        *pos += take;
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, StatusCode> {
        std::fs::remove_file(self.local(&filename)).map_err(map_err)?;
        Ok(ok_status(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, StatusCode> {
        std::fs::create_dir(self.local(&path)).map_err(map_err)?;
        Ok(ok_status(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, StatusCode> {
        std::fs::remove_dir(self.local(&path)).map_err(map_err)?;
        Ok(ok_status(id))
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, StatusCode> {
        let from = self.local(&oldpath);
        let to = self.local(&newpath);
        // `fs::rename` replaces an existing file on both Windows and Unix, which
        // matches what an SFTP client expects from a plain rename.
        std::fs::rename(from, to).map_err(map_err)?;
        Ok(ok_status(id))
    }
}

struct SshSession {
    channels: HashMap<ChannelId, Channel<Msg>>,
    root: PathBuf,
}

struct SshServer {
    root: PathBuf,
}

impl russh::server::Server for SshServer {
    type Handler = SshSession;

    fn new_client(&mut self, _: Option<SocketAddr>) -> SshSession {
        SshSession {
            channels: HashMap::new(),
            root: self.root.clone(),
        }
    }
}

impl russh::server::Handler for SshSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == TEST_USER && password == TEST_PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel_id)?;
            return Ok(());
        }
        match self.channels.remove(&channel_id) {
            Some(channel) => {
                session.channel_success(channel_id)?;
                // `run` spawns the SFTP loop internally and returns immediately.
                russh_sftp::server::run(channel.into_stream(), SftpFs::new(self.root.clone()))
                    .await;
            }
            None => session.channel_failure(channel_id)?,
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- test harness

#[derive(Default)]
struct RecordingSink {
    events: parking_lot::Mutex<Vec<(String, serde_json::Value)>>,
}

impl RecordingSink {
    fn event_names(&self) -> Vec<String> {
        self.events
            .lock()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }
}

impl EventSink for RecordingSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        self.events.lock().push((event.to_string(), payload));
    }
}

struct Harness {
    root: PathBuf,
    local_dir: PathBuf,
    port: u16,
    profile: Profile,
    db: Arc<Db>,
    ssh: Arc<SshManager>,
    sessions: Arc<SessionManager>,
    transfers: Arc<TransferManager>,
    recorder: Arc<RecordingSink>,
}

fn unique_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "swiftsftp-{prefix}-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

impl Harness {
    /// Start a server + managers, and pre-trust the server host key (no prompt).
    async fn start() -> Harness {
        let root = unique_dir("srv");
        let local_dir = unique_dir("local");

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();

        let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        let public = key.public_key();
        let algorithm = public.algorithm().to_string();
        let fingerprint = public.fingerprint(HashAlg::Sha256).to_string();
        let key_text = public.to_openssh().unwrap();

        let config = Arc::new(russh::server::Config {
            keys: vec![key],
            auth_rejection_time: Duration::from_millis(10),
            auth_rejection_time_initial: Some(Duration::from_millis(0)),
            ..Default::default()
        });
        // The running server borrows its listener and handler; keep both alive
        // for the whole test process.
        let listener: &'static tokio::net::TcpListener = Box::leak(Box::new(listener));
        let server: &'static mut SshServer = Box::leak(Box::new(SshServer { root: root.clone() }));
        let running = server.run_on_socket(config, listener);
        tokio::spawn(async move {
            let _ = running.await;
        });

        let db = Arc::new(Db::open(&unique_dir("db").join("test.db")).unwrap());
        // Trust the test server's host key up front, exactly as if the user had
        // accepted it before, so the verifier never has to prompt.
        db.trust_host("127.0.0.1", port, &algorithm, &fingerprint, &key_text)
            .unwrap();

        let recorder = Arc::new(RecordingSink::default());
        let sink: Sink = recorder.clone();
        let ssh = Arc::new(SshManager::with_sink(sink.clone(), db.clone()));
        let sessions = Arc::new(SessionManager::with_sink(ssh.clone(), sink.clone()));
        let settings = Arc::new(parking_lot::RwLock::new(Settings::default()));
        let transfers = Arc::new(TransferManager::with_sink(
            sink,
            ssh.clone(),
            db.clone(),
            settings,
        ));
        transfers.clone().start();

        let profile = Profile {
            id: "test-profile".to_string(),
            name: "Test server".to_string(),
            group_name: "Ungrouped".to_string(),
            color: None,
            host: "127.0.0.1".to_string(),
            port,
            username: TEST_USER.to_string(),
            auth_method: "password".to_string(),
            key_path: None,
            default_remote_dir: None,
            timeout_secs: 15,
            keepalive_secs: 10,
            auto_connect: false,
            last_dir: None,
            has_password: false,
            has_passphrase: false,
            created_at: 0,
            updated_at: 0,
        };
        db.save_profile(&profile).unwrap();

        Harness {
            root,
            local_dir,
            port,
            profile,
            db,
            ssh,
            sessions,
            transfers,
            recorder,
        }
    }

    async fn open_session(&self) -> String {
        let (session_id, home, _) = self
            .sessions
            .open(&self.profile, Some(TEST_PASSWORD))
            .await
            .expect("open sftp session");
        assert_eq!(home, "/", "home must be the sandbox root");
        session_id
    }

    fn local(&self, name: &str) -> PathBuf {
        self.local_dir.join(name)
    }

    /// Wait for a transfer to reach a terminal state and return it.
    async fn wait_transfer(&self, id: &str) -> swiftsftp_lib::transfer::TransferTask {
        for _ in 0..300 {
            let task = self.transfers.snapshot().into_iter().find(|t| t.id == id);
            if let Some(task) = task {
                if matches!(task.status.as_str(), "completed" | "failed" | "cancelled") {
                    return task;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("transfer {id} never finished");
    }

    fn enqueue(&self, spec: TransferSpec) -> String {
        self.transfers.enqueue(spec).expect("enqueue transfer").id
    }

    fn cleanup(&self) {
        let _ = std::fs::remove_dir_all(&self.root);
        let _ = std::fs::remove_dir_all(&self.local_dir);
    }
}

fn upload_spec(profile_id: &str, local: &Path, remote: &str, overwrite: &str) -> TransferSpec {
    TransferSpec {
        kind: "upload".to_string(),
        profile_id: profile_id.to_string(),
        dest_profile_id: None,
        local_path: Some(local.to_string_lossy().to_string()),
        remote_path: remote.to_string(),
        dest_remote_path: None,
        overwrite: Some(overwrite.to_string()),
        password: Some(TEST_PASSWORD.to_string()),
        size: None,
    }
}

fn download_spec(profile_id: &str, remote: &str, local: &Path, overwrite: &str) -> TransferSpec {
    TransferSpec {
        kind: "download".to_string(),
        profile_id: profile_id.to_string(),
        dest_profile_id: None,
        local_path: Some(local.to_string_lossy().to_string()),
        remote_path: remote.to_string(),
        dest_remote_path: None,
        overwrite: Some(overwrite.to_string()),
        password: Some(TEST_PASSWORD.to_string()),
        size: None,
    }
}

fn remote_op_spec(
    profile_id: &str,
    from: &str,
    to: &str,
    is_move: bool,
    overwrite: &str,
) -> TransferSpec {
    TransferSpec {
        kind: if is_move {
            "move_remote"
        } else {
            "copy_remote"
        }
        .to_string(),
        profile_id: profile_id.to_string(),
        dest_profile_id: Some(profile_id.to_string()),
        local_path: None,
        remote_path: from.to_string(),
        dest_remote_path: Some(to.to_string()),
        overwrite: Some(overwrite.to_string()),
        password: Some(TEST_PASSWORD.to_string()),
        size: None,
    }
}

// ------------------------------------------------------------------- the tests

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn browses_and_edits_files_over_sftp() {
    let harness = Harness::start().await;
    let session = harness.open_session().await;

    // Listing the sandbox root works and is empty.
    let home = harness.sessions.list_dir(&session, "/").await.unwrap();
    assert_eq!(home.path, "/");
    assert!(home.entries.is_empty(), "{:?}", home.entries);
    assert!(home.at_root);

    // mkdir / create / rename / delete
    let dir = harness.sessions.mkdir(&session, "/", "docs").await.unwrap();
    assert_eq!(dir, "/docs");
    let file = harness
        .sessions
        .create_file(&session, "/docs", "readme.txt")
        .await
        .unwrap();
    assert_eq!(file, "/docs/readme.txt");
    assert!(std::fs::metadata(harness.root.join("docs/readme.txt")).is_ok());

    let renamed = harness
        .sessions
        .rename(&session, "/docs/readme.txt", "guide.txt")
        .await
        .unwrap();
    assert_eq!(renamed, "/docs/guide.txt");

    // Text read/write round-trip, with the temp-file + rename commit.
    harness
        .sessions
        .write_text(&session, "/docs/guide.txt", "hello", None, None, false)
        .await
        .unwrap();
    let text = harness
        .sessions
        .read_text(&session, "/docs/guide.txt")
        .await
        .unwrap();
    assert_eq!(text.content, "hello");
    assert_eq!(text.encoding, "utf-8");
    assert_eq!(text.size, 5);

    // Conflict detection: a stale size/time must be refused unless forced.
    let conflict = harness
        .sessions
        .write_text(
            &session,
            "/docs/guide.txt",
            "changed",
            Some(1),
            Some(5),
            false,
        )
        .await;
    let conflict = conflict.expect_err("stale write must be refused");
    assert_eq!(conflict.code, "conflict");
    harness
        .sessions
        .write_text(
            &session,
            "/docs/guide.txt",
            "changed",
            Some(1),
            Some(5),
            true,
        )
        .await
        .unwrap();
    let text = harness
        .sessions
        .read_text(&session, "/docs/guide.txt")
        .await
        .unwrap();
    assert_eq!(text.content, "changed");

    // Permissions survive a round-trip.
    harness
        .sessions
        .chmod(&session, "/docs/guide.txt", 0o600)
        .await
        .unwrap();
    let stat = harness
        .sessions
        .stat(&session, "/docs/guide.txt")
        .await
        .unwrap();
    assert_eq!(stat.mode.unwrap() & 0o777, 0o600);
    assert!(!stat.is_dir);

    // Listing shows the folder with its metadata.
    let docs = harness.sessions.list_dir(&session, "/docs").await.unwrap();
    assert_eq!(docs.entries.len(), 1);
    assert_eq!(docs.entries[0].name, "guide.txt");
    assert_eq!(docs.entries[0].size, 7);

    // Recursive delete removes the tree and everything in it.
    harness
        .sessions
        .mkdir(&session, "/docs", "nested")
        .await
        .unwrap();
    harness
        .sessions
        .create_file(&session, "/docs/nested", "deep.txt")
        .await
        .unwrap();
    let removed = harness
        .sessions
        .delete(&session, &["/docs".to_string()], true)
        .await
        .unwrap();
    assert!(removed >= 4, "expected the whole tree, removed {removed}");
    assert!(harness.sessions.stat(&session, "/docs").await.is_err());

    // Dangerous paths are refused before touching the server.
    let refused = harness
        .sessions
        .delete(&session, &["/".to_string()], true)
        .await
        .expect_err("deleting / must be refused");
    assert_eq!(refused.code, "invalid_path");

    harness.sessions.close(&session);
    harness.cleanup();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn search_uses_the_caller_supplied_id_and_reports_progress() {
    let harness = Harness::start().await;
    let session = harness.open_session().await;

    // A small tree to search.
    harness.sessions.mkdir(&session, "/", "logs").await.unwrap();
    for name in ["alpha.txt", "beta.log", "gamma.txt"] {
        harness
            .sessions
            .create_file(&session, "/logs", name)
            .await
            .unwrap();
    }

    let options = SearchOptions {
        query: ".txt".to_string(),
        extensions: vec![],
        min_size: None,
        max_size: None,
        modified_after: None,
        modified_before: None,
        recursive: true,
        include_hidden: true,
        max_results: 100,
    };

    // The id the caller passes in is the id the server uses everywhere.
    let result = harness
        .sessions
        .search(
            &session,
            "/",
            options.clone(),
            Some("caller-id-123".to_string()),
        )
        .await
        .unwrap();
    assert_eq!(result.search_id, "caller-id-123");
    let mut names: Vec<String> = result.entries.iter().map(|e| e.name.clone()).collect();
    names.sort();
    assert_eq!(names, vec!["alpha.txt", "gamma.txt"]);
    assert!(result.scanned >= 3);

    // Progress events must carry the caller's id — that is the value the UI
    // matches on. Events are throttled to one per 200 ms, so a tiny tree may
    // legitimately produce none; what matters is that any event uses this id.
    let stray: Vec<String> = harness
        .recorder
        .events
        .lock()
        .iter()
        .filter(|(event, payload)| {
            event == "search://progress" && payload["searchId"] != "caller-id-123"
        })
        .map(|(_, payload)| payload.to_string())
        .collect();
    assert!(
        stray.is_empty(),
        "progress events must use the caller supplied id, found {stray:?}"
    );

    // Cancelling with that id is wired to the same token map.
    let cancelled = harness.sessions.cancel_search("caller-id-123");
    assert!(!cancelled, "the finished search has no token left");
    assert!(!harness.sessions.cancel_search("unknown-id"));

    // A search that is still running can be cancelled with that id.
    harness.sessions.mkdir(&session, "/", "tree").await.unwrap();
    const TREE_DIRS: usize = 400;
    for index in 0..TREE_DIRS {
        let dir_name = format!("d{index:03}");
        harness
            .sessions
            .mkdir(&session, "/tree", &dir_name)
            .await
            .unwrap();
        harness
            .sessions
            .create_file(&session, &format!("/tree/{dir_name}"), "f.txt")
            .await
            .unwrap();
    }
    let sessions = harness.sessions.clone();
    let session_id = session.clone();
    let running = tokio::spawn(async move {
        sessions
            .search(&session_id, "/tree", options, Some("cancel-me".to_string()))
            .await
            .unwrap()
    });
    tokio::time::sleep(Duration::from_millis(40)).await;
    let accepted = harness.sessions.cancel_search("cancel-me");
    let result = running.await.unwrap();
    assert_eq!(result.search_id, "cancel-me");
    if accepted {
        assert!(result.cancelled, "a cancelled search must report cancelled");
        assert!(
            result.entries.len() < TREE_DIRS,
            "the walk must stop before visiting every directory, found {}",
            result.entries.len()
        );
    }

    harness.sessions.close(&session);
    harness.cleanup();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn transfers_upload_download_and_honour_overwrite_policies() {
    let harness = Harness::start().await;
    let session = harness.open_session().await;
    harness.sessions.mkdir(&session, "/", "up").await.unwrap();

    let local_file = harness.local("note.txt");
    std::fs::write(&local_file, b"hello world").unwrap();

    // ---- upload, then read it back through SFTP
    let id = harness.enqueue(upload_spec(
        "test-profile",
        &local_file,
        "/up/note.txt",
        "replace",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    assert!(task.method.unwrap_or_default().starts_with("stream"));
    assert!(
        harness
            .recorder
            .event_names()
            .iter()
            .any(|name| name == "transfer://update"),
        "progress updates must reach the event sink"
    );
    let text = harness
        .sessions
        .read_text(&session, "/up/note.txt")
        .await
        .unwrap();
    assert_eq!(text.content, "hello world");

    // ---- upload with "skip" leaves the remote file alone
    std::fs::write(&local_file, b"second version").unwrap();
    let id = harness.enqueue(upload_spec(
        "test-profile",
        &local_file,
        "/up/note.txt",
        "skip",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed");
    assert_eq!(
        task.method.unwrap_or_default(),
        "skipped (destination exists)"
    );
    let text = harness
        .sessions
        .read_text(&session, "/up/note.txt")
        .await
        .unwrap();
    assert_eq!(text.content, "hello world", "skip must not overwrite");

    // ---- download
    let downloaded = harness.local("note-copy.txt");
    let id = harness.enqueue(download_spec(
        "test-profile",
        "/up/note.txt",
        &downloaded,
        "replace",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    assert_eq!(std::fs::read(&downloaded).unwrap(), b"hello world");

    // ---- download with "skip" keeps the existing local file (and does not fail)
    std::fs::write(&downloaded, b"LOCAL ORIGINAL").unwrap();
    let id = harness.enqueue(download_spec(
        "test-profile",
        "/up/note.txt",
        &downloaded,
        "skip",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed");
    assert_eq!(
        task.method.unwrap_or_default(),
        "skipped (destination exists)"
    );
    assert_eq!(std::fs::read(&downloaded).unwrap(), b"LOCAL ORIGINAL");

    // ---- download with "rename" keeps BOTH files (regression: it used to
    // delete the destination and overwrite it)
    let id = harness.enqueue(download_spec(
        "test-profile",
        "/up/note.txt",
        &downloaded,
        "rename",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    assert_eq!(std::fs::read(&downloaded).unwrap(), b"LOCAL ORIGINAL");
    let numbered = harness.local("note-copy (2).txt");
    assert_eq!(
        std::fs::read(&numbered).unwrap(),
        b"hello world",
        "the renamed copy must exist next to the original"
    );

    // ---- download with "replace" overwrites the local file
    let id = harness.enqueue(download_spec(
        "test-profile",
        "/up/note.txt",
        &downloaded,
        "replace",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    assert_eq!(std::fs::read(&downloaded).unwrap(), b"hello world");
    assert!(
        numbered.exists(),
        "the renamed copy is not touched by replace"
    );

    // ---- move onto an existing file with "skip": source and destination must
    // both survive (regression: rename used to clobber the destination)
    std::fs::write(harness.local("move-src.txt"), b"SOURCE").unwrap();
    let id = harness.enqueue(upload_spec(
        "test-profile",
        &harness.local("move-src.txt"),
        "/up/move-src.txt",
        "replace",
    ));
    harness.wait_transfer(&id).await;
    std::fs::write(harness.local("move-dst.txt"), b"DESTINATION").unwrap();
    let id = harness.enqueue(upload_spec(
        "test-profile",
        &harness.local("move-dst.txt"),
        "/up/move-dst.txt",
        "replace",
    ));
    harness.wait_transfer(&id).await;

    let id = harness.enqueue(remote_op_spec(
        "test-profile",
        "/up/move-src.txt",
        "/up/move-dst.txt",
        true,
        "skip",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    assert_eq!(
        task.method.unwrap_or_default(),
        "skipped (destination exists)"
    );
    let destination = harness
        .sessions
        .read_text(&session, "/up/move-dst.txt")
        .await
        .unwrap();
    assert_eq!(
        destination.content, "DESTINATION",
        "the move must not overwrite"
    );
    let source = harness
        .sessions
        .read_text(&session, "/up/move-src.txt")
        .await
        .unwrap();
    assert_eq!(source.content, "SOURCE", "a skipped move keeps the source");

    // ---- move with "rename" lands on a free name and removes the source
    let id = harness.enqueue(remote_op_spec(
        "test-profile",
        "/up/move-src.txt",
        "/up/move-dst.txt",
        true,
        "rename",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    assert!(harness
        .sessions
        .stat(&session, "/up/move-src.txt")
        .await
        .is_err());
    let moved = harness
        .sessions
        .read_text(&session, "/up/move-dst (2).txt")
        .await
        .unwrap();
    assert_eq!(moved.content, "SOURCE");

    // ---- server-side copy on the same server
    let id = harness.enqueue(remote_op_spec(
        "test-profile",
        "/up/note.txt",
        "/up/note-copy.txt",
        false,
        "replace",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    let copied = harness
        .sessions
        .read_text(&session, "/up/note-copy.txt")
        .await
        .unwrap();
    assert_eq!(copied.content, "hello world");

    // ---- upload with "replace" does overwrite an existing remote file (the
    // "skip" case above proved it does not)
    let id = harness.enqueue(upload_spec(
        "test-profile",
        &local_file,
        "/up/note.txt",
        "replace",
    ));
    let task = harness.wait_transfer(&id).await;
    assert_eq!(task.status, "completed", "{:?}", task.error);
    let replaced = harness
        .sessions
        .read_text(&session, "/up/note.txt")
        .await
        .unwrap();
    assert_eq!(replaced.content, "second version");

    harness.sessions.close(&session);
    harness.cleanup();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reuses_one_authenticated_transport_for_many_sessions() {
    let harness = Harness::start().await;

    let first = harness.open_session().await;
    let second = harness.open_session().await;
    assert_ne!(first, second);
    assert!(harness.ssh.is_connected("test-profile"));

    // Both channels work over the single transport.
    harness.sessions.mkdir(&first, "/", "one").await.unwrap();
    harness.sessions.mkdir(&second, "/", "two").await.unwrap();
    let root = harness.sessions.list_dir(&first, "/").await.unwrap();
    let mut names: Vec<String> = root.entries.iter().map(|e| e.name.clone()).collect();
    names.sort();
    assert_eq!(names, vec!["one", "two"]);

    assert_eq!(harness.ssh.pool_len(), 1);
    assert!(harness.port > 0);
    assert_eq!(harness.db.list_profiles().unwrap().len(), 1);

    harness.sessions.close(&first);
    harness.sessions.close(&second);
    harness.cleanup();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_a_wrong_password_without_leaving_a_transport() {
    let harness = Harness::start().await;
    let error = harness
        .sessions
        .open(&harness.profile, Some("definitely-wrong"))
        .await
        .expect_err("wrong password must fail");
    assert!(
        matches!(error.code.as_str(), "auth_failed" | "connection_failed"),
        "unexpected code {:?}",
        error
    );
    assert!(!harness.ssh.is_connected("test-profile"));
    harness.cleanup();
}
