//! Virtual controller output.
//!
//! [`VirtualControllerBackend`] is the replaceable boundary to whatever
//! driver creates the virtual gamepad (see `docs/virtual-driver-evaluation.md`).
//! [`VirtualOutputManager`] owns the policy that sits above any backend:
//! at most one virtual device per physical controller, and the previous
//! device is always disconnected before a different mode is connected.
//!
//! * [`translate`] converts output state to Xbox 360 (XUSB) and DualShock 4
//!   report layouts; any driver backend uses it.
//! * [`drivers`] detects (read-only) whether ViGEmBus and HidHide exist.
//!
//! * [`platform_backend`] picks the backend for this build. On Windows that is
//!   the **experimental** ViGEmBus backend (Xbox 360 only), which works only if
//!   the user installed ViGEmBus themselves; elsewhere [`UnavailableBackend`].
//!
//! Before any virtual device is removed (switching output, physical
//! disconnect, shutdown) the manager sends a neutral report, so a game never
//! sees a button that stays held.

#![deny(unsafe_code)]

pub mod drivers;
pub mod translate;
#[cfg(windows)]
pub mod vigem;

use nexus_controller_core::{ControllerState, VirtualOutputKind};
use serde::Serialize;
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum BackendStatus {
    /// The backend can create devices.
    Ready { version: Option<String> },
    /// The backend cannot create devices; `reason` is user-presentable.
    Unavailable { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum OutputError {
    #[error("virtual output backend unavailable: {0}")]
    Unavailable(String),
    #[error("{0:?} output is not supported by this backend")]
    UnsupportedMode(VirtualOutputKind),
    #[error("backend error: {0}")]
    Backend(String),
}

/// Opaque handle to a device created by a backend.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct VirtualDeviceHandle(pub u64);

/// A driver-specific way to create and feed virtual gamepads.
pub trait VirtualControllerBackend: Send {
    fn name(&self) -> &'static str;
    fn status(&self) -> BackendStatus;
    fn supports(&self, kind: VirtualOutputKind) -> bool;
    fn connect(&mut self, kind: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError>;
    fn update(
        &mut self,
        handle: VirtualDeviceHandle,
        state: &ControllerState,
    ) -> Result<(), OutputError>;
    fn disconnect(&mut self, handle: VirtualDeviceHandle) -> Result<(), OutputError>;
    /// Which player slot Windows gave the device (0 = player 1), if the
    /// backend can tell. Games that only listen to player 1 need slot 0.
    fn player_index(&mut self, _handle: VirtualDeviceHandle) -> Option<u8> {
        None
    }
    /// Called while no new input arrives. A backend whose driver can lose an
    /// update sends its last state again here, so the device cannot stay on
    /// an older state. Sending an identical state must be harmless.
    fn keep_alive(&mut self, _handle: VirtualDeviceHandle) -> Result<(), OutputError> {
        Ok(())
    }
}

/// The backend for this platform: experimental ViGEmBus on Windows.
pub fn platform_backend() -> Box<dyn VirtualControllerBackend> {
    #[cfg(windows)]
    {
        Box::new(vigem::ViGEmBackend::new())
    }
    #[cfg(not(windows))]
    {
        Box::new(UnavailableBackend)
    }
}

/// Neutral state: nothing pressed, sticks centred, triggers released.
fn neutral() -> ControllerState {
    ControllerState::default()
}

/// Used where no driver backend exists (non-Windows builds, tests).
#[derive(Debug, Default)]
pub struct UnavailableBackend;

pub const NO_DRIVER_REASON: &str =
    "Virtual controller output needs Windows and the optional ViGEmBus driver.";

impl VirtualControllerBackend for UnavailableBackend {
    fn name(&self) -> &'static str {
        "none"
    }
    fn status(&self) -> BackendStatus {
        BackendStatus::Unavailable {
            reason: NO_DRIVER_REASON.to_owned(),
        }
    }
    fn supports(&self, _kind: VirtualOutputKind) -> bool {
        false
    }
    fn connect(&mut self, _kind: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
        Err(OutputError::Unavailable(NO_DRIVER_REASON.to_owned()))
    }
    fn update(&mut self, _: VirtualDeviceHandle, _: &ControllerState) -> Result<(), OutputError> {
        Err(OutputError::Unavailable(NO_DRIVER_REASON.to_owned()))
    }
    fn disconnect(&mut self, _: VirtualDeviceHandle) -> Result<(), OutputError> {
        Ok(())
    }
}

/// What the manager is doing, for display.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputStatus {
    pub requested: VirtualOutputKind,
    /// The mode of the virtual device that currently exists, if any.
    pub active: Option<VirtualOutputKind>,
    pub backend: String,
    pub backend_status: BackendStatus,
    pub last_error: Option<String>,
    /// XInput player slot of the virtual device (0 = player 1), if known.
    pub player_index: Option<u8>,
    /// The device failed and creating it again is being retried by itself.
    pub retrying: bool,
}

/// Something the engine should log and show (returned once per change).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutputEvent {
    /// The virtual controller stopped working; NEXUS will retry.
    Failed(String),
    /// A retry succeeded; the virtual controller exists again.
    Recovered,
}

/// First retry delay after a driver failure; doubles up to [`RETRY_MAX`].
pub const RETRY_BASE: Duration = Duration::from_secs(1);
pub const RETRY_MAX: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug)]
struct Retry {
    attempts: u32,
    at: Instant,
}

/// Enforces one virtual device per physical controller.
pub struct VirtualOutputManager {
    backend: Box<dyn VirtualControllerBackend>,
    requested: VirtualOutputKind,
    active: Option<(VirtualOutputKind, VirtualDeviceHandle)>,
    player: Option<u8>,
    /// The state most recently submitted (resent after a recovery).
    last: ControllerState,
    last_error: Option<String>,
    retry: Option<Retry>,
    retry_base: Duration,
    event: Option<OutputEvent>,
}

impl VirtualOutputManager {
    pub fn new(backend: Box<dyn VirtualControllerBackend>) -> Self {
        Self {
            backend,
            requested: VirtualOutputKind::Disabled,
            active: None,
            player: None,
            last: neutral(),
            last_error: None,
            retry: None,
            retry_base: RETRY_BASE,
            event: None,
        }
    }

    /// Shorter retry delays (tests only need milliseconds).
    pub fn with_retry_base(mut self, base: Duration) -> Self {
        self.retry_base = base;
        self
    }

    /// The latest failure or recovery, once.
    pub fn take_event(&mut self) -> Option<OutputEvent> {
        self.event.take()
    }

    fn schedule_retry(&mut self, now: Instant) {
        let attempts = self.retry.map_or(0, |r| r.attempts) + 1;
        let delay =
            (self.retry_base * (1u32 << (attempts - 1).min(5))).min(RETRY_MAX.max(self.retry_base));
        self.retry = Some(Retry {
            attempts,
            at: now + delay,
        });
    }

    pub fn status(&self) -> OutputStatus {
        OutputStatus {
            requested: self.requested,
            active: self.active.map(|(k, _)| k),
            backend: self.backend.name().to_owned(),
            backend_status: self.backend.status(),
            last_error: self.last_error.clone(),
            player_index: self.player.filter(|_| self.active.is_some()),
            retrying: self.active.is_none() && self.retry.is_some(),
        }
    }

    /// Switches the output mode.
    ///
    /// The existing virtual device is disconnected first. If that fails, the
    /// new device is **not** created, so two virtual controllers never exist
    /// for one physical controller.
    pub fn set_mode(&mut self, kind: VirtualOutputKind) -> Result<(), OutputError> {
        self.requested = kind;
        self.retry = None;
        if self.active.map(|(k, _)| k) == Some(kind) {
            return Ok(());
        }
        let result = self.apply();
        self.last_error = result.as_ref().err().map(|e| e.to_string());
        if let Err(OutputError::Backend(_)) = &result {
            // The driver is there but refused: try again later by itself.
            self.schedule_retry(Instant::now());
        }
        result
    }

    fn apply(&mut self) -> Result<(), OutputError> {
        if let Some((_, handle)) = self.active {
            self.remove(handle)?;
            self.active = None;
        }
        if self.requested == VirtualOutputKind::Disabled {
            return Ok(());
        }
        if !self.backend.supports(self.requested) {
            return Err(match self.backend.status() {
                BackendStatus::Unavailable { reason } => OutputError::Unavailable(reason),
                BackendStatus::Ready { .. } => OutputError::UnsupportedMode(self.requested),
            });
        }
        let handle = self.backend.connect(self.requested)?;
        self.active = Some((self.requested, handle));
        self.player = self.backend.player_index(handle);
        Ok(())
    }

    /// Forwards processed state to the active virtual device, if any.
    ///
    /// If the driver stops accepting updates, the device is dropped (best
    /// effort), the failure is reported once, and creating it again is
    /// retried with growing delays. If the driver is gone entirely
    /// ("unavailable"), retrying stops until the user checks again.
    pub fn submit(&mut self, state: &ControllerState) {
        let now = Instant::now();
        self.last = *state;
        match self.active {
            Some((_, handle)) => {
                if let Err(e) = self.backend.update(handle, state) {
                    self.device_failed(handle, &e, now);
                }
            }
            None => {
                let Some(retry) = self.retry else { return };
                if now < retry.at || self.requested == VirtualOutputKind::Disabled {
                    return;
                }
                match self.apply() {
                    Ok(()) => {
                        self.retry = None;
                        self.last_error = None;
                        self.event = Some(OutputEvent::Recovered);
                        if let Some((_, handle)) = self.active {
                            let _ = self.backend.update(handle, state);
                        }
                    }
                    Err(e @ OutputError::Backend(_)) => {
                        self.last_error = Some(e.to_string());
                        self.schedule_retry(now);
                    }
                    Err(e) => {
                        // Driver missing or mode unsupported: stop retrying.
                        self.last_error = Some(e.to_string());
                        self.retry = None;
                        self.event = Some(OutputEvent::Failed(e.to_string()));
                    }
                }
            }
        }
    }

    fn device_failed(&mut self, handle: VirtualDeviceHandle, e: &OutputError, now: Instant) {
        let _ = self.backend.disconnect(handle);
        self.active = None;
        let msg = format!("The virtual controller stopped working ({e}). NEXUS will try again.");
        self.last_error = Some(msg.clone());
        self.event = Some(OutputEvent::Failed(msg));
        self.schedule_retry(now);
    }

    /// Call while no new input arrives (idle ticks, unreadable reports).
    ///
    /// - With a device: lets the backend make sure its last state really
    ///   reached the driver (some drivers can lose a single update, which
    ///   matters when nothing is sent after it, such as a final neutral frame).
    /// - After a failure: keeps the automatic re-creation going even though
    ///   no input is coming in, and restores the last state.
    pub fn keep_alive(&mut self) {
        match self.active {
            Some((_, handle)) => {
                if let Err(e) = self.backend.keep_alive(handle) {
                    self.device_failed(handle, &e, Instant::now());
                }
            }
            None if self.retry.is_some() => {
                let last = self.last;
                self.submit(&last);
            }
            None => {}
        }
    }

    /// Sends a neutral report (nothing pressed, sticks centred) to the active
    /// virtual device, if any. Used when the last submitted state can no
    /// longer be trusted, e.g. a macro was stopped while no input arrives.
    pub fn submit_neutral(&mut self) {
        self.submit(&neutral());
    }

    /// Removes the virtual device (on physical disconnect or shutdown).
    pub fn release(&mut self) -> Result<(), OutputError> {
        if let Some((_, handle)) = self.active.take() {
            self.remove(handle)?;
        }
        Ok(())
    }

    /// Sends a neutral report, then disconnects, so no input stays held.
    fn remove(&mut self, handle: VirtualDeviceHandle) -> Result<(), OutputError> {
        let _ = self.backend.update(handle, &neutral());
        self.backend.disconnect(handle)
    }
}

impl Drop for VirtualOutputManager {
    fn drop(&mut self) {
        let _ = self.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Debug, PartialEq)]
    enum Call {
        Connect(VirtualOutputKind),
        Disconnect(u64),
        /// Handle and whether the state was neutral.
        Update(u64, bool),
    }

    #[derive(Default)]
    struct Recording {
        calls: Arc<Mutex<Vec<Call>>>,
        live: Arc<Mutex<Vec<u64>>>,
        next: u64,
        fail_disconnect: bool,
    }

    impl VirtualControllerBackend for Recording {
        fn name(&self) -> &'static str {
            "recording"
        }
        fn status(&self) -> BackendStatus {
            BackendStatus::Ready { version: None }
        }
        fn supports(&self, kind: VirtualOutputKind) -> bool {
            kind != VirtualOutputKind::Disabled
        }
        fn connect(&mut self, kind: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
            self.next += 1;
            self.calls.lock().unwrap().push(Call::Connect(kind));
            self.live.lock().unwrap().push(self.next);
            Ok(VirtualDeviceHandle(self.next))
        }
        fn update(
            &mut self,
            h: VirtualDeviceHandle,
            s: &ControllerState,
        ) -> Result<(), OutputError> {
            self.calls
                .lock()
                .unwrap()
                .push(Call::Update(h.0, *s == ControllerState::default()));
            Ok(())
        }
        fn disconnect(&mut self, h: VirtualDeviceHandle) -> Result<(), OutputError> {
            if self.fail_disconnect {
                return Err(OutputError::Backend("stuck".into()));
            }
            self.calls.lock().unwrap().push(Call::Disconnect(h.0));
            self.live.lock().unwrap().retain(|x| *x != h.0);
            Ok(())
        }
    }

    type Shared<T> = Arc<Mutex<Vec<T>>>;

    fn manager() -> (VirtualOutputManager, Shared<Call>, Shared<u64>) {
        let b = Recording::default();
        let (calls, live) = (b.calls.clone(), b.live.clone());
        (VirtualOutputManager::new(Box::new(b)), calls, live)
    }

    #[test]
    fn switching_disconnects_previous_device_first() {
        let (mut m, calls, live) = manager();
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        m.set_mode(VirtualOutputKind::DualShock4).unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                Call::Connect(VirtualOutputKind::Xbox360),
                Call::Update(1, true),
                Call::Disconnect(1),
                Call::Connect(VirtualOutputKind::DualShock4),
            ]
        );
        assert_eq!(*live.lock().unwrap(), vec![2]);
        assert_eq!(m.status().active, Some(VirtualOutputKind::DualShock4));
    }

    #[test]
    fn same_mode_is_a_no_op() {
        let (mut m, calls, _) = manager();
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        assert_eq!(calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn failed_disconnect_blocks_new_device() {
        let b = Recording {
            fail_disconnect: true,
            ..Default::default()
        };
        let live = b.live.clone();
        let mut m = VirtualOutputManager::new(Box::new(b));
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        assert!(m.set_mode(VirtualOutputKind::DualShock4).is_err());
        assert_eq!(live.lock().unwrap().len(), 1, "must never have two devices");
        assert!(m.status().last_error.is_some());
    }

    #[test]
    fn submit_only_reaches_active_device_and_drop_releases() {
        let (mut m, calls, live) = manager();
        m.submit(&ControllerState::default());
        assert!(calls.lock().unwrap().is_empty());
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        m.submit(&ControllerState::default());
        drop(m);
        let calls = calls.lock().unwrap();
        assert_eq!(
            calls[calls.len() - 2..],
            [Call::Update(1, true), Call::Disconnect(1)],
            "neutral, then removed"
        );
        assert!(live.lock().unwrap().is_empty());
    }

    #[test]
    fn every_removal_sends_a_neutral_report_first() {
        let (mut m, calls, live) = manager();
        let mut held = ControllerState::default();
        held.buttons.south = true;
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        m.submit(&held);
        m.set_mode(VirtualOutputKind::Disabled).unwrap(); // output switched off
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        m.submit(&held);
        m.release().unwrap(); // physical disconnect / shutdown
        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                Call::Connect(VirtualOutputKind::Xbox360),
                Call::Update(1, false),
                Call::Update(1, true),
                Call::Disconnect(1),
                Call::Connect(VirtualOutputKind::Xbox360),
                Call::Update(2, false),
                Call::Update(2, true),
                Call::Disconnect(2),
            ]
        );
        assert!(live.lock().unwrap().is_empty());
        assert!(m.release().is_ok(), "releasing twice is harmless");
    }

    /// A backend whose device can break and recover on demand.
    #[derive(Default)]
    struct Flaky {
        fail_updates: Arc<std::sync::atomic::AtomicBool>,
        fail_connects: Arc<std::sync::atomic::AtomicBool>,
        unavailable: Arc<std::sync::atomic::AtomicBool>,
        connects: Arc<std::sync::atomic::AtomicUsize>,
        live: Arc<std::sync::atomic::AtomicUsize>,
        keep_alives: Arc<std::sync::atomic::AtomicUsize>,
        next: u64,
    }

    impl VirtualControllerBackend for Flaky {
        fn name(&self) -> &'static str {
            "flaky"
        }
        fn status(&self) -> BackendStatus {
            BackendStatus::Ready { version: None }
        }
        fn supports(&self, kind: VirtualOutputKind) -> bool {
            kind == VirtualOutputKind::Xbox360
        }
        fn connect(&mut self, _: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
            use std::sync::atomic::Ordering::SeqCst;
            if self.unavailable.load(SeqCst) {
                return Err(OutputError::Unavailable("driver removed".into()));
            }
            if self.fail_connects.load(SeqCst) {
                return Err(OutputError::Backend("busy".into()));
            }
            self.connects.fetch_add(1, SeqCst);
            self.live.fetch_add(1, SeqCst);
            self.next += 1;
            Ok(VirtualDeviceHandle(self.next))
        }
        fn update(
            &mut self,
            _: VirtualDeviceHandle,
            _: &ControllerState,
        ) -> Result<(), OutputError> {
            if self.fail_updates.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(OutputError::Backend("device gone".into()));
            }
            Ok(())
        }
        fn disconnect(&mut self, _: VirtualDeviceHandle) -> Result<(), OutputError> {
            self.live.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }
        /// Each new device lands in the next player slot.
        fn player_index(&mut self, h: VirtualDeviceHandle) -> Option<u8> {
            Some((h.0 - 1) as u8)
        }
        fn keep_alive(&mut self, _: VirtualDeviceHandle) -> Result<(), OutputError> {
            self.keep_alives
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if self.fail_updates.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(OutputError::Backend("device gone".into()));
            }
            Ok(())
        }
    }

    #[test]
    fn keep_alive_reaches_the_backend_and_drives_recovery_without_new_input() {
        use std::sync::atomic::Ordering::SeqCst;
        let b = Flaky::default();
        let (fail, keep_alives, connects, live) = (
            b.fail_updates.clone(),
            b.keep_alives.clone(),
            b.connects.clone(),
            b.live.clone(),
        );
        let mut m =
            VirtualOutputManager::new(Box::new(b)).with_retry_base(Duration::from_millis(5));
        // Output off: nothing to keep alive.
        m.keep_alive();
        assert_eq!(keep_alives.load(SeqCst), 0);

        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        m.submit(&ControllerState::default());
        m.keep_alive();
        m.keep_alive();
        assert_eq!(
            keep_alives.load(SeqCst),
            2,
            "the backend may resend its last state"
        );
        assert_eq!(m.take_event(), None);

        // The device breaks while no input arrives: noticed by the keep-alive,
        // reported once, and re-created by later keep-alives alone.
        fail.store(true, SeqCst);
        m.keep_alive();
        assert!(matches!(m.take_event(), Some(OutputEvent::Failed(_))));
        assert_eq!(live.load(SeqCst), 0);
        assert!(m.status().retrying);
        fail.store(false, SeqCst);
        std::thread::sleep(Duration::from_millis(40));
        m.keep_alive();
        assert_eq!(m.take_event(), Some(OutputEvent::Recovered));
        assert_eq!((connects.load(SeqCst), live.load(SeqCst)), (2, 1));
        assert!(!m.status().retrying);

        // Switching output off stops everything.
        m.set_mode(VirtualOutputKind::Disabled).unwrap();
        let n = keep_alives.load(SeqCst);
        m.keep_alive();
        assert_eq!(keep_alives.load(SeqCst), n);
        assert_eq!(live.load(SeqCst), 0);
    }

    #[test]
    fn a_failing_virtual_controller_is_dropped_reported_once_and_recreated() {
        use std::sync::atomic::Ordering::SeqCst;
        let b = Flaky::default();
        let (fail, fail_connect, connects, live) = (
            b.fail_updates.clone(),
            b.fail_connects.clone(),
            b.connects.clone(),
            b.live.clone(),
        );
        let mut m =
            VirtualOutputManager::new(Box::new(b)).with_retry_base(Duration::from_millis(5));
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        let s = ControllerState::default();
        m.submit(&s);
        assert_eq!(m.take_event(), None);
        let st = m.status();
        assert_eq!((st.player_index, st.retrying), (Some(0), false), "player 1");

        fail.store(true, SeqCst);
        fail_connect.store(true, SeqCst);
        m.submit(&s);
        assert!(matches!(m.take_event(), Some(OutputEvent::Failed(_))));
        assert_eq!(live.load(SeqCst), 0, "broken device dropped");
        assert_eq!(m.status().active, None);
        let st = m.status();
        assert_eq!(
            (st.player_index, st.retrying),
            (None, true),
            "shown as retrying"
        );
        for _ in 0..3 {
            m.submit(&s);
        }
        assert_eq!(m.take_event(), None, "reported once, not every report");

        // Driver healthy again: the next due retry recreates the device.
        fail.store(false, SeqCst);
        fail_connect.store(false, SeqCst);
        std::thread::sleep(Duration::from_millis(80));
        m.submit(&s);
        assert_eq!(m.take_event(), Some(OutputEvent::Recovered));
        assert_eq!(m.status().active, Some(VirtualOutputKind::Xbox360));
        assert_eq!(m.status().last_error, None);
        let st = m.status();
        assert_eq!(
            (st.player_index, st.retrying),
            (Some(1), false),
            "new slot shown"
        );
        assert_eq!(
            (connects.load(SeqCst), live.load(SeqCst)),
            (2, 1),
            "exactly one device"
        );
    }

    #[test]
    fn retrying_stops_when_the_driver_is_gone_and_output_off_cancels_it() {
        use std::sync::atomic::Ordering::SeqCst;
        let b = Flaky::default();
        let (fail, unavailable, connects) = (
            b.fail_updates.clone(),
            b.unavailable.clone(),
            b.connects.clone(),
        );
        let mut m =
            VirtualOutputManager::new(Box::new(b)).with_retry_base(Duration::from_millis(1));
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        fail.store(true, SeqCst);
        unavailable.store(true, SeqCst);
        let s = ControllerState::default();
        m.submit(&s); // fails, schedules retry
        std::thread::sleep(Duration::from_millis(5));
        m.submit(&s); // retry finds the driver gone
        assert!(m.status().last_error.unwrap().contains("driver removed"));
        unavailable.store(false, SeqCst);
        std::thread::sleep(Duration::from_millis(5));
        m.submit(&s);
        assert_eq!(
            connects.load(SeqCst),
            1,
            "no more automatic retries once the driver is gone"
        );

        // Output off while a retry is pending cancels it.
        let b = Flaky::default();
        let (fail, connects) = (b.fail_updates.clone(), b.connects.clone());
        let mut m =
            VirtualOutputManager::new(Box::new(b)).with_retry_base(Duration::from_millis(1));
        m.set_mode(VirtualOutputKind::Xbox360).unwrap();
        fail.store(true, SeqCst);
        m.submit(&s);
        m.set_mode(VirtualOutputKind::Disabled).unwrap();
        fail.store(false, SeqCst);
        std::thread::sleep(Duration::from_millis(5));
        m.submit(&s);
        assert_eq!(connects.load(SeqCst), 1);
        assert_eq!(m.status().active, None);
    }

    #[test]
    fn neutral_state_translates_to_an_idle_xbox_report() {
        assert_eq!(
            translate::to_xusb(&ControllerState::default()),
            translate::XusbReport::default()
        );
    }

    #[test]
    fn unavailable_backend_reports_reason_and_creates_nothing() {
        let mut m = VirtualOutputManager::new(Box::new(UnavailableBackend));
        let err = m.set_mode(VirtualOutputKind::Xbox360).unwrap_err();
        assert!(matches!(err, OutputError::Unavailable(_)));
        let s = m.status();
        assert_eq!(s.requested, VirtualOutputKind::Xbox360);
        assert_eq!(s.active, None);
        assert!(m.set_mode(VirtualOutputKind::Disabled).is_ok());
    }
}
