// Rules for the Mapping screen (Controller › Mapping): where each button's
// card sits around the controller picture, what the card says a game
// receives, and the remap edits. Pure, so they are unit-tested; the screen
// only renders them. The edits produce exactly the RemapRule shapes the
// engine already reads (crates/input-processing), no new settings.

import type { ButtonMapping } from "./buttonMapping";
import type { MacroButton, ProcessingConfig, RemapRule, VirtualOutputKind } from "../types/engine";
import type { ViewModel } from "./controller3d.ts";

/** Cards around the picture, in reading order per side (matches the DualSense layout). */
export const CALLOUTS: Record<"top" | "left" | "right" | "bottom", MacroButton[]> = {
  top: ["leftTrigger", "leftShoulder", "touchpad", "rightShoulder", "rightTrigger"],
  left: ["select", "dpadUp", "dpadRight", "dpadLeft", "dpadDown", "leftStick"],
  right: ["start", "north", "west", "east", "south", "rightStick"],
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

/**
 * Leader line from a card to its button. The line leaves the card on the
 * side facing the controller and ends at the centre of the button.
 */
export function leaderLine(side: keyof typeof CALLOUTS, card: Box, button: Box): { from: Point; to: Point } {
  const to = { x: button.left + button.width / 2, y: button.top + button.height / 2 };
  const midX = card.left + card.width / 2;
  const midY = card.top + card.height / 2;
  const from =
    side === "left" ? { x: card.left + card.width, y: midY }
      : side === "right" ? { x: card.left, y: midY }
        : side === "top" ? { x: midX, y: card.top + card.height }
          : { x: midX, y: card.top };
  return { from, to };
}
