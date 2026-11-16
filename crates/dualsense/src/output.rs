//! DualSense output reports: rumble, lightbar and player LEDs.
//!
//! Layout follows the Linux kernel `hid-playstation` driver
//! (`struct dualsense_output_report_common`, 47 bytes):
//!
//! | Offset | Field |
//! |---|---|
//! | 0 | valid_flag0 (bit0 compatible vibration, bit1 haptics select) |
//! | 1 | valid_flag1 (bit2 lightbar control, bit4 player indicator control) |
//! | 2 / 3 | motor_right / motor_left |
//! | 38 | valid_flag2 (bit1 lightbar setup control) |
//! | 41 | lightbar_setup (bit1 = fade out the default light) |
//! | 42 | player LED brightness (0 high, 1 medium, 2 low) |
//! | 43 | player LEDs (5 bits) |
//! | 44–46 | lightbar red, green, blue |
//!
//! USB: report 0x02 followed by the common block. Bluetooth: report 0x31,
//! sequence tag, tag 0x10, common block, CRC-32 (seed 0xA2) in bytes 74–77.
//!
//! **Not verified on hardware yet.** Rumble uses the original "compatible
//! vibration" mode, which newer firmware may render weaker than games do.

use crate::crc::bluetooth_report_crc;

pub const USB_OUTPUT_REPORT_ID: u8 = 0x02;
pub const BT_OUTPUT_REPORT_ID: u8 = 0x31;
pub const BT_OUTPUT_REPORT_LEN: usize = 78;
/// Minimum USB length (report ID + common block); Windows may require the
/// device's full output report length, so callers pad to that.
pub const USB_OUTPUT_REPORT_MIN_LEN: usize = 48;
const COMMON_LEN: usize = 47;
const BT_OUTPUT_CRC_SEED: u8 = 0xA2;
const BT_OUTPUT_TAG: u8 = 0x10;

/// What to send to the controller. `None` fields are left unchanged.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OutputState {
    /// (left / heavy, right / light) motor strength, 0–255.
    pub rumble: Option<(u8, u8)>,
    pub lightbar: Option<[u8; 3]>,
    /// Five player indicator LEDs as bits 0–4.
    pub player_leds: Option<u8>,
    /// 0 = high, 1 = medium, 2 = low.
    pub player_led_brightness: u8,
    /// Fade out the controller's default light so custom colours apply
    /// (sent once, the first time NEXUS takes over the lightbar).
    pub release_default_light: bool,
}

fn common(s: &OutputState) -> [u8; COMMON_LEN] {
    let mut c = [0u8; COMMON_LEN];
    if let Some((left, right)) = s.rumble {
        c[0] |= 0b0000_0011; // compatible vibration + haptics select
        c[2] = right;
        c[3] = left;
    }
    if let Some([r, g, b]) = s.lightbar {
        c[1] |= 1 << 2;
        c[44] = r;
        c[45] = g;
        c[46] = b;
    }
    if let Some(leds) = s.player_leds {
        c[1] |= 1 << 4;
        c[42] = s.player_led_brightness.min(2);
        c[43] = leds & 0x1F;
    }
    if s.release_default_light {
        c[38] |= 1 << 1;
        c[41] = 1 << 1;
    }
    c
}

/// USB output report, padded with zeros to `len` (at least 48 bytes).
pub fn usb_output_report(s: &OutputState, len: usize) -> Vec<u8> {
    let mut r = vec![0u8; len.max(USB_OUTPUT_REPORT_MIN_LEN)];
    r[0] = USB_OUTPUT_REPORT_ID;
    r[1..1 + COMMON_LEN].copy_from_slice(&common(s));
    r
}

/// Bluetooth output report with sequence number (0–15) and CRC.
pub fn bluetooth_output_report(s: &OutputState, seq: u8) -> Vec<u8> {
    let mut r = vec![0u8; BT_OUTPUT_REPORT_LEN];
    r[0] = BT_OUTPUT_REPORT_ID;
    r[1] = (seq & 0x0F) << 4;
    r[2] = BT_OUTPUT_TAG;
    r[3..3 + COMMON_LEN].copy_from_slice(&common(s));
    let crc = bluetooth_report_crc(BT_OUTPUT_CRC_SEED, &r[..74]);
    r[74..78].copy_from_slice(&crc.to_le_bytes());
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_state_changes_nothing() {
        let r = usb_output_report(&OutputState::default(), 48);
        assert_eq!(r.len(), 48);
        assert_eq!(r[0], 0x02);
        assert!(r[1..].iter().all(|b| *b == 0), "no valid flags, no data");
    }

    #[test]
    fn usb_fields_land_at_kernel_offsets() {
        let s = OutputState {
            rumble: Some((200, 50)),
            lightbar: Some([10, 20, 30]),
            player_leds: Some(0b10101),
            player_led_brightness: 1,
            release_default_light: true,
        };
        let r = usb_output_report(&s, 64);
        assert_eq!(r.len(), 64, "padded to the device's output length");
        let c = &r[1..];
        assert_eq!(c[0], 0b11);
        assert_eq!(c[1], (1 << 2) | (1 << 4));
        assert_eq!((c[2], c[3]), (50, 200), "right then left motor");
        assert_eq!(c[38], 1 << 1);
        assert_eq!(c[41], 1 << 1);
        assert_eq!((c[42], c[43]), (1, 0b10101));
        assert_eq!(&c[44..47], &[10, 20, 30]);
    }

    #[test]
    fn bluetooth_report_has_tag_sequence_and_valid_crc() {
        let s = OutputState {
            lightbar: Some([255, 0, 128]),
            ..OutputState::default()
        };
        let r = bluetooth_output_report(&s, 0x1B);
        assert_eq!(r.len(), 78);
        assert_eq!(
            (r[0], r[1], r[2]),
            (0x31, 0xB0, 0x10),
            "sequence keeps 4 bits"
        );
        assert_eq!(&r[3 + 44..3 + 47], &[255, 0, 128]);
        let crc = u32::from_le_bytes(r[74..78].try_into().unwrap());
        assert_eq!(crc, bluetooth_report_crc(0xA2, &r[..74]));
        assert_ne!(
            crc,
            bluetooth_report_crc(0xA1, &r[..74]),
            "output seed differs from input"
        );
    }

    #[test]
    fn player_leds_are_masked_and_brightness_capped() {
        let s = OutputState {
            player_leds: Some(0xFF),
            player_led_brightness: 9,
            ..OutputState::default()
        };
        let r = usb_output_report(&s, 48);
        assert_eq!((r[1 + 42], r[1 + 43]), (2, 0x1F));
    }
}
