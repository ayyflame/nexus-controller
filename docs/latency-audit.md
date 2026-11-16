# Latency Audit: Baseline, Findings and Optimization Plan

**Status:** report only. No code has been changed. Every optimization below waits for approval.

**Scope:**

- the DualSense over USB → NEXUS → virtual Xbox 360 controller (ViGEmBus) → game path;
- macros and legitimate latency reduction only.

**Constraints:**

- no Bluetooth;
- no kernel driver;
- no anti-cheat bypass, game-process access or detection evasion;
- no unrelated features.

Every number in this report is labelled **measured** (with where), **estimated** (with the basis), or **pending hardware** (you measure it on Windows). This audit ran in a Linux container with a mock HID backend and a mock virtual controller. It contains **no Windows or USB measurements**.

## 1. The input path today

```
DualSense ──USB interrupt IN, ~4 ms (250 Hz)──► Windows HID stack ──► overlapped ReadFile completes
   │
   ▼  reader thread "nexus-hid-N" (one per controller, normal priority, event wait — no polling)
parse report → [raw history + rate/interval counters + rumble check] → processing (remap, curves, layers)
   → macro runner → to_xusb → ViGEmBus update (IOCTL) → [UI snapshot under lock] → next ReadFile
   │                                                     │
   ▼                                                     ▼
(optional) one output report (lightbar/rumble), up to 1 s wait     game reads XInput once per frame
```

- A macro is evaluated on **every report**: its output is recalculated from the physical state, so a release takes effect on the next report.
- Between reports, a playing macro is advanced only on an idle tick (read timeout).
- The UI never runs on the reader thread. A separate bridge thread copies a snapshot at 60 Hz.

## 2. Baseline measurements

### Measured (Linux container, 4 vCPU, release build, mock HID and mock virtual controller)

| Stage | p50 | p99 | p99.9 | max | Note |
|---|---|---|---|---|---|
| Parse DualSense USB report | 65 ns | 121 ns | 230 ns | 37 µs | 200,000 iterations |
| Processing (remap, sticks, triggers, layers, gyro, touchpad) | 160 ns | 290 ns | 786 ns | 59 µs | default settings |
| Macro runner (Repeat While Held playing) | 62 ns | 130 ns | 216 ns | 45 µs | |
| Translate to Xbox 360 report | 61 ns | 109 ns | 201 ns | 38 µs | |
| **All four stages** | **346 ns** | **620 ns** | **4.6 µs** | **60 µs** | the max values are OS preemption, not code |
| **Whole reader-thread loop per report** (mock read, telemetry, macro, virtual submit, UI snapshot) | **1.3–1.6 µs average** | | | | 200,000 reports, 4 runs |
| Engine "pipeline" timer (processing + macro + virtual submit), 256-report window | 0 µs | 0–1 µs | | 2–491 µs | outliers occur with **and** without UI load |
| Same with an aggressive UI poller (status + raw reports at about 2,000 Hz, ~30× the real 60 Hz) | 0 µs | 1 µs | | 4–482 µs | **no measurable UI contention** |
| Trigger report → first macro press | **0 extra reports** | | | | the macro presses in the same report that saw the trigger |
| Trigger release → macro output neutral | **0 extra reports** | | | | existing automated test, report by report |

### Estimated (not measured; basis given)

| Stage | Estimate | Basis |
|---|---|---|
| DualSense report interval | 4 ms (≈2 ms average wait for the next sample) | your diagnostics: ~250 Hz |
| Windows HID stack to ReadFile completion | ~0.1–0.5 ms | typical HID class-driver behaviour; unmeasured |
| ViGEmBus update IOCTL | ~20–100 µs | synchronous device I/O; unmeasured. It **is** included in the Performance page "NEXUS processing time" on Windows |
| Game reading XInput | 0 – one frame (≈8 ms average at 60 fps, ≈2 ms at 240 fps) | the game polls once per frame; outside NEXUS's control |
| Reader-thread wake-up delay under CPU load | usually < 0.1 ms; tails of 1–15 ms possible | normal-priority thread competing with a game on a busy CPU |

### Pending hardware (please measure; steps in §6)

- Performance page values on Windows: report rate, time between reports (min/avg/max), late counts over 8 and 50 ms, and NEXUS processing time (p50/p99/max).
- CPU use of NEXUS idle and with a game running.

## 3. Findings

| # | Finding | Effect on latency | Severity |
|---|---|---|---|
| F1 | NEXUS's own processing is about 1 µs per report, under 0.05 % of the 4 ms report interval | Negligible today | — |
| F2 | The dominant latencies are outside NEXUS: the controller's 4 ms report interval and the game's per-frame XInput read | Can't be reduced by NEXUS under the constraints (a higher USB poll rate needs a kernel filter driver, which is excluded) | Context |
| F3 | The reader thread runs at **normal priority**. The measured 0.5 ms outliers appeared with no UI load, so they are scheduler preemption. On Windows with a game loading the CPU, wake-up delays can reach several ms | **Main jitter risk** (tails, not average) | High |
| F4 | The optional output write (lightbar or vibration) runs on the reader thread and may wait **up to 1 s**. It's normally about 1–2 ms and rare (only when lighting changes or a vibration starts or stops), but a stalled write would freeze input for up to 1 s | Rare worst-case stall | Medium |
| F5 | Before the virtual report is sent, each report does: a lock plus 2 heap allocations for the raw-report history, a lock for the vibration request, and rate/interval counters | Adds a few hundred ns and lock interactions ahead of the output | Low |
| F6 | After the send, the UI snapshot is updated under a lock that the 60 Hz UI bridge also takes. No contention was measurable even at 30× the real UI rate | None measured | Low |
| F7 | The UI bridge serialises and emits status at 60 Hz even while the window is minimised | CPU use while gaming, not input latency | Low |
| F8 | Macro steps advance on reports, so step boundaries are quantised to the ~4 ms report interval. The first press is in the same report as the trigger | ≤ 4 ms timing granularity; below one game frame | Accept |
| F9 | Every report is sent to ViGEmBus even when unchanged (250 updates/s) | Small CPU cost; also keeps the virtual pad fresh after driver hiccups | Accept |
| F10 | User settings that **add** lag by design: gyro smoothing (exponential filter; default 0.3, only when gyro is on, estimated ≈ 3 ms time constant at 250 Hz). Deadzones, curves and remaps add no delay | Optional, user-controlled | Document |
| F11 | No unnecessary queues: one report is processed per read, in order, on one thread. No report is dropped or coalesced, which macro edges and recording depend on | Good | — |

## 4. Prioritised optimization plan (for approval)

| Priority | Change | Expected effect | Risk to reliability / stuck buttons | Verification |
|---|---|---|---|---|
| **P1** | **Measure on Windows first** (no code): §6 steps L1–L6 | A real baseline to compare against | None | Your numbers recorded in the checklist |
| **P2** | **Reader-thread scheduling:** raise each controller reader thread to `THREAD_PRIORITY_HIGHEST` and register it with Windows MMCSS ("Games" task, `AvSetMmThreadCharacteristicsW`; user-mode, no admin). Fall back silently if unavailable | Smaller wake-up delays under CPU load (lower p99/max, more consistent timing). No change to the average | Low: the thread always blocks in an event wait, so it can't spin. No change to input logic | New tests that the priority setup never fails startup. Compare L3/L5 before and after with a game running |
| **P3** | **Bound the output write wait:** 1 s → about 25 ms on the reader thread. A cancelled write stays pending and is retried on the next iteration (vibration *stop* is always retried until sent) | Removes the rare up-to-1 s input stall | Medium if done wrong (a lost vibration-stop would leave rumble on), hence the retry rule and tests | Mock tests: slow write never delays the next report; vibration stop always delivered. Hardware: V-rows plus lightbar and vibration checks 46 and 48 |
| **P4** | **Send first, bookkeep after:** move raw history, rate counters, the vibration check and the UI snapshot after the virtual submit | Output leaves a few hundred ns earlier; diagnostics unchanged | Very low: same work, different order | Existing macro and output tests unchanged; ordering test |
| **P5** | **No per-report allocations or locks before output:** the raw history stores fixed-size arrays (no heap), and the vibration request uses an atomic generation check before taking its lock | Fewer allocator and lock interactions, so less jitter | Low | Allocation-free unit test; diagnostics output unchanged |
| **P6** | **Quiet UI while minimised:** pause the 60 Hz status events while the window is hidden or minimised; send one immediately when shown | Less CPU while gaming | Low: the UI is stale only while invisible | UI test plus a manual minimise/restore check |

**Not recommended:**

- dropping or coalescing reports (breaks macro trigger edges and recording);
- skipping unchanged ViGEmBus updates (tiny gain, stale-state risk);
- busy-polling or spin-waiting (CPU cost, no gain over event waits);
- a separate timer thread for sub-report macro steps (complexity and new stuck-button paths for ≤ 4 ms);
- USB poll-rate overclocking (needs a kernel filter driver; excluded).

**Honest expectation:**

- **Average:** NEXUS already adds about 1 µs of processing (Windows driver costs unmeasured). End-to-end latency is dominated by the 4 ms controller report interval and the game's frame rate. P2–P6 won't change the average noticeably.
- **Consistency:** they target consistency: fewer multi-ms tails under load, and no rare stalls.

## 5. Settings that affect latency (user guidance, no code)

- **Gyro smoothing:** adds intentional lag (default 0.3 ≈ 3 ms when gyro is on). Set it to 0 if responsiveness matters more than steadiness.
- **Unaffected settings:** deadzones, curves, remaps, layers and macros add no measurable delay.
- **USB connection:** plug the DualSense directly into a PC USB port (not a hub or front-panel extension) with a data cable.
- **Windows:** keep NEXUS running at normal priority (no third-party "priority booster" tools). Close the Raw HID Reports auto-refresh while playing.

## 6. Hardware measurement steps (P1)

Record these in [`tests/hardware-verification.md`](../tests/hardware-verification.md) under the latency rows. They aren't pass/fail; they form the baseline.

| Row | Steps | Record |
|---|---|---|
| L1 | NEXUS running, controller connected, output on, no game. After 2 minutes open **Performance** | Report rate; time between reports min/avg/max; late over 8 ms and over 50 ms; NEXUS processing time p50/p99/max |
| L2 | Same, while holding a Repeat While Held macro for 30 s | Same values |
| L3 | Start a demanding single-player game, play 5 minutes with the macro in use, Alt+Tab to NEXUS **Performance** | Same values (shows behaviour under CPU load) |
| L4 | Task Manager › Details › `nexus-desktop.exe` | CPU % with NEXUS minimised and idle, and during L3 |
| L5 | During L3 | Late over 8 ms and over 50 ms since connect |
| L6 | Settings › HID Devices › **Copy diagnostics report** after L3 | Send the file |
