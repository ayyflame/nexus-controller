// Macro Studio helpers: button metadata, defaults, timeline maths and
// client-side validation. The Rust engine (crates/macro-engine) is the
// authority; these mirror its rules so the UI can guide users instantly.

import type {
  ControllerState, Macro, MacroButton, MacroStep, PlaybackMode, ValidationIssue,
} from "../types/engine";

export interface ButtonInfo {
  id: MacroButton;
  /** Full name shown in tooltips and lists. */
  name: string;
  /** Short label for chips. */
  short: string;
  /** Face buttons render a shape instead of text. */
  shape?: "triangle" | "circle" | "cross" | "square";
}

export const BUTTONS: Record<MacroButton, ButtonInfo> = {
  north: { id: "north", name: "Triangle", short: "△", shape: "triangle" },
  east: { id: "east", name: "Circle", short: "○", shape: "circle" },
  south: { id: "south", name: "Cross", short: "✕", shape: "cross" },
  west: { id: "west", name: "Square", short: "□", shape: "square" },
  leftShoulder: { id: "leftShoulder", name: "L1", short: "L1" },
  rightShoulder: { id: "rightShoulder", name: "R1", short: "R1" },
  leftTrigger: { id: "leftTrigger", name: "L2", short: "L2" },
  rightTrigger: { id: "rightTrigger", name: "R2", short: "R2" },
  leftStick: { id: "leftStick", name: "L3 (left stick click)", short: "L3" },
  rightStick: { id: "rightStick", name: "R3 (right stick click)", short: "R3" },
  start: { id: "start", name: "Options", short: "Options" },
  select: { id: "select", name: "Create", short: "Create" },
  home: { id: "home", name: "PS button", short: "PS" },
  touchpad: { id: "touchpad", name: "Touchpad click", short: "Touchpad" },
  mute: { id: "mute", name: "Mute", short: "Mute" },
  dpadUp: { id: "dpadUp", name: "D-pad Up", short: "▲" },
  dpadDown: { id: "dpadDown", name: "D-pad Down", short: "▼" },
  dpadLeft: { id: "dpadLeft", name: "D-pad Left", short: "◀" },
  dpadRight: { id: "dpadRight", name: "D-pad Right", short: "▶" },
};

export function buttonNames(buttons: MacroButton[]): string {
  return buttons.map((b) => BUTTONS[b].name).join(" + ");
}

// ---- Limits and defaults (match crates/macro-engine/src/model.rs) ----

export const LIMITS = {
  minHoldMs: 20,
  maxHoldMs: 10_000,
  maxDelayMs: 10_000,
  maxSteps: 200,
  maxNameLength: 60,
  maxDescriptionLength: 300,
};

export const DEFAULT_HOLD_MS = 100;
export const DEFAULT_DELAY_MS = 150;
export const DEFAULT_REPEAT_DELAY_MS = 50;

export const HOLD_PRESETS = [
  { label: "Tap", ms: 60, hint: "A quick tap" },
  { label: "Press", ms: 100, hint: "A normal button press" },
  { label: "Hold", ms: 400, hint: "Hold the button briefly" },
  { label: "Long hold", ms: 1000, hint: "Hold for one second" },
];

export const DELAY_PRESETS = [
  { label: "None", ms: 0, hint: "Next action starts immediately" },
  { label: "Short", ms: 100, hint: "A short pause" },
  { label: "Normal", ms: 150, hint: "A natural pause between presses" },
  { label: "Long", ms: 500, hint: "Half a second" },
];

export const MODES: Record<PlaybackMode, { title: string; description: string }> = {
  once: {
    title: "Play Once",
    description: "Press the button once and the whole sequence plays one time.",
  },
  repeatWhileHeld: {
    title: "Repeat While Held",
    description: "The sequence keeps repeating while you hold the button and stops when you let go.",
  },
  toggle: {
    title: "Toggle On/Off",
    description: "Press once to start repeating. Press again to stop.",
  },
};

let counter = 0;
export function uid(prefix = "s"): string {
  counter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `${prefix}-${rand}-${counter}`;
}

export function newStep(buttons: MacroButton[]): MacroStep {
  return { id: uid(), buttons, holdMs: DEFAULT_HOLD_MS, delayAfterMs: DEFAULT_DELAY_MS };
}

export function newMacro(): Macro {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    steps: [],
    trigger: null,
    mode: "once",
    repeatDelayMs: DEFAULT_REPEAT_DELAY_MS,
    blockTrigger: true,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

// ---- Timeline ----

export function totalDuration(steps: MacroStep[]): number {
  return steps.reduce((t, s) => t + s.holdMs + s.delayAfterMs, 0);
}

export interface SequencePoint { step: number | null; pressed: boolean; finished: boolean }

/** Same rules as `sequence_at` in the engine. */
export function sequenceAt(steps: MacroStep[], elapsedMs: number): SequencePoint {
  let t = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    t += s.holdMs;
    if (elapsedMs < t) return { step: i, pressed: true, finished: false };
    t += s.delayAfterMs;
    if (elapsedMs < t) return { step: i, pressed: false, finished: false };
  }
  return { step: null, pressed: false, finished: true };
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 2)} s`;
  return `${Math.round(ms)} ms`;
}

const IDLE_STICK = { x: 0, y: 0, rawX: 128, rawY: 128 };

/** A controller state with only `buttons` pressed, for the visual preview. */
export function stateWithButtons(buttons: MacroButton[]): ControllerState {
  const has = (b: MacroButton) => buttons.includes(b);
  const v = has("dpadUp"), d = has("dpadDown"), l = has("dpadLeft"), r = has("dpadRight");
  const dpad = v ? (l ? "upLeft" : r ? "upRight" : "up")
    : d ? (l ? "downLeft" : r ? "downRight" : "down")
      : l ? "left" : r ? "right" : "neutral";
  const trigger = (on: boolean) => ({ value: on ? 1 : 0, raw: on ? 255 : 0, digital: on });
  return {
    leftStick: IDLE_STICK, rightStick: IDLE_STICK,
    leftTrigger: trigger(has("leftTrigger")), rightTrigger: trigger(has("rightTrigger")),
    dpad,
    buttons: {
      south: has("south"), east: has("east"), west: has("west"), north: has("north"),
      leftShoulder: has("leftShoulder"), rightShoulder: has("rightShoulder"),
      leftStick: has("leftStick"), rightStick: has("rightStick"),
      start: has("start"), select: has("select"), home: has("home"),
      touchpad: has("touchpad"), mute: has("mute"),
    },
    touchpad: null, motion: null, battery: null, sequence: null, format: "unknown",
  };
}

// ---- Validation (mirror of validate_macro) ----

export function validateMacro(m: Macro, others: Macro[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = m.name.trim();
  const rest = others.filter((o) => o.id !== m.id || !m.id);
  if (!name) issues.push({ field: "name", message: "Give your macro a name." });
  else if (name.length > LIMITS.maxNameLength)
    issues.push({ field: "name", message: `Keep the name under ${LIMITS.maxNameLength} characters.` });
  else if (rest.some((o) => o.name.trim().toLowerCase() === name.toLowerCase()))
    issues.push({ field: "name", message: `You already have a macro called “${name}”.` });
  if (m.description.length > LIMITS.maxDescriptionLength)
    issues.push({ field: "description", message: `Keep the description under ${LIMITS.maxDescriptionLength} characters.` });
  if (m.steps.length === 0) issues.push({ field: "steps", message: "Add at least one action to the sequence." });
  if (m.steps.length > LIMITS.maxSteps)
    issues.push({ field: "steps", message: `A macro can have at most ${LIMITS.maxSteps} actions.` });
  m.steps.forEach((s, i) => {
    if (s.buttons.length === 0) issues.push({ field: "steps", message: `Action ${i + 1} has no button.` });
  });
  const conflict = triggerConflict(m, others);
  if (conflict) issues.push({ field: "trigger", message: conflict });
  return issues;
}

/** Message if another enabled macro already uses this macro's trigger. */
export function triggerConflict(m: Macro, others: Macro[]): string | null {
  if (!m.trigger || !m.enabled) return null;
  const other = others.find((o) => o.id !== m.id && o.enabled && o.trigger === m.trigger);
  return other
    ? `This button already starts “${other.name}”. Choose another button or turn that macro off.`
    : null;
}

/** Which buttons can't be chosen as a trigger, and why. */
export function triggerBlockers(m: Macro, others: Macro[]): Partial<Record<MacroButton, string>> {
  const blocked: Partial<Record<MacroButton, string>> = { home: "The PS button is reserved by the system." };
  for (const o of others) {
    if (o.id !== m.id && o.enabled && o.trigger) {
      blocked[o.trigger] = `Already starts “${o.name}”`;
    }
  }
  return blocked;
}

/** Buttons pressed in a controller state (same rules as the engine). */
export function pressedButtons(s: ControllerState | null | undefined): MacroButton[] {
  if (!s) return [];
  const b = s.buttons;
  const d = s.dpad;
  const out: MacroButton[] = [];
  const add = (on: boolean, id: MacroButton) => { if (on) out.push(id); };
  add(b.south, "south"); add(b.east, "east"); add(b.west, "west"); add(b.north, "north");
  add(b.leftShoulder, "leftShoulder"); add(b.rightShoulder, "rightShoulder");
  add(s.leftTrigger.value >= 0.5, "leftTrigger"); add(s.rightTrigger.value >= 0.5, "rightTrigger");
  add(b.leftStick, "leftStick"); add(b.rightStick, "rightStick");
  add(b.start, "start"); add(b.select, "select"); add(b.home, "home");
  add(b.touchpad, "touchpad"); add(b.mute, "mute");
  add(d === "up" || d === "upLeft" || d === "upRight", "dpadUp");
  add(d === "down" || d === "downLeft" || d === "downRight", "dpadDown");
  add(d === "left" || d === "upLeft" || d === "downLeft", "dpadLeft");
  add(d === "right" || d === "upRight" || d === "downRight", "dpadRight");
  return out;
}
