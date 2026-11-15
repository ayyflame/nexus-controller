//! NEXUS desktop shell: hosts the controller engine and exposes it to the
//! React UI through typed commands and events. The engine runs on its own
//! threads; this crate only adapts it to Tauri.

mod bridge;
mod commands;

use nexus_engine::{Engine, EngineConfig};
use nexus_profile_manager::ProfileStore;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};

pub struct AppState {
    pub engine: Arc<Engine>,
    pub store: Mutex<ProfileStore>,
    pub data_dir: Option<PathBuf>,
    /// Set if the profile database could not be opened and an in-memory
    /// store is in use (settings will not persist this session).
    pub storage_warning: Option<String>,
    pub bridge: bridge::Bridge,
}

fn open_store(data_dir: Option<&PathBuf>) -> (ProfileStore, Option<String>) {
    let attempt = match data_dir {
        Some(dir) => ProfileStore::open(&dir.join("nexus.db")).map_err(|e| e.to_string()),
        None => Err("application data directory is unavailable".to_owned()),
    };
    match attempt {
        Ok(store) => (store, None),
        Err(e) => {
            let store = ProfileStore::open_in_memory().expect("in-memory SQLite must open");
            (
                store,
                Some(format!(
                    "Profiles could not be loaded ({e}). Changes will not be saved."
                )),
            )
        }
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().ok();
            let (store, storage_warning) = open_store(data_dir.as_ref());
            let profile = store.active_profile()?;

            let engine = Arc::new(Engine::start_default(EngineConfig {
                initial_output: profile.virtual_output,
                processing: profile.processing.clone(),
                ..Default::default()
            }));
            // The macro library is shared; which macros are on is per profile.
            match store.list_macros_for(profile.id) {
                Ok(macros) => engine.set_macros(macros),
                Err(e) => eprintln!("NEXUS: could not load macros: {e}"),
            }
            let bridge = bridge::Bridge::spawn(app.handle().clone(), engine.clone());

            app.manage(AppState {
                engine,
                store: Mutex::new(store),
                data_dir,
                storage_warning,
                bridge,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_status,
            commands::get_event_log,
            commands::get_raw_reports,
            commands::get_hid_diagnostics,
            commands::rescan_devices,
            commands::list_profiles,
            commands::get_active_profile,
            commands::set_active_profile,
            commands::set_virtual_output,
            commands::create_profile,
            commands::rename_profile,
            commands::duplicate_profile,
            commands::delete_profile,
            commands::set_processing,
            commands::list_macros,
            commands::save_macro,
            commands::delete_macro,
            commands::duplicate_macro,
            commands::set_macro_enabled,
            commands::start_macro_recording,
            commands::stop_macro_recording,
            commands::cancel_macro_recording,
            commands::stop_all_macros,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the NEXUS application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.bridge.stop();
                // Releases controller handles and any virtual devices.
                state.engine.shutdown();
            }
        }
    });
}
