// The Mapping page's connectors end at each control's anchor (frameIn). These
// tests check, on the real 3D models, that every anchor is a visible point of
// its own control from the default view: a ray from the camera to the anchor
// first meets that control, not another part and not empty space next to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAMERA_TARGET, VIEWS, fitRadius, orbitToOffset } from "./controller3d.ts";
import { DUALSENSE_SPEC, MODEL_SCALE, classify, classifyIn, findIslands, partAnchor, type ModelSpec, type V3 } from "./dualsenseModel.ts";
import { DS4_NORMALISE, DS4_PARTS, DUALSHOCK4_SPEC } from "./dualshock4Model.ts";
import type { MacroButton } from "../types/engine";

interface Tri { a: V3; b: V3; c: V3; part: MacroButton | null }

function glb(name: string) {
  const buf = readFileSync(new URL(`../assets/models/${name}`, import.meta.url));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i: number): number[] => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? n * size;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const out: number[] = [];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = k * stride + c * size;
      out.push(a.componentType === 5126 ? dv.getFloat32(o, true) : size === 4 ? dv.getUint32(o, true) : size === 2 ? dv.getUint16(o, true) : dv.getUint8(o));
    }
    return out;
  };
  return { json, read };
}

/** Triangles of a model in its shared frame, each labelled with the control it belongs to (null: the shell). */
function triangles(spec: ModelSpec, file: string, framed: boolean): Tri[] {
  const { json, read } = glb(file);
  const out: Tri[] = [];
  const add = (pos: number[], index: number[] | null, material: string, map: (v: V3) => V3) => {
    for (const isl of findIslands(pos, index)) {
      const part = framed ? classifyIn(DS4_PARTS, material, isl) : classify(material, isl);
      for (const t of isl.triangles) {
        const v = (k: number): V3 => { const i = index ? index[3 * t + k]! : 3 * t + k; return map([pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!]); };
        out.push({ a: v(0), b: v(1), c: v(2), part });
      }
    }
  };
  if (!framed) {
    for (const mesh of json.meshes) {
      const p = mesh.primitives[0];
      add(read(p.attributes.POSITION), p.indices !== undefined ? read(p.indices) : null, json.materials[p.material].name, (v) => v);
    }
    return out;
  }
  // The DualShock 4 file: node transforms (they cancel out) then the normalisation, as the app does.
  const { centre, scale } = DS4_NORMALISE;
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    for (const p of json.meshes[node.mesh].primitives) {
      const pos = read(p.attributes.POSITION);
      const framedPos = pos.map((x, i) => (x - centre[i % 3]!) * scale);
      add(framedPos, p.indices !== undefined ? read(p.indices) : null, json.materials[p.material].name, (v) => v);
    }
  }
  void spec;
  return out;
}

/** Ray–triangle intersection distance (Möller–Trumbore), or null. */
function hitDistance(o: V3, d: V3, t: Tri): number | null {
  const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const e1 = sub(t.b, t.a), e2 = sub(t.c, t.a), h = cross(d, e2), a = dot(e1, h);
  if (Math.abs(a) < 1e-12) return null;
  const f = 1 / a, s = sub(o, t.a), u = f * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1), v = f * dot(d, q);
  if (v < 0 || u + v > 1) return null;
  const dist = f * dot(e2, q);
  return dist > 1e-6 ? dist : null;
}

function check(spec: ModelSpec, file: string, framed: boolean) {
  const tris = triangles(spec, file, framed);
  // The default camera, in model units (the scene is the model scaled by MODEL_SCALE); 3:2 as on the Mapping page.
  const view = VIEWS.default;
  const off = orbitToOffset({ ...view, radius: fitRadius(view.radius, 1.5) });
  const eye0 = orbitToOffset(view);
  const eye: V3 = [0, 1, 2].map((k) => (CAMERA_TARGET[k]! + eye0[k]!) / MODEL_SCALE) as V3;
  const cam: V3 = [(CAMERA_TARGET[0] + off[0]) / MODEL_SCALE, (CAMERA_TARGET[1] + off[1]) / MODEL_SCALE, (CAMERA_TARGET[2] + off[2]) / MODEL_SCALE];
  const results: Record<string, string> = {};
  for (const b of Object.keys(spec.parts) as MacroButton[]) {
    const own = tris.filter((t) => t.part === b);
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const t of own) for (const v of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, v[k]!); max[k] = Math.max(max[k]!, v[k]!); }
    // As the app does (modelParts.buildModel): the control's own triangles decide its anchor.
    const anchor = partAnchor(spec, b, min, max, own.flatMap((t) => [...t.a, ...t.b, ...t.c]), eye);
    const dir: V3 = [anchor[0] - cam[0], anchor[1] - cam[1], anchor[2] - cam[2]];
    const len = Math.hypot(...dir);
    const d: V3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    let best = Infinity, part: MacroButton | null | undefined;
    for (const t of tris) { const h = hitDistance(cam, d, t); if (h !== null && h < best) { best = h; part = t.part; } }
    results[b] = part === undefined ? "nothing" : part === b ? (Math.abs(best - len) < 0.03 ? "ok" : `own part but ${(best - len).toFixed(3)} from the anchor`) : `hits ${part ?? "the shell"}`;
  }
  return results;
}

const allOk = (r: Record<string, string>) => Object.fromEntries(Object.keys(r).map((k) => [k, "ok"]));

test("DualSense: every connector end is on its own control, seen from the default view", () => {
  const r = check(DUALSENSE_SPEC, "dualsense.glb", false);
  assert.deepEqual(r, allOk(r));
});

test("DualShock 4: every connector end is on its own control, seen from the default view", () => {
  const r = check(DUALSHOCK4_SPEC, "dualshock4.glb", true);
  assert.deepEqual(r, allOk(r));
});
