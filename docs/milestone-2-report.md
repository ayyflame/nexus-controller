# Milestone 2 Report

Date: 2026-11-15

## Summary

All software for Milestone 2 that does **not** cross the hardware gate is implemented and tested:

- the complete input processing pipeline with remapping;
- full profile management;
- Macro Studio execution with reliable stop;
- Windows hot-plug device management;
- virtual-controller report translation and driver detection;
- a redesigned interface.

**Milestone 2 is not complete under its Definition of Done.** No real DualSense has been tested on Windows yet, so the experimental ViGEmBus backend was deliberately **not** implemented. Every item that depends on real hardware or a virtual controller remains open.

## Hardware validation gate (audit)

| Check | Status |
|---|---|
| USB detection | **Not verified**: no results received |
| USB buttons, sticks, triggers | **Not verified** |
| Bluetooth detection | **Not verified** |
| Bluetooth buttons and analog input | **Not verified** |
| Reconnection after disconnect | **Not verified** |
| Macro recording with the real controller | **Not verified** |

Evidence:

- every row in `tests/hardware-verification.md` is empty;
- no `tests/fixtures/`, diagnostics reports or GitHub issues exist;
- all tests use synthetic reports.

The gate stays closed. Opening it is described in `docs/virtual-output.md`.

## Definition of Done

| Item | Status |
|---|---|
| Real DualSense connects over USB | ⛔ Unverified (code complete, hardware test pending) |
| Real DualSense connects over Bluetooth | ⛔ Unverified |
| Reads and processes input correctly | ⚠ Implemented and synthetic-tested; unverified on hardware |
| Users can remap buttons | ✅ Implemented and tested (applies to processed output) |
| Stick and trigger processing works | ✅ Implemented and tested |
| Macro Studio records and executes real sequences | ⚠ Implemented; real-controller recording unverified |
| Macros reach the selected virtual controller | ⛔ Blocked: no virtual output backend (gate) |
| Virtual Xbox 360 output works | ⛔ Blocked (translation done and tested) |
| Virtual DualShock 4 output works | ⛔ Blocked (translation done and tested) |
| Users can switch output types | ⚠ Selection, persistence and the switching policy work; no device is created (gate) |
| Duplicate physical/virtual input addressed | ⚠ Input side done (virtual devices never read); HidHide plan documented, blocked by gate |
| Profiles preserve and restore configurations | ✅ Implemented and tested (schema v3) |
| Disconnect/reconnect reliable | ⚠ Hot-plug implemented and mock-tested; unverified on hardware |
| Full automated test suite passes | ✅ 159 Rust + 9 frontend |
| Windows installer builds | ✅ See CI run in the release notes |

## Implemented in this milestone

**Device management**
- Windows `CM_Register_Notification` hot-plug: instant connect and disconnect, with a 5-second safety-net scan.
- `Button` identity moved into `controller-core`.

**Input processing** (`input-processing`), configurable per stick and per trigger and saved in profiles:
- inner and outer deadzone, anti-deadzone, sensitivity;
- linear, power or custom response curves;
- radial or axial deadzone shape, circular output, axis inversion;
- trigger deadzone, saturation point and output range;
- button remapping, including disabling buttons and analog-preserving trigger swaps;
- allocation-free per report; settings are sanitised.

**Profiles** (schema v3, migrated safely from v1 and v2):
- create, rename, duplicate and delete, with friendly errors; the last profile can't be deleted;
- per-profile processing settings and per-profile macro on/off;
- switching applies output mode, processing and macros atomically;
- the last-used profile loads at start-up.

**Macro Studio:**
- **Stop all macros**, latched until the trigger is released;
- macros overlay after remapping and trigger from physical buttons;
- macro on/off is per profile.

**Virtual output:**
- XUSB and DS4 report translation (tested);
- read-only ViGEmBus and HidHide detection;
- gate and risk documentation.

**Performance:** the time NEXUS adds per report (p50/p99/max) is shown in Performance.

**Interface:**
- navigation is now Dashboard, Controller, Macro Studio, Profiles, Performance and Settings;
- six Dashboard status tiles;
- the Controller page has Live, Sticks (curve editor and deadzone plot), Triggers, Buttons, Virtual Output, and Lighting & Haptics (marked "not available yet");
- full profile management.

## Not implemented (and why)

| Feature | Reason |
|---|---|
| ViGEmBus backend; Xbox 360 / DS4 devices | Hardware gate |
| HidHide integration | Hardware gate; also requires explicit approval |
| Driver install flow | Comes with the backend; must stay a separate, approved step |
| Vibration, lightbar, player LEDs, adaptive triggers | Need DualSense output reports verified on hardware; nothing is sent to the controller yet |
| DualSense Edge paddles and Fn buttons | Report bits not yet verified |
| Touchpad as buttons or regions, gyro | Out of scope for this milestone |
| OBS overlay | Removed from navigation; planned later |

## Test results

- `cargo test --workspace`: **159 passed, 0 failed** (Milestone 1 / Macro Studio: 118). Two assertions were edited to be **stricter** or to match deliberate wording; none were removed or weakened.
- `npm test`: **9 passed**. The preview maths is checked against the same cases as the engine.
- `npm run typecheck`, `cargo fmt --check`, clippy (Linux and `x86_64-pc-windows-msvc`): clean.
- The real app was launched on Linux and migrated an on-disk v2 database to v3.
- Windows build and installer: produced by CI (see the release notes for the run link).

## Next steps

1. Install the new build. Complete `tests/hardware-verification.md` rows 1–37 over USB and Bluetooth, and share both diagnostics reports.
2. Fix any hardware findings and add the recorded reports as regression fixtures.
3. **Open the gate:** implement the experimental ViGEmBus backend (Xbox 360 and DS4) using the existing translation layer, with an explicit driver-approval flow.
4. Add HidHide integration as a separately approved option, then verify recognition in `joy.cpl` / an XInput tester and a game.
