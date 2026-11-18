import { test } from "node:test";
import assert from "node:assert/strict";
import { addStickSample, addTriggerSample, emptyStickRange, emptyTriggerRange, stickRangeResult, triggerRangeResult } from "./diagAnalog.ts";
import { accelG, gyroDps, motionAvailability, tiltFrom } from "./diagMotion.ts";
import { batteryText, freshness, healthItems, reportAge } from "./diagHealth.ts";
import { analyzeDrift, compareToReference, invalidReason } from "./diagDrift.ts";
import { STEPS, checkDone, feed, goTo, markFailed, retry, startTest, summary, type TestState } from "./diagTest.ts";
import { activeControls, mergeSeen } from "./diagDetected.ts";
import { stateOf, stick, trigger } from "./diagFixtures.ts";
import type { ControllerState, DeviceSnapshot } from "../types/engine";

// ---- Sticks and triggers ------------------------------------------------------

test("stick range needs every edge and all eight directions", () => {
  let r = emptyStickRange();
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r = addStickSample(r, x!, y!);
  let res = stickRangeResult(r);
  assert.deepEqual([res.left, res.right, res.up, res.down, res.complete], [true, true, true, true, false], "diagonals missing");
  assert.equal(res.sectorsReached, 4);
  for (let a = 0; a < 360; a += 15) r = addStickSample(r, Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180));
  res = stickRangeResult(r);
  assert.equal(res.sectorsReached, 8);
  assert.equal(res.complete, true);
});

test("a stick that stops short is not full range", () => {
  let r = emptyStickRange();
  for (let a = 0; a < 360; a += 10) r = addStickSample(r, 0.85 * Math.cos((a * Math.PI) / 180), 0.85 * Math.sin((a * Math.PI) / 180));
  const res = stickRangeResult(r);
  assert.equal(res.complete, false);
  assert.equal(res.sectorsReached, 0);
  assert.ok(Math.abs(r.maxRadius - 0.85) < 1e-6);
  assert.equal(addStickSample(emptyStickRange(), Number.NaN, 0).maxRadius, 0, "bad values are ignored");
});

test("triggers confirm full release and full press, and explain incomplete travel", () => {
  let r = emptyTriggerRange();
  assert.deepEqual(triggerRangeResult(r), { fullRelease: false, fullPress: false, incomplete: null }, "unused");
  for (const v of [0, 60, 255, 0]) r = addTriggerSample(r, v);
  assert.deepEqual(triggerRangeResult(r), { fullRelease: true, fullPress: true, incomplete: null });
  let short = emptyTriggerRange();
  for (const v of [0, 120, 230, 0]) short = addTriggerSample(short, v);
  const s = triggerRangeResult(short);
  assert.equal(s.fullPress, false);
  assert.match(s.incomplete!, /Highest value seen 230 of 255 \(90 %\)/);
  let stuck = emptyTriggerRange();
  for (const v of [9, 255, 12]) stuck = addTriggerSample(stuck, v);
  assert.match(triggerRangeResult(stuck).incomplete!, /never fully returned to 0/);
});

// ---- Motion -------------------------------------------------------------------

test("motion: units and tilt from real sensor counts", () => {
  assert.deepEqual(gyroDps([16384, -1638.4, 0]), [1000, -100, 0]);
  assert.deepEqual(accelG([0, 8192, -4096]), [0, 1, -0.5]);
  const flat = tiltFrom([0, 1, 0])!;
  assert.ok(Math.abs(flat.pitchDeg) < 1e-9 && Math.abs(flat.rollDeg) < 1e-9 && flat.steady);
  const forward = tiltFrom([0, Math.SQRT1_2, Math.SQRT1_2])!;
  assert.ok(Math.abs(forward.pitchDeg - 45) < 1e-6);
  const side = tiltFrom([0.5, Math.sqrt(0.75), 0])!;
  assert.ok(Math.abs(side.rollDeg - 30) < 1e-6);
  assert.equal(tiltFrom([0, 0.05, 0]), null, "free fall / no gravity: no tilt");
  assert.equal(tiltFrom([0, 2, 0])!.steady, false, "moving: tilt not trustworthy");
});

test("missing motion data is explained", () => {
  assert.deepEqual(motionAvailability(stateOf()), { available: true });
  assert.equal(motionAvailability(null).available, false);
  const basic = motionAvailability(stateOf({ motion: null, format: "dualSenseBluetoothBasic" }));
  assert.ok(!basic.available && /no motion data/.test(basic.reason));
  const usb = motionAvailability(stateOf({ motion: null }));
  assert.ok(!usb.available && /don't include motion/.test(usb.reason));
});

// ---- Health -------------------------------------------------------------------

function device(patch: Partial<DeviceSnapshot> = {}): DeviceSnapshot {
  return {
    device: { model: "dualSense", connection: "usb", origin: "physical", vendorId: 0x054c, productId: 0x0ce6, productName: "DualSense Wireless Controller" },
    connectedAtMs: 0, input: stateOf(), processed: stateOf(), playingMacros: [], activeLayer: null,
    pipelineLatency: { p50Us: 6, p99Us: 15, maxUs: 40, samples: 256 }, sequenceGaps: 0,
    reportIntervals: { intervals: 1000, minUs: 3900, meanUs: 4000, maxUs: 4300, over8ms: 0, over50ms: 0 },
    outputReportsSent: 0, lastReportMs: 10_000, reportRateHz: 250, totalReports: 1001, parseErrors: 0, lastParseError: null,
    output: { requested: "xbox360", active: "xbox360", backend: "v", backendStatus: { state: "ready", version: null }, lastError: null, playerIndex: 0, retrying: false },
    ...patch,
  } as unknown as DeviceSnapshot;
}

test("stale input is detected from the last report time", () => {
  assert.equal(reportAge(null, 5), null);
  assert.equal(freshness(reportAge(10_000, 10_004)), "live");
  assert.equal(freshness(reportAge(10_000, 10_100)), "slow");
  assert.equal(freshness(reportAge(10_000, 10_400)), "stale");
  assert.equal(freshness(null), "none");
  const items = healthItems(device(), 10_900);
  const input = items.find((i) => i.label === "Input")!;
  assert.match(input.value, /No input for 0\.9 s/);
  assert.ok(input.warn);
});

test("every health value says whether it is measured, reported or estimated", () => {
  const items = healthItems(device({ parseErrors: 3, sequenceGaps: 2 }), 10_002);
  const by = (l: string) => items.find((i) => i.label === l)!;
  assert.equal(by("Dropped reports").source, "estimate");
  assert.equal(by("Unreadable reports").source, "measured");
  assert.ok(by("Unreadable reports").warn && by("Dropped reports").warn);
  assert.equal(by("Battery").source, "reported");
  assert.match(by("NEXUS processing time").value, /6 \/ 15 \/ 40 µs/);
});

test("battery is only shown when the controller reports it", () => {
  assert.equal(batteryText(null), "Not reported in this controller's reports");
  assert.equal(batteryText({ percent: 75, status: "charging" }), "About 75 %, charging");
  assert.equal(batteryText({ percent: 100, status: "full" }), "Full (charging complete)");
  assert.match(batteryText({ percent: 0, status: "error" }), /battery error/);
});

// ---- Drift --------------------------------------------------------------------

test("drift test measures centre offset, deviation, spread and drift", () => {
  const samples = Array.from({ length: 300 }, (_, i) => ({ t: i * 16, x: 0.02 + (i % 2 ? 0.004 : -0.004) + i * 0.00005, y: -0.01 }));
  const r = analyzeDrift(samples)!;
  assert.equal(r.samples, 300);
  assert.equal(r.durationMs, 299 * 16);
  assert.ok(Math.abs(r.mean.x - (0.02 + 149.5 * 0.00005)) < 1e-3);
  assert.ok(r.centerOffset > 0.02 && r.centerOffset < 0.04);
  assert.ok(r.drift > 0.01 && r.drift < 0.02, `drift ${r.drift}`);
  assert.equal(r.disturbed, false);
  assert.match(compareToReference(r, 0.05), /inside the reference radius of 5\.0 %/);
  assert.match(compareToReference(r, 0.01), /outside the reference radius of 1\.0 % by/);
  assert.equal(analyzeDrift([]), null);
});

test("a drift measurement without enough input is not analysed", () => {
  const one = analyzeDrift([{ t: 0, x: 0.6, y: 0.3 }]);
  assert.match(invalidReason(one, 10)!, /Only 1 samples in 10 s \(at least 200 expected\)/);
  assert.match(invalidReason(null, 5)!, /No samples/);
  const full = analyzeDrift(Array.from({ length: 600 }, (_, i) => ({ t: i * 16.7, x: 0.01, y: 0 })));
  assert.equal(invalidReason(full, 10), null);
});

test("moving the stick during the drift test is flagged", () => {
  const r = analyzeDrift([{ t: 0, x: 0, y: 0 }, { t: 100, x: 0.9, y: 0 }, { t: 200, x: 0, y: 0 }])!;
  assert.equal(r.disturbed, true);
});

// ---- Controller test ----------------------------------------------------------

function run(t: TestState, states: ControllerState[]): TestState {
  for (const s of states) t = feed(t, s);
  return t;
}

test("the guided test covers every DualSense control in ten steps", () => {
  assert.equal(STEPS.length, 10);
  const ids = STEPS.flatMap((s) => s.checks.map((c) => c.id));
  for (const id of ["south", "east", "west", "north", "dpadUp", "dpadDown", "dpadLeft", "dpadRight", "leftShoulder", "rightShoulder",
    "l2", "r2", "leftStick", "rightStick", "ls", "rs", "touch", "select", "start", "home", "mute"]) {
    assert.ok(ids.includes(id), id);
  }
});

test("a button passes only after press and release", () => {
  let t = startTest();
  t = run(t, [stateOf({ buttons: { south: true } })]);
  assert.equal(checkDone(t, "south"), false, "still held");
  t = run(t, [stateOf()]);
  assert.equal(checkDone(t, "south"), true);
  assert.equal(t.results.face, "untested", "other face buttons missing");
  for (const b of ["east", "west", "north"] as const) t = run(t, [stateOf({ buttons: { [b]: true } }), stateOf()]);
  assert.equal(t.results.face, "pass");
});

test("d-pad diagonals count for both directions", () => {
  let t = goTo(startTest(), 1);
  t = run(t, [stateOf({ dpad: "upLeft" }), stateOf(), stateOf({ dpad: "downRight" }), stateOf()]);
  assert.equal(t.results.dpad, "pass");
});

test("a trigger must reach the end and come back to zero", () => {
  let t = goTo(startTest(), 3);
  t = run(t, [stateOf({ leftTrigger: trigger(240) }), stateOf({ leftTrigger: trigger(0) })]);
  assert.equal(checkDone(t, "l2"), false, "240 is not the end");
  t = run(t, [stateOf({ leftTrigger: trigger(255) }), stateOf({ leftTrigger: trigger(30) })]);
  assert.equal(checkDone(t, "l2"), false, "not released");
  t = run(t, [stateOf({ leftTrigger: trigger(0) })]);
  assert.equal(checkDone(t, "l2"), true);
  t = run(t, [stateOf({ rightTrigger: trigger(255) }), stateOf()]);
  assert.equal(t.results.triggers, "pass");
});

test("a stick must cover the full range, not just move, and return to centre", () => {
  let t = goTo(startTest(), 5);
  t = run(t, [stateOf({ leftStick: stick(0.6, 0) }), stateOf()]);
  assert.equal(t.results.lstick, "untested", "moving is not enough");
  const circle = Array.from({ length: 48 }, (_, i) => stateOf({ leftStick: stick(Math.cos((i * Math.PI) / 24), Math.sin((i * Math.PI) / 24)) }));
  t = run(t, circle);
  assert.equal(t.results.lstick, "untested", "not back at the centre yet");
  t = run(t, [stateOf()]);
  assert.equal(t.results.lstick, "pass");
  // The right stick moving does not count for the left stick step.
  let r = goTo(startTest(), 5);
  r = run(r, Array.from({ length: 48 }, (_, i) => stateOf({ rightStick: stick(Math.cos((i * Math.PI) / 24), Math.sin((i * Math.PI) / 24)) })));
  assert.equal(r.results.lstick, "untested");
});

test("touchpad needs a touch and a click", () => {
  let t = goTo(startTest(), 7);
  t = run(t, [stateOf({ buttons: { touchpad: true } }), stateOf()]);
  assert.equal(t.results.touchpad, "untested");
  const touched = stateOf({ touchpad: { points: [{ active: true, id: 3, x: 500, y: 300 }, { active: false, id: 0, x: 0, y: 0 }], width: 1920, height: 1080 } });
  t = run(t, [touched, stateOf()]);
  assert.equal(t.results.touchpad, "pass");
});

test("fail, retry, navigation and summary", () => {
  let t = startTest();
  t = markFailed(t);
  assert.equal(t.results.face, "fail");
  t = run(t, [stateOf({ buttons: { south: true } }), stateOf()]);
  assert.equal(checkDone(t, "south"), false, "a failed step stops recording");
  t = retry(t);
  assert.equal(t.results.face, "untested");
  for (const b of ["south", "east", "west", "north"] as const) t = run(t, [stateOf({ buttons: { [b]: true } }), stateOf()]);
  assert.equal(t.results.face, "pass");
  assert.equal(markFailed(t).results.face, "pass", "a pass isn't overwritten");
  t = goTo(t, 9);
  t = run(t, [stateOf({ buttons: { mute: true } }), stateOf()]);
  t = goTo(t, 10);
  assert.equal(t.finished, true);
  assert.deepEqual(summary(t), { pass: 2, fail: 0, untested: 8 });
  assert.equal(feed(t, stateOf({ buttons: { south: true } })), t, "finished test ignores input");
  assert.equal(feed(startTest(), null).results.face, "untested", "no input, no change");
});

// ---- Detection ----------------------------------------------------------------

test("every control is detected from live state", () => {
  const s = stateOf({
    buttons: { south: true, east: true, west: true, north: true, leftShoulder: true, rightShoulder: true, leftStick: true,
      rightStick: true, start: true, select: true, home: true, touchpad: true, mute: true },
    dpad: "upRight", leftTrigger: trigger(200), rightTrigger: trigger(30),
    leftStick: stick(0.5, 0), rightStick: stick(0, -0.5),
    touchpad: { points: [{ active: true, id: 1, x: 1, y: 1 }, { active: false, id: 0, x: 0, y: 0 }], width: 1920, height: 1080 },
  });
  const a = activeControls(s);
  assert.equal(a.size, 20, [...a].join(","));
  assert.ok(!a.has("dpadDown") && !a.has("dpadLeft"));
  assert.equal(activeControls(stateOf()).size, 0, "nothing at rest");
  const seen = mergeSeen(new Set(), stateOf({ buttons: { south: true } }));
  assert.ok(seen.has("south"));
  assert.equal(mergeSeen(seen, stateOf()), seen, "unchanged set is reused (no re-render)");
});
