// Undo/redo rules of hooks/useHistory.ts, checked through its reducer logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyReducer, type HistoryState } from "./history.ts";

test("undo and redo walk the history; a new edit clears redo", () => {
  let s: HistoryState<number> = { past: [], present: 1, future: [] };
  s = historyReducer(s, { type: "set", value: 2 });
  s = historyReducer(s, { type: "set", value: 3 });
  s = historyReducer(s, { type: "undo" });
  assert.equal(s.present, 2);
  s = historyReducer(s, { type: "undo" });
  assert.equal(s.present, 1);
  s = historyReducer(s, { type: "undo" });
  assert.equal(s.present, 1, "nothing left to undo");
  s = historyReducer(s, { type: "redo" });
  assert.equal(s.present, 2);
  s = historyReducer(s, { type: "set", value: 9 });
  assert.deepEqual(s.future, [], "a new edit clears redo");
  s = historyReducer(s, { type: "redo" });
  assert.equal(s.present, 9);
});

test("setting the same value adds no undo step; history is capped", () => {
  const v = [1];
  let s: HistoryState<number[]> = { past: [], present: v, future: [] };
  s = historyReducer(s, { type: "set", value: v });
  assert.equal(s.past.length, 0);
  let n: HistoryState<number> = { past: [], present: 0, future: [] };
  for (let i = 1; i <= 150; i++) n = historyReducer(n, { type: "set", value: i });
  assert.equal(n.past.length, 100);
  assert.equal(n.past[0], 50);
});
