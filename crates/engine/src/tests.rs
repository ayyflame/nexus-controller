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
