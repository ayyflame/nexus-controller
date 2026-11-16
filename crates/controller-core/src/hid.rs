//! Platform-neutral view of a HID device and an open HID connection.

use serde::Serialize;
use std::time::Duration;
use thiserror::Error;

/// Everything NEXUS learned about one HID top-level collection during
/// enumeration. Collected by the platform backend; consumed by drivers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HidDeviceInfo {
    /// OS device interface path. Used as the connection key.
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub release_number: u16,
    /// HID usage page / usage of the top-level collection. `0` if unknown.
    pub usage_page: u16,
    pub usage: u16,
    /// Report lengths including the report-ID byte, as reported by the OS.
    pub input_report_len: u16,
    pub output_report_len: u16,
    pub feature_report_len: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
    /// PnP instance ID of the HID device node, e.g. `HID\VID_054C&PID_0CE6\...`.
    pub instance_id: Option<String>,
    /// PnP instance IDs of the ancestors, nearest parent first. Used to tell
    /// physical buses from software-enumerated (virtual) ones.
    pub ancestor_instance_ids: Vec<String>,
}

/// One range of input usages declared in a HID report descriptor, as the OS
/// reports it (Windows `HidP_GetButtonCaps` / `HidP_GetValueCaps`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidUsageRange {
    pub usage_page: u16,
    pub usage_min: u16,
    pub usage_max: u16,
    pub report_id: u8,
    /// Bits per value (values only; 1 for buttons).
    pub bit_size: u16,
    pub report_count: u16,
}

/// One HID interface (top-level collection) of a physical device, with the
/// inputs its descriptor declares. Used by the Report Inspector to see every
/// interface of a controller, including ones NEXUS does not open.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidInterfaceDetails {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub usage_page: u16,
    pub usage: u16,
    pub input_report_len: u16,
    pub output_report_len: u16,
    pub feature_report_len: u16,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub instance_id: Option<String>,
    /// Declared button usages (e.g. Button page 1–15 on a standard DualSense).
    pub input_buttons: Vec<HidUsageRange>,
    /// Declared value usages (sticks, triggers, vendor-defined bytes).
    pub input_values: Vec<HidUsageRange>,
    /// `true` if the descriptor details could not be read.
    pub caps_unavailable: bool,
}

impl HidInterfaceDetails {
    /// Details with no descriptor information (used by non-Windows backends).
    pub fn from_info(info: &HidDeviceInfo) -> Self {
        Self {
            path: info.path.clone(),
            vendor_id: info.vendor_id,
            product_id: info.product_id,
            usage_page: info.usage_page,
            usage: info.usage,
            input_report_len: info.input_report_len,
            output_report_len: info.output_report_len,
            feature_report_len: info.feature_report_len,
            product: info.product.clone(),
            manufacturer: info.manufacturer.clone(),
            instance_id: info.instance_id.clone(),
            caps_unavailable: true,
            ..Default::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum HidError {
    /// The device has gone away. Normal on unplug / power-off.
    #[error("device disconnected")]
    Disconnected,
    #[error("access denied (another application may hold the device exclusively)")]
    AccessDenied,
    #[error("device not found")]
    NotFound,
    #[error("HID access is not supported on this platform: {0}")]
    Unsupported(String),
    #[error("I/O error: {0}")]
    Io(String),
}

/// An open, readable HID connection. Implementations must be safe to move to
/// a dedicated reader thread.
pub trait HidConnection: Send {
    /// Blocks for up to `timeout` waiting for one input report.
    ///
    /// Returns `Ok(0)` on timeout, otherwise the number of bytes written to
    /// `buf` (first byte is the report ID).
    fn read_report(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize, HidError>;

    /// Reads a feature report. `buf[0]` must hold the report ID on entry.
    fn get_feature_report(&mut self, buf: &mut [u8]) -> Result<usize, HidError>;

    /// Writes an output report (`report[0]` is the report ID). Backends that
    /// cannot write return `Unsupported`.
    fn write_output_report(&mut self, _report: &[u8]) -> Result<usize, HidError> {
        Err(HidError::Unsupported("output reports".into()))
    }
}
