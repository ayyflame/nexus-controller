# Live Viewer and controller diagnostics

Sidebar › **Live Viewer**. Read-only: it shows what NEXUS receives from the DualSense (USB) and never changes mappings, calibration, profiles or macros. It consumes the controller state the engine already publishes to the UI (about 60 updates a second). It never polls the controller itself. Closing it doesn't affect controller processing, macros or the virtual Xbox controller.

## Tabs

| Tab | What it shows | Source |
|---|---|---|
| **Live** | The 3D controller with pressed buttons, stick and trigger movement and touches, plus what is sent to the game. Marks for remapped, macro, disabled and layer/gyro buttons; click a button for its mapping. The **active shift layer**. Analog values (raw bytes, values, sent to game). **Detected this session**: every control lights while used and gets a tick once seen | Engine: physical input, processed output, active layer |
| **Sticks & Triggers** | Per stick: X/Y raw and normalised, distance from centre, the profile's deadzone on the plot, the value sent to the game, and a **full-range test** (four edges, eight directions, furthest reach). Per trigger: raw and %, the value sent to the game, the lowest and highest values seen, **fully released (≤ 2)** and **fully pressed (≥ 253)**, and a note when travel is incomplete | Engine |
| **Motion** | Gyroscope X/Y/Z and accelerometer X/Y/Z, as raw counts and in °/s and g. **Tilt** (forward/back, left/right) from gravity, with a level, and the sensor timestamp. If a report carries no motion data, it says why | DualSense report |
| **Health** | Name, model, connection, vendor/product ID, report format, time connected, last report, last unreadable report. Input freshness (stale input is flagged after 250 ms without a report), report rate, reports received, unreadable reports, dropped reports, time between reports, late reports, NEXUS processing time, battery. **Connection events** | Each value is labelled *measured*, *from controller* or *estimate* |
| **Controller Test** | A guided ten-step test: face buttons, D-pad, bumpers, triggers, stick clicks, left stick full range, right stick full range, touchpad, Create/Options/PS, Mute. Each control is **pass**, **fail** or **not tested**, with Retry, Back/Skip, Mark as failed, and a summary | Engine; nothing is changed |
| **Drift Test** | Leave the controller untouched for 5, 10 or 30 s. It reports the average resting position, the centre offset, the maximum deviation, jitter and drift (first second against last second), compared with a reference radius you set (by default the profile's deadzone). There is no "defective" verdict | Engine (raw, before any deadzone) |

| **Calibration** | The calibration wizard ([`calibration.md`](calibration.md)). The **Live** tab also shows the current profile's calibration status (sticks: calibrated or not, centre offset, deadzone; triggers: endpoints), with a shortcut to run it | Profile settings |

## Pass rules (Controller Test)

- **Button:** pressed, then released, so a stuck button doesn't pass.
- **Trigger:** reaches raw ≥ 253, then returns to ≤ 2.
- **Stick:** reaches all four edges (≥ 95 % deflection) and all eight 45° directions (≥ 90 %), then returns near the centre (≤ 15 %).
- **Touchpad:** a touch is seen and the pad is clicked.

## Limits

- **Update rate.** The UI receives about 60 updates a second, while the controller sends about 250. A press shorter than about 20 ms can be missed by the test and the detection view; macros and game output are unaffected, because they run in the engine on every report. The drift test samples at the same rate, and a measurement with fewer than 20 samples a second is rejected as invalid.
- **Motion units are estimates.** NEXUS doesn't apply the controller's factory IMU calibration. The raw counts are exact. The conversions use 16.384 counts per °/s (the same scale as gyro aiming) and 8192 counts per g.
  - The tilt axes assume Y reads about +1 g with the controller lying flat. Verify this on hardware.
  - Yaw (turning flat on a table) can't be measured from gravity and isn't shown. There is no 3-D model.
- **Battery** comes from the controller's report in 10 % steps. It shows "Not reported" when a report has no battery field.
- **Dropped reports** are an estimate from gaps in the controller's report counter.
- **Paddles.** MZ Titan independent paddles aren't detected: the captures so far show they send nothing over USB in native mode. Mapped paddles appear as the button they're mapped to.
- **Bluetooth** is not supported.

## Hardware checks (your PC, DualSense on USB)

| # | Step | Expected |
|---|---|---|
| LV1 | Live tab: press every button once, move both sticks, pull both triggers, touch and click the touchpad, press Mute | Each lights on the picture while held; *Detected this session* reaches 22 of 22 |
| LV2 | Hold Cross + Triangle + L1 together | All three lit at once |
| LV3 | With a remap (e.g. Cross → Circle) and a macro on R3 | Cross shows the teal "remapped" dot and R3 the gold "macro" dot; clicking each shows the right mapping |
| LV4 | With a hold layer on L1: hold L1 | Badge "Layer active: <name>" appears and disappears on release |
| LV5 | Sticks & Triggers: roll each stick around the edge | 8 of 8 directions, "Full range reached"; at rest X/Y read near 0 (raw near 128) |
| LV6 | Pull each trigger fully, then let go | Highest 255 (or ≥ 253), lowest 0; both ticks |
| LV7 | Motion: controller flat on the table, then tilt forward, then to the right | Flat: about 0° / 0°, about 1.0 g, "Steady". Forward and right move the bubble and change the matching angle (note if the sign or axis is wrong) |
| LV8 | Motion: rotate the controller quickly | Gyro values rise and fall back near 0 at rest; the sensor timestamp keeps counting |
| LV9 | Health with the controller plugged in for 2 minutes | Rate about 250 reports/s, unreadable 0, time between reports about 4 ms, battery shows a percent (and *charging* while on USB) |
| LV10 | Unplug the cable while on Health, then plug it back in | "No input" notice within about a second of unplugging the cable; connection events show the disconnect and connect |
| LV11 | Controller Test: run all ten steps | Each passes when done fully; a trigger pulled only halfway doesn't pass the trigger step; the summary is correct |
| LV12 | Controller Test while the virtual Xbox controller is on (`joy.cpl` open) | Presses still reach `joy.cpl`; nothing in your profile changes |
| LV13 | Drift Test, 10 s per stick, not touching the controller | Valid result (about 600 samples); values in % recorded; repeat once and compare |
| LV14 | Close the Live Viewer during a Repeat While Held macro | The macro and the virtual controller keep working |
