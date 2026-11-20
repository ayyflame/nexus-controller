# Installs, updates and uninstalls the freshly built NEXUS installers on a
# throwaway GitHub Windows runner and checks that:
#   - the NSIS installer installs silently, per user, without admin rights;
#   - NEXUS starts, and a second start does not leave a second copy running;
#   - an update (installing over it with /UPDATE, as the updater does) keeps
#     the "Start with Windows" entry and the user's data;
#   - uninstalling, even while NEXUS is running, removes the program, its
#     uninstall entry and the "Start with Windows" entry (and its Task Manager
#     flag), and keeps profiles/settings (the user didn't ask to delete them);
#   - the MSI uninstall removes the "Start with Windows" entry as well.
# Never run this on a real PC: it installs and uninstalls NEXUS and writes
# HKCU startup values.
param(
  [Parameter(Mandatory = $true)][string]$Installers
)
$ErrorActionPreference = 'Stop'

$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$ApprovedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$DataDir = Join-Path $env:APPDATA 'com.nexus.controllerengine'
$script:failures = @()

function Check([string]$what, [bool]$ok) {
  if ($ok) { Write-Host "  ok   $what" } else { Write-Host "  FAIL $what"; $script:failures += $what }
}
function Until([string]$what, [scriptblock]$cond, [int]$seconds = 60) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 500 }
  Write-Host "  (timed out after $seconds s waiting for $what)"
  return $false
}
function ExplainMissingData {
  # Evidence for a failed start: data folders, the process, crash events.
  Write-Host "  --- diagnostics: NEXUS data folders ---"
  Get-ChildItem (Join-Path $env:APPDATA 'com.nexus.controllerengine'), (Join-Path $env:LOCALAPPDATA 'com.nexus.controllerengine') -Recurse -Depth 1 -ErrorAction SilentlyContinue |
    Select-Object -First 30 | ForEach-Object { Write-Host "  $($_.FullName)" }
  Write-Host "  --- diagnostics: processes ---"
  Get-Process nexus-desktop -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  pid $($_.Id) started $($_.StartTime) responding $($_.Responding) title '$($_.MainWindowTitle)'" }
  Write-Host "  --- diagnostics: application errors ---"
  Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2; StartTime = (Get-Date).AddMinutes(-10) } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'nexus' } | Select-Object -First 5 | ForEach-Object { Write-Host "  $($_.TimeCreated) $($_.ProviderName): $($_.Message)" }
}
function Value([string]$key) { (Get-ItemProperty -Path $key -Name NEXUS -ErrorAction SilentlyContinue).NEXUS }
function Copies { @(Get-Process nexus-desktop -ErrorAction SilentlyContinue).Count }
function UninstallEntry {
  Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    Get-ItemProperty | Where-Object { $_.DisplayName -eq 'NEXUS' }
}
function SimulateStartWithWindows([string]$exe) {
  # Exactly what Settings › Windows › Start with Windows writes, plus the
  # "disabled" flag Task Manager stores when a user switches it off there.
  New-Item -Path $ApprovedKey -Force | Out-Null
  Set-ItemProperty -Path $RunKey -Name NEXUS -Value "`"$exe`" --background"
  Set-ItemProperty -Path $ApprovedKey -Name NEXUS -Type Binary -Value ([byte[]](3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
}

$setup = Get-ChildItem $Installers -Filter *-setup.exe | Select-Object -First 1
$msi = Get-ChildItem $Installers -Filter *.msi | Select-Object -First 1
if (-not $setup) { throw "No NSIS installer in $Installers" }

Write-Host "NSIS: install $($setup.Name)"
$p = Start-Process $setup.FullName -ArgumentList '/S' -Wait -PassThru
Check "installer exit code 0 (was $($p.ExitCode))" ($p.ExitCode -eq 0)
Check "uninstall entry registered" ([bool](Until 'uninstall entry' { [bool](UninstallEntry) }))
$entry = UninstallEntry
$dir = ($entry.InstallLocation -replace '"', '').TrimEnd('\')
if (-not $dir) { $dir = Split-Path ($entry.UninstallString -replace '"', '') }
$exe = Join-Path $dir 'nexus-desktop.exe'
Check "program installed per user under LOCALAPPDATA ($exe)" ((Test-Path $exe) -and $exe.StartsWith($env:LOCALAPPDATA))
Check "no startup entry after a plain install" (-not (Value $RunKey))

Write-Host "Start NEXUS, then start it again"
Start-Process $exe | Out-Null
Check "NEXUS is running" ([bool](Until 'NEXUS to start' { (Copies) -ge 1 } 60))
$dbCreated = [bool](Until 'nexus.db' { Test-Path (Join-Path $DataDir 'nexus.db') } 60)
Check "profile database created" $dbCreated
if (-not $dbCreated) { ExplainMissingData }
Start-Sleep -Seconds 3
Start-Process $exe | Out-Null
Start-Sleep -Seconds 8
Check "a second start leaves one copy running (running: $(Copies))" ((Copies) -eq 1)

SimulateStartWithWindows $exe
Write-Host "NSIS: update (install over it with /UPDATE, as the updater does) while NEXUS runs"
$p = Start-Process $setup.FullName -ArgumentList '/S', '/UPDATE' -Wait -PassThru
Check "update exit code 0 (was $($p.ExitCode))" ($p.ExitCode -eq 0)
Check "program still installed after the update" (Test-Path $exe)
Check "update keeps Start with Windows" ((Value $RunKey) -eq "`"$exe`" --background")
Check "update keeps the profile database" (Test-Path (Join-Path $DataDir 'nexus.db'))

Write-Host "NSIS: uninstall while NEXUS runs"
Start-Process $exe | Out-Null
[void](Until 'NEXUS to start' { (Copies) -ge 1 } 60)
Start-Sleep -Seconds 3
# _?= runs the uninstaller in place, so -Wait waits for the real work.
$p = Start-Process (Join-Path $dir 'uninstall.exe') -ArgumentList '/S', "_?=$dir" -Wait -PassThru
Check "uninstaller exit code 0 (was $($p.ExitCode))" ($p.ExitCode -eq 0)
Check "NEXUS was closed by the uninstaller" ([bool](Until 'NEXUS to exit' { (Copies) -eq 0 } 30))
Check "program removed" ([bool](Until 'program removal' { -not (Test-Path $exe) } 30))
Check "uninstall entry removed" (-not (UninstallEntry))
Check "Start with Windows entry removed" (-not (Value $RunKey))
Check "Task Manager startup flag removed" (-not (Value $ApprovedKey))
Check "profiles and settings kept (nexus.db)" (Test-Path (Join-Path $DataDir 'nexus.db'))

if ($msi) {
  Write-Host "MSI: install $($msi.Name)"
  $log = Join-Path $env:RUNNER_TEMP 'nexus-msi.log'
  $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$($msi.FullName)`"", '/qn', '/norestart', '/l*v', "`"$log-install`"" -Wait -PassThru
  Check "MSI install exit code 0 (was $($p.ExitCode))" ($p.ExitCode -eq 0)
  SimulateStartWithWindows 'C:\Program Files\NEXUS\nexus-desktop.exe'
  $p = Start-Process msiexec.exe -ArgumentList '/x', "`"$($msi.FullName)`"", '/qn', '/norestart', '/l*v', "`"$log-uninstall`"" -Wait -PassThru
  Check "MSI uninstall exit code 0 (was $($p.ExitCode))" ($p.ExitCode -eq 0)
  Check "MSI uninstall removed Start with Windows" (-not (Value $RunKey))
  Check "MSI uninstall removed the Task Manager flag" (-not (Value $ApprovedKey))
  Check "MSI uninstall kept profiles and settings" (Test-Path (Join-Path $DataDir 'nexus.db'))
  if (-not (Select-String -Path "$log-uninstall" -Pattern 'NexusRemoveStartupEntry' -Quiet)) { Write-Host "  (NexusRemoveStartupEntry not found in the MSI log)" }
}

if ($script:failures.Count -gt 0) { throw "Installer check failed: $($script:failures -join '; ')" }
Write-Host "All installer checks passed."
