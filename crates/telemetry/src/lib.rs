//! Bounded, thread-safe diagnostics storage: an event log, a raw HID report
//! history and input-rate statistics. Everything is in memory and capped so
//! telemetry can never grow without bound while the engine runs.

#![forbid(unsafe_code)]

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Fixed-capacity FIFO; the oldest entry is dropped when full.
#[derive(Debug)]
pub struct Ring<T> {
    items: VecDeque<T>,
    capacity: usize,
}

impl<T: Clone> Ring<T> {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "ring capacity must be non-zero");
        Self {
            items: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    pub fn push(&mut self, item: T) {
        if self.items.len() == self.capacity {
            self.items.pop_front();
        }
        self.items.push_back(item);
    }

    /// The newest `limit` items, oldest first.
    pub fn latest(&self, limit: usize) -> Vec<T> {
        let skip = self.items.len().saturating_sub(limit);
        self.items.iter().skip(skip).cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp_ms: u64,
    pub level: LogLevel,
    pub category: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawReport {
    pub timestamp_ms: u64,
    pub device_id: String,
    pub bytes: Vec<u8>,
    /// `None` if the report parsed; otherwise the parse error.
    pub parse_error: Option<String>,
}

/// Bytes kept per raw report (DualSense USB reports are 64 bytes; longer
/// reports are truncated in the history only, never in processing).
pub const RAW_SLOT_BYTES: usize = 128;

/// Fixed-size storage for one raw report, so recording never allocates.
#[derive(Clone, Debug)]
struct RawSlot {
    timestamp_ms: u64,
    device_id: Arc<str>,
    len: u16,
    bytes: [u8; RAW_SLOT_BYTES],
    parse_error: Option<String>,
}

impl RawSlot {
    fn into_report(self) -> RawReport {
        RawReport {
            timestamp_ms: self.timestamp_ms,
            device_id: self.device_id.to_string(),
            bytes: self.bytes[..self.len as usize].to_vec(),
            parse_error: self.parse_error,
        }
    }
}

/// Report-rate statistics for one input stream.
#[derive(Debug)]
pub struct RateCounter {
    window: Duration,
    window_start: Instant,
    window_count: u64,
    last_rate: f64,
    pub total_reports: u64,
    pub parse_errors: u64,
}

impl RateCounter {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            window_start: Instant::now(),
            window_count: 0,
            last_rate: 0.0,
            total_reports: 0,
            parse_errors: 0,
        }
    }

    pub fn record(&mut self, now: Instant, parsed_ok: bool) {
        self.total_reports += 1;
        if !parsed_ok {
            self.parse_errors += 1;
        }
        self.window_count += 1;
        self.roll(now);
    }

    /// Closes the current window if it has elapsed.
    pub fn roll(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.window_start);
        if elapsed >= self.window {
            self.last_rate = self.window_count as f64 / elapsed.as_secs_f64();
            self.window_count = 0;
            self.window_start = now;
        }
        // A silent stream decays to zero instead of showing a stale rate.
        if elapsed >= self.window * 2 {
            self.last_rate = 0.0;
        }
    }

    /// Reports per second over the last completed window.
    pub fn rate_hz(&self) -> f64 {
        self.last_rate
    }
}

/// Time between consecutive input reports, for USB stability checks
/// (a DualSense over USB normally reports about every 4 ms, i.e. ~250 Hz).
/// Counts are since the controller connected. Recording never allocates.
#[derive(Debug, Default)]
pub struct IntervalStats {
    last: Option<Instant>,
    count: u64,
    sum_us: u64,
    min_us: u32,
    max_us: u32,
    over_8ms: u64,
    over_50ms: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntervalSummary {
    /// Number of intervals measured (reports - 1).
    pub intervals: u64,
    pub min_us: u32,
    pub mean_us: u32,
    pub max_us: u32,
    /// Intervals longer than 8 ms (two normal USB periods): a late report.
    pub over_8ms: u64,
    /// Intervals longer than 50 ms: a visible stall.
    pub over_50ms: u64,
}

impl IntervalStats {
    pub fn record(&mut self, now: Instant) {
        if let Some(prev) = self.last {
            let us = now
                .saturating_duration_since(prev)
                .as_micros()
                .min(u128::from(u32::MAX)) as u32;
            if self.count == 0 || us < self.min_us {
                self.min_us = us;
            }
            self.max_us = self.max_us.max(us);
            self.count += 1;
            self.sum_us += u64::from(us);
            if us > 8_000 {
                self.over_8ms += 1;
            }
            if us > 50_000 {
                self.over_50ms += 1;
            }
        }
        self.last = Some(now);
    }

    pub fn summary(&self) -> IntervalSummary {
        IntervalSummary {
            intervals: self.count,
            min_us: self.min_us,
            mean_us: self.sum_us.checked_div(self.count).unwrap_or(0) as u32,
            max_us: self.max_us,
            over_8ms: self.over_8ms,
            over_50ms: self.over_50ms,
        }
    }
}

/// Fixed-size window of recent durations (microseconds) for latency
/// percentiles. Recording never allocates.
#[derive(Debug)]
pub struct LatencyWindow {
    samples: [u32; LATENCY_WINDOW],
    len: usize,
    next: usize,
}

pub const LATENCY_WINDOW: usize = 256;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencySummary {
    pub p50_us: u32,
    pub p99_us: u32,
    pub max_us: u32,
    pub samples: u32,
    #[serde(default)]
    pub mean_us: u32,
    #[serde(default)]
    pub p95_us: u32,
}

impl Default for LatencyWindow {
    fn default() -> Self {
        Self {
            samples: [0; LATENCY_WINDOW],
            len: 0,
            next: 0,
        }
    }
}

impl LatencyWindow {
    pub fn record(&mut self, d: Duration) {
        self.samples[self.next] = d.as_micros().min(u32::MAX as u128) as u32;
        self.next = (self.next + 1) % LATENCY_WINDOW;
        self.len = (self.len + 1).min(LATENCY_WINDOW);
    }

    pub fn summary(&self) -> LatencySummary {
        if self.len == 0 {
            return LatencySummary::default();
        }
        let mut sorted = self.samples; // copy on the stack
        let s = &mut sorted[..self.len];
        s.sort_unstable();
        let at = |q: f64| s[((s.len() - 1) as f64 * q).round() as usize];
        LatencySummary {
            p50_us: at(0.5),
            p99_us: at(0.99),
            max_us: s[s.len() - 1],
            samples: self.len as u32,
            mean_us: (s.iter().map(|v| u64::from(*v)).sum::<u64>() / s.len() as u64) as u32,
            p95_us: at(0.95),
        }
    }
}

/// Fixed-size window of recent stage durations in **nanoseconds** (the
/// stages of one report take well under a microsecond to a few microseconds,
/// too fine for [`LatencyWindow`]). Recording never allocates; values above
/// ~4.29 s saturate.
#[derive(Debug)]
pub struct StageWindow {
    samples: [u32; LATENCY_WINDOW],
    len: usize,
    next: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSummary {
    pub p50_ns: u32,
    pub p99_ns: u32,
    pub max_ns: u32,
    pub samples: u32,
    #[serde(default)]
    pub mean_ns: u32,
    #[serde(default)]
    pub p95_ns: u32,
}

impl Default for StageWindow {
    fn default() -> Self {
        Self {
            samples: [0; LATENCY_WINDOW],
            len: 0,
            next: 0,
        }
    }
}

impl StageWindow {
    pub fn record(&mut self, d: Duration) {
        self.samples[self.next] = d.as_nanos().min(u32::MAX as u128) as u32;
        self.next = (self.next + 1) % LATENCY_WINDOW;
        self.len = (self.len + 1).min(LATENCY_WINDOW);
    }

    pub fn summary(&self) -> StageSummary {
        if self.len == 0 {
            return StageSummary::default();
        }
        let mut sorted = self.samples; // copy on the stack
        let s = &mut sorted[..self.len];
        s.sort_unstable();
        let at = |q: f64| s[((s.len() - 1) as f64 * q).round() as usize];
        StageSummary {
            p50_ns: at(0.5),
            p99_ns: at(0.99),
            max_ns: s[s.len() - 1],
            samples: self.len as u32,
            mean_ns: (s.iter().map(|v| u64::from(*v)).sum::<u64>() / s.len() as u64) as u32,
            p95_ns: at(0.95),
        }
    }
}

/// How reports and virtual-controller updates flow, for spotting uneven
/// input: the spacing of reports and of updates to the virtual controller
/// (recent 256 each), and whether NEXUS fell behind the controller.
/// Recording never allocates.
#[derive(Debug, Default)]
pub struct FlowStats {
    report_gaps: LatencyWindow,
    output_gaps: LatencyWindow,
    last_report: Option<Instant>,
    last_output: Option<Instant>,
    queued: u64,
    run: u32,
    longest_run: u32,
    unchanged: u64,
    outputs: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSummary {
    /// Time between input reports (recent 256).
    pub report_gaps: LatencySummary,
    /// Time between frames sent to the virtual controller (recent 256).
    pub output_gaps: LatencySummary,
    /// Reports that were already waiting when NEXUS asked for the next one,
    /// i.e. NEXUS was behind the controller (since connect).
    pub queued_reports: u64,
    /// Most queued reports in a row: how far NEXUS fell behind at worst.
    pub longest_backlog: u32,
    /// Frames sent to the virtual controller that were identical to the one
    /// before (still sent: the driver ignores repeats, and a repeat delivers
    /// a frame the driver missed).
    pub unchanged_outputs: u64,
    /// All frames sent to the virtual controller.
    pub outputs: u64,
}

impl FlowStats {
    /// A report was read; `queued` if it was already waiting (no wait).
    pub fn report(&mut self, now: Instant, queued: bool) {
        if let Some(prev) = self.last_report {
            self.report_gaps.record(now.saturating_duration_since(prev));
        }
        self.last_report = Some(now);
        if queued {
            self.queued += 1;
            self.run += 1;
            self.longest_run = self.longest_run.max(self.run);
        } else {
            self.run = 0;
        }
    }

    /// A frame was sent to the virtual controller; `unchanged` if identical to the previous one.
    pub fn output(&mut self, now: Instant, unchanged: bool) {
        if let Some(prev) = self.last_output {
            self.output_gaps.record(now.saturating_duration_since(prev));
        }
        self.last_output = Some(now);
        self.outputs += 1;
        if unchanged {
            self.unchanged += 1;
        }
    }

    pub fn summary(&self) -> FlowSummary {
        FlowSummary {
            report_gaps: self.report_gaps.summary(),
            output_gaps: self.output_gaps.summary(),
            queued_reports: self.queued,
            longest_backlog: self.longest_run,
            unchanged_outputs: self.unchanged,
            outputs: self.outputs,
        }
    }
}

/// Where the time of one report goes, measured on the reader thread.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageLatency {
    /// From the moment the report was read to the start of processing
    /// (parsing and hand-over inside the reader thread).
    pub input: StageSummary,
    /// Sticks, triggers, remapping, layers, gyro and touchpad.
    pub mapping: StageSummary,
    /// Macro playback.
    pub macros: StageSummary,
    /// Handing the frame to the virtual controller driver (ViGEmBus call).
    pub output: StageSummary,
    /// Driver calls slower than a report interval, since the controller connected.
    pub slow_output: SlowCalls,
}

/// A driver call slower than this holds up the next DualSense USB report.
pub const SLOW_CALL: Duration = Duration::from_millis(4);
/// A driver call slower than this is a stall a player can notice.
pub const STALLED_CALL: Duration = Duration::from_millis(50);

/// Counts of slow calls and the longest call, kept for the whole connection
/// (the 256-sample windows forget a rare spike within a second).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowCalls {
    /// Calls that took 4 ms or longer.
    pub over_4ms: u64,
    /// Calls that took 50 ms or longer.
    pub over_50ms: u64,
    pub longest_ns: u64,
    /// All calls counted.
    pub calls: u64,
}

impl SlowCalls {
    pub fn record(&mut self, d: Duration) {
        self.calls += 1;
        if d >= SLOW_CALL {
            self.over_4ms += 1;
            if d >= STALLED_CALL {
                self.over_50ms += 1;
            }
        }
        self.longest_ns = self
            .longest_ns
            .max(d.as_nanos().min(u64::MAX as u128) as u64);
    }
}

/// Shared telemetry sink used by the engine.
pub struct Telemetry {
    log: Mutex<Ring<LogEntry>>,
    raw: Mutex<Ring<RawSlot>>,
}

impl Telemetry {
    pub fn new(log_capacity: usize, raw_capacity: usize) -> Self {
        Self {
            log: Mutex::new(Ring::new(log_capacity)),
            raw: Mutex::new(Ring::new(raw_capacity)),
        }
    }

    pub fn log(&self, level: LogLevel, category: &str, message: impl Into<String>) -> LogEntry {
        let entry = LogEntry {
            timestamp_ms: unix_millis(),
            level,
            category: category.to_owned(),
            message: message.into(),
        };
        lock(&self.log).push(entry.clone());
        entry
    }

    /// Records one raw report. Allocation-free on the per-report path: the
    /// bytes are copied into a fixed slot and the device ID is shared. Only a
    /// parse error (rare) allocates its message.
    pub fn record_raw(&self, device_id: &Arc<str>, bytes: &[u8], parse_error: Option<String>) {
        let mut slot = RawSlot {
            timestamp_ms: unix_millis(),
            device_id: device_id.clone(),
            len: bytes.len().min(RAW_SLOT_BYTES) as u16,
            bytes: [0; RAW_SLOT_BYTES],
            parse_error,
        };
        slot.bytes[..slot.len as usize].copy_from_slice(&bytes[..slot.len as usize]);
        lock(&self.raw).push(slot);
    }

    pub fn recent_log(&self, limit: usize) -> Vec<LogEntry> {
        lock(&self.log).latest(limit)
    }

    pub fn recent_raw(&self, limit: usize) -> Vec<RawReport> {
        lock(&self.raw)
            .latest(limit)
            .into_iter()
            .map(RawSlot::into_report)
            .collect()
    }
}

/// Telemetry must keep working even if a panicking thread poisoned a lock.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_drops_oldest_when_full() {
        let mut r = Ring::new(3);
        for i in 0..5 {
            r.push(i);
        }
        assert_eq!(r.latest(10), vec![2, 3, 4]);
        assert_eq!(r.latest(2), vec![3, 4]);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn rate_counter_measures_and_decays() {
        let t0 = Instant::now();
        let mut c = RateCounter::new(Duration::from_secs(1));
        c.window_start = t0;
        for i in 0..250 {
            c.record(t0 + Duration::from_millis(i * 4), i % 50 != 0);
        }
        c.roll(t0 + Duration::from_millis(1000));
        assert!((c.rate_hz() - 250.0).abs() < 1.0, "rate {}", c.rate_hz());
        assert_eq!(c.total_reports, 250);
        assert_eq!(c.parse_errors, 5);
        c.roll(t0 + Duration::from_millis(3500));
        assert_eq!(c.rate_hz(), 0.0);
    }

    #[test]
    fn latency_window_percentiles_and_wraparound() {
        let mut w = LatencyWindow::default();
        assert_eq!(w.summary(), LatencySummary::default());
        for us in 1..=100u64 {
            w.record(Duration::from_micros(us));
        }
        let s = w.summary();
        assert_eq!(
            (s.p50_us, s.p99_us, s.max_us, s.samples),
            (51, 99, 100, 100)
        );
        for _ in 0..LATENCY_WINDOW {
            w.record(Duration::from_micros(7));
        }
        assert_eq!(w.summary().max_us, 7, "old samples rolled out");
        assert_eq!(w.summary().samples, LATENCY_WINDOW as u32);
    }

    #[test]
    fn telemetry_is_bounded() {
        let t = Telemetry::new(2, 2);
        let dev: Arc<str> = Arc::from("dev");
        for i in 0..10 {
            t.log(LogLevel::Info, "test", format!("m{i}"));
            t.record_raw(&dev, &[i], None);
        }
        let log = t.recent_log(10);
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].message, "m9");
        assert_eq!(t.recent_raw(10)[1].bytes, vec![9]);
        assert_eq!(t.recent_raw(10)[1].device_id, "dev");
    }

    #[test]
    fn raw_history_keeps_exact_bytes_and_truncates_only_beyond_the_slot() {
        let t = Telemetry::new(1, 4);
        let dev: Arc<str> = Arc::from("d");
        let usb: Vec<u8> = (0..64).collect();
        t.record_raw(&dev, &usb, None);
        t.record_raw(&dev, &[7; 200], Some("bad".into()));
        let r = t.recent_raw(2);
        assert_eq!(r[0].bytes, usb, "a full 64-byte USB report is kept exactly");
        assert_eq!(r[1].bytes.len(), RAW_SLOT_BYTES);
        assert_eq!(r[1].parse_error.as_deref(), Some("bad"));
    }

    #[test]
    fn report_intervals_track_min_mean_max_and_late_reports() {
        let mut st = IntervalStats::default();
        assert_eq!(st.summary(), IntervalSummary::default());
        let t0 = Instant::now();
        // 250 Hz with one 12 ms hiccup and one 60 ms stall.
        let offsets_ms = [0u64, 4, 8, 12, 24, 28, 88, 92];
        for ms in offsets_ms {
            st.record(t0 + Duration::from_millis(ms));
        }
        let s = st.summary();
        assert_eq!(s.intervals, 7);
        assert_eq!(s.min_us, 4_000);
        assert_eq!(s.max_us, 60_000);
        assert_eq!(s.mean_us, 92_000 / 7);
        assert_eq!(s.over_8ms, 2);
        assert_eq!(s.over_50ms, 1);
    }
}

#[cfg(test)]
mod stage_tests {
    use super::*;

    #[test]
    fn stage_window_keeps_nanoseconds_and_percentiles() {
        let mut w = StageWindow::default();
        assert_eq!(w.summary(), StageSummary::default());
        for ns in 1..=100u64 {
            w.record(Duration::from_nanos(ns * 10));
        }
        let s = w.summary();
        assert_eq!(s.samples, 100);
        assert_eq!(s.max_ns, 1000);
        assert!((490..=510).contains(&s.p50_ns), "{s:?}");
        assert!((980..=1000).contains(&s.p99_ns), "{s:?}");
        // Old samples roll out of the fixed window.
        for _ in 0..LATENCY_WINDOW {
            w.record(Duration::from_nanos(7));
        }
        assert_eq!(w.summary().max_ns, 7);
        // Absurd values saturate instead of wrapping.
        w.record(Duration::from_secs(100));
        assert_eq!(w.summary().max_ns, u32::MAX);
    }
}

#[cfg(test)]
mod flow_tests {
    use super::*;

    #[test]
    fn summaries_include_mean_and_95th_percentile() {
        let mut w = LatencyWindow::default();
        for us in 1..=100u64 {
            w.record(Duration::from_micros(us));
        }
        let s = w.summary();
        assert_eq!((s.mean_us, s.max_us), (50, 100));
        assert!((94..=96).contains(&s.p95_us), "{s:?}");
        let mut st = StageWindow::default();
        for ns in 1..=100u64 {
            st.record(Duration::from_nanos(ns));
        }
        let s = st.summary();
        assert_eq!(s.mean_ns, 50);
        assert!((94..=96).contains(&s.p95_ns), "{s:?}");
    }

    #[test]
    fn flow_measures_report_and_frame_spacing_backlog_and_repeats() {
        let t0 = Instant::now();
        let ms = |n: u64| t0 + Duration::from_millis(n);
        let mut f = FlowStats::default();
        // Reports every 4 ms; the third and fourth were already waiting.
        for (i, queued) in [false, false, true, true, false, true].iter().enumerate() {
            f.report(ms(4 * i as u64), *queued);
            f.output(ms(4 * i as u64) + Duration::from_micros(200), i == 1);
        }
        let s = f.summary();
        assert_eq!(s.report_gaps.samples, 5);
        assert_eq!((s.report_gaps.p50_us, s.report_gaps.max_us), (4000, 4000));
        assert_eq!(s.output_gaps.p50_us, 4000);
        assert_eq!(
            (s.queued_reports, s.longest_backlog),
            (3, 2),
            "two in a row at worst"
        );
        assert_eq!((s.unchanged_outputs, s.outputs), (1, 6));
    }
}
