# Controller input timing: investigation (November 2026)

**Report:** Warzone itself runs fine with NEXUS, but controller input through NEXUS feels choppy, inconsistent or less responsive than the controller used directly.

**Result:**
- The full NEXUS path was measured through the real ViGEmBus driver and read back with Windows' XInput API, the interface games read.
- NEXUS adds about **10–30 µs**. Every report goes on to the game at the controller's own pace.
- No stage of NEXUS's input path was found to delay, drop, batch or bunch up input. So **the input path was not changed**.
- The measurements used **synthetic reports on a GitHub-hosted Windows machine**, not a physical controller or a game. Whether the symptom comes from something outside these measurements must be checked on the affected PC (section 5). Section 4 lists the candidates.

## 1. The path, stage by stage

| # | Stage | How it runs | Queue, wait or timer |
|---|---|---|---|
| 1 | Controller → USB → Windows HID | The controller sends a report about every 4 ms (DualSense and DualShock 4 over USB) | Windows' HID driver keeps up to 32 unread reports |
| 2 | HID read | One reader thread per controller (one step above normal priority). An overlapped read waits on an event until the next report arrives (100 ms timeout when nothing arrives) | No polling, no sleep; one report per read, in order |
| 3 | Parsing | On the reader thread, the moment the read returns (≈55 ns) | — |
| 4 | Normalised state | A value on the stack; no copy to another thread | — |
| 5 | Mapping (sticks, triggers, remaps, layers, gyro, touchpad), then macros | Same thread, immediately (≈2 µs, ≈1 µs) | Settings changes are picked up by an atomic check; no lock on this path |
| 6 | Xbox 360 frame | Translated from the processed state on the same thread | — |
| 7 | ViGEmBus | One synchronous driver call per report (`IOCTL_XUSB_SUBMIT_REPORT`), immediately | No coalescing, no timer, no separate output thread. NEXUS sends every frame, even when unchanged |
| 8 | Game | Windows' Xbox 360 driver gives the newest frame to XInput; the game reads it once per frame | Outside NEXUS |

Only **after** stage 7 does the reader thread do its bookkeeping:
- status for the UI, under a short lock;
- raw-report history;
- statistics.

The window's refresh rate (60/s focused, 4/s in the background) only changes how often the UI copies that status. It never waits on, or slows, the reader thread.

**Event-driven, not timer-driven.** A frame goes to the virtual controller when a report arrives. The 100 ms timer only matters when **no** report arrives: it re-sends the last frame (a keep-alive) and keeps macros timing.

**Stale-report skipping** only acts if NEXUS falls 8 ms behind, for example during a driver stall. It then sends the newest report instead of replaying old ones. In normal operation it never triggers: the measurements below show 0 skips except during machine-wide stalls on the CI VM.

## 2. Measurements through the real driver

**Machine:** GitHub `windows-11-arm` runner (a shared virtual machine) with ViGEmBus 1.22.0. **Input:** synthetic DualSense reports, one every 4 ms. **Measured by:** a separate thread polling `XInputGetState` and recording when each report's unique tag first appears. **Builds:** release, as the app.

**Tests:**
- `crates/virtual-controller/tests/xinput_streaming.rs`: ViGEmBus alone.
- `crates/engine/tests/pipeline_timing.rs`: the whole engine.

Both run in the *XInput loopback check* workflow.

**Scenarios:**
- **A:** the controller used without NEXUS. Not measurable here (needs the physical controller and the game; section 5).
- **ViGEmBus alone:** the driver with no NEXUS engine in front of it, the baseline for NEXUS's share.
- **B:** NEXUS, default settings.
- **C:** NEXUS with mappings (remaps, stick deadzone and curves, a shift layer).
- **D:** NEXUS with a rapid-fire macro playing.

Each ran idle, and with every CPU core busy as a stand-in for a game.

### Before any change (the code as it is; nothing was changed afterwards)

Representative clean run (run 45112008412). All values in µs except the last column; 1,500 reports per row.

| Scenario | Report → XInput, mean / p50 / p95 / p99 / max | XInput update spacing, p50 / p99 / max | Never visible |
|---|---|---|---|
| ViGEmBus alone, idle | 47 / 28 / 81 / 130 / 10,984 | 3,999 / 11,587 / 76,850 | 11 (0.7 %) |
| ViGEmBus alone, all cores busy | 48 / 47 / 66 / 80 / 154 | 4,000 / 4,042 / 4,304 | 0 |
| B, idle | 41 / 40 / 56 / 68 / 445 | 3,999 / 4,030 / 4,640 | 1 (0.1 %) |
| C, idle | 45 / 43 / 69 / 90 / 250 | 3,999 / 4,035 / 4,176 | 0 |
| D, idle | in this run 50–60 µs p50 | 4,000 / ~4,100 | 0 |
| B, all cores busy | 72 / 71 / 102 / 142 / 478 (run 45112880794) | 4,000 / 4,030 | 0 |
| C, all cores busy | 81 / 78 / 111 / 161 / 514 (run 45112880794) | 4,000 / 4,040 | 0 |
| D, all cores busy | 71 / 71 / 92 / 105 / 138 (run 45112880794) | 4,000 / 4,040 | 0 |

NEXUS's own processing, measured by the engine (p50 / p99):

| Stage | Measured |
|---|---|
| Whole report | 71–90 µs / 110–130 µs |
| Hand-over | 0.4 µs / 0.8 µs |
| Mapping | 1.7–2.9 µs / 2.7–4.1 µs |
| Macros | 0.4–0.9 µs / 0.8–1.4 µs |
| ViGEmBus call | 38–100 µs / 110–130 µs, most of the total |

The report-to-XInput time is about the driver call itself plus a few microseconds.

**What the numbers say:**
- **Timing:** NEXUS adds about 10–30 µs over the driver alone.
- **Spacing:** XInput sees a new frame every 4.0 ms, the spacing of the input; p99 is within 0.1 ms of it.
- **Nothing coalesced or batched:** in clean runs, at most 0.4 % of updates were never visible. Those coincide with stalls of the whole virtual machine (a driver call up to 274 ms, the sender itself delayed), not with NEXUS.
- **Mappings and macros:** they add no measurable delay, a few microseconds at most.
- **Load:** with every core busy, the median rises by about 30 µs and spacing stays at 4 ms.

### An anomaly specific to the CI machine (not reproduced consistently)

In 3 of 5 runs, partway into scenario D, XInput switched to an all-zero state and stopped changing for every later scenario. It even stayed that way in a new process with a new virtual controller.

Throughout, NEXUS's frames were correct (checked against what it sent), ViGEmBus accepted every update without error, and the controller stayed in its XInput slot. The same scenarios ran clean in the other runs. The A-press pattern sent without NEXUS also ran clean (2,500 updates, 1 not visible).

Because the state survives the process, the cause is in Windows on that machine (Microsoft Edge was in the foreground; it reads controllers itself). It doesn't match the reported symptom (input dead, not choppy) and was not seen in any engine-level measurement.

## 3. What was checked, and found fine

| Question | Finding |
|---|---|
| Reports processed immediately or batched? | Immediately, one per read, on the reader thread |
| Input loop blocking unnecessarily? | No. It blocks only in the read, waiting for the next report |
| Lock contention? | None on the path before the driver call. The UI's status lock is taken after the frame is sent, for a few µs |
| Mappings or macros adding delay? | 1–3 µs (measured) |
| Output synchronised or timer-driven? | Neither. One driver call per report, right after processing |
| ViGEmBus submission delayed? | 28–56 µs median from the call to XInput (measured) |
| Unchanged-frame suppression? | NEXUS doesn't suppress; the driver ignores repeats. A repeat also re-delivers a frame the driver missed. Repeated frames are now counted on the Performance page |
| Stale-report skipping dropping useful input? | It only triggers 8 ms behind. In clean runs it skipped 0 reports; it only showed up during VM-wide stalls |
| Virtual output rate consistent? | Yes, 4.0 ms ± 0.1 ms (p99) |
| Output stale after a new report? | No. Each report's frame is visible ~50 µs later, and the final state was always shown in clean runs |
| Tied to the UI refresh rate? | No. The reader thread never waits for the UI |

## 4. What wasn't measured, and could make input feel worse

These are outside NEXUS's timing path, and none is proven to be the cause:

1. **Double input.** Warzone supports PlayStation controllers natively. If it sees the physical DualSense/DualShock 4 **and** NEXUS's Xbox controller, both drive the game. The game may switch between them, apply its own settings to one and NEXUS's processing to the other, and change button prompts. That reads as inconsistent or unpredictable input.
   - **Check:** Windows *Game Controllers* (`joy.cpl`) should list only *Controller (XBOX 360 For Windows)* while playing.
   - **Fix:** turn off PlayStation controller support in Warzone and Steam, or hide the controller with HidHide (`docs/hidhide-setup.md`).
2. **Two deadzones and curves on top of each other.** NEXUS's default left and right stick deadzone is 5 % (radial, rescaled). Warzone then applies its own deadzone and response curve to the Xbox controller. Small aim movements need more travel than with the controller used directly.
   - **Check:** set NEXUS's stick deadzone to 0 (*Controller › Sticks*) or Warzone's to its minimum, and compare.
3. **Uneven reports from the controller.** Caused by the cable, a hub, USB power saving or other USB devices. It appears as uneven *Time between reports* on the Performance page, before NEXUS.
4. **The game's frame rate.** The game reads the controller once per frame.

## 5. Checking on the affected PC (A–D)

Use the same match type or the firing range, and the same movements, for each scenario. Leave NEXUS on **Performance** in the background for one minute of play, then read it.

| | Setup |
|---|---|
| A | NEXUS closed, the controller used directly by Warzone (its PlayStation controller support on). This is the feel to compare against |
| B | NEXUS, default settings, no macros. Warzone's PlayStation controller support **off**, or the controller hidden with HidHide |
| C | As B, with your mappings |
| D | As C, with your macros enabled |

**Record for B–D** (Performance page; each distribution is average / median / 95th / 99th / max):

| Row | Healthy |
|---|---|
| Time between reports | median ≈ 4.0 ms, 99th < 5 ms |
| Time between frames sent to the virtual controller | the same as the row above |
| NEXUS processing time | 99th < 1 ms |
| Virtual controller driver call | 99th < 1 ms; slow calls over 4 ms rare |
| Reports already waiting · most in a row | 0 · 0–1 |
| Stale reports skipped | 0 |
| Repeated frames | any value: frames identical to the one before, counted and sent anyway |

**Reading it:**
- **Reports already uneven:** the cause is before NEXUS (USB, cable, hub, power saving).
- **Frames less even than reports, or reports waiting:** NEXUS fell behind. Look at the driver call and slow calls: ViGEmBus or system load.
- **Everything healthy but the feel differs from A:** look at section 4 (double input, stacked deadzones).
- **B fine but C or D not:** that mapping or macro. Compare the processing time rows.

Record the results in `tests/hardware-verification.md` (*IT1–IT3*).

## 6. New diagnostics (Performance page)

- **Average and 95th percentile** for NEXUS processing time and every stage, beside the median, 99th percentile and maximum.
- **Input flow** over the last ~1 s:
  - time between reports, and time between frames sent to the virtual controller, each average / median / 95th / 99th / max;
  - reports already waiting when read (NEXUS was behind), and the most in a row;
  - repeated frames.

All are recorded on the reader thread without allocating (`crates/telemetry` `FlowStats`). The read wait comes from the reader loop (`SessionHandler::on_read_wait`).
