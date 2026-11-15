//! Per-controller reader thread.

use nexus_controller_core::{
    ConnectedDevice, ControllerDriver, ControllerState, DeviceId, DisconnectReason, HidConnection,
    HidDeviceInfo, HidError, Identification, ReportError,
};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Duration;

/// Receives everything a session produces. Called on the reader thread, so
/// implementations must not block for long.
pub trait SessionHandler: Send {
    /// One input report: the exact bytes read, and the parse result.
    fn on_report(&mut self, raw: &[u8], parsed: Result<ControllerState, ReportError>);
    /// Called when a read times out with no data (roughly every read timeout).
    fn on_idle(&mut self) {}
    /// Non-fatal problems, such as a failed initialisation step.
    fn on_warning(&mut self, _message: String) {}
    /// Last call before the thread exits.
    fn on_end(&mut self, _reason: &DisconnectReason) {}
}

/// Creates a handler for each new connection.
pub type SessionHandlerFactory = Box<dyn FnMut(&ConnectedDevice) -> Box<dyn SessionHandler> + Send>;

pub(crate) const STOP_NONE: u8 = 0;
pub(crate) const STOP_SHUTDOWN: u8 = 1;
pub(crate) const STOP_REMOVED: u8 = 2;

pub(crate) struct SessionContext {
    pub connection: Box<dyn HidConnection>,
    pub driver: Arc<dyn ControllerDriver>,
    pub info: HidDeviceInfo,
    pub identification: Identification,
    pub handler: Box<dyn SessionHandler>,
    pub stop: Arc<AtomicU8>,
    pub read_timeout: Duration,
    pub ended: Sender<(DeviceId, DisconnectReason)>,
    pub notify: Arc<dyn Fn() + Send + Sync>,
}

pub(crate) fn run(mut ctx: SessionContext) {
    let id = DeviceId(ctx.info.path.clone());

    if let Err(e) = ctx
        .driver
        .initialize(ctx.connection.as_mut(), &ctx.info, &ctx.identification)
    {
        ctx.handler.on_warning(format!(
            "{} initialisation step failed ({e}); continuing with default report mode",
            ctx.driver.name()
        ));
    }

    let mut parser = ctx.driver.create_parser(&ctx.identification);
    // Some backends require the buffer to be at least the collection's
    // maximum input report length.
    let mut buf = vec![0u8; (ctx.info.input_report_len as usize).max(128)];

    let reason = loop {
        match ctx.stop.load(Ordering::Acquire) {
            STOP_SHUTDOWN => break DisconnectReason::Shutdown,
            STOP_REMOVED => break DisconnectReason::Removed,
            _ => {}
        }
        match ctx.connection.read_report(&mut buf, ctx.read_timeout) {
            Ok(0) => ctx.handler.on_idle(),
            Ok(n) => {
                let raw = &buf[..n];
                let parsed = parser.parse(raw);
                ctx.handler.on_report(raw, parsed);
            }
            Err(HidError::Disconnected) | Err(HidError::NotFound) => {
                break DisconnectReason::Removed
            }
            Err(e) => break DisconnectReason::Error(e.to_string()),
        }
    };

    ctx.handler.on_end(&reason);
    // Close the OS handle before announcing the end, so a reconnect never
    // overlaps with the old handle.
    drop(ctx.connection);
    let _ = ctx.ended.send((id, reason));
    (ctx.notify)();
}
