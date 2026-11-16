//! **Experimental** ViGEmBus backend: a virtual Xbox 360 controller.
//!
//! - ViGEmBus is a third-party driver that was retired upstream (Nov 2023).
//!   It is used for experimental testing only, never bundled or installed by
//!   NEXUS; the user installs it from the official release themselves.
//! - Only Xbox 360 (XInput) output is offered. DualShock 4 is not enabled.
//! - Each virtual controller has its own connection to the bus driver. If
//!   NEXUS exits or crashes, Windows closes that connection and ViGEmBus
//!   removes the controller, so no virtual device is left behind.
//! - Talks to the driver through the MIT-licensed `vigem-client` crate (pure
//!   Rust, no DLL). Replace this file to change drivers; nothing else in NEXUS
//!   depends on ViGEm.

use std::collections::HashMap;

use nexus_controller_core::{ControllerState, VirtualOutputKind};
use vigem_client::{Client, Error as VigemError, TargetId, XButtons, XGamepad, Xbox360Wired};

use crate::translate::to_xusb;
use crate::{BackendStatus, OutputError, VirtualControllerBackend, VirtualDeviceHandle};

pub const NOT_INSTALLED: &str = "ViGEmBus is not installed. It is an optional third-party driver: \
see Controller › Virtual Output for how to install it yourself.";

fn describe(e: VigemError) -> String {
    match e {
        VigemError::BusNotFound => NOT_INSTALLED.to_owned(),
        VigemError::BusAccessFailed(code) => {
            format!("ViGEmBus is installed but could not be opened (Windows error {code}). Restart the PC or reinstall ViGEmBus.")
        }
        VigemError::BusVersionMismatch => "The installed ViGEmBus version is not compatible. Install ViGEmBus 1.22.".to_owned(),
        VigemError::NoFreeSlot => "ViGEmBus has no free controller slots. Close other apps that create virtual controllers.".to_owned(),
        other => format!("ViGEmBus error: {other:?}"),
    }
}

#[derive(Default)]
pub struct ViGEmBackend {
    targets: HashMap<u64, Xbox360Wired<Client>>,
    next: u64,
}

impl ViGEmBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl VirtualControllerBackend for ViGEmBackend {
    fn name(&self) -> &'static str {
        "vigembus (experimental)"
    }

    fn status(&self) -> BackendStatus {
        // Opening the bus is read-only and cheap; the handle closes at once.
        match Client::connect() {
            Ok(_) => BackendStatus::Ready { version: None },
            Err(e) => BackendStatus::Unavailable {
                reason: describe(e),
            },
        }
    }

    fn supports(&self, kind: VirtualOutputKind) -> bool {
        kind == VirtualOutputKind::Xbox360
    }

    fn connect(&mut self, kind: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
        if kind != VirtualOutputKind::Xbox360 {
            return Err(OutputError::UnsupportedMode(kind));
        }
        let client = Client::connect().map_err(|e| OutputError::Unavailable(describe(e)))?;
        let mut target = Xbox360Wired::new(client, TargetId::XBOX360_WIRED);
        target
            .plugin()
            .map_err(|e| OutputError::Backend(describe(e)))?;
        target
            .wait_ready()
            .map_err(|e| OutputError::Backend(describe(e)))?;
        self.next += 1;
        self.targets.insert(self.next, target);
        Ok(VirtualDeviceHandle(self.next))
    }

    fn update(
        &mut self,
        handle: VirtualDeviceHandle,
        state: &ControllerState,
    ) -> Result<(), OutputError> {
        let target = self
            .targets
            .get_mut(&handle.0)
            .ok_or_else(|| OutputError::Backend("virtual controller no longer exists".into()))?;
        let r = to_xusb(state);
        let pad = XGamepad {
            buttons: XButtons(r.buttons),
            left_trigger: r.left_trigger,
            right_trigger: r.right_trigger,
            thumb_lx: r.thumb_lx,
            thumb_ly: r.thumb_ly,
            thumb_rx: r.thumb_rx,
            thumb_ry: r.thumb_ry,
        };
        target
            .update(&pad)
            .map_err(|e| OutputError::Backend(describe(e)))
    }

    fn disconnect(&mut self, handle: VirtualDeviceHandle) -> Result<(), OutputError> {
        if let Some(mut target) = self.targets.remove(&handle.0) {
            // Neutral first (the manager also does this), then unplug.
            let _ = target.update(&XGamepad::default());
            target
                .unplug()
                .map_err(|e| OutputError::Backend(describe(e)))?;
        }
        Ok(())
    }
}
