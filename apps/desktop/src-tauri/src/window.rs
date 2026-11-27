//! The main window is created after everything else has started.
//!
//! Tauri creates windows listed in `tauri.conf.json` *before* the app's own
//! setup runs, and creating one waits for WebView2 to start. On a fresh or
//! busy PC that took 7 s in CI, and once more than 60 s (WebView2 setting up
//! its profile, being updated, or scanned). Until then NEXUS had no profile
//! database, no controller engine and no virtual controller. So the window
//! has `"create": false`, and it is created on its own thread once the
//! database, engine and tray are running:
//! - the controller works even while WebView2 is slow, or if it is broken;
//! - the tray works meanwhile (Tauri's event loop isn't blocked);
//! - asking for the window before it exists shows it once it is ready, and a
//!   failed creation is logged and retried from tray › *Open NEXUS*.

use crate::AppState;
use nexus_telemetry::LogLevel;
use std::time::Instant;
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

pub const MAIN: &str = "main";

/// Where the main window is in its life.
#[derive(Debug, Default)]
pub struct MainWindow {
    creating: bool,
    ready: bool,
    show_when_ready: bool,
    pub failures: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShowRequest {
    /// The window exists: show it now.
    ShowNow,
    /// It is being created; it will be shown when ready.
    Queued,
    /// It doesn't exist and isn't being created: create it, then show it.
    Create,
}

impl MainWindow {
    /// At start-up: create the window, shown or not.
    pub fn begin(&mut self, show: bool) -> bool {
        if self.creating || self.ready {
            return false;
        }
        self.creating = true;
        self.show_when_ready = show;
        true
    }

    /// Someone asked for the window (tray, second start).
    pub fn request_show(&mut self) -> ShowRequest {
        if self.ready {
            return ShowRequest::ShowNow;
        }
        self.show_when_ready = true;
        if self.creating {
            ShowRequest::Queued
        } else {
            self.creating = true;
            ShowRequest::Create
        }
    }

    /// The window was created. Returns whether to show it.
    pub fn created(&mut self) -> bool {
        self.creating = false;
        self.ready = true;
        std::mem::take(&mut self.show_when_ready)
    }

    /// Creating it failed; the next request tries again.
    pub fn failed(&mut self) {
        self.creating = false;
        self.show_when_ready = false;
        self.failures += 1;
    }

    pub fn is_ready(&self) -> bool {
        self.ready
    }
}

fn state(app: &AppHandle) -> Option<tauri::State<'_, AppState>> {
    app.try_state::<AppState>()
}

/// Creates the main window from its `tauri.conf.json` entry on a separate
/// thread (Tauri hands the work to the main thread and waits; that thread
/// keeps running the event loop meanwhile).
pub fn spawn_create(app: AppHandle) {
    let fallback = app.clone();
    let spawned = std::thread::Builder::new()
        .name("nexus-window".into())
        .spawn(move || {
            let started = Instant::now();
            let result = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN)
                .cloned()
                .ok_or_else(|| "no main window in the configuration".to_owned())
                .and_then(|c| {
                    WebviewWindowBuilder::from_config(&app, &c)
                        .and_then(|b| b.build())
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                });
            let Some(st) = state(&app) else { return };
            let ms = started.elapsed().as_millis();
            match result {
                Ok(()) => {
                    st.engine
                        .log(LogLevel::Info, "app", format!("Window ready after {ms} ms"));
                    let show = st.main_window.lock().unwrap_or_else(|e| e.into_inner()).created();
                    if show {
                        show_now(&app);
                    }
                }
                Err(e) => {
                    st.main_window.lock().unwrap_or_else(|e| e.into_inner()).failed();
                    st.engine.log(
                        LogLevel::Error,
                        "app",
                        format!(
                            "The NEXUS window could not be opened after {ms} ms ({e}). The controller \
                             keeps working; use tray › Open NEXUS to try again. If this keeps happening, \
                             repair the Microsoft Edge WebView2 Runtime (Windows Settings › Apps)."
                        ),
                    );
                }
            }
        });
    if spawned.is_err() {
        if let Some(st) = state(&fallback) {
            st.main_window
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .failed();
        }
    }
}

/// Brings the main window back (from the tray, minimised or behind others),
/// creating it first if it doesn't exist yet.
pub fn show_main(app: &AppHandle) {
    let Some(st) = state(app) else { return };
    let request = st
        .main_window
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .request_show();
    match request {
        ShowRequest::ShowNow => show_now(app),
        ShowRequest::Queued => {}
        ShowRequest::Create => spawn_create(app.clone()),
    }
}

fn show_now(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(st) = state(app) {
        st.bridge.set_visible(true);
    }
}

/// Hides the main window to the tray. NEXUS keeps running; the UI status
/// stream pauses until the window is shown again.
pub fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
    }
    if let Some(st) = state(app) {
        st.bridge.set_visible(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hidden_start_creates_the_window_without_showing_it() {
        let mut w = MainWindow::default();
        assert!(w.begin(false));
        assert!(!w.created(), "started at sign-in into the tray");
        assert_eq!(w.request_show(), ShowRequest::ShowNow);
    }

    #[test]
    fn asking_for_the_window_while_webview2_is_slow_shows_it_once_ready() {
        let mut w = MainWindow::default();
        assert!(w.begin(false));
        assert_eq!(w.request_show(), ShowRequest::Queued, "no second window");
        assert_eq!(w.request_show(), ShowRequest::Queued);
        assert!(w.created(), "the queued request shows it");
        assert!(w.is_ready());
        assert!(!w.begin(true), "never created twice");
    }

    #[test]
    fn a_failed_window_is_retried_on_the_next_request() {
        let mut w = MainWindow::default();
        assert!(w.begin(true));
        w.failed();
        assert_eq!(w.failures, 1);
        assert!(!w.is_ready());
        assert_eq!(
            w.request_show(),
            ShowRequest::Create,
            "tray › Open tries again"
        );
        assert_eq!(w.request_show(), ShowRequest::Queued);
        assert!(w.created());
    }
}
