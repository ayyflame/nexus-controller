//! NEXUS desktop shell: hosts the controller engine and exposes it to the
//! React UI through typed commands and events. The engine runs on its own
//! threads; this crate only adapts it to Tauri.

mod background;
mod bridge;
mod commands;
mod game_watch;
mod restore;
mod startup;
mod tray;
mod updates;
mod window;

use background::{WindowBehaviour, WindowChange, WindowResponse};
use nexus_engine::{Engine, EngineConfig};
use nexus_profile_manager::ProfileStore;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};

/// How long quitting waits for each controller to release its buttons and
/// remove its virtual controller. A reader stuck in a driver call that never
/// returns must not keep NEXUS from exiting; Windows then removes the virtual
/// controller when the process ends (see docs/driver-performance.md).
pub const EXIT_RELEASE_TIMEOUT: Duration = Duration::from_secs(2);

pub struct AppState {
    pub engine: Arc<Engine>,
    pub store: Mutex<ProfileStore>,
    pub data_dir: Option<PathBuf>,
    /// Set if the profile database could not be opened and an in-memory
    /// store is in use (settings will not persist this session).
    pub storage_warning: Option<String>,
    pub bridge: bridge::Bridge,
    /// Automatic per-game profile switching is on.
    pub auto_switch: std::sync::atomic::AtomicBool,
    pub game_watch: std::sync::OnceLock<game_watch::GameWatch>,
    /// Report Inspector captures (diagnostics; kept in memory only).
    pub inspector: Mutex<nexus_engine::inspector::InspectorSession>,
    /// Close/minimise to tray, start hidden (read on every window event).
    pub behaviour: Mutex<WindowBehaviour>,
    /// The main window is created after everything else (see `window`).
    pub main_window: Mutex<window::MainWindow>,
}

/// Makes the "Start with Windows" entry match the user's saved choice: puts
/// it back after an upgrade that uninstalled first, adopts a choice made by
/// an older version, and points it at this copy if NEXUS was reinstalled
/// elsewhere. Installed builds only: a development build must never take
/// over the installed copy's entry.
fn reconcile_startup_entry(store: &mut ProfileStore) -> Option<String> {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        let exe = std::env::current_exe().ok()?;
        let wanted = startup::preference(
            store
                .get_setting(startup::PREFERENCE_KEY)
                .ok()
                .flatten()
                .as_deref(),
        );
        match startup::reconcile(&mut startup::Registry::nexus(), &exe, wanted) {
            Ok(r) => {
                if let Some(on) = r.save {
                    let _ = store
                        .set_setting(startup::PREFERENCE_KEY, if on { "true" } else { "false" });
                }
                r.restored
                    .then(|| "Start with Windows was put back after reinstalling NEXUS".to_owned())
            }
            Err(e) => Some(format!("Could not check the Start with Windows entry: {e}")),
        }
    }
    #[cfg(not(all(windows, not(debug_assertions))))]
    {
        let _ = store;
        None
    }
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
    let started_at_sign_in = startup::started_at_sign_in(&std::env::args().collect::<Vec<_>>());
    let app = tauri::Builder::default()
        // First: a second copy of NEXUS would fight over the DualSense and
        // create a second virtual controller. It exits at once and the
        // running copy shows its window instead.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if background::show_on_second_launch(startup::started_at_sign_in(&args)) {
                tray::show_main(app);
            }
        }))
        // Window size, position and maximised state across restarts. Never
        // visibility: whether the window opens is decided below.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        // Rust-side only: no updater permission is granted to the webview.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            let Some(state) = window.try_state::<AppState>() else {
                return;
            };
            if let WindowEvent::Focused(focused) = event {
                // Behind a game: the status stream slows to a few updates a second.
                state.bridge.set_focused(*focused);
                return;
            }
            let behaviour = *state.behaviour.lock().unwrap_or_else(|e| e.into_inner());
            let change = match event {
                WindowEvent::CloseRequested { .. } => WindowChange::CloseRequested,
                // Windows reports minimising as a resize (P6).
                _ => match bridge::visibility_after(event, || window.is_minimized().ok()) {
                    Some(visible) => WindowChange::Visibility(visible),
                    None => return,
                },
            };
            match background::respond(behaviour, change) {
                WindowResponse::Close => {}
                WindowResponse::HideToTray => {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                    tray::hide_main(window.app_handle());
                }
                WindowResponse::StatusStream(on) => state.bridge.set_visible(on),
            }
        })
        .setup(move |app| {
            let data_dir = app.path().app_data_dir().ok();
            let (mut store, storage_warning) = open_store(data_dir.as_ref());
            let behaviour = WindowBehaviour::from_saved(
                store
                    .get_setting(background::SETTINGS_KEY)
                    .ok()
                    .flatten()
                    .as_deref(),
            );
            // Start with the default profile, if one is chosen.
            let profile = store.activate_default_profile()?;

            let startup_note = reconcile_startup_entry(&mut store);
            // One automatic backup per day (kept 14 days), restorable from
            // Profiles › Restore points.
            if let Some(dir) = data_dir.as_ref() {
                if let Err(e) = restore::daily_backup(
                    &store,
                    &dir.join("backups"),
                    &commands::stamp(),
                    env!("CARGO_PKG_VERSION"),
                ) {
                    eprintln!("NEXUS: daily backup failed: {e}");
                }
            }
            let engine = Arc::new(Engine::start_default(EngineConfig {
                initial_output: commands::effective_output(&store, profile.virtual_output),
                processing: profile.processing.clone(),
                ..Default::default()
            }));
            // The macro library is shared; which macros are on is per profile.
            match store.list_macros_for(profile.id) {
                Ok(macros) => engine.set_macros(macros),
                Err(e) => eprintln!("NEXUS: could not load macros: {e}"),
            }
            let bridge = bridge::Bridge::spawn(app.handle().clone(), engine.clone());
            let auto_switch = store.auto_switch_enabled().unwrap_or(true);

            app.manage(AppState {
                engine,
                store: Mutex::new(store),
                data_dir,
                storage_warning,
                bridge,
                auto_switch: std::sync::atomic::AtomicBool::new(auto_switch),
                game_watch: std::sync::OnceLock::new(),
                inspector: Mutex::new(Default::default()),
                behaviour: Mutex::new(behaviour),
                main_window: Mutex::new(Default::default()),
            });
            if let Some(note) = startup_note {
                app.state::<AppState>()
                    .engine
                    .log(nexus_telemetry::LogLevel::Info, "app", note);
            }
            // Without a tray icon a hidden window could never be reopened:
            // closing must quit, minimising must stay on the taskbar, and the
            // window must open even when Windows started NEXUS at sign-in.
            let behaviour = match tray::create(app.handle()) {
                Ok(()) => behaviour,
                Err(e) => {
                    eprintln!("NEXUS: no tray icon ({e}); the window stays reachable");
                    let b = background::without_tray();
                    *app.state::<AppState>()
                        .behaviour
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = b;
                    b
                }
            };
            // Last: the window. Everything above (profiles, controller
            // engine, virtual controller, tray) already runs without it.
            let show = background::show_at_launch(behaviour, started_at_sign_in);
            app.state::<AppState>().bridge.set_visible(false);
            let begin = app
                .state::<AppState>()
                .main_window
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .begin(show);
            if begin {
                window::spawn_create(app.handle().clone());
            }
            if nexus_app_detect::supported() {
                let watch = game_watch::GameWatch::spawn(app.handle().clone());
                let _ = app.state::<AppState>().game_watch.set(watch);
            }
            let updates = updates::UpdateService::init(app.handle(), &app.state::<AppState>());
            app.manage(updates);
            updates::spawn_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_status,
            commands::check_virtual_output,
            commands::get_event_log,
            commands::get_raw_reports,
            commands::get_hid_diagnostics,
            commands::rescan_devices,
            commands::list_profiles,
            commands::get_active_profile,
            commands::set_active_profile,
            commands::get_default_profile,
            commands::set_default_profile,
            commands::get_windows_integration,
            commands::set_window_behaviour,
            commands::set_start_with_windows,
            commands::set_virtual_output,
            commands::get_output_consent,
            commands::set_output_consent,
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
            commands::refresh_drivers,
            commands::test_vibration,
            commands::start_gyro_calibration,
            commands::finish_gyro_calibration,
            commands::find_conflicts,
            commands::set_profile_games,
            commands::recent_programs,
            commands::get_auto_switch,
            commands::set_auto_switch,
            commands::list_templates,
            commands::create_profile_from_template,
            commands::export_config,
            commands::preview_import,
            commands::import_config,
            commands::create_backup,
            commands::list_restore_points,
            commands::read_restore_point,
            commands::export_macros,
            commands::get_update_status,
            commands::check_for_updates,
            commands::download_update,
            commands::install_update,
            commands::postpone_update,
            commands::set_auto_update_check,
            commands::dismiss_update_outcome,
            commands::inspector_record,
            commands::inspector_view,
            commands::inspector_clear,
            commands::inspector_interfaces,
            commands::inspector_export,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the NEXUS application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            updates::shutdown_runtime(handle);
        }
    });
}
