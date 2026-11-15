# Milestone 1 Report: Desktop Foundation and DualSense Detection

Date: 2026-11-15

## Build environment, and what it means

Milestone 1 was developed in a **cloud Linux container (Ubuntu 24.04 x86_64)**, not on Windows 11. Consequences:

| Check | Status |
|---|---|
| Windows version / architecture | **Not verifiable here.** Use `scripts/check-env.ps1` on the target PC. |
| Rust 1.97.0 / Cargo 1.97.0 | ✓ present (container) |
| Node.js 22.23.4 / npm 10.9.9 | ✓ present (container) |
| Tauri prerequisites | ✓ Linux equivalents (WebKitGTK 4.1) installed to compile and run the shell. Windows uses WebView2. |
| Visual Studio Build Tools / Windows SDK | **Not verifiable here** (not available on Linux) |
| Windows HID code | Compiled and clippy-clean for `x86_64-pc-windows-msvc`. **Never executed.** |
| Physical DualSense | **Not available. No hardware behaviour has been verified.** |

## What was delivered

| Requirement | State |
|---|---|
| Tauri 2 + React + TS app, graphite/gold design, sidebar, dashboard, settings, status | ✓ Implemented. Ran on Linux under Xvfb; the dashboard correctly reported "Unsupported OS". |
| HID enumeration (Windows) | ✓ Implemented with SetupAPI, CfgMgr32 and HID.dll. Untested on Windows. |
| DualSense identification (VID/PID + gamepad collection) | ✓ Unit tested |
| Physical vs virtual distinction (PnP ancestry) | ✓ Unit tested with realistic instance-ID chains; needs hardware confirmation |
| Connection type USB/Bluetooth | ✓ Three-tier detection, "Undetermined" when not conclusive |
| Connect/disconnect events in the UI | ✓ |
| Never claim a connection without a real device | ✓ Connected only after an open handle; live input only after a valid parsed report; browser preview shows "Engine offline" |
| USB input parsing | ✓ Implemented from protocol sources; synthetic-report tests |
| Bluetooth input parsing (0x31 + CRC, basic 0x01, mode switch) | ✓ Implemented; synthetic-report tests |
| Normalized state (sticks, triggers, face, bumpers, D-pad, L3/R3, Options, Create, PS, touchpad, mute, IMU raw, battery) | ✓ |
| Raw report preservation | ✓ Bounded ring buffer (256), visible in Settings → Diagnostics |
| Detect at launch, monitor removal, auto-reconnect, no duplicates, clean shutdown | ✓ Tested with the mock backend and real threads |
| Last-used profile (SQLite) | ✓ |
| Virtual output selection | ✓ Saved per profile. **No backend**: the UI says so explicitly. |
| `VirtualControllerBackend` interface + disconnect-before-switch policy | ✓ Tested |
| Driver evaluation | ✓ `docs/virtual-driver-evaluation.md`; **approval requested** |

## Automated test results

`cargo test --workspace`: **71 passed, 0 failed.**

| Crate | Tests | Covers |
|---|---|---|
| nexus-dualsense | 25 | identification, transport detection, virtual/physical classification, USB/BT/basic parsing, every button bit, D-pad, touch, IMU, battery, CRC, bad CRC, truncated/empty/unknown reports, 15 000-case no-panic fuzz |
| nexus-device-manager | 16 | dedupe, virtual ignore, serial duplicate, removal → close, immediate reconnect, exponential backoff, launch detection, unplug/replug with threads, handle closure, shutdown joins |
| nexus-engine | 8 | end-to-end: no-device honesty, awaiting-input → live, raw bytes preserved, invalid reports counted without replacing state, event stream, virtual ignore, output-without-driver reporting, unsupported OS, idempotent shutdown |
| nexus-controller-core | 7 | stick/trigger normalization, hat decoding, IPC JSON contract |
| nexus-profile-manager | 5 | default profile, last-used survives reopen, dangling ID fallback, validation, schema guard |
| nexus-virtual-controller | 5 | disconnect-before-connect, no-op same mode, failed disconnect blocks new device, release on drop, unavailable backend |
| nexus-telemetry | 3 | ring bounds, rate counter |
| nexus-input-processing | 2 | pass-through, stage order |

All report data in tests is synthetic. No recorded hardware reports exist yet.

## Build results

| Command | Result |
|---|---|
| `npm install` | ✓ 0 vulnerabilities (React 19.3, Vite 8.3, TypeScript 7.0, @tauri-apps/api + cli 2.12) |
| `npm run typecheck` (strict, `noUncheckedIndexedAccess`) | ✓ |
| `npm run build` | ✓ 249 kB JS / 11 kB CSS (77 kB / 3 kB gzip) |
| `cargo check --workspace` (Linux) | ✓ Tauri 2.12.5 |
| `cargo clippy --workspace --all-targets` | ✓ 0 warnings |
| `cargo clippy --target x86_64-pc-windows-msvc` (all engine crates incl. Windows HID backend) | ✓ 0 warnings |
| `cargo check -p nexus-desktop --target x86_64-pc-windows-msvc` | ✗ **expected**: bundled SQLite needs MSVC `cl.exe`, which the Linux container lacks. Must be built on Windows. |
| `cargo build -p nexus-desktop` + launch (Linux/Xvfb) | ✓ Window rendered, IPC working, `nexus.db` created, clean exit |

## Remaining issues and risks

1. **Unverified on Windows and hardware.** The Windows HID backend, transport detection, virtual-device classification, the Bluetooth mode switch and disconnect timing have not run on real systems. Run `tests/hardware-verification.md` first.
2. **Discovery uses 1 s polling.** Every scan enumerates HID interfaces and opens each with a zero-access handle to read its VID (deep queries only for Sony). This is cheap but not free. Replace with `CM_Register_Notification` arrival/removal notifications (Milestone 2) and keep a slow fallback scan.
3. **USB + Bluetooth at the same time.** Dedupe uses the HID serial string, which may be empty on USB. The robust key is the MAC from feature report `0x09` (not yet implemented).
4. **Exclusive access by other software.** If Steam Input, DS4Windows or HidHide hide or hold the device, NEXUS cannot see it or reports "access denied". There is no guidance UI yet.
5. **DualSense Edge:** paddles and Fn buttons are not decoded. IMU values are raw (uncalibrated).
6. **No virtual output backend.** Pending the driver decision. Games currently see only the physical controller.
7. **Duplicate controllers in games.** Once virtual output exists, games will see both the physical and the virtual pad unless the physical one is hidden. A strategy is needed (Milestone 2).
8. **TypeScript types are hand-mirrored.** One Rust test pins the event JSON shape; generate them (e.g. `ts-rs`) next.
9. **The dashboard shows the first controller only.** The engine already supports several.
10. **Profiles:** list and activate only; no create/rename/delete UI yet.
11. **No code signing** for the NEXUS installer, so SmartScreen will warn. Start with Windows is not implemented (optional, later).
12. Abnormal termination (Task Manager kill) skips the graceful shutdown path. Windows still releases HID handles.

## Screens

- `screenshots/dashboard-real-app-linux.png`: the real app on Linux, in its honest "Unsupported OS" state (taken before the overlay contrast fix).
- `screenshots/dashboard-SYNTHETIC-test-fixture.png`: live-input rendering checked with a **test-only mocked IPC layer and synthetic state**, used only to check the visualization. It is not part of the app and is not real hardware data.
