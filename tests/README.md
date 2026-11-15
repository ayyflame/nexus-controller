# Tests

Rust unit and integration tests live next to the code they test (`#[cfg(test)]` modules), which is the Rust convention.

```bash
cargo test --workspace
```

| Area | Location |
|---|---|
| Device identification, USB/BT detection, physical vs virtual | `crates/dualsense/src/identify.rs` |
| HID report parsing (USB, BT 0x31 + CRC, BT basic, invalid/truncated, fuzz) | `crates/dualsense/src/report.rs`, `crc.rs` |
| State normalization | `crates/controller-core/src/state.rs` |
| IPC JSON contract | `crates/controller-core/src/device.rs` |
| Connection policy: dedupe, reconnect, backoff, virtual filtering | `crates/device-manager/src/tracker.rs` |
| Disconnect handling, reconnection, shutdown with real threads (mock HID) | `crates/device-manager/src/manager.rs` |
| End-to-end engine (mock HID + synthetic reports) | `crates/engine/src/tests.rs` |
| Virtual output switching policy | `crates/virtual-controller/src/lib.rs` |
| Profiles / last-used persistence | `crates/profile-manager/src/lib.rs` |
| Macro model, playback modes, recording | `crates/macro-engine/src/` |
| Macro storage and v1→v2 migration | `crates/profile-manager/src/macros.rs` |
| Macros end to end (synthetic reports) | `crates/engine/src/tests.rs` |
| Macro Studio helpers (frontend) | `apps/desktop/src/lib/macros.test.ts` (`npm test`) |
| Telemetry bounds and rates | `crates/telemetry/src/lib.rs` |

All input reports used in tests are **synthetic** (built by `nexus_dualsense::synthetic`). The mock HID backend is compiled only for tests (`cfg(test)` / `test-support` feature) and is never part of the application.

Frontend: `npm run typecheck` and `npm run build` in `apps/desktop`.

Physical hardware must be verified manually: see [`hardware-verification.md`](hardware-verification.md).
