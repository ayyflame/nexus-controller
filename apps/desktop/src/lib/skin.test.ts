import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENTS, COMPONENT_IDS, DEFAULT_LIGHT_BAR, FINISHES, FINISH_IDS, LIMITS, PRESETS, SKIN_VERSION,
  copyStyle, exportSkin, fileNameFor, fitWithin, hexToRgb, importSkin, isPlain, lightness, migrateSkin, newSkin,
  normalizeHex, pasteStyle, presetSkin, pushRecent, randomSkin, resetAll, resetComponent, rgbToHex, searchComponents,
  setStyle, sniffImage, styleOf, type Skin,
} from "./skin.ts";

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("every control and shell part can be styled, each listed once", () => {
  for (const b of ["north", "east", "south", "west", "dpadUp", "dpadRight", "dpadDown", "dpadLeft", "leftShoulder",
    "rightShoulder", "leftTrigger", "rightTrigger", "home", "select", "start", "leftStick", "rightStick", "touchpad"]) {
    assert.ok(COMPONENT_IDS.includes(b as never), b);
  }
  for (const z of ["frontShell", "rearShell", "gripLeft", "gripRight", "centerTrim", "lightBar", "stickBases"]) assert.ok(COMPONENT_IDS.includes(z as never), z);
  assert.equal(new Set(COMPONENT_IDS).size, COMPONENT_IDS.length);
});

test("component search matches labels, groups and keywords", () => {
  assert.deepEqual(searchComponents("trig").map((c) => c.id), ["leftTrigger", "rightTrigger"]);
  assert.deepEqual(searchComponents("rgb").map((c) => c.id), ["lightBar"]);
  assert.ok(searchComponents("d-pad").length === 4);
  assert.equal(searchComponents("").length, COMPONENTS.length);
  assert.deepEqual(searchComponents("left grip").map((c) => c.id), ["gripLeft"]);
});

test("finishes are real material settings, not just colours", () => {
  assert.deepEqual(FINISH_IDS, ["original", "matte", "satin", "gloss", "metallic", "chrome", "carbon", "rubber", "brushed"]);
  assert.ok(FINISHES.chrome.metalness === 1 && FINISHES.chrome.roughness < 0.1);
  assert.ok(FINISHES.gloss.clearcoat === 1 && FINISHES.matte.roughness > 0.9);
  assert.ok(FINISHES.brushed.anisotropy > 0 && FINISHES.brushed.texture === "brushed");
  assert.equal(FINISHES.carbon.texture, "carbon");
  assert.equal(FINISHES.rubber.texture, "rubber");
  for (const f of Object.values(FINISHES)) for (const k of ["roughness", "metalness", "clearcoat", "sheen", "anisotropy"] as const) assert.ok(f[k] >= 0 && f[k] <= 1);
});

test("editing one component leaves the others alone; plain styles are not stored", () => {
  const s0 = newSkin("A", "black", 1);
  const s1 = setStyle(s0, "north", { color: "#ff0000", finish: "gloss" });
  assert.deepEqual(styleOf(s1, "north"), { color: "#ff0000", finish: "gloss", gradient: null, pattern: null });
  assert.equal(s1.components.east, undefined);
  assert.equal(s0.components.north, undefined, "the original skin is unchanged");
  const s2 = setStyle(s1, "north", { color: null, finish: "original" });
  assert.equal(s2.components.north, undefined, "back to plain → removed");
  assert.ok(isPlain(styleOf(s2, "north")));
});

test("reset one component, reset everything", () => {
  let s = setStyle(setStyle(newSkin("A", "black", 1), "frontShell", { color: "#123456" }), "south", { color: "#00ff00" });
  s = { ...s, lightBar: "#ff0000", decals: [{ id: "d", component: "frontShell", image: PNG_1PX, x: 0.5, y: 0.5, scale: 0.3, rotation: 0, opacity: 1 }] };
  const r1 = resetComponent(s, "frontShell");
  assert.equal(r1.components.frontShell, undefined);
  assert.equal(r1.decals.length, 0, "its graphics go too");
  assert.equal(r1.components.south?.color, "#00ff00", "others kept");
  assert.equal(resetComponent(s, "lightBar").lightBar, DEFAULT_LIGHT_BAR);
  const all = resetAll(s);
  assert.deepEqual([all.components, all.decals, all.lightBar, all.name, all.id], [{}, [], DEFAULT_LIGHT_BAR, s.name, s.id]);
});

test("copy and paste styles between components", () => {
  const s = setStyle(newSkin("A", "black", 1), "north", { color: "#abcdef", finish: "chrome" });
  const c = copyStyle(s, "north", ["east", "south", "lightBar"]);
  assert.equal(c.components.east?.finish, "chrome");
  assert.equal(c.components.south?.color, "#abcdef");
  assert.equal(c.components.lightBar, undefined, "the light bar only takes a glow colour");
  const p = pasteStyle(s, styleOf(s, "north"), ["leftStick"]);
  assert.equal(p.components.leftStick?.color, "#abcdef");
});

test("colour helpers: hex/RGB, lightness, recent colours", () => {
  assert.equal(normalizeHex("ABC"), "#aabbcc");
  assert.equal(normalizeHex("#1a2B3c"), "#1a2b3c");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("red"), null);
  assert.deepEqual(hexToRgb("#ff8000"), [255, 128, 0]);
  assert.equal(rgbToHex(255, 128, 0), "#ff8000");
  assert.equal(rgbToHex(300, -5, Number.NaN), "#ff0000");
  assert.ok(lightness("#ffffff") > 0.99 && lightness("#000000") === 0);
  assert.deepEqual(pushRecent(["#111111", "#222222"], "#222222"), ["#222222", "#111111"]);
  assert.equal(pushRecent(Array.from({ length: 12 }, (_, i) => rgbToHex(i, i, i)), "#ffffff").length, 12);
});

test("the ten presets exist and each configures the model", () => {
  const names = PRESETS.map((p) => p.spec.name);
  assert.deepEqual(names, ["Midnight Black", "Arctic White", "Cyberpunk", "Neon RGB", "Carbon Fiber", "Stealth", "Blood Red", "Purple Haze", "Titanium", "Custom"]);
  for (const p of PRESETS) {
    const s = presetSkin(p.id)!;
    assert.equal(s.version, SKIN_VERSION);
    const r = migrateSkin(s);
    assert.ok(r.ok, p.id);
    assert.deepEqual(r.ok && r.skin.components, s.components, `${p.id} survives validation unchanged`);
  }
  assert.equal(presetSkin("preset-midnight")!.base, "black");
  assert.equal(presetSkin("preset-arctic")!.base, "white");
  assert.equal(presetSkin("preset-carbon")!.components.frontShell?.finish, "carbon");
  assert.equal(presetSkin("preset-titanium")!.components.north?.finish, "chrome");
  assert.ok(Object.keys(presetSkin("preset-cyberpunk")!.components).length > 10);
  assert.equal(presetSkin("nope"), null);
});

test("random skins are coherent, valid and repeatable for a seed", () => {
  const base = newSkin("R", "black", 1);
  const a = randomSkin(base, 42);
  assert.deepEqual(randomSkin(base, 42), a, "same seed → same skin");
  assert.notDeepEqual(randomSkin(base, 43).components, a.components);
  const r = migrateSkin(a);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.skin.components, a.components);
  assert.equal(a.components.gripLeft?.color, a.components.frontShell?.color, "grips match the shell");
  assert.equal(a.id, base.id, "keeps identity");
});

test("export → import round trip; import never overwrites an existing skin", () => {
  let s = setStyle(newSkin("My skin", "white", 1000), "frontShell", { color: "#ff0000", gradient: { to: "#0000ff", angle: 45 }, pattern: { id: "hex", color: "#000000", scale: 2, opacity: 0.4 } });
  s = { ...s, decals: [{ id: "d1", component: "touchpad", image: PNG_1PX, x: 0.4, y: 0.6, scale: 0.5, rotation: 30, opacity: 0.8 }], thumbnail: PNG_1PX };
  const text = exportSkin(s);
  assert.ok(!text.includes("thumbnail"), "thumbnail not exported");
  const r = importSkin(text, 2000);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.notEqual(r.skin.id, s.id, "new id");
  assert.deepEqual(r.skin.components, s.components);
  assert.deepEqual(r.skin.decals, s.decals);
  assert.equal(r.skin.base, "white");
  assert.equal(r.skin.createdAt, 2000);
  assert.equal(fileNameFor(s), "My-skin.nexusskin.json");
});

test("bad or hostile files are rejected or cleaned", () => {
  assert.equal(importSkin("{nope").ok, false);
  assert.equal(importSkin(JSON.stringify({ format: "other" })).ok, false);
  const future = importSkin(JSON.stringify({ format: "nexus-skin", version: 99 }));
  assert.ok(!future.ok && /newer NEXUS/.test(future.error));
  assert.equal(importSkin("x".repeat(LIMITS.fileBytes + 1)).ok, false);
  const r = importSkin(JSON.stringify({
    format: "nexus-skin", version: 1, name: "<script>alert(1)</script>".repeat(5), base: "purple", lighting: "disco",
    lightBar: "javascript:alert(1)",
    components: { frontShell: { color: "url(evil)", finish: "lava" }, evilPart: { color: "#ffffff" }, north: { color: "#00ff00", finish: "gloss", gradient: { to: "#zzz" }, pattern: { id: "skulls" } } },
    decals: [
      { component: "frontShell", image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
      { component: "north", image: PNG_1PX },
      { component: "rearShell", image: PNG_1PX, x: 9, scale: -3, rotation: 9999 },
    ],
  }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.skin.name.length, LIMITS.nameLength);
  assert.equal(r.skin.base, "black");
  assert.equal(r.skin.lighting, "studio");
  assert.equal(r.skin.lightBar, DEFAULT_LIGHT_BAR);
  assert.equal(r.skin.components.frontShell, undefined, "invalid colour and finish → plain → dropped");
  assert.deepEqual(r.skin.components.north, { color: "#00ff00", finish: "gloss", gradient: null, pattern: null });
  assert.equal(Object.keys(r.skin.components).length, 1);
  assert.equal(r.skin.decals.length, 1, "SVG and decals on unsupported parts removed");
  assert.deepEqual([r.skin.decals[0]!.x, r.skin.decals[0]!.scale, r.skin.decals[0]!.rotation], [1, 0.05, 180]);
  assert.ok(r.warnings.length >= 3);
});

test("uploaded images: real type from the bytes, sizes kept within limits", () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), null);
  assert.deepEqual(fitWithin(4000, 2000), [1024, 512]);
  assert.deepEqual(fitWithin(300, 200), [300, 200]);
});

test("older stored skins keep working (format version 1 is read as-is)", () => {
  const stored: Skin = { ...newSkin("Old", "black", 5), components: { south: { color: "#123123", finish: "satin", gradient: null, pattern: null } } };
  const r = migrateSkin(JSON.parse(JSON.stringify(stored)));
  assert.ok(r.ok && r.skin.id === stored.id && r.skin.components.south?.finish === "satin", "keeps id when loading from storage");
  assert.equal(FINISH_IDS.length, 9);
});
