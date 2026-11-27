//! Pushes engine state to the UI.
//!
//! The engine never calls into Tauri. This thread polls the engine at a fixed
//! UI rate, which decouples controller input (≈250 Hz or more) from rendering.
//! A stalled webview therefore cannot back-pressure the input path.

use nexus_engine::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const EVENT_STATUS: &str = "nexus://status";
pub const EVENT_ENGINE: &str = "nexus://engine-event";
const FRAME: Duration = Duration::from_millis(16);
/// Loop period while the window is minimised or hidden: only engine events
/// are forwarded, so there is no reason to wake 60 times a second.
const HIDDEN_FRAME: Duration = Duration::from_millis(100);
/// Fastest status rate while the window is visible but not focused, e.g.
/// behind or beside a game. Every status update re-renders the UI (and the
/// 3D controller view on the GPU); 60 of them a second competed with the
/// game for the GPU and CPU (docs/performance-investigation.md).
pub(crate) const UNFOCUSED_INTERVAL: Duration = Duration::from_millis(250);

/// Decides when to send a status update.
/// - Minimised or hidden: nothing is sent (no serialising, no IPC, no
///   re-rendering). When the window becomes visible again the current
///   status is sent immediately.
/// - Visible and focused: every change, up to the bridge's 60 Hz.
/// - Visible but not focused (the user is in a game): at most one update
///   per [`UNFOCUSED_INTERVAL`]. Regaining focus sends the current status
///   at once.
#[derive(Debug, Default)]
pub(crate) struct StatusGate {
    last_revision: u64,
    was_visible: bool,
    was_focused: bool,
    last_sent: Option<Instant>,
}

impl StatusGate {
    pub(crate) fn should_send(
        &mut self,
        visible: bool,
        focused: bool,
        revision: u64,
        now: Instant,
    ) -> bool {
        let became_visible = visible && !self.was_visible;
        let became_focused = focused && !self.was_focused;
        self.was_visible = visible;
        self.was_focused = focused;
        if !visible {
            return false;
        }
        let changed = revision != self.last_revision;
        let send = became_visible
            || (focused && (became_focused || changed))
            || (!focused
                && changed
                && self
                    .last_sent
                    .is_none_or(|t| now.duration_since(t) >= UNFOCUSED_INTERVAL));
        if send {
            self.last_revision = revision;
            self.last_sent = Some(now);
        }
        send
    }
}

pub struct Bridge {
    stop: Arc<AtomicBool>,
    visible: Arc<AtomicBool>,
    focused: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Bridge {
    pub fn spawn(app: AppHandle, engine: Arc<Engine>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let visible = Arc::new(AtomicBool::new(true));
        let shown = visible.clone();
        // Assume focus until Windows says otherwise (a new window is focused).
        let focused = Arc::new(AtomicBool::new(true));
        let active = focused.clone();
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
                    let visible = shown.load(Ordering::Acquire);
                    if gate.should_send(
                        visible,
                        active.load(Ordering::Acquire),
                        engine.revision(),
                        Instant::now(),
                    ) {
                        let _ = app.emit(EVENT_STATUS, engine.status());
                    }
                    std::thread::sleep(if visible { FRAME } else { HIDDEN_FRAME });
                }
            })
            .expect("failed to spawn UI bridge thread");
        Self {
            stop,
            visible,
            focused,
            thread: Mutex::new(Some(thread)),
        }
    }

    /// Called from window events: false while minimised or hidden.
    pub fn set_visible(&self, visible: bool) {
        self.visible.store(visible, Ordering::Release);
    }

    /// Called from window focus events: false while another program (such
    /// as a game) is in front. The status stream then slows down.
    pub fn set_focused(&self, focused: bool) {
        self.focused.store(focused, Ordering::Release);
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
    use super::{visibility_after, StatusGate, UNFOCUSED_INTERVAL};
    use std::time::{Duration, Instant};
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
        let now = Instant::now();
        let mut gate = StatusGate::default();
        assert!(gate.should_send(true, true, 1, now));
        let hidden = visibility_after(&resized(0, 0), || Some(true)).unwrap();
        assert!(
            !gate.should_send(hidden, true, 2, now),
            "paused while minimised"
        );
        let shown = visibility_after(&resized(1280, 800), || Some(false)).unwrap();
        assert!(
            gate.should_send(shown, true, 2, now),
            "latest status sent on restore"
        );
    }

    #[test]
    fn status_is_paused_while_minimised_and_resent_on_restore() {
        let now = Instant::now();
        let mut g = StatusGate::default();
        assert!(g.should_send(true, true, 1, now), "first frame");
        assert!(!g.should_send(true, true, 1, now), "unchanged");
        assert!(g.should_send(true, true, 2, now), "changed");
        // Minimised: nothing is sent however often the engine changes.
        for rev in 3..200 {
            assert!(!g.should_send(false, true, rev, now));
        }
        // Restored: the current state is sent at once, even if unchanged since.
        assert!(g.should_send(true, true, 199, now));
        assert!(!g.should_send(true, true, 199, now));
        assert!(g.should_send(true, true, 200, now));
    }

    /// Simulates one second of the bridge loop (16 ms frames) with the
    /// engine changing on every frame, as it does while sticks move.
    fn sends_per_second(focused: bool) -> usize {
        let start = Instant::now();
        let mut g = StatusGate::default();
        (0..63u64)
            .filter(|i| {
                let now = start + Duration::from_millis(16 * i);
                g.should_send(true, focused, i + 1, now)
            })
            .count()
    }

    #[test]
    fn a_focused_window_gets_every_change_and_an_unfocused_one_four_a_second() {
        assert_eq!(sends_per_second(true), 63);
        let background = sends_per_second(false);
        assert!(
            (4..=5).contains(&background),
            "unfocused: {background} updates in one second"
        );
    }

    #[test]
    fn regaining_focus_sends_the_current_status_at_once() {
        let t0 = Instant::now();
        let mut g = StatusGate::default();
        assert!(g.should_send(true, false, 1, t0), "first status, unfocused");
        let soon = t0 + Duration::from_millis(20);
        assert!(!g.should_send(true, false, 2, soon), "throttled");
        assert!(
            g.should_send(true, true, 2, soon),
            "focused again: sent now"
        );
        assert!(g.should_send(true, true, 3, soon), "then every change");
        // Losing focus starts the slow rate from the last update.
        assert!(!g.should_send(true, false, 4, soon));
        assert!(g.should_send(true, false, 4, soon + UNFOCUSED_INTERVAL));
        // Nothing changed: nothing is sent while unfocused.
        let later = soon + UNFOCUSED_INTERVAL * 3;
        assert!(!g.should_send(true, false, 4, later));
        let back = later + Duration::from_millis(1);
        assert!(g.should_send(true, true, 4, back), "focus regained: resent");
        assert!(!g.should_send(true, true, 4, back), "then only on change");
    }

    #[test]
    fn a_hidden_window_gets_nothing_focused_or_not() {
        let now = Instant::now();
        let mut g = StatusGate::default();
        for rev in 1..50 {
            assert!(!g.should_send(false, rev % 2 == 0, rev, now));
        }
    }
}
