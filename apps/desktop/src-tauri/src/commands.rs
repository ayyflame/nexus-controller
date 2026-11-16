//! Typed commands invoked from the UI. The TypeScript mirror lives in
//! `apps/desktop/src/types/engine.ts` and `apps/desktop/src/lib/engine.ts`.

use crate::AppState;
use nexus_controller_core::VirtualOutputKind;
use nexus_engine::{EngineStatus, HidDiagnostic};
use nexus_input_processing::ProcessingConfig;
use nexus_macro_engine::{Macro, RecordingResult, ValidationIssue};
use nexus_profile_manager::{Profile, ProfileError, ProfileStore};
use nexus_telemetry::{LogEntry, RawReport};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub message: String,
    /// Field-level problems for forms (macro validation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<ValidationIssue>>,
}

impl<E: std::fmt::Display> From<E> for CommandError {
    fn from(e: E) -> Self {
        Self {
            message: e.to_string(),
            issues: None,
        }
    }
}

fn profile_error(e: ProfileError) -> CommandError {
    match e {
        ProfileError::InvalidMacro(issues) => CommandError {
            message: issues
                .first()
                .map(|i| i.message.clone())
                .unwrap_or_else(|| "The macro is not valid.".to_owned()),
            issues: Some(issues),
        },
        other => other.into(),
    }
}

type CmdResult<T> = Result<T, CommandError>;

const MAX_LIMIT: usize = 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    pub data_dir: Option<String>,
    pub storage_warning: Option<String>,
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        data_dir: state.data_dir.as_ref().map(|p| p.display().to_string()),
        storage_warning: state.storage_warning.clone(),
    }
}

#[tauri::command]
pub fn get_status(state: State<'_, AppState>) -> EngineStatus {
    state.engine.status()
}

#[tauri::command]
pub fn get_event_log(state: State<'_, AppState>, limit: Option<usize>) -> Vec<LogEntry> {
    state.engine.recent_log(limit.unwrap_or(200).min(MAX_LIMIT))
}

#[tauri::command]
pub fn get_raw_reports(state: State<'_, AppState>, limit: Option<usize>) -> Vec<RawReport> {
    state
        .engine
        .recent_raw_reports(limit.unwrap_or(32).min(MAX_LIMIT))
}

#[tauri::command]
pub fn get_hid_diagnostics(state: State<'_, AppState>) -> Vec<HidDiagnostic> {
    state.engine.hid_diagnostics()
}

#[tauri::command]
pub fn refresh_drivers(
    state: State<'_, AppState>,
) -> nexus_virtual_controller::drivers::DriverStatus {
    state.engine.refresh_drivers()
}

#[tauri::command]
pub fn rescan_devices(state: State<'_, AppState>) {
    state.engine.rescan();
}

#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> CmdResult<Vec<Profile>> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "profile store poisoned")?
        .list_profiles()?)
}

#[tauri::command]
pub fn get_active_profile(state: State<'_, AppState>) -> CmdResult<Profile> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "profile store poisoned")?
        .active_profile()?)
}

/// Makes the engine match `profile` completely: output mode, processing
/// settings and the macros switched on in that profile. Running macros stop.
pub(crate) fn apply_profile(
    state: &AppState,
    store: &ProfileStore,
    profile: &Profile,
) -> CmdResult<()> {
    state.engine.set_output_mode(profile.virtual_output);
    state.engine.set_processing(profile.processing.clone());
    let macros = store.list_macros_for(profile.id).map_err(profile_error)?;
    state.engine.set_macros(macros);
    Ok(())
}

#[tauri::command]
pub fn set_active_profile(state: State<'_, AppState>, id: i64) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let profile = store.set_active_profile(id).map_err(profile_error)?;
    apply_profile(&state, &store, &profile)?;
    Ok(profile)
}

#[tauri::command]
pub fn create_profile(state: State<'_, AppState>, name: String) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.create_profile(&name).map_err(profile_error)
}

#[tauri::command]
pub fn rename_profile(state: State<'_, AppState>, id: i64, name: String) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.rename_profile(id, &name).map_err(profile_error)
}

#[tauri::command]
pub fn duplicate_profile(state: State<'_, AppState>, id: i64) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.duplicate_profile(id).map_err(profile_error)
}

/// Deletes a profile and returns the (possibly new) active profile.
#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, id: i64) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let active = store.delete_profile(id).map_err(profile_error)?;
    apply_profile(&state, &store, &active)?;
    Ok(active)
}

/// Saves stick/trigger/remap settings to the active profile and applies them.
#[tauri::command]
pub fn set_processing(state: State<'_, AppState>, config: ProcessingConfig) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let active = store.active_profile().map_err(profile_error)?;
    let profile = store
        .set_processing(active.id, &config)
        .map_err(profile_error)?;
    state.engine.set_processing(profile.processing.clone());
    Ok(profile)
}

/// Saves the virtual output choice to the active profile and requests it
/// from the engine. Whether a virtual device actually exists is reported
/// separately in `EngineStatus` (no driver backend exists in Milestone 1).
#[tauri::command]
pub fn set_virtual_output(
    state: State<'_, AppState>,
    mode: VirtualOutputKind,
) -> CmdResult<Profile> {
    let profile = {
        let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
        let active = store.active_profile()?;
        store.set_virtual_output(active.id, mode)?
    };
    state.engine.set_output_mode(mode);
    Ok(profile)
}

// ---- Macro Studio -----------------------------------------------------------

/// Hands the stored library to the engine after every change.
fn sync_engine(state: &AppState, store: &ProfileStore) -> CmdResult<Vec<Macro>> {
    let macros = store.list_macros().map_err(profile_error)?;
    state.engine.set_macros(macros.clone());
    Ok(macros)
}

#[tauri::command]
pub fn list_macros(state: State<'_, AppState>) -> CmdResult<Vec<Macro>> {
    let store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.list_macros().map_err(profile_error)
}

/// Creates (empty `id`) or updates a macro. Rejected with field-level
/// `issues` if invalid or conflicting.
#[tauri::command]
pub fn save_macro(state: State<'_, AppState>, definition: Macro) -> CmdResult<Macro> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let saved = store.save_macro(definition).map_err(profile_error)?;
    sync_engine(&state, &store)?;
    Ok(saved)
}

#[tauri::command]
pub fn delete_macro(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.delete_macro(&id).map_err(profile_error)?;
    sync_engine(&state, &store)?;
    Ok(())
}

#[tauri::command]
pub fn duplicate_macro(state: State<'_, AppState>, id: String) -> CmdResult<Macro> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let copy = store.duplicate_macro(&id).map_err(profile_error)?;
    sync_engine(&state, &store)?;
    Ok(copy)
}

#[tauri::command]
pub fn set_macro_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> CmdResult<Macro> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let m = store
        .set_macro_enabled(&id, enabled)
        .map_err(profile_error)?;
    sync_engine(&state, &store)?;
    Ok(m)
}

#[tauri::command]
pub fn start_macro_recording(state: State<'_, AppState>) -> CmdResult<()> {
    state.engine.start_recording().map_err(Into::into)
}

#[tauri::command]
pub fn stop_macro_recording(state: State<'_, AppState>) -> CmdResult<RecordingResult> {
    state.engine.stop_recording().map_err(Into::into)
}

#[tauri::command]
pub fn stop_all_macros(state: State<'_, AppState>) {
    state.engine.stop_all_macros();
}

#[tauri::command]
pub fn cancel_macro_recording(state: State<'_, AppState>) {
    state.engine.cancel_recording();
}

// ---- Milestone 3: feedback, gyro calibration, conflicts ---------------------

/// Vibrates the connected DualSense briefly (0–1 strength).
#[tauri::command]
pub fn test_vibration(
    state: State<'_, AppState>,
    strength: f32,
    duration_ms: u32,
) -> CmdResult<()> {
    state
        .engine
        .test_vibration(strength, duration_ms)
        .map_err(Into::into)
}

#[tauri::command]
pub fn start_gyro_calibration(state: State<'_, AppState>) -> CmdResult<()> {
    state.engine.start_gyro_calibration().map_err(Into::into)
}

#[tauri::command]
pub fn finish_gyro_calibration(
    state: State<'_, AppState>,
) -> CmdResult<nexus_engine::GyroCalibration> {
    state.engine.finish_gyro_calibration().map_err(Into::into)
}

/// Mapping conflicts in `config`, including with the active profile's macros.
#[tauri::command]
pub fn find_conflicts(
    state: State<'_, AppState>,
    config: ProcessingConfig,
) -> CmdResult<Vec<nexus_input_processing::ConfigConflict>> {
    let store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let triggers: Vec<_> = store
        .list_macros()
        .map_err(profile_error)?
        .into_iter()
        .filter(|m| m.enabled)
        .filter_map(|m| m.trigger)
        .collect();
    Ok(nexus_input_processing::find_conflicts(&config, &triggers))
}

// ---- Smart profiles and portability ---------------------------------------

use nexus_profile_manager::{ImportMode, ImportPreview, ImportReport, ProfileTemplate, TEMPLATES};
use std::sync::atomic::Ordering;
use tauri::Manager;

#[tauri::command]
pub fn set_profile_games(
    state: State<'_, AppState>,
    id: i64,
    games: Vec<String>,
) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.set_profile_games(id, &games).map_err(profile_error)
}

#[tauri::command]
pub fn get_auto_switch(state: State<'_, AppState>) -> bool {
    state.auto_switch.load(Ordering::Acquire)
}

#[tauri::command]
pub fn set_auto_switch(state: State<'_, AppState>, enabled: bool) -> CmdResult<()> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store
        .set_auto_switch_enabled(enabled)
        .map_err(profile_error)?;
    state.auto_switch.store(enabled, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn list_templates() -> &'static [ProfileTemplate] {
    TEMPLATES
}

#[tauri::command]
pub fn create_profile_from_template(
    state: State<'_, AppState>,
    name: String,
    template: String,
) -> CmdResult<Profile> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store
        .create_profile_from_template(&name, &template)
        .map_err(profile_error)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: Option<String>,
    pub json: String,
}

/// "2026-11-16_14-05-09" in UTC, for file names.
fn stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}_{:02}-{:02}-{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn write_file(dir: Option<std::path::PathBuf>, name: &str, json: &str) -> Option<String> {
    let dir = dir?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(name);
    std::fs::write(&path, json).ok()?;
    Some(path.display().to_string())
}

fn exports_dir(app: &tauri::AppHandle, sub: &str) -> Option<std::path::PathBuf> {
    app.path()
        .document_dir()
        .ok()
        .map(|d| d.join("NEXUS").join(sub))
}

/// Exports profiles (all if `profile_ids` is empty) to Documents\NEXUS.
#[tauri::command]
pub fn export_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    profile_ids: Vec<i64>,
    include_all_macros: bool,
) -> CmdResult<ExportResult> {
    let store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let ids = (!profile_ids.is_empty()).then_some(profile_ids.as_slice());
    let bundle = store
        .export_bundle(ids, include_all_macros, env!("CARGO_PKG_VERSION"))
        .map_err(profile_error)?;
    let json = serde_json::to_string_pretty(&bundle)?;
    let label = match bundle.profiles.as_slice() {
        [one] => one
            .name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ')
            .collect::<String>(),
        _ => "all-profiles".into(),
    };
    let path = write_file(
        exports_dir(&app, "Exports"),
        &format!("{} {}.nexus.json", label.trim(), stamp()),
        &json,
    );
    Ok(ExportResult { path, json })
}

#[tauri::command]
pub fn preview_import(
    state: State<'_, AppState>,
    json: String,
    mode: ImportMode,
) -> CmdResult<ImportPreview> {
    let store = state.store.lock().map_err(|_| "profile store poisoned")?;
    store.preview_import(&json, mode).map_err(profile_error)
}

/// Imports a file. `Replace` first saves an automatic backup of the current
/// configuration in the app data folder; if that fails nothing is replaced.
#[tauri::command]
pub fn import_config(
    state: State<'_, AppState>,
    json: String,
    mode: ImportMode,
) -> CmdResult<ImportReport> {
    let mut store = state.store.lock().map_err(|_| "profile store poisoned")?;
    if mode == ImportMode::Replace {
        let backup = store
            .export_bundle(None, true, env!("CARGO_PKG_VERSION"))
            .map_err(profile_error)?;
        let text = serde_json::to_string_pretty(&backup)?;
        let dir = state.data_dir.as_ref().map(|d| d.join("backups"));
        if write_file(dir, &format!("pre-restore {}.nexus.json", stamp()), &text).is_none() {
            return Err("Couldn't save a safety backup first, so nothing was replaced.".into());
        }
    }
    let report = store.import_bundle(&json, mode).map_err(profile_error)?;
    let active = store.active_profile().map_err(profile_error)?;
    apply_profile(&state, &store, &active)?;
    Ok(report)
}

/// Saves a full backup (all profiles and macros) to Documents\NEXUS\Backups.
#[tauri::command]
pub fn create_backup(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<ExportResult> {
    let store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let bundle = store
        .export_bundle(None, true, env!("CARGO_PKG_VERSION"))
        .map_err(profile_error)?;
    let json = serde_json::to_string_pretty(&bundle)?;
    let path = write_file(
        exports_dir(&app, "Backups"),
        &format!("nexus-backup {}.nexus.json", stamp()),
        &json,
    );
    if path.is_none() {
        return Err("Couldn't write the backup file to Documents\\NEXUS\\Backups.".into());
    }
    Ok(ExportResult { path, json })
}

/// Exports the whole macro library (no profiles) to Documents\\NEXUS\\Exports.
#[tauri::command]
pub fn export_macros(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<ExportResult> {
    let store = state.store.lock().map_err(|_| "profile store poisoned")?;
    let bundle = store
        .export_bundle(Some(&[]), true, env!("CARGO_PKG_VERSION"))
        .map_err(profile_error)?;
    let json = serde_json::to_string_pretty(&bundle)?;
    let path = write_file(
        exports_dir(&app, "Exports"),
        &format!("macros {}.nexus.json", stamp()),
        &json,
    );
    Ok(ExportResult { path, json })
}
