import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo, CommandError, EngineEvent, HidDiagnostic, EngineStatus, LogEntry, Profile, RawReport,
  VirtualOutputKind,
} from "../types/engine";

export const EVENT_STATUS = "nexus://status";
export const EVENT_ENGINE = "nexus://engine-event";

/** True only inside the NEXUS desktop shell, where the Rust engine exists. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as CommandError).message);
  }
  return String(e);
}

/** Typed wrappers over the Rust commands in src-tauri/src/commands.rs. */
export const engineApi = {
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  getStatus: () => invoke<EngineStatus>("get_status"),
  getEventLog: (limit?: number) => invoke<LogEntry[]>("get_event_log", { limit }),
  getRawReports: (limit?: number) => invoke<RawReport[]>("get_raw_reports", { limit }),
  getHidDiagnostics: () => invoke<HidDiagnostic[]>("get_hid_diagnostics"),
  rescanDevices: () => invoke<void>("rescan_devices"),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  getActiveProfile: () => invoke<Profile>("get_active_profile"),
  setActiveProfile: (id: number) => invoke<Profile>("set_active_profile", { id }),
  setVirtualOutput: (mode: VirtualOutputKind) => invoke<Profile>("set_virtual_output", { mode }),

  onStatus: (cb: (s: EngineStatus) => void): Promise<UnlistenFn> =>
    listen<EngineStatus>(EVENT_STATUS, (e) => cb(e.payload)),
  onEngineEvent: (cb: (e: EngineEvent) => void): Promise<UnlistenFn> =>
    listen<EngineEvent>(EVENT_ENGINE, (e) => cb(e.payload)),
};
