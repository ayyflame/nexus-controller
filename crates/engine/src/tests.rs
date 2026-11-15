//! End-to-end engine tests using the mock HID backend and **synthetic**
//! DualSense reports (see `nexus_dualsense::synthetic`).

use super::*;
use nexus_controller_core::{DeviceOrigin, HidDeviceInfo, ReportFormat};
use nexus_device_manager::mock::MockHidBackend;
use nexus_device_manager::UnsupportedBackend;
use nexus_dualsense::synthetic::Payload;
use nexus_dualsense::{PRODUCT_ID_DUALSENSE, VENDOR_ID_SONY};

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
        "no virtual output in this build"
    );
    assert!(s
        .macros
        .blocked_reason
        .as_deref()
        .unwrap()
        .contains("virtual controller output isn't enabled"));
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
    cfg.remap = vec![nexus_input_processing::RemapRule {
        from: MacroButton::South,
        to: Some(MacroButton::East),
    }];
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
    cfg.remap = vec![nexus_input_processing::RemapRule {
        from: MacroButton::RightStick,
        to: None,
    }];
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
