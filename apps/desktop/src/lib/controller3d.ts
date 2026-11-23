// Input mapping and camera rules for the 3D controller (components/controller3d).
// Pure (no three.js), so they are unit-tested. Every visual value comes from
// the ControllerState NEXUS already publishes; nothing is simulated.
//
// Scene axes: x to the right, y up (towards L1/R1), z out of the face.

import { dpadLit } from "./controllerView.ts";
import type { ControllerModel, ControllerState, MacroButton, ReportFormat } from "../types/engine";

/** Largest stick tilt (radians), about the DualSense's real ~22°. */
export const MAX_TILT = 0.38;
/** How far a fully pressed L2/R2 swings in (radians). */
export const TRIGGER_SWING = 0.42;

/**
 * Rotation about x (radians) of L2/R2 for a pressure of 0…1. The blade hangs
 * below and behind its hinge, so pulling turns it negatively: the tip moves
 * towards the player and up into the body, as on the real controller.
 */
export function triggerAngle(value: number): number {
  return -clamp(value, 0, 1) * TRIGGER_SWING;
}

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

export type Vec3 = [number, number, number];

/** Is a surface facing the camera (so its leader line should show)? */
export function facesCamera(anchor: { pos: Vec3; normal: Vec3 }, camera: Vec3): boolean {
  const d: Vec3 = [camera[0] - anchor.pos[0], camera[1] - anchor.pos[1], camera[2] - anchor.pos[2]];
  return d[0] * anchor.normal[0] + d[1] * anchor.normal[1] + d[2] * anchor.normal[2] > 0;
}

// ---- Camera ------------------------------------------------------------

/** Camera position around the target, as radius, polar angle from +Y (phi) and azimuth around Y (theta, 0 = front). */
export interface Orbit { radius: number; phi: number; theta: number }

export const CAMERA_TARGET: Vec3 = [0, -0.1, 0];
export const ZOOM = { min: 5, max: 17 } as const;

export const VIEWS = {
  /** A slight tilt, the way you look at a controller in your hands. */
  default: { radius: 10.4, phi: 1.12, theta: 0 },
  front: { radius: 10.4, phi: Math.PI / 2, theta: 0 },
  rear: { radius: 10.4, phi: Math.PI / 2, theta: Math.PI },
  /** From above the top edge: bumpers and triggers. */
  top: { radius: 9.8, phi: 0.42, theta: 0 },
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

// ---- Which model ---------------------------------------------------------

/** The 3D models NEXUS has. A DualSense Edge is shown as a DualSense. */
export type ViewModel = "dualSense" | "dualShock4";

/**
 * Which 3D model to show. The state says which controller it came from (its
 * report format). States that don't (macro previews, or no input yet) use
 * the connected controller's model; with nothing connected, the model shown
 * last stays, with the usual "No controller connected" badge.
 */
export function modelFor(format: ReportFormat | null | undefined, connected: ControllerModel | null | undefined, last: ViewModel): ViewModel {
  if (format === "dualShock4Usb") return "dualShock4";
  if (format === "dualSenseUsb" || format === "dualSenseBluetooth" || format === "dualSenseBluetoothBasic") return "dualSense";
  if (connected === "dualShock4") return "dualShock4";
  if (connected === "dualSense" || connected === "dualSenseEdge") return "dualSense";
  return last;
}
