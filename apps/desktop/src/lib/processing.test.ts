/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STICK, evaluateCurve, processStick, shapeMagnitude, triggerOutput } from "./processing.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;

// Same cases as crates/input-processing/src/processing_tests.rs so the
// on-screen previews match what the engine does.
test("deadzone, outer deadzone and anti-deadzone match the engine", () => {
  const c = { ...DEFAULT_STICK, deadzone: 0.1 };
  assert.deepEqual(processStick(c, 0.05, -0.05), [0, 0]);
  assert.ok(close(processStick(c, 0.55, 0)[0], 0.5));
  assert.ok(close(shapeMagnitude({ ...DEFAULT_STICK, deadzone: 0, outerDeadzone: 0.1 }, 0.9), 1));
  const anti = { ...DEFAULT_STICK, deadzone: 0.1, antiDeadzone: 0.2 };
  assert.equal(shapeMagnitude(anti, 0.05), 0);
  assert.ok(close(shapeMagnitude(anti, 0.1001), 0.2));
  assert.ok(close(shapeMagnitude({ ...DEFAULT_STICK, deadzone: 0, sensitivity: 2 }, 0.25), 0.5));
});

test("curves match the engine", () => {
  assert.ok(close(evaluateCurve({ type: "power", exponent: 2 }, 0.5), 0.25));
  const custom = { type: "custom" as const, points: [{ x: 0.5, y: 0.2 }] };
  assert.ok(close(evaluateCurve(custom, 0.25), 0.1));
  assert.ok(close(evaluateCurve(custom, 0.75), 0.6));
});

test("axial, circular and inversion match the engine", () => {
  const axial = { ...DEFAULT_STICK, deadzone: 0.2, shape: "axial" as const, circular: false };
  const [x, y] = processStick(axial, 0.1, 0.9);
  assert.equal(x, 0);
  assert.ok(close(y, 0.875));
  const [cx, cy] = processStick({ ...DEFAULT_STICK, deadzone: 0 }, 1, 1);
  assert.ok(close(Math.hypot(cx, cy), 1));
  assert.deepEqual(processStick({ ...DEFAULT_STICK, deadzone: 0, invertY: true }, 0, 1), [0, -1]);
});

test("trigger output matches the engine", () => {
  const c = { deadzone: 0.1, maxInput: 0.9, outputMin: 0.2, outputMax: 0.8 };
  assert.equal(triggerOutput(c, 0.05), 0);
  assert.ok(close(triggerOutput(c, 0.5), 0.5));
  assert.ok(close(triggerOutput(c, 0.95), 0.8));
});
