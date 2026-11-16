// Run with: npm test  (Node's built-in test runner, no extra dependencies)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newMacro, newStep, pressedButtons, sequenceAt, stateWithButtons, totalDuration,
  triggerBlockers, triggerConflict, validateMacro,
} from "./macros.ts";
import type { Macro, MacroStep } from "../types/engine";

const step = (buttons: MacroStep["buttons"], holdMs: number, delayAfterMs: number): MacroStep =>
  ({ id: Math.random().toString(), buttons, holdMs, delayAfterMs });

const macro = (over: Partial<Macro>): Macro => ({ ...newMacro(), name: "M", steps: [step(["south"], 100, 50)], ...over });

test("sequenceAt matches the engine's timeline (same cases as playback.rs)", () => {
  const steps = [step(["south"], 100, 50), step(["east"], 100, 0)];
  assert.deepEqual(sequenceAt(steps, 0), { step: 0, pressed: true, finished: false });
  assert.equal(sequenceAt(steps, 99).pressed, true);
  assert.deepEqual(sequenceAt(steps, 100), { step: 0, pressed: false, finished: false });
  assert.deepEqual(sequenceAt(steps, 150), { step: 1, pressed: true, finished: false });
  assert.equal(sequenceAt(steps, 250).finished, true);
  assert.equal(sequenceAt([], 0).finished, true);
  assert.equal(totalDuration(steps), 250);
});

test("new steps use sensible defaults", () => {
  const s = newStep(["north"]);
  assert.equal(s.holdMs, 100);
  assert.equal(s.delayAfterMs, 150);
  assert.ok(s.id.length > 0);
  assert.notEqual(newStep(["north"]).id, s.id);
});

test("validation guides the user", () => {
  const issues = validateMacro(macro({ name: " ", steps: [] }), []);
  assert.deepEqual(issues.map((i) => i.field), ["name", "steps"]);
  assert.equal(validateMacro(macro({}), []).length, 0);
  const existing = macro({ id: "a", name: "Reload" });
  assert.equal(validateMacro(macro({ name: "reload" }), [existing])[0]?.field, "name");
});

test("trigger conflicts only between enabled macros", () => {
  const a = macro({ id: "a", name: "A", trigger: "rightStick" });
  const b = macro({ id: "b", name: "B", trigger: "rightStick" });
  assert.match(triggerConflict(b, [a]) ?? "", /already starts “A”/);
  assert.equal(triggerConflict({ ...b, enabled: false }, [a]), null);
  assert.equal(triggerConflict(b, [{ ...a, enabled: false }]), null);
  const blocked = triggerBlockers(b, [a]);
  assert.ok(blocked.home, "PS button reserved");
  assert.ok(blocked.rightStick, "used by A");
  assert.equal(triggerBlockers(a, [a]).rightStick, undefined, "own trigger stays selectable");
});

test("preview state presses exactly the given buttons", () => {
  const s = stateWithButtons(["south", "dpadUp", "dpadRight", "rightTrigger"]);
  assert.equal(s.buttons.south, true);
  assert.equal(s.buttons.east, false);
  assert.equal(s.dpad, "upRight");
  assert.equal(s.rightTrigger.value, 1);
  assert.deepEqual(pressedButtons(s).sort(), ["dpadRight", "dpadUp", "rightTrigger", "south"]);
  assert.deepEqual(pressedButtons(stateWithButtons([])), []);
  assert.deepEqual(pressedButtons(null), []);
});

import { MACRO_TEMPLATES } from "./macroTemplates.ts";
import { isNewer } from "./updates.ts";

test("macro templates produce valid, editable sequences", () => {
  for (const t of MACRO_TEMPLATES) {
    const steps = t.build("north");
    assert.ok(steps.length > 0, t.id);
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, "unique ids");
    assert.equal(validateMacro({ ...newMacro(), name: t.name, steps }, []).length, 0, t.id);
    assert.ok(steps.every((s) => s.buttons[0] === "north"));
  }
});

test("update version comparison", () => {
  assert.ok(isNewer("v0.2.0", "0.1.0"));
  assert.ok(isNewer("0.10.0", "0.9.9"));
  assert.ok(!isNewer("v0.1.0", "0.1.0"));
  assert.ok(!isNewer("0.0.9", "0.1.0"));
});
