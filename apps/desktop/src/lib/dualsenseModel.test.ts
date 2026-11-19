import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodePng } from "./pngDecode.test-helper.ts";
import { BLACK_FINISH_GLSL, BLACK_PLATE, isStickBase, shellZoneOf, BLACK_PRINT, FINISH_BANDS, blackFinishPixel, classify, findIslands, frameOf, PARTS, type V3 } from "./dualsenseModel.ts";
import type { MacroButton } from "../types/engine";

/** Reads the shipped GLB without three.js: JSON chunk + binary chunk. */
function loadGlb() {
  const buf = readFileSync(new URL("../assets/models/dualsense.glb", import.meta.url));
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i: number) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = a.count * ({ SCALAR: 1, VEC3: 3 } as Record<string, number>)[a.type]!;
    const off = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const copy = bin.buffer.slice(off, off + n * (a.componentType === 5123 ? 2 : 4));
    return a.componentType === 5126 ? new Float32Array(copy) : a.componentType === 5123 ? new Uint16Array(copy) : new Uint32Array(copy);
  };
  return { json, read };
}

test("the model file is the credited CC BY 4.0 model", () => {
  const { json } = loadGlb();
  assert.match(json.asset.extras.license, /^CC-BY-4\.0/);
  assert.match(json.asset.extras.author, /^AHarmlessPotato/);
});

test("every control is found in the real model, each exactly where expected", () => {
  const { json, read } = loadGlb();
  const found = new Map<MacroButton, { islands: number; min: V3; max: V3 }>();
  for (const mesh of json.meshes) {
    const p = mesh.primitives[0];
    const material = json.materials[p.material].name as string;
    for (const isl of findIslands(read(p.attributes.POSITION), p.indices !== undefined ? read(p.indices) : null)) {
      const b = classify(material, isl);
      if (!b) continue;
      const f = found.get(b) ?? { islands: 0, min: [...isl.min] as V3, max: [...isl.max] as V3 };
      f.islands++;
      for (let d = 0; d < 3; d++) { f.min[d] = Math.min(f.min[d]!, isl.min[d]!); f.max[d] = Math.max(f.max[d]!, isl.max[d]!); }
      found.set(b, f);
    }
  }
  assert.deepEqual([...found.keys()].sort(), Object.keys(PARTS).sort(), "all 19 controls");
  const islands = Object.fromEntries([...found].map(([b, f]) => [b, f.islands]));
  // Body + printed symbol / arrow for face buttons and D-pad, cap + base for sticks, the PS button's pieces.
  assert.deepEqual(islands, {
    dpadUp: 2, dpadRight: 2, dpadDown: 2, dpadLeft: 2, north: 2, west: 2, south: 2, east: 2,
    leftStick: 2, rightStick: 2, home: 4, mute: 1, select: 1, start: 1,
    leftShoulder: 1, rightShoulder: 1, leftTrigger: 1, rightTrigger: 1, touchpad: 1,
  });
  // Left/right pairs mirror each other; the D-pad is on the left, face buttons on the right.
  const cx = (b: MacroButton) => (found.get(b)!.min[0] + found.get(b)!.max[0]) / 2;
  for (const [l, r] of [["leftStick", "rightStick"], ["leftShoulder", "rightShoulder"], ["leftTrigger", "rightTrigger"], ["select", "start"]] as const) {
    assert.ok(Math.abs(cx(l) + cx(r)) < 0.01, `${l}/${r} mirrored`);
    assert.ok(cx(l) < 0, `${l} on the left`);
  }
  assert.ok(cx("dpadUp") < 0 && cx("north") > 0);
  // Triggers sit behind the face, bumpers in front of them.
  const cz = (b: MacroButton) => (found.get(b)!.min[2] + found.get(b)!.max[2]) / 2;
  assert.ok(cz("leftTrigger") < cz("leftShoulder"));
});

test("an island far from every control is part of the shell", () => {
  assert.equal(classify("1001", { min: [0, -0.2, 0], max: [0.01, -0.19, 0.01] }), null);
  assert.equal(classify("1002", { min: [-0.63, 0.37, 0.28], max: [-0.61, 0.38, 0.29] }), null, "wrong material");
  assert.equal(classify("1001", { min: [-0.63, 0.37, 0.28], max: [-0.61, 0.38, 0.29] }), "dpadUp");
});

test("islands: connected triangles group together, welded across seams", () => {
  // Two triangles sharing an edge through duplicated (seam) vertices, plus one apart.
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, /* seam copies */ 1, 0, 0, 0, 1, 0, 1, 1, 0, /* apart */ 5, 5, 5, 6, 5, 5, 5, 6, 5];
  const isl = findIslands(pos, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(isl.length, 2);
  const sizes = isl.map((i) => i.triangles.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test("pivots: sticks tilt from inside the body, triggers swing from their top front edge", () => {
  const s = frameOf("leftStick", [-0.45, -0.13, 0.28], [-0.19, 0.13, 0.41]);
  assert.deepEqual(s.pivot.map((v) => +v.toFixed(3)), [-0.32, 0, 0.12]);
  assert.equal(s.anchor[2], 0.41);
  const t = frameOf("leftTrigger", [-0.75, 0.41, -0.24], [-0.47, 0.65, 0.0]);
  assert.deepEqual(t.pivot.map((v) => +v.toFixed(3)), [-0.61, 0.63, -0.02]);
});

test("Midnight Black: white plastic turns near-black, grey printing turns light, dark parts stay dark", () => {
  assert.deepEqual(blackFinishPixel(232, 228, 238), BLACK_PLATE, "white plate");
  assert.deepEqual(blackFinishPixel(200, 200, 200), BLACK_PLATE, "light grey plastic");
  const symbol = blackFinishPixel(120, 120, 124);
  assert.ok(symbol[0] > 150, "a grey printed symbol becomes light, so it shows on black");
  const core = blackFinishPixel(46, 49, 64);
  assert.ok(core[0] < 46 && core[0] > 30, "the dark core stays dark");
  // Blending at a white→grey edge stays between the two results, without jumps.
  let prev = blackFinishPixel(0, 0, 0)[0];
  for (let v = 0; v <= 255; v += 5) {
    const x = blackFinishPixel(v, v, v)[0];
    assert.ok(x >= 0 && x <= 255);
    assert.ok(Math.abs(x - prev) < 45, `smooth near ${v}`);
    prev = x;
  }
});

test("the shader version of Midnight Black uses exactly the tested rule's colours and bands", () => {
  const n = (v: number) => (v / 255).toFixed(4);
  assert.ok(BLACK_FINISH_GLSL.includes(`vec3(${BLACK_PLATE.map(n).join(", ")})`), "plate colour");
  assert.ok(BLACK_FINISH_GLSL.includes(`vec3(${BLACK_PRINT.map(n).join(", ")})`), "print colour");
  assert.ok(BLACK_FINISH_GLSL.includes(`smoothstep( ${FINISH_BANDS.white[0].toFixed(4)}, ${FINISH_BANDS.white[1].toFixed(4)}, l )`), "white band");
  assert.ok(BLACK_FINISH_GLSL.includes(`smoothstep( ${FINISH_BANDS.print[0].toFixed(4)}, ${FINISH_BANDS.print[1].toFixed(4)}, l )`), "print band");
  assert.match(BLACK_FINISH_GLSL, /uniform float nexusBlack;/);
});

test("the app's security policy lets the 3D model's embedded textures load", () => {
  // three.js unpacks a GLB's textures into blob: URLs and fetches them; without
  // blob: in connect-src and img-src the controller renders untextured (all white).
  const conf = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const csp: string = conf.app.security.csp;
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";
  assert.match(directive("connect-src"), /(^|\s)blob:(\s|$)/);
  assert.match(directive("img-src"), /(^|\s)blob:(\s|$)/);
  assert.doesNotMatch(csp, /\*|https?:\/\/(?!ipc\.localhost)/, "still no outside hosts");
});


test("the shell splits into front, rear, grips and centre trim by the model's own paint regions", () => {
  const buf = readFileSync(new URL("../assets/models/dualsense.glb", import.meta.url));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const bin = buf.subarray(20 + jsonLen + 8);
  const view = (i: number) => { const bv = json.bufferViews[i]; return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength); };
  const read = (i: number) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[a.type]!;
    const off = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const copy = bin.buffer.slice(off, off + n * (a.componentType === 5123 ? 2 : 4));
    return a.componentType === 5126 ? new Float32Array(copy) : a.componentType === 5123 ? new Uint16Array(copy) : new Uint32Array(copy);
  };
  const counts: Record<string, number> = {};
  let stickBases = 0;
  for (const mesh of json.meshes) {
    const p = mesh.primitives[0];
    const mat = json.materials[p.material];
    if (mat.name === "1001") continue;
    // 1002 (the back housing) is all white plastic and stored as JPEG; only 1011's PNG needs reading.
    const png = mat.name === "1011"
      ? decodePng(Buffer.from(view(json.images[json.textures[mat.pbrMetallicRoughness.baseColorTexture.index].source].bufferView)))
      : null;
    const pos = read(p.attributes.POSITION) as Float32Array;
    const uv = read(p.attributes.TEXCOORD_0) as Float32Array;
    const idx = read(p.indices);
    for (const isl of findIslands(pos, idx)) {
      if (classify(mat.name, isl)) continue;
      if (isStickBase(mat.name, isl)) { stickBases++; continue; }
      for (const t of isl.triangles) {
        const c: V3 = [0, 0, 0]; let u = 0, v = 0;
        for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]!; for (let d = 0; d < 3; d++) c[d] = c[d]! + pos[3 * i + d]! / 3; u += uv[2 * i]! / 3; v += uv[2 * i + 1]! / 3; }
        let l = 1;
        if (png) {
          const px = Math.min(png.width - 1, Math.floor((u % 1) * png.width)), py = Math.min(png.height - 1, Math.floor((v % 1) * png.height));
          const o = (py * png.width + px) * png.channels;
          l = png.channels >= 3 ? (0.2126 * png.data[o]! + 0.7152 * png.data[o + 1]! + 0.0722 * png.data[o + 2]!) / 255 : png.data[o]! / 255;
        }
        const z = shellZoneOf(mat.name, c, l, 0);
        counts[z] = (counts[z] ?? 0) + 1;
      }
    }
  }
  assert.equal(stickBases, 2, "one ring per stick");
  for (const z of ["frontShell", "rearShell", "gripLeft", "gripRight", "centerTrim"]) assert.ok((counts[z] ?? 0) > 1000, `${z}: ${counts[z]}`);
  const g = (counts.gripLeft! - counts.gripRight!) / counts.gripLeft!;
  assert.ok(Math.abs(g) < 0.2, `grips are roughly mirror images (${counts.gripLeft} / ${counts.gripRight})`);
});

test("zone rules: light bar glow, grips, white plastic and the dark core", () => {
  assert.equal(shellZoneOf("1011", [0, 0.5, 0.25], 0.2, 0.9), "lightBar");
  assert.equal(shellZoneOf("1011", [-0.7, -0.5, 0], 0.9, 0), "gripLeft");
  assert.equal(shellZoneOf("1002", [0.7, -0.5, -0.3], 0.9, 0), "gripRight");
  assert.equal(shellZoneOf("1002", [0.2, 0.3, -0.3], 0.9, 0), "rearShell");
  assert.equal(shellZoneOf("1011", [0.6, 0.3, 0.25], 0.9, 0), "frontShell");
  assert.equal(shellZoneOf("1011", [0.1, -0.1, 0.25], 0.2, 0), "centerTrim");
  assert.equal(shellZoneOf("1011", [-0.7, -0.5, 0], 0.2, 0), "centerTrim", "dark plastic in a grip stays with the core");
});
