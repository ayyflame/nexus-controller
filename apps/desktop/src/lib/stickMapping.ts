// Mirror of the engine's stick-to-button rules (crates/input-processing,
// `stick_directions`) for the live preview, plus labels. The engine is the
// authority; tests keep the two in step.

import type { MacroButton, StickButtons, StickRouting, StickSource } from "../types/engine";

export const DIR_UP = 1, DIR_DOWN = 2, DIR_LEFT = 4, DIR_RIGHT = 8;
const VERTICAL = DIR_UP | DIR_DOWN, HORIZONTAL = DIR_LEFT | DIR_RIGHT;

/** Directions pressed for a processed stick position, given what was pressed before. */
export function stickDirections(b: StickButtons, x: number, y: number, prev: number): number {
  const axis = (v: number, threshold: number, pos: number, neg: number) => {
    const on = (bit: number, m: number) => (prev & bit ? m > threshold - b.hysteresis : m >= threshold);
    if (v > 0 && on(pos, v)) return pos;
    if (v < 0 && on(neg, -v)) return neg;
    return 0;
  };
  let d = axis(y, b.thresholdY, DIR_UP, DIR_DOWN) | axis(x, b.thresholdX, DIR_RIGHT, DIR_LEFT);
  if (b.directions === "four" && d & VERTICAL && d & HORIZONTAL) {
    const heldV = !!(prev & VERTICAL) && !(prev & HORIZONTAL);
    const heldH = !!(prev & HORIZONTAL) && !(prev & VERTICAL);
    const keepVertical = heldV ? true : heldH ? false : Math.abs(y) / b.thresholdY >= Math.abs(x) / b.thresholdX;
    d &= keepVertical ? VERTICAL : HORIZONTAL;
  }
  return d;
}

/** The buttons a set of directions presses. */
export function directionButtons(b: StickButtons, d: number): MacroButton[] {
  const out: MacroButton[] = [];
  const add = (bit: number, btn: MacroButton | null) => { if (d & bit && btn && !out.includes(btn)) out.push(btn); };
  add(DIR_UP, b.up); add(DIR_DOWN, b.down); add(DIR_LEFT, b.left); add(DIR_RIGHT, b.right);
  return out;
}

export const ROUTING_PRESETS: Array<{ id: string; label: string; hint: string; routing: StickRouting }> = [
  { id: "normal", label: "Normal", hint: "Each stick is itself", routing: { leftOutput: "left", rightOutput: "right" } },
  { id: "swap", label: "Swap sticks", hint: "Left stick moves the game's right stick and the other way round", routing: { leftOutput: "right", rightOutput: "left" } },
];

export function routingPresetId(r: StickRouting): string | null {
  return ROUTING_PRESETS.find((p) => p.routing.leftOutput === r.leftOutput && p.routing.rightOutput === r.rightOutput)?.id ?? null;
}

const SOURCE: Record<StickSource, string> = { left: "Left stick", right: "Right stick", off: "Nothing (centred)" };
export const sourceLabel = (s: StickSource) => SOURCE[s];

/** One line describing where the sticks go. */
export function routingText(r: StickRouting): string {
  if (r.leftOutput === "left" && r.rightOutput === "right") return "Each stick controls its own side in games.";
  if (r.leftOutput === "right" && r.rightOutput === "left") return "Sticks are swapped: your left stick is the game's right stick.";
  return `Game's left stick: ${SOURCE[r.leftOutput].toLowerCase()} · game's right stick: ${SOURCE[r.rightOutput].toLowerCase()}.`;
}
