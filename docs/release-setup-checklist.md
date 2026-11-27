# First signed, auto-updating release: what you need to set up

Everything below needs your own accounts, so none of it exists yet. Until **all** of it is in place, a release is refused before anything is built, with a list of what's missing (`scripts/check-release-config.ps1`). Development builds and the README's *Latest build* download keep working without any of it.

Work through the sections in order. Tick each box.

## 1. GitHub account (owner)

- [ ] Two-factor authentication on: *GitHub › Settings › Password and authentication* (SignPath requires it).
- [ ] *Repository › Settings › Actions › General*: Actions are allowed for this repository. The workflow declares its own token permissions (contents write, actions read, id-token and attestations write), so the default *Workflow permissions* setting can stay as it is, unless your account or organisation blocks workflows from requesting write access.
- [ ] Releases are built only from commits on `main` (the workflow checks). Merge first, then release.

## 2. Updater signing key (your PC, 5 minutes)

In `apps\desktop`:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.tauri\nexus-updater.key"
```

- [ ] Choose a **strong password** when asked (required).
- [ ] Back up `nexus-updater.key` **and** its password in two places (password manager + offline copy). If they're lost, installed copies can never update automatically again.
- [ ] Never commit the key, paste it in an issue or chat, or put it anywhere but GitHub secrets.

## 3. Update host: Cloudflare R2 (15 minutes)

- [ ] Cloudflare account; *R2* enabled (free tier covers this use).
- [ ] *R2 › Create bucket*: name `nexus-updates`. Location: automatic; storage class: Standard.
- [ ] *Bucket › Settings › Custom Domains › Connect domain*, e.g. `updates.<your-domain>`. The domain must be on Cloudflare. A custom domain is strongly recommended over the `r2.dev` address, which is rate-limited and meant for development, and **the address can never change** for installed copies. The address becomes `UPDATE_PUBLIC_BASE_URL`, e.g. `https://updates.example.com`.
- [ ] Leave public listing off; no CORS rules are needed (NEXUS isn't a browser page).
- [ ] *R2 › Manage R2 API Tokens › Create API token*: permission **Object Read & Write**, **Apply to specific buckets only** = `nexus-updates`, no expiry (or a long one, with a reminder to rotate). Note the **Access Key ID** and **Secret Access Key** (shown once).
- [ ] Note the **S3 API endpoint** shown on the bucket page: `https://<account-id>.r2.cloudflarestorage.com`.

What the workflow writes there:
- `stable/<version>/NEXUS_<version>_x64-setup.exe`, never overwritten (`Cache-Control: public, max-age=31536000, immutable`);
- then `stable/latest.json` (`Cache-Control: no-cache`).

Nothing else is stored, and nothing else needs to be public.

## 4. Code signing: SignPath Foundation (application, then 15 minutes)

- [ ] `CODE_SIGNING_POLICY.md` is on `main` (merge this branch first).
- [ ] Apply at signpath.org with the answers in [signpath-application.md](signpath-application.md). Wait for acceptance.
- [ ] Two-factor authentication on your SignPath account.
- [ ] In SignPath:
  - create the artifact configuration from `.signpath/artifact-configuration.xml`;
  - connect GitHub as the trusted build system for the project;
  - create a CI user with submitter rights and an **API token**.
- [ ] Note the **Organization ID**, **Project slug** and **Signing policy slug**.

*(Alternatives: Microsoft Trusted Signing or a certificate, see [code-signing.md](code-signing.md). Then set those values instead of the SignPath ones.)*

## 5. GitHub secrets and variables

*Repository › Settings › Secrets and variables › Actions*.

**Secrets** (encrypted):

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Whole contents of `nexus-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password |
| `UPDATE_S3_ACCESS_KEY_ID` | R2 Access Key ID |
| `UPDATE_S3_SECRET_ACCESS_KEY` | R2 Secret Access Key |
| `SIGNPATH_API_TOKEN` | SignPath CI user's API token |

**Variables** (not secret):

| Name | Value |
|---|---|
| `TAURI_UPDATER_PUBKEY` | Whole contents of `nexus-updater.key.pub` |
| `UPDATE_PUBLIC_BASE_URL` | e.g. `https://updates.example.com` (host root, no path) |
| `UPDATE_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `UPDATE_S3_BUCKET` | `nexus-updates` |
| `NEXUS_SIGN_PROVIDER` | `signpath` |
| `SIGNPATH_ORGANIZATION_ID` | The organization GUID |
| `SIGNPATH_PROJECT_SLUG` | e.g. `nexus-controller` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | e.g. `release-signing` |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Optional; empty = the project's default configuration |

With SignPath, every signed file must show **SignPath Foundation** as signer and carry a timestamp, or the release stops. If you use Trusted Signing or a certificate instead, also set `NEXUS_SIGN_EXPECTED_SUBJECT` to the name in that certificate ([code-signing.md](code-signing.md)).

## 6. First release: version 0.2.0

All builds so far, including everyone's manual installs, are version **0.1.0**. The first public release must be **newer** so it installs as a normal upgrade and the updater has a clean starting point:

1. `node scripts/bump-version.mjs 0.2.0` (updates `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json` and `tauri.conf.json` together).
2. Copy `docs/release-notes-draft-v0.2.0.md` to `release-notes/v0.2.0.md` and edit it. Users see this in the update notice.
3. Commit both together and push to `main` (or publish a GitHub Release `v0.2.0` with the same text). See [releasing.md](releasing.md).
4. Watch the *Windows release build* run. It stops at the configuration check if anything above is missing. With SignPath, **approve the signing request in SignPath within 30 minutes** (the run waits that long, then stops without publishing anything). Then it checks the signatures, publishes `stable/latest.json`, verifies that the published files are byte-for-byte what it signed, and creates the GitHub Release.
5. Install `NEXUS_0.2.0_x64-setup.exe` from the release **by hand, once**, on each PC (earlier builds have no update address built in). From then on, updates arrive automatically.
6. Check: Windows *File › Properties › Digital Signatures* on the setup shows SignPath Foundation; *Settings › Updates* says *You're up to date (0.2.0)*.
7. Run [update-verification.md](update-verification.md) with 0.2.1 before announcing automatic updates.

## What happens to people on the manual 0.1.0 build

Installing 0.2.0 over 0.1.0 keeps profiles, macros, calibration, settings and restore points. Either installer choice works (both are tested in CI):
- **Don't uninstall:** everything stays, including *Start with Windows*.
- **Uninstall before installing** (the installer's default): your data folder is kept unless you tick *Delete the application data*. The old uninstaller removes the *Start with Windows* entry. From this version on, NEXUS remembers the choice in its own settings and puts the entry back on its next start. Builds before this one didn't remember it, so **someone upgrading from an older 0.1.0 build this way turns *Start with Windows* on again once** (*Settings › Windows*). Say so in the 0.2.0 release notes.

A daily automatic backup exists from the first start of any recent build, and every update saves a *Saved before updating* restore point.
