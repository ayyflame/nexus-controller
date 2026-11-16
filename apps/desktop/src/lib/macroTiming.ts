// Editing macro timing after recording or building. Pure functions over
// MacroStep[]; every result is clamped to the limits the Rust engine
// validates (crates/macro-engine/src/model.rs), so edited timing can never
// produce a macro that fails to save or plays wrongly.

import { LIMITS } from "./macros.ts";
import type { MacroStep, PlaybackMode } from "../types/engine";

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
  if (i <= 0 || i >= steps.length || steps[i - 1]!.delayAfterMs === clampDelay(ms)) return steps;
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

/** A place where two presses of the same button are too close together, so a
 *  game may see one long press instead of two. `after` is the index of the
 *  action whose wait is too short; `repeat` marks the loop boundary (last
 *  action → first action, gap = last wait + pause between repeats). */
export interface MergeRisk {
  after: number;
  repeat: boolean;
  gapMs: number;
  buttons: MacroStep["buttons"];
}

const shared = (a: MacroStep, b: MacroStep) => a.buttons.filter((x) => b.buttons.includes(x));

export function mergeRisks(steps: MacroStep[], mode: PlaybackMode, repeatDelayMs: number): MergeRisk[] {
  const out: MergeRisk[] = [];
  for (let i = 0; i + 1 < steps.length; i++) {
    const same = shared(steps[i]!, steps[i + 1]!);
    if (same.length && steps[i]!.delayAfterMs < LIMITS.minReleaseGapMs) {
      out.push({ after: i, repeat: false, gapMs: steps[i]!.delayAfterMs, buttons: same });
    }
  }
  if (mode !== "once" && steps.length > 0) {
    const last = steps[steps.length - 1]!;
    const same = shared(last, steps[0]!);
    const gap = last.delayAfterMs + repeatDelayMs;
    if (same.length && gap < LIMITS.minReleaseGapMs) {
      out.push({ after: steps.length - 1, repeat: true, gapMs: gap, buttons: same });
    }
  }
  return out;
}

/** Where a preview is after `elapsedMs`. Looping modes repeat the sequence
 *  with the pause between repeats, exactly like the engine. */
export function previewAt(steps: MacroStep[], elapsedMs: number, loopPauseMs: number | null) {
  const total = steps.reduce((t, s) => t + s.holdMs + s.delayAfterMs, 0);
  if (loopPauseMs === null) return { cycleMs: elapsedMs, done: elapsedMs >= total };
  const cycle = Math.max(1, total + loopPauseMs);
  return { cycleMs: elapsedMs % cycle, done: false };
}

/** Parses a millisecond field. Returns the value to store, or null to revert
 *  the field (empty or not a number). */
export function parseMs(text: string, min: number, max: number): number | null {
  if (text.trim() === "") return null;
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}
