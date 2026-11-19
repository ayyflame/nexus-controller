//! End-to-end engine tests using the mock HID backend and **synthetic**
//! DualSense reports (see `nexus_dualsense::synthetic`).

use super::*;
use nexus_controller_core::{DeviceOrigin, HidDeviceInfo, ReportFormat};
use nexus_device_manager::mock::MockHidBackend;
use nexus_device_manager::UnsupportedBackend;
use nexus_dualsense::synthetic::Payload;
use nexus_dualsense::{PRODUCT_ID_DUALSENSE, VENDOR_ID_SONY};
use nexus_virtual_controller::UnavailableBackend;

const PATH: &str = r"\\?\hid#vid_054c&pid_0ce6&mi_03#test#{4d1e55b2-f16f-11cf-88cb-001111000030}";

fn usb_info() -> HidDeviceInfo {
    HidDeviceInfo {
        path: PATH.into(),
        vendor_id: VENDOR_ID_SONY,
        product_id: PRODUCT_ID_DUALSENSE,
        usage_page: 1,
        usage: 5,
        input_report_len: 64,
        product: Some("DualSense Wireless Controller".into()),
        ancestor_instance_ids: vec![
            r"USB\VID_054C&PID_0CE6&MI_03\x".into(),
            r"USB\VID_054C&PID_0CE6\y".into(),
            r"PCI\VEN_8086\z".into(),
        ],
        ..Default::default()
    }
}

fn config() -> EngineConfig {
    EngineConfig {
        devices: DeviceManagerConfig {
            scan_interval: Duration::from_millis(10),
            read_timeout: Duration::from_millis(5),
        },
        // Mock devices never produce OS device notifications. With
        // notifications on (real Windows), polling would relax to the 5 s
        // safety net and simulated re-plugs would only be seen after 5 s.
        hotplug: false,
        ..Default::default()
    }
}

fn engine(backend: &MockHidBackend) -> Engine {
    Engine::start(
        Arc::new(backend.clone()),
        vec![Arc::new(DualSenseDriver)],
        Arc::new(|| Box::new(UnavailableBackend)),
        config(),
    )
}

fn wait_status(e: &Engine, what: &str, pred: impl Fn(&EngineStatus) -> bool) -> EngineStatus {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let s = e.status();
        if pred(&s) {
            return s;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {what}: {s:#?}"
        );
        std::thread::sleep(Duration::from_millis(3));
    }
}

#[test]
fn no_controller_is_never_reported_as_connected() {
    let backend = MockHidBackend::new();
    let e = engine(&backend);
    std::thread::sleep(Duration::from_millis(60));
    let s = e.status();
    assert!(s.devices.is_empty());
    assert!(s.hid_available);
    assert!(e.recent_raw_reports(10).is_empty());
}

#[test]
fn connected_controller_reports_awaiting_input_then_live_state() {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    let e = engine(&backend);

    let s = wait_status(&e, "connection", |s| s.devices.len() == 1);
    let d = &s.devices[0];
    assert_eq!(d.device.connection, ConnectionType::Usb);
    assert_eq!(d.device.origin, DeviceOrigin::Physical);
    assert!(
        d.input.is_none(),
        "no input may be shown before a real report"
    );

    let mut p = Payload::neutral();
    p.lx = 255;
    p.buttons[0] |= 0x20; // cross
    backend.push_report(PATH, p.usb_report());

    let s = wait_status(&e, "input", |s| s.devices[0].input.is_some());
    let input = s.devices[0].input.unwrap();
    assert_eq!(input.format, ReportFormat::DualSenseUsb);
    assert_eq!(input.left_stick.x, 1.0);
    assert!(input.buttons.south);

    let raw = e.recent_raw_reports(10);
    assert_eq!(raw.len(), 1);
    assert_eq!(raw[0].bytes, p.usb_report(), "raw bytes preserved exactly");
    assert!(raw[0].parse_error.is_none());
}

#[test]
fn invalid_reports_are_counted_and_do_not_replace_valid_state() {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    let e = engine(&backend);
    wait_status(&e, "connection", |s| s.devices.len() == 1);

    let mut p = Payload::neutral();
    p.rx = 0;
    backend.push_report(PATH, p.usb_report());
    backend.push_report(PATH, vec![0x01, 0x80, 0x80]); // truncated
    backend.push_report(PATH, vec![0x77; 64]); // unknown report id

    let s = wait_status(&e, "reports", |s| s.devices[0].total_reports == 3);
    let d = &s.devices[0];
    assert_eq!(d.parse_errors, 2);
    assert!(d.last_parse_error.as_deref().unwrap().contains("0x77"));
    assert_eq!(d.input.unwrap().right_stick.x, -1.0);
    let raw = e.recent_raw_reports(10);
    assert_eq!(raw.len(), 3);
    assert!(raw[1].parse_error.is_some());
}

#[test]
fn disconnect_and_reconnect_are_published_as_events() {
    let backend = MockHidBackend::new();
    let e = engine(&backend);
    let events = e.subscribe();

    backend.plug(usb_info());
    wait_status(&e, "connect", |s| s.devices.len() == 1);
    backend.unplug(PATH);
    wait_status(&e, "disconnect", |s| s.devices.is_empty());
    backend.plug(usb_info());
    wait_status(&e, "reconnect", |s| s.devices.len() == 1);

    let device_events: Vec<DeviceEvent> = events
        .try_iter()
        .filter_map(|ev| match ev {
            EngineEvent::Device(d) => Some(d),
            _ => None,
        })
        .collect();
    let kinds: Vec<&str> = device_events
        .iter()
        .map(|d| match d {
            DeviceEvent::Connected { .. } => "connected",
            DeviceEvent::Disconnected { .. } => "disconnected",
            _ => "other",
        })
        .collect();
    assert_eq!(kinds, vec!["connected", "disconnected", "connected"]);
    assert_eq!(backend.live_connections(PATH), 1);
}

#[test]
fn virtual_dualsense_is_ignored() {
    let backend = MockHidBackend::new();
    let mut info = usb_info();
    info.ancestor_instance_ids = vec![
        r"USB\VID_054C&PID_0CE6\1".into(),
        r"ROOT\SYSTEM\0001".into(),
    ];
    backend.plug(info);
    let e = engine(&backend);
    std::thread::sleep(Duration::from_millis(60));
    assert!(e.status().devices.is_empty());
    assert_eq!(backend.open_count(PATH), 0);
    assert!(e
        .recent_log(20)
        .iter()
        .any(|l| l.message.contains("Ignored virtual")));
}

#[test]
fn output_request_without_driver_is_reported_not_faked() {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    let e = engine(&backend);
    wait_status(&e, "connect", |s| s.devices.len() == 1);
    e.set_output_mode(VirtualOutputKind::Xbox360);
    let s = wait_status(&e, "output status", |s| {
        s.devices[0].output.requested == VirtualOutputKind::Xbox360
    });
    assert_eq!(s.requested_output, VirtualOutputKind::Xbox360);
    assert_eq!(s.devices[0].output.active, None);
    assert!(s.devices[0].output.last_error.is_some());
    assert!(matches!(
        s.output_backend_status,
        BackendStatus::Unavailable { .. }
    ));
}

#[test]
fn unsupported_platform_is_reported() {
    let e = Engine::start(
        Arc::new(UnsupportedBackend),
        vec![Arc::new(DualSenseDriver)],
        Arc::new(|| Box::new(UnavailableBackend)),
        config(),
    );
    let s = wait_status(&e, "enumeration error", |s| s.enumeration_error.is_some());
    assert!(!s.hid_available);
    assert!(s.devices.is_empty());
}

#[test]
fn shutdown_releases_devices_and_is_idempotent() {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    let e = engine(&backend);
    wait_status(&e, "connect", |s| s.devices.len() == 1);
    e.shutdown();
    e.shutdown();
    assert!(e.status().devices.is_empty());
    assert_eq!(backend.live_connections(PATH), 0);
    assert!(e
        .recent_log(5)
        .iter()
        .any(|l| l.message == "Engine stopped"));
}

#[test]
fn hid_diagnostics_report_scan_with_masked_serial() {
    let backend = MockHidBackend::new();
    let mut info = usb_info();
    info.serial_number = Some("a0:b1:c2:d3:e4:f5".into());
    backend.plug(info);
    let e = engine(&backend);
    wait_status(&e, "connect", |s| s.devices.len() == 1);
    let diag = e.hid_diagnostics();
    assert_eq!(diag.len(), 1);
    assert_eq!(
        diag[0].identified_model,
        Some(nexus_controller_core::ControllerModel::DualSense)
    );
    assert_eq!(diag[0].origin, Some(DeviceOrigin::Physical));
    assert_eq!(diag[0].serial_masked.as_deref(), Some("***************f5"));
    assert_eq!(diag[0].ancestor_instance_ids.len(), 3);
}

#[test]
fn mask_serial_handles_short_values() {
    assert_eq!(mask_serial(""), "");
    assert_eq!(mask_serial("a"), "a");
    assert_eq!(mask_serial("abc"), "*bc");
}

#[test]
fn mac_addresses_in_instance_ids_are_masked() {
    let id = r"BTHENUM\{00001124-0000-1000-8000-00805F9B34FB}_VID&0002054C_PID&0CE6\8&1A2B3C4D&0&A0B1C2D3E4F5_C00000000";
    let masked = mask_mac_like(id);
    assert!(masked.contains("&**********F5_C00000000"), "{masked}");
    assert!(
        masked.contains("00805F9B34FB}"),
        "GUID tail must be kept: {masked}"
    );
    assert_eq!(
        mask_mac_like(r"USB\VID_054C&PID_0CE6\6&ABCDEF&0&3"),
        r"USB\VID_054C&PID_0CE6\6&ABCDEF&0&3"
    );
}

// ---- Macros -------------------------------------------------------------

use nexus_macro_engine::{Macro, MacroButton, MacroStep, PlaybackMode};

const R3: (usize, u8) = (1, 0x80);
const CROSS: (usize, u8) = (0, 0x20);
const CIRCLE: (usize, u8) = (0, 0x40);

fn report(bits: &[(usize, u8)]) -> Vec<u8> {
    let mut p = Payload::neutral();
    for (byte, mask) in bits {
        p.buttons[*byte] |= mask;
    }
    p.usb_report()
}

fn jump_macro(mode: PlaybackMode) -> Macro {
    Macro {
        id: "jump".into(),
        name: "Jump".into(),
        description: String::new(),
        enabled: true,
        steps: vec![MacroStep {
            id: "s1".into(),
            buttons: vec![MacroButton::South],
            hold_ms: 2000,
            delay_after_ms: 0,
        }],
        trigger: Some(MacroButton::RightStick),
        mode,
        repeat_delay_ms: 50,
        block_trigger: true,
        activation_ms: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    }
}

fn connected_engine() -> (MockHidBackend, Engine) {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    let e = engine(&backend);
    wait_status(&e, "connect", |s| s.devices.len() == 1);
    backend.push_report(PATH, report(&[]));
    wait_status(&e, "first input", |s| s.devices[0].input.is_some());
    (backend, e)
}

#[test]
fn macro_runs_from_physical_trigger_and_shows_in_processed_output() {
    let (backend, e) = connected_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::Once)]);
    backend.push_report(PATH, report(&[R3]));
    let s = wait_status(&e, "macro playing", |s| {
        !s.devices[0].playing_macros.is_empty()
    });
    let d = &s.devices[0];
    let physical = d.input.unwrap();
    let out = d.processed.unwrap();
    assert!(
        physical.buttons.right_stick && !physical.buttons.south,
        "physical input untouched"
    );
    assert!(out.buttons.south, "macro pressed Cross in output");
    assert!(!out.buttons.right_stick, "trigger hidden from output");
    assert_eq!(d.playing_macros, vec!["jump".to_string()]);
    assert_eq!(s.macros.armed, 1);
    assert!(
        !s.macros.games_can_receive,
        "no virtual output backend in this test"
    );
    assert!(s
        .macros
        .blocked_reason
        .as_deref()
        .unwrap()
        .contains("needs the optional ViGEmBus driver"));
}

#[test]
fn disconnect_stops_macros_and_reconnect_starts_clean() {
    let (backend, e) = connected_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::Toggle)]);
    backend.push_report(PATH, report(&[R3]));
    wait_status(&e, "playing", |s| !s.devices[0].playing_macros.is_empty());
    backend.unplug(PATH);
    wait_status(&e, "disconnect", |s| s.devices.is_empty());
    backend.plug(usb_info());
    wait_status(&e, "reconnect", |s| s.devices.len() == 1);
    backend.push_report(PATH, report(&[]));
    let s = wait_status(&e, "input", |s| s.devices[0].processed.is_some());
    assert!(
        s.devices[0].playing_macros.is_empty(),
        "toggled macro did not survive reconnect"
    );
    assert!(!s.devices[0].processed.unwrap().buttons.south);
}

#[test]
fn recording_captures_real_reports_and_pauses_macros() {
    let (backend, e) = connected_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::Once)]);
    e.start_recording().unwrap();
    assert!(e.start_recording().is_err(), "only one recording at a time");

    for (bits, ms) in [
        (vec![R3], 150),
        (vec![], 100),
        (vec![CIRCLE], 120),
        (vec![], 0),
    ] {
        backend.push_report(PATH, report(&bits));
        std::thread::sleep(Duration::from_millis(ms));
    }
    let s = wait_status(&e, "presses recorded", |s| {
        s.macros
            .recording
            .as_ref()
            .is_some_and(|r| r.presses == 2 && r.held.is_empty())
    });
    assert!(
        s.devices[0].playing_macros.is_empty(),
        "trigger did not fire while recording"
    );

    let result = e.stop_recording().unwrap();
    let buttons: Vec<_> = result.steps.iter().map(|s| s.buttons.clone()).collect();
    assert_eq!(
        buttons,
        vec![vec![MacroButton::RightStick], vec![MacroButton::East]]
    );
    assert!(
        result.steps[0].hold_ms >= 100,
        "timing captured: {:?}",
        result.steps
    );
    assert!(e.status().macros.recording.is_none());

    // Macros work again after recording.
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    wait_status(&e, "macro resumes", |s| {
        !s.devices[0].playing_macros.is_empty()
    });
}

#[test]
fn recording_requires_controller_and_reports_disconnect() {
    let backend = MockHidBackend::new();
    let e = engine(&backend);
    assert!(e
        .start_recording()
        .unwrap_err()
        .contains("Connect your controller"));
    assert!(e.stop_recording().is_err());

    let (backend, e) = connected_engine();
    e.start_recording().unwrap();
    backend.push_report(PATH, report(&[CROSS]));
    wait_status(&e, "held", |s| {
        s.macros.recording.as_ref().is_some_and(|r| r.presses == 1)
    });
    backend.unplug(PATH);
    wait_status(&e, "interrupted", |s| {
        s.macros.recording.as_ref().is_some_and(|r| r.interrupted)
    });
    let result = e.stop_recording().unwrap();
    assert_eq!(result.steps.len(), 1, "what was captured is kept");
}

#[test]
fn cancel_recording_resumes_macros() {
    let (backend, e) = connected_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::Once)]);
    e.start_recording().unwrap();
    e.cancel_recording();
    assert!(e.status().macros.recording.is_none());
    backend.push_report(PATH, report(&[R3]));
    wait_status(&e, "macro runs", |s| {
        !s.devices[0].playing_macros.is_empty()
    });
}

// ---- Device notifications ------------------------------------------------

#[test]
fn device_change_notification_connects_without_waiting_for_poll() {
    let backend = MockHidBackend::new();
    let e = Engine::start(
        Arc::new(backend.clone()),
        vec![Arc::new(DualSenseDriver)],
        Arc::new(|| Box::new(UnavailableBackend)),
        EngineConfig {
            devices: DeviceManagerConfig {
                scan_interval: Duration::from_secs(60), // polling effectively off
                read_timeout: Duration::from_millis(5),
            },
            hotplug: false,
            ..Default::default()
        },
    );
    std::thread::sleep(Duration::from_millis(30)); // first scan done, nothing found
    backend.plug(usb_info());
    std::thread::sleep(Duration::from_millis(50));
    assert!(e.status().devices.is_empty(), "no poll for 60 s");
    e.notify_device_change();
    wait_status(&e, "connected via notification", |s| s.devices.len() == 1);
    backend.unplug(PATH);
    wait_status(&e, "removal noticed by the read", |s| s.devices.is_empty());
    backend.plug(usb_info());
    e.notify_device_change();
    wait_status(&e, "reconnected via notification", |s| s.devices.len() == 1);
    assert!(!e.status().hotplug_active);
}

// ---- Processing ----------------------------------------------------------

#[test]
fn processing_settings_apply_live_and_remap_reaches_output() {
    let (backend, e) = connected_engine();
    let mut cfg = nexus_input_processing::ProcessingConfig::passthrough();
    cfg.left_stick.deadzone = 0.5;
    cfg.remap = vec![nexus_input_processing::RemapRule::new(
        MacroButton::South,
        Some(MacroButton::East),
    )];
    e.set_processing(cfg);
    let mut p = Payload::neutral();
    p.lx = 160; // ≈0.25: inside the new deadzone
    p.buttons[0] |= CROSS.1;
    backend.push_report(PATH, p.usb_report());
    let s = wait_status(&e, "processed", |s| {
        s.devices[0].input.is_some_and(|i| i.buttons.south)
    });
    let d = &s.devices[0];
    let (input, out) = (d.input.unwrap(), d.processed.unwrap());
    assert!(input.left_stick.x > 0.2, "physical input untouched");
    assert_eq!(out.left_stick.x, 0.0, "deadzone applied");
    assert!(
        out.buttons.east && !out.buttons.south,
        "Cross remapped to Circle"
    );
    assert_eq!(e.processing().left_stick.deadzone, 0.5);
}

#[test]
fn macro_trigger_uses_physical_button_even_when_remapped() {
    let (backend, e) = connected_engine();
    let mut cfg = nexus_input_processing::ProcessingConfig::passthrough();
    cfg.remap = vec![nexus_input_processing::RemapRule::new(
        MacroButton::RightStick,
        None,
    )];
    e.set_processing(cfg);
    e.set_macros(vec![jump_macro(PlaybackMode::Once)]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    let s = wait_status(&e, "macro", |s| !s.devices[0].playing_macros.is_empty());
    assert!(
        s.devices[0].processed.unwrap().buttons.south,
        "macro output after remapping"
    );
}

#[test]
fn pipeline_latency_is_measured() {
    let (backend, e) = connected_engine();
    for _ in 0..70 {
        backend.push_report(PATH, report(&[]));
    }
    let s = wait_status(&e, "latency", |s| {
        s.devices[0].pipeline_latency.samples >= 64
    });
    let l = s.devices[0].pipeline_latency;
    assert!(l.p50_us <= l.p99_us && l.p99_us <= l.max_us);
}

#[test]
fn per_stage_latency_is_published_and_adds_up() {
    let (backend, e) = connected_engine();
    for _ in 0..70 {
        backend.push_report(PATH, report(&[]));
    }
    let s = wait_status(&e, "stage latency", |s| {
        s.devices[0].stage_latency.mapping.samples >= 64
    });
    let d = &s.devices[0];
    let st = d.stage_latency;
    for (name, x) in [
        ("input", st.input),
        ("mapping", st.mapping),
        ("macros", st.macros),
        ("output", st.output),
    ] {
        assert!(x.samples >= 64, "{name}: {x:?}");
        assert!(
            x.p50_ns <= x.p99_ns && x.p99_ns <= x.max_ns,
            "{name}: {x:?}"
        );
    }
    // The stages are parts of the total: their medians can't exceed the total's maximum.
    let parts = st.input.p50_ns as u64
        + st.mapping.p50_ns as u64
        + st.macros.p50_ns as u64
        + st.output.p50_ns as u64;
    assert!(
        parts <= (d.pipeline_latency.max_us as u64 + 1) * 1000,
        "{parts} ns vs {:?}",
        d.pipeline_latency
    );
}

#[test]
fn stop_all_macros_cancels_a_toggled_macro() {
    let (backend, e) = connected_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::Toggle)]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    wait_status(&e, "playing", |s| !s.devices[0].playing_macros.is_empty());
    e.stop_all_macros();
    backend.push_report(PATH, report(&[]));
    let s = wait_status(&e, "stopped", |s| s.devices[0].playing_macros.is_empty());
    assert!(
        !s.devices[0].processed.unwrap().buttons.south,
        "no stuck press"
    );
}

// ---- Milestone 3: feedback, gyro calibration, diagnostics ------------------

fn bt_info() -> HidDeviceInfo {
    HidDeviceInfo {
        path: BT_PATH.into(),
        vendor_id: VENDOR_ID_SONY,
        product_id: PRODUCT_ID_DUALSENSE,
        usage_page: 1,
        usage: 5,
        input_report_len: 78,
        output_report_len: 78,
        ancestor_instance_ids: vec![
            r"BTHENUM\{00001124-0000-1000-8000-00805F9B34FB}_VID&0002054C_PID&0CE6\x".into(),
        ],
        ..Default::default()
    }
}

const BT_PATH: &str = r"\\?\hid#{00001124-0000-1000-8000-00805f9b34fb}_vid&0002054c_pid&0ce6#bt";

fn wait_writes(backend: &MockHidBackend, path: &str, n: usize) -> Vec<Vec<u8>> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let w = backend.writes(path);
        if w.len() >= n {
            return w;
        }
        assert!(
            Instant::now() < deadline,
            "expected {n} writes, got {}",
            w.len()
        );
        std::thread::sleep(Duration::from_millis(3));
    }
}

fn pump(backend: &MockHidBackend, path: &str, n: usize) {
    for _ in 0..n {
        backend.push_report(path, Payload::neutral().usb_report());
    }
}

#[test]
fn nothing_is_sent_to_the_controller_unless_enabled() {
    let (backend, e) = connected_engine();
    pump(&backend, PATH, 20);
    std::thread::sleep(Duration::from_millis(80));
    assert!(
        backend.writes(PATH).is_empty(),
        "default profile never writes"
    );
    assert!(e.status().devices[0].output_reports_sent == 0);
}

#[test]
fn lightbar_is_sent_once_when_enabled_and_again_only_on_change() {
    let (backend, e) = connected_engine();
    let mut cfg = e.processing();
    cfg.feedback.lightbar_enabled = true;
    cfg.feedback.color = [10, 20, 30];
    e.set_processing(cfg.clone());
    pump(&backend, PATH, 10);
    let w = wait_writes(&backend, PATH, 1);
    let r = &w[0];
    assert_eq!(r[0], 0x02, "USB output report");
    assert_eq!(r.len(), 48);
    assert_eq!(&r[1 + 44..1 + 47], &[10, 20, 30]);
    assert_eq!(r[1 + 41], 1 << 1, "default light released the first time");
    pump(&backend, PATH, 20);
    std::thread::sleep(Duration::from_millis(60));
    assert_eq!(
        backend.writes(PATH).len(),
        1,
        "unchanged settings are not resent"
    );
    cfg.feedback.color = [1, 2, 3];
    e.set_processing(cfg);
    pump(&backend, PATH, 5);
    let w = wait_writes(&backend, PATH, 2);
    assert_eq!(&w[1][1 + 44..1 + 47], &[1, 2, 3]);
    assert_eq!(w[1][1 + 41], 0, "release only sent once");
}

#[test]
fn vibration_test_starts_and_always_stops() {
    let (backend, e) = connected_engine();
    let mut cfg = e.processing();
    cfg.feedback.rumble_intensity = 0.5;
    e.set_processing(cfg);
    e.test_vibration(1.0, 60).unwrap();
    pump(&backend, PATH, 3);
    let w = wait_writes(&backend, PATH, 1);
    assert_eq!(
        (w[0][1 + 2], w[0][1 + 3]),
        (128, 128),
        "scaled by intensity"
    );
    assert_eq!(w[0][1] & 0b11, 0b11);
    std::thread::sleep(Duration::from_millis(80));
    pump(&backend, PATH, 3);
    let w = wait_writes(&backend, PATH, 2);
    assert_eq!((w[1][1 + 2], w[1][1 + 3]), (0, 0), "motors stopped");
}

#[test]
fn bluetooth_feedback_uses_bt_reports_with_crc_and_sequence() {
    let backend = MockHidBackend::new();
    backend.plug(bt_info());
    let e = engine(&backend);
    wait_status(&e, "bt connect", |s| s.devices.len() == 1);
    let mut cfg = e.processing();
    cfg.feedback.lightbar_enabled = true;
    e.set_processing(cfg.clone());
    backend.push_report(BT_PATH, Payload::neutral().bluetooth_report());
    let w = wait_writes(&backend, BT_PATH, 1);
    assert_eq!(
        (w[0].len(), w[0][0], w[0][1], w[0][2]),
        (78, 0x31, 0x00, 0x10)
    );
    let crc = u32::from_le_bytes(w[0][74..78].try_into().unwrap());
    assert_eq!(
        crc,
        nexus_dualsense::bluetooth_report_crc(0xA2, &w[0][..74])
    );
    cfg.feedback.color = [0, 0, 255];
    e.set_processing(cfg);
    backend.push_report(BT_PATH, Payload::neutral().bluetooth_report());
    let w = wait_writes(&backend, BT_PATH, 2);
    assert_eq!(w[1][1], 0x10, "sequence advanced");
}

#[test]
fn test_vibration_requires_a_controller() {
    let backend = MockHidBackend::new();
    let e = engine(&backend);
    assert!(e.test_vibration(1.0, 100).is_err());
}

#[test]
fn gyro_calibration_averages_resting_gyro_and_detects_movement() {
    let (backend, e) = connected_engine();
    e.start_gyro_calibration().unwrap();
    assert!(e.status().gyro_calibrating);
    for i in 0..30 {
        let mut p = Payload::neutral();
        p.gyro = [10 + (i % 3), -4, 7];
        backend.push_report(PATH, p.usb_report());
    }
    wait_status(&e, "samples", |s| s.devices[0].total_reports >= 31);
    let c = e.finish_gyro_calibration().unwrap();
    assert!(c.steady && c.samples >= 30);
    assert!((c.bias[0] - 11.0).abs() < 0.5 && c.bias[1] == -4.0 && c.bias[2] == 7.0);

    e.start_gyro_calibration().unwrap();
    for i in 0..30 {
        let mut p = Payload::neutral();
        p.gyro = [if i % 2 == 0 { 400 } else { -400 }, 0, 0];
        backend.push_report(PATH, p.usb_report());
    }
    wait_status(&e, "samples", |s| s.devices[0].total_reports >= 61);
    assert!(
        !e.finish_gyro_calibration().unwrap().steady,
        "movement detected"
    );
    assert!(e.finish_gyro_calibration().is_err(), "not started");
}

#[test]
fn sequence_gaps_and_connection_stats_are_counted() {
    let (backend, e) = connected_engine();
    // The setup report had sequence 0; 3 and 4 go missing.
    for seq in [1u8, 2, 5, 6] {
        let mut p = Payload::neutral();
        p.seq = seq;
        backend.push_report(PATH, p.usb_report());
    }
    let s = wait_status(&e, "gaps", |s| s.devices[0].sequence_gaps == 2);
    assert_eq!(s.stats.connects, 1);
    backend.unplug(PATH);
    let s = wait_status(&e, "disconnect", |s| s.devices.is_empty());
    assert_eq!(s.stats.disconnects, 1);
}

#[test]
fn report_intervals_are_published_for_usb_stability_checks() {
    let (backend, e) = connected_engine();
    for seq in 1..=70u8 {
        let mut p = Payload::neutral();
        p.seq = seq;
        backend.push_report(PATH, p.usb_report());
    }
    let s = wait_status(&e, "intervals", |s| {
        s.devices[0].report_intervals.intervals >= 60
    });
    let i = s.devices[0].report_intervals;
    assert!(i.min_us <= i.mean_us && i.mean_us <= i.max_us, "{i:?}");
    // Simulated timing only: real 250 Hz behaviour must be checked on hardware.
}

// ---- Report Inspector (synthetic reports; real controllers need hardware) ----

use crate::inspector::{analyse, Analysis, InspectorSession, RawCapture, Verdict};

/// Resting reports with the noise a real controller has: counter, timestamp,
/// gyro and a little stick jitter.
fn resting(n: usize, tweak: impl Fn(&mut Vec<u8>)) -> Vec<Vec<u8>> {
    (0..n)
        .map(|i| {
            let mut p = Payload::neutral();
            p.seq = i as u8;
            p.sensor_timestamp = 1000 + i as u32 * 333;
            p.gyro = [(i % 5) as i16 - 2, 3 - (i % 7) as i16, (i % 3) as i16];
            p.lx = 128 + (i % 3) as u8;
            let mut r = p.usb_report();
            tweak(&mut r);
            r
        })
        .collect()
}

fn with_bits(n: usize, byte: usize, mask: u8) -> Vec<Vec<u8>> {
    resting(n, |r| r[byte] |= mask)
}

#[test]
fn inspector_reports_nothing_when_nothing_is_pressed() {
    let a = analyse(&resting(200, |_| {}), &resting(200, |_| {}));
    assert_eq!(a.verdict, Verdict::NoChange);
    assert!(a.changes.is_empty(), "noise is ignored: {:?}", a.changes);
    for b in [7, 16, 28, 1] {
        assert!(a.noisy_bytes.contains(&b), "byte {b} should be noisy");
    }
}

#[test]
fn inspector_identifies_a_paddle_mapped_to_cross_as_cross() {
    let a = analyse(&resting(200, |_| {}), &with_bits(200, 8, 0x20));
    assert_eq!(
        a.verdict,
        Verdict::DecodedButtons {
            buttons: vec!["Cross"]
        }
    );
    assert!(
        a.summary.contains("Mapped-button activity"),
        "{}",
        a.summary
    );
    assert!(
        a.summary.contains("not an independent input"),
        "{}",
        a.summary
    );
}

#[test]
fn inspector_flags_undecoded_button_bits_as_candidates() {
    let a = analyse(&resting(200, |_| {}), &with_bits(200, 10, 0x40));
    assert_eq!(
        a.verdict,
        Verdict::UndecodedBits {
            locations: vec!["byte 10 mask 0x40".into()]
        }
    );
    let c = &a.changes[0];
    assert_eq!(
        (c.index, c.set_bits, c.cleared_bits, c.undecoded_bits),
        (10, 0x40, 0, 0x40)
    );
    assert!(c.hints[0].contains("unconfirmed"));
    assert_eq!(c.reports_changed, 200);
}

#[test]
fn inspector_flags_changes_in_unused_bytes() {
    let a = analyse(&resting(200, |_| {}), &resting(200, |r| r[45] = 0x03));
    assert!(
        matches!(&a.verdict, Verdict::UndecodedBits { locations } if locations == &["byte 45 mask 0x03"])
    );
    assert_eq!(a.changes[0].field_kind, "unknown");
    assert!(
        a.summary.starts_with("Possible independent input"),
        "{}",
        a.summary
    );
}

#[test]
fn inspector_ignores_timestamps_counters_and_motion() {
    // Real controllers have slow counters in bytes 12-15 and 49-52 that are
    // steady for the 2 s baseline but differ minutes later, and motion data
    // that changes when the controller is picked up. None of it is input.
    let later = resting(200, |r| {
        r[13] = r[13].wrapping_add(0x1C); // timestamp high byte moved on
        r[14] ^= 0x01;
        r[22] = 0x7F; // accelerometer
        r[25] = 0x40; // accelerometer
        r[31] = 0x2D; // sensor timestamp high byte
        r[51] = 0x33; // status timestamp
        r[52] = 0x2D;
        r[53] ^= 0x10; // battery / power status
    });
    let a = analyse(&resting(200, |_| {}), &later);
    assert_eq!(a.verdict, Verdict::NoChange, "{:?}", a.changes);
    assert!(a.changes.is_empty());
    for b in [13, 14, 22, 25, 31, 51, 52, 53] {
        assert!(a.ignored_bytes.contains(&b), "byte {b} should be ignored");
    }
    // With Cross held as well, the result is Cross and nothing else.
    let cross = resting(200, |r| {
        r[8] |= 0x20;
        r[13] = 0x9F;
        r[22] = 0x7F;
        r[52] = 0x2D;
    });
    let a = analyse(&resting(200, |_| {}), &cross);
    assert_eq!(
        a.verdict,
        Verdict::DecodedButtons {
            buttons: vec!["Cross"]
        }
    );
}

#[test]
fn inspector_does_not_call_a_one_off_flicker_a_candidate() {
    let mut action = resting(200, |r| r[8] |= 0x20);
    action[50][32] = 0x0F; // one report out of 200
    let a = analyse(&resting(200, |_| {}), &action);
    assert_eq!(
        a.verdict,
        Verdict::DecodedButtons {
            buttons: vec!["Cross"]
        }
    );
    assert!(
        a.notes
            .iter()
            .any(|n| n.contains("Byte 32") && n.contains("not treated as a candidate")),
        "{:?}",
        a.notes
    );
    // Held throughout, the same bit is a candidate.
    let held = resting(200, |r| {
        r[8] |= 0x20;
        r[32] = 0x0F;
    });
    let a = analyse(&resting(200, |_| {}), &held);
    assert!(matches!(&a.verdict, Verdict::UndecodedBits { .. }));
    assert!(
        a.summary
            .contains("also reported Cross (mapped-button activity)"),
        "{}",
        a.summary
    );
}

// ---- Regression: real captures from a DualSense with MZ Titan paddles --------
// Recorded with the Report Inspector (2026-11-17), stored compactly: for each
// section a little-endian u16 count, then that many 64-byte USB reports. The
// first section is the 2 s hands-off baseline (all reports); then each capture,
// keeping every fifth report. They contain only input data (no serial number).

fn fixture_sections(bytes: &[u8]) -> Vec<Vec<Vec<u8>>> {
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let n = u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize;
        at += 2;
        out.push(
            (0..n)
                .map(|k| bytes[at + k * 64..at + (k + 1) * 64].to_vec())
                .collect(),
        );
        at += n * 64;
    }
    out
}

fn fixture_verdicts(bytes: &[u8]) -> Vec<Analysis> {
    let s = fixture_sections(bytes);
    s[1..].iter().map(|c| analyse(&s[0], c)).collect()
}

fn reported(buttons: &[&'static str]) -> Verdict {
    Verdict::DecodedButtons {
        buttons: buttons.to_vec(),
    }
}

#[test]
fn real_captures_of_mapped_paddles_are_reported_as_their_buttons() {
    // Paddles mapped in the MZ Titan app: left = Circle, right = Cross
    // (Triangle also pressed during that capture), then Cross itself.
    let a = fixture_verdicts(include_bytes!("fixtures/mz_titan_mapped.bin"));
    assert_eq!(a.len(), 3);
    assert_eq!(
        a[0].verdict,
        reported(&["Circle"]),
        "left paddle: {}",
        a[0].summary
    );
    assert_eq!(
        a[1].verdict,
        reported(&["Cross", "Triangle"]),
        "right paddle: {}",
        a[1].summary
    );
    assert_eq!(
        a[2].verdict,
        reported(&["Cross"]),
        "Cross reference: {}",
        a[2].summary
    );
    for x in &a {
        assert!(
            x.summary.starts_with("Mapped-button activity"),
            "{}",
            x.summary
        );
        assert!(
            x.changes.iter().all(|c| c.undecoded_bits == 0),
            "{:?}",
            x.changes
        );
        // The counters and motion data that used to be flagged are ignored.
        for b in [13, 16, 25, 31, 52] {
            assert!(
                x.ignored_bytes.contains(&b),
                "byte {b}: {:?}",
                x.ignored_bytes
            );
        }
    }
}

#[test]
fn real_captures_of_the_second_session_have_no_false_candidates() {
    let a = fixture_verdicts(include_bytes!("fixtures/mz_titan_session2.bin"));
    assert_eq!(a.len(), 8);
    // Captures 1-4: paddles reported as normal buttons.
    assert_eq!(a[0].verdict, reported(&["Cross"]), "left paddle");
    assert_eq!(
        a[1].verdict,
        reported(&["D-pad", "Triangle"]),
        "right paddle"
    );
    assert_eq!(a[2].verdict, reported(&["Cross"]), "Cross reference");
    assert_eq!(
        a[3].verdict,
        reported(&["D-pad", "Cross", "Triangle"]),
        "both paddles"
    );
    // Captures 5-7: nothing but a slight left-stick drift since the baseline.
    // Whether the paddles were in independent mode then is not yet confirmed,
    // so the result is only "no button or candidate data", nothing more.
    for (n, x) in a[4..7].iter().enumerate() {
        assert!(
            matches!(x.verdict, Verdict::NoChange | Verdict::AnalogOnly),
            "capture {}: {:?} {}",
            n + 5,
            x.verdict,
            x.summary
        );
    }
    // Capture 8: Cross again; a one-report flicker elsewhere is not a candidate.
    assert_eq!(
        a[7].verdict,
        reported(&["Cross"]),
        "Cross reference 2: {}",
        a[7].summary
    );
    assert!(a
        .iter()
        .all(|x| !matches!(x.verdict, Verdict::UndecodedBits { .. })));
    // No advice about stick wobble or sensor data (the full capture 8 also
    // has a one-report flicker in byte 32, which is not in this trimmed copy).
    for x in &a {
        for note in &x.notes {
            assert!(note.starts_with("Byte 32 changed in only"), "{note}");
        }
    }
}

#[test]
fn inspector_separates_mixed_and_analog_changes() {
    // Paddle sends Cross *and* an undecoded bit: the undecoded bit wins.
    let mixed = analyse(
        &resting(100, |_| {}),
        &resting(100, |r| {
            r[8] |= 0x20;
            r[11] |= 0x01;
        }),
    );
    assert!(matches!(mixed.verdict, Verdict::UndecodedBits { .. }));
    assert!(mixed.changes.iter().any(|c| c.decoded == vec!["Cross"]));
    // Right stick pushed fully: analog only.
    let analog = analyse(&resting(100, |_| {}), &resting(100, |r| r[3] = 255));
    assert_eq!(analog.verdict, Verdict::AnalogOnly);
}

#[test]
fn inspector_notes_brief_presses_and_odd_reports() {
    let mut action = resting(100, |_| {});
    action[0][10] |= 0x80;
    let a = analyse(&resting(100, |_| {}), &action);
    assert!(
        a.notes
            .iter()
            .any(|n| n.to_lowercase().contains("hold the input")),
        "{:?}",
        a.notes
    );
    let odd = analyse(&[vec![0x31; 78]], &[vec![0x31; 78]]);
    assert!(odd.notes.iter().any(|n| n.contains("Report IDs")));
}

fn raw(device: &str, reports: Vec<Vec<u8>>) -> RawCapture {
    RawCapture {
        device_id: device.into(),
        vendor_id: 0x054C,
        product_id: 0x0CE6,
        duration_ms: 2000,
        reports,
    }
}

#[test]
fn inspector_session_requires_a_baseline_from_the_same_controller() {
    let mut s = InspectorSession::default();
    assert!(s
        .add_action("Left paddle", raw("a", with_bits(10, 10, 0x40)))
        .is_err());
    s.set_baseline(raw("a", resting(100, |_| {})));
    assert!(s
        .add_action("Other pad", raw("b", resting(10, |_| {})))
        .is_err());
    let c = s
        .add_action("  Left paddle ", raw("a", with_bits(100, 10, 0x40)))
        .unwrap();
    assert_eq!(c.label, "Left paddle");
    let v = s.view();
    assert_eq!(v.captures.len(), 1);
    assert_eq!(v.baseline.as_ref().unwrap().reports, 100);
    assert!(v.baseline.unwrap().reference_hex.starts_with("01 "));
    let e = s.export();
    assert_eq!(e.baseline.unwrap().reports_hex.len(), 100);
    assert_eq!(e.captures[0].reports_hex.len(), 100);
    assert_eq!(e.captures[0].reports_hex[0].split(' ').count(), 64);
    s.set_baseline(raw("a", resting(100, |_| {})));
    assert!(s.view().captures.is_empty(), "a new baseline starts over");
}

#[test]
fn capture_records_raw_reports_of_the_connected_controller() {
    let (backend, e) = connected_engine();
    let e = Arc::new(e);
    let feeder = {
        let backend = backend.clone();
        std::thread::spawn(move || {
            for seq in 0..40u8 {
                let mut p = Payload::neutral();
                p.seq = seq;
                p.buttons[2] |= 0x40;
                backend.push_report(PATH, p.usb_report());
                std::thread::sleep(Duration::from_millis(4));
            }
        })
    };
    let busy = {
        let e = e.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            e.capture_reports(None, Duration::from_millis(10))
        })
    };
    let c = e.capture_reports(None, Duration::from_millis(250)).unwrap();
    feeder.join().unwrap();
    assert!(busy
        .join()
        .unwrap()
        .unwrap_err()
        .contains("already running"));
    assert!(!c.reports.is_empty());
    assert!(c.reports.iter().all(|r| r.len() == 64 && r[10] & 0x40 != 0));
    assert_eq!(c.device_id, PATH);
}

#[test]
fn capture_and_interfaces_need_a_connected_controller() {
    let backend = MockHidBackend::new();
    let e = engine(&backend);
    assert!(e
        .capture_reports(None, Duration::from_millis(1))
        .unwrap_err()
        .contains("Connect"));
    assert!(e.related_interfaces(None).is_err());
}

#[test]
fn related_interfaces_lists_only_the_same_physical_device() {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    // A second interface of the same USB device (e.g. a paddle board).
    backend.plug(HidDeviceInfo {
        path: "sibling".into(),
        usage_page: 0xFF00,
        usage: 1,
        ancestor_instance_ids: vec![
            r"USB\VID_054C&PID_0CE6&MI_04\q".into(),
            r"USB\VID_054C&PID_0CE6\y".into(),
        ],
        ..usb_info()
    });
    // Another Sony device on a different USB port.
    backend.plug(HidDeviceInfo {
        path: "other".into(),
        ancestor_instance_ids: vec![
            r"USB\VID_054C&PID_0CE6&MI_03\x2".into(),
            r"USB\VID_054C&PID_0CE6\other".into(),
        ],
        ..usb_info()
    });
    let e = engine(&backend);
    wait_status(&e, "connect", |s| !s.devices.is_empty());
    let dev = e
        .status()
        .devices
        .iter()
        .find(|d| d.device.id.0 == PATH)
        .map(|d| d.device.id.0.clone())
        .unwrap();
    let list = e.related_interfaces(Some(&dev)).unwrap();
    let mut paths: Vec<_> = list.iter().map(|d| d.path.as_str()).collect();
    paths.sort();
    let mut expected = vec![PATH, "sibling"];
    expected.sort();
    assert_eq!(paths, expected);
    assert!(list.iter().any(|d| d.usage_page == 0xFF00));
}

// ---- Macro → virtual Xbox 360 controller (mock driver backend) ---------------
//
// These prove the whole pipeline in software: physical report → macro engine →
// virtual controller report. They do not prove that Windows or a game sees
// the controller; that needs ViGEmBus and hardware (see the checklist).

use nexus_virtual_controller::translate::{to_xusb, xusb, XusbReport};
use nexus_virtual_controller::{OutputError, VirtualDeviceHandle};

#[derive(Clone, Debug, PartialEq)]
enum Pad {
    Connect(u64),
    Report(u64, XusbReport),
    Disconnect(u64),
}

/// Everything the mock driver was asked to do, plus how often it was asked
/// to keep its last state alive (those are not new reports).
#[derive(Clone, Default)]
struct PadLog(Arc<Mutex<Vec<Pad>>>, Arc<std::sync::atomic::AtomicUsize>);

impl PadLog {
    fn all(&self) -> Vec<Pad> {
        self.0.lock().unwrap().clone()
    }
    fn reports(&self) -> Vec<XusbReport> {
        self.all()
            .into_iter()
            .filter_map(|p| match p {
                Pad::Report(_, r) => Some(r),
                _ => None,
            })
            .collect()
    }
    fn keep_alives(&self) -> usize {
        self.1.load(Ordering::SeqCst)
    }
    fn live(&self) -> usize {
        let all = self.all();
        let c = all.iter().filter(|p| matches!(p, Pad::Connect(_))).count();
        let d = all
            .iter()
            .filter(|p| matches!(p, Pad::Disconnect(_)))
            .count();
        c - d
    }
    fn wait(&self, what: &str, pred: impl Fn(&[Pad]) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !pred(&self.all()) {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {what}: {:?}",
                self.all().len()
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

/// Stands in for the ViGEmBus backend: Xbox 360 only, records every report.
struct RecordingPad {
    log: PadLog,
    next: u64,
    /// Simulates whether ViGEmBus is installed.
    installed: Arc<std::sync::atomic::AtomicBool>,
    /// Simulates a slow driver: each update takes this long (ms). While it
    /// is `u64::MAX`, updates block until it changes (a hung driver call).
    stall_ms: Arc<AtomicU64>,
}

impl VirtualControllerBackend for RecordingPad {
    fn name(&self) -> &'static str {
        "recording"
    }
    fn status(&self) -> BackendStatus {
        if self.installed.load(Ordering::SeqCst) {
            BackendStatus::Ready { version: None }
        } else {
            BackendStatus::Unavailable {
                reason: "not installed".into(),
            }
        }
    }
    fn supports(&self, kind: VirtualOutputKind) -> bool {
        kind == VirtualOutputKind::Xbox360
    }
    fn connect(&mut self, _: VirtualOutputKind) -> Result<VirtualDeviceHandle, OutputError> {
        if !self.installed.load(Ordering::SeqCst) {
            return Err(OutputError::Unavailable("not installed".into()));
        }
        self.next += 1;
        self.log.0.lock().unwrap().push(Pad::Connect(self.next));
        Ok(VirtualDeviceHandle(self.next))
    }
    fn update(&mut self, h: VirtualDeviceHandle, s: &ControllerState) -> Result<(), OutputError> {
        let stall = self.stall_ms.load(Ordering::SeqCst);
        if stall == u64::MAX {
            while self.stall_ms.load(Ordering::SeqCst) == u64::MAX {
                std::thread::sleep(Duration::from_millis(1));
            }
        } else if stall > 0 {
            std::thread::sleep(Duration::from_millis(stall));
        }
        self.log
            .0
            .lock()
            .unwrap()
            .push(Pad::Report(h.0, to_xusb(s)));
        Ok(())
    }
    fn disconnect(&mut self, h: VirtualDeviceHandle) -> Result<(), OutputError> {
        self.log.0.lock().unwrap().push(Pad::Disconnect(h.0));
        Ok(())
    }
    fn keep_alive(&mut self, _: VirtualDeviceHandle) -> Result<(), OutputError> {
        self.log.1.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn rapid_macro() -> Macro {
    Macro {
        steps: vec![MacroStep {
            id: "s1".into(),
            buttons: vec![MacroButton::South],
            hold_ms: 30,
            delay_after_ms: 30,
        }],
        repeat_delay_ms: 0,
        ..jump_macro(PlaybackMode::RepeatWhileHeld)
    }
}

/// Engine with Xbox 360 output requested and the controller connected.
fn xbox_engine() -> (MockHidBackend, Engine, PadLog) {
    let installed = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let (backend, e, log) = xbox_engine_with(installed);
    log.wait("virtual controller", |p| p.contains(&Pad::Connect(1)));
    (backend, e, log)
}

fn xbox_engine_with(
    installed: Arc<std::sync::atomic::AtomicBool>,
) -> (MockHidBackend, Engine, PadLog) {
    xbox_engine_stalling(installed, Default::default())
}

fn xbox_engine_stalling(
    installed: Arc<std::sync::atomic::AtomicBool>,
    stall_ms: Arc<AtomicU64>,
) -> (MockHidBackend, Engine, PadLog) {
    let backend = MockHidBackend::new();
    backend.plug(usb_info());
    let log = PadLog::default();
    let factory_log = log.clone();
    let e = Engine::start(
        Arc::new(backend.clone()),
        vec![Arc::new(DualSenseDriver)],
        Arc::new(move || {
            Box::new(RecordingPad {
                log: factory_log.clone(),
                next: 0,
                installed: installed.clone(),
                stall_ms: stall_ms.clone(),
            })
        }),
        EngineConfig {
            initial_output: VirtualOutputKind::Xbox360,
            ..config()
        },
    );
    wait_status(&e, "connect", |s| s.devices.len() == 1);
    (backend, e, log)
}

/// Sends `n` reports about 4 ms apart (USB DualSense rate).
fn pump_at_250hz(backend: &MockHidBackend, bits: &[(usize, u8)], n: usize) {
    for _ in 0..n {
        backend.push_report(PATH, report(bits));
        std::thread::sleep(Duration::from_millis(4));
    }
}

const A_PRESSED: fn(&XusbReport) -> bool = |r| r.buttons & xusb::A != 0;

#[test]
fn physical_buttons_reach_the_virtual_xbox_controller() {
    let (backend, _e, log) = xbox_engine();
    backend.push_report(PATH, report(&[(0, 0x20)])); // Cross
    log.wait("A", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if A_PRESSED(r)))
    });
    backend.push_report(PATH, report(&[]));
    log.wait(
        "release",
        |p| matches!(p.last(), Some(Pad::Report(_, r)) if r.buttons == 0),
    );
}

#[test]
fn repeat_while_held_repeats_on_the_virtual_controller_and_stops_on_the_first_released_report() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![rapid_macro()]);
    // Let the reader thread pick up the macro on an idle report first.
    backend.push_report(PATH, report(&[]));
    log.wait("idle report", |p| {
        p.iter().any(|x| matches!(x, Pad::Report(..)))
    });
    let before = log.reports().len();

    // While a macro plays the engine also updates the virtual controller
    // between reports (idle ticks), so reports are matched by content, not
    // count: the released phase holds Triangle (Y) as a marker.
    const TRIANGLE: (usize, u8) = (0, 0x80);
    pump_at_250hz(&backend, &[R3], 100); // ~400 ms: about 6 cycles of 60 ms
    pump_at_250hz(&backend, &[TRIANGLE], 25);
    log.wait("released phase", |p| {
        p.iter()
            .filter(|x| matches!(x, Pad::Report(_, r) if r.buttons & xusb::Y != 0))
            .count()
            >= 25
    });

    let reports = log.reports()[before..].to_vec();
    let first_released = reports
        .iter()
        .position(|r| r.buttons & xusb::Y != 0)
        .unwrap();
    let (held, released) = reports.split_at(first_released);
    let presses = held
        .windows(2)
        .filter(|w| !A_PRESSED(&w[0]) && A_PRESSED(&w[1]))
        .count()
        + usize::from(held.first().is_some_and(A_PRESSED));
    assert!(presses >= 3, "macro repeats while held: {presses} presses");
    assert!(
        held.iter().any(|r| !A_PRESSED(r)),
        "A is released between repeats"
    );
    assert!(
        held.iter().all(|r| r.buttons & xusb::RIGHT_THUMB == 0),
        "trigger (R3) never reaches the game"
    );
    assert!(
        released.iter().all(|r| !A_PRESSED(r)),
        "from the first released report on, the macro presses nothing: {:?}",
        released.iter().map(|r| r.buttons).collect::<Vec<_>>()
    );
    wait_status(&e, "macro stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
}

#[test]
fn unplugging_mid_macro_sends_neutral_then_removes_the_virtual_controller() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]); // holds A for 2 s
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    log.wait("A held", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if A_PRESSED(r)))
    });
    backend.unplug(PATH);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );
    assert_eq!(log.live(), 0);
    wait_status(&e, "disconnected", |s| s.devices.is_empty());
}

#[test]
fn switching_output_mid_macro_releases_cleanly_and_reconnects_fresh() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    log.wait("A held", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if A_PRESSED(r)))
    });

    // Off while the macro is pressing A.
    e.set_output_mode(VirtualOutputKind::Disabled);
    backend.push_report(PATH, report(&[R3]));
    log.wait("off", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let i = all.iter().position(|p| *p == Pad::Disconnect(1)).unwrap();
    assert_eq!(
        all[i - 1],
        Pad::Report(1, XusbReport::default()),
        "neutral before removal"
    );
    assert_eq!(log.live(), 0);

    // DualShock 4 is not offered by this backend: nothing is created.
    e.set_output_mode(VirtualOutputKind::DualShock4);
    backend.push_report(PATH, report(&[]));
    wait_status(&e, "ds4 refused", |s| {
        s.devices[0].output.last_error.is_some()
    });
    assert_eq!(log.live(), 0);

    // Back to Xbox 360: a new controller, nothing held over from before.
    e.set_output_mode(VirtualOutputKind::Xbox360);
    backend.push_report(PATH, report(&[]));
    log.wait("reconnected", |p| p.contains(&Pad::Connect(2)));
    log.wait("first report", |p| {
        p.iter().any(|x| matches!(x, Pad::Report(2, _)))
    });
    let first = log.all().into_iter().find_map(|p| match p {
        Pad::Report(2, r) => Some(r),
        _ => None,
    });
    assert_eq!(first.map(|r| r.buttons), Some(0));
    assert_eq!(log.live(), 1, "exactly one virtual controller");
}

#[test]
fn shutdown_mid_macro_sends_neutral_and_removes_the_virtual_controller() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::Toggle)]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    log.wait("A held", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if A_PRESSED(r)))
    });
    e.shutdown();
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );
    assert_eq!(log.live(), 0);
}

// ---- M4.5: driver readiness, profile reload, rapid and concurrent macros -----

const L3: (usize, u8) = (1, 0x40);
const TRIANGLE_MARK: (usize, u8) = (0, 0x80); // reaches the pad as Y
const SQUARE_MARK: (usize, u8) = (0, 0x10); // reaches the pad as X

fn has(r: &XusbReport, bit: u16) -> bool {
    r.buttons & bit != 0
}

fn macro_on(id: &str, trigger: MacroButton, out: MacroButton, mode: PlaybackMode) -> Macro {
    let mut m = rapid_macro();
    m.id = id.into();
    m.name = id.into();
    m.trigger = Some(trigger);
    m.mode = mode;
    m.steps[0].buttons = vec![out];
    m
}

fn count_with(log: &PadLog, bit: u16) -> usize {
    log.reports().iter().filter(|r| has(r, bit)).count()
}

/// Releases every button, waits until no macro plays, then returns the
/// reports produced by `n` further physical reports holding Square (a marker,
/// seen as X).
fn settle(backend: &MockHidBackend, e: &Engine, log: &PadLog, n: usize) -> Vec<XusbReport> {
    pump_at_250hz(backend, &[], 3); // release everything
    wait_status(e, "macros idle", |s| s.devices[0].playing_macros.is_empty());
    let before = log.reports().len();
    let marked = count_with(log, xusb::X);
    pump_at_250hz(backend, &[SQUARE_MARK], n);
    let deadline = Instant::now() + Duration::from_secs(5);
    while count_with(log, xusb::X) < marked + n {
        assert!(Instant::now() < deadline, "settle timed out");
        std::thread::sleep(Duration::from_millis(2));
    }
    log.reports()[before..].to_vec()
}

#[test]
fn driver_installed_while_running_is_used_after_check_again() {
    let installed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (backend, e, log) = xbox_engine_with(installed.clone());
    backend.push_report(PATH, report(&[]));
    let s = wait_status(&e, "first input", |s| s.devices[0].input.is_some());
    assert_eq!(s.devices[0].output.active, None);
    assert!(log.all().is_empty(), "nothing created without the driver");

    installed.store(true, Ordering::SeqCst); // user installs ViGEmBus
    e.refresh_drivers(); // "Check again"
    backend.push_report(PATH, report(&[]));
    log.wait("created", |p| p.contains(&Pad::Connect(1)));
    let s = wait_status(&e, "active", |s| s.devices[0].output.active.is_some());
    assert!(matches!(
        s.output_backend_status,
        BackendStatus::Ready { .. }
    ));
}

#[test]
fn rapid_taps_never_leave_a_button_held_in_any_mode() {
    for mode in [
        PlaybackMode::RepeatWhileHeld,
        PlaybackMode::Toggle,
        PlaybackMode::Once,
    ] {
        let (backend, e, log) = xbox_engine();
        e.set_macros(vec![macro_on(
            "tap",
            MacroButton::RightStick,
            MacroButton::South,
            mode,
        )]);
        backend.push_report(PATH, report(&[]));
        for _ in 0..20 {
            pump_at_250hz(&backend, &[R3], 2);
            pump_at_250hz(&backend, &[TRIANGLE_MARK], 2);
        }
        let tail = settle(&backend, &e, &log, 10);
        let reports = log.reports();
        if mode == PlaybackMode::RepeatWhileHeld {
            assert!(
                reports
                    .iter()
                    .filter(|r| has(r, xusb::Y))
                    .all(|r| !has(r, xusb::A)),
                "{mode:?}: nothing pressed while released"
            );
        }
        // 20 taps: Toggle ends off; Once finishes; nothing stays held.
        assert!(
            tail.iter().all(|r| !has(r, xusb::A)),
            "{mode:?}: A stuck after taps"
        );
        assert!(
            reports.iter().all(|r| !has(r, xusb::RIGHT_THUMB)),
            "{mode:?}: trigger leaked"
        );
    }
}

#[test]
fn two_macros_run_together_and_stop_independently() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![
        macro_on(
            "a",
            MacroButton::RightStick,
            MacroButton::South,
            PlaybackMode::RepeatWhileHeld,
        ),
        macro_on(
            "b",
            MacroButton::LeftStick,
            MacroButton::East,
            PlaybackMode::RepeatWhileHeld,
        ),
    ]);
    backend.push_report(PATH, report(&[]));
    pump_at_250hz(&backend, &[R3, L3], 50);
    pump_at_250hz(&backend, &[L3, TRIANGLE_MARK], 50); // R3 released
    let tail = settle(&backend, &e, &log, 10);
    let reports = log.reports();
    assert!(
        reports.iter().any(|r| has(r, xusb::A)) && reports.iter().any(|r| has(r, xusb::B)),
        "both play"
    );
    let only_b: Vec<_> = reports.iter().filter(|r| has(r, xusb::Y)).collect();
    assert!(
        only_b.iter().all(|r| !has(r, xusb::A)),
        "A stops when its trigger is released"
    );
    assert!(only_b.iter().any(|r| has(r, xusb::B)), "B keeps repeating");
    assert!(tail.iter().all(|r| !has(r, xusb::A) && !has(r, xusb::B)));
}

#[test]
fn two_macros_pressing_the_same_button_release_it_only_when_both_stop() {
    let (backend, e, log) = xbox_engine();
    let mut a = macro_on(
        "a",
        MacroButton::RightStick,
        MacroButton::South,
        PlaybackMode::RepeatWhileHeld,
    );
    let mut b = macro_on(
        "b",
        MacroButton::LeftStick,
        MacroButton::South,
        PlaybackMode::RepeatWhileHeld,
    );
    a.steps[0].delay_after_ms = 0; // hold A continuously
    b.steps[0].delay_after_ms = 0;
    e.set_macros(vec![a, b]);
    backend.push_report(PATH, report(&[]));
    pump_at_250hz(&backend, &[R3, L3], 20);
    pump_at_250hz(&backend, &[L3, TRIANGLE_MARK], 30); // only L3 still held
    let tail = settle(&backend, &e, &log, 10);
    let held_by_b: Vec<_> = log
        .reports()
        .into_iter()
        .filter(|r| has(r, xusb::Y))
        .collect();
    assert!(held_by_b.len() >= 30);
    assert!(
        held_by_b.iter().all(|r| has(r, xusb::A)),
        "the other macro still holds A"
    );
    assert!(tail.iter().all(|r| !has(r, xusb::A)));
}

#[test]
fn profile_reload_while_held_does_not_restart_the_macro_on_the_virtual_pad() {
    let (backend, e, log) = xbox_engine();
    let m = macro_on(
        "a",
        MacroButton::RightStick,
        MacroButton::South,
        PlaybackMode::RepeatWhileHeld,
    );
    e.set_macros(vec![m.clone()]);
    backend.push_report(PATH, report(&[]));
    pump_at_250hz(&backend, &[R3], 30);
    log.wait("A", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if has(r, xusb::A)))
    });

    e.set_macros(vec![m]); // profile switch: same macro reloaded
    pump_at_250hz(&backend, &[R3], 2);
    wait_status(&e, "reloaded", |s| s.devices[0].playing_macros.is_empty());
    let marked = count_with(&log, xusb::Y);
    let before = log.reports().len();
    pump_at_250hz(&backend, &[R3, TRIANGLE_MARK], 40); // still held, ~160 ms
    let deadline = Instant::now() + Duration::from_secs(5);
    while count_with(&log, xusb::Y) < marked + 40 {
        assert!(Instant::now() < deadline, "timed out");
        std::thread::sleep(Duration::from_millis(2));
    }
    let after = log.reports()[before..].to_vec();
    assert!(
        after.iter().all(|r| !has(r, xusb::A)),
        "no restart until released"
    );
    assert!(
        after.iter().all(|r| !has(r, xusb::RIGHT_THUMB)),
        "trigger stays hidden"
    );

    pump_at_250hz(&backend, &[], 2); // release
    let before = log.reports().len();
    pump_at_250hz(&backend, &[R3], 20); // fresh press
    log.wait("restart", |p| {
        p[before..]
            .iter()
            .any(|x| matches!(x, Pad::Report(_, r) if has(r, xusb::A)))
    });
}

#[test]
fn switching_to_a_profile_with_output_off_mid_macro_releases_cleanly() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    log.wait("A held", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if has(r, xusb::A)))
    });
    // What apply_profile does for a profile whose output is Disabled.
    e.set_output_mode(VirtualOutputKind::Disabled);
    e.set_macros(vec![]);
    backend.push_report(PATH, report(&[R3]));
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let i = all.iter().position(|p| *p == Pad::Disconnect(1)).unwrap();
    assert_eq!(all[i - 1], Pad::Report(1, XusbReport::default()));
    assert_eq!(log.live(), 0);
}

// ---- Profile reload during an input stall (no reports arriving) -----------
// The test read timeout is 5 ms, so "no reports pushed" is a stall: the
// reader thread only gets idle ticks, exactly as in production after 100 ms
// of silence.

/// Holds R3 so the 2 s jump macro presses A, then stops sending reports.
fn stall_mid_macro(backend: &MockHidBackend, e: &Engine) {
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    wait_status(e, "macro playing", |s| {
        s.devices[0].playing_macros == vec!["jump".to_owned()]
    });
}

fn last_report(log: &PadLog, pad: u64) -> Option<XusbReport> {
    log.all().into_iter().rev().find_map(|p| match p {
        Pad::Report(h, r) if h == pad => Some(r),
        _ => None,
    })
}

#[test]
fn profile_reload_during_a_stall_sends_neutral_and_reports_restore_input() {
    let (backend, e, log) = xbox_engine();
    stall_mid_macro(&backend, &e);
    log.wait("A held", |_| {
        last_report(&log, 1).is_some_and(|r| has(&r, xusb::A))
    });

    // Profile switch (output stays on) while no reports arrive.
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    let s = wait_status(&e, "macro stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    log.wait("neutral frame", |_| {
        last_report(&log, 1) == Some(XusbReport::default())
    });
    assert_eq!(s.devices[0].processed, Some(ControllerState::default()));

    // The stall continues: nothing presses anything again.
    let before = log.all().len();
    std::thread::sleep(Duration::from_millis(60));
    assert!(log.all()[before..]
        .iter()
        .all(|p| matches!(p, Pad::Report(1, r) if *r == XusbReport::default())));
    assert_eq!(log.live(), 1, "the virtual controller stays connected");

    // Reports resume with the trigger still held and Cross pressed: physical
    // input passes through, the macro does not restart, the trigger is hidden.
    let before = log.reports().len();
    pump_at_250hz(&backend, &[R3, TRIANGLE_MARK], 10);
    log.wait("physical input again", |_| {
        log.reports()[before..].iter().any(|r| has(r, xusb::Y))
    });
    let after = log.reports()[before..].to_vec();
    assert!(after.iter().all(|r| !has(r, xusb::A)), "no restart");
    assert!(after.iter().all(|r| !has(r, xusb::RIGHT_THUMB)));

    // Release and press again: the macro works normally.
    pump_at_250hz(&backend, &[], 2);
    let before = log.reports().len();
    pump_at_250hz(&backend, &[R3], 10);
    log.wait("fresh press plays", |_| {
        log.reports()[before..].iter().any(|r| has(r, xusb::A))
    });
}

#[test]
fn switching_to_an_output_off_profile_during_a_stall_releases_cleanly() {
    let (backend, e, log) = xbox_engine();
    stall_mid_macro(&backend, &e);
    log.wait("A held", |_| {
        last_report(&log, 1).is_some_and(|r| has(&r, xusb::A))
    });

    // Output on -> off, no reports arriving.
    e.set_output_mode(VirtualOutputKind::Disabled);
    e.set_macros(vec![]);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    wait_status(&e, "macro stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    let all = log.all();
    let i = all.iter().position(|p| *p == Pad::Disconnect(1)).unwrap();
    assert_eq!(all[i - 1], Pad::Report(1, XusbReport::default()));
    std::thread::sleep(Duration::from_millis(40));
    assert_eq!(log.all().len(), i + 1, "nothing after the removal");
    assert_eq!(log.live(), 0);
}

#[test]
fn switching_to_an_output_on_profile_during_a_stall_starts_neutral() {
    let (backend, e, log) = xbox_engine();
    e.set_output_mode(VirtualOutputKind::Disabled);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    // The macro plays (output off) and then reports stop.
    stall_mid_macro(&backend, &e);

    // Output off -> on with a profile reload, no reports arriving.
    e.set_output_mode(VirtualOutputKind::Xbox360);
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    log.wait("new virtual controller", |p| p.contains(&Pad::Connect(2)));
    wait_status(&e, "macro stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    log.wait("neutral frame", |_| {
        last_report(&log, 2) == Some(XusbReport::default())
    });
    std::thread::sleep(Duration::from_millis(40));
    assert_eq!(last_report(&log, 2), Some(XusbReport::default()));

    // Reports resume: physical input reaches the new virtual controller.
    backend.push_report(PATH, report(&[CROSS]));
    log.wait("physical input", |_| {
        last_report(&log, 2).is_some_and(|r| has(&r, xusb::A))
    });
}

#[test]
fn profile_reload_during_a_stall_with_output_off_creates_nothing() {
    let (backend, e, log) = xbox_engine();
    e.set_output_mode(VirtualOutputKind::Disabled);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let events = log.all().len();
    stall_mid_macro(&backend, &e);

    // Output off -> off with a profile reload, no reports arriving.
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    let s = wait_status(&e, "macro stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    assert_eq!(s.devices[0].processed, Some(ControllerState::default()));
    std::thread::sleep(Duration::from_millis(40));
    assert_eq!(log.all().len(), events, "no virtual controller activity");
    assert_eq!(log.live(), 0);
}

#[test]
fn idle_ticks_are_not_counted_as_processing_time_samples() {
    let (backend, e) = connected_engine(); // 1 report so far
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    for _ in 0..63 {
        backend.push_report(PATH, report(&[R3]));
    }
    let s = wait_status(&e, "64 reports", |s| s.devices[0].total_reports == 64);
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_owned()]);
    // A stall: the macro keeps running on idle ticks (about 5 ms apart).
    std::thread::sleep(Duration::from_millis(150));
    for _ in 0..64 {
        backend.push_report(PATH, report(&[R3]));
    }
    let s = wait_status(&e, "128 reports", |s| {
        s.devices[0].total_reports == 128 && s.devices[0].pipeline_latency.samples >= 128
    });
    assert_eq!(
        s.devices[0].pipeline_latency.samples, 128,
        "one sample per controller report, none for idle ticks"
    );
    // The stall itself stays visible in the report-interval statistics.
    assert!(s.devices[0].report_intervals.over_50ms >= 1);
}

// ---- Fail-safe for repeated unreadable reports ------------------------------

fn unreadable() -> Vec<u8> {
    vec![0x77; 64] // unknown report id
}

fn push_unreadable(backend: &MockHidBackend, n: usize) {
    for _ in 0..n {
        backend.push_report(PATH, unreadable());
    }
}

fn wait_errors(e: &Engine, n: u64) -> EngineStatus {
    wait_status(e, "unreadable reports counted", |s| {
        s.devices.first().is_some_and(|d| d.parse_errors == n)
    })
}

fn log_count(e: &Engine, text: &str) -> usize {
    e.recent_log(500)
        .iter()
        .filter(|l| l.message.contains(text))
        .count()
}

const FAILSAFE_WARNING: &str = "unreadable reports in a row";
const FAILSAFE_RECOVERY: &str = "readable again";

/// Holds R3 so the 2 s jump macro is pressing A on the virtual controller.
fn holding_macro(backend: &MockHidBackend, e: &Engine, log: &PadLog) {
    stall_mid_macro(backend, e);
    log.wait("A held", |_| {
        last_report(log, 1).is_some_and(|r| has(&r, xusb::A))
    });
}

/// Last report sent after position `from` in the log, on any virtual pad.
/// (Each new session's mock driver numbers its pads from 1 again.)
fn last_report_since(log: &PadLog, from: usize) -> Option<XusbReport> {
    log.all()[from..].iter().rev().find_map(|p| match p {
        Pad::Report(_, r) => Some(*r),
        _ => None,
    })
}

fn connects(p: &[Pad]) -> usize {
    p.iter().filter(|x| matches!(x, Pad::Connect(_))).count()
}

#[test]
fn seven_unreadable_reports_do_not_trigger_the_fail_safe() {
    assert_eq!(crate::UNREADABLE_REPORT_LIMIT, 8);
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 7);
    let s = wait_errors(&e, 7);
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_owned()]);
    assert!(log.reports().iter().skip(1).all(|r| has(r, xusb::A)));
    assert!(last_report(&log, 1).is_some_and(|r| has(&r, xusb::A)));
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 0);
    // A valid report carries on as if nothing happened: no restart needed.
    backend.push_report(PATH, report(&[R3]));
    let s = wait_status(&e, "valid report", |s| s.devices[0].total_reports == 10);
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_owned()]);
    assert!(last_report(&log, 1).is_some_and(|r| has(&r, xusb::A)));
    assert_eq!(log_count(&e, FAILSAFE_RECOVERY), 0);
}

#[test]
fn eight_unreadable_reports_stop_macros_and_send_one_neutral_frame() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 8);
    let s = wait_errors(&e, 8);
    let s = if s.devices[0].playing_macros.is_empty() {
        s
    } else {
        wait_status(&e, "macros stopped", |s| {
            s.devices[0].playing_macros.is_empty()
        })
    };
    assert_eq!(s.devices[0].processed, Some(ControllerState::default()));
    assert_eq!(last_report(&log, 1), Some(XusbReport::default()));
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 1);

    // Idle ticks after the fail-safe add nothing: exactly one neutral frame
    // follows the last frame that had A pressed.
    std::thread::sleep(Duration::from_millis(60));
    let reports = log.reports();
    let last_a = reports.iter().rposition(|r| has(r, xusb::A)).unwrap();
    assert_eq!(reports[last_a + 1..], [XusbReport::default()]);

    // More unreadable reports: no further output, no repeated warning, and
    // the virtual controller stays connected.
    let events = log.all().len();
    push_unreadable(&backend, 40);
    wait_errors(&e, 48);
    std::thread::sleep(Duration::from_millis(40)); // idle ticks too
    assert_eq!(log.all().len(), events, "exactly one neutral frame");
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 1);
    assert_eq!(log.live(), 1);
    assert!(!log.all().iter().any(|p| matches!(p, Pad::Disconnect(_))));
    assert_eq!(e.status().devices.len(), 1, "still connected");
}

#[test]
fn a_valid_report_between_errors_resets_the_count() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 7);
    backend.push_report(PATH, report(&[R3]));
    push_unreadable(&backend, 7);
    let s = wait_errors(&e, 14);
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_owned()]);
    assert!(last_report(&log, 1).is_some_and(|r| has(&r, xusb::A)));
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 0);
    // The eighth in a row after the reset does trigger it.
    push_unreadable(&backend, 1);
    wait_status(&e, "fail-safe", |s| s.devices[0].playing_macros.is_empty());
    assert_eq!(last_report(&log, 1), Some(XusbReport::default()));
}

#[test]
fn alternating_valid_and_unreadable_reports_never_trigger_the_fail_safe() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    for _ in 0..40 {
        backend.push_report(PATH, unreadable());
        backend.push_report(PATH, report(&[R3]));
    }
    let s = wait_status(&e, "all reports", |s| s.devices[0].total_reports == 82);
    assert_eq!(s.devices[0].parse_errors, 40);
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_owned()]);
    assert!(log.reports().iter().skip(1).all(|r| has(r, xusb::A)));
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 0);
}

#[test]
fn recovery_restores_physical_input_and_macros_need_a_fresh_press() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 12);
    wait_errors(&e, 12);
    wait_status(&e, "fail-safe", |s| s.devices[0].playing_macros.is_empty());
    std::thread::sleep(Duration::from_millis(40)); // idle ticks add nothing
    let before = log.reports().len();
    assert_eq!(log.reports()[before - 1], XusbReport::default());

    // First valid report: Circle, left stick fully right, R2 fully pulled,
    // and the macro trigger R3 still held.
    let mut p = Payload::neutral();
    p.buttons[0] |= CIRCLE.1;
    p.buttons[1] |= R3.1;
    p.lx = 255;
    p.r2 = 255;
    backend.push_report(PATH, p.usb_report());
    log.wait("first valid report", |_| log.reports().len() > before);
    let first = log.reports()[before];
    assert!(has(&first, xusb::B), "physical button on the first report");
    assert_eq!(first.thumb_lx, i16::MAX, "stick");
    assert_eq!(first.right_trigger, 255, "trigger");
    assert!(!has(&first, xusb::A), "macro not restarted");
    assert!(
        !has(&first, xusb::RIGHT_THUMB),
        "macro trigger still hidden"
    );

    // Still held: the macro stays stopped. Recovery is logged once.
    for _ in 0..20 {
        backend.push_report(PATH, p.usb_report());
    }
    let s = wait_status(&e, "more reports", |s| s.devices[0].total_reports == 35);
    assert!(s.devices[0].playing_macros.is_empty());
    assert!(log.reports()[before..].iter().all(|r| !has(r, xusb::A)));
    assert_eq!(log_count(&e, FAILSAFE_RECOVERY), 1);
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 1);

    // Release, then press again: the macro plays.
    pump_at_250hz(&backend, &[], 2);
    let before = log.reports().len();
    pump_at_250hz(&backend, &[R3], 10);
    log.wait("fresh press plays", |_| {
        log.reports()[before..].iter().any(|r| has(r, xusb::A))
    });

    // A second episode warns again (once), and recovers again (once).
    push_unreadable(&backend, 8);
    wait_status(&e, "second fail-safe", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    backend.push_report(PATH, report(&[]));
    let deadline = Instant::now() + Duration::from_secs(5);
    while log_count(&e, FAILSAFE_RECOVERY) < 2 {
        assert!(Instant::now() < deadline, "second recovery not logged");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 2);
}

#[test]
fn fail_safe_with_output_disabled_sends_no_virtual_report() {
    let (backend, e, log) = xbox_engine();
    e.set_output_mode(VirtualOutputKind::Disabled);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let events = log.all().len();
    stall_mid_macro(&backend, &e);
    push_unreadable(&backend, 8);
    wait_errors(&e, 8);
    let s = wait_status(&e, "macros stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    assert_eq!(s.devices[0].processed, Some(ControllerState::default()));
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 1);
    std::thread::sleep(Duration::from_millis(30));
    assert_eq!(log.all().len(), events, "no virtual controller activity");
    assert_eq!(log.live(), 0);
}

#[test]
fn the_unreadable_count_starts_again_after_a_reconnect() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 7);
    wait_errors(&e, 7);

    // Normal disconnect handling is unchanged: neutral, then removal.
    backend.unplug(PATH);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );
    wait_status(&e, "disconnected", |s| s.devices.is_empty());

    // New session: seven more unreadable reports are 7 in a row, not 14.
    let base = log.all().len();
    backend.plug(usb_info());
    log.wait("new virtual controller", |p| connects(p) == 2);
    wait_status(&e, "reconnected", |s| s.devices.len() == 1);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3]));
    log.wait("A held again", |_| {
        last_report_since(&log, base).is_some_and(|r| has(&r, xusb::A))
    });
    push_unreadable(&backend, 7);
    let s = wait_errors(&e, 7);
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_owned()]);
    assert!(last_report_since(&log, base).is_some_and(|r| has(&r, xusb::A)));
    assert_eq!(log.live(), 1);
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 0);
}

#[test]
fn disconnect_during_the_fail_safe_removes_the_virtual_controller_normally() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 8);
    wait_status(&e, "fail-safe", |s| s.devices[0].playing_macros.is_empty());
    assert_eq!(log.live(), 1, "fail-safe keeps the virtual controller");

    backend.unplug(PATH);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );
    assert_eq!(log.live(), 0);

    // Reconnecting gives a clean session with working input.
    wait_status(&e, "disconnected", |s| s.devices.is_empty());
    let base = log.all().len();
    backend.plug(usb_info());
    log.wait("new virtual controller", |p| connects(p) == 2);
    wait_status(&e, "reconnected", |s| s.devices.len() == 1);
    backend.push_report(PATH, report(&[CROSS]));
    log.wait("physical input", |_| {
        last_report_since(&log, base).is_some_and(|r| has(&r, xusb::A))
    });
    assert_eq!(log_count(&e, FAILSAFE_WARNING), 1);
    assert_eq!(
        log_count(&e, FAILSAFE_RECOVERY),
        0,
        "new session, no episode"
    );
}

#[test]
fn shutdown_during_the_fail_safe_is_safe() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 20);
    wait_errors(&e, 20);
    wait_status(&e, "fail-safe", |s| s.devices[0].playing_macros.is_empty());
    e.shutdown();
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );
    assert_eq!(log.live(), 0);
    e.shutdown(); // idempotent
}

#[test]
fn the_fail_safe_stops_every_active_macro() {
    let (backend, e, log) = xbox_engine();
    let long = |id: &str, trigger, out, mode| {
        let mut m = macro_on(id, trigger, out, mode);
        m.steps[0].hold_ms = 2000;
        m
    };
    e.set_macros(vec![
        long(
            "held",
            MacroButton::RightStick,
            MacroButton::South,
            PlaybackMode::RepeatWhileHeld,
        ),
        long(
            "toggled",
            MacroButton::LeftStick,
            MacroButton::East,
            PlaybackMode::Toggle,
        ),
    ]);
    backend.push_report(PATH, report(&[]));
    backend.push_report(PATH, report(&[R3, L3]));
    wait_status(&e, "both playing", |s| {
        s.devices[0].playing_macros.len() == 2
    });
    log.wait("A and B held", |_| {
        last_report(&log, 1).is_some_and(|r| has(&r, xusb::A) && has(&r, xusb::B))
    });

    push_unreadable(&backend, 8);
    wait_status(&e, "all stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });
    assert_eq!(last_report(&log, 1), Some(XusbReport::default()));

    // Valid reports with both triggers still held: neither macro restarts,
    // including the toggled one.
    let before = log.reports().len();
    for _ in 0..20 {
        backend.push_report(PATH, report(&[R3, L3, TRIANGLE_MARK]));
    }
    log.wait("valid reports", |_| {
        log.reports()[before..]
            .iter()
            .filter(|r| has(r, xusb::Y))
            .count()
            == 20
    });
    assert!(log.reports()[before..]
        .iter()
        .all(|r| !has(r, xusb::A) && !has(r, xusb::B)));
    assert!(e.status().devices[0].playing_macros.is_empty());
}

// ---- Game output: physical DualSense → processing → virtual Xbox 360 pad ----
// Everything a game receives is what the mock driver records here, already
// translated to the XInput report. These tests follow one input at a time from
// the USB report to that report.

use nexus_input_processing::{LayerMode, MappingLayer, ProcessingConfig, RemapRule, ResponseCurve};

/// Xbox output with processing switched to plain passthrough.
fn passthrough_xbox() -> (MockHidBackend, Engine, PadLog) {
    let (backend, e, log) = xbox_engine();
    e.set_processing(ProcessingConfig::passthrough());
    (backend, e, log)
}

/// Sends one physical report and waits until the virtual pad shows `want`.
fn expect_pad(backend: &MockHidBackend, log: &PadLog, p: &Payload, want: XusbReport, what: &str) {
    backend.push_report(PATH, p.usb_report());
    let deadline = Instant::now() + Duration::from_secs(5);
    while log.reports().last() != Some(&want) {
        assert!(
            Instant::now() < deadline,
            "{what}: virtual pad shows {:?}, expected {want:?}",
            log.reports().last()
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn pad(buttons: u16) -> XusbReport {
    XusbReport {
        buttons,
        ..Default::default()
    }
}

fn held(byte: usize, mask: u8) -> Payload {
    let mut p = Payload::neutral();
    p.buttons[byte] |= mask;
    p
}

fn dpad(hat: u8) -> Payload {
    let mut p = Payload::neutral();
    p.buttons[0] = hat;
    p
}

#[test]
fn every_physical_button_reaches_the_virtual_pad_as_its_xbox_button() {
    let (backend, _e, log) = passthrough_xbox();
    let cases: [(&str, Payload, u16); 19] = [
        ("Cross", held(0, 0x20), xusb::A),
        ("Circle", held(0, 0x40), xusb::B),
        ("Square", held(0, 0x10), xusb::X),
        ("Triangle", held(0, 0x80), xusb::Y),
        ("L1", held(1, 0x01), xusb::LEFT_SHOULDER),
        ("R1", held(1, 0x02), xusb::RIGHT_SHOULDER),
        ("Create", held(1, 0x10), xusb::BACK),
        ("Options", held(1, 0x20), xusb::START),
        ("L3", held(1, 0x40), xusb::LEFT_THUMB),
        ("R3", held(1, 0x80), xusb::RIGHT_THUMB),
        ("PS", held(2, 0x01), xusb::GUIDE),
        ("D-pad up", dpad(0), xusb::DPAD_UP),
        ("D-pad up-right", dpad(1), xusb::DPAD_UP | xusb::DPAD_RIGHT),
        ("D-pad right", dpad(2), xusb::DPAD_RIGHT),
        ("D-pad down", dpad(4), xusb::DPAD_DOWN),
        (
            "D-pad down-left",
            dpad(5),
            xusb::DPAD_DOWN | xusb::DPAD_LEFT,
        ),
        ("D-pad left", dpad(6), xusb::DPAD_LEFT),
        // No Xbox 360 equivalent: nothing is sent unless remapped.
        ("Touchpad click", held(2, 0x02), 0),
        ("Mute", held(2, 0x04), 0),
    ];
    for (name, p, bits) in cases {
        expect_pad(&backend, &log, &p, pad(bits), name);
        // Releasing returns the pad to exactly neutral: nothing stays held.
        expect_pad(&backend, &log, &Payload::neutral(), pad(0), "release");
    }
    // Several at once.
    let mut p = held(0, 0x20 | 0x80);
    p.buttons[1] |= 0x01 | 0x80;
    expect_pad(
        &backend,
        &log,
        &p,
        pad(xusb::A | xusb::Y | xusb::LEFT_SHOULDER | xusb::RIGHT_THUMB),
        "four buttons",
    );
}

#[test]
fn sticks_reach_the_virtual_pad_with_full_range_and_xinput_directions() {
    let (backend, _e, log) = passthrough_xbox();
    let stick = |lx: u8, ly: u8, rx: u8, ry: u8| {
        let mut p = Payload::neutral();
        (p.lx, p.ly, p.rx, p.ry) = (lx, ly, rx, ry);
        p
    };
    let want = |lx: i16, ly: i16, rx: i16, ry: i16| XusbReport {
        thumb_lx: lx,
        thumb_ly: ly,
        thumb_rx: rx,
        thumb_ry: ry,
        ..Default::default()
    };
    // DualSense: 0 = left / up, 255 = right / down. XInput: up is positive.
    expect_pad(
        &backend,
        &log,
        &stick(255, 128, 128, 128),
        want(32767, 0, 0, 0),
        "left right",
    );
    expect_pad(
        &backend,
        &log,
        &stick(0, 128, 128, 128),
        want(-32768, 0, 0, 0),
        "left left",
    );
    expect_pad(
        &backend,
        &log,
        &stick(128, 0, 128, 128),
        want(0, 32767, 0, 0),
        "left up",
    );
    expect_pad(
        &backend,
        &log,
        &stick(128, 255, 128, 128),
        want(0, -32768, 0, 0),
        "left down",
    );
    // Diagonals: radial shaping keeps the stick on the unit circle (a real
    // stick's gate is round), so a corner arrives as 0.7071 on each axis.
    expect_pad(
        &backend,
        &log,
        &stick(128, 128, 255, 0),
        want(0, 0, 23170, 23170),
        "right up-right",
    );
    expect_pad(
        &backend,
        &log,
        &stick(128, 128, 0, 255),
        want(0, 0, -23170, -23170),
        "right down-left",
    );
    expect_pad(
        &backend,
        &log,
        &stick(128, 128, 128, 128),
        want(0, 0, 0, 0),
        "centre is exactly 0",
    );
    // Half deflection stays proportional (64/127 of full).
    backend.push_report(PATH, stick(192, 128, 128, 128).usb_report());
    log.wait("half right", |_| {
        log.reports()
            .last()
            .is_some_and(|r| (r.thumb_lx - 16512).abs() <= 2)
    });
}

#[test]
fn analog_triggers_reach_the_virtual_pad_exactly() {
    let (backend, _e, log) = passthrough_xbox();
    for (l2, r2) in [
        (0u8, 0u8),
        (1, 254),
        (100, 37),
        (128, 128),
        (255, 255),
        (0, 0),
    ] {
        let mut p = Payload::neutral();
        (p.l2, p.r2) = (l2, r2);
        let want = XusbReport {
            left_trigger: l2,
            right_trigger: r2,
            ..Default::default()
        };
        expect_pad(&backend, &log, &p, want, "triggers");
    }
}

#[test]
fn remaps_reach_the_virtual_pad() {
    let (backend, e, log) = xbox_engine();
    let mut cfg = ProcessingConfig::passthrough();
    cfg.remap = vec![
        RemapRule::new(MacroButton::South, Some(MacroButton::East)), // Cross → B
        RemapRule::new(MacroButton::West, Some(MacroButton::RightTrigger)), // Square → RT
        RemapRule::new(MacroButton::North, None),                    // Triangle off
        RemapRule::new(MacroButton::Touchpad, Some(MacroButton::Select)), // Touchpad → Back
        RemapRule::new(MacroButton::LeftTrigger, Some(MacroButton::RightTrigger)),
    ];
    e.set_processing(cfg);
    expect_pad(
        &backend,
        &log,
        &held(0, 0x20),
        pad(xusb::B),
        "Cross sends B, not A",
    );
    expect_pad(
        &backend,
        &log,
        &held(0, 0x80),
        pad(0),
        "disabled button sends nothing",
    );
    expect_pad(
        &backend,
        &log,
        &held(2, 0x02),
        pad(xusb::BACK),
        "touchpad click sends Back",
    );
    let full_rt = XusbReport {
        right_trigger: 255,
        ..Default::default()
    };
    expect_pad(
        &backend,
        &log,
        &held(0, 0x10),
        full_rt,
        "button on a trigger pulls it fully",
    );
    // A trigger mapped to the other trigger keeps its analog value.
    let mut p = Payload::neutral();
    p.l2 = 90;
    let moved = XusbReport {
        right_trigger: 90,
        ..Default::default()
    };
    expect_pad(&backend, &log, &p, moved, "L2 travel arrives on RT");
    expect_pad(&backend, &log, &Payload::neutral(), pad(0), "release");
}

#[test]
fn deadzone_and_curve_shape_what_the_virtual_pad_receives() {
    let (backend, e, log) = xbox_engine();
    let mut cfg = ProcessingConfig::passthrough();
    cfg.left_stick.deadzone = 0.25;
    cfg.left_stick.curve = ResponseCurve::Power { exponent: 2.0 };
    cfg.right_trigger.deadzone = 0.5;
    e.set_processing(cfg);
    let mut p = Payload::neutral();
    p.lx = 150; // ≈0.17: inside the deadzone
    p.r2 = 100; // ≈0.39: inside the trigger deadzone
    expect_pad(&backend, &log, &p, pad(0), "inside both deadzones");
    p.lx = 255;
    p.r2 = 255;
    let full = XusbReport {
        thumb_lx: 32767,
        right_trigger: 255,
        ..Default::default()
    };
    expect_pad(&backend, &log, &p, full, "full deflection is still full");
    // Halfway through the usable range, a squared curve gives a quarter.
    let mut p = Payload::neutral();
    p.lx = 128 + 79; // ≈0.622 → (0.622-0.25)/0.75 ≈ 0.496 → ² ≈ 0.246
    backend.push_report(PATH, p.usb_report());
    log.wait("curved half", |_| {
        log.reports()
            .last()
            .is_some_and(|r| (r.thumb_lx as f32 / 32767.0 - 0.246).abs() < 0.01 && r.thumb_ly == 0)
    });
}

#[test]
fn shift_layers_change_what_the_virtual_pad_receives() {
    let (backend, e, log) = xbox_engine();
    let mut cfg = ProcessingConfig::passthrough();
    cfg.layers = vec![MappingLayer {
        name: "Shift".into(),
        activator: MacroButton::LeftShoulder,
        mode: LayerMode::Hold,
        remap: vec![RemapRule::new(MacroButton::West, Some(MacroButton::DpadUp))],
    }];
    e.set_processing(cfg);
    expect_pad(
        &backend,
        &log,
        &held(0, 0x10),
        pad(xusb::X),
        "Square alone is X",
    );
    expect_pad(
        &backend,
        &log,
        &held(1, 0x01),
        pad(0),
        "the layer button itself is hidden",
    );
    let mut both = held(0, 0x10);
    both.buttons[1] |= 0x01;
    expect_pad(
        &backend,
        &log,
        &both,
        pad(xusb::DPAD_UP),
        "L1 + Square is D-pad up",
    );
    // Other buttons keep working while the layer is held.
    let mut plus = both;
    plus.buttons[0] |= 0x20;
    expect_pad(
        &backend,
        &log,
        &plus,
        pad(xusb::DPAD_UP | xusb::A),
        "plus Cross",
    );
    expect_pad(
        &backend,
        &log,
        &held(0, 0x10),
        pad(xusb::X),
        "layer released: X again",
    );
    expect_pad(&backend, &log, &Payload::neutral(), pad(0), "release");
}

#[test]
fn macro_presses_combine_with_physical_buttons_sticks_and_triggers() {
    let (backend, e, log) = passthrough_xbox();
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]); // R3 → A for 2 s
    backend.push_report(PATH, report(&[]));
    // Hold the macro trigger, Circle, the left stick right and half RT.
    let mut p = held(1, 0x80);
    p.buttons[0] |= 0x40;
    p.lx = 255;
    p.r2 = 128;
    let want = XusbReport {
        buttons: xusb::A | xusb::B, // macro's A + physical B; R3 hidden
        thumb_lx: 32767,
        right_trigger: 128,
        ..Default::default()
    };
    expect_pad(
        &backend,
        &log,
        &p,
        want,
        "macro and physical input together",
    );
    // Physical changes pass through while the macro keeps playing.
    p.buttons[0] &= !0x40;
    p.lx = 128;
    let want = XusbReport {
        buttons: xusb::A,
        right_trigger: 128,
        ..Default::default()
    };
    expect_pad(
        &backend,
        &log,
        &p,
        want,
        "physical released, macro still pressing",
    );
    // Releasing the trigger stops the macro; only physical input remains.
    let mut p = Payload::neutral();
    p.r2 = 128;
    let want = XusbReport {
        right_trigger: 128,
        ..Default::default()
    };
    expect_pad(&backend, &log, &p, want, "macro stopped");
    // A physical press of the macro's own output button is not cancelled by it.
    expect_pad(
        &backend,
        &log,
        &held(0, 0x20),
        pad(xusb::A),
        "physical Cross",
    );
}

#[test]
fn switching_profiles_keeps_the_same_virtual_pad_and_applies_the_new_mapping() {
    let (backend, e, log) = passthrough_xbox();
    expect_pad(
        &backend,
        &log,
        &held(0, 0x20),
        pad(xusb::A),
        "profile 1: Cross is A",
    );
    // What apply_profile does when both profiles use Xbox 360 output.
    let mut cfg = ProcessingConfig::passthrough();
    cfg.remap = vec![RemapRule::new(MacroButton::South, Some(MacroButton::North))];
    e.set_output_mode(VirtualOutputKind::Xbox360);
    e.set_processing(cfg);
    e.set_macros(vec![]);
    expect_pad(
        &backend,
        &log,
        &held(0, 0x20),
        pad(xusb::Y),
        "profile 2: Cross is Y",
    );
    let all = log.all();
    assert_eq!(
        connects(&all),
        1,
        "the game keeps seeing the same controller"
    );
    assert!(!all.iter().any(|p| matches!(p, Pad::Disconnect(_))));
    // No frame in between had both the old and the new button, or a stray one.
    assert!(log
        .reports()
        .iter()
        .all(|r| [0, xusb::A, xusb::Y].contains(&r.buttons)));
}

#[test]
fn turning_output_off_and_on_again_gives_a_fresh_working_pad() {
    let (backend, e, log) = passthrough_xbox();
    expect_pad(&backend, &log, &held(0, 0x20), pad(xusb::A), "before");
    e.set_output_mode(VirtualOutputKind::Disabled);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let i = all.iter().position(|p| *p == Pad::Disconnect(1)).unwrap();
    assert_eq!(
        all[i - 1],
        Pad::Report(1, XusbReport::default()),
        "neutral first"
    );
    // While off, input produces no virtual reports at all.
    backend.push_report(PATH, held(0, 0x40).usb_report());
    wait_status(&e, "report seen", |s| {
        s.devices[0].input.is_some_and(|i| i.buttons.east)
    });
    assert_eq!(log.all().len(), i + 1);
    assert_eq!(e.status().devices[0].output.active, None);

    e.set_output_mode(VirtualOutputKind::Xbox360);
    log.wait("created again", |p| connects(p) == 2);
    expect_pad(
        &backend,
        &log,
        &held(0, 0x10),
        pad(xusb::X),
        "after re-enabling",
    );
    assert_eq!(log.live(), 1);
    assert_eq!(
        e.status().devices[0].output.active,
        Some(VirtualOutputKind::Xbox360)
    );
}

#[test]
fn closing_and_restarting_nexus_leaves_no_pad_behind_and_works_again() {
    let (backend, e, log) = passthrough_xbox();
    expect_pad(&backend, &log, &held(0, 0x20), pad(xusb::A), "first run");
    e.shutdown();
    drop(e);
    assert_eq!(log.live(), 0, "no virtual controller left behind");
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );

    // Second run: same controller still plugged in.
    let log2 = PadLog::default();
    let factory_log = log2.clone();
    let e2 = Engine::start(
        Arc::new(backend.clone()),
        vec![Arc::new(DualSenseDriver)],
        Arc::new(move || {
            Box::new(RecordingPad {
                log: factory_log.clone(),
                next: 0,
                installed: Arc::new(std::sync::atomic::AtomicBool::new(true)),
                stall_ms: Default::default(),
            })
        }),
        EngineConfig {
            initial_output: VirtualOutputKind::Xbox360,
            processing: ProcessingConfig::passthrough(),
            ..config()
        },
    );
    wait_status(&e2, "reconnect", |s| s.devices.len() == 1);
    log2.wait("virtual controller", |p| p.contains(&Pad::Connect(1)));
    expect_pad(&backend, &log2, &held(0, 0x40), pad(xusb::B), "second run");
    e2.shutdown();
    assert_eq!(log2.live(), 0);
}

// ---- Keep-alive: one-off frames must reach the driver -----------------------
// A real driver can lose a single update. While reports flow, the next report
// repairs it. When nothing follows (a stall, unreadable reports), the engine
// asks the driver backend to make sure its last state stands.

fn wait_keep_alives(log: &PadLog, more_than: usize) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while log.keep_alives() <= more_than {
        assert!(Instant::now() < deadline, "no keep-alive");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn the_last_frame_is_kept_alive_while_no_reports_arrive() {
    let (backend, _e, log) = passthrough_xbox();
    expect_pad(&backend, &log, &held(0, 0x20), pad(xusb::A), "Cross held");
    // The controller goes quiet: no new virtual reports, only keep-alives.
    let (reports, alive) = (log.all().len(), log.keep_alives());
    wait_keep_alives(&log, alive + 3);
    assert_eq!(log.all().len(), reports, "keep-alives are not new reports");
    assert_eq!(log.reports().last(), Some(&pad(xusb::A)));
}

#[test]
fn the_neutral_frame_after_a_stall_reload_is_kept_alive() {
    let (backend, e, log) = xbox_engine();
    stall_mid_macro(&backend, &e);
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    log.wait("neutral frame", |_| {
        last_report(&log, 1) == Some(XusbReport::default())
    });
    let alive = log.keep_alives();
    wait_keep_alives(&log, alive + 3);
    assert_eq!(last_report(&log, 1), Some(XusbReport::default()));
}

#[test]
fn the_fail_safe_neutral_frame_is_kept_alive_by_every_unreadable_report() {
    let (backend, e, log) = xbox_engine();
    holding_macro(&backend, &e, &log);
    push_unreadable(&backend, 8);
    wait_status(&e, "fail-safe", |s| s.devices[0].playing_macros.is_empty());
    let alive = log.keep_alives();
    push_unreadable(&backend, 20);
    wait_errors(&e, 28);
    assert!(
        log.keep_alives() >= alive + 20,
        "one keep-alive per unreadable report: {} -> {}",
        alive,
        log.keep_alives()
    );
    assert_eq!(last_report(&log, 1), Some(XusbReport::default()));
}

#[test]
fn no_keep_alive_while_output_is_off() {
    let (backend, e, log) = xbox_engine();
    e.set_output_mode(VirtualOutputKind::Disabled);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    backend.push_report(PATH, report(&[CROSS]));
    wait_status(&e, "report", |s| s.devices[0].input.is_some());
    let alive = log.keep_alives();
    std::thread::sleep(Duration::from_millis(60));
    assert_eq!(log.keep_alives(), alive);
}

// ---- Live Viewer: active shift layer ------------------------------------------

#[test]
fn the_active_shift_layer_is_published_for_hold_and_toggle_layers() {
    use nexus_input_processing::{LayerMode, MappingLayer, ProcessingConfig, RemapRule};
    let (backend, e) = connected_engine();
    let mut cfg = ProcessingConfig::passthrough();
    cfg.layers = vec![
        MappingLayer {
            name: "Hold L1".into(),
            activator: MacroButton::LeftShoulder,
            mode: LayerMode::Hold,
            remap: vec![RemapRule::new(MacroButton::West, Some(MacroButton::DpadUp))],
        },
        MappingLayer {
            name: "Toggle R1".into(),
            activator: MacroButton::RightShoulder,
            mode: LayerMode::Toggle,
            remap: vec![],
        },
    ];
    e.set_processing(cfg);
    let layer = |e: &Engine| e.status().devices[0].active_layer;
    backend.push_report(PATH, report(&[]));
    wait_status(&e, "no layer", |s| s.devices[0].total_reports >= 2);
    assert_eq!(layer(&e), None);
    backend.push_report(PATH, report(&[(1, 0x01)])); // L1 held
    wait_status(&e, "hold layer", |s| s.devices[0].active_layer == Some(0));
    backend.push_report(PATH, report(&[]));
    wait_status(&e, "released", |s| s.devices[0].active_layer.is_none());
    // Toggle: a single press switches it on and it stays on after release.
    backend.push_report(PATH, report(&[(1, 0x02)]));
    backend.push_report(PATH, report(&[]));
    wait_status(&e, "toggle on", |s| s.devices[0].active_layer == Some(1));
    std::thread::sleep(Duration::from_millis(30));
    assert_eq!(layer(&e), Some(1), "stays on");
    backend.push_report(PATH, report(&[(1, 0x02)]));
    backend.push_report(PATH, report(&[]));
    wait_status(&e, "toggle off", |s| s.devices[0].active_layer.is_none());
}

// ---- Calibration reaches the virtual Xbox controller ---------------------------

#[test]
fn stick_and_trigger_calibration_shape_what_the_virtual_pad_receives() {
    use nexus_input_processing::StickCalibration;
    let (backend, e, log) = xbox_engine();
    // A stick resting at raw (134, 128) ≈ +0.047 and a trigger resting at 6.
    let mut rest = Payload::neutral();
    rest.lx = 134;
    rest.l2 = 6;
    let mut cfg = ProcessingConfig::passthrough();
    e.set_processing(cfg.clone());
    backend.push_report(PATH, rest.usb_report());
    log.wait("uncalibrated", |_| {
        log.reports()
            .last()
            .is_some_and(|r| r.thumb_lx > 1000 && r.left_trigger == 6)
    });
    // Calibrated to that resting point (what the wizard applies): output centred.
    cfg.left_stick.calibration = StickCalibration {
        center_x: 6.0 / 127.0,
        center_y: 0.0,
        min_x: -1.0,
        max_x: 1.0,
        min_y: -1.0,
        max_y: 1.0,
    };
    cfg.left_trigger.raw_min = 6.0 / 255.0;
    cfg.left_trigger.raw_max = 220.0 / 255.0;
    e.set_processing(cfg.clone());
    expect_pad(
        &backend,
        &log,
        &rest,
        XusbReport::default(),
        "calibrated rest is neutral",
    );
    // Full travel still reaches full output, including a trigger that only reaches 220.
    let mut full = Payload::neutral();
    full.lx = 255;
    full.l2 = 220;
    let want = XusbReport {
        thumb_lx: 32767,
        left_trigger: 255,
        ..Default::default()
    };
    expect_pad(&backend, &log, &full, want, "full range");
    // Back to the profile without calibration (a profile switch).
    e.set_processing(ProcessingConfig::passthrough());
    backend.push_report(PATH, rest.usb_report());
    log.wait("uncalibrated again", |_| {
        log.reports()
            .last()
            .is_some_and(|r| r.thumb_lx > 1000 && r.left_trigger == 6)
    });
}

#[test]
fn output_check_compares_what_was_sent_with_what_xinput_reads() {
    use crate::output_check::{check_output, OutputCheck};
    use nexus_virtual_controller::xinput::XInputPad;
    let (backend, e, _log) = xbox_engine();
    // Cross held: the virtual controller is sent A.
    backend.push_report(PATH, report(&[CROSS]));
    let mut s = wait_status(&e, "processed", |s| {
        s.devices[0]
            .processed
            .as_ref()
            .is_some_and(|p| p.buttons.south)
    });
    assert_eq!(
        check_output(&s, |_| unreachable!()),
        OutputCheck::SlotUnknown,
        "slot not known yet"
    );
    s.devices[0].output.player_index = Some(0);
    let sent = XInputPad {
        buttons: xusb::A,
        ..Default::default()
    };
    // Windows reads the same: a match.
    match check_output(&s, |slot| {
        assert_eq!(slot, 0);
        Ok(Some(sent))
    }) {
        OutputCheck::Compared {
            differences,
            sent: got,
            ..
        } => {
            assert!(differences.is_empty());
            assert_eq!(got.buttons & xusb::A, xusb::A);
        }
        other => panic!("{other:?}"),
    }
    // Windows reads nothing pressed: the difference is named.
    match check_output(&s, |_| Ok(Some(XInputPad::default()))) {
        OutputCheck::Compared { differences, .. } => {
            assert_eq!(
                differences,
                vec!["A: sent pressed, Windows reads released".to_string()]
            );
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        check_output(&s, |_| Ok(None)),
        OutputCheck::Missing { slot: 0 }
    );
    assert_eq!(
        check_output(&s, |_| Err("no XInput".into())),
        OutputCheck::Unavailable {
            reason: "no XInput".into()
        }
    );
    s.devices[0].output.active = None;
    assert_eq!(
        check_output(&s, |_| unreachable!()),
        OutputCheck::NotXbox { active: None }
    );
    s.devices.clear();
    assert_eq!(
        check_output(&s, |_| unreachable!()),
        OutputCheck::NoController
    );
}

#[test]
fn a_button_combination_reaches_the_virtual_controller() {
    use nexus_controller_core::Button;
    use nexus_input_processing::{ComboRule, ProcessingConfig};
    let (backend, e, log) = xbox_engine();
    e.set_processing(ProcessingConfig {
        combos: vec![ComboRule {
            buttons: vec![Button::LeftShoulder, Button::RightShoulder],
            sends: vec![Button::North],
            hide_inputs: true,
        }],
        ..Default::default()
    });
    // L1 + R1 held together → the game sees Y, not LB/RB.
    backend.push_report(PATH, report(&[(1, 0x01 | 0x02)]));
    log.wait("Y from the combination", |p| {
        p.iter().any(|x| {
            matches!(x, Pad::Report(_, r) if r.buttons & xusb::Y != 0
            && r.buttons & (xusb::LEFT_SHOULDER | xusb::RIGHT_SHOULDER) == 0)
        })
    });
    // Released: Y goes away.
    backend.push_report(PATH, report(&[]));
    log.wait(
        "released",
        |p| matches!(p.last(), Some(Pad::Report(_, r)) if r.buttons == 0),
    );
}

// ---- Slow and hung virtual controller driver calls (simulated) -------------

fn stalling_xbox() -> (MockHidBackend, Engine, PadLog, Arc<AtomicU64>) {
    let stall = Arc::new(AtomicU64::new(0));
    let installed = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let (backend, e, log) = xbox_engine_stalling(installed, stall.clone());
    log.wait("virtual controller", |p| p.contains(&Pad::Connect(1)));
    e.set_processing(ProcessingConfig::passthrough());
    (backend, e, log, stall)
}

#[test]
fn a_slow_driver_call_delays_reports_but_none_is_lost_and_each_is_counted() {
    let (backend, e, log, stall) = stalling_xbox();
    expect_pad(&backend, &log, &held(0, 0), pad(0), "settled");
    let before = log.reports().len();
    stall.store(60, Ordering::SeqCst);
    // Reports keep arriving while the driver call is stuck; the HID driver
    // queues them (on Windows: up to 32, about 128 ms at 250 Hz).
    for p in [held(0, 0x20), held(0, 0x40), held(0, 0x20 | 0x40), held(0, 0)] {
        backend.push_report(PATH, p.usb_report());
        std::thread::sleep(Duration::from_millis(4));
    }
    log.wait("all four after the stall", |_| log.reports().len() >= before + 4);
    stall.store(0, Ordering::SeqCst);
    let sent: Vec<u16> = log.reports()[before..before + 4]
        .iter()
        .map(|r| r.buttons)
        .collect();
    assert_eq!(
        sent,
        [xusb::A, xusb::B, xusb::A | xusb::B, 0],
        "every report reaches the game, in order, after the stall"
    );
    // Counted for the whole connection, not only the last 256 calls.
    pump(&backend, PATH, 70);
    let s = wait_status(&e, "slow calls", |s| {
        s.devices[0].stage_latency.slow_output.over_50ms >= 4
    });
    let slow = s.devices[0].stage_latency.slow_output;
    assert!(slow.over_4ms >= slow.over_50ms);
    assert!(slow.longest_ns >= 60_000_000, "{slow:?}");
    assert!(slow.calls >= 64, "{slow:?}");
}

#[test]
fn a_hung_driver_call_does_not_keep_nexus_from_exiting() {
    let (backend, e, log, stall) = stalling_xbox();
    expect_pad(&backend, &log, &held(0, 0x20), pad(xusb::A), "A held");
    stall.store(u64::MAX, Ordering::SeqCst);
    backend.push_report(PATH, held(0, 0x20).usb_report());
    std::thread::sleep(Duration::from_millis(30)); // the reader is now inside the call

    let t = Instant::now();
    assert!(!e.shutdown_within(Duration::from_millis(150)));
    assert!(t.elapsed() < Duration::from_secs(1), "{:?}", t.elapsed());
    assert!(e
        .recent_log(5)
        .iter()
        .any(|l| l.message.contains("not released within 150 ms")));

    // If the call does return after all, the controller is still released
    // properly: a neutral frame, then the virtual controller is removed.
    stall.store(0, Ordering::SeqCst);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)]
    );
    e.shutdown(); // already given up on: returns at once
}

#[test]
fn exit_releases_held_buttons_and_running_macros_before_removing_the_pad() {
    let (backend, e, log) = xbox_engine();
    e.set_macros(vec![rapid_macro()]);
    pump(&backend, PATH, 3);
    // R3 starts the repeating macro; Square is held at the same time.
    for _ in 0..20 {
        backend.push_report(PATH, report(&[(0, 0x10), R3]));
        std::thread::sleep(Duration::from_millis(4));
    }
    wait_status(&e, "macro playing", |s| !s.devices[0].playing_macros.is_empty());
    let t = Instant::now();
    assert!(e.shutdown_within(Duration::from_secs(2)));
    assert!(t.elapsed() < Duration::from_secs(1));
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)],
        "nothing stays pressed in the game"
    );
    assert_eq!(log.live(), 0);
}
