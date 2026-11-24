//! DualShock 4 through the whole engine, with the mock HID backend, the
//! recording virtual Xbox pad and **synthetic** DualShock 4 USB reports
//! (`nexus_dualshock4::synthetic`). Nothing here was run on a real controller.

use super::*;
use nexus_dualshock4::synthetic::{button, Report as Ds4};
use nexus_dualshock4::{PRODUCT_ID_DUALSHOCK4_V1, PRODUCT_ID_DUALSHOCK4_V2};
use nexus_input_processing::{StickButtons, StickSource};

const DS4_PATH: &str =
    r"\\?\hid#vid_054c&pid_09cc&mi_03#ds4#{4d1e55b2-f16f-11cf-88cb-001111000030}";

fn ds4_info(path: &str, pid: u16, serial: &str) -> HidDeviceInfo {
    HidDeviceInfo {
        path: path.into(),
        vendor_id: VENDOR_ID_SONY,
        product_id: pid,
        usage_page: 1,
        usage: 5,
        input_report_len: 64,
        output_report_len: 32,
        product: Some("Wireless Controller".into()),
        serial_number: Some(serial.into()),
        ancestor_instance_ids: vec![
            format!(r"USB\VID_054C&PID_{pid:04X}&MI_03\{serial}"),
            format!(r"USB\VID_054C&PID_{pid:04X}\{serial}-parent"),
            r"PCI\VEN_8086\z".into(),
        ],
        ..Default::default()
    }
}

/// Engine with both PlayStation drivers (as the app starts it) and the
/// recording Xbox 360 pad, with `devices` plugged in.
fn ds4_xbox_engine(devices: &[HidDeviceInfo]) -> (MockHidBackend, Engine, PadLog) {
    let backend = MockHidBackend::new();
    for d in devices {
        backend.plug(d.clone());
    }
    let log = PadLog::default();
    let factory_log = log.clone();
    let e = Engine::start(
        Arc::new(backend.clone()),
        supported_drivers(),
        Arc::new(move || {
            Box::new(RecordingPad {
                log: factory_log.clone(),
                next: 0,
                installed: Arc::new(std::sync::atomic::AtomicBool::new(true)),
                stall_ms: Default::default(),
                fail: Default::default(),
            })
        }),
        EngineConfig {
            initial_output: VirtualOutputKind::Xbox360,
            ..config()
        },
    );
    wait_status(&e, "connect", |s| s.devices.len() == devices.len());
    (backend, e, log)
}

fn one_ds4() -> (MockHidBackend, Engine, PadLog) {
    let r = ds4_xbox_engine(&[ds4_info(DS4_PATH, PRODUCT_ID_DUALSHOCK4_V2, "ds4-a")]);
    r.2.wait("virtual controller", |p| p.contains(&Pad::Connect(1)));
    r
}

/// Sends one DualShock 4 report and waits until the virtual pad shows `want`.
fn expect_ds4(backend: &MockHidBackend, log: &PadLog, r: &Ds4, want: XusbReport, what: &str) {
    backend.push_report(DS4_PATH, r.usb_report());
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

fn pressed(n: u8) -> Ds4 {
    Ds4::neutral().press(n)
}

fn hat(h: u8) -> Ds4 {
    let mut r = Ds4::neutral();
    r.hat = h;
    r
}

#[test]
fn both_hardware_revisions_connect_as_dualshock4_with_live_input() {
    for pid in [PRODUCT_ID_DUALSHOCK4_V1, PRODUCT_ID_DUALSHOCK4_V2] {
        let path = format!(
            r"\\?\hid#vid_054c&pid_{pid:04x}&mi_03#x#{{4d1e55b2-f16f-11cf-88cb-001111000030}}"
        );
        let backend = MockHidBackend::new();
        backend.plug(ds4_info(&path, pid, "s"));
        let e = Engine::start(
            Arc::new(backend.clone()),
            supported_drivers(),
            Arc::new(|| Box::new(UnavailableBackend)),
            config(),
        );
        let s = wait_status(&e, "connect", |s| s.devices.len() == 1);
        let d = &s.devices[0].device;
        assert_eq!(d.model, ControllerModel::DualShock4);
        assert_eq!(d.connection, ConnectionType::Usb);
        assert_eq!((d.vendor_id, d.product_id), (VENDOR_ID_SONY, pid));
        assert!(
            s.devices[0].input.is_none(),
            "nothing shown before real input"
        );
        let mut r = Ds4::neutral().press(button::CROSS);
        r.l2 = 200;
        backend.push_report(&path, r.usb_report());
        let s = wait_status(&e, "input", |s| s.devices[0].input.is_some());
        let input = s.devices[0].input.unwrap();
        assert_eq!(input.format, ReportFormat::DualShock4Usb);
        assert!(input.buttons.south);
        assert_eq!(input.left_trigger.raw, 200);
        assert_eq!(input.touchpad.unwrap().height, 942);
        // The scan diagnostics name the model too.
        let scan = e.hid_diagnostics();
        assert_eq!(scan[0].identified_model, Some(ControllerModel::DualShock4));
    }
}

#[test]
fn every_dualshock4_button_reaches_the_virtual_pad_as_its_xbox_button() {
    let (backend, e, log) = one_ds4();
    e.set_processing(ProcessingConfig::passthrough());
    let cases: [(&str, Ds4, u16); 20] = [
        ("Cross", pressed(button::CROSS), xusb::A),
        ("Circle", pressed(button::CIRCLE), xusb::B),
        ("Square", pressed(button::SQUARE), xusb::X),
        ("Triangle", pressed(button::TRIANGLE), xusb::Y),
        ("L1", pressed(button::L1), xusb::LEFT_SHOULDER),
        ("R1", pressed(button::R1), xusb::RIGHT_SHOULDER),
        ("Share", pressed(button::SHARE), xusb::BACK),
        ("Options", pressed(button::OPTIONS), xusb::START),
        ("L3", pressed(button::L3), xusb::LEFT_THUMB),
        ("R3", pressed(button::R3), xusb::RIGHT_THUMB),
        ("PS", pressed(button::PS), xusb::GUIDE),
        ("D-pad up", hat(0), xusb::DPAD_UP),
        ("D-pad up-right", hat(1), xusb::DPAD_UP | xusb::DPAD_RIGHT),
        ("D-pad right", hat(2), xusb::DPAD_RIGHT),
        (
            "D-pad down-right",
            hat(3),
            xusb::DPAD_DOWN | xusb::DPAD_RIGHT,
        ),
        ("D-pad down", hat(4), xusb::DPAD_DOWN),
        ("D-pad down-left", hat(5), xusb::DPAD_DOWN | xusb::DPAD_LEFT),
        ("D-pad left", hat(6), xusb::DPAD_LEFT),
        ("D-pad up-left", hat(7), xusb::DPAD_UP | xusb::DPAD_LEFT),
        // No Xbox 360 equivalent: nothing unless remapped.
        ("Touchpad click", pressed(button::TOUCHPAD), 0),
    ];
    for (name, r, bits) in cases {
        expect_ds4(&backend, &log, &r, pad(bits), name);
        expect_ds4(&backend, &log, &Ds4::neutral(), pad(0), "release");
    }
    let combo = Ds4::neutral()
        .press(button::CROSS)
        .press(button::TRIANGLE)
        .press(button::L1)
        .press(button::R3);
    expect_ds4(
        &backend,
        &log,
        &combo,
        pad(xusb::A | xusb::Y | xusb::LEFT_SHOULDER | xusb::RIGHT_THUMB),
        "four buttons",
    );
}

#[test]
fn dualshock4_sticks_and_triggers_reach_the_virtual_pad_with_full_range() {
    let (backend, e, log) = one_ds4();
    e.set_processing(ProcessingConfig::passthrough());
    // Each axis alone, to its full XInput range (y up), as for a DualSense.
    type Set = fn(&mut Ds4);
    type Get = fn(&XusbReport) -> i32;
    let axes: [(&str, Set, Get, i32); 8] = [
        (
            "left full left",
            |r| r.lx = 0,
            |x| x.thumb_lx as i32,
            -32767,
        ),
        (
            "left full right",
            |r| r.lx = 255,
            |x| x.thumb_lx as i32,
            32767,
        ),
        ("left full up", |r| r.ly = 0, |x| x.thumb_ly as i32, 32767),
        (
            "left full down",
            |r| r.ly = 255,
            |x| x.thumb_ly as i32,
            -32767,
        ),
        (
            "right full left",
            |r| r.rx = 0,
            |x| x.thumb_rx as i32,
            -32767,
        ),
        (
            "right full right",
            |r| r.rx = 255,
            |x| x.thumb_rx as i32,
            32767,
        ),
        ("right full up", |r| r.ry = 0, |x| x.thumb_ry as i32, 32767),
        (
            "right full down",
            |r| r.ry = 255,
            |x| x.thumb_ry as i32,
            -32767,
        ),
    ];
    for (name, set, get, want) in axes {
        let mut r = Ds4::neutral();
        set(&mut r);
        backend.push_report(DS4_PATH, r.usb_report());
        log.wait(
            name,
            |p| matches!(p.last(), Some(Pad::Report(_, x)) if (get(x) - want).abs() <= 1),
        );
        expect_ds4(
            &backend,
            &log,
            &Ds4::neutral(),
            XusbReport::default(),
            "centred",
        );
    }
    let mut r = Ds4::neutral();
    (r.l2, r.r2) = (255, 255);
    expect_ds4(
        &backend,
        &log,
        &r,
        XusbReport {
            left_trigger: 255,
            right_trigger: 255,
            ..Default::default()
        },
        "both triggers fully pressed",
    );
    // Rest values: centred sticks and released triggers are exactly neutral.
    expect_ds4(
        &backend,
        &log,
        &Ds4::neutral(),
        XusbReport::default(),
        "rest",
    );
    let mut half = Ds4::neutral();
    half.r2 = 128;
    expect_ds4(
        &backend,
        &log,
        &half,
        XusbReport {
            right_trigger: 128,
            ..Default::default()
        },
        "R2 half travel",
    );
}

#[test]
fn remapping_stick_routing_and_trigger_tuning_work_on_a_dualshock4() {
    let (backend, e, log) = one_ds4();
    let mut cfg = ProcessingConfig::passthrough();
    cfg.remap = vec![
        RemapRule::new(MacroButton::South, Some(MacroButton::East)), // Cross → B
        RemapRule::new(MacroButton::Touchpad, Some(MacroButton::Select)), // touchpad → Back
        RemapRule::new(MacroButton::LeftTrigger, Some(MacroButton::RightTrigger)),
    ];
    e.set_processing(cfg);
    expect_ds4(
        &backend,
        &log,
        &pressed(button::CROSS),
        pad(xusb::B),
        "Cross sends B",
    );
    expect_ds4(
        &backend,
        &log,
        &pressed(button::TOUCHPAD),
        pad(xusb::BACK),
        "touchpad → Back",
    );
    let mut l2 = Ds4::neutral();
    l2.l2 = 90;
    expect_ds4(
        &backend,
        &log,
        &l2,
        XusbReport {
            right_trigger: 90,
            ..Default::default()
        },
        "L2 travel arrives on RT",
    );

    // Stick swap and stick-to-d-pad, as for a DualSense.
    let mut c = ProcessingConfig::passthrough();
    c.stick_routing.left_output = StickSource::Right;
    c.stick_routing.right_output = StickSource::Off;
    c.left_stick.buttons = StickButtons {
        enabled: true,
        up: Some(nexus_controller_core::Button::DpadUp),
        down: Some(nexus_controller_core::Button::DpadDown),
        left: Some(nexus_controller_core::Button::DpadLeft),
        right: Some(nexus_controller_core::Button::DpadRight),
        ..StickButtons::default()
    };
    e.set_processing(c);
    let mut r = Ds4::neutral();
    r.ly = 0;
    r.rx = 255;
    backend.push_report(DS4_PATH, r.usb_report());
    log.wait("d-pad up and the game's left stick right", |pads| {
        pads.iter().any(|x| {
            matches!(x, Pad::Report(_, r) if r.buttons == xusb::DPAD_UP
                && r.thumb_lx == i16::MAX && r.thumb_ly == 0 && r.thumb_rx == 0)
        })
    });

    // Trigger tuning: a deadzone on L2 ignores the first part of the travel.
    let mut c = ProcessingConfig::passthrough();
    c.left_trigger.deadzone = 0.5;
    e.set_processing(c);
    let mut light = Ds4::neutral();
    light.l2 = 100; // under half
    expect_ds4(
        &backend,
        &log,
        &light,
        XusbReport::default(),
        "inside the L2 deadzone",
    );
    let mut full = Ds4::neutral();
    full.l2 = 255;
    expect_ds4(
        &backend,
        &log,
        &full,
        XusbReport {
            left_trigger: 255,
            ..Default::default()
        },
        "L2 fully pressed",
    );
}

#[test]
fn combinations_and_shift_layers_work_on_a_dualshock4() {
    use nexus_controller_core::Button;
    use nexus_input_processing::ComboRule;
    let (backend, e, log) = one_ds4();
    e.set_processing(ProcessingConfig {
        combos: vec![ComboRule {
            buttons: vec![Button::LeftShoulder, Button::RightShoulder],
            sends: vec![Button::North],
            hide_inputs: true,
        }],
        ..Default::default()
    });
    backend.push_report(
        DS4_PATH,
        Ds4::neutral()
            .press(button::L1)
            .press(button::R1)
            .usb_report(),
    );
    log.wait("Y from the combination", |p| {
        p.iter().any(|x| {
            matches!(x, Pad::Report(_, r) if r.buttons & xusb::Y != 0
                && r.buttons & (xusb::LEFT_SHOULDER | xusb::RIGHT_SHOULDER) == 0)
        })
    });
    expect_ds4(&backend, &log, &Ds4::neutral(), pad(0), "released");
}

#[test]
fn macros_including_hold_to_activate_run_from_dualshock4_buttons() {
    let (backend, e, log) = one_ds4();
    // Tap macro on R3 (holds A for 2 s, playing while held).
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    backend.push_report(DS4_PATH, Ds4::neutral().usb_report());
    backend.push_report(DS4_PATH, pressed(button::R3).usb_report());
    log.wait("macro presses A", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if A_PRESSED(r)))
    });
    let s = wait_status(&e, "macro playing", |s| {
        !s.devices[0].playing_macros.is_empty()
    });
    assert_eq!(s.devices[0].playing_macros, vec!["jump".to_string()]);
    // The trigger is blocked from the game while the macro owns it.
    assert!(!log.reports().iter().any(|r| has(r, xusb::RIGHT_THUMB)));
    backend.push_report(DS4_PATH, Ds4::neutral().usb_report());
    wait_status(&e, "macro stopped", |s| {
        s.devices[0].playing_macros.is_empty()
    });

    // Hold-to-activate: a short tap does nothing; holding past the time does.
    let mut hold = macro_on(
        "hold",
        MacroButton::West,
        MacroButton::North,
        PlaybackMode::Once,
    );
    hold.activation_ms = 150;
    e.set_macros(vec![hold]);
    let before = count_with(&log, xusb::Y);
    for _ in 0..5 {
        backend.push_report(DS4_PATH, pressed(button::SQUARE).usb_report());
        std::thread::sleep(Duration::from_millis(4));
    }
    backend.push_report(DS4_PATH, Ds4::neutral().usb_report());
    std::thread::sleep(Duration::from_millis(60));
    assert_eq!(
        count_with(&log, xusb::Y),
        before,
        "a 20 ms tap is not a hold"
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    while count_with(&log, xusb::Y) == before {
        assert!(
            Instant::now() < deadline,
            "held Square never activated the macro"
        );
        backend.push_report(DS4_PATH, pressed(button::SQUARE).usb_report());
        std::thread::sleep(Duration::from_millis(4));
    }
    pump_ds4(&backend, &Ds4::neutral(), 5);
}

fn pump_ds4(backend: &MockHidBackend, r: &Ds4, n: usize) {
    for _ in 0..n {
        backend.push_report(DS4_PATH, r.usb_report());
        std::thread::sleep(Duration::from_millis(4));
    }
}

#[test]
fn switching_profiles_changes_what_a_dualshock4_sends() {
    let (backend, e, log) = one_ds4();
    let mut a = ProcessingConfig::passthrough();
    a.remap = vec![RemapRule::new(MacroButton::South, Some(MacroButton::North))];
    e.switch_processing(a);
    expect_ds4(
        &backend,
        &log,
        &pressed(button::CROSS),
        pad(xusb::Y),
        "profile A: Cross → Y",
    );
    let mut b = ProcessingConfig::passthrough();
    b.remap = vec![RemapRule::new(MacroButton::South, Some(MacroButton::West))];
    e.switch_processing(b);
    expect_ds4(
        &backend,
        &log,
        &pressed(button::CROSS),
        pad(xusb::X),
        "profile B: Cross → X",
    );
    e.switch_processing(ProcessingConfig::passthrough());
    expect_ds4(
        &backend,
        &log,
        &pressed(button::CROSS),
        pad(xusb::A),
        "back to default",
    );
    expect_ds4(&backend, &log, &Ds4::neutral(), pad(0), "release");
}

#[test]
fn unplugging_a_dualshock4_mid_press_sends_neutral_and_reconnect_starts_clean() {
    let (backend, e, log) = one_ds4();
    e.set_macros(vec![jump_macro(PlaybackMode::RepeatWhileHeld)]);
    backend.push_report(DS4_PATH, Ds4::neutral().usb_report());
    let mut held = pressed(button::R3).press(button::L1);
    held.lx = 0;
    backend.push_report(DS4_PATH, held.usb_report());
    log.wait("macro holds A", |p| {
        p.iter()
            .any(|x| matches!(x, Pad::Report(_, r) if A_PRESSED(r)))
    });
    backend.unplug(DS4_PATH);
    log.wait("removed", |p| p.contains(&Pad::Disconnect(1)));
    let all = log.all();
    let n = all.len();
    assert_eq!(
        all[n - 2..],
        [Pad::Report(1, XusbReport::default()), Pad::Disconnect(1)],
        "neutral, then the virtual controller is removed"
    );
    wait_status(&e, "disconnected", |s| s.devices.is_empty());

    // Plugged back in: a fresh virtual controller that starts neutral, no
    // macro running, and the old held buttons don't come back.
    backend.plug(ds4_info(DS4_PATH, PRODUCT_ID_DUALSHOCK4_V2, "ds4-a"));
    let s = wait_status(&e, "reconnected", |s| s.devices.len() == 1);
    assert_eq!(s.devices[0].device.model, ControllerModel::DualShock4);
    assert!(s.devices[0].input.is_none(), "no state carried over");
    // Each session gets its own virtual controller.
    log.wait("second virtual controller", |p| {
        connects(p) == 2 && log.live() == 1
    });
    let from = log.all().len();
    backend.push_report(DS4_PATH, Ds4::neutral().usb_report());
    log.wait(
        "neutral on the new pad",
        |p| matches!(p.last(), Some(Pad::Report(_, r)) if *r == XusbReport::default()),
    );
    assert!(
        log.reports()[log.reports().len() - (log.all().len() - from)..]
            .iter()
            .all(|r| *r == XusbReport::default()),
        "nothing held from before the unplug"
    );
    assert!(s.devices[0].playing_macros.is_empty());
}

#[test]
fn a_dualshock4_and_a_dualsense_together_keep_their_own_identity_and_state() {
    let ds4 = ds4_info(DS4_PATH, PRODUCT_ID_DUALSHOCK4_V1, "ds4-a");
    let mut ds = usb_info();
    ds.serial_number = Some("ds-b".into());
    let (backend, e, _log) = ds4_xbox_engine(&[ds4, ds]);
    let s = e.status();
    let model_of = |s: &EngineStatus, path: &str| {
        s.devices
            .iter()
            .find(|d| d.device.id.0 == path)
            .map(|d| d.device.model)
    };
    assert_eq!(model_of(&s, DS4_PATH), Some(ControllerModel::DualShock4));
    assert_eq!(model_of(&s, PATH), Some(ControllerModel::DualSense));

    // Each controller's reports are parsed with its own layout and never
    // show up on the other one.
    let mut r = Ds4::neutral().press(button::CROSS);
    r.l2 = 222;
    backend.push_report(DS4_PATH, r.usb_report());
    backend.push_report(PATH, report(&[(0, 0x80)])); // Triangle on the DualSense
    let s = wait_status(&e, "both live", |s| {
        s.devices.iter().all(|d| d.input.is_some())
    });
    let input = |path: &str| {
        s.devices
            .iter()
            .find(|d| d.device.id.0 == path)
            .and_then(|d| d.input)
            .unwrap()
    };
    let (a, b) = (input(DS4_PATH), input(PATH));
    assert!(a.buttons.south && !a.buttons.north && a.left_trigger.raw == 222);
    assert_eq!(a.format, ReportFormat::DualShock4Usb);
    assert!(b.buttons.north && !b.buttons.south && b.left_trigger.raw == 0);
    assert_eq!(b.format, ReportFormat::DualSenseUsb);

    // Unplugging one leaves the other connected and untouched.
    backend.unplug(DS4_PATH);
    let s = wait_status(&e, "one left", |s| s.devices.len() == 1);
    assert_eq!(s.devices[0].device.model, ControllerModel::DualSense);
    assert!(s.devices[0].input.unwrap().buttons.north);
}

#[test]
fn two_dualshock4s_are_two_controllers_and_never_swap_state() {
    let p2 = r"\\?\hid#vid_054c&pid_05c4&mi_03#second#{4d1e55b2-f16f-11cf-88cb-001111000030}";
    let (backend, e, _log) = ds4_xbox_engine(&[
        ds4_info(DS4_PATH, PRODUCT_ID_DUALSHOCK4_V2, "ds4-a"),
        ds4_info(p2, PRODUCT_ID_DUALSHOCK4_V1, "ds4-b"),
    ]);
    backend.push_report(DS4_PATH, pressed(button::CIRCLE).usb_report());
    backend.push_report(p2, pressed(button::SQUARE).usb_report());
    let s = wait_status(&e, "both live", |s| {
        s.devices.iter().all(|d| d.input.is_some())
    });
    for d in &s.devices {
        let i = d.input.unwrap();
        if d.device.id.0 == DS4_PATH {
            assert!(i.buttons.east && !i.buttons.west);
        } else {
            assert!(i.buttons.west && !i.buttons.east);
        }
    }
}

#[test]
fn a_virtual_dualshock4_from_vigembus_is_never_read() {
    let backend = MockHidBackend::new();
    let mut v = ds4_info(
        r"\\?\hid#vid_054c&pid_05c4#vigem#{4d1e55b2-f16f-11cf-88cb-001111000030}",
        PRODUCT_ID_DUALSHOCK4_V1,
        "v",
    );
    v.ancestor_instance_ids = vec![
        r"USB\VID_054C&PID_05C4\1&2D595CA7&0&01".into(),
        r"ROOT\SYSTEM\0001".into(),
    ];
    backend.plug(v);
    let e = Engine::start(
        Arc::new(backend.clone()),
        supported_drivers(),
        Arc::new(|| Box::new(UnavailableBackend)),
        config(),
    );
    std::thread::sleep(Duration::from_millis(80));
    assert!(e.status().devices.is_empty());
    let scan = e.hid_diagnostics();
    assert_eq!(scan[0].origin, Some(DeviceOrigin::Virtual));
}

#[test]
fn light_bar_and_vibration_use_the_dualshock4_output_report() {
    let (backend, e, _log) = one_ds4();
    pump_ds4(&backend, &Ds4::neutral(), 10);
    assert!(
        backend.writes(DS4_PATH).is_empty(),
        "nothing sent unless enabled"
    );

    let mut cfg = e.processing();
    cfg.feedback.lightbar_enabled = true;
    cfg.feedback.color = [10, 20, 30];
    cfg.feedback.player_leds_enabled = true; // no player LEDs on a DualShock 4
    e.set_processing(cfg.clone());
    pump_ds4(&backend, &Ds4::neutral(), 5);
    let w = wait_writes(&backend, DS4_PATH, 1);
    assert_eq!(
        (w[0][0], w[0].len()),
        (0x05, 32),
        "DualShock 4 USB output report"
    );
    assert_eq!(w[0][1], 0x02, "light bar only");
    assert_eq!(&w[0][6..9], &[10, 20, 30]);

    cfg.feedback.rumble_intensity = 1.0;
    e.set_processing(cfg);
    e.test_vibration(0.5, 40).unwrap();
    pump_ds4(&backend, &Ds4::neutral(), 3);
    let w = wait_writes(&backend, DS4_PATH, 2);
    assert_eq!(w[1][1] & 0x01, 0x01, "motors");
    assert_eq!((w[1][4], w[1][5]), (128, 128));
    std::thread::sleep(Duration::from_millis(60));
    pump_ds4(&backend, &Ds4::neutral(), 3);
    let w = wait_writes(&backend, DS4_PATH, 3);
    assert_eq!((w[2][4], w[2][5]), (0, 0), "vibration always stops");
    assert!(w.iter().all(|r| r[0] == 0x05), "never a DualSense report");
}

#[test]
fn bad_dualshock4_reports_are_counted_and_never_replace_good_input() {
    let (backend, e, _log) = one_ds4();
    backend.push_report(DS4_PATH, pressed(button::TRIANGLE).usb_report());
    wait_status(&e, "input", |s| s.devices[0].input.is_some());
    let mut bt = Ds4::neutral().usb_report();
    bt[0] = 0x11; // Bluetooth report ID
    let mut bad_touch = Ds4::neutral();
    bad_touch.touch_count = 9;
    backend.push_report(DS4_PATH, bt);
    backend.push_report(DS4_PATH, Ds4::neutral().usb_report()[..40].to_vec());
    backend.push_report(DS4_PATH, bad_touch.usb_report());
    let s = wait_status(&e, "errors", |s| s.devices[0].parse_errors >= 3);
    assert!(
        s.devices[0].input.unwrap().buttons.north,
        "last good input kept"
    );
    assert!(s.devices[0]
        .last_parse_error
        .as_deref()
        .unwrap()
        .contains("touch"));
}

#[test]
fn dualshock4_reports_feed_drop_estimates_and_report_rate() {
    let (backend, e, _log) = one_ds4();
    for c in [10u8, 11, 12, 14, 15] {
        let mut r = Ds4::neutral();
        r.counter = c;
        backend.push_report(DS4_PATH, r.usb_report());
        std::thread::sleep(Duration::from_millis(4));
    }
    let s = wait_status(&e, "gap", |s| s.devices[0].sequence_gaps == 1);
    assert_eq!(s.devices[0].total_reports, 5);
}

#[test]
fn the_report_inspector_names_dualshock4_bytes() {
    let base: Vec<Vec<u8>> = (0..20).map(|_| Ds4::neutral().usb_report()).collect();
    let share: Vec<Vec<u8>> = (0..20)
        .map(|_| pressed(button::SHARE).usb_report())
        .collect();
    let layout = crate::inspector::layout_for(PRODUCT_ID_DUALSHOCK4_V2);
    let a = crate::inspector::analyse_with(&layout, &base, &share);
    assert_eq!(
        a.verdict,
        Verdict::DecodedButtons {
            buttons: vec!["Share"]
        }
    );
    // The same bytes read with the DualSense table would be misnamed.
    let wrong = analyse(&base, &share);
    assert_ne!(wrong.verdict, a.verdict);
    // Counter bits count up by themselves; the baseline marks them as noise.
    let counting: Vec<Vec<u8>> = (0..20u8)
        .map(|i| {
            let mut r = Ds4::neutral();
            r.counter = i;
            r.usb_report()
        })
        .collect();
    let a = crate::inspector::analyse_with(&layout, &counting, &counting);
    assert_eq!(a.verdict, Verdict::NoChange);
}

#[test]
fn a_profile_switch_with_macros_applies_to_a_dualshock4() {
    use nexus_macro_engine::{Macro, MacroStep, PlaybackMode};
    let (backend, e, log) = one_ds4();
    let mut a = ProcessingConfig::passthrough();
    a.remap = vec![RemapRule::new(MacroButton::South, Some(MacroButton::North))];
    // Profile A: Cross → Y, and Options starts a macro that holds Square.
    let hold_square = Macro {
        id: "sq".into(),
        name: "Square".into(),
        description: String::new(),
        enabled: true,
        steps: vec![MacroStep {
            id: "s".into(),
            buttons: vec![MacroButton::West],
            hold_ms: 3000,
            delay_after_ms: 0,
        }],
        trigger: Some(MacroButton::Start),
        mode: PlaybackMode::Once,
        repeat_delay_ms: 0,
        block_trigger: true,
        activation_ms: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    };
    e.switch_profile(a, vec![hold_square]);
    expect_ds4(
        &backend,
        &log,
        &pressed(button::CROSS),
        pad(xusb::Y),
        "profile A: Cross → Y",
    );
    expect_ds4(&backend, &log, &Ds4::neutral(), pad(0), "release");
    expect_ds4(
        &backend,
        &log,
        &pressed(button::OPTIONS),
        pad(xusb::X),
        "profile A: Options starts the Square macro",
    );
    // Profile B (plain, no macros): the macro stops at once and Cross is A again.
    e.switch_profile(ProcessingConfig::passthrough(), vec![]);
    expect_ds4(
        &backend,
        &log,
        &Ds4::neutral(),
        pad(0),
        "the macro stopped with the switch",
    );
    expect_ds4(
        &backend,
        &log,
        &pressed(button::CROSS),
        pad(xusb::A),
        "profile B: Cross → A",
    );
    expect_ds4(&backend, &log, &Ds4::neutral(), pad(0), "release");
}
