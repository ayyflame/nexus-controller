// Rules for the Mapping screen (Mapping page): where each button's
// card sits around the controller picture, what the card says a game
// receives, and the remap edits. Pure, so they are unit-tested; the screen
// only renders them. The edits produce exactly the RemapRule shapes the
// engine already reads (crates/input-processing), no new settings.

import type { ButtonMapping } from "./buttonMapping";
import type { MacroButton, ProcessingConfig, RemapRule, VirtualOutputKind } from "../types/engine";
import type { ViewModel } from "./controller3d.ts";

/**
 * Cards around the picture, in order along each side. The order follows
 * where each control appears on screen, so connectors don't cross each
 * other or pass over another control: seen from the front and above, a
 * trigger sits just inside and behind its bumper (L1, L2, Touchpad, R2, R1);
 * on each side the outer D-pad arm / face button comes before the inner one;
 * Mute sits below the PS button.
 */
export const CALLOUTS: Record<"top" | "left" | "right" | "bottom", MacroButton[]> = {
  top: ["leftShoulder", "leftTrigger", "touchpad", "rightTrigger", "rightShoulder"],
  left: ["select", "dpadUp", "dpadLeft", "dpadRight", "dpadDown", "leftStick"],
  right: ["start", "north", "east", "west", "south", "rightStick"],
  bottom: ["home", "mute"],
};

export const CALLOUT_BUTTONS: MacroButton[] = [...CALLOUTS.top, ...CALLOUTS.left, ...CALLOUTS.right, ...CALLOUTS.bottom];

/** The cards for the controller shown: a DualShock 4 has no Mute button (its layout is otherwise the same). */
export function calloutsFor(model: ViewModel): typeof CALLOUTS {
  return model === "dualShock4" ? { ...CALLOUTS, bottom: CALLOUTS.bottom.filter((b) => b !== "mute") } : CALLOUTS;
}

/** A card's name on the controller shown: Share on a DualShock 4 is Create on a DualSense. */
export function shortName(button: MacroButton, model: ViewModel): string {
  return model === "dualShock4" && button === "select" ? "Share" : SHORT_NAMES[button];
}

/** Short PlayStation names for the cards. */
export const SHORT_NAMES: Record<MacroButton, string> = {
  north: "Triangle", east: "Circle", south: "Cross", west: "Square",
  leftShoulder: "L1", rightShoulder: "R1", leftTrigger: "L2", rightTrigger: "R2",
  leftStick: "L3", rightStick: "R3", start: "Options", select: "Create", home: "PS", touchpad: "Touchpad", mute: "Mute",
  dpadUp: "D-pad up", dpadDown: "D-pad down", dpadLeft: "D-pad left", dpadRight: "D-pad right",
};

const XBOX: Record<MacroButton, string | null> = {
  south: "A", east: "B", west: "X", north: "Y",
  leftShoulder: "LB", rightShoulder: "RB", leftTrigger: "LT (analog)", rightTrigger: "RT (analog)",
  leftStick: "Left stick click", rightStick: "Right stick click", start: "Start", select: "Back", home: "Guide",
  dpadUp: "D-pad up", dpadDown: "D-pad down", dpadLeft: "D-pad left", dpadRight: "D-pad right",
  // An Xbox 360 controller has no such buttons (crates/virtual-controller translate.rs).
  touchpad: null, mute: null,
};

const DS4: Record<MacroButton, string | null> = {
  south: "Cross", east: "Circle", west: "Square", north: "Triangle",
  leftShoulder: "L1", rightShoulder: "R1", leftTrigger: "L2 (analog)", rightTrigger: "R2 (analog)",
  leftStick: "L3", rightStick: "R3", start: "Options", select: "Share", home: "PS", touchpad: "Touchpad click",
  dpadUp: "D-pad up", dpadDown: "D-pad down", dpadLeft: "D-pad left", dpadRight: "D-pad right",
  // A DualShock 4 has no mute button.
  mute: null,
};

/**
 * What a game sees for `button` on the virtual controller, or null when that
 * controller has no such input. With output off, the Xbox 360 names are shown
 * (the default output).
 */
export function gameLabel(button: MacroButton, output: VirtualOutputKind): string | null {
  return (output === "dualShock4" ? DS4 : XBOX)[button];
}

export type CalloutTone = "normal" | "remapped" | "disabled" | "unsent";

export interface Callout {
  /** Second line of the card: what the game receives. */
  sends: string;
  tone: CalloutTone;
  /** Small extra notes: macros, layers, gyro. */
  notes: string[];
}

/** The card text for one button. */
export function calloutFor(m: ButtonMapping, output: VirtualOutputKind): Callout {
  const notes: string[] = [];
  const [first] = m.macros;
  if (m.macros.length === 1 && first) notes.push(`Macro: ${first.name}`);
  else if (m.macros.length > 1) notes.push(`${m.macros.length} macros`);
  if (m.activatesLayers.length) notes.push(`Layer: ${m.activatesLayers.join(", ")}`);
  else if (m.layers.length) notes.push(`Changes in ${m.layers.length === 1 ? m.layers[0]?.layer : `${m.layers.length} layers`}`);
  if (m.gyroButtonHidden) notes.push("Gyro button");

  const targets = [m.sends, ...m.also].filter((b): b is MacroButton => b !== null);
  const named = targets.map((b) => gameLabel(b, output)).filter((s): s is string => s !== null);
  if (m.kind === "disabled") return { sends: "Disabled", tone: "disabled", notes };
  if (named.length === 0) return { sends: "Not sent to games", tone: "unsent", notes };
  return { sends: named.join(" + "), tone: m.kind === "remapped" ? "remapped" : "normal", notes };
}

/** Sets what `from` sends: itself ("same"), nothing ("off"), or another button. Keeps its "also" button. */
export function setRemapTarget(config: ProcessingConfig, from: MacroButton, value: MacroButton | "same" | "off"): ProcessingConfig {
  const prev = config.remap.find((r) => r.from === from);
  const rest = config.remap.filter((r) => r.from !== from);
  if (value === "same" && !prev?.also?.length) return { ...config, remap: rest };
  const to = value === "same" ? from : value === "off" ? null : value;
  return { ...config, remap: [...rest, { from, to, also: prev?.also ?? [] }] };
}

/** Sets the second button `from` presses at the same time (null: none). Keeps its target. */
export function setRemapAlso(config: ProcessingConfig, from: MacroButton, also: MacroButton | null): ProcessingConfig {
  const prev = config.remap.find((r) => r.from === from);
  const rest = config.remap.filter((r) => r.from !== from);
  const to = prev ? prev.to : from;
  if (!also && to === from) return { ...config, remap: rest };
  return { ...config, remap: [...rest, { from, to, also: also ? [also] : [] }] };
}

/** Puts `from` back to its normal behaviour (removes its base remap only; layers are untouched). */
export function resetButton(config: ProcessingConfig, from: MacroButton): ProcessingConfig {
  return { ...config, remap: config.remap.filter((r) => r.from !== from) };
}

/** Undo/redo stacks of the remap list, kept by the Mapping screen. */
export interface RemapHistory { past: RemapRule[][]; future: RemapRule[][] }

export const EMPTY_HISTORY: RemapHistory = { past: [], future: [] };

/** Records `before` as an undo step when an edit changed the remap list. */
export function recordEdit(h: RemapHistory, before: RemapRule[], after: RemapRule[]): RemapHistory {
  if (JSON.stringify(before) === JSON.stringify(after)) return h;
  return { past: [...h.past, before].slice(-100), future: [] };
}

export function undoRemap(h: RemapHistory, current: RemapRule[]): { history: RemapHistory; remap: RemapRule[] } | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, remap: prev };
}

export function redoRemap(h: RemapHistory, current: RemapRule[]): { history: RemapHistory; remap: RemapRule[] } | null {
  const next = h.future[0];
  if (!next) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, remap: next };
}

export interface Point { x: number; y: number }
export interface Box { left: number; top: number; width: number; height: number }
export type Side = keyof typeof CALLOUTS;

/** Distance a connector runs straight out of its card before turning towards the control. */
export const STUB = 10;
/** Keeps the connector away from the card's rounded corners. */
const INSET = 9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Connector from a card to its control: it leaves the card's edge facing
 * the controller at `along` (a position on that edge; by default the point
 * closest to the control), runs `STUB` px straight out, then goes straight
 * to the control's anchor. Returns the polyline's points, card end first;
 * the last point is exactly the anchor.
 */
export function leaderRoute(side: Side, card: Box, anchor: Point, along?: number): Point[] {
  const right = card.left + card.width, bottom = card.top + card.height;
  if (side === "left" || side === "right") {
    const y = clamp(along ?? anchor.y, card.top + INSET, bottom - INSET);
    const x = side === "left" ? right : card.left;
    const out = side === "left" ? x + STUB : x - STUB;
    return [{ x, y }, { x: out, y }, anchor];
  }
  const x = clamp(along ?? anchor.x, card.left + INSET, right - INSET);
  const y = side === "top" ? bottom : card.top;
  const out = side === "top" ? y + STUB : y - STUB;
  return [{ x, y }, { x, y: out }, anchor];
}

/** Does the segment a→b pass through the box (shrunk by `pad`)? */
export function segmentHitsBox(a: Point, b: Point, box: Box, pad = 1): boolean {
  const x0 = box.left + pad, x1 = box.left + box.width - pad, y0 = box.top + pad, y1 = box.top + box.height - pad;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky clipping: the segment hits the box if some part of it survives.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as Array<[number, number]>) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}

/** Does a polyline pass through any of the boxes? */
export function routeHitsBoxes(route: Point[], boxes: Box[]): boolean {
  for (let i = 0; i + 1 < route.length; i++) {
    for (const b of boxes) if (segmentHitsBox(route[i]!, route[i + 1]!, b)) return true;
  }
  return false;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Do two polylines cross each other (touching end points don't count)? */
export function routesCross(r1: Point[], r2: Point[]): boolean {
  for (let i = 0; i + 1 < r1.length; i++) {
    for (let j = 0; j + 1 < r2.length; j++) if (segmentsCross(r1[i]!, r1[i + 1]!, r2[j]!, r2[j + 1]!)) return true;
  }
  return false;
}

/**
 * The connector for one card: the most direct route that doesn't pass
 * through another card. Tries the point of the facing edge nearest the
 * control first, then other points along that edge; if every route is
 * blocked, the direct one is used.
 */
export function chooseRoute(side: Side, card: Box, anchor: Point, obstacles: Box[]): Point[] {
  const direct = leaderRoute(side, card, anchor);
  if (!routeHitsBoxes(direct.slice(1), obstacles)) return direct;
  const vertical = side === "left" || side === "right";
  const lo = vertical ? card.top : card.left, len = vertical ? card.height : card.width;
  const tries = [0.5, 0.15, 0.85, 0, 1].map((f) => lo + f * len);
  for (const along of tries) {
    const r = leaderRoute(side, card, anchor, along);
    if (!routeHitsBoxes(r.slice(1), obstacles)) return r;
  }
  return direct;
}
