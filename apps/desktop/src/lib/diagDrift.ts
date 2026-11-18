// Stick drift measurement: the user leaves the controller untouched while
// raw stick positions are recorded. Results are measurements; NEXUS doesn't
// call a controller defective. A reference threshold (by default the
// profile's deadzone) can be compared against.

export interface DriftSample { t: number; x: number; y: number }

export interface DriftResult {
  samples: number;
  durationMs: number;
  /** Average resting position (−1…1). */
  mean: { x: number; y: number };
  /** Distance of the average resting position from the ideal centre. */
  centerOffset: number;
  /** Largest distance of any sample from the ideal centre. */
  maxDeviation: number;
  /** Largest distance of any sample from the average (jitter). */
  maxSpread: number;
  /** How far the average moved between the first and the last second. */
  drift: number;
  /** The stick was clearly moved during the measurement. */
  disturbed: boolean;
}

export const DISTURBED_SPREAD = 0.25;

const avg = (s: DriftSample[]) => s.length
  ? { x: s.reduce((a, v) => a + v.x, 0) / s.length, y: s.reduce((a, v) => a + v.y, 0) / s.length }
  : { x: 0, y: 0 };

export function analyzeDrift(samples: DriftSample[], windowMs = 1000): DriftResult | null {
  const s = samples.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  if (s.length === 0) return null;
  const t0 = s[0]!.t, t1 = s[s.length - 1]!.t;
  const mean = avg(s);
  const first = avg(s.filter((v) => v.t - t0 <= windowMs));
  const last = avg(s.filter((v) => t1 - v.t <= windowMs));
  const maxSpread = Math.max(...s.map((v) => Math.hypot(v.x - mean.x, v.y - mean.y)));
  return {
    samples: s.length,
    durationMs: t1 - t0,
    mean,
    centerOffset: Math.hypot(mean.x, mean.y),
    maxDeviation: Math.max(...s.map((v) => Math.hypot(v.x, v.y))),
    maxSpread,
    drift: Math.hypot(last.x - first.x, last.y - first.y),
    disturbed: maxSpread > DISTURBED_SPREAD,
  };
}

/** Fewer samples than this per second means input stopped during the test. */
export const MIN_SAMPLES_PER_SECOND = 20;

/** Null when the measurement is usable, otherwise why it isn't. */
export function invalidReason(r: DriftResult | null, requestedSeconds: number): string | null {
  if (!r) return "No samples were recorded: no controller input arrived.";
  const need = Math.floor(requestedSeconds * MIN_SAMPLES_PER_SECOND);
  if (r.samples < need) {
    return `Only ${r.samples} samples in ${requestedSeconds} s (at least ${need} expected): the controller stopped sending during the test. Check the cable and measure again.`;
  }
  return null;
}

/** Objective comparison with a reference radius (e.g. the deadzone). */
export function compareToReference(r: DriftResult, reference: number): string {
  const p = (v: number) => `${(v * 100).toFixed(1)} %`;
  if (r.maxDeviation <= reference) {
    return `The largest resting deviation (${p(r.maxDeviation)}) is inside the reference radius of ${p(reference)}.`;
  }
  return `The largest resting deviation (${p(r.maxDeviation)}) is outside the reference radius of ${p(reference)} by ${p(r.maxDeviation - reference)}.`;
}
