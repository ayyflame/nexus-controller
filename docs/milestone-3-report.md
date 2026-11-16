# Milestone 3 Report: Advanced Features and Professional Experience

Date: 2026-11-16

## 1. Audit (before implementation)

| Item | Finding |
|---|---|
| Real-hardware verification | **None.** All 37 rows of `tests/hardware-verification.md` are empty. There are no fixtures, diagnostics reports or issues. |
| Milestone 2 status | **Not complete.** Virtual output (ViGEmBus) is still behind the hardware gate. Everything else in M2 is implemented and synthetic-tested. |
| Windows build | The M2 build (`7a8d053`) succeeded on GitHub Actions: tests, installers, and no VC++ runtime dependency. |
| Architecture problems fixed first | (1) No database backup before migrations. (2) Processing stages were stateless and had no clock, which blocks gyro smoothing, toggles and swipes. (3) No path for sending output reports to the controller. (4) Settings were engine-wide (multi-controller limitation, see §4). (5) The UI only showed the first controller. |

## 2. Feature status

Legend:
- ✅ implemented and automatically tested;
- 🟡 implemented, but depends on hardware behaviour **not yet verified** with a real DualSense;
- ⛔ not implemented, with the reason given.

| Area | Feature | Status |
|---|---|---|
| Sticks | Custom curves, deadzone, anti-deadzone, outer deadzone | ✅ |
| | Independent X/Y sensitivity | ✅ |
| | Circularity correction and circle / square / unchanged output | ✅ |
| | Calibration wizard (centre and per-direction range) | ✅ logic, 🟡 real sticks |
| | Separate left/right settings; live visualisation | ✅ |
| Triggers | Deadzone, full-press point, output range | ✅ |
| | Activation ("click") threshold, sensitivity curve | ✅ |
| | Calibration wizard (rest and full press) | ✅ logic, 🟡 real triggers |
| Gyro | Gyro → right stick: always / while held / toggle | ✅ logic, 🟡 axes, signs and scale |
| | Sensitivity (overall and vertical), full-scale speed, threshold, smoothing, inversion, yaw/roll | ✅ |
| | Calibration (resting bias with a stillness check), live motion view | ✅ logic, 🟡 hardware |
| Touchpad | Left/right and four-zone click mapping with a visual editor | ✅ logic, 🟡 coordinates |
| | Swipe gestures (4 directions, distance and time limits, timed press) | ✅ logic, 🟡 hardware |
| Mapping | Button → button, disable, one input → several outputs | ✅ |
| | Shift layers (hold / toggle, up to 4) with hidden activators | ✅ |
| | Conflict detection (layers, gyro button, macro triggers) | ✅ |
| | Per-profile mappings, "restore default mapping" | ✅ |
| Macro Studio 2.0 | Multi-select, copy/paste, group duplicate/delete | ✅ (UI) |
| | Reusable blocks (insert another macro's sequence), templates | ✅ |
| | Import/export, per-profile on/off, Stop all with latch | ✅ |
| Feedback | Lightbar colour, brightness, connection colours, player LEDs | 🟡 output reports follow the Linux `hid-playstation` layout |
| | Vibration strength + Test vibration (always stops) | 🟡 "compatible vibration" mode; may be weaker on new firmware |
| | Adaptive triggers | ⛔ effect formats are reverse-engineered, not documented; not implemented |
| Smart profiles | Per-game executables, automatic switching (on/off), manual switching | ✅ logic, 🟡 Windows foreground detection is compile-checked only |
| | Templates, duplicate, per-profile macros/sticks/triggers/lighting | ✅ |
| Portability | Export profile / all / macros; import with preview; backup and restore | ✅ |
| | Validation (format, version, size, macros, games, references); all-or-nothing | ✅ |
| | Add never overwrites; Replace makes an automatic safety backup first | ✅ |
| Performance | Report rate, NEXUS processing time (measured), input errors | ✅ |
| | Dropped reports from sequence-counter gaps | 🟡 estimate; assumes the counter advances by one per report |
| | Connection history, output reports sent, macro status, diagnostics export | ✅ |
| | Virtual output update rate | ⛔ no virtual output yet (gate) |
| Multiple controllers | Detect, identify and view each controller (selector) | ✅ engine already ran one session per controller |
| | Independent settings and profile per controller | ⛔ see §4 |
| | Choose which controller drives which virtual output | ⛔ needs virtual output; each controller already gets at most one |
| UX | Onboarding, Ctrl+K settings search, tooltips, reset buttons, confirmations, keyboard navigation | ✅ |
| Updates | Version display, update check (GitHub releases) | ✅. The repository is private, so the check reports "no public release information" until releases are public. |
| | Data kept across updates and uninstall | ✅ data lives in `%APPDATA%`; DB backup before migration |
| | In-app auto-update | ⛔ needs signed update artifacts and a public feed |
| Virtual output | Xbox 360 / DualShock 4 devices, HidHide | ⛔ hardware gate (unchanged from M2) |

## 3. Data and compatibility

- **Schema v4** adds `games_json`. A v3 database is copied to `nexus.db.v3.bak` before migrating, and this was tested on a real on-disk v3 database.
- **Profile settings JSON** gains `layers`, `gyro`, `touchpad`, `feedback` and new stick/trigger fields. All have defaults, so Milestone 2 profiles load unchanged (tested).
- **Default behaviour** is unchanged: gyro, touchpad zones, layers and lighting are all off, and nothing is sent to the controller unless enabled.

## 4. Multiple controllers: current limitation

The engine runs a separate, isolated session per physical controller: its own reader thread, processing state, macro runner and virtual-output slot. That gives each controller exactly one virtual output and no shared input ownership. Settings, however, come from the **active profile** and apply to every controller.

Per-controller profile assignment needs per-session settings in the engine, plus a stable controller identity (MAC address from feature report 0x09 over USB). This is documented as the next step and not faked in the UI. The selector only chooses which controller you are *viewing*.

## 5. Test results

| Suite | Result |
|---|---|
| `cargo test --workspace` | **210 passed, 0 failed** (Milestone 2: 159) |
| `npm test` | **14 passed** |
| `cargo fmt --check`, clippy (Linux and `x86_64-pc-windows-msvc`), `npm run typecheck`, `npm run build` | clean |
| Real app on Linux (Xvfb) | Starts; on-disk v3 → v4 migration with backup |
| Windows build and installer | See the CI run linked in the final report |

**Changes to existing tests**, none of which weaken an assertion:
- Struct literals updated for the new fields (`RemapRule::new`, `..TriggerConfig::default()`).
- The v2 → v3 migration test now asserts the current schema version.
- One new calibration test had a wrong input, which was fixed.

## 6. Hardware results

**No hardware testing has been performed.** Every 🟡 item above needs the checklist (rows 1–52) on a real DualSense over USB and over Bluetooth.
