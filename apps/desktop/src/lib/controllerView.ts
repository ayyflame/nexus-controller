// Small, pure helpers behind the controller picture (unit-tested). Every value
// comes from real controller state.

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
  add(b.select, s.format === "dualShock4Usb" ? "Share" : "Create"); add(b.start, "Options"); add(b.home, "PS"); add(b.touchpad, "Touchpad click"); add(b.mute, "Mute");
  const d = dpadLit(s.dpad);
  add(d.up, "D-pad up"); add(d.down, "D-pad down"); add(d.left, "D-pad left"); add(d.right, "D-pad right");
  const stick = (n: string, x: number, y: number) => { if (Math.hypot(x, y) > 0.1) names.push(`${n} stick moved`); };
  stick("Left", s.leftStick.x, s.leftStick.y);
  stick("Right", s.rightStick.x, s.rightStick.y);
  return names.length ? `Pressed: ${names.join(", ")}` : "Nothing pressed";
}
