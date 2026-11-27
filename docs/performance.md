# Input performance

How long NEXUS takes from a DualSense report to the virtual Xbox 360 controller, how it's measured, and what was found. For NEXUS's effect on the game's own frame rate (the window's rendering, device scans), see [performance-investigation.md](performance-investigation.md). For input timing through the real driver to XInput, see [input-timing.md](input-timing.md).

## What NEXUS measures (Performance page)

| Measurement | Where |
|---|---|
| Report rate, time between reports, reports later than 8 ms / 50 ms | Performance, Live Viewer › Health |
| Dropped reports (from the controller's sequence counter, an estimate) | Performance |
| Unreadable reports | Performance |
| NEXUS processing time per report (*Total: read → virtual controller*), average / median / 95th / 99th percentile / max | Performance › 2 |
| **The same time split by stage** (ns): report hand-over, mapping, macros, virtual controller driver call | Performance |
| **Slow driver calls** since the controller connected (over 4 ms, over 50 ms, longest) | Performance |
| **Stale reports skipped** after a slow call (only the newest queued report is processed) | Performance |
| **Whether Windows receives exactly what NEXUS sends** | Live Viewer › Output Check |
| End-to-end time, button press to game reaction | **Not measured**: NEXUS sees neither the press itself nor when the game reads the virtual controller. Performance › 4 says so |

Every value is measured on the controller's own reader thread with fixed-size buffers. Measuring adds four clock reads per report and allocates nothing. Values refresh every 64 reports (about 4 times a second).

## Benchmark: NEXUS's own processing

`cargo test --release -p nexus-engine hotpath_benchmark -- --ignored --nocapture` replays 200,000 reports through the real handler with a macro playing. Result on a Linux cloud machine (Intel Xeon 2.1 GHz, 4 vCPU), November 2026:

| Stage | p50 | p99 |
|---|---|---|
| HID report parse | 52 ns | 111 ns |
| Mapping (sticks, triggers, remap, layers, gyro, touchpad) | 135 ns | 144 ns |
| Macros | 60 ns | 78 ns |
| Virtual output call (test stand-in, not the real driver) | 106 ns | 110 ns |
| **Report → virtual controller** | **405 ns** | **681 ns** |

**0 heap allocations per report** (enforced by a test that always runs).

**Conclusion:** NEXUS's processing takes under a microsecond, about 0.01 % of the 4 ms between DualSense USB reports. There is no processing bottleneck, so no speed changes were made to the hot path.

## The real driver call (ViGEmBus)

The `xinput-loopback` CI job installs ViGEmBus on a GitHub Windows 11 (ARM64) runner, sends 500 updates in four ways, and reads them back through XInput. Three runs on the same code, November 2026:

| Run | Result | Per update p50 | p99 | max |
|---|---|---|---|---|
| 1 | failed | 107 µs – 1.2 ms | up to 161 ms | 556 ms |
| 2 | failed | 67 – 241 µs | up to 162 ms | 484 ms |
| 3 | passed (298 one-off updates, 0 lost) | 94 – 196 µs | 0.6 – 5.8 ms | 27 ms |

In both failed runs, after a burst of updates, XInput kept showing the pad as neutral for more than 2 seconds, despite keep-alive resends. The failures line up with the runner being starved (in run 2, one batch of 500 paced updates took 8.8 s instead of ~2 s).

**Conclusion:** on that shared cloud VM the driver call is usually 0.1–0.3 ms, but it can occasionally take tens to hundreds of milliseconds, and it ran on NEXUS's input thread. Whether a gaming PC ever does this can only be measured on real hardware, which is what the Performance page's *Virtual controller driver call* row and Live Viewer › Output Check are for. The output path was not restructured: moving the driver call to another thread would add delay to every normal frame, and there's no evidence yet that real PCs need it. What a slow call does, the safeguards added, and the design to use if real PCs need it are in [driver-performance.md](driver-performance.md).

## Rules

- No busy loops: the reader thread waits for reports (the 100 ms HID read timeout and the 1 s DualSense output write timeout are unchanged).
- No allocations, locks or frontend messages per report in the hot path; the UI receives a status snapshot about 60 times a second.
- Only change the hot path for speed when a measurement shows a real bottleneck.
