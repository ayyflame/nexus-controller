// Small, pure calculations behind the controller picture, kept apart from the
// SVG so they are unit-tested. Every value comes from real controller state.

import type { ControllerState, DpadDirection } from "../types/engine";

export interface DpadLit { up: boolean; down: boolean; left: boolean; right: boolean }

export function dpadLit(d: DpadDirection | undefined): DpadLit {
  const v = d ?? "neutral";
  return {
    up: v === "up" || v === "upLeft" || v === "upRight",
    down: v === "down" || v === "downLeft" || v === "downRight",
    left: v === "left" || v === "upLeft" || v === "downLeft",
    right: v === "right" || v === "upRight" || v === "downRight",
  };
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/**
 * Screen offset of a stick cap for stick values x, y in −1…1 (y up is
 * positive, as in the engine). SVG y grows downward, so y is flipped.
 */
export function stickOffset(x: number, y: number, travel: number): [number, number] {
  return [clamp(x, -1, 1) * travel, -clamp(y, -1, 1) * travel];
}

/**
 * An L2/R2 trigger seen from the front: it rises from behind its bumper.
 * `outer` is the edge at the controller's side, `inner` the edge towards the
 * middle; `top` its highest point; below `visibleBottom` it is hidden by the
 * bumper (drawn on top) and continues to `bottom`.
 */
export interface TriggerShape { outer: number; inner: number; top: number; visibleBottom: number; bottom: number; dip: number }

/** Outline of a trigger: a rounded tab, taller at the outside, like the real L2/R2. */
export function triggerPath(g: TriggerShape): string {
  const d = g.inner > g.outer ? 1 : -1;
  const w = Math.abs(g.inner - g.outer);
  const r = Math.min(w * 0.22, (g.visibleBottom - g.top) * 0.55);
  const slope = (g.visibleBottom - g.top) * 0.12;
  const x = (k: number) => g.outer + d * k;
  return `M${x(0)} ${g.bottom}` +
    `L${x(0)} ${g.top + r}Q${x(0)} ${g.top} ${x(r)} ${g.top}` +
    `L${x(w - r * 0.8)} ${g.top + slope}Q${x(w)} ${g.top + slope} ${x(w)} ${g.top + slope + r * 0.8}` +
    `L${x(w)} ${g.bottom}Z`;
}

/**
 * Where the pressure fill starts (its top edge) and how far the trigger dips,
 * for a value in 0…1. The fill covers the part hidden behind the bumper from
 * the start, so half pressure fills half of what is visible.
 */
export function triggerLevel(value: number, g: TriggerShape): { fillTop: number; dip: number } {
  const v = clamp(value, 0, 1);
  return { fillTop: g.visibleBottom - v * (g.visibleBottom - g.top), dip: v * g.dip };
}

/** Touch point position inside the drawn touchpad box. */
export function touchPosition(
  p: { x: number; y: number }, pad: { width: number; height: number }, box: { x: number; y: number; w: number; h: number },
): [number, number] {
  const w = Math.max(1, pad.width);
  const h = Math.max(1, pad.height);
  return [box.x + clamp(p.x / w, 0, 1) * box.w, box.y + clamp(p.y / h, 0, 1) * box.h];
}

/** Everything pressed or moved, in words, for screen readers. */
export function describeState(s: ControllerState | null): string {
  if (!s) return "No live input";
  const b = s.buttons;
  const names: string[] = [];
  const add = (on: boolean, n: string) => { if (on) names.push(n); };
  add(b.north, "Triangle"); add(b.east, "Circle"); add(b.south, "Cross"); add(b.west, "Square");
  add(b.leftShoulder, "L1"); add(b.rightShoulder, "R1");
  add(s.leftTrigger.value > 0.02, `L2 ${Math.round(s.leftTrigger.value * 100)}%`);
  add(s.rightTrigger.value > 0.02, `R2 ${Math.round(s.rightTrigger.value * 100)}%`);
  add(b.leftStick, "L3"); add(b.rightStick, "R3");
  add(b.select, "Create"); add(b.start, "Options"); add(b.home, "PS"); add(b.touchpad, "Touchpad click"); add(b.mute, "Mute");
  const d = dpadLit(s.dpad);
  add(d.up, "D-pad up"); add(d.down, "D-pad down"); add(d.left, "D-pad left"); add(d.right, "D-pad right");
  const stick = (n: string, x: number, y: number) => { if (Math.hypot(x, y) > 0.1) names.push(`${n} stick moved`); };
  stick("Left", s.leftStick.x, s.leftStick.y);
  stick("Right", s.rightStick.x, s.rightStick.y);
  return names.length ? `Pressed: ${names.join(", ")}` : "Nothing pressed";
}
