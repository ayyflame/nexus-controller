#![allow(clippy::field_reassign_with_default)] // tests build states step by step

use crate::*;
use nexus_controller_core::{Button, ControllerState, StickState, TriggerState};

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-4
}

fn stick(x: f32, y: f32) -> StickState {
    StickState {
        x,
        y,
        raw_x: 0,
        raw_y: 0,
    }
}

fn run(cfg: &ProcessingConfig, mut s: ControllerState) -> ControllerState {
    ConfiguredProcessor::new(cfg).process(&mut s);
    s
}

// ---- Sticks ---------------------------------------------------------------

#[test]
fn radial_deadzone_removes_drift_and_rescales() {
    let c = StickConfig {
        deadzone: 0.1,
        ..StickConfig::default()
    };
    let mut s = stick(0.05, -0.05);
    process_stick(&c, &mut s);
    assert_eq!((s.x, s.y), (0.0, 0.0), "drift inside the deadzone");
    assert_eq!((s.raw_x, s.raw_y), (128, 128));

    let mut s = stick(0.55, 0.0);
    process_stick(&c, &mut s);
    assert!(close(s.x, 0.5), "rescaled so output starts at 0: {}", s.x);
    let mut s = stick(1.0, 0.0);
    process_stick(&c, &mut s);
    assert!(close(s.x, 1.0), "full deflection still reaches 1");
}

#[test]
fn radial_deadzone_keeps_direction() {
    let c = StickConfig {
        deadzone: 0.2,
        ..StickConfig::default()
    };
    let mut s = stick(0.6, 0.8); // magnitude 1, direction 37°
    process_stick(&c, &mut s);
    assert!(close(s.y / s.x, 0.8 / 0.6), "angle preserved");
}

#[test]
fn axial_deadzone_is_per_axis() {
    let c = StickConfig {
        deadzone: 0.2,
        shape: DeadzoneShape::Axial,
        circular: false,
        ..StickConfig::default()
    };
    let mut s = stick(0.1, 0.9);
    process_stick(&c, &mut s);
    assert_eq!(
        s.x, 0.0,
        "small x removed even though the stick is far from centre"
    );
    assert!(close(s.y, 0.875));
}

#[test]
fn outer_deadzone_saturates_early() {
    let c = StickConfig {
        deadzone: 0.0,
        outer_deadzone: 0.1,
        ..StickConfig::default()
    };
    assert!(close(shape_magnitude(&c, 0.9), 1.0));
    assert!(close(shape_magnitude(&c, 0.45), 0.5));
}

#[test]
fn anti_deadzone_sets_minimum_output() {
    let c = StickConfig {
        deadzone: 0.1,
        anti_deadzone: 0.2,
        ..StickConfig::default()
    };
    assert_eq!(
        shape_magnitude(&c, 0.05),
        0.0,
        "still zero inside the deadzone"
    );
    assert!(
        close(shape_magnitude(&c, 0.1001), 0.2),
        "jumps to the anti-deadzone"
    );
    assert!(close(shape_magnitude(&c, 1.0), 1.0));
}

#[test]
fn sensitivity_scales_and_caps() {
    let c = StickConfig {
        deadzone: 0.0,
        sensitivity: 2.0,
        ..StickConfig::default()
    };
    assert!(close(shape_magnitude(&c, 0.25), 0.5));
    assert!(
        close(shape_magnitude(&c, 0.9), 1.0),
        "never above full deflection"
    );
}

#[test]
fn response_curves() {
    let p = ResponseCurve::Power { exponent: 2.0 };
    assert!(close(evaluate_curve(&p, 0.5), 0.25));
    assert!(close(evaluate_curve(&p, 1.0), 1.0));
    let custom = ResponseCurve::Custom {
        points: vec![CurvePoint { x: 0.5, y: 0.2 }],
    };
    assert!(close(evaluate_curve(&custom, 0.25), 0.1));
    assert!(close(evaluate_curve(&custom, 0.75), 0.6));
    assert!(close(evaluate_curve(&custom, 1.0), 1.0));
    assert!(close(evaluate_curve(&ResponseCurve::Linear, 0.3), 0.3));
    for curve in [p, custom, ResponseCurve::Linear] {
        let mut last = -1.0;
        for i in 0..=100 {
            let v = evaluate_curve(&curve, i as f32 / 100.0);
            assert!(v >= last, "curves are monotonic");
            last = v;
        }
    }
}

#[test]
fn circular_clamp_limits_diagonals() {
    let c = StickConfig {
        deadzone: 0.0,
        ..StickConfig::default()
    };
    let mut s = stick(1.0, 1.0); // square corner of the raw range
    process_stick(&c, &mut s);
    assert!(close(s.x.hypot(s.y), 1.0));
    let square = StickConfig {
        circular: false,
        shape: DeadzoneShape::Axial,
        ..c
    };
    let mut s = stick(1.0, 1.0);
    process_stick(&square, &mut s);
    assert_eq!((s.x, s.y), (1.0, 1.0));
}

#[test]
fn inversion_and_raw_values_follow_output() {
    let c = StickConfig {
        deadzone: 0.0,
        invert_y: true,
        ..StickConfig::default()
    };
    let mut s = stick(0.0, 1.0);
    process_stick(&c, &mut s);
    assert_eq!(s.y, -1.0);
    assert_eq!(s.raw_y, 255, "raw Y grows downward");
}

#[test]
fn left_and_right_sticks_are_independent() {
    let mut cfg = ProcessingConfig::passthrough();
    cfg.right_stick.deadzone = 0.5;
    let mut s = ControllerState::default();
    s.left_stick = stick(0.3, 0.0);
    s.right_stick = stick(0.3, 0.0);
    let out = run(&cfg, s);
    assert!(close(out.left_stick.x, 0.3));
    assert_eq!(out.right_stick.x, 0.0);
}

#[test]
fn passthrough_changes_nothing() {
    let mut s = ControllerState::default();
    s.left_stick = StickState::from_u8(37, 201);
    s.right_stick = StickState::from_u8(255, 0);
    s.left_trigger = TriggerState::from_u8(77, true);
    Button::South.set(&mut s, true);
    let out = run(&ProcessingConfig::passthrough(), s);
    assert!(close(out.left_stick.x, s.left_stick.x) && close(out.left_stick.y, s.left_stick.y));
    assert!(close(out.left_trigger.value, s.left_trigger.value));
    assert!(out.buttons.south);
}

// ---- Triggers -------------------------------------------------------------

#[test]
fn trigger_deadzone_saturation_and_range() {
    let c = TriggerConfig {
        deadzone: 0.1,
        max_input: 0.9,
        output_min: 0.2,
        output_max: 0.8,
    };
    assert_eq!(trigger_output(&c, 0.05), 0.0);
    assert!(close(trigger_output(&c, 0.5), 0.5));
    assert!(
        close(trigger_output(&c, 0.95), 0.8),
        "saturates at max_input, capped at output_max"
    );
    assert!(
        close(trigger_output(&c, 0.1001), 0.2),
        "jumps to output_min"
    );
    let mut t = TriggerState::from_u8(255, true);
    process_trigger(&c, &mut t);
    assert_eq!(t.raw, 204);
    assert!(t.digital);
    let mut t = TriggerState::from_u8(10, false);
    process_trigger(&c, &mut t);
    assert!(!t.digital && t.raw == 0);
}

// ---- Remapping ------------------------------------------------------------

fn remap(rules: &[(Button, Option<Button>)]) -> ProcessingConfig {
    let mut c = ProcessingConfig::passthrough();
    c.remap = rules
        .iter()
        .map(|&(from, to)| RemapRule { from, to })
        .collect();
    c
}

fn pressed(buttons: &[Button]) -> ControllerState {
    let mut s = ControllerState::default();
    for b in buttons {
        b.set(&mut s, true);
    }
    s
}

#[test]
fn remap_swaps_and_disables() {
    let cfg = remap(&[
        (Button::South, Some(Button::East)),
        (Button::East, Some(Button::South)),
        (Button::Touchpad, None),
    ]);
    let out = run(
        &cfg,
        pressed(&[Button::South, Button::Touchpad, Button::North]),
    );
    assert!(out.buttons.east && !out.buttons.south, "Cross → Circle");
    assert!(!out.buttons.touchpad, "disabled");
    assert!(out.buttons.north, "unmapped buttons unchanged");
    let out = run(&cfg, pressed(&[Button::East]));
    assert!(out.buttons.south && !out.buttons.east, "Circle → Cross");
}

#[test]
fn remap_two_buttons_to_one_target() {
    let cfg = remap(&[(Button::LeftShoulder, Some(Button::South))]);
    let out = run(&cfg, pressed(&[Button::LeftShoulder, Button::South]));
    assert!(out.buttons.south && !out.buttons.left_shoulder);
}

#[test]
fn remap_dpad_directions() {
    let cfg = remap(&[(Button::DpadUp, Some(Button::DpadDown))]);
    let out = run(&cfg, pressed(&[Button::DpadUp, Button::DpadLeft]));
    assert!(out.dpad.down() && out.dpad.left() && !out.dpad.up());
}

#[test]
fn remap_triggers_keep_analog_when_swapped() {
    let cfg = remap(&[
        (Button::LeftTrigger, Some(Button::RightTrigger)),
        (Button::RightTrigger, Some(Button::LeftTrigger)),
    ]);
    let mut s = ControllerState::default();
    s.left_trigger = TriggerState::from_u8(51, false); // 0.2
    let out = run(&cfg, s);
    assert!(close(out.right_trigger.value, 0.2), "analog carried across");
    assert_eq!(out.left_trigger.value, 0.0);
}

#[test]
fn remap_button_to_trigger_and_trigger_to_button() {
    let cfg = remap(&[
        (Button::RightShoulder, Some(Button::RightTrigger)),
        (Button::LeftTrigger, Some(Button::West)),
    ]);
    let mut s = pressed(&[Button::RightShoulder]);
    s.left_trigger = TriggerState::from_u8(200, true);
    let out = run(&cfg, s);
    assert_eq!(out.right_trigger.value, 1.0);
    assert!(out.right_trigger.digital);
    assert!(out.buttons.west, "L2 past half travel presses Square");
    assert_eq!(
        out.left_trigger.value, 0.0,
        "L2 no longer reaches the game as L2"
    );
    let mut s = ControllerState::default();
    s.left_trigger = TriggerState::from_u8(60, false);
    assert!(!run(&cfg, s).buttons.west, "below half travel");
}

#[test]
fn unmapped_partial_trigger_is_preserved_with_remap_active() {
    let cfg = remap(&[(Button::South, Some(Button::East))]);
    let mut s = ControllerState::default();
    s.right_trigger = TriggerState::from_u8(64, false);
    let out = run(&cfg, s);
    assert!(close(out.right_trigger.value, 64.0 / 255.0));
}

// ---- Config ---------------------------------------------------------------

#[test]
fn sanitize_clamps_and_dedupes() {
    let mut c = ProcessingConfig::default();
    c.left_stick.deadzone = 5.0;
    c.left_stick.outer_deadzone = 0.5;
    c.left_stick.sensitivity = f32::NAN;
    c.left_stick.curve = ResponseCurve::Custom {
        points: vec![
            CurvePoint { x: 0.7, y: 2.0 },
            CurvePoint { x: 0.3, y: 0.1 },
            CurvePoint { x: 0.3, y: 0.5 },
            CurvePoint {
                x: f32::NAN,
                y: 0.0,
            },
        ],
    };
    c.left_trigger = TriggerConfig {
        deadzone: 0.5,
        max_input: 0.2,
        output_min: 0.9,
        output_max: 0.1,
    };
    c.remap = vec![
        RemapRule {
            from: Button::South,
            to: Some(Button::East),
        },
        RemapRule {
            from: Button::South,
            to: None,
        },
        RemapRule {
            from: Button::North,
            to: Some(Button::North),
        },
    ];
    let s = c.sanitized();
    assert_eq!(s.left_stick.deadzone, 0.9);
    assert!(s.left_stick.deadzone + s.left_stick.outer_deadzone <= 0.95 + 1e-6);
    assert_eq!(s.left_stick.sensitivity, 1.0);
    match &s.left_stick.curve {
        ResponseCurve::Custom { points } => {
            assert_eq!(points.len(), 2);
            assert_eq!(points[0].x, 0.3);
            assert_eq!(points[1].y, 1.0);
        }
        other => panic!("{other:?}"),
    }
    assert!(s.left_trigger.max_input > s.left_trigger.deadzone);
    assert!(s.left_trigger.output_max >= s.left_trigger.output_min);
    assert_eq!(
        s.remap,
        vec![RemapRule {
            from: Button::South,
            to: Some(Button::East)
        }]
    );
}

#[test]
fn config_json_is_stable_and_tolerant() {
    let json = serde_json::to_string(&ProcessingConfig::default()).unwrap();
    assert!(json.contains(r#""leftStick":{"deadzone":0.05"#));
    assert!(json.contains(r#""curve":{"type":"linear"}"#));
    // Older or partial settings load with defaults for missing fields.
    let partial: ProcessingConfig = serde_json::from_str(
        r#"{"rightStick":{"deadzone":0.2,"curve":{"type":"power","exponent":1.5}}}"#,
    )
    .unwrap();
    assert_eq!(partial.right_stick.deadzone, 0.2);
    assert_eq!(partial.right_stick.sensitivity, 1.0);
    assert_eq!(partial.left_stick, StickConfig::default());
    let empty: ProcessingConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(empty, ProcessingConfig::default());
    let remap: ProcessingConfig = serde_json::from_str(
        r#"{"remap":[{"from":"south","to":null},{"from":"east","to":"north"}]}"#,
    )
    .unwrap();
    assert_eq!(remap.remap[0].to, None);
    assert_eq!(remap.remap[1].to, Some(Button::North));
}
