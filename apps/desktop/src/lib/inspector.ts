// Report Inspector types (mirror crates/engine/src/inspector.rs and
// controller-core HidInterfaceDetails) and pure display helpers.

export type Verdict =
  | { kind: "noChange" }
  | { kind: "decodedButtons"; buttons: string[] }
  | { kind: "undecodedBits"; locations: string[] }
  | { kind: "analogOnly" }
  | { kind: "unexpectedFormat" };

export interface ByteChange {
  index: number; field: string; fieldKind: "input" | "varying" | "unknown";
  baseline: number; setBits: number; clearedBits: number; undecodedBits: number;
  reportsChanged: number; valuesSeen: number[]; decoded: string[]; hints: string[];
}

export interface Analysis {
  baselineReports: number; actionReports: number; reportLen: number; noisyBytes: number[];
  changes: ByteChange[]; verdict: Verdict; summary: string; notes: string[];
  /** Bytes that changed but are timestamps, counters, motion or battery data: never input. */
  ignoredBytes?: number[];
}

export interface LabeledCapture {
  label: string;
  capture: { deviceId: string; vendorId: number; productId: number; durationMs: number };
  analysis: Analysis;
}

export interface InspectorView {
  deviceId: string | null;
  productId: number | null;
  baseline: { reports: number; durationMs: number; referenceHex: string; noisyBytes: number[] } | null;
  captures: LabeledCapture[];
}

export interface HidUsageRange { usagePage: number; usageMin: number; usageMax: number; reportId: number; bitSize: number; reportCount: number }

export interface HidInterfaceDetails {
  path: string; vendorId: number; productId: number; usagePage: number; usage: number;
  inputReportLen: number; outputReportLen: number; featureReportLen: number;
  product: string | null; manufacturer: string | null; instanceId: string | null;
  inputButtons: HidUsageRange[]; inputValues: HidUsageRange[]; capsUnavailable: boolean;
}

export const BASELINE_MS = 2000;
export const ACTION_MS = 3000;
export const PRESET_LABELS = ["Left paddle", "Right paddle", "Both paddles", "Cross (reference)"];

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** Bit numbers (0 = least significant) set in `mask`. */
export function maskBits(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].filter((b) => mask & (1 << b));
}

/** "0x40 (bit 6)" or "0x41 (bits 0, 6)". */
export function describeMask(mask: number): string {
  if (!mask) return "—";
  const bits = maskBits(mask);
  return `0x${hex2(mask)} (bit${bits.length > 1 ? "s" : ""} ${bits.join(", ")})`;
}

export function byteValue(n: number): string {
  return `0x${hex2(n)}`;
}

export function verdictBadge(v: Verdict): { tone: "warn" | "ok" | "neutral"; text: string } {
  switch (v.kind) {
    case "undecodedBits": return { tone: "warn", text: "Possible independent input" };
    case "decodedButtons": return { tone: "neutral", text: `Reported as ${v.buttons.join(" + ")} (mapped button)` };
    case "analogOnly": return { tone: "neutral", text: "Sticks / triggers / touch only" };
    case "unexpectedFormat": return { tone: "warn", text: "Unexpected report format" };
    case "noChange": return { tone: "neutral", text: "No change in the report" };
  }
}

export function usageLabel(page: number, usage: number): string {
  if (page === 0x01 && usage === 0x05) return "Gamepad";
  if (page === 0x01 && usage === 0x04) return "Joystick";
  if (page === 0x01 && usage === 0x06) return "Keyboard";
  if (page === 0x01 && usage === 0x02) return "Mouse";
  if (page === 0x0c) return "Consumer control";
  if (page >= 0xff00) return "Vendor-defined";
  return `Usage ${hex4(page)}:${hex4(usage)}`;
}

/** "Buttons 1–15 (page 0009)" style summary of declared button ranges. */
export function describeButtons(ranges: HidUsageRange[]): string {
  if (!ranges.length) return "none declared";
  return ranges
    .map((r) => {
      const n = r.usageMax - r.usageMin + 1;
      const page = r.usagePage === 0x09 ? "" : ` page ${hex4(r.usagePage)}`;
      return `${r.usageMin === r.usageMax ? r.usageMin : `${r.usageMin}–${r.usageMax}`} (${n} button${n === 1 ? "" : "s"}${page}${r.reportId ? `, report ${hex2(r.reportId)}` : ""})`;
    })
    .join("; ");
}

export function totalButtons(ranges: HidUsageRange[]): number {
  return ranges.filter((r) => r.usagePage === 0x09).reduce((a, r) => a + (r.usageMax - r.usageMin + 1), 0);
}
