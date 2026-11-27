//! Physical controller discovery, connection lifecycle and input reading.
//!
//! * [`backend::HidBackend`] — platform HID access (Windows implementation in
//!   `windows.rs`; other platforms get [`backend::UnsupportedBackend`]).
//! * [`tracker::ConnectionTracker`] — pure, deterministic connection policy:
//!   deduplication, virtual-device filtering, retry backoff, reconnection.
//! * [`manager::DeviceManager`] — executes the tracker's decisions and runs
//!   one reader thread per connected controller.
//! * [`session::SessionHandler`] — the callback interface through which each
//!   reader thread hands raw and parsed reports to the engine.

pub mod backend;
pub mod hotplug;
pub mod manager;
pub mod session;
pub mod tracker;

#[cfg(windows)]
mod windows;

#[cfg(any(test, feature = "test-support"))]
pub mod mock;

pub use backend::{composite_parent, platform_backend, HidBackend, UnsupportedBackend};
pub use hotplug::{watch_hid_devices, HotplugCallback, HotplugGuard};
pub use manager::{DeviceManager, DeviceManagerConfig, ScannedDevice};
pub use session::{SessionHandler, SessionHandlerFactory, CAUGHT_UP_WAIT, STALE_INPUT_AFTER};
pub use tracker::{Candidate, ConnectionTracker, TrackerAction};
