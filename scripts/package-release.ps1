# Collect the built executable and NSIS installer into release/windows/ with the
# names used on the download page, produce a portable zip, checksums and a build
# report that describes exactly what was packaged.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$target = "src-tauri\target\release"
$nsis = "$target\bundle\nsis"
$out = "release\windows"

$exe = Join-Path $target "swiftsftp.exe"
if (-not (Test-Path $exe)) { throw "$exe not found - run 'pnpm tauri build' first" }

# Several versions can sit in the bundle folder; take the newest installer.
$setup = Get-ChildItem $nsis -Filter *setup.exe -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $setup) { throw "NSIS installer not found in $nsis" }

$version = (Get-Content "package.json" -Raw | ConvertFrom-Json).version

New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item $setup.FullName "$out\SwiftSFTP-Setup.exe" -Force
Copy-Item $exe "$out\SwiftSFTP.exe" -Force

# Updater signature: uploaded next to latest.json on the GitHub release.
$sigCopied = $false
if (Test-Path "$($setup.FullName).sig") {
  Copy-Item "$($setup.FullName).sig" "$out\SwiftSFTP-Setup.exe.sig" -Force
  $sigCopied = $true
}

# Refuse to package a build whose updater signature does not match the public key
# that ships inside the app: the updater would reject every future update.
if ($sigCopied -and (Get-Command node -ErrorAction SilentlyContinue)) {
  & node "scripts\verify-signature.cjs" (Join-Path $out "SwiftSFTP-Setup.exe") (Join-Path $out "SwiftSFTP-Setup.exe.sig") "src-tauri\tauri.conf.json"
  if ($LASTEXITCODE -ne 0) {
    throw "Updater signature does not verify against plugins.updater.pubkey - refusing to package"
  }
}

# Portable build: application + WebView2 note + licence.
$portable = Join-Path $env:TEMP ("swiftsftp-portable-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item $exe (Join-Path $portable "SwiftSFTP.exe")
Copy-Item "installer\LICENSE.txt" (Join-Path $portable "LICENSE.txt")
@"
SwiftSFTP Explorer - Portable build

Run SwiftSFTP.exe. No installation is required.

Requirements: Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime.
Most Windows 10/11 systems already have it. If the app does not start, install
the Evergreen WebView2 Runtime from Microsoft:
https://developer.microsoft.com/microsoft-edge/webview2/

This portable copy stores its data in %APPDATA%\com.swiftsftp.explorer.
"@ | Set-Content (Join-Path $portable "READ-ME.txt")

Remove-Item "$out\SwiftSFTP-Portable.zip" -ErrorAction SilentlyContinue
Compress-Archive -Path "$portable\*" -DestinationPath "$out\SwiftSFTP-Portable.zip" -Force
Remove-Item $portable -Recurse -Force

# Checksums so the download can be verified after transfer.
$sums = foreach ($name in @("SwiftSFTP-Setup.exe", "SwiftSFTP.exe", "SwiftSFTP-Portable.zip")) {
  $file = Join-Path $out $name
  if (Test-Path $file) {
    $hash = (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash *$name"
  }
}
$sums | Set-Content (Join-Path $out "SHA256SUMS.txt") -Encoding ascii

# Build report: replaces the previous "copy the console log" behaviour, which
# could silently ship an unrelated, older log.
$commit = "unknown"
if (Get-Command git -ErrorAction SilentlyContinue) {
  $short = git rev-parse --short HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $short) {
    $commit = $short.Trim()
    if ((git status --porcelain 2>$null | Measure-Object).Count -gt 0) {
      $commit = "$commit (working tree had local changes)"
    }
  }
}
function Get-ToolVersion([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { return "$name not found" }
  $line = (& $name --version 2>$null | Select-Object -First 1)
  if ($line) { return $line.Trim() } else { return "$name (unknown version)" }
}

$sizes = foreach ($name in @("SwiftSFTP-Setup.exe", "SwiftSFTP.exe", "SwiftSFTP-Portable.zip")) {
  $file = Join-Path $out $name
  if (Test-Path $file) { "  {0,-26} {1,12:N0} bytes" -f $name, (Get-Item $file).Length }
}

$report = @(
  "SwiftSFTP Explorer $version - release build report",
  "",
  "Built:     $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
  "Commit:    $commit",
  "Installer: $($setup.Name)",
  "Updater:   $(if ($sigCopied) { 'signed (SwiftSFTP-Setup.exe.sig)' } else { 'NOT signed - set TAURI_SIGNING_PRIVATE_KEY and rebuild' })",
  "",
  "Toolchain:",
  "  $(Get-ToolVersion rustc)",
  "  $(Get-ToolVersion cargo)",
  "  $(Get-ToolVersion node)",
  "  $(Get-ToolVersion pnpm)",
  "",
  "Artifacts:",
  $sizes,
  "",
  "SHA-256 (see SHA256SUMS.txt):",
  ($sums | ForEach-Object { "  $_" })
)
$report | Set-Content "release\BUILD_LOG.txt" -Encoding utf8

Get-ChildItem $out | Format-Table Name, Length
