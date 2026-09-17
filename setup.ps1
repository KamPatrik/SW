<#
  Revela - one-shot dev environment bootstrap for a fresh Windows PC.

  Run from the project root:
    powershell -ExecutionPolicy Bypass -File .\setup.ps1

  Installs via winget (only when missing): Node.js LTS, Rust (rustup, MSVC),
  Visual Studio Build Tools with the C++ workload. Then runs `npm install`.
#>

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-Cmd([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin"
}

function Assert-Winget {
  if (-not (Test-Cmd "winget")) {
    throw "winget not found. Install 'App Installer' from the Microsoft Store, then re-run this script."
  }
}

Write-Host "== Revela setup ==" -ForegroundColor Cyan

# --- Node.js ------------------------------------------------------------
if (Test-Cmd "node") {
  Write-Host "Node.js found: $(node --version)"
} else {
  Assert-Winget
  Write-Host "Installing Node.js LTS..." -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Update-SessionPath
  if (-not (Test-Cmd "node")) { throw "Node.js installed but not on PATH yet - open a new terminal and re-run." }
}

# --- Rust (stable-msvc) --------------------------------------------------
if (Test-Cmd "cargo") {
  Write-Host "Rust found: $(cargo --version)"
} else {
  Assert-Winget
  Write-Host "Installing Rust (rustup)..." -ForegroundColor Yellow
  winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
  Update-SessionPath
  if (Test-Cmd "rustup") { rustup default stable-msvc | Out-Null }
  if (-not (Test-Cmd "cargo")) { throw "Rust installed but not on PATH yet - open a new terminal and re-run." }
}

# --- MSVC C++ build tools (linker, SQLite C sources) ---------------------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = $false
if (Test-Path $vswhere) {
  $vcPath = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath
  if ($vcPath) { $hasVC = $true }
}
if ($hasVC) {
  Write-Host "MSVC C++ build tools found."
} else {
  Assert-Winget
  Write-Host "Installing Visual Studio Build Tools (C++ workload) - this takes a while..." -ForegroundColor Yellow
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements `
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

# --- WebView2 runtime (preinstalled on current Win 10/11) -----------------
$wvKey = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
if (Test-Path $wvKey) {
  Write-Host "WebView2 runtime found."
} else {
  Write-Host "WebView2 runtime not detected - Tauri will offer to install it on first run." -ForegroundColor Yellow
}

# --- npm dependencies -----------------------------------------------------
Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host "  npm run tauri dev     # run the app (first Rust compile takes several minutes)"
Write-Host "  npm run tauri build   # build installer -> src-tauri\target\release\bundle\nsis"
