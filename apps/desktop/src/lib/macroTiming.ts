// Editing macro timing after recording or building. Pure functions over
// MacroStep[]; every result is clamped to the limits the Rust engine
// validates (crates/macro-engine/src/model.rs), so edited timing can never
// produce a macro that fails to save or plays wrongly.

import { LIMITS } from "./macros.ts";
import type { MacroStep } from "../types/engine";

export const clampHold = (ms: number) =>
  Math.max(LIMITS.minHoldMs, Math.min(LIMITS.maxHoldMs, Math.round(Number.isFinite(ms) ? ms : LIMITS.minHoldMs)));

export const clampDelay = (ms: number) =>
  Math.max(0, Math.min(LIMITS.maxDelayMs, Math.round(Number.isFinite(ms) ? ms : 0)));

/** Start time of each action, in ms after the macro starts. */
export function startTimes(steps: MacroStep[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of steps) {
    out.push(t);
    t += s.holdMs + s.delayAfterMs;
  }
  return out;
}

/** Pause before action `i` starts: the previous action's wait (0 for the first). */
export function waitBefore(steps: MacroStep[], i: number): number {
  return i > 0 ? steps[i - 1]?.delayAfterMs ?? 0 : 0;
}

/** Sets the pause before action `i` (edits the previous action's wait). The
 *  first action always starts as soon as the macro is triggered. */
export function setWaitBefore(steps: MacroStep[], i: number, ms: number): MacroStep[] {
  if (i <= 0 || i >= steps.length) return steps;
  return steps.map((s, k) => (k === i - 1 ? { ...s, delayAfterMs: clampDelay(ms) } : s));
}

/** Sets press time and/or wait for every selected action. */
export function setTiming(
  steps: MacroStep[],
  ids: readonly string[],
  t: { holdMs?: number; delayAfterMs?: number },
): MacroStep[] {
  const sel = new Set(ids);
  return steps.map((s) =>
    sel.has(s.id)
      ? {
          ...s,
          holdMs: t.holdMs === undefined ? s.holdMs : clampHold(t.holdMs),
          delayAfterMs: t.delayAfterMs === undefined ? s.delayAfterMs : clampDelay(t.delayAfterMs),
        }
      : s,
  );
}

/** Scales press times and waits of the selected actions by `percent`
 *  (e.g. 50 = twice as fast, 200 = half as fast), keeping their rhythm. */
export function scaleTiming(steps: MacroStep[], ids: readonly string[], percent: number): MacroStep[] {
  const f = Math.max(1, Math.min(1000, Number.isFinite(percent) ? percent : 100)) / 100;
  const sel = new Set(ids);
  return steps.map((s) =>
    sel.has(s.id) ? { ...s, holdMs: clampHold(s.holdMs * f), delayAfterMs: clampDelay(s.delayAfterMs * f) } : s,
  );
}

/** Shared value of a field across the selection, or null when they differ. */
export function commonValue(steps: MacroStep[], ids: readonly string[], key: "holdMs" | "delayAfterMs"): number | null {
  const values = new Set(steps.filter((s) => ids.includes(s.id)).map((s) => s[key]));
  return values.size === 1 ? [...values][0]! : null;
}
