# NEXUS Controller Engine

NEXUS is a Windows 11 app that remaps and fine-tunes a **Sony DualSense (PS5) or DualShock 4 (PS4) connected by USB** and sends the result to games as a **virtual Xbox 360 controller**.

```
DualSense or DualShock 4 (USB) → NEXUS: sticks, triggers, remapping, layers, macros → virtual Xbox 360 controller → Windows games
```

Built with Tauri 2, React and TypeScript for the UI, and Rust for the engine, with SQLite storage and Windows HID. NEXUS is a personal project for its owner and a few friends(Vibe Coded Slop).

<p align="center">
  <a href="https://github.com/ayyflame/nexus-controller/releases/download/latest-build/NEXUS-latest-x64-setup.exe"><img src="docs/assets/download-button.svg" alt="Download NEXUS — latest build for Windows 11 (64-bit)" width="340"></a>
</p>
<p align="center">
  <sub><a href="https://github.com/ayyflame/nexus-controller/releases/tag/latest-build">Latest build details and checksum</a> · <a href="https://github.com/ayyflame/nexus-controller/actions/workflows/windows-release.yml?query=branch%3Amain+is%3Asuccess">All builds</a></sub>
</p>

> **Status:** all features below are implemented and covered by automated tests (simulated input and GitHub's Windows machines). **None of it has been validated yet with a real DualSense or DualShock 4 in games, including Warzone, and no release is made until it is:** see the release gate in [`tests/hardware-verification.md`](tests/hardware-verification.md#release-gate). Earlier hardware plans: [`tests/m4.5-test-plan.md`](tests/m4.5-test-plan.md), [`docs/game-output.md`](docs/game-output.md), [`docs/3d-controller.md`](docs/3d-controller.md). Automatic updates are built but not switched on yet ([Updates](#updates)).

## Contents

[Features](#features) · [Requirements](#requirements) · [Installation](#installation) · [Updating and uninstalling](#updating-and-uninstalling) · [Using NEXUS](#using-nexus) · [Known limitations](#known-limitations) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation) · [Develop](#develop) · [Credits](#credits) · [License](#license)

## Features

### Controller
- **Automatic USB detection.** Finds a USB DualSense or DualShock 4, shows which one it is, reconnects within about a second, ignores duplicate and virtual devices. No Bluetooth.
- **Same features for both controllers.** Everything below works the same with a DualSense or a DualShock 4: each has its own report reader, and both feed the same mapping, macro and profile engine.
- **Sticks** (*Sticks*): deadzones (radial or axial, outer, anti-deadzone), sensitivity, response curves (presets or custom), invert, circular or square output.
- **Stick swap and stick to buttons** (*Sticks*): swap the left and right sticks (or send one stick to both, or neither), and press buttons by pushing a stick, e.g. the d-pad. Separate left/right and up/down thresholds, a release margin against flicker, 8 or 4 directions, and the stick's movement kept for the game or not. Per profile.
- **Triggers** (*Triggers*): deadzone, range, curve and the point where the trigger counts as pressed.
- **Calibration** (*Live Viewer › Calibration*): a guided wizard for both sticks (resting centre, jitter, full range, a recommended deadzone) and both triggers. Nothing is saved until you apply it, and you can go back to the previous calibration.
- **Button remapping** (*Mapping*): click any button on the controller, or its card, and choose what it sends: another button, nothing, or two buttons at once. Each card shows what the game receives (e.g. Triangle → Y). Undo/redo and a list view included.
- **Shift layers:** hold or toggle a button to switch to a second button layout.
- **Button combinations:** hold 2–3 buttons together to press others (e.g. L1 + R1 → Triangle), optionally hiding the held buttons from the game.
- **Gyro aiming and touchpad** (optional): gyro onto a stick, touchpad zones and swipes as buttons.
- **Lighting and vibration** for the controller itself (*Lighting & Haptics*). A DualShock 4 has a light bar and vibration but no player lights.

### Interactive 3D controller
- Your controller as a 3D model that follows the real controller (a DualSense model or a DualShock 4 model, whichever is connected): buttons light up, sticks tilt, L2/R2 swing with their pressure, touches appear on the touchpad.
- Drag to rotate, scroll to zoom, Front/Rear/Top views, Midnight Black or White.
- Shown on the Dashboard, *Mapping*, the Live Viewer and Macro Studio, always as the 3D model of whichever controller is connected, DualSense or DualShock 4.

### Macro Studio
- A **Macro Library** page (search, sort, pinned macros, each one's button and the profiles it is on in) and a separate **editor page** per macro (duplicate, export one macro, delete with confirmation). Back and Forward move between them.
- **Record** a macro from the controller or **build it** by clicking the 3D controller. Actions can **press**, **press and keep held** (while later actions run) or **release**, so "hold L2 while tapping R2" is one macro.
- **Play Once** (1–100 times per press), **Repeat While Held** or **Toggle On/Off**, optionally **hold to activate** (the trigger must be held for a set time first; a quick tap does nothing).
- A **Test** panel shows what the engine is doing: waiting, arming, running action N, stopped.
- Linked with *Mapping*: show a macro's button there, start a new macro for a button, or remove a button's macro without deleting it.
- Type each action's **press time** and **wait** in milliseconds, edit several at once, scale a recorded rhythm, with a live preview and undo/redo.
- Warnings when a press is too short or too close to the next for a game to see it; conflicting triggers are blocked; the trigger button can be hidden from games.
- Macros start from the physical button, so remapping never breaks them.

### Profiles
- Each profile keeps its own sticks, triggers, mapping, layers, gyro, touchpad, lighting and output settings.
- **Profile Manager** (*Profiles*): every profile in one list with its game, when it was last used and changed, and which is active. Search, sort (recently used, name, last modified, newest) and pin favourites to the top.
- Create a profile from default settings, as a copy of the current or any other profile (settings and macro choices, not its games), or from a template (Standard, Shooter, Racing, Relaxed). Rename, duplicate, export one profile, delete with confirmation.
- A **start-up profile** NEXUS starts with. It, or (if none is chosen) your first profile, is protected from deletion.
- Shows which controllers a profile fully works with: settings for the Mute button or the player lights do nothing on a DualShock 4.
- Switching profile (by hand or by a game) applies the settings and the macros as one change: no controller report is ever processed with half of a switch.
- **Automatic switching** when a linked game (`.exe`) is in the foreground. Pick the game from the programs you used recently, or type its file name.
- Macros are shared by all profiles. Import/export and backups.
- **Restore points:** a backup every day (last 14 kept), before every restore and before every update, all restorable from *Profiles*. Restoring saves a safety copy first.

### Getting ready to play
- The Dashboard's **Get ready to play** checklist shows each step: DualSense on USB, ViGEmBus installed, virtual controller on, games seeing it as player 1. When a step fails, it says what to do (another USB port, close other controller tools, restart Windows, unplug another Xbox controller, …).

### Live Viewer and diagnostics
- **Live Viewer** (sidebar): every control and analog value, motion (gyro, accelerometer, tilt), connection health, a guided 10-step controller test, a drift test and the calibration wizard. Read-only apart from calibration.
- **Output Check** (*Live Viewer*): reads the virtual Xbox controller back through XInput (as games do) and compares every button and axis with what NEXUS sent.
- **Performance:** an overview first (report rate, time inside NEXUS, virtual controller submission, findings), then four parts: controller reports (spacing, late and dropped reports), processing in NEXUS split by stage, virtual controller submission (driver call, slow calls), and end to end, which NEXUS can't measure and says so. Findings say what to do; the settings in effect are shown read-only. Measurements: [`docs/performance.md`](docs/performance.md); what a slow driver call does: [`docs/driver-performance.md`](docs/driver-performance.md).
- **Diagnostics** (*Settings › HID Devices*): raw reports, the engine log, a Report Inspector and a shareable diagnostics report. The report includes the virtual controller's status and errors; serial numbers, MAC addresses, your Windows account name, folder paths, and profile and macro contents are left out.

### Virtual Xbox 360 output
- Games see a standard *Controller (XBOX 360 For Windows)* after all processing, remapping and macros.
- NEXUS shows whether it's connected, its player slot, and when it's reconnecting after a driver error.
- **No stuck buttons:** a neutral state is sent when the virtual controller goes away, when NEXUS quits, on a profile change while the controller is silent, and after 8 unreadable reports in a row.
- **No late presses:** if NEXUS falls 8 ms or more behind (usually because the virtual controller driver was slow), it skips the reports Windows queued meanwhile and sends only the newest state. Old presses are never replayed late; a tap made entirely during such a delay is dropped.

### Running in the background
- **Tray icon:** NEXUS keeps running in the notification area. Click it to open the window; right-click for *Stop all macros* and *Quit NEXUS*.
- **Close and minimise** (*Settings › Windows*): closing the window keeps NEXUS running in the tray by default, so games keep the virtual controller. Minimising can hide it to the tray too. Both can be switched.
- **Start with Windows** (*Settings › Windows*), for your user account only, straight to the tray (or with the window, if you prefer). A switch-off in Task Manager › Startup apps is shown.
- **One copy at a time:** opening NEXUS again brings the running window back, instead of a second copy fighting over the controller.
- Window size and position, and the page you were on, are restored at the next start.
- **Quitting** stops macros, releases every button and removes the virtual controller first (waiting at most 2 seconds for the driver).

### Updates
- **Built:** a check shortly after start-up and every 6 hours, a notice with the release notes (**Update now** / **Remind me later**), background download, signature check, and install with your data kept (backed up first).
- **Not switched on yet:** the first signed, auto-updating release (0.2.0) needs the owner's accounts set up first ([`docs/release-setup-checklist.md`](docs/release-setup-checklist.md)). Updates were verified end to end on Windows in CI ([`docs/update-verification.md`](docs/update-verification.md)). Until then, install new builds by hand.

## Requirements

| What | Details |
|---|---|
| **Windows 11, 64-bit** | Windows 10 and ARM are not supported. |
| **DualSense or DualShock 4, and a USB data cable** | USB-C for a DualSense, Micro-USB for a DualShock 4. Bluetooth isn't supported; charge-only cables don't carry data. See [Supported controllers](#supported-controllers). |
| **[ViGEmBus](https://github.com/nefarius/ViGEmBus/releases) 1.22** (free, third-party) | **Needed for games to see NEXUS.** Without it NEXUS still reads and shows the controller, but games see no virtual controller. Retired by its developer in 2023 but works on Windows 11, so NEXUS labels virtual output *experimental*. |
| **[HidHide](https://github.com/nefarius/HidHide/releases)** (free, third-party) | **Optional.** Stops presses counting twice in games with PlayStation support or Steam Input, by hiding the controller from everything but NEXUS. Without it, turn off PlayStation controller support in the game or Steam. Guide: [`docs/hidhide-setup.md`](docs/hidhide-setup.md). |
| WebView2 Runtime, WebGL graphics | Part of Windows 11. Without WebGL, NEXUS can't show the 3D controller; a note says so and everything else works (on the Mapping page the cards still select and edit controls). |

NEXUS **never installs, bundles or silently configures drivers** and needs no administrator rights. You install ViGEmBus (and HidHide if wanted) yourself from the official pages.

### Supported controllers

| Controller | USB IDs | Connection | Notes |
|---|---|---|---|
| **DualSense** (PS5, CFI-ZCT1) | 054C:0CE6 | USB-C data cable | |
| DualSense Edge | 054C:0DF2 | USB-C data cable | Read as a DualSense; back buttons and Fn buttons aren't decoded |
| **DualShock 4** (PS4), first revision CUH-ZCT1 | 054C:05C4 | Micro-USB data cable | Light bar and vibration; no player lights or mute button |
| **DualShock 4**, second revision CUH-ZCT2 | 054C:09CC | Micro-USB data cable | As above |

**Connecting:** plug the controller into a USB port on the PC (a direct port is best), with a data cable. There's nothing to pair or switch on. The Dashboard, the sidebar and *Live Viewer* show **DualSense** or **DualShock 4** within about a second. *Settings › Device scan* shows the identified model and revision.

**How NEXUS identifies it:**
- **Vendor and product:** Sony's vendor ID and the controller's product ID, read from the device path before anything is opened.
- **Interface:** only the controller's game pad interface.
- **Connection:** USB, from Windows' device tree.
- **Virtual or physical:** virtual controllers, such as ViGEmBus's DualShock 4, are recognised and never read.

Each model has its own report reader (DualShock 4 format: [`docs/dualshock4-protocol.md`](docs/dualshock4-protocol.md)).

## Installation

1. **Install NEXUS.** Use the **Download NEXUS** button above and run `NEXUS-latest-x64-setup.exe`.
   - Windows SmartScreen may say *"Windows protected your PC"* because development builds aren't code-signed: click **More info › Run anyway**. Releases from 0.2.0 on are signed (see the [code signing policy](CODE_SIGNING_POLICY.md)); each download can also be checked with `gh attestation verify <file> --repo ayyflame/nexus-controller`. Why, and what signing would take: [`docs/code-signing.md`](docs/code-signing.md).
   - It installs for your account only; no administrator password needed. Installing over an older version keeps your profiles, macros and settings.
2. **Install ViGEmBus.** Download `ViGEmBus_1.22.0_x64_x86_arm64.exe` from the [official page](https://github.com/nefarius/ViGEmBus/releases) and run it (the administrator prompt is from ViGEmBus). In NEXUS, **Virtual Controller › Check drivers again**: the *ViGEmBus driver* card should show **Ready**.
3. **Connect and turn on output.** Plug in the DualSense or DualShock 4; the Dashboard shows **DualSense** or **DualShock 4** and the sidebar shows it as connected. In **Virtual Controller**, turn on **Use the experimental virtual controller** and choose **Xbox 360**. The Xbox 360 option should show **Active**, with **Xbox 360 connected** and *Games see it as player 1*.
4. **Check in Windows.** Win + R → `joy.cpl` → **Controller (XBOX 360 For Windows)** → **Properties**. Pressing controller buttons lights the matching Xbox buttons, remaps and macros included.

More detail: [`docs/install-windows.md`](docs/install-windows.md).

## Updating and uninstalling

**Updating (now):** download the newest build with the button above and run it over the installed version. Profiles, macros, calibration and settings are kept, and *Start with Windows* stays as you set it. NEXUS also saves a daily backup you can restore from *Profiles › Restore points*.

**Automatic updates (once switched on):** NEXUS checks shortly after start-up and every 6 hours and shows a notice; nothing installs without your OK. Each update is checked against NEXUS's signing key, your data is backed up first, and a failed update leaves the current version running. To go back a version, install the older setup from its GitHub Release; *Profiles › Restore points › Saved before updating* restores your data as it was. Details: [`docs/updater-setup.md`](docs/updater-setup.md#when-an-update-fails).

**Uninstalling:** Windows *Settings › Apps › Installed apps › NEXUS › Uninstall* (it offers to close NEXUS if it is running). This removes the program, its Start-menu entry and the *Start with Windows* entry. Your data in `%APPDATA%\com.nexus.controllerengine` is kept unless you tick *Delete the application data*, so reinstalling brings everything back. ViGEmBus and HidHide are separate programs: uninstall them from *Installed apps* if no other program needs them.

## Using NEXUS

**Remap buttons:** *Mapping*. Click a button on the controller or its card, then choose what it **Sends** and, optionally, a second button under **Also press**. Pressing a button on the controller lights its card. Shift layers are set up below the mapping.

**Tune sticks and triggers:** *Sticks* and *› Triggers* apply live, with your input and the result plotted side by side. For drift or short travel, run **Live Viewer › Calibration**.

**Make a macro:** *Macro Studio › ＋ New macro*, then record it or build it, adjust the timing on the timeline, and pick the trigger button and mode; it saves automatically. Timing follows controller reports (about every 4 ms over USB). For **Repeat While Held**:
- leave at least **20 ms** between two presses of the same button;
- make presses at least **40–50 ms** long, because games read the controller once per frame.

**Profiles:** switch from the sidebar or in *Profiles*, create from templates or copies, choose a **start-up profile**, pin favourites, and link a game's `.exe` to switch automatically.

**Keep it running while you play:** close the window; NEXUS stays in the tray. Use *Settings › Windows* to start it with Windows, and tray › *Quit NEXUS* to really close it.

**Check that games get your input:** *Live Viewer › Output Check* with the virtual controller on. Press buttons and move the sticks: every row should stay green.

**What games receive:**
- **Buttons:** Cross/Circle/Square/Triangle → A/B/X/Y, L1/R1 → LB/RB, L2/R2 → LT/RT (full analog), Create/Options → Back/Start, PS → Guide.
- **Not sent:** touchpad click and Mute have no Xbox equivalent (remap them to use them). Gyro, touchpad position, adaptive triggers and the light bar aren't part of an Xbox controller.
- **Rumble and icons:** rumble from games isn't passed to the DualSense, and games show Xbox button icons.
- **Online games:** some anti-cheat systems block virtual controllers or macros. NEXUS doesn't hide from them, so don't use it where a game's rules forbid it.

Full details: [`docs/game-output.md`](docs/game-output.md).

## Known limitations

- **USB only.** Bluetooth isn't supported, by design, for either controller. The Sony DualShock 4 USB Wireless Adaptor isn't supported either.
- **DualShock 4:**
  - only Sony's two revisions (CUH-ZCT1, CUH-ZCT2) are recognised. Third-party "DS4-compatible" pads with other USB IDs aren't, and ones that use Sony's IDs are untested;
  - Share appears as *Create* in the button lists, since both sit in the same place.
- **One controller type out:** games see a virtual **Xbox 360** controller. DualShock 4 output, adaptive triggers, the light bar, gyro and touchpad position aren't passed to games, and rumble from games doesn't reach the controller. Games show Xbox button icons.
- **ViGEmBus is retired** by its developer (2023). It works on Windows 11 today, but if a future Windows update breaks it there are no fixes from upstream. NEXUS labels virtual output *experimental*; the replacement options are evaluated in [`docs/virtual-driver-evaluation.md`](docs/virtual-driver-evaluation.md#long-term-update-2026-11-20-what-could-replace-vigembus).
- **Anti-cheat:** some games block virtual controllers or macros. NEXUS never hides from anti-cheat or touches game processes; don't use it where a game's rules forbid it.
- **Player slot:** many games only listen to player 1. If another Xbox-type controller is connected first, NEXUS becomes player 2 (the Dashboard checklist says so).
- **Double input:** games and Steam with PlayStation support see both the PlayStation controller and NEXUS's Xbox controller unless you turn that support off or use HidHide.
- **Slow driver calls:** if the virtual-controller driver stalls, NEXUS skips the input it queued meanwhile rather than sending it late; a tap made entirely during such a stall is lost.
- **Not code-signed yet:** SmartScreen warns on first install ([`docs/code-signing.md`](docs/code-signing.md)).
- **Windows 11, 64-bit only.** Windows 10 and ARM aren't supported.
- **Not yet validated** with a real DualSense or DualShock 4 in games: see the release gate in [`tests/hardware-verification.md`](tests/hardware-verification.md#release-gate).

## Troubleshooting

| Problem | What to do |
|---|---|
| The controller never appears | Use a **data** cable (USB-C for a DualSense, Micro-USB for a DualShock 4) in a direct USB port. A DualShock 4 connected by Bluetooth isn't used: plug it in by cable. Close Steam, DS4Windows or similar tools, then **Settings › Scan now**. |
| *Waiting for ViGEmBus* / driver not installed | Install ViGEmBus 1.22, then **Virtual Controller › Check drivers again**. If it says *installed but could not be opened*, restart Windows. |
| Games don't react, but `joy.cpl` shows the Xbox controller | Check the **player** number under *Virtual controller now*. Many games only listen to player 1: unplug other Xbox-type controllers and turn the output off and on. |
| A press counts twice | The game or Steam sees both controllers. Turn off PlayStation controller support there, or set up HidHide. |
| Controller missing after setting up HidHide | NEXUS must be on HidHide's *Applications* list (copy its path from *Virtual Controller*), or untick *Enable device hiding*. |
| *Reconnecting…* on the virtual controller | NEXUS re-creates it by itself. If it keeps happening, restart Windows or reinstall ViGEmBus. |
| A macro press isn't seen | Press time at least 40–50 ms; 20 ms between presses of the same button. |
| Stick drift, or a stick/trigger not reaching full range | **Live Viewer › Calibration**; **Live Viewer › Drift Test** shows how much a stick drifts. |
| The 3D controller looks plain white or doesn't change colour | Install the newest build; older builds blocked the model's textures. |
| The window doesn't open, but the controller works | The window uses Microsoft Edge WebView2. NEXUS starts the controller first and keeps running in the tray; tray › *Open NEXUS* tries again. If it never opens, repair *Microsoft Edge WebView2 Runtime* in *Settings › Apps*. |
| Closing the window doesn't quit NEXUS | That's on purpose, so games keep the controller: quit from the tray icon (right-click › *Quit NEXUS*), or switch it off under *Settings › Windows › Close button*. |
| Nothing opens when I start NEXUS | It's already running in the tray, and that copy's window is brought back. If NEXUS was started with Windows, it starts in the tray; click the tray icon. |
| Something else looks wrong | **Settings › HID Devices › Copy diagnostics report**, paste it into a text file and send it with a description. |

Your data lives in `%APPDATA%\com.nexus.controllerengine` (profiles, macros, settings, backups). Uninstalling removes the *Start with Windows* entry and leaves your data there; delete the folder for a clean removal.

## Documentation

- **Using NEXUS:** [Installing](docs/install-windows.md) · [Game output](docs/game-output.md) · [Macro Studio](docs/macro-studio.md) · [3D controller view](docs/3d-controller.md) · [Live Viewer](docs/live-viewer.md) · [Performance](docs/performance.md) · [Driver call stalls](docs/driver-performance.md) · [Calibration](docs/calibration.md) · [HidHide setup](docs/hidhide-setup.md)
- **Testing:** [Hardware test plan](tests/m4.5-test-plan.md) · [Hardware verification checklist](tests/hardware-verification.md) · [Update verification](docs/update-verification.md)
- **Updates and releases:** [Release setup checklist](docs/release-setup-checklist.md) · [Updater setup](docs/updater-setup.md) · [Releasing](docs/releasing.md) · [Code signing](docs/code-signing.md) · [Code signing policy](CODE_SIGNING_POLICY.md) · [SignPath application](docs/signpath-application.md)
- **Internals:** [Architecture](docs/architecture.md) · [DualSense report format](docs/dualsense-protocol.md) · [DualShock 4 report format](docs/dualshock4-protocol.md) · [Virtual output and drivers](docs/virtual-output.md) · [Virtual driver evaluation](docs/virtual-driver-evaluation.md) · [Latency audit](docs/latency-audit.md)

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

- 3D controller model: **"Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato)** ([source](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). NEXUS splits it into separate controls and recolours it at run time.
- DualShock 4 3D model: **"DualShock 4 PlayStation Controller" by [shaielwolf](https://sketchfab.com/shaielwolf) ([source](https://sketchfab.com/3d-models/dualshock-4-playstation-controller-e3c2f0dc16524fc19cdde45bad1de1a9))**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). NEXUS splits it into separate controls at run time.
- NEXUS is not affiliated with Sony.

## License

NEXUS's code is under the [MIT License](LICENSE): you may use, copy, modify and share it, keeping the copyright notice; it comes with no warranty. The 3D model and other third-party parts keep their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
