//! CRC-32 used by DualSense Bluetooth reports.
//!
//! Standard reflected CRC-32 (poly 0xEDB88320, init 0xFFFFFFFF, final XOR),
//! computed over a one-byte transaction header followed by the report bytes.
//! The header is 0xA1 for input reports (HIDP DATA | INPUT).

const TABLE: [u32; 256] = build_table();

const fn build_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

fn update(mut crc: u32, bytes: &[u8]) -> u32 {
    for &b in bytes {
        crc = TABLE[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc
}

/// Standard CRC-32 of `bytes`.
#[cfg(test)]
pub(crate) fn crc32(bytes: &[u8]) -> u32 {
    !update(0xFFFF_FFFF, bytes)
}

/// CRC of a Bluetooth report as the controller computes it: over the header
/// byte `seed` and then `bytes`.
pub fn bluetooth_report_crc(seed: u8, bytes: &[u8]) -> u32 {
    !update(update(0xFFFF_FFFF, &[seed]), bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_standard_check_value() {
        // The canonical CRC-32 check value.
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn seeded_crc_equals_crc_of_concatenation() {
        let data = [0x31u8, 0x00, 0x80, 0x7F];
        let mut joined = vec![0xA1];
        joined.extend_from_slice(&data);
        assert_eq!(bluetooth_report_crc(0xA1, &data), crc32(&joined));
    }
}
