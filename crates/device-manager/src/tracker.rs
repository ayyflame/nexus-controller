//! Connection policy as a pure state machine (no I/O, no threads), so that
//! deduplication, reconnection and backoff are fully unit-testable.

use nexus_controller_core::{
    DeviceEvent, DeviceId, DeviceOrigin, DisconnectReason, HidDeviceInfo, Identification,
};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

/// A HID device recognised by a driver during the latest enumeration.
#[derive(Clone, Debug)]
pub struct Candidate {
    pub info: HidDeviceInfo,
    pub identification: Identification,
    /// Index of the driver that recognised it.
    pub driver: usize,
}

impl Candidate {
    pub fn id(&self) -> DeviceId {
        DeviceId(self.info.path.clone())
    }
    fn serial(&self) -> Option<&str> {
        self.info
            .serial_number
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug)]
pub enum TrackerAction {
    Open(Candidate),
    /// The device is no longer enumerated; stop its session.
    Close(DeviceId),
}

#[derive(Clone, Copy, Debug)]
struct Backoff {
    attempts: u32,
    retry_at: Instant,
}

pub const BACKOFF_BASE: Duration = Duration::from_secs(1);
pub const BACKOFF_MAX: Duration = Duration::from_secs(16);

fn backoff_delay(attempts: u32) -> Duration {
    let shift = attempts.saturating_sub(1).min(5);
    (BACKOFF_BASE * (1u32 << shift)).min(BACKOFF_MAX)
}

#[derive(Debug, Default)]
pub struct ConnectionTracker {
    /// Devices with a live session, and their serial number if known.
    active: HashMap<DeviceId, Option<String>>,
    /// Virtual devices already reported, so the event is emitted once.
    ignored_virtual: HashSet<DeviceId>,
    ignored_duplicate: HashSet<DeviceId>,
    backoff: HashMap<DeviceId, Backoff>,
}

impl ConnectionTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_active(&self, id: &DeviceId) -> bool {
        self.active.contains_key(id)
    }

    pub fn active_count(&self) -> usize {
        self.active.len()
    }

    /// Compares the current enumeration with known state and decides what to
    /// open and close. Never asks to open a device that already has a session.
    pub fn reconcile(
        &mut self,
        candidates: Vec<Candidate>,
        now: Instant,
    ) -> (Vec<TrackerAction>, Vec<DeviceEvent>) {
        let mut actions = Vec::new();
        let mut events = Vec::new();
        let present: HashSet<DeviceId> = candidates.iter().map(Candidate::id).collect();

        for candidate in candidates {
            let id = candidate.id();
            if candidate.identification.origin == DeviceOrigin::Virtual {
                if self.ignored_virtual.insert(id.clone()) {
                    events.push(DeviceEvent::VirtualDeviceIgnored {
                        device_id: id,
                        model: candidate.identification.model,
                    });
                }
                continue;
            }
            if self.active.contains_key(&id) {
                continue;
            }
            if let Some(serial) = candidate.serial() {
                let existing = self
                    .active
                    .iter()
                    .find(|(_, s)| s.as_deref() == Some(serial))
                    .map(|(existing, _)| existing.clone());
                if let Some(existing) = existing {
                    if self.ignored_duplicate.insert(id.clone()) {
                        events.push(DeviceEvent::DuplicateIgnored {
                            device_id: id,
                            existing,
                        });
                    }
                    continue;
                }
            }
            if let Some(b) = self.backoff.get(&id) {
                if now < b.retry_at {
                    continue;
                }
            }
            // Reserve the slot now so a second candidate with the same serial
            // in this same scan is treated as a duplicate.
            self.active
                .insert(id, candidate.serial().map(str::to_owned));
            actions.push(TrackerAction::Open(candidate));
        }

        for id in self.active.keys() {
            if !present.contains(id) {
                actions.push(TrackerAction::Close(id.clone()));
            }
        }

        // Forget per-device bookkeeping for devices that disappeared, so a
        // re-plug is reported and retried immediately.
        self.ignored_virtual.retain(|id| present.contains(id));
        self.ignored_duplicate.retain(|id| present.contains(id));
        self.backoff.retain(|id, _| present.contains(id));

        (actions, events)
    }

    pub fn on_opened(&mut self, id: &DeviceId) {
        self.backoff.remove(id);
    }

    /// Records a failed open and returns the event to publish.
    pub fn on_open_failed(&mut self, id: &DeviceId, error: String, now: Instant) -> DeviceEvent {
        self.active.remove(id);
        let delay = self.bump_backoff(id, now);
        DeviceEvent::OpenFailed {
            device_id: id.clone(),
            error,
            retry_in_ms: delay.as_millis() as u64,
        }
    }

    /// Records the end of a session. Removal clears backoff so the device
    /// reconnects as soon as it reappears; an I/O error backs off.
    pub fn on_session_ended(&mut self, id: &DeviceId, reason: &DisconnectReason, now: Instant) {
        self.active.remove(id);
        self.ignored_duplicate.clear();
        match reason {
            DisconnectReason::Error(_) => {
                self.bump_backoff(id, now);
            }
            DisconnectReason::Removed | DisconnectReason::Shutdown => {
                self.backoff.remove(id);
            }
        }
    }

    fn bump_backoff(&mut self, id: &DeviceId, now: Instant) -> Duration {
        let entry = self.backoff.entry(id.clone()).or_insert(Backoff {
            attempts: 0,
            retry_at: now,
        });
        entry.attempts += 1;
        let delay = backoff_delay(entry.attempts);
        entry.retry_at = now + delay;
        delay
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nexus_controller_core::{ConnectionType, ControllerModel};

    fn candidate(path: &str, origin: DeviceOrigin, serial: Option<&str>) -> Candidate {
        Candidate {
            info: HidDeviceInfo {
                path: path.into(),
                serial_number: serial.map(Into::into),
                ..Default::default()
            },
            identification: Identification {
                model: ControllerModel::DualSense,
                connection: ConnectionType::Usb,
                origin,
            },
            driver: 0,
        }
    }

    fn opens(actions: &[TrackerAction]) -> Vec<String> {
        actions
            .iter()
            .filter_map(|a| match a {
                TrackerAction::Open(c) => Some(c.info.path.clone()),
                _ => None,
            })
            .collect()
    }

    fn closes(actions: &[TrackerAction]) -> Vec<String> {
        actions
            .iter()
            .filter_map(|a| match a {
                TrackerAction::Close(id) => Some(id.0.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn opens_new_device_once() {
        let mut t = ConnectionTracker::new();
        let now = Instant::now();
        let c = candidate("a", DeviceOrigin::Physical, None);
        let (a, _) = t.reconcile(vec![c.clone()], now);
        assert_eq!(opens(&a), vec!["a"]);
        t.on_opened(&c.id());
        for _ in 0..5 {
            let (a, e) = t.reconcile(vec![c.clone()], now);
            assert!(
                a.is_empty() && e.is_empty(),
                "duplicate connection requested"
            );
        }
        assert_eq!(t.active_count(), 1);
    }

    #[test]
    fn unknown_origin_is_opened_virtual_is_ignored_once() {
        let mut t = ConnectionTracker::new();
        let now = Instant::now();
        let v = candidate("virt", DeviceOrigin::Virtual, None);
        let u = candidate("unk", DeviceOrigin::Unknown, None);
        let (a, e) = t.reconcile(vec![v.clone(), u.clone()], now);
        assert_eq!(opens(&a), vec!["unk"]);
        assert!(matches!(&e[..], [DeviceEvent::VirtualDeviceIgnored { .. }]));
        let (_, e) = t.reconcile(vec![v.clone(), u], now);
        assert!(e.is_empty(), "virtual device reported twice");
    }

    #[test]
    fn same_serial_on_second_interface_is_duplicate() {
        let mut t = ConnectionTracker::new();
        let now = Instant::now();
        let usb = candidate("usb", DeviceOrigin::Physical, Some("AA:BB"));
        let bt = candidate("bt", DeviceOrigin::Physical, Some("AA:BB"));
        let (a, e) = t.reconcile(vec![usb.clone(), bt.clone()], now);
        assert_eq!(opens(&a), vec!["usb"]);
        assert!(matches!(&e[..], [DeviceEvent::DuplicateIgnored { .. }]));
        // Once the first goes away, the second may connect.
        t.on_session_ended(&usb.id(), &DisconnectReason::Removed, now);
        let (a, _) = t.reconcile(vec![bt], now);
        assert_eq!(opens(&a), vec!["bt"]);
    }

    #[test]
    fn removed_device_is_closed_and_reconnects_immediately_when_back() {
        let mut t = ConnectionTracker::new();
        let now = Instant::now();
        let c = candidate("a", DeviceOrigin::Physical, None);
        t.reconcile(vec![c.clone()], now);
        t.on_opened(&c.id());

        let (a, _) = t.reconcile(vec![], now);
        assert_eq!(closes(&a), vec!["a"]);
        assert!(t.is_active(&c.id()), "stays active until the session ends");
        t.on_session_ended(&c.id(), &DisconnectReason::Removed, now);
        assert!(!t.is_active(&c.id()));

        let (a, _) = t.reconcile(vec![c.clone()], now);
        assert_eq!(opens(&a), vec!["a"], "reconnect without delay");
    }

    #[test]
    fn open_failures_back_off_exponentially() {
        let mut t = ConnectionTracker::new();
        let t0 = Instant::now();
        let c = candidate("a", DeviceOrigin::Physical, None);
        let mut now = t0;
        let mut delays = vec![];
        for _ in 0..7 {
            let (a, _) = t.reconcile(vec![c.clone()], now);
            assert_eq!(opens(&a), vec!["a"]);
            match t.on_open_failed(&c.id(), "busy".into(), now) {
                DeviceEvent::OpenFailed { retry_in_ms, .. } => delays.push(retry_in_ms),
                e => panic!("unexpected {e:?}"),
            }
            // Not retried before the deadline...
            let (a, _) = t.reconcile(vec![c.clone()], now + Duration::from_millis(999));
            assert!(opens(&a).is_empty());
            now += Duration::from_millis(*delays.last().unwrap());
        }
        assert_eq!(delays, vec![1000, 2000, 4000, 8000, 16000, 16000, 16000]);
        // ...and success resets it.
        t.reconcile(vec![c.clone()], now);
        t.on_opened(&c.id());
        t.on_session_ended(&c.id(), &DisconnectReason::Removed, now);
        let (a, _) = t.reconcile(vec![c.clone()], now);
        assert_eq!(opens(&a), vec!["a"]);
    }

    #[test]
    fn io_error_session_end_backs_off_but_retries() {
        let mut t = ConnectionTracker::new();
        let now = Instant::now();
        let c = candidate("a", DeviceOrigin::Physical, None);
        t.reconcile(vec![c.clone()], now);
        t.on_opened(&c.id());
        t.on_session_ended(&c.id(), &DisconnectReason::Error("glitch".into()), now);
        let (a, _) = t.reconcile(vec![c.clone()], now);
        assert!(opens(&a).is_empty());
        let (a, _) = t.reconcile(vec![c.clone()], now + BACKOFF_BASE);
        assert_eq!(opens(&a), vec!["a"]);
    }

    #[test]
    fn backoff_is_forgotten_when_device_disappears() {
        let mut t = ConnectionTracker::new();
        let now = Instant::now();
        let c = candidate("a", DeviceOrigin::Physical, None);
        t.reconcile(vec![c.clone()], now);
        t.on_open_failed(&c.id(), "busy".into(), now);
        t.reconcile(vec![], now); // unplugged
        let (a, _) = t.reconcile(vec![c], now); // plugged back in
        assert_eq!(opens(&a), vec!["a"]);
    }
}
