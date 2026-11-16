//! Pushes engine state to the UI.
//!
//! The engine never calls into Tauri. This thread polls the engine at a fixed
//! UI rate, which decouples controller input (≈250 Hz or more) from rendering.
//! A stalled webview therefore cannot back-pressure the input path.

use nexus_engine::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const EVENT_STATUS: &str = "nexus://status";
pub const EVENT_ENGINE: &str = "nexus://engine-event";
const FRAME: Duration = Duration::from_millis(16);

/// Decides when to send a status update. While the window is minimised or
/// hidden nothing is sent (no serialising, no IPC, no re-rendering); when it
/// becomes visible again the current status is sent immediately.
#[derive(Debug, Default)]
pub(crate) struct StatusGate {
    last_revision: u64,
    was_visible: bool,
}

impl StatusGate {
    pub(crate) fn should_send(&mut self, visible: bool, revision: u64) -> bool {
        let became_visible = visible && !self.was_visible;
        self.was_visible = visible;
        if !visible {
            return false;
        }
        if became_visible || revision != self.last_revision {
            self.last_revision = revision;
            return true;
        }
        false
    }
}

pub struct Bridge {
    stop: Arc<AtomicBool>,
    visible: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Bridge {
    pub fn spawn(app: AppHandle, engine: Arc<Engine>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let visible = Arc::new(AtomicBool::new(true));
        let shown = visible.clone();
        let events = engine.subscribe();
        let thread = std::thread::Builder::new()
            .name("nexus-ui-bridge".into())
            .spawn(move || {
                let mut gate = StatusGate::default();
                while !flag.load(Ordering::Acquire) {
                    // Engine events (connects, log lines) are rare; always forwarded.
                    for event in events.try_iter() {
                        let _ = app.emit(EVENT_ENGINE, &event);
                    }
                    if gate.should_send(shown.load(Ordering::Acquire), engine.revision()) {
                        let _ = app.emit(EVENT_STATUS, engine.status());
                    }
                    std::thread::sleep(FRAME);
                }
            })
            .expect("failed to spawn UI bridge thread");
        Self {
            stop,
            visible,
            thread: Mutex::new(Some(thread)),
        }
    }

    /// Called from window events: false while minimised or hidden.
    pub fn set_visible(&self, visible: bool) {
        self.visible.store(visible, Ordering::Release);
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = t.join();
        }
    }
}

/// What a window event means for the UI status stream: `Some(false)` when
/// the window was minimised, `Some(true)` when it is shown at a real size
/// again, `None` for events that say nothing about it (moving, losing focus,
/// being covered by another window).
///
/// Windows reports minimising as a resize, usually to 0 x 0. `is_minimized`
/// asks the window itself and is only called for resize events.
pub fn visibility_after(
    event: &tauri::WindowEvent,
    is_minimized: impl FnOnce() -> Option<bool>,
) -> Option<bool> {
    let tauri::WindowEvent::Resized(size) = event else {
        return None;
    };
    let minimised = is_minimized().unwrap_or(false) || (size.width == 0 && size.height == 0);
    Some(!minimised)
}

#[cfg(test)]
mod tests {
    use super::{visibility_after, StatusGate};
    use tauri::{PhysicalPosition, PhysicalSize, WindowEvent};

    fn resized(w: u32, h: u32) -> WindowEvent {
        WindowEvent::Resized(PhysicalSize::new(w, h))
    }

    #[test]
    fn minimising_hides_and_restoring_shows() {
        // Minimise: Windows resizes to 0 x 0 and the window says "minimised".
        assert_eq!(visibility_after(&resized(0, 0), || Some(true)), Some(false));
        // Either signal alone is enough.
        assert_eq!(
            visibility_after(&resized(1280, 800), || Some(true)),
            Some(false)
        );
        assert_eq!(
            visibility_after(&resized(0, 0), || Some(false)),
            Some(false)
        );
        assert_eq!(visibility_after(&resized(0, 0), || None), Some(false));
        // Restore, maximise or a normal resize: visible.
        assert_eq!(
            visibility_after(&resized(1280, 800), || Some(false)),
            Some(true)
        );
        assert_eq!(visibility_after(&resized(1280, 800), || None), Some(true));
    }

    #[test]
    fn other_window_events_do_not_change_visibility() {
        // A window that merely lost focus or sits behind a game keeps its
        // status stream: only minimising pauses it.
        let asked = std::cell::Cell::new(false);
        let ask = || {
            asked.set(true);
            Some(true)
        };
        assert_eq!(visibility_after(&WindowEvent::Focused(false), ask), None);
        assert_eq!(
            visibility_after(&WindowEvent::Moved(PhysicalPosition::new(0, 0)), || Some(
                true
            )),
            None
        );
        assert!(!asked.get(), "the window is only queried on resize");
    }

    #[test]
    fn minimise_then_restore_pauses_and_resends_status() {
        let mut gate = StatusGate::default();
        assert!(gate.should_send(true, 1));
        let hidden = visibility_after(&resized(0, 0), || Some(true)).unwrap();
        assert!(!gate.should_send(hidden, 2), "paused while minimised");
        let shown = visibility_after(&resized(1280, 800), || Some(false)).unwrap();
        assert!(gate.should_send(shown, 2), "latest status sent on restore");
    }

    #[test]
    fn status_is_paused_while_minimised_and_resent_on_restore() {
        let mut g = StatusGate::default();
        assert!(g.should_send(true, 1), "first frame");
        assert!(!g.should_send(true, 1), "unchanged");
        assert!(g.should_send(true, 2), "changed");
        // Minimised: nothing is sent however often the engine changes.
        for rev in 3..200 {
            assert!(!g.should_send(false, rev));
        }
        // Restored: the current state is sent at once, even if unchanged since.
        assert!(g.should_send(true, 199));
        assert!(!g.should_send(true, 199));
        assert!(g.should_send(true, 200));
    }
}
