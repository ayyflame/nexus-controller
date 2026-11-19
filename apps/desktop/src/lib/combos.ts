// Button combinations (Controller › Mapping): holding 2–3 buttons together
// presses 1–3 others. The same limits as the engine
// (crates/input-processing, ComboRule); pure, unit-tested.

import type { ComboRule, MacroButton } from "../types/engine";

export const MAX_COMBOS = 8;
export const MAX_COMBO_BUTTONS = 3;
export const MAX_COMBO_SENDS = 3;

export function newCombo(): ComboRule {
  return { buttons: ["leftShoulder", "rightShoulder"], sends: ["north"], hideInputs: true };
}

/** Why a combination won't work as entered (the engine would drop it), or null. */
export function comboProblem(c: ComboRule, all: ComboRule[]): string | null {
  const buttons = [...new Set(c.buttons)];
  if (buttons.length < 2) return "Pick at least two different buttons to hold.";
  if (buttons.length > MAX_COMBO_BUTTONS) return `At most ${MAX_COMBO_BUTTONS} buttons.`;
  if (!c.sends.length) return "Pick what it presses.";
  const key = (x: ComboRule) => [...new Set(x.buttons)].sort().join("+");
  const first = all.findIndex((x) => key(x) === key(c));
  if (first !== all.indexOf(c)) return "Another combination already uses these buttons; only the first one works.";
  return null;
}

/** Replaces slot `i` of a list (null removes it), keeping at most `max` distinct entries. */
export function setSlot(list: MacroButton[], i: number, b: MacroButton | null, max: number): MacroButton[] {
  const next = [...list];
  if (b === null) next.splice(i, 1); else next[i] = b;
  return [...new Set(next.filter(Boolean))].slice(0, max);
}

/** "L1 + R1 → Triangle" style summary. */
export function comboText(c: ComboRule, name: (b: MacroButton) => string): string {
  return `${c.buttons.map(name).join(" + ")} → ${c.sends.map(name).join(" + ") || "nothing"}`;
}
