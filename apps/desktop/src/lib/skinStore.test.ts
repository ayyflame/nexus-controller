import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_KEY, OLD_FINISH_KEY, createSkinLibrary, memoryBackend, type Prefs } from "./skinStore.ts";
import { newSkin, setStyle } from "./skin.ts";

function prefs(init: Record<string, string> = {}): Prefs & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => { data[k] = v; } };
}

test("first start with Studio keeps the colour picked with the old switch", () => {
  assert.equal(createSkinLibrary(memoryBackend(), prefs({ [OLD_FINISH_KEY]: "white" })).getState().activeId, "preset-arctic");
  assert.equal(createSkinLibrary(memoryBackend(), prefs()).getState().activeId, "preset-midnight");
  assert.equal(createSkinLibrary(memoryBackend(), prefs({ [ACTIVE_KEY]: "preset-titanium" })).getState().activeId, "preset-titanium");
});

test("save, rename, duplicate, delete; designs survive a restart (same storage)", async () => {
  let t = 100;
  const backend = memoryBackend();
  const p = prefs();
  const lib = createSkinLibrary(backend, p, () => ++t);
  await lib.load();
  const a = await lib.save(setStyle(newSkin("Red", "black", 1), "frontShell", { color: "#ff0000" }));
  lib.setActive(a.id);
  await lib.rename(a.id, "  Crimson  ");
  const copy = await lib.duplicate(a.id);
  assert.notEqual(copy.id, a.id);
  assert.equal(copy.name, "Crimson copy");
  assert.equal(copy.components.frontShell?.color, "#ff0000");
  assert.deepEqual(lib.getState().skins.map((s) => s.name), ["Crimson copy", "Crimson"], "newest first");

  // "Restart": a new library over the same storage and preferences.
  const again = createSkinLibrary(backend, p, () => ++t);
  await again.load();
  assert.deepEqual(again.getState().skins.map((s) => s.name).sort(), ["Crimson", "Crimson copy"]);
  assert.equal(again.active().name, "Crimson", "the active skin is remembered");

  await again.remove(a.id);
  assert.equal(again.getState().activeId, "preset-midnight", "deleting the active skin falls back to Midnight Black");
  assert.deepEqual(again.getState().skins.map((s) => s.name), ["Crimson copy"]);
});

test("presets resolve by id; unknown ids fall back to Midnight Black", async () => {
  const lib = createSkinLibrary(memoryBackend(), prefs());
  await lib.load();
  assert.equal(lib.resolve("preset-cyberpunk").name, "Cyberpunk");
  assert.equal(lib.resolve("gone").name, "Midnight Black");
});

test("a damaged stored record is skipped, not deleted; a storage failure is reported", async () => {
  const good = newSkin("Good", "white", 1);
  const backend = memoryBackend([good, { id: "broken", format: "something-else" }]);
  const lib = createSkinLibrary(backend, prefs());
  await lib.load();
  assert.deepEqual(lib.getState().skins.map((s) => s.name), ["Good"]);
  assert.equal((await backend.all()).length, 2, "the unreadable record is left alone");

  const failing = createSkinLibrary({ all: async () => { throw new Error("blocked"); }, put: async () => {}, remove: async () => {} }, prefs());
  await failing.load();
  assert.match(failing.getState().error ?? "", /couldn't be read/);
});

test("listeners hear about changes", async () => {
  const lib = createSkinLibrary(memoryBackend(), prefs());
  let n = 0;
  const off = lib.subscribe(() => n++);
  await lib.load();
  lib.setActive("preset-stealth");
  off();
  lib.setActive("preset-blood");
  assert.equal(n, 2);
});
