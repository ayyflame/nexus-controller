import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreLabel, visiblePoints } from "./restorePoints.ts";
import type { RestorePoint } from "../types/engine";

const p = (kind: RestorePoint["kind"], name = "x"): RestorePoint => ({ id: name, name, kind, modifiedMs: 0, bytes: 1 });

test("each kind of restore point is named for what it is", () => {
  assert.equal(restoreLabel(p("manual")), "Your backup");
  assert.equal(restoreLabel(p("daily")), "Daily automatic backup");
  assert.equal(restoreLabel(p("beforeRestore")), "Saved before a restore");
  assert.equal(restoreLabel(p("beforeUpdate", "pre-update 0.1.0 to 0.2.0 2026-11-20_08-00-00.db")), "Saved before updating 0.1.0 → 0.2.0");
  assert.equal(restoreLabel(p("beforeUpdate", "pre-update.db")), "Saved before an update");
});

test("only the newest are shown at first", () => {
  const all = Array.from({ length: 12 }, (_, i) => p("daily", String(i)));
  assert.deepEqual(visiblePoints(all, 5).shown.map((x) => x.id), ["0", "1", "2", "3", "4"]);
  assert.equal(visiblePoints(all, 5).more, 7);
  assert.equal(visiblePoints(all.slice(0, 2), 5).more, 0);
});
