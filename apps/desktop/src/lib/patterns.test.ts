import { test } from "node:test";
import assert from "node:assert/strict";
import { TILE, TILE_IDS, tilePixels } from "./patterns.ts";
import { PATTERN_IDS } from "./skin.ts";

test("every pattern and finish texture has a tile", () => {
  for (const p of PATTERN_IDS) assert.ok(TILE_IDS.includes(p), p);
  for (const f of ["carbon", "rubber", "brushed"]) assert.ok(TILE_IDS.includes(f as never), f);
});

test("tiles are seamless, non-empty and not flat", () => {
  for (const id of TILE_IDS) {
    const px = tilePixels(id);
    assert.equal(px.length, TILE * TILE);
    let min = 255, max = 0, edge = 0;
    for (const v of px) { min = Math.min(min, v); max = Math.max(max, v); }
    assert.ok(max - min > 60, `${id} has contrast (${min}–${max})`);
    // Wrapping: the last column continues into the first, the last row into the first,
    // about as smoothly as neighbouring columns inside the tile do.
    let inner = 0;
    for (let y = 0; y < TILE; y++) {
      edge += Math.abs(px[y * TILE + TILE - 1]! - px[y * TILE]!);
      inner += Math.abs(px[y * TILE + TILE / 2]! - px[y * TILE + TILE / 2 - 1]!);
    }
    for (let x = 0; x < TILE; x++) {
      edge += Math.abs(px[(TILE - 1) * TILE + x]! - px[x]!);
      inner += Math.abs(px[(TILE / 2) * TILE + x]! - px[(TILE / 2 - 1) * TILE + x]!);
    }
    assert.ok(edge <= inner * 2.5 + TILE * 2 * 8, `${id} tiles without a seam (edge ${edge} vs inside ${inner})`);
  }
});

test("tiles are generated once and reused", () => {
  assert.equal(tilePixels("hex"), tilePixels("hex"));
});
