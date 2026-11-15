//! Recognising DualSense HID collections and classifying how they are attached.

use crate::report::{BT_REPORT_LEN, USB_REPORT_LEN};
use crate::{
    PRODUCT_ID_DUALSENSE, PRODUCT_ID_DUALSENSE_EDGE, USAGE_GAMEPAD, USAGE_PAGE_GENERIC_DESKTOP,
    VENDOR_ID_SONY,
};
use nexus_controller_core::{
    ConnectionType, ControllerModel, DeviceOrigin, HidDeviceInfo, Identification,
};

/// Service class GUID of the Bluetooth HID profile; appears in the device
/// interface path of Bluetooth Classic HID devices on Windows.
const BT_HID_SERVICE_GUID: &str = "{00001124-0000-1000-8000-00805f9b34fb}";

/// Returns `Some` if `device` is the gamepad collection of a DualSense.
pub fn identify(device: &HidDeviceInfo) -> Option<Identification> {
    if device.vendor_id != VENDOR_ID_SONY {
        return None;
    }
    let model = match device.product_id {
        PRODUCT_ID_DUALSENSE => ControllerModel::DualSense,
        PRODUCT_ID_DUALSENSE_EDGE => ControllerModel::DualSenseEdge,
        _ => return None,
    };
    // A usage page of 0 means the backend could not read capabilities; accept
    // it rather than hide a real controller. Otherwise require the gamepad
    // collection so that we never open an unrelated interface.
    if device.usage_page != 0
        && !(device.usage_page == USAGE_PAGE_GENERIC_DESKTOP && device.usage == USAGE_GAMEPAD)
    {
        return None;
    }
    Some(Identification {
        model,
        connection: detect_connection(device),
        origin: classify_origin(&device.ancestor_instance_ids),
    })
}

fn enumerator(instance_id: &str) -> String {
    instance_id
        .split('\\')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase()
}

/// Determines USB vs Bluetooth. Evidence is used in order of reliability and
/// `Unknown` is returned when none is conclusive.
///
/// 1. The nearest bus ancestor in the PnP tree (`USB\…` vs `BTHENUM\…`).
/// 2. The interface path (Bluetooth HID paths embed the HID service GUID).
/// 3. The input report length (64 on USB, 78 on Bluetooth).
pub fn detect_connection(device: &HidDeviceInfo) -> ConnectionType {
    for id in &device.ancestor_instance_ids {
        match enumerator(id).as_str() {
            "HID" => continue,
            "USB" => return ConnectionType::Usb,
            "BTHENUM" | "BTHLEDEVICE" | "BTHLE" => return ConnectionType::Bluetooth,
            _ => break,
        }
    }

    let path = device.path.to_ascii_lowercase();
    if path.contains(BT_HID_SERVICE_GUID) {
        return ConnectionType::Bluetooth;
    }
    if path.contains("hid#vid_054c&pid_") {
        return ConnectionType::Usb;
    }

    match device.input_report_len as usize {
        USB_REPORT_LEN => ConnectionType::Usb,
        BT_REPORT_LEN => ConnectionType::Bluetooth,
        _ => ConnectionType::Unknown,
    }
}

/// Decides whether a device hangs off real hardware or a software bus.
///
/// Walks the ancestors nearest-first, skipping `HID` and `USB` nodes (a
/// virtual bus such as ViGEmBus also creates `USB\VID_…` children), and
/// classifies by the first node that is something else:
///
/// * `PCI`, `ACPI`, `URS`, `USB4` → host controller → [`DeviceOrigin::Physical`]
/// * `BTHENUM`, `BTHLEDEVICE`, `BTHLE` → Bluetooth stack → `Physical`
/// * `ROOT`, `SWD` → root/software-enumerated bus driver → [`DeviceOrigin::Virtual`]
/// * anything else, or no ancestry information → [`DeviceOrigin::Unknown`]
pub fn classify_origin(ancestors: &[String]) -> DeviceOrigin {
    for id in ancestors {
        return match enumerator(id).as_str() {
            "HID" | "USB" => continue,
            "PCI" | "ACPI" | "URS" | "USB4" => DeviceOrigin::Physical,
            "BTHENUM" | "BTHLEDEVICE" | "BTHLE" => DeviceOrigin::Physical,
            "ROOT" | "SWD" => DeviceOrigin::Virtual,
            _ => DeviceOrigin::Unknown,
        };
    }
    DeviceOrigin::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb_dualsense() -> HidDeviceInfo {
        HidDeviceInfo {
            path: r"\\?\hid#vid_054c&pid_0ce6&mi_03#8&2a5b3c4d&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}".into(),
            vendor_id: VENDOR_ID_SONY,
            product_id: PRODUCT_ID_DUALSENSE,
            usage_page: 0x01,
            usage: 0x05,
            input_report_len: 64,
            ancestor_instance_ids: vec![
                r"USB\VID_054C&PID_0CE6&MI_03\7&1F2E3D4C&0&0003".into(),
                r"USB\VID_054C&PID_0CE6\6&ABCDEF&0&3".into(),
                r"USB\ROOT_HUB30\5&1234ABCD&0&0".into(),
                r"PCI\VEN_8086&DEV_7AE0&SUBSYS_00000000&REV_11\3&11583659&0&A0".into(),
                r"ACPI\PNP0A08\0".into(),
                r"ROOT\ACPI_HAL\0000".into(),
            ],
            ..Default::default()
        }
    }

    fn bt_dualsense() -> HidDeviceInfo {
        HidDeviceInfo {
            path: r"\\?\hid#{00001124-0000-1000-8000-00805f9b34fb}_vid&0002054c_pid&0ce6#9&3a4b5c6d&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}".into(),
            vendor_id: VENDOR_ID_SONY,
            product_id: PRODUCT_ID_DUALSENSE,
            usage_page: 0x01,
            usage: 0x05,
            input_report_len: 78,
            ancestor_instance_ids: vec![
                r"BTHENUM\{00001124-0000-1000-8000-00805F9B34FB}_VID&0002054C_PID&0CE6\8&1A2B3C4D&0&A0B1C2D3E4F5_C00000000".into(),
                r"BTH\MS_BTHBRB\7&2F3E4D5C&0&1".into(),
                r"USB\VID_8087&PID_0026\5&1234ABCD&0&10".into(),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn identifies_usb_dualsense_as_physical_usb() {
        let id = identify(&usb_dualsense()).expect("should identify");
        assert_eq!(id.model, ControllerModel::DualSense);
        assert_eq!(id.connection, ConnectionType::Usb);
        assert_eq!(id.origin, DeviceOrigin::Physical);
    }

    #[test]
    fn identifies_bluetooth_dualsense_as_physical_bluetooth() {
        let id = identify(&bt_dualsense()).expect("should identify");
        assert_eq!(id.connection, ConnectionType::Bluetooth);
        assert_eq!(id.origin, DeviceOrigin::Physical);
    }

    #[test]
    fn identifies_dualsense_edge() {
        let mut d = usb_dualsense();
        d.product_id = PRODUCT_ID_DUALSENSE_EDGE;
        assert_eq!(identify(&d).unwrap().model, ControllerModel::DualSenseEdge);
    }

    #[test]
    fn rejects_other_vendors_and_products() {
        let mut d = usb_dualsense();
        d.vendor_id = 0x045E; // Microsoft
        assert!(identify(&d).is_none());

        let mut d = usb_dualsense();
        d.product_id = 0x05C4; // DualShock 4 (also what ViGEm emulates)
        assert!(identify(&d).is_none());
    }

    #[test]
    fn rejects_non_gamepad_collections() {
        let mut d = usb_dualsense();
        d.usage_page = 0x0C; // consumer control
        d.usage = 0x01;
        assert!(identify(&d).is_none());
    }

    #[test]
    fn accepts_unknown_usage_when_caps_unavailable() {
        let mut d = usb_dualsense();
        d.usage_page = 0;
        d.usage = 0;
        assert!(identify(&d).is_some());
    }

    #[test]
    fn root_enumerated_bus_is_virtual() {
        // Shape of a ViGEmBus child: USB-style IDs under a ROOT\SYSTEM bus.
        let ancestors = vec![
            r"USB\VID_054C&PID_0CE6\1&2D595CA7&0&01".to_string(),
            r"ROOT\SYSTEM\0001".to_string(),
        ];
        assert_eq!(classify_origin(&ancestors), DeviceOrigin::Virtual);

        let mut d = usb_dualsense();
        d.ancestor_instance_ids = ancestors;
        let id = identify(&d).unwrap();
        assert_eq!(id.origin, DeviceOrigin::Virtual);
    }

    #[test]
    fn software_device_is_virtual() {
        let ancestors = vec![r"SWD\VHF\{abcdef}".to_string()];
        assert_eq!(classify_origin(&ancestors), DeviceOrigin::Virtual);
    }

    #[test]
    fn missing_or_unrecognised_ancestry_is_unknown() {
        assert_eq!(classify_origin(&[]), DeviceOrigin::Unknown);
        assert_eq!(
            classify_origin(&[r"USB\VID_054C&PID_0CE6\x".to_string()]),
            DeviceOrigin::Unknown
        );
        assert_eq!(
            classify_origin(&[r"SOMEBUS\THING\0".to_string()]),
            DeviceOrigin::Unknown
        );
    }

    #[test]
    fn connection_falls_back_to_path_then_report_length() {
        let mut d = bt_dualsense();
        d.ancestor_instance_ids.clear();
        assert_eq!(detect_connection(&d), ConnectionType::Bluetooth);

        let mut d = usb_dualsense();
        d.ancestor_instance_ids.clear();
        assert_eq!(detect_connection(&d), ConnectionType::Usb);

        let mut d = HidDeviceInfo {
            path: "opaque".into(),
            input_report_len: 78,
            ..Default::default()
        };
        assert_eq!(detect_connection(&d), ConnectionType::Bluetooth);
        d.input_report_len = 64;
        assert_eq!(detect_connection(&d), ConnectionType::Usb);
        d.input_report_len = 0;
        assert_eq!(detect_connection(&d), ConnectionType::Unknown);
    }
}
