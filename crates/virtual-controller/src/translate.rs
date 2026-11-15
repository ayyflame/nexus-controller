//! Translation from NEXUS output state to virtual controller report formats.
//!
//! These layouts are the public report structures used by Xbox 360 (XUSB /
//! XInput) and DualShock 4 virtual devices (as defined by the ViGEm client
//! headers `XUSB_REPORT` and `DS4_REPORT`). They are independent of any
//! driver, so every backend shares them and they are fully unit-tested.
//!
//! | DualSense            | Xbox 360        | DualShock 4      |
//! |----------------------|-----------------|------------------|
//! | Cross / Circle       | A / B           | Cross / Circle   |
//! | Square / Triangle    | X / Y           | Square / Triangle|
//! | L1 / R1              | LB / RB         | L1 / R1          |
//! | L2 / R2 (analog)     | LT / RT         | L2 / R2 + bits   |
//! | L3 / R3              | LS / RS         | L3 / R3          |
//! | Create / Options     | Back / Start    | Share / Options  |
//! | PS                   | Guide           | PS               |
//! | Touchpad click       | — (not sent)    | Touchpad click   |
//! | Mute                 | — (not sent)    | — (not sent)     |
//! | D-pad                | D-pad bits      | Hat switch       |

use nexus_controller_core::{ControllerState, DpadDirection};

/// `XUSB_REPORT`: what an Xbox 360 controller reports through XInput.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct XusbReport {
    pub buttons: u16,
    pub left_trigger: u8,
    pub right_trigger: u8,
    /// −32768 … 32767, Y positive **up** (XInput convention).
    pub thumb_lx: i16,
    pub thumb_ly: i16,
    pub thumb_rx: i16,
    pub thumb_ry: i16,
}

/// `XUSB_GAMEPAD_*` button bits.
pub mod xusb {
    pub const DPAD_UP: u16 = 0x0001;
    pub const DPAD_DOWN: u16 = 0x0002;
    pub const DPAD_LEFT: u16 = 0x0004;
    pub const DPAD_RIGHT: u16 = 0x0008;
    pub const START: u16 = 0x0010;
    pub const BACK: u16 = 0x0020;
    pub const LEFT_THUMB: u16 = 0x0040;
    pub const RIGHT_THUMB: u16 = 0x0080;
    pub const LEFT_SHOULDER: u16 = 0x0100;
    pub const RIGHT_SHOULDER: u16 = 0x0200;
    pub const GUIDE: u16 = 0x0400;
    pub const A: u16 = 0x1000;
    pub const B: u16 = 0x2000;
    pub const X: u16 = 0x4000;
    pub const Y: u16 = 0x8000;
}

/// `DS4_REPORT`: the basic DualShock 4 input report.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ds4Report {
    /// 0 … 255, centre 128, Y grows **downward** (DS4 convention).
    pub thumb_lx: u8,
    pub thumb_ly: u8,
    pub thumb_rx: u8,
    pub thumb_ry: u8,
    /// Low nibble: hat switch (`ds4::HAT_*`); high bits: `ds4::*` buttons.
    pub buttons: u16,
    /// `ds4::SPECIAL_*` bits.
    pub special: u8,
    pub trigger_l: u8,
    pub trigger_r: u8,
}

impl Default for Ds4Report {
    fn default() -> Self {
        Self {
            thumb_lx: 0x80,
            thumb_ly: 0x80,
            thumb_rx: 0x80,
            thumb_ry: 0x80,
            buttons: ds4::HAT_NONE,
            special: 0,
            trigger_l: 0,
            trigger_r: 0,
        }
    }
}

/// `DS4_BUTTON_*`, `DS4_BUTTON_DPAD_*` and `DS4_SPECIAL_BUTTON_*` values.
pub mod ds4 {
    pub const HAT_NORTH: u16 = 0;
    pub const HAT_NORTHEAST: u16 = 1;
    pub const HAT_EAST: u16 = 2;
    pub const HAT_SOUTHEAST: u16 = 3;
    pub const HAT_SOUTH: u16 = 4;
    pub const HAT_SOUTHWEST: u16 = 5;
    pub const HAT_WEST: u16 = 6;
    pub const HAT_NORTHWEST: u16 = 7;
    pub const HAT_NONE: u16 = 8;
    pub const SQUARE: u16 = 1 << 4;
    pub const CROSS: u16 = 1 << 5;
    pub const CIRCLE: u16 = 1 << 6;
    pub const TRIANGLE: u16 = 1 << 7;
    pub const SHOULDER_LEFT: u16 = 1 << 8;
    pub const SHOULDER_RIGHT: u16 = 1 << 9;
    pub const TRIGGER_LEFT: u16 = 1 << 10;
    pub const TRIGGER_RIGHT: u16 = 1 << 11;
    pub const SHARE: u16 = 1 << 12;
    pub const OPTIONS: u16 = 1 << 13;
    pub const THUMB_LEFT: u16 = 1 << 14;
    pub const THUMB_RIGHT: u16 = 1 << 15;
    pub const SPECIAL_PS: u8 = 1 << 0;
    pub const SPECIAL_TOUCHPAD: u8 = 1 << 1;
}

fn axis_i16(v: f32) -> i16 {
    let v = if v.is_finite() {
        v.clamp(-1.0, 1.0)
    } else {
        0.0
    };
    if v >= 0.0 {
        (v * 32767.0).round() as i16
    } else {
        (v * 32768.0).round() as i16
    }
}

fn axis_u8(v: f32) -> u8 {
    let v = if v.is_finite() {
        v.clamp(-1.0, 1.0)
    } else {
        0.0
    };
    ((v + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8
}

fn trigger_u8(v: f32) -> u8 {
    if v.is_finite() {
        (v.clamp(0.0, 1.0) * 255.0).round() as u8
    } else {
        0
    }
}

pub fn to_xusb(s: &ControllerState) -> XusbReport {
    let b = &s.buttons;
    let mut buttons = 0u16;
    let mut set = |on: bool, bit: u16| {
        if on {
            buttons |= bit;
        }
    };
    set(s.dpad.up(), xusb::DPAD_UP);
    set(s.dpad.down(), xusb::DPAD_DOWN);
    set(s.dpad.left(), xusb::DPAD_LEFT);
    set(s.dpad.right(), xusb::DPAD_RIGHT);
    set(b.start, xusb::START);
    set(b.select, xusb::BACK);
    set(b.left_stick, xusb::LEFT_THUMB);
    set(b.right_stick, xusb::RIGHT_THUMB);
    set(b.left_shoulder, xusb::LEFT_SHOULDER);
    set(b.right_shoulder, xusb::RIGHT_SHOULDER);
    set(b.home, xusb::GUIDE);
    set(b.south, xusb::A);
    set(b.east, xusb::B);
    set(b.west, xusb::X);
    set(b.north, xusb::Y);
    XusbReport {
        buttons,
        left_trigger: trigger_u8(s.left_trigger.value),
        right_trigger: trigger_u8(s.right_trigger.value),
        thumb_lx: axis_i16(s.left_stick.x),
        thumb_ly: axis_i16(s.left_stick.y),
        thumb_rx: axis_i16(s.right_stick.x),
        thumb_ry: axis_i16(s.right_stick.y),
    }
}

fn hat(d: DpadDirection) -> u16 {
    match d {
        DpadDirection::Up => ds4::HAT_NORTH,
        DpadDirection::UpRight => ds4::HAT_NORTHEAST,
        DpadDirection::Right => ds4::HAT_EAST,
        DpadDirection::DownRight => ds4::HAT_SOUTHEAST,
        DpadDirection::Down => ds4::HAT_SOUTH,
        DpadDirection::DownLeft => ds4::HAT_SOUTHWEST,
        DpadDirection::Left => ds4::HAT_WEST,
        DpadDirection::UpLeft => ds4::HAT_NORTHWEST,
        DpadDirection::Neutral => ds4::HAT_NONE,
    }
}

pub fn to_ds4(s: &ControllerState) -> Ds4Report {
    let b = &s.buttons;
    let mut buttons = hat(s.dpad);
    let mut set = |on: bool, bit: u16| {
        if on {
            buttons |= bit;
        }
    };
    set(b.west, ds4::SQUARE);
    set(b.south, ds4::CROSS);
    set(b.east, ds4::CIRCLE);
    set(b.north, ds4::TRIANGLE);
    set(b.left_shoulder, ds4::SHOULDER_LEFT);
    set(b.right_shoulder, ds4::SHOULDER_RIGHT);
    set(s.left_trigger.value > 0.0, ds4::TRIGGER_LEFT);
    set(s.right_trigger.value > 0.0, ds4::TRIGGER_RIGHT);
    set(b.select, ds4::SHARE);
    set(b.start, ds4::OPTIONS);
    set(b.left_stick, ds4::THUMB_LEFT);
    set(b.right_stick, ds4::THUMB_RIGHT);
    let mut special = 0u8;
    if b.home {
        special |= ds4::SPECIAL_PS;
    }
    if b.touchpad {
        special |= ds4::SPECIAL_TOUCHPAD;
    }
    Ds4Report {
        thumb_lx: axis_u8(s.left_stick.x),
        thumb_ly: axis_u8(-s.left_stick.y),
        thumb_rx: axis_u8(s.right_stick.x),
        thumb_ry: axis_u8(-s.right_stick.y),
        buttons,
        special,
        trigger_l: trigger_u8(s.left_trigger.value),
        trigger_r: trigger_u8(s.right_trigger.value),
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use nexus_controller_core::{Button, StickState, TriggerState};

    fn with(buttons: &[Button]) -> ControllerState {
        let mut s = ControllerState::default();
        for b in buttons {
            b.set(&mut s, true);
        }
        s
    }

    #[test]
    fn neutral_state() {
        let s = ControllerState::default();
        assert_eq!(to_xusb(&s), XusbReport::default());
        assert_eq!(to_ds4(&s), Ds4Report::default());
    }

    #[test]
    fn xusb_button_mapping_is_one_to_one() {
        let cases = [
            (Button::South, xusb::A),
            (Button::East, xusb::B),
            (Button::West, xusb::X),
            (Button::North, xusb::Y),
            (Button::LeftShoulder, xusb::LEFT_SHOULDER),
            (Button::RightShoulder, xusb::RIGHT_SHOULDER),
            (Button::LeftStick, xusb::LEFT_THUMB),
            (Button::RightStick, xusb::RIGHT_THUMB),
            (Button::Start, xusb::START),
            (Button::Select, xusb::BACK),
            (Button::Home, xusb::GUIDE),
            (Button::DpadUp, xusb::DPAD_UP),
            (Button::DpadDown, xusb::DPAD_DOWN),
            (Button::DpadLeft, xusb::DPAD_LEFT),
            (Button::DpadRight, xusb::DPAD_RIGHT),
        ];
        for (b, bit) in cases {
            assert_eq!(to_xusb(&with(&[b])).buttons, bit, "{b:?}");
        }
        assert_eq!(
            to_xusb(&with(&[Button::Touchpad, Button::Mute])).buttons,
            0,
            "not representable"
        );
    }

    #[test]
    fn ds4_button_mapping_is_one_to_one() {
        let cases = [
            (Button::West, ds4::SQUARE),
            (Button::South, ds4::CROSS),
            (Button::East, ds4::CIRCLE),
            (Button::North, ds4::TRIANGLE),
            (Button::LeftShoulder, ds4::SHOULDER_LEFT),
            (Button::RightShoulder, ds4::SHOULDER_RIGHT),
            (Button::Select, ds4::SHARE),
            (Button::Start, ds4::OPTIONS),
            (Button::LeftStick, ds4::THUMB_LEFT),
            (Button::RightStick, ds4::THUMB_RIGHT),
        ];
        for (b, bit) in cases {
            let r = to_ds4(&with(&[b]));
            assert_eq!(r.buttons, bit | ds4::HAT_NONE, "{b:?}");
            assert_eq!(r.special, 0);
        }
        assert_eq!(to_ds4(&with(&[Button::Home])).special, ds4::SPECIAL_PS);
        assert_eq!(
            to_ds4(&with(&[Button::Touchpad])).special,
            ds4::SPECIAL_TOUCHPAD
        );
    }

    #[test]
    fn dpad_including_diagonals() {
        let cases = [
            (vec![Button::DpadUp], ds4::HAT_NORTH, xusb::DPAD_UP),
            (
                vec![Button::DpadUp, Button::DpadRight],
                ds4::HAT_NORTHEAST,
                xusb::DPAD_UP | xusb::DPAD_RIGHT,
            ),
            (
                vec![Button::DpadDown, Button::DpadLeft],
                ds4::HAT_SOUTHWEST,
                xusb::DPAD_DOWN | xusb::DPAD_LEFT,
            ),
            (vec![Button::DpadLeft], ds4::HAT_WEST, xusb::DPAD_LEFT),
        ];
        for (buttons, hat, bits) in cases {
            let s = with(&buttons);
            assert_eq!(to_ds4(&s).buttons & 0x0F, hat);
            assert_eq!(to_xusb(&s).buttons, bits);
        }
    }

    #[test]
    fn sticks_keep_full_range_and_direction() {
        let mut s = ControllerState::default();
        s.left_stick = StickState {
            x: 1.0,
            y: 1.0,
            raw_x: 255,
            raw_y: 0,
        }; // right + up
        s.right_stick = StickState {
            x: -1.0,
            y: -1.0,
            raw_x: 0,
            raw_y: 255,
        };
        let x = to_xusb(&s);
        assert_eq!(
            (x.thumb_lx, x.thumb_ly),
            (32767, 32767),
            "XInput: up is positive"
        );
        assert_eq!((x.thumb_rx, x.thumb_ry), (-32768, -32768));
        let d = to_ds4(&s);
        assert_eq!((d.thumb_lx, d.thumb_ly), (255, 0), "DS4: up is 0");
        assert_eq!((d.thumb_rx, d.thumb_ry), (0, 255));
    }

    #[test]
    fn analog_values_are_preserved() {
        let mut s = ControllerState::default();
        s.left_stick = StickState::from_u8(64, 192); // left-ish, down-ish
        s.left_trigger = TriggerState::from_u8(100, false);
        s.right_trigger = TriggerState::from_u8(255, true);
        let x = to_xusb(&s);
        assert_eq!((x.left_trigger, x.right_trigger), (100, 255));
        assert!((x.thumb_lx as f32 / 32768.0 - s.left_stick.x).abs() < 0.001);
        let d = to_ds4(&s);
        assert_eq!((d.trigger_l, d.trigger_r), (100, 255));
        assert!(
            (d.thumb_lx as i32 - 64).abs() <= 1,
            "DualSense raw survives: {}",
            d.thumb_lx
        );
        assert!((d.thumb_ly as i32 - 192).abs() <= 1, "{}", d.thumb_ly);
        assert_eq!(
            d.buttons & ds4::TRIGGER_LEFT,
            ds4::TRIGGER_LEFT,
            "pressed bit while analog > 0"
        );
    }

    #[test]
    fn centre_maps_exactly_and_bad_values_are_safe() {
        let mut s = ControllerState::default();
        s.left_stick.x = f32::NAN;
        s.left_trigger.value = 7.0;
        let x = to_xusb(&s);
        assert_eq!(x.thumb_lx, 0);
        assert_eq!(x.left_trigger, 255);
        assert_eq!(to_ds4(&ControllerState::default()).thumb_lx, 128);
    }
}
