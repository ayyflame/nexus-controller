// Finds the individual controls inside the DualSense model
// (src/assets/models/dualsense.glb, "Playstation 5 Dualsense" by
// AHarmlessPotato, CC BY 4.0). The model stores all buttons in one mesh per
// material, but each control is its own piece of geometry (an "island" of
// connected triangles). This module finds those islands and names them by
// where they are, so each control can light up and move on its own.
// Pure (no three.js): unit-tested against the real model file.

import type { MacroButton } from "../types/engine";

export type V3 = [number, number, number];

export interface Island {
  /** Triangle numbers (index into the primitive's triangles). */
  triangles: number[];
  min: V3;
  max: V3;
}

export const centreOf = (i: { min: V3; max: V3 }): V3 =>
  [(i.min[0] + i.max[0]) / 2, (i.min[1] + i.max[1]) / 2, (i.min[2] + i.max[2]) / 2];

/**
 * Groups triangles into connected islands. Vertices at the same position are
 * treated as one (the model splits vertices along UV seams).
 */
export function findIslands(pos: ArrayLike<number>, index: ArrayLike<number> | null): Island[] {
  const vertexCount = pos.length / 3;
  const triCount = index ? index.length / 3 : vertexCount / 3;
  const at = (k: number) => (index ? index[k]! : k);
  const weld = new Map<string, number>();
  const rep = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(pos[3 * v]! * 1e5)},${Math.round(pos[3 * v + 1]! * 1e5)},${Math.round(pos[3 * v + 2]! * 1e5)}`;
    const seen = weld.get(key);
    if (seen === undefined) { weld.set(key, v); rep[v] = v; } else rep[v] = seen;
  }
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  for (let t = 0; t < triCount; t++) {
    const a = find(rep[at(3 * t)]!), b = find(rep[at(3 * t + 1)]!), c = find(rep[at(3 * t + 2)]!);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) parent[find(c)] = b2;
  }
  const byRoot = new Map<number, Island>();
  for (let t = 0; t < triCount; t++) {
    const root = find(rep[at(3 * t)]!);
    let isl = byRoot.get(root);
    if (!isl) { isl = { triangles: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; byRoot.set(root, isl); }
    isl.triangles.push(t);
    for (let k = 0; k < 3; k++) {
      const v = at(3 * t + k);
      for (let d = 0; d < 3; d++) {
        const p = pos[3 * v + d]!;
        if (p < isl.min[d]!) isl.min[d] = p;
        if (p > isl.max[d]!) isl.max[d] = p;
      }
    }
  }
  return [...byRoot.values()];
}

/** How a control moves when used. */
export type Motion = "press" | "bumper" | "stick" | "trigger";

interface PartSpec {
  material: string; centre: V3; tolerance: number; motion: Motion;
  /** Made of a clear cap (the outermost piece, 20 % opaque in the file) over a solid inner piece with the symbol. */
  clearCap?: boolean;
}

/**
 * Where each control is in the model (model units: x right, y up, z out of
 * the face; the controller is 2 units wide). Measured from the file.
 * `material` is the glTF material name the control's geometry uses.
 */
export const PARTS: Record<MacroButton, PartSpec> = {
  dpadUp: { material: "1001", centre: [-0.62, 0.376, 0.285], tolerance: 0.05, motion: "press", clearCap: true },
  dpadRight: { material: "1001", centre: [-0.524, 0.274, 0.285], tolerance: 0.05, motion: "press", clearCap: true },
  dpadDown: { material: "1001", centre: [-0.626, 0.177, 0.285], tolerance: 0.05, motion: "press", clearCap: true },
  dpadLeft: { material: "1001", centre: [-0.723, 0.28, 0.285], tolerance: 0.05, motion: "press", clearCap: true },
  north: { material: "1001", centre: [0.623, 0.423, 0.3], tolerance: 0.05, motion: "press", clearCap: true },
  west: { material: "1001", centre: [0.476, 0.276, 0.307], tolerance: 0.05, motion: "press", clearCap: true },
  south: { material: "1001", centre: [0.623, 0.129, 0.289], tolerance: 0.05, motion: "press", clearCap: true },
  east: { material: "1001", centre: [0.77, 0.276, 0.286], tolerance: 0.05, motion: "press", clearCap: true },
  leftStick: { material: "1001", centre: [-0.318, 0, 0.33], tolerance: 0.07, motion: "stick" },
  rightStick: { material: "1001", centre: [0.318, 0, 0.33], tolerance: 0.07, motion: "stick" },
  home: { material: "1001", centre: [0, 0.005, 0.254], tolerance: 0.07, motion: "press" },
  // Tight: a wider trim piece (the microphone grille) sits 0.013 away.
  mute: { material: "1001", centre: [0, -0.102, 0.216], tolerance: 0.006, motion: "press" },
  select: { material: "1001", centre: [-0.467, 0.494, 0.294], tolerance: 0.04, motion: "press" },
  start: { material: "1001", centre: [0.467, 0.494, 0.294], tolerance: 0.04, motion: "press" },
  leftShoulder: { material: "1001", centre: [-0.619, 0.577, 0.122], tolerance: 0.05, motion: "bumper" },
  rightShoulder: { material: "1001", centre: [0.619, 0.577, 0.122], tolerance: 0.05, motion: "bumper" },
  leftTrigger: { material: "1001", centre: [-0.614, 0.528, -0.118], tolerance: 0.05, motion: "trigger" },
  rightTrigger: { material: "1001", centre: [0.614, 0.528, -0.118], tolerance: 0.05, motion: "trigger" },
  touchpad: { material: "1011", centre: [0, 0.424, 0.25], tolerance: 0.012, motion: "press" },
};

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The control an island belongs to (closest within tolerance), or null for the shell and other fixed parts. */
export function classify(material: string, island: { min: V3; max: V3 }): MacroButton | null {
  const c = centreOf(island);
  let best: MacroButton | null = null;
  let bestD = Infinity;
  for (const [b, spec] of Object.entries(PARTS) as Array<[MacroButton, PartSpec]>) {
    if (spec.material !== material) continue;
    const d = dist(c, spec.centre);
    if (d <= spec.tolerance && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

export interface PartFrame {
  /** Point the control moves around (sticks tilt, triggers swing about it). */
  pivot: V3;
  /** Its top, where a leader line points. */
  anchor: V3;
  /** Which way its visible surface faces. */
  normal: V3;
}

/** Pivot, anchor and facing of a control from its bounding box. */
export function frameOf(b: MacroButton, min: V3, max: V3): PartFrame {
  const c = centreOf({ min, max });
  switch (PARTS[b].motion) {
    case "stick": return { pivot: [c[0], c[1], 0.12], anchor: [c[0], c[1], max[2]], normal: [0, 0, 1] };
    // Hinged at its top front edge, under the bumper.
    case "trigger": return { pivot: [c[0], max[1] - 0.02, max[2] - 0.02], anchor: [c[0], max[1], c[2]], normal: [0, 1, 0] };
    case "bumper": return { pivot: c, anchor: [c[0], max[1], c[2]], normal: [0, 0.8, 0.6] };
    default: return { pivot: c, anchor: [c[0], c[1], max[2]], normal: [0, 0, 1] };
  }
}

/** Model units → scene units (the scene is built for a controller 7.2 units wide). */
export const MODEL_SCALE = 3.6;
/** How far a pressed button sinks, in model units. */
export const PRESS_DEPTH = 0.012;

// ---- Midnight Black finish ----------------------------------------------
// The model's colour textures are painted for a white DualSense: white
// plastic, a dark grey core, and grey printing (button symbols, lettering).
// The black finish repaints each texture colour as it is drawn: white
// plastic → near-black, grey printing → light grey (as on a Midnight Black
// controller), dark parts stay dark. The rule runs in the graphics shader
// (BLACK_FINISH_GLSL); blackFinishPixel is the same rule in TypeScript, so
// it can be tested.

/** Near-black plastic with a slightly cool tint (sRGB 0–255). */
export const BLACK_PLATE: V3 = [27, 28, 33];
/** Light grey printing on black plastic (sRGB 0–255). */
export const BLACK_PRINT: V3 = [176, 178, 184];
/** Lightness bands (sRGB luminance 0–1): above WHITE is white plastic, between PRINT and WHITE is printing. */
export const FINISH_BANDS = { white: [0.6, 0.72], print: [0.34, 0.44], keep: 0.85 } as const;

const step = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One texture colour (0–255 sRGB) repainted for the Midnight Black finish. Blends smoothly at edges. */
export function blackFinishPixel(r: number, g: number, b: number): V3 {
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const white = step(FINISH_BANDS.white[0], FINISH_BANDS.white[1], l);
  const print = step(FINISH_BANDS.print[0], FINISH_BANDS.print[1], l) * (1 - white);
  const keep = 1 - white - print;
  const mix = (i: 0 | 1 | 2, orig: number) =>
    Math.round(white * BLACK_PLATE[i] + print * BLACK_PRINT[i] + keep * orig * FINISH_BANDS.keep);
  return [mix(0, r), mix(1, g), mix(2, b)];
}

const f = (n: number) => n.toFixed(4);
const vec = (c: V3) => `vec3(${c.map((v) => f(v / 255)).join(", ")})`;

/**
 * The same rule as GLSL, for three.js's standard material. Textures are
 * sampled as linear colour, so it converts to sRGB, applies the rule, and
 * converts back. GLSL's smoothstep is the same curve as `step` above.
 */
export const BLACK_FINISH_GLSL = `
uniform float nexusBlack;
vec3 nexusBlackFinish( vec3 linear ) {
  vec3 s = pow( clamp( linear, 0.0, 1.0 ), vec3( 1.0 / 2.2 ) );
  float l = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
  float white = smoothstep( ${f(FINISH_BANDS.white[0])}, ${f(FINISH_BANDS.white[1])}, l );
  float print = smoothstep( ${f(FINISH_BANDS.print[0])}, ${f(FINISH_BANDS.print[1])}, l ) * ( 1.0 - white );
  float keep = 1.0 - white - print;
  vec3 outS = white * ${vec(BLACK_PLATE)} + print * ${vec(BLACK_PRINT)} + keep * s * ${f(FINISH_BANDS.keep)};
  return pow( outS, vec3( 2.2 ) );
}
`;
