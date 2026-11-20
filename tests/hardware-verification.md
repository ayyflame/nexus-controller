# Hardware Verification Checklist

NEXUS supports the DualSense over **USB only**. Rows marked *Out of scope* concern Bluetooth and are no longer tested.

NEXUS is developed in a Linux container without access to Windows or a controller. Only the owner can fill in these results. Known so far (owner reports): USB input works, with 73,835 reports, 0 parse errors and about 250 Hz. Rows marked **Pass (owner, date)** were reported by the owner. Every other row is unverified until recorded here. Simulation and CI-machine results are never entered in this checklist.

**Current pass:** follow [`m4.5-test-plan.md`](m4.5-test-plan.md) for the testing order, exact steps and PASS/FAIL criteria. Record results in the *Result* column below (Pass or Fail, date, build).

### Status summary

| Status | Rows |
|---|---|
| Physically verified (owner) | V3, V4, V6, V7, V14 (build `711f0d4`; V14 game title pending); USB input in general |
| Re-check on build B `9d00fa2` | V6, V7 |
| Outstanding (M4.5 pass, build B) | 22, 24–27, 35, 36, 53–62, V1–V2 (optional), V5, V8–V13, V15–V21, D1–D10, T1–T10 |
| Outstanding (latency A/B) | L1–L6, on build A `b862b6a` and build B `9d00fa2` |
| Outstanding (later) | 1–5, 10–21 (1–5 and 21 are covered by 53–55, 58 and 61 when those are run), 28–34, 38–52 |
| Out of scope (Bluetooth) | 6–9, 23, 37 |

Setup steps: `docs/windows-setup.md`. Useful tools: **Settings → HID Devices (Sony)** (what Windows reports and how NEXUS classified it; **Copy diagnostics report**), **Raw HID Reports** (enable auto-refresh) and **Engine Log**.

## Discovery and connection

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Start NEXUS with no controller | "No controller"; no device in the event list | |
| 2 | Plug in by USB | Within ~1 s: *DualSense connected (USB)*; dashboard shows **Connected** | |
| 3 | Quit NEXUS, keep USB plugged, start NEXUS | Detected at launch | |
| 4 | Unplug USB | *Controller disconnected*; dashboard returns to "No controller" | |
| 5 | Re-plug USB 10× quickly | Each time exactly one connect; never two devices listed | |
| 6 | Pair via Bluetooth, connect | *connected (Bluetooth)*; report format shows **Bluetooth report 0x31** (not "basic") within a second | *Out of scope (Bluetooth)* |
| 7 | Turn the controller off (hold PS 10 s) while on Bluetooth | Disconnect detected (record how long it takes) | *Out of scope (Bluetooth)* |
| 8 | Turn back on | Automatic reconnect | *Out of scope (Bluetooth)* |
| 9 | Plug USB while connected over Bluetooth | Record behaviour: one controller listed, which transport? | *Out of scope (Bluetooth)* |
| 10 | With DS4Windows / Steam running | Note whether NEXUS can still open the device (exclusive access) | |
| 11 | With ViGEmBus + DS4Windows emulating a DS4 | Virtual DS4 is not listed; if a virtual DualSense exists, the log says "Ignored virtual" | |

## Input parsing (USB)

| # | Step | Expected | Result |
|---|---|---|---|
| 12 | Sticks at rest | LX/LY/RX/RY ≈ 0 (record actual resting values) | |
| 13 | Each stick to all 4 extremes | ±1.0, with **up = positive Y** | |
| 14 | L2/R2 full travel | 0 → 255; trigger glows when the digital bit sets | |
| 15 | Each face button, L1, R1, L3, R3, Create, Options, PS, mute, touchpad click | Only the matching element lights | |
| 16 | D-pad, all 8 directions | Correct direction, including diagonals | |
| 17 | One and two fingers on the touchpad | Points track the finger positions | |
| 18 | Battery while charging and unplugged | Plausible percentage and status | |
| 19 | Performance page | Record the report rate and the parse-error count (should stay 0) | |
| 20 | Save 5 raw USB reports (Settings › Raw HID Reports) | Attach to the repository as `tests/fixtures/` for regression tests | |

## Shutdown

| # | Step | Expected | Result |
|---|---|---|---|
| 21 | Close the window while connected | Process exits within 1 s; controller usable by other apps immediately | |

## Macro Studio (with the controller connected)

| # | Step | Expected | Result |
|---|---|---|---|
| 22 | Create Macro → Record → press Square, Triangle → Stop | Two actions with roughly your timing | |
| 23 | Repeat over Bluetooth | Same result | *Out of scope (Bluetooth)* |
| 24 | Assign R3, Play Once, save; press R3 | "Test with your controller" shows Square then Triangle; *Playing* badge | |
| 25 | Repeat While Held / Toggle | Repeats while held / until pressed again | |
| 26 | Unplug the controller while a Toggle macro plays | Macro stops; nothing stays pressed after reconnect | |
| 27 | Close NEXUS during recording, then reopen | App closes cleanly; saved macros still listed | |

## Controller settings and profiles (Milestone 2)

| # | Step | Expected | Result |
|---|---|---|---|
| 28 | Controller › Live: move each stick and trigger | "Your controller" and "Sent to the game" both move; deadzone circle visible | |
| 29 | Sticks: set deadzone 30%, move the stick slightly | Gold dot stays centred until past the circle | |
| 30 | Sticks: Precise curve, then Custom (drag a point) | Output follows the curve shown | |
| 31 | Triggers: deadzone 20%, Full press at 60% | Output 0 below 20%, 100% from 60% | |
| 32 | Buttons: Cross → Circle, Touchpad → Disabled | Live "Sent to the game" shows Circle; touchpad does nothing | |
| 33 | Profiles: create, rename, duplicate, switch, delete | Settings follow the profile; nothing from the old profile stays active | |
| 34 | Quit and reopen NEXUS | Last-used profile and its settings load | |
| 35 | Plug/unplug USB | Connect/disconnect appears instantly (Settings shows "Instant (Windows device notifications)") | |
| 36 | Macro Studio: start a Toggle macro, press **Stop all macros** | Playing stops immediately; holding the trigger does not restart it | |
| 37 | Repeat 28–32 and 36 over Bluetooth | Same results | *Out of scope (Bluetooth)* |

## Milestone 3 (USB)

| # | Step | Expected | Result |
|---|---|---|---|
| 38 | Controller › Sticks › Calibrate (both sticks) | Rest reads 0,0 afterwards; full circle reaches the edge | |
| 39 | Triggers › Calibrate; set Click point 20% | L2 counts as pressed at a light pull (Buttons tab lights) | |
| 40 | Gyro › Live motion: turn, tilt, roll | Correct bars move; record the sign of each | |
| 41 | Gyro on, While holding L2; turn right | Right stick moves right (else note: inverted) | |
| 42 | Gyro › Calibrate on a table | "Calibrated"; resting stick output stays at 0 | |
| 43 | Touchpad › Four zones; click each corner | Assigned button for each zone | |
| 44 | Touchpad swipes in each direction | Assigned button pulses once | |
| 45 | Buttons: layer on L1 (hold) mapping Square → D-pad Up | Holding L1 changes Square; L1 hidden | |
| 46 | Lighting: enable lightbar, change colour | Controller lightbar follows | |
| 47 | Player lights pattern | LEDs match | |
| 48 | Test vibration at 100% and 30% | Vibrates ~0.6 s, then stops; strength differs | |
| 49 | Profiles: add your game's .exe, enable auto-switch, launch the game | Profile switches within ~1 s; returns when you leave | |
| 50 | Export a profile, Import on another PC (or after deleting it) | Same settings restored | |
| 51 | Create backup, change things, Restore backup | Everything restored; safety backup in the data folder | |
| 52 | Two controllers, both by USB | Both listed; selector switches the view | |

## Milestone 4: USB reliability (Performance page and Settings → Copy diagnostics report)

The automated tests for these run against a simulated HID backend. They prove the logic, not the behaviour of Windows or the controller.

| # | Step | Expected | Result |
|---|---|---|---|
| 53 | Start NEXUS with the controller already plugged in | Connected within ~1 s | |
| 54 | Start NEXUS with nothing plugged in, then plug in | "No controller" first, then connected within ~1 s | |
| 55 | Unplug | Disconnected within ~1 s (note the time) | |
| 56 | Re-plug into the **same** port | One controller, input works | |
| 57 | Re-plug into a **different** USB port (Windows assigns a new device path) | One controller, input works, no duplicate in Settings → HID Devices | |
| 58 | Re-plug 20 times quickly (about 1 s apart) | Each time exactly one controller; engine log shows matching connect/disconnect counts; no errors | |
| 59 | 10-minute soak: leave connected, move sticks occasionally; open **Performance** | Rate 245–255 Hz; input errors 0; dropped reports 0; time between reports average ≈ 4.0 ms; late over 50 ms = 0. Record min/avg/max and late counts. | |
| 60 | During the soak, open and close other apps (browser, a game launcher) | Late-report counters stay low; record values | |
| 61 | Close NEXUS while connected, reopen | Exits within 1 s; reconnects on start; no "access denied" | |
| 62 | Copy diagnostics report after 59 | Attach it (includes report intervals and connection stats) | |

## Milestone 4: ModdedZone MZ Titan back paddles (Settings → Report Inspector)

Do every capture with the controller lying still, pressing only what the step says. Export after each configuration (**Export captures** saves to `Documents\NEXUS\Captures`) and send the files.

| # | MZ Titan configuration | Steps in NEXUS | Record |
|---|---|---|---|
| T1 | Any | **List interfaces** | Number of interfaces, their type (Gamepad / Vendor-defined / Keyboard…), VID:PID, declared buttons. Screenshot. |
| T2 | Paddles **mapped** to Cross / Circle | Record baseline. Choose *Left paddle* → Record while holding. Then *Right paddle*. Then *Cross (reference)*. | Expected: left paddle shows "Reported as Cross", identical to the Cross capture. Export. |
| T3 | Paddles set to **independent / native** mode (MZ Titan app) | Unplug, re-plug, **List interfaces** again | Did the interfaces, PID or declared buttons change? |
| T4 | Native mode | Record baseline, then *Left paddle* | Verdict and changed bytes, or "No change" |
| T5 | Native mode | *Right paddle* | Same |
| T6 | Native mode | *Both paddles* | Same; are the bits independent (left + right combined)? |
| T7 | Native mode | Repeat T4 twice more | Same byte and bit every time? |
| T8 | Native mode | Custom label "Cross while paddle held": hold left paddle **and** press Cross | Cross still reported normally |
| T9 | Native mode | Windows *Set up USB game controllers* (`joy.cpl`) → Properties; press paddles | Do extra button numbers light up? |
| T10 | — | **Export captures** for T2 and T4–T8 | Send the JSON files |

**Interpretation.** NEXUS will add Paddle Left and Paddle Right as inputs only if T4–T7 show consistent bits that NEXUS does not decode yet, or an extra interface from T1/T3 carries them. "Reported as Cross" means mapped mode, which already works as Cross. "No change" with no extra interface means the paddles are not visible to Windows in that mode. That would be documented, not worked around.

## Macro beta: experimental virtual Xbox 360 controller (USB)

Prerequisites:

- ViGEmBus 1.22 installed by you (`docs/virtual-output.md`);
- DualSense connected by USB;
- Controller › Virtual Output → **Use the experimental virtual controller** on, then **Xbox 360**.

Use Windows tools and offline or single-player games only.

Re-test V6–V12 on each new build that changes macro or output code. M4.5 changed: a held trigger now needs a fresh press after a profile switch; the virtual controller recovers by itself after a driver hiccup; "Check again" re-creates it after installing ViGEmBus.

| # | Step | Expected | Result |
|---|---|---|---|
| V1 | *(Optional: only after reinstalling ViGEmBus)* Virtual Output tab before installing ViGEmBus | "Not installed" with install steps; Xbox 360 cannot be selected while the switch is off | |
| V2 | *(Optional)* Install ViGEmBus, click **Check again** | "Installed and ready" | |
| V3 | Switch on, choose Xbox 360 | "Xbox 360 connected" | **Pass** (owner, 2026-11-16, build 711f0d4, CI run 43817242201) |
| V4 | `joy.cpl` (Win+R) | **Controller (XBOX 360 For Windows)** listed. Properties: buttons, sticks and triggers follow the DualSense (Cross = button 1 / A) | **Pass**: Windows recognises the virtual Xbox 360 controller (owner, 2026-11-16, build 711f0d4, CI run 43817242201) |
| V5 | Browser gamepad tester (e.g. a "gamepad tester" site) | An Xbox 360 controller shows input. Note whether the physical DualSense also appears (duplicate input) | |
| V6 | Macro Studio: Repeat While Held macro (e.g. Cross, hold 50 ms, wait 50 ms) on R3 or a mapped paddle; hold the trigger 5 s in `joy.cpl` Properties | Button 1 blinks repeatedly; the trigger itself never lights | **Pass**: repeats while held (owner, 2026-11-16, build 711f0d4, CI run 43817242201) |
| V7 | Release the trigger | Blinking stops at once; nothing stays lit | **Pass**: release stops the macro (owner, 2026-11-16, build 711f0d4, CI run 43817242201) |
| V8 | Tap the trigger quickly 20 times | No button stays lit afterwards; no extra repeats after release | |
| V9 | Hold the trigger, unplug USB | Virtual controller disappears from `joy.cpl`; on re-plug it returns with nothing pressed | |
| V10 | Hold the trigger, switch output to Disabled, then back to Xbox 360 | Removed, then re-created; nothing pressed | |
| V11 | Hold the trigger, close NEXUS | Virtual controller disappears; nothing stays pressed | |
| V12 | Turn the switch off | Virtual controller removed at once | |
| V13 | Steam running (Big Picture → Controller settings) | Record which controllers Steam lists, and whether input doubles | |
| V14 | One offline or single-player game you choose | Record the title, whether the game uses the Xbox controller, macro behaviour, and any double input | **Pass**: macro output works in an offline/single-player game; title to be recorded (owner, 2026-11-16, build 711f0d4, CI run 43817242201) |
| V15 | Two profiles with the same Repeat While Held macro. Hold the trigger, switch profile (Profiles page or game auto-switch) | Macro stops and does **not** restart while still held; releasing and pressing again starts it | |
| V16 | Two macros on different triggers (e.g. R3 and L3), hold both, then release one | Both repeat; releasing one stops only that one; nothing stays lit | |
| V17 | NEXUS running, output on: Device Manager › System devices › **Nefarius Virtual Gamepad Emulation Bus** › Disable device; watch Virtual Output; then Enable device and click **Check again** | While disabled: virtual controller shown as not connected, with a message (no crash or freeze). After Enable + **Check again**: **Xbox 360 connected** again, without re-plugging or restarting NEXUS | |
| V18 | Record a macro, then edit one action's press time and wait (Exact timing), save; hold its trigger with `joy.cpl` Properties open | Timing visibly follows the edit (e.g. 2× slower is clearly slower); no re-recording needed | |
| V19 | Select all actions, **2× faster**, save, test again; then Ctrl+Z | Faster playback; undo restores the recorded timing | |
| V20 | Record: tap Square, then Triangle quickly (Square released before Triangle) | Two separate actions, not one "Square + Triangle" action | |
| V21 | Build YY (Triangle, Triangle) with wait 0 ms and pause between repeats 0 ms | ⚠ on the wait and two warnings under the timeline. After setting both to 50 ms, warnings disappear and `joy.cpl` shows Y blinking in pairs while held | |

## Duplicate input, with and without HidHide (optional)

Virtual output must be on (Xbox 360). Run D1–D3 **before** installing HidHide. Steps are in `docs/hidhide-setup.md`. NEXUS never changes HidHide settings.

| # | Step | Expected | Result |
|---|---|---|---|
| D1 | No HidHide. `joy.cpl` | Record which controllers are listed (expected: DualSense **and** Xbox 360) | |
| D2 | No HidHide. Browser gamepad tester; press Cross once | Record whether both controllers register the press (double input) | |
| D3 | No HidHide. Steam running (Settings › Controller) | Record which controllers Steam lists and whether a press counts twice | |
| D4 | Install HidHide from the official release page; click **Check again** | Virtual Output shows HidHide **Installed**; NEXUS still works | |
| D5 | Configuration Client: add NEXUS (path copied from the Virtual Output tab) to Applications; tick the DualSense in Devices; enable hiding | NEXUS keeps showing the DualSense connected; macros still work | |
| D6 | Repeat D1–D3 | Only the Xbox 360 controller is visible; one press counts once | |
| D7 | Close NEXUS with hiding on; open `joy.cpl` | No controller listed (expected, documented) | |
| D8 | Remove NEXUS from Applications (hiding still on), restart NEXUS | NEXUS shows no controller **and** the hint "HidHide may be hiding it from NEXUS too"; adding NEXUS back restores it | |
| D9 | Plug the DualSense into a different USB port with hiding on | Record whether it stays hidden or needs ticking again | |
| D10 | Untick **Enable device hiding**, then uninstall HidHide | The DualSense is visible to games again; NEXUS keeps working | |

## Latency, before and after (no pass/fail; run each row on build A `b862b6a` and build B; see `docs/latency-audit.md` §6)

**Only real Windows PC + DualSense results go in this table.** The Linux simulation and the Windows CI virtual-machine probe (no USB controller) are reported in `docs/latency-audit.md` §7 and are not hardware results. Write each result as "A: … / B: …".

| # | Step | Record | Result |
|---|---|---|---|
| L1 | Controller connected, output on, no game; after 2 min open **Performance** | Report rate; time between reports min/avg/max; late > 8 ms and > 50 ms; NEXUS processing time p50/p99/max | |
| L2 | Same while holding a Repeat While Held macro for 30 s | Same values | |
| L3 | Open **Performance**, then play a demanding single-player game 5 min using the macro, windowed or borderless so the page stays visible. Read processing time **while still playing** (it covers only the last second). Fullscreen only: Alt+Tab and read within 1 s, and say so | Processing time p50/p99/max during play; then the other values | |
| L4 | Task Manager › Processes › **NEXUS** row (includes its WebView2 processes), controller sending input: (a) window visible on Dashboard, (b) window **minimised** (not just behind another window: P6 pauses the UI only when minimised) | CPU % for (a) and (b) on A and on B | |
| L5 | End of L3, before unplugging | Late > 8 ms and > 50 ms since connect; max time between reports (main evidence under load) | |
| L6 | **Copy diagnostics report** at the end of L3, with the game still running if possible | Send the file (B's file includes processing time; A's does not) | |

## Known limitations (current build)

| Area | Limitation |
|---|---|
| Connection | USB only. Bluetooth is out of scope. |
| Virtual controller | Experimental: ViGEmBus (retired upstream, user-installed, never bundled). Xbox 360 only; DualShock 4 not enabled. |
| Xbox 360 protocol | No touchpad, gyro, mute, adaptive triggers or haptics. Use touchpad zones and gyro-to-stick mappings instead. |
| Duplicate input | Without HidHide, the physical DualSense stays visible to games and Steam, and some may react to both controllers. Optional: HidHide set up by the user (`docs/hidhide-setup.md`), or turn off PlayStation controller support in the game or Steam. Rows D1–D10 not yet run. |
| Multiple controllers | Each physical controller gets its own virtual controller, but all share one profile, settings and macro set (per-controller settings are planned for M5). |
| MZ Titan paddles | Mapped mode works as the mapped button. Independent paddles are **not** supported; no capture evidence exists yet (T1–T10). |
| Driver installed while NEXUS runs | Click **Check again** on the Virtual Output tab. |
| Online games | Not tested and not targeted. Many online games prohibit macros. NEXUS does not try to avoid anti-cheat detection. |
| Installer | Not code-signed (personal use); SmartScreen shows a warning on first install. |

## Core functionality (November 2026): needs a real DualSense on Windows

Simulated and CI tests cover the logic; these confirm it on hardware.

| # | Check | Expected |
|---|---|---|
| CF1 | Virtual output on (Xbox 360), **Live Viewer › Output Check**, press every button, pull both triggers, move both sticks | Every row stays green; "Windows receives exactly what NEXUS sends" |
| CF2 | Same, with a game (e.g. Warzone) running in the background | Still green; no differences that stay while input is held still |
| CF3 | **Performance**, play for 30+ minutes | *Virtual controller driver call* p99 stays well under 1 ms; *Slow driver calls* shows 0 over 50 ms and almost none over 4 ms; report rate ~250 Hz; late reports over 50 ms stay at or near 0. Note any spikes: any call over 50 ms means the latest-frame handoff in `docs/driver-performance.md` should be built |
| CF4 | **Controller › Mapping › Button combinations**: L1 + R1 → Triangle, hide on | Holding L1+R1 gives Y in `joy.cpl`/Output Check, not LB/RB; releasing one doesn't flash LB/RB; L1 alone still gives LB |
| CF5 | Macro with **Hold to activate** 300 ms, each mode | A quick tap does nothing; holding fires it; releasing stops Repeat While Held at once |
| CF6 | Profiles › **Make default**, switch to another profile, restart NEXUS | NEXUS starts on the default profile |
| CF7 | Unplug the controller while a macro is running and a button is held | The virtual controller is removed; Output Check / `joy.cpl` show nothing stuck; reconnect resumes |

## Windows integration and stick mapping (November 2026): needs Windows, the DualSense for SM checks

The rules are unit-tested and the installer check runs in CI on a GitHub Windows machine; these confirm behaviour on a real PC.

| # | Check | Expected |
|---|---|---|
| WI1 | Close the window (default settings) while a game uses the controller | NEXUS stays in the tray; the game keeps the controller; clicking the tray icon brings the window back where it was |
| WI2 | Tray right-click › **Quit NEXUS** while holding a button / while a macro plays | NEXUS exits within ~2 s; `joy.cpl` shows the Xbox controller gone, nothing stuck in the game |
| WI3 | *Settings › Windows*: Close button → *Quit NEXUS*, close the window | NEXUS exits and releases the controller (as WI2) |
| WI4 | *Minimise → Hide to the tray*, minimise | No taskbar button; tray click restores it |
| WI5 | **Start with Windows** on, sign out and in | NEXUS starts in the tray (no window), the DualSense and virtual controller work without opening it |
| WI6 | Same with *When started with Windows → Open the window* | The window opens at sign-in |
| WI7 | Task Manager › Startup apps › NEXUS → Disabled, then open *Settings › Windows* | *Start with Windows* shows off with the Task Manager note; turning it on works at the next sign-in |
| WI8 | Start NEXUS from the Start menu while it already runs (hidden or not) | No second copy (Task Manager shows one `nexus-desktop.exe`); the existing window comes to the front |
| WI9 | Resize/move the window, go to Performance, quit and start again | Same size, position and page |
| WI10 | Uninstall from Windows Settings › Apps with Start with Windows on | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has no `NEXUS` value; `%APPDATA%\com.nexus.controllerengine` is still there |
| WI11 | Update to a newer build with Start with Windows on | Still starts with Windows afterwards; profiles kept |
| SM1 | *Controller › Sticks › Stick swap › Swap sticks*, move each stick in `joy.cpl` / Output Check | Left stick moves the right axes and the other way round, with the full range; L3/R3 unchanged |
| SM2 | Left stick deadzone 30 %, right 5 %, swapped | The left stick's drift is still hidden (its deadzone travels with it) |
| SM3 | Gyro on, sticks swapped | Gyro still aims with the game's right stick |
| SM4 | *Stick to buttons* on the left stick, *Use as d-pad*, analog off | Pushing the stick presses the d-pad in the game; the game's left stick stays centred |
| SM5 | Same, threshold 50 %, release margin 10 %: rest the stick near half travel and wobble it | No flicker of the d-pad button (Output Check / `joy.cpl`) |
| SM6 | 4 directions, roll the stick from up to right | Never both buttons at once; up releases before right presses |
| SM7 | *Also move the stick in games* on, Precise curve | The d-pad presses and the stick still moves with the curve applied |
| SM8 | Switch to a profile without stick mapping while a stick-button is held | The button releases at once; nothing stuck |
| DS1 | **Performance** during 30+ minutes of play | *Stale reports skipped after slow calls* stays at 0 (any skips mean NEXUS fell 8 ms or more behind, almost always because of slow driver calls: note when) |

## Release preparation (November 2026): needs Windows, a DualSense for RP1–RP3

| # | Check | Expected |
|---|---|---|
| RP1 | Fresh install, first start, follow the welcome guide and the Dashboard's **Get ready to play** checklist from nothing | Each step turns green in order; every failing step's advice is accurate (no ViGEmBus, output off, controller unplugged, a second Xbox controller holding player 1) |
| RP2 | Start Warzone (or any game) once, then *Profiles* › a profile › **Pick a recently used program** | The game's program is listed; picking it links it; switching happens when the game is in front |
| RP3 | *Profiles* › **Restore points**: restore yesterday's daily backup, then the *Saved before a restore* point | Profiles and macros go back each time; nothing is lost |
| RP4 | Install an update with the updater (once it is switched on), then *Restore points* › *Saved before updating* | The pre-update data restores |
| RP5 | *Settings* › **Copy diagnostics report**, paste into a text editor | No Windows account name, serial number, MAC address or profile/macro names appear |

## Release gate

No release (versioned or announced) until all of these are done on a real Windows 11 PC with a USB DualSense, and the results are recorded here with the date and NEXUS commit:

1. **CF1–CF3, CF7** (Output Check, with Warzone running, 30+ minutes of play on the Performance page, unplug with a held button and a running macro).
2. **DS1**: no stale skips and no slow driver calls over 50 ms during that play session. Any call over 50 ms means the output-thread design in `docs/driver-performance.md` is needed before a release.
3. **WI1, WI2, WI5, WI8, WI10** (close to tray during a game, Quit releases everything, start with Windows, single copy, uninstall cleanup).
4. **SM1, SM4, SM5** (stick swap, stick as d-pad, no flicker near the threshold), if those features are to be used.
5. A Warzone session with the profile you'll actually play: inputs respond normally, nothing stays pressed after alt-tab, after closing NEXUS to the tray, or after quitting it. NEXUS does not try to avoid anti-cheat; if Warzone rejects virtual controllers or macros, stop using NEXUS there.

Automated results (unit, simulated-engine and installer tests on GitHub's Windows machines) do not count towards this gate.
