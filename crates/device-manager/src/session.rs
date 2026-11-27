//! Per-controller reader thread.

use nexus_controller_core::{
    ConnectedDevice, ControllerDriver, ControllerState, DeviceId, DisconnectReason, HidConnection,
    HidDeviceInfo, HidError, Identification, ReportError,
};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Handling one report (including the virtual controller driver call and
/// any DualSense output write) for this long means the reports Windows
/// queued meanwhile are old: two DualSense USB report intervals.
pub const STALE_INPUT_AFTER: Duration = Duration::from_millis(8);
/// A read that waited at least this long found the queue empty: the reader
/// was caught up. (A queued report is returned in microseconds; the next
/// report from a DualSense takes 1–4 ms.)
pub const CAUGHT_UP_WAIT: Duration = Duration::from_micros(300);
/// At most this many queued reports are read when skipping (Windows queues
/// 32 by default), so a device that floods reports can't trap the loop.
const MAX_SKIP: usize = 512;

/// Receives everything a session produces. Called on the reader thread, so
/// implementations must not block for long.
pub trait SessionHandler: Send {
    /// One input report: the exact bytes read, and the parse result.
    fn on_report(&mut self, raw: &[u8], parsed: Result<ControllerState, ReportError>);
    /// Called when a read times out with no data (roughly every read timeout).
    fn on_idle(&mut self) {}
    /// Called just before `on_report` with how long the read waited for that
    /// report. Under [`CAUGHT_UP_WAIT`] the report was already queued, so
    /// the reader was behind the controller. Diagnostics only.
    fn on_read_wait(&mut self, _waited: Duration) {}
    /// After a slow iteration, `count` queued reports were skipped because
    /// they were stale; the newest one is delivered to `on_report` next.
    fn on_stale_skipped(&mut self, _count: usize) {}
    /// Non-fatal problems, such as a failed initialisation step.
    fn on_warning(&mut self, _message: String) {}
    /// An output report to send to the controller, if one is pending.
    /// Polled after every read; return `None` when there is nothing to send.
    fn take_output(&mut self) -> Option<Vec<u8>> {
        None
    }
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
    pub stale_after: Duration,
    pub ended: Sender<(DeviceId, DisconnectReason)>,
    pub notify: Arc<dyn Fn() + Send + Sync>,
}

pub(crate) fn run(mut ctx: SessionContext) {
    let id = DeviceId(ctx.info.path.clone());

    // Modest priority raise (Windows: one step above normal) so a ready
    // report is processed promptly when the CPU is busy. No-op elsewhere.
    if !raise_reader_priority() {
        #[cfg(windows)]
        ctx.handler.on_warning(
            "Could not raise the input thread priority; continuing at normal priority".into(),
        );
    }

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

    let mut write_warned = false;
    // The newest queued report, already in `buf`, after stale ones were skipped.
    let mut pending: Option<usize> = None;
    // Last moment the reader had nothing left to read. If it hasn't been
    // caught up for `stale_after`, queued reports are stale, whether one
    // iteration was very slow or many were each a little too slow.
    let mut caught_up = Instant::now();
    let reason = loop {
        match ctx.stop.load(Ordering::Acquire) {
            STOP_SHUTDOWN => break DisconnectReason::Shutdown,
            STOP_REMOVED => break DisconnectReason::Removed,
            _ => {}
        }
        let read_began = Instant::now();
        // How long the read waited (zero for a report kept after skipping).
        let mut waited = Duration::ZERO;
        let read = match pending.take() {
            Some(n) => Ok(n),
            None => {
                let r = ctx.connection.read_report(&mut buf, ctx.read_timeout);
                waited = read_began.elapsed();
                if matches!(r, Ok(0)) || waited >= CAUGHT_UP_WAIT {
                    caught_up = Instant::now();
                }
                r
            }
        };
        let started = Instant::now();
        match read {
            Ok(0) => ctx.handler.on_idle(),
            Ok(n) => {
                ctx.handler.on_read_wait(waited);
                let raw = &buf[..n];
                let parsed = parser.parse(raw);
                ctx.handler.on_report(raw, parsed);
            }
            Err(HidError::Disconnected) | Err(HidError::NotFound) => {
                break DisconnectReason::Removed
            }
            Err(e) => break DisconnectReason::Error(e.to_string()),
        }
        // At most one pending output per iteration keeps writes bounded.
        if let Some(report) = ctx.handler.take_output() {
            match ctx.connection.write_output_report(&report) {
                Ok(_) => write_warned = false,
                Err(HidError::Disconnected) => break DisconnectReason::Removed,
                Err(e) => {
                    if !write_warned {
                        write_warned = true;
                        ctx.handler
                            .on_warning(format!("Could not send settings to the controller: {e}"));
                    }
                }
            }
        }
        // Behind for too long (usually slow virtual controller driver calls):
        // whatever Windows queued meanwhile is stale. Every report carries
        // the controller's full state, so skipping to the newest loses only
        // presses made and released entirely during the delay, and never
        // replays an old press or release late. In normal operation every
        // read waits for the next report, so nothing is skipped.
        if is_behind(started, caught_up, ctx.stale_after) {
            match skip_stale(ctx.connection.as_mut(), &mut buf) {
                Ok((latest, skipped)) => {
                    if skipped > 0 {
                        ctx.handler.on_stale_skipped(skipped);
                    }
                    pending = latest;
                    caught_up = Instant::now();
                }
                Err(HidError::Disconnected) | Err(HidError::NotFound) => {
                    break DisconnectReason::Removed
                }
                Err(e) => break DisconnectReason::Error(e.to_string()),
            }
        }
    };

    ctx.handler.on_end(&reason);
    // Close the OS handle before announcing the end, so a reconnect never
    // overlaps with the old handle.
    drop(ctx.connection);
    let _ = ctx.ended.send((id, reason));
    (ctx.notify)();
}

/// This iteration took `stale_after`, or the reader hasn't been caught up
/// (found nothing left to read) for that long.
fn is_behind(started: Instant, caught_up: Instant, stale_after: Duration) -> bool {
    let now = Instant::now();
    now.saturating_duration_since(started) >= stale_after
        || now.saturating_duration_since(caught_up) >= stale_after
}

/// Reads every report that is already queued, without waiting. Returns the
/// length of the newest (left in `buf`) and how many older ones were skipped.
pub(crate) fn skip_stale(
    connection: &mut dyn HidConnection,
    buf: &mut [u8],
) -> Result<(Option<usize>, usize), HidError> {
    let mut latest = None;
    let mut read = 0usize;
    while read < MAX_SKIP {
        match connection.read_report(buf, Duration::ZERO)? {
            0 => break,
            n => {
                latest = Some(n);
                read += 1;
            }
        }
    }
    Ok((latest, read.saturating_sub(1)))
}

/// Raises the reader thread's priority where supported.
fn raise_reader_priority() -> bool {
    #[cfg(windows)]
    {
        crate::windows::raise_current_thread_priority()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct Queue(VecDeque<Vec<u8>>, bool);

    impl HidConnection for Queue {
        fn read_report(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize, HidError> {
            assert_eq!(timeout, Duration::ZERO, "skipping never waits");
            if self.1 {
                return Err(HidError::Disconnected);
            }
            Ok(self.0.pop_front().map_or(0, |r| {
                buf[..r.len()].copy_from_slice(&r);
                r.len()
            }))
        }
        fn get_feature_report(&mut self, _: &mut [u8]) -> Result<usize, HidError> {
            Ok(0)
        }
    }

    #[test]
    fn skipping_keeps_only_the_newest_queued_report() {
        let mut q = Queue(
            VecDeque::from([vec![1, 1], vec![1, 2], vec![1, 3, 3]]),
            false,
        );
        let mut buf = [0u8; 8];
        assert_eq!(skip_stale(&mut q, &mut buf).unwrap(), (Some(3), 2));
        assert_eq!(&buf[..3], [1, 3, 3]);
        assert!(q.0.is_empty());
    }

    #[test]
    fn skipping_with_nothing_queued_does_nothing() {
        let mut q = Queue(VecDeque::new(), false);
        assert_eq!(skip_stale(&mut q, &mut [0u8; 8]).unwrap(), (None, 0));
        let mut one = Queue(VecDeque::from([vec![9]]), false);
        assert_eq!(
            skip_stale(&mut one, &mut [0u8; 8]).unwrap(),
            (Some(1), 0),
            "one queued report is kept, not skipped"
        );
    }

    #[test]
    fn skipping_is_bounded_and_reports_disconnects() {
        let mut q = Queue((0..2000).map(|_| vec![1]).collect(), false);
        let (latest, skipped) = skip_stale(&mut q, &mut [0u8; 8]).unwrap();
        assert_eq!((latest, skipped), (Some(1), MAX_SKIP - 1));
        let mut gone = Queue(VecDeque::new(), true);
        assert!(matches!(
            skip_stale(&mut gone, &mut [0u8; 8]),
            Err(HidError::Disconnected)
        ));
    }
}
