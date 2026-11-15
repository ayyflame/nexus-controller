# Hardware Verification Checklist (Milestone 1)

None of these have been performed yet. Milestone 1 was built in a Linux container without access to Windows or a DualSense. Run them on Windows 11 x64 with a real DualSense and record the results.

Useful tools: **Settings → Diagnostics → Raw HID Reports** (enable auto-refresh) and **Engine Log**.

## Discovery and connection

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Start NEXUS with no controller | "No controller"; no device in the event list | |
| 2 | Plug in by USB | Within ~1 s: *DualSense connected (USB)*; dashboard shows **Connected** | |
| 3 | Quit NEXUS, keep USB plugged, start NEXUS | Detected at launch | |
| 4 | Unplug USB | *Controller disconnected*; dashboard returns to "No controller" | |
| 5 | Re-plug USB 10× quickly | Each time exactly one connect; never two devices listed | |
| 6 | Pair via Bluetooth, connect | *connected (Bluetooth)*; report format shows **Bluetooth report 0x31** (not "basic") within a second | |
| 7 | Turn the controller off (hold PS 10 s) while on Bluetooth | Disconnect detected (record how long it takes) | |
| 8 | Turn back on | Automatic reconnect | |
| 9 | Plug USB while connected over Bluetooth | Record behaviour: one controller listed, which transport? | |
| 10 | With DS4Windows / Steam running | Note whether NEXUS can still open the device (exclusive access) | |
| 11 | With ViGEmBus + DS4Windows emulating a DS4 | Virtual DS4 is not listed; if a virtual DualSense exists, the log says "Ignored virtual" | |

## Input parsing (USB, then repeat over Bluetooth)

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
