//! Builders for **synthetic** DualSense input reports, for automated tests.
//!
//! These reports are constructed from the documented layout. They are not
//! recordings from hardware and must never be shown to users as live input.

use crate::crc::bluetooth_report_crc;

#[derive(Clone, Copy, Debug, Default)]
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

    fn encode(self) -> [u8; 4] {
        [
            (if self.active { 0 } else { 0x80 }) | (self.id & 0x7F),
            (self.x & 0xFF) as u8,
            ((self.x >> 8) as u8 & 0x0F) | (((self.y & 0x0F) as u8) << 4),
            (self.y >> 4) as u8,
        ]
    }
}

/// Field-level description of the shared 63-byte input payload.
#[derive(Clone, Debug)]
pub struct Payload {
    pub lx: u8,
    pub ly: u8,
    pub rx: u8,
    pub ry: u8,
    pub l2: u8,
    pub r2: u8,
    pub seq: u8,
    /// Button bytes; low nibble of byte 0 is the hat switch.
    pub buttons: [u8; 4],
    pub gyro: [i16; 3],
    pub accel: [i16; 3],
    pub sensor_timestamp: u32,
    pub touch: [Touch; 2],
    pub status: u8,
}

impl Payload {
    /// Sticks centred, nothing pressed, no touches, battery discharging at 55%.
    pub fn neutral() -> Self {
        Self {
            lx: 0x80,
            ly: 0x80,
            rx: 0x80,
            ry: 0x80,
            l2: 0,
            r2: 0,
            seq: 0,
            buttons: [0x08, 0, 0, 0],
            gyro: [0; 3],
            accel: [0; 3],
            sensor_timestamp: 0,
            touch: [Touch::default(); 2],
            status: 0x05,
        }
    }

    pub fn encode(&self) -> [u8; 63] {
        let mut p = [0u8; 63];
        p[0] = self.lx;
        p[1] = self.ly;
        p[2] = self.rx;
        p[3] = self.ry;
        p[4] = self.l2;
        p[5] = self.r2;
        p[6] = self.seq;
        p[7..11].copy_from_slice(&self.buttons);
        for i in 0..3 {
            p[15 + i * 2..17 + i * 2].copy_from_slice(&self.gyro[i].to_le_bytes());
            p[21 + i * 2..23 + i * 2].copy_from_slice(&self.accel[i].to_le_bytes());
        }
        p[27..31].copy_from_slice(&self.sensor_timestamp.to_le_bytes());
        p[32..36].copy_from_slice(&self.touch[0].encode());
        p[36..40].copy_from_slice(&self.touch[1].encode());
        p[52] = self.status;
        p
    }

    /// 64-byte USB report 0x01.
    pub fn usb_report(&self) -> Vec<u8> {
        let mut r = vec![0x01];
        r.extend_from_slice(&self.encode());
        r
    }

    /// 78-byte Bluetooth extended report 0x31 with a valid CRC-32.
    pub fn bluetooth_report(&self) -> Vec<u8> {
        let mut r = vec![0u8; 78];
        r[0] = 0x31;
        r[1] = 0x10; // sequence tag
        r[2..65].copy_from_slice(&self.encode());
        let crc = bluetooth_report_crc(0xA1, &r[..74]);
        r[74..78].copy_from_slice(&crc.to_le_bytes());
        r
    }

    /// 10-byte Bluetooth basic report 0x01.
    pub fn bluetooth_basic_report(&self) -> Vec<u8> {
        vec![
            0x01,
            self.lx,
            self.ly,
            self.rx,
            self.ry,
            self.buttons[0],
            self.buttons[1],
            self.buttons[2],
            self.l2,
            self.r2,
        ]
    }
}
