# SignPath Foundation application: prepared answers

Everything the SignPath Foundation application asks for, ready to copy. Apply at **https://signpath.org** (*Apply*), signed in as the repository owner. SignPath reviews each project; acceptance isn't guaranteed. Their current form may ask questions in a different order or wording, so check it, and update this page if it changed.

## Project

| Field | Answer |
|---|---|
| Project name | NEXUS Controller Engine |
| Repository | https://github.com/ayyflame/nexus-controller |
| Homepage / download page | https://github.com/ayyflame/nexus-controller#readme (releases: https://github.com/ayyflame/nexus-controller/releases) |
| Licence | MIT (OSI-approved), file `LICENSE`; third-party notices in `THIRD_PARTY_NOTICES.md` |
| Maintainer | ayyflame (GitHub), repository owner |
| Short description | A Windows 11 desktop app that reads a Sony DualSense controller over USB, lets the user tune sticks and triggers, remap buttons and record macros, and presents the result to games as a virtual Xbox 360 controller through the separately installed ViGEmBus driver. |
| Platform | Windows 11 x64 |
| Language / stack | Rust (engine, Tauri 2 desktop shell), TypeScript + React (UI) |
| Build system | GitHub Actions on GitHub-hosted `windows-latest` runners, workflow `.github/workflows/windows-release.yml`. Release builds start only from a published GitHub Release (or the version's release notes pushed to `main`), and build that exact commit. |
| Artifacts to sign | `NEXUS_<version>_x64-setup.exe` (NSIS installer) and `NEXUS_<version>_x64_en-US.msi` (MSI, including the `nexus-desktop.exe` inside it); see `.signpath/artifact-configuration.xml` |
| Release frequency | Occasional; a few releases per year expected |
| Code signing policy page | https://github.com/ayyflame/nexus-controller/blob/main/CODE_SIGNING_POLICY.md |
| Privacy | No telemetry or accounts; network use is limited to update checks against the project's own update host (see the policy page) |

## Eligibility points they check, and where NEXUS stands

| Requirement | NEXUS |
|---|---|
| OSI-approved licence, public source | MIT, public GitHub repository |
| No proprietary components by the maintainer | None. The only non-code third-party asset is a 3D controller model under CC BY 4.0 (`THIRD_PARTY_NOTICES.md`). Rust crates and npm packages are open source (locked in `Cargo.lock` and `package-lock.json`). |
| Builds fully automated from the repository | Yes. Every tool is pinned: Rust 1.100.0, Node 22.23.5, and actions by commit SHA. Crates and npm packages come from lockfiles (`--locked`, `npm ci`). Every build records `build-info.txt` and a provenance attestation. |
| Only the project's own software is signed | Yes. ViGEmBus and HidHide (third-party drivers) are never bundled or signed; users install them from their publishers. |
| MFA for everyone who can change the code or approve signing | **To do before applying:** turn on two-factor authentication on GitHub (Settings › Password and authentication) and on the SignPath account. |
| Code signing policy with roles and a privacy statement, linked from the project | `CODE_SIGNING_POLICY.md` (linked from the README). Make sure it's on `main` before applying. |
| Attribution on the project's download page | In the policy page now. Add the same line to the README's download section when the first signed release ships (*"Free code signing provided by SignPath.io, certificate by SignPath Foundation"*). |

Things a reviewer may ask about, with answers:
- **Macros and games.** NEXUS doesn't read or modify game processes, doesn't inject code, and doesn't try to avoid anti-cheat detection. The README tells users not to use it where a game's rules forbid controllers or macros. Its only interaction with games is a standard virtual Xbox 360 controller.
- **Drivers.** NEXUS installs no driver. It talks to ViGEmBus (BSD-3-Clause, installed by the user) through its documented interface.
- **Start with Windows.** It's off by default and set per user (HKCU `Run`) only when the user turns it on; the uninstaller removes it.

## After acceptance

SignPath creates the project and gives you:
1. **Organization ID** (a GUID) → GitHub variable `SIGNPATH_ORGANIZATION_ID`.
2. **Project slug** (e.g. `nexus-controller`) → variable `SIGNPATH_PROJECT_SLUG`.
3. **Signing policy slug** for releases (usually `release-signing`) → variable `SIGNPATH_SIGNING_POLICY_SLUG`.
4. An **API token** for a CI user with *submitter* rights on that project → secret `SIGNPATH_API_TOKEN`.

Then:
- Create the artifact configuration from `.signpath/artifact-configuration.xml`. If you name it, put the slug in variable `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`; otherwise the project's default is used.
- Connect GitHub as a trusted build system for the project (SignPath's GitHub integration), so it can verify that signing requests come from this repository's workflow.
- Set variable `NEXUS_SIGN_PROVIDER` = `signpath`.

The full order of setup, including updates, is in [release-setup-checklist.md](release-setup-checklist.md).
