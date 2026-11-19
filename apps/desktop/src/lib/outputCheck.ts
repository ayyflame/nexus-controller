// Output Check (Live Viewer): reads of the virtual Xbox 360 controller back
// through XInput, compared with what NEXUS sent. Pure helpers, unit-tested.

import type { OutputCheck, StageSummary, XInputPad } from "../types/engine";

export const XBUTTONS: Array<[number, string]> = [
  [0x1000, "A"], [0x2000, "B"], [0x4000, "X"], [0x8000, "Y"], [0x0100, "LB"], [0x0200, "RB"],
  [0x0020, "Back"], [0x0010, "Start"], [0x0040, "Left stick click"], [0x0080, "Right stick click"],
  [0x0001, "D-pad up"], [0x0002, "D-pad down"], [0x0004, "D-pad left"], [0x0008, "D-pad right"],
];

export interface Row { label: string; sent: string; read: string; ok: boolean }

/** One row per button and axis: what NEXUS sent next to what Windows reads. */
export function rowsFor(sent: XInputPad, read: XInputPad): Row[] {
  const rows: Row[] = XBUTTONS.map(([bit, label]) => {
    const s = (sent.buttons & bit) !== 0, r = (read.buttons & bit) !== 0;
    return { label, sent: s ? "pressed" : "–", read: r ? "pressed" : "–", ok: s === r };
  });
  const axes: Array<[string, number, number]> = [
    ["LT", sent.leftTrigger, read.leftTrigger], ["RT", sent.rightTrigger, read.rightTrigger],
    ["Left stick X", sent.thumbLx, read.thumbLx], ["Left stick Y", sent.thumbLy, read.thumbLy],
    ["Right stick X", sent.thumbRx, read.thumbRx], ["Right stick Y", sent.thumbRy, read.thumbRy],
  ];
  for (const [label, s, r] of axes) rows.push({ label, sent: String(s), read: String(r), ok: s === r });
  return rows;
}

export type Tone = "ok" | "warn" | "bad" | "idle";

/** Headline for a check result. */
export function describeCheck(c: OutputCheck): { tone: Tone; title: string; detail: string } {
  switch (c.state) {
    case "noController":
      return { tone: "idle", title: "No controller", detail: "Connect the DualSense to check what reaches Windows." };
    case "notXbox":
      return { tone: "idle", title: "Virtual Xbox 360 controller not active",
        detail: "Turn on the virtual controller (Xbox 360) under Controller › Virtual Output. Only the Xbox 360 controller can be read back through XInput." };
    case "slotUnknown":
      return { tone: "warn", title: "Waiting for Windows", detail: "The virtual controller exists but Windows hasn't reported its player slot yet." };
    case "unavailable":
      return { tone: "warn", title: "Can't read XInput", detail: c.reason };
    case "missing":
      return { tone: "bad", title: `Windows shows no controller in player ${c.slot + 1}`,
        detail: "The virtual controller was created but Windows doesn't list it. Turn the output off and on; if that doesn't help, restart Windows or reinstall ViGEmBus." };
    case "compared":
      return c.differences.length === 0
        ? { tone: "ok", title: `Windows receives exactly what NEXUS sends (player ${c.slot + 1})`, detail: "Every button, trigger and stick value matches." }
        : { tone: "warn", title: `${c.differences.length} difference${c.differences.length > 1 ? "s" : ""} right now`,
          detail: "While a button or stick is moving, a reading can be one update behind. Hold the input still: a difference that stays is real." };
  }
}

/**
 * Consecutive matching reads, for a stable verdict: a single mismatch while
 * input is changing is expected (the two reads aren't at the same instant).
 */
export function nextStreak(prev: { matches: number; mismatches: number }, c: OutputCheck): { matches: number; mismatches: number } {
  if (c.state !== "compared") return { matches: 0, mismatches: 0 };
  return c.differences.length === 0 ? { matches: prev.matches + 1, mismatches: 0 } : { matches: 0, mismatches: prev.mismatches + 1 };
}

/** "0.4 µs", "135 ns", "1.2 ms". */
export function formatNs(ns: number): string {
  if (!Number.isFinite(ns) || ns < 0) return "—";
  if (ns < 1000) return `${Math.round(ns)} ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(ns < 10_000 ? 1 : 0)} µs`;
  return `${(ns / 1_000_000).toFixed(1)} ms`;
}

export function stageText(s: StageSummary): string {
  return s.samples ? `${formatNs(s.p50Ns)} / ${formatNs(s.p99Ns)} / ${formatNs(s.maxNs)}` : "—";
}
