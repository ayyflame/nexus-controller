import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_GROUPS, PAGE_IDS, SEARCH_ITEMS, resolvePage } from "./navigation.ts";

test("every page has exactly one place in the sidebar (Settings in the footer)", () => {
  const ids = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length, "no duplicate destinations");
  assert.ok(!ids.includes("settings"));
  assert.deepEqual([...PAGE_IDS].sort(), [...ids, "settings"].sort());
  // Labels are unique too, so nothing reads like two ways to the same place.
  const labels = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
  assert.equal(new Set(labels).size, labels.length);
});

test("Mapping is a top-level destination, not a tab", () => {
  const controller = NAV_GROUPS.find((g) => g.label === "Your controller")!;
  assert.equal(controller.items[0]!.id, "mapping");
  assert.deepEqual(resolvePage("mapping"), { page: "mapping" });
});

test("old Controller page links land on the page that now holds that setting", () => {
  assert.deepEqual(resolvePage("controller", "buttons"), { page: "mapping" });
  assert.deepEqual(resolvePage("controller", "output"), { page: "virtual-controller" });
  assert.deepEqual(resolvePage("controller", "sticks"), { page: "sticks" });
  assert.deepEqual(resolvePage("controller", "triggers"), { page: "triggers" });
  assert.deepEqual(resolvePage("controller", "gyro"), { page: "motion" });
  assert.deepEqual(resolvePage("controller", "touchpad"), { page: "touchpad" });
  assert.deepEqual(resolvePage("controller", "lighting"), { page: "lighting" });
  // The Controller page's Live tab duplicated Live Viewer's.
  assert.deepEqual(resolvePage("controller", "live"), { page: "live-viewer", tab: "live" });
  assert.deepEqual(resolvePage("controller"), { page: "mapping" });
  assert.deepEqual(resolvePage("live-viewer", "calibration"), { page: "live-viewer", tab: "calibration" });
  assert.deepEqual(resolvePage("nowhere"), { page: "dashboard" });
});

test("every search result opens a real page (no links into the old Controller tabs)", () => {
  for (const s of SEARCH_ITEMS) {
    assert.ok((PAGE_IDS as string[]).includes(s.page), `${s.label} → ${s.page}`);
  }
  const hits = (q: string) => SEARCH_ITEMS.filter((s) => `${s.label} ${s.hint} ${s.keywords}`.toLowerCase().includes(q)).map((s) => s.page);
  assert.ok(hits("remap").includes("mapping"));
  assert.ok(hits("deadzone").includes("sticks"));
  assert.ok(hits("gyro").includes("motion"));
  assert.ok(hits("vigem").includes("virtual-controller"));
});
