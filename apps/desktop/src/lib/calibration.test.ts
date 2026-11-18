import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_CENTER_SAMPLES, adviseDeadzone, applyCalibration, calibrationStatus, measureCenter, measureRange, measureTrigger,
  restoreSnapshot, snapshotOf, stickCalibrationFrom, DEFAULT_STICK_CALIBRATION, type CenterResult, type Sample,
} from "./calibration.ts";
import { defaultProcessing } from "./processing.ts";

/** Resting samples around (cx, cy) with ±amp alternating noise. */
function resting(n: number, cx: number, cy: number, amp: number, drift = 0): Sample[] {
  return Array.from({ length: n }, (_, i) => ({ t: i * 16.7, x: cx + (i % 2 ? amp : -amp) + drift * i, y: cy }));
}

function circle(cx: number, cy: number, r: number, n = 144, rx = r, ry = r): Sample[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { t: i * 16.7, x: cx + Math.cos(a) * rx * r / r, y: cy + Math.sin(a) * ry * r / r };
  });
}

test("centre is averaged, not assumed to be zero", () => {
  const m = measureCenter(resting(180, 0.04, -0.02, 0.01));
  assert.ok(m.ok);
  const c = m.value;
  assert.ok(Math.abs(c.center.x - 0.04) < 1e-9 && Math.abs(c.center.y + 0.02) < 1e-9);
  assert.ok(Math.abs(c.offset - Math.hypot(0.04, 0.02)) < 1e-9);
  assert.equal(c.samples, 180);
});

test("jitter, deviation and drift are measured around the measured centre", () => {
  const c = measureCenter(resting(180, 0.03, 0, 0.01)) as { ok: true; value: CenterResult };
  assert.ok(Math.abs(c.value.minDeviation - 0.01) < 1e-9 && Math.abs(c.value.maxDeviation - 0.01) < 1e-9);
  assert.ok(Math.abs(c.value.jitter - 0.01) < 1e-9, "RMS of ±0.01 is 0.01");
  assert.ok(Math.abs(c.value.maxFromIdeal - 0.04) < 1e-9);
  assert.ok(c.value.drift < 1e-9);
  const drifting = measureCenter(resting(240, 0, 0, 0.002, 0.0002));
  assert.ok(drifting.ok && drifting.value.drift > 0.03, "slow drift shows between the first and last second");
});

test("too few samples or a moved stick give no centre", () => {
  const few = measureCenter(resting(MIN_CENTER_SAMPLES - 1, 0, 0, 0.01));
  assert.ok(!few.ok && /at least 90 needed/.test(few.reason));
  const moved = measureCenter([...resting(100, 0, 0, 0.005), { t: 2000, x: 0.8, y: 0 }]);
  assert.ok(!moved.ok && /moved/.test(moved.reason));
});

test("deadzone advice comes from the measured resting movement", () => {
  const quiet = adviseDeadzone((measureCenter(resting(180, 0.06, 0, 0.004)) as any).value);
  assert.equal(quiet.recommended, 0.025, "0.004 × 1.25 + 2 raw steps ≈ 2.1 %, rounded up to 2.5 %");
  assert.equal(quiet.withoutCalibration, 0.1, "without centre calibration the 6 % offset must be covered too");
  assert.ok(quiet.minDetectable > quiet.restingMovement);
  const noisy = adviseDeadzone((measureCenter(resting(180, 0, 0, 0.05)) as any).value);
  assert.equal(noisy.recommended, 0.08);
  const perfect = adviseDeadzone((measureCenter(resting(180, 0, 0, 0)) as any).value);
  assert.equal(perfect.recommended, 0.02, "never below 2 %");
});

test("full range: extremes, directions and diagonal consistency", () => {
  const r = measureRange(circle(0, 0, 1), { x: 0, y: 0 });
  assert.ok(r.ok);
  const v = r.value;
  assert.ok(Math.abs(v.maxX - 1) < 1e-9 && Math.abs(v.minX + 1) < 1e-9 && Math.abs(v.maxY - 1) < 1e-9 && Math.abs(v.minY + 1) < 1e-9);
  assert.ok(v.reach.every((x) => x > 0.99));
  assert.ok(Math.abs(v.diagonalRatio - 1) < 0.01, "round gate");
  assert.equal(v.coverage, 1);
  assert.ok(v.reachesExpected && v.complete);
});

test("a short stick and a square-ish gate are reported as measured, not corrected", () => {
  const short = measureRange(circle(0, 0, 0.8), { x: 0, y: 0 });
  assert.ok(short.ok && !short.value.reachesExpected && !short.value.complete);
  assert.ok(Math.abs(short.value.maxRadius - 0.8) < 1e-9);
  // Only straight pushes, no circle: diagonals and coverage missing.
  const cross: Sample[] = [];
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 0; i < 20; i++) cross.push({ t: cross.length, x: x!, y: y! });
  const c = measureRange(cross, { x: 0, y: 0 });
  assert.ok(c.ok && c.value.reachesExpected && !c.value.complete);
  assert.equal(c.value.diagonalRatio, 0);
  const few = measureRange(cross.slice(0, 10), { x: 0, y: 0 });
  assert.ok(!few.ok);
});

test("range is measured relative to the measured centre", () => {
  const r = measureRange(circle(0.05, 0, 0.95), { x: 0.05, y: 0 });
  assert.ok(r.ok && r.value.reach.every((x) => Math.abs(x - 0.95) < 0.01));
  assert.ok(Math.abs(r.value.maxX - 1.0) < 1e-9 && Math.abs(r.value.minX + 0.9) < 1e-9);
});

test("stick calibration takes the measured centre and range within engine limits", () => {
  const center = (measureCenter(resting(180, 0.05, -0.03, 0.005)) as any).value;
  const range = (measureRange(circle(0.05, -0.03, 0.93), { x: 0.05, y: -0.03 }) as any).value;
  const { calibration, warnings } = stickCalibrationFrom(center, range, DEFAULT_STICK_CALIBRATION);
  assert.ok(Math.abs(calibration.centerX - 0.05) < 1e-9 && Math.abs(calibration.centerY + 0.03) < 1e-9);
  assert.ok(Math.abs(calibration.maxX - 0.98) < 1e-9 && Math.abs(calibration.minX + 0.88) < 1e-9);
  assert.deepEqual(warnings, []);
  // An axis end that wasn't reached keeps the previous value.
  const half = (measureRange([...circle(0, 0, 1).filter((s) => s.x <= 0.3)], { x: 0, y: 0 }) as any).value;
  const r2 = stickCalibrationFrom((measureCenter(resting(180, 0, 0, 0.005)) as any).value, half, DEFAULT_STICK_CALIBRATION);
  assert.equal(r2.calibration.maxX, 1, "previous right end kept");
  assert.ok(r2.warnings.some((w) => /Right wasn't reached/.test(w)));
  const r3 = stickCalibrationFrom((measureCenter(resting(180, 0.7, 0, 0.005)) as any).value, null, DEFAULT_STICK_CALIBRATION);
  assert.equal(r3.calibration.centerX, 0.5);
  assert.ok(r3.warnings.some((w) => /limited/.test(w)) && r3.warnings.some((w) => /Range not measured/.test(w)));
});

test("trigger endpoints: released and pressed values, incomplete travel", () => {
  const ok = measureTrigger(new Array(30).fill(0).map((_, i) => (i % 3 === 0 ? 2 : 0)), new Array(30).fill(255));
  assert.ok(ok.ok);
  assert.deepEqual([ok.value.releasedMax, ok.value.pressedMax, ok.value.incomplete], [2, 255, false]);
  assert.ok(Math.abs(ok.value.rawMin - 2 / 255) < 1e-9 && ok.value.rawMax === 1);
  const short = measureTrigger(new Array(30).fill(0), new Array(30).fill(220));
  assert.ok(short.ok && short.value.incomplete && Math.abs(short.value.rawMax - 220 / 255) < 1e-9);
  const barely = measureTrigger(new Array(30).fill(0), new Array(30).fill(50));
  assert.ok(!barely.ok && /only moved from 0 to 50/.test(barely.reason));
  assert.ok(!measureTrigger([0], [255]).ok, "too few samples");
});

test("apply changes only the chosen calibration fields; rollback restores them exactly", () => {
  const base = defaultProcessing();
  base.remap = [{ from: "south", to: "east" }];
  base.leftStick.curve = { type: "power", exponent: 2 };
  const before = snapshotOf(base);
  const cal = { centerX: 0.04, centerY: -0.02, minX: -0.9, maxX: 0.95, minY: -0.92, maxY: 0.97 };
  const next = applyCalibration(base, { leftStick: { calibration: cal, deadzone: 0.06 }, rightTrigger: { rawMin: 0.01, rawMax: 0.9 } });
  assert.deepEqual(next.leftStick.calibration, cal);
  assert.equal(next.leftStick.deadzone, 0.06);
  assert.deepEqual(next.rightTrigger.rawMin, 0.01);
  assert.deepEqual(next.rightStick, base.rightStick, "untouched stick unchanged");
  assert.deepEqual(next.leftTrigger, base.leftTrigger);
  assert.deepEqual(next.remap, base.remap, "mappings unchanged");
  assert.deepEqual(next.leftStick.curve, base.leftStick.curve, "curve unchanged");
  assert.equal(base.leftStick.deadzone, defaultProcessing().leftStick.deadzone, "input not mutated");
  const back = restoreSnapshot(next, before);
  assert.deepEqual(back, base);
});

test("status shows what is calibrated in the current profile", () => {
  const base = defaultProcessing();
  let s = calibrationStatus(base);
  assert.ok(s.sticks.every((x) => !x.calibrated) && s.triggers.every((x) => !x.calibrated));
  const next = applyCalibration(base, { leftStick: { calibration: { ...DEFAULT_STICK_CALIBRATION, centerX: 0.03, centerY: 0.04 } }, leftTrigger: { rawMin: 0.02, rawMax: 1 } });
  s = calibrationStatus(next);
  assert.equal(s.sticks[0]!.calibrated, true);
  assert.ok(Math.abs(s.sticks[0]!.centerOffset - 0.05) < 1e-9);
  assert.equal(s.sticks[1]!.calibrated, false);
  assert.equal(s.triggers[0]!.calibrated, true);
});
