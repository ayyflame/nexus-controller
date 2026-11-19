import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCheck, formatNs, nextStreak, rowsFor, stageText } from "./outputCheck.ts";
import type { XInputPad } from "../types/engine";

const pad = (p: Partial<XInputPad> = {}): XInputPad => ({ buttons: 0, leftTrigger: 0, rightTrigger: 0, thumbLx: 0, thumbLy: 0, thumbRx: 0, thumbRy: 0, ...p });

test("rows compare every button and axis", () => {
  const rows = rowsFor(pad({ buttons: 0x1000, rightTrigger: 255 }), pad({ buttons: 0x1000 }));
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.find((r) => r.label === "A"), { label: "A", sent: "pressed", read: "pressed", ok: true });
  assert.deepEqual(rows.find((r) => r.label === "RT"), { label: "RT", sent: "255", read: "0", ok: false });
  assert.equal(rows.filter((r) => !r.ok).length, 1);
});

test("each check state has clear wording; a match is green", () => {
  assert.equal(describeCheck({ state: "compared", slot: 0, sent: pad(), read: pad(), differences: [] }).tone, "ok");
  const diff = describeCheck({ state: "compared", slot: 1, sent: pad(), read: pad(), differences: ["A: …", "B: …"] });
  assert.equal(diff.tone, "warn");
  assert.match(diff.title, /2 differences/);
  assert.match(describeCheck({ state: "missing", slot: 0 }).title, /player 1/);
  assert.match(describeCheck({ state: "notXbox", active: null }).detail, /Virtual Output/);
  assert.equal(describeCheck({ state: "noController" }).tone, "idle");
  assert.equal(describeCheck({ state: "unavailable", reason: "x" }).detail, "x");
});

test("a verdict needs consecutive matches; any other state resets it", () => {
  const ok = { state: "compared" as const, slot: 0, sent: pad(), read: pad(), differences: [] };
  const bad = { ...ok, differences: ["A"] };
  let s = { matches: 0, mismatches: 0 };
  s = nextStreak(s, ok); s = nextStreak(s, ok);
  assert.deepEqual(s, { matches: 2, mismatches: 0 });
  s = nextStreak(s, bad);
  assert.deepEqual(s, { matches: 0, mismatches: 1 });
  assert.deepEqual(nextStreak(s, { state: "noController" }), { matches: 0, mismatches: 0 });
});

test("nanosecond formatting for the stage timings", () => {
  assert.equal(formatNs(135), "135 ns");
  assert.equal(formatNs(1234), "1.2 µs");
  assert.equal(formatNs(286_000), "286 µs");
  assert.equal(formatNs(160_685_000), "160.7 ms");
  assert.equal(formatNs(Number.NaN), "—");
  assert.equal(stageText({ p50Ns: 60, p99Ns: 78, maxNs: 80, samples: 256 }), "60 ns / 78 ns / 80 ns");
  assert.equal(stageText({ p50Ns: 0, p99Ns: 0, maxNs: 0, samples: 0 }), "—");
  assert.equal(stageText(undefined), "—", "an older status without stage timings doesn't break the page");
});
