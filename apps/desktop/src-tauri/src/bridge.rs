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

#[cfg(test)]
mod tests {
    use super::StatusGate;

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
