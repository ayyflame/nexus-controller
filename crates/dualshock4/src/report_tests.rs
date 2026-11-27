//! DualShock 4 USB parser tests. Reports come from [`crate::synthetic`]
//! (built from the documented layout, not recorded from hardware). The layout
//! itself is checked against the USB report descriptor of a real controller.

use super::*;
use crate::synthetic::{button, Report, Touch};
use nexus_controller_core::ConnectionType;

/// HID report descriptor of a DUALSHOCK 4 CUH-ZCT1 over USB (054C:05C4),
/// 507 bytes, as published in hid-tools (`hidtools/device/sony_gamepad.py`,
/// `PS4ControllerUSB.report_descriptor`), the emulator used by the Linux
/// kernel's HID self-tests. It is the controller's own description of its
/// reports, so it is independent of the parsers NEXUS's layout comes from.
const DS4_USB_REPORT_DESCRIPTOR: [u8; 507] = [
    0x05, 0x01, 0x09, 0x05, 0xa1, 0x01, 0x85, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35,
    0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x04, 0x81, 0x02, 0x09, 0x39, 0x15, 0x00, 0x25,
    0x07, 0x35, 0x00, 0x46, 0x3b, 0x01, 0x65, 0x14, 0x75, 0x04, 0x95, 0x01, 0x81, 0x42, 0x65, 0x00,
    0x05, 0x09, 0x19, 0x01, 0x29, 0x0e, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x0e, 0x81, 0x02,
    0x06, 0x00, 0xff, 0x09, 0x20, 0x75, 0x06, 0x95, 0x01, 0x15, 0x00, 0x25, 0x7f, 0x81, 0x02, 0x05,
    0x01, 0x09, 0x33, 0x09, 0x34, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x02, 0x81, 0x02,
    0x06, 0x00, 0xff, 0x09, 0x21, 0x95, 0x36, 0x81, 0x02, 0x85, 0x05, 0x09, 0x22, 0x95, 0x1f, 0x91,
    0x02, 0x85, 0x04, 0x09, 0x23, 0x95, 0x24, 0xb1, 0x02, 0x85, 0x02, 0x09, 0x24, 0x95, 0x24, 0xb1,
    0x02, 0x85, 0x08, 0x09, 0x25, 0x95, 0x03, 0xb1, 0x02, 0x85, 0x10, 0x09, 0x26, 0x95, 0x04, 0xb1,
    0x02, 0x85, 0x11, 0x09, 0x27, 0x95, 0x02, 0xb1, 0x02, 0x85, 0x12, 0x06, 0x02, 0xff, 0x09, 0x21,
    0x95, 0x0f, 0xb1, 0x02, 0x85, 0x13, 0x09, 0x22, 0x95, 0x16, 0xb1, 0x02, 0x85, 0x14, 0x06, 0x05,
    0xff, 0x09, 0x20, 0x95, 0x10, 0xb1, 0x02, 0x85, 0x15, 0x09, 0x21, 0x95, 0x2c, 0xb1, 0x02, 0x06,
    0x80, 0xff, 0x85, 0x80, 0x09, 0x20, 0x95, 0x06, 0xb1, 0x02, 0x85, 0x81, 0x09, 0x21, 0x95, 0x06,
    0xb1, 0x02, 0x85, 0x82, 0x09, 0x22, 0x95, 0x05, 0xb1, 0x02, 0x85, 0x83, 0x09, 0x23, 0x95, 0x01,
    0xb1, 0x02, 0x85, 0x84, 0x09, 0x24, 0x95, 0x04, 0xb1, 0x02, 0x85, 0x85, 0x09, 0x25, 0x95, 0x06,
    0xb1, 0x02, 0x85, 0x86, 0x09, 0x26, 0x95, 0x06, 0xb1, 0x02, 0x85, 0x87, 0x09, 0x27, 0x95, 0x23,
    0xb1, 0x02, 0x85, 0x88, 0x09, 0x28, 0x95, 0x3f, 0xb1, 0x02, 0x85, 0x89, 0x09, 0x29, 0x95, 0x02,
    0xb1, 0x02, 0x85, 0x90, 0x09, 0x30, 0x95, 0x05, 0xb1, 0x02, 0x85, 0x91, 0x09, 0x31, 0x95, 0x03,
    0xb1, 0x02, 0x85, 0x92, 0x09, 0x32, 0x95, 0x03, 0xb1, 0x02, 0x85, 0x93, 0x09, 0x33, 0x95, 0x0c,
    0xb1, 0x02, 0x85, 0x94, 0x09, 0x34, 0x95, 0x3f, 0xb1, 0x02, 0x85, 0xa0, 0x09, 0x40, 0x95, 0x06,
    0xb1, 0x02, 0x85, 0xa1, 0x09, 0x41, 0x95, 0x01, 0xb1, 0x02, 0x85, 0xa2, 0x09, 0x42, 0x95, 0x01,
    0xb1, 0x02, 0x85, 0xa3, 0x09, 0x43, 0x95, 0x30, 0xb1, 0x02, 0x85, 0xa4, 0x09, 0x44, 0x95, 0x0d,
    0xb1, 0x02, 0x85, 0xf0, 0x09, 0x47, 0x95, 0x3f, 0xb1, 0x02, 0x85, 0xf1, 0x09, 0x48, 0x95, 0x3f,
    0xb1, 0x02, 0x85, 0xf2, 0x09, 0x49, 0x95, 0x0f, 0xb1, 0x02, 0x85, 0xa7, 0x09, 0x4a, 0x95, 0x01,
    0xb1, 0x02, 0x85, 0xa8, 0x09, 0x4b, 0x95, 0x01, 0xb1, 0x02, 0x85, 0xa9, 0x09, 0x4c, 0x95, 0x08,
    0xb1, 0x02, 0x85, 0xaa, 0x09, 0x4e, 0x95, 0x01, 0xb1, 0x02, 0x85, 0xab, 0x09, 0x4f, 0x95, 0x39,
    0xb1, 0x02, 0x85, 0xac, 0x09, 0x50, 0x95, 0x39, 0xb1, 0x02, 0x85, 0xad, 0x09, 0x51, 0x95, 0x0b,
    0xb1, 0x02, 0x85, 0xae, 0x09, 0x52, 0x95, 0x01, 0xb1, 0x02, 0x85, 0xaf, 0x09, 0x53, 0x95, 0x02,
    0xb1, 0x02, 0x85, 0xb0, 0x09, 0x54, 0x95, 0x3f, 0xb1, 0x02, 0x85, 0xe0, 0x09, 0x57, 0x95, 0x02,
    0xb1, 0x02, 0x85, 0xb3, 0x09, 0x55, 0x95, 0x3f, 0xb1, 0x02, 0x85, 0xb4, 0x09, 0x55, 0x95, 0x3f,
    0xb1, 0x02, 0x85, 0xb5, 0x09, 0x56, 0x95, 0x3f, 0xb1, 0x02, 0x85, 0xd0, 0x09, 0x58, 0x95, 0x3f,
    0xb1, 0x02, 0x85, 0xd4, 0x09, 0x59, 0x95, 0x3f, 0xb1, 0x02, 0xc0,
];

/// One Input field of a report, as the descriptor declares it.
#[derive(Debug, Clone, PartialEq)]
struct Field {
    report_id: u8,
    usage_page: u32,
    usages: Vec<u32>,
    bit_offset: usize,
    size: usize,
    count: usize,
}

/// Minimal HID descriptor walker: enough for Input and Output main items with
/// report IDs (short items only, which is all this descriptor uses).
fn walk(desc: &[u8]) -> (Vec<Field>, std::collections::BTreeMap<(u8, char), usize>) {
    let mut fields = Vec::new();
    let mut bits = std::collections::BTreeMap::<(u8, char), usize>::new();
    let (mut page, mut size, mut count, mut id) = (0u32, 0usize, 0usize, 0u8);
    let mut usages: Vec<u32> = Vec::new();
    let (mut umin, mut umax) = (None, None);
    let mut i = 0;
    while i < desc.len() {
        let prefix = desc[i];
        let len = match prefix & 0x03 {
            3 => 4,
            n => n as usize,
        };
        let mut v = 0u32;
        for k in 0..len {
            v |= u32::from(desc[i + 1 + k]) << (8 * k);
        }
        match prefix & 0xFC {
            0x04 => page = v,           // Usage Page
            0x74 => size = v as usize,  // Report Size
            0x94 => count = v as usize, // Report Count
            0x84 => id = v as u8,       // Report ID
            0x08 => usages.push(v),     // Usage
            0x18 => umin = Some(v),     // Usage Minimum
            0x28 => umax = Some(v),     // Usage Maximum
            0x80 | 0x90 => {
                // Input / Output
                let kind = if prefix & 0xFC == 0x80 { 'i' } else { 'o' };
                if let (Some(a), Some(b)) = (umin, umax) {
                    usages.extend(a..=b);
                }
                let at = bits.entry((id, kind)).or_insert(0);
                if kind == 'i' {
                    fields.push(Field {
                        report_id: id,
                        usage_page: page,
                        usages: usages.clone(),
                        bit_offset: *at,
                        size,
                        count,
                    });
                }
                *at += size * count;
                usages.clear();
                umin = None;
                umax = None;
            }
            0xA0 | 0xC0 | 0xB0 => {
                usages.clear();
                umin = None;
                umax = None;
            }
            _ => {}
        }
        i += 1 + len;
    }
    (fields, bits)
}

#[test]
fn the_parser_offsets_match_the_controllers_own_report_descriptor() {
    let (fields, bits) = walk(&DS4_USB_REPORT_DESCRIPTOR);
    let input1: Vec<&Field> = fields.iter().filter(|f| f.report_id == 1).collect();
    // Bit offsets below exclude the report-ID byte, so byte n of the report
    // starts at bit (n - 1) * 8.
    let at = |byte: usize| (byte - 1) * 8;
    let find = |page: u32, usage: u32| {
        input1
            .iter()
            .find(|f| f.usage_page == page && f.usages.contains(&usage))
            .map(|f| {
                let k = f.usages.iter().position(|u| *u == usage).unwrap();
                (f.bit_offset + k * f.size, f.size)
            })
            .unwrap_or_else(|| panic!("usage {page:x}/{usage:x} not in report 1"))
    };
    // Sticks: X, Y, then Z, Rz (the right stick), one byte each.
    assert_eq!(find(0x01, 0x30), (at(off::LX), 8), "left X");
    assert_eq!(find(0x01, 0x31), (at(off::LY), 8), "left Y");
    assert_eq!(find(0x01, 0x32), (at(off::RX), 8), "right X (Z)");
    assert_eq!(find(0x01, 0x35), (at(off::RY), 8), "right Y (Rz)");
    // Hat switch: low nibble of byte 5.
    assert_eq!(find(0x01, 0x39), (at(off::BUTTONS), 4), "hat");
    // Buttons 1-14 follow the hat, one bit each, in the order the parser uses.
    for (n, (byte, mask)) in [
        (5, 0x10),
        (5, 0x20),
        (5, 0x40),
        (5, 0x80),
        (6, 0x01),
        (6, 0x02),
        (6, 0x04),
        (6, 0x08),
        (6, 0x10),
        (6, 0x20),
        (6, 0x40),
        (6, 0x80),
        (7, 0x01),
        (7, 0x02),
    ]
    .iter()
    .enumerate()
    {
        let bit = at(*byte) + (*mask as u8).trailing_zeros() as usize;
        assert_eq!(find(0x09, n as u32 + 1), (bit, 1), "button {}", n + 1);
    }
    // The vendor field after the buttons: the 6-bit report counter.
    let counter = input1
        .iter()
        .find(|f| f.usage_page == 0xFF00 && f.size == 6)
        .expect("6-bit counter");
    assert_eq!(counter.bit_offset, at(7) + 2);
    // Analog triggers: Rx, Ry in bytes 8 and 9.
    assert_eq!(find(0x01, 0x33), (at(off::L2), 8), "L2 (Rx)");
    assert_eq!(find(0x01, 0x34), (at(off::R2), 8), "R2 (Ry)");
    // Everything after is one vendor block; the report is 64 bytes with its ID.
    assert_eq!(bits[&(1, 'i')] / 8 + 1, USB_REPORT_LEN);
    // Output report 5 (vibration, light bar) is 32 bytes with its ID.
    assert_eq!(
        bits[&(5, 'o')] / 8 + 1,
        crate::output::USB_OUTPUT_REPORT_LEN
    );
    // Report 1 is the only input report, so every read is report 1 (Windows
    // reads are as long as the longest input report).
    assert!(bits
        .keys()
        .filter(|(_, k)| *k == 'i')
        .all(|(id, _)| *id == 1));
}

#[test]
fn the_synthetic_builder_agrees_with_the_descriptor_packing() {
    // The builder packs hat, buttons and counter bit by bit as the
    // descriptor declares; the parser reads them with byte masks.
    let r = Report::neutral().press(button::TOUCHPAD).usb_report();
    assert_eq!(r[7], 0x02);
    let mut c = Report::neutral();
    c.counter = 0x3F;
    assert_eq!(c.usb_report()[7], 0xFC);
}

fn parse(r: &Report) -> ControllerState {
    DualShock4Parser::new()
        .parse(&r.usb_report())
        .expect("valid USB report")
}

#[test]
fn neutral_report() {
    let s = parse(&Report::neutral());
    assert_eq!(s.format, ReportFormat::DualShock4Usb);
    assert_eq!((s.left_stick.x, s.left_stick.y), (0.0, 0.0));
    assert_eq!((s.right_stick.x, s.right_stick.y), (0.0, 0.0));
    assert_eq!((s.left_trigger.value, s.right_trigger.value), (0.0, 0.0));
    assert!(!s.left_trigger.digital && !s.right_trigger.digital);
    assert_eq!(s.dpad, DpadDirection::Neutral);
    assert_eq!(s.buttons, Buttons::default());
    let tp = s.touchpad.unwrap();
    assert!(!tp.points[0].active && !tp.points[1].active);
    assert_eq!((tp.width, tp.height), (1920, 942));
    assert_eq!(s.motion.unwrap(), MotionState::default());
    assert_eq!(
        s.battery.unwrap(),
        BatteryState {
            percent: 55,
            status: BatteryStatus::Discharging
        }
    );
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
fn every_button_maps_to_exactly_one_field() {
    type Check = fn(&ControllerState) -> bool;
    let cases: &[(u8, &str, Check)] = &[
        (button::SQUARE, "Square", |s| s.buttons.west),
        (button::CROSS, "Cross", |s| s.buttons.south),
        (button::CIRCLE, "Circle", |s| s.buttons.east),
        (button::TRIANGLE, "Triangle", |s| s.buttons.north),
        (button::L1, "L1", |s| s.buttons.left_shoulder),
        (button::R1, "R1", |s| s.buttons.right_shoulder),
        (button::L2, "L2 digital", |s| s.left_trigger.digital),
        (button::R2, "R2 digital", |s| s.right_trigger.digital),
        (button::SHARE, "Share", |s| s.buttons.select),
        (button::OPTIONS, "Options", |s| s.buttons.start),
        (button::L3, "L3", |s| s.buttons.left_stick),
        (button::R3, "R3", |s| s.buttons.right_stick),
        (button::PS, "PS", |s| s.buttons.home),
        (button::TOUCHPAD, "touchpad click", |s| s.buttons.touchpad),
    ];
    for &(n, name, check) in cases {
        let s = parse(&Report::neutral().press(n));
        assert!(check(&s), "{name} not decoded");
        let set = count_buttons(&s.buttons)
            + s.left_trigger.digital as usize
            + s.right_trigger.digital as usize;
        assert_eq!(set, 1, "{name} set other buttons too");
        assert_eq!(s.dpad, DpadDirection::Neutral, "{name} changed the d-pad");
        assert!(!s.buttons.mute, "a DualShock 4 has no mute button");
    }
}

#[test]
fn all_buttons_at_once() {
    let mut r = Report::neutral();
    for n in 1..=14 {
        r = r.press(n);
    }
    r.hat = 7;
    let s = parse(&r);
    assert_eq!(count_buttons(&s.buttons), 12, "every button except mute");
    assert!(s.left_trigger.digital && s.right_trigger.digital);
    assert_eq!(s.dpad, DpadDirection::UpLeft);
}

#[test]
fn dpad_directions_diagonals_and_centre() {
    use DpadDirection::*;
    let expected = [Up, UpRight, Right, DownRight, Down, DownLeft, Left, UpLeft];
    for hat in 0..16u8 {
        let mut r = Report::neutral().press(button::CROSS);
        r.hat = hat;
        let s = parse(&r);
        let want = expected.get(hat as usize).copied().unwrap_or(Neutral);
        assert_eq!(s.dpad, want, "hat {hat}");
        assert!(
            s.buttons.south,
            "hat {hat} must not disturb the face buttons"
        );
    }
    let diag = |hat| {
        let mut r = Report::neutral();
        r.hat = hat;
        parse(&r).dpad
    };
    assert!(diag(1).up() && diag(1).right());
    assert!(diag(3).down() && diag(3).right());
    assert!(diag(5).down() && diag(5).left());
    assert!(diag(7).up() && diag(7).left());
}

#[test]
fn sticks_cover_the_full_range_with_y_up() {
    let mut r = Report::neutral();
    (r.lx, r.ly, r.rx, r.ry) = (0, 0, 255, 255);
    let s = parse(&r);
    assert_eq!(
        (s.left_stick.x, s.left_stick.y),
        (-1.0, 1.0),
        "left: full left, full up"
    );
    assert_eq!(
        (s.right_stick.x, s.right_stick.y),
        (1.0, -1.0),
        "right: full right, full down"
    );
    assert_eq!((s.left_stick.raw_x, s.right_stick.raw_y), (0, 255));
    // One step either side of centre.
    (r.lx, r.ly, r.rx, r.ry) = (0x7F, 0x81, 0x81, 0x7F);
    let s = parse(&r);
    let step = 1.0 / 127.0;
    assert!((s.left_stick.x + step).abs() < 1e-6 && (s.left_stick.y + step).abs() < 1e-6);
    assert!((s.right_stick.x - step).abs() < 1e-6 && (s.right_stick.y - step).abs() < 1e-6);
    // Sticks are independent of each other.
    let mut r = Report::neutral();
    r.rx = 0;
    let s = parse(&r);
    assert_eq!((s.left_stick.x, s.right_stick.x), (0.0, -1.0));
}

#[test]
fn triggers_rest_at_zero_and_reach_one_independently_of_the_digital_bit() {
    for (raw, value) in [
        (0u8, 0.0f32),
        (1, 1.0 / 255.0),
        (128, 128.0 / 255.0),
        (255, 1.0),
    ] {
        let mut r = Report::neutral();
        (r.l2, r.r2) = (raw, 255 - raw);
        let s = parse(&r);
        assert!((s.left_trigger.value - value).abs() < 1e-6, "L2 raw {raw}");
        assert!(
            (s.right_trigger.value - (1.0 - value)).abs() < 1e-6,
            "R2 raw {raw}"
        );
        assert_eq!((s.left_trigger.raw, s.right_trigger.raw), (raw, 255 - raw));
        assert!(!s.left_trigger.digital && !s.right_trigger.digital);
    }
    // Fully pressed with the digital bits, as a real trigger reports it.
    let mut r = Report::neutral().press(button::L2).press(button::R2);
    (r.l2, r.r2) = (255, 255);
    let s = parse(&r);
    assert!(s.left_trigger.digital && s.right_trigger.digital);
    assert_eq!((s.left_trigger.value, s.right_trigger.value), (1.0, 1.0));
    // A digital bit never invents an analog value.
    let s = parse(&Report::neutral().press(button::L2));
    assert!(s.left_trigger.digital);
    assert_eq!(s.left_trigger.value, 0.0);
}

#[test]
fn motion_sensors_and_timestamp_are_passed_through_raw() {
    let mut r = Report::neutral();
    r.gyro = [-1, i16::MAX, i16::MIN];
    r.accel = [8192, -8192, 123];
    r.sensor_timestamp = 0xFFFE;
    r.temperature = 0x1A;
    let m = parse(&r).motion.unwrap();
    assert_eq!(m.gyro_raw, [-1, i16::MAX, i16::MIN]);
    assert_eq!(m.accel_raw, [8192, -8192, 123]);
    assert_eq!(m.sensor_timestamp, 0xFFFE);
}

#[test]
fn battery_follows_the_linux_driver() {
    let b = |status0: u8| decode_battery(status0);
    let st = |p, s| BatteryState {
        percent: p,
        status: s,
    };
    use BatteryStatus::*;
    for level in 0..10u8 {
        assert_eq!(
            b(level),
            st(level * 10 + 5, Discharging),
            "unplugged {level}"
        );
        assert_eq!(
            b(0x10 | level),
            st(level * 10 + 5, Charging),
            "cable {level}"
        );
    }
    assert_eq!(b(10), st(100, Discharging));
    assert_eq!(
        b(0x0F),
        st(100, Discharging),
        "no cable: anything above 9 is full"
    );
    assert_eq!(b(0x1A), st(100, Charging));
    assert_eq!(b(0x1B), st(100, Full));
    assert_eq!(b(0x1C), st(0, Unknown));
    assert_eq!(b(0x1D), st(0, Unknown));
    assert_eq!(b(0x1E), st(0, Error));
    assert_eq!(b(0x1F), st(0, Error));
    // Upper bits (other status flags) don't change the reading.
    assert_eq!(b(0xE5), st(55, Discharging));
    let mut r = Report::neutral();
    r.status0 = 0x1B;
    assert_eq!(parse(&r).battery.unwrap().status, Full);
}

#[test]
fn touchpad_uses_the_newest_touch_report() {
    let mut r = Report::neutral();
    r.touch_count = 2;
    r.touch_reports[0] = (9, [Touch::down(4, 1919, 941), Touch::down(5, 0, 0)]);
    r.touch_reports[1] = (8, [Touch::down(3, 100, 100), Touch::up(2)]);
    let tp = parse(&r).touchpad.unwrap();
    assert_eq!(
        tp.points[0],
        TouchPoint {
            active: true,
            id: 4,
            x: 1919,
            y: 941
        }
    );
    assert_eq!(
        tp.points[1],
        TouchPoint {
            active: true,
            id: 5,
            x: 0,
            y: 0
        }
    );
    // 12-bit packing across the shared middle byte.
    r.touch_reports[0].1[0] = Touch::down(1, 0xABC, 0x3A5);
    let tp = parse(&r).touchpad.unwrap();
    assert_eq!((tp.points[0].x, tp.points[0].y), (0xABC, 0x3A5));
}

#[test]
fn inactive_points_carry_no_coordinates() {
    let mut r = Report::neutral();
    r.touch_count = 1;
    let mut up = Touch::down(7, 500, 400);
    up.active = false; // the controller leaves the old coordinates behind
    r.touch_reports[0] = (1, [up, Touch::up(0)]);
    let p = parse(&r).touchpad.unwrap().points[0];
    assert_eq!(
        p,
        TouchPoint {
            active: false,
            id: 7,
            x: 0,
            y: 0
        }
    );
}

#[test]
fn a_report_without_touch_reports_keeps_the_last_touch_state() {
    let mut parser = DualShock4Parser::new();
    let mut r = Report::neutral();
    r.touch_count = 1;
    r.touch_reports[0] = (1, [Touch::down(1, 960, 471), Touch::up(0)]);
    let first = parser.parse(&r.usb_report()).unwrap().touchpad.unwrap();
    assert!(first.points[0].active);
    // Count 0: whatever is in the touch area isn't new data.
    r.touch_count = 0;
    r.touch_reports[0] = (2, [Touch::down(9, 1, 1), Touch::up(0)]);
    let next = parser.parse(&r.usb_report()).unwrap().touchpad.unwrap();
    assert_eq!(next, first);
    // A fresh session starts with no fingers.
    let fresh = DualShock4Parser::new().parse(&r.usb_report()).unwrap();
    assert!(!fresh.touchpad.unwrap().points[0].active);
}

#[test]
fn the_six_bit_counter_is_extended_for_drop_estimates() {
    let mut parser = DualShock4Parser::new();
    let mut seqs = Vec::new();
    for c in [60u8, 61, 62, 63, 0, 1, 3, 3] {
        let mut r = Report::neutral();
        r.counter = c;
        seqs.push(parser.parse(&r.usb_report()).unwrap().sequence.unwrap());
    }
    // Steps of one across the 63 -> 0 wrap; the jump 1 -> 3 is one lost
    // report; a repeated value is a step of zero.
    assert_eq!(seqs, vec![60, 61, 62, 63, 64, 65, 67, 67]);
}

#[test]
fn invalid_lengths_report_ids_and_malformed_reports_are_rejected() {
    let mut p = DualShock4Parser::new();
    assert_eq!(p.parse(&[]), Err(ReportError::Empty));
    let full = Report::neutral().usb_report();
    for len in [1usize, 10, 33, 63] {
        assert_eq!(
            p.parse(&full[..len]),
            Err(ReportError::TooShort {
                report_id: 0x01,
                expected: 64,
                actual: len
            }),
            "length {len}"
        );
    }
    // Windows may pad a read to a longer buffer; the report is still valid.
    let mut padded = full.clone();
    padded.resize(547, 0);
    assert!(p.parse(&padded).is_ok());
    // Bluetooth (0x11), output (0x05), feature-style and zero IDs.
    for id in [0x11u8, 0x05, 0x02, 0x00, 0x31, 0xFF] {
        let mut r = full.clone();
        r[0] = id;
        assert_eq!(p.parse(&r), Err(ReportError::UnsupportedReportId(id)));
    }
    for count in [4u8, 0x80, 0xFF] {
        let mut r = Report::neutral();
        r.touch_count = count;
        assert!(matches!(
            p.parse(&r.usb_report()),
            Err(ReportError::Malformed {
                report_id: 0x01,
                ..
            })
        ));
    }
    // After rejected reports the parser still works.
    assert!(p.parse(&full).is_ok());
}

#[test]
fn the_dualsense_layout_would_misread_a_dualshock4_report() {
    // Why the DualShock 4 needs its own parser: the same bytes mean other
    // things in a DualSense report.
    let mut r = Report::neutral();
    r.l2 = 255; // byte 8: L2 on a DualShock 4, the first button byte on a DualSense
    let bytes = r.usb_report();
    let ds4 = DualShock4Parser::new().parse(&bytes).unwrap();
    assert_eq!(ds4.left_trigger.value, 1.0);
    assert_eq!(ds4.buttons, Buttons::default());
    let ds = nexus_dualsense::DualSenseParser::new(ConnectionType::Usb)
        .parse(&bytes)
        .unwrap();
    assert_ne!(
        ds.buttons,
        Buttons::default(),
        "the DualSense parser sees face buttons"
    );
    // ...and reads the d-pad byte (5, centred = 0x08) as its L2 trigger.
    assert_eq!(ds.left_trigger.raw, 0x08);
}

#[test]
fn the_parser_never_panics_on_arbitrary_input() {
    let mut seed = 0x9E37_79B9u32;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    let mut p = DualShock4Parser::new();
    let mut ok = 0;
    for _ in 0..20_000 {
        let len = (next() % 80) as usize;
        let mut buf: Vec<u8> = (0..len).map(|_| next() as u8).collect();
        if let Some(first) = buf.first_mut() {
            *first = [0x01, 0x11, 0x05][(next() % 3) as usize];
        }
        if let Ok(s) = p.parse(&buf) {
            ok += 1;
            assert!(
                (-1.0..=1.0).contains(&s.left_stick.x) && (-1.0..=1.0).contains(&s.right_stick.y)
            );
            assert!((0.0..=1.0).contains(&s.left_trigger.value));
            assert!(s.battery.unwrap().percent <= 100);
            let tp = s.touchpad.unwrap();
            assert!(tp.points.iter().all(|p| p.x <= 0xFFF && p.y <= 0xFFF));
        }
    }
    assert!(ok > 0, "some random reports are valid");
}
