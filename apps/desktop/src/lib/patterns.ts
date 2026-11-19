// Seamless greyscale tiles for Controller Studio's patterns and finish
// textures (carbon weave, rubber grain, brushed metal). Generated in code,
// no image files. Pure: returns pixel values 0–255 in a SIZE×SIZE array that
// tiles without seams in both directions.

import type { PatternId } from "./skin";

export const TILE = 256;

type Gen = (x: number, y: number) => number;

/** Seeded hash → 0…1. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise that wraps every `period` cells (so the tile is seamless). */
function noise(u: number, v: number, period: number, seed: number): number {
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const fx = u - x0, fy = v - y0;
  const w = (n: number) => ((n % period) + period) % period;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(w(x0), w(y0), seed), b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed), d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}

function fbm(x: number, y: number, base: number, octaves: number, seed: number): number {
  let v = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = base * 2 ** o;
    v += noise((x / TILE) * p, (y / TILE) * p, p, seed + o) * amp;
    total += amp;
    amp /= 2;
  }
  return v / total;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

const GENERATORS: Record<PatternId | "rubber" | "brushed", Gen> = {
  camo: (x, y) => {
    const n = fbm(x, y, 4, 3, 11);
    return n > 0.62 ? 1 : n > 0.5 ? 0.55 : n > 0.4 ? 0.25 : 0;
  },
  digital: (x, y) => {
    const c = 8; // square "pixels"
    const n = fbm(Math.floor(x / c) * c, Math.floor(y / c) * c, 4, 3, 23);
    return n > 0.6 ? 1 : n > 0.48 ? 0.5 : 0;
  },
  hex: (x, y) => {
    // A hex grid that repeats exactly over the tile: 4 columns × 4 rows of hexagons.
    const w = TILE / 4, h = TILE / 4;
    const cells: Array<[number, number]> = [];
    for (let i = -1; i <= 4; i++) for (let j = -1; j <= 4; j++) cells.push([i * w + (j % 2 ? w / 2 : 0), j * h]);
    let d1 = Infinity, d2 = Infinity;
    for (const [cx, cy] of cells) {
      const d = Math.hypot(x - cx, (y - cy) * 1.15);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return 1 - smooth(1.5, 4, d2 - d1); // lines where two cells meet
  },
  stripes: (x, y) => { const t = ((x + y) / TILE) * 8; return smooth(0.42, 0.5, Math.abs((t % 1) - 0.5) * 2) ; },
  dots: (x, y) => {
    const c = TILE / 8;
    const dx = (x % c) - c / 2, dy = (y % c) - c / 2;
    return 1 - smooth(c * 0.22, c * 0.26, Math.hypot(dx, dy));
  },
  waves: (x, y) => {
    const v = Math.sin(((y / TILE) * 6 + Math.sin((x / TILE) * TAU * 2) * 0.35) * TAU);
    return smooth(0.55, 0.75, v);
  },
  checker: (x, y) => ((Math.floor(x / (TILE / 8)) + Math.floor(y / (TILE / 8))) % 2 ? 1 : 0),
  carbon: (x, y) => {
    // 2×2 twill: tows alternate direction, each with a soft cylindrical shading.
    const c = TILE / 16;
    const i = Math.floor(x / c), j = Math.floor(y / c);
    const horizontal = (Math.floor((i + j) / 2) % 2) === 0;
    const t = horizontal ? (y % c) / c : (x % c) / c;
    const shade = Math.sin(t * Math.PI);
    const grain = noise((x / TILE) * 64, (y / TILE) * 64, 64, 5) * 0.15;
    return Math.min(1, (horizontal ? 0.35 : 0.6) * shade + 0.15 + grain);
  },
  rubber: (x, y) => fbm(x, y, 32, 2, 41) * 0.8 + hash(x, y, 7) * 0.2,
  brushed: (x, y) => {
    // Long streaks along x: noise stretched 1:32.
    const n = noise((x / TILE) * 2, (y / TILE) * 128, 2, 13) * 0.7 + noise((x / TILE) * 4, (y / TILE) * 256, 4, 17) * 0.3;
    return 0.35 + n * 0.65;
  },
};

export type TileId = keyof typeof GENERATORS;
export const TILE_IDS = Object.keys(GENERATORS) as TileId[];

const cache = new Map<TileId, Uint8Array>();

/** The tile's pixels (0–255), generated once. */
export function tilePixels(id: TileId): Uint8Array {
  const hit = cache.get(id);
  if (hit) return hit;
  const g = GENERATORS[id];
  const px = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px[y * TILE + x] = Math.round(Math.min(1, Math.max(0, g(x, y))) * 255);
  cache.set(id, px);
  return px;
}
