// Pure rules behind the Macro Studio workspace: searching, sorting, pinned
// macros, where a macro is used, and what a running macro is doing right now
// (from the engine's run state). Unit-tested; the page only renders them.

import { BUTTONS, lengthMs, sequenceStateAt, totalDuration } from "./macros.ts";
import type { Macro, MacroButton, MacroMeta, MacroRun, Profile } from "../types/engine";

export type MacroSort = "modified" | "name" | "created";

export const MACRO_SORTS: Array<{ id: MacroSort; label: string }> = [
  { id: "modified", label: "Last modified" },
  { id: "name", label: "Name" },
  { id: "created", label: "Newest" },
];

export const EMPTY_MACRO_META: MacroMeta = { pinned: [], profiles: {} };

/** Matches the name, the description or the trigger button's name. */
export function macroMatches(m: Macro, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const trigger = m.trigger ? BUTTONS[m.trigger].name.toLowerCase() : "";
  return m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || trigger.includes(q);
}

/** Pinned macros first (in pin order), then the rest sorted. */
export function organizeMacros(macros: Macro[], meta: MacroMeta, query: string, sort: MacroSort): { pinned: Macro[]; others: Macro[] } {
  const shown = macros.filter((m) => macroMatches(m, query));
  const pinned = meta.pinned.map((id) => shown.find((m) => m.id === id)).filter((m): m is Macro => m !== undefined);
  const byName = (a: Macro, b: Macro) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const cmp = sort === "name" ? byName
    : sort === "created" ? (a: Macro, b: Macro) => b.createdAtMs - a.createdAtMs || byName(a, b)
      : (a: Macro, b: Macro) => b.updatedAtMs - a.updatedAtMs || byName(a, b);
  const others = shown.filter((m) => !meta.pinned.includes(m.id)).sort(cmp);
  return { pinned, others };
}

export interface Usage {
  /** The button that starts it (null: not assigned). */
  trigger: MacroButton | null;
  /** Profiles it is switched on in. */
  profiles: Profile[];
  /** On in the active profile and assigned: it reacts to its button now. */
  activeNow: boolean;
}

/** Where a macro is used: its button and the profiles it is on in. */
export function usageOf(m: Macro, meta: MacroMeta, profiles: Profile[], activeProfileId: number | null): Usage {
  const ids = meta.profiles[m.id] ?? [];
  const on = profiles.filter((p) => ids.includes(p.id));
  return { trigger: m.trigger, profiles: on, activeNow: !!m.trigger && activeProfileId !== null && ids.includes(activeProfileId) };
}

/** One line: "R1 · on in Default, Warzone" / "No button · off in every profile". */
export function usageText(u: Usage): string {
  const button = u.trigger ? BUTTONS[u.trigger].name : "No button";
  const where = u.profiles.length === 0 ? "off in every profile"
    : `on in ${u.profiles.map((p) => p.name).join(", ")}`;
  return `${button} · ${where}`;
}

export type RunView =
  | { state: "idle" }
  | { state: "arming"; heldMs: number; neededMs: number }
  | { state: "running"; step: number | null; pressed: boolean; pass: number; passes: number | null; progress: number; elapsedMs: number; down: MacroButton[] };

/**
 * What a macro is doing at `nowMs`, from the engine's run state and the same
 * timing rules as playback: the current action, the pass (Play Once with a
 * repeat count, or a loop) and how far through the pass it is.
 */
export function runView(m: Macro, run: MacroRun | undefined, nowMs: number): RunView {
  if (!run) return { state: "idle" };
  const elapsed = Math.max(0, nowMs - run.sinceMs);
  if (run.state === "arming") return { state: "arming", heldMs: Math.min(elapsed, m.activationMs), neededMs: m.activationMs };
  const total = totalDuration(m.steps);
  const pause = m.repeatDelayMs;
  const cycle = Math.max(1, total + pause);
  const pass = Math.floor(elapsed / cycle);
  const inPass = elapsed - pass * cycle;
  const passes = m.mode === "once" ? Math.max(1, m.repeatCount ?? 1) : null;
  const { point, down } = sequenceStateAt(m.steps, inPass);
  return {
    state: "running", step: point.step, pressed: point.pressed, pass: passes === null ? pass : Math.min(pass, passes - 1),
    passes, progress: total ? Math.min(1, inPass / total) : 1, elapsedMs: elapsed, down,
  };
}

/** Plain-language description of one action, as shown in the editor. */
export function describeStep(steps: Macro["steps"], i: number): string {
  const s = steps[i]!;
  const names = s.buttons.map((b) => BUTTONS[b].name).join(" + ");
  const wait = s.delayAfterMs ? `, then wait ${s.delayAfterMs} ms` : "";
  switch (s.kind ?? "tap") {
    case "hold": return `Press ${names} and keep it held${wait}`;
    case "release": return `Release ${names}${wait}`;
    default: return `Press ${names} for ${s.holdMs} ms, release${wait}`;
  }
}

/** Total time of one press of the trigger (all passes of Play Once), or one loop cycle. */
export function playTime(m: Macro): number {
  const one = m.steps.reduce((t, s) => t + lengthMs(s), 0);
  if (m.mode !== "once") return one + m.repeatDelayMs;
  const n = Math.max(1, m.repeatCount ?? 1);
  return n * one + (n - 1) * m.repeatDelayMs;
}

/**
 * What a Macro Studio address opens. The library is the default; an editor
 * needs a macro chosen first: "edit:<id>" opens a saved macro, "draft" the new
 * macro that isn't saved yet, "new" / "new:<button>" the library with the
 * New macro dialog (from Mapping, for that button).
 */
export type MacroRoute =
  | { view: "library"; create: false }
  | { view: "library"; create: true; trigger: MacroButton | null }
  | { view: "editor"; id: string }
  | { view: "draft" };

export function parseMacroRoute(tab: string | undefined): MacroRoute {
  if (tab === "draft") return { view: "draft" };
  if (tab?.startsWith("edit:") && tab.length > 5) return { view: "editor", id: tab.slice(5) };
  if (tab === "new" || tab?.startsWith("new:")) {
    const b = tab.slice(4);
    return { view: "library", create: true, trigger: Object.hasOwn(BUTTONS, b) ? (b as MacroButton) : null };
  }
  return { view: "library", create: false };
}

export const editorTab = (id: string) => `edit:${id}`;
