# Collect the built executable and NSIS installer into release/windows/.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$target = "src-tauri\target\release"
$nsis = "$target\bundle\nsis"
$out = "release\windows"

$exe = Join-Path $target "swiftsftp.exe"
if (-not (Test-Path $exe)) { throw "$exe not found - run 'pnpm tauri build' first" }

$setup = Get-ChildItem $nsis -Filter *setup.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) { throw "NSIS installer not found in $nsis" }

New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item $setup.FullName "$out\SwiftSFTP-Setup.exe" -Force
Copy-Item $exe "$out\SwiftSFTP.exe" -Force

$portable = Join-Path $env:TEMP ("swiftsftp-portable-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item $exe (Join-Path $portable "SwiftSFTP.exe")
Copy-Item "installer\LICENSE.txt" (Join-Path $portable "LICENSE.txt")
@"
SwiftSFTP Explorer - Portable build

Run SwiftSFTP.exe. No installation is required.
Requires Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime.
"@ | Set-Content (Join-Path $portable "READ-ME.txt")

Remove-Item "$out\SwiftSFTP-Portable.zip" -ErrorAction SilentlyContinue
Compress-Archive -Path "$portable\*" -DestinationPath "$out\SwiftSFTP-Portable.zip" -Force
Remove-Item $portable -Recurse -Force

if (Test-Path "build.log") { Copy-Item "build.log" "release\BUILD_LOG.txt" -Force }

Get-ChildItem $out | Format-Table Name, Length
