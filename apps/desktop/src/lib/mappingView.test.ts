import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonMapping } from "./buttonMapping.ts";
import {
  CALLOUT_BUTTONS, EMPTY_HISTORY, STUB, calloutFor, chooseRoute, gameLabel, leaderRoute, recordEdit, routeHitsBoxes, routesCross, redoRemap, resetButton,
  setRemapAlso, setRemapTarget, undoRemap,
} from "./mappingView.ts";
import { defaultProcessing } from "./processing.ts";
import { BUTTONS } from "./macros.ts";
import type { Macro, MacroButton, ProcessingConfig } from "../types/engine";

const cfg = (patch: Partial<ProcessingConfig> = {}): ProcessingConfig => ({ ...defaultProcessing(), ...patch });
const card = (b: MacroButton, c: ProcessingConfig, out: "xbox360" | "dualShock4" | "disabled" = "xbox360", macros: Macro[] = []) =>
  calloutFor(buttonMapping(b, c, macros), out);

test("every button has exactly one card around the picture", () => {
  const all = Object.keys(BUTTONS).sort();
  assert.deepEqual([...CALLOUT_BUTTONS].sort(), all);
  assert.equal(new Set(CALLOUT_BUTTONS).size, CALLOUT_BUTTONS.length);
});

test("cards name what the virtual controller sends, per output type", () => {
  assert.equal(gameLabel("north", "xbox360"), "Y");
  assert.equal(gameLabel("select", "xbox360"), "Back");
  assert.equal(gameLabel("home", "xbox360"), "Guide");
  assert.equal(gameLabel("leftTrigger", "xbox360"), "LT (analog)");
  assert.equal(gameLabel("touchpad", "xbox360"), null, "an Xbox 360 controller has no touchpad");
  assert.equal(gameLabel("mute", "xbox360"), null);
  assert.equal(gameLabel("touchpad", "dualShock4"), "Touchpad click");
  assert.equal(gameLabel("select", "dualShock4"), "Share");
  assert.equal(gameLabel("mute", "dualShock4"), null);
  assert.equal(gameLabel("south", "disabled"), "A", "output off shows the default Xbox names");
});

test("a card shows normal, remapped, combined, disabled and not-sent buttons", () => {
  assert.deepEqual(card("north", cfg()), { sends: "Y", tone: "normal", notes: [] });
  const c = cfg({ remap: [
    { from: "north", to: "south", also: [] },
    { from: "east", to: "east", also: ["leftShoulder"] },
    { from: "west", to: null, also: [] },
  ] });
  assert.deepEqual(card("north", c), { sends: "A", tone: "remapped", notes: [] });
  assert.equal(card("east", c).sends, "B + LB");
  assert.deepEqual(card("west", c), { sends: "Disabled", tone: "disabled", notes: [] });
  assert.deepEqual(card("touchpad", cfg()), { sends: "Not sent to games", tone: "unsent", notes: [] });
  assert.equal(card("touchpad", cfg(), "dualShock4").sends, "Touchpad click");
  const t = cfg({ remap: [{ from: "touchpad", to: "select", also: [] }] });
  assert.deepEqual(card("touchpad", t), { sends: "Back", tone: "remapped", notes: [] }, "remapping makes it usable");
});

test("a card notes macros, layers and the gyro button", () => {
  const m: Macro = {
    id: "m", name: "Rapid", description: "", enabled: true, steps: [{ id: "s", buttons: ["south"], holdMs: 50, delayAfterMs: 50 }],
    trigger: "rightShoulder", mode: "repeatWhileHeld", repeatDelayMs: 0, blockTrigger: true, activationMs: 0, createdAtMs: 0, updatedAtMs: 0,
  };
  assert.deepEqual(card("rightShoulder", cfg(), "xbox360", [m]).notes, ["Macro: Rapid"]);
  const c = cfg({ layers: [{ name: "Shift", activator: "leftStick", mode: "hold", remap: [{ from: "south", to: "east", also: [] }] }] });
  assert.deepEqual(card("leftStick", c).notes, ["Layer: Shift"]);
  assert.deepEqual(card("south", c).notes, ["Changes in Shift"]);
  const g = cfg({ gyro: { ...defaultProcessing().gyro, enabled: true, activation: "whileHeld", button: "leftShoulder", suppressButton: true } });
  assert.deepEqual(card("leftShoulder", g).notes, ["Gyro button"]);
});

test("edits produce the same remap rules the engine reads", () => {
  let c = setRemapTarget(cfg(), "north", "south");
  assert.deepEqual(c.remap, [{ from: "north", to: "south", also: [] }]);
  c = setRemapAlso(c, "north", "leftShoulder");
  assert.deepEqual(c.remap, [{ from: "north", to: "south", also: ["leftShoulder"] }], "keeps the target");
  c = setRemapTarget(c, "north", "off");
  assert.deepEqual(c.remap, [{ from: "north", to: null, also: ["leftShoulder"] }], "keeps the also button");
  c = setRemapTarget(c, "north", "same");
  assert.deepEqual(c.remap, [{ from: "north", to: "north", also: ["leftShoulder"] }]);
  c = setRemapAlso(c, "north", null);
  assert.deepEqual(c.remap, [], "back to normal leaves no rule");
  const two = setRemapTarget(setRemapTarget(cfg(), "east", "west"), "north", "south");
  assert.deepEqual(resetButton(two, "east").remap, [{ from: "north", to: "south", also: [] }], "reset touches one button only");
  const layered = cfg({ layers: [{ name: "L", activator: "home", mode: "toggle", remap: [{ from: "east", to: null, also: [] }] }] });
  assert.deepEqual(resetButton(setRemapTarget(layered, "east", "west"), "east").layers, layered.layers, "layers are untouched");
});

test("undo and redo walk the remap history", () => {
  const a = cfg().remap;
  const b = setRemapTarget(cfg(), "north", "south").remap;
  const c = setRemapTarget(cfg({ remap: b }), "east", "off").remap;
  let h = recordEdit(EMPTY_HISTORY, a, b);
  h = recordEdit(h, b, c);
  assert.equal(recordEdit(h, c, structuredClone(c)), h, "a no-op edit records nothing");
  const u1 = undoRemap(h, c)!;
  assert.deepEqual(u1.remap, b);
  const u2 = undoRemap(u1.history, u1.remap)!;
  assert.deepEqual(u2.remap, a);
  assert.equal(undoRemap(u2.history, u2.remap), null, "nothing more to undo");
  const r1 = redoRemap(u2.history, u2.remap)!;
  assert.deepEqual(r1.remap, b);
  const fresh = recordEdit(r1.history, b, setRemapTarget(cfg({ remap: b }), "west", "north").remap);
  assert.equal(fresh.future.length, 0, "a new edit clears redo");
});

test("a connector leaves its card on the side facing the controller and ends exactly on the control", () => {
  const control = { x: 510, y: 310 };
  const left = leaderRoute("left", { left: 0, top: 100, width: 120, height: 40 }, control);
  // Card edge at the height nearest the control (clamped inside the card), a short stub, then the control.
  assert.deepEqual(left, [{ x: 120, y: 131 }, { x: 120 + STUB, y: 131 }, control]);
  const level = leaderRoute("left", { left: 0, top: 290, width: 120, height: 40 }, control);
  assert.deepEqual(level[0], { x: 120, y: 310 }, "level with the control: a straight line");
  assert.deepEqual(leaderRoute("right", { left: 900, top: 100, width: 120, height: 40 }, control)[0], { x: 900, y: 131 });
  assert.deepEqual(leaderRoute("top", { left: 400, top: 0, width: 120, height: 40 }, control)[0], { x: 510, y: 40 });
  assert.deepEqual(leaderRoute("bottom", { left: 400, top: 600, width: 120, height: 40 }, control)[0], { x: 510, y: 600 });
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const r = leaderRoute(side, { left: 300, top: 300, width: 100, height: 40 }, control);
    assert.deepEqual(r[r.length - 1], control, `${side}: ends on the control`);
  }
});

test("a connector goes around other cards instead of through them", () => {
  // L2's card sits right above L1's; the trigger is below both.
  const l2 = { left: 100, top: 0, width: 150, height: 44 };
  const l1 = { left: 100, top: 52, width: 150, height: 44 };
  const trigger = { x: 175, y: 200 };
  const direct = leaderRoute("top", l2, trigger);
  assert.ok(routeHitsBoxes(direct.slice(1), [l1]), "the direct route would cross L1's card");
  // With L1 offset, a route along L2's edge clears it.
  const offset = { ...l1, left: 190 };
  const r = chooseRoute("top", l2, trigger, [offset]);
  assert.ok(!routeHitsBoxes(r.slice(1), [offset]));
  assert.deepEqual(r[r.length - 1], trigger);
});

test("crossing connectors are detected (touching ends are not crossings)", () => {
  assert.ok(routesCross([{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 0, y: 10 }, { x: 10, y: 0 }]));
  assert.ok(!routesCross([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 5 }, { x: 10, y: 5 }]));
  assert.ok(!routesCross([{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 10, y: 10 }, { x: 20, y: 0 }]));
});

test("Mapping cards follow the controller shown: no Mute card and Share on a DualShock 4", async () => {
  const { CALLOUTS, calloutsFor, shortName } = await import("./mappingView.ts");
  assert.equal(calloutsFor("dualSense"), CALLOUTS, "DualSense unchanged");
  const ds4 = calloutsFor("dualShock4");
  assert.deepEqual(ds4.bottom, ["home"]);
  assert.deepEqual(ds4.top, CALLOUTS.top);
  assert.deepEqual(ds4.left, CALLOUTS.left);
  assert.deepEqual(ds4.right, CALLOUTS.right);
  assert.equal(shortName("select", "dualShock4"), "Share");
  assert.equal(shortName("select", "dualSense"), "Create");
  assert.equal(shortName("north", "dualShock4"), "Triangle");
});
