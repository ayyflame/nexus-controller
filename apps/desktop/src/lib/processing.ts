// Mirror of crates/input-processing (curves, deadzones, triggers) used only
// to draw previews. The engine is the authority and does the real work.

import type {
  ProcessingConfig, ResponseCurve, StickConfig, TriggerConfig,
} from "../types/engine";

export const DEFAULT_STICK: StickConfig = {
  deadzone: 0.05, outerDeadzone: 0, antiDeadzone: 0, sensitivity: 1,
  curve: { type: "linear" }, shape: "radial", circular: true, invertX: false, invertY: false,
};

export const DEFAULT_TRIGGER: TriggerConfig = { deadzone: 0, maxInput: 1, outputMin: 0, outputMax: 1 };

export function defaultProcessing(): ProcessingConfig {
  return {
    leftStick: { ...DEFAULT_STICK }, rightStick: { ...DEFAULT_STICK },
    leftTrigger: { ...DEFAULT_TRIGGER }, rightTrigger: { ...DEFAULT_TRIGGER },
    remap: [],
  };
}

export const CURVE_PRESETS: Array<{ id: string; label: string; hint: string; curve: ResponseCurve }> = [
  { id: "linear", label: "Linear", hint: "Output follows the stick exactly", curve: { type: "linear" } },
  { id: "precise", label: "Precise", hint: "Slower near the centre for fine aiming", curve: { type: "power", exponent: 1.8 } },
  { id: "responsive", label: "Responsive", hint: "Reacts quickly to small movements", curve: { type: "power", exponent: 0.6 } },
];

export const STICK_PRESETS: Array<{ id: string; label: string; hint: string; apply: (c: StickConfig) => StickConfig }> = [
  { id: "default", label: "Recommended", hint: "Small deadzone to hide stick drift", apply: () => ({ ...DEFAULT_STICK }) },
  { id: "raw", label: "Raw", hint: "No deadzone or shaping at all", apply: () => ({ ...DEFAULT_STICK, deadzone: 0, circular: false }) },
  { id: "precise", label: "Precise aim", hint: "Deadzone plus a precise curve", apply: () => ({ ...DEFAULT_STICK, deadzone: 0.08, curve: { type: "power", exponent: 1.8 } }) },
  { id: "drift", label: "Worn stick", hint: "Larger deadzone for a drifting stick", apply: () => ({ ...DEFAULT_STICK, deadzone: 0.15 }) },
];

export function evaluateCurve(curve: ResponseCurve, n: number): number {
  const x = Math.min(1, Math.max(0, n));
  switch (curve.type) {
    case "linear": return x;
    case "power": return Math.pow(x, curve.exponent);
    case "custom": {
      let px = 0, py = 0;
      for (const p of [...curve.points, { x: 1, y: 1 }]) {
        if (x <= p.x) {
          const span = p.x - px;
          return span <= 1e-6 ? p.y : py + ((p.y - py) * (x - px)) / span;
        }
        px = p.x; py = p.y;
      }
      return 1;
    }
  }
}

/** Same as `shape_magnitude` in processor.rs. */
export function shapeMagnitude(c: StickConfig, m: number): number {
  if (m <= c.deadzone) return 0;
  const usable = Math.max(1e-6, 1 - c.deadzone - c.outerDeadzone);
  const n = Math.min(1, Math.max(0, (m - c.deadzone) / usable));
  const shaped = Math.min(1, Math.max(0, evaluateCurve(c.curve, n) * c.sensitivity));
  return c.antiDeadzone + (1 - c.antiDeadzone) * shaped;
}

/** Same as `process_stick`: returns the processed (x, y). */
export function processStick(c: StickConfig, x0: number, y0: number): [number, number] {
  let x = c.invertX ? -x0 : x0;
  let y = c.invertY ? -y0 : y0;
  if (c.shape === "radial") {
    const m = Math.hypot(x, y);
    if (m > 0) { const out = shapeMagnitude(c, m); x = (x / m) * out; y = (y / m) * out; }
  } else {
    x = Math.sign(x) * shapeMagnitude(c, Math.abs(x));
    y = Math.sign(y) * shapeMagnitude(c, Math.abs(y));
  }
  if (c.circular) { const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } }
  // `+ 0` turns -0 into 0 so previews never show "-0".
  return [Math.max(-1, Math.min(1, x)) + 0, Math.max(-1, Math.min(1, y)) + 0];
}

/** Same as `trigger_output`. */
export function triggerOutput(c: TriggerConfig, v: number): number {
  if (v <= c.deadzone) return 0;
  const n = Math.min(1, Math.max(0, (v - c.deadzone) / Math.max(1e-6, c.maxInput - c.deadzone)));
  return c.outputMin + (c.outputMax - c.outputMin) * n;
}

export function curvePresetId(curve: ResponseCurve): string {
  if (curve.type === "linear") return "linear";
  if (curve.type === "custom") return "custom";
  return CURVE_PRESETS.find((p) => p.curve.type === "power" && p.curve.exponent === curve.exponent)?.id ?? "custom";
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
