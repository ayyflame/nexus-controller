import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, directionButtons, routingPresetId, routingText, stickDirections,
} from "./stickMapping.ts";
import { DEFAULT_STICK, DEFAULT_STICK_BUTTONS, STICK_PRESETS, applyStickPreset, defaultProcessing, withDefaults } from "./processing.ts";
import type { StickButtons } from "../types/engine";

const dpad: StickButtons = { ...DEFAULT_STICK_BUTTONS, enabled: true, up: "dpadUp", down: "dpadDown", left: "dpadLeft", right: "dpadRight" };

test("directions match the engine: thresholds, hysteresis and diagonals", () => {
  assert.equal(stickDirections(dpad, 0, 0.49, 0), 0);
  assert.equal(stickDirections(dpad, 0, 0.5, 0), DIR_UP);
  assert.equal(stickDirections(dpad, 0, 0.45, DIR_UP), DIR_UP, "hysteresis holds it");
  assert.equal(stickDirections(dpad, 0, 0.4, DIR_UP), 0, "released at threshold − hysteresis");
  assert.equal(stickDirections(dpad, 0.7, -0.7, 0), DIR_DOWN | DIR_RIGHT);
  assert.equal(stickDirections({ ...dpad, thresholdX: 0.3, thresholdY: 0.8, hysteresis: 0 }, 0.35, 0.7, 0), DIR_RIGHT);
});

test("four-way keeps the held direction through the diagonal", () => {
  const four = { ...dpad, directions: "four" as const, hysteresis: 0.05 };
  let d = stickDirections(four, 0.6, 0.8, 0);
  assert.equal(d, DIR_UP);
  const seen = [[0.6, 0.7], [0.8, 0.5], [0.85, 0.44], [0.9, 0]].map(([x, y]) => (d = stickDirections(four, x!, y!, d)));
  assert.deepEqual(seen, [DIR_UP, DIR_UP, DIR_RIGHT, DIR_RIGHT]);
  assert.equal(stickDirections(four, -0.9, 0, 0), DIR_LEFT);
});

test("directions name their buttons", () => {
  assert.deepEqual(directionButtons(dpad, DIR_UP | DIR_RIGHT), ["dpadUp", "dpadRight"]);
  assert.deepEqual(directionButtons({ ...dpad, right: null }, DIR_RIGHT), []);
});

test("routing presets and description", () => {
  assert.equal(routingPresetId({ leftOutput: "left", rightOutput: "right" }), "normal");
  assert.equal(routingPresetId({ leftOutput: "right", rightOutput: "left" }), "swap");
  assert.equal(routingPresetId({ leftOutput: "right", rightOutput: "off" }), null);
  assert.match(routingText({ leftOutput: "right", rightOutput: "left" }), /swapped/);
  assert.match(routingText({ leftOutput: "right", rightOutput: "off" }), /right stick.*nothing/);
});

test("older profiles get stick mapping defaults, and presets keep calibration and stick buttons", () => {
  const old = withDefaults({ leftStick: { ...DEFAULT_STICK, buttons: undefined as unknown as StickButtons } });
  assert.deepEqual(old.leftStick.buttons, DEFAULT_STICK_BUTTONS);
  assert.deepEqual(old.stickRouting, { leftOutput: "left", rightOutput: "right" });
  assert.deepEqual(defaultProcessing().stickRouting, { leftOutput: "left", rightOutput: "right" });
  const tuned = { ...DEFAULT_STICK, buttons: dpad, calibration: { ...DEFAULT_STICK.calibration, centerX: 0.04 } };
  for (const p of STICK_PRESETS) {
    const after = applyStickPreset(p, tuned);
    assert.deepEqual(after.buttons, dpad, p.id);
    assert.equal(after.calibration.centerX, 0.04, p.id);
  }
});
