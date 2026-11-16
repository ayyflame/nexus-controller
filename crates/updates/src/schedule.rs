//! When automatic update checks run.
//!
//! - Every session checks once, shortly after start-up, so start-up itself is
//!   never slowed by the network.
//! - After that, it checks every 6 hours while NEXUS is running.
//! - After a failed check (offline, server error) it tries again after 1 hour
//!   instead of 6. Failures are shown quietly in Settings, never as a pop-up.
//!
//! All times are Unix seconds, so the policy is testable without waiting.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Schedule {
    pub initial_delay_secs: u64,
    pub interval_secs: u64,
    pub retry_after_failure_secs: u64,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            initial_delay_secs: 20,
            interval_secs: 6 * 60 * 60,
            retry_after_failure_secs: 60 * 60,
        }
    }
}

/// The last automatic or manual check made in this session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub at: u64,
    pub ok: bool,
}

impl Schedule {
    /// Unix time of the next automatic check.
    pub fn next_due(&self, started_at: u64, last: Option<Attempt>) -> u64 {
        let first = started_at.saturating_add(self.initial_delay_secs);
        match last {
            None => first,
            Some(a) => {
                let wait = if a.ok {
                    self.interval_secs
                } else {
                    self.retry_after_failure_secs
                };
                first.max(a.at.saturating_add(wait))
            }
        }
    }

    /// Whether an automatic check should start now. Nothing runs when the
    /// user turned automatic checks off or updates are not configured.
    pub fn should_check(
        &self,
        now: u64,
        started_at: u64,
        last: Option<Attempt>,
        auto_enabled: bool,
        configured: bool,
    ) -> bool {
        auto_enabled && configured && now >= self.next_due(started_at, last)
    }
}
