import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyIn, findIslands, frameIn, type V3 } from "./dualsenseModel.ts";
import { DS4_MODEL_CREDIT, DS4_NORMALISE, DS4_PARTS, DUALSHOCK4_SPEC } from "./dualshock4Model.ts";
import type { MacroButton } from "../types/engine";

type M = number[]; // column-major 4x4

/** Reads the shipped GLB without three.js (handles interleaved vertex data). */
function loadGlb() {
  const buf = readFileSync(new URL("../assets/models/dualshock4.glb", import.meta.url));
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i: number): Float32Array | Uint32Array => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? n * size;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const out = a.componentType === 5126 ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = k * stride + c * size;
      out[k * n + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : size === 4 ? dv.getUint32(o, true) : size === 2 ? dv.getUint16(o, true) : dv.getUint8(o);
    }
    return out;
  };
  return { json, read };
}

const mul = (a: M, b: M): M => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
};
const IDENTITY: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Every mesh primitive in the shared frame: node transforms, then the normalisation (as buildModel does). */
function framedPrimitives() {
  const { json, read } = loadGlb();
  const out: Array<{ material: string; pos: Float32Array; index: Uint32Array | null; world: M }> = [];
  const walk = (i: number, parent: M) => {
    const n = json.nodes[i];
    assert.ok(!n.translation && !n.rotation && !n.scale, "only matrices in this file");
    const world = mul(parent, n.matrix ?? IDENTITY);
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const raw = read(p.attributes.POSITION) as Float32Array;
        const pos = new Float32Array(raw.length);
        const { centre, scale } = DS4_NORMALISE;
        for (let v = 0; v < raw.length / 3; v++) for (let r = 0; r < 3; r++) {
          const w = world[r]! * raw[3 * v]! + world[4 + r]! * raw[3 * v + 1]! + world[8 + r]! * raw[3 * v + 2]! + world[12 + r]!;
          pos[3 * v + r] = (w - centre[r]!) * scale;
        }
        out.push({ material: json.materials[p.material].name, pos, index: p.indices !== undefined ? (read(p.indices) as Uint32Array) : null, world });
      }
    }
    for (const c of n.children ?? []) walk(c, world);
  };
  for (const root of json.scenes[0].nodes) walk(root, IDENTITY);
  return out;
}

test("the model file is your credited CC BY 4.0 DualShock 4 model", () => {
  const { json } = loadGlb();
  assert.equal(json.asset.extras.title, DS4_MODEL_CREDIT.title);
  assert.match(json.asset.extras.author, /^shaielwolf/);
  assert.match(json.asset.extras.license, /^CC-BY-4\.0/);
  assert.equal(json.asset.extras.source, DS4_MODEL_CREDIT.source);
});

test("its node transforms cancel out and it fits the shared frame like the DualSense", () => {
  const prims = framedPrimitives();
  for (const p of prims) p.world.forEach((v, i) => assert.ok(Math.abs(v - IDENTITY[i]!) < 1e-9, "identity world matrix"));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let v = 0; v < p.pos.length / 3; v++) for (let d = 0; d < 3; d++) {
    lo[d] = Math.min(lo[d]!, p.pos[3 * v + d]!);
    hi[d] = Math.max(hi[d]!, p.pos[3 * v + d]!);
  }
  // 2 units wide and centred, as the camera and lighting expect.
  assert.ok(Math.abs(hi[0]! - lo[0]! - 2) < 0.001, `width ${hi[0]! - lo[0]!}`);
  for (let d = 0; d < 3; d++) assert.ok(Math.abs(lo[d]! + hi[d]!) < 0.001, `centred on axis ${d}`);
  // Height and depth close to the DualSense's (about 1.3 and 0.82 units).
  assert.ok(hi[1]! - lo[1]! > 1.1 && hi[1]! - lo[1]! < 1.4);
  assert.ok(hi[2]! - lo[2]! > 0.7 && hi[2]! - lo[2]! < 0.95);
});

test("every DualShock 4 control is its own piece of the real model, exactly where expected", () => {
  const found = new Map<MacroButton, { islands: number; min: V3; max: V3 }>();
  let fixedTriangles = 0;
  for (const p of framedPrimitives()) {
    for (const isl of findIslands(p.pos, p.index)) {
      const b = classifyIn(DS4_PARTS, p.material, isl);
      if (!b) { fixedTriangles += isl.triangles.length; continue; }
      const f = found.get(b) ?? { islands: 0, min: [...isl.min] as V3, max: [...isl.max] as V3 };
      f.islands++;
      for (let d = 0; d < 3; d++) { f.min[d] = Math.min(f.min[d]!, isl.min[d]!); f.max[d] = Math.max(f.max[d]!, isl.max[d]!); }
      found.set(b, f);
    }
  }
  assert.deepEqual([...found.keys()].sort(), Object.keys(DS4_PARTS).sort(), "all 18 controls");
  assert.ok(!found.has("mute"), "a DualShock 4 has no Mute button");
  for (const [b, f] of found) assert.equal(f.islands, 1, `${b} is exactly one piece of geometry`);
  // Shell front and back, headphone jack, screws and USB port, the strips behind the bumpers.
  assert.equal(fixedTriangles, 20846 + 13560 + 1948 + 10936 + 2 * 664, "the shell and other fixed parts stay fixed");

  const c = (b: MacroButton, d: 0 | 1 | 2) => (found.get(b)!.min[d] + found.get(b)!.max[d]) / 2;
  for (const [l, r] of [["leftStick", "rightStick"], ["leftShoulder", "rightShoulder"], ["leftTrigger", "rightTrigger"], ["select", "start"]] as const) {
    assert.ok(Math.abs(c(l, 0) + c(r, 0)) < 0.01, `${l}/${r} mirrored`);
    assert.ok(c(l, 0) < 0, `${l} on the left`);
  }
  // D-pad on the left, face buttons on the right, in a cross.
  assert.ok(c("dpadUp", 1) > c("dpadLeft", 1) && c("dpadLeft", 1) > c("dpadDown", 1));
  assert.ok(c("dpadLeft", 0) < c("dpadUp", 0) && c("dpadUp", 0) < c("dpadRight", 0) && c("dpadRight", 0) < 0);
  assert.ok(c("north", 1) > c("west", 1) && c("west", 1) > c("south", 1) && c("west", 0) < c("north", 0) && c("north", 0) < c("east", 0));
  assert.ok(c("west", 0) > 0);
  // PS between the sticks, touchpad above them, bumpers above and in front of the triggers.
  assert.ok(Math.abs(c("home", 0)) < 0.01 && c("home", 1) < c("touchpad", 1));
  assert.ok(c("leftShoulder", 2) > c("leftTrigger", 2) && c("leftShoulder", 1) > c("leftTrigger", 1));
  assert.ok(c("leftStick", 2) > c("home", 2), "sticks stand out of the face");
});

test("DualShock 4 pivots: sticks tilt from their base, triggers swing from their top front edge", () => {
  const min: V3 = [-0.5, -0.2, 0.156], max: V3 = [-0.14, 0.16, 0.433];
  const stick = frameIn(DUALSHOCK4_SPEC, "leftStick", min, max);
  assert.deepEqual(stick.pivot, [-0.32, -0.020000000000000004, 0.156]);
  const t = frameIn(DUALSHOCK4_SPEC, "leftTrigger", [-0.72, 0.4, -0.23], [-0.49, 0.62, 0.01]);
  assert.ok(Math.abs(t.pivot[1] - 0.6) < 1e-9 && Math.abs(t.pivot[2] - -0.01) < 1e-9);
  assert.equal(DUALSHOCK4_SPEC.finishes, false, "shown in its own colours");
});
