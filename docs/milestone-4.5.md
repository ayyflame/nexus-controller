# Milestone 4.5: Controller Reliability & Input Completion

**Status:** implementation complete; hardware verification pending (see [`tests/m4.5-test-plan.md`](../tests/m4.5-test-plan.md)).

**Build under test:** Windows build [43943310033](https://github.com/ayyflame/nexus-controller/actions/runs/43943310033), commit `832de00`. It contains every item below plus the latency changes P2, P4, P5 and P6 (`docs/latency-audit.md`).

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

## Automated results (simulated, no hardware)

| Check | Result (commit `b862b6a`) |
|---|---|
| Rust tests (Linux and the Windows CI runner) | 284 passed, 0 failed |
| Frontend tests | 33 passed, 0 failed |
| `cargo fmt --check`, `cargo clippy -D warnings`, TypeScript check, production build | Clean |
| Windows CI build and installers | Success (run 43907861742): `NEXUS_0.1.0_x64-setup.exe`, `.msi` |

Automated tests use a mock HID backend and a mock virtual controller. They prove NEXUS's logic, not Windows, ViGEmBus, HidHide or game behaviour.

## Hardware results

| Verified by the owner (2026-11-16, build `711f0d4`) | Outstanding |
|---|---|
| DualSense USB input; Windows recognises the virtual Xbox 360 controller (V3, V4); Repeat While Held repeats and stops on release (V6, V7); macro output in an offline game (V14, title pending) | Everything in `tests/m4.5-test-plan.md`, including re-checks of V6 and V7 on `832de00` |

## Known limitations

See *Known limitations* in [`tests/hardware-verification.md`](../tests/hardware-verification.md):

- USB only;
- ViGEmBus is experimental and retired upstream;
- Xbox 360 only (no touchpad, gyro, mute, adaptive triggers or haptics in output);
- double input is possible without HidHide;
- settings are shared across multiple controllers;
- MZ Titan independent paddles are unsupported until capture evidence exists;
- the installer is not code-signed.
