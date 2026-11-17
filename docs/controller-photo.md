# Controller picture: photo mode (optional)

By default NEXUS draws the controller. Optionally it shows **your own photo** of the controller, unchanged, with live overlays on top: pressed buttons glow gold, the selected button is outlined in teal, stick indicators move over the sticks, touch points appear on the touchpad, and small dots mark remapped, macro and disabled buttons.

## How it works

- **NEXUS does not ship or download any photo.** You choose the image file once: Controller › Live › *Controller picture* › **Use my photo…**. It is stored only in NEXUS's webview storage on this PC. **Use drawing** removes it.
- The overlay positions were measured on one specific front-view image: 400 × 400 px, SHA-256 `b337756a4eb35b87944827d5fe7315016be86f197c62e42e153309c2dcad8b13`. NEXUS accepts only that exact file. Any other picture is refused with a message, because the buttons would not line up.
- The photo is shown at its own aspect ratio without cropping or filters. Overlays are an SVG with the photo's pixel size as its viewBox, so they scale with it at any window size. Inactive overlays are fully transparent.
- Every page that shows the controller (Dashboard, Controller, Macro Studio preview and live test) uses the photo once it is set.

## Measured positions (image pixels)

| Control | Position | How it was found |
|---|---|---|
| D-pad arms | up (125, 157), down (124, 187), left (110, 172.5), right (140, 173) | Centroid of each arm's printed arrow |
| Triangle, Square, Circle, Cross | (276.8, 155), (259.4, 173.2), (295.4, 172.6), (277.2, 190.7) | Centroid of each symbol; Circle checked against the grid because its rim reflection biases the centroid |
| Left / right stick | (162, 205) / (240, 205), radius 14 | Best fit of the cap against its darker rim |
| Touchpad | top edge y 133 from x 154 to 250.5, bottom y 180.5 from x 163 to 240 | Edges and the blue light strips |
| Create / Options | (148.5, 142.5) / (255.5, 142.5) | Enlarged view, mirrored about the controller's centre line (x 201.5) |
| PS button / mute | (202, 205) / (201.5, 219.5) | Enlarged view |
| L1 / R1 | lips at y 126–133, x 112–142 / 262–292 | Silhouette |

## Limits of this picture

- **L2 and R2 are not visible** in this front view (they sit behind L1 and R1). Their pressure is shown as two meters in the empty space just above the shoulders, not on the triggers themselves.
- At 400 px, Create and Options are only about 4 × 8 px and the mute button about 10 × 3 px: their hotspots are accurate to about ±1 px of the photo.
- The photo shows the controller at rest. A pressed button or moved stick is shown by the overlay, not by the photo changing.
