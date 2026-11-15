use nexus_controller_core::{HidConnection, HidDeviceInfo, HidError};
use std::sync::Arc;

/// Platform HID access.
pub trait HidBackend: Send + Sync {
    fn name(&self) -> &'static str;

    /// `false` if this backend can never find devices on this platform.
    fn is_available(&self) -> bool {
        true
    }

    /// Lists present HID collections whose vendor ID is in `vendor_ids`.
    /// Devices from other vendors are skipped without being queried further.
    fn enumerate(&self, vendor_ids: &[u16]) -> Result<Vec<HidDeviceInfo>, HidError>;

    /// Opens a device for reading input reports.
    fn open(&self, device: &HidDeviceInfo) -> Result<Box<dyn HidConnection>, HidError>;
}

/// Used on platforms without a HID implementation. It never reports devices,
/// and says why, so the UI can show "unsupported platform" instead of
/// "no controller connected".
#[derive(Debug, Default)]
pub struct UnsupportedBackend;

impl HidBackend for UnsupportedBackend {
    fn name(&self) -> &'static str {
        "unsupported"
    }
    fn is_available(&self) -> bool {
        false
    }
    fn enumerate(&self, _: &[u16]) -> Result<Vec<HidDeviceInfo>, HidError> {
        Err(HidError::Unsupported(format!(
            "NEXUS reads controllers through Windows HID APIs; this build is running on {}",
            std::env::consts::OS
        )))
    }
    fn open(&self, _: &HidDeviceInfo) -> Result<Box<dyn HidConnection>, HidError> {
        Err(HidError::Unsupported(std::env::consts::OS.to_owned()))
    }
}

/// The real HID backend for the current platform.
pub fn platform_backend() -> Arc<dyn HidBackend> {
    #[cfg(windows)]
    {
        Arc::new(crate::windows::WindowsHidBackend::new())
    }
    #[cfg(not(windows))]
    {
        Arc::new(UnsupportedBackend)
    }
}
