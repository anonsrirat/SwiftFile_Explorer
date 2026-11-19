# Build instructions (Windows x64)

These steps reproduce `release/windows/SwiftSFTP-Setup.exe` from source. They are for the developer
machine only — the end user just runs the installer.

## 1. Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Rust | 1.99.1+ MSVC | `rustup default stable-x86_64-pc-windows-msvc` |
| Visual Studio Build Tools | 2022, "Desktop development with C++" | provides `link.exe` |
| Node.js | 20 LTS or newer (24.4.1 used) | |
| pnpm | 10.x | `corepack enable` |
| NSIS | 3.x with `Thai.nlf` | `choco install nsis`, or let Tauri download it |

No NASM is needed: the build uses russh's `ring` backend, not `aws-lc-rs`.

## 2. Install dependencies

```bash
pnpm install
```

## 3. Verify

```bash
pnpm typecheck
pnpm test
cd src-tauri
cargo fmt --check
cargo clippy --all-targets      # expected: 0 warnings
cargo test                      # expected: 25 unit + 5 end-to-end tests
cd ..
```

`cargo test` also runs the end-to-end suite in `src-tauri/tests/sftp_integration.rs`. It needs no
external SFTP server: the test starts an in-process SSH + SFTP server (russh + russh-sftp) on a
random loopback port, backed by a temporary directory, and drives the real managers against it.

## 4. Build the installer

```bash
pnpm tauri build
```

Outputs:

- `src-tauri/target/release/swiftsftp.exe`
- `src-tauri/target/release/bundle/nsis/SwiftSFTP Explorer_1.1.0_x64-setup.exe`

The frontend build runs with `--max-old-space-size=4096` because Monaco is large; Monaco is emitted
as a separate lazy chunk so the app shell stays small.

## 5. Package the release folder

```bash
bash scripts/package-release.sh        # or: powershell -File scripts/package-release.ps1
```

Creates:

- `release/windows/SwiftSFTP-Setup.exe`
- `release/windows/SwiftSFTP.exe`
- `release/windows/SwiftSFTP-Portable.zip`
- `release/BUILD_LOG.txt`

## 6. Regenerate icons and installer artwork (optional)

```bash
node scripts/gen-icons.mjs
```

Writes `src-tauri/icons/*` (PNG/ICO), `installer/header.bmp`, `installer/sidebar.bmp` and
`src/assets/logo.png`. Requires no image libraries.

## 7. Notes for CI

- Set `TAURI_SIGNING_PRIVATE_KEY` only if you add updater signing; this build does not use it.
- Code signing: set `bundle.windows.certificateThumbprint` / `signCommand` in `tauri.conf.json` (or
  the `TAURI_SIGNING_*` / `WINDOWS_CERTIFICATE_*` environment variables) once you have a certificate.
  Without it the installer is unsigned and SmartScreen will warn.
- ARM64: install the `aarch64-pc-windows-msvc` target and build with
  `pnpm tauri build --target aarch64-pc-windows-msvc`. Not tested in this release.
