// "Ready to play" checklist (Dashboard and first launch): what stands between
// the user and a game seeing NEXUS, and what to do about each problem.
// Pure, so every state and its advice is tested.

import type { DeviceSnapshot, EngineStatus } from "../types/engine";

export const VIGEMBUS_RELEASES = "https://github.com/nefarius/ViGEmBus/releases";

export type StepState = "done" | "todo" | "problem" | "waiting" | "optional";

export interface ReadyStep {
  id: "controller" | "driver" | "output" | "games" | "doubleInput";
  title: string;
  state: StepState;
  /** What is going on, or what to do about it. */
  detail: string;
  action?: { label: string; page: string; tab?: string } | { label: string; url: string };
}

export interface ReadinessInput {
  status: EngineStatus | null;
  device: DeviceSnapshot | null;
  /** Controller phase key from useControllerPhase ("live", "awaiting", "stale", …). */
  phase: string;
  /** The experimental virtual-output switch; null while unknown. */
  consent: boolean | null;
}

const OUTPUT_TAB = { page: "controller", tab: "output" } as const;

function controllerStep({ status, device, phase }: ReadinessInput): ReadyStep {
  const title = "DualSense connected by USB";
  if (!status) return { id: "controller", title, state: "waiting", detail: "Starting the controller engine…" };
  if (!device) {
    return {
      id: "controller", title, state: "todo",
      detail: status.enumerationError
        ? `Windows reported: ${status.enumerationError}. Reconnect the controller, then Settings › Scan now.`
        : "Plug the DualSense into a USB port on the PC with a USB-C data cable (charge-only cables don't work). "
          + "If it doesn't appear, close Steam, DS4Windows or other controller tools and try another port.",
      action: { label: "Scan settings", page: "settings" },
    };
  }
  if (device.device.connection === "bluetooth") {
    return { id: "controller", title, state: "problem", detail: "NEXUS works over USB only. Connect the controller with a USB-C data cable." };
  }
  if (phase === "awaiting") {
    return { id: "controller", title, state: "waiting", detail: "Connected, waiting for the first input. If this lasts more than a few seconds, unplug and reconnect it." };
  }
  if (phase === "stale") {
    return {
      id: "controller", title, state: "problem",
      detail: "The controller stopped sending input. Unplug it and plug it into another USB port (not a hub). Games keep a neutral controller meanwhile; nothing stays pressed.",
    };
  }
  return { id: "controller", title, state: "done", detail: "Receiving live input." };
}

function driverStep({ status }: ReadinessInput): ReadyStep {
  const title = "ViGEmBus driver installed";
  if (!status) return { id: "driver", title, state: "waiting", detail: "Checking…" };
  const backend = status.outputBackendStatus;
  if (backend.state === "ready") return { id: "driver", title, state: "done", detail: "Installed and ready." };
  if (status.drivers.vigembus === "installed") {
    return {
      id: "driver", title, state: "problem",
      detail: `Installed, but NEXUS can't use it: ${backend.reason} Restart Windows; if it persists, reinstall ViGEmBus 1.22.`,
      action: { label: "Check again", ...OUTPUT_TAB },
    };
  }
  return {
    id: "driver", title, state: "todo",
    detail: "Games only see NEXUS through this free driver. Install ViGEmBus 1.22 from its official page (NEXUS never installs drivers itself), then press Check again.",
    action: { label: "Get ViGEmBus", url: VIGEMBUS_RELEASES },
  };
}

function outputStep({ status, consent }: ReadinessInput): ReadyStep {
  const title = "Virtual Xbox 360 controller turned on";
  if (!status || consent === null) return { id: "output", title, state: "waiting", detail: "Checking…" };
  if (consent && status.requestedOutput === "xbox360") return { id: "output", title, state: "done", detail: "On (Xbox 360)." };
  return {
    id: "output", title, state: "todo",
    detail: "Turn on Use the experimental virtual controller and choose Xbox 360.",
    action: { label: "Open Virtual Output", ...OUTPUT_TAB },
  };
}

function gamesStep(i: ReadinessInput, ready: boolean): ReadyStep {
  const title = "Games can see it";
  const out = i.device?.output;
  if (!ready) return { id: "games", title, state: "waiting", detail: "Finish the steps above first." };
  if (out?.active) {
    const slot = out.playerIndex;
    if (slot === null || slot === 0) {
      return { id: "games", title, state: "done", detail: "Connected as player 1. Live Viewer › Output Check confirms what games receive.", action: { label: "Output Check", page: "live-viewer", tab: "output" } };
    }
    return {
      id: "games", title, state: "problem",
      detail: `Connected as player ${slot + 1}: another Xbox-type controller holds player 1. Many games only listen to player 1. Unplug the other controller, then turn the virtual output off and on.`,
      action: { label: "Open Virtual Output", ...OUTPUT_TAB },
    };
  }
  if (out?.retrying) {
    return {
      id: "games", title, state: "problem",
      detail: "The virtual controller stopped working; NEXUS is creating it again by itself. If this keeps happening, restart Windows or reinstall ViGEmBus 1.22.",
    };
  }
  return {
    id: "games", title, state: "problem",
    detail: out?.lastError ? `Not connected: ${out.lastError}` : "Not connected yet. Turn the virtual output off and on in Controller › Virtual Output.",
    action: { label: "Open Virtual Output", ...OUTPUT_TAB },
  };
}

function doubleInputStep({ status }: ReadinessInput): ReadyStep {
  const title = "Double input prevention (optional)";
  if (status?.drivers.hidhide === "installed") {
    return { id: "doubleInput", title, state: "done", detail: "HidHide is installed. Make sure NEXUS is on its Applications list." };
  }
  return {
    id: "doubleInput", title, state: "optional",
    detail: "If a game (or Steam) reacts twice to one press, turn off its PlayStation controller support or set up HidHide.",
    action: { label: "How to", page: "controller", tab: "output" },
  };
}

/** The checklist, top to bottom. */
export function readinessSteps(i: ReadinessInput): ReadyStep[] {
  const steps = [controllerStep(i), driverStep(i), outputStep(i)];
  const ready = steps.every((s) => s.state === "done");
  return [...steps, gamesStep(i, ready), doubleInputStep(i)];
}

/** Everything a game needs is in place (the optional step doesn't count). */
export function readyToPlay(steps: ReadyStep[]): boolean {
  return steps.filter((s) => s.state !== "optional" && s.id !== "doubleInput").every((s) => s.state === "done");
}
