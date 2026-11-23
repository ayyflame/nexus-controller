# 3D controller view

NEXUS shows your controller (a DualSense or a DualShock 4) as an interactive 3D model on the Dashboard, Controller › Live, Controller › Mapping and the Live Viewer. It moves with your real controller. Everything it shows comes from the same live input the rest of NEXUS uses (`device.input` from the engine's status stream). It never reads the controller on its own and never changes mappings, macros, profiles or the virtual controller.

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

### DualShock 4

When a DualShock 4 is connected, the view shows the DualShock 4 model instead, with the same camera views, lighting and highlights:

| Control | In the 3D view |
|---|---|
| Cross, Circle, Square, Triangle, Share, Options, PS, L1, R1, each D-pad arm | Light up gold and sink slightly while pressed |
| L2 / R2 | Swing in with the analog pressure and glow |
| Left / right stick | Tilt toward where they're pushed; L3/R3 press the stick down |
| Touchpad | Sinks and lights while clicked; fingers show as gold dots |
| Light bar | Shown as the model's own (pink) light bar glow, which doesn't change |

It has no Mute button, so nothing lights for it, and the White / Midnight Black switch is hidden: the model is shown in its own black colours.

**Which model is shown:**
- **The controller's own input decides:** the report format says DualSense or DualShock 4.
- **Before the first input:** the connected controller's model.
- **Unplugged:** the last model stays, at rest, with the usual *No controller connected* badge.
- **Switching controllers** changes the model at once without restarting NEXUS. The other model's file loads the first time it is needed; the loading placeholder shows meanwhile.

## Using it

- **Rotate:** drag. It turns all the way round, and the movement eases out smoothly.
- **Zoom:** scroll, or use − / +.
- **Views:** Reset (the default slight tilt), Front, Rear, and Top (bumpers and triggers).
- **Colour:** the round swatch switches between Midnight Black and White. The model's textures are painted for a white controller; Midnight Black repaints them (white plastic → black, grey printing → light grey), so the button symbols stay readable.
- **2D:** switches to the flat picture (drawing or your own photo). The drawing matches the connected controller: a DualSense, or a DualShock 4 whose outline is traced from the DualShock 4 3D model and whose buttons sit where the model has them (`lib/dualshock4Art.ts`). The flat picture then has a **3D** button in its corner to switch back, on every page. Controller › Live › Controller picture also switches between 3D and 2D.
- **Controller › Mapping:** click a control on the model to edit it. The leader lines follow the controls as you turn the model, and are hidden for controls facing away.
- **ⓘ:** shows the 3D model's credit.

## Performance

- **Rendering:** it draws a frame only when something visible changes (input, camera, size). With the controller still and the view untouched, it draws nothing.
- **Loading:** the 3D code (~270 kB gzipped) and the model (~5.9 MB DualSense, ~7.1 MB DualShock 4, loaded from the app itself, no network) load only when a 3D view first needs them. The DualShock 4 file isn't loaded unless a DualShock 4 is used.
- **In the background:** while another program (a game) has the focus, the model doesn't redraw for input; it catches up when NEXUS is focused again. Measured with the DualShock 4 model in headless Chromium: no 3D frames while unfocused with input streaming, a redraw within 1.5 s of focus.
- **Fallback:** if the PC can't draw WebGL, NEXUS shows the flat picture with a note. The small previews (Sent to the game, macro previews) stay flat.

## The model

`apps/desktop/src/assets/models/dualsense.glb`: **"Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato)** ([source](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The file itself is unchanged. When it loads, NEXUS:
- splits its meshes into one object per control (`apps/desktop/src/lib/dualsenseModel.ts`)
- gives each control a pivot
- tints it for the Midnight Black finish and the gold/teal highlights.

A test checks that all 19 controls are found in the file at their expected places.

`apps/desktop/src/assets/models/dualshock4.glb`: **"DualShock 4 PlayStation Controller" by [shaielwolf](https://sketchfab.com/shaielwolf)** ([source](https://sketchfab.com/3d-models/dualshock-4-playstation-controller-e3c2f0dc16524fc19cdde45bad1de1a9)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The file is unchanged.

**How its parts are found:** the file groups parts by kind: one mesh holds all the buttons, one both sticks, one the bumpers and triggers, one the touchpad. Inside each mesh every control is its own piece of geometry, so NEXUS:
- moves the file into the same frame as the DualSense (2 units wide, centred);
- splits each mesh into its pieces and names each by position (`apps/desktop/src/lib/dualshock4Model.ts`).

Each control then moves as itself, as on the DualSense. A test (`dualshock4Model.test.ts`) checks against the real file that:
- all 18 controls are found, each exactly one piece, at the expected place;
- the shell, headphone jack, screws, USB port and the thin strips behind the bumpers stay fixed.

Both models include the controllers' own markings (the PS button and the SONY lettering on the top edge); NEXUS is not affiliated with Sony.

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
| 3D11 | With a DualShock 4: 3D1–3D7 (no Mute) | The DualShock 4 model shows and responds the same way |
| 3D12 | Unplug the DualSense, plug in a DualShock 4 (and back) | The model changes to the controller that's connected, without restarting NEXUS |

## 2D pictures with a DualShock 4

Every flat picture follows the controller shown, chosen the same way as the 3D model (`hooks/useShownModel.ts`):
- the controller the input came from;
- otherwise the connected controller;
- otherwise the last one shown.

| Where | DualSense | DualShock 4 |
|---|---|---|
| Dashboard › Live Input, Controller › Live, Live Viewer › Live (2D mode) | DualSense drawing (or your photo) | DualShock 4 drawing |
| *Sent to the game* previews (Controller › Live, Live Viewer), Macro Studio preview and live test | DualSense drawing (or your photo) | DualShock 4 drawing |
| Controller › Mapping (2D and 3D): cards and leader lines | Cards for every control, *Create* | No *Mute* card; *Share* |
| Macro Studio button pads | With *Mute*, *Create* | No *Mute* key; *Share* |
| Controller › Touchpad zone editor | 16:9 (1920 × 1080) | DualShock 4 shape (1920 × 942) |
| Controller › Live › Controller picture | *Use my photo…* available | Drawing only (the photo is of a DualSense) |

The DualShock 4 drawing:
- **Size and style:** the same viewBox, size, colours, highlights, mark dots and clickable parts as the DualSense drawing.
- **Shape:** body, touchpad and bumper outlines traced from the DualShock 4 3D model's front view. A test checks the body against the model's silhouette: same width, height and area within 1 %.
- **Positions:** every button, the D-pad arms, sticks, Share, Options and PS sit at the model's own positions.
- **Differences from the DualSense drawing:** the D-pad and face-button wells and the coloured face symbols are drawn; there are no light strips and no Mute button.
