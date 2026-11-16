use crate::backend::HidBackend;
use crate::session::{self, SessionContext, SessionHandlerFactory, STOP_REMOVED, STOP_SHUTDOWN};
use crate::tracker::{Candidate, ConnectionTracker, TrackerAction};
use nexus_controller_core::{
    ConnectedDevice, ControllerDriver, DeviceEvent, DeviceId, DisconnectReason, HidDeviceInfo,
    Identification,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct DeviceManagerConfig {
    /// How often to enumerate HID devices to find new or removed controllers.
    pub scan_interval: Duration,
    /// Read timeout; bounds how quickly a reader thread notices a stop request.
    pub read_timeout: Duration,
}

impl Default for DeviceManagerConfig {
    fn default() -> Self {
        Self {
            scan_interval: Duration::from_millis(1000),
            read_timeout: Duration::from_millis(100),
        }
    }
}

/// One HID collection from the vendor-filtered enumeration, with the
/// identification result (if any). Kept for diagnostics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScannedDevice {
    pub info: HidDeviceInfo,
    pub identification: Option<Identification>,
}

struct RunningSession {
    device: ConnectedDevice,
    stop: Arc<AtomicU8>,
    thread: Option<JoinHandle<()>>,
}

/// Owns all controller connections. Driven by repeated calls to [`poll`]
/// from a single supervisor thread.
///
/// [`poll`]: DeviceManager::poll
pub struct DeviceManager {
    backend: Arc<dyn HidBackend>,
    drivers: Vec<Arc<dyn ControllerDriver>>,
    vendor_ids: Vec<u16>,
    config: DeviceManagerConfig,
    tracker: ConnectionTracker,
    sessions: HashMap<DeviceId, RunningSession>,
    ended_tx: Sender<(DeviceId, DisconnectReason)>,
    ended_rx: Receiver<(DeviceId, DisconnectReason)>,
    factory: SessionHandlerFactory,
    notify: Arc<dyn Fn() + Send + Sync>,
    next_scan: Instant,
    last_enumeration_error: Option<String>,
    last_scan: Vec<ScannedDevice>,
    thread_counter: u64,
}

impl DeviceManager {
    /// `notify` is invoked from reader threads when a session ends, so the
    /// supervisor can wake up and call [`DeviceManager::poll`] promptly.
    pub fn new(
        backend: Arc<dyn HidBackend>,
        drivers: Vec<Arc<dyn ControllerDriver>>,
        config: DeviceManagerConfig,
        factory: SessionHandlerFactory,
        notify: Arc<dyn Fn() + Send + Sync>,
    ) -> Self {
        let mut vendor_ids: Vec<u16> = drivers
            .iter()
            .flat_map(|d| d.vendor_ids().iter().copied())
            .collect();
        vendor_ids.sort_unstable();
        vendor_ids.dedup();
        let (ended_tx, ended_rx) = channel();
        Self {
            backend,
            drivers,
            vendor_ids,
            config,
            tracker: ConnectionTracker::new(),
            sessions: HashMap::new(),
            ended_tx,
            ended_rx,
            factory,
            notify,
            next_scan: Instant::now(),
            last_enumeration_error: None,
            last_scan: Vec::new(),
            thread_counter: 0,
        }
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.name()
    }

    pub fn backend_available(&self) -> bool {
        self.backend.is_available()
    }

    /// The most recent enumeration error, cleared by the next successful scan.
    pub fn last_enumeration_error(&self) -> Option<&str> {
        self.last_enumeration_error.as_deref()
    }

    /// Every HID collection from the most recent successful scan whose vendor
    /// a driver claims, including ones no driver identified.
    pub fn last_scan(&self) -> &[ScannedDevice] {
        &self.last_scan
    }

    pub fn connected_devices(&self) -> Vec<ConnectedDevice> {
        self.sessions.values().map(|s| s.device.clone()).collect()
    }

    /// Makes the next [`poll`](Self::poll) enumerate immediately.
    pub fn request_scan(&mut self) {
        self.next_scan = Instant::now();
    }

    pub fn time_until_next_scan(&self) -> Duration {
        self.next_scan.saturating_duration_since(Instant::now())
    }

    /// Processes ended sessions and, when due, enumerates devices.
    pub fn poll(&mut self) -> Vec<DeviceEvent> {
        let mut events = Vec::new();
        self.collect_ended(&mut events);
        let now = Instant::now();
        if now >= self.next_scan {
            self.scan(now, &mut events);
            self.next_scan = now + self.config.scan_interval;
        }
        events
    }

    fn collect_ended(&mut self, events: &mut Vec<DeviceEvent>) {
        let mut any = false;
        while let Ok((id, reason)) = self.ended_rx.try_recv() {
            if let Some(mut s) = self.sessions.remove(&id) {
                if let Some(t) = s.thread.take() {
                    let _ = t.join();
                }
            }
            self.tracker.on_session_ended(&id, &reason, Instant::now());
            events.push(DeviceEvent::Disconnected {
                device_id: id,
                reason,
            });
            any = true;
        }
        if any {
            // Look again right away: the controller may already be back on
            // another transport, or the error may have been transient.
            self.next_scan = Instant::now();
        }
    }

    fn scan(&mut self, now: Instant, events: &mut Vec<DeviceEvent>) {
        let devices = match self.backend.enumerate(&self.vendor_ids) {
            Ok(d) => {
                self.last_enumeration_error = None;
                d
            }
            Err(e) => {
                let msg = e.to_string();
                if self.last_enumeration_error.as_deref() != Some(msg.as_str()) {
                    events.push(DeviceEvent::EnumerationFailed { error: msg.clone() });
                    self.last_enumeration_error = Some(msg);
                }
                return;
            }
        };

        let mut candidates = Vec::new();
        let mut scanned = Vec::with_capacity(devices.len());
        for info in devices {
            let found = self
                .drivers
                .iter()
                .enumerate()
                .find_map(|(i, d)| d.identify(&info).map(|ident| (i, ident)));
            scanned.push(ScannedDevice {
                info: info.clone(),
                identification: found.as_ref().map(|(_, ident)| ident.clone()),
            });
            if let Some((driver, identification)) = found {
                candidates.push(Candidate {
                    info,
                    identification,
                    driver,
                });
            }
        }
        self.last_scan = scanned;

        let (actions, tracker_events) = self.tracker.reconcile(candidates, now);
        events.extend(tracker_events);

        for action in actions {
            match action {
                TrackerAction::Open(candidate) => self.open(candidate, now, events),
                TrackerAction::Close(id) => {
                    if let Some(s) = self.sessions.get(&id) {
                        s.stop.store(STOP_REMOVED, Ordering::Release);
                    }
                }
            }
        }
    }

    fn open(&mut self, candidate: Candidate, now: Instant, events: &mut Vec<DeviceEvent>) {
        let id = candidate.id();
        let connection = match self.backend.open(&candidate.info) {
            Ok(c) => c,
            Err(e) => {
                events.push(self.tracker.on_open_failed(&id, e.to_string(), now));
                return;
            }
        };
        self.tracker.on_opened(&id);

        let ident = candidate.identification.clone();
        let device = ConnectedDevice {
            id: id.clone(),
            model: ident.model,
            connection: ident.connection,
            origin: ident.origin,
            vendor_id: candidate.info.vendor_id,
            product_id: candidate.info.product_id,
            product_name: candidate.info.product.clone(),
            serial_number: candidate.info.serial_number.clone(),
            output_report_len: candidate.info.output_report_len,
        };
        let handler = (self.factory)(&device);
        let stop = Arc::new(AtomicU8::new(session::STOP_NONE));
        let ctx = SessionContext {
            connection,
            driver: self.drivers[candidate.driver].clone(),
            info: candidate.info,
            identification: ident,
            handler,
            stop: stop.clone(),
            read_timeout: self.config.read_timeout,
            ended: self.ended_tx.clone(),
            notify: self.notify.clone(),
        };
        self.thread_counter += 1;
        let spawn = std::thread::Builder::new()
            .name(format!("nexus-hid-{}", self.thread_counter))
            .spawn(move || session::run(ctx));
        match spawn {
            Ok(thread) => {
                self.sessions.insert(
                    id,
                    RunningSession {
                        device: device.clone(),
                        stop,
                        thread: Some(thread),
                    },
                );
                events.push(DeviceEvent::Connected { device });
            }
            Err(e) => {
                events.push(self.tracker.on_open_failed(
                    &id,
                    format!("could not start reader thread: {e}"),
                    now,
                ));
            }
        }
    }

    /// Stops every session and waits for reader threads to exit.
    pub fn shutdown(&mut self) -> Vec<DeviceEvent> {
        for s in self.sessions.values() {
            s.stop.store(STOP_SHUTDOWN, Ordering::Release);
        }
        for s in self.sessions.values_mut() {
            if let Some(t) = s.thread.take() {
                let _ = t.join();
            }
        }
        let mut events = Vec::new();
        self.collect_ended(&mut events);
        self.sessions.clear();
        events
    }
}

impl Drop for DeviceManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::MockHidBackend;
    use crate::session::SessionHandler;
    use nexus_controller_core::{ControllerState, ReportError};
    use nexus_dualsense_like::*;
    use std::sync::Mutex;

    /// Minimal driver so this crate's tests don't depend on a real driver crate.
    mod nexus_dualsense_like {
        use nexus_controller_core::*;
        pub struct TestDriver;
        pub struct EchoParser;
        impl ReportParser for EchoParser {
            fn parse(&mut self, r: &[u8]) -> Result<ControllerState, ReportError> {
                match r.first() {
                    Some(0x01) => Ok(ControllerState {
                        sequence: r.get(1).copied(),
                        ..Default::default()
                    }),
                    Some(&id) => Err(ReportError::UnsupportedReportId(id)),
                    None => Err(ReportError::Empty),
                }
            }
        }
        impl ControllerDriver for TestDriver {
            fn name(&self) -> &'static str {
                "test"
            }
            fn vendor_ids(&self) -> &'static [u16] {
                &[0x1234]
            }
            fn identify(&self, d: &HidDeviceInfo) -> Option<Identification> {
                (d.vendor_id == 0x1234).then_some(Identification {
                    model: ControllerModel::DualSense,
                    connection: ConnectionType::Usb,
                    origin: if d
                        .ancestor_instance_ids
                        .iter()
                        .any(|a| a.starts_with("ROOT"))
                    {
                        DeviceOrigin::Virtual
                    } else {
                        DeviceOrigin::Physical
                    },
                })
            }
            fn create_parser(&self, _: &Identification) -> Box<dyn ReportParser> {
                Box::new(EchoParser)
            }
        }
    }

    type ReportLog = Arc<Mutex<Vec<Result<Option<u8>, ReportError>>>>;

    #[derive(Default, Clone)]
    struct Recorder {
        reports: ReportLog,
        ends: Arc<Mutex<Vec<DisconnectReason>>>,
    }
    struct RecHandler(Recorder);
    impl SessionHandler for RecHandler {
        fn on_report(&mut self, _raw: &[u8], p: Result<ControllerState, ReportError>) {
            self.0.reports.lock().unwrap().push(p.map(|s| s.sequence));
        }
        fn on_end(&mut self, r: &DisconnectReason) {
            self.0.ends.lock().unwrap().push(r.clone());
        }
    }

    fn info(path: &str) -> nexus_controller_core::HidDeviceInfo {
        nexus_controller_core::HidDeviceInfo {
            path: path.into(),
            vendor_id: 0x1234,
            input_report_len: 64,
            ..Default::default()
        }
    }

    fn manager(backend: &MockHidBackend, rec: &Recorder) -> DeviceManager {
        let rec = rec.clone();
        DeviceManager::new(
            Arc::new(backend.clone()),
            vec![Arc::new(TestDriver)],
            DeviceManagerConfig {
                scan_interval: Duration::from_millis(10),
                read_timeout: Duration::from_millis(5),
            },
            Box::new(move |_| Box::new(RecHandler(rec.clone()))),
            Arc::new(|| {}),
        )
    }

    /// Polls until `pred` matches an event or the timeout expires.
    fn poll_until(m: &mut DeviceManager, pred: impl Fn(&DeviceEvent) -> bool) -> Vec<DeviceEvent> {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut all = vec![];
        while Instant::now() < deadline {
            let evs = m.poll();
            let hit = evs.iter().any(&pred);
            all.extend(evs);
            if hit {
                return all;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        panic!("condition not reached; events: {all:?}");
    }

    fn wait_for(cond: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !cond() {
            assert!(Instant::now() < deadline, "timed out");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    #[test]
    fn no_device_means_no_connection() {
        let backend = MockHidBackend::new();
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        for _ in 0..5 {
            assert!(m.poll().is_empty());
            std::thread::sleep(Duration::from_millis(11));
        }
        assert!(m.connected_devices().is_empty());
    }

    #[test]
    fn detects_already_connected_device_on_first_poll() {
        let backend = MockHidBackend::new();
        backend.plug(info("pad"));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        let events = m.poll();
        assert!(matches!(&events[..], [DeviceEvent::Connected { .. }]));
        assert_eq!(m.connected_devices().len(), 1);
    }

    #[test]
    fn delivers_reports_including_invalid_ones() {
        let backend = MockHidBackend::new();
        backend.plug(info("pad"));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        m.poll();
        backend.push_report("pad", vec![0x01, 7]);
        backend.push_report("pad", vec![0x09]);
        backend.push_report("pad", vec![0x01, 8]);
        wait_for(|| rec.reports.lock().unwrap().len() == 3);
        assert_eq!(
            *rec.reports.lock().unwrap(),
            vec![
                Ok(Some(7)),
                Err(ReportError::UnsupportedReportId(9)),
                Ok(Some(8))
            ]
        );
    }

    #[test]
    fn unplug_then_replug_reconnects_without_duplicates() {
        let backend = MockHidBackend::new();
        backend.plug(info("pad"));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));

        backend.unplug("pad");
        poll_until(&mut m, |e| {
            matches!(
                e,
                DeviceEvent::Disconnected {
                    reason: DisconnectReason::Removed,
                    ..
                }
            )
        });
        assert!(m.connected_devices().is_empty());
        assert_eq!(backend.live_connections("pad"), 0, "old handle closed");

        backend.plug(info("pad"));
        poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));
        // Keep polling for a while: no second connection may appear.
        for _ in 0..20 {
            for e in m.poll() {
                assert!(
                    !matches!(e, DeviceEvent::Connected { .. }),
                    "duplicate connect"
                );
            }
            std::thread::sleep(Duration::from_millis(3));
        }
        assert_eq!(backend.open_count("pad"), 2);
        assert_eq!(backend.live_connections("pad"), 1);
    }

    #[test]
    fn device_vanishing_from_enumeration_ends_session_as_removed() {
        let backend = MockHidBackend::new();
        backend.plug(info("pad"));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        m.poll();
        // Remove from enumeration but keep the handle readable (the OS has
        // not failed the read yet).
        backend.hide("pad");
        poll_until(&mut m, |e| {
            matches!(
                e,
                DeviceEvent::Disconnected {
                    reason: DisconnectReason::Removed,
                    ..
                }
            )
        });
    }

    #[test]
    fn open_failure_is_reported_and_retried() {
        let backend = MockHidBackend::new();
        backend.plug(info("pad"));
        backend.set_fail_open("pad", true);
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        let events = m.poll();
        assert!(matches!(
            &events[..],
            [DeviceEvent::OpenFailed {
                retry_in_ms: 1000,
                ..
            }]
        ));
        assert!(m.connected_devices().is_empty());
        backend.set_fail_open("pad", false);
        // Retried after the 1 s backoff.
        poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));
    }

    #[test]
    fn last_scan_lists_identified_and_unidentified_devices() {
        let backend = MockHidBackend::new();
        backend.plug(info("pad"));
        let mut other = info("other");
        other.vendor_id = 0x9999; // filtered out by vendor
        backend.plug(other);
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        m.poll();
        let scan = m.last_scan();
        assert_eq!(scan.len(), 1);
        assert_eq!(scan[0].info.path, "pad");
        assert!(scan[0].identification.is_some());
    }

    #[test]
    fn virtual_device_is_never_opened() {
        let backend = MockHidBackend::new();
        let mut v = info("virtual-pad");
        v.ancestor_instance_ids = vec![r"ROOT\SYSTEM\0001".into()];
        backend.plug(v);
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        let events = m.poll();
        assert!(matches!(
            &events[..],
            [DeviceEvent::VirtualDeviceIgnored { .. }]
        ));
        assert_eq!(backend.open_count("virtual-pad"), 0);
    }

    #[test]
    fn enumeration_failure_reported_once() {
        let backend = MockHidBackend::new();
        backend.set_enumeration_error(Some("boom".into()));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        assert!(matches!(
            &m.poll()[..],
            [DeviceEvent::EnumerationFailed { .. }]
        ));
        std::thread::sleep(Duration::from_millis(11));
        assert!(m.poll().is_empty());
    }

    #[test]
    fn shutdown_joins_threads_and_closes_handles() {
        let backend = MockHidBackend::new();
        backend.plug(info("a"));
        backend.plug(info("b"));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        m.poll();
        assert_eq!(m.connected_devices().len(), 2);
        let events = m.shutdown();
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| matches!(
            e,
            DeviceEvent::Disconnected {
                reason: DisconnectReason::Shutdown,
                ..
            }
        )));
        assert_eq!(
            backend.live_connections("a") + backend.live_connections("b"),
            0
        );
        assert_eq!(rec.ends.lock().unwrap().len(), 2);
    }

    // ---- USB reliability (Milestone 4, simulated with the mock backend) ----

    type TaggedLog = Arc<Mutex<Vec<(String, Option<u8>)>>>;

    /// Records which session (device path) delivered each report.
    fn tagged_manager(backend: &MockHidBackend, log: &TaggedLog) -> DeviceManager {
        struct Tagged(String, TaggedLog);
        impl SessionHandler for Tagged {
            fn on_report(&mut self, _raw: &[u8], p: Result<ControllerState, ReportError>) {
                if let Ok(s) = p {
                    self.1.lock().unwrap().push((self.0.clone(), s.sequence));
                }
            }
            fn on_end(&mut self, _r: &DisconnectReason) {}
        }
        let log = log.clone();
        DeviceManager::new(
            Arc::new(backend.clone()),
            vec![Arc::new(TestDriver)],
            DeviceManagerConfig {
                scan_interval: Duration::from_millis(10),
                read_timeout: Duration::from_millis(5),
            },
            Box::new(move |d| Box::new(Tagged(d.id.0.clone(), log.clone()))),
            Arc::new(|| {}),
        )
    }

    fn with_serial(path: &str, serial: Option<&str>) -> nexus_controller_core::HidDeviceInfo {
        nexus_controller_core::HidDeviceInfo {
            serial_number: serial.map(str::to_owned),
            ..info(path)
        }
    }

    fn connected_paths(m: &DeviceManager) -> Vec<String> {
        let mut v: Vec<String> = m.connected_devices().into_iter().map(|d| d.id.0).collect();
        v.sort();
        v
    }

    #[test]
    fn new_hid_path_with_same_serial_replaces_the_old_session() {
        // Windows can give a re-plugged controller a new interface path while
        // the old session has not failed its read yet.
        let backend = MockHidBackend::new();
        backend.plug(with_serial("path-a", Some("SERIAL1")));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));

        backend.hide("path-a"); // old handle still readable, gone from enumeration
        backend.plug(with_serial("path-b", Some("SERIAL1")));
        let events = poll_until(
            &mut m,
            |e| matches!(e, DeviceEvent::Connected { device } if device.id.0 == "path-b"),
        );
        assert!(events.iter().any(|e| matches!(e,
            DeviceEvent::Disconnected { device_id, reason: DisconnectReason::Removed } if device_id.0 == "path-a")));
        assert_eq!(connected_paths(&m), vec!["path-b"]);
        assert_eq!(backend.live_connections("path-a"), 0, "old handle closed");
        assert_eq!(backend.live_connections("path-b"), 1);
    }

    #[test]
    fn new_hid_path_without_serial_reconnects_once() {
        // Windows often reports no serial number for a USB DualSense.
        let backend = MockHidBackend::new();
        backend.plug(with_serial("path-a", None));
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));
        backend.unplug("path-a");
        backend.plug(with_serial("path-b", None));
        poll_until(
            &mut m,
            |e| matches!(e, DeviceEvent::Connected { device } if device.id.0 == "path-b"),
        );
        for _ in 0..20 {
            m.poll();
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(connected_paths(&m), vec!["path-b"]);
        assert_eq!(backend.live_connections("path-a"), 0);
    }

    #[test]
    fn repeated_replug_cycles_never_duplicate_or_leak() {
        const CYCLES: usize = 100;
        let backend = MockHidBackend::new();
        let rec = Recorder::default();
        let mut m = manager(&backend, &rec);
        let (mut connects, mut disconnects) = (0, 0);
        let count = |evs: &[DeviceEvent], c: &mut usize, d: &mut usize| {
            for e in evs {
                match e {
                    DeviceEvent::Connected { .. } => *c += 1,
                    DeviceEvent::Disconnected { .. } => *d += 1,
                    _ => {}
                }
            }
        };
        for i in 0..CYCLES {
            // Alternate paths, as Windows may do across re-plugs.
            let path = if i % 2 == 0 { "pad-x" } else { "pad-y" };
            backend.plug(with_serial(path, Some("S")));
            let evs = poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));
            count(&evs, &mut connects, &mut disconnects);
            assert_eq!(connected_paths(&m), vec![path], "cycle {i}");
            backend.unplug(path);
            let evs = poll_until(&mut m, |e| matches!(e, DeviceEvent::Disconnected { .. }));
            count(&evs, &mut connects, &mut disconnects);
            assert!(m.connected_devices().is_empty(), "cycle {i}");
            assert_eq!(
                backend.live_connections(path),
                0,
                "cycle {i}: handle leaked"
            );
        }
        assert_eq!((connects, disconnects), (CYCLES, CYCLES));
        assert!(m.sessions.is_empty(), "all reader threads joined");
    }

    #[test]
    fn reports_from_a_removed_session_never_reach_the_new_one() {
        let backend = MockHidBackend::new();
        backend.plug(with_serial("old", Some("S")));
        let log = TaggedLog::default();
        let mut m = tagged_manager(&backend, &log);
        poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));
        backend.push_report("old", vec![0x01, 1]);
        wait_for(|| log.lock().unwrap().len() == 1);

        backend.hide("old");
        backend.plug(with_serial("new", Some("S")));
        poll_until(
            &mut m,
            |e| matches!(e, DeviceEvent::Connected { device } if device.id.0 == "new"),
        );
        // A late report on the old handle must go nowhere.
        backend.push_report("old", vec![0x01, 99]);
        backend.push_report("new", vec![0x01, 2]);
        wait_for(|| log.lock().unwrap().iter().any(|(p, _)| p == "new"));
        std::thread::sleep(Duration::from_millis(30));
        let log = log.lock().unwrap().clone();
        assert_eq!(
            log,
            vec![("old".to_owned(), Some(1)), ("new".to_owned(), Some(2))]
        );
    }

    #[test]
    fn shutdown_and_restart_reopen_the_same_controller_once() {
        let backend = MockHidBackend::new();
        backend.plug(with_serial("pad", Some("S")));
        for run in 0..5 {
            let rec = Recorder::default();
            let mut m = manager(&backend, &rec);
            poll_until(&mut m, |e| matches!(e, DeviceEvent::Connected { .. }));
            assert_eq!(backend.live_connections("pad"), 1, "run {run}");
            m.shutdown();
            assert_eq!(
                backend.live_connections("pad"),
                0,
                "run {run}: handle released on exit"
            );
        }
        assert_eq!(backend.open_count("pad"), 5);
    }
}
