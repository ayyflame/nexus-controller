//! Builders for **synthetic** DualShock 4 USB input reports, for automated
//! tests. Built from the documented layout (`docs/dualshock4-protocol.md`);
//! they are not recordings from hardware and must never be shown to users as
//! live input.

/// One touch point as the controller encodes it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Touch {
    pub active: bool,
    pub id: u8,
    pub x: u16,
    pub y: u16,
}

impl Touch {
    pub fn down(id: u8, x: u16, y: u16) -> Self {
        Self {
            active: true,
            id,
            x,
            y,
        }
    }

    pub fn up(id: u8) -> Self {
        Self {
            active: false,
            id,
            x: 0,
            y: 0,
        }
    }

    pub fn encode(self) -> [u8; 4] {
        [
            (if self.active { 0 } else { 0x80 }) | (self.id & 0x7F),
            (self.x & 0xFF) as u8,
            ((self.x >> 8) as u8 & 0x0F) | (((self.y & 0x0F) as u8) << 4),
            (self.y >> 4) as u8,
        ]
    }
}

/// Field-level description of the 64-byte USB report 0x01.
#[derive(Clone, Debug)]
pub struct Report {
    pub lx: u8,
    pub ly: u8,
    pub rx: u8,
    pub ry: u8,
    /// Low nibble of byte 5: hat switch (8 = centred).
    pub hat: u8,
    /// Buttons as the controller numbers them in its HID descriptor (1 =
    /// Square ... 14 = touchpad click), see [`Report::press`].
    pub buttons: u16,
    /// 6-bit report counter (bits 2–7 of byte 7).
    pub counter: u8,
    pub l2: u8,
    pub r2: u8,
    pub sensor_timestamp: u16,
    pub temperature: u8,
    pub gyro: [i16; 3],
    pub accel: [i16; 3],
    pub status0: u8,
    pub touch_count: u8,
    /// Up to three touch reports, newest first: (timestamp, two points).
    pub touch_reports: [(u8, [Touch; 2]); 3],
}

/// HID button numbers (the order of the controller's descriptor).
pub mod button {
    pub const SQUARE: u8 = 1;
    pub const CROSS: u8 = 2;
    pub const CIRCLE: u8 = 3;
    pub const TRIANGLE: u8 = 4;
    pub const L1: u8 = 5;
    pub const R1: u8 = 6;
    pub const L2: u8 = 7;
    pub const R2: u8 = 8;
    pub const SHARE: u8 = 9;
    pub const OPTIONS: u8 = 10;
    pub const L3: u8 = 11;
    pub const R3: u8 = 12;
    pub const PS: u8 = 13;
    pub const TOUCHPAD: u8 = 14;
}

impl Report {
    /// Sticks centred, nothing pressed, no fingers, battery discharging at 55 %.
    pub fn neutral() -> Self {
        let none = [Touch::up(0), Touch::up(0)];
        Self {
            lx: 0x80,
            ly: 0x80,
            rx: 0x80,
            ry: 0x80,
            hat: 8,
            buttons: 0,
            counter: 0,
            l2: 0,
            r2: 0,
            sensor_timestamp: 0,
            temperature: 0,
            gyro: [0; 3],
            accel: [0; 3],
            status0: 0x05,
            touch_count: 0,
            touch_reports: [(0, none); 3],
        }
    }

    /// Presses HID button `n` (1–14).
    pub fn press(mut self, n: u8) -> Self {
        assert!((1..=14).contains(&n));
        self.buttons |= 1 << (n - 1);
        self
    }

    pub fn usb_report(&self) -> Vec<u8> {
        let mut r = vec![0u8; 64];
        r[0] = 0x01;
        r[1] = self.lx;
        r[2] = self.ly;
        r[3] = self.rx;
        r[4] = self.ry;
        // The descriptor packs hat (4 bits), 14 buttons, 6-bit counter LSB first.
        let packed: u32 = u32::from(self.hat & 0x0F)
            | (u32::from(self.buttons & 0x3FFF) << 4)
            | (u32::from(self.counter & 0x3F) << 18);
        r[5..8].copy_from_slice(&packed.to_le_bytes()[..3]);
        r[8] = self.l2;
        r[9] = self.r2;
        r[10..12].copy_from_slice(&self.sensor_timestamp.to_le_bytes());
        r[12] = self.temperature;
        for i in 0..3 {
            r[13 + i * 2..15 + i * 2].copy_from_slice(&self.gyro[i].to_le_bytes());
            r[19 + i * 2..21 + i * 2].copy_from_slice(&self.accel[i].to_le_bytes());
        }
        r[30] = self.status0;
        r[33] = self.touch_count;
        for (k, (ts, points)) in self.touch_reports.iter().enumerate() {
            let at = 34 + k * 9;
            r[at] = *ts;
            r[at + 1..at + 5].copy_from_slice(&points[0].encode());
            r[at + 5..at + 9].copy_from_slice(&points[1].encode());
        }
        r
    }
}
