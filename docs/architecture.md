# NEXUS Architecture

## Goals that shape the design

1. **The controller engine is independent of the UI.** It runs on its own threads and never calls into Tauri or React. Closing a page, a slow re-render, or a hung webview cannot delay controller input.
2. **Four layers with explicit interfaces**, so new hardware or a new virtual driver touches one layer only:

```
 Physical input           Normalized state         Input processing          Virtual output
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐      ┌──────────────────────┐
│ HidConnection    │raw  │ ReportParser     │State│ ProcessingPipeline│State │ VirtualOutputManager │
│ (device-manager) ├────►│ (dualsense)      ├────►│ InputProcessor[] ├─────►│  └ VirtualController │
│                  │bytes│ → ControllerState│     │ (input-processing)│      │    Backend (replace- │
└──────────────────┘     └──────────────────┘     └──────────────────┘      │    able)             │
        ▲                        ▲                                           └──────────────────────┘
        │ ControllerDriver (identify / initialize / create_parser) — controller-core
```

3. **No fake data.** The engine reports a controller only after a real HID handle is open, shows input only after a valid report has been parsed, and reports virtual output as *requested* vs *active* separately.

## Repository layout

```
nexus-controller/
├── Cargo.toml                    Rust workspace
├── crates/
│   ├── controller-core/          Hardware-neutral types and traits (no I/O, no unsafe)
│   ├── dualsense/                DualSense identification, USB/BT report parsing, CRC-32
│   ├── device-manager/           HID backend trait, Windows HID backend, connection tracker,
│   │                             per-controller reader threads, mock backend (tests only)
│   ├── input-processing/         InputProcessor trait + ordered pipeline (pass-through in M1)
│   ├── virtual-controller/       VirtualControllerBackend trait + one-device-per-controller policy
│   ├── button-mapping/           Placeholder crate (documented scope only)
│   ├── macro-engine/             Macro model/validation, MacroRunner (playback), MacroRecorder
│   ├── profile-manager/          SQLite profiles + macro library (schema v2), migrations, last-used profile
│   ├── telemetry/                Bounded event log, raw report history, report-rate counters
│   └── engine/                   Runtime: wires everything together, owns threads, snapshots
├── apps/desktop/
│   ├── src/                      React + TypeScript UI
│   │   ├── components/ pages/ hooks/ styles/ lib/ types/
│   └── src-tauri/                Tauri 2 shell: commands, UI bridge thread, app lifecycle
├── docs/                         This documentation
└── tests/                        Test guide and hardware verification checklist
```

Compared with the suggested structure, two crates were added:

- **`engine`** is the runtime that composes the modules. Keeping it out of `src-tauri` means the full input path (discovery → parse → process → output) is testable without Tauri, and could later run as a Windows service or CLI.
- **`telemetry`** is separate so that diagnostics storage is bounded and reusable.

Tests live next to the code in each crate (`#[cfg(test)]`), which is the Rust convention; `tests/README.md` explains how to run them.

## Dependency direction

```
controller-core  ◄── dualsense
       ▲         ◄── input-processing
       │         ◄── virtual-controller
       │         ◄── profile-manager
       │         ◄── device-manager
       │
     engine ──► device-manager, dualsense, input-processing, virtual-controller, telemetry
       ▲
 src-tauri ──► engine, profile-manager, telemetry
```

`controller-core` has no dependencies besides `serde` and `thiserror`. Only `device-manager/src/windows.rs` contains `unsafe` code; every other crate uses `#![forbid(unsafe_code)]`.

## Threads

| Thread | Owner | Responsibility |
|---|---|---|
| `nexus-supervisor` | engine | Calls `DeviceManager::poll` and processes connect/disconnect. Sleeps until the next scan (1 s), a rescan request, or a session-ended wake-up. |
| `nexus-hid-N` (one per controller) | device-manager | Overlapped `ReadFile` with a 100 ms timeout → parse → `SessionHandler::on_report` (the engine's handler runs processing + virtual output on this same thread, with no extra hop). |
| `nexus-ui-bridge` | src-tauri | Every 16 ms: forwards engine events and, if the status revision changed, emits a status snapshot to the UI. |

The input path never waits on the UI. The bridge *pulls* snapshots, so a slow webview only lowers the UI refresh rate.

## Connection lifecycle

`device-manager/src/tracker.rs` holds the connection policy as a pure state machine (no I/O), so it is fully unit-tested:

- **Launch:** the first `poll` enumerates immediately, so an already-connected controller is found at start-up.
- **Dedupe:** a device path that already has a session is never opened again. A second interface reporting the same serial number is ignored (`DuplicateIgnored`).
- **Virtual filtering:** devices whose PnP ancestry leads to a `ROOT\` or `SWD\` (software) bus are never opened (`VirtualDeviceIgnored`). This prevents NEXUS from reading its own future virtual output, or another tool's.
- **Removal:** a read failing with "device not connected", or the device leaving enumeration, ends the session as `Removed`. The handle is closed **before** the end is announced.
- **Reconnect:** a removed device is reopened as soon as it reappears, with no delay. I/O errors and failed opens back off 1 s → 2 s → 4 s → 8 s → 16 s.
- **Shutdown:** `Engine::shutdown` stops every reader, releases virtual devices and joins all threads. Tauri calls it on `RunEvent::Exit`.

## IPC contract (React ↔ Rust)

Commands (`src-tauri/src/commands.rs`; typed wrappers in `src/lib/engine.ts`):

| Command | Returns |
|---|---|
| `get_app_info` | version, OS, data folder, storage warning |
| `get_status` | `EngineStatus` (devices, live input, output status) |
| `get_event_log(limit)` / `get_raw_reports(limit)` | Diagnostics |
| `rescan_devices` | Forces an enumeration now |
| `list_profiles` / `get_active_profile` / `set_active_profile(id)` | Profiles |
| `set_virtual_output(mode)` | Saves to the active profile and requests it from the engine |

Events: `nexus://status` (`EngineStatus`, at most 60 Hz, only on change) and `nexus://engine-event` (`EngineEvent`: device events and log entries).

The TypeScript mirror is in `src/types/engine.ts`. A Rust test pins the JSON shape of `DeviceEvent`. Generating the TS types from Rust (for example with `ts-rs`) is proposed for Milestone 2.

## Security posture

- The Tauri capability grants `core:default` only: no filesystem, shell or HTTP plugins.
- A strict CSP is set.
- No administrator rights are needed. HID enumeration uses zero-access query handles.
- No driver is installed or bundled.
- Enumeration is restricted to vendor IDs that a registered driver claims, so unrelated HID devices (keyboards, security keys) are never queried.

## Macros

See [`macro-studio.md`](macro-studio.md). Each controller's reader thread runs physical input → `ProcessingPipeline` → `MacroRunner` (from `macro-engine`) → virtual output. `DeviceSnapshot.input` is the physical state and `DeviceSnapshot.processed` is what games would receive. Macros are stored once in the profile database and shared by every profile.

## Milestone 2 additions

**Input pipeline.** Each controller's reader thread runs these stages in order:

1. Parse the report into the physical `ControllerState`. This is the state shown in Live and Dashboard.
2. Run `ConfiguredProcessor` (`input-processing`):
   - sticks: deadzones, curve, sensitivity, anti-deadzone, circular output, inversion;
   - triggers: deadzone, saturation, output range;
   - button remapping.
3. Run `MacroRunner` (`macro-engine`). It reads triggers from the *physical* state and overlays macro presses after remapping.
4. Send to `VirtualOutputManager`, which uses `translate::to_xusb` / `to_ds4` once a backend exists.

Settings and macros reach the reader threads through generation counters. Changes apply on the next report, with no locks held on the hot path and no allocation per report. The time NEXUS adds per report is measured in a fixed 256-sample window.

**Device discovery.** `CM_Register_Notification` on the HID interface class wakes the supervisor on every arrival or removal. A 5-second scan remains as a safety net.

**Profiles (schema v3).**
- Each profile owns its processing settings (`settings_json`) and virtual output choice.
- Macros are a shared library, while on/off is per profile (`profile_macros`).
- Switching profile applies output mode, processing and macros together.

**Virtual output.** See [`virtual-output.md`](virtual-output.md). Translation and driver detection are implemented. The ViGEmBus backend is gated on hardware validation.

## Milestone 3 additions

- **`ConfiguredProcessor`** is now stateful and clocked (`process_at`). Per report it runs: stick calibration and shaping → trigger calibration/curve/activation → gyro → touchpad zones/swipes → shift layers and remapping (with multi-action). It still never allocates per report.
- **Output reports.** `HidConnection::write_output_report` exists. Reader threads poll their handler for at most **one** pending report per iteration (latest-state, so bounded). The engine builds USB `0x02` / Bluetooth `0x31` reports (`dualsense::output`) only when lighting changes or a vibration starts or stops.
- **`nexus-app-detect`** reports the foreground program (limited query; no memory access). `AutoSwitcher` holds the switching rules, and a watcher thread in the desktop shell applies profiles.
- **Portability** (`profile-manager/portable.rs`): a versioned `nexus-config` JSON format, validated and transactional.
- **Schema v4** adds per-profile games, with a database backup before each migration.
