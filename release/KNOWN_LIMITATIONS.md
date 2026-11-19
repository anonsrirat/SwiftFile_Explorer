# Known limitations — SwiftSFTP Explorer 1.1.2

These are real, current limitations of this build. Nothing here is hidden behind a disabled button:
the UI does not offer features that are not implemented.

## Distribution

1. **Unsigned binaries.** No code-signing certificate was available, so
   `SwiftSFTP-Setup.exe` and `swiftsftp.exe` are unsigned. Windows SmartScreen will likely show
   "Windows protected your PC" on first run (More info → Run anyway). The app never disables
   SmartScreen, Defender or any other Windows security feature.
2. **x64 only.** This release was built for `x86_64-pc-windows-msvc`. An ARM64 build
   (`aarch64-pc-windows-msvc`) is supported by the stack but was not built or tested here because the
   ARM64 MSVC toolchain and NSIS target are not installed on the build machine.

## Connections and authentication

3. **SSH agent** authentication talks to the Windows OpenSSH agent named pipe
   (`\\.\pipe\openssh-ssh-agent`) only. Pageant and other agent transports are not supported.
4. **Key formats:** OpenSSH and PEM private keys (RSA, ECDSA, Ed25519) are supported through
   `russh-keys`. Newer OpenSSH keys encrypted with `bcrypt` passphrases work; exotic formats such as
   PKCS#8 with hardware-backed keys are not tested.
5. **Keyboard-interactive** prompts are surfaced as password prompts; multi-factor servers that ask
   several questions in one challenge are answered with the same password for each prompt.
6. **ProxyJump / bastion hosts** and **IPv6 zone identifiers** are not implemented.
7. **No auto-reconnect loop after the app restarts.** Tabs are restored and the app re-authenticates;
   SSH sessions cannot survive process exit, and the app does not claim otherwise. Auto-reconnect is
   attempted only while the app is running.

## File operations

8. **Server-side copy** uses `cp -p --` / `mv -a --` over SSH exec and is **off by default**. It
   must be enabled in the first-run notice or in Settings → Security (`allowServerCommands`). When
   disabled, or when the server has no POSIX shell, copies stream through the client, are verified by
   size instead of SHA-256, and the transfer row states which method was used.
   `copy-data` (the SFTP v6 extension) is not used because `russh-sftp` does not expose it.
9. **Remote → remote across two different servers** always streams through this machine; there is no
   relay support.
10. **Drag out to Windows Explorer** (Shell `IDataObject` / `CF_HDROP` provider) is not implemented.
    Dropping files *from* Explorer *into* the app, and internal drag between tabs/panes, are
    implemented.
11. **Very large directories** are listed in full before rendering (then virtualised). A directory
    with hundreds of thousands of entries will use proportional memory during listing.
12. **Permissions** are edited numerically (octal) plus owner/group read-write-execute toggles; ACLs,
    Windows-style ACLs and `chown` are not exposed.

## Transfers

13. **Pause/resume** stops the transfer between buffers within the running session and continues
    from there; it does not resume from a saved offset after the app closes. Leftover `.part` files
    are removed when a transfer fails, and an aborted transfer must be restarted. Automatic retries
    (Settings → Performance) re-run the whole file.
14. **Checksum verification** runs only when the remote server has `sha256sum` or `shasum`; otherwise
    size verification is used and the UI reports "size only".
15. **Speed limit** applies per transfer, not as a global aggregate cap.
16. **Transfers of a single file** cannot be split across multiple connections, so a single large file
    is bounded by one channel's throughput.

## Editor

17. The built-in editor opens files up to 8 MB and decodes UTF-8, UTF-8 with BOM and UTF-16LE. It
    always saves as UTF-8; binary files are refused.
18. Conflict detection compares size and modification time before writing. A file changed twice with
    the same size within the same second could be missed.

## Search

19. Search walks directories over SFTP with a small concurrency limit; on servers with thousands of
    directories it is slower than a server-side `find` and is intentionally throttled to avoid
    overloading the server. Regex search is not supported (glob/substring only).

## Platform

20. Local file operations use the Windows path APIs of the app process; UNC paths work, mapped network
    drives behave as configured by Windows.
21. Logs are written to `%LOCALAPPDATA%\com.swiftsftp.explorer\logs`. They never contain passwords or
    key material, but they do contain host names, user names and file paths.

## Updates

25. **Auto-update needs published releases.** The app checks
    `github.com/anonsrirat/SwiftFile_Explorer/releases/latest/download/latest.json`. Until a release is
    published there (with the `.sig` and `latest.json` produced by the workflow), the check simply
    reports “up to date”/fails silently. The update round-trip was not exercised end to end.
26. **The signing key must be kept.** `installer/updater.key` signs updates; it is git-ignored. If it
    is lost, already-installed copies can no longer verify new builds — users would have to install
    manually once to switch to a new key.
27. Groups and colours are stored locally only; they are not exported with settings.

## Testing gaps in this build

22. **The protocol paths are covered by an in-process end-to-end suite, not by a third-party
    server.** `src-tauri/tests/sftp_integration.rs` starts a real SSH + SFTP server (russh +
    russh-sftp) on a loopback port with a temporary directory and drives the real managers:
    connect, list, mkdir/create/rename, text read/write with conflict detection, chmod, recursive
    delete, search + cancel, upload/download with every overwrite policy, same-server copy/move, a
    shared transport across sessions, and a rejected password. This caught and fixed a real
    recursive-delete bug (parents were removed before their subdirectories).
    It does **not** cover distribution-specific server behaviour (ProFTPD/OpenSSH quirks, non-POSIX
    shells, non-UTF-8 filenames) or a real public server, because sending credentials to an outside
    system is out of scope.
23. **No benchmark against WinSCP** was performed (no comparable network path on the build machine).
    No throughput claim is made anywhere in this project.
24. **Installer UI was exercised only silently** (`/S`), which installed the app to
    `%LOCALAPPDATA%\SwiftSFTP Explorer` and produced a working `uninstall.exe`. The interactive wizard
    pages (welcome, directory chooser, shortcuts) and the Thai translation were not clicked through
    on this machine.
