//! Sony DualSense support: identification, connection-type detection and
//! input report parsing for USB and Bluetooth.
//!
//! Protocol sources: the Linux kernel `hid-playstation` driver and SDL's
//! `SDL_hidapi_ps5.c`, cross-checked against each other. See
//! `docs/dualsense-protocol.md` for the byte-level layout. Parsing has been
//! validated with synthetic reports only; confirm on real hardware before
//! relying on it for release.

#![forbid(unsafe_code)]

mod crc;
mod driver;
mod identify;
pub mod output;
mod report;

#[cfg(any(test, feature = "test-support"))]
pub mod synthetic;

pub use crc::bluetooth_report_crc;
pub use driver::DualSenseDriver;
pub use identify::{classify_origin, detect_connection, identify};
pub use report::{DualSenseParser, BT_BASIC_REPORT_MIN_LEN, BT_REPORT_LEN, USB_REPORT_LEN};

/// Sony Interactive Entertainment USB vendor ID.
pub const VENDOR_ID_SONY: u16 = 0x054C;
/// DualSense Wireless Controller (CFI-ZCT1).
pub const PRODUCT_ID_DUALSENSE: u16 = 0x0CE6;
/// DualSense Edge Wireless Controller (CFI-ZCP1).
pub const PRODUCT_ID_DUALSENSE_EDGE: u16 = 0x0DF2;

/// HID usage page / usage for the gamepad top-level collection.
pub const USAGE_PAGE_GENERIC_DESKTOP: u16 = 0x01;
pub const USAGE_GAMEPAD: u16 = 0x05;

/// Touchpad resolution reported by the DualSense.
pub const TOUCHPAD_WIDTH: u16 = 1920;
pub const TOUCHPAD_HEIGHT: u16 = 1080;
