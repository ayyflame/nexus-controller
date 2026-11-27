# Code signing policy

> **Status:** NEXUS has applied for, or is preparing to apply for, free code signing from the SignPath Foundation. **No release is Authenticode-signed yet.** This page takes effect for the first signed release. Until then, Windows shows *"Unknown publisher"* for NEXUS installers.

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

Only release builds of this repository, built by its GitHub Actions workflow [`windows-release.yml`](.github/workflows/windows-release.yml) on GitHub-hosted runners, from a GitHub Release of a version tag:

- `NEXUS_<version>_x64-setup.exe`: the installer users download, and what the updater runs;
- `NEXUS_<version>_x64_en-US.msi`, including the `nexus-desktop.exe` inside it.

Development builds (every push to `main`, manual workflow runs, and the *Latest build* download) are **not** signed. Third-party software is never signed by this project: NEXUS doesn't bundle ViGEmBus, HidHide or any other driver, and users install those from their publishers.

## Team and roles

| Role | Who | Responsibility |
|---|---|---|
| Author, reviewer and approver | [ayyflame](https://github.com/ayyflame) (repository owner) | Writes or reviews every change merged to `main`, and approves each signing request in SignPath |

Everyone with these roles uses multi-factor authentication on GitHub and on SignPath. Changes from other contributors are merged only after the owner reviews them in a pull request. If the team grows, this table is updated before new members get any of these roles.

## How a release is signed

1. The owner publishes a GitHub Release for a version tag, or pushes that version's release notes to `main`.
2. The workflow checks that signing and automatic updates are fully configured (`scripts/check-release-config.ps1`), runs every test, and builds the installers from the tagged commit with pinned tools.
3. The unsigned installers are uploaded as a workflow artifact. SignPath fetches them from that workflow run (origin verification), and the owner approves the request in SignPath.
4. The workflow refuses to continue unless every file has a valid signature. It then creates the separate updater signature over the signed installer and publishes it.
5. Every published file has a SHA-256 checksum and a GitHub build-provenance attestation (`gh attestation verify <file> --repo ayyflame/nexus-controller`).

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Specifically:

- **Update checks.** In release builds, NEXUS checks for updates by downloading `latest.json` from the update host shortly after starting and every 6 hours, and downloads an update only when the user chooses *Update now*. The request contains no personal data, only what any HTTPS download sends (IP address, NEXUS's user agent). Automatic checks can be turned off in *Settings › Updates*.
- **No telemetry, no analytics, no accounts.**
- **Diagnostics reports** are created only when the user asks, and are copied to the clipboard for the user to share. They leave out serial numbers, MAC addresses, Windows account names, folder paths, and profile and macro contents.
- **Game detection** for automatic profile switching only reads the name of the program in the foreground, on the user's PC; nothing is sent anywhere.

## Reporting a problem

If a signed NEXUS file behaves in a way this policy doesn't describe, or you believe the signing process was misused, open an issue at https://github.com/ayyflame/nexus-controller/issues or contact SignPath Foundation (https://signpath.org).
