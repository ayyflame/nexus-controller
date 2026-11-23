import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { engineApi, errorMessage, isDesktopShell } from "../lib/engine";
import type { AppInfo, ControllerModel, DeviceEvent, EngineStatus, Profile } from "../types/engine";

export interface TimedDeviceEvent { at: number; event: DeviceEvent }

export type EngineConnection =
  /** Running in a plain browser: no engine exists, nothing is shown as live. */
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

interface EngineContextValue {
  connection: EngineConnection;
  status: EngineStatus | null;
  appInfo: AppInfo | null;
  profile: Profile | null;
  deviceEvents: TimedDeviceEvent[];
  setProfile: (p: Profile) => void;
  /** Controller shown on Dashboard / Controller pages (multi-controller). */
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
}

const EngineContext = createContext<EngineContextValue | null>(null);
/**
 * The model of the controller the UI focuses on, alone: it changes only when
 * a different kind of controller is connected, so pictures and labels that
 * depend on it don't re-render on every status update.
 */
const ConnectedModelContext = createContext<ControllerModel | null>(null);
const MAX_EVENTS = 50;

export function EngineProvider({ children }: { children: ReactNode }) {
  const desktop = isDesktopShell();
  const [connection, setConnection] = useState<EngineConnection>(
    desktop ? { kind: "loading" } : { kind: "unavailable" },
  );
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [deviceEvents, setDeviceEvents] = useState<TimedDeviceEvent[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];

    (async () => {
      try {
        // Subscribe first so nothing between the snapshot and the
        // subscription is missed.
        unlisten.push(await engineApi.onStatus((s) => {
          // Status events can be reordered with the initial fetch; keep the newest.
          setStatus((prev) => (prev && prev.revision > s.revision ? prev : s));
        }));
        // Automatic per-game switching changes the profile from the backend.
        unlisten.push(await engineApi.onProfileChanged((p) => setProfile(p)));
        unlisten.push(await engineApi.onEngineEvent((e) => {
          if (e.kind !== "device") return;
          setDeviceEvents((prev) => [{ at: Date.now(), event: e.data }, ...prev].slice(0, MAX_EVENTS));
        }));
        const [s, info, p] = await Promise.all([
          engineApi.getStatus(), engineApi.getAppInfo(), engineApi.getActiveProfile(),
        ]);
        if (disposed) return;
        setStatus((prev) => (prev && prev.revision > s.revision ? prev : s));
        setAppInfo(info);
        setProfile(p);
        setConnection({ kind: "ready" });
      } catch (e) {
        if (!disposed) setConnection({ kind: "error", message: errorMessage(e) });
      }
    })();

    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  }, [desktop]);

  const set = useCallback((p: Profile) => setProfile(p), []);
  const value = useMemo(
    () => ({ connection, status, appInfo, profile, deviceEvents, setProfile: set, selectedDeviceId, setSelectedDeviceId }),
    [connection, status, appInfo, profile, deviceEvents, set, selectedDeviceId],
  );
  const devices = status?.devices ?? [];
  const connectedModel = (devices.find((d) => d.device.id === selectedDeviceId) ?? devices[0])?.device.model ?? null;
  return (
    <EngineContext.Provider value={value}>
      <ConnectedModelContext.Provider value={connectedModel}>{children}</ConnectedModelContext.Provider>
    </EngineContext.Provider>
  );
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error("useEngine must be used inside <EngineProvider>");
  return ctx;
}

/** Model of the controller the UI focuses on (null: none connected). Re-renders only when it changes. */
export function useConnectedModel(): ControllerModel | null {
  return useContext(ConnectedModelContext);
}

/** The controller the UI focuses on: the selected one, else the first. */
export function usePrimaryDevice() {
  const { status, selectedDeviceId } = useEngine();
  const devices = status?.devices ?? [];
  return devices.find((d) => d.device.id === selectedDeviceId) ?? devices[0] ?? null;
}
