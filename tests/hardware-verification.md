# Hardware Verification Checklist

NEXUS supports the DualSense over **USB only**. Rows marked *Out of scope* concern Bluetooth and are no longer tested.

NEXUS is developed in a Linux container without access to Windows or a controller. Only the owner can fill in these results. Known so far (owner reports): USB input works, with 73,835 reports, 0 parse errors and about 250 Hz. Rows marked **Pass (owner, date)** were reported by the owner. Every other row is unverified until recorded here.

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
| 19 | Performance page | Record the report rate (USB and BT) and the parse-error count (should stay 0) | |
| 20 | Save 5 raw reports per transport | Attach to the repository as `tests/fixtures/` for regression tests | |

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
| 46 | Lighting: enable lightbar, change colour | Controller lightbar follows (USB and BT) | |
| 47 | Player lights pattern | LEDs match | |
| 48 | Test vibration at 100% and 30% | Vibrates ~0.6 s, then stops; strength differs | |
| 49 | Profiles: add your game's .exe, enable auto-switch, launch the game | Profile switches within ~1 s; returns when you leave | |
| 50 | Export a profile, Import on another PC (or after deleting it) | Same settings restored | |
| 51 | Create backup, change things, Restore backup | Everything restored; safety backup in the data folder | |
| 52 | Two controllers (USB + BT) | Both listed; selector switches the view | |

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
| V1 | Virtual Output tab before installing ViGEmBus | "Not installed" with install steps; Xbox 360 cannot be selected while the switch is off | |
| V2 | Install ViGEmBus, click **Check again** | "Installed and ready" | |
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
| V17 | Close NEXUS, install ViGEmBus (or start with it stopped), reopen with output on; then click **Check again** | Virtual controller appears without toggling or re-plugging | |

## Known limitations (current build)

| Area | Limitation |
|---|---|
| Connection | USB only. Bluetooth is out of scope. |
| Virtual controller | Experimental: ViGEmBus (retired upstream, user-installed, never bundled). Xbox 360 only; DualShock 4 not enabled. |
| Xbox 360 protocol | No touchpad, gyro, mute, adaptive triggers or haptics. Use touchpad zones and gyro-to-stick mappings instead. |
| Duplicate input | The physical DualSense stays visible to games and Steam. Some may react to both controllers. HidHide is deferred; turn off PlayStation controller support in the game or Steam if needed (V5, V13 not yet measured). |
| Multiple controllers | Each physical controller gets its own virtual controller, but all share one profile, settings and macro set (per-controller settings are planned for M5). |
| MZ Titan paddles | Mapped mode works as the mapped button. Independent paddles are **not** supported; no capture evidence exists yet (T1–T10). |
| Driver installed while NEXUS runs | Click **Check again** on the Virtual Output tab. |
| Online games | Not tested and not targeted. Many online games prohibit macros. NEXUS does not try to avoid anti-cheat detection. |
| Installer | Not code-signed (personal use); SmartScreen shows a warning on first install. |
