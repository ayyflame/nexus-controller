# Windows code signing (Authenticode)

**Status: not signed.** NEXUS has no code-signing certificate, and no build is Authenticode-signed. Development builds report `NotSigned` in *Report Authenticode signature status*. **A release can't be built without signing:** the configuration check refuses it, and the workflow refuses unsigned files. The signing steps for SignPath, Trusted Signing and PFX are in the workflow and their checks are self-tested; they need a real certificate or a SignPath project.

## What unsigned means for users

- Windows SmartScreen shows *"Windows protected your PC"* the first time the installer runs. *More info › Run anyway* installs it. Reputation for unsigned files is per file, so every new build starts from zero.
- Some antivirus products are more suspicious of unsigned programs, especially ones that start with Windows (NEXUS's *Start with Windows*).
- Updates are **not** affected. They are verified with the separate Tauri updater signature (`docs/updater-setup.md`). Never use one key for both.

## What needs signing

| File | Why |
|---|---|
| `nexus-desktop.exe` | What Windows starts at sign-in and what antivirus scans; also the file inside every installer |
| `NEXUS_<v>_x64-setup.exe` (NSIS) and its embedded uninstaller | What users download (SmartScreen) and what the updater runs |
| `NEXUS_<v>_x64_en-US.msi` | The alternative installer |

Tauri signs all of these during `tauri build` when `bundle.windows.signCommand` is set, which the release workflow does when a provider is configured. The updater signature is created afterwards, over the signed installer.

## Options, compared (checked 2026-11-20)

| | SignPath Foundation | Microsoft Trusted Signing ("Artifact Signing") | OV/EV certificate from a CA |
|---|---|---|---|
| Cost | Free for eligible open-source projects | Monthly fee (Basic tier includes 5,000 signatures/month) | Yearly fee, plus a hardware token or cloud HSM |
| Who can get it | Open-source projects that pass review | Organisations in the USA, Canada, EU, UK; individual developers in the USA and Canada (Microsoft's docs; individual onboarding has been paused at times, so check the portal) | Anyone who passes the CA's identity checks |
| Publisher name users see | **SignPath Foundation** (not the project owner) | The validated person or organisation | The validated person or organisation |
| Key handling | SignPath's HSM; signs only artifacts built by the connected CI | Microsoft-managed; signs via an Azure identity | Must be on a hardware token or cloud HSM since 2023, so a plain PFX in a GitHub secret is not possible for new certificates |
| Fits NEXUS's CI | Through SignPath's GitHub Action (artifact-based, see below) | Directly, through `scripts/sign-windows.ps1` (`trusted-signing`) | With a cloud-HSM vendor's tool; a PFX (`pfx`) only for legacy or test certificates |

### Is SignPath Foundation appropriate for NEXUS?

Likely yes, subject to their review:
- **MIT licence (OSI-approved):** ✓
- **Public GitHub repository:** ✓
- **Fully automated builds from the repository (GitHub Actions):** ✓
- **No proprietary code:** ✓. The 3D model is a CC BY 4.0 asset, not code, but mention it in the application. ViGEmBus and HidHide are not bundled.
- **To do before applying:**
  - turn on MFA for every maintainer on GitHub (and on SignPath);
  - add a short code-signing policy page (who builds, who approves releases);
  - show SignPath's attribution line on the release page.
- **Uncertain:** whether their review accepts a controller remapper with macros, given anti-cheat concerns some games have. NEXUS doesn't evade anti-cheat or touch game processes, which the application should say.

## Recommendation

1. **Apply to SignPath Foundation first.** It's free, made for projects like this, and keeps the key off GitHub and off your PC. The cost is that the publisher shown is "SignPath Foundation".
2. **If the owner is in the USA or Canada, or turns NEXUS into a company:** Microsoft Trusted Signing. It shows the owner's name, and the workflow already supports it. Set the variables and secrets below.
3. A traditional OV/EV certificate only if neither works.

## Setting it up

### Microsoft Trusted Signing (supported by the workflow now)

1. Azure portal: create a Trusted Signing account, complete identity validation, and create a **Public Trust** certificate profile.
2. Create an app registration (service principal) with the *Trusted Signing Certificate Profile Signer* role on that account.
3. GitHub › Settings › Secrets and variables › Actions:
   - **Variables:** `NEXUS_SIGN_PROVIDER` = `trusted-signing`, `NEXUS_TS_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`), `NEXUS_TS_ACCOUNT`, `NEXUS_TS_PROFILE`.
   - **Secrets:** `NEXUS_TS_AZURE_TENANT_ID`, `NEXUS_TS_AZURE_CLIENT_ID`, `NEXUS_TS_AZURE_CLIENT_SECRET`.
4. Publish a release. The release build installs Microsoft's signing client, Tauri signs each file through `scripts/sign-windows.ps1`, and *Report Authenticode signature status* **fails the release** if any file isn't `Valid`.

### SignPath Foundation (supported by the workflow; needs their project)

Application answers: [signpath-application.md](signpath-application.md). Policy: [`CODE_SIGNING_POLICY.md`](../CODE_SIGNING_POLICY.md). Setup order: [release-setup-checklist.md](release-setup-checklist.md).

SignPath signs **artifacts uploaded by the workflow** (origin verification), so for SignPath the release job does:
1. Build the installers. Tauri can't call SignPath during its own build.
2. Upload `unsigned-installers` (the setup `.exe` and the `.msi`).
3. `signpath/github-action-submit-signing-request` (pinned by commit) signs them per `.signpath/artifact-configuration.xml`, and waits for your approval in SignPath.
4. Swap in the signed files, and **stop unless every file is `Valid`**.
5. Create the updater signature over the signed setup, then checksums, provenance, publishing.

One limitation: Tauri patches `nexus-desktop.exe` separately for each installer type, and SignPath can't open NSIS archives. So with SignPath the app **inside the NSIS setup** stays unsigned, while the setup itself, the MSI and the app inside the MSI are signed. SmartScreen checks the downloaded setup, which is signed. Trusted Signing (below) signs everything, because Tauri calls it during the build.

### PFX (legacy or test certificates only)

`NEXUS_SIGN_PROVIDER` = `pfx`, secret `NEXUS_SIGN_PFX_BASE64` (base64 of the `.pfx`), secret `NEXUS_SIGN_PFX_PASSWORD`, optional variable `NEXUS_SIGN_TIMESTAMP_URL`. New publicly trusted certificates can't be exported as PFX, so this is mainly what the self-test uses.

## What is tested in CI today

- **Self-test:** *Signing hook self-test* creates a throwaway self-signed certificate on the GitHub machine and signs a copy of `nexus-desktop.exe` and the setup `.exe` through `scripts/sign-windows.ps1`, then checks the signer. This proves the hook works. It does not make anything trusted, and it never touches the published files.
- **Release check:** *Report Authenticode signature status* lists every file's status, and fails a release when a provider is configured but a file isn't `Valid`.

## SmartScreen without signing

Users should download only from the README's button or the GitHub release, and can compare the SHA-256 checksum published with each build (`NEXUS-latest-SHA256.txt`, `SHA256SUMS.txt`).
