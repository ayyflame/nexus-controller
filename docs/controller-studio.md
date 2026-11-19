# Controller Studio

Controller Studio (sidebar › **Controller Studio**) customises how the 3D DualSense looks in NEXUS: colours, materials, gradients, patterns, graphics and lighting. The skin you save is shown everywhere the 3D controller appears (Dashboard, Controller › Live and Mapping, Live Viewer).

A skin changes only the picture. It never changes controller input, mappings, macros, profiles or what games receive.

## Workspace

| Area | What it does |
|---|---|
| **Top toolbar** | Undo, redo, Randomise, Reset part, Reset all, Compare (switch between your changes and the saved version), Lighting, Base, Import, Export, Screenshot, Save / Save as |
| **Left: parts** | Search box and every part by group. Click to edit; the eye hides a part to see what's under it |
| **Centre** | The live 3D controller: drag to rotate, scroll to zoom, Reset/Front/Rear/Top views. Click a part on the model to select it. Live input keeps working while you edit |
| **Right: appearance** | Colour (system picker, HEX, RGB, favourites, recent, palettes), material, gradient, pattern, graphic, copy/paste style, Apply to… |
| **Bottom: library** | The presets and your saved skins, with previews. Click one to switch to it straight away |

Keyboard: **Ctrl+Z** undo, **Ctrl+Y** or **Ctrl+Shift+Z** redo, **Ctrl+S** save. Dragging a colour or a slider counts as one undo step.

## What can be customised

- **Shell:** front shell, rear shell, left grip, right grip, centre trim, touchpad, light bar (glow colour).
- **Buttons:** Triangle, Circle, Cross, Square, each D-pad direction, L1, R1, L2, R2, PS, Create, Options, Mute.
- **Sticks:** left cap, right cap, stick bases.

Each part has:
- **Colour:** "As modelled", or any custom colour. Printed symbols (△ ○ ✕ □, D-pad arrows) stay readable in a contrasting shade.
- **Material:** As modelled, Matte, Satin, Gloss, Metallic, Chrome, Carbon fibre, Textured rubber, Brushed metal. These are real material settings (roughness, metalness, clear coat, sheen, anisotropy), and carbon, rubber and brushed metal also add their own surface texture.
- **Gradient:** a second colour and a direction. On the shell it flows across all shell parts.
- **Pattern:** camouflage, digital camo, hexagons, stripes, dots, waves, checker or carbon weave, in any colour, size and strength. Patterns are projected in 3D, so they run continuously across a part.
- **Graphic** (front shell, rear shell, grips, touchpad): upload a PNG, JPEG or WebP (up to 4 MB) and set its position, size, rotation and opacity. One graphic per part.

The skin also stores the **base** (how parts without a colour look: Midnight Black or White), the **light bar** colour and the **lighting** preset (Studio, Showroom, Night, Neon, Sunset).

## Presets

Midnight Black, Arctic White, Cyberpunk, Neon RGB, Carbon Fiber, Stealth, Blood Red, Purple Haze, Titanium, and Custom (a plain white starting point). Opening a preset and changing it, then **Save as new…**, creates your own skin; presets themselves never change.

## Saving, switching, import and export

- **Save** stores the skin and makes it the one shown across NEXUS. Skins are kept in the app's own storage (the webview's built-in database) and survive restarts and NEXUS updates.
- **Rename, Duplicate, Delete, Export** are on each saved skin's card. Delete asks for confirmation.
- **Export** saves a `.nexusskin.json` file, including any graphics. **Import** reads one back as a new skin; it never replaces a skin you already have.
- Leaving a skin with unsaved changes asks whether to save, discard or stay.

## Format and safety

- **Versioned format:** skins are stored as `{ "format": "nexus-skin", "version": 1, … }`. Every skin, whether stored, imported or from an older format, goes through one validation step (`lib/skin.ts`, `migrateSkin`):
  - unknown parts and fields are dropped;
  - numbers are kept within their ranges;
  - colours must be valid hex.
- **Newer formats:** a skin from a newer NEXUS is refused with a message instead of being misread. A damaged stored record is skipped, never deleted.
- **Uploaded graphics:**
  - the real file type is checked from its first bytes (PNG, JPEG, WebP only; SVG and anything else is refused);
  - size is limited;
  - the image is decoded and re-encoded through a canvas, so only plain pixels are stored.
- **Imported files:** the same rules apply to graphics inside them.

## How it works (for developers)

- **Splitting the model:** the model (`apps/desktop/src/assets/models/dualsense.glb`) keeps every control as separate geometry, and NEXUS splits them out when loading (`lib/dualsenseModel.ts`). The shell is split into zones by the model's own paint regions (white plastic, back housing, dark core, light bar) and the grip line.
- **Clean edges:** where a region boundary runs through a triangle, the shader picks the style per pixel, so edges follow the paint lines.
- **Rendering:** every piece has its own `MeshPhysicalMaterial` with a styling stage added to its shader (`components/controller3d/modelParts.ts`). Patterns and finish textures are generated in code (`lib/patterns.ts`, no image files).
- **Performance:** the 3D view still draws only when something visible changes. A still controller with normal sensor jitter does not cause redraws.

## Checks to do on a real PC

These need Windows with a DualSense. Simulated input in a browser doesn't count.

| # | Check | Expected |
|---|---|---|
| CS1 | Colour each shell part, each button, each stick part | Only that part changes |
| CS2 | Try every material | Chrome reflects, Gloss has a clear coat, Matte is flat, Carbon/Rubber/Brushed show their texture |
| CS3 | Gradient, pattern and a graphic on the front shell | They follow the controller's shape; the graphic can be moved, sized, rotated |
| CS4 | Each preset, Randomise, Reset part, Reset all | The model updates immediately |
| CS5 | Undo/redo with the buttons and Ctrl+Z / Ctrl+Y | Steps back and forward; a colour drag is one step |
| CS6 | Save, close NEXUS, reopen | The skin is still there and still active |
| CS7 | Export, delete the skin, Import the file | The skin comes back as it was |
| CS8 | While customised: press buttons, move sticks, pull L2/R2 | Live input still shows |
| CS9 | Rotate, zoom, Front/Rear/Top | Unchanged behaviour; Rear shows the back shell |
| CS10 | Games and macros while Studio is open | Unchanged |
