//! Names for every byte and decoded bit of the DualShock 4 **USB** input
//! report (0x01, 64 bytes including the ID), for the Report Inspector. Byte
//! indexes include the report-ID byte, as in [`crate::report`].

pub use nexus_dualsense::layout::FieldKind;

/// Name and kind of byte `index` of a USB input report.
pub fn usb_byte(index: usize) -> (&'static str, FieldKind) {
    use FieldKind::*;
    match index {
        0 => ("Report ID", Input),
        1 => ("Left stick X", Varying),
        2 => ("Left stick Y", Varying),
        3 => ("Right stick X", Varying),
        4 => ("Right stick Y", Varying),
        5 => ("Buttons 1: D-pad, Square, Cross, Circle, Triangle", Input),
        6 => ("Buttons 2: L1, R1, L2, R2, Share, Options, L3, R3", Input),
        // Bits 2-7 count reports; the inspector's baseline marks them as noisy.
        7 => (
            "Buttons 3: PS, touchpad click; report counter (bits 2-7)",
            Input,
        ),
        8 => ("L2 trigger", Input),
        9 => ("R2 trigger", Input),
        10..=11 => ("Sensor timestamp", Varying),
        12 => ("Sensor temperature", Varying),
        13..=18 => ("Gyroscope", Varying),
        19..=24 => ("Accelerometer", Varying),
        25..=29 => ("Reserved (not decoded)", Unknown),
        30 => ("Battery and cable status", Varying),
        31 => ("Status (not decoded)", Unknown),
        32 => ("Reserved (not decoded)", Unknown),
        33 => ("Touch report count", Varying),
        34 | 43 | 52 => ("Touch report timestamp", Varying),
        35..=42 => ("Touchpad points (newest)", Input),
        44..=51 | 53..=60 => ("Touchpad points (older)", Input),
        61..=63 => ("Reserved (not decoded)", Unknown),
        _ => ("Beyond the standard 64-byte report", Unknown),
    }
}

/// Bytes holding sticks, triggers or touch positions (analog, not buttons).
pub fn usb_analog(index: usize) -> bool {
    matches!(index, 1..=4 | 8..=9 | 35..=42 | 44..=51 | 53..=60)
}

/// Name of one bit that NEXUS decodes into a button, if any.
pub fn usb_decoded_bit(index: usize, mask: u8) -> Option<&'static str> {
    Some(match (index, mask) {
        (5, 0x01..=0x08) => "D-pad",
        (5, 0x10) => "Square",
        (5, 0x20) => "Cross",
        (5, 0x40) => "Circle",
        (5, 0x80) => "Triangle",
        (6, 0x01) => "L1",
        (6, 0x02) => "R1",
        (6, 0x04) => "L2 (digital)",
        (6, 0x08) => "R2 (digital)",
        (6, 0x10) => "Share",
        (6, 0x20) => "Options",
        (6, 0x40) => "L3",
        (6, 0x80) => "R3",
        (7, 0x01) => "PS",
        (7, 0x02) => "Touchpad click",
        _ => return None,
    })
}

/// Hint for bits NEXUS doesn't decode.
pub fn usb_undecoded_hint(index: usize, mask: u8) -> Option<&'static str> {
    match (index, mask) {
        (7, 0x04..=0x80) => Some("Report counter (changes every report)"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_byte_is_named_and_decoded_bits_match_the_parser() {
        for i in 0..64 {
            assert!(!usb_byte(i).0.is_empty(), "byte {i}");
        }
        assert_eq!(usb_byte(64).1, FieldKind::Unknown);
        assert_eq!(usb_decoded_bit(5, 0x20), Some("Cross"));
        assert_eq!(usb_decoded_bit(6, 0x10), Some("Share"));
        assert_eq!(
            usb_decoded_bit(7, 0x04),
            None,
            "counter bits aren't buttons"
        );
        assert!(usb_analog(8) && usb_analog(9) && !usb_analog(5));
    }
}
