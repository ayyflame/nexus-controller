//! Bounded, thread-safe diagnostics storage: an event log, a raw HID report
//! history and input-rate statistics. Everything is in memory and capped so
//! telemetry can never grow without bound while the engine runs.

#![forbid(unsafe_code)]

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
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

/// Shared telemetry sink used by the engine.
pub struct Telemetry {
    log: Mutex<Ring<LogEntry>>,
    raw: Mutex<Ring<RawReport>>,
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

    pub fn record_raw(&self, device_id: &str, bytes: &[u8], parse_error: Option<String>) {
        lock(&self.raw).push(RawReport {
            timestamp_ms: unix_millis(),
            device_id: device_id.to_owned(),
            bytes: bytes.to_vec(),
            parse_error,
        });
    }

    pub fn recent_log(&self, limit: usize) -> Vec<LogEntry> {
        lock(&self.log).latest(limit)
    }

    pub fn recent_raw(&self, limit: usize) -> Vec<RawReport> {
        lock(&self.raw).latest(limit)
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
    fn telemetry_is_bounded() {
        let t = Telemetry::new(2, 2);
        for i in 0..10 {
            t.log(LogLevel::Info, "test", format!("m{i}"));
            t.record_raw("dev", &[i], None);
        }
        let log = t.recent_log(10);
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].message, "m9");
        assert_eq!(t.recent_raw(10)[1].bytes, vec![9]);
    }
}
