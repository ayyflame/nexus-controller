//! Recognising the gamepad collection of a USB DualShock 4.

use crate::{PRODUCT_ID_DUALSHOCK4_V1, PRODUCT_ID_DUALSHOCK4_V2, USB_REPORT_LEN, VENDOR_ID_SONY};
use nexus_controller_core::{ConnectionType, ControllerModel, HidDeviceInfo, Identification};
use nexus_dualsense::{
    classify_origin, detect_connection, USAGE_GAMEPAD, USAGE_PAGE_GENERIC_DESKTOP,
};

/// Returns `Some` if `device` is the gamepad collection of a DualShock 4
/// connected by USB.
///
/// - Vendor Sony and product 0x05C4 or 0x09CC. The DualSense (0x0CE6,
///   0x0DF2) and the wireless adaptor (0x0BA0) are not DualShock 4 devices
///   here.
/// - The Generic Desktop / Game Pad collection, so no other interface of the
///   controller (such as its audio) is opened. A usage page of 0 means the
///   capabilities couldn't be read; it is accepted, as for the DualSense.
/// - USB only. A Bluetooth DualShock 4 sends a different report (0x11 with a
///   CRC) after a mode switch NEXUS doesn't perform, so it isn't claimed.
///   When the transport can't be determined, the 64-byte USB report length
///   decides.
/// - The origin (physical or a software bus such as ViGEmBus) is reported, so
///   the device manager can ignore virtual controllers.
pub fn identify(device: &HidDeviceInfo) -> Option<Identification> {
    if device.vendor_id != VENDOR_ID_SONY {
        return None;
    }
    if !matches!(
        device.product_id,
        PRODUCT_ID_DUALSHOCK4_V1 | PRODUCT_ID_DUALSHOCK4_V2
    ) {
        return None;
    }
    if device.usage_page != 0
        && !(device.usage_page == USAGE_PAGE_GENERIC_DESKTOP && device.usage == USAGE_GAMEPAD)
    {
        return None;
    }
    let connection = match detect_connection(device) {
        ConnectionType::Usb => ConnectionType::Usb,
        ConnectionType::Unknown if device.input_report_len as usize == USB_REPORT_LEN => {
            ConnectionType::Usb
        }
        _ => return None,
    };
    Some(Identification {
        model: ControllerModel::DualShock4,
        connection,
        origin: classify_origin(&device.ancestor_instance_ids),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PRODUCT_ID_DUALSHOCK4_WIRELESS_ADAPTOR;
    use nexus_controller_core::DeviceOrigin;

    /// Shape of a DualShock 4 on a USB port of an Intel host controller.
    pub(crate) fn usb_ds4(pid: u16) -> HidDeviceInfo {
        HidDeviceInfo {
            path: format!(
                r"\\?\hid#vid_054c&pid_{pid:04x}&mi_03#8&1b2c3d4e&0&0000#{{4d1e55b2-f16f-11cf-88cb-001111000030}}"
            ),
            vendor_id: VENDOR_ID_SONY,
            product_id: pid,
            usage_page: 0x01,
            usage: 0x05,
            input_report_len: 64,
            output_report_len: 32,
            ancestor_instance_ids: vec![
                format!(r"USB\VID_054C&PID_{pid:04X}&MI_03\7&2A3B4C5D&0&0003"),
                format!(r"USB\VID_054C&PID_{pid:04X}\5&ABCDEF&0&2"),
                r"USB\ROOT_HUB30\4&1234ABCD&0&0".into(),
                r"PCI\VEN_8086&DEV_A36D&SUBSYS_00000000&REV_10\3&11583659&0&A0".into(),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn both_hardware_revisions_are_physical_usb_dualshock4() {
        for pid in [PRODUCT_ID_DUALSHOCK4_V1, PRODUCT_ID_DUALSHOCK4_V2] {
            let id = identify(&usb_ds4(pid)).expect("identified");
            assert_eq!(id.model, ControllerModel::DualShock4);
            assert_eq!(id.connection, ConnectionType::Usb);
            assert_eq!(id.origin, DeviceOrigin::Physical);
        }
        assert!(crate::revision(PRODUCT_ID_DUALSHOCK4_V2)
            .unwrap()
            .contains("ZCT2"));
    }

    #[test]
    fn dualsense_and_other_sony_products_are_not_dualshock4() {
        for pid in [
            nexus_dualsense::PRODUCT_ID_DUALSENSE,
            nexus_dualsense::PRODUCT_ID_DUALSENSE_EDGE,
            PRODUCT_ID_DUALSHOCK4_WIRELESS_ADAPTOR,
            0x0268, // DualShock 3
        ] {
            assert!(identify(&usb_ds4(pid)).is_none(), "pid {pid:04x}");
        }
        // And the DualSense driver doesn't claim a DualShock 4.
        for pid in [PRODUCT_ID_DUALSHOCK4_V1, PRODUCT_ID_DUALSHOCK4_V2] {
            assert!(nexus_dualsense::identify(&usb_ds4(pid)).is_none());
        }
    }

    #[test]
    fn keyboards_mice_and_other_vendors_are_rejected() {
        let mut d = usb_ds4(PRODUCT_ID_DUALSHOCK4_V1);
        d.vendor_id = 0x046D; // Logitech, same product number by chance
        assert!(identify(&d).is_none());
        for (page, usage) in [(0x01, 0x06), (0x01, 0x02), (0x0C, 0x01), (0xFF00, 0x01)] {
            let mut d = usb_ds4(PRODUCT_ID_DUALSHOCK4_V2);
            d.usage_page = page; // keyboard, mouse, consumer control, vendor
            d.usage = usage;
            assert!(identify(&d).is_none(), "usage {page:04x}/{usage:02x}");
        }
    }

    #[test]
    fn unknown_capabilities_are_accepted_like_the_dualsense() {
        let mut d = usb_ds4(PRODUCT_ID_DUALSHOCK4_V1);
        d.usage_page = 0;
        d.usage = 0;
        assert!(identify(&d).is_some());
    }

    #[test]
    fn bluetooth_dualshock4_is_not_claimed() {
        let d = HidDeviceInfo {
            path: r"\\?\hid#{00001124-0000-1000-8000-00805f9b34fb}_vid&0002054c_pid&09cc#9&1&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}".into(),
            vendor_id: VENDOR_ID_SONY,
            product_id: PRODUCT_ID_DUALSHOCK4_V2,
            usage_page: 1,
            usage: 5,
            input_report_len: 547,
            ancestor_instance_ids: vec![
                r"BTHENUM\{00001124-0000-1000-8000-00805F9B34FB}_VID&0002054C_PID&09CC\8&1&0&A0B1C2D3E4F5_C00000000".into(),
            ],
            ..Default::default()
        };
        assert!(identify(&d).is_none());
    }

    #[test]
    fn unknown_transport_needs_the_usb_report_length() {
        let mut d = usb_ds4(PRODUCT_ID_DUALSHOCK4_V1);
        d.ancestor_instance_ids.clear();
        d.path = "opaque".into();
        d.input_report_len = 64;
        assert_eq!(identify(&d).unwrap().connection, ConnectionType::Usb);
        d.input_report_len = 0;
        assert!(identify(&d).is_none());
    }

    #[test]
    fn a_vigembus_virtual_dualshock4_is_identified_as_virtual() {
        // ViGEmBus emulates 054C:05C4 under a ROOT-enumerated bus. It must be
        // recognised (so it can be ignored), never read as a physical pad.
        let mut d = usb_ds4(PRODUCT_ID_DUALSHOCK4_V1);
        d.ancestor_instance_ids = vec![
            r"USB\VID_054C&PID_05C4\1&2D595CA7&0&01".into(),
            r"ROOT\SYSTEM\0001".into(),
        ];
        assert_eq!(identify(&d).unwrap().origin, DeviceOrigin::Virtual);
    }
}
