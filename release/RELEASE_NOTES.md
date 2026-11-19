# SwiftSFTP Explorer — Release Notes

## 1.1.2 — 2026-11-20 (updater signing key fixed)

- **The public key embedded in the app was wrong.** The `plugins.updater.pubkey` value in
  `tauri.conf.json` did not match `installer/updater.key`, so every downloaded update would have been
  rejected with "signature verification failed" — the in-app updater could never have worked, even
  with `latest.json` in place. The embedded key now matches the key that signs the installer.
- **Packaging now verifies it.** `scripts/verify-signature.cjs` checks the installer signature
  against the key embedded in the app, and `scripts/package-release.ps1` / `.sh` refuse to build the
  release folder when it does not verify, so this cannot ship silently again.
- Contains everything from 1.1.1 below.

Install 1.1.2 once by hand (1.1.1 and older cannot verify their own updates); from then on the
updater works.

## 1.1.1 — 2026-11-20 (hardening pass)

Shipped `latest.json` and a `.sig` for the first time, so the in-app update check finally had
something to read — but its embedded public key did not match the signing key (see 1.1.2), so it
cannot update itself. It contains the whole hardening pass:

- **Overwrite policies are respected everywhere.** A remote move used to `rename` straight onto the
  requested destination before the policy was resolved, so "skip" silently replaced the file that was
  already there and "rename" never applied. A download with "rename" deleted the local file it was
  supposed to keep. Both are fixed; temporary files are unique per job and a failed transfer no
  longer leaves a `.part` file behind.
- **Recursive delete works on nested folders.** Deleting a folder that contained a subfolder always
  failed with a server error, because the parent was removed before its children.
- **Search: live progress and a working Stop.** The id is created by the UI instead of being returned
  after the walk finished, so progress events match and "Stop" really cancels the scan.
- **Settings that used to do nothing now work.** "Retry attempts" drives automatic retries for
  transient failures (bounded, with backoff), the default local folder pre-fills the download picker,
  and the three startup behaviours behave as labelled. The unused connection-pool setting is gone.
- **Server-side commands are off by default.** `cp`/`mv` on the server and remote SHA-256 checks now
  need an explicit opt-in from a short first-run notice; until then copies stream through this
  computer and are verified by size.
- **Checksum mismatches are diagnosable.** The hash is read as the first 64-character hex token in
  the command output (tolerating GNU's escaped file names and shell banners), and a mismatch reports
  the first 12 characters of both hashes and logs the full pair.
- **Complete Thai UI.** Every string in the store, dialogs and window chrome is translated (336 keys,
  English and Thai at parity); the four previously missing Thai keys are included.
- **End-to-end tests.** `cargo test` now also drives the real managers against an in-process SSH/SFTP
  server: listing, file operations, text editing with conflict detection, recursive delete, search +
  cancel, every overwrite policy, SHA-256 verified uploads, and a rejected password.

## 1.1.0 — 2026-11-12 (second build)

- **Live folder updates.** The open folder now refreshes itself: every 4 s while the window is
  focused, immediately when the window regains focus, and as soon as an upload / remote copy / move
  finishes. Refreshes are silent — no spinner, no scroll jump, no lost selection — and only touch the
  view when the listing actually changed.
- **Refresh no longer reloads the app.** The WebView2 context menu (which contains its own “Reload”)
  is suppressed app-wide except inside text inputs and the editor, and F5 is captured as “refresh the
  folder”. Right-clicking empty space in the file view now opens the app's own menu with Refresh, New
  folder, New file and Paste. Ctrl+R / F5 refresh in place without losing selection or scroll.
- **Drag files onto a tab.** Holding files over a tab for 400 ms switches to it, and dropping copies
  them into that tab's folder (works across servers — the transfer is queued and shown in the transfer
  panel). The hovered tab is highlighted.
- **Rubber-band selection.** Drag across empty space to select files and folders; Ctrl held adds to the
  current selection, a plain click on empty space clears it.

## 1.1.0 — 2026-11-12

- **Start folder is honoured.** Connecting to a proxy now opens the “Default remote folder” set on
  the profile. Previously `lastDir` was checked first, so the configured folder was skipped after
  the first visit. New tabs use `defaultRemoteDir → lastDir → home`.
- **Server groups.** Groups are real records (name, colour, order) instead of free text. Manage them
  from the connection dialog; deleting a group moves its servers to *Ungrouped* without touching
  anything on the server. Renaming a group updates its servers in one transaction.
- **Colours.** Every group has an accent colour and every server can override it. The sidebar shows
  a colour dot per group and a colour bar per server.
- **Signed auto-update.** The app checks
  `github.com/anonsrirat/SwiftFile_Explorer/releases/latest/download/latest.json` on start-up (and on
  demand from Settings → Advanced), shows an in-app banner with the release notes, and installs the
  new version with a real progress bar, then relaunches. Updates are verified against an embedded
  minisign public key; a `v*` tag now triggers `.github/workflows/release.yml`, which builds, signs
  and publishes `latest.json`.

## 1.0.0 — first public build

Release date: 2026-11-12
Platform: Windows 10/11 x64 (NSIS installer + portable zip)

## Highlights

- Native Rust SSH/SFTP engine (russh + russh-sftp) with one authenticated transport shared by every
  tab, search and transfer to the same server.
- Windows 11-style explorer shell: multi-tab, breadcrumbs, address bar, three view modes and a
  virtualised file list that stays smooth well past 10,000 entries.
- Transfer manager with a bounded worker pool, live byte-accurate progress, measured speed, ETA,
  pause/resume, cancel, retry, `.part` temp files and atomic rename.
- Monaco editor for remote config files with conflict detection and `Ctrl+S`.
- Recursive search with filters for name, extension, size and modified date.
- Credentials sealed with Windows DPAPI; trusted host keys stored per server with change detection.

## Installer

- `SwiftSFTP-Setup.exe` — NSIS, English + Thai UI, per-user or per-machine install, optional desktop
  and Start-menu shortcuts, launch-after-install, uninstaller.
- WebView2: the installer only installs the runtime if the target machine is missing it; a normal
  Windows 10/11 install already has it.
- No Rust, Node.js, MSVC or other developer tools are required on the target machine.

## Security notes

- The binaries are **not code-signed**. SmartScreen may warn on first run; this build does not
  disable any Windows security feature.
- Passwords and key passphrases never leave the machine unencrypted and are never logged.
- Host-key verification cannot be disabled. A changed host key blocks the connection until the user
  reviews the new fingerprint.

## Fixes in the 1.0.0 rebuild

- **Right-click on a file or folder now opens the context menu.** The row handler called
  `event.preventDefault()` before Radix's trigger handler ran; Radix cancels its own open when the
  event is already default-prevented, so the menu never appeared. Both the details/list rows and the
  grid tiles are fixed.
- **Delete works again.** Every delete path (Delete key, context menu, shift-delete) waited on
  `window.confirm`, which does not return a usable answer inside the Tauri WebView — so nothing
  happened. Confirmation is now an in-app dialog with a real Cancel/Delete choice. The same in-app
  dialog replaces the native confirm for: deleting a saved server (sidebar and connection dialog),
  forgetting trusted host keys, clearing saved credentials, factory reset, and discarding unsaved
  editor changes.
- **Faster startup.** The window no longer shows a "Loading…" placeholder while settings and
  profiles are read; the shell renders on the first frame and data streams in. `index.html` now paints
  the window background before the stylesheet loads, removing the white flash.

## Changes in this build

- First public build.
- Build pipeline: the frontend build now runs with a larger Node heap and splits Monaco into its own
  lazily loaded chunk (initial bundle ≈ 229 kB + React/Radix chunks).
- Clippy is clean with `-D warnings`-level hygiene (0 warnings), `cargo fmt --check` passes.

## Known issues

See `KNOWN_LIMITATIONS.md`.
