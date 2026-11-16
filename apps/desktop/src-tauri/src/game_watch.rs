//! Automatic per-game profile switching. Polls the foreground program twice
//! a second (a cheap query) and applies a profile when a configured game is
//! focused, restoring the previous profile afterwards.

use crate::AppState;
use nexus_app_detect::{foreground, AutoSwitcher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_PROFILE_CHANGED: &str = "nexus://profile-changed";
const POLL: Duration = Duration::from_millis(500);
const SETTLE: Duration = Duration::from_millis(1000);

pub struct GameWatch {
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl GameWatch {
    pub fn spawn(app: AppHandle) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let own_exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        let thread = std::thread::Builder::new()
            .name("nexus-game-watch".into())
            .spawn(move || {
                let mut switcher = AutoSwitcher::new(SETTLE, &[own_exe.as_str()]);
                while !flag.load(Ordering::Acquire) {
                    std::thread::sleep(POLL);
                    let Some(state) = app.try_state::<AppState>() else {
                        continue;
                    };
                    if !state.auto_switch.load(Ordering::Acquire) {
                        switcher.reset();
                        continue;
                    }
                    let fg = foreground();
                    let Ok(mut store) = state.store.lock() else {
                        continue;
                    };
                    let Ok(profiles) = store.list_profiles() else {
                        continue;
                    };
                    let Ok(active) = store.active_profile() else {
                        continue;
                    };
                    let target = switcher.update(Instant::now(), fg, active.id, |exe| {
                        profiles
                            .iter()
                            .find(|p| p.games.iter().any(|g| g == exe))
                            .map(|p| p.id)
                    });
                    if let Some(id) = target {
                        if let Ok(profile) = store.set_active_profile(id) {
                            let _ = crate::commands::apply_profile(&state, &store, &profile);
                            drop(store);
                            let _ = app.emit(EVENT_PROFILE_CHANGED, &profile);
                        }
                    }
                }
            })
            .expect("failed to spawn game watcher");
        Self {
            stop,
            thread: Mutex::new(Some(thread)),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = t.join();
        }
    }
}
