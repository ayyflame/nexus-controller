# Milestone 4: Investigation and Implementation Plan (for approval)

Scope: USB reliability, ModdedZone MZ Titan back paddles, and virtual Xbox 360 / DualShock 4 output. Windows 11 x64, **USB only**.

Status legend used throughout:

- **HW-verified**: confirmed on real hardware by the owner.
- **Simulated**: automated test with the mock HID backend.
- **Unverified**: neither.

Known hardware facts from the owner:

- A physical PS5 DualSense over USB works: 73,835 reports, 0 parse errors, about 250 Hz.
- Nothing else in `tests/hardware-verification.md` has been recorded yet.

---

## 1. USB reliability findings

How discovery works today:

- `device-manager/tracker.rs` holds a pure connection state machine.
- `windows.rs` provides overlapped HID reads and `CM_Register_Notification` hot-plug wake-ups, with a 5 s safety scan.
- `engine` runs a supervisor thread plus one reader thread per controller.

| # | Requirement | Current behaviour | Automated (simulated) | Hardware | Gap / action |
|---|---|---|---|---|---|
| 1 | Detect at start-up | First `poll` enumerates immediately | `detects_already_connected_device_on_first_poll` | Implied by the owner's diagnostics, not recorded | Record checklist row 3 |
| 2 | Start with no controller | "No controller", no fake data | `no_controller_is_never_reported_as_connected` | Unverified | Row 1 |
| 3 | Unplug detection | A read failing with `ERROR_DEVICE_NOT_CONNECTED`, or the device leaving enumeration, ends the session as **Removed**. The handle is closed before the event. | `device_vanishing_from_enumeration_ends_session_as_removed`, `disconnect_and_reconnect_are_published_as_events` | Unverified | Row 4; add a detection-latency figure to diagnostics |
| 4 | Automatic reconnect | Removed devices reopen with no backoff; the OS notification wakes the supervisor | `unplug_then_replug_reconnects_without_duplicates`, `device_change_notification_connects_without_waiting_for_poll` | Unverified | Row 5 |
| 5 | **Different HID path or handle after re-plug** | Sessions are keyed by interface path. A new path is treated as a new device, and the old session closes when its path disappears or its read fails. If the new path appears **while the old session is still alive** and both report the same serial, the new one is `DuplicateIgnored` until the old one ends. The session-end wake-up then retries it. | **Not covered** | Unverified | **Add tests:** path change with the same serial; path change with an empty serial (Windows often reports no USB serial for a DualSense) |
| 6 | Repeated cycles | Per-device bookkeeping is forgotten on removal | One re-plug cycle only | Unverified | **Add a soak test:** 200 alternating-path cycles, checking session count, events, joined threads and no handle leaks in the mock |
| 7 | No duplicates or stale streams | Dedup by path and by serial. Each reader thread owns its handle and stops before the end is announced. | Partly | Unverified | **Add a test:** reports queued on a removed session never reach the state of the new session (generation check) |
| 8 | Stable ~250 Hz | `RateCounter` (1 s window) plus sequence-gap counter and pipeline latency | Rate and gaps counted | ~250 Hz observed | **Add interval statistics:** min, avg and max report interval, gaps over 8 ms and over 50 ms since connect, shown on Performance and in the diagnostics report. Acceptance: 245–255 Hz, 0 parse errors, 0 sequence gaps over a 10 min soak. |
| 9 | Clean shutdown and restart | `Engine::shutdown` stops readers and joins threads (idempotent); Tauri calls it on exit and before an update install | `shutdown_releases_devices_and_is_idempotent`, `shutdown_joins_threads_and_closes_handles` | Unverified | Row 21 |

Other findings:

- **Bluetooth text.** The UI, docs and `NO_DRIVER_REASON` still mention Bluetooth. Bluetooth is now permanently out of scope. **Proposal:** remove Bluetooth from all user-facing text and the checklist, and keep the existing tested Bluetooth parser code dormant. Removing it is the alternative; this is decision **D3** below.
- **USB access mode.** NEXUS does not open the DualSense exclusively, so Steam or DS4Windows can read it at the same time. That matters for duplicate input; see section 3.

## 2. MZ Titan back paddles

### What the code shows

1. **Only two USB IDs are opened.** NEXUS opens VID `054C` with PID `0CE6` (DualSense) or `0DF2` (DualSense Edge), and only the *Generic Desktop / Gamepad* collection (`dualsense/src/identify.rs`).
   - If the Titan board added its own HID interface with a different usage (keyboard, consumer or vendor page), NEXUS would never read it.
   - If that interface used a different vendor ID, it would not even appear in *Settings → HID Devices*.
2. **The parser ignores bits 3–7 of the third button byte** (`report.rs::decode_buttons` reads only PS, touchpad and mute). On a **DualSense Edge**, that byte is where the Fn buttons and back paddles are reported, according to public reverse-engineering such as SDL's HIDAPI driver. So today **even a genuine Edge's paddles are dropped**.
3. **Unparsed bytes of the 64-byte USB report** (reserved and vendor areas) are not decoded either. They are recorded in full in the raw-report history, so they can be compared.
4. **Mapped-button mode is indistinguishable by design.** If the Titan maps a paddle to Cross, the report says "Cross". NEXUS will **never** label that as a paddle.

### What is unknown

ModdedZone's public material says the MZ Titan chip lets you assign any function to any button, including back paddles with "dual-input" support. It does not say whether an "independent" paddle produces any distinct data on a PC, or where. ([ModdedZone MZ Titan OS](https://moddedzone.com/pages/mz-titan-os), [Mod Squad product page](https://modsquad.com.au/titan-dualsense-modded-ps5-controller/))

Plausible outcomes, to be settled by capture:

| Outcome | What NEXUS would do |
|---|---|
| A. Paddle sets unused bits in the standard report (e.g. Edge-style bits, or a reserved byte) | Full native support (section 4) |
| B. The controller re-enumerates as a DualSense Edge (PID `0DF2`) in that mode | Decode Edge paddles; full support |
| C. Paddle appears on an extra HID interface of the same USB device | Read that interface too (still user-mode HID; no driver) |
| D. Nothing on the PC changes in independent mode (paddle data stays inside the controller or only reaches a console) | Not possible through HID. Document it. Only mapped mode works. |

### Diagnostic tool to build first: **Report Inspector**

This is a read-only diagnostic, added under *Settings → Diagnostics*. It changes no behaviour:

- **Record baseline (2 s, hands off) → Record "press X" (2 s)**. It lists every byte and bit that changed, excluding sticks, triggers, motion, timestamps and counters, which it learns from the baseline noise.
- **Interfaces** lists *every* HID interface of the connected USB device (same USB parent or container ID): VID, PID, usage page, usage and report lengths. This includes interfaces NEXUS doesn't open.
- **Export capture** saves a JSON file you can send me. Serials are masked, as in the current diagnostics report.

### Physical test procedure (MZ Titan, USB)

Do each step with nothing else pressed, then export the capture.

| # | MZ Titan configuration | Action | Record |
|---|---|---|---|
| T1 | Any | Settings → Diagnostics → Report Inspector → **Interfaces** | All interfaces listed (VID/PID/usage) |
| T2 | Paddles mapped to Cross / Circle | Baseline, then press left paddle, then right paddle, then Cross | Expect identical changes for left paddle and Cross (bit 0x20 of byte 8) |
| T3 | Paddles set to **independent / native** mode | Baseline, then press left paddle | Changed bits, or "nothing changed" |
| T4 | Native mode | Right paddle | Same |
| T5 | Native mode | Both paddles | Same |
| T6 | Native mode | Unplug and re-plug, then repeat T1 | Does the PID or the interface list change in this mode? |
| T7 | Native mode | Hold left paddle 10 s | Bit stays set, no flicker |
| T8 | Native mode | Cross, Square, PS, touchpad, mute | Normal buttons unaffected |
| T9 | Any | Windows *Set up USB game controllers* (`joy.cpl`) → Properties, press paddles | Does Windows show extra buttons? (independent of NEXUS) |
| T10 | Any | Export captures T2–T8 | Attach to the issue or send to me |

Support is claimed only for the outcome the captures prove, and only after T3–T8 pass on the real controller.

## 3. Virtual controller technology comparison

| Option | Xbox 360 / XInput | DualShock 4 | Windows 11 | Maintenance and signing | Licence and redistribution | Install and consent | Steam and games | Fits the one-backend interface |
|---|---|---|---|---|---|---|---|---|
| **ViGEmBus 1.22** (Nefarius) | Yes | Yes (incl. extended report: touchpad, motion) | Works | **Archived Nov 2023, no updates**; existing build is Microsoft-signed | BSD-3; we will **not** bundle it | User installs the official installer (UAC, admin) | Widely used (DS4Windows etc.). Some anti-cheat systems are reported to refuse virtual pads (**untested by us**). | Yes |
| **Nefarius VirtualPad** (ViGEm successor) | Reportedly yes | Reportedly yes | Reportedly yes | Maintained (commercial) | **Commercial licence**; availability and terms not public | Vendor-defined | Unknown | Yes, behind the same trait |
| **Windows InputInjector gamepad** (`InjectGamepadInput`) | Feeds `Windows.Gaming.Input`; **XInput visibility unconfirmed** | No | Yes, no driver | Microsoft API | Needs the restricted `inputInjectionBrokered` capability: MSIX packaging and Store or enterprise approval | None | Unknown, likely limited | Partly (Xbox only) |
| **vJoy** | No (DirectInput only) | No | Community forks | Uncertain | MIT | Driver install | Poor for modern games | No |
| **Custom UMDF / VHF driver** | Possible | Possible | Possible | We would own the signing | — | — | — | **Excluded by the rules** (custom driver) |
| **Steam Input** (user-side) | Steam's own virtual pad | — | Yes | Valve | — | None | Steam games only | Not controllable by NEXUS |

Sources:

- [vigembusdriver.com](https://vigembusdriver.com/)
- [Coda: "What is ViGEmBus, and is it still safe to use? (2026)"](https://coda-apps.com/guides/what-is-vigembus)
- [Nefarius downloads](https://docs.nefarius.at/Downloads/)
- [Microsoft: InputInjector.InjectGamepadInput](https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.preview.injection.inputinjector.injectgamepadinput?view=winrt-26100)
- [Microsoft: input injection capability](https://learn.microsoft.com/en-us/windows/uwp/design/input/input-injection)

See also the Milestone 1 evaluation in [`virtual-driver-evaluation.md`](virtual-driver-evaluation.md).

**Conclusion.** No currently maintained, freely redistributable, signed Windows driver offers both Xbox 360 and DS4 output.

**Recommendation.** Implement **ViGEmBus as an experimental, opt-in backend**. This matches the Milestone 1 approval: never bundled, never silently installed, retired status shown in the UI. Keep `VirtualControllerBackend` as the replaceable seam, so VirtualPad (if a licence is obtained) or another driver can replace it without touching the engine or UI. ViGEmBus is not presented as the production default. The UI calls it "Experimental driver (retired upstream)".

**Duplicate input.** Games that read the DualSense directly (Steam Input, games with native PlayStation support) will see both the physical pad and the virtual one. Hiding the physical device requires a filter driver such as Nefarius HidHide, which is a separate install. Until that is approved, NEXUS will:

- warn when virtual output is on and Steam is running;
- explain the duplicate-input situation in plain language;
- offer "Disable Steam Input for this game" guidance.

NEXUS will never claim a game works until it has been tested.

## 4. Recommended architecture

```
DualSense USB ──► dualsense parser ──► ControllerState (+ paddles, if proven) ──► ConfiguredProcessor
                     └─ raw extra bits kept for Report Inspector             (remap, layers, gyro, touchpad)
                                                                                     │
                                                                              MacroRunner
                                                                                     │
                                                    VirtualOutputManager ──► VirtualControllerBackend
                                                    (one device per physical      ├─ UnavailableBackend (default)
                                                     controller; switch = full    └─ ViGEmBackend (Windows, opt-in,
                                                     disconnect then connect)         user-installed driver)
```

- **Paddles.** Add `Button::PaddleLeft` and `Button::PaddleRight`, plus `Buttons.paddle_left` and `Buttons.paddle_right`, and per-device `capabilities.paddles: Detected | NotDetected`.
  - The capability becomes **Detected** only when a decoder proven by capture sees a paddle bit. A remapped Cross never sets it.
  - Remap, layers and macro triggers already work on `Button`, so paddles flow through them unchanged.
  - Profiles store JSON (`settings_json`), and the new enum variants are additive, so **no database migration is needed**. Older profiles still load. A test will prove it.
- **Virtual output.** Xbox 360 and DS4 have no paddle buttons. A paddle reaches a game only through a mapping to an existing button (default: unassigned).
  - DS4 output carries touchpad and motion through the extended report, if the driver interface supports it. This will be checked in the driver API before it is claimed.
  - Xbox 360 output has no touchpad or motion, so gyro-to-stick (already implemented) is used instead.
- **ViGEm access.** Use the pure-Rust `vigem-client` crate (MIT). It talks to the bus driver directly, with no DLL to ship. It is Windows-only and isolated in `virtual-controller/src/vigem.rs`. If DS4 extended reports aren't exposed there, the documented driver IOCTL will be wrapped in that same file.
- **Lifecycle.**
  - Connect when a physical controller session starts and output is enabled.
  - Update on every processed report (no allocation).
  - Switching type means disconnect, confirm, then connect.
  - Unplug or shutdown means disconnect and wait for the driver to confirm.
  - A driver failure turns output **off** with a visible error; it never retries silently forever.

## 5. Files and modules to change

| Stage | Files |
|---|---|
| S1 USB reliability | `crates/device-manager/src/{tracker.rs,manager.rs,mock.rs}` (tests, interval stats); `crates/telemetry/src/lib.rs` (interval statistics); `crates/engine/src/{lib.rs,tests.rs}` (stats in status, soak test); `apps/desktop/src/pages/Performance.tsx`, `lib/diagnostics.ts`; Bluetooth text in `virtual-controller/src/lib.rs`, UI pages, docs, `tests/hardware-verification.md` |
| S2 Report Inspector | `crates/device-manager/src/windows.rs` (list sibling interfaces, read-only); `crates/engine/src/lib.rs` (capture command); new `crates/engine/src/inspector.rs` (bit-diff, pure, tested); `apps/desktop/src-tauri/src/commands.rs`; new `apps/desktop/src/components/ReportInspector.tsx`; `pages/Settings.tsx` |
| S3 Paddles (after captures) | `crates/controller-core/src/{button.rs,state.rs}`; `crates/dualsense/src/report.rs` (+ Edge bits); `crates/input-processing` (button lists); `crates/macro-engine` (trigger list); UI button pickers, Live view, input monitor |
| S4 Virtual output | new `crates/virtual-controller/src/vigem.rs`; `drivers.rs` (driver detection, already present); `lib.rs` (backend selection); `crates/engine/src/lib.rs` (switch and cleanup); `apps/desktop/src/pages/Controller.tsx` → Virtual Output tab (consent, install guide, status); docs `virtual-output.md` |
| S5 Integration | Tests across the above; `tests/hardware-verification.md` (new USB, paddle and virtual-output rows); Windows CI build |

## 6. Risks and required hardware tests

| Risk | Mitigation |
|---|---|
| MZ Titan independent mode exposes nothing to a PC (outcome D) | Documented honestly; mapped mode still works; no driver or firmware workaround |
| A Titan bit coincides with a different meaning on other DualSense revisions | Decoder enabled only for the exact proven layout and device; capability shown only after a paddle bit is actually seen |
| ViGEmBus is retired, so a future Windows update could break it | Opt-in, clearly labelled; replaceable backend; output failure falls back to off with an error |
| Anti-cheat refusing virtual pads | No compatibility claims without a test; per-game notes |
| Duplicate input (physical + virtual) | Warning and guidance; HidHide only with separate approval |
| Driver install needs admin | Only the user runs the official installer; NEXUS itself stays non-admin |
| Regression in existing features | Full Rust and frontend suites plus a Windows CI build after every stage |

**Hardware tests required** (to be added to `tests/hardware-verification.md`):

- USB rows 1–5, 21, plus a new 10-minute soak (rate, gaps, parse errors) and 20 rapid re-plugs;
- MZ Titan T1–T10;
- virtual output, once the driver is installed by the user:
  - Xbox 360 visible in `joy.cpl`, and in the browser Gamepad tester;
  - DS4 visible likewise;
  - switching 10× leaves no leftover devices;
  - unplug removes the virtual pad;
  - app exit removes it;
  - mapping and macro reach it;
  - one named game per output type.

## Decisions requested

- **D1.** Approve stages **S1** (USB reliability tests and interval stats) and **S2** (Report Inspector). Both are safe: no drivers and no behaviour change.
- **D2.** Re-confirm **ViGEmBus as an experimental, opt-in, user-installed backend** for S4, implemented with the `vigem-client` crate.
- **D3.** Bluetooth: hide it from all user-facing text and keep the dormant parser code (recommended), or remove the code.
- **D4.** HidHide for duplicate-input suppression: out of scope for now (recommended), or evaluate it in S4.
