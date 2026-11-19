import { test } from "node:test";
import assert from "node:assert/strict";
import { comboProblem, comboText, newCombo, setSlot } from "./combos.ts";
import { BUTTONS } from "./macros.ts";
import type { ComboRule } from "../types/engine";

test("a new combination is valid: L1 + R1 → Triangle, inputs hidden", () => {
  const c = newCombo();
  assert.equal(comboProblem(c, [c]), null);
  assert.equal(comboText(c, (b) => BUTTONS[b].name), "L1 + R1 → Triangle");
  assert.equal(c.hideInputs, true);
});

test("problems match what the engine would drop", () => {
  const one: ComboRule = { buttons: ["south", "south"], sends: ["north"], hideInputs: true };
  assert.match(comboProblem(one, [one])!, /two different/);
  const none: ComboRule = { buttons: ["south", "east"], sends: [], hideInputs: true };
  assert.match(comboProblem(none, [none])!, /what it presses/);
  const a: ComboRule = { buttons: ["south", "east"], sends: ["north"], hideInputs: true };
  const b: ComboRule = { buttons: ["east", "south"], sends: ["west"], hideInputs: false };
  assert.equal(comboProblem(a, [a, b]), null, "the first one works");
  assert.match(comboProblem(b, [a, b])!, /already uses/);
});

test("editing slots keeps buttons distinct and within the limit", () => {
  assert.deepEqual(setSlot(["south", "east"], 1, "south", 3), ["south"]);
  assert.deepEqual(setSlot(["south", "east"], 2, "west", 3), ["south", "east", "west"]);
  assert.deepEqual(setSlot(["south", "east", "west"], 1, null, 3), ["south", "west"]);
  assert.deepEqual(setSlot(["south", "east", "west"], 3, "north", 3), ["south", "east", "west"]);
});
