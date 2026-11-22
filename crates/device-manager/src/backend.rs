use nexus_controller_core::{HidConnection, HidDeviceInfo, HidError, HidInterfaceDetails};
use std::collections::HashMap;
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

/// The vendor ID written in a HID device path, if there is one: USB paths
/// carry `VID_054C`, Bluetooth ones `VID&0002054C` (the last four digits
/// are the vendor). Read from the path alone, without opening the device.
pub fn vendor_id_in_path(path: &str) -> Option<u16> {
    let lower = path.to_ascii_lowercase();
    let hex_run = |from: usize| -> &str {
        let rest = &lower[from..];
        let end = rest
            .find(|c: char| !c.is_ascii_hexdigit())
            .unwrap_or(rest.len());
        &rest[..end]
    };
    if let Some(i) = lower.find("vid_") {
        let run = hex_run(i + 4);
        if run.len() == 4 {
            return u16::from_str_radix(run, 16).ok();
        }
    }
    if let Some(i) = lower.find("vid&") {
        let run = hex_run(i + 4);
        if run.len() >= 4 {
            return u16::from_str_radix(&run[run.len() - 4..], 16).ok();
        }
    }
    None
}

/// The scan step of [`HidBackend::enumerate`] on Windows, kept free of
/// system calls so it can be tested. `present` is every HID interface
/// (path plus what `query` needs); `query` opens one and reads it.
///
/// Every scan used to open every HID device in the PC (mouse, keyboard,
/// headset, ...) and read three descriptor strings from the controller, which
/// are USB requests. Now:
/// - interfaces whose path names another vendor are never opened;
/// - a controller already read and still present is not read again
///   (`cache`, keyed by interface path, forgets interfaces that are gone);
/// - paths without a vendor ID are queried as before.
pub fn scan_present<I>(
    present: Vec<(String, I)>,
    vendor_ids: &[u16],
    cache: &mut HashMap<String, HidDeviceInfo>,
    mut query: impl FnMut(&str, I) -> Option<HidDeviceInfo>,
) -> Vec<HidDeviceInfo> {
    cache.retain(|path, _| present.iter().any(|(p, _)| p == path));
    let mut out = Vec::new();
    for (path, extra) in present {
        if vendor_id_in_path(&path).is_some_and(|v| !vendor_ids.contains(&v)) {
            continue;
        }
        if let Some(info) = cache
            .get(&path)
            .filter(|i| vendor_ids.contains(&i.vendor_id))
        {
            out.push(info.clone());
            continue;
        }
        if let Some(info) = query(&path, extra) {
            // A device read while it was still starting up may not answer
            // the string requests yet; read it again next time.
            if info.product.is_some() {
                cache.insert(path, info.clone());
            }
            out.push(info);
        }
    }
    out
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

    const PAD: &str =
        r"\\?\hid#vid_054c&pid_0ce6&mi_03#8&2a1b&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";
    const MOUSE: &str =
        r"\\?\HID#VID_046D&PID_C08B&MI_00#8&1234&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";
    const KEYBOARD: &str =
        r"\\?\hid#vid_1532&pid_0226&mi_01&col02#9&3c&0&0001#{4d1e55b2-f16f-11cf-88cb-001111000030}";
    const BT_PAD: &str = r"\\?\hid#{00001124-0000-1000-8000-00805f9b34fb}_vid&0002054c_pid&0ce6#9&1&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";
    const NO_VID: &str =
        r"\\?\hid#hidhide_virtual#1&2&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";

    #[test]
    fn vendor_is_read_from_usb_and_bluetooth_paths() {
        assert_eq!(vendor_id_in_path(PAD), Some(0x054c));
        assert_eq!(vendor_id_in_path(MOUSE), Some(0x046d), "upper case");
        assert_eq!(vendor_id_in_path(KEYBOARD), Some(0x1532));
        assert_eq!(vendor_id_in_path(BT_PAD), Some(0x054c));
        assert_eq!(vendor_id_in_path(NO_VID), None);
        assert_eq!(vendor_id_in_path(r"hid#vid_05#x"), None, "too short");
        assert_eq!(vendor_id_in_path(r"hid#vid_zz12#x"), None, "not hex");
    }

    fn pad_info(path: &str, product: Option<&str>) -> HidDeviceInfo {
        HidDeviceInfo {
            path: path.into(),
            vendor_id: 0x054c,
            product: product.map(str::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn other_vendors_are_never_opened_and_a_known_controller_is_read_once() {
        let present = || {
            [PAD, MOUSE, KEYBOARD, NO_VID]
                .iter()
                .map(|p| (p.to_string(), ()))
                .collect::<Vec<_>>()
        };
        let mut cache = HashMap::new();
        let mut opened: Vec<String> = Vec::new();
        let mut query = |path: &str, _: ()| {
            opened.push(path.to_owned());
            (path == PAD).then(|| pad_info(PAD, Some("DualSense Wireless Controller")))
        };
        // First scan: the controller and the path without a vendor are read.
        let found = scan_present(present(), &[0x054c], &mut cache, &mut query);
        assert_eq!(
            found,
            vec![pad_info(PAD, Some("DualSense Wireless Controller"))]
        );
        // Many later scans: only the interface without a vendor ID is opened.
        for _ in 0..100 {
            let again = scan_present(present(), &[0x054c], &mut cache, &mut query);
            assert_eq!(again, found);
        }
        assert_eq!(opened.iter().filter(|p| *p == PAD).count(), 1);
        assert_eq!(opened.iter().filter(|p| *p == NO_VID).count(), 101);
        assert!(!opened.iter().any(|p| p == MOUSE || p == KEYBOARD));
    }

    #[test]
    fn an_unplugged_controller_is_forgotten_and_read_again_when_it_returns() {
        let mut cache = HashMap::new();
        let mut reads = 0;
        let mut query = |_: &str, _: ()| {
            reads += 1;
            Some(pad_info(PAD, Some("DualSense")))
        };
        let with_pad = || vec![(PAD.to_string(), ())];
        assert_eq!(
            scan_present(with_pad(), &[0x054c], &mut cache, &mut query).len(),
            1
        );
        assert!(scan_present(vec![], &[0x054c], &mut cache, &mut query).is_empty());
        assert!(
            cache.is_empty(),
            "gone from the system, gone from the cache"
        );
        assert_eq!(
            scan_present(with_pad(), &[0x054c], &mut cache, &mut query).len(),
            1
        );
        assert_eq!(reads, 2);
    }

    #[test]
    fn a_controller_that_did_not_answer_yet_is_read_again() {
        let mut cache = HashMap::new();
        let mut answers = vec![
            Some(pad_info(PAD, Some("DualSense"))),
            Some(pad_info(PAD, None)),
        ];
        let mut query = |_: &str, _: ()| answers.pop().flatten();
        let present = || vec![(PAD.to_string(), ())];
        let first = scan_present(present(), &[0x054c], &mut cache, &mut query);
        assert_eq!(first[0].product, None, "still reported, but not kept");
        let second = scan_present(present(), &[0x054c], &mut cache, &mut query);
        assert_eq!(second[0].product.as_deref(), Some("DualSense"));
        assert!(cache.contains_key(PAD));
    }
}
