// "Detected this session": every control NEXUS has seen used since the
// Live Viewer opened, so it's obvious which inputs reach NEXUS at all.

import type { ControllerState, MacroButton } from "../types/engine";
import { isPressed } from "./diagTest.ts";

export const CONTROLS: Array<{ id: MacroButton | "lstickMove" | "rstickMove" | "touchMove"; label: string }> = [
  { id: "south", label: "Cross" }, { id: "east", label: "Circle" }, { id: "west", label: "Square" }, { id: "north", label: "Triangle" },
  { id: "dpadUp", label: "D-pad up" }, { id: "dpadDown", label: "D-pad down" }, { id: "dpadLeft", label: "D-pad left" }, { id: "dpadRight", label: "D-pad right" },
  { id: "leftShoulder", label: "L1" }, { id: "rightShoulder", label: "R1" }, { id: "leftTrigger", label: "L2" }, { id: "rightTrigger", label: "R2" },
  { id: "leftStick", label: "L3" }, { id: "rightStick", label: "R3" }, { id: "lstickMove", label: "Left stick" }, { id: "rstickMove", label: "Right stick" },
  { id: "select", label: "Create" }, { id: "start", label: "Options" }, { id: "home", label: "PS" },
  { id: "touchpad", label: "Touchpad click" }, { id: "touchMove", label: "Touchpad touch" }, { id: "mute", label: "Mute" },
];

export type ControlId = (typeof CONTROLS)[number]["id"];

/** Controls active in this state (triggers count from 10 % travel, sticks from 20 % deflection). */
export function activeControls(s: ControllerState | null): Set<ControlId> {
  const out = new Set<ControlId>();
  if (!s) return out;
  for (const c of CONTROLS) {
    const id = c.id;
    if (id === "lstickMove") { if (Math.hypot(s.leftStick.x, s.leftStick.y) > 0.2) out.add(id); }
    else if (id === "rstickMove") { if (Math.hypot(s.rightStick.x, s.rightStick.y) > 0.2) out.add(id); }
    else if (id === "touchMove") { if (s.touchpad?.points.some((p) => p.active)) out.add(id); }
    else if (id === "leftTrigger") { if (s.leftTrigger.value > 0.1) out.add(id); }
    else if (id === "rightTrigger") { if (s.rightTrigger.value > 0.1) out.add(id); }
    else if (isPressed(s, id)) out.add(id);
  }
  return out;
}

export function mergeSeen(seen: ReadonlySet<ControlId>, s: ControllerState | null): Set<ControlId> {
  const now = activeControls(s);
  if ([...now].every((c) => seen.has(c))) return seen as Set<ControlId>;
  return new Set([...seen, ...now]);
}
