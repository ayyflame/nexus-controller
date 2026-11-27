// Performance page: real measurements arranged by where the time goes
// (controller reports → processing → virtual-controller submission), plus
// plain findings with something to do about them. Pure helpers, unit-tested.
// A value NEXUS doesn't have is labelled as such, never shown as 0.

import type { DeviceSnapshot, EngineStatus, LatencySummary, StageSummary } from "../types/engine";
import { freshness, reportAge } from "./diagHealth.ts";
import { formatNs } from "./outputCheck.ts";

export const DIST_COLUMNS = ["Average", "Median", "95th %", "99th %", "Max"] as const;

/** One distribution row: five cells, or why there are none. */
export type Dist = { cells: string[]; missing: null } | { cells: null; missing: string };

const cellsNs = (v: Array<number | undefined>): string[] => v.map((x) => (x === undefined ? "n/a" : formatNs(x)));

/** A stage timing (nanoseconds). `idle` names why there are no samples yet. */
export function stageDist(s: StageSummary | undefined, idle: string): Dist {
  if (!s) return { cells: null, missing: "Not reported by this engine build" };
  if (!s.samples) return { cells: null, missing: idle };
  return { cells: cellsNs([s.meanNs, s.p50Ns, s.p95Ns, s.p99Ns, s.maxNs]), missing: null };
}

/** A microsecond distribution (processing time, time between reports or frames). */
export function usDist(s: LatencySummary | undefined, idle: string): Dist {
  if (!s) return { cells: null, missing: "Not reported by this engine build" };
  if (!s.samples) return { cells: null, missing: idle };
  return { cells: [s.meanUs, s.p50Us, s.p95Us, s.p99Us, s.maxUs].map((x) => (x === undefined ? "n/a" : formatUs(x))), missing: null };
}

/** Microseconds: "46 µs" below a millisecond, "4.01 ms" (two decimals, for report spacing) above. */
export function formatUs(us: number): string {
  return us < 1000 ? formatNs(us * 1000) : `${(us / 1000).toFixed(2)} ms`;
}

export type FindingTone = "ok" | "warn" | "error";
export interface Finding {
  id: string;
  tone: FindingTone;
  title: string;
  detail: string;
  /** Where to go about it, if anywhere. */
  action?: { label: string; page: string; tab?: string };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * What in the measurements needs attention, worst first. Each finding says
 * what was measured and what can be done; nothing is guessed.
 */
export function performanceFindings(d: DeviceSnapshot, status: EngineStatus | null, nowMs: number): Finding[] {
  const out: Finding[] = [];
  const age = reportAge(d.lastReportMs, nowMs);
  const f = freshness(age);
  if (f === "none") {
    out.push({ id: "no-input", tone: "warn", title: "No input report yet",
      detail: "The controller is open but hasn't sent a readable report. Unplug it and plug it back in; if that doesn't help, try another USB port." });
  } else if (f === "stale") {
    out.push({ id: "stale", tone: "error", title: `No input for ${((age ?? 0) / 1000).toFixed(1)} s`,
      detail: "The controller stopped sending. Check the cable, then unplug it and plug it back in. The values below are the last ones received." });
  }
  const o = d.output;
  if (o.lastError) {
    out.push({ id: "output-error", tone: "error", title: "The virtual controller reported an error", detail: o.lastError,
      action: { label: "Open Virtual Controller", page: "virtual-controller" } });
  } else if (o.requested !== "disabled" && !o.active && status && status.outputBackendStatus.state !== "ready") {
    out.push({ id: "output-driver", tone: "warn", title: "Virtual controller not running",
      detail: `${status.outputBackendStatus.reason} Games don't receive NEXUS's output until the driver answers.`,
      action: { label: "Open Virtual Controller", page: "virtual-controller" } });
  }
  if (o.active && o.playerIndex !== null && o.playerIndex > 0) {
    out.push({ id: "slot", tone: "warn", title: `The virtual controller is player ${o.playerIndex + 1}`,
      detail: "Another Xbox-type controller holds player 1. Games that only listen to player 1 won't react to NEXUS." ,
      action: { label: "Open Virtual Controller", page: "virtual-controller" } });
  }
  const slow = d.stageLatency?.slowOutput;
  if (o.active && slow && slow.over50ms > 0) {
    out.push({ id: "slow-50", tone: "error", title: `${plural(slow.over50ms, "driver call")} took over 50 ms`,
      detail: `A stall you could notice in a game (longest ${formatNs(slow.longestNs)}). The time is spent inside the ViGEmBus driver call, after NEXUS's own processing. Live Viewer › Output Check confirms what Windows receives.`,
      action: { label: "Open Output Check", page: "live-viewer", tab: "output" } });
  } else if (o.active && slow && slow.over4ms > 0) {
    out.push({ id: "slow-4", tone: "warn", title: `${plural(slow.over4ms, "driver call")} took over 4 ms`,
      detail: `Each one held up the next report (longest ${formatNs(slow.longestNs)}). Occasional ones are harmless; many in a row mean the driver or Windows is busy.` });
  }
  if (d.reportIntervals.over50ms > 0) {
    out.push({ id: "gaps-50", tone: "warn", title: `The controller paused over 50 ms ${plural(d.reportIntervals.over50ms, "time")}`,
      detail: "These gaps happen before NEXUS: in the controller, the USB connection or Windows. Plug the controller straight into the PC rather than a hub, and try another port." });
  }
  if (d.parseErrors > 0) {
    out.push({ id: "parse", tone: "warn", title: `${plural(d.parseErrors, "unreadable report")}`,
      detail: `${d.lastParseError ? `Last one: ${d.lastParseError}. ` : ""}Use Copy diagnostics at the top of this page and include the report when you report this.` });
  }
  const flow = d.flow;
  if (flow && flow.longestBacklog > 1) {
    out.push({ id: "backlog", tone: "warn", title: `NEXUS fell behind the controller (up to ${plural(flow.longestBacklog, "report")} in a row)`,
      detail: "Reports were already waiting when NEXUS asked for the next one. This usually follows slow driver calls; NEXUS then skips the stale reports and sends only the newest." });
  }
  if (d.sequenceGaps > 0) {
    out.push({ id: "dropped", tone: "warn", title: `About ${plural(d.sequenceGaps, "report")} dropped (estimate)`,
      detail: "Counted from gaps in the controller's own report counter, before NEXUS reads them: a cable, USB port or Windows issue rather than NEXUS." });
  }
  return out;
}

/** The single headline for the findings tile. */
export function findingsHeadline(list: Finding[]): { tone: FindingTone; value: string; sub: string } {
  if (list.length === 0) return { tone: "ok", value: "Nothing to fix", sub: "No problem in the measured values" };
  const worst: FindingTone = list.some((x) => x.tone === "error") ? "error" : "warn";
  return { tone: worst, value: `${list.length} to check`, sub: list[0]!.title };
}

/** "250 reports/s" or why there's no rate. */
export function rateText(d: DeviceSnapshot): string {
  if (d.lastReportMs === null) return "No reports yet";
  return `${d.reportRateHz.toFixed(0)} reports/s`;
}
