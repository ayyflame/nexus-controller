# NEXUS Controller Engine

NEXUS is a Windows 11 (x64) app that processes and remaps a **Sony DualSense connected by USB**, then delivers the result to games through a **virtual Xbox 360 controller**.

```
DualSense (USB) → NEXUS: sticks, triggers, remapping, layers, macros → virtual Xbox 360 controller → Windows games
```

Built with Tauri 2, React and TypeScript for the UI, and Rust for the engine, with SQLite storage and Windows HID. NEXUS is a personal project for its owner and a few friends(Vibe Coded Slop.

> **Status:** the features below are implemented and covered by automated tests. Hardware checks with a physical DualSense, ViGEmBus and real games are tracked in [`tests/m4.5-test-plan.md`](tests/m4.5-test-plan.md), [`docs/game-output.md`](docs/game-output.md) and [`docs/3d-controller.md`](docs/3d-controller.md). Automatic updates work in a Windows test but are not live yet (see [Updates](#updates)).

## Features

### Controller input and processing

- **USB detection.** NEXUS finds a USB DualSense automatically, reconnects within about a second and ignores duplicate or virtual devices. Bluetooth is not supported.
- **Sticks** (*Controller › Sticks*): deadzone (radial or axial), outer deadzone, anti-deadzone, sensitivity, response curves with presets or custom points, invert, and circular or square output.
- **Triggers** (*Controller › Triggers*): deadzone, range, curve, and the point where the trigger counts as pressed.
- **Calibration** (*Live Viewer › Calibration*): a guided wizard that measures each stick's resting centre, jitter and full range, recommends a deadzone, and measures L2/R2's released and fully pressed ends. Nothing is saved until you review and apply it, and you can reset to the previous calibration ([`docs/calibration.md`](docs/calibration.md)).
- **Interactive 3D controller**: your DualSense as a 3D model that moves with the real controller: buttons light up, sticks tilt, L2/R2 swing with their pressure, touches show on the touchpad. Drag to rotate, scroll to zoom, front/rear/top views, Midnight Black or White. See [docs/3d-controller.md](docs/3d-controller.md).
- **Button remapping** (*Controller › Mapping*): click any button on the 3D controller, or its card, and choose what it sends: another button, nothing, or two buttons at once. Each card shows what the game receives (for example Triangle → Y). Undo/redo and a list view are included.
- **Shift layers:** hold a button (or toggle it) to switch to a different button layout while it's active.
- **Gyro and touchpad** (optional): gyro aiming onto a stick, touchpad zones and swipes as buttons.
- **Lighting and vibration** for the physical controller (*Controller › Lighting & Haptics*).

### Macro Studio

- **Create a macro** by **recording** it from the controller or **building it manually** on a controller layout.
- **Three playback modes:** **Play Once**, **Repeat While Held** and **Toggle On/Off**.
- **Editable timing:**
  - Every action has a **press time** and a **wait after release** that you type in milliseconds. A *wait before* is also available.
  - Several actions can be edited at once, with speed scaling to keep a recorded rhythm.
  - The timeline and the on-screen preview update right away, with undo/redo.
- **Safety checks:** warnings when the same button would be pressed again too quickly for a game to see two presses (including across the repeat boundary). Conflicting triggers are blocked, and the trigger button can be hidden from games.
- **Triggers:** macros start from the physical button, so remapping doesn't break them. They combine with whatever you're holding.

### Profiles

- **Profile contents:** each profile stores stick, trigger, mapping, layer, gyro, touchpad and lighting settings, plus its virtual output choice.
- **Profile management:** create from templates (Standard, Shooter, Racing, Relaxed), rename, duplicate and delete.
- **Automatic switching:** a profile can switch on when a linked game (`.exe`) starts.
- **Shared macros:** macros are kept in one library and available in every profile.
- **Backup and transfer:** import/export of profiles and macros, plus database backups.

### Live view and diagnostics

- **Live controller picture** (Dashboard, *Controller › Live*, *Controller › Mapping* and the Live Viewer):
  - **3D by default:** the interactive DualSense model described above.
  - **2D if you prefer:** *Controller › Live › Controller picture › 2D* shows the flat drawing (or your own photo). It's also shown automatically if the PC can't draw 3D.
  - Pressed buttons light up, stick movement is shown, L2/R2 fill with their analog pressure, and touches appear on the touchpad.
  - Your physical input and what is sent to the game are shown side by side.
  - Click a button to see what it is mapped to; small marks flag remapped, macro and disabled buttons.
  - Optionally, you can use your own photo of the controller instead of the drawing ([`docs/controller-photo.md`](docs/controller-photo.md)).
- **Performance page:**
  - report rate, time between reports, late-report counts and dropped reports;
  - NEXUS processing time, where the 99th percentile and maximum include the driver call.
- **Diagnostics** (*Settings › HID Devices*): raw HID reports, the engine log, a Report Inspector for unknown buttons, and a shareable diagnostics report. Serial numbers and paths are masked.

### Live Viewer (diagnostics)

- **What it is:** a sidebar page ([`docs/live-viewer.md`](docs/live-viewer.md)) with seven tabs:
  - **Live:** every control, the analog values, the active shift layer, and which controls were detected.
  - **Sticks & Triggers:** the full-range test, deadzone, and raw vs. sent values.
  - **Motion:** gyro, accelerometer and tilt.
  - **Health:** report rate, stale input, dropped or unreadable reports, processing time, battery and connection events.
  - **Controller Test:** a guided 10-step pass/fail check.
  - **Drift Test:** measures how much each stick moves at rest over time.
  - **Calibration:** a guided wizard for both sticks (centre, deadzone recommendation, full range) and both triggers (endpoints). It saves to the current profile only after you review and apply, and can be reset to the previous values ([`docs/calibration.md`](docs/calibration.md)).
- **Read-only, except Calibration:** the other tabs never change settings. Calibration only changes the current profile's calibration, and only when you apply it. Nothing here affects macros or game output.

### Virtual Xbox 360 output

- **What games see:** a standard *Controller (XBOX 360 For Windows)*, after all processing, remapping and macros.
- **Status:** NEXUS shows whether the virtual controller is connected, its XInput player slot, and when it's reconnecting after a driver error.
- **No stuck buttons:**
  - A neutral state is sent whenever the virtual controller is removed (unplug, output off, exit).
  - It's also sent whenever input can't be trusted: a profile change while the controller sends nothing, or 8 unreadable reports in a row.
- See [`docs/game-output.md`](docs/game-output.md) for exactly what games receive and the compatibility limits.

### Updates

- **Implemented:**
  - a check about 20 s after start-up and every 6 hours;
  - a notice with your version, the new version and the release notes, plus **Update now** and **Remind me later**;
  - a background download with progress;
  - a signature check before anything runs;
  - install and restart with your data kept, after a backup is made first.
- **Not live yet.** The signing key, update host and GitHub secrets haven't been set up ([`docs/updater-setup.md`](docs/updater-setup.md)), so current builds never check for updates.
- **Verified on Windows in CI.** An installed 0.1.0 updated itself to 0.1.1 with its data intact on a Windows test machine. It used a test key and a local HTTPS host ([`docs/update-verification.md`](docs/update-verification.md)). Until the one-time setup is done, install new versions by hand.

## Requirements

| What | Details |
|---|---|
| Windows 11, 64-bit (x64) | Windows 10 and ARM are not supported. |
| A Sony DualSense and a **USB-C data cable** | Bluetooth is not supported. Charge-only cables don't carry data. |
| **ViGEmBus** 1.22 (free, third-party) | **Needed for games to receive NEXUS output.** Without it, NEXUS still reads and shows your controller, but games see no virtual controller. Official download: [github.com/nefarius/ViGEmBus/releases](https://github.com/nefarius/ViGEmBus/releases) (`ViGEmBus_1.22.0_x64_x86_arm64.exe`). It was retired by its developer in 2023 but still works on Windows 11, which is why NEXUS labels virtual output *experimental*. |
| **HidHide** (free, third-party) | **Optional, not needed for normal use.** Games with PlayStation support, and Steam Input, may see both the DualSense and NEXUS's Xbox controller, so a press counts twice. HidHide hides the DualSense from everything except NEXUS. Official download: [github.com/nefarius/HidHide/releases](https://github.com/nefarius/HidHide/releases). Without it, turn off PlayStation controller support in the game or in Steam instead. Guide: [`docs/hidhide-setup.md`](docs/hidhide-setup.md). |
| Microsoft Edge WebView2 Runtime | Part of Windows 11. The installer downloads it if missing. |
| Graphics with WebGL support | Any Windows 11 PC has it. Used by the 3D controller view. Without it, NEXUS shows the flat picture instead. |

**NEXUS never installs, bundles or silently configures drivers.** You install ViGEmBus (and HidHide, if you want it) yourself from the official pages. NEXUS only checks whether they are present. NEXUS itself needs no administrator rights.

## Installation

### 1. Install NEXUS

1. While signed in to GitHub (the repository is private), download **`NEXUS_<version>_x64-setup.exe`**:
   - from the [Releases page](https://github.com/ayyflame/nexus-controller/releases); or
   - from the newest green run of [*Windows release build*](https://github.com/ayyflame/nexus-controller/actions/workflows/windows-release.yml), under **Artifacts › NEXUS-windows-x64**, which is a ZIP to extract.
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen may say *"Windows protected your PC"*: click **More info › Run anyway**.
3. Click **Next › Install › Finish**. It installs for your user account only, so no administrator password is needed.

Installing a newer version over an older one keeps your profiles and macros. More detail: [`docs/install-windows.md`](docs/install-windows.md).

### 2. Install the virtual controller driver (ViGEmBus)

1. Open the official release page: <https://github.com/nefarius/ViGEmBus/releases>.
2. Download **`ViGEmBus_1.22.0_x64_x86_arm64.exe`** and run it. Windows asks for administrator approval for the driver installer; that prompt is from ViGEmBus, not NEXUS.
3. In NEXUS, open **Controller › Virtual Output** and click **Check again**. *Driver* should show **Installed and ready**.

### 3. Connect the DualSense and turn on virtual output

1. Plug the DualSense in with a USB-C data cable. The Dashboard shows **DualSense · USB**, and the picture follows your input.
2. Go to **Controller › Virtual Output**.
3. Turn on **Use the experimental virtual controller**.
4. Choose **Xbox 360**. The choice is saved in the current profile.
5. *Virtual controller now* should show **Xbox 360 connected · Games see it as player 1**.

### 4. Check that Windows sees the virtual controller

1. Press **Win + R**, type `joy.cpl`, press **Enter**.
2. **Controller (XBOX 360 For Windows)** should be listed. Open **Properties** and press buttons on the DualSense: the matching Xbox buttons light up, including remaps and macros.

## Using NEXUS

### Map controller inputs

- **Remap buttons:** *Controller › Mapping*. Every button has a card around the controller picture showing what the game receives (Xbox names such as A, LB, Back; DualShock 4 names if that output is chosen). Click a card or the button on the picture, then pick what it **Sends** (itself, another button, or **Disabled**) and optionally a second button under **Also press**. Pressing a button on your controller lights its card. **Undo**, **Redo**, **Reset all** and a **List** view are at the top right.
- **Shift layers:** in the layers section of the same tab, pick an activator button (held or toggled) and the mappings that apply while it's active. The activator itself is not sent to the game.
- **Sticks and triggers:** *Controller › Sticks* and *Controller › Triggers*. Changes apply live, and the plots show your physical input next to the processed result.
- **Check a mapping:** *Controller › Live*. Click a button on the controller (in 3D or 2D) to see what it sends, which layers change it and which macros it starts.
- **3D view controls:** drag to rotate, scroll or −/+ to zoom; **Reset**, **Front**, **Rear** and **Top** views; the round swatch switches between Midnight Black and White; **2D** switches to the flat picture.

### Create and edit a macro

1. **Macro Studio › Create Macro**, then give it a name.
2. Create the sequence:
   - **Record:** **Start Recording**, perform the presses on the controller, then **Stop Recording**; or
   - **Build Manually:** click buttons on the layout to add actions.
3. Edit the timeline:
   - **One action:** click it and type its **press time** and **wait after release** in ms. Values are stored when you press Enter or leave the field, and *Exact timing* also has *wait before*.
   - **Several actions:** select them with Ctrl/Shift-click or Ctrl+A to edit them together or scale their speed.
   - Reorder, duplicate or delete actions. Ctrl+Z and Ctrl+Y undo and redo.
   - **Play preview** shows the sequence on screen only; nothing is pressed in games.
4. Assign it: pick the **trigger button** and the mode, then **Save Macro**. Later edits save automatically.

### Repeat While Held

Choose **Repeat While Held** as the mode. The sequence repeats while the trigger is held and stops as soon as you release it.

- **Wait after the last action:** this runs before each repeat. **Pause between repeats** (*Advanced settings*) adds more.
- **Same button pressed again:** for a game to see two presses, leave at least 20 ms between them. NEXUS warns if a sequence or its repeat boundary is shorter.
- **Very short presses:** a game reads the controller once per frame (16.7 ms at 60 fps), so presses shorter than about 40–50 ms can be missed.

### Profiles

- **Profiles:** create a profile (blank or from a template) and switch between them. Each profile keeps its own sticks, triggers, mappings, layers, gyro, touchpad, lighting and output settings.
- **Automatic switching:** add a game's `.exe` to a profile to switch to it when that game starts.
- **Macros:** they're shared by all profiles.
- **Backups:** export or import profiles and macros, or create a backup under *Settings*.

### Understanding the virtual controller output

- **What games see:** an Xbox 360 controller.
  - Cross/Circle/Square/Triangle arrive as A/B/X/Y; L1/R1 as LB/RB; L2/R2 as LT/RT (full analog); Create/Options as Back/Start; PS as Guide.
  - Stick up is positive, as XInput expects.
- **Not sent:** Touchpad click and Mute have no Xbox equivalent; remap them to an Xbox button to use them. Gyro, touchpad position, adaptive triggers, haptics and the lightbar aren't part of an Xbox 360 controller either.
- **Compared with what you press:** *Controller › Live* shows **Your controller** next to **Sent to the game**.
- **Vibration and button icons:** rumble a game sends isn't passed to the DualSense. Games show Xbox button icons.
- **Online games:** some anti-cheat systems block virtual controllers or macros. NEXUS does nothing to hide from them. Don't use it where a game's rules forbid it.

## Troubleshooting

| Problem | What to do |
|---|---|
| The DualSense never appears | Use a USB-C **data** cable and a direct USB port. Close Steam, DS4Windows or similar tools that can lock the controller, then **Settings › Scan now**. |
| *Waiting for ViGEmBus* / Driver not installed | Install ViGEmBus 1.22 from the official page, then **Controller › Virtual Output › Check again**. If it says *installed but could not be opened*, restart Windows. |
| Games don't react, but `joy.cpl` shows the Xbox controller | Check *Virtual controller now* for the **player** number. Many games only listen to player 1: unplug other Xbox-type controllers, then turn the output off and on. Also make sure the game uses controller input. |
| A press counts twice in a game | The game or Steam sees both controllers. Turn off PlayStation controller support in the game or in Steam, or set up HidHide ([`docs/hidhide-setup.md`](docs/hidhide-setup.md)). |
| Controller not found after setting up HidHide | NEXUS must be on HidHide's *Applications* list. Add it again (copy the path from *Virtual Output*), or untick *Enable device hiding*. |
| *Reconnecting…* on the virtual controller | ViGEmBus rejected an update. NEXUS re-creates the controller by itself (1 s, then up to every 30 s). If it keeps happening, restart Windows or reinstall ViGEmBus. |
| A macro press isn't seen by the game | Make the press time at least 40–50 ms and keep the 20 ms gap between presses of the same button. |
| Stick drift or a stick that doesn't reach full range | **Live Viewer › Calibration**: calibrate the stick. It measures the resting centre and full range and recommends a deadzone. **Live Viewer › Drift Test** shows how much it drifts. |
| A trigger doesn't reach 100 % | **Live Viewer › Calibration**: calibrate L2/R2 so their full press gives full output. |
| SmartScreen warns when installing | Expected: the installer isn't code-signed yet. **More info › Run anyway**. |
| Something looks wrong | **Settings › HID Devices › Copy diagnostics report**, paste it into a text file and send it with a description. |

Your data is in `%APPDATA%\com.nexus.controllerengine` (profiles, macros, settings, backups). Uninstalling NEXUS leaves it there; delete the folder for a clean removal.

## Develop

Only needed to build NEXUS from source.

| Tool | Version |
|---|---|
| Visual Studio 2022 Build Tools | "Desktop development with C++" (MSVC x64 and Windows 11 SDK) |
| Rust | stable ≥ 1.89, `x86_64-pc-windows-msvc` ([rustup.rs](https://rustup.rs)) |
| Node.js | 20 LTS or newer (22 recommended) |

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1   # read-only environment check
cd apps\desktop
npm install
npm run tauri dev                                                  # run
```

Checks (as CI runs them):

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd apps\desktop; npm run typecheck; npm test; npm run build
```

Installers: `npm run tauri build` in `apps\desktop`, output in `target\release\bundle\`. CI builds them on every *Windows release build* run. Releasing a version: [`docs/releasing.md`](docs/releasing.md).

**Layout:**

- `apps/desktop`: Tauri app (`src-tauri`) and React UI (`src`). The 3D model is in `src/assets/models`, the 3D view in `src/components/controller3d`.
- `crates/`:
  - `controller-core`: state model.
  - `dualsense`: report parsing.
  - `device-manager`: HID, reconnect, reader threads.
  - `input-processing`: sticks, triggers, remap, layers.
  - `macro-engine`, `profile-manager` (SQLite), `virtual-controller` (ViGEmBus, Xbox 360 translation), `engine`, `telemetry`, `app-detect`.
  - `updates`: update manifest and signature tools.

## Documentation

- **Using NEXUS:**
  - [Installing NEXUS](docs/install-windows.md)
  - [Game output: what games receive, compatibility limits](docs/game-output.md)
  - [Macro Studio](docs/macro-studio.md)
  - [Optional HidHide setup](docs/hidhide-setup.md)
  - [3D controller view](docs/3d-controller.md)
  - [Controller photo mode](docs/controller-photo.md)
  - [Live Viewer and diagnostics](docs/live-viewer.md)
  - [Calibration wizard](docs/calibration.md)
- **Testing:**
  - [Hardware test plan](tests/m4.5-test-plan.md)
  - [Hardware verification checklist](tests/hardware-verification.md)
  - [Update verification](docs/update-verification.md)
- **Updates and releases:**
  - [Updater setup](docs/updater-setup.md)
  - [Releasing](docs/releasing.md)
- **Internals:**
  - [Architecture](docs/architecture.md)
  - [DualSense report format](docs/dualsense-protocol.md)
  - [Virtual output and drivers](docs/virtual-output.md)
  - [Virtual driver evaluation](docs/virtual-driver-evaluation.md)
  - [Latency audit](docs/latency-audit.md)
  - [Developer setup on Windows](docs/windows-setup.md)
- **History:**
  - [M1 report](docs/milestone-1-report.md)
  - [M2 report](docs/milestone-2-report.md)
  - [M3 report](docs/milestone-3-report.md)
  - [M4 plan](docs/milestone-4-plan.md)
  - [M4 S1/S2 report](docs/milestone-4-s1-s2-report.md)
  - [M4.5](docs/milestone-4.5.md)
  - [M5 plan](docs/milestone-5-plan.md)

## Ground rules

- No simulated input is ever shown as live controller data.
- No drivers are installed, bundled or configured by NEXUS.
- No administrator rights are requested.
- No game-memory access, injection, aim assistance, recoil manipulation or anti-cheat evasion.

## Credits

- 3D controller model: **"Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato)** ([source](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). NEXUS splits it into separate controls and recolours it at run time. NEXUS is not affiliated with Sony.
