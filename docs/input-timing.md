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

### Measured (the code as it is; the input path was not changed)

Two runs on the same kind of machine, 1,500 reports per row, values in µs. **A shared virtual machine adds its own pauses**, so the spread between runs is the VM, not NEXUS: compare the rows within a run.

**Run 45112008412** (all scenarios clean):

| Scenario | Report → XInput, mean / p50 / p95 / p99 / max | XInput update spacing, p50 / p95 / p99 / max | Never visible |
|---|---|---|---|
| ViGEmBus alone, idle | 32 / 30 / 51 / 91 / 717 | 4,000 / 4,021 / 4,062 / 5,093 | 0 |
| ViGEmBus alone, all cores busy | 49 / 47 / 70 / 98 / 226 | 4,000 / 4,022 / 4,046 / 13,968 | 0 |
| B default, idle | 53 / 52 / 67 / 87 / 296 | 4,000 / 4,016 / 4,030 / 4,450 | 0 |
| C mappings, idle | 51 / 51 / 63 / 70 / 102 | 4,000 / 4,015 / 4,025 / 4,043 | 0 |
| D macro playing, idle | 146 / 55 / 1,124 / 1,414 / 2,166 | 4,000 / 5,069 / 5,361 / 6,119 | 0 |
| B default, all cores busy | 122 / 55 / 926 / 1,273 / 2,090 | 3,999 / 4,877 / 5,222 / 6,034 | 0 |
| C mappings, all cores busy | 82 / 59 / 124 / 1,032 / 2,114 | 3,997 / 4,068 / 4,967 / 6,049 | 0 |
| D macro playing, all cores busy | 118 / 60 / 879 / 1,287 / 1,552 | 3,999 / 4,827 / 5,229 / 5,490 | 0 |

**Run 45112880794** (with every core busy): B 74 / 72 / 102 / 142 / 478; C 81 / 78 / 111 / 161 / 514; D 71 / 71 / 92 / 105 / 138. Spacing p99 about 4.04 ms, 0 missing.

**Where the time goes**, per report (run 45113820263, C mappings, idle; the cleanest pass of that run):

| Stage | mean / p50 / p95 / p99 / max |
|---|---|
| Report pushed → NEXUS's read returns (thread wake-up) | 17 / 16 / 24 / 34 / 95 |
| Read returned → ViGEmBus call returned (all of NEXUS, then the driver call) | 72 / 72 / 103 / 163 / 401 |
| Call returned → XInput shows it | 0 / 0 / 0 / 0 / 147 |
| **Total, report → XInput** | **42 / 41 / 62 / 85 / 237** |

XInput already has the new state when the driver call returns: the output stage has no timer or queue. With every core busy, the reader thread still wakes in 8–9 µs at the median (one step above normal priority, ahead of the busy normal-priority threads).

Inside that, NEXUS's own work (engine statistics, p50 / p99):

| Stage | p50 / p99 |
|---|---|
| Parsing and hand-over | 0.3–0.6 µs / 0.7–1.0 µs |
| Mapping | 1.2–2.9 µs / 2.7–12.6 µs |
| Macros | 0.4–0.9 µs / 0.8–1.6 µs |
| ViGEmBus call | 38–106 µs / 110–440 µs |

The 1–2 ms outliers in some rows (p95 / p99) come from the machine: they appear in the thread wake-up and in the driver call, and in "ViGEmBus alone" too. They also appear with every core busy, with or without macros.

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

### An anomaly of the CI machine, reproduced without NEXUS

In several runs, about 2 s after A started being pressed every 60 ms, XInput switched to an all-zero state. It stopped changing, also in later steps and in a new process with a new virtual controller. Throughout:
- NEXUS's frames were correct (checked against what it sent);
- ViGEmBus accepted every update without error;
- the controller stayed in its XInput slot.

**It also happened with ViGEmBus alone, without NEXUS's engine** (run 45113483612). After 508 updates of the same A-press pattern, XInput stopped following: 79.6 % of updates never visible, and 100 % in the next phase with no buttons pressed.

The foreground window was a Windows UI that accepts controller input: Windows Search (`SearchHost.exe`), or in another run Microsoft Edge. So it's how Windows on that machine treats repeated A presses while one of its own controller-aware apps is in front, not NEXUS. It doesn't match the reported symptom (input dead, not choppy).

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
   - **Check:** set NEXUS's stick deadzone to 0 (*Sticks*) or Warzone's to its minimum, and compare.
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

Record the results in `tests/hardware-verification.md` (*IT1–IT4*).

## 6. New diagnostics (Performance page)

- **Average and 95th percentile** for NEXUS processing time and every stage, beside the median, 99th percentile and maximum.
- **Input flow** over the last ~1 s:
  - time between reports, and time between frames sent to the virtual controller, each average / median / 95th / 99th / max;
  - reports already waiting when read (NEXUS was behind), and the most in a row;
  - repeated frames.

All are recorded on the reader thread without allocating (`crates/telemetry` `FlowStats`). The read wait comes from the reader loop (`SessionHandler::on_read_wait`).
