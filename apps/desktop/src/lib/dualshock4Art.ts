// Flat (2D) DualShock 4 picture, matching the DualSense drawing's size and
// style (components/ControllerVisual.tsx). Everything is taken from the
// DualShock 4 3D model (src/assets/models/dualshock4.glb, "DualShock 4
// PlayStation Controller" by shaielwolf, CC BY 4.0):
// - the outlines of the body, touchpad and bumpers were traced from the
//   model's front view (its meshes projected onto the face, rasterised at
//   4 cells per unit, outer contour traced and simplified to within 0.5–0.6
//   units);
// - every control sits where the model has it (DS4_PARTS, the same table
//   the 3D view uses), projected the same way.
// Pure (no React), so it is unit-tested.

import type { MacroButton } from "../types/engine";
import type { TriggerShape } from "./controllerView.ts";
import { DS4_PARTS } from "./dualshock4Model.ts";

/**
 * Model frame (x right, y up, 2 units wide) → drawing units, in the
 * DualSense drawing's viewBox (0 −38 800 558): 360 units per model unit,
 * centred at x 400, with the sticks at the same height as the DualSense's.
 */
export const ART_SCALE = 360;
export const ART_ORIGIN = { x: 400, y: 247 } as const;
export function toArt(x: number, y: number): [number, number] {
  return [ART_ORIGIN.x + x * ART_SCALE, ART_ORIGIN.y - y * ART_SCALE];
}

/** Traced from the model's front view (see above). */
export const DS4_OUTLINES = {
  body: "M129.6 36.9L228.6 36.9L230.4 37.9L233.9 44.1L240.6 46.9L276.6 47.6L276.6 52.1L278.4 52.9L299.4 54.4L509.4 54.1L523.1 52.4L523.4 47.6L555.6 47.4L560.4 46.6L566.1 44.1L569.9 37.6L571.4 36.9L670.9 37.1L677.1 51.6L693.6 80.4L706.4 106.4L720.1 144.6L732.1 188.9L745.1 248.9L756.6 314.4L759.9 348.9L759.9 369.9L758.1 388.1L755.1 409.4L748.6 427.9L739.9 443.1L730.9 453.6L718.4 464.4L709.6 469.6L700.1 473.4L687.6 475.1L675.9 474.6L660.4 471.6L651.9 467.9L637.6 457.9L628.9 448.9L620.9 437.6L617.1 430.1L607.9 411.4L573.6 332.4L567.9 321.6L559.4 312.1L548.1 320.1L537.9 325.4L526.6 328.4L516.6 329.1L504.1 328.4L492.1 325.4L480.9 319.9L468.6 310.1L331.4 310.1L319.1 319.9L307.9 325.4L295.9 328.4L286.1 329.1L273.4 328.4L262.1 325.4L251.9 320.1L240.6 312.1L232.1 321.6L226.4 332.4L192.1 411.4L179.1 437.6L171.1 448.9L162.4 457.9L152.6 465.4L140.9 471.1L131.9 473.6L121.4 474.9L108.1 474.9L99.9 473.4L90.4 469.6L81.6 464.4L69.1 453.6L60.1 443.1L51.4 427.9L44.9 409.4L40.1 369.9L40.1 348.9L43.1 314.6L49.1 278.1L60.4 222.1L69.6 182.1L80.6 142.6L87.4 122.6L96.4 100.6L106.1 81.1L122.4 52.6L129.4 37.1Z",
  touchpad: "M287.4 44.9L512.6 44.9L518.9 45.1L521.9 46.9L522.9 47.6L522.9 170.9L520.6 176.1L516.4 180.1L512.6 181.9L506.1 183.4L293.9 183.4L288.6 182.6L283.6 180.1L279.4 176.1L277.1 170.9L277.1 47.6L281.1 45.1L287.1 45.1Z",
  leftShoulder: "M179.4 18.9L200.6 19.9L216.9 23.4L225.9 27.1L226.6 33.6L226.1 43.1L224.4 44.4L180.9 44.4L135.4 44.4L133.6 43.4L133.1 40.9L133.1 31.4L133.9 28.4L135.1 27.4L146.6 23.4L161.4 20.1L179.1 19.1Z",
  rightShoulder: "M612.4 18.9L638.6 20.1L656.9 24.4L666.1 28.4L666.9 31.4L666.9 40.9L666.4 43.4L664.6 44.4L627.4 44.4L575.6 44.4L573.9 43.1L573.4 33.6L573.9 28.1L574.9 26.4L583.1 23.4L595.6 20.4L612.1 19.1Z",
} as const;

/** Where a control's centre is drawn. */
export function artPosition(b: MacroButton): { x: number; y: number } {
  const p = DS4_PARTS[b];
  if (!p) throw new Error(`DualShock 4 has no ${b}`);
  const [x, y] = toArt(p.centre[0], p.centre[1]);
  return { x, y };
}

/** Sizes measured from the model, in drawing units. */
export const DS4_ART = {
  /** Face buttons: 0.13 model units across. */
  faceRadius: 0.065 * ART_SCALE,
  /** D-pad arms: 0.116 x 0.145. */
  armWidth: 0.116 * ART_SCALE,
  armLength: 0.145 * ART_SCALE,
  /** Share / Options: 0.06 x 0.104. */
  smallKey: { w: 0.06 * ART_SCALE, h: 0.104 * ART_SCALE },
  /** PS button: 0.1 across. */
  homeRadius: 0.05 * ART_SCALE,
  /** The round recesses around the D-pad and the face buttons. */
  wellRadius: 0.215 * ART_SCALE,
} as const;

/** Touchpad box (for touch dots): the traced outline's bounds. */
export const DS4_TOUCH_BOX = boundsOf(DS4_OUTLINES.touchpad);

/** L2/R2, drawn rising from behind the bumpers as in the DualSense drawing, at the model's trigger width (0.233). */
export const DS4_TRIGGERS: Record<"leftTrigger" | "rightTrigger", TriggerShape> = {
  leftTrigger: { outer: toArt(-0.608 - 0.1165, 0)[0], inner: toArt(-0.608 + 0.1165, 0)[0], top: -20, visibleBottom: 24, bottom: 44, dip: 6 },
  rightTrigger: { outer: toArt(0.608 + 0.1165, 0)[0], inner: toArt(0.608 - 0.1165, 0)[0], top: -20, visibleBottom: 24, bottom: 44, dip: 6 },
};

/** Bounding box of an "M x y L x y … Z" path. */
export function boundsOf(path: string): { x: number; y: number; w: number; h: number } {
  const n = path.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Points of an "M x y L x y … Z" path. */
export function pointsOf(path: string): Array<[number, number]> {
  const n = path.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  return out;
}
