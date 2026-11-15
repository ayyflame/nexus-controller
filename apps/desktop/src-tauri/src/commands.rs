//! Typed commands invoked from the UI. The TypeScript mirror lives in
//! `apps/desktop/src/types/engine.ts` and `apps/desktop/src/lib/engine.ts`.

use crate::AppState;
use nexus_controller_core::VirtualOutputKind;
use nexus_engine::EngineStatus;
use nexus_profile_manager::Profile;
use nexus_telemetry::{LogEntry, RawReport};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub message: String,
}

impl<E: std::fmt::Display> From<E> for CommandError {
    fn from(e: E) -> Self {
        Self {
            message: e.to_string(),
        }
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

#[tauri::command]
pub fn set_active_profile(state: State<'_, AppState>, id: i64) -> CmdResult<Profile> {
    let profile = state
        .store
        .lock()
        .map_err(|_| "profile store poisoned")?
        .set_active_profile(id)?;
    state.engine.set_output_mode(profile.virtual_output);
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
