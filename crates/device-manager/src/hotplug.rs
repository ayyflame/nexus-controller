//! Device arrival/removal notifications.
//!
//! On Windows, NEXUS registers for HID device-interface notifications with
//! `CM_Register_Notification`, so a controller plugged in or paired is picked
//! up immediately instead of on the next poll. Polling remains as a slower
//! safety net. On other platforms, registration reports `Unsupported`.

use std::sync::Arc;

/// Called (from an OS thread) whenever a HID interface arrives or leaves.
/// Must be cheap and non-blocking.
pub type HotplugCallback = Arc<dyn Fn() + Send + Sync>;

/// Keeps the registration alive; dropping it unregisters.
pub struct HotplugGuard {
    #[cfg(windows)]
    _inner: crate::windows::NotificationHandle,
}

/// Starts watching for HID arrivals and removals.
pub fn watch_hid_devices(callback: HotplugCallback) -> Result<HotplugGuard, String> {
    #[cfg(windows)]
    {
        crate::windows::NotificationHandle::register(callback).map(|h| HotplugGuard { _inner: h })
    }
    #[cfg(not(windows))]
    {
        let _ = callback;
        Err(format!(
            "device notifications are not supported on {}",
            std::env::consts::OS
        ))
    }
}
