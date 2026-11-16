import { test } from "node:test";
import assert from "node:assert/strict";
import { commonValue, scaleTiming, setTiming, setWaitBefore, startTimes, waitBefore } from "./macroTiming.ts";
import { validateMacro, newMacro, totalDuration, sequenceAt } from "./macros.ts";
import type { MacroStep } from "../types/engine";

const step = (id: string, holdMs: number, delayAfterMs: number): MacroStep => ({ id, buttons: ["south"], holdMs, delayAfterMs });
// A "recorded" macro with uneven human timing.
const recorded = () => [step("a", 87, 143), step("b", 112, 96), step("c", 64, 0)];

test("each action's start time and wait before it", () => {
  const s = recorded();
  assert.deepEqual(startTimes(s), [0, 230, 438]);
  assert.equal(waitBefore(s, 0), 0, "first action starts at once");
  assert.equal(waitBefore(s, 2), 96);
});

test("editing the wait before an action moves it and everything after", () => {
  const s = setWaitBefore(recorded(), 1, 300);
  assert.equal(s[0]!.delayAfterMs, 300);
  assert.deepEqual(startTimes(s), [0, 387, 595]);
  assert.deepEqual(setWaitBefore(recorded(), 0, 500), recorded(), "first action: nothing to change");
});

test("bulk timing changes only the selected actions", () => {
  const s = setTiming(recorded(), ["a", "c"], { holdMs: 50 });
  assert.deepEqual(s.map((x) => x.holdMs), [50, 112, 50]);
  assert.deepEqual(s.map((x) => x.delayAfterMs), [143, 96, 0], "waits untouched");
  const w = setTiming(recorded(), ["a", "b", "c"], { delayAfterMs: 40 });
  assert.deepEqual(w.map((x) => x.delayAfterMs), [40, 40, 40]);
  assert.equal(commonValue(w, ["a", "b"], "delayAfterMs"), 40);
  assert.equal(commonValue(w, ["a", "b"], "holdMs"), null, "mixed values");
});

test("scaling keeps the rhythm and respects limits", () => {
  const half = scaleTiming(recorded(), ["a", "b", "c"], 50);
  assert.deepEqual(half.map((x) => [x.holdMs, x.delayAfterMs]), [[44, 72], [56, 48], [32, 0]]);
  const tiny = scaleTiming(recorded(), ["c"], 1);
  assert.equal(tiny[2]!.holdMs, 20, "never below the minimum press time");
  const huge = setTiming(recorded(), ["a"], { holdMs: 99_999, delayAfterMs: -5 });
  assert.deepEqual([huge[0]!.holdMs, huge[0]!.delayAfterMs], [10_000, 0]);
  const nan = setTiming(recorded(), ["a"], { holdMs: Number.NaN });
  assert.equal(nan[0]!.holdMs, 20);
});

test("edited timing always validates and drives the preview", () => {
  const edited = scaleTiming(setTiming(recorded(), ["b"], { holdMs: 250 }), ["a", "b", "c"], 200);
  const m = { ...newMacro(), name: "Edited", steps: edited };
  assert.deepEqual(validateMacro(m, []), []);
  assert.equal(totalDuration(edited), edited.reduce((t, s) => t + s.holdMs + s.delayAfterMs, 0));
  const [, b] = startTimes(edited);
  assert.equal(sequenceAt(edited, b!).step, 1, "preview reaches action 2 exactly at its new start");
  assert.equal(sequenceAt(edited, b! - 1).step, 0);
});
