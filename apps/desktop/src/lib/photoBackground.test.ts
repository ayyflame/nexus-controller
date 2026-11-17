import { test } from "node:test";
import assert from "node:assert/strict";
import { removeLightBackground } from "./photoBackground.ts";

/** w x h image from rows of grey levels. */
function image(rows: number[][]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length, w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.flat().forEach((v, p) => { data.set([v, v, v, 255], p * 4); });
  return { data, w, h };
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

test("the white surround becomes transparent; the dark object is untouched", () => {
  const { data, w, h } = image([
    [255, 255, 255, 255, 255],
    [255, 20, 20, 20, 255],
    [255, 20, 250, 20, 255], // enclosed reflection
    [255, 20, 20, 20, 255],
    [255, 255, 255, 255, 255],
  ]);
  const n = removeLightBackground(data, w, h);
  assert.equal(n, 16, "only the 16 border pixels");
  assert.deepEqual(px(data, w, 0, 0), [0, 0, 0, 0], "white -> fully transparent");
  assert.deepEqual(px(data, w, 1, 1), [20, 20, 20, 255], "object kept");
  assert.deepEqual(px(data, w, 2, 2), [250, 250, 250, 255], "enclosed light area kept");
});

test("soft edges and shadows keep their darkness as transparency", () => {
  const { data, w, h } = image([[255, 204, 153, 20]]);
  removeLightBackground(data, w, h);
  assert.deepEqual(px(data, w, 1, 0), [0, 0, 0, 51], "20 % dark -> 20 % black");
  assert.deepEqual(px(data, w, 2, 0), [0, 0, 0, 102], "40 % dark -> 40 % black");
  assert.deepEqual(px(data, w, 3, 0), [20, 20, 20, 255], "below the threshold: object");
});

test("light compression speckles on the outline are blended, the body is not", () => {
  // background | fringe 120 | fringe 90 | body 30 | body 30 | body 30
  const { data, w, h } = image([[255, 120, 90, 30, 30, 30]]);
  removeLightBackground(data, w, h);
  assert.deepEqual(px(data, w, 1, 0), [0, 0, 0, 135], "fringe pixel -> dark, partly transparent");
  assert.deepEqual(px(data, w, 2, 0), [0, 0, 0, 165], "second fringe pixel too");
  assert.deepEqual(px(data, w, 3, 0), [30, 30, 30, 255], "the dark body is untouched");
  // Fringe deeper than the edge pass is left as it is.
  const deep = image([[255, 120, 120, 120, 120, 30]]);
  removeLightBackground(deep.data, deep.w, deep.h);
  assert.deepEqual(px(deep.data, deep.w, 4, 0), [120, 120, 120, 255]);
});

test("an image with no light border is left alone", () => {
  const { data, w, h } = image([[10, 10], [10, 10]]);
  assert.equal(removeLightBackground(data, w, h), 0);
  assert.deepEqual(px(data, w, 0, 0), [10, 10, 10, 255]);
});
