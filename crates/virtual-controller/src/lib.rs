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
}

/// Enforces one virtual device per physical controller.
pub struct VirtualOutputManager {
    backend: Box<dyn VirtualControllerBackend>,
    requested: VirtualOutputKind,
    active: Option<(VirtualOutputKind, VirtualDeviceHandle)>,
    last_error: Option<String>,
}

impl VirtualOutputManager {
    pub fn new(backend: Box<dyn VirtualControllerBackend>) -> Self {
        Self {
            backend,
            requested: VirtualOutputKind::Disabled,
            active: None,
            last_error: None,
        }
    }

    pub fn status(&self) -> OutputStatus {
        OutputStatus {
            requested: self.requested,
            active: self.active.map(|(k, _)| k),
            backend: self.backend.name().to_owned(),
            backend_status: self.backend.status(),
            last_error: self.last_error.clone(),
        }
    }

    /// Switches the output mode.
    ///
    /// The existing virtual device is disconnected first. If that fails, the
    /// new device is **not** created, so two virtual controllers never exist
    /// for one physical controller.
    pub fn set_mode(&mut self, kind: VirtualOutputKind) -> Result<(), OutputError> {
        self.requested = kind;
        if self.active.map(|(k, _)| k) == Some(kind) {
            return Ok(());
        }
        let result = self.apply();
        self.last_error = result.as_ref().err().map(|e| e.to_string());
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
        Ok(())
    }

    /// Forwards processed state to the active virtual device, if any.
    pub fn submit(&mut self, state: &ControllerState) {
        if let Some((_, handle)) = self.active {
            if let Err(e) = self.backend.update(handle, state) {
                self.last_error = Some(e.to_string());
            }
        }
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
