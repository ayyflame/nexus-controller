// Guided controller test. A pure state machine fed with the controller state
// NEXUS publishes; it only reads input and never changes mappings,
// calibration, profiles or macros.
//
// A control passes when it is seen working fully:
// - button: pressed, then released (so a stuck button doesn't pass);
// - trigger: pressed to the end (raw ≥ 253) and released to 0 (raw ≤ 2);
// - stick: all four edges and all eight directions reached, then back to the centre;
// - touchpad: a touch seen, and the touchpad clicked.

import type { ControllerModel, ControllerState, MacroButton } from "../types/engine";
import {
  addStickSample, addTriggerSample, CENTER_RADIUS, emptyStickRange, emptyTriggerRange,
  PRESSED_RAW, RELEASED_RAW, stickRangeResult, type StickRange, type TriggerRange,
} from "./diagAnalog.ts";

export type CheckDef =
  | { id: string; kind: "button"; button: MacroButton; label: string }
  | { id: string; kind: "trigger"; side: "left" | "right"; label: string }
  | { id: string; kind: "stick"; side: "left" | "right"; label: string }
  | { id: string; kind: "touch"; label: string };

export interface StepDef { id: string; title: string; hint: string; checks: CheckDef[] }

const btn = (button: MacroButton, label: string): CheckDef => ({ id: button, kind: "button", button, label });

export const STEPS: StepDef[] = [
  { id: "face", title: "Face buttons", hint: "Press and release Cross, Circle, Square and Triangle.",
    checks: [btn("south", "Cross"), btn("east", "Circle"), btn("west", "Square"), btn("north", "Triangle")] },
  { id: "dpad", title: "D-pad", hint: "Press and release each direction.",
    checks: [btn("dpadUp", "Up"), btn("dpadDown", "Down"), btn("dpadLeft", "Left"), btn("dpadRight", "Right")] },
  { id: "bumpers", title: "Bumpers", hint: "Press and release L1 and R1.",
    checks: [btn("leftShoulder", "L1"), btn("rightShoulder", "R1")] },
  { id: "triggers", title: "Triggers", hint: "Pull L2 and R2 all the way down, then let them go completely.",
    checks: [{ id: "l2", kind: "trigger", side: "left", label: "L2" }, { id: "r2", kind: "trigger", side: "right", label: "R2" }] },
  { id: "clicks", title: "Stick clicks", hint: "Click both sticks (L3 and R3).",
    checks: [btn("leftStick", "L3"), btn("rightStick", "R3")] },
  { id: "lstick", title: "Left stick: full range", hint: "Roll the left stick slowly around the whole edge, then let it go.",
    checks: [{ id: "ls", kind: "stick", side: "left", label: "Left stick" }] },
  { id: "rstick", title: "Right stick: full range", hint: "Roll the right stick slowly around the whole edge, then let it go.",
    checks: [{ id: "rs", kind: "stick", side: "right", label: "Right stick" }] },
  { id: "touchpad", title: "Touchpad", hint: "Slide a finger across the touchpad, then click it.",
    checks: [{ id: "touch", kind: "touch", label: "Touch and click" }] },
  { id: "system", title: "Create, Options and PS", hint: "Press and release Create, Options and the PS button.",
    checks: [btn("select", "Create"), btn("start", "Options"), btn("home", "PS")] },
  { id: "extra", title: "Other inputs", hint: "Press and release the Mute button.",
    checks: [btn("mute", "Mute")] },
];

export type StepResult = "untested" | "pass" | "fail";

type Progress =
  | { kind: "button"; pressed: boolean; done: boolean }
  | { kind: "trigger"; range: TriggerRange; pressedEnd: boolean; done: boolean }
  | { kind: "stick"; range: StickRange; done: boolean }
  | { kind: "touch"; touched: boolean; clicked: boolean; done: boolean };

export interface TestState {
  step: number;
  results: Record<string, StepResult>;
  progress: Record<string, Progress>;
  finished: boolean;
  /** The steps for the controller the test started with. */
  steps: StepDef[];
}

/** The steps for one controller model. A DualShock 4 has no mute button
 *  (that step would never pass) and calls Create "Share". */
export function stepsFor(model?: ControllerModel | null): StepDef[] {
  if (model !== "dualShock4") return STEPS;
  return STEPS.filter((s) => s.id !== "extra").map((s) => s.id !== "system" ? s : {
    ...s, title: "Share, Options and PS", hint: "Press and release Share, Options and the PS button.",
    checks: [btn("select", "Share"), btn("start", "Options"), btn("home", "PS")],
  });
}

function freshProgress(c: CheckDef): Progress {
  switch (c.kind) {
    case "button": return { kind: "button", pressed: false, done: false };
    case "trigger": return { kind: "trigger", range: emptyTriggerRange(), pressedEnd: false, done: false };
    case "stick": return { kind: "stick", range: emptyStickRange(), done: false };
    case "touch": return { kind: "touch", touched: false, clicked: false, done: false };
  }
}

function stepProgress(s: StepDef): Record<string, Progress> {
  return Object.fromEntries(s.checks.map((c) => [c.id, freshProgress(c)]));
}

export function startTest(model?: ControllerModel | null): TestState {
  const steps = stepsFor(model);
  return {
    step: 0,
    results: Object.fromEntries(steps.map((s) => [s.id, "untested" as StepResult])),
    progress: stepProgress(steps[0]!),
    finished: false,
    steps,
  };
}

export function isPressed(s: ControllerState, b: MacroButton): boolean {
  const k = s.buttons;
  const d = s.dpad;
  switch (b) {
    case "south": return k.south; case "east": return k.east; case "west": return k.west; case "north": return k.north;
    case "leftShoulder": return k.leftShoulder; case "rightShoulder": return k.rightShoulder;
    case "leftStick": return k.leftStick; case "rightStick": return k.rightStick;
    case "start": return k.start; case "select": return k.select; case "home": return k.home;
    case "touchpad": return k.touchpad; case "mute": return k.mute;
    case "leftTrigger": return s.leftTrigger.digital; case "rightTrigger": return s.rightTrigger.digital;
    case "dpadUp": return d === "up" || d === "upLeft" || d === "upRight";
    case "dpadDown": return d === "down" || d === "downLeft" || d === "downRight";
    case "dpadLeft": return d === "left" || d === "upLeft" || d === "downLeft";
    case "dpadRight": return d === "right" || d === "upRight" || d === "downRight";
  }
}

function advance(c: CheckDef, p: Progress, s: ControllerState): Progress {
  if (p.done) return p;
  switch (p.kind) {
    case "button": {
      const on = isPressed(s, (c as Extract<CheckDef, { kind: "button" }>).button);
      if (on) return { ...p, pressed: true };
      return p.pressed ? { ...p, done: true } : p;
    }
    case "trigger": {
      const t = (c as Extract<CheckDef, { kind: "trigger" }>).side === "left" ? s.leftTrigger : s.rightTrigger;
      const range = addTriggerSample(p.range, t.raw);
      const pressedEnd = p.pressedEnd || t.raw >= PRESSED_RAW;
      return { kind: "trigger", range, pressedEnd, done: pressedEnd && t.raw <= RELEASED_RAW };
    }
    case "stick": {
      const st = (c as Extract<CheckDef, { kind: "stick" }>).side === "left" ? s.leftStick : s.rightStick;
      const range = addStickSample(p.range, st.x, st.y);
      const back = Math.hypot(st.x, st.y) <= CENTER_RADIUS;
      return { kind: "stick", range, done: stickRangeResult(range).complete && back };
    }
    case "touch": {
      const touched = p.touched || !!s.touchpad?.points.some((pt) => pt.active);
      const clicked = p.clicked || s.buttons.touchpad;
      return { kind: "touch", touched, clicked, done: touched && clicked && !s.buttons.touchpad };
    }
  }
}

/** Feeds one controller state to the current step. */
export function feed(t: TestState, s: ControllerState | null): TestState {
  if (!s || t.finished) return t;
  const step = t.steps[t.step]!;
  if (t.results[step.id] !== "untested") return t;
  const progress = Object.fromEntries(step.checks.map((c) => [c.id, advance(c, t.progress[c.id]!, s)]));
  const allDone = step.checks.every((c) => progress[c.id]!.done);
  return { ...t, progress, results: allDone ? { ...t.results, [step.id]: "pass" } : t.results };
}

export function checkDone(t: TestState, id: string): boolean { return !!t.progress[id]?.done; }
export function checkProgress(t: TestState, id: string): Progress | undefined { return t.progress[id]; }

export function markFailed(t: TestState): TestState {
  const step = t.steps[t.step]!;
  return t.results[step.id] === "pass" ? t : { ...t, results: { ...t.results, [step.id]: "fail" } };
}

/** Clears the current step's result and progress so it can be tried again. */
export function retry(t: TestState): TestState {
  const step = t.steps[t.step]!;
  return { ...t, finished: false, results: { ...t.results, [step.id]: "untested" }, progress: stepProgress(step) };
}

/** Moves to another step (keeping results); past the last step, finishes. */
export function goTo(t: TestState, index: number): TestState {
  if (index >= t.steps.length) return { ...t, finished: true };
  const i = Math.max(0, index);
  return { ...t, step: i, finished: false, progress: stepProgress(t.steps[i]!) };
}

export function summary(t: TestState): { pass: number; fail: number; untested: number } {
  const v = Object.values(t.results);
  return { pass: v.filter((r) => r === "pass").length, fail: v.filter((r) => r === "fail").length, untested: v.filter((r) => r === "untested").length };
}
