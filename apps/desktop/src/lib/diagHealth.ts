// Connection and input health, from values the engine measures. Each item
// says whether it is measured, reported by the controller, or an estimate.

import type { BatteryState, DeviceSnapshot } from "../types/engine";

export type Source = "measured" | "reported" | "estimate";

/** Over USB a DualSense sends a report about every 4 ms, also when idle. */
export const STALE_MS = 250;
export const SLOW_MS = 40;

export type Freshness = "live" | "slow" | "stale" | "none";

export function reportAge(lastReportMs: number | null, nowMs: number): number | null {
  return lastReportMs === null ? null : Math.max(0, nowMs - lastReportMs);
}

export function freshness(ageMs: number | null): Freshness {
  if (ageMs === null) return "none";
  if (ageMs > STALE_MS) return "stale";
  if (ageMs > SLOW_MS) return "slow";
  return "live";
}

export function freshnessText(f: Freshness, ageMs: number | null): string {
  switch (f) {
    case "none": return "No input report received yet";
    case "stale": return `No input for ${((ageMs ?? 0) / 1000).toFixed(1)} s: the controller has stopped sending`;
    case "slow": return `Last report ${Math.round(ageMs ?? 0)} ms ago (slower than usual)`;
    case "live": return "Receiving input";
  }
}

export function batteryText(b: BatteryState | null): string {
  if (!b) return "Not reported in this controller's reports";
  switch (b.status) {
    case "charging": return `About ${b.percent} %, charging`;
    case "full": return "Full (charging complete)";
    case "discharging": return `About ${b.percent} %`;
    case "error": return "The controller reports a battery error";
    default: return "Reported, but the state is unknown";
  }
}

export interface HealthItem { label: string; value: string; source: Source; warn?: boolean }

export function healthItems(d: DeviceSnapshot, nowMs: number): HealthItem[] {
  const age = reportAge(d.lastReportMs, nowMs);
  const f = freshness(age);
  const i = d.reportIntervals;
  const ms = (us: number) => `${(us / 1000).toFixed(2)} ms`;
  return [
    { label: "Input", value: freshnessText(f, age), source: "measured", warn: f === "stale" || f === "none" },
    { label: "Report rate", value: `${d.reportRateHz.toFixed(0)} reports/s`, source: "measured", warn: d.reportRateHz > 0 && d.reportRateHz < 200 },
    { label: "Reports received", value: d.totalReports.toLocaleString("en-US"), source: "measured" },
    { label: "Unreadable reports", value: String(d.parseErrors), source: "measured", warn: d.parseErrors > 0 },
    { label: "Dropped reports", value: String(d.sequenceGaps), source: "estimate", warn: d.sequenceGaps > 0 },
    { label: "Time between reports", value: i.intervals > 0 ? `${ms(i.minUs)} / ${ms(i.meanUs)} / ${ms(i.maxUs)} (min / avg / max)` : "—", source: "measured" },
    { label: "Late reports (> 8 ms / > 50 ms)", value: `${i.over8ms} / ${i.over50ms}`, source: "measured", warn: i.over50ms > 0 },
    { label: "NEXUS processing time", value: d.pipelineLatency.samples > 0 ? `${d.pipelineLatency.p50Us} / ${d.pipelineLatency.p99Us} / ${d.pipelineLatency.maxUs} µs (median / 99 % / max, last ~1 s)` : "—", source: "measured" },
    { label: "Battery", value: batteryText(d.input?.battery ?? null), source: "reported" },
  ];
}
