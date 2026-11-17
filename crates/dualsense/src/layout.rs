//! Names for every byte and known bit of the DualSense **USB** input report
//! (report ID 0x01, 64 bytes including the ID). Used by the Report Inspector
//! to explain which fields changed. Byte indexes include the report-ID byte.

/// How a byte is expected to behave while the controller sits untouched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKind {
    /// Changes only when the user does something (buttons, triggers at rest).
    Input,
    /// Changes constantly (counters, timestamps, motion sensors, stick noise).
    Varying,
    /// Not used by NEXUS; meaning unknown or reserved.
    Unknown,
}

/// Name and kind of byte `index` of a USB input report.
pub fn usb_byte(index: usize) -> (&'static str, FieldKind) {
    use FieldKind::*;
    match index {
        0 => ("Report ID", Input),
        1 => ("Left stick X", Varying),
        2 => ("Left stick Y", Varying),
        3 => ("Right stick X", Varying),
        4 => ("Right stick Y", Varying),
        5 => ("L2 trigger", Input),
        6 => ("R2 trigger", Input),
        7 => ("Sequence counter", Varying),
        8 => ("Buttons 1: D-pad, Square, Cross, Circle, Triangle", Input),
        9 => ("Buttons 2: L1, R1, L2, R2, Create, Options, L3, R3", Input),
        10 => (
            "Buttons 3: PS, touchpad, mute (bits 3-7 not decoded)",
            Input,
        ),
        11 => ("Buttons 4 (not decoded)", Unknown),
        // Not decoded, but not unused: captures from real controllers show a
        // free-running counter here (byte 12 counts up every report, 13-15
        // carry), so it changes over time with nobody touching anything.
        12..=15 => ("Firmware timestamp (counter)", Varying),
        16..=21 => ("Gyroscope", Varying),
        22..=27 => ("Accelerometer", Varying),
        28..=31 => ("Sensor timestamp", Varying),
        32 => ("Reserved (not decoded)", Unknown),
        33..=40 => ("Touchpad points", Input),
        41..=48 => ("Trigger and status area (not decoded)", Unknown),
        // A second free-running timestamp (bytes 49-52), seen in real captures.
        49..=52 => ("Status timestamp (counter)", Varying),
        53 => ("Battery and power status", Varying),
        54..=63 => ("Status / reserved (not decoded)", Unknown),
        _ => ("Beyond the standard 64-byte report", Unknown),
    }
}

/// Name of one bit that NEXUS decodes into a button, if any.
pub fn usb_decoded_bit(index: usize, mask: u8) -> Option<&'static str> {
    Some(match (index, mask) {
        (8, 0x01..=0x08) => "D-pad",
        (8, 0x10) => "Square",
        (8, 0x20) => "Cross",
        (8, 0x40) => "Circle",
        (8, 0x80) => "Triangle",
        (9, 0x01) => "L1",
        (9, 0x02) => "R1",
        (9, 0x04) => "L2 (digital)",
        (9, 0x08) => "R2 (digital)",
        (9, 0x10) => "Create",
        (9, 0x20) => "Options",
        (9, 0x40) => "L3",
        (9, 0x80) => "R3",
        (10, 0x01) => "PS",
        (10, 0x02) => "Touchpad click",
        (10, 0x04) => "Mute",
        _ => return None,
    })
}

/// Hint for bits NEXUS does not decode yet. The DualSense Edge assignments
/// come from public reverse-engineering (e.g. SDL) and are **unconfirmed**.
pub fn usb_undecoded_hint(index: usize, mask: u8) -> Option<&'static str> {
    Some(match (index, mask) {
        (10, 0x10) => "DualSense Edge: left Fn (unconfirmed)",
        (10, 0x20) => "DualSense Edge: right Fn (unconfirmed)",
        (10, 0x40) => "DualSense Edge: left back button (unconfirmed)",
        (10, 0x80) => "DualSense Edge: right back button (unconfirmed)",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_byte_of_the_usb_report_is_named() {
        for i in 0..64 {
            assert!(!usb_byte(i).0.is_empty(), "byte {i}");
        }
        assert_eq!(usb_byte(64).1, FieldKind::Unknown);
    }

    #[test]
    fn decoded_bits_match_the_parser_layout() {
        // The parser reads face buttons from byte 8 (payload offset 7).
        assert_eq!(usb_decoded_bit(8, 0x20), Some("Cross"));
        assert_eq!(usb_decoded_bit(10, 0x04), Some("Mute"));
        assert_eq!(
            usb_decoded_bit(10, 0x40),
            None,
            "upper bits are not decoded"
        );
        assert!(usb_undecoded_hint(10, 0x40)
            .unwrap()
            .contains("unconfirmed"));
    }
}
