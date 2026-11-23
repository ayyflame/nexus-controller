import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ART_SCALE, DS4_OUTLINES, DS4_TOUCH_BOX, DS4_TRIGGERS, artPosition, boundsOf, pointsOf, toArt } from "./dualshock4Art.ts";
import { DS4_NORMALISE, DS4_PARTS } from "./dualshock4Model.ts";
import type { MacroButton } from "../types/engine";

/** Is (x, y) inside the polygon (even-odd rule)? */
function inside(poly: Array<[number, number]>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const area = (poly: Array<[number, number]>) =>
  Math.abs(poly.reduce((a, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]!; return a + x * y2 - x2 * y; }, 0)) / 2;

const body = pointsOf(DS4_OUTLINES.body);
const CONTROLS = Object.keys(DS4_PARTS) as MacroButton[];

test("every DualShock 4 control is drawn where the 3D model has it, inside the body", () => {
  for (const b of CONTROLS) {
    const p = DS4_PARTS[b]!;
    const [x, y] = toArt(p.centre[0], p.centre[1]);
    assert.deepEqual(artPosition(b), { x, y }, `${b} from the model's part table`);
    if (b !== "leftShoulder" && b !== "rightShoulder" && b !== "leftTrigger" && b !== "rightTrigger") {
      assert.ok(inside(body, x, y), `${b} inside the body outline`);
    }
  }
  assert.throws(() => artPosition("mute"), /no mute/);
  // Mirrored pairs, D-pad left, face buttons right, PS in the middle.
  // (The D-pad arms sit closer together than the face buttons on the real controller, so only the clusters mirror.)
  for (const [l, r] of [["leftStick", "rightStick"], ["select", "start"], ["dpadUp", "north"], ["dpadDown", "south"]] as const) {
    assert.ok(Math.abs(artPosition(l).x + artPosition(r).x - 800) < 1, `${l}/${r} mirrored`);
  }
  assert.equal(artPosition("home").x, 400);
  assert.ok(artPosition("dpadUp").y < artPosition("dpadDown").y, "up is up");
});

test("the outlines fit the DualSense drawing's frame", () => {
  const b = boundsOf(DS4_OUTLINES.body);
  assert.ok(Math.abs(b.x + b.w / 2 - 400) < 1, "centred");
  assert.ok(b.w > 700 && b.w < 730, `about as wide as the DualSense drawing (720): ${b.w}`);
  assert.ok(b.y > -38 && b.y + b.h < 520, "inside the viewBox");
  // Touchpad inside the body, bumpers on its top edge, left/right mirrored.
  const t = DS4_TOUCH_BOX;
  // The touchpad sits in a notch of the shell's top edge: its centre and lower corners are inside the body.
  for (const [x, y] of [[t.x + t.w / 2, t.y + t.h / 2], [t.x + 10, t.y + t.h - 10], [t.x + t.w - 10, t.y + t.h - 10]]) {
    assert.ok(inside(body, x!, y!), `touchpad point ${x},${y} inside body`);
  }
  assert.ok(t.x > b.x && t.x + t.w < b.x + b.w);
  const l = boundsOf(DS4_OUTLINES.leftShoulder), r = boundsOf(DS4_OUTLINES.rightShoulder);
  assert.ok(Math.abs(l.x + l.w + r.x - 800) < 1.5 && Math.abs(l.y - r.y) < 0.5, "bumpers mirrored");
  assert.ok(l.y < b.y + 5, "bumpers at the top");
  // L2/R2 tabs sit over their bumpers.
  const lt = DS4_TRIGGERS.leftTrigger;
  assert.ok(lt.outer >= l.x - 5 && lt.inner <= l.x + l.w + 5);
  assert.ok(Math.abs(DS4_TRIGGERS.leftTrigger.outer + DS4_TRIGGERS.rightTrigger.outer - 800) < 0.01);
});

/** Front view of the model's body (front and back shell meshes), rasterised at one cell per drawing unit. */
function modelSilhouette() {
  const buf = readFileSync(new URL("../assets/models/dualshock4.glb", import.meta.url));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i: number) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = a.type === "VEC3" ? 3 : 1, size = a.componentType === 5123 ? 2 : 4, stride = bv.byteStride ?? n * size;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const out = new Float64Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = k * stride + c * size;
      out[k * n + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : size === 2 ? dv.getUint16(o, true) : dv.getUint32(o, true);
    }
    return out;
  };
  const W = 800, H = 560, OY = 40;
  const grid = new Uint8Array(W * H);
  const { centre, scale } = DS4_NORMALISE;
  const shells = json.nodes.filter((n: { name?: string; children?: number[] }) => n.name === "Front_2" || n.name === "Back_4");
  for (const shell of shells) {
    const meshNode = json.nodes[json.nodes[shell.children[0]].children[0]];
    const p = json.meshes[meshNode.mesh].primitives[0];
    const pos = read(p.attributes.POSITION), idx = read(p.indices);
    const at = (v: number) => toArt((pos[3 * v]! - centre[0]) * scale, (pos[3 * v + 1]! - centre[1]) * scale);
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [at(idx[t]!), at(idx[t + 1]!), at(idx[t + 2]!)];
      const ys = tri.map((q) => q[1] + OY);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
        const yc = y + 0.5, xs: number[] = [];
        for (let e = 0; e < 3; e++) {
          const a = tri[e]!, b2 = tri[(e + 1) % 3]!, ay = a[1] + OY, by = b2[1] + OY;
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(a[0] + ((yc - ay) / (by - ay)) * (b2[0] - a[0]));
        }
        if (xs.length < 2) continue;
        for (let x = Math.max(0, Math.ceil(Math.min(...xs) - 0.5)); x <= Math.min(W - 1, Math.floor(Math.max(...xs) - 0.5)); x++) grid[y * W + x] = 1;
      }
    }
  }
  let filled = 0, minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y * W + x]) {
    filled++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y - OY); maxY = Math.max(maxY, y - OY);
  }
  return { filled, minX, maxX, minY, maxY };
}

test("the drawn body is the model's own front silhouette", () => {
  const m = modelSilhouette();
  const b = boundsOf(DS4_OUTLINES.body);
  assert.ok(Math.abs(b.x - m.minX) < 2 && Math.abs(b.x + b.w - (m.maxX + 1)) < 2, "same width as the model");
  assert.ok(Math.abs(b.y - m.minY) < 2 && Math.abs(b.y + b.h - (m.maxY + 1)) < 2, "same height as the model");
  const drawn = area(body);
  assert.ok(Math.abs(drawn - m.filled) / m.filled < 0.01, `same area within 1 %: drawn ${drawn.toFixed(0)}, model ${m.filled}`);
  assert.equal(ART_SCALE, 360, "2 model units = 720 drawing units, as wide as the DualSense drawing");
});
