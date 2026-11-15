//! The NEXUS controller engine runtime.
//!
//! Owns device discovery, per-controller input pipelines and virtual output,
//! and runs entirely on its own threads. It has no knowledge of the UI. The
//! desktop shell only calls [`Engine`] methods and polls snapshots, so UI
//! rendering or navigation can never stall controller input.
//!
//! Threads:
//! * **supervisor** (`nexus-supervisor`) — enumeration, connect/disconnect
//!   handling, event fan-out.
//! * **one reader per controller** (`nexus-hid-N`) — read → parse → process →
//!   virtual output, with no hop through another thread (lowest latency).

#![forbid(unsafe_code)]

use nexus_controller_core::{
    ConnectedDevice, ConnectionType, ControllerDriver, ControllerModel, ControllerState,
    DeviceEvent, DeviceId, DeviceOrigin, DisconnectReason, ReportError, VirtualOutputKind,
};
use nexus_device_manager::{
    platform_backend, DeviceManager, DeviceManagerConfig, HidBackend, ScannedDevice, SessionHandler,
};
use nexus_dualsense::DualSenseDriver;
use nexus_input_processing::ProcessingPipeline;
use nexus_macro_engine::{
    Macro, MacroButton, MacroLibrary, MacroRecorder, MacroRunner, RecordingResult,
};
use nexus_telemetry::{unix_millis, LogEntry, LogLevel, RateCounter, RawReport, Telemetry};
use nexus_virtual_controller::{
    BackendStatus, OutputStatus, UnavailableBackend, VirtualControllerBackend, VirtualOutputManager,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub type OutputBackendFactory = Arc<dyn Fn() -> Box<dyn VirtualControllerBackend> + Send + Sync>;

#[derive(Clone, Debug)]
pub struct EngineConfig {
    pub devices: DeviceManagerConfig,
    /// Virtual output requested at start-up (normally from the last profile).
    pub initial_output: VirtualOutputKind,
    pub log_capacity: usize,
    pub raw_report_capacity: usize,
    /// Register for OS device arrival/removal notifications (Windows).
    pub hotplug: bool,
    /// Scan interval used as a safety net while notifications are active.
    pub hotplug_fallback_interval: Duration,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            devices: DeviceManagerConfig::default(),
            initial_output: VirtualOutputKind::Disabled,
            log_capacity: 500,
            raw_report_capacity: 256,
            hotplug: true,
            hotplug_fallback_interval: Duration::from_secs(5),
        }
    }
}

/// Live view of one connected physical controller.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    pub device: ConnectedDevice,
    pub connected_at_ms: u64,
    /// Latest **physical** input exactly as parsed. `None` until the first
    /// valid report arrives.
    pub input: Option<ControllerState>,
    /// What games would receive: input after processing and macros.
    pub processed: Option<ControllerState>,
    /// IDs of macros currently playing on this controller.
    pub playing_macros: Vec<String>,
    pub last_report_ms: Option<u64>,
    pub report_rate_hz: f64,
    pub total_reports: u64,
    pub parse_errors: u64,
    pub last_parse_error: Option<String>,
    pub output: OutputStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// Increments whenever anything in the status changes.
    pub revision: u64,
    pub hid_backend: String,
    pub hid_available: bool,
    /// OS device notifications are active (instant connect/disconnect).
    pub hotplug_active: bool,
    pub enumeration_error: Option<String>,
    pub requested_output: VirtualOutputKind,
    pub output_backend: String,
    pub output_backend_status: BackendStatus,
    pub devices: Vec<DeviceSnapshot>,
    pub macros: MacroRuntimeStatus,
}

/// Whether macros can affect games right now, and recording progress.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroRuntimeStatus {
    /// Macros that are enabled, assigned and have a sequence.
    pub armed: usize,
    /// `true` only when a virtual controller exists for macro output.
    pub games_can_receive: bool,
    /// User-facing explanation when `games_can_receive` is false.
    pub blocked_reason: Option<String>,
    pub recording: Option<RecordingStatus>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub elapsed_ms: u64,
    pub presses: usize,
    /// Buttons held right now (being recorded).
    pub held: Vec<MacroButton>,
    pub limit_reached: bool,
    /// The controller disconnected; recording stopped.
    pub interrupted: bool,
}

struct RecordingState {
    recorder: MacroRecorder,
    /// Only the first controller that reports is recorded.
    device: Option<DeviceId>,
    interrupted: bool,
}

/// What Windows reported for one HID collection during the latest scan.
/// Used to diagnose identification problems on real hardware. The serial
/// number (a Bluetooth DualSense reports its MAC address) is masked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDiagnostic {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub release_number: u16,
    pub usage_page: u16,
    pub usage: u16,
    pub input_report_len: u16,
    pub output_report_len: u16,
    pub feature_report_len: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_masked: Option<String>,
    pub instance_id: Option<String>,
    pub ancestor_instance_ids: Vec<String>,
    /// `None` if no driver recognised this collection.
    pub identified_model: Option<ControllerModel>,
    pub connection: Option<ConnectionType>,
    pub origin: Option<DeviceOrigin>,
}

/// Keeps only the last two characters of a serial number.
pub fn mask_serial(serial: &str) -> String {
    let chars: Vec<char> = serial.chars().collect();
    let keep = chars.len().min(2);
    let hidden = chars.len() - keep;
    "*".repeat(hidden) + &chars[hidden..].iter().collect::<String>()
}

/// Masks runs of exactly 12 hex digits (Bluetooth MAC addresses inside
/// Windows instance IDs and paths), keeping the last two digits. Runs that
/// end a GUID (followed by `}`) are left intact.
pub fn mask_mac_like(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_hexdigit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_hexdigit() {
                i += 1;
            }
            let run = &chars[start..i];
            let bounded_before = start == 0 || !chars[start - 1].is_ascii_alphanumeric();
            let next = chars.get(i).copied();
            let bounded_after = next.is_none_or(|c| !c.is_ascii_alphanumeric());
            if run.len() == 12 && bounded_before && bounded_after && next != Some('}') {
                out.push_str("**********");
                out.extend(&run[10..]);
            } else {
                out.extend(run);
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

impl From<&ScannedDevice> for HidDiagnostic {
    fn from(d: &ScannedDevice) -> Self {
        let i = &d.info;
        Self {
            path: mask_mac_like(&i.path),
            vendor_id: i.vendor_id,
            product_id: i.product_id,
            release_number: i.release_number,
            usage_page: i.usage_page,
            usage: i.usage,
            input_report_len: i.input_report_len,
            output_report_len: i.output_report_len,
            feature_report_len: i.feature_report_len,
            manufacturer: i.manufacturer.clone(),
            product: i.product.clone(),
            serial_masked: i.serial_number.as_deref().map(mask_serial),
            instance_id: i.instance_id.as_deref().map(mask_mac_like),
            ancestor_instance_ids: i
                .ancestor_instance_ids
                .iter()
                .map(|a| mask_mac_like(a))
                .collect(),
            identified_model: d.identification.as_ref().map(|x| x.model),
            connection: d.identification.as_ref().map(|x| x.connection),
            origin: d.identification.as_ref().map(|x| x.origin),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum EngineEvent {
    Device(DeviceEvent),
    Log(LogEntry),
}

enum Control {
    Wake,
    Rescan,
    /// A HID device arrived or was removed.
    DeviceChange,
    Shutdown,
}

struct Shared {
    telemetry: Telemetry,
    devices: Mutex<BTreeMap<DeviceId, DeviceSnapshot>>,
    requested_output: Mutex<VirtualOutputKind>,
    output_generation: AtomicU64,
    revision: AtomicU64,
    subscribers: Mutex<Vec<Sender<EngineEvent>>>,
    enumeration_error: Mutex<Option<String>>,
    hid_scan: Mutex<Vec<HidDiagnostic>>,
    macros: Arc<MacroLibrary>,
    recording: Mutex<Option<RecordingState>>,
    hid_backend: String,
    hid_available: bool,
    hotplug_active: std::sync::atomic::AtomicBool,
    output_backend: String,
    output_backend_status: BackendStatus,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Shared {
    fn bump(&self) {
        self.revision.fetch_add(1, Ordering::Release);
    }

    fn broadcast(&self, event: EngineEvent) {
        lock(&self.subscribers).retain(|tx| tx.send(event.clone()).is_ok());
    }

    fn log(&self, level: LogLevel, category: &str, message: impl Into<String>) {
        let entry = self.telemetry.log(level, category, message);
        self.broadcast(EngineEvent::Log(entry));
    }

    fn update_device(&self, id: &DeviceId, f: impl FnOnce(&mut DeviceSnapshot)) {
        if let Some(s) = lock(&self.devices).get_mut(id) {
            f(s);
            self.bump();
        }
    }
}

pub struct Engine {
    shared: Arc<Shared>,
    control: Sender<Control>,
    hotplug: Mutex<Option<nexus_device_manager::HotplugGuard>>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
}

impl Engine {
    /// Starts the engine with the platform HID backend, the DualSense driver
    /// and no virtual output driver.
    pub fn start_default(config: EngineConfig) -> Self {
        Self::start(
            platform_backend(),
            vec![Arc::new(DualSenseDriver)],
            Arc::new(|| Box::new(UnavailableBackend)),
            config,
        )
    }

    pub fn start(
        hid: Arc<dyn HidBackend>,
        drivers: Vec<Arc<dyn ControllerDriver>>,
        output_factory: OutputBackendFactory,
        config: EngineConfig,
    ) -> Self {
        let probe = output_factory();
        let shared = Arc::new(Shared {
            telemetry: Telemetry::new(config.log_capacity, config.raw_report_capacity),
            devices: Mutex::new(BTreeMap::new()),
            requested_output: Mutex::new(config.initial_output),
            output_generation: AtomicU64::new(0),
            revision: AtomicU64::new(1),
            subscribers: Mutex::new(Vec::new()),
            enumeration_error: Mutex::new(None),
            hid_scan: Mutex::new(Vec::new()),
            macros: Arc::new(MacroLibrary::new()),
            recording: Mutex::new(None),
            hid_backend: hid.name().to_owned(),
            hid_available: hid.is_available(),
            hotplug_active: std::sync::atomic::AtomicBool::new(false),
            output_backend: probe.name().to_owned(),
            output_backend_status: probe.status(),
        });
        drop(probe);

        shared.log(
            LogLevel::Info,
            "engine",
            format!(
                "Engine started (HID backend: {}, virtual output backend: {})",
                shared.hid_backend, shared.output_backend
            ),
        );

        let (control, control_rx) = channel();
        let wake = control.clone();
        let notify: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            let _ = wake.send(Control::Wake);
        });

        let factory_shared = shared.clone();
        let factory = Box::new(move |device: &ConnectedDevice| {
            new_session_handler(&factory_shared, &output_factory, device)
        });

        // Instant device detection where the OS supports it; polling becomes
        // a slower safety net.
        let mut device_config = config.devices.clone();
        let hotplug = if config.hotplug {
            let tx = Mutex::new(control.clone());
            match nexus_device_manager::watch_hid_devices(Arc::new(move || {
                let _ = lock(&tx).send(Control::DeviceChange);
            })) {
                Ok(guard) => {
                    device_config.scan_interval = config.hotplug_fallback_interval;
                    shared.log(
                        LogLevel::Info,
                        "device",
                        "Watching for device connections (instant detection)",
                    );
                    Some(guard)
                }
                Err(e) => {
                    shared.log(
                        LogLevel::Info,
                        "device",
                        format!("Using periodic scanning: {e}"),
                    );
                    None
                }
            }
        } else {
            None
        };
        shared
            .hotplug_active
            .store(hotplug.is_some(), Ordering::Release);

        let sup_shared = shared.clone();
        let supervisor = std::thread::Builder::new()
            .name("nexus-supervisor".into())
            .spawn(move || {
                let manager = DeviceManager::new(hid, drivers, device_config, factory, notify);
                supervise(manager, sup_shared, control_rx);
            })
            .expect("failed to spawn engine supervisor thread");

        Self {
            shared,
            control,
            hotplug: Mutex::new(hotplug),
            supervisor: Mutex::new(Some(supervisor)),
        }
    }

    pub fn revision(&self) -> u64 {
        self.shared.revision.load(Ordering::Acquire)
    }

    pub fn status(&self) -> EngineStatus {
        // Take each lock in its own statement: guards created inside a struct
        // literal live until the end of the whole expression.
        let macros = self.macro_status();
        let devices = lock(&self.shared.devices).values().cloned().collect();
        let enumeration_error = lock(&self.shared.enumeration_error).clone();
        let requested_output = *lock(&self.shared.requested_output);
        EngineStatus {
            revision: self.revision(),
            hid_backend: self.shared.hid_backend.clone(),
            hid_available: self.shared.hid_available,
            hotplug_active: self.shared.hotplug_active.load(Ordering::Acquire),
            enumeration_error,
            requested_output,
            output_backend: self.shared.output_backend.clone(),
            output_backend_status: self.shared.output_backend_status.clone(),
            devices,
            macros,
        }
    }

    fn macro_status(&self) -> MacroRuntimeStatus {
        let requested = *lock(&self.shared.requested_output);
        let any_active = lock(&self.shared.devices)
            .values()
            .any(|d| d.output.active.is_some());
        let blocked_reason = match (&self.shared.output_backend_status, requested) {
            _ if any_active => None,
            (BackendStatus::Unavailable { .. }, _) => Some(
                "Games can't receive macros yet: NEXUS has no virtual controller driver installed. \
                 You can still create, record and test macros here."
                    .to_owned(),
            ),
            (BackendStatus::Ready { .. }, VirtualOutputKind::Disabled) => Some(
                "Turn on a virtual controller (Settings → Virtual Output) so games receive macros."
                    .to_owned(),
            ),
            (BackendStatus::Ready { .. }, _) => {
                Some("Connect your controller so NEXUS can create the virtual controller.".to_owned())
            }
        };
        let recording = lock(&self.shared.recording)
            .as_ref()
            .map(|r| RecordingStatus {
                elapsed_ms: r.recorder.elapsed_ms(Instant::now()),
                presses: r.recorder.presses(),
                held: r.recorder.held(),
                limit_reached: r.recorder.limit_reached(),
                interrupted: r.interrupted,
            });
        MacroRuntimeStatus {
            armed: self
                .shared
                .macros
                .get()
                .iter()
                .filter(|m| m.is_armed())
                .count(),
            games_can_receive: blocked_reason.is_none(),
            blocked_reason,
            recording,
        }
    }

    /// Replaces the macros the engine runs. Running macros stop; each starts
    /// again on its next trigger press.
    pub fn set_macros(&self, macros: Vec<Macro>) {
        self.shared.macros.set(macros);
        self.shared.bump();
    }

    /// Starts recording physical button input. Macros are paused meanwhile.
    pub fn start_recording(&self) -> Result<(), String> {
        // Record the first controller that is sending input, starting from
        // its current state so buttons already held are not captured.
        let source = lock(&self.shared.devices)
            .values()
            .find_map(|d| d.input.map(|input| (d.device.id.clone(), input)));
        let Some((device, baseline)) = source else {
            return Err("Connect your controller to record a macro.".to_owned());
        };
        let mut rec = lock(&self.shared.recording);
        if rec.is_some() {
            return Err("A recording is already in progress.".to_owned());
        }
        let now = Instant::now();
        let mut recorder = MacroRecorder::new(now);
        recorder.feed(&baseline, now);
        *rec = Some(RecordingState {
            recorder,
            device: Some(device),
            interrupted: false,
        });
        drop(rec);
        self.shared.macros.set_suspended(true);
        self.shared.bump();
        self.shared
            .log(LogLevel::Info, "macro", "Macro recording started");
        Ok(())
    }

    /// Stops recording and returns the captured sequence.
    pub fn stop_recording(&self) -> Result<RecordingResult, String> {
        let state = lock(&self.shared.recording).take();
        self.shared.macros.set_suspended(false);
        self.shared.bump();
        let state = state.ok_or_else(|| "No recording is in progress.".to_owned())?;
        let result = state.recorder.finish(Instant::now());
        self.shared.log(
            LogLevel::Info,
            "macro",
            format!("Macro recording stopped ({} actions)", result.steps.len()),
        );
        Ok(result)
    }

    /// Discards a recording in progress, if any.
    pub fn cancel_recording(&self) {
        if lock(&self.shared.recording).take().is_some() {
            self.shared
                .log(LogLevel::Info, "macro", "Macro recording cancelled");
        }
        self.shared.macros.set_suspended(false);
        self.shared.bump();
    }

    /// Receives every subsequent device event and log entry.
    pub fn subscribe(&self) -> Receiver<EngineEvent> {
        let (tx, rx) = channel();
        lock(&self.shared.subscribers).push(tx);
        rx
    }

    /// Requests a virtual output mode for all controllers. Each controller's
    /// reader thread applies it (disconnect old → connect new) within one
    /// read timeout.
    pub fn set_output_mode(&self, kind: VirtualOutputKind) {
        *lock(&self.shared.requested_output) = kind;
        self.shared.output_generation.fetch_add(1, Ordering::AcqRel);
        self.shared.bump();
        self.shared.log(
            LogLevel::Info,
            "output",
            format!("Virtual output set to {}", kind.as_str()),
        );
    }

    /// HID collections seen in the most recent scan (vendor-filtered).
    pub fn hid_diagnostics(&self) -> Vec<HidDiagnostic> {
        lock(&self.shared.hid_scan).clone()
    }

    /// Tells the engine a device arrived or left (normally called by the OS
    /// notification). Triggers an immediate scan.
    pub fn notify_device_change(&self) {
        let _ = self.control.send(Control::DeviceChange);
    }

    pub fn rescan(&self) {
        let _ = self.control.send(Control::Rescan);
    }

    pub fn recent_log(&self, limit: usize) -> Vec<LogEntry> {
        self.shared.telemetry.recent_log(limit)
    }

    pub fn recent_raw_reports(&self, limit: usize) -> Vec<RawReport> {
        self.shared.telemetry.recent_raw(limit)
    }

    /// Stops all controller sessions, releases virtual devices and joins the
    /// engine threads. Idempotent.
    pub fn shutdown(&self) {
        // Stop OS notifications first so none arrive during shutdown.
        drop(lock(&self.hotplug).take());
        let handle = lock(&self.supervisor).take();
        if let Some(handle) = handle {
            let _ = self.control.send(Control::Shutdown);
            let _ = handle.join();
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn supervise(mut manager: DeviceManager, shared: Arc<Shared>, control: Receiver<Control>) {
    loop {
        for event in manager.poll() {
            handle_device_event(&shared, event);
        }
        sync_enumeration_error(&shared, manager.last_enumeration_error());
        sync_scan(&shared, manager.last_scan());

        match control.recv_timeout(manager.time_until_next_scan()) {
            Ok(Control::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(Control::Rescan) | Ok(Control::DeviceChange) => manager.request_scan(),
            Ok(Control::Wake) | Err(RecvTimeoutError::Timeout) => {}
        }
    }
    for event in manager.shutdown() {
        handle_device_event(&shared, event);
    }
    shared.log(LogLevel::Info, "engine", "Engine stopped");
}

fn sync_scan(shared: &Shared, scan: &[ScannedDevice]) {
    let fresh: Vec<HidDiagnostic> = scan.iter().map(HidDiagnostic::from).collect();
    let mut stored = lock(&shared.hid_scan);
    if *stored != fresh {
        *stored = fresh;
    }
}

fn sync_enumeration_error(shared: &Shared, current: Option<&str>) {
    let mut stored = lock(&shared.enumeration_error);
    if stored.as_deref() != current {
        *stored = current.map(str::to_owned);
        shared.bump();
    }
}

fn connection_label(c: ConnectionType) -> &'static str {
    match c {
        ConnectionType::Usb => "USB",
        ConnectionType::Bluetooth => "Bluetooth",
        ConnectionType::Unknown => "an undetermined connection",
    }
}

fn handle_device_event(shared: &Shared, event: DeviceEvent) {
    match &event {
        DeviceEvent::Connected { device } => shared.log(
            LogLevel::Info,
            "device",
            format!(
                "{} connected via {}",
                device.model.display_name(),
                connection_label(device.connection)
            ),
        ),
        DeviceEvent::Disconnected { device_id, reason } => {
            let removed = lock(&shared.devices).remove(device_id);
            shared.bump();
            let name = removed
                .map(|s| s.device.model.display_name())
                .unwrap_or("Controller");
            let (level, why) = match reason {
                DisconnectReason::Removed => (LogLevel::Info, "disconnected".to_owned()),
                DisconnectReason::Shutdown => (LogLevel::Info, "released (shutdown)".to_owned()),
                DisconnectReason::Error(e) => (LogLevel::Warn, format!("lost after error: {e}")),
            };
            shared.log(level, "device", format!("{name} {why}"));
        }
        DeviceEvent::OpenFailed {
            error, retry_in_ms, ..
        } => shared.log(
            LogLevel::Warn,
            "device",
            format!(
                "Could not open controller: {error}. Retrying in {} s",
                retry_in_ms / 1000
            ),
        ),
        DeviceEvent::VirtualDeviceIgnored { model, .. } => shared.log(
            LogLevel::Info,
            "device",
            format!(
                "Ignored virtual {} (software-created device)",
                model.display_name()
            ),
        ),
        DeviceEvent::DuplicateIgnored { .. } => shared.log(
            LogLevel::Info,
            "device",
            "Ignored a second interface of an already-connected controller",
        ),
        DeviceEvent::EnumerationFailed { error } => shared.log(
            LogLevel::Error,
            "device",
            format!("Device enumeration failed: {error}"),
        ),
    }
    shared.broadcast(EngineEvent::Device(event));
}

struct EngineSessionHandler {
    shared: Arc<Shared>,
    id: DeviceId,
    pipeline: ProcessingPipeline,
    macros: MacroRunner,
    last_physical: Option<ControllerState>,
    output: VirtualOutputManager,
    output_generation: u64,
    rate: RateCounter,
    last_rate_published: f64,
}

fn new_session_handler(
    shared: &Arc<Shared>,
    output_factory: &OutputBackendFactory,
    device: &ConnectedDevice,
) -> Box<dyn SessionHandler> {
    let mut output = VirtualOutputManager::new(output_factory());
    let requested = *lock(&shared.requested_output);
    let generation = shared.output_generation.load(Ordering::Acquire);
    if let Err(e) = output.set_mode(requested) {
        shared.log(
            LogLevel::Warn,
            "output",
            format!("Virtual output not started: {e}"),
        );
    }
    // Register the snapshot before the reader thread starts, so the UI shows
    // the controller as connected (awaiting input) immediately.
    lock(&shared.devices).insert(
        device.id.clone(),
        DeviceSnapshot {
            device: device.clone(),
            connected_at_ms: unix_millis(),
            input: None,
            processed: None,
            playing_macros: Vec::new(),
            last_report_ms: None,
            report_rate_hz: 0.0,
            total_reports: 0,
            parse_errors: 0,
            last_parse_error: None,
            output: output.status(),
        },
    );
    shared.bump();
    Box::new(EngineSessionHandler {
        shared: shared.clone(),
        id: device.id.clone(),
        pipeline: ProcessingPipeline::new(),
        macros: MacroRunner::new(shared.macros.clone()),
        last_physical: None,
        output,
        output_generation: generation,
        rate: RateCounter::new(Duration::from_secs(1)),
        last_rate_published: 0.0,
    })
}

impl EngineSessionHandler {
    /// physical → processing → macros → virtual output.
    fn run_pipeline(
        &mut self,
        physical: &ControllerState,
    ) -> (ControllerState, Option<Vec<String>>) {
        let mut out = self.pipeline.run(physical);
        let was_playing = self.macros.playing();
        self.macros.process(physical, &mut out, Instant::now());
        self.output.submit(&out);
        let playing = self.macros.playing();
        (out, (playing != was_playing).then_some(playing))
    }

    fn feed_recording(&self, physical: &ControllerState) {
        if !self.shared.macros.is_suspended() {
            return; // fast path: not recording
        }
        if let Some(rec) = lock(&self.shared.recording).as_mut() {
            if rec.interrupted {
                return;
            }
            match &rec.device {
                Some(d) if *d != self.id => return,
                None => rec.device = Some(self.id.clone()),
                _ => {}
            }
            rec.recorder.feed(physical, Instant::now());
        }
    }

    fn sync_output_mode(&mut self) {
        let generation = self.shared.output_generation.load(Ordering::Acquire);
        if generation == self.output_generation {
            return;
        }
        self.output_generation = generation;
        let requested = *lock(&self.shared.requested_output);
        if let Err(e) = self.output.set_mode(requested) {
            self.shared.log(
                LogLevel::Warn,
                "output",
                format!("Virtual output not started: {e}"),
            );
        }
        let status = self.output.status();
        self.shared.update_device(&self.id, |s| s.output = status);
    }
}

impl SessionHandler for EngineSessionHandler {
    fn on_report(&mut self, raw: &[u8], parsed: Result<ControllerState, ReportError>) {
        self.sync_output_mode();
        self.rate.record(Instant::now(), parsed.is_ok());
        let error = parsed.as_ref().err().map(ToString::to_string);
        self.shared
            .telemetry
            .record_raw(&self.id.0, raw, error.clone());

        let physical = parsed.ok();
        let processed = physical.map(|state| {
            self.feed_recording(&state);
            self.last_physical = Some(state);
            self.run_pipeline(&state)
        });

        let (rate, total, errors) = (
            self.rate.rate_hz(),
            self.rate.total_reports,
            self.rate.parse_errors,
        );
        self.last_rate_published = rate;
        self.shared.update_device(&self.id, |s| {
            s.last_report_ms = Some(unix_millis());
            s.report_rate_hz = rate;
            s.total_reports = total;
            s.parse_errors = errors;
            match (physical, processed) {
                (Some(input), Some((out, playing))) => {
                    s.input = Some(input);
                    s.processed = Some(out);
                    if let Some(p) = playing {
                        s.playing_macros = p;
                    }
                }
                // Keep the last valid state; record why this report failed.
                _ => s.last_parse_error = error,
            }
        });
    }

    fn on_idle(&mut self) {
        self.sync_output_mode();
        // Keep macro timing moving even if reports pause briefly.
        if let Some(physical) = self.last_physical {
            self.macros.refresh(&physical);
            if !self.macros.playing().is_empty() {
                let (out, playing) = self.run_pipeline(&physical);
                self.shared.update_device(&self.id, |s| {
                    s.processed = Some(out);
                    if let Some(p) = playing {
                        s.playing_macros = p;
                    }
                });
            }
        }
        self.rate.roll(Instant::now());
        let rate = self.rate.rate_hz();
        if rate != self.last_rate_published {
            self.last_rate_published = rate;
            self.shared
                .update_device(&self.id, |s| s.report_rate_hz = rate);
        }
    }

    fn on_warning(&mut self, message: String) {
        self.shared.log(LogLevel::Warn, "device", message);
    }

    fn on_end(&mut self, _reason: &DisconnectReason) {
        // Release every macro press before the virtual device goes away.
        self.macros.stop_all();
        if let Some(rec) = lock(&self.shared.recording).as_mut() {
            if rec.device.as_ref() == Some(&self.id) {
                rec.interrupted = true;
                self.shared.bump();
            }
        }
        if let Err(e) = self.output.release() {
            self.shared.log(
                LogLevel::Error,
                "output",
                format!("Failed to remove virtual controller: {e}"),
            );
        }
    }
}

#[cfg(test)]
mod tests;
