// Virtual Controller page: what each output choice means right now, the
// driver and HidHide lines, and the technical facts split by where they come
// from. Pure helpers, unit-tested; every value comes from the engine status.

import type { DeviceSnapshot, DriverPresence, EngineStatus, VirtualOutputKind } from "../types/engine";
import { formatNs } from "./outputCheck.ts";

export type OptionState = "active" | "selected" | "available" | "unavailable";
export type Tone = "ok" | "warn" | "error" | "idle";

export interface OutputOption {
  kind: VirtualOutputKind;
  label: string;
  /** What choosing it does, in one line. */
  description: string;
  /** True for the profile's choice (the checked radio). */
  checked: boolean;
  /** False when it can't be chosen now; `reason` says why. */
  available: boolean;
  reason: string | null;
  /** The one state shown on the option's badge. */
  state: OptionState;
}

export const OUTPUT_KINDS: VirtualOutputKind[] = ["disabled", "xbox360", "dualShock4"];

/** Output names as this page shows them ("Off" rather than "Disabled"). */
export const OUTPUT_LABEL: Record<VirtualOutputKind, string> = { disabled: "Off", xbox360: "Xbox 360", dualShock4: "DualShock 4" };
const DESCRIPTION: Record<VirtualOutputKind, string> = {
  disabled: "Games see only your physical controller, without NEXUS's mapping or macros.",
  xbox360: "Games see a virtual Xbox 360 controller with your mapping, stick settings and macros.",
  dualShock4: "A virtual DualShock 4 for games that need PlayStation input.",
};

export const STATE_LABEL: Record<OptionState, string> = {
  active: "Active", selected: "Selected", available: "Available", unavailable: "Unavailable",
};

/**
 * The three output choices. "Active" only when Windows has the virtual
 * controller of that kind now; "Selected" when it is the profile's choice but
 * not (yet) running. DualShock 4 output doesn't exist in this version.
 */
export function outputOptions(o: {
  requested: VirtualOutputKind;
  active: VirtualOutputKind | null;
  /** The experimental-output switch; null while unknown. */
  consent: boolean | null;
  /** The engine answers commands. */
  ready: boolean;
}): OutputOption[] {
  return OUTPUT_KINDS.map((kind) => {
    const checked = o.requested === kind;
    let reason: string | null = null;
    if (kind === "dualShock4") reason = "Not available in this version: NEXUS can create only an Xbox 360 controller.";
    else if (!o.ready) reason = "The controller engine isn't running.";
    else if (kind !== "disabled" && o.consent !== true) reason = "Turn on the experimental virtual controller first.";
    const available = reason === null;
    const state: OptionState = kind !== "disabled" && o.active === kind ? "active"
      : checked ? "selected" : available ? "available" : "unavailable";
    return { kind, label: OUTPUT_LABEL[kind], description: DESCRIPTION[kind], checked, available, reason, state };
  });
}

/** Next option for arrow-key movement in the radio group, skipping unavailable ones. */
export function nextOption(options: OutputOption[], from: VirtualOutputKind, step: 1 | -1): VirtualOutputKind {
  const usable = options.filter((x) => x.available || x.kind === from);
  if (usable.length === 0) return from;
  const i = usable.findIndex((x) => x.kind === from);
  const n = (Math.max(0, i) + step + usable.length) % usable.length;
  return usable[n]!.kind;
}

export interface Line {
  tone: Tone; value: string; detail: string;
  /** The detail in a few words, for a status tile. */
  short: string;
}

/** ViGEmBus, the driver the virtual controller needs. */
export function vigemLine(status: EngineStatus | null): Line {
  if (!status) return { tone: "idle", value: "Unknown", detail: "Waiting for the controller engine.", short: "Waiting for the engine" };
  if (status.outputBackendStatus.state === "ready") {
    const v = status.outputBackendStatus.version;
    return { tone: "ok", value: "Ready", detail: v ? `ViGEmBus ${v} is installed and answering.` : "Installed and answering.", short: "Installed and answering" };
  }
  switch (status.drivers.vigembus) {
    case "installed": return { tone: "warn", value: "Not answering", detail: status.outputBackendStatus.reason, short: "Installed, but not answering" };
    case "notInstalled": return { tone: "error", value: "Not installed", detail: "Needed for the virtual controller. Install it below.", short: "Needed for the virtual controller" };
    default: return { tone: "idle", value: "Unknown", detail: "Drivers can be checked only on Windows.", short: "Checked only on Windows" };
  }
}

/**
 * HidHide. NEXUS only knows whether HidHide is installed, never whether your
 * controller is hidden, so this never says it is.
 */
export function hidHideLine(o: { hidhide: DriverPresence | undefined; outputActive: boolean }): Line {
  switch (o.hidhide) {
    case "installed":
      return { tone: "idle", value: "Installed", detail: "NEXUS can't see whether your controller is hidden. Check it in HidHide's own app.", short: "Hiding is set in HidHide" };
    case "notInstalled":
      return o.outputActive
        ? { tone: "warn", value: "Not installed", detail: "Games may see your controller and the virtual one, so a press can count twice.", short: "A press may count twice" }
        : { tone: "idle", value: "Not installed", detail: "Optional. Only matters while the virtual controller is on.", short: "Optional" };
    default:
      return { tone: "idle", value: "Unknown", detail: "Drivers can be checked only on Windows.", short: "Checked only on Windows" };
  }
}

export type FactSource = "measured" | "reported" | "estimate";
export interface Fact { label: string; value: string; source: FactSource; hint?: string }

/**
 * Technical details for the Virtual Controller page, grouped by source:
 * measured by NEXUS, reported by Windows or the driver, or estimated.
 * A value that isn't available says so instead of showing 0.
 */
export function technicalFacts(device: DeviceSnapshot | null, status: EngineStatus | null): Fact[] {
  const facts: Fact[] = [];
  const out = device?.output ?? null;
  const backend = status?.outputBackendStatus;
  const name = status?.outputBackend;
  facts.push({ label: "Output backend", value: !name ? "Unknown" : name === "none" ? "None on this system" : name, source: "reported" });
  facts.push({ label: "Driver version", value: backend?.state === "ready" ? backend.version ?? "Not reported by the driver" : "Driver not answering", source: "reported" });
  facts.push({ label: "Player slot (XInput)", value: !out?.active ? "No virtual controller" : out.playerIndex === null ? "Not reported yet" : `Player ${out.playerIndex + 1}`, source: "reported" });
  if (!device) {
    facts.push({ label: "Frames sent to the virtual controller", value: "No controller connected", source: "measured" });
    return facts;
  }
  const flow = device.flow;
  facts.push({
    label: "Frames sent to the virtual controller", source: "measured",
    value: !flow ? "Not reported by this engine build" : out?.active ? flow.outputs.toLocaleString("en-US") : "None (virtual controller off)",
  });
  const call = device.stageLatency?.output;
  facts.push({
    label: "Driver call time, median / 99th percentile", source: "measured",
    hint: "How long handing one frame to ViGEmBus takes, over about the last second.",
    value: !call ? "Not reported by this engine build" : !out?.active ? "No virtual controller" : call.samples === 0 ? "No frames sent yet" : `${formatNs(call.p50Ns)} / ${formatNs(call.p99Ns)}`,
  });
  const slow = device.stageLatency?.slowOutput;
  facts.push({
    label: "Slow driver calls (over 4 ms / over 50 ms)", source: "measured",
    value: !slow ? "Not reported by this engine build" : !out?.active ? "No virtual controller" : slow.calls === 0 ? "No frames sent yet" : `${slow.over4ms} / ${slow.over50ms}`,
  });
  facts.push({
    label: "Dropped input reports", source: "estimate",
    hint: "Counted from gaps in the controller's own report counter, so it is an estimate.",
    value: device.input ? device.sequenceGaps.toLocaleString("en-US") : "No input yet",
  });
  return facts;
}
