use nexus_controller_core::{HidConnection, HidDeviceInfo, HidError, HidInterfaceDetails};
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

    /// Every HID interface that belongs to the same physical USB device as
    /// `of` (same composite USB parent), **including other vendors' and
    /// usages**, for diagnostics. Read-only: interfaces are only queried,
    /// never opened for reading. The default implementation can only see
    /// interfaces of `of`'s own vendor and has no descriptor details.
    fn related_interfaces(&self, of: &HidDeviceInfo) -> Result<Vec<HidInterfaceDetails>, HidError> {
        let parent = composite_parent(&of.ancestor_instance_ids);
        Ok(self
            .enumerate(&[of.vendor_id])?
            .iter()
            .filter(|d| {
                d.path == of.path
                    || (parent.is_some() && composite_parent(&d.ancestor_instance_ids) == parent)
            })
            .map(HidInterfaceDetails::from_info)
            .collect())
    }
}

/// The PnP instance ID of the physical USB device a HID interface belongs to:
/// the nearest `USB\` ancestor that is not a composite-device function
/// (`&MI_xx`). `None` if the ancestry has no USB device.
pub fn composite_parent(ancestors: &[String]) -> Option<&str> {
    let usb = |a: &&String| a.to_ascii_uppercase().starts_with("USB\\");
    ancestors
        .iter()
        .filter(usb)
        .find(|a| !a.to_ascii_uppercase().contains("&MI_"))
        .map(String::as_str)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composite_parent_skips_interface_functions_and_hubs_after_it() {
        let a = vec![
            r"USB\VID_054C&PID_0CE6&MI_03\7&1F2E&0&0003".to_owned(),
            r"USB\VID_054C&PID_0CE6\6&ABCDEF&0&3".to_owned(),
            r"USB\ROOT_HUB30\5&1234&0&0".to_owned(),
        ];
        assert_eq!(
            composite_parent(&a),
            Some(r"USB\VID_054C&PID_0CE6\6&ABCDEF&0&3")
        );
        assert_eq!(composite_parent(&[r"HID\X".to_owned()]), None);
        assert_eq!(composite_parent(&[]), None);
    }
}
