# Controller calibration wizard

**Live Viewer › Calibration** (also opened from *Sticks* and *Triggers*, and from *Live › Calibration* status).

Calibrates the left stick, right stick, L2 and R2 of the current profile from your DualSense's raw input. **Nothing changes until you review the results and press _Apply and save_.**

## Steps

| Part | Step | What is measured |
|---|---|---|
| Each stick | **1. Centre** (3 s, hands off) | Average resting X/Y (the measured centre, never assumed to be 0), offset from the ideal centre, closest and furthest resting deviation, jitter (RMS), drift between the first and last second. Rejected if fewer than 90 readings or the stick moved |
| | **2. Deadzone** | Resting movement and the smallest reliably detectable movement. A **recommended** deadzone (resting movement + 25 % + two raw steps, between 2 % and 30 %), and the deadzone that would be needed **without** centre calibration. A live circular preview (measured centre, resting-movement area, recommended and previewed deadzone, the stick now). Type any value; *Use recommended* or *Keep current* |
| | **3. Full range** | Guided: up, down, left, right, the four diagonals, then the full circle. Min/max X and Y, furthest distance, reach in eight directions, diagonal ÷ straight reach, circle coverage, and whether every straight direction reaches 95 %. The plot draws exactly what was measured |
| Each trigger | **1. Released** (1.5 s), **2. Fully pressed** | Released raw values, the highest pressed value, incomplete travel (below 240 of 255). Rejected if too few readings or almost no travel |

## Results

Per part, the screen shows:
- the measurements;
- the calibration that would be stored;
- the deadzone change (current → new);
- warnings for incomplete tests, short range and limited values;
- **Apply** checkboxes (centre and range, and deadzone, separately) and **Retry**.

Then choose:
- **Apply and save to *profile***: saves only the ticked calibration fields to the active profile. Mappings, curves, macros and everything else are untouched. The engine uses them at once, so games get them through the virtual Xbox controller.
- **Cancel (change nothing)**.
- After applying, **Reset to previous calibration** puts back exactly the values from before.

Calibration belongs to each profile. Switching profiles loads that profile's calibration. *Sticks/Triggers* show the status and can reset to factory.

## How it is applied

The existing processing (`crates/input-processing`) applies calibration before deadzones and curves:
- **Sticks:** each axis is mapped from the measured minimum–centre–maximum to −1…0…1.
- **Triggers:** the measured released–pressed range is mapped to 0…1.

Saved values are limited:
- stick centre within ±50 %;
- stick range ends at least 20 % from the centre;
- trigger released value at most 50 %, with the pressed value at least 20 % above it.

An axis end that wasn't reached at least 60 % from the centre keeps its previous value, with a warning.

## Limits

- **Sampling.** Samples arrive at the UI rate, about 60 a second. The engine itself reads about 250.
- **Range scaling.** A trigger or stick that can't physically reach the end is scaled to full output from the furthest point measured. That's intended, but say so if it feels wrong.
- **Resolution.** Stick resolution is 1/127 per raw step, so recommendations below 2 % aren't meaningful.
- **Physical check needed.** Not yet verified with a physical DualSense: everything above was tested with simulated input.

## Hardware checks (DualSense on USB)

| # | Step | Expected |
|---|---|---|
| CAL1 | Calibrate the left stick: centre hands-off | About 180 readings; centre close to 0 (typically within a few %), jitter small; no "moved" error |
| CAL2 | Touch the stick during the centre step | Rejected with "the stick moved"; measure again works |
| CAL3 | Deadzone step | Recommended value shown; the gold ring follows typed values; the teal dot stays inside the grey area at rest |
| CAL4 | Full range: up, down, left, right, diagonals, circle | All eight directions ticked, circle about 100 %, diagonal ratio near 1.0, *Reaches 95 % straight: Yes* |
| CAL5 | L2: released, then fully pressed | Released about 0, pressed 255 (or close); no incomplete warning |
| CAL6 | Results: untick "Apply deadzone", apply | Profile deadzone unchanged; centre/range applied; Sticks shows "Calibrated: centre …" |
| CAL7 | After applying, Live tab and `joy.cpl` | At rest the processed stick reads 0 / 0; full push reaches the edge; L2 reaches 100 % |
| CAL8 | Reset to previous calibration | Previous values back; Sticks shows the old state |
| CAL9 | Calibrate profile A, switch to profile B, then back | B shows its own (or no) calibration; A's comes back |
| CAL10 | Restart NEXUS | Profile A still calibrated |
| CAL11 | Cancel halfway through | Nothing changed |
| CAL12 | Calibrate while a Repeat While Held macro is assigned | The macro still works normally during and after calibration |
