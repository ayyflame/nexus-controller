import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AT_REST, MAX_TILT, TRIGGER_SWING, VIEWS, ZOOM, facesCamera, fitRadius, orbitBetween, orbitToOffset, stickPose, triggerAngle,
  visualFrom, visualKey,
} from "./controller3d.ts";
import { parseFinish, parseViewMode } from "./controllerViewMode.ts";
import { stateOf } from "./diagFixtures.ts";
import type { ControllerState } from "../types/engine";

const state = (patch: (s: ControllerState) => void): ControllerState => { const s = stateOf(); patch(s); return s; };

test("no controller, or not live: the model rests with nothing lit", () => {
  assert.equal(visualFrom(null, true), AT_REST);
  assert.equal(visualFrom(state((s) => { s.buttons.south = true; }), false), AT_REST);
  assert.equal(AT_REST.connected, false);
  assert.ok(Object.values(AT_REST.lit).every((v) => !v));
});

test("every button lights only its own part, D-pad diagonals light two arms", () => {
  const buttons = ["south", "east", "west", "north", "leftShoulder", "rightShoulder", "leftStick", "rightStick",
    "start", "select", "home", "touchpad", "mute"] as const;
  for (const b of buttons) {
    const v = visualFrom(state((s) => { s.buttons[b] = true; }), true);
    assert.deepEqual(Object.entries(v.lit).filter(([, on]) => on).map(([k]) => k), [b], b);
  }
  const d = visualFrom(state((s) => { s.dpad = "downRight"; }), true);
  assert.deepEqual(Object.entries(d.lit).filter(([, on]) => on).map(([k]) => k).sort(), ["dpadDown", "dpadRight"]);
});

test("sticks lean the way they are pushed, limited to the circle", () => {
  assert.deepEqual(stickPose(1, 0, false), { rotX: -0, rotY: MAX_TILT, pressed: false });
  assert.deepEqual(stickPose(0, 1, false), { rotX: -MAX_TILT, rotY: 0, pressed: false }, "up tilts the top away");
  const corner = stickPose(1, 1, true);
  assert.ok(Math.abs(Math.hypot(corner.rotX, corner.rotY) - MAX_TILT) < 1e-9, "corner limited to the circle");
  assert.equal(corner.pressed, true);
  assert.deepEqual(stickPose(Number.NaN, 0, false), { rotX: -0, rotY: 0, pressed: false });
  const v = visualFrom(state((s) => { s.leftStick.x = -0.5; s.rightStick.y = -0.25; }), true);
  assert.equal(v.leftStick.rotY, -0.5 * MAX_TILT);
  assert.equal(v.rightStick.rotX, 0.25 * MAX_TILT);
});

test("L2/R2 follow analog pressure and swing the tip towards the body", () => {
  const v = visualFrom(state((s) => { s.leftTrigger.value = 0.5; s.rightTrigger.value = 1.4; }), true);
  assert.equal(v.l2, 0.5);
  assert.equal(v.r2, 1, "clamped");
  assert.equal(v.lit.leftTrigger, true);
  assert.equal(triggerAngle(0), -0);
  assert.equal(triggerAngle(1), -TRIGGER_SWING);
  // The blade's tip hangs below and behind the hinge (y −, z −). Rotating it by
  // the trigger angle about x must move it up into the body (z +) and towards the player (y −).
  const [y, z] = [-0.22, -0.22];
  const a = triggerAngle(1);
  const y2 = y * Math.cos(a) - z * Math.sin(a);
  const z2 = y * Math.sin(a) + z * Math.cos(a);
  assert.ok(z2 > z, "into the body");
  assert.ok(y2 < y, "towards the player");
});

test("touches map to 0…1 on the touchpad; only active points show", () => {
  const v = visualFrom(state((s) => {
    s.touchpad = { width: 1920, height: 1080, points: [{ active: true, id: 3, x: 960, y: 1080 }, { active: false, id: 4, x: 0, y: 0 }] };
  }), true);
  assert.deepEqual(v.touches, [{ id: 3, u: 0.5, v: 1 }]);
});

test("the view redraws only when something visible changes", () => {
  const a = visualFrom(state(() => {}), true);
  const b = visualFrom(state((s) => { s.leftStick.x = 0.0001; s.sequence = 99; }), true);
  assert.equal(visualKey(a), visualKey(b), "invisible differences (tiny drift, sequence) don't redraw");
  const c = visualFrom(state((s) => { s.buttons.north = true; }), true);
  assert.notEqual(visualKey(a), visualKey(c));
  assert.notEqual(visualKey(a), visualKey(AT_REST), "connection state is part of it");
});

test("camera views, zoom limits and the short way round", () => {
  const off = orbitToOffset(VIEWS.front);
  assert.ok(Math.abs(off[0]) < 1e-9 && Math.abs(off[1]) < 1e-9 && off[2] > 10, "front looks along −z at the face");
  const rear = orbitToOffset(VIEWS.rear);
  assert.ok(rear[2] < -10, "rear is behind");
  assert.ok(orbitToOffset(VIEWS.top)[1] > 8, "top is above the bumpers");
  for (const v of Object.values(VIEWS)) assert.ok(v.radius >= ZOOM.min && v.radius <= ZOOM.max);
  // From 350° to 10° turns 20°, not 340°.
  const mid = orbitBetween({ radius: 10, phi: 1, theta: (350 * Math.PI) / 180 }, { radius: 10, phi: 1, theta: (10 * Math.PI) / 180 }, 0.5);
  assert.ok(Math.abs(((mid.theta * 180) / Math.PI) - 360) < 1e-6);
  assert.deepEqual(orbitBetween(VIEWS.front, VIEWS.rear, 1).phi, VIEWS.rear.phi);
  assert.equal(fitRadius(10, 2), 10, "wide panel: as set");
  assert.equal(fitRadius(10, 1), 15, "narrow panel: further back");
  assert.equal(fitRadius(16, 0.5), ZOOM.max, "never past the zoom limit");
});

test("leader lines only for controls facing the camera", () => {
  const face = { pos: [0, 0, 1] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  assert.equal(facesCamera(face, [0, 0, 10]), true);
  assert.equal(facesCamera(face, [0, 0, -10]), false, "rear view hides face-button lines");
});

test("view preferences: 3D and Midnight Black unless chosen otherwise", () => {
  assert.equal(parseViewMode(null), "3d");
  assert.equal(parseViewMode("flat"), "flat");
  assert.equal(parseViewMode("junk"), "3d");
  assert.equal(parseFinish(null), "black");
  assert.equal(parseFinish("white"), "white");
});

test("the model follows the controller and stays after an unplug", async () => {
  const { modelFor } = await import("./controller3d.ts");
  // The state says which controller it came from.
  assert.equal(modelFor("dualShock4Usb", null, "dualSense"), "dualShock4");
  assert.equal(modelFor("dualSenseUsb", "dualShock4", "dualShock4"), "dualSense");
  assert.equal(modelFor("dualSenseBluetooth", null, "dualShock4"), "dualSense");
  // No input yet, or a preview that doesn't say: the connected controller.
  assert.equal(modelFor("unknown", "dualShock4", "dualSense"), "dualShock4");
  assert.equal(modelFor(null, "dualSenseEdge", "dualShock4"), "dualSense", "an Edge is shown as a DualSense");
  // Nothing connected: the last model stays (with the usual badge); first start shows the DualSense.
  assert.equal(modelFor(null, null, "dualShock4"), "dualShock4");
  assert.equal(modelFor(undefined, undefined, "dualSense"), "dualSense");
});

test("a DualShock 4 state lights the same controls, with no Mute", () => {
  const s = state((x) => {
    Object.assign(x.buttons, { south: true, select: true, home: true, touchpad: true, mute: false });
    x.format = "dualShock4Usb";
  });
  const v = visualFrom(s, true);
  assert.ok(v.lit.south && v.lit.select && v.lit.home && v.lit.touchpad);
  assert.equal(v.lit.mute, false);
});
