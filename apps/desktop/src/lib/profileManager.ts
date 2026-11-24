// Pure rules behind the Profile Manager: searching, sorting, pinned and
// recently used profiles, what a profile changes, and which controllers it
// fully works with. Unit-tested; the page only renders them.

import type { MacroButton, Profile, ProcessingConfig } from "../types/engine";
import { withDefaults } from "./processing.ts";

/** Organisation data from the engine (`get_profile_meta`). */
export interface ProfileMeta {
  /** Pinned profiles, in the order they were pinned. */
  pinned: number[];
  /** Profile id (as a string key) → when it was last made active. */
  lastUsedMs: Record<string, number>;
  /** The profile NEXUS starts with, if one is chosen. */
  startup: number | null;
  /** The profile that can't be deleted. */
  protected: number;
}

export const EMPTY_META: ProfileMeta = { pinned: [], lastUsedMs: {}, startup: null, protected: -1 };

export type SortKey = "recent" | "name" | "modified" | "created";

export const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "recent", label: "Recently used" },
  { id: "name", label: "Name" },
  { id: "modified", label: "Last modified" },
  { id: "created", label: "Newest" },
];

export const lastUsed = (meta: ProfileMeta, id: number): number | null => meta.lastUsedMs[String(id)] ?? null;

/** Does the profile match the search text (name or a linked game)? */
export function matches(p: Profile, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.name.toLowerCase().includes(q) || p.games.some((g) => g.toLowerCase().includes(q));
}

function compare(sort: SortKey, meta: ProfileMeta) {
  const byName = (a: Profile, b: Profile) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return (a: Profile, b: Profile): number => {
    switch (sort) {
      case "name": return byName(a, b);
      case "modified": return b.updatedAtMs - a.updatedAtMs || byName(a, b);
      case "created": return b.createdAtMs - a.createdAtMs || b.id - a.id;
      case "recent": {
        // Never-used profiles go last, by name.
        const ua = lastUsed(meta, a.id) ?? -1, ub = lastUsed(meta, b.id) ?? -1;
        return ub - ua || byName(a, b);
      }
    }
  };
}

/**
 * The list as shown: pinned profiles first (in pin order), then the rest
 * in the chosen order. Search filters both by name or linked game.
 */
export function organize(profiles: Profile[], meta: ProfileMeta, query: string, sort: SortKey): { pinned: Profile[]; others: Profile[] } {
  const shown = profiles.filter((p) => matches(p, query));
  const pinned = meta.pinned.map((id) => shown.find((p) => p.id === id)).filter((p): p is Profile => p !== undefined);
  const others = shown.filter((p) => !meta.pinned.includes(p.id)).sort(compare(sort, meta));
  return { pinned, others };
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function relativeTime(ms: number | null, now: number): string {
  if (ms === null || ms <= 0) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** What the profile changes from a plain controller, in a few words. */
export function summary(raw: Profile): string[] {
  const p = withDefaults(raw.processing);
  const parts: string[] = [];
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  if (p.remap.length) parts.push(n(p.remap.length, "remapped button"));
  if (p.layers.length) parts.push(n(p.layers.length, "shift layer"));
  if (p.combos.length) parts.push(n(p.combos.length, "combination"));
  if (p.leftStick.curve.type !== "linear" || p.rightStick.curve.type !== "linear") parts.push("custom stick curves");
  const dz = (x: number) => Math.round(x * 100);
  if (dz(p.leftStick.deadzone) !== 5 || dz(p.rightStick.deadzone) !== 5) parts.push(`deadzones ${dz(p.leftStick.deadzone)} % / ${dz(p.rightStick.deadzone)} %`);
  if (p.leftTrigger.deadzone > 0 || p.rightTrigger.deadzone > 0 || p.leftTrigger.maxInput < 1 || p.rightTrigger.maxInput < 1) parts.push("tuned triggers");
  if (p.gyro.enabled) parts.push("gyro aiming");
  if (p.touchpad.zones.some((z) => z !== null) || p.touchpad.swipesEnabled) parts.push("touchpad buttons");
  return parts.length ? parts : ["Default settings"];
}

/** Every button the profile reads from the controller (not what it sends). */
function inputsUsed(p: ProcessingConfig): MacroButton[] {
  const used: MacroButton[] = [];
  for (const r of p.remap) used.push(r.from);
  for (const l of p.layers) { used.push(l.activator); for (const r of l.remap) used.push(r.from); }
  for (const c of p.combos) used.push(...c.buttons);
  if (p.gyro.enabled && p.gyro.activation !== "always" && p.gyro.button) used.push(p.gyro.button);
  return used;
}

export interface Compatibility {
  /** Settings that can't take effect on a DualShock 4 (empty: works fully). */
  dualShock4: string[];
  /** Notes that apply whichever controller is used. */
  general: string[];
}

/**
 * Which controllers the profile fully works with. Every profile runs on
 * both; a DualShock 4 has no Mute button and no player lights, so settings
 * that rely on them do nothing there.
 */
export function compatibility(raw: Profile): Compatibility {
  const p = withDefaults(raw.processing);
  const ds4: string[] = [];
  const reads = inputsUsed(p).filter((b) => b === "mute");
  if (reads.length) ds4.push("uses the Mute button, which a DualShock 4 doesn't have");
  if (p.feedback.playerLedsEnabled) ds4.push("player lights (a DualShock 4 has none)");
  const general: string[] = [];
  if (raw.virtualOutput === "dualShock4") general.push("virtual DualShock 4 output isn't available yet, so games see no controller");
  return { dualShock4: ds4, general };
}

/** A name for a copy that isn't taken: "Name (copy)", "Name (copy 2)"… (max 40 characters). */
export function copyName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  const stem = base.trim().slice(0, 30);
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem} (copy)` : `${stem} (copy ${n})`;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

export type NewProfileSource = { kind: "blank" } | { kind: "copy"; from: number } | { kind: "template"; id: string };
