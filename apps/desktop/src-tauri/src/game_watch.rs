//! Automatic per-game profile switching. Polls the foreground window twice
//! a second (a cheap query that opens nothing; the program behind it is
//! looked up only when the window changes) and applies a profile when a
//! configured game is focused, restoring the previous profile afterwards.

use crate::AppState;
use nexus_app_detect::{AutoSwitcher, ForegroundWatcher, RecentPrograms};
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
    /// Programs recently in the foreground (for picking a game to link).
    recent: Arc<Mutex<RecentPrograms>>,
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
        let recent = Arc::new(Mutex::new(RecentPrograms::new(12, &[own_exe.as_str()])));
        let seen = recent.clone();
        let thread = std::thread::Builder::new()
            .name("nexus-game-watch".into())
            .spawn(move || {
                let mut switcher = AutoSwitcher::new(SETTLE, &[own_exe.as_str()]);
                let mut watcher = ForegroundWatcher::default();
                while !flag.load(Ordering::Acquire) {
                    std::thread::sleep(POLL);
                    let Some(state) = app.try_state::<AppState>() else {
                        continue;
                    };
                    let fg = watcher.current();
                    seen.lock().unwrap_or_else(|e| e.into_inner()).record(&fg);
                    if !state.auto_switch.load(Ordering::Acquire) {
                        switcher.reset();
                        continue;
                    }
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
            recent,
            thread: Mutex::new(Some(thread)),
        }
    }

    /// Programs recently in the foreground, newest first.
    pub fn recent(&self) -> Vec<String> {
        self.recent.lock().unwrap_or_else(|e| e.into_inner()).list()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = t.join();
        }
    }
}
