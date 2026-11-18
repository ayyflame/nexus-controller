// Builds the DualSense-style model from geometry (no downloaded model, no
// textures, no logos). Outlines come from the same front-view measurements as
// the 2D drawing (lib/controller3d.ts); depth, bevels and the grips' sweep
// are modelled here. Everything returned must be disposed by the caller.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BODY, BUMPER_PATHS, DPAD_ARM_PATH, MUTE, SHELL_PATH, SPEAKER_DOTS, TOUCHPAD_PATH, UNIT, parsePath, toWorld,
} from "../../lib/controller3d";

type Map2 = (x: number, y: number) => [number, number];

/** A three.js Shape from an SVG-style path, through a coordinate mapping. */
export function shapeFromPath(d: string, map: Map2): THREE.Shape {
  const shape = new THREE.Shape();
  for (const s of parsePath(d)) {
    if (s.op === "M") shape.moveTo(...map(s.x, s.y));
    else if (s.op === "L") shape.lineTo(...map(s.x, s.y));
    else if (s.op === "Q") shape.quadraticCurveTo(...map(s.x1, s.y1), ...map(s.x, s.y));
    else if (s.op === "C") shape.bezierCurveTo(...map(s.x1, s.y1), ...map(s.x2, s.y2), ...map(s.x, s.y));
    else shape.closePath();
  }
  return shape;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Smooth shading across the bevels: merge the extrusion's split vertices first. */
function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const merged = mergeVertices(g, 1e-4);
  g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Rounded slab from an outline: sides follow the outline, the faces are inset by the bevel. */
function slab(shape: THREE.Shape, depth: number, bevel: number, segments = 4, curveSegments = 24): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel,
    bevelSegments: segments, curveSegments, steps: 1,
  });
}

/**
 * The body: the measured outline extruded to the controller's thickness with
 * deep rounded edges, then sculpted so the grips sweep back and thicken like
 * the real handles. The face is at z = 0.
 */
export function bodyGeometry(): THREE.BufferGeometry {
  const shape = shapeFromPath(SHELL_PATH, toWorld);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: BODY.depth, bevelEnabled: true, bevelThickness: BODY.bevel, bevelSize: BODY.bevelSize,
    bevelOffset: -BODY.bevelSize, bevelSegments: 10, curveSegments: 36, steps: 3,
  });
  const total = BODY.depth + 2 * BODY.bevel;
  g.translate(0, 0, -(BODY.depth + BODY.bevel));
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    let z = p.getZ(i);
    const back = Math.min(1, Math.max(0, -z / total)); // 0 at the face, 1 at the back
    const grip = smooth(-0.5, -2.45, y); // 0 above the grips, 1 at their ends
    // Grips sweep away from the face and swell towards the back (the handles).
    z -= grip * grip * 0.5 + grip * back * 0.62;
    // The top edge is thinner than the middle, as on the real controller.
    const top = smooth(1.2, 2.4, y);
    z += top * back * 0.22;
    // A gentle crown across the face.
    z += (1 - back) * 0.05 * (1 - Math.min(1, (x / 3.4) ** 2)) * (1 - grip);
    p.setZ(i, z);
  }
  return smoothNormals(g);
}

export function touchpadGeometry(): THREE.BufferGeometry {
  const g = slab(shapeFromPath(TOUCHPAD_PATH, toWorld), 0.02, 0.025, 4, 16);
  g.translate(0, 0, 0.0);
  return g;
}

/** A shallow recess ring the touchpad sits in. */
export function touchpadFrameGeometry(): THREE.BufferGeometry {
  const outer = shapeFromPath(TOUCHPAD_PATH, (x, y) => {
    const [wx, wy] = toWorld(x, y);
    return [wx * 1.035, wy + (wy > 0 ? 0.04 : -0.02)];
  });
  const g = slab(outer, 0.006, 0.012, 2, 16);
  g.translate(0, 0, 0.0);
  return g;
}

/** L1/R1: the measured bumper outline, deep enough to sit across the top edge. */
export function bumperGeometry(side: keyof typeof BUMPER_PATHS): THREE.BufferGeometry {
  const g = slab(shapeFromPath(BUMPER_PATHS[side], toWorld), 0.34, 0.06, 4, 16);
  g.translate(0, 0, -0.56);
  return g;
}

/**
 * L2/R2 seen from the side: a curved paddle hinged under the bumper that
 * hooks down behind the body. Built around its hinge (origin), extruded
 * across its width (x), so pressing is a rotation about x.
 */
export function triggerGeometry(width: number): THREE.BufferGeometry {
  // (a, b): a = distance behind the hinge, b = height above it.
  const s = new THREE.Shape();
  s.moveTo(-0.02, 0.06);
  s.quadraticCurveTo(0.35, 0.2, 0.68, 0.06);
  s.quadraticCurveTo(0.92, -0.08, 0.9, -0.42);
  s.quadraticCurveTo(0.88, -0.66, 0.74, -0.7);
  s.quadraticCurveTo(0.64, -0.68, 0.66, -0.5);
  s.quadraticCurveTo(0.66, -0.2, 0.45, -0.08);
  s.quadraticCurveTo(0.2, 0.0, -0.02, -0.06);
  s.closePath();
  const bevel = 0.05;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel * 0.4,
    bevelSegments: 4, curveSegments: 20, steps: 1,
  });
  // Shape x (a) → world −z (behind), shape y → world y, extrusion → world x.
  g.rotateY(Math.PI / 2);
  g.translate(-(width / 2 - bevel), 0, 0);
  return smoothNormals(g);
}

/** One D-pad arm (pointing up from the centre). */
export function dpadArmGeometry(): THREE.BufferGeometry {
  const g = slab(shapeFromPath(DPAD_ARM_PATH, (x, y) => [x * UNIT, -y * UNIT]), 0.04, 0.03, 4, 12);
  return g;
}

/** The little arrow printed on a D-pad arm. */
export function dpadArrowGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.535);
  s.lineTo(0.045, 0.475);
  s.lineTo(-0.045, 0.475);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Round button turned on a lathe: straight sides, softly domed top. Axis along z. */
function lathe(points: Array<[number, number]>, segments = 48): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

export function faceButtonGeometry(r: number): THREE.BufferGeometry {
  return lathe([[0.001, 0.125], [r * 0.6, 0.123], [r * 0.85, 0.115], [r * 0.97, 0.095], [r, 0.07], [r, -0.02]]);
}

/** The ring around a face button (its hole in the shell). */
export function wellGeometry(inner: number, outer: number): THREE.BufferGeometry {
  return new THREE.RingGeometry(inner, outer, 48);
}

/** Symbols on the face buttons (flat, printed). */
export function symbolGeometry(kind: "triangle" | "circle" | "cross" | "square"): THREE.BufferGeometry {
  if (kind === "circle") return new THREE.RingGeometry(0.074, 0.098, 48);
  if (kind === "square") {
    const o = 0.082, i = 0.058;
    const s = new THREE.Shape([new THREE.Vector2(-o, -o), new THREE.Vector2(o, -o), new THREE.Vector2(o, o), new THREE.Vector2(-o, o)]);
    s.holes.push(new THREE.Path([new THREE.Vector2(-i, -i), new THREE.Vector2(-i, i), new THREE.Vector2(i, i), new THREE.Vector2(i, -i)]));
    return new THREE.ShapeGeometry(s);
  }
  if (kind === "triangle") {
    const tri = (r: number) => [90, 210, 330].map((a) => new THREE.Vector2(r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180) - 0.012));
    const s = new THREE.Shape(tri(0.118));
    s.holes.push(new THREE.Path(tri(0.074).reverse()));
    return new THREE.ShapeGeometry(s);
  }
  // cross: a plus, turned 45°
  const a = 0.108, w = 0.0125;
  const pts: Array<[number, number]> = [[-w, a], [w, a], [w, w], [a, w], [a, -w], [w, -w], [w, -a], [-w, -a], [-w, -w], [-a, -w], [-a, w], [-w, w]];
  const c = Math.SQRT1_2;
  return new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * c - y * c, x * c + y * c))));
}

/** Stick parts, built around the stick's pivot (inside the body). */
export const STICK_PIVOT_Z = -0.32;
export function stickStemGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.12, 0.14, 0.62, 32);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.31);
  return g;
}
export function stickCapGeometry(): THREE.BufferGeometry {
  // Skirt, rounded rim, concave dish: the DualSense cap profile.
  return lathe([
    [0.001, 0.775], [0.12, 0.78], [0.24, 0.795], [0.31, 0.815], [0.355, 0.83], [0.385, 0.828], [0.405, 0.815],
    [0.415, 0.79], [0.418, 0.72], [0.41, 0.66], [0.39, 0.62], [0.28, 0.6], [0.15, 0.6],
  ], 56);
}
/** The textured grip ring on top of the cap. */
export function stickRimGeometry(): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(0.37, 0.034, 12, 56);
  g.translate(0, 0, 0.8);
  return g;
}
/** The dark collar the stick sits in. */
export function stickWellGeometry(): THREE.BufferGeometry {
  return lathe([[0.2, 0.03], [0.4, 0.035], [0.47, 0.03], [0.5, 0.012], [0.52, -0.01]]);
}

export function homeGeometry(r: number): THREE.BufferGeometry {
  return lathe([[0.001, 0.09], [r * 0.6, 0.088], [r * 0.9, 0.075], [r, 0.05], [r, -0.01]], 40);
}

/** A rounded rectangle lying on the face, e.g. Create, Options and Mute. */
export function pillGeometry(w: number, h: number, depth: number): THREE.BufferGeometry {
  const r = Math.min(w, h) / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, h / 2 - r);
  s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, h / 2);
  s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -h / 2 + r);
  s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  return slab(s, depth, Math.min(0.018, r * 0.6), 3, 12);
}

export function muteGeometry(): THREE.BufferGeometry {
  return pillGeometry(MUTE.w * UNIT, MUTE.h * UNIT, 0.02);
}

/** The light strips beside the touchpad, as thin rounded bars between two points. */
export function lightBarGeometry([x1, y1, x2, y2]: [number, number, number, number]): THREE.BufferGeometry {
  const a = new THREE.Vector3(...toWorld(x1, y1), 0.012);
  const b = new THREE.Vector3(...toWorld(x2, y2), 0.012);
  const g = new THREE.CapsuleGeometry(0.022, a.distanceTo(b), 4, 12);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Speaker holes below the touchpad, one merged geometry. */
export function speakerGeometry(): THREE.BufferGeometry {
  const dots = SPEAKER_DOTS.map(([x, y]) => {
    const g = new THREE.CircleGeometry(0.019, 12);
    g.translate(...toWorld(x, y), 0.003);
    return g;
  });
  const merged = mergeGeometries(dots)!;
  for (const d of dots) d.dispose();
  return merged;
}

/** USB-C port on the top edge (seen from the top or rear). */
export function usbPortGeometry(): THREE.BufferGeometry {
  const g = pillGeometry(0.36, 0.11, 0.06);
  g.rotateX(-Math.PI / 2);
  return g;
}
