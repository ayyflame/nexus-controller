// Profiles › Restore points: labels for the backups NEXUS keeps. Pure, tested.

import type { RestorePoint } from "../types/engine";

/** What a restore point is, in words. */
export function restoreLabel(p: RestorePoint): string {
  switch (p.kind) {
    case "manual": return "Your backup";
    case "daily": return "Daily automatic backup";
    case "beforeRestore": return "Saved before a restore";
    case "beforeUpdate": {
      const m = /^pre-update (\S+) to (\S+) /i.exec(p.name);
      return m ? `Saved before updating ${m[1]} → ${m[2]}` : "Saved before an update";
    }
  }
}

/** The newest `limit` points, plus how many more there are. */
export function visiblePoints(points: RestorePoint[], limit: number): { shown: RestorePoint[]; more: number } {
  return { shown: points.slice(0, limit), more: Math.max(0, points.length - limit) };
}
