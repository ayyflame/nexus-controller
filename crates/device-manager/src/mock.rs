//! In-memory HID backend for **automated tests only**. Compiled only with
//! `cfg(test)` or the `test-support` feature; never used by the application.

use crate::backend::HidBackend;
use nexus_controller_core::{HidConnection, HidDeviceInfo, HidError};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct DeviceSlot {
    info: Option<HidDeviceInfo>,
    writes: Arc<Mutex<Vec<Vec<u8>>>>,
    enumerated: bool,
    reports: Arc<Mutex<VecDeque<Vec<u8>>>>,
    connected: Arc<AtomicBool>,
    live: Arc<AtomicUsize>,
    opens: usize,
    fail_open: bool,
}

#[derive(Default)]
struct State {
    devices: HashMap<String, DeviceSlot>,
    enumeration_error: Option<String>,
}

#[derive(Clone, Default)]
pub struct MockHidBackend {
    state: Arc<Mutex<State>>,
}

impl MockHidBackend {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds (or re-adds) a device. A re-plugged device gets a fresh report queue.
    pub fn plug(&self, info: HidDeviceInfo) {
        let mut st = self.state.lock().unwrap();
        let slot = st.devices.entry(info.path.clone()).or_default();
        slot.info = Some(info);
        slot.enumerated = true;
        slot.reports = Arc::default();
        slot.connected = Arc::new(AtomicBool::new(true));
    }

    /// Simulates a physical unplug: gone from enumeration and open handles fail.
    pub fn unplug(&self, path: &str) {
        let mut st = self.state.lock().unwrap();
        if let Some(slot) = st.devices.get_mut(path) {
            slot.enumerated = false;
            slot.connected.store(false, Ordering::SeqCst);
        }
    }

    /// Removes from enumeration only; open handles keep working.
    pub fn hide(&self, path: &str) {
        if let Some(slot) = self.state.lock().unwrap().devices.get_mut(path) {
            slot.enumerated = false;
        }
    }

    pub fn push_report(&self, path: &str, report: Vec<u8>) {
        let st = self.state.lock().unwrap();
        st.devices[path].reports.lock().unwrap().push_back(report);
    }

    pub fn set_fail_open(&self, path: &str, fail: bool) {
        self.state
            .lock()
            .unwrap()
            .devices
            .get_mut(path)
            .unwrap()
            .fail_open = fail;
    }

    pub fn set_enumeration_error(&self, error: Option<String>) {
        self.state.lock().unwrap().enumeration_error = error;
    }

    /// Output reports written to a device, oldest first.
    pub fn writes(&self, path: &str) -> Vec<Vec<u8>> {
        self.state
            .lock()
            .unwrap()
            .devices
            .get(path)
            .map_or(Vec::new(), |s| s.writes.lock().unwrap().clone())
    }

    pub fn open_count(&self, path: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .devices
            .get(path)
            .map_or(0, |s| s.opens)
    }

    /// Number of currently open (not yet dropped) connections.
    pub fn live_connections(&self, path: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .devices
            .get(path)
            .map_or(0, |s| s.live.load(Ordering::SeqCst))
    }
}

impl HidBackend for MockHidBackend {
    fn name(&self) -> &'static str {
        "mock"
    }

    fn enumerate(&self, vendor_ids: &[u16]) -> Result<Vec<HidDeviceInfo>, HidError> {
        let st = self.state.lock().unwrap();
        if let Some(e) = &st.enumeration_error {
            return Err(HidError::Io(e.clone()));
        }
        let mut out: Vec<HidDeviceInfo> = st
            .devices
            .values()
            .filter(|s| s.enumerated)
            .filter_map(|s| s.info.clone())
            .filter(|i| vendor_ids.contains(&i.vendor_id))
            .collect();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn open(&self, device: &HidDeviceInfo) -> Result<Box<dyn HidConnection>, HidError> {
        let mut st = self.state.lock().unwrap();
        let slot = st.devices.get_mut(&device.path).ok_or(HidError::NotFound)?;
        if slot.fail_open {
            return Err(HidError::AccessDenied);
        }
        if !slot.enumerated {
            return Err(HidError::NotFound);
        }
        slot.opens += 1;
        slot.live.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(MockConnection {
            writes: slot.writes.clone(),
            reports: slot.reports.clone(),
            connected: slot.connected.clone(),
            live: slot.live.clone(),
        }))
    }
}

struct MockConnection {
    writes: Arc<Mutex<Vec<Vec<u8>>>>,
    reports: Arc<Mutex<VecDeque<Vec<u8>>>>,
    connected: Arc<AtomicBool>,
    live: Arc<AtomicUsize>,
}

impl HidConnection for MockConnection {
    fn read_report(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize, HidError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(HidError::Disconnected);
        }
        if let Some(r) = self.reports.lock().unwrap().pop_front() {
            let n = r.len().min(buf.len());
            buf[..n].copy_from_slice(&r[..n]);
            return Ok(n);
        }
        std::thread::sleep(timeout.min(Duration::from_millis(2)));
        Ok(0)
    }

    fn write_output_report(&mut self, report: &[u8]) -> Result<usize, HidError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(HidError::Disconnected);
        }
        self.writes.lock().unwrap().push(report.to_vec());
        Ok(report.len())
    }

    fn get_feature_report(&mut self, buf: &mut [u8]) -> Result<usize, HidError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(HidError::Disconnected);
        }
        Ok(buf.len())
    }
}

impl Drop for MockConnection {
    fn drop(&mut self) {
        self.live.fetch_sub(1, Ordering::SeqCst);
    }
}
