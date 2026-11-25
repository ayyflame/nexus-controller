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

import { mergeRisks, parseMs, previewAt } from "./macroTiming.ts";

const yy = (gap: number, last = 50): MacroStep[] => [
  { id: "1", buttons: ["north"], holdMs: 50, delayAfterMs: gap },
  { id: "2", buttons: ["north"], holdMs: 50, delayAfterMs: last },
];

test("same-button presses that would merge are flagged", () => {
  assert.deepEqual(mergeRisks(yy(50), "repeatWhileHeld", 50), [], "YY with 50 ms gaps is fine");
  const between = mergeRisks(yy(0), "repeatWhileHeld", 50);
  assert.equal(between.length, 1);
  assert.deepEqual([between[0]!.after, between[0]!.repeat, between[0]!.gapMs], [0, false, 0]);
  // Repeat boundary: last wait 0 + pause 0 merges the last Y into the next first Y.
  const boundary = mergeRisks(yy(50, 0), "repeatWhileHeld", 0);
  assert.deepEqual(boundary.map((r) => [r.after, r.repeat, r.gapMs]), [[1, true, 0]]);
  assert.deepEqual(mergeRisks(yy(50, 0), "repeatWhileHeld", 30), [], "the pause provides the gap");
  assert.deepEqual(mergeRisks(yy(50, 0), "once", 0), [], "Play Once has no repeat boundary");
  assert.equal(mergeRisks(yy(50, 0), "toggle", 10).length, 1, "Toggle loops too");
  // Different buttons never merge.
  const xy: MacroStep[] = [{ id: "a", buttons: ["west"], holdMs: 50, delayAfterMs: 0 }, { id: "b", buttons: ["north"], holdMs: 50, delayAfterMs: 0 }];
  assert.deepEqual(mergeRisks(xy, "repeatWhileHeld", 0), []);
});

test("preview loops exactly like the engine", () => {
  const s = yy(40, 0); // cycle = 50+40+50+0 = 140 ms, + pause 60 = 200 ms
  assert.deepEqual(previewAt(s, 150, null), { cycleMs: 150, done: true, pass: 0 }, "Play Once ends after one pass");
  assert.deepEqual(previewAt(s, 139, null), { cycleMs: 139, done: false, pass: 0 });
  assert.deepEqual(previewAt(s, 210, 60), { cycleMs: 10, done: false, pass: 1 }, "loops after 200 ms");
  // Play Once three times with a 60 ms pause: 140 + 60 per pass, ends 140 ms into the third.
  assert.deepEqual(previewAt(s, 210, null, 3, 60), { cycleMs: 10, done: false, pass: 1 });
  assert.equal(previewAt(s, 539, null, 3, 60).done, false);
  assert.equal(previewAt(s, 540, null, 3, 60).done, true);
  assert.equal(sequenceAt(s, previewAt(s, 210, 60).cycleMs).pressed, true);
  assert.equal(sequenceAt(s, previewAt(s, 160, 60).cycleMs).finished, true, "repeat pause shows nothing pressed");
});

test("preview timing matches the engine's sequence_at", () => {
  // Same table as the Rust test `sequence_at` (Cross 100 / wait 50, Circle 100 / wait 0).
  const s: MacroStep[] = [
    { id: "a", buttons: ["south"], holdMs: 100, delayAfterMs: 50 },
    { id: "b", buttons: ["east"], holdMs: 100, delayAfterMs: 0 },
  ];
  assert.deepEqual(sequenceAt(s, 0), { step: 0, pressed: true, finished: false });
  assert.equal(sequenceAt(s, 99).pressed, true);
  assert.deepEqual(sequenceAt(s, 100), { step: 0, pressed: false, finished: false });
  assert.deepEqual(sequenceAt(s, 150), { step: 1, pressed: true, finished: false });
  assert.equal(sequenceAt(s, 250).finished, true);
});

test("millisecond fields: empty reverts, out of range is limited", () => {
  assert.equal(parseMs("", 20, 10000), null);
  assert.equal(parseMs("abc", 20, 10000), null);
  assert.equal(parseMs("99999", 20, 10000), 10000);
  assert.equal(parseMs("5", 20, 10000), 20);
  assert.equal(parseMs("42.6", 0, 10000), 43);
});

import { checkMs, msFieldCommit } from "./macroTiming.ts";

test("typed milliseconds are checked, never rounded or limited", () => {
  assert.deepEqual(checkMs("150", 0, 10000), { ok: true, value: 150 });
  assert.deepEqual(checkMs(" 150 ms ", 0, 10000), { ok: true, value: 150 });
  assert.deepEqual(checkMs("0", 0, 10000), { ok: true, value: 0 });
  assert.deepEqual(checkMs("10000", 0, 10000), { ok: true, value: 10000 });
  assert.equal(checkMs("", 0, 10000).ok, false);
  assert.equal(checkMs("abc", 0, 10000).ok, false);
  assert.equal(checkMs("42.6", 0, 10000).ok, false, "no silent rounding");
  assert.equal(checkMs("-5", 0, 10000).ok, false);
  assert.equal(checkMs("1e3", 0, 10000).ok, false);
  const low = checkMs("5", 20, 10000);
  assert.deepEqual(low, { ok: false, error: "Must be 20–10000 ms." }, "below the press-time minimum is reported");
  assert.equal(checkMs("10001", 0, 10000).ok, false, "above the limit is reported");
  assert.deepEqual(checkMs("150%", 1, 1000, "%"), { ok: true, value: 150 });
});

test("a millisecond field commits only on Enter or leaving, and only real changes", () => {
  // Tabbing through without typing changes nothing.
  assert.deepEqual(msFieldCommit("80", 80, false, 0, 10000, "leave"), { store: null, text: "80", error: null });
  // Select-all and type a new value.
  assert.deepEqual(msFieldCommit("125", 80, true, 0, 10000, "enter"), { store: 125, text: "125", error: null });
  assert.deepEqual(msFieldCommit("125", 80, true, 0, 10000, "leave"), { store: 125, text: "125", error: null });
  // Same value: no undo step.
  assert.equal(msFieldCommit("80", 80, true, 0, 10000, "enter").store, null);
  // Invalid on Enter: the typed text stays so it can be corrected.
  const enter = msFieldCommit("5", 80, true, 20, 10000, "enter");
  assert.deepEqual([enter.store, enter.text], [null, "5"]);
  assert.match(enter.error!, /20–10000 ms/);
  // Invalid on leaving: the stored value is shown again, with a message.
  const leave = msFieldCommit("", 80, true, 0, 10000, "leave");
  assert.deepEqual([leave.store, leave.text], [null, "80"]);
  assert.match(leave.error!, /kept 80 ms/);
  // Bulk field with differing values ("varies"): empty and untouched is fine.
  assert.deepEqual(msFieldCommit("", null, false, 0, 10000, "leave"), { store: null, text: "", error: null });
  assert.equal(msFieldCommit("60", null, true, 0, 10000, "leave").store, 60);
});
