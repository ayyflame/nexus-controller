import { test } from "node:test";
import assert from "node:assert/strict";
import { HOTSPOTS, PHOTO, STICK_TRAVEL, TOUCH_BOX, TRIGGER_METERS, isCalibratedPhoto, sha256Hex } from "./controllerPhoto.ts";
import type { Hotspot } from "./controllerPhoto.ts";

function bounds(h: Hotspot): [number, number, number, number] {
  if (h.kind === "circle") return [h.cx - h.r, h.cy - h.r, h.cx + h.r, h.cy + h.r];
  if (h.kind === "rect") return [h.x, h.y, h.x + h.w, h.y + h.h];
  const xs = h.points.map((p) => p[0]); const ys = h.points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

test("every pressable control except L2/R2 has a hotspot inside the image", () => {
  const expected = ["south", "east", "west", "north", "leftShoulder", "rightShoulder", "leftStick", "rightStick",
    "start", "select", "home", "touchpad", "mute", "dpadUp", "dpadDown", "dpadLeft", "dpadRight"];
  assert.deepEqual(Object.keys(HOTSPOTS).sort(), [...expected].sort());
  for (const [id, h] of Object.entries(HOTSPOTS)) {
    const [x0, y0, x1, y1] = bounds(h!);
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= PHOTO.width && y1 <= PHOTO.height, id);
  }
  for (const m of Object.values(TRIGGER_METERS)) assert.ok(m.y + m.h <= PHOTO.height);
});

test("hotspots are where a DualSense front view puts them, mirrored about the centre", () => {
  const c = (id: keyof typeof HOTSPOTS) => { const [a, b, x, y] = bounds(HOTSPOTS[id]!); return [(a + x) / 2, (b + y) / 2]; };
  const mid = 201.5; // centre line of the controller in the image
  const mirror = (a: keyof typeof HOTSPOTS, b: keyof typeof HOTSPOTS, tol: number) =>
    assert.ok(Math.abs((c(a)[0]! + c(b)[0]!) / 2 - mid) <= tol, `${a}/${b} not mirrored`);
  mirror("leftStick", "rightStick", 1);
  mirror("leftShoulder", "rightShoulder", 1);
  mirror("select", "start", 1);
  // D-pad and face buttons sit on the same height, left and right of the touchpad.
  assert.ok(Math.abs(c("dpadLeft")[1]! - c("west")[1]!) < 2);
  assert.ok(c("north")[1]! < c("west")[1]! && c("south")[1]! > c("east")[1]!);
  assert.ok(c("dpadUp")[1]! < c("dpadLeft")[1]! && c("dpadDown")[1]! > c("dpadRight")[1]!);
  // Sticks below the touchpad, PS between them, mute below PS.
  const [, , , tpBottom] = bounds(HOTSPOTS.touchpad!);
  assert.ok(c("leftStick")[1]! > tpBottom && Math.abs(c("home")[1]! - c("leftStick")[1]!) < 2);
  assert.ok(c("mute")[1]! > c("home")[1]!);
  assert.ok(STICK_TRAVEL < (HOTSPOTS.leftStick as { r: number }).r);
  assert.ok(TOUCH_BOX.w > 0 && TOUCH_BOX.h > 0);
});

test("only the exact calibrated image is accepted", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await isCalibratedPhoto(new TextEncoder().encode("another picture").buffer as ArrayBuffer), false);
});
