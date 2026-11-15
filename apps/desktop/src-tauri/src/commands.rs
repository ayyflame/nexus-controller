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
fn apply_profile(state: &AppState, store: &ProfileStore, profile: &Profile) -> CmdResult<()> {
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
