// Layout and input mapping for the 3D controller (components/controller3d).
// Pure (no three.js), so the rules are unit-tested. Every visual value comes
// from the ControllerState NEXUS already publishes; nothing is simulated.
//
// The model is built in "drawing units": the same front-view measurements as
// the 2D drawing (components/ControllerVisual.tsx, viewBox 800 wide, measured
// from a DualSense front view). toWorld() turns them into 3D units:
// 1 unit = 100 drawing units, x to the right, y up, z out of the face.

import { dpadLit } from "./controllerView";
import type { ControllerState, MacroButton } from "../types/engine";

export const UNIT = 0.01;
export const ORIGIN = { x: 400, y: 270 } as const;

export function toWorld(x: number, y: number): [number, number] {
  return [(x - ORIGIN.x) * UNIT, -(y - ORIGIN.y) * UNIT];
}

/** Outline of the body seen from the front (same as the 2D drawing). */
export const SHELL_PATH = "M400 36L548 36C590 34 640 32 664 42C684 54 698 84 704 107C716 150 730 182 739 214C748 248 756 290 758 330C760 370 758 410 752 440C746 468 734 486 718 496C704 504 688 508 672 507C660 506 652 500 648 488C642 470 638 460 634 450C624 426 614 402 606 388C598 372 592 354 582 344C574 338 566 336 556 336L400 338L244 336C234 336 226 338 218 344C208 354 202 372 194 388C186 402 176 426 166 450C162 460 158 470 152 488C148 500 140 506 128 507C112 508 96 504 82 496C66 486 54 468 48 440C42 410 40 370 42 330C44 290 52 248 61 214C70 182 84 150 96 107C102 84 116 54 136 42C160 32 210 34 252 36L400 36Z";

export const TOUCHPAD = { x: 262, y: 40, w: 276, h: 135 } as const;
export const TOUCHPAD_PATH =
  `M${TOUCHPAD.x} ${TOUCHPAD.y}H${TOUCHPAD.x + TOUCHPAD.w}L${TOUCHPAD.x + TOUCHPAD.w - 13} ${TOUCHPAD.y + TOUCHPAD.h - 16}` +
  `Q${TOUCHPAD.x + TOUCHPAD.w - 16} ${TOUCHPAD.y + TOUCHPAD.h} ${TOUCHPAD.x + TOUCHPAD.w - 32} ${TOUCHPAD.y + TOUCHPAD.h}H${TOUCHPAD.x + 32}` +
  `Q${TOUCHPAD.x + 16} ${TOUCHPAD.y + TOUCHPAD.h} ${TOUCHPAD.x + 13} ${TOUCHPAD.y + TOUCHPAD.h - 16}Z`;

export const BUMPER_PATHS = {
  leftShoulder: "M134 46Q140 22 170 20H202Q222 21 228 38L230 46Z",
  rightShoulder: "M666 46Q660 22 630 20H598Q578 21 572 38L570 46Z",
} as const;

/** One D-pad arm pointing up, relative to the D-pad centre (rotated for the others). */
export const DPAD_ARM_PATH = "M-18 -55Q-18 -62 -11 -62H11Q18 -62 18 -55V-29L0 -12L-18 -29Z";

export const DPAD = { x: 176, y: 150 } as const;
export const FACE = { x: 621, y: 157, gap: 47, r: 24 } as const;
export const STICKS = { leftStick: { x: 286, y: 255 }, rightStick: { x: 514, y: 255 } } as const;
export const HOME = { x: 400, y: 255, r: 13 } as const;
export const MUTE = { x: 400, y: 296.5, w: 32, h: 9 } as const;
export const SMALL_BUTTONS = {
  select: { x: 238.5, y: 80, angle: -15 },
  start: { x: 561.5, y: 80, angle: 15 },
} as const;
export const LIGHT_BARS: Array<[number, number, number, number]> = [[253, 50, 271, 166], [547, 50, 529, 166]];
export const SPEAKER_DOTS: Array<[number, number]> =
  [-3, -2, -1, 0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => [400 + c * 7, 198 + r * 7] as [number, number]));

/** Body thickness and where things sit in depth (z = 0 is the face). */
export const BODY = { depth: 0.92, bevel: 0.22, bevelSize: 0.16 } as const;
export const TRIGGER_X = { leftTrigger: [138, 226], rightTrigger: [574, 662] } as const;

/** Largest stick tilt (radians), about the DualSense's real ~22°. */
export const MAX_TILT = 0.38;
/** How far a fully pressed L2/R2 swings in (radians). */
export const TRIGGER_SWING = 0.3;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

export interface StickPose { rotX: number; rotY: number; pressed: boolean }

/**
 * Tilt of a stick for engine values x, y (−1…1, up positive). The stick
 * leans towards where it is pushed: right turns about +Y, up about −X.
 * Values beyond the circle (square-ish corners) are limited to it.
 */
export function stickPose(x: number, y: number, pressed: boolean): StickPose {
  let cx = clamp(x, -1, 1);
  let cy = clamp(y, -1, 1);
  const m = Math.hypot(cx, cy);
  if (m > 1) { cx /= m; cy /= m; }
  return { rotX: -cy * MAX_TILT, rotY: cx * MAX_TILT, pressed };
}

export type Lit = Record<MacroButton, boolean>;

export interface Visual3D {
  /** False: no controller (or not live): everything at rest, nothing lit. */
  connected: boolean;
  lit: Lit;
  leftStick: StickPose;
  rightStick: StickPose;
  /** Analog trigger travel, 0…1. */
  l2: number;
  r2: number;
  /** Active touches, 0…1 across and down the touchpad. */
  touches: Array<{ id: number; u: number; v: number }>;
}

const NONE: Lit = {
  south: false, east: false, west: false, north: false, leftShoulder: false, rightShoulder: false,
  leftTrigger: false, rightTrigger: false, leftStick: false, rightStick: false, start: false, select: false,
  home: false, touchpad: false, mute: false, dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false,
};

export const AT_REST: Visual3D = {
  connected: false, lit: NONE, leftStick: stickPose(0, 0, false), rightStick: stickPose(0, 0, false), l2: 0, r2: 0, touches: [],
};

/** What the 3D model shows for one controller state. */
export function visualFrom(s: ControllerState | null, live: boolean): Visual3D {
  if (!s || !live) return AT_REST;
  const b = s.buttons;
  const d = dpadLit(s.dpad);
  const l2 = clamp(s.leftTrigger.value, 0, 1);
  const r2 = clamp(s.rightTrigger.value, 0, 1);
  const tp = s.touchpad;
  return {
    connected: true,
    lit: {
      south: b.south, east: b.east, west: b.west, north: b.north,
      leftShoulder: b.leftShoulder, rightShoulder: b.rightShoulder,
      leftTrigger: l2 > 0.004 || s.leftTrigger.digital, rightTrigger: r2 > 0.004 || s.rightTrigger.digital,
      leftStick: b.leftStick, rightStick: b.rightStick, start: b.start, select: b.select, home: b.home,
      touchpad: b.touchpad, mute: b.mute, dpadUp: d.up, dpadDown: d.down, dpadLeft: d.left, dpadRight: d.right,
    },
    leftStick: stickPose(s.leftStick.x, s.leftStick.y, b.leftStick),
    rightStick: stickPose(s.rightStick.x, s.rightStick.y, b.rightStick),
    l2,
    r2,
    touches: tp
      ? tp.points.filter((p) => p.active).map((p) => ({
        id: p.id, u: clamp(p.x / Math.max(1, tp.width), 0, 1), v: clamp(p.y / Math.max(1, tp.height), 0, 1),
      }))
      : [],
  };
}

/**
 * Compact signature of what is visible. The 3D view redraws only when this
 * changes (rounded to what can be seen), not on every status update.
 */
export function visualKey(v: Visual3D): string {
  const r = (n: number) => Math.round(n * 200);
  const lit = (Object.keys(v.lit) as MacroButton[]).map((k) => (v.lit[k] ? 1 : 0)).join("");
  const st = (p: StickPose) => `${r(p.rotX)},${r(p.rotY)},${p.pressed ? 1 : 0}`;
  const t = v.touches.map((p) => `${p.id}:${r(p.u)},${r(p.v)}`).join(";");
  return `${v.connected ? 1 : 0}|${lit}|${st(v.leftStick)}|${st(v.rightStick)}|${r(v.l2)},${r(v.r2)}|${t}`;
}

/** Touch position on the touchpad surface, in drawing units. */
export function touchPoint(u: number, v: number): [number, number] {
  const inset = 10;
  const top = TOUCHPAD.y + inset;
  const h = TOUCHPAD.h - 2 * inset;
  const y = top + clamp(v, 0, 1) * h;
  // The pad narrows towards the bottom: follow its edges.
  const shrink = 13 * ((y - TOUCHPAD.y) / (TOUCHPAD.h - 16));
  const left = TOUCHPAD.x + inset + shrink;
  const right = TOUCHPAD.x + TOUCHPAD.w - inset - shrink;
  return [left + clamp(u, 0, 1) * (right - left), y];
}

export type Vec3 = [number, number, number];

/**
 * Where each control is in 3D (its top), and which way its surface faces.
 * Used for leader lines on the Mapping screen and for selection marks.
 */
export function anchorOf(b: MacroButton): { pos: Vec3; normal: Vec3 } {
  const up: Vec3 = [0, 0, 1];
  const at = (x: number, y: number, z: number, normal: Vec3 = up) => {
    const [wx, wy] = toWorld(x, y);
    return { pos: [wx, wy, z] as Vec3, normal };
  };
  const g = FACE.gap;
  switch (b) {
    case "north": return at(FACE.x, FACE.y - g, 0.13);
    case "east": return at(FACE.x + g, FACE.y, 0.13);
    case "south": return at(FACE.x, FACE.y + g, 0.13);
    case "west": return at(FACE.x - g, FACE.y, 0.13);
    case "dpadUp": return at(DPAD.x, DPAD.y - 40, 0.1);
    case "dpadDown": return at(DPAD.x, DPAD.y + 40, 0.1);
    case "dpadLeft": return at(DPAD.x - 40, DPAD.y, 0.1);
    case "dpadRight": return at(DPAD.x + 40, DPAD.y, 0.1);
    case "leftStick": return at(STICKS.leftStick.x, STICKS.leftStick.y, 0.62);
    case "rightStick": return at(STICKS.rightStick.x, STICKS.rightStick.y, 0.62);
    case "touchpad": return at(TOUCHPAD.x + TOUCHPAD.w / 2, TOUCHPAD.y + TOUCHPAD.h / 2, 0.06);
    case "home": return at(HOME.x, HOME.y, 0.09);
    case "mute": return at(MUTE.x, MUTE.y, 0.05);
    case "select": return at(SMALL_BUTTONS.select.x, SMALL_BUTTONS.select.y, 0.07);
    case "start": return at(SMALL_BUTTONS.start.x, SMALL_BUTTONS.start.y, 0.07);
    case "leftShoulder": return at(182, 22, -0.22, [0, 0.8, 0.6]);
    case "rightShoulder": return at(618, 22, -0.22, [0, 0.8, 0.6]);
    case "leftTrigger": return at(182, 4, -0.8, [0, 0.85, -0.5]);
    case "rightTrigger": return at(618, 4, -0.8, [0, 0.85, -0.5]);
  }
}

/** Is a surface facing the camera (so its leader line should show)? */
export function facesCamera(anchor: { pos: Vec3; normal: Vec3 }, camera: Vec3): boolean {
  const d: Vec3 = [camera[0] - anchor.pos[0], camera[1] - anchor.pos[1], camera[2] - anchor.pos[2]];
  return d[0] * anchor.normal[0] + d[1] * anchor.normal[1] + d[2] * anchor.normal[2] > 0;
}

// ---- Camera ------------------------------------------------------------

/** Camera position around the target, as radius, polar angle from +Y (phi) and azimuth around Y (theta, 0 = front). */
export interface Orbit { radius: number; phi: number; theta: number }

export const CAMERA_TARGET: Vec3 = [0, -0.15, -0.45];
export const ZOOM = { min: 5, max: 17 } as const;

export const VIEWS = {
  /** A slight tilt, the way you look at a controller in your hands. */
  default: { radius: 10.2, phi: 1.12, theta: 0 },
  front: { radius: 10.2, phi: Math.PI / 2, theta: 0 },
  rear: { radius: 10.2, phi: Math.PI / 2, theta: Math.PI },
  /** From above the top edge: bumpers and triggers. */
  top: { radius: 9.6, phi: 0.42, theta: 0 },
} satisfies Record<string, Orbit>;

export type ViewName = keyof typeof VIEWS;

/** Camera offset from the target for an orbit (three.js Spherical convention). */
export function orbitToOffset(o: Orbit): Vec3 {
  const s = Math.sin(o.phi);
  return [o.radius * s * Math.sin(o.theta), o.radius * Math.cos(o.phi), o.radius * s * Math.cos(o.theta)];
}

/** Smooth step between two orbits, turning the short way round (t: 0…1). */
export function orbitBetween(a: Orbit, b: Orbit, t: number): Orbit {
  const k = clamp(t, 0, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // ease in-out
  let dt = (b.theta - a.theta) % (2 * Math.PI);
  if (dt > Math.PI) dt -= 2 * Math.PI;
  if (dt < -Math.PI) dt += 2 * Math.PI;
  return { radius: a.radius + (b.radius - a.radius) * e, phi: a.phi + (b.phi - a.phi) * e, theta: a.theta + dt * e };
}

/** Narrow views move the camera back so the whole controller still fits. */
export function fitRadius(radius: number, aspect: number): number {
  const wanted = 1.5;
  return aspect > 0 && aspect < wanted ? Math.min(ZOOM.max, radius * (wanted / aspect)) : radius;
}

// ---- SVG path → segments (for the model's outlines) ------------------------

export type Segment =
  | { op: "M" | "L"; x: number; y: number }
  | { op: "Q"; x1: number; y1: number; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

/** Parses the small SVG path subset used above (M L H V Q C Z, absolute or relative) into absolute segments. */
export function parsePath(d: string): Segment[] {
  const tokens = d.match(/[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Segment[] = [];
  let i = 0;
  let cmd = "";
  let x = 0, y = 0, sx = 0, sy = 0;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || !/^-?\d|^-?\./.test(t)) throw new Error(`bad path near token ${i}`);
    return Number(t);
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) { cmd = t; i++; }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": x = ox + num(); y = oy + num(); sx = x; sy = y; out.push({ op: "M", x, y }); cmd = rel ? "l" : "L"; break;
      case "L": x = ox + num(); y = oy + num(); out.push({ op: "L", x, y }); break;
      case "H": x = ox + num(); out.push({ op: "L", x, y }); break;
      case "V": y = oy + num(); out.push({ op: "L", x, y }); break;
      case "Q": { const x1 = ox + num(), y1 = oy + num(); x = ox + num(); y = oy + num(); out.push({ op: "Q", x1, y1, x, y }); break; }
      case "C": {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
        x = ox + num(); y = oy + num();
        out.push({ op: "C", x1, y1, x2, y2, x, y });
        break;
      }
      case "Z":
        out.push({ op: "Z" }); x = sx; y = sy;
        if (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) throw new Error("number after Z");
        break;
      default: throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return out;
}
