// Calibration wizard logic. Pure functions over raw samples the UI already
// receives from the engine (physical input, before any processing). Nothing
// here changes a setting: `applyCalibration` only builds a new profile
// configuration, which the wizard saves after the user confirms.
//
// The calibration itself is applied by the existing processing in
// crates/input-processing (stick centre and range, trigger raw range), before
// deadzones and curves, so it reaches the virtual Xbox controller exactly
// like every other setting.

import { analyzeDrift } from "./diagDrift.ts";
import type { ProcessingConfig, StickCalibration, StickConfig, TriggerConfig } from "../types/engine";

export interface Sample { t: number; x: number; y: number }

/** The UI receives about 60 updates a second; centre needs ~2 s of them. */
export const MIN_CENTER_SAMPLES = 90;
export const MIN_RANGE_SAMPLES = 60;
export const MIN_TRIGGER_SAMPLES = 20;
/** One raw step of a DualSense stick axis (1/127 of the half range). */
export const RAW_STEP = 1 / 127;

// ---- Centre ---------------------------------------------------------------------

export interface CenterResult {
  samples: number;
  durationMs: number;
  /** Average resting position: the measured centre (not assumed to be 0). */
  center: { x: number; y: number };
  /** Distance of the measured centre from the ideal centre. */
  offset: number;
  /** Closest and furthest any sample came to the measured centre. */
  minDeviation: number;
  maxDeviation: number;
  /** Root-mean-square distance from the measured centre (noise). */
  jitter: number;
  /** Change of the average between the first and the last second. */
  drift: number;
  /** Furthest any sample was from the ideal centre (what an uncalibrated deadzone must cover). */
  maxFromIdeal: number;
  /** The stick moved during measurement: results are not usable. */
  disturbed: boolean;
}

export type Measured<T> = { ok: true; value: T } | { ok: false; reason: string };

export function measureCenter(samples: Sample[]): Measured<CenterResult> {
  const s = samples.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  if (s.length < MIN_CENTER_SAMPLES) {
    return { ok: false, reason: `Only ${s.length} readings (at least ${MIN_CENTER_SAMPLES} needed). Keep the controller connected and measure again.` };
  }
  const d = analyzeDrift(s)!;
  const dist = s.map((v) => Math.hypot(v.x - d.mean.x, v.y - d.mean.y));
  const value: CenterResult = {
    samples: s.length,
    durationMs: d.durationMs,
    center: d.mean,
    offset: d.centerOffset,
    minDeviation: Math.min(...dist),
    maxDeviation: Math.max(...dist),
    jitter: Math.sqrt(dist.reduce((a, v) => a + v * v, 0) / dist.length),
    drift: d.drift,
    maxFromIdeal: d.maxDeviation,
    disturbed: d.disturbed,
  };
  if (value.disturbed) return { ok: false, reason: "The stick moved during the measurement. Let go of it completely and measure again." };
  return { ok: true, value };
}

// ---- Deadzone -------------------------------------------------------------------

export interface DeadzoneAdvice {
  /** Largest resting movement around the measured centre (hardware). */
  restingMovement: number;
  /** Smallest movement that stands out from resting noise. */
  minDetectable: number;
  /** Suggested deadzone with the centre calibrated. */
  recommended: number;
  /** Deadzone that would be needed without centre calibration. */
  withoutCalibration: number;
}

const roundUp = (v: number, step = 0.005) => Math.ceil(v / step - 1e-9) * step;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Recommends a starting deadzone from the measured resting movement: that
 * movement plus a 25 % margin and two raw steps, so the stick's own noise
 * never registers as input. Between 2 % and 30 %; the user can change it.
 */
export function adviseDeadzone(c: CenterResult): DeadzoneAdvice {
  const margin = (v: number) => clamp(roundUp(v * 1.25 + 2 * RAW_STEP), 0.02, 0.3);
  return {
    restingMovement: c.maxDeviation,
    minDetectable: roundUp(c.maxDeviation + RAW_STEP, 0.001),
    recommended: margin(c.maxDeviation),
    withoutCalibration: margin(c.maxFromIdeal),
  };
}

// ---- Full range -----------------------------------------------------------------

export const DIRECTIONS = ["Right", "Up-right", "Up", "Up-left", "Left", "Down-left", "Down", "Down-right"] as const;
/** Reaching this far (relative to the centre) counts as reaching a direction. */
export const DIRECTION_REACH = 0.9;
/** A cardinal direction should reach at least this far on a healthy stick. */
export const EXPECTED_REACH = 0.95;

export interface RangeResult {
  samples: number;
  /** Extremes relative to the ideal centre (what calibration stores). */
  minX: number; maxX: number; minY: number; maxY: number;
  /** Furthest distance from the measured centre. */
  maxRadius: number;
  /** Furthest distance from the measured centre in each of eight directions. */
  reach: number[];
  cardinalMean: number;
  diagonalMean: number;
  /** Diagonal reach divided by straight reach (about 1.0 for a round gate). */
  diagonalRatio: number;
  /** Share of the circle (36 × 10°) reached at ≥ 85 %. */
  coverage: number;
  /** Every straight direction reaches the expected range. */
  reachesExpected: boolean;
  /** Every direction reached and the circle mostly covered. */
  complete: boolean;
}

export function measureRange(samples: Sample[], center: { x: number; y: number }): Measured<RangeResult> {
  const s = samples.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  if (s.length < MIN_RANGE_SAMPLES) {
    return { ok: false, reason: `Only ${s.length} readings (at least ${MIN_RANGE_SAMPLES} needed). Move the stick for longer.` };
  }
  const reach = new Array(8).fill(0);
  const bins = new Array(36).fill(false);
  let maxRadius = 0;
  for (const v of s) {
    const dx = v.x - center.x, dy = v.y - center.y;
    const r = Math.hypot(dx, dy);
    maxRadius = Math.max(maxRadius, r);
    if (r < 0.2) continue;
    const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const dir = Math.round(a / 45) % 8;
    reach[dir] = Math.max(reach[dir], r);
    if (r >= 0.85) bins[Math.floor(a / 10) % 36] = true;
  }
  const cardinal = [reach[0], reach[2], reach[4], reach[6]];
  const diagonal = [reach[1], reach[3], reach[5], reach[7]];
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const cardinalMean = mean(cardinal), diagonalMean = mean(diagonal);
  const coverage = bins.filter(Boolean).length / bins.length;
  const value: RangeResult = {
    samples: s.length,
    minX: Math.min(...s.map((v) => v.x)), maxX: Math.max(...s.map((v) => v.x)),
    minY: Math.min(...s.map((v) => v.y)), maxY: Math.max(...s.map((v) => v.y)),
    maxRadius, reach, cardinalMean, diagonalMean,
    diagonalRatio: cardinalMean > 0 ? diagonalMean / cardinalMean : 0,
    coverage,
    reachesExpected: cardinal.every((r) => r >= EXPECTED_REACH),
    complete: reach.every((r) => r >= DIRECTION_REACH) && coverage >= 0.9,
  };
  return { ok: true, value };
}

/** Limits the engine accepts (crates/input-processing StickConfig::sanitized). */
const LIMITS = { center: 0.5, minEnd: -0.2, maxEnd: 0.2 };

/**
 * The stick calibration to store. An axis end is only taken from the
 * measurement if it was clearly reached (at least 60 % from the centre);
 * otherwise the previous value is kept and a warning returned.
 */
export function stickCalibrationFrom(
  center: CenterResult, range: RangeResult | null, previous: StickCalibration,
): { calibration: StickCalibration; warnings: string[] } {
  const warnings: string[] = [];
  const cx = clamp(center.center.x, -LIMITS.center, LIMITS.center);
  const cy = clamp(center.center.y, -LIMITS.center, LIMITS.center);
  if (cx !== center.center.x || cy !== center.center.y) warnings.push("The measured centre is far off; it was limited to ±50 %.");
  if (!range) return { calibration: { ...previous, centerX: cx, centerY: cy }, warnings: [...warnings, "Range not measured: the previous range is kept."] };
  const end = (measured: number, ctr: number, prev: number, name: string, isMin: boolean) => {
    const ok = isMin ? ctr - measured >= 0.6 : measured - ctr >= 0.6;
    if (!ok) { warnings.push(`${name} wasn't reached far enough; the previous value is kept.`); return prev; }
    return isMin ? clamp(measured, -1, LIMITS.minEnd) : clamp(measured, LIMITS.maxEnd, 1);
  };
  return {
    calibration: {
      centerX: cx, centerY: cy,
      minX: end(range.minX, cx, previous.minX, "Left", true),
      maxX: end(range.maxX, cx, previous.maxX, "Right", false),
      minY: end(range.minY, cy, previous.minY, "Down", true),
      maxY: end(range.maxY, cy, previous.maxY, "Up", false),
    },
    warnings,
  };
}

// ---- Triggers -------------------------------------------------------------------

export interface TriggerResult {
  /** Raw 0–255 while released (highest seen) and pressed (highest seen). */
  releasedMax: number;
  releasedMin: number;
  pressedMax: number;
  /** Doesn't reach the end: the controller reports less than full travel. */
  incomplete: boolean;
  /** Proposed raw range for the engine (0–1). */
  rawMin: number;
  rawMax: number;
}

export function measureTrigger(released: number[], pressed: number[]): Measured<TriggerResult> {
  const r = released.filter(Number.isFinite), p = pressed.filter(Number.isFinite);
  if (r.length < MIN_TRIGGER_SAMPLES || p.length < MIN_TRIGGER_SAMPLES) {
    return { ok: false, reason: `Not enough readings (${r.length} released, ${p.length} pressed; at least ${MIN_TRIGGER_SAMPLES} each).` };
  }
  const releasedMax = Math.max(...r), releasedMin = Math.min(...r), pressedMax = Math.max(...p);
  if (pressedMax - releasedMax < 0.3 * 255) {
    return { ok: false, reason: `The trigger only moved from ${releasedMax} to ${pressedMax} of 255. Press it all the way down during the "pressed" step.` };
  }
  const rawMin = clamp(releasedMax / 255, 0, 0.5);
  return {
    ok: true,
    value: { releasedMax, releasedMin, pressedMax, incomplete: pressedMax < 240, rawMin, rawMax: Math.max(rawMin + 0.2, pressedMax / 255) },
  };
}

// ---- Apply, status, rollback ------------------------------------------------------

export interface CalibrationSnapshot {
  leftStick: { calibration: StickCalibration; deadzone: number };
  rightStick: { calibration: StickCalibration; deadzone: number };
  leftTrigger: { rawMin: number; rawMax: number };
  rightTrigger: { rawMin: number; rawMax: number };
}

export function snapshotOf(c: ProcessingConfig): CalibrationSnapshot {
  return {
    leftStick: { calibration: { ...c.leftStick.calibration }, deadzone: c.leftStick.deadzone },
    rightStick: { calibration: { ...c.rightStick.calibration }, deadzone: c.rightStick.deadzone },
    leftTrigger: { rawMin: c.leftTrigger.rawMin, rawMax: c.leftTrigger.rawMax },
    rightTrigger: { rawMin: c.rightTrigger.rawMin, rawMax: c.rightTrigger.rawMax },
  };
}

/** The pending changes the user chose to apply (anything left out is unchanged). */
export interface PendingCalibration {
  leftStick?: { calibration?: StickCalibration; deadzone?: number };
  rightStick?: { calibration?: StickCalibration; deadzone?: number };
  leftTrigger?: { rawMin: number; rawMax: number };
  rightTrigger?: { rawMin: number; rawMax: number };
}

/** A new configuration with only the calibration fields changed. */
export function applyCalibration(c: ProcessingConfig, p: PendingCalibration): ProcessingConfig {
  const stick = (s: StickConfig, q?: PendingCalibration["leftStick"]): StickConfig => (!q ? s : {
    ...s,
    ...(q.calibration ? { calibration: { ...q.calibration } } : {}),
    ...(q.deadzone !== undefined ? { deadzone: q.deadzone } : {}),
  });
  const trig = (t: TriggerConfig, q?: { rawMin: number; rawMax: number }): TriggerConfig => (!q ? t : { ...t, rawMin: q.rawMin, rawMax: q.rawMax });
  return {
    ...c,
    leftStick: stick(c.leftStick, p.leftStick),
    rightStick: stick(c.rightStick, p.rightStick),
    leftTrigger: trig(c.leftTrigger, p.leftTrigger),
    rightTrigger: trig(c.rightTrigger, p.rightTrigger),
  };
}

/** Puts back exactly the calibration fields of a snapshot. */
export function restoreSnapshot(c: ProcessingConfig, s: CalibrationSnapshot): ProcessingConfig {
  return applyCalibration(c, {
    leftStick: { calibration: s.leftStick.calibration, deadzone: s.leftStick.deadzone },
    rightStick: { calibration: s.rightStick.calibration, deadzone: s.rightStick.deadzone },
    leftTrigger: s.leftTrigger, rightTrigger: s.rightTrigger,
  });
}

export const DEFAULT_STICK_CALIBRATION: StickCalibration = { centerX: 0, centerY: 0, minX: -1, maxX: 1, minY: -1, maxY: 1 };

const sameCal = (a: StickCalibration, b: StickCalibration) =>
  (Object.keys(a) as Array<keyof StickCalibration>).every((k) => Math.abs(a[k] - b[k]) < 1e-6);

export interface CalibrationStatus {
  sticks: Array<{ side: "leftStick" | "rightStick"; calibrated: boolean; centerOffset: number; deadzone: number }>;
  triggers: Array<{ side: "leftTrigger" | "rightTrigger"; calibrated: boolean; rawMin: number; rawMax: number }>;
}

export function calibrationStatus(c: ProcessingConfig): CalibrationStatus {
  return {
    sticks: (["leftStick", "rightStick"] as const).map((side) => ({
      side,
      calibrated: !sameCal(c[side].calibration, DEFAULT_STICK_CALIBRATION),
      centerOffset: Math.hypot(c[side].calibration.centerX, c[side].calibration.centerY),
      deadzone: c[side].deadzone,
    })),
    triggers: (["leftTrigger", "rightTrigger"] as const).map((side) => ({
      side, calibrated: c[side].rawMin !== 0 || c[side].rawMax !== 1, rawMin: c[side].rawMin, rawMax: c[side].rawMax,
    })),
  };
}
