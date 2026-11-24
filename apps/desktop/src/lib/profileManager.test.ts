import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_META, compatibility, copyName, matches, organize, relativeTime, summary, type ProfileMeta } from "./profileManager.ts";
import { defaultProcessing } from "./processing.ts";
import type { Profile, ProcessingConfig } from "../types/engine";

const profile = (id: number, name: string, patch: Partial<Profile> = {}, cfg: Partial<ProcessingConfig> = {}): Profile => ({
  id, name, virtualOutput: "xbox360", games: [], createdAtMs: id * 1000, updatedAtMs: id * 1000,
  processing: { ...defaultProcessing(), ...cfg }, ...patch,
});

const list = [
  profile(1, "Default"),
  profile(2, "Warzone", { games: ["cod.exe"], updatedAtMs: 9000 }),
  profile(3, "racing", { games: ["forza.exe"] }),
  profile(4, "Apex"),
];

test("search matches the name or a linked game, ignoring case", () => {
  assert.ok(matches(list[1]!, "WAR"));
  assert.ok(matches(list[1]!, "cod"));
  assert.ok(!matches(list[1]!, "forza"));
  assert.ok(matches(list[0]!, "  "), "empty search shows everything");
  const { pinned, others } = organize(list, EMPTY_META, "forza", "name");
  assert.deepEqual([...pinned, ...others].map((p) => p.name), ["racing"]);
});

test("pinned profiles come first in pin order; the rest follow the chosen sort", () => {
  const meta: ProfileMeta = { ...EMPTY_META, pinned: [4, 2], lastUsedMs: { "1": 50, "3": 900, "2": 100 } };
  const ids = (sort: Parameters<typeof organize>[3]) => {
    const o = organize(list, meta, "", sort);
    return [o.pinned.map((p) => p.id), o.others.map((p) => p.id)];
  };
  assert.deepEqual(ids("name"), [[4, 2], [1, 3]], "Default, racing (case-insensitive)");
  assert.deepEqual(ids("recent"), [[4, 2], [3, 1]], "most recently used first");
  assert.deepEqual(ids("modified"), [[4, 2], [3, 1]]);
  assert.deepEqual(ids("created"), [[4, 2], [3, 1]]);
  // Never-used profiles go last, by name.
  const o = organize(list, EMPTY_META, "", "recent");
  assert.deepEqual(o.others.map((p) => p.name), ["Apex", "Default", "racing", "Warzone"]);
  // A pinned profile that no longer exists or doesn't match the search is skipped.
  assert.deepEqual(organize(list, { ...meta, pinned: [99, 2] }, "apex", "name").pinned, []);
});

test("times read naturally", () => {
  const now = Date.UTC(2026, 10, 24, 12);
  assert.equal(relativeTime(null, now), "never");
  assert.equal(relativeTime(now - 20_000, now), "just now");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5 min ago");
  assert.equal(relativeTime(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(relativeTime(now - 26 * 3_600_000, now), "yesterday");
  assert.equal(relativeTime(now - 4 * 86_400_000, now), "4 days ago");
  assert.match(relativeTime(now - 40 * 86_400_000, now), /2026/);
});

test("the summary names what a profile changes", () => {
  assert.deepEqual(summary(profile(1, "x")), ["Default settings"]);
  const p = profile(2, "y", {}, {
    remap: [{ from: "south", to: "east" }],
    layers: [{ name: "L", activator: "leftShoulder", mode: "hold", remap: [] }],
    combos: [{ buttons: ["north", "south"], sends: ["home"], hideInputs: true }],
    leftStick: { ...defaultProcessing().leftStick, deadzone: 0.12 },
    gyro: { ...defaultProcessing().gyro, enabled: true },
  });
  assert.deepEqual(summary(p), ["1 remapped button", "1 shift layer", "1 combination", "deadzones 12 % / 5 %", "gyro aiming"]);
});

test("compatibility: a DualShock 4 has no Mute button and no player lights", () => {
  assert.deepEqual(compatibility(profile(1, "plain")), { dualShock4: [], general: [] });
  // Sending Mute is fine (it's what games receive); reading it isn't possible on a DualShock 4.
  assert.deepEqual(compatibility(profile(2, "sends", {}, { remap: [{ from: "south", to: "mute" }] })).dualShock4, []);
  assert.equal(compatibility(profile(3, "reads", {}, { remap: [{ from: "mute", to: "south" }] })).dualShock4.length, 1);
  assert.equal(compatibility(profile(4, "layer", {}, { layers: [{ name: "L", activator: "mute", mode: "hold", remap: [] }] })).dualShock4.length, 1);
  assert.equal(compatibility(profile(5, "combo", {}, { combos: [{ buttons: ["mute", "south"], sends: ["home"], hideInputs: false }] })).dualShock4.length, 1);
  const leds = profile(6, "leds", {}, { feedback: { ...defaultProcessing().feedback, playerLedsEnabled: true } });
  assert.match(compatibility(leds).dualShock4[0]!, /player lights/);
  assert.match(compatibility(profile(7, "ds4out", { virtualOutput: "dualShock4" })).general[0]!, /isn't available/);
});

test("copy names avoid every existing name", () => {
  assert.equal(copyName("Warzone", ["Warzone"]), "Warzone (copy)");
  assert.equal(copyName("Warzone", ["Warzone", "warzone (COPY)"]), "Warzone (copy 2)");
  assert.ok(copyName("x".repeat(40), []).length <= 40);
});
