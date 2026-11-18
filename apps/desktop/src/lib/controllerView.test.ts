import { test } from "node:test";
import assert from "node:assert/strict";
import { describeState, dpadLit, stickOffset, touchPosition, triggerLevel, triggerPath } from "./controllerView.ts";
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

test("stick caps move with the real values; up on the stick is up on screen", () => {
  assert.deepEqual(stickOffset(0, 0, 15), [0, -0]);
  assert.deepEqual(stickOffset(1, 1, 15), [15, -15], "right and up");
  assert.deepEqual(stickOffset(-1, -1, 15), [-15, 15], "left and down");
  assert.deepEqual(stickOffset(0.5, 0, 20), [10, -0]);
  assert.deepEqual(stickOffset(3, -3, 15), [15, 15], "never outside the well");
  assert.deepEqual(stickOffset(Number.NaN, 0, 15), [0, -0]);
});

test("trigger pressure fills the visible part of the trigger proportionally and safely", () => {
  const t = { outer: 10, inner: 40, top: 0, visibleBottom: 20, bottom: 24, dip: 2 };
  assert.deepEqual(triggerLevel(0, t), { fillTop: 20, dip: 0 }, "released: nothing above the bumper");
  assert.deepEqual(triggerLevel(0.5, t), { fillTop: 10, dip: 1 });
  assert.deepEqual(triggerLevel(1, t), { fillTop: 0, dip: 2 });
  assert.deepEqual(triggerLevel(1.7, t), { fillTop: 0, dip: 2 });
  assert.deepEqual(triggerLevel(-0.2, t), { fillTop: 20, dip: 0 });
  assert.deepEqual(triggerLevel(Number.NaN, t), { fillTop: 20, dip: 0 });
});

test("L2 and R2 outlines are mirror images", () => {
  const l = { outer: 10, inner: 40, top: 0, visibleBottom: 20, bottom: 24, dip: 2 };
  const r = { ...l, outer: 90, inner: 60 };
  const xs = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const left = xs(triggerPath(l));
  const right = xs(triggerPath(r));
  assert.equal(left.length, right.length);
  left.forEach(([x, y], i) => {
    assert.ok(Math.abs(x + right[i]![0] - 100) < 1e-9, "mirrored about x = 50");
    assert.equal(y, right[i]![1]);
  });
  assert.ok(left.every(([x, y]) => x >= 10 && x <= 40 && y >= 0 && y <= 24), "stays inside its box");
});

test("touch points land inside the drawn touchpad", () => {
  const box = { x: 100, y: 50, w: 200, h: 100 };
  assert.deepEqual(touchPosition({ x: 0, y: 0 }, { width: 1920, height: 1080 }, box), [100, 50]);
  assert.deepEqual(touchPosition({ x: 960, y: 540 }, { width: 1920, height: 1080 }, box), [200, 100]);
  assert.deepEqual(touchPosition({ x: 5000, y: 5000 }, { width: 1920, height: 1080 }, box), [300, 150]);
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
