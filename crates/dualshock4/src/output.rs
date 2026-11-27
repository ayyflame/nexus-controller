//! DualShock 4 USB output report 0x05 (32 bytes): vibration and light bar.
//!
//! Layout from the Linux `hid-playstation` driver (`struct
//! dualshock4_output_report_usb`, size-checked at compile time) and SDL
//! (`DS4EffectsState_t`), matching the controller's HID descriptor (output
//! report 5, 31 data bytes):
//!
//! | Byte | Field |
//! |---|---|
//! | 0 | Report ID 0x05 |
//! | 1 | Valid flags: bit 0 motors, bit 1 light bar colour, bit 2 blink |
//! | 2, 3 | Valid flags 1, reserved |
//! | 4 / 5 | Right (light) motor / left (heavy) motor |
//! | 6–8 | Light bar red, green, blue |
//! | 9, 10 | Blink on / off time (not used) |
//!
//! The DualShock 4 has no player LEDs; those requests are ignored.
//! **Not verified on hardware yet.**

use nexus_dualsense::output::OutputState;

pub const USB_OUTPUT_REPORT_ID: u8 = 0x05;
pub const USB_OUTPUT_REPORT_LEN: usize = 32;

const FLAG_MOTORS: u8 = 0x01;
const FLAG_LIGHTBAR: u8 = 0x02;

/// USB output report, padded with zeros to `len` (at least 32 bytes, the
/// length Windows expects for this controller).
pub fn usb_output_report(s: &OutputState, len: usize) -> Vec<u8> {
    let mut r = vec![0u8; len.max(USB_OUTPUT_REPORT_LEN)];
    r[0] = USB_OUTPUT_REPORT_ID;
    if let Some((left, right)) = s.rumble {
        r[1] |= FLAG_MOTORS;
        r[4] = right;
        r[5] = left;
    }
    if let Some([red, green, blue]) = s.lightbar {
        r[1] |= FLAG_LIGHTBAR;
        r[6] = red;
        r[7] = green;
        r[8] = blue;
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_requested_changes_nothing() {
        let r = usb_output_report(&OutputState::default(), 0);
        assert_eq!(r.len(), 32);
        assert_eq!(r[0], 0x05);
        assert!(r[1..].iter().all(|b| *b == 0), "no valid flags, no data");
    }

    #[test]
    fn motors_and_light_bar_land_at_kernel_offsets() {
        let s = OutputState {
            rumble: Some((200, 50)),
            lightbar: Some([10, 20, 30]),
            player_leds: Some(0b10101),
            player_led_brightness: 1,
            release_default_light: true,
        };
        let r = usb_output_report(&s, 32);
        assert_eq!(r[1], 0x03);
        assert_eq!((r[4], r[5]), (50, 200), "right (light) then left (heavy)");
        assert_eq!(&r[6..9], &[10, 20, 30]);
        assert!(
            r[9..].iter().all(|b| *b == 0),
            "no player LEDs on a DualShock 4"
        );
    }

    #[test]
    fn stopping_vibration_only_touches_the_motors() {
        let s = OutputState {
            rumble: Some((0, 0)),
            ..OutputState::default()
        };
        let r = usb_output_report(&s, 32);
        assert_eq!(r[1], 0x01);
        assert_eq!(&r[4..9], &[0, 0, 0, 0, 0]);
    }
}
