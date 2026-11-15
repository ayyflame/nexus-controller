//! DualSense input report decoding.
//!
//! The USB report 0x01 and the Bluetooth report 0x31 share one 63-byte
//! payload layout; only the header differs:
//!
//! | Transport       | Report ID | Header bytes          | Payload offset | Total length |
//! |-----------------|-----------|-----------------------|----------------|--------------|
//! | USB             | 0x01      | id                    | 1              | 64           |
//! | Bluetooth (ext) | 0x31      | id, sequence tag      | 2              | 78 (+CRC-32) |
//! | Bluetooth basic | 0x01      | id                    | 1 (other map)  | 10           |

use crate::crc::bluetooth_report_crc;
use crate::{TOUCHPAD_HEIGHT, TOUCHPAD_WIDTH};
use nexus_controller_core::{
    BatteryState, BatteryStatus, Buttons, ConnectionType, ControllerState, DpadDirection,
    MotionState, ReportError, ReportFormat, ReportParser, StickState, TouchPoint, TouchpadState,
    TriggerState,
};

pub const USB_REPORT_LEN: usize = 64;
pub const BT_REPORT_LEN: usize = 78;
pub const BT_BASIC_REPORT_MIN_LEN: usize = 10;

const REPORT_ID_INPUT: u8 = 0x01;
const REPORT_ID_BT_EXTENDED: u8 = 0x31;
const BT_INPUT_CRC_SEED: u8 = 0xA1;

/// Byte offsets inside the shared 63-byte payload.
mod off {
    pub const LX: usize = 0;
    pub const LY: usize = 1;
    pub const RX: usize = 2;
    pub const RY: usize = 3;
    pub const L2: usize = 4;
    pub const R2: usize = 5;
    pub const SEQ: usize = 6;
    pub const BUTTONS: usize = 7; // 4 bytes
    pub const GYRO: usize = 15; // 3 x i16 LE
    pub const ACCEL: usize = 21; // 3 x i16 LE
    pub const SENSOR_TS: usize = 27; // u32 LE
    pub const TOUCH: usize = 32; // 2 x 4 bytes
    pub const STATUS: usize = 52;
    pub const LEN: usize = 63;
}

/// Stateful parser for one DualSense session.
#[derive(Debug)]
pub struct DualSenseParser {
    connection: ConnectionType,
}

impl DualSenseParser {
    pub fn new(connection: ConnectionType) -> Self {
        Self { connection }
    }
}

impl ReportParser for DualSenseParser {
    fn parse(&mut self, report: &[u8]) -> Result<ControllerState, ReportError> {
        let Some(&report_id) = report.first() else {
            return Err(ReportError::Empty);
        };
        match report_id {
            REPORT_ID_BT_EXTENDED => parse_bluetooth_extended(report),
            REPORT_ID_INPUT => {
                // Windows pads every read to the collection's maximum input
                // length, so on Bluetooth the 10-byte basic report arrives in
                // a 78-byte buffer. The transport decides the layout.
                let usb_layout = match self.connection {
                    ConnectionType::Usb => true,
                    ConnectionType::Bluetooth => false,
                    ConnectionType::Unknown => {
                        report.len() >= USB_REPORT_LEN && report.len() != BT_REPORT_LEN
                    }
                };
                if usb_layout {
                    parse_usb(report)
                } else {
                    parse_bluetooth_basic(report)
                }
            }
            other => Err(ReportError::UnsupportedReportId(other)),
        }
    }
}

fn require_len(report: &[u8], expected: usize) -> Result<(), ReportError> {
    if report.len() < expected {
        Err(ReportError::TooShort {
            report_id: report[0],
            expected,
            actual: report.len(),
        })
    } else {
        Ok(())
    }
}

fn parse_usb(report: &[u8]) -> Result<ControllerState, ReportError> {
    require_len(report, USB_REPORT_LEN)?;
    Ok(parse_payload(
        &report[1..1 + off::LEN],
        ReportFormat::DualSenseUsb,
    ))
}

fn parse_bluetooth_extended(report: &[u8]) -> Result<ControllerState, ReportError> {
    require_len(report, BT_REPORT_LEN)?;
    let crc_at = BT_REPORT_LEN - 4;
    let reported = u32::from_le_bytes(report[crc_at..BT_REPORT_LEN].try_into().unwrap());
    let computed = bluetooth_report_crc(BT_INPUT_CRC_SEED, &report[..crc_at]);
    if reported != computed {
        return Err(ReportError::ChecksumMismatch { reported, computed });
    }
    Ok(parse_payload(
        &report[2..2 + off::LEN],
        ReportFormat::DualSenseBluetooth,
    ))
}

fn parse_bluetooth_basic(report: &[u8]) -> Result<ControllerState, ReportError> {
    require_len(report, BT_BASIC_REPORT_MIN_LEN)?;
    let (b0, b1, b2) = (report[5], report[6], report[7]);
    let (buttons, dpad) = decode_buttons(b0, b1, b2);
    Ok(ControllerState {
        left_stick: StickState::from_u8(report[1], report[2]),
        right_stick: StickState::from_u8(report[3], report[4]),
        left_trigger: TriggerState::from_u8(report[8], b1 & 0x04 != 0),
        right_trigger: TriggerState::from_u8(report[9], b1 & 0x08 != 0),
        dpad,
        buttons,
        touchpad: None,
        motion: None,
        battery: None,
        sequence: None,
        format: ReportFormat::DualSenseBluetoothBasic,
    })
}

fn decode_buttons(b0: u8, b1: u8, b2: u8) -> (Buttons, DpadDirection) {
    let buttons = Buttons {
        west: b0 & 0x10 != 0,
        south: b0 & 0x20 != 0,
        east: b0 & 0x40 != 0,
        north: b0 & 0x80 != 0,
        left_shoulder: b1 & 0x01 != 0,
        right_shoulder: b1 & 0x02 != 0,
        select: b1 & 0x10 != 0,
        start: b1 & 0x20 != 0,
        left_stick: b1 & 0x40 != 0,
        right_stick: b1 & 0x80 != 0,
        home: b2 & 0x01 != 0,
        touchpad: b2 & 0x02 != 0,
        mute: b2 & 0x04 != 0,
    };
    (buttons, DpadDirection::from_hat(b0 & 0x0F))
}

fn le_i16(p: &[u8], at: usize) -> i16 {
    i16::from_le_bytes([p[at], p[at + 1]])
}

fn decode_touch(p: &[u8]) -> TouchPoint {
    TouchPoint {
        active: p[0] & 0x80 == 0,
        id: p[0] & 0x7F,
        x: u16::from(p[1]) | (u16::from(p[2] & 0x0F) << 8),
        y: u16::from(p[2] >> 4) | (u16::from(p[3]) << 4),
    }
}

fn decode_battery(status: u8) -> BatteryState {
    let capacity = status & 0x0F;
    let (percent, status) = match status >> 4 {
        0x0 => ((capacity * 10 + 5).min(100), BatteryStatus::Discharging),
        0x1 => ((capacity * 10 + 5).min(100), BatteryStatus::Charging),
        0x2 => (100, BatteryStatus::Full),
        0xA | 0xB | 0xF => (0, BatteryStatus::Error),
        _ => (0, BatteryStatus::Unknown),
    };
    BatteryState { percent, status }
}

fn parse_payload(p: &[u8], format: ReportFormat) -> ControllerState {
    debug_assert_eq!(p.len(), off::LEN);
    let b = &p[off::BUTTONS..off::BUTTONS + 4];
    let (buttons, dpad) = decode_buttons(b[0], b[1], b[2]);
    ControllerState {
        left_stick: StickState::from_u8(p[off::LX], p[off::LY]),
        right_stick: StickState::from_u8(p[off::RX], p[off::RY]),
        left_trigger: TriggerState::from_u8(p[off::L2], b[1] & 0x04 != 0),
        right_trigger: TriggerState::from_u8(p[off::R2], b[1] & 0x08 != 0),
        dpad,
        buttons,
        touchpad: Some(TouchpadState {
            points: [
                decode_touch(&p[off::TOUCH..off::TOUCH + 4]),
                decode_touch(&p[off::TOUCH + 4..off::TOUCH + 8]),
            ],
            width: TOUCHPAD_WIDTH,
            height: TOUCHPAD_HEIGHT,
        }),
        motion: Some(MotionState {
            gyro_raw: [
                le_i16(p, off::GYRO),
                le_i16(p, off::GYRO + 2),
                le_i16(p, off::GYRO + 4),
            ],
            accel_raw: [
                le_i16(p, off::ACCEL),
                le_i16(p, off::ACCEL + 2),
                le_i16(p, off::ACCEL + 4),
            ],
            sensor_timestamp: u32::from_le_bytes(
                p[off::SENSOR_TS..off::SENSOR_TS + 4].try_into().unwrap(),
            ),
        }),
        battery: Some(decode_battery(p[off::STATUS])),
        sequence: Some(p[off::SEQ]),
        format,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synthetic::{Payload, Touch};

    fn usb(p: &Payload) -> ControllerState {
        DualSenseParser::new(ConnectionType::Usb)
            .parse(&p.usb_report())
            .expect("valid USB report")
    }

    #[test]
    fn neutral_usb_report() {
        let s = usb(&Payload::neutral());
        assert_eq!(s.format, ReportFormat::DualSenseUsb);
        assert_eq!(s.left_stick.x, 0.0);
        assert_eq!(s.left_stick.y, 0.0);
        assert_eq!(s.right_stick.x, 0.0);
        assert_eq!(s.left_trigger.value, 0.0);
        assert_eq!(s.dpad, DpadDirection::Neutral);
        assert_eq!(s.buttons, Buttons::default());
        let tp = s.touchpad.unwrap();
        assert!(!tp.points[0].active && !tp.points[1].active);
        assert_eq!((tp.width, tp.height), (1920, 1080));
    }

    #[test]
    fn sticks_and_triggers() {
        let mut p = Payload::neutral();
        p.lx = 0;
        p.ly = 0;
        p.rx = 255;
        p.ry = 255;
        p.l2 = 255;
        p.r2 = 51;
        let s = usb(&p);
        assert_eq!((s.left_stick.x, s.left_stick.y), (-1.0, 1.0));
        assert_eq!((s.right_stick.x, s.right_stick.y), (1.0, -1.0));
        assert_eq!(s.left_trigger.value, 1.0);
        assert!((s.right_trigger.value - 0.2).abs() < 1e-6);
        assert_eq!(s.right_trigger.raw, 51);
    }

    #[test]
    fn every_button_maps_to_one_field() {
        type Check = fn(&ControllerState) -> bool;
        let cases: &[(usize, u8, &str, Check)] = &[
            (0, 0x10, "square", |s| s.buttons.west),
            (0, 0x20, "cross", |s| s.buttons.south),
            (0, 0x40, "circle", |s| s.buttons.east),
            (0, 0x80, "triangle", |s| s.buttons.north),
            (1, 0x01, "L1", |s| s.buttons.left_shoulder),
            (1, 0x02, "R1", |s| s.buttons.right_shoulder),
            (1, 0x04, "L2 digital", |s| s.left_trigger.digital),
            (1, 0x08, "R2 digital", |s| s.right_trigger.digital),
            (1, 0x10, "Create", |s| s.buttons.select),
            (1, 0x20, "Options", |s| s.buttons.start),
            (1, 0x40, "L3", |s| s.buttons.left_stick),
            (1, 0x80, "R3", |s| s.buttons.right_stick),
            (2, 0x01, "PS", |s| s.buttons.home),
            (2, 0x02, "touchpad click", |s| s.buttons.touchpad),
            (2, 0x04, "mute", |s| s.buttons.mute),
        ];
        for &(byte, mask, name, check) in cases {
            let mut p = Payload::neutral();
            p.buttons[byte] |= mask;
            let s = usb(&p);
            assert!(check(&s), "{name} not decoded");
            // Exactly one boolean should be set (digital trigger bits are
            // outside `Buttons`).
            let set = count_buttons(&s.buttons)
                + s.left_trigger.digital as usize
                + s.right_trigger.digital as usize;
            assert_eq!(set, 1, "{name} set other buttons too");
            assert_eq!(s.dpad, DpadDirection::Neutral, "{name} changed dpad");
        }
    }

    fn count_buttons(b: &Buttons) -> usize {
        [
            b.south,
            b.east,
            b.west,
            b.north,
            b.left_shoulder,
            b.right_shoulder,
            b.left_stick,
            b.right_stick,
            b.start,
            b.select,
            b.home,
            b.touchpad,
            b.mute,
        ]
        .iter()
        .filter(|v| **v)
        .count()
    }

    #[test]
    fn dpad_directions() {
        for hat in 0..=8u8 {
            let mut p = Payload::neutral();
            p.buttons[0] = (p.buttons[0] & 0xF0) | hat;
            assert_eq!(usb(&p).dpad, DpadDirection::from_hat(hat));
        }
    }

    #[test]
    fn touchpad_points() {
        let mut p = Payload::neutral();
        p.touch[0] = Touch::down(5, 1919, 1079);
        p.touch[1] = Touch::down(6, 0, 0);
        let tp = usb(&p).touchpad.unwrap();
        assert_eq!(
            tp.points[0],
            TouchPoint {
                active: true,
                id: 5,
                x: 1919,
                y: 1079
            }
        );
        assert_eq!(
            tp.points[1],
            TouchPoint {
                active: true,
                id: 6,
                x: 0,
                y: 0
            }
        );
    }

    #[test]
    fn motion_and_battery() {
        let mut p = Payload::neutral();
        p.gyro = [-1, 2, i16::MAX];
        p.accel = [i16::MIN, 0, 8192];
        p.sensor_timestamp = 0xDEADBEEF;
        p.status = 0x17; // charging, capacity 7
        p.seq = 42;
        let s = usb(&p);
        let m = s.motion.unwrap();
        assert_eq!(m.gyro_raw, [-1, 2, i16::MAX]);
        assert_eq!(m.accel_raw, [i16::MIN, 0, 8192]);
        assert_eq!(m.sensor_timestamp, 0xDEADBEEF);
        assert_eq!(
            s.battery.unwrap(),
            BatteryState {
                percent: 75,
                status: BatteryStatus::Charging
            }
        );
        assert_eq!(s.sequence, Some(42));
    }

    #[test]
    fn battery_states() {
        assert_eq!(decode_battery(0x0A).percent, 100); // capped
        assert_eq!(decode_battery(0x00).percent, 5);
        assert_eq!(decode_battery(0x20).status, BatteryStatus::Full);
        assert_eq!(decode_battery(0xA0).status, BatteryStatus::Error);
        assert_eq!(decode_battery(0x50).status, BatteryStatus::Unknown);
    }

    #[test]
    fn bluetooth_extended_report_with_valid_crc() {
        let mut p = Payload::neutral();
        p.lx = 255;
        p.buttons[0] |= 0x20;
        let report = p.bluetooth_report();
        assert_eq!(report.len(), BT_REPORT_LEN);
        // The parser accepts 0x31 regardless of the connection hint.
        for conn in [
            ConnectionType::Bluetooth,
            ConnectionType::Unknown,
            ConnectionType::Usb,
        ] {
            let s = DualSenseParser::new(conn).parse(&report).unwrap();
            assert_eq!(s.format, ReportFormat::DualSenseBluetooth);
            assert_eq!(s.left_stick.x, 1.0);
            assert!(s.buttons.south);
        }
    }

    #[test]
    fn bluetooth_extended_report_with_bad_crc_is_rejected() {
        let mut report = Payload::neutral().bluetooth_report();
        report[5] ^= 0xFF; // corrupt a payload byte
        let err = DualSenseParser::new(ConnectionType::Bluetooth)
            .parse(&report)
            .unwrap_err();
        assert!(matches!(err, ReportError::ChecksumMismatch { .. }));
    }

    #[test]
    fn bluetooth_basic_report_in_padded_buffer() {
        let mut p = Payload::neutral();
        p.lx = 0;
        p.r2 = 255;
        p.buttons[1] |= 0x01;
        p.buttons[0] = (p.buttons[0] & 0xF0) | 2;
        let mut report = p.bluetooth_basic_report();
        report.resize(BT_REPORT_LEN, 0); // Windows pads to InputReportByteLength
        let s = DualSenseParser::new(ConnectionType::Bluetooth)
            .parse(&report)
            .unwrap();
        assert_eq!(s.format, ReportFormat::DualSenseBluetoothBasic);
        assert_eq!(s.left_stick.x, -1.0);
        assert_eq!(s.right_trigger.value, 1.0);
        assert!(s.buttons.left_shoulder);
        assert_eq!(s.dpad, DpadDirection::Right);
        assert!(s.touchpad.is_none() && s.motion.is_none() && s.battery.is_none());

        // With an unknown transport the 78-byte padded buffer is still basic.
        let s = DualSenseParser::new(ConnectionType::Unknown)
            .parse(&report)
            .unwrap();
        assert_eq!(s.format, ReportFormat::DualSenseBluetoothBasic);
    }

    #[test]
    fn unknown_transport_with_usb_length_uses_usb_layout() {
        let s = DualSenseParser::new(ConnectionType::Unknown)
            .parse(&Payload::neutral().usb_report())
            .unwrap();
        assert_eq!(s.format, ReportFormat::DualSenseUsb);
    }

    #[test]
    fn invalid_and_incomplete_reports() {
        let mut parser = DualSenseParser::new(ConnectionType::Usb);
        assert_eq!(parser.parse(&[]), Err(ReportError::Empty));
        assert_eq!(
            parser.parse(&[0x05, 0, 0]),
            Err(ReportError::UnsupportedReportId(0x05))
        );
        let full = Payload::neutral().usb_report();
        assert_eq!(
            parser.parse(&full[..63]),
            Err(ReportError::TooShort {
                report_id: 0x01,
                expected: 64,
                actual: 63
            })
        );
        let bt = Payload::neutral().bluetooth_report();
        assert!(matches!(
            parser.parse(&bt[..40]),
            Err(ReportError::TooShort {
                report_id: 0x31,
                expected: 78,
                ..
            })
        ));
        let mut bt_parser = DualSenseParser::new(ConnectionType::Bluetooth);
        assert!(matches!(
            bt_parser.parse(&[0x01, 0x80, 0x80]),
            Err(ReportError::TooShort { expected: 10, .. })
        ));
    }

    #[test]
    fn parser_never_panics_on_arbitrary_input() {
        // Deterministic pseudo-random fuzz over lengths and contents.
        let mut seed = 0x1234_5678u32;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed
        };
        for conn in [
            ConnectionType::Usb,
            ConnectionType::Bluetooth,
            ConnectionType::Unknown,
        ] {
            let mut parser = DualSenseParser::new(conn);
            for _ in 0..5000 {
                let len = (next() % 100) as usize;
                let mut buf: Vec<u8> = (0..len).map(|_| next() as u8).collect();
                if let Some(first) = buf.first_mut() {
                    *first = [0x01, 0x31, 0x02][(next() % 3) as usize];
                }
                let _ = parser.parse(&buf);
            }
        }
    }
}
