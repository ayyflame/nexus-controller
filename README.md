# NEXUS Controller Engine

Windows 11 controller customization and emulation for the Sony DualSense, connected by **USB** (Bluetooth is not supported).
Tauri 2 · React · TypeScript · Rust · SQLite · Windows HID.

**Milestone 1 (foundation)** contains:

- The desktop application.
- DualSense discovery over USB, with automatic connect, reconnect and deduplication.
- USB input parsing into a normalized state model.
- Profile persistence with last-used profile loading.
- Diagnostics: raw HID reports, an event log and report rate.
- A replaceable virtual-output interface, **with no driver yet**.

See [`docs/milestone-1-report.md`](docs/milestone-1-report.md) for status and verification limits.

## Install (users and testers)

Download the Windows installer from the [Releases page](https://github.com/ayyflame/nexus-controller/releases) and double-click it. No developer tools are needed. Step-by-step instructions are in [`docs/install-windows.md`](docs/install-windows.md).

Installers are built automatically by GitHub Actions ([`.github/workflows/windows-release.yml`](.github/workflows/windows-release.yml)):

- **Run workflow** on the Actions tab produces a downloadable artifact (no automatic updates).
- **Publishing a GitHub Release** `v<version>` builds signed installers, publishes them as an automatic update, and attaches them to the release. See [`docs/releasing.md`](docs/releasing.md).

**Automatic updates** use the official Tauri updater: a check shortly after start-up and every 6 hours, **Update now / Later**, signature-verified downloads, and data kept across updates. They are **implemented but not live yet**: the signing key, update host and GitHub secrets still need the one-time setup in [`docs/updater-setup.md`](docs/updater-setup.md). Real installation from one version to the next is unverified until [`docs/update-verification.md`](docs/update-verification.md) has been run on Windows.

## Develop

Everything below is only for building NEXUS from source.

### Requirements (Windows 11 x64)

| Tool | Version | Notes |
|---|---|---|
| Visual Studio 2022 Build Tools | "Desktop development with C++" workload | MSVC x64 compiler and Windows 11 SDK (needed for Rust and the bundled SQLite) |
| Rust | stable ≥ 1.89, `x86_64-pc-windows-msvc` | https://rustup.rs |
| Node.js | 20 LTS or newer (22 recommended) | includes npm |
| WebView2 Runtime | any | preinstalled on Windows 11 |

Check your machine (read-only, no admin):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1
```

### Run

```powershell
cd apps\desktop
npm install
npm run tauri dev
```

The first build compiles all Rust dependencies, which takes a few minutes. No administrator rights are needed. No driver is installed.

### Test and check

```powershell
# from the repository root
cargo test --workspace
cargo clippy --workspace --all-targets
# from apps\desktop
npm run typecheck
npm run build
```

### Build an installer locally

```powershell
cd apps\desktop
npm run tauri build
```

Output goes to `target\release\bundle\nsis\` and `target\release\bundle\msi\`. The installers are not Authenticode-signed until a code-signing certificate is configured. The MSI step downloads the WiX toolset on first use. Local builds have no update server configured, so they never check for updates.

## Documentation

- [Architecture](docs/architecture.md)
- [Virtual driver evaluation and recommendation](docs/virtual-driver-evaluation.md)
- [DualSense report format](docs/dualsense-protocol.md)
- [Milestone 4 plan](docs/milestone-4-plan.md)
- [Milestone 4 S1/S2 report](docs/milestone-4-s1-s2-report.md)
- [Milestone 4.5: controller reliability and input completion](docs/milestone-4.5.md)
- [M4.5 hardware test plan](tests/m4.5-test-plan.md)
- [Milestone 5 plan](docs/milestone-5-plan.md)
- [Milestone 1 report](docs/milestone-1-report.md)
- [Milestone 2 proposal](docs/milestone-2-proposal.md)
- [Macro Studio](docs/macro-studio.md)
- [Virtual output, drivers and duplicate input](docs/virtual-output.md)
- [Milestone 2 report](docs/milestone-2-report.md)
- [Milestone 3 report](docs/milestone-3-report.md)
- [Installing NEXUS (end users)](docs/install-windows.md)
- [Automatic updates: one-time setup](docs/updater-setup.md)
- [Releasing a new version](docs/releasing.md)
- [Update verification checklist](docs/update-verification.md)
- [Developer setup on Windows 11 and hardware validation](docs/windows-setup.md)
- [Hardware verification checklist](tests/hardware-verification.md)

## Ground rules

No fake controller data is shown as live. No drivers are installed without approval. No admin rights are requested unnecessarily. No game-memory access, aim assistance or recoil manipulation.
