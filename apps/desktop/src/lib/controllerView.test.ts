import { test } from "node:test";
import assert from "node:assert/strict";
import { describeState, dpadLit } from "./controllerView.ts";
import type { ControllerState } from "../types/engine";

function state(): ControllerState {
  const stick = { x: 0, y: 0, rawX: 128, rawY: 128 };
  const trig = { value: 0, raw: 0, digital: false };
  return {
    leftStick: { ...stick }, rightStick: { ...stick }, leftTrigger: { ...trig }, rightTrigger: { ...trig },
    dpad: "neutral",
    buttons: { south: false, east: false, west: false, north: false, leftShoulder: false, rightShoulder: false,
      leftStick: false, rightStick: false, start: false, select: false, home: false, touchpad: false, mute: false },
    touchpad: null, motion: null, battery: null, sequence: null, format: "dualSenseUsb",
  };
}

test("d-pad directions light the right arms, including diagonals", () => {
  assert.deepEqual(dpadLit("neutral"), { up: false, down: false, left: false, right: false });
  assert.deepEqual(dpadLit(undefined), { up: false, down: false, left: false, right: false });
  assert.deepEqual(dpadLit("up"), { up: true, down: false, left: false, right: false });
  assert.deepEqual(dpadLit("downLeft"), { up: false, down: true, left: true, right: false });
  assert.deepEqual(dpadLit("upRight"), { up: true, down: false, left: false, right: true });
});

test("the screen-reader text lists everything pressed at once", () => {
  assert.equal(describeState(null), "No live input");
  const s = state();
  assert.equal(describeState(s), "Nothing pressed");
  s.buttons.south = true;
  s.buttons.leftShoulder = true;
  s.dpad = "upLeft";
  s.rightTrigger = { value: 0.42, raw: 107, digital: false };
  s.leftStick = { x: 0.8, y: 0, rawX: 230, rawY: 128 };
  assert.equal(describeState(s), "Pressed: Cross, L1, R2 42%, D-pad up, D-pad left, Left stick moved");
});

test("the picture's description names Share on a DualShock 4", async () => {
  const { describeState } = await import("./controllerView.ts");
  const { stateOf } = await import("./diagFixtures.ts");
  const s = stateOf({ buttons: { select: true } });
  assert.match(describeState(s), /Create/);
  assert.match(describeState({ ...s, format: "dualShock4Usb" }), /Share/);
});
