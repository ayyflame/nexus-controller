// Ready-made sequences for Macro Studio. Users pick one, then edit it.
import type { MacroButton, MacroStep } from "../types/engine";
import { uid } from "./macros.ts";

export interface MacroTemplate {
  id: string;
  name: string;
  description: string;
  build: (button: MacroButton) => MacroStep[];
}

const step = (buttons: MacroButton[], holdMs: number, delayAfterMs: number): MacroStep =>
  ({ id: uid(), buttons, holdMs, delayAfterMs });
const hold = (buttons: MacroButton[], delayAfterMs: number): MacroStep => ({ id: uid(), buttons, holdMs: 0, delayAfterMs, kind: "hold" });
const release = (buttons: MacroButton[], delayAfterMs: number): MacroStep => ({ id: uid(), buttons, holdMs: 0, delayAfterMs, kind: "release" });

export const MACRO_TEMPLATES: MacroTemplate[] = [
  { id: "double", name: "Double tap", description: "Tap a button twice quickly",
    build: (b) => [step([b], 60, 60), step([b], 60, 0)] },
  { id: "triple", name: "Triple tap", description: "Three quick taps",
    build: (b) => [step([b], 60, 60), step([b], 60, 60), step([b], 60, 0)] },
  { id: "rapid", name: "Rapid press", description: "Fast repeated taps (use with Repeat While Held)",
    build: (b) => [step([b], 40, 40)] },
  { id: "hold", name: "Long hold", description: "Hold a button for one second",
    build: (b) => [step([b], 1000, 0)] },
  { id: "tap-hold", name: "Tap, then hold", description: "Quick tap followed by a half-second hold",
    build: (b) => [step([b], 60, 100), step([b], 500, 0)] },
  { id: "hold-l2", name: "Hold L2 while tapping", description: "Keep L2 down while the button is tapped twice, then let go of L2",
    build: (b) => b === "leftTrigger"
      ? [hold(["rightTrigger"], 100), step([b], 60, 80), step([b], 60, 80), release(["rightTrigger"], 0)]
      : [hold(["leftTrigger"], 100), step([b], 60, 80), step([b], 60, 80), release(["leftTrigger"], 0)] },
];
