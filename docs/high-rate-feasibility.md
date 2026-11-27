# High-rate controller output: feasibility (up to 8000 Hz)

Question: can NEXUS offer an adjustable controller output rate up to
8000 Hz (0.125 ms), like an "up to 8000 Hz" claim?

Status: investigation only. No product code changed, no rate setting added.

## Short answer

- **The controllers are the limit.** A stock DualSense or DualShock 4 sends
  250 reports per second over USB (4 ms). A DualSense Edge is reported to
  send 1000 per second over USB. NEXUS cannot make a controller report
  faster.
- **A higher output rate does not create new input.** ViGEmBus ignores a
  frame identical to the last one. We measured 16,000 unchanged frames at
  8000 Hz: XInput's packet number did not advance once. Sending at 8000 Hz
  from a 250 Hz controller would give a game exactly what it gets today.
- **ViGEmBus can carry 8000 distinct updates per second, but only just.**
  On the test machine, XInput showed 7999 distinct updates per second. Each
  synchronous driver call takes 84 µs median and 162 µs p95, against a
  125 µs budget, and 9.5 % of deadlines were missed.
- **The NEXUS engine as built:**
  - sustains about 2000 reports per second;
  - is marginal at 4000;
  - cannot sustain 8000. It falls behind by about 1 ms and its stale-report
    skip drops 27 % of the reports.

  The cost is almost entirely the synchronous ViGEmBus call; mapping and
  macros take about 2 µs.
- **Recommendation:**
  - Do not add a polling-rate or output-rate setting. With the supported
    controllers it would be a fake setting.
  - Keep output event-driven: one frame per controller report, at the
    controller's own rate. NEXUS does this today, and it already carries a
    DualSense Edge's 1000 Hz with room to spare.
  - No architectural change is needed for any supported controller.

## Pipeline and the limit at each stage

| Stage | How it works today | Limit found | Bottleneck for 8000 Hz? |
|---|---|---|---|
| 1. Controller → USB | Interrupt IN endpoint, polled by the host | DualSense / DS4: 250 Hz (4 ms). DualSense Edge: reportedly 1000 Hz over USB. | **Yes, the hard limit.** Faster needs a third-party USB polling filter driver (excluded) and firmware that produces new data faster (unproven). |
| 2. Windows HID → NEXUS read | Overlapped `ReadFile`, one report per read. The reader thread sleeps until a report arrives (no timer, no polling). | Wake-up 15–19 µs p50 (stand-in device). The Windows HID buffer is 32 reports by default; NEXUS does not change it. That is 128 ms at 250 Hz but only 4 ms at 8000 Hz. | No |
| 3. NEXUS processing | Parse, mapping, macros, then the output call, synchronously on the same thread. Bookkeeping comes after the call. | Mapping 1.1–1.7 µs, macros 0.4–0.5 µs (p50). | No |
| 4. ViGEmBus submit | `vigem-client` `update`: `DeviceIoControl(IOCTL_XUSB_SUBMIT_REPORT)`, then waits for completion. Synchronous; one call per frame; unchanged frames are still sent. | 84 µs p50, 162 µs p95, 243 µs p99 alone; about 145 µs p50 inside the engine at 4000–8000 Hz. An unchanged frame costs 2–3 µs and is ignored. | **Yes, for NEXUS's own throughput** (one call per report, serial) |
| 5. XInput | xusb22 holds the latest state; a game calls `XInputGetState` whenever it likes. | It reflected every distinct update up to 8000/s; call returned → XInput shows: 0 µs. | No (but see below) |
| 6. Game | Reads XInput at its own pace, usually once per rendered frame (for example 60–240 times per second). | The game's own read rate | **Yes, for what a player can feel.** Updates between two reads are never seen. |

"How often NEXUS can call the driver" (stage 4) and "how often the state can
be seen through XInput" (stage 5) were measured separately. Neither is a
"game input rate": that is set by stages 1 and 6.

## Measurements

The tests behind these numbers:

- `crates/virtual-controller/tests/xinput_rate_sweep.rs` (ViGEmBus alone);
- `crates/engine/tests/pipeline_timing.rs`, `input_rate_sweep_through_nexus`
  (the whole engine).

The "XInput loopback check" workflow runs both.

Conditions:

- **Machine:** GitHub `windows-11-arm`, a 4-processor virtual machine with
  ViGEmBus 1.22.0, release builds.
- **Input:** simulated. Every update is tagged in the two analog triggers,
  and no buttons are pressed (repeated button presses freeze XInput on this
  VM; see `input-timing.md`).
- **Not tested:** a physical controller, a desktop PC or a game.
- **Run:** `XInput loopback check` run 45309083063 on `feature/core-expansion`.

### ViGEmBus alone (sender paced by deadline, no NEXUS engine)

| Rate | Achieved | Deadline misses | Driver call p50 / p95 / p99 (µs) | Submit → XInput p50 / p99 (µs) | Distinct updates in XInput | Never visible |
|---|---|---|---|---|---|---|
| 125 | 125/s | 0 | 99 / 155 / 350 | 30 / 79 | 126/s | 0 |
| 250 | 250/s | 0 | 90 / 123 / 144 | 25 / 41 | 251/s | 1 of 500 |
| 500 | 500/s | 0 | 88 / 124 / 157 | 25 / 41 | 501/s | 0 |
| 1000 | 1000/s | 0 | 85 / 119 / 146 | 24 / 48 | 1001/s | 0 |
| 2000 | 2000/s | 0.12 % | 96 / 163 / 291 | 26 / 79 | 2001/s | 0 |
| 4000 | 4000/s | 0.44 % | 83 / 130 / 189 | 23 / 57 | 4001/s | 1 of 8000 |
| 8000 | 7999/s | **9.5 %** | 84 / 162 / 243 | 26 / 82 | 7999/s | 3 of 16000 |
| 8000, all cores busy | 8000/s | 6.9 % | 78 / 151 / 219 | 34 / 82 | 7997/s | 6 of 16000 |
| 8000, unchanged frames | 8000/s | 1.6 % | **2.1** / 3.6 / 15 | — | **packet advanced 0 times after the first** | — |

How to read these numbers:

- **Time in the driver call:** 73.5 % of wall time at 8000 Hz, which is most
  of one core's time.
- **CPU time:** the kernel time reported by `GetThreadTimes` is sampled on
  the system clock tick (15.6 ms), so per-update CPU figures at low rates
  are not reliable. At 8000 Hz it showed about 26 % of a core in the kernel.
  The rest of the call is waiting for the driver to complete.
- **The measuring reader** polled XInput every 1.6 µs (p50), well below the
  125 µs period, so it could resolve every update.

### NEXUS engine end to end (stand-in device → engine → ViGEmBus → XInput)

| Input rate | Report → XInput p50 / p95 / p99 (µs) | Processing p50 / p99 (µs) | Busy (mean processing × rate) | Reads already queued | Stale reports skipped | Distinct updates in XInput |
|---|---|---|---|---|---|---|
| 125 | 50 / 70 / 96 | 98 / 180 | 1 % of a core | 1 of 250 | 0 | 126/s |
| 250 | 46 / 58 / 72 | 90 / 134 | 2 % | 0 of 500 | 0 | 251/s |
| 500 | 45 / 62 / 95 | 87 / 122 | 4 % | 0 of 1000 | 0 | 501/s |
| 1000 | 43 / 57 / 95 | 124 / 298 | 12 % | 3 of 2000 | 0 | 1001/s |
| 1000, all cores busy | 51 / 77 / 106 | 116 / 311 | 11 % | 14 of 2000 | 0 | 1001/s |
| 2000 | 43 / 68 / 104 | 51 / 173 | 17 % | 193 of 4000 (longest run 12) | 0 | 2001/s |
| 4000 | 46 / **402 / 860** | 146 / 434 | 62 % | 7858 of 8000 | 80 (1 %) | 3960/s |
| 8000 | **977 / 2721 / 3380** | 150 / 466 | **135 %** | 11838 of 16000 | **4202 (27 %)** | 5862/s |
| 8000, all cores busy | 769 / 2395 / 3253 | 130 / 422 | 120 % | 12513 of 16000 | 3444 (22 %) | 6255/s |

How to read these numbers:

- **Repeated frames:** none were sent in any run.
- **Driver errors:** none in either test.
- **Split at 8000 Hz:**
  - read → driver call returned: 146 µs p50;
  - call returned → XInput: 0 µs;
  - report → NEXUS read: 1013 µs p50. That is queueing: NEXUS is behind.

  The stale-report skip (catch up to the newest report after falling 8 ms
  behind) keeps the delay bounded instead of letting it grow.
- **Run-to-run variation:** on this virtual machine the driver call varies
  between runs (48–150 µs p50). Inside the engine at high rates it was
  slower than alone (about 145 µs against 84 µs). Treat about 2000 Hz as
  "sustained" here and 4000 Hz as "marginal", not as exact limits.

## Which rates are real

| Rate | Status |
|---|---|
| 250 Hz | **Real today.** A stock DualSense or DualShock 4 over USB; NEXUS forwards every report (p50 about 46 µs). |
| 1000 Hz | **Real if the controller produces it.** A DualSense Edge over USB is reported to (SDL). NEXUS already carries 1000 Hz with no backlog. Not verified on a physical Edge. |
| 2000 Hz | Carried by NEXUS and the driver in simulation. No supported controller sends it over stock USB. |
| 4000 Hz | Marginal in NEXUS (backlog builds, p95 400 µs); fine through ViGEmBus alone. No source. |
| 8000 Hz | ViGEmBus alone: barely (9.5 % missed deadlines, most of a core). NEXUS as built: **not sustainable** (27 % dropped, 1–3 ms behind). No supported controller, so **theoretical only**. |

"Up to 8000 Hz" output from a 250 Hz or 1000 Hz controller can only repeat
frames, which the driver ignores, or invent frames between real ones, which
adds no information and would delay or distort input. Neither is acceptable.

## Is an architectural change needed?

**Not for any controller NEXUS supports.** At 250–1000 Hz the engine uses
1–12 % of a core and adds about 45 µs.

If a real source above about 2000 Hz ever appears, the change would be:

1. **Decouple output from input with a latest-value mailbox.**
   - The reader thread parses, maps and stores the newest frame.
   - An output thread submits the newest frame whenever the previous call
     has returned.
   - Effect: no queue growth; at most one call (about 0.1 ms) of delay; the
     output rate adapts to the driver's real capacity.
   - Risks: macro timing and feedback ordering must stay on one clock; it
     needs its own tests.
2. **Skip unchanged frames.** Cheap anyway (2 µs, ignored by the driver).
   Keep the existing keep-alive re-send, which recovers a frame the driver
   missed.
3. **Do not move to asynchronous IOCTLs or another bus driver** without
   new measurements showing the need. `vigem-client` 0.1.4 waits for each
   submit; changing that means custom driver-protocol code.
4. **The HID input buffer:** only relevant above 1000 Hz (32 reports is
   4 ms at 8000 Hz), via `HidD_SetNumInputBuffers`.

## Safest approach (recommended)

1. **Keep the current design:** event-driven, one frame per report, no
   timer, ViGEmBus.
2. **Show the measured rate, don't set one.** The app's diagnostics already
   show the controller's measured report intervals ("Input flow" on the
   Performance page). A DualSense Edge user would see 1 ms there if their
   controller really reports at 1000 Hz.
3. **No output-rate or polling-rate setting.** Revisit only with a real
   input source above 1000 Hz, measured on physical hardware, and then use
   approach 1 above.
4. **Hardware checks still needed** (not done; no hardware here):
   - a physical DualSense, DualShock 4 and, if available, a DualSense Edge
     on USB;
   - their report intervals and report → XInput latency on a desktop PC,
     using the procedure in `tests/hardware-verification.md` IT1–IT4.

## Sources

Code read for the controllers' report rates:

- **Linux `hid-playstation.c`:** "Default to 4ms poll interval, which is
  same as USB (not adjustable)" (DualShock 4).
- **SDL `SDL_hidapi_ps5.c`:**
  - "Standard DualSense sensor update rate is 250 Hz over USB";
  - "DualSense Edge sensor update rate is 1000 Hz over USB";
  - "Bluetooth sensor update rate appears to be 1000 Hz".
- **SDL `SDL_hidapi_ps4.c`:** sensor rate = `1000 / report_interval`.

Web sources:

- [SDL: allow 1 kHz sample rate for DualSense Edge over USB](https://discourse.libsdl.org/t/sdl-allow-1-khz-sample-rate-for-dualsense-edge-over-usb/60373)
- [usb_oc-dkms](https://github.com/p0358/usb_oc-dkms) and [its DualSense discussion](https://github.com/p0358/usb_oc-dkms/discussions/1): polling overclock through a kernel module; the descriptor's interval
- [dsremap: DualSense reverse engineering](https://dsremap.readthedocs.io/en/latest/reverse.html)
- [Fedora discussion: DualSense descriptor](https://discussion.fedoraproject.org/t/playstation-5-dualsense-controller-only-acting-as-a-mouse-via-its-touchpad/126984)
- [Nobara issue 64](https://gitlab.com/GloriousEggroll/nobara-images/-/issues/64)
- [HLPlanet: controller overclocking](https://www.hlplanet.com/?p=1928)
- [VGChartz forum: DualSense update rate](https://gamrconnect.vgchartz.com/post.php?id=9272200)
- [DS4Windows low-latency guide](https://testmygamepad.pages.dev/guides/performance/tools/ds4windows-low-latency-guide)
- [Yahoo Tech: overclocking a PS5 controller's polling rate](https://tech.yahoo.com/general/articles/overclock-ps5-controller-polling-rate-152508142.html)
- [r/GyroGaming: worse results after overclocking a PS5 controller](https://red.bismuth.it/r/GyroGaming/comments/1g59cio/worse_results_when_i_overclock_my_ps5_controller)
- [dev.to: controller polling rate test](https://dev.to/nasirazizawan/controller-polling-rate-test-check-your-ps5xbox-hz-usb-vs-bluetooth-4fp3)
