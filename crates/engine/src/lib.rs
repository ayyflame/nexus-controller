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
use nexus_input_processing::{ConfiguredProcessor, ProcessingConfig, ProcessingPipeline};
use nexus_macro_engine::{
    Macro, MacroButton, MacroLibrary, MacroRecorder, MacroRunner, RecordingResult,
};
use nexus_telemetry::{
    unix_millis, IntervalStats, IntervalSummary, LatencySummary, LatencyWindow, LogEntry, LogLevel,
    RateCounter, RawReport, SlowCalls, StageLatency, StageWindow, Telemetry,
};
use nexus_virtual_controller::drivers::{probe_drivers, DriverStatus};
use nexus_virtual_controller::{
    BackendStatus, OutputEvent, OutputStatus, VirtualControllerBackend, VirtualOutputManager,
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
    /// Stick, trigger and remapping settings at start-up (from the profile).
    pub processing: ProcessingConfig,
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
            processing: ProcessingConfig::default(),
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
    /// Index (in the profile's `layers`) of the shift layer active on this
    /// controller, if any.
    pub active_layer: Option<usize>,
    /// Time NEXUS spends per report: processing, macros and output.
    pub pipeline_latency: LatencySummary,
    /// The same time split by stage, in nanoseconds.
    pub stage_latency: StageLatency,
    /// Reports missing according to the controller's sequence counter
    /// (estimate: assumes the counter advances once per report).
    pub sequence_gaps: u64,
    /// Time between reports since connect (USB stability).
    pub report_intervals: IntervalSummary,
    /// Output reports (lightbar, LEDs, vibration) sent to this controller.
    pub output_reports_sent: u64,
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
    /// Whether ViGEmBus / HidHide are installed (read-only check).
    pub drivers: DriverStatus,
    /// Connection history since NEXUS started.
    pub stats: EngineStats,
    /// Gyro calibration in progress.
    pub gyro_calibrating: bool,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStats {
    pub connects: u64,
    pub disconnects: u64,
    pub connection_errors: u64,
}

/// Result of averaging the resting gyro.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GyroCalibration {
    /// Resting offset per axis in raw units (store in `GyroConfig::bias`).
    pub bias: [f32; 3],
    pub samples: u32,
    /// `false` if the controller moved during calibration.
    pub steady: bool,
}

#[derive(Default)]
struct GyroCalState {
    sum: [f64; 3],
    min: [i16; 3],
    max: [i16; 3],
    count: u32,
}

/// Largest raw spread (≈3 °/s) still considered "held still".
const GYRO_STEADY_SPREAD: i16 = 50;

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
    /// Unmasked scan results, used only inside the engine (Report Inspector).
    scan_infos: Mutex<Vec<nexus_controller_core::HidDeviceInfo>>,
    /// Report Inspector capture: checked on every report without locking.
    capturing: std::sync::atomic::AtomicBool,
    capture: Mutex<Option<(DeviceId, Vec<Vec<u8>>)>>,
    drivers: Mutex<DriverStatus>,
    macros: Arc<MacroLibrary>,
    recording: Mutex<Option<RecordingState>>,
    processing: Mutex<Arc<ProcessingConfig>>,
    processing_generation: AtomicU64,
    rumble_request: Mutex<(u64, f32, u32)>,
    /// Generation of `rumble_request`, read lock-free on every report.
    rumble_generation: AtomicU64,
    stats: Mutex<EngineStats>,
    gyro_cal: Mutex<Option<GyroCalState>>,
    /// True while a gyro calibration collects samples (lock-free check per report).
    gyro_calibrating: std::sync::atomic::AtomicBool,
    hid_backend: String,
    hid_available: bool,
    hotplug_active: std::sync::atomic::AtomicBool,
    output_backend: String,
    output_backend_status: Mutex<BackendStatus>,
    output_factory: OutputBackendFactory,
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
    hid: Arc<dyn HidBackend>,
    control: Sender<Control>,
    hotplug: Mutex<Option<nexus_device_manager::HotplugGuard>>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
    /// Signalled when the supervisor has released every controller.
    stopped: Mutex<Option<Receiver<()>>>,
}

impl Engine {
    /// Starts the engine with the platform HID backend, the DualSense driver
    /// and no virtual output driver.
    pub fn start_default(config: EngineConfig) -> Self {
        Self::start(
            platform_backend(),
            vec![Arc::new(DualSenseDriver)],
            Arc::new(nexus_virtual_controller::platform_backend),
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
            scan_infos: Mutex::new(Vec::new()),
            capturing: std::sync::atomic::AtomicBool::new(false),
            capture: Mutex::new(None),
            drivers: Mutex::new(probe_drivers()),
            macros: Arc::new(MacroLibrary::new()),
            recording: Mutex::new(None),
            processing: Mutex::new(Arc::new(config.processing.sanitized())),
            processing_generation: AtomicU64::new(0),
            rumble_request: Mutex::new((0, 0.0, 0)),
            rumble_generation: AtomicU64::new(0),
            stats: Mutex::new(EngineStats::default()),
            gyro_cal: Mutex::new(None),
            gyro_calibrating: std::sync::atomic::AtomicBool::new(false),
            hid_backend: hid.name().to_owned(),
            hid_available: hid.is_available(),
            hotplug_active: std::sync::atomic::AtomicBool::new(false),
            output_backend: probe.name().to_owned(),
            output_backend_status: Mutex::new(probe.status()),
            output_factory: output_factory.clone(),
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
        let hid_for_engine = hid.clone();
        let (stopped_tx, stopped) = channel();
        let supervisor = std::thread::Builder::new()
            .name("nexus-supervisor".into())
            .spawn(move || {
                let manager = DeviceManager::new(hid, drivers, device_config, factory, notify);
                supervise(manager, sup_shared, control_rx);
                let _ = stopped_tx.send(());
            })
            .expect("failed to spawn engine supervisor thread");

        Self {
            shared,
            hid: hid_for_engine,
            control,
            hotplug: Mutex::new(hotplug),
            supervisor: Mutex::new(Some(supervisor)),
            stopped: Mutex::new(Some(stopped)),
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
        let drivers = *lock(&self.shared.drivers);
        let stats = *lock(&self.shared.stats);
        let gyro_calibrating = lock(&self.shared.gyro_cal).is_some();
        let output_backend_status = lock(&self.shared.output_backend_status).clone();
        EngineStatus {
            revision: self.revision(),
            hid_backend: self.shared.hid_backend.clone(),
            hid_available: self.shared.hid_available,
            hotplug_active: self.shared.hotplug_active.load(Ordering::Acquire),
            enumeration_error,
            requested_output,
            output_backend: self.shared.output_backend.clone(),
            output_backend_status,
            devices,
            macros,
            drivers,
            stats,
            gyro_calibrating,
        }
    }

    fn macro_status(&self) -> MacroRuntimeStatus {
        let requested = *lock(&self.shared.requested_output);
        let any_active = lock(&self.shared.devices)
            .values()
            .any(|d| d.output.active.is_some());
        let backend_status = lock(&self.shared.output_backend_status).clone();
        let blocked_reason = match (&backend_status, requested) {
            _ if any_active => None,
            (BackendStatus::Unavailable { .. }, _) => Some(
                "Games receive macros through a virtual controller, which needs the optional ViGEmBus driver \
                 (Controller › Virtual Output). You can still create, record and test macros here."
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

    /// Applies new stick/trigger/remap settings to every controller on its
    /// next report.
    pub fn set_processing(&self, config: ProcessingConfig) {
        *lock(&self.shared.processing) = Arc::new(config.sanitized());
        self.shared
            .processing_generation
            .fetch_add(1, Ordering::AcqRel);
        self.shared.bump();
    }

    pub fn processing(&self) -> ProcessingConfig {
        (**lock(&self.shared.processing)).clone()
    }

    /// Replaces the macros the engine runs. Running macros stop; each starts
    /// again on its next trigger press.
    pub fn set_macros(&self, macros: Vec<Macro>) {
        self.shared.macros.set(macros);
        self.shared.bump();
    }

    /// Vibrates every connected DualSense at `strength` (0–1, scaled by the
    /// profile's vibration intensity) for `duration_ms`, then stops.
    pub fn test_vibration(&self, strength: f32, duration_ms: u32) -> Result<(), String> {
        if lock(&self.shared.devices).is_empty() {
            return Err("Connect your controller to test vibration.".to_owned());
        }
        let mut r = lock(&self.shared.rumble_request);
        *r = (
            r.0 + 1,
            strength.clamp(0.0, 1.0),
            duration_ms.clamp(50, 3000),
        );
        self.shared.rumble_generation.store(r.0, Ordering::Release);
        Ok(())
    }

    /// Starts averaging the resting gyro. Keep the controller still on a
    /// flat surface, then call [`Engine::finish_gyro_calibration`].
    pub fn start_gyro_calibration(&self) -> Result<(), String> {
        let has_motion = lock(&self.shared.devices)
            .values()
            .any(|d| d.input.is_some_and(|i| i.motion.is_some()));
        if !has_motion {
            return Err(
                "Connect your controller (motion data is needed) to calibrate the gyro.".to_owned(),
            );
        }
        *lock(&self.shared.gyro_cal) = Some(GyroCalState {
            min: [i16::MAX; 3],
            max: [i16::MIN; 3],
            ..GyroCalState::default()
        });
        self.shared.gyro_calibrating.store(true, Ordering::Release);
        self.shared.bump();
        Ok(())
    }

    pub fn finish_gyro_calibration(&self) -> Result<GyroCalibration, String> {
        self.shared.gyro_calibrating.store(false, Ordering::Release);
        let state = lock(&self.shared.gyro_cal).take();
        self.shared.bump();
        let s = state.ok_or_else(|| "Gyro calibration was not started.".to_owned())?;
        if s.count < 20 {
            return Err("Not enough motion data was received. Try again.".to_owned());
        }
        let bias = s.sum.map(|v| (v / s.count as f64) as f32);
        let steady = (0..3).all(|i| s.max[i].saturating_sub(s.min[i]) <= GYRO_STEADY_SPREAD);
        Ok(GyroCalibration {
            bias,
            samples: s.count,
            steady,
        })
    }

    /// Immediately stops every running macro on every controller.
    pub fn stop_all_macros(&self) {
        self.shared.macros.request_stop_all();
        self.shared
            .log(LogLevel::Info, "macro", "All macros stopped");
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
    /// The connected controller to inspect: `device_id`, or the first one.
    fn inspect_target(&self, device_id: Option<&str>) -> Result<ConnectedDevice, String> {
        let devices = lock(&self.shared.devices);
        let found = match device_id {
            Some(id) => devices.values().find(|d| d.device.id.0 == id),
            None => devices.values().next(),
        };
        found
            .map(|d| d.device.clone())
            .ok_or_else(|| "Connect your controller with a USB cable first.".to_owned())
    }

    /// Records the raw input reports of one controller for `duration`
    /// (Report Inspector). Blocks the calling thread; never the input path.
    pub fn capture_reports(
        &self,
        device_id: Option<&str>,
        duration: Duration,
    ) -> Result<inspector::RawCapture, String> {
        let device = self.inspect_target(device_id)?;
        if self.shared.capturing.swap(true, Ordering::AcqRel) {
            return Err("A recording is already running.".into());
        }
        *lock(&self.shared.capture) = Some((device.id.clone(), Vec::new()));
        std::thread::sleep(duration);
        self.shared.capturing.store(false, Ordering::Release);
        let reports = lock(&self.shared.capture)
            .take()
            .map(|(_, r)| r)
            .unwrap_or_default();
        if !lock(&self.shared.devices).contains_key(&device.id) {
            return Err("The controller disconnected during the recording. Try again.".into());
        }
        if reports.is_empty() {
            return Err(
                "No reports arrived during the recording. Is the controller still connected?"
                    .into(),
            );
        }
        Ok(inspector::RawCapture {
            device_id: device.id.0,
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            duration_ms: duration.as_millis().min(u128::from(u32::MAX)) as u32,
            reports,
        })
    }

    /// Every HID interface of the connected controller's physical USB device,
    /// including ones NEXUS does not open (read-only query).
    pub fn related_interfaces(
        &self,
        device_id: Option<&str>,
    ) -> Result<Vec<nexus_controller_core::HidInterfaceDetails>, String> {
        let device = self.inspect_target(device_id)?;
        let info = lock(&self.shared.scan_infos)
            .iter()
            .find(|i| i.path == device.id.0)
            .cloned()
            .ok_or("The controller is not in the latest device scan yet. Try again in a second.")?;
        let mut list = self
            .hid
            .related_interfaces(&info)
            .map_err(|e| e.to_string())?;
        for d in &mut list {
            d.instance_id = d.instance_id.as_deref().map(mask_mac_like);
        }
        Ok(list)
    }

    pub fn hid_diagnostics(&self) -> Vec<HidDiagnostic> {
        lock(&self.shared.hid_scan).clone()
    }

    /// Tells the engine a device arrived or left (normally called by the OS
    /// notification). Triggers an immediate scan.
    pub fn notify_device_change(&self) {
        let _ = self.control.send(Control::DeviceChange);
    }

    /// Checks again whether the optional drivers are installed.
    pub fn refresh_drivers(&self) -> DriverStatus {
        let status = probe_drivers();
        *lock(&self.shared.drivers) = status;
        // Picks up a driver the user installed while NEXUS was running.
        let backend_status = (self.shared.output_factory)().status();
        *lock(&self.shared.output_backend_status) = backend_status;
        // Every controller re-applies its requested output on its next
        // report, so a driver installed while NEXUS runs is used at once.
        self.shared.output_generation.fetch_add(1, Ordering::AcqRel);
        self.shared.bump();
        status
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
    /// engine threads. Idempotent. Waits as long as that takes; at app exit
    /// use [`Engine::shutdown_within`].
    pub fn shutdown(&self) {
        self.shutdown_within(Duration::MAX);
    }

    /// Like [`Engine::shutdown`], but gives up waiting after `timeout`.
    ///
    /// Each controller's reader thread sends a neutral frame and removes its
    /// virtual controller before it stops. A reader stuck inside a driver
    /// call that never returns cannot do that, and must not keep NEXUS from
    /// exiting: after `timeout` this returns `false` and leaves the threads
    /// to finish on their own. When the process then exits, Windows closes
    /// the driver connection and ViGEmBus removes the virtual controller.
    pub fn shutdown_within(&self, timeout: Duration) -> bool {
        // Stop OS notifications first so none arrive during shutdown.
        *lock(&self.hotplug) = None;
        let Some(handle) = lock(&self.supervisor).take() else {
            return true;
        };
        let _ = self.control.send(Control::Shutdown);
        let stopped = lock(&self.stopped).take();
        let finished = match stopped {
            // Disconnected: the supervisor ended without signalling (it panicked).
            Some(rx) => !matches!(rx.recv_timeout(timeout), Err(RecvTimeoutError::Timeout)),
            None => true,
        };
        if finished {
            let _ = handle.join();
        } else {
            self.shared.log(
                LogLevel::Warn,
                "engine",
                format!(
                    "Controllers were not released within {} ms (a driver call is not \
                     returning). Windows removes the virtual controller when NEXUS exits.",
                    timeout.as_millis()
                ),
            );
        }
        finished
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
    *lock(&shared.scan_infos) = scan.iter().map(|d| d.info.clone()).collect();
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
        DeviceEvent::Connected { .. }
        | DeviceEvent::Disconnected { .. }
        | DeviceEvent::OpenFailed { .. } => {
            let mut st = lock(&shared.stats);
            match &event {
                DeviceEvent::Connected { .. } => st.connects += 1,
                DeviceEvent::Disconnected {
                    reason: DisconnectReason::Error(_),
                    ..
                }
                | DeviceEvent::OpenFailed { .. } => {
                    st.connection_errors += 1;
                    if matches!(event, DeviceEvent::Disconnected { .. }) {
                        st.disconnects += 1;
                    }
                }
                DeviceEvent::Disconnected { .. } => st.disconnects += 1,
                _ => {}
            }
        }
        _ => {}
    }
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

/// Unreadable reports in a row before the output is made safe (macros
/// stopped, neutral frame). About 32 ms at the DualSense's 250 Hz USB rate:
/// short enough that nothing stays held, long enough that an isolated bad
/// report never interrupts output.
pub const UNREADABLE_REPORT_LIMIT: u32 = 8;

struct EngineSessionHandler {
    shared: Arc<Shared>,
    id: DeviceId,
    /// Shared copy of the device ID for the raw history (no per-report allocation).
    raw_id: Arc<str>,
    pipeline: ProcessingPipeline,
    processing_generation: u64,
    latency: LatencyWindow,
    /// Per-stage time of each report (nanoseconds), published with `latency`.
    stages: Stages,
    reports_since_latency_publish: u32,
    macros: MacroRunner,
    last_physical: Option<ControllerState>,
    /// Unreadable reports received in a row (reset by every valid report).
    unreadable_run: u32,
    /// True while the output is held safe because of unreadable reports.
    unreadable_failsafe: bool,
    output: VirtualOutputManager,
    output_generation: u64,
    rate: RateCounter,
    intervals: IntervalStats,
    last_rate_published: f64,
    feedback: Feedback,
    last_sequence: Option<u8>,
    sequence_gaps: u64,
}

/// Physical DualSense feedback for one session: sends a report only when
/// the wanted lightbar/LED state changes or a vibration starts or ends.
struct Feedback {
    usb: bool,
    output_len: usize,
    config: nexus_input_processing::FeedbackConfig,
    sent_lighting: (Option<[u8; 3]>, Option<u8>, u8),
    light_released: bool,
    rumble_generation: u64,
    rumble_until: Option<Instant>,
    pending: Option<nexus_dualsense::output::OutputState>,
    seq: u8,
    sent: u64,
}

impl Feedback {
    fn new(device: &ConnectedDevice, rumble_generation: u64) -> Self {
        let usb = match device.connection {
            ConnectionType::Usb => true,
            ConnectionType::Bluetooth => false,
            ConnectionType::Unknown => {
                (device.output_report_len as usize) < nexus_dualsense::output::BT_OUTPUT_REPORT_LEN
            }
        };
        Self {
            usb,
            output_len: device.output_report_len as usize,
            config: Default::default(),
            sent_lighting: (None, None, 0),
            light_released: false,
            rumble_generation,
            rumble_until: None,
            pending: None,
            seq: 0,
            sent: 0,
        }
    }

    fn pending(&mut self) -> &mut nexus_dualsense::output::OutputState {
        self.pending.get_or_insert_with(Default::default)
    }

    fn update(&mut self, shared: &Shared, now: Instant) {
        let c = &self.config;
        let light = c.lightbar_enabled.then(|| c.lightbar_color(self.usb));
        let leds = c.player_leds_enabled.then_some(c.player_leds);
        let wanted = (light, leds, c.player_led_brightness);
        if wanted != self.sent_lighting {
            let release = light.is_some() && !self.light_released;
            let brightness = c.player_led_brightness;
            let p = self.pending();
            p.lightbar = light;
            p.player_leds = leds;
            p.player_led_brightness = brightness;
            p.release_default_light = release;
            self.light_released |= light.is_some();
            self.sent_lighting = wanted;
        }
        // Lock-free check: the request lock is taken only when a new vibration
        // was requested. The stop below runs either way.
        if shared.rumble_generation.load(Ordering::Acquire) != self.rumble_generation {
            let (generation, strength, ms) = *lock(&shared.rumble_request);
            self.rumble_generation = generation;
            let level = (strength * self.config.rumble_intensity * 255.0).round() as u8;
            self.pending().rumble = Some((level, level));
            self.rumble_until = Some(now + Duration::from_millis(ms as u64));
        } else if self.rumble_until.is_some_and(|t| now >= t) {
            self.rumble_until = None;
            self.pending().rumble = Some((0, 0)); // always stop
        }
    }

    fn take(&mut self) -> Option<Vec<u8>> {
        let state = self.pending.take()?;
        self.sent += 1;
        Some(if self.usb {
            nexus_dualsense::output::usb_output_report(&state, self.output_len)
        } else {
            let seq = self.seq;
            self.seq = (self.seq + 1) & 0x0F;
            nexus_dualsense::output::bluetooth_output_report(&state, seq)
        })
    }
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
            active_layer: None,
            pipeline_latency: LatencySummary::default(),
            stage_latency: StageLatency::default(),
            sequence_gaps: 0,
            report_intervals: IntervalSummary::default(),
            output_reports_sent: 0,
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
        raw_id: Arc::from(device.id.0.as_str()),
        feedback: {
            let mut f = Feedback::new(device, lock(&shared.rumble_request).0);
            f.config = lock(&shared.processing).feedback.clone();
            f
        },
        last_sequence: None,
        sequence_gaps: 0,
        pipeline: build_pipeline(&lock(&shared.processing)),
        processing_generation: shared.processing_generation.load(Ordering::Acquire),
        latency: LatencyWindow::default(),
        stages: Stages::default(),
        reports_since_latency_publish: 0,
        macros: MacroRunner::new(shared.macros.clone()),
        last_physical: None,
        unreadable_run: 0,
        unreadable_failsafe: false,
        output,
        output_generation: generation,
        rate: RateCounter::new(Duration::from_secs(1)),
        intervals: IntervalStats::default(),
        last_rate_published: 0.0,
    })
}

fn build_pipeline(config: &ProcessingConfig) -> ProcessingPipeline {
    let mut p = ProcessingPipeline::new();
    p.push(Box::new(ConfiguredProcessor::new(config)));
    p
}

impl EngineSessionHandler {
    /// physical → processing (sticks, triggers, remap) → macros → virtual output.
    ///
    /// `received` is when a controller report reached the handler; the
    /// recorded processing time is from then until the virtual controller has
    /// the result. Idle ticks pass `None`: they are not controller reports,
    /// so they are kept out of the processing-time statistics.
    fn run_pipeline(
        &mut self,
        physical: &ControllerState,
        received: Option<Instant>,
    ) -> (ControllerState, Option<Vec<String>>) {
        self.sync_processing();
        // Four clock reads per report split the time by stage; macros reuse
        // one of them as their "now".
        let t0 = Instant::now();
        let mut out = self.pipeline.run(physical);
        let t1 = Instant::now();
        self.macros.process(physical, &mut out, t1);
        let t2 = Instant::now();
        self.output.submit(&out);
        let t3 = Instant::now();
        self.stages.mapping.record(t1 - t0);
        self.stages.macros.record(t2 - t1);
        self.stages.output.record(t3 - t2);
        self.stages.slow_output.record(t3 - t2);
        if let Some(received) = received {
            self.latency.record(t3.saturating_duration_since(received));
            self.stages
                .input
                .record(t0.saturating_duration_since(received));
        }
        if let Some(event) = self.output.take_event() {
            self.on_output_event(event);
        }
        // The list (which allocates) is built only when it changed.
        let playing = self
            .macros
            .take_playing_changed()
            .then(|| self.macros.playing());
        (out, playing)
    }

    /// Picks up new settings (pipeline and feedback) before anything uses them.
    fn sync_processing(&mut self) {
        let generation = self.shared.processing_generation.load(Ordering::Acquire);
        if generation != self.processing_generation {
            self.processing_generation = generation;
            let config = lock(&self.shared.processing).clone();
            self.pipeline = build_pipeline(&config);
            self.feedback.config = config.feedback.clone();
        }
    }

    /// Fail-safe for a controller that keeps sending unreadable reports.
    ///
    /// An unreadable report cannot be processed, so the virtual controller
    /// would keep its last frame, including any button a macro was pressing.
    /// After [`UNREADABLE_REPORT_LIMIT`] such reports in a row, every macro is
    /// stopped and one neutral frame is sent; the virtual controller stays
    /// connected. The first valid report resumes normal processing (it has
    /// already run when this is called); macros need a fresh trigger press.
    /// Each transition is logged once. Returns true when the fail-safe has
    /// just started.
    fn track_unreadable(&mut self, valid: bool) -> bool {
        if valid {
            self.unreadable_run = 0;
            if self.unreadable_failsafe {
                self.unreadable_failsafe = false;
                self.shared.log(
                    LogLevel::Info,
                    "device",
                    "Controller reports are readable again; input resumed. \
                     Press a macro's trigger again to restart it.",
                );
            }
            return false;
        }
        self.unreadable_run = self.unreadable_run.saturating_add(1);
        if self.unreadable_failsafe || self.unreadable_run < UNREADABLE_REPORT_LIMIT {
            return false;
        }
        self.unreadable_failsafe = true;
        self.macros.stop_all();
        // The stop is published by the caller; consume the change so a later
        // idle tick does not send a second neutral frame for it.
        self.macros.take_playing_changed();
        self.output.submit_neutral();
        if let Some(event) = self.output.take_event() {
            self.on_output_event(event);
        }
        self.shared.log(
            LogLevel::Warn,
            "device",
            format!(
                "The controller sent {UNREADABLE_REPORT_LIMIT} unreadable reports in a row. \
                 Macros were stopped and the virtual controller was set to neutral \
                 until readable reports return."
            ),
        );
        true
    }

    fn feed_gyro_calibration(&self, physical: &ControllerState) {
        if !self.shared.gyro_calibrating.load(Ordering::Acquire) {
            return;
        }
        let Some(m) = physical.motion else { return };
        if let Some(cal) = lock(&self.shared.gyro_cal).as_mut() {
            for i in 0..3 {
                cal.sum[i] += m.gyro_raw[i] as f64;
                cal.min[i] = cal.min[i].min(m.gyro_raw[i]);
                cal.max[i] = cal.max[i].max(m.gyro_raw[i]);
            }
            cal.count += 1;
        }
    }

    fn track_sequence(&mut self, state: &ControllerState) {
        if let Some(seq) = state.sequence {
            if let Some(prev) = self.last_sequence {
                let gap = seq.wrapping_sub(prev).wrapping_sub(1);
                // Large jumps are resets, not losses.
                if gap > 0 && gap < 64 {
                    self.sequence_gaps += gap as u64;
                }
            }
            self.last_sequence = Some(seq);
        }
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

    fn keep_output_alive(&mut self) {
        self.output.keep_alive();
        if let Some(event) = self.output.take_event() {
            self.on_output_event(event);
        }
    }

    /// Rare: the virtual controller failed or came back (logged once each).
    fn on_output_event(&mut self, event: OutputEvent) {
        match event {
            OutputEvent::Failed(msg) => self.shared.log(LogLevel::Warn, "output", msg),
            OutputEvent::Recovered => {
                self.shared
                    .log(LogLevel::Info, "output", "Virtual controller re-created")
            }
        }
        let status = self.output.status();
        self.shared.update_device(&self.id, |s| s.output = status);
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
        let now = Instant::now();
        self.sync_output_mode();
        self.sync_processing();

        // Input path first: processing, macros and the virtual controller.
        // Everything below is bookkeeping and runs after the game already has
        // this report. Every report is processed; none is dropped or merged.
        let physical = parsed.as_ref().ok().copied();
        let processed = physical.map(|state| {
            self.last_physical = Some(state);
            self.run_pipeline(&state, Some(now))
        });
        let failsafe_started = self.track_unreadable(physical.is_some());
        if physical.is_none() {
            // Nothing new to send: make sure the last frame (possibly the
            // fail-safe's neutral frame) really reached the driver.
            self.keep_output_alive();
        }

        self.rate.record(now, parsed.is_ok());
        self.intervals.record(now);
        let error = parsed.as_ref().err().map(ToString::to_string);
        self.shared
            .telemetry
            .record_raw(&self.raw_id, raw, error.clone());
        if self.shared.capturing.load(Ordering::Relaxed) {
            if let Some((device, reports)) = lock(&self.shared.capture).as_mut() {
                if *device == self.id && reports.len() < inspector::MAX_CAPTURE_REPORTS {
                    reports.push(raw.to_vec());
                }
            }
        }
        if let Some(state) = &physical {
            self.track_sequence(state);
            self.feed_gyro_calibration(state);
            self.feed_recording(state);
        }
        self.feedback.update(&self.shared, Instant::now());
        let (gaps, sent) = (self.sequence_gaps, self.feedback.sent);
        // For display only, after the virtual controller already has this report.
        let layer = self.pipeline.active_layer();

        let (rate, total, errors) = (
            self.rate.rate_hz(),
            self.rate.total_reports,
            self.rate.parse_errors,
        );
        self.last_rate_published = rate;
        self.reports_since_latency_publish += 1;
        let latency = (self.reports_since_latency_publish >= 64).then(|| {
            self.reports_since_latency_publish = 0;
            (
                self.latency.summary(),
                self.intervals.summary(),
                self.stages.summary(),
            )
        });
        self.shared.update_device(&self.id, |s| {
            if let Some((l, i, st)) = latency {
                s.pipeline_latency = l;
                s.report_intervals = i;
                s.stage_latency = st;
            }
            s.last_report_ms = Some(unix_millis());
            s.report_rate_hz = rate;
            s.total_reports = total;
            s.parse_errors = errors;
            s.sequence_gaps = gaps;
            s.output_reports_sent = sent;
            s.active_layer = layer;
            match (physical, processed) {
                (Some(input), Some((out, playing))) => {
                    s.input = Some(input);
                    s.processed = Some(out);
                    if let Some(p) = playing {
                        s.playing_macros = p;
                    }
                }
                // Keep the last valid state; record why this report failed.
                _ => {
                    s.last_parse_error = error;
                    if failsafe_started {
                        s.processed = Some(ControllerState::default());
                        s.playing_macros.clear();
                    }
                }
            }
        });
    }

    fn on_idle(&mut self) {
        self.sync_output_mode();
        self.sync_processing();
        self.feedback.update(&self.shared, Instant::now());
        // Keep macro timing moving even if reports pause briefly.
        if let Some(physical) = self.last_physical {
            self.macros.refresh(&physical);
            if self.macros.take_playing_changed() {
                // A reload (e.g. profile switch) stopped a macro while no
                // reports arrive. The virtual controller still holds the
                // macro's last frame and the physical state is stale, so
                // send a neutral frame: nothing may stay pressed. The next
                // valid report restores normal physical input.
                self.output.submit_neutral();
                if let Some(event) = self.output.take_event() {
                    self.on_output_event(event);
                }
                // Publish it too, otherwise the UI would keep showing the
                // macro as playing.
                let playing = self.macros.playing();
                self.shared.update_device(&self.id, |s| {
                    s.processed = Some(ControllerState::default());
                    s.playing_macros = playing;
                });
            }
            if !self.macros.playing().is_empty() {
                let (out, playing) = self.run_pipeline(&physical, None);
                self.shared.update_device(&self.id, |s| {
                    s.processed = Some(out);
                    if let Some(p) = playing {
                        s.playing_macros = p;
                    }
                });
            }
        }
        // No report arrived: the last frame sent is the one that must stand
        // (it may be a one-off neutral frame), and a failed virtual
        // controller keeps being re-created although no input comes in.
        self.keep_output_alive();
        self.rate.roll(Instant::now());
        let rate = self.rate.rate_hz();
        if rate != self.last_rate_published {
            self.last_rate_published = rate;
            self.shared
                .update_device(&self.id, |s| s.report_rate_hz = rate);
        }
    }

    fn take_output(&mut self) -> Option<Vec<u8>> {
        self.feedback.take()
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

/// Per-stage timing windows of one controller's reader thread.
#[derive(Default)]
struct Stages {
    input: StageWindow,
    mapping: StageWindow,
    macros: StageWindow,
    output: StageWindow,
    slow_output: SlowCalls,
}

impl Stages {
    fn summary(&self) -> StageLatency {
        StageLatency {
            input: self.input.summary(),
            mapping: self.mapping.summary(),
            macros: self.macros.summary(),
            output: self.output.summary(),
            slow_output: self.slow_output,
        }
    }
}

pub mod inspector;
pub mod output_check;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod hotpath_tests;
