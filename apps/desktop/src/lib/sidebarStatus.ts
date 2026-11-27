// The sidebar's always-visible virtual controller line. Pure, tested.

import type { DeviceSnapshot, EngineStatus } from "../types/engine";

export interface OutputLine { label: string; tone: "ok" | "warn" | "error" | "idle"; tip: string }

/** `engine`: the connection to the controller engine (no status yet means starting, or no engine at all). */
export function outputLine(status: EngineStatus | null, device: DeviceSnapshot | null,
  engine: "loading" | "ready" | "unavailable" | "error" = "ready"): OutputLine {
  if (engine === "unavailable") return { label: "Xbox output: unavailable", tone: "idle", tip: "The controller engine runs only in the NEXUS desktop app." };
  if (engine === "error") return { label: "Xbox output: unknown", tone: "error", tip: "Could not reach the controller engine." };
  if (!status) return { label: "Xbox output: starting…", tone: "idle", tip: "Connecting to the controller engine." };
  if (status.requestedOutput === "disabled") {
    return { label: "Xbox output: off", tone: "idle", tip: "Games don't see NEXUS. Turn it on on the Virtual Controller page." };
  }
  if (status.outputBackendStatus.state !== "ready") {
    return { label: "Xbox output: no driver", tone: "error", tip: "ViGEmBus isn't available. See the Dashboard checklist." };
  }
  const out = device?.output;
  if (!device) return { label: "Xbox output: waiting", tone: "idle", tip: "Connect a DualSense or DualShock 4 by USB." };
  if (out?.active) {
    const p = out.playerIndex;
    if (p != null && p > 0) return { label: `Xbox output: player ${p + 1}`, tone: "warn", tip: "Another controller holds player 1; many games only listen to player 1." };
    return { label: "Xbox output: on", tone: "ok", tip: "Games see NEXUS as an Xbox 360 controller." };
  }
  if (out?.retrying) return { label: "Xbox output: reconnecting", tone: "warn", tip: "The virtual controller stopped working; NEXUS is creating it again." };
  return { label: "Xbox output: not connected", tone: "error", tip: out?.lastError ?? "See the Dashboard checklist." };
}
