# Automatic updates: one-time setup

> **Status:** the updater is implemented, and a real installed-to-installed update passed on Windows in CI ([`update-verification.md`](update-verification.md)). It is **not live** yet, because no signing key, update host or GitHub secrets have been configured. Until the steps below are done, every build reports *"Automatic updates aren't set up in this build"* and never contacts anything. Publishing a release fails on purpose, with a message naming what is missing.

## How it works

```
GitHub Release v0.1.1 published
        │
        ▼
windows-release.yml ── tests ── tauri build (signs updater artifacts with the PRIVATE key from secrets)
        │
        ├─ make-manifest create: verifies the .sig against the PUBLIC key, refuses non-newer versions
        ├─ upload  stable/0.1.1/NEXUS_0.1.1_x64-setup.exe   (immutable)
        ├─ upload  stable/latest.json                          (last)
        └─ make-manifest verify: re-downloads both from the public URLs and checks the signature
        
NEXUS (installed) ── every start (+20 s) and every 6 h ── GET https://<host>/stable/latest.json
        │ newer version?  → banner "Update available" (Update now / Remind me later)
        ▼ Update now
download → plugin verifies signature → "Restart and install"
        → database snapshot + expected version saved → engine stopped
        → NSIS installer (passive) → NEXUS reopens → version verified
```

- The update host is **public and read-only**. It holds only the installer and `latest.json`. No GitHub token is in the app.
- The app embeds only the **public** key. The private key exists only on your PC (plus your backups) and in GitHub encrypted secrets.
- Every download is checked against the public key before it runs, both by the Tauri updater plugin after download and again before install. Unsigned or modified packages are rejected. There is no option to turn this off.
- Only the **NSIS** installer (`-setup.exe`) is used for updates. The manifest publishes only the `windows-x86_64-nsis` key, so a copy installed from the `.msi` is told to download the new setup `.exe` and is never cross-upgraded into a second installation.
- HTTPS is required for the manifest and the download. The app refuses `http://`.

**Tauri updater signatures are not Windows code signing.** They prove an update came from you. They do **not** remove the Windows SmartScreen warning on first install. That needs an Authenticode code-signing certificate, which is a separate, still-open item.

## 1. Create the update signing key (on your PC)

You need Node.js. In a terminal in `apps\desktop`:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.tauri\nexus-updater.key"
```

- Choose a **strong password** when asked. The release workflow requires one.
- This writes `nexus-updater.key` (**private**) and `nexus-updater.key.pub` (public).
- Never put the private key in the repository, an issue, a chat or a screenshot. `.gitignore` excludes `*.key`, but keep it outside the repo folder anyway.

### Back it up now

Store **both** the private key file and its password in at least two separate safe places, for example a password manager entry with the key file attached plus an encrypted offline copy.

> **If the private key or its password is lost, installed copies of NEXUS can never update automatically again.** They only trust the public key they were built with. Every user would have to download and install a new version by hand. If the key is **leaked**, anyone with update-host access could sign a malicious update. Rotate it as described below.

## 2. Create the update host (Cloudflare R2, about 10 minutes)

Any S3-compatible storage with public HTTPS reads works. These steps use Cloudflare R2 (no egress fees).

1. Cloudflare dashboard → **R2** → **Create bucket**, e.g. `nexus-updates`.
2. Bucket → **Settings** → **Public access**: connect a **custom domain** (recommended, e.g. `updates.example.com`), or enable the **r2.dev** URL. Note the public base URL, e.g. `https://updates.example.com`.
3. R2 → **Manage R2 API tokens** → **Create API token** with permission **Object Read & Write**, limited to this bucket. Note the **Access Key ID**, **Secret Access Key**, and the **S3 endpoint** `https://<account-id>.r2.cloudflarestorage.com`.

The workflow writes `stable/<version>/NEXUS_<version>_x64-setup.exe` and then `stable/latest.json`. Nothing else is stored there.

## 3. Add GitHub secrets and variables

Repository → **Settings → Secrets and variables → Actions**.

**Secrets** (encrypted, never shown in logs):

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The **contents** of `nexus-updater.key`. Open it in Notepad and paste everything. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The key's password |
| `UPDATE_S3_ACCESS_KEY_ID` | R2 Access Key ID |
| `UPDATE_S3_SECRET_ACCESS_KEY` | R2 Secret Access Key |

**Variables** (not secret):

| Name | Value |
|---|---|
| `TAURI_UPDATER_PUBKEY` | The **contents** of `nexus-updater.key.pub` (one line of base64) |
| `UPDATE_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `UPDATE_S3_BUCKET` | `nexus-updates` |
| `UPDATE_PUBLIC_BASE_URL` | `https://updates.example.com` (no trailing path) |

The app checks `UPDATE_PUBLIC_BASE_URL/stable/latest.json`. That URL and the public key are built into each release. Changing either later means users must install one release by hand to pick up the new values. Choose a stable domain.

## 4. First release

Follow [releasing.md](releasing.md) and publish **v0.1.0** as the first updater-enabled release. Builds downloaded before this (workflow artifacts) don't contain the update settings. Install the v0.1.0 release once by hand, and updates are automatic from then on.

Then work through [update-verification.md](update-verification.md) with v0.1.1.

## Rotating or replacing the key

1. Generate a new key pair (step 1).
2. Update `TAURI_UPDATER_PUBKEY` and both signing secrets.
3. Publish a release. Clients still on the **old** key will reject it, because its signature is from the new key. If the old private key is still available and was not leaked, publish one last release signed with the **old** key that embeds the **new** public key: build it with the old secrets and the new `TAURI_UPDATER_PUBKEY` variable. Only after that, switch the secrets to the new key.
4. If the old key was leaked, users must reinstall by hand. Say so in the release notes and on the Releases page.

## Files

| File | Role |
|---|---|
| `crates/updates` | Manifest format and validation, version rules, schedule, state machine, signature checks, `make-manifest` CLI |
| `apps/desktop/src-tauri/src/updates.rs` | Runs the official Tauri updater plugin from Rust; backup, install, version check after restart |
| `apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater` | Empty `pubkey` and `endpoints` in the repository. Filled only by the release workflow. Install mode `passive`. |
| `apps/desktop/src/components/UpdateBanner.tsx`, `pages/Settings.tsx` | Update banner and Settings → Updates |
| `.github/workflows/windows-release.yml` | Release pipeline |
