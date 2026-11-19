# Virtual controller driver calls: stalls, risks and the contingency design

The `xinput-loopback` CI job found that a ViGEmBus driver call can occasionally take tens to hundreds of milliseconds on a starved GitHub runner (see [performance.md](performance.md)). This page records what that means for NEXUS as it is built today, what was changed, and the design to use **only if** real PCs show the same problem.

## How the output path works today

Each DualSense has one reader thread. For every input report it does:

```
read report (HID, 100 ms timeout) → parse → mapping → macros → ViGEmBus update() → bookkeeping → optional DualSense output write (1 s timeout)
```

`ViGEmBackend::update` calls `vigem_client::Xbox360Wired::update`, which sends `IOCTL_XUSB_SUBMIT_REPORT` with `DeviceIoControl` and then waits with `GetOverlappedResult(…, bWait = TRUE)`. **That wait has no timeout.** ViGEmBus normally completes this request at once (it copies the report and returns), which is why the measured median is 0.07–0.3 ms. But if the call is slow, the reader thread waits for it.

## What a slow call does (analysed from the code, and simulated in tests)

| Effect | Short stall (< ~128 ms) | Long stall (> ~128 ms) | Call never returns |
|---|---|---|---|
| Input to the game | Delayed by the stall. Windows' HID driver queues the reports (32 by default, about 128 ms at 250 Hz); NEXUS then processes every queued report in order, each with its own driver call, so it catches up within a few ms | As short, but reports older than the 32 queued are dropped by Windows (counted as *Dropped reports* via the sequence counter) | The game keeps the last state that reached the driver. If a button was held, it **stays held** until NEXUS exits |
| Macros | Steps due during the stall run late (timing is taken when the report is processed); nothing is skipped | Same | Frozen |
| Fail-safes (unplug, unreadable reports) | Act after the call returns | Same | Never act |
| UI | Unaffected: the UI reads a snapshot, and no lock is held during the driver call | Same | The device shows stale values; the Performance page stops updating for that controller |
| DualSense lightbar/vibration writes | Delayed | Delayed | Never sent |
| Output mode changes, profile switches | Applied after the call returns | Same | Never applied |
| Quitting NEXUS | Normal | Normal | **Before this milestone: the exit could hang**, because shutdown waited for the reader thread. Fixed, see below |

Simulated evidence (mock driver, `crates/engine/src/tests.rs`):

- `a_slow_driver_call_delays_reports_but_none_is_lost_and_each_is_counted`: with 60 ms per call, four reports sent during the stall all reach the virtual controller, in order, and the slow calls are counted.
- `a_hung_driver_call_does_not_keep_nexus_from_exiting`: with a call that does not return, shutdown gives up after its timeout (150 ms in the test) instead of hanging. When the call returns after all, the reader still sends a neutral frame and removes the virtual controller.

These are simulations of the driver's timing, not measurements of ViGEmBus on a gaming PC.

## What changed in this milestone (no threading rewrite)

1. **Exit can't hang on the driver.** `Engine::shutdown_within(timeout)` stops every reader. It returns `false` if a reader is still inside a driver call after `timeout` (the app uses 2 s), and the app then exits anyway. When the process ends, Windows closes the ViGEmBus connection and ViGEmBus removes the virtual controller, so nothing stays held in the game after NEXUS has closed.
2. **The app releases controllers explicitly on exit.** Before, NEXUS exited without stopping the engine and relied entirely on Windows closing handles. Now quitting (tray *Quit*, closing the window when *close to tray* is off, or a Windows shutdown that lets the app exit) stops macros, sends a neutral frame and unplugs the virtual controller first.
3. **Slow calls are counted for the whole connection.** The Performance page's *Slow driver calls* row shows how many calls took 4 ms or longer (longer than one USB report interval), how many took 50 ms or longer, and the longest. The p50/p99/max row only covers the last 256 calls (about one second), so a rare spike could be missed; this counter cannot. It costs one comparison per report and allocates nothing.

## Can the current design tolerate slow calls?

- **Occasional calls of a few ms: yes.** The next report is processed a few ms late and nothing is lost.
- **Rare stalls up to ~128 ms: yes, with visible lag.** Nothing is lost, but the game gets the queued input in a burst after the stall.
- **Longer stalls: degraded.** Windows drops the oldest queued reports, and NEXUS counts them.
- **A call that never returns: not tolerated.** A held button stays held in the game until NEXUS quits. Quitting now always works. No evidence exists that ViGEmBus 1.22 does this on a normal PC; the CI stalls all ended by themselves.

**Decision:** keep the driver call on the reader thread for now. Moving it to another thread adds a thread hand-off (wake-up latency, typically 10–50 µs but more under load) to *every* frame in order to protect against a problem that hasn't been seen on a real PC. The CF3 hardware check decides this.

## When to implement the contingency

Implement the design below if any of these show up on a real PC during normal play (CF3 in `tests/hardware-verification.md`):

- *Slow driver calls* shows **any** call over 50 ms, or
- more than about **1 call in 10,000 over 4 ms**, or
- the driver call p99 is above **1 ms**, or
- Output Check shows a difference that stays while the controller is held still.

## Contingency design: latest-frame handoff

Goal: the reader thread never waits for the driver. It keeps reading, processing, running macros and fail-safes at full rate while a slow driver call is in progress.

```
reader thread (per controller)                     output thread (per controller)
read → parse → mapping → macros ─┐                 ┌─ wait on condvar (or 100 ms timeout → keep-alive)
                                 ├─► Mailbox ──────┤
         commands (mode, release)┘  (1 slot)       └─ take frame → backend.update() → record timing
```

**Mailbox.** `Mutex<Slot>` + `Condvar`, where `Slot { frame: ControllerState, seq: u64, pressed_since_taken: u32, command: Option<Command> }`. The reader writes the newest frame and notifies; the output thread takes whatever is newest. One slot means a slow call can never build up a queue of stale frames: after a stall the game gets the **current** state immediately, not a replay. The mutex is held only to copy about 100 bytes, never during the driver call.

**No lost taps.** Coalescing to the latest frame could hide a tap that starts and ends during one stall. The reader therefore ORs every newly pressed button into `pressed_since_taken`. When the output thread takes the slot and a button in that mask is released in the newest frame, it first sends one frame with the button pressed, then the newest frame. The game sees every tap at least once and in the right order. Analog values are not merged; the latest value wins.

**Release always wins.** Neutral frames (fail-safe, macro stop, unplug) and `release` are *commands*, not frames. They are never coalesced away, and the output thread runs them before any later frame. `Shutdown` is a command too. The output thread sends neutral, unplugs and exits, and the reader joins it with a timeout (as `shutdown_within` does now).

**Ownership.** `VirtualOutputManager` (and so the ViGEmBus handle) moves entirely to the output thread, so the backend still needs no locking. `set_mode`, `keep_alive` and the retry/recreate logic run there unchanged. Status, events and `player_index` come back to the reader through a small `Mutex<OutputStatus>`, read when it changes (a generation counter, like the existing `output_generation`).

**Keep-alive.** The output thread's condvar wait uses the same 100 ms idle timeout; on timeout it calls `keep_alive()`, as the reader's idle tick does today.

**Timing and telemetry.** The output stage is then timed on the output thread. A new *hand-off* stage (frame written → driver call started) shows the cost of the thread switch. The *Slow driver calls* counter stays.

**Priority.** The output thread gets the same raised priority as the reader (`raise_current_thread_priority`).

**Tests to write with it:** a tap during a 60 ms stall is delivered; a release during a stall is delivered and nothing stays held; a fail-safe neutral frame is never overtaken by an older frame; shutdown with a hung driver call returns within its timeout; 0 allocations per report on the reader (the hot-path test); and the hot-path benchmark for the extra hand-off cost.

**Cost to accept:** one extra wake-up per frame (measure it; if the hand-off p99 exceeds about 100 µs, reconsider), one extra thread per controller, and more complex shutdown ordering.

## Not changed

- The 100 ms HID read timeout and the 1 s DualSense output write timeout.
- `vigem-client` itself. A timed wait instead of `GetOverlappedResult(…, TRUE)` would need `CancelIoEx` and a re-sent report, inside a third-party crate, for a stall not yet seen on real hardware.
