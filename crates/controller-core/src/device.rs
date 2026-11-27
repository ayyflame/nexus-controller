//! Identity and lifecycle types for physical controllers.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Stable key for one physical HID connection.
///
/// On Windows this is the HID device interface path, which is unique per
/// physical connection and changes when the controller moves between USB and
/// Bluetooth.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(pub String);

impl fmt::Display for DeviceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// How the controller is attached to the PC.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionType {
    Usb,
    Bluetooth,
    /// The transport could not be determined reliably. The UI must show this
    /// as unknown rather than guessing.
    Unknown,
}

/// Supported physical controller models.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControllerModel {
    DualSense,
    /// Recognised and parsed with the DualSense base layout. Edge-only inputs
    /// (back paddles, Fn buttons) are not yet decoded.
    DualSenseEdge,
    /// PlayStation 4 DUALSHOCK 4 (CUH-ZCT1 or CUH-ZCT2), over USB. Its own
    /// report format, parsed by `nexus-dualshock4`.
    DualShock4,
}

impl ControllerModel {
    pub fn display_name(self) -> &'static str {
        match self {
            ControllerModel::DualSense => "DualSense Wireless Controller",
            ControllerModel::DualSenseEdge => "DualSense Edge Wireless Controller",
            ControllerModel::DualShock4 => "DUALSHOCK 4 Wireless Controller",
        }
    }
}

/// Whether a HID device is real hardware or created by a software bus driver.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceOrigin {
    /// Attached through a hardware bus (USB host controller or Bluetooth).
    Physical,
    /// Created by a software-enumerated bus (for example ViGEmBus or a
    /// virtual HID framework driver). NEXUS never reads input from these.
    Virtual,
    /// The device tree did not let us decide.
    Unknown,
}

/// Virtual controller type presented to games.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VirtualOutputKind {
    #[default]
    Disabled,
    Xbox360,
    DualShock4,
}

impl VirtualOutputKind {
    pub fn as_str(self) -> &'static str {
        match self {
            VirtualOutputKind::Disabled => "disabled",
            VirtualOutputKind::Xbox360 => "xbox360",
            VirtualOutputKind::DualShock4 => "dualShock4",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "disabled" => Some(VirtualOutputKind::Disabled),
            "xbox360" => Some(VirtualOutputKind::Xbox360),
            "dualShock4" => Some(VirtualOutputKind::DualShock4),
            _ => None,
        }
    }
}

/// A physical controller with an open HID connection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDevice {
    pub id: DeviceId,
    pub model: ControllerModel,
    pub connection: ConnectionType,
    pub origin: DeviceOrigin,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: Option<String>,
    pub serial_number: Option<String>,
    /// Output report length reported by the OS (0 if unknown).
    #[serde(default)]
    pub output_report_len: u16,
}

/// Why a controller session ended.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum DisconnectReason {
    /// The OS reported the device as gone (unplugged, powered off, out of range).
    Removed,
    /// An I/O error ended the session. The device may be reopened.
    Error(String),
    /// NEXUS is shutting down.
    Shutdown,
}

/// Device lifecycle notifications produced by the device manager.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DeviceEvent {
    Connected {
        device: ConnectedDevice,
    },
    Disconnected {
        device_id: DeviceId,
        reason: DisconnectReason,
    },
    OpenFailed {
        device_id: DeviceId,
        error: String,
        retry_in_ms: u64,
    },
    /// A supported model was found on a software bus and deliberately skipped.
    VirtualDeviceIgnored {
        device_id: DeviceId,
        model: ControllerModel,
    },
    /// A second interface for an already-connected controller (same serial)
    /// was found and skipped to avoid duplicate input.
    DuplicateIgnored {
        device_id: DeviceId,
        existing: DeviceId,
    },
    /// HID enumeration failed or is not available on this platform.
    EnumerationFailed {
        error: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend's TypeScript types depend on this exact JSON shape.
    #[test]
    fn device_event_json_shape_matches_frontend_contract() {
        let e = DeviceEvent::Disconnected {
            device_id: DeviceId("p".into()),
            reason: DisconnectReason::Error("x".into()),
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"type":"disconnected","deviceId":"p","reason":{"kind":"error","detail":"x"}}"#
        );
        let e = DeviceEvent::OpenFailed {
            device_id: DeviceId("p".into()),
            error: "busy".into(),
            retry_in_ms: 1000,
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"type":"openFailed","deviceId":"p","error":"busy","retryInMs":1000}"#
        );
        assert_eq!(
            serde_json::to_string(&DisconnectReason::Removed).unwrap(),
            r#"{"kind":"removed"}"#
        );
        assert_eq!(
            serde_json::to_string(&VirtualOutputKind::DualShock4).unwrap(),
            r#""dualShock4""#
        );
    }
}
