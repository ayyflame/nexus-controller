import { useEffect, useState, type ReactNode } from "react";
import { useEngine } from "../hooks/useEngine";

export type Tone = "ok" | "warn" | "error" | "idle";

export interface ControllerPhase {
  key: "browser" | "loading" | "error" | "unsupported" | "disconnected" | "awaiting" | "stale" | "live";
  label: string;
  detail: string;
  tone: Tone;
}

/** A controller is treated as silent if no report arrived for this long. */
const STALE_MS = 1500;

/** Re-renders periodically so staleness is noticed even without new data. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Single source of truth for "is a controller really connected and live". */
export function useControllerPhase(): ControllerPhase {
  const { connection, status } = useEngine();
  const now = useNow(500);

  if (connection.kind === "unavailable")
    return { key: "browser", label: "Engine offline", tone: "idle",
      detail: "The UI is running outside the NEXUS desktop shell, so no controller engine is available." };
  if (connection.kind === "loading" || !status)
    return { key: "loading", label: "Starting…", tone: "idle", detail: "Connecting to the controller engine." };
  if (connection.kind === "error")
    return { key: "error", label: "Engine error", tone: "error", detail: connection.message };
  if (!status.hidAvailable)
    return { key: "unsupported", label: "Unsupported OS", tone: "error",
      detail: status.enumerationError ?? "HID access is not available on this platform." };

  const d = status.devices[0];
  if (!d)
    return { key: "disconnected", label: "No controller", tone: "idle",
      detail: status.enumerationError ?? "Connect a DualSense by USB or Bluetooth. NEXUS will detect it automatically." };
  if (!d.input || d.lastReportMs === null)
    return { key: "awaiting", label: "Awaiting input", tone: "warn",
      detail: "The controller is open but no valid input report has been received yet." };
  if (now - d.lastReportMs > STALE_MS)
    return { key: "stale", label: "No input", tone: "warn",
      detail: "The controller is connected but has stopped sending input reports." };
  return { key: "live", label: "Connected", tone: "ok", detail: "Receiving live input." };
}

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`pill tone-${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
