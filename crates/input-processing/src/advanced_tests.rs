#![allow(clippy::field_reassign_with_default)]
//! Milestone 3 processing: calibration, per-axis sensitivity, square output,
//! trigger activation/curve, gyro, touchpad and mapping layers.
//! All inputs are synthetic; hardware behaviour is verified separately.

use crate::*;
use nexus_controller_core::{
    Button, ControllerState, MotionState, StickState, TouchPoint, TouchpadState, TriggerState,
};
use std::time::{Duration, Instant};

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-3
}

fn stick(x: f32, y: f32) -> StickState {
    StickState {
        x,
        y,
        raw_x: 0,
        raw_y: 0,
    }
}

fn step(p: &mut ConfiguredProcessor, physical: &ControllerState, now: Instant) -> ControllerState {
    let mut s = *physical;
    p.process_at(&mut s, physical, now);
    s
}

fn at(t0: Instant, ms: u64) -> Instant {
    t0 + Duration::from_millis(ms)
}

// ---- Sticks ---------------------------------------------------------------

#[test]
fn independent_axis_sensitivity() {
    let c = StickConfig {
        deadzone: 0.0,
        circular: false,
        sensitivity_x: 0.5,
        sensitivity_y: 2.0,
        ..StickConfig::default()
    };
    let mut s = stick(0.4, 0.3);
    process_stick(&c, &mut s);
    assert!(close(s.x, 0.2) && close(s.y, 0.6), "{} {}", s.x, s.y);
}

#[test]
fn square_output_reaches_corners() {
    let c = StickConfig {
        deadzone: 0.0,
        square_output: true,
        ..StickConfig::default()
    };
    let d = std::f32::consts::FRAC_1_SQRT_2;
    let mut s = stick(d, d); // full deflection on the diagonal of a circle
    process_stick(&c, &mut s);
    assert!(close(s.x, 1.0) && close(s.y, 1.0));
    let mut s = stick(1.0, 0.0);
    process_stick(&c, &mut s);
    assert!(
        close(s.x, 1.0) && close(s.y, 0.0),
        "straight directions unchanged"
    );
}

#[test]
fn stick_calibration_recentres_and_rescales() {
    let c = StickConfig {
        deadzone: 0.0,
        circular: false,
        calibration: StickCalibration {
            center_x: 0.1,
            center_y: -0.05,
            min_x: -0.8,
            max_x: 0.9,
            min_y: -1.0,
            max_y: 1.0,
        },
        ..StickConfig::default()
    };
    let mut s = stick(0.1, -0.05);
    process_stick(&c, &mut s);
    assert!(
        close(s.x, 0.0) && close(s.y, 0.0),
        "measured rest position is centre"
    );
    let mut s = stick(0.9, -0.05); // y at its measured centre
    process_stick(&c, &mut s);
    assert!(close(s.x, 1.0), "measured max reaches full");
    let mut s = stick(-0.8, -0.05);
    process_stick(&c, &mut s);
    assert!(close(s.x, -1.0), "measured min reaches full");
}

// ---- Triggers -------------------------------------------------------------

#[test]
fn trigger_activation_threshold_controls_button_press() {
    let mut cfg = ProcessingConfig::passthrough();
    cfg.left_trigger.activation = 0.1;
    cfg.remap = vec![RemapRule::new(Button::LeftTrigger, Some(Button::South))];
    let mut p = ConfiguredProcessor::new(&cfg);
    let mut s = ControllerState::default();
    s.left_trigger = TriggerState::from_u8(40, false); // ≈0.16
    let out = step(&mut p, &s, Instant::now());
    assert!(out.buttons.south, "light pull past a 10% activation point");
}

#[test]
fn trigger_curve_and_calibration() {
    let c = TriggerConfig {
        curve: 2.0,
        ..TriggerConfig::default()
    };
    assert!(close(trigger_output(&c, 0.5), 0.25));
    let worn = TriggerConfig {
        raw_min: 0.1,
        raw_max: 0.8,
        ..TriggerConfig::default()
    };
    assert_eq!(trigger_output(&worn, 0.1), 0.0, "measured rest is zero");
    assert!(
        close(trigger_output(&worn, 0.8), 1.0),
        "measured max is full"
    );
    let mut t = TriggerState::from_u8(255, true);
    process_trigger(
        &TriggerConfig {
            activation: 1.0,
            output_max: 0.9,
            ..TriggerConfig::default()
        },
        &mut t,
    );
    assert!(!t.digital, "below activation even at full travel");
}

// ---- Gyro -----------------------------------------------------------------

fn gyro_state(pitch: i16, yaw: i16, roll: i16) -> ControllerState {
    ControllerState {
        motion: Some(MotionState {
            gyro_raw: [pitch, yaw, roll],
            accel_raw: [0, 0, 0],
            sensor_timestamp: 0,
        }),
        ..ControllerState::default()
    }
}

fn gyro_cfg() -> ProcessingConfig {
    let mut c = ProcessingConfig::passthrough();
    c.gyro = GyroConfig {
        enabled: true,
        smoothing: 0.0,
        threshold_dps: 0.0,
        full_scale_dps: 100.0,
        ..GyroConfig::default()
    };
    c
}

fn dps(v: f32) -> i16 {
    (v * GYRO_LSB_PER_DPS).round() as i16
}

#[test]
fn gyro_moves_right_stick() {
    let mut p = ConfiguredProcessor::new(&gyro_cfg());
    let out = step(
        &mut p,
        &gyro_state(dps(50.0), dps(-50.0), 0),
        Instant::now(),
    );
    assert!(
        close(out.right_stick.x, 0.5),
        "turning right (negative yaw) moves right: {}",
        out.right_stick.x
    );
    assert!(close(out.right_stick.y, 0.5), "{}", out.right_stick.y);
    assert_eq!(out.left_stick.x, 0.0);
}

#[test]
fn gyro_adds_to_real_stick_and_clamps() {
    let mut p = ConfiguredProcessor::new(&gyro_cfg());
    let mut s = gyro_state(0, dps(-80.0), 0);
    s.right_stick = stick(0.6, 0.0);
    let out = step(&mut p, &s, Instant::now());
    assert!(close(out.right_stick.x, 1.0), "0.6 + 0.8 clamped to 1");
}

#[test]
fn gyro_threshold_bias_invert_and_roll() {
    let mut c = gyro_cfg();
    c.gyro.threshold_dps = 5.0;
    let mut p = ConfiguredProcessor::new(&c);
    assert_eq!(
        step(&mut p, &gyro_state(dps(3.0), dps(-3.0), 0), Instant::now())
            .right_stick
            .x,
        0.0,
        "resting hand ignored"
    );

    c.gyro.threshold_dps = 0.0;
    c.gyro.bias = [0.0, 100.0, 0.0];
    let mut p = ConfiguredProcessor::new(&c);
    assert!(
        close(
            step(&mut p, &gyro_state(0, 100, 0), Instant::now())
                .right_stick
                .x,
            0.0
        ),
        "bias removed"
    );

    c.gyro.bias = [0.0; 3];
    c.gyro.invert_x = true;
    c.gyro.horizontal_axis = GyroHorizontalAxis::Roll;
    let mut p = ConfiguredProcessor::new(&c);
    let out = step(
        &mut p,
        &gyro_state(0, dps(90.0), dps(-20.0)),
        Instant::now(),
    );
    assert!(
        close(out.right_stick.x, -0.2),
        "roll used and inverted, yaw ignored: {}",
        out.right_stick.x
    );
}

#[test]
fn gyro_smoothing_eases_in() {
    let mut c = gyro_cfg();
    c.gyro.smoothing = 0.5;
    let mut p = ConfiguredProcessor::new(&c);
    let s = gyro_state(0, dps(-50.0), 0);
    let first = step(&mut p, &s, Instant::now()).right_stick.x;
    let second = step(&mut p, &s, Instant::now()).right_stick.x;
    assert!(close(first, 0.25) && close(second, 0.375));
}

#[test]
fn gyro_while_held_and_toggle_with_suppressed_button() {
    let mut c = gyro_cfg();
    c.gyro.activation = GyroActivation::WhileHeld;
    c.gyro.button = Some(Button::LeftTrigger);
    c.gyro.suppress_button = true;
    let mut p = ConfiguredProcessor::new(&c);
    let moving = gyro_state(0, dps(-50.0), 0);
    assert_eq!(
        step(&mut p, &moving, Instant::now()).right_stick.x,
        0.0,
        "off until L2 held"
    );
    let mut aiming = moving;
    aiming.left_trigger = TriggerState::from_u8(255, true);
    let out = step(&mut p, &aiming, Instant::now());
    assert!(close(out.right_stick.x, 0.5));
    assert_eq!(out.left_trigger.value, 0.0, "L2 hidden from the game");

    c.gyro.activation = GyroActivation::Toggle;
    c.gyro.button = Some(Button::Touchpad);
    let mut p = ConfiguredProcessor::new(&c);
    let mut tap = moving;
    tap.buttons.touchpad = true;
    step(&mut p, &tap, Instant::now()); // toggle on
    assert!(p.gyro_active());
    assert!(close(
        step(&mut p, &moving, Instant::now()).right_stick.x,
        0.5
    ));
    step(&mut p, &tap, Instant::now()); // toggle off
    assert_eq!(step(&mut p, &moving, Instant::now()).right_stick.x, 0.0);
}

#[test]
fn gyro_without_motion_data_does_nothing() {
    let mut p = ConfiguredProcessor::new(&gyro_cfg());
    let mut s = ControllerState::default(); // e.g. Bluetooth basic report
    s.right_stick = stick(0.3, 0.0);
    assert!(close(step(&mut p, &s, Instant::now()).right_stick.x, 0.3));
}

// ---- Touchpad -------------------------------------------------------------

fn touch(x: u16, y: u16, active: bool, click: bool) -> ControllerState {
    let mut s = ControllerState::default();
    s.touchpad = Some(TouchpadState {
        points: [
            TouchPoint {
                active,
                id: 1,
                x,
                y,
            },
            TouchPoint::default(),
        ],
        width: 1920,
        height: 1080,
    });
    s.buttons.touchpad = click;
    s
}

#[test]
fn touchpad_left_right_zones() {
    let mut c = ProcessingConfig::passthrough();
    c.touchpad.layout = TouchLayout::LeftRight;
    c.touchpad.zones = [Some(Button::Select), Some(Button::Start), None, None];
    let mut p = ConfiguredProcessor::new(&c);
    let t0 = Instant::now();
    let out = step(&mut p, &touch(300, 500, true, true), t0);
    assert!(
        out.buttons.select && !out.buttons.touchpad,
        "left click → Create"
    );
    let out = step(&mut p, &touch(1600, 500, true, true), t0);
    assert!(out.buttons.start && !out.buttons.select);
}

#[test]
fn touchpad_quadrants_and_unassigned_zone_keeps_click() {
    let mut c = ProcessingConfig::passthrough();
    c.touchpad.layout = TouchLayout::Quadrants;
    c.touchpad.zones = [Some(Button::North), None, None, Some(Button::DpadDown)];
    let mut p = ConfiguredProcessor::new(&c);
    let t0 = Instant::now();
    assert!(step(&mut p, &touch(100, 100, true, true), t0).buttons.north);
    let out = step(&mut p, &touch(1800, 1000, true, true), t0);
    assert!(out.dpad.down() && !out.buttons.touchpad);
    let out = step(&mut p, &touch(1800, 100, true, true), t0);
    assert!(out.buttons.touchpad, "top-right not assigned: normal click");
}

#[test]
fn swipes_fire_a_short_press_in_the_right_direction() {
    let mut c = ProcessingConfig::passthrough();
    c.touchpad.swipes_enabled = true;
    c.touchpad.swipe_right = Some(Button::RightShoulder);
    c.touchpad.swipe_up = Some(Button::DpadUp);
    let mut p = ConfiguredProcessor::new(&c);
    let t0 = Instant::now();
    step(&mut p, &touch(200, 540, true, false), t0);
    step(&mut p, &touch(1200, 560, true, false), at(t0, 100));
    let out = step(&mut p, &touch(1200, 560, false, false), at(t0, 150));
    assert!(out.buttons.right_shoulder, "swipe right → R1");
    assert!(
        step(&mut p, &touch(0, 0, false, false), at(t0, 200))
            .buttons
            .right_shoulder,
        "held for the pulse"
    );
    assert!(
        !step(&mut p, &touch(0, 0, false, false), at(t0, 260))
            .buttons
            .right_shoulder,
        "released after 80 ms"
    );

    step(&mut p, &touch(960, 1000, true, false), at(t0, 400));
    step(&mut p, &touch(960, 300, true, false), at(t0, 450));
    assert!(
        step(&mut p, &touch(960, 300, false, false), at(t0, 480))
            .dpad
            .up(),
        "swipe up"
    );
}

#[test]
fn slow_or_short_touches_are_not_swipes() {
    let mut c = ProcessingConfig::passthrough();
    c.touchpad.swipes_enabled = true;
    c.touchpad.swipe_right = Some(Button::RightShoulder);
    let mut p = ConfiguredProcessor::new(&c);
    let t0 = Instant::now();
    step(&mut p, &touch(200, 540, true, false), t0);
    step(&mut p, &touch(1500, 540, true, false), at(t0, 900));
    assert!(
        !step(&mut p, &touch(1500, 540, false, false), at(t0, 950))
            .buttons
            .right_shoulder,
        "too slow"
    );
    step(&mut p, &touch(200, 540, true, false), at(t0, 1000));
    step(&mut p, &touch(300, 540, true, false), at(t0, 1050));
    assert!(
        !step(&mut p, &touch(300, 540, false, false), at(t0, 1080))
            .buttons
            .right_shoulder,
        "too short"
    );
}

// ---- Layers and multi-action ------------------------------------------------

fn with(buttons: &[Button]) -> ControllerState {
    let mut s = ControllerState::default();
    for b in buttons {
        b.set(&mut s, true);
    }
    s
}

fn layered() -> ProcessingConfig {
    let mut c = ProcessingConfig::passthrough();
    c.remap = vec![RemapRule::new(Button::South, Some(Button::East))];
    c.layers = vec![MappingLayer {
        name: "Shift".into(),
        activator: Button::LeftShoulder,
        mode: LayerMode::Hold,
        remap: vec![
            RemapRule::new(Button::South, Some(Button::North)),
            RemapRule::new(Button::West, None),
        ],
    }];
    c
}

#[test]
fn hold_layer_overrides_base_while_held_and_hides_activator() {
    let mut p = ConfiguredProcessor::new(&layered());
    let t0 = Instant::now();
    let out = step(&mut p, &with(&[Button::South]), t0);
    assert!(out.buttons.east, "base layer");
    let out = step(
        &mut p,
        &with(&[
            Button::LeftShoulder,
            Button::South,
            Button::West,
            Button::DpadLeft,
        ]),
        t0,
    );
    assert!(out.buttons.north && !out.buttons.east, "layer rule wins");
    assert!(!out.buttons.west, "disabled in layer");
    assert!(out.dpad.left(), "unlisted buttons fall through");
    assert!(!out.buttons.left_shoulder, "activator hidden");
    assert_eq!(p.active_layer(), Some(0));
    let out = step(&mut p, &with(&[Button::South]), t0);
    assert!(
        out.buttons.east && p.active_layer().is_none(),
        "released → base"
    );
}

#[test]
fn toggle_layer_stays_on_until_pressed_again() {
    let mut c = layered();
    c.layers[0].mode = LayerMode::Toggle;
    let mut p = ConfiguredProcessor::new(&c);
    let t0 = Instant::now();
    step(&mut p, &with(&[Button::LeftShoulder]), t0);
    assert!(
        step(&mut p, &with(&[Button::South]), t0).buttons.north,
        "toggled on"
    );
    step(&mut p, &with(&[Button::LeftShoulder]), t0);
    assert!(
        step(&mut p, &with(&[Button::South]), t0).buttons.east,
        "toggled off"
    );
}

#[test]
fn one_input_can_press_several_outputs() {
    let mut c = ProcessingConfig::passthrough();
    c.remap = vec![RemapRule {
        from: Button::RightStick,
        to: Some(Button::South),
        also: vec![Button::East, Button::RightTrigger],
    }];
    let mut p = ConfiguredProcessor::new(&c);
    let out = step(&mut p, &with(&[Button::RightStick]), Instant::now());
    assert!(out.buttons.south && out.buttons.east && out.right_trigger.value == 1.0);
    assert!(!out.buttons.right_stick);
}

// ---- Config ---------------------------------------------------------------

#[test]
fn conflicts_are_reported() {
    let mut c = layered();
    c.remap
        .push(RemapRule::new(Button::LeftShoulder, Some(Button::South)));
    c.layers.push(MappingLayer {
        name: "Dup".into(),
        activator: Button::LeftShoulder,
        mode: LayerMode::Hold,
        remap: vec![],
    });
    c.gyro.enabled = true;
    c.gyro.activation = GyroActivation::WhileHeld;
    let msgs: Vec<String> = find_conflicts(&c, &[Button::LeftShoulder])
        .into_iter()
        .map(|c| c.message)
        .collect();
    assert!(msgs.iter().any(|m| m.contains("same button")));
    assert!(msgs
        .iter()
        .any(|m| m.contains("its own remapping is ignored")));
    assert!(msgs.iter().any(|m| m.contains("also starts a macro")));
    assert!(msgs.iter().any(|m| m.contains("no button is chosen")));
    assert!(find_conflicts(&ProcessingConfig::default(), &[]).is_empty());
}

#[test]
fn sanitize_limits_layers_and_extra_actions() {
    let mut c = ProcessingConfig::default();
    for b in [
        Button::LeftShoulder,
        Button::RightShoulder,
        Button::LeftStick,
        Button::RightStick,
        Button::Touchpad,
    ] {
        c.layers.push(MappingLayer {
            name: format!("  {b:?}  "),
            activator: b,
            mode: LayerMode::Hold,
            remap: vec![],
        });
    }
    c.remap = vec![RemapRule {
        from: Button::South,
        to: Some(Button::East),
        also: vec![
            Button::East,
            Button::North,
            Button::North,
            Button::West,
            Button::DpadUp,
            Button::DpadDown,
        ],
    }];
    c.gyro.smoothing = 5.0;
    c.touchpad.swipe_distance = 0.0;
    let s = c.sanitized();
    assert_eq!(s.layers.len(), MAX_LAYERS);
    assert_eq!(s.layers[0].name, "LeftShoulder");
    assert_eq!(
        s.remap[0].also,
        vec![Button::North, Button::West, Button::DpadUp],
        "deduped, capped at 3"
    );
    assert_eq!(s.gyro.smoothing, 0.95);
    assert_eq!(s.touchpad.swipe_distance, 0.05);
}

#[test]
fn milestone_2_profiles_load_with_new_defaults() {
    let m2 = r#"{"leftStick":{"deadzone":0.1,"curve":{"type":"linear"}},"leftTrigger":{"deadzone":0.2,"maxInput":0.8,"outputMin":0,"outputMax":1},"remap":[{"from":"south","to":"east"}]}"#;
    let c: ProcessingConfig = serde_json::from_str(m2).unwrap();
    assert_eq!(c.left_stick.deadzone, 0.1);
    assert_eq!(c.left_stick.sensitivity_x, 1.0);
    assert_eq!(c.left_trigger.activation, 0.5);
    assert_eq!(c.remap[0].also, Vec::<Button>::new());
    assert!(!c.gyro.enabled && c.layers.is_empty());
    assert_eq!(c.touchpad.layout, TouchLayout::Whole);
    let json = serde_json::to_string(&c.remap[0]).unwrap();
    assert_eq!(
        json, r#"{"from":"south","to":"east"}"#,
        "no empty `also` written"
    );
}

#[test]
fn feedback_colours_and_sanitising() {
    let mut f = FeedbackConfig {
        color: [200, 100, 50],
        brightness: 0.5,
        ..FeedbackConfig::default()
    };
    assert_eq!(f.lightbar_color(true), [100, 50, 25]);
    f.connection_colors = true;
    f.brightness = 1.0;
    assert_eq!(f.lightbar_color(true), f.usb_color);
    assert_eq!(f.lightbar_color(false), f.bluetooth_color);
    let mut c = ProcessingConfig::default();
    c.feedback = FeedbackConfig {
        brightness: 3.0,
        player_leds: 0xFF,
        player_led_brightness: 7,
        rumble_intensity: -1.0,
        ..FeedbackConfig::default()
    };
    let s = c.sanitized().feedback;
    assert_eq!(
        (
            s.brightness,
            s.player_leds,
            s.player_led_brightness,
            s.rumble_intensity
        ),
        (1.0, 0x1F, 2, 0.0)
    );
    assert!(
        !ProcessingConfig::default().feedback.lightbar_enabled,
        "off unless the user enables it"
    );
}
