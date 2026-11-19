# NEXUS Controller Engine

NEXUS is a Windows 11 app that remaps and fine-tunes a **Sony DualSense connected by USB** and sends the result to games as a **virtual Xbox 360 controller**.

```
DualSense (USB) → NEXUS: sticks, triggers, remapping, layers, macros → virtual Xbox 360 controller → Windows games
```

Built with Tauri 2, React and TypeScript for the UI, and Rust for the engine, with SQLite storage and Windows HID. NEXUS is a personal project for its owner and a few friends(Vibe Coded Slop).

<p align="center">
  <a href="https://github.com/ayyflame/nexus-controller/releases/download/latest-build/NEXUS-latest-x64-setup.exe"><img src="docs/assets/download-button.svg" alt="Download NEXUS — latest build for Windows 11 (64-bit)" width="340"></a>
</p>
<p align="center">
  <sub><a href="https://github.com/ayyflame/nexus-controller/releases/tag/latest-build">Latest build details and checksum</a> · <a href="https://github.com/ayyflame/nexus-controller/actions/workflows/windows-release.yml?query=branch%3Amain+is%3Asuccess">All builds</a></sub>
</p>

> **Status:** all features below are implemented and covered by automated tests. Hardware checks with a real DualSense, ViGEmBus and games are listed in [`tests/m4.5-test-plan.md`](tests/m4.5-test-plan.md), [`docs/game-output.md`](docs/game-output.md) and [`docs/3d-controller.md`](docs/3d-controller.md). Automatic updates are built but not switched on yet ([Updates](#updates)).

## Contents

[Features](#features) · [Requirements](#requirements) · [Installation](#installation) · [Using NEXUS](#using-nexus) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation) · [Develop](#develop) · [Credits](#credits) · [License](#license)

## Features

### Controller
- **Automatic USB detection.** Finds a USB DualSense, reconnects within about a second, ignores duplicate and virtual devices. No Bluetooth.
- **Sticks** (*Controller › Sticks*): deadzones (radial or axial, outer, anti-deadzone), sensitivity, response curves (presets or custom), invert, circular or square output.
- **Triggers** (*Controller › Triggers*): deadzone, range, curve and the point where the trigger counts as pressed.
- **Calibration** (*Live Viewer › Calibration*): a guided wizard for both sticks (resting centre, jitter, full range, a recommended deadzone) and both triggers. Nothing is saved until you apply it, and you can go back to the previous calibration.
- **Button remapping** (*Controller › Mapping*): click any button on the controller, or its card, and choose what it sends: another button, nothing, or two buttons at once. Each card shows what the game receives (e.g. Triangle → Y). Undo/redo and a list view included.
- **Shift layers:** hold or toggle a button to switch to a second button layout.
- **Button combinations:** hold 2–3 buttons together to press others (e.g. L1 + R1 → Triangle), optionally hiding the held buttons from the game.
- **Gyro aiming and touchpad** (optional): gyro onto a stick, touchpad zones and swipes as buttons.
- **Lighting and vibration** for the controller itself (*Controller › Lighting & Haptics*).

### Interactive 3D controller
- Your DualSense as a 3D model that follows the real controller: buttons light up, sticks tilt, L2/R2 swing with their pressure, touches appear on the touchpad.
- Drag to rotate, scroll to zoom, Front/Rear/Top views, Midnight Black or White.
- Shown on the Dashboard, *Controller › Live*, *Controller › Mapping* and the Live Viewer. A flat 2D picture (or your own photo) is available instead.

### Macro Studio
- **Record** a macro from the controller or **build it** on a controller layout.
- **Play Once**, **Repeat While Held** or **Toggle On/Off**, optionally **hold to activate** (the trigger must be held for a set time first; a quick tap does nothing).
- Type each action's **press time** and **wait** in milliseconds, edit several at once, scale a recorded rhythm, with a live preview and undo/redo.
- Warnings when a press is too short or too close to the next for a game to see it; conflicting triggers are blocked; the trigger button can be hidden from games.
- Macros start from the physical button, so remapping never breaks them.

### Profiles
- Each profile keeps its own sticks, triggers, mapping, layers, gyro, touchpad, lighting and output settings.
- Templates (Standard, Shooter, Racing, Relaxed), rename, duplicate, delete, and a **default profile** NEXUS starts with.
- **Automatic switching** when a linked game (`.exe`) starts.
- Macros are shared by all profiles. Import/export and backups.

### Live Viewer and diagnostics
- **Live Viewer** (sidebar): every control and analog value, motion (gyro, accelerometer, tilt), connection health, a guided 10-step controller test, a drift test and the calibration wizard. Read-only apart from calibration.
- **Output Check** (*Live Viewer*): reads the virtual Xbox controller back through XInput (as games do) and compares every button and axis with what NEXUS sent.
- **Performance:** report rate, timing, late and dropped reports, NEXUS processing time split by stage (mapping, macros, virtual controller driver call). Measurements: [`docs/performance.md`](docs/performance.md).
- **Diagnostics** (*Settings › HID Devices*): raw reports, the engine log, a Report Inspector and a shareable diagnostics report (serial numbers and paths masked).

### Virtual Xbox 360 output
- Games see a standard *Controller (XBOX 360 For Windows)* after all processing, remapping and macros.
- NEXUS shows whether it's connected, its player slot, and when it's reconnecting after a driver error.
- **No stuck buttons:** a neutral state is sent when the virtual controller goes away, on a profile change while the controller is silent, and after 8 unreadable reports in a row.

### Updates
- **Built:** a check shortly after start-up and every 6 hours, a notice with the release notes (**Update now** / **Remind me later**), background download, signature check, and install with your data kept (backed up first).
- **Not switched on yet:** the signing key and update host still need setting up ([`docs/updater-setup.md`](docs/updater-setup.md)). It was verified end to end on Windows in CI ([`docs/update-verification.md`](docs/update-verification.md)). Until then, install new builds by hand.

## Requirements

| What | Details |
|---|---|
| **Windows 11, 64-bit** | Windows 10 and ARM are not supported. |
| **DualSense + USB-C data cable** | Bluetooth isn't supported; charge-only cables don't carry data. |
| **[ViGEmBus](https://github.com/nefarius/ViGEmBus/releases) 1.22** (free, third-party) | **Needed for games to see NEXUS.** Without it NEXUS still reads and shows the controller, but games see no virtual controller. Retired by its developer in 2023 but works on Windows 11, so NEXUS labels virtual output *experimental*. |
| **[HidHide](https://github.com/nefarius/HidHide/releases)** (free, third-party) | **Optional.** Stops presses counting twice in games with PlayStation support or Steam Input, by hiding the DualSense from everything but NEXUS. Without it, turn off PlayStation controller support in the game or Steam. Guide: [`docs/hidhide-setup.md`](docs/hidhide-setup.md). |
| WebView2 Runtime, WebGL graphics | Part of Windows 11. Without WebGL, NEXUS shows the 2D picture instead of 3D. |

NEXUS **never installs, bundles or silently configures drivers** and needs no administrator rights. You install ViGEmBus (and HidHide if wanted) yourself from the official pages.

## Installation

1. **Install NEXUS.** Use the **Download NEXUS** button above and run `NEXUS-latest-x64-setup.exe`.
   - Windows SmartScreen may say *"Windows protected your PC"* because the installer isn't code-signed yet: click **More info › Run anyway**.
   - It installs for your account only; no administrator password needed. Installing over an older version keeps your profiles, macros and settings.
2. **Install ViGEmBus.** Download `ViGEmBus_1.22.0_x64_x86_arm64.exe` from the [official page](https://github.com/nefarius/ViGEmBus/releases) and run it (the administrator prompt is from ViGEmBus). In NEXUS, **Controller › Virtual Output › Check again** should show **Installed and ready**.
3. **Connect and turn on output.** Plug in the DualSense; the Dashboard shows **DualSense · USB**. In **Controller › Virtual Output**, turn on **Use the experimental virtual controller** and choose **Xbox 360**. It should show **Xbox 360 connected · Games see it as player 1**.
4. **Check in Windows.** Win + R → `joy.cpl` → **Controller (XBOX 360 For Windows)** → **Properties**. Pressing DualSense buttons lights the matching Xbox buttons, remaps and macros included.

More detail: [`docs/install-windows.md`](docs/install-windows.md).

## Using NEXUS

**Remap buttons:** *Controller › Mapping*. Click a button on the controller or its card, then choose what it **Sends** and, optionally, a second button under **Also press**. Pressing a button on the controller lights its card. Shift layers are set up below the mapping.

**Tune sticks and triggers:** *Controller › Sticks* and *› Triggers* apply live, with your input and the result plotted side by side. For drift or short travel, run **Live Viewer › Calibration**.

**Make a macro:** *Macro Studio › Create Macro*, then record it or build it, adjust the timing on the timeline, pick the trigger button and mode, and **Save Macro**. For **Repeat While Held**:
- leave at least **20 ms** between two presses of the same button;
- make presses at least **40–50 ms** long, because games read the controller once per frame.

**Profiles:** switch from the sidebar, create from templates, choose a **default** to start with, and link a game's `.exe` to switch automatically.

**Check that games get your input:** *Live Viewer › Output Check* with the virtual controller on. Press buttons and move the sticks: every row should stay green.

**What games receive:**
- **Buttons:** Cross/Circle/Square/Triangle → A/B/X/Y, L1/R1 → LB/RB, L2/R2 → LT/RT (full analog), Create/Options → Back/Start, PS → Guide.
- **Not sent:** touchpad click and Mute have no Xbox equivalent (remap them to use them). Gyro, touchpad position, adaptive triggers and the light bar aren't part of an Xbox controller.
- **Rumble and icons:** rumble from games isn't passed to the DualSense, and games show Xbox button icons.
- **Online games:** some anti-cheat systems block virtual controllers or macros. NEXUS doesn't hide from them, so don't use it where a game's rules forbid it.

Full details: [`docs/game-output.md`](docs/game-output.md).

## Troubleshooting

| Problem | What to do |
|---|---|
| The DualSense never appears | Use a USB-C **data** cable in a direct USB port. Close Steam, DS4Windows or similar tools, then **Settings › Scan now**. |
| *Waiting for ViGEmBus* / driver not installed | Install ViGEmBus 1.22, then **Controller › Virtual Output › Check again**. If it says *installed but could not be opened*, restart Windows. |
| Games don't react, but `joy.cpl` shows the Xbox controller | Check the **player** number under *Virtual controller now*. Many games only listen to player 1: unplug other Xbox-type controllers and turn the output off and on. |
| A press counts twice | The game or Steam sees both controllers. Turn off PlayStation controller support there, or set up HidHide. |
| Controller missing after setting up HidHide | NEXUS must be on HidHide's *Applications* list (copy its path from *Virtual Output*), or untick *Enable device hiding*. |
| *Reconnecting…* on the virtual controller | NEXUS re-creates it by itself. If it keeps happening, restart Windows or reinstall ViGEmBus. |
| A macro press isn't seen | Press time at least 40–50 ms; 20 ms between presses of the same button. |
| Stick drift, or a stick/trigger not reaching full range | **Live Viewer › Calibration**; **Live Viewer › Drift Test** shows how much a stick drifts. |
| The 3D controller looks plain white or doesn't change colour | Install the newest build; older builds blocked the model's textures. |
| Something else looks wrong | **Settings › HID Devices › Copy diagnostics report**, paste it into a text file and send it with a description. |

Your data lives in `%APPDATA%\com.nexus.controllerengine` (profiles, macros, settings, backups). Uninstalling leaves it there; delete the folder for a clean removal.

## Documentation

- **Using NEXUS:** [Installing](docs/install-windows.md) · [Game output](docs/game-output.md) · [Macro Studio](docs/macro-studio.md) · [3D controller view](docs/3d-controller.md) · [Live Viewer](docs/live-viewer.md) · [Performance](docs/performance.md) · [Calibration](docs/calibration.md) · [Controller photo mode](docs/controller-photo.md) · [HidHide setup](docs/hidhide-setup.md)
- **Testing:** [Hardware test plan](tests/m4.5-test-plan.md) · [Hardware verification checklist](tests/hardware-verification.md) · [Update verification](docs/update-verification.md)
- **Updates and releases:** [Updater setup](docs/updater-setup.md) · [Releasing](docs/releasing.md)
- **Internals:** [Architecture](docs/architecture.md) · [DualSense report format](docs/dualsense-protocol.md) · [Virtual output and drivers](docs/virtual-output.md) · [Virtual driver evaluation](docs/virtual-driver-evaluation.md) · [Latency audit](docs/latency-audit.md)

<details>
<summary>Project history</summary>

[M1](docs/milestone-1-report.md) · [M2](docs/milestone-2-report.md) · [M3](docs/milestone-3-report.md) · [M4 plan](docs/milestone-4-plan.md) · [M4 S1/S2](docs/milestone-4-s1-s2-report.md) · [M4.5](docs/milestone-4.5.md) · [M5 plan](docs/milestone-5-plan.md)

</details>

## Develop

<details>
<summary>Building NEXUS from source</summary>

| Tool | Version |
|---|---|
| Visual Studio 2022 Build Tools | "Desktop development with C++" (MSVC x64 and Windows 11 SDK) |
| Rust | stable ≥ 1.89, `x86_64-pc-windows-msvc` ([rustup.rs](https://rustup.rs)) |
| Node.js | 20 LTS or newer (22 recommended) |

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1   # read-only environment check
cd apps\desktop
npm install
npm run tauri dev                                                  # run with hot reload
```

Checks, as CI runs them:

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd apps\desktop; npm run typecheck; npm test; npm run build
```

- **Installers:** `npm run tauri build` in `apps\desktop`; output in `target\release\bundle\`. Every push to `main` that changes the app is built automatically and refreshes the **Latest build** download.
- **Releasing a version:** [`docs/releasing.md`](docs/releasing.md). Windows setup: [`docs/windows-setup.md`](docs/windows-setup.md).

**Layout**
- `apps/desktop`: the Tauri app (`src-tauri`) and React UI (`src`). The 3D model is in `src/assets/models`, the 3D view in `src/components/controller3d`.
- `crates/`:
  - `controller-core` (state model), `dualsense` (report parsing), `device-manager` (HID, reconnect, reader threads);
  - `input-processing` (sticks, triggers, remap, layers), `macro-engine`, `profile-manager` (SQLite);
  - `virtual-controller` (ViGEmBus, Xbox 360 translation), `engine`, `telemetry`, `app-detect`, `updates`.

</details>

## Ground rules

- No simulated input is ever shown as live controller data.
- No drivers are installed, bundled or configured by NEXUS, and no administrator rights are requested.
- No game-memory access, injection, aim assistance, recoil manipulation or anti-cheat evasion.

## Credits

- 3D controller model: **"Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato)** ([source](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). NEXUS splits it into separate controls and recolours it at run time. NEXUS is not affiliated with Sony.

## License

NEXUS's code is under the [MIT License](LICENSE): you may use, copy, modify and share it, keeping the copyright notice; it comes with no warranty. The 3D model and other third-party parts keep their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
