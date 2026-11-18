// Stick and trigger range diagnostics. Pure accumulators fed from the
// controller state NEXUS already publishes (about 60 times a second to the
// UI); nothing here talks to the controller or changes any setting.

/** Stick values are −1…1 with up positive (as the engine publishes them). */
export interface StickRange {
  samples: number;
  minX: number; maxX: number; minY: number; maxY: number;
  maxRadius: number;
  /** Eight 45° sectors (0 = right, counter-clockwise) reached at the edge. */
  sectors: boolean[];
}

export const EDGE = 0.95;          // counts as "fully pushed" along an axis
export const SECTOR_RADIUS = 0.9;  // counts as "at the edge" for a direction
export const CENTER_RADIUS = 0.15; // counts as "back near the centre"

export function emptyStickRange(): StickRange {
  return { samples: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, maxRadius: 0, sectors: new Array(8).fill(false) };
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

export function addStickSample(r: StickRange, x0: number, y0: number): StickRange {
  const x = finite(x0), y = finite(y0);
  const radius = Math.hypot(x, y);
  const sectors = r.sectors.slice();
  if (radius >= SECTOR_RADIUS) {
    const a = (Math.atan2(y, x) * 180) / Math.PI;
    sectors[Math.round(((a + 360) % 360) / 45) % 8] = true;
  }
  return {
    samples: r.samples + 1,
    minX: Math.min(r.minX, x), maxX: Math.max(r.maxX, x),
    minY: Math.min(r.minY, y), maxY: Math.max(r.maxY, y),
    maxRadius: Math.max(r.maxRadius, radius),
    sectors,
  };
}

export interface StickRangeResult {
  left: boolean; right: boolean; up: boolean; down: boolean;
  sectorsReached: number;
  /** All four axis ends and all eight directions reached. */
  complete: boolean;
}

export function stickRangeResult(r: StickRange): StickRangeResult {
  const res = { left: r.minX <= -EDGE, right: r.maxX >= EDGE, up: r.maxY >= EDGE, down: r.minY <= -EDGE };
  const sectorsReached = r.sectors.filter(Boolean).length;
  return { ...res, sectorsReached, complete: res.left && res.right && res.up && res.down && sectorsReached === 8 };
}

/** Raw trigger bytes 0–255. */
export interface TriggerRange { samples: number; minRaw: number; maxRaw: number }

export const RELEASED_RAW = 2;   // at or below: fully released
export const PRESSED_RAW = 253;  // at or above: fully pressed

export function emptyTriggerRange(): TriggerRange { return { samples: 0, minRaw: 255, maxRaw: 0 }; }

export function addTriggerSample(r: TriggerRange, raw: number): TriggerRange {
  const v = Math.max(0, Math.min(255, Math.round(finite(raw))));
  return { samples: r.samples + 1, minRaw: Math.min(r.minRaw, v), maxRaw: Math.max(r.maxRaw, v) };
}

export interface TriggerRangeResult {
  fullRelease: boolean;
  fullPress: boolean;
  /** Why travel looks incomplete, or null. Only after the trigger was used. */
  incomplete: string | null;
}

export function triggerRangeResult(r: TriggerRange): TriggerRangeResult {
  const fullRelease = r.samples > 0 && r.minRaw <= RELEASED_RAW;
  const fullPress = r.maxRaw >= PRESSED_RAW;
  let incomplete: string | null = null;
  if (r.samples > 0 && r.maxRaw > 40 && !fullPress) incomplete = `Highest value seen ${r.maxRaw} of 255 (${Math.round((r.maxRaw / 255) * 100)} %). Press it all the way down.`;
  else if (r.samples > 0 && !fullRelease) incomplete = `Lowest value seen ${r.minRaw} of 255: it never fully returned to 0.`;
  return { fullRelease, fullPress, incomplete };
}

export const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, finite(v))) * 100)} %`;
export const signed = (v: number, digits = 3) => (finite(v) >= 0 ? "+" : "") + finite(v).toFixed(digits);
