# SwiftSFTP Explorer

A native Windows SFTP file manager built with **Rust + Tauri 2 + React**. It looks and feels like
Windows 11 File Explorer, but every file operation runs over a real SSH/SFTP connection handled in
Rust.

> ภาษาไทย: ดู [README_TH.md](README_TH.md) สำหรับคู่มือติดตั้งและใช้งานฉบับเต็ม

---

## What it does

| Area | Details |
| --- | --- |
| Connections | Saved profiles, password / private key / Windows OpenSSH agent auth, host-key verification (TOFU + change detection), keepalive, shared SSH transport per server |
| Browsing | Multi-tab, breadcrumbs, address bar with path completion, back/forward/up, details / list / grid views, virtualised lists for 10k+ entries, sorting, hidden files |
| File operations | New folder/file, rename, delete (recursive, guarded), copy/cut/paste, multi-select, chmod, properties, drag & drop from Explorer, drag between tabs |
| Transfers | Queue, configurable concurrency, real byte progress and measured speed, ETA, pause/resume, cancel, retry, temporary `.part` files + atomic rename, size and optional SHA-256 verification, history |
| Editor | Monaco-based editor for text/config files with syntax highlighting, Ctrl+S, unsaved indicator, remote-change conflict detection |
| Search | Recursive search by name, extension, size and modified date, with live progress and cancel |
| Security | Passwords and key passphrases encrypted with Windows DPAPI, no plaintext secrets in SQLite or logs, strict host-key checks, shell arguments quoted, dangerous paths refused, server-side commands off until you opt in (first-run notice) |
| Organisation | Named server groups with their own colours, per-server colour overrides, group management dialog |
| Updates | Signed auto-update from GitHub Releases: background check, in-app banner, one-click download + install + relaunch |

## Requirements (end user)

- Windows 10 or Windows 11 (64-bit)
- WebView2 runtime (the installer downloads it if it is missing)
- Nothing else — no Rust, Node.js, npm or Visual Studio

## Install

1. Run `SwiftSFTP-Setup.exe` from `release/windows/`.
2. Choose the install location and whether to create desktop / Start-menu shortcuts.
3. Launch the app and add your first server.

The build in this repository is **not code-signed**, so Windows SmartScreen may show
"Windows protected your PC". Choose *More info → Run anyway*. No security setting is disabled by the
app.

## Build from source

Requirements: Rust stable (MSVC toolchain), Node.js 20+, pnpm 10+, NSIS 3 (for the installer).

```bash
pnpm install
pnpm icons            # regenerate icon set + installer artwork (optional)
pnpm typecheck        # TypeScript
pnpm test             # Vitest unit tests
cd src-tauri
cargo test            # Rust unit tests
cargo clippy --all-targets
cd ..
pnpm tauri build      # release build + NSIS installer
```

Artifacts:

- `src-tauri/target/release/swiftsftp.exe`
- `src-tauri/target/release/bundle/nsis/SwiftSFTP Explorer_1.1.0_x64-setup.exe`

`scripts/package-release.sh` (or `.ps1` on Windows) copies and renames them into `release/windows/`
as `SwiftSFTP-Setup.exe` and `SwiftSFTP-Portable.zip`.

## Architecture

```
src/                    React UI (Tailwind 4, Radix primitives, zustand)
  components/           chrome, file list, transfer dock, dialogs
  stores/app.ts         tabs, selection, clipboard, dialogs, transfer state
  lib/api.ts            typed wrappers over Tauri commands
src-tauri/src/
  ssh.rs                shared SSH transports, host-key verification, agent/key auth, remote exec
  sftp.rs               SFTP channels, listing, file operations, search, text read/write
  transfer.rs           bounded worker pool, progress, pause/cancel/retry, verification
  db.rs                 SQLite: profiles, trusted keys, favourites, recent, history, settings
  secrets.rs            Windows DPAPI (CryptProtectData) for credentials
  commands.rs           Tauri command surface used by the UI
  events.rs             event sink abstraction (lets the core run headless in tests)
  remote_path.rs        POSIX path helpers + shell quoting
installer/              NSIS artwork and licence
scripts/                icon generation, release packaging
```

Design notes:

- One **SSH transport** is authenticated per saved server. Tabs, searches and transfers open their
  own **SFTP channels** over it, so opening a tab reuses the existing login.
- Transfers stream through bounded buffers; files are never read into memory whole.
- Uploads/downloads write to a temporary name and rename into place only after the size (and
  checksum, when available) matches.
- Same-server copies use the SFTP `rename` for moves, `cp`/`mv` over SSH when you enable
  "server-side copy commands", and only otherwise stream through the client.
- Remote-to-remote copies between different servers always stream through the client.

## Updates

`src-tauri/tauri.conf.json` points the updater at
`https://github.com/anonsrirat/SwiftFile_Explorer/releases/latest/download/latest.json`.
Release builds are signed with the minisign key in `installer/updater.key` (git-ignored); the public
key is embedded in the config. The GitHub workflow `.github/workflows/release.yml` builds, signs and
publishes a draft release including `latest.json` when a `v*` tag is pushed.

Set the repository secret `TAURI_SIGNING_PRIVATE_KEY` to the contents of `installer/updater.key`
(and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has one) before tagging.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Shift+K | Duplicate tab |
| Ctrl+R | Refresh |
| Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V | Select all, copy, cut, paste |
| F2 | Rename |
| Delete / Shift+Delete | Delete (with / without confirmation) |
| Alt+←, Alt+→, Alt+↑, Backspace | Back, forward, up |
| Enter | Open selected item |
| Ctrl+, | Settings |
| Ctrl+J | Transfer panel |

## Tests

- Rust unit tests: 25 (path normalisation, shell quoting, POSIX modes, text decoding, DB
  persistence, DPAPI round-trip, transfer contracts, overwrite policies). `cargo test`
- Rust end-to-end tests: 5 in `src-tauri/tests/sftp_integration.rs`. They start a **real SSH +
  SFTP server in-process** (`russh` + `russh-sftp`, backed by a temp folder) and drive the real
  `SshManager`, `SessionManager` and `TransferManager`: connect, list, mkdir/create/rename,
  text read/write with conflict detection, chmod, recursive delete, search + cancel by caller id,
  upload/download with every overwrite policy, same-server copy/move, shared transport, and a
  rejected password. No Docker or network server is needed: `cargo test`
- Frontend: 19 Vitest unit tests (path utilities, formatting, permission masks, file
  classification). `pnpm test`
- Manual: the app was launched and the connection dialog, layout and window controls were verified
  visually. See `release/TEST_REPORT.md` for what was and was not exercised.

## Known limitations

See `release/KNOWN_LIMITATIONS.md`. The important ones:

- No code signing certificate: SmartScreen warning on first run.
- SSH agent authentication uses the Windows OpenSSH agent named pipe only.
- Drag **out** to Windows Explorer is not implemented (drop **in** from Explorer is).
- Pause/resume continues the current session; suspended transfers are not resumed after restarting
  the app.
- The editor detects UTF-8 / UTF-16LE / UTF-8-BOM and always saves as UTF-8.
- Server-side commands (`cp`/`mv`, remote SHA-256) are **off by default**; same-server copies then
  stream through this computer and are verified by size. Turn them on in the first-run notice or in
  Settings → Security.
- The end-to-end suite talks to an in-process test server; it does not cover a real third-party
  server's quirks, and there is still no throughput benchmark.

## Licence

Proprietary; see `installer/LICENSE.txt`.
