//! The extension point for physical controller support.

use crate::device::{ConnectionType, ControllerModel, DeviceOrigin};
use crate::hid::{HidConnection, HidDeviceInfo, HidError};
use crate::state::ControllerState;
use thiserror::Error;

/// Result of a driver recognising a HID device.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identification {
    pub model: ControllerModel,
    pub connection: ConnectionType,
    pub origin: DeviceOrigin,
}

/// Errors for reports that cannot be turned into a [`ControllerState`].
/// These are expected occasionally and must never crash the session.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ReportError {
    #[error("empty report")]
    Empty,
    #[error("unsupported report id 0x{0:02X}")]
    UnsupportedReportId(u8),
    #[error(
        "report 0x{report_id:02X} too short: expected at least {expected} bytes, got {actual}"
    )]
    TooShort {
        report_id: u8,
        expected: usize,
        actual: usize,
    },
    #[error("checksum mismatch: report says 0x{reported:08X}, computed 0x{computed:08X}")]
    ChecksumMismatch { reported: u32, computed: u32 },
    /// The report has the right ID and length but contradicts its own
    /// format (for example an impossible count field).
    #[error("malformed report 0x{report_id:02X}: {reason}")]
    Malformed { report_id: u8, reason: &'static str },
}

/// Stateful decoder from raw reports to normalized state. One per session.
pub trait ReportParser: Send {
    fn parse(&mut self, report: &[u8]) -> Result<ControllerState, ReportError>;
}

/// Support for one family of physical controllers.
pub trait ControllerDriver: Send + Sync {
    /// Short identifier used in logs.
    fn name(&self) -> &'static str;

    /// USB vendor IDs this driver cares about. Backends use this to avoid
    /// querying unrelated HID devices.
    fn vendor_ids(&self) -> &'static [u16];

    /// Returns `Some` if this driver supports the device.
    fn identify(&self, device: &HidDeviceInfo) -> Option<Identification>;

    /// One-time setup after the connection opens (for example switching a
    /// Bluetooth controller into full-report mode). Must be non-destructive.
    fn initialize(
        &self,
        _connection: &mut dyn HidConnection,
        _device: &HidDeviceInfo,
        _identification: &Identification,
    ) -> Result<(), HidError> {
        Ok(())
    }

    fn create_parser(&self, identification: &Identification) -> Box<dyn ReportParser>;
}
