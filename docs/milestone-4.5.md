# Milestone 4.5: Controller Reliability & Input Completion

**Status:** implementation complete; hardware verification pending (see [`tests/m4.5-test-plan.md`](../tests/m4.5-test-plan.md)).

**Build under test:** Windows build [43951723592](https://github.com/ayyflame/nexus-controller/actions/runs/43951723592), commit `9d00fa2`. It contains every item below plus the latency changes P2, P4, P5 and P6 (`docs/latency-audit.md`). It replaces the earlier test build `832de00`.

**Scope rules:**

- USB only; no Bluetooth;
- no custom kernel driver;
- no automatic driver installation;
- no database migration;
- ViGEmBus stays experimental and replaceable;
- no M5 work.

## Changes

| Commit | Change |
|---|---|
| `711f0d4` (macro beta, prerequisite) | Experimental virtual Xbox 360 output via a user-installed ViGEmBus; consent switch; neutral report before every removal |
| `3128ee9` | **Gap A:** "Check again" re-creates the virtual controller after ViGEmBus is installed while NEXUS runs. **Gap B:** a failing virtual controller is dropped, logged once and re-created with back-off (1 s doubling to 30 s); retrying stops if the driver is gone. **Gap C:** after a macro reload (profile switch, edit, resume after recording), a held trigger must be released and pressed again. **Gap D:** tests for rapid taps, two macros at once, two macros on one button, and a profile with output off. **Bug fixed:** a macro stopped by an idle-time reload was still shown as *Playing*. |
| `ae54956` | Optional HidHide guidance on the Virtual Output tab (NEXUS never installs or configures it); `docs/hidhide-setup.md`; rows D1–D10 |
| `31c6ec3` | **Editable macro timing:** per-action *starts at* and *wait before*; bulk edit for selected actions (set press time or wait, or scale speed); helpers clamped to engine limits; no data-model or engine change |
| `b862b6a` | **Macro Studio audit:** recorder no longer merges a quick tap after a release into a "pressed together" action; recorded same-button presses keep a 20 ms release gap; millisecond fields revert on empty input, show the stored value and add no no-op undo steps; warnings for same-button presses under 20 ms apart (including the repeat boundary); looping preview for Repeat While Held and Toggle |
| `41a4f44` | **Reliability and measurement corrections** (after the read-only audit). **Stall reload:** a profile switch or macro edit that stops a macro while the controller sends nothing now sends a neutral frame to the virtual controller, for every output on/off transition. **Statistics:** idle ticks are no longer counted as processing-time samples. **Diagnostics:** the report includes processing time (p50/p99/max) with its definition and the build commit (report version 2). **Tests added:** the reader thread's priority (Windows), the minimise and restore hook, macro timing after reopening the database file, `block_trigger` through duplicate, export and import (no defect found) |
| `ef639fd`, `9d00fa2` | **Unreadable-report fail-safe (audit item C4):** after 8 controller reports in a row that NEXUS can't read, all macros are stopped and one neutral frame is sent to the virtual controller, which stays connected. Any valid report resets the count. The first valid report resumes physical input at once; macros need a fresh trigger press. The warning and the recovery are each logged once per episode |

## Automated results (simulated, no hardware)

| Check | Result (commit `9d00fa2`) |
|---|---|
| Rust tests | Linux: 310 passed, 0 failed. Windows CI runner: 312 passed, 0 failed (includes the Windows-only reader-thread priority tests) |
| Frontend tests | 39 passed, 0 failed |
| `cargo fmt --check`, `cargo clippy -D warnings`, TypeScript check, production build | Clean |
| Windows CI build and installers | Success (run 43951723592): `NEXUS_0.1.0_x64-setup.exe`, `.msi` |

Automated tests use a mock HID backend and a mock virtual controller. They prove NEXUS's logic, not Windows, ViGEmBus, HidHide or game behaviour.

## Hardware results

| Verified by the owner (2026-11-16, build `711f0d4`) | Outstanding |
|---|---|
| DualSense USB input; Windows recognises the virtual Xbox 360 controller (V3, V4); Repeat While Held repeats and stops on release (V6, V7); macro output in an offline game (V14, title pending) | Everything in `tests/m4.5-test-plan.md`, including re-checks of V6 and V7 on `9d00fa2` |

## Known limitations

See *Known limitations* in [`tests/hardware-verification.md`](../tests/hardware-verification.md):

- USB only;
- ViGEmBus is experimental and retired upstream;
- Xbox 360 only (no touchpad, gyro, mute, adaptive triggers or haptics in output);
- double input is possible without HidHide;
- settings are shared across multiple controllers;
- MZ Titan independent paddles are unsupported until capture evidence exists;
- the installer is not code-signed;
- the stall-reload fix and the unreadable-report fail-safe can't be reproduced by hand on real hardware (a USB DualSense doesn't stop sending or send unreadable reports on demand), so both are verified by simulation only;
- up to 7 unreadable reports in a row (about 28 ms at 250 Hz) leave the virtual controller on its last state, by design, so an isolated bad report never interrupts output;
- if a connected controller goes completely silent without disconnecting, a macro that is playing keeps playing on the last known input (a silence rule was considered and left out of scope).
