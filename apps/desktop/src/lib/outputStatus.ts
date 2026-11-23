// One place that turns the engine's virtual-controller status into the words
// shown on the Dashboard and the Virtual Output tab.

import type { OutputStatus, VirtualOutputKind } from "../types/engine";

export interface OutputSummary {
  tone: "ok" | "warn" | "neutral";
  /** Short state, e.g. "Xbox 360 connected". */
  text: string;
  /** One more line of explanation, when useful. */
  detail: string | null;
}

const KIND: Record<VirtualOutputKind, string> = { disabled: "Off", xbox360: "Xbox 360", dualShock4: "DualShock 4" };

export function outputSummary(o: {
  /** The connected controller's output status; null when no controller is connected. */
  output: OutputStatus | null;
  requested: VirtualOutputKind;
  /** The experimental-output switch; null while unknown. */
  consent: boolean | null;
  driverReady: boolean;
}): OutputSummary {
  const out = o.output;
  if (out?.active) {
    const slot = out.playerIndex ?? null;
    if (slot === null) return { tone: "ok", text: `${KIND[out.active]} connected`, detail: null };
    if (slot === 0) return { tone: "ok", text: `${KIND[out.active]} connected`, detail: "Games see it as player 1." };
    return {
      tone: "warn",
      text: `${KIND[out.active]} connected as player ${slot + 1}`,
      detail: `Another Xbox-type controller holds player ${slot === 1 ? "1" : `1–${slot}`}. Games that only listen to player 1 won't react to NEXUS: unplug the other controller, then turn this output off and on again.`,
    };
  }
  if (o.consent === false) return { tone: "neutral", text: "Off", detail: null };
  if (o.requested === "disabled") return { tone: "neutral", text: "Turned off", detail: null };
  if (out?.retrying) {
    return { tone: "warn", text: "Reconnecting…", detail: "The virtual controller stopped working. NEXUS is creating it again by itself." };
  }
  if (!out) return { tone: "neutral", text: "Waiting for your controller (USB)", detail: null };
  if (!o.driverReady) return { tone: "neutral", text: "Waiting for ViGEmBus", detail: null };
  return { tone: "neutral", text: "Not connected", detail: null };
}
