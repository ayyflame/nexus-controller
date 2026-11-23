//! Sony DUALSHOCK 4 (PlayStation 4) support over **USB**: identification,
//! input report parsing, the Report Inspector byte map and the output report
//! for the lightbar and vibration.
//!
//! This is a separate implementation from the DualSense: the DualShock 4
//! report puts the triggers, motion sensors, battery and touchpad at other
//! offsets, encodes the battery differently, has a 6-bit report counter and a
//! smaller touchpad. Its output only reaches the shared
//! [`nexus_controller_core::ControllerState`], so mapping, macros, profiles
//! and the virtual Xbox 360 controller work unchanged.
//!
//! Layout sources, checked against each other (see
//! `docs/dualshock4-protocol.md`):
//! - Linux kernel `drivers/hid/hid-playstation.c` (`struct
//!   dualshock4_input_report_usb`, with compile-time size checks);
//! - SDL `src/joystick/hidapi/SDL_hidapi_ps4.c` (`PS4StatePacket_t`);
//! - hid-tools `hidtools/device/sony_gamepad.py` (`PS4ControllerUSB`, used by
//!   the kernel's HID self-tests), including the USB report descriptor of a
//!   real controller, which the tests decode to confirm the offsets.
//!
//! Validated with synthetic reports only; not yet with a physical controller.

#![forbid(unsafe_code)]

mod driver;
mod identify;
pub mod layout;
pub mod output;
mod report;

#[cfg(any(test, feature = "test-support"))]
pub mod synthetic;

pub use driver::DualShock4Driver;
pub use identify::identify;
pub use report::{DualShock4Parser, MAX_TOUCH_REPORTS, USB_REPORT_LEN};

pub use nexus_dualsense::VENDOR_ID_SONY;
/// DUALSHOCK 4, first revision (CUH-ZCT1). Also the ID ViGEmBus gives its
/// virtual DualShock 4, which NEXUS recognises as virtual and never reads.
pub const PRODUCT_ID_DUALSHOCK4_V1: u16 = 0x05C4;
/// DUALSHOCK 4, second revision (CUH-ZCT2, light bar visible on the touchpad).
pub const PRODUCT_ID_DUALSHOCK4_V2: u16 = 0x09CC;
/// Sony DUALSHOCK 4 USB Wireless Adaptor. **Not supported**: it reports the
/// controller's wireless state, which NEXUS doesn't handle.
pub const PRODUCT_ID_DUALSHOCK4_WIRELESS_ADAPTOR: u16 = 0x0BA0;

/// Touchpad resolution reported by the DualShock 4 (kernel `DS4_TOUCHPAD_*`).
pub const TOUCHPAD_WIDTH: u16 = 1920;
pub const TOUCHPAD_HEIGHT: u16 = 942;

/// The hardware revision behind a product ID, for diagnostics.
pub fn revision(product_id: u16) -> Option<&'static str> {
    match product_id {
        PRODUCT_ID_DUALSHOCK4_V1 => Some("CUH-ZCT1 (first revision)"),
        PRODUCT_ID_DUALSHOCK4_V2 => Some("CUH-ZCT2 (second revision)"),
        _ => None,
    }
}
