#!/usr/bin/env bash
# Collect the built executable and NSIS installer into release/windows/ with the
# names used on the download page, and produce a portable zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_DIR="src-tauri/target/release"
NSIS_DIR="$TARGET_DIR/bundle/nsis"
OUT="release/windows"

EXE="$TARGET_DIR/swiftsftp.exe"
# Several versions can sit in the bundle folder; take the newest installer.
SETUP_SRC="$(ls -t "$NSIS_DIR"/*setup.exe 2>/dev/null | head -n 1 || true)"

if [ ! -f "$EXE" ]; then
  echo "error: $EXE not found — run 'pnpm tauri build' first" >&2
  exit 1
fi
if [ -z "$SETUP_SRC" ]; then
  echo "error: NSIS installer not found in $NSIS_DIR" >&2
  exit 1
fi

mkdir -p "$OUT"
cp "$SETUP_SRC" "$OUT/SwiftSFTP-Setup.exe"
# Updater signature: uploaded next to latest.json on the GitHub release.
if [ -f "$SETUP_SRC.sig" ]; then
  cp "$SETUP_SRC.sig" "$OUT/SwiftSFTP-Setup.exe.sig"
fi
cp "$EXE" "$OUT/SwiftSFTP.exe"

# Portable build: application + WebView2 note + licence.
PORTABLE="$ROOT/.portable-build"
rm -rf "$PORTABLE"
mkdir -p "$PORTABLE"
cp "$EXE" "$PORTABLE/SwiftSFTP.exe"
cp installer/LICENSE.txt "$PORTABLE/LICENSE.txt"
cat > "$PORTABLE/READ-ME.txt" <<'TXT'
SwiftSFTP Explorer — Portable build

Run SwiftSFTP.exe. No installation is required.

Requirements: Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime.
Most Windows 10/11 systems already have it. If the app does not start, install
the Evergreen WebView2 Runtime from Microsoft:
https://developer.microsoft.com/microsoft-edge/webview2/

This portable copy stores its data in %APPDATA%\com.swiftsftp.explorer.
TXT
rm -f "$OUT/SwiftSFTP-Portable.zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$PORTABLE" && zip -qr "$ROOT/$OUT/SwiftSFTP-Portable.zip" .)
else
  # Convert the MSYS paths into Windows paths for PowerShell.
  WIN_PORTABLE="$(cygpath -w "$PORTABLE" 2>/dev/null || echo "$PORTABLE")"
  WIN_OUT="$(cygpath -w "$ROOT/$OUT" 2>/dev/null || echo "$OUT")"
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path '$WIN_PORTABLE\\*' -DestinationPath '$WIN_OUT\\SwiftSFTP-Portable.zip' -Force"
fi
rm -rf "$PORTABLE"

cp build.log release/BUILD_LOG.txt 2>/dev/null || true

echo "release artifacts:"
ls -lh "$OUT"
