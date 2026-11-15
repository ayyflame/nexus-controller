//! The normalized controller state model.
//!
//! Conventions (all downstream code relies on these):
//! * Stick axes are in `[-1.0, 1.0]`; `x` is positive to the right and `y` is
//!   positive **up**. No deadzone is applied at this layer.
//! * Trigger values are in `[0.0, 1.0]`.
//! * Raw hardware values are preserved next to normalized ones so processing
//!   stages and diagnostics never lose precision.
//! * Buttons use positional names (`south`, `east`, ...) so that the model
//!   is not tied to one vendor's labels.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickState {
    pub x: f32,
    pub y: f32,
    pub raw_x: u8,
    pub raw_y: u8,
}

impl StickState {
    /// Builds a stick from 8-bit raw axes where `0x80` is centre and raw Y
    /// grows downward (the convention used by Sony controllers).
    pub fn from_u8(raw_x: u8, raw_y: u8) -> Self {
        Self {
            x: axis_from_u8(raw_x),
            y: -axis_from_u8(raw_y),
            raw_x,
            raw_y,
        }
    }
}

/// Maps `0..=255` (centre 128) to `[-1, 1]`, with 128 mapping exactly to 0.
pub fn axis_from_u8(raw: u8) -> f32 {
    ((raw as f32 - 128.0) / 127.0).clamp(-1.0, 1.0)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerState {
    pub value: f32,
    pub raw: u8,
    /// Hardware digital threshold bit, if the controller reports one.
    pub digital: bool,
}

impl TriggerState {
    pub fn from_u8(raw: u8, digital: bool) -> Self {
        Self {
            value: raw as f32 / 255.0,
            raw,
            digital,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DpadDirection {
    #[default]
    Neutral,
    Up,
    UpRight,
    Right,
    DownRight,
    Down,
    DownLeft,
    Left,
    UpLeft,
}

impl DpadDirection {
    /// Decodes a standard 8-way HID hat switch (0 = up, clockwise; 8+ = neutral).
    pub fn from_hat(hat: u8) -> Self {
        match hat {
            0 => DpadDirection::Up,
            1 => DpadDirection::UpRight,
            2 => DpadDirection::Right,
            3 => DpadDirection::DownRight,
            4 => DpadDirection::Down,
            5 => DpadDirection::DownLeft,
            6 => DpadDirection::Left,
            7 => DpadDirection::UpLeft,
            _ => DpadDirection::Neutral,
        }
    }

    pub fn up(self) -> bool {
        matches!(self, Self::Up | Self::UpRight | Self::UpLeft)
    }
    pub fn down(self) -> bool {
        matches!(self, Self::Down | Self::DownRight | Self::DownLeft)
    }
    pub fn left(self) -> bool {
        matches!(self, Self::Left | Self::UpLeft | Self::DownLeft)
    }
    pub fn right(self) -> bool {
        matches!(self, Self::Right | Self::UpRight | Self::DownRight)
    }
}

/// Digital buttons. DualSense names are given for reference.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buttons {
    /// Cross
    pub south: bool,
    /// Circle
    pub east: bool,
    /// Square
    pub west: bool,
    /// Triangle
    pub north: bool,
    /// L1
    pub left_shoulder: bool,
    /// R1
    pub right_shoulder: bool,
    /// L3
    pub left_stick: bool,
    /// R3
    pub right_stick: bool,
    /// Options
    pub start: bool,
    /// Create
    pub select: bool,
    /// PS button
    pub home: bool,
    /// Touchpad click
    pub touchpad: bool,
    /// Microphone mute button
    pub mute: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchPoint {
    pub active: bool,
    /// Finger tracking ID assigned by the controller.
    pub id: u8,
    pub x: u16,
    pub y: u16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchpadState {
    pub points: [TouchPoint; 2],
    /// Touch surface resolution, so consumers can normalise coordinates.
    pub width: u16,
    pub height: u16,
}

/// Uncalibrated IMU readings exactly as reported by the hardware.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionState {
    pub gyro_raw: [i16; 3],
    pub accel_raw: [i16; 3],
    pub sensor_timestamp: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BatteryStatus {
    Discharging,
    Charging,
    Full,
    Error,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    pub percent: u8,
    pub status: BatteryStatus,
}

/// Which wire format the state was decoded from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportFormat {
    #[default]
    Unknown,
    /// DualSense USB report 0x01 (64 bytes).
    DualSenseUsb,
    /// DualSense Bluetooth extended report 0x31 (78 bytes, CRC-32).
    DualSenseBluetooth,
    /// DualSense Bluetooth basic report 0x01 sent before the controller is
    /// switched into extended mode. No IMU, touchpad or battery.
    DualSenseBluetoothBasic,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerState {
    pub left_stick: StickState,
    pub right_stick: StickState,
    pub left_trigger: TriggerState,
    pub right_trigger: TriggerState,
    pub dpad: DpadDirection,
    pub buttons: Buttons,
    pub touchpad: Option<TouchpadState>,
    pub motion: Option<MotionState>,
    pub battery: Option<BatteryState>,
    /// Report counter from the hardware, when available.
    pub sequence: Option<u8>,
    pub format: ReportFormat,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axis_centre_maps_to_exact_zero() {
        assert_eq!(axis_from_u8(128), 0.0);
    }

    #[test]
    fn axis_extremes_are_clamped_to_unit_range() {
        assert_eq!(axis_from_u8(0), -1.0);
        assert_eq!(axis_from_u8(255), 1.0);
    }

    #[test]
    fn stick_y_is_positive_up() {
        // Sony raw Y = 0 means fully up.
        let s = StickState::from_u8(128, 0);
        assert_eq!(s.y, 1.0);
        let s = StickState::from_u8(128, 255);
        assert_eq!(s.y, -1.0);
        assert_eq!(s.raw_y, 255);
    }

    #[test]
    fn trigger_normalization() {
        assert_eq!(TriggerState::from_u8(0, false).value, 0.0);
        assert_eq!(TriggerState::from_u8(255, true).value, 1.0);
        assert!((TriggerState::from_u8(128, false).value - 0.50196).abs() < 1e-4);
    }

    #[test]
    fn hat_decoding_covers_all_directions() {
        let expected = [
            DpadDirection::Up,
            DpadDirection::UpRight,
            DpadDirection::Right,
            DpadDirection::DownRight,
            DpadDirection::Down,
            DpadDirection::DownLeft,
            DpadDirection::Left,
            DpadDirection::UpLeft,
        ];
        for (hat, dir) in expected.iter().enumerate() {
            assert_eq!(DpadDirection::from_hat(hat as u8), *dir);
        }
        for hat in 8..=15 {
            assert_eq!(DpadDirection::from_hat(hat), DpadDirection::Neutral);
        }
        assert!(DpadDirection::UpLeft.up() && DpadDirection::UpLeft.left());
        assert!(!DpadDirection::Neutral.down());
    }

    #[test]
    fn virtual_output_kind_round_trips_through_storage_string() {
        for kind in [
            VirtualOutputKindAlias::Disabled,
            VirtualOutputKindAlias::Xbox360,
            VirtualOutputKindAlias::DualShock4,
        ] {
            assert_eq!(VirtualOutputKindAlias::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(VirtualOutputKindAlias::parse("bogus"), None);
    }

    use crate::device::VirtualOutputKind as VirtualOutputKindAlias;
}
