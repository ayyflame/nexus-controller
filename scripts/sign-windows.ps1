# Authenticode-signs one file. Tauri calls this for each file it signs
# (nexus-desktop.exe, the NSIS installer and uninstaller, the MSI) when the
# release workflow sets bundle.windows.signCommand. See docs/code-signing.md.
#
# Nothing here holds a credential. Everything comes from the environment the
# workflow sets from GitHub secrets, and only for release builds:
#   NEXUS_SIGN_PROVIDER        pfx | trusted-signing
#   NEXUS_SIGN_TIMESTAMP_URL   RFC 3161 timestamp server (optional for pfx)
#   pfx:              NEXUS_SIGN_PFX_PATH, NEXUS_SIGN_PFX_PASSWORD
#   trusted-signing:  NEXUS_TS_DLIB (Azure.CodeSigning.Dlib.dll), NEXUS_TS_METADATA (metadata.json),
#                     and AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET for the signing identity
param([Parameter(Mandatory = $true, Position = 0)][string]$File)
$ErrorActionPreference = 'Stop'

function Find-SignTool {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $tool = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $tool) { throw "signtool.exe not found under $kits (install the Windows SDK)" }
  $tool.FullName
}

if (-not (Test-Path $File)) { throw "No such file to sign: $File" }
$signtool = Find-SignTool
$ts = $env:NEXUS_SIGN_TIMESTAMP_URL
$signArgs = @('sign', '/fd', 'sha256')

switch ($env:NEXUS_SIGN_PROVIDER) {
  'pfx' {
    if (-not $env:NEXUS_SIGN_PFX_PATH) { throw 'NEXUS_SIGN_PFX_PATH is not set' }
    $signArgs += @('/f', $env:NEXUS_SIGN_PFX_PATH)
    if ($env:NEXUS_SIGN_PFX_PASSWORD) { $signArgs += @('/p', $env:NEXUS_SIGN_PFX_PASSWORD) }
  }
  'trusted-signing' {
    if (-not $env:NEXUS_TS_DLIB -or -not $env:NEXUS_TS_METADATA) { throw 'NEXUS_TS_DLIB and NEXUS_TS_METADATA must be set' }
    if (-not $ts) { $ts = 'http://timestamp.acs.microsoft.com' }
    $signArgs += @('/dlib', $env:NEXUS_TS_DLIB, '/dmdf', $env:NEXUS_TS_METADATA)
  }
  default { throw "No signing provider configured (NEXUS_SIGN_PROVIDER='$($env:NEXUS_SIGN_PROVIDER)')" }
}
if ($ts) { $signArgs += @('/tr', $ts, '/td', 'sha256') }
$signArgs += $File

# Never echo the arguments: they can include the PFX password.
& $signtool @signArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE) for $File" }
Write-Host "Signed $([System.IO.Path]::GetFileName($File))"
