# Milestone 2 Proposal: Hardware Validation and Virtual Output

## Objective

Prove the Milestone 1 foundation on real Windows 11 hardware. Then deliver the first end-to-end path: **physical DualSense → normalized state → virtual Xbox 360 or DualShock 4 controller that games can see**, with safe mode switching, honest driver status and no silent installs.

## Decisions needed before starting

| # | Decision | Recommendation |
|---|---|---|
| D1 | Virtual driver for M2 | **ViGEmBus 1.22.0** via `vigem-client` (pure Rust), as a documented-risk dependency. It is detected, not bundled. In parallel, contact LizardByte about licensing, DS4-on-Windows and the IPC protocol. See `virtual-driver-evaluation.md`. |
| D2 | Driver distribution | Link to the official signed ViGEmBus release from a "Driver required" panel. Never bundle or repackage the `.sys`. Revisit bundling the *official installer* only with explicit permission. |
| D3 | Physical controller hiding | Phase 1: show a clear in-app warning that games may see two controllers, and document per-game workarounds. Phase 2: evaluate HidHide (maintenance status, licensing) or alternatives as a separate decision. |
| D4 | Code-signing certificate for the NEXUS installer | Obtain an OV/EV certificate before any external testers. |

## Work plan (sequential)

### Phase A — Hardware validation (gate for everything else)
1. Run `tests/hardware-verification.md` on Windows 11 x64 over USB and Bluetooth.
2. Record real reports into `tests/fixtures/` and add regression tests that parse them.
3. Fix any discrepancy in transport detection, virtual/physical classification, BT mode switch or disconnect timing.
4. Add a GitHub Actions `windows-latest` CI job: `cargo test`, `clippy`, `npm run build`, and an unsigned `tauri build`.

**Exit:** checklist passes on two different PCs (at least one using the built-in Bluetooth adapter).

### Phase B — Discovery hardening
1. Event-driven hot-plug with `CM_Register_Notification` (HID interface arrivals and removals). Keep a 5 s fallback scan.
2. Read the controller MAC (feature report `0x09` on USB; serial string on BT) for identity-based dedupe across transports.
3. Show "device busy / hidden by another application" guidance when an open fails with access denied.
4. Multi-controller support in the UI (controller selector); the engine already supports it.

### Phase C — Virtual output (after D1 approval)
1. `ViGEmBackend` implementing `VirtualControllerBackend`:
   - Detect whether the bus is present and its version, with a clear status in Settings.
   - Create and remove an X360 target and a DS4 target.
   - Handle the bus disappearing while running.
2. Output mappers (pure, unit-tested):
   - `ControllerState` → XUSB report: sticks, triggers, buttons. PS → Guide; Create/Options → Back/Start; touchpad click → configurable, default none.
   - `ControllerState` → DS4 report: including touchpad and IMU passthrough.
3. Mode switching, verified with the real bus: disconnect old → confirm removal → create new, never two at once. Already enforced by `VirtualOutputManager`; add integration tests against ViGEmBus on the CI runner if feasible, otherwise a manual checklist.
4. Rumble feedback: virtual-device rumble notification → DualSense output report (USB 0x02 / BT 0x31 with CRC). Opt-in, conservative intensity.
5. Release the virtual device when the physical controller disconnects, and recreate it on reconnect. Make the behaviour configurable later.
6. Dashboard: "Virtual output: Xbox 360 — Active" only when the target really exists.

### Phase D — Quality and observability
1. Generate TypeScript types from Rust (`ts-rs`) and remove the hand-maintained mirror.
2. Latency instrumentation: HID read timestamp → virtual submit timestamp. Show p50/p99 on the Performance page.
3. Frontend tests (Vitest) for controller-phase logic and the IPC adapters.
4. Structured file logging with rotation in the app data folder.

## Explicitly out of scope for M2
Deadzones, curves, remapping, macros, adaptive-trigger effects, OBS overlay, start-with-Windows, and auto profile switching. Those are planned for M3 and later, on top of the `InputProcessor` pipeline.

## Acceptance criteria
- Hardware checklist passes over USB and Bluetooth; recorded-fixture tests in CI.
- With ViGEmBus installed: selecting Xbox 360 makes `joy.cpl` / the Windows Game Controllers panel and an XInput test show one Xbox 360 controller tracking the DualSense. Switching to DS4 removes it before the DS4 appears. Selecting Disabled removes all virtual devices.
- Without ViGEmBus: no errors beyond a clear "driver required" status, and nothing is installed.
- Unplugging the DualSense removes or neutralizes the virtual device within 1 s; re-plugging restores it.
- Measured added latency (read → submit) p99 < 1 ms on a typical desktop.
- No administrator prompt during normal use.

## Estimated effort
Phase A: 2–3 days (hardware-dependent) · Phase B: 3–4 days · Phase C: 6–8 days · Phase D: 3 days.
