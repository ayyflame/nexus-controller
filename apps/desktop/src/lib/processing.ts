// Mirror of crates/input-processing (curves, deadzones, triggers) used only
// to draw previews. The engine is the authority and does the real work.

import type {
  FeedbackConfig, GyroConfig, ProcessingConfig, ResponseCurve, StickConfig, TouchpadConfig, TriggerConfig,
} from "../types/engine";

export const DEFAULT_CALIBRATION = { centerX: 0, centerY: 0, minX: -1, maxX: 1, minY: -1, maxY: 1 };

export const DEFAULT_STICK: StickConfig = {
  deadzone: 0.05, outerDeadzone: 0, antiDeadzone: 0, sensitivity: 1,
  curve: { type: "linear" }, shape: "radial", circular: true, invertX: false, invertY: false,
  sensitivityX: 1, sensitivityY: 1, squareOutput: false, calibration: { ...DEFAULT_CALIBRATION },
};

export const DEFAULT_TRIGGER: TriggerConfig = {
  deadzone: 0, maxInput: 1, outputMin: 0, outputMax: 1, activation: 0.5, curve: 1, rawMin: 0, rawMax: 1,
};

export const DEFAULT_GYRO: GyroConfig = {
  enabled: false, activation: "always", button: null, suppressButton: false, fullScaleDps: 250,
  sensitivityX: 1, sensitivityY: 1, invertX: false, invertY: false, smoothing: 0.3, thresholdDps: 2,
  horizontalAxis: "yaw", bias: [0, 0, 0],
};

export const DEFAULT_TOUCHPAD: TouchpadConfig = {
  layout: "whole", zones: [null, null, null, null], swipesEnabled: false, swipeDistance: 0.25, swipeMaxMs: 600,
  swipeUp: null, swipeDown: null, swipeLeft: null, swipeRight: null, swipePressMs: 80,
};

export const DEFAULT_FEEDBACK: FeedbackConfig = {
  lightbarEnabled: false, color: [212, 169, 79], brightness: 1, connectionColors: false,
  usbColor: [64, 160, 255], bluetoothColor: [140, 90, 255], playerLedsEnabled: false, playerLeds: 0b00100,
  playerLedBrightness: 0, rumbleIntensity: 1,
};

export function defaultProcessing(): ProcessingConfig {
  return {
    leftStick: { ...DEFAULT_STICK }, rightStick: { ...DEFAULT_STICK },
    leftTrigger: { ...DEFAULT_TRIGGER }, rightTrigger: { ...DEFAULT_TRIGGER },
    remap: [], layers: [], combos: [], gyro: { ...DEFAULT_GYRO }, touchpad: { ...DEFAULT_TOUCHPAD },
    feedback: { ...DEFAULT_FEEDBACK },
  };
}

/** Fills fields missing from settings saved by an older version. */
export function withDefaults(c: Partial<ProcessingConfig> | null | undefined): ProcessingConfig {
  const d = defaultProcessing();
  if (!c) return d;
  const stick = (s?: Partial<StickConfig>) => ({ ...DEFAULT_STICK, ...s, calibration: { ...DEFAULT_CALIBRATION, ...s?.calibration } });
  return {
    leftStick: stick(c.leftStick), rightStick: stick(c.rightStick),
    leftTrigger: { ...DEFAULT_TRIGGER, ...c.leftTrigger }, rightTrigger: { ...DEFAULT_TRIGGER, ...c.rightTrigger },
    remap: c.remap ?? [], layers: c.layers ?? [], combos: c.combos ?? [],
    gyro: { ...d.gyro, ...c.gyro }, touchpad: { ...d.touchpad, ...c.touchpad }, feedback: { ...d.feedback, ...c.feedback },
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
function calibrateAxis(v: number, center: number, min: number, max: number): number {
  const out = v >= center ? (v - center) / Math.max(1e-6, max - center) : (v - center) / Math.max(1e-6, center - min);
  return Math.max(-1, Math.min(1, out));
}

export function processStick(c: StickConfig, x0: number, y0: number): [number, number] {
  const cal = c.calibration;
  let x = calibrateAxis(x0, cal.centerX, cal.minX, cal.maxX);
  let y = calibrateAxis(y0, cal.centerY, cal.minY, cal.maxY);
  if (c.invertX) x = -x;
  if (c.invertY) y = -y;
  if (c.shape === "radial") {
    const m = Math.hypot(x, y);
    if (m > 0) { const out = shapeMagnitude(c, m); x = (x / m) * out; y = (y / m) * out; }
  } else {
    x = Math.sign(x) * shapeMagnitude(c, Math.abs(x));
    y = Math.sign(y) * shapeMagnitude(c, Math.abs(y));
  }
  x *= c.sensitivityX;
  y *= c.sensitivityY;
  if (c.squareOutput) {
    const m = Math.min(1, Math.hypot(x, y));
    const k = Math.max(Math.abs(x), Math.abs(y));
    if (k > 0) { x = (x / k) * m; y = (y / k) * m; }
  } else if (c.circular) { const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } }
  // `+ 0` turns -0 into 0 so previews never show "-0".
  return [Math.max(-1, Math.min(1, x)) + 0, Math.max(-1, Math.min(1, y)) + 0];
}

/** Same as `trigger_output`. */
export function triggerOutput(c: TriggerConfig, raw: number): number {
  const v = Math.min(1, Math.max(0, (raw - c.rawMin) / Math.max(1e-6, c.rawMax - c.rawMin)));
  if (v <= c.deadzone) return 0;
  const n = Math.min(1, Math.max(0, (v - c.deadzone) / Math.max(1e-6, c.maxInput - c.deadzone)));
  return c.outputMin + (c.outputMax - c.outputMin) * Math.pow(n, c.curve);
}

export function curvePresetId(curve: ResponseCurve): string {
  if (curve.type === "linear") return "linear";
  if (curve.type === "custom") return "custom";
  return CURVE_PRESETS.find((p) => p.curve.type === "power" && p.curve.exponent === curve.exponent)?.id ?? "custom";
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
