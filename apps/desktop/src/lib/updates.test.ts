import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeUpdate, formatBytes, formatLastCheck, isBusy, progressPercent, releaseOf,
  type UpdateState, type UpdateStatus,
} from "./updates.ts";

const release = { version: "0.1.1", notes: "Fixes", pubDate: null };
const status = (state: UpdateState, extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  configured: true, currentVersion: "0.1.0", channel: "stable", autoCheck: true,
  lastSuccessMs: null, state, banner: false, postponed: null, outcome: null, ...extra,
});

test("download progress and size", () => {
  assert.equal(progressPercent({ kind: "downloading", release, downloaded: 1_500_000, total: 3_000_000 }), 50);
  assert.equal(progressPercent({ kind: "downloading", release, downloaded: 10, total: null }), null);
  assert.equal(progressPercent({ kind: "available", release }), null);
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(3_217_000), "3.1 MB");
  assert.equal(formatBytes(-1), "—");
  const d = describeUpdate(status({ kind: "downloading", release, downloaded: 1_048_576, total: 2_097_152 }));
  assert.match(d.text, /1\.0 MB of 2\.0 MB \(50%\)/);
});

test("every state has a status line", () => {
  const states: UpdateState[] = [
    { kind: "notConfigured" }, { kind: "idle" }, { kind: "checking", manual: true }, { kind: "upToDate" },
    { kind: "available", release }, { kind: "downloading", release, downloaded: 0, total: null },
    { kind: "readyToInstall", release, size: 3 }, { kind: "installing", release },
    { kind: "failed", error: { kind: "offline", message: "Couldn't reach the update server.", detail: "" }, release: null },
  ];
  for (const s of states) assert.ok(describeUpdate(status(s)).text.length > 0, s.kind);
  assert.equal(describeUpdate(status({ kind: "upToDate" })).tone, "ok");
  assert.equal(describeUpdate(status({ kind: "failed", error: { kind: "offline", message: "x", detail: "" }, release: null })).tone, "warn");
  assert.equal(describeUpdate(status({ kind: "failed", error: { kind: "invalidSignature", message: "x", detail: "" }, release: null })).tone, "error");
  assert.match(describeUpdate(status({ kind: "idle" }, { autoCheck: false })).text, /off/);
});

test("busy states block a second operation in the UI", () => {
  assert.ok(isBusy({ kind: "checking", manual: false }));
  assert.ok(isBusy({ kind: "downloading", release, downloaded: 0, total: null }));
  assert.ok(isBusy({ kind: "installing", release }));
  assert.ok(!isBusy({ kind: "available", release }));
  assert.equal(releaseOf({ kind: "readyToInstall", release, size: 1 })?.version, "0.1.1");
  assert.equal(releaseOf({ kind: "upToDate" }), null);
});

test("last check time", () => {
  const now = 1_000_000_000;
  assert.equal(formatLastCheck(null, now), "Never");
  assert.equal(formatLastCheck(now - 10_000, now), "Just now");
  assert.equal(formatLastCheck(now - 60_000, now), "1 minute ago");
  assert.equal(formatLastCheck(now - 3 * 3_600_000, now), "3 hours ago");
});
