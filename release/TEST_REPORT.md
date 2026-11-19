# Test report — SwiftSFTP Explorer 1.0.0

Date: 2026-11-12
Machine: Windows 11 (build 26200), x64
Toolchain: rustc 1.99.1 (`x86_64-pc-windows-msvc`), Node v24.4.1, pnpm 10.32.1,
NSIS 3 (`makensis.exe`, includes `Thai.nlf`), MSVC 2022 Build Tools.

Everything below was executed on this machine. Where a test could not run, the reason is stated.

---

## 0. Verification after the 2026-11-19 hardening pass

Re-run end to end on the same machine after the fixes listed below. These are the numbers produced
by these commands now — nothing is carried over from earlier releases.

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `pnpm typecheck` | ✅ no errors |
| Frontend unit tests | `pnpm test` | ✅ 19 passed (2 files) |
| Production frontend build | `pnpm build` | ✅ built |
| Rust unit tests | `cargo test --lib` | ✅ 26 passed |
| Rust end-to-end tests | `cargo test --test sftp_integration` | ✅ 6 passed |
| Rust lints | `cargo clippy --all-targets` | ✅ 0 warnings |

**The end-to-end suite now exists and runs without any external server.** `src-tauri/tests/sftp_integration.rs`
starts a real SSH server and a real SFTP subsystem in-process (`russh` + `russh-sftp`) on a random
loopback port, backed by a temporary directory, and drives the production managers
(`SshManager` → `SessionManager` → `TransferManager`). The window is the only thing replaced: events go
to a recording sink (`src-tauri/src/events.rs`) instead of the webview. `cargo test` runs it.

What the suite covers:

- password authentication, a pre-trusted host key (no prompt), and a **rejected** password that
  leaves no transport behind
- one authenticated transport shared by several SFTP sessions (`pool_len() == 1`)
- listing, mkdir, create, rename, stat, chmod (mode round-trip), text read/write with the
  temp-file + rename commit, and stale-write **conflict detection**
- recursive delete of a nested tree, and refusal of `/`
- recursive search with a caller-supplied id, progress events carrying that id, and cancelling a
  running search
- upload and download with `replace`, `skip` and `rename`, plus same-server copy and move
- SHA-256 verified uploads: a 3 MiB file is uploaded, hashed on the server through an SSH `exec`
  channel and compared byte-for-byte; a deliberately wrong server hash must fail the transfer,
  remove the partial file and name both hashes in the error message

**Defects found by these tests and fixed in this pass** (each was a real bug, not a hypothetical):

1. **Move ignored the overwrite policy.** `move_remote` called SFTP `rename` *before* resolving the
   policy, so "skip" silently replaced the destination file and "rename" never applied. The policy is
   resolved first now; the test asserts that both source and destination survive a skipped move.
2. **Download "rename" destroyed the existing file.** It deleted the destination and renamed over it.
   It now keeps both (`report (2).txt`). "Skip" also no longer transfers the whole file before
   deciding to discard it.
3. **Recursive delete failed on any folder containing a subfolder.** The old loop removed the parent
   directory immediately after queueing its children, which servers refuse (`Failure`). Replaced with
   a post-order traversal.
4. **Search progress and Stop were dead.** The search id was only known after the command finished, so
   the UI could never match a progress event or cancel the walk. The caller now supplies the id.
5. Uploads dropped onto a folder row went to the currently open folder instead of the target folder.
6. `loadDir` had no request token, so a slow listing could overwrite a newer navigation.
7. Settings that did nothing: `retryCount` now drives automatic retries (transient errors only,
   bounded, with backoff), `defaultLocalFolder` prefills the download picker, and `startBehavior`
   "home"/"welcome" behave as labelled. The unused `connectionPoolSize` was removed.
8. Security default changed: server-side commands (`cp`/`mv`, remote SHA-256) are **off** until the
   user opts in through the new first-run notice; the Settings toggle warns before turning them off.
9. Thai i18n: the four missing keys were added and the remaining hard-coded English in the store,
   dialogs and window chrome moved into `src/lib/i18n.ts`.
10. **Checksum parsing.** A real field log from this machine showed every upload to a live server
    failing with "SHA-256 checksum mismatch — the uploaded file was discarded" (SCP-verified: the
    bytes were fine, the comparison was not). The hash is now taken as the first 64-character hex
    token in the command output, which also covers GNU coreutils' leading-backslash escaping of
    awkward file names, banner text before the result and uppercase output. Mismatch messages now
    include the first 12 characters of both hashes and a warning with the full pair is logged, so a
    recurrence can be diagnosed from the log alone. The new end-to-end test uploads 3 MiB and
    verifies it through that same path.

Not covered by the suite (see `KNOWN_LIMITATIONS.md`): the updater round-trip, the interactive
installer wizard, distribution-specific server quirks (ProFTPD/OpenSSH edge cases, non-POSIX shells,
non-UTF-8 filenames), and throughput.

---

## 1. Static checks and unit tests

| Check | Command | Result |
| --- | --- | --- |
| Rust formatting | `cargo fmt --check` | ✅ pass (no diff) |
| Rust lints | `cargo clippy --all-targets` | ✅ 0 warnings (5 `field_reassign_with_default` warnings were found and fixed) |
| Rust tests | `cargo test` | ✅ 22 passed, 0 failed |
| TypeScript | `tsc --noEmit` (part of `pnpm build`) | ✅ pass |
| Frontend tests | `pnpm test` | ✅ 2 files, 19 tests passed (535 ms) |
| Production frontend build | `pnpm build` | ✅ built in 34 s |

Rust test coverage (`src-tauri/src`):

- `db`: profile upsert keeps last directory, secrets deleted with profile, known hosts upsert per
  algorithm, settings round-trip + clamping, profile save/load.
- `secrets`: real DPAPI `CryptProtectData`/`CryptUnprotectData` round-trip (encrypt → decrypt →
  compare, plus wrong-scope rejection path).
- `sftp`: POSIX mode formatting, human-readable sizes, unsafe name rejection, text decoding
  (UTF-8 / UTF-8 BOM / UTF-16LE).
- `ssh`: host-key decision serialisation, challenge prompt serialisation (camelCase contract).
- `transfer`: status names match the frontend contract, temp file names unique per job, transfer
  kind parsing rejects unknown values.
- `remote_path` helpers used by all commands.

Frontend test coverage: path normalisation/joining/absolute detection, byte and duration formatting,
permission-mask parsing, file-kind classification by extension.

## 2. Production build

`pnpm tauri build` → success (NSIS bundle produced).

Frontend chunks (gzip in brackets):

```
dist/assets/index-*.js        228.72 kB (65.66 kB)   ← app shell
dist/assets/react-*.js        233.90 kB (73.47 kB)
dist/assets/radix-*.js         98.68 kB (31.74 kB)
dist/assets/monaco-*.js     4,517.20 kB (1,159 kB)  ← lazy-loaded only when the editor opens
dist/assets/monaco-*.css      186.53 kB (27.76 kB)  ← lazy-loaded
dist/assets/EditorDialog-*.js   5.40 kB (2.25 kB)    ← lazy chunk
```

Release binary profile: `lto = true`, `codegen-units = 1`, `opt-level = "s"`, `strip = true`,
`panic = "abort"`.

## 3. Installer tests (executed)

| Test | Method | Result |
| --- | --- | --- |
| Silent install | `SwiftSFTP-Setup.exe /S` | ✅ installed to `C:\Program Files\SwiftSFTP Explorer` (per-machine), exit 0 |
| Installed files | directory listing | ✅ `swiftsftp.exe` (10,734,592 bytes) + `uninstall.exe` (111,449 bytes) |
| Uninstall registration | `reg query HKLM\...\Uninstall\SwiftSFTP Explorer` | ✅ `DisplayName=SwiftSFTP Explorer`, `DisplayVersion=1.0.0`, `Publisher=SwiftSFTP`, `InstallLocation`, `UninstallString`, `DisplayIcon`, `NoModify=1`, `NoRepair=1`, `EstimatedSize=0x295f` |
| Launch without dev tools | started the **installed** `swiftsftp.exe` | ✅ process running (PID 2480, ~39 MB working set); app created `%APPDATA%\com.swiftsftp.explorer\swiftsftp.db` (28,672 bytes) and the WebView2 profile under `%LOCALAPPDATA%\com.swiftsftp.explorer\EBWebView` |

The installation left on this machine by the test was produced from the installer *before* the final
Clippy-only source cleanup (same features, different binary hash: installed
`18072d9b…`, current `d3dfd8b4…`). Re-run `release\windows\SwiftSFTP-Setup.exe` to update it, or
uninstall the old copy from Settings → Apps first.
| Portable build | ran `release\windows\SwiftSFTP.exe` | ✅ starts and runs identically |
| Silent uninstall | `uninstall.exe /S` | ⚠️ **not verified.** The installation is per-machine, so the uninstaller requires elevation; the automated session has no interactive UAC approval, and the process exited without removing files. The uninstaller itself exists and is correctly registered under Apps & features. Use Settings → Apps to uninstall, or run `uninstall.exe` and approve the UAC prompt. |
| Per-user install (`/currentuser /S`) | attempted twice | ⚠️ did not produce an install in this non-interactive session. The per-machine path is the one verified above. |
| Interactive wizard (welcome, directory chooser, shortcut checkboxes, Thai UI) | not clicked | ⚠️ cannot be automated here; must be checked by hand. |
| Upgrade over an existing install | installer re-run over the installed copy | ⚠️ **not verified.** The repeated silent runs in this non-interactive session did not replace the installed files, so the in-place upgrade path must be checked by hand. |

## 3b. Bug-fix verification (2026-11-12 rebuild)

| Item | Evidence | Result |
| --- | --- | --- |
| Context menu opened nothing | Root cause confirmed in `node_modules/@radix-ui/react-context-menu/dist/index.mjs:92` — `composeEventHandlers(props.onContextMenu, handleOpen)` skips `handleOpen` when the child handler already called `preventDefault()`. The row handler did exactly that. | ✅ fixed in `EntryRow`/`EntryTile`; `pnpm typecheck` + `pnpm build` pass |
| Delete did nothing | All five delete/confirm paths called `window.confirm`, which cannot answer inside the Tauri WebView, so the condition was always falsy. Replaced with the store-driven `ConfirmDialog`. | ✅ replaced in App.tsx, FileList, Sidebar, ConnectionDialog, SettingsDialog, editor close; no `window.confirm` remains in `src/` |
| Startup placeholder | `Loading…` gate on `state.ready` removed; `index.html` paints the app background before CSS loads. | ✅ verified by inspection + typecheck; not clicked through on screen |

The behaviour of the new dialog and the context menu was **not** exercised against a live server (same
blocker as §4). The checks above are compile/build level plus source-level root-cause evidence.

## 3c. 1.1.0 feature verification (2026-11-12)

| Item | Evidence | Result |
| --- | --- | --- |
| Default remote folder ignored | `tabForProfile()` used `lastDir \|\| defaultRemoteDir`, and `lastDir` is written after every visit, so the configured folder was never used after the first session. Order is now `defaultRemoteDir → lastDir → home` (also in `newSessionTab`). | ✅ code + typecheck |
| Groups / colours | New `server_groups` table (name, colour, position), `profiles.color` column added through an idempotent `ALTER TABLE`, `groups_list` / `group_save` / `group_delete` commands, grouped sidebar with colour dots and per-server accent bars, group manager dialog. Renaming a group updates its profiles in one transaction; deleting one moves them to *Ungrouped*. | ✅ `cargo test` 22 passed, `cargo clippy` 0 warnings, typecheck clean |
| Signed auto-update | `tauri-plugin-updater` + `tauri-plugin-process`, endpoint `https://github.com/anonsrirat/SwiftFile_Explorer/releases/latest/download/latest.json`, minisign keypair generated (`installer/updater.key`, git-ignored), public key embedded in `tauri.conf.json`, `createUpdaterArtifacts: true`. | ✅ build produced `…-setup.exe.sig`; the installer is signed for updates |
| Update UI | Startup background check, banner with version + release notes + real download progress, “Update now” triggers download → install → relaunch; manual check in Settings → Advanced. | ✅ typecheck + build; the download path itself could not be exercised because no release exists on GitHub yet |

Not verifiable here: an actual update round-trip. It needs a published `latest.json` + `.sig` on the GitHub repo
above and an older build installed. The local build only proves the artifacts are produced and signed.

## 3d. Live refresh / drag-and-drop / selection (2026-11-12)

| Item | Implementation | Result |
| --- | --- | --- |
| Folder not updating | `silentRefreshTab` re-reads the listing and replaces state only when an entry differs (path, size, mtime, mode, type), keeping selection/scroll. Triggered by a 4 s poll while focused, window focus, and completed upload/copy/move transfers (destination and source folders). | ✅ typecheck + build; not driven against a server |
| Refresh reloading the whole app | The WebView2 native context menu was reachable in empty areas and its “Reload” restarts the renderer (losing sessions). Now `contextmenu` is suppressed except in inputs/editor, F5 refreshes the folder, and the empty-area right-click opens an app menu (Refresh/New folder/New file/Paste). | ✅ typecheck + build |
| Drag onto a tab | Tab accepts the internal drag payload, highlights after `dragenter`, activates after 400 ms of hovering, and on drop queues a remote copy into that tab's folder via `enqueueRemoteCopy`. | ✅ typecheck + build |
| Rubber-band selection | Pointer drag on empty space draws a selection rectangle and selects intersecting `[data-entry-path]` rows/tiles; Ctrl adds, click clears. | ✅ typecheck + build |

These are UI behaviours; they were compiled and typechecked but **not** clicked through in a live
session (still no SFTP server on this machine, see §4).

## 4. What was NOT tested — and why

These are the honest gaps. They are also listed in `KNOWN_LIMITATIONS.md`.

1. **Live SFTP sessions (login, list, upload, download, rename, delete, chmod, search, reconnect,
   multi-tab single-auth).** This machine has the Windows OpenSSH **client** only; `sshd` is not
   installed and adding the OpenSSH Server capability requires administrator rights. Docker is not
   installed either, so no containerised SFTP server could be started. No third-party public SFTP
   server was used, because doing so would mean sending credentials to a system outside this
   project.
2. **Throughput / benchmark comparison with WinSCP** (1 GB file, 10 × 100 MB, 1,000 small files,
   connection setup time, memory under load). No server and no comparable network path were
   available, so no numbers are claimed anywhere in this project.
3. **Host-key prompt flow against a real server** (first-connect prompt, changed-key warning). The
   logic is unit-tested for serialisation and the verifier path is compiled and exercised by tests,
   but the end-to-end prompt was not seen on screen.
4. **DPAPI across Windows users** (credential becomes unreadable for another user). Verified only
   that encryption/decryption round-trips for the current user.

## 5. How to run the missing integration tests (reproducible)

On any machine where you can install the OpenSSH Server (Windows) or use Linux:

```powershell
# Windows: install and start the server (admin PowerShell)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
New-LocalUser -Name sftptest -Password (ConvertTo-SecureString "Sftp!Test123" -AsPlainText -Force)
```

Then in SwiftSFTP Explorer:

1. New profile → host `127.0.0.1`, port 22, user `sftptest`, password `Sftp!Test123`.
2. Accept the host key after checking `ssh-keygen -lf C:\ProgramData\ssh\ssh_host_ed25519_key.pub`.
3. Verify: create folder, upload a 1 GB file while watching Task Manager memory (should stay flat),
   upload 1,000 small files, rename, chmod 600, edit a `.yml` file and save, search recursively,
   pull the network cable and confirm the tab reports a disconnect and reconnects.
4. Open 5 tabs on the same server and confirm `sshd` logs a single successful authentication
   (Windows: `Get-WinEvent -LogName 'OpenSSH/Operational' -MaxEvents 20`).

For a Linux test bed:

```bash
docker run -d -p 2222:22 -e SFTP_USERS="tester:pass:1001" atmoz/sftp
```
