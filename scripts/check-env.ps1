# NEXUS development environment check for Windows 11 x64.
# Read-only: inspects the system and prints findings. Installs nothing and
# needs no administrator rights.
#   powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1

$ErrorActionPreference = "SilentlyContinue"
$failures = 0

# PowerShell 5.1-compatible "a ?? b".
function Or($value, $fallback) { if ($value) { $value } else { $fallback } }

function Report($name, $ok, $detail) {
    $mark = if ($ok) { "[ OK ]" } else { "[FAIL]"; $script:failures++ }
    Write-Host ("{0} {1,-28} {2}" -f $mark, $name, $detail)
}

$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
Report "Windows 11" ($build -ge 22000) "$($os.Caption) build $build"
Report "64-bit OS" ($os.OSArchitecture -match "64") $os.OSArchitecture

$rustc = (rustc --version) 2>$null
Report "Rust (rustc)" ([bool]$rustc) (Or $rustc "not found - install from https://rustup.rs")
$cargo = (cargo --version) 2>$null
Report "Cargo" ([bool]$cargo) (Or $cargo "not found")
$host_triple = ((rustc -vV) -match "^host:") -replace "host: ", ""
Report "Rust MSVC toolchain" ($host_triple -eq "x86_64-pc-windows-msvc") (Or $host_triple "unknown")

$node = (node --version) 2>$null
$nodeOk = $node -and ([int]($node.TrimStart('v').Split('.')[0]) -ge 20)
Report "Node.js >= 20" $nodeOk (Or $node "not found")
$npm = (npm --version) 2>$null
Report "npm" ([bool]$npm) (Or $npm "not found")

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vc = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
}
Report "VS Build Tools (MSVC x64)" ([bool]$vc) (Or $vc "install 'Desktop development with C++'")

$sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\Include"
$sdk = if (Test-Path $sdkRoot) { (Get-ChildItem $sdkRoot | Sort-Object Name | Select-Object -Last 1).Name }
Report "Windows SDK" ([bool]$sdk) (Or $sdk "not found")

$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv
if (-not $wv) { $wv = Get-ItemProperty "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv }
Report "WebView2 Runtime" ([bool]$wv) (Or $wv.pv "not found")

# Informational: is a DualSense present right now? (VID 054C, PID 0CE6 / 0DF2)
$pads = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match "VID_054C&PID_(0CE6|0DF2)|_VID&0002054C_PID&(0CE6|0DF2)" }
Write-Host ("[INFO] DualSense devices present: {0}" -f ($pads | Measure-Object).Count)
$vigem = Get-PnpDevice | Where-Object { $_.FriendlyName -match "Virtual Gamepad Emulation Bus" }
Write-Host ("[INFO] ViGEmBus installed: {0}" -f [bool]$vigem)

if ($failures -gt 0) { Write-Host "`n$failures check(s) failed."; exit 1 }
Write-Host "`nEnvironment ready."
