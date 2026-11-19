# 3D controller view

NEXUS shows your DualSense as an interactive 3D model on the Dashboard, Controller › Live, Controller › Mapping and the Live Viewer. It moves with your real controller. Everything it shows comes from the same live input the rest of NEXUS uses (`device.input` from the engine's status stream). It never reads the controller on its own and never changes mappings, macros, profiles or the virtual controller.

## What it shows

| Control | In the 3D view |
|---|---|
| Cross, Circle, Square, Triangle, Create, Options, L1, R1 | Light up gold and sink slightly while pressed |
| D-pad | Each direction lights on its own; diagonals light two |
| L2 / R2 | Swing in with the analog pressure and glow brighter the further they're pulled |
| Left / right stick | Tilt toward where they're pushed (up to ~22°); L3/R3 press the cap down |
| Touchpad | Lights while clicked; each finger shows as a gold dot where it touches |
| PS button | Lights up gold |
| Mute | Lights up orange |
| Light bar | On while a controller is connected, off when not |
| No controller | The model rests and a "No controller connected" badge appears. It picks up again as soon as input returns |

## Using it

- **Rotate:** drag. It turns all the way round, and the movement eases out smoothly.
- **Zoom:** scroll, or use − / +.
- **Views:** Reset (the default slight tilt), Front, Rear, and Top (bumpers and triggers).
- **Studio:** opens Controller Studio, where the controller's look is customised (colours, materials, presets, skins). See [controller-studio.md](controller-studio.md).
- **2D:** switches to the flat picture (drawing or your own photo). The flat picture then has a **3D** button in its corner to switch back, on every page. Controller › Live › Controller picture also switches between 3D and 2D.
- **Controller › Mapping:** click a control on the model to edit it. The leader lines follow the controls as you turn the model, and are hidden for controls facing away.
- **ⓘ:** shows the 3D model's credit.

## Performance

- **Rendering:** it draws a frame only when something visible changes (input, camera, size). With the controller still and the view untouched, it draws nothing.
- **Loading:** the 3D code (~270 kB gzipped) and the model (~5.9 MB, loaded from the app itself, no network) load only when a 3D view is first shown.
- **Fallback:** if the PC can't draw WebGL, NEXUS shows the flat picture with a note. The small previews (Sent to the game, macro previews) stay flat.

## The model

`apps/desktop/src/assets/models/dualsense.glb`: **"Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato)** ([source](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The file itself is unchanged. When it loads, NEXUS:
- splits its meshes into one object per control (`apps/desktop/src/lib/dualsenseModel.ts`)
- gives each control a pivot
- tints it for the Midnight Black finish and the gold/teal highlights.

A test checks that all 19 controls are found in the file at their expected places. The model includes the controller's own markings (the PS button shape and the SONY lettering on the top edge); NEXUS is not affiliated with Sony.

## Hardware checks (not yet done)

These need a real DualSense on Windows. Simulated input and CI don't count.

| # | Check | Expected |
|---|---|---|
| 3D1 | Press each face button, Create, Options, L1, R1, PS, Mute, touchpad click | Only that part lights; it goes dark on release |
| 3D2 | Each D-pad direction, then each diagonal | One arm lights, then two |
| 3D3 | Slowly pull L2, then R2 | The trigger swings in and glows gradually, matching Live Viewer › Analog |
| 3D4 | Circle each stick; click L3/R3 | The stick leans the way it's pushed, never the opposite way; it presses down on click |
| 3D5 | Touch with one, then two fingers; move them | Dots follow the fingers on the touchpad |
| 3D6 | Unplug, then plug back in | "No controller connected" appears, the light bar goes off; everything resumes on reconnect |
| 3D7 | Drag, scroll, Reset / Front / Rear / Top, resize the window | Smooth, no jumps; the controller stays in view |
| 3D8 | Controller › Mapping: click a control on the model, remap it | The editor opens for that control; the remap works in `joy.cpl` |
| 3D9 | Leave NEXUS on the Dashboard with the controller untouched | Task Manager shows little GPU/CPU use from NEXUS |
| 3D10 | Macros, profile switching and game output while the 3D view is open | Unchanged behaviour |
