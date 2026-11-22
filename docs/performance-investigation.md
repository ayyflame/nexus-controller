# Warzone performance investigation (November 2026)

**Report:** with NEXUS running, Warzone itself lags (lower FPS, frame-time spikes, stutter), not only the controller.

**Status:** one cause in NEXUS was found and measured, and two smaller ones were found by reading the code. All three are fixed. **Whether these fixes cure the lag in Warzone is not yet known.** That needs the comparison in [section 5](#5-manual-warzone-comparison-six-scenarios) on the PC where the lag happens. No game was run for this investigation.

Labels used below:
- **Measured:** run in this investigation, with the tool and machine named.
- **Code:** found by reading the code; not measured.
- **Inference:** reasoning from a measurement to Windows, WebView2 or a GPU, which weren't available.

## 1. What NEXUS does while a game runs

| Work | How often (before) | Cost | Label |
|---|---|---|---|
| Controller reader: HID read, then mapping, macros, then ViGEmBus | Every report (≈250/s) | 405 ns p50 per report, no allocations (`docs/performance.md`); the thread blocks in the read, no busy waiting | Measured earlier |
| ViGEmBus update | Every report | One driver call per report; the driver ignores unchanged reports. Slow calls are counted on the Performance page | Code, `docs/driver-performance.md` |
| UI bridge: status snapshot and JSON for the window | **60/s whenever the window isn't minimised or hidden**, including while behind or beside the game | 6.7–7.8 µs per snapshot, 3.4 KB (≈0.4 ms CPU/s) | Measured (release build, Linux) |
| Window: React re-render, **3D controller redraw** (shadow pass, anti-aliasing, up to 2× pixel density), status-dot animation | Same 60/s, plus 60 animation frames/s while a controller is live | See section 2 | Measured (Chromium) |
| Device scan (safety net beside device notifications) | Every 5 s | Opened **every HID device in the PC** (mouse, keyboard, headset, RGB devices) and read three USB string descriptors from the DualSense each time | Code |
| Game watcher | Every 500 ms | Opened a handle to the foreground program (the game) every time; profile lookups in SQLite when automatic switching is on | Code |
| Update check scheduler | Every 5 s (a timer; it checks online at most once a day) | Negligible | Code |
| Logging, telemetry | In memory; disk writes only on user actions (backups, export) | Negligible | Code |
| Timer resolution, process priority, MMCSS | Not changed (no `timeBeginPeriod`; the reader thread is one step above normal; MMCSS only in a test) | None | Code |

## 2. Measurements: the window's rendering

**Method.**
- The production frontend build ran in headless Chromium (Playwright) on a 4-vCPU Linux cloud machine.
- The engine was simulated: a real status snapshot from the engine tests, with sticks and a trigger moving on every update.
- Measured over 8 s after the 3D model had fully loaded (15 s):
  - main-thread busy time (Chrome DevTools `Performance.getMetrics`);
  - style recalculations;
  - 3D frames (WebGL `clear` calls ÷ 2, since each frame clears for the shadow pass and the image);
  - total CPU of all browser processes (`/proc`).
- Each scenario used a fresh browser.

**Limits.** Chromium here renders WebGL in software (SwiftShader), so 3D cost shows up as CPU. On a gaming PC the same frames run on the GPU, alongside Warzone. The absolute numbers don't transfer to WebView2 on Windows; the counts of updates and frames do. Script: `uiperf.cjs` (kept outside the repository).

### Before: a game in front, NEXUS window open (visible, not focused)

| Page and controller picture | Status updates/s requested | Achieved | Main thread | All browser CPU | 3D frames/s |
|---|---|---|---|---|---|
| Dashboard, 3D (the default) | 60 | 3 (saturated) | 998 ms/s (100%) | 390% (all 4 cores) | 1.75, trying to draw 60 |
| Controller, 3D | 60 | 3 (saturated) | 999 ms/s | 390% | 2.15 |
| Dashboard, flat picture | 60 | 63 | 191 ms/s | 114% | — |
| Controller, flat picture | 60 | 63 | 256 ms/s | 152% | — |
| Performance page | 60 | 63 | 102 ms/s | 84% | — |
| Any page, controller live | — | — | 60 style recalculations/s from the looping status-dot animation alone | — | — |

With nothing streaming, the same pages idle at 1–3 ms/s main thread and under 1% CPU. **The work comes from the status stream and what it redraws.** Before the fix, only minimising the window or closing it to the tray stopped the stream.

**Inference.** On a gaming PC the 3D view redraws its scene up to 60 times a second on the GPU while the player moves the sticks. That is a second 3D application competing with Warzone for the GPU and CPU for as long as the NEXUS window is visible. With a second monitor, or a borderless game window over NEXUS, it is visible the whole session. This fits the report, but whether it is the cause on the affected PC is what section 5 tests.

### After (same method)

| Page and controller picture | Status updates/s | Main thread | All browser CPU | 3D frames/s |
|---|---|---|---|---|
| Dashboard, 3D | 4 | 19 ms/s | 3.3% | 0 |
| Controller, 3D | 4 | 34 ms/s | 5.1% | 0 |
| Dashboard, flat picture | 4 | 32 ms/s | 5.8% | — |
| Controller, flat picture | 4 | 42 ms/s | 6.6% | — |
| Performance page | 4 | 11 ms/s | 2.1% | — |

- **Focus regained:** the 3D view draws the current state at once (measured: 3 frames within 1.5 s of focus).
- **NEXUS focused:** unchanged, 60 updates/s with every change drawn.

## 3. Changes

| # | Change | Why | Files |
|---|---|---|---|
| 1 | While the NEXUS window is visible but not focused, status updates go to the window at most 4 times a second (250 ms). Focused: unchanged (every change, up to 60/s). Minimised or hidden: none, as before. Regaining focus sends the current status at once. The bridge loop wakes every 100 ms instead of 16 ms while hidden. | Section 2: all UI work scales with the update rate | `src-tauri/src/bridge.rs`, `src-tauri/src/lib.rs` (focus events) |
| 2 | While NEXUS isn't focused, the 3D controller view doesn't redraw for input changes; it draws the latest state when focus returns. Mapping marks and click handlers no longer change on every update, which had made the 3D library schedule extra redraws. | Section 2: the 3D redraw is the costliest item; with change 1 alone it still drew 4 frames/s | `components/controller3d/Controller3D.tsx`, `hooks/useWindowActive.ts` |
| 3 | Looping CSS animations (status dots, recording dot) pause while NEXUS isn't focused. | 60 style recalculations and repaints per second for decoration | `lib/windowActivity.ts`, `main.tsx`, `styles/global.css` |
| 4 | Device scan: interfaces whose path names another vendor (`VID_xxxx`) are no longer opened. A controller already read is not read again while it stays present; it is forgotten when unplugged. | Each 5 s scan opened every HID device in the PC and sent three USB string requests to the DualSense: periodic driver work outside NEXUS. Periodic HID enumeration is a known cause of in-game hitches (SDL moved its HIDAPI joystick code off periodic polling for this reason). Not measured here. | `device-manager/src/backend.rs` (`scan_present`, `vendor_id_in_path`), `device-manager/src/windows.rs` |
| 5 | Game watcher: the foreground window and its process ID are read twice a second (opens nothing). The program name is looked up, which opens a query-only handle, only when the window or process changes. | It opened a handle to the game twice a second (7,200 per hour) | `app-detect/src/lib.rs` (`ForegroundWatcher`), `src-tauri/src/game_watch.rs` |

**Not changed, on purpose:**
- **Input path, ViGEmBus output and output thread:** no measurement shows NEXUS's input path slowing the game, and the Performance page already counts slow driver calls.
- **Mappings, macros, USB-only support, neutral output and disconnect safeguards:** untouched.
- **Report rate:** NEXUS reads what the controller sends; it doesn't change the controller's polling.

## 4. What still needs Windows

- WebView2's real CPU and GPU cost per frame (section 2 measured Chromium with software rendering).
- Whether the 5 s device scan caused hitches on the affected PC (change 4 removes most of its work either way).
- DPC/ISR latency and USB behaviour with the DualSense and ViGEmBus. None of NEXUS's code runs in a driver; any DPC cost comes from the HID, USB and ViGEmBus drivers handling ≈250 reports a second.

## 5. Manual Warzone comparison (six scenarios)

Run on the PC where the lag happens, with the same Warzone settings, map or mode (a private match or the firing range is the most repeatable), and route for every run. Use the old build (before this change) and the new build in turn for scenarios B–F.

**Tools (all free):**
- **CapFrameX** or **PresentMon:** FPS, frame times, 1% and 0.1% lows. Record 90 s per run, starting at the same point.
- **Process Explorer** (Sysinternals): `nexus-desktop.exe` › Properties › Threads, for CPU per thread. Note the busiest threads. The `msedgewebview2.exe` processes NEXUS started are its window; note their CPU and *GPU* columns as well.
- **Task Manager › Performance:** total CPU and GPU (3D), and NEXUS's memory.
- **LatencyMon** (Resplendence): run *without* the game for 2 minutes per scenario. Note the highest DPC and ISR execution times and which driver (`HidUsb.sys`, `USBXHCI.sys`, `ViGEmBus.sys`, …).
- **NEXUS Performance page:**
  - report rate;
  - slow driver calls (over 4 ms, over 50 ms, longest);
  - stale reports skipped.

**Scenarios.** For each: three 90 s runs. In C–F put the NEXUS window where it normally is during play (behind the game, or on the second monitor), and note which.

| | Scenario | Setup |
|---|---|---|
| A | NEXUS closed | Quit NEXUS from the tray. Play with any controller that works without NEXUS (or none, mouse and keyboard). Baseline. |
| B | NEXUS open, no controller | NEXUS running, DualSense unplugged |
| C | Controller connected, macros disabled | DualSense on USB, *Send to games* on, every macro disabled |
| D | Normal processing | Your Warzone profile (mappings, curves, deadzones), macros disabled |
| E | Macros enabled | As D, with your macros enabled (use them as you normally would) |
| F | Trigger customization enabled | As E, with adaptive-trigger effects / trigger settings on |

Also run D twice more with the **new** build:
- **D-min:** NEXUS minimised to the tray;
- **D-3D:** NEXUS on a second monitor showing the Dashboard with the 3D view, without clicking it.

**Record per run:**

| Item | Where |
|---|---|
| Average FPS, 1% low, 0.1% low, frame-time spikes over 2× the median (count) | CapFrameX/PresentMon |
| NEXUS CPU % (total and busiest 3 threads), WebView2 CPU % and GPU % | Process Explorer |
| System CPU %, GPU 3D %, NEXUS memory | Task Manager |
| Highest DPC and ISR time and the driver responsible (separate 2-minute run) | LatencyMon |
| Report rate, slow driver calls, stale skips | NEXUS Performance page |
| Whether the lag was noticeable (yes/no), window placement, build | You |

**Reading the results:**
- **A ≈ B:** NEXUS idle doesn't hurt.
- **The lag starts at C:** the controller path or the window.
  - If WebView2's GPU or CPU is high in C–F with the old build and low with the new one, and FPS recovers, the window was the cause (changes 1–3).
  - If FPS stays low with the new build while WebView2 is idle, compare D-min. Lag even when minimised points at the input/output path or the drivers: look at LatencyMon's driver and the Performance page's slow calls.
- **The lag starts only at E or F:** macros or trigger effects. Report which, with the Performance page numbers.
- **Stutter every ≈5 s with the old build only:** the device scan (change 4).

Record the results in `tests/hardware-verification.md` (*WZ1–WZ3*) with the date and NEXUS commit.
