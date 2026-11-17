import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonMapping, buttonMarks, describeMapping } from "./buttonMapping.ts";
import { defaultProcessing } from "./processing.ts";
import { BUTTONS } from "./macros.ts";
import type { Macro, MacroButton, ProcessingConfig } from "../types/engine";

const name = (b: MacroButton) => BUTTONS[b].name;

function cfg(patch: Partial<ProcessingConfig> = {}): ProcessingConfig {
  return { ...defaultProcessing(), ...patch };
}

function macro(id: string, trigger: MacroButton | null, extra: Partial<Macro> = {}): Macro {
  return {
    id, name: `Macro ${id}`, description: "", enabled: true,
    steps: [{ id: "s", buttons: ["south"], holdMs: 50, delayAfterMs: 50 }],
    trigger, mode: "repeatWhileHeld", repeatDelayMs: 0, blockTrigger: true, createdAtMs: 0, updatedAtMs: 0, ...extra,
  };
}

test("an unmapped button sends itself", () => {
  const m = buttonMapping("south", cfg(), []);
  assert.deepEqual([m.kind, m.sends, m.also], ["normal", "south", []]);
  assert.deepEqual(describeMapping(m, name), ["Sends Cross (normal)."]);
  assert.deepEqual(buttonMarks(["south"], cfg(), []), {}, "nothing to mark");
});

test("remapped, also-press and disabled buttons are told apart", () => {
  const c = cfg({ remap: [
    { from: "south", to: "east" },
    { from: "west", to: "west", also: ["north"] },
    { from: "north", to: null },
    { from: "east", to: null, also: ["dpadUp"] },
    { from: "start", to: "start" }, // a no-op rule is still normal
  ] });
  assert.equal(buttonMapping("south", c, []).kind, "remapped");
  assert.deepEqual(describeMapping(buttonMapping("south", c, []), name), ["Remapped: sends Circle."]);
  assert.deepEqual(describeMapping(buttonMapping("west", c, []), name), ["Remapped: sends Square + Triangle."]);
  assert.equal(buttonMapping("north", c, []).kind, "disabled");
  assert.deepEqual(describeMapping(buttonMapping("north", c, []), name), ["Disabled: sends nothing to the game."]);
  assert.equal(buttonMapping("east", c, []).kind, "remapped", "sends something, so not disabled");
  assert.deepEqual(describeMapping(buttonMapping("east", c, []), name), ["Sends D-pad Up instead."]);
  assert.equal(buttonMapping("start", c, []).kind, "normal");
  const marks = buttonMarks(["south", "west", "north", "east", "start"], c, []);
  assert.deepEqual(Object.keys(marks).sort(), ["east", "north", "south", "west"]);
  assert.equal(marks.north?.disabled, true);
  assert.equal(marks.south?.remapped, true);
});

test("macros are shown on their physical trigger button only when they can run", () => {
  const macros = [
    macro("a", "rightStick"),
    macro("b", "rightStick", { mode: "toggle", blockTrigger: false }),
    macro("off", "leftStick", { enabled: false }),
    macro("empty", "home", { steps: [] }),
    macro("none", null),
  ];
  const m = buttonMapping("rightStick", cfg(), macros);
  assert.deepEqual(m.macros.map((x) => x.id), ["a", "b"]);
  const lines = describeMapping(m, name);
  assert.match(lines[1]!, /Starts the macro "Macro a" \(repeats while held; the button itself is hidden/);
  assert.match(lines[2]!, /"Macro b" \(toggles on\/off\)\.$/);
  const marks = buttonMarks(["rightStick", "leftStick", "home"], cfg(), macros);
  assert.equal(marks.rightStick?.macro, true);
  assert.equal(marks.leftStick, undefined, "disabled macro");
  assert.equal(marks.home, undefined, "macro without steps");
});

test("layers and the gyro button are explained", () => {
  const c = cfg({
    layers: [{ name: "Shift", activator: "leftShoulder", mode: "hold", remap: [{ from: "west", to: "dpadUp" }, { from: "north", to: null }] }],
  });
  c.gyro = { ...c.gyro, enabled: true, activation: "whileHeld", button: "leftTrigger", suppressButton: true };
  assert.deepEqual(describeMapping(buttonMapping("leftShoulder", c, []), name),
    ["Sends L1 (normal).", 'Switches the layer "Shift" (not sent to the game itself).']);
  assert.deepEqual(describeMapping(buttonMapping("west", c, []), name),
    ["Sends Square (normal).", 'In the layer "Shift": sends D-pad Up.']);
  assert.match(describeMapping(buttonMapping("north", c, []), name)[1]!, /sends nothing/);
  assert.match(describeMapping(buttonMapping("leftTrigger", c, []), name)[1]!, /Switches gyro aiming/);
  const marks = buttonMarks(["leftShoulder", "west", "leftTrigger", "south"], c, []);
  assert.deepEqual(Object.keys(marks).sort(), ["leftShoulder", "leftTrigger", "west"]);
  assert.equal(marks.west?.special, true);
  // Gyro always on: its button is not consumed.
  c.gyro = { ...c.gyro, activation: "always" };
  assert.equal(buttonMapping("leftTrigger", c, []).gyroButtonHidden, false);
});
