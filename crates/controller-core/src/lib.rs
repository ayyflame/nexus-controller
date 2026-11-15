//! Hardware-neutral vocabulary shared by every NEXUS engine module.
//!
//! The engine is organised as four layers with explicit interfaces:
//!
//! 1. **Physical input** — [`hid::HidConnection`] delivers raw HID reports.
//! 2. **Normalized state** — a [`driver::ReportParser`] turns a raw report
//!    into a hardware-neutral [`state::ControllerState`].
//! 3. **Input processing** — `nexus-input-processing` transforms one
//!    `ControllerState` into another (deadzones, curves, mapping, ...).
//! 4. **Virtual output** — `nexus-virtual-controller` feeds the processed
//!    state to a replaceable virtual-gamepad backend.
//!
//! Only layer 1 and the parser know anything about a specific product. Adding
//! a new physical controller means implementing [`driver::ControllerDriver`];
//! nothing downstream of [`state::ControllerState`] changes.

#![forbid(unsafe_code)]

pub mod button;
pub mod device;
pub mod driver;
pub mod hid;
pub mod state;

pub use button::Button;
pub use device::{
    ConnectedDevice, ConnectionType, ControllerModel, DeviceEvent, DeviceId, DeviceOrigin,
    DisconnectReason, VirtualOutputKind,
};
pub use driver::{ControllerDriver, Identification, ReportError, ReportParser};
pub use hid::{HidConnection, HidDeviceInfo, HidError};
pub use state::{
    BatteryState, BatteryStatus, Buttons, ControllerState, DpadDirection, MotionState,
    ReportFormat, StickState, TouchPoint, TouchpadState, TriggerState,
};
