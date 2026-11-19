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
  # Refuse to package a build whose updater signature does not match the public
  # key that ships inside the app: the updater would reject every update.
  if command -v node >/dev/null 2>&1; then
    node scripts/verify-signature.cjs \
      "$OUT/SwiftSFTP-Setup.exe" "$OUT/SwiftSFTP-Setup.exe.sig" "src-tauri/tauri.conf.json" || {
      echo "error: updater signature does not verify against plugins.updater.pubkey" >&2
      exit 1
    }
  fi
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

# Checksums so the download can be verified after transfer.
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT" && sha256sum SwiftSFTP-Setup.exe SwiftSFTP.exe SwiftSFTP-Portable.zip > SHA256SUMS.txt)
fi

# Build report: describes exactly what was packaged instead of copying a stale log.
VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json | head -n 1)"
COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git rev-parse --short HEAD >/dev/null 2>&1; then
  COMMIT="$(git rev-parse --short HEAD)"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    COMMIT="$COMMIT (working tree had local changes)"
  fi
fi
SIG_STATE="NOT signed - set TAURI_SIGNING_PRIVATE_KEY and rebuild"
if [ -f "$OUT/SwiftSFTP-Setup.exe.sig" ]; then
  SIG_STATE="signed (SwiftSFTP-Setup.exe.sig)"
fi
{
  echo "SwiftSFTP Explorer $VERSION - release build report"
  echo ""
  echo "Built:     $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "Commit:    $COMMIT"
  echo "Installer: $(basename "$SETUP_SRC")"
  echo "Updater:   $SIG_STATE"
  echo ""
  echo "Toolchain:"
  for tool in rustc cargo node pnpm; do
    if command -v "$tool" >/dev/null 2>&1; then
      echo "  $("$tool" --version 2>/dev/null | head -n 1)"
    else
      echo "  $tool not found"
    fi
  done
  echo ""
  echo "Artifacts:"
  (cd "$OUT" && ls -l SwiftSFTP-Setup.exe SwiftSFTP.exe SwiftSFTP-Portable.zip 2>/dev/null | awk '{ printf "  %-26s %12s bytes\n", $9, $5 }')
  echo ""
  echo "SHA-256 (see SHA256SUMS.txt):"
  if [ -f "$OUT/SHA256SUMS.txt" ]; then sed 's/^/  /' "$OUT/SHA256SUMS.txt"; fi
} > release/BUILD_LOG.txt

echo "release artifacts:"
ls -lh "$OUT"
