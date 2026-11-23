//! DualShock 4 USB input report decoding.
//!
//! Report 0x01, 64 bytes including the report ID. Byte indexes below count
//! the report ID as byte 0 (Linux `struct dualshock4_input_report_usb` is the
//! ID followed by the 32-byte common block, the touch section and padding).
//!
//! | Bytes | Field |
//! |---|---|
//! | 1, 2 / 3, 4 | Left stick X, Y / right stick X, Y (0–255, centre 0x80, Y down) |
//! | 5 | Hat switch (bits 0–3), Square, Cross, Circle, Triangle (bits 4–7) |
//! | 6 | L1, R1, L2, R2, Share, Options, L3, R3 (bits 0–7) |
//! | 7 | PS (bit 0), touchpad click (bit 1), report counter (bits 2–7) |
//! | 8 / 9 | L2 / R2 analog (0 released – 255 fully pressed) |
//! | 10–11 | Sensor timestamp (u16, about 5.33 µs per step) |
//! | 12 | Sensor temperature (not used) |
//! | 13–18 | Gyroscope X, Y, Z (i16 LE, uncalibrated) |
//! | 19–24 | Accelerometer X, Y, Z (i16 LE, uncalibrated) |
//! | 25–29 | Reserved |
//! | 30 | Battery level (bits 0–3), cable connected (bit 4) |
//! | 31, 32 | Status (not used), reserved |
//! | 33 | Number of touch reports that follow (0–3) |
//! | 34–60 | Three touch reports, newest first: timestamp, then two 4-byte points |
//! | 61–63 | Reserved |

use crate::{TOUCHPAD_HEIGHT, TOUCHPAD_WIDTH};
use nexus_controller_core::{
    BatteryState, BatteryStatus, Buttons, ControllerState, DpadDirection, MotionState, ReportError,
    ReportFormat, ReportParser, StickState, TouchPoint, TouchpadState, TriggerState,
};

pub const USB_REPORT_LEN: usize = 64;
/// Touch reports the USB report has room for.
pub const MAX_TOUCH_REPORTS: usize = 3;

const REPORT_ID_USB_INPUT: u8 = 0x01;

/// Byte offsets in the USB report, counting the report ID as byte 0.
pub(crate) mod off {
    pub const LX: usize = 1;
    pub const LY: usize = 2;
    pub const RX: usize = 3;
    pub const RY: usize = 4;
    pub const BUTTONS: usize = 5; // 3 bytes
    pub const L2: usize = 8;
    pub const R2: usize = 9;
    pub const SENSOR_TS: usize = 10; // u16 LE
    pub const GYRO: usize = 13; // 3 x i16 LE
    pub const ACCEL: usize = 19; // 3 x i16 LE
    pub const STATUS0: usize = 30;
    pub const TOUCH_COUNT: usize = 33;
    /// First (newest) touch report: timestamp, then two points.
    pub const TOUCH_REPORTS: usize = 34; // 3 x 9 bytes
}

/// Battery capacity value meaning "full" while the cable is connected.
const BATTERY_FULL: u8 = 11;
const CABLE_CONNECTED: u8 = 0x10;

/// Stateful parser for one DualShock 4 session.
///
/// State kept between reports:
/// - the touchpad, because a report with no touch reports (count 0) carries
///   no new touch data;
/// - the 6-bit report counter, extended to the 8-bit counter the engine
///   uses to estimate dropped reports.
#[derive(Debug)]
pub struct DualShock4Parser {
    touchpad: TouchpadState,
    counter: Option<(u8, u8)>,
}

impl Default for DualShock4Parser {
    fn default() -> Self {
        Self::new()
    }
}

impl DualShock4Parser {
    pub fn new() -> Self {
        let inactive = TouchPoint {
            active: false,
            ..TouchPoint::default()
        };
        Self {
            touchpad: TouchpadState {
                points: [inactive; 2],
                width: TOUCHPAD_WIDTH,
                height: TOUCHPAD_HEIGHT,
            },
            counter: None,
        }
    }

    /// Extends the controller's 6-bit counter to 8 bits, counting the steps
    /// between reports (so a lost report shows as a gap of one, also across
    /// the 63 → 0 wrap).
    fn extend_counter(&mut self, raw6: u8) -> u8 {
        let extended = match self.counter {
            None => raw6,
            Some((prev6, prev)) => prev.wrapping_add(raw6.wrapping_sub(prev6) & 0x3F),
        };
        self.counter = Some((raw6, extended));
        extended
    }
}

impl ReportParser for DualShock4Parser {
    fn parse(&mut self, report: &[u8]) -> Result<ControllerState, ReportError> {
        let Some(&report_id) = report.first() else {
            return Err(ReportError::Empty);
        };
        if report_id != REPORT_ID_USB_INPUT {
            // 0x11 is the Bluetooth report, which this USB parser never decodes.
            return Err(ReportError::UnsupportedReportId(report_id));
        }
        // Windows delivers reads padded to the collection's input length (64);
        // anything shorter is incomplete. Longer buffers are padding.
        if report.len() < USB_REPORT_LEN {
            return Err(ReportError::TooShort {
                report_id,
                expected: USB_REPORT_LEN,
                actual: report.len(),
            });
        }
        let touch_count = report[off::TOUCH_COUNT] as usize;
        if touch_count > MAX_TOUCH_REPORTS {
            // As the Linux driver does: the report contradicts its own layout.
            return Err(ReportError::Malformed {
                report_id,
                reason: "more touch reports than the USB report has room for",
            });
        }

        let b = &report[off::BUTTONS..off::BUTTONS + 3];
        let (buttons, dpad) = decode_buttons(b[0], b[1], b[2]);
        if touch_count > 0 {
            // Newest first (hid-tools; SDL also reads only the first).
            let t = off::TOUCH_REPORTS;
            self.touchpad.points = [
                decode_touch(&report[t + 1..t + 5]),
                decode_touch(&report[t + 5..t + 9]),
            ];
        }
        let sequence = self.extend_counter(b[2] >> 2);

        Ok(ControllerState {
            left_stick: StickState::from_u8(report[off::LX], report[off::LY]),
            right_stick: StickState::from_u8(report[off::RX], report[off::RY]),
            left_trigger: TriggerState::from_u8(report[off::L2], b[1] & 0x04 != 0),
            right_trigger: TriggerState::from_u8(report[off::R2], b[1] & 0x08 != 0),
            dpad,
            buttons,
            touchpad: Some(self.touchpad),
            motion: Some(MotionState {
                gyro_raw: [
                    le_i16(report, off::GYRO),
                    le_i16(report, off::GYRO + 2),
                    le_i16(report, off::GYRO + 4),
                ],
                accel_raw: [
                    le_i16(report, off::ACCEL),
                    le_i16(report, off::ACCEL + 2),
                    le_i16(report, off::ACCEL + 4),
                ],
                sensor_timestamp: u32::from(u16::from_le_bytes([
                    report[off::SENSOR_TS],
                    report[off::SENSOR_TS + 1],
                ])),
            }),
            battery: Some(decode_battery(report[off::STATUS0])),
            sequence: Some(sequence),
            format: ReportFormat::DualShock4Usb,
        })
    }
}

/// Same bit assignments as the DualSense's first three button bytes (both
/// follow the controller's HID descriptor: hat, then buttons 1–14). Share is
/// the DualSense's Create position; the DualShock 4 has no mute button.
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
        mute: false,
    };
    // Hat values 8–15 are "centred" (the descriptor declares 0–7 with a null state).
    (buttons, DpadDirection::from_hat(b0 & 0x0F))
}

fn le_i16(r: &[u8], at: usize) -> i16 {
    i16::from_le_bytes([r[at], r[at + 1]])
}

/// Touch point: contact byte (bit 7 set = no finger, bits 0–6 tracking ID),
/// then 12-bit X and 12-bit Y packed into three bytes.
fn decode_touch(p: &[u8]) -> TouchPoint {
    let active = p[0] & 0x80 == 0;
    if !active {
        // The coordinates of an inactive point are not valid (Linux driver).
        return TouchPoint {
            active: false,
            id: p[0] & 0x7F,
            x: 0,
            y: 0,
        };
    }
    TouchPoint {
        active: true,
        id: p[0] & 0x7F,
        x: u16::from(p[1]) | (u16::from(p[2] & 0x0F) << 8),
        y: u16::from(p[2] >> 4) | (u16::from(p[3]) << 4),
    }
}

/// Battery, as the Linux driver reads it. The level is in tenths (0 = 0–9 %,
/// reported as the middle of the range). With the cable connected, 0–10 means
/// charging, 11 full, 14 and 15 charging errors.
fn decode_battery(status0: u8) -> BatteryState {
    let level = status0 & 0x0F;
    if status0 & CABLE_CONNECTED != 0 {
        match level {
            0..=9 => BatteryState {
                percent: level * 10 + 5,
                status: BatteryStatus::Charging,
            },
            10 => BatteryState {
                percent: 100,
                status: BatteryStatus::Charging,
            },
            BATTERY_FULL => BatteryState {
                percent: 100,
                status: BatteryStatus::Full,
            },
            14 | 15 => BatteryState {
                percent: 0,
                status: BatteryStatus::Error,
            },
            _ => BatteryState {
                percent: 0,
                status: BatteryStatus::Unknown,
            },
        }
    } else {
        BatteryState {
            percent: if level < 10 { level * 10 + 5 } else { 100 },
            status: BatteryStatus::Discharging,
        }
    }
}

#[cfg(test)]
#[path = "report_tests.rs"]
mod tests;
