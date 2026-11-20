# Windows code signing (Authenticode): readiness

**Status: not signed.** No code-signing certificate exists for NEXUS, and the builds are not Authenticode-signed. Every Windows build reports this in its *Report Authenticode signature status* step (`NotSigned`).

## What that means for users

- Windows SmartScreen shows *"Windows protected your PC"* the first time someone runs the installer. *More info › Run anyway* installs it. The README and `docs/install-windows.md` say so.
- Some antivirus products are more suspicious of unsigned programs, especially ones that start with Windows.
- Updates are **not** affected. They are verified with the separate Tauri updater signature (`docs/updater-setup.md`), which Windows doesn't see.

## The two kinds of signature

| | Tauri updater signature | Authenticode code signing |
|---|---|---|
| Proves | An update came from NEXUS's release key | Who published the program, to Windows |
| Checked by | NEXUS's updater, before installing | Windows (SmartScreen, UAC, Defender) |
| Key | `TAURI_SIGNING_PRIVATE_KEY` (GitHub secret) | A certificate from a certificate authority or signing service |
| State | Built and verified in CI; the key and update host aren't set up yet | **Not set up** |

They must stay separate: never reuse one key for the other.

## Options

1. **SignPath Foundation (free for open-source projects).** The repository is public under MIT, so NEXUS may qualify. They sign releases built by GitHub Actions; the certificate is issued to SignPath Foundation with the project named. Needs an application and their GitHub integration.
2. **Microsoft Trusted Signing** (Azure, a monthly fee). Needs identity validation of an individual or organisation. Tauri can call its CLI through `bundle.windows.signCommand`.
3. **An OV or EV certificate from a certificate authority** (yearly fee; since 2023 the key must live on a hardware token or cloud HSM, so it can't simply be a GitHub secret). EV used to skip SmartScreen's reputation building; today both build reputation over time.

None of these can be set up from the code alone: each needs an account and identity checks by the owner.

## How it plugs in (once there is a certificate)

Tauri signs `nexus-desktop.exe`, the NSIS installer and its uninstaller, and the MSI during `tauri build` when one of these is configured in `apps/desktop/src-tauri/tauri.conf.json` (or in a release-only `--config` file, as the workflow already does for the updater):

```json
{ "bundle": { "windows": {
  "signCommand": "<signing tool> sign … %1",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
} } }
```

`certificateThumbprint` can be used instead, for a certificate installed on the build machine.

Steps:
1. Keep credentials in GitHub Actions secrets, separate from the updater secrets. Use the release job only, never pull-request builds.
2. Add the signing configuration only to the release build step (`windows-release.yml`, *Build installers (release, signed for updates)*). Development builds stay unsigned.
3. Change *Report Authenticode signature status* to **fail** release builds whose files aren't `Valid`.
4. Sign before generating `latest.json`. The updater signature covers the final, Authenticode-signed installer.
5. Re-run the installer check (`scripts/installer-check.ps1`) and the update end-to-end test (`update-e2e.yml`) with signed builds.

## SmartScreen without signing

Reputation for unsigned files is per file hash, so every new build starts from zero. Users should download only from the README's button or the GitHub release, and can compare the SHA-256 checksum published next to each build (`NEXUS-latest-SHA256.txt`, `SHA256SUMS.txt`).
