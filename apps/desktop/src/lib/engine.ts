import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo, CommandError, EngineEvent, HidDiagnostic, EngineStatus, LogEntry, Macro, Profile, RawReport,
  DriverStatus, ProcessingConfig, RecordingResult, ValidationIssue, VirtualOutputKind,
} from "../types/engine";

export const EVENT_STATUS = "nexus://status";
export const EVENT_ENGINE = "nexus://engine-event";

/** True only inside the NEXUS desktop shell, where the Rust engine exists. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Field-level validation issues carried by a command error, if any. */
export function errorIssues(e: unknown): ValidationIssue[] {
  if (typeof e === "object" && e !== null && "issues" in e) {
    return ((e as CommandError).issues ?? []) as ValidationIssue[];
  }
  return [];
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
  createProfile: (name: string) => invoke<Profile>("create_profile", { name }),
  renameProfile: (id: number, name: string) => invoke<Profile>("rename_profile", { id, name }),
  duplicateProfile: (id: number) => invoke<Profile>("duplicate_profile", { id }),
  /** Returns the active profile afterwards. */
  deleteProfile: (id: number) => invoke<Profile>("delete_profile", { id }),
  setProcessing: (config: ProcessingConfig) => invoke<Profile>("set_processing", { config }),
  stopAllMacros: () => invoke<void>("stop_all_macros"),
  refreshDrivers: () => invoke<DriverStatus>("refresh_drivers"),

  listMacros: () => invoke<Macro[]>("list_macros"),
  saveMacro: (definition: Macro) => invoke<Macro>("save_macro", { definition }),
  deleteMacro: (id: string) => invoke<void>("delete_macro", { id }),
  duplicateMacro: (id: string) => invoke<Macro>("duplicate_macro", { id }),
  setMacroEnabled: (id: string, enabled: boolean) => invoke<Macro>("set_macro_enabled", { id, enabled }),
  startMacroRecording: () => invoke<void>("start_macro_recording"),
  stopMacroRecording: () => invoke<RecordingResult>("stop_macro_recording"),
  cancelMacroRecording: () => invoke<void>("cancel_macro_recording"),

  onStatus: (cb: (s: EngineStatus) => void): Promise<UnlistenFn> =>
    listen<EngineStatus>(EVENT_STATUS, (e) => cb(e.payload)),
  onEngineEvent: (cb: (e: EngineEvent) => void): Promise<UnlistenFn> =>
    listen<EngineEvent>(EVENT_ENGINE, (e) => cb(e.payload)),
};
