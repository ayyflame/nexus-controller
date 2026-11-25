import type { ProfileMeta } from "./profileManager";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  OutputCheck, RestorePoint, WindowBehaviour, WindowsIntegration,
  AppInfo, CommandError, EngineEvent, HidDiagnostic, EngineStatus, LogEntry, Macro, Profile, RawReport,
  ConfigConflict, DriverStatus, ExportResult, GyroCalibration, ImportMode, ImportPreview, ImportReport, ProcessingConfig,
  MacroMeta, ProfileTemplate, RecordingResult, ValidationIssue, VirtualOutputKind,
} from "../types/engine";
import type { UpdateStatus } from "./updates";

export const EVENT_STATUS = "nexus://status";
export const EVENT_ENGINE = "nexus://engine-event";
export const EVENT_PROFILE_CHANGED = "nexus://profile-changed";
export const EVENT_UPDATE = "nexus://update";

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
  getDefaultProfile: () => invoke<number | null>("get_default_profile"),
  setDefaultProfile: (id: number | null) => invoke<number | null>("set_default_profile", { id }),
  checkVirtualOutput: () => invoke<OutputCheck>("check_virtual_output"),
  getWindowsIntegration: () => invoke<WindowsIntegration>("get_windows_integration"),
  setWindowBehaviour: (behaviour: WindowBehaviour) => invoke<WindowsIntegration>("set_window_behaviour", { behaviour }),
  setStartWithWindows: (enabled: boolean) => invoke<WindowsIntegration>("set_start_with_windows", { enabled }),
  getEventLog: (limit?: number) => invoke<LogEntry[]>("get_event_log", { limit }),
  getRawReports: (limit?: number) => invoke<RawReport[]>("get_raw_reports", { limit }),
  getHidDiagnostics: () => invoke<HidDiagnostic[]>("get_hid_diagnostics"),
  rescanDevices: () => invoke<void>("rescan_devices"),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  getActiveProfile: () => invoke<Profile>("get_active_profile"),
  setActiveProfile: (id: number) => invoke<Profile>("set_active_profile", { id }),
  setVirtualOutput: (mode: VirtualOutputKind) => invoke<Profile>("set_virtual_output", { mode }),
  /** A blank profile, or (with `copyFrom`) a full copy of another one under `name`. */
  createProfile: (name: string, copyFrom?: number) => invoke<Profile>("create_profile", { name, copyFrom: copyFrom ?? null }),
  getProfileMeta: () => invoke<ProfileMeta>("get_profile_meta"),
  setProfilePinned: (id: number, pinned: boolean) => invoke<ProfileMeta>("set_profile_pinned", { id, pinned }),
  renameProfile: (id: number, name: string) => invoke<Profile>("rename_profile", { id, name }),
  duplicateProfile: (id: number) => invoke<Profile>("duplicate_profile", { id }),
  /** Returns the active profile afterwards. */
  deleteProfile: (id: number) => invoke<Profile>("delete_profile", { id }),
  /** Saves to `profileId` (the profile the edit was made in), or the active profile. */
  setProcessing: (config: ProcessingConfig, profileId?: number) => invoke<Profile>("set_processing", { config, profileId: profileId ?? null }),
  stopAllMacros: () => invoke<void>("stop_all_macros"),
  refreshDrivers: () => invoke<DriverStatus>("refresh_drivers"),
  getOutputConsent: () => invoke<{ enabled: boolean }>("get_output_consent"),
  setOutputConsent: (enabled: boolean) => invoke<{ enabled: boolean }>("set_output_consent", { enabled }),
  testVibration: (strength: number, durationMs: number) => invoke<void>("test_vibration", { strength, durationMs }),
  startGyroCalibration: () => invoke<void>("start_gyro_calibration"),
  finishGyroCalibration: () => invoke<GyroCalibration>("finish_gyro_calibration"),
  findConflicts: (config: ProcessingConfig) => invoke<ConfigConflict[]>("find_conflicts", { config }),
  setProfileGames: (id: number, games: string[]) => invoke<Profile>("set_profile_games", { id, games }),
  recentPrograms: () => invoke<string[]>("recent_programs"),
  listRestorePoints: () => invoke<RestorePoint[]>("list_restore_points"),
  readRestorePoint: (id: string) => invoke<string>("read_restore_point", { id }),
  getAutoSwitch: () => invoke<boolean>("get_auto_switch"),
  setAutoSwitch: (enabled: boolean) => invoke<void>("set_auto_switch", { enabled }),
  listTemplates: () => invoke<ProfileTemplate[]>("list_templates"),
  createProfileFromTemplate: (name: string, template: string) => invoke<Profile>("create_profile_from_template", { name, template }),
  exportConfig: (profileIds: number[], includeAllMacros: boolean) => invoke<ExportResult>("export_config", { profileIds, includeAllMacros }),
  exportMacros: () => invoke<ExportResult>("export_macros"),
  exportMacro: (ids: string[]) => invoke<ExportResult>("export_macro", { ids }),
  getMacroMeta: () => invoke<MacroMeta>("get_macro_meta"),
  setMacroPinned: (id: string, pinned: boolean) => invoke<MacroMeta>("set_macro_pinned", { id, pinned }),
  previewImport: (json: string, mode: ImportMode) => invoke<ImportPreview>("preview_import", { json, mode }),
  importConfig: (json: string, mode: ImportMode) => invoke<ImportReport>("import_config", { json, mode }),
  createBackup: () => invoke<ExportResult>("create_backup"),

  listMacros: () => invoke<Macro[]>("list_macros"),
  saveMacro: (definition: Macro) => invoke<Macro>("save_macro", { definition }),
  deleteMacro: (id: string) => invoke<void>("delete_macro", { id }),
  duplicateMacro: (id: string) => invoke<Macro>("duplicate_macro", { id }),
  setMacroEnabled: (id: string, enabled: boolean) => invoke<Macro>("set_macro_enabled", { id, enabled }),
  startMacroRecording: () => invoke<void>("start_macro_recording"),
  stopMacroRecording: () => invoke<RecordingResult>("stop_macro_recording"),
  cancelMacroRecording: () => invoke<void>("cancel_macro_recording"),

  getUpdateStatus: () => invoke<UpdateStatus>("get_update_status"),
  checkForUpdates: () => invoke<UpdateStatus>("check_for_updates"),
  downloadUpdate: () => invoke<UpdateStatus>("download_update"),
  installUpdate: () => invoke<UpdateStatus>("install_update"),
  postponeUpdate: () => invoke<UpdateStatus>("postpone_update"),
  setAutoUpdateCheck: (enabled: boolean) => invoke<UpdateStatus>("set_auto_update_check", { enabled }),
  dismissUpdateOutcome: () => invoke<UpdateStatus>("dismiss_update_outcome"),
  onUpdate: (cb: (s: UpdateStatus) => void): Promise<UnlistenFn> =>
    listen<UpdateStatus>(EVENT_UPDATE, (e) => cb(e.payload)),

  onStatus: (cb: (s: EngineStatus) => void): Promise<UnlistenFn> =>
    listen<EngineStatus>(EVENT_STATUS, (e) => cb(e.payload)),
  onProfileChanged: (cb: (p: Profile) => void): Promise<UnlistenFn> =>
    listen<Profile>(EVENT_PROFILE_CHANGED, (e) => cb(e.payload)),
  onEngineEvent: (cb: (e: EngineEvent) => void): Promise<UnlistenFn> =>
    listen<EngineEvent>(EVENT_ENGINE, (e) => cb(e.payload)),
};
