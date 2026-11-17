import { test } from "node:test";
import assert from "node:assert/strict";
import { describeButtons, describeMask, maskBits, totalButtons, usageLabel, verdictBadge } from "./inspector.ts";

test("bit masks are described with bit numbers", () => {
  assert.deepEqual(maskBits(0x41), [0, 6]);
  assert.equal(describeMask(0x40), "0x40 (bit 6)");
  assert.equal(describeMask(0x41), "0x41 (bits 0, 6)");
  assert.equal(describeMask(0), "—");
});

test("verdicts never call a decoded button a paddle", () => {
  assert.equal(verdictBadge({ kind: "decodedButtons", buttons: ["Cross"] }).text, "Reported as Cross (mapped button)");
  assert.doesNotMatch(verdictBadge({ kind: "decodedButtons", buttons: ["Cross"] }).text, /independent/i);
  assert.match(verdictBadge({ kind: "undecodedBits", locations: ["byte 45 mask 0x03"] }).text, /Possible independent input/);
  assert.equal(verdictBadge({ kind: "undecodedBits", locations: ["byte 10 mask 0x40"] }).tone, "warn");
  assert.match(verdictBadge({ kind: "noChange" }).text, /No change/);
});

test("interface descriptors are summarised", () => {
  assert.equal(usageLabel(1, 5), "Gamepad");
  assert.equal(usageLabel(0xff00, 1), "Vendor-defined");
  const std = [{ usagePage: 9, usageMin: 1, usageMax: 15, reportId: 1, bitSize: 1, reportCount: 15 }];
  assert.equal(totalButtons(std), 15);
  assert.equal(describeButtons(std), "1–15 (15 buttons, report 01)");
  assert.equal(describeButtons([]), "none declared");
});
