# Checks that everything a public release needs is configured, before any
# build starts. A release is refused unless BOTH automatic updates and
# Authenticode signing are fully set up (docs/release-setup-checklist.md).
#
# Reads only environment variables (set by the workflow from GitHub secrets
# and variables). Prints what is missing or malformed, never a value.
# Exit code 0 = ready; 1 = not ready.
#
#   updater:  TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD (secrets)
#             TAURI_UPDATER_PUBKEY, UPDATE_PUBLIC_BASE_URL, UPDATE_S3_ENDPOINT, UPDATE_S3_BUCKET (variables)
#             UPDATE_S3_ACCESS_KEY_ID, UPDATE_S3_SECRET_ACCESS_KEY (secrets)
#   signing:  NEXUS_SIGN_PROVIDER = signpath | trusted-signing | pfx, plus that provider's values
#             (trusted-signing and pfx also need NEXUS_SIGN_EXPECTED_SUBJECT; SignPath's signer is fixed)
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$problems = New-Object System.Collections.Generic.List[string]
function Need([string]$name, [string]$what) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { $problems.Add("$name is not set ($what)") }
}
function Val([string]$name) { [Environment]::GetEnvironmentVariable($name) }
# A Tauri (minisign) key is base64 text whose decoded first line is "untrusted comment: …".
function Is-MinisignKey([string]$value, [string]$kind) {
  try {
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value.Trim()))
    return $text.StartsWith('untrusted comment:') -and $text -match $kind
  } catch { return $false }
}

# ---- Automatic updates --------------------------------------------------------
Need TAURI_SIGNING_PRIVATE_KEY 'secret: contents of the updater private key file'
Need TAURI_SIGNING_PRIVATE_KEY_PASSWORD 'secret: the updater key password'
Need TAURI_UPDATER_PUBKEY 'variable: contents of the updater .pub file'
Need UPDATE_PUBLIC_BASE_URL 'variable: public HTTPS address of the update host'
Need UPDATE_S3_ENDPOINT 'variable: S3 API endpoint of the update host'
Need UPDATE_S3_BUCKET 'variable: bucket name'
Need UPDATE_S3_ACCESS_KEY_ID 'secret: update host access key ID'
Need UPDATE_S3_SECRET_ACCESS_KEY 'secret: update host secret key'

if (Val TAURI_UPDATER_PUBKEY) {
  if (-not (Is-MinisignKey (Val TAURI_UPDATER_PUBKEY) 'public key')) { $problems.Add('TAURI_UPDATER_PUBKEY is not a Tauri updater public key (paste the whole .pub file)') }
}
if (Val TAURI_SIGNING_PRIVATE_KEY) {
  if (-not (Is-MinisignKey (Val TAURI_SIGNING_PRIVATE_KEY) 'secret key')) { $problems.Add('TAURI_SIGNING_PRIVATE_KEY is not a Tauri updater private key (paste the whole .key file)') }
  # Whether the private key belongs to TAURI_UPDATER_PUBKEY is checked later, before
  # anything is published: make-manifest verifies the new signature with the public key.
}
foreach ($u in 'UPDATE_PUBLIC_BASE_URL', 'UPDATE_S3_ENDPOINT') {
  $v = Val $u
  if ($v -and -not $v.StartsWith('https://')) { $problems.Add("$u must start with https://") }
  if ($v -and ($v.Contains('?') -or $v.Contains('#'))) { $problems.Add("$u must be a plain address (no ? or #)") }
}
$base = Val UPDATE_PUBLIC_BASE_URL
if ($base -and $base.TrimEnd('/') -match '/stable$') { $problems.Add('UPDATE_PUBLIC_BASE_URL must be the host root; NEXUS adds /stable/latest.json itself') }
$bucket = Val UPDATE_S3_BUCKET
if ($bucket -and $bucket -notmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$') { $problems.Add('UPDATE_S3_BUCKET is not a valid bucket name (3-63 lower-case letters, digits, hyphens)') }

# ---- Authenticode signing ---------------------------------------------------------
$provider = Val NEXUS_SIGN_PROVIDER
switch ($provider) {
  'signpath' {
    Need SIGNPATH_API_TOKEN 'secret: SignPath CI user API token'
    Need SIGNPATH_ORGANIZATION_ID 'variable: SignPath organization ID'
    Need SIGNPATH_PROJECT_SLUG 'variable: SignPath project slug'
    Need SIGNPATH_SIGNING_POLICY_SLUG 'variable: SignPath signing policy slug (release-signing)'
    $org = Val SIGNPATH_ORGANIZATION_ID
    if ($org -and $org -notmatch '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') { $problems.Add('SIGNPATH_ORGANIZATION_ID is not a GUID') }
  }
  'trusted-signing' {
    Need NEXUS_TS_ENDPOINT 'variable: Trusted Signing endpoint'
    Need NEXUS_TS_ACCOUNT 'variable: Trusted Signing account name'
    Need NEXUS_TS_PROFILE 'variable: certificate profile name'
    Need AZURE_TENANT_ID 'secret NEXUS_TS_AZURE_TENANT_ID'
    Need AZURE_CLIENT_ID 'secret NEXUS_TS_AZURE_CLIENT_ID'
    Need AZURE_CLIENT_SECRET 'secret NEXUS_TS_AZURE_CLIENT_SECRET'
    Need NEXUS_SIGN_EXPECTED_SUBJECT 'variable: the name in the signing certificate, checked on every signed file'
    $ep = Val NEXUS_TS_ENDPOINT
    if ($ep -and $ep -notmatch '^https://[a-z0-9-]+\.codesigning\.azure\.net/?$') { $problems.Add('NEXUS_TS_ENDPOINT should look like https://<region>.codesigning.azure.net') }
  }
  'pfx' {
    Need NEXUS_SIGN_PFX_BASE64 'secret: base64 of the .pfx'
    Need NEXUS_SIGN_PFX_PASSWORD 'secret: the .pfx password'
    Need NEXUS_SIGN_TIMESTAMP_URL 'variable: timestamp server (required for releases)'
    Need NEXUS_SIGN_EXPECTED_SUBJECT 'variable: the name in the signing certificate, checked on every signed file'
  }
  { [string]::IsNullOrWhiteSpace($_) } {
    $problems.Add('NEXUS_SIGN_PROVIDER is not set: releases must be Authenticode-signed (signpath, trusted-signing or pfx; see docs/code-signing.md)')
  }
  default { $problems.Add("NEXUS_SIGN_PROVIDER '$provider' is unknown (signpath, trusted-signing or pfx)") }
}

if ($problems.Count -gt 0) {
  if (-not $Quiet) {
    Write-Host "Release configuration is incomplete ($($problems.Count) problems):"
    $problems | ForEach-Object { Write-Host "  - $_" }
    Write-Host "See docs/release-setup-checklist.md."
  }
  exit 1
}
if (-not $Quiet) { Write-Host "Release configuration is complete (signing: $provider)." }
exit 0
