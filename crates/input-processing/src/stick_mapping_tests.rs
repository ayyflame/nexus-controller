//! Stick swapping and stick-to-button mapping. Synthetic inputs; how a game
//! reacts is checked on hardware separately (tests/hardware-verification.md).

use crate::*;
use nexus_controller_core::{Button, ControllerState, DpadDirection, MotionState, StickState};
use std::time::Instant;

fn stick(x: f32, y: f32) -> StickState {
    StickState {
        x,
        y,
        raw_x: 0,
        raw_y: 0,
    }
}

fn with_sticks(l: (f32, f32), r: (f32, f32)) -> ControllerState {
    ControllerState {
        left_stick: stick(l.0, l.1),
        right_stick: stick(r.0, r.1),
        ..Default::default()
    }
}

fn run(p: &mut ConfiguredProcessor, physical: &ControllerState) -> ControllerState {
    let mut s = *physical;
    p.process_at(&mut s, physical, Instant::now());
    s
}

trait DpadUp {
    fn dpad_up(&self) -> bool;
}
impl DpadUp for ControllerState {
    fn dpad_up(&self) -> bool {
        Button::DpadUp.is_pressed(self)
    }
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-3
}

/// No deadzone or shaping, so outputs equal inputs.
fn raw() -> ProcessingConfig {
    ProcessingConfig::passthrough()
}

fn routed(left: StickSource, right: StickSource) -> ProcessingConfig {
    ProcessingConfig {
        stick_routing: StickRouting {
            left_output: left,
            right_output: right,
        },
        ..raw()
    }
}

fn dpad_buttons() -> StickButtons {
    StickButtons {
        enabled: true,
        up: Some(Button::DpadUp),
        down: Some(Button::DpadDown),
        left: Some(Button::DpadLeft),
        right: Some(Button::DpadRight),
        ..StickButtons::default()
    }
}

fn left_buttons(b: StickButtons) -> ProcessingConfig {
    let mut c = raw();
    c.left_stick.buttons = b;
    c
}

// ---- Swapping --------------------------------------------------------------

#[test]
fn sticks_swap_with_exact_analog_values() {
    let mut p = ConfiguredProcessor::new(&routed(StickSource::Right, StickSource::Left));
    let out = run(&mut p, &with_sticks((0.25, -0.5), (-0.75, 0.125)));
    assert!(close(out.left_stick.x, -0.75) && close(out.left_stick.y, 0.125));
    assert!(close(out.right_stick.x, 0.25) && close(out.right_stick.y, -0.5));
    assert_eq!(
        out.right_stick.raw_x,
        (0.25f32 * 127.0 + 128.0).round() as u8
    );
}

#[test]
fn one_stick_can_drive_either_or_both_and_off_centres() {
    let input = with_sticks((0.5, 0.5), (-0.5, -0.5));
    let mut p = ConfiguredProcessor::new(&routed(StickSource::Right, StickSource::Right));
    let out = run(&mut p, &input);
    assert!(close(out.left_stick.x, -0.5) && close(out.right_stick.x, -0.5));

    let mut p = ConfiguredProcessor::new(&routed(StickSource::Off, StickSource::Left));
    let out = run(&mut p, &input);
    assert_eq!(
        out.left_stick,
        StickState {
            x: 0.0,
            y: 0.0,
            raw_x: 128,
            raw_y: 128
        }
    );
    assert!(close(out.right_stick.x, 0.5));
}

#[test]
fn a_swapped_stick_keeps_its_own_deadzone_and_curve() {
    // The worn left stick has a big deadzone; the right one a precise curve.
    let mut c = routed(StickSource::Right, StickSource::Left);
    c.left_stick.deadzone = 0.3;
    c.right_stick.curve = ResponseCurve::Power { exponent: 2.0 };
    let mut p = ConfiguredProcessor::new(&c);
    let out = run(&mut p, &with_sticks((0.2, 0.0), (0.5, 0.0)));
    assert!(
        close(out.right_stick.x, 0.0),
        "left's deadzone hides its drift"
    );
    assert!(close(out.left_stick.x, 0.25), "right's curve: 0.5² = 0.25");
}

#[test]
fn default_routing_changes_nothing() {
    let input = with_sticks((0.3, -0.2), (0.1, 0.9));
    let mut p = ConfiguredProcessor::new(&raw());
    let out = run(&mut p, &input);
    assert_eq!(out.left_stick.x, 0.3);
    assert_eq!(out.right_stick.y, 0.9);
}

#[test]
fn gyro_aims_with_the_games_right_stick_after_a_swap() {
    let mut c = routed(StickSource::Right, StickSource::Left);
    c.gyro.enabled = true;
    c.gyro.smoothing = 0.0;
    c.gyro.threshold_dps = 0.0;
    let mut p = ConfiguredProcessor::new(&c);
    let mut input = with_sticks((0.0, 0.0), (0.4, 0.0));
    input.motion = Some(MotionState {
        gyro_raw: [0, -(100.0 * GYRO_LSB_PER_DPS) as i16, 0],
        accel_raw: [0; 3],
        sensor_timestamp: 0,
    });
    let out = run(&mut p, &input);
    assert!(
        close(out.left_stick.x, 0.4),
        "physical right stick → game's left"
    );
    assert!(
        out.right_stick.x > 0.3,
        "gyro still moves the game's right stick: {}",
        out.right_stick.x
    );
}

#[test]
fn stick_clicks_are_buttons_and_stay_where_they_are() {
    let mut p = ConfiguredProcessor::new(&routed(StickSource::Right, StickSource::Left));
    let mut input = with_sticks((0.0, 0.0), (0.0, 0.0));
    input.buttons.left_stick = true;
    let out = run(&mut p, &input);
    assert!(out.buttons.left_stick && !out.buttons.right_stick);
}

// ---- Stick to buttons ------------------------------------------------------

#[test]
fn directions_press_buttons_and_diagonals_press_two() {
    let mut p = ConfiguredProcessor::new(&left_buttons(dpad_buttons()));
    let out = run(&mut p, &with_sticks((0.0, 0.8), (0.0, 0.0)));
    assert_eq!(out.dpad, DpadDirection::Up);
    let out = run(&mut p, &with_sticks((0.7, -0.7), (0.0, 0.0)));
    assert_eq!(out.dpad, DpadDirection::DownRight);
    let out = run(&mut p, &with_sticks((0.0, 0.0), (0.0, 0.0)));
    assert_eq!(out.dpad, DpadDirection::Neutral);
}

#[test]
fn the_stick_stays_centred_unless_analog_passthrough_is_on() {
    let input = with_sticks((0.0, 0.8), (0.0, 0.0));
    let mut p = ConfiguredProcessor::new(&left_buttons(dpad_buttons()));
    let out = run(&mut p, &input);
    assert_eq!((out.left_stick.x, out.left_stick.y), (0.0, 0.0));

    let mut c = left_buttons(StickButtons {
        passthrough: true,
        ..dpad_buttons()
    });
    c.left_stick.curve = ResponseCurve::Power { exponent: 2.0 };
    let mut p = ConfiguredProcessor::new(&c);
    let out = run(&mut p, &input);
    assert!(
        close(out.left_stick.y, 0.64),
        "the curve still applies: {}",
        out.left_stick.y
    );
    assert_eq!(out.dpad, DpadDirection::Up, "and the button is pressed");
}

#[test]
fn hysteresis_prevents_chatter_near_the_threshold() {
    let b = StickButtons {
        threshold_y: 0.5,
        hysteresis: 0.1,
        ..dpad_buttons()
    };
    let mut p = ConfiguredProcessor::new(&left_buttons(b));
    let up =
        |p: &mut ConfiguredProcessor, y: f32| run(p, &with_sticks((0.0, y), (0.0, 0.0))).dpad_up();
    assert!(!up(&mut p, 0.49), "below the threshold");
    assert!(up(&mut p, 0.5), "presses at the threshold");
    assert!(up(&mut p, 0.45), "a wobble back does not release");
    assert!(up(&mut p, 0.41));
    assert!(!up(&mut p, 0.4), "released at threshold − hysteresis");
    assert!(!up(&mut p, 0.49), "and needs the full threshold again");
    assert!(up(&mut p, 0.5));

    // Without hysteresis the same wobble releases at once.
    let mut p = ConfiguredProcessor::new(&left_buttons(StickButtons {
        hysteresis: 0.0,
        ..b
    }));
    assert!(up(&mut p, 0.5));
    assert!(!up(&mut p, 0.49));
}

#[test]
fn x_and_y_have_their_own_thresholds() {
    let b = StickButtons {
        threshold_x: 0.3,
        threshold_y: 0.8,
        hysteresis: 0.0,
        ..dpad_buttons()
    };
    let mut p = ConfiguredProcessor::new(&left_buttons(b));
    let out = run(&mut p, &with_sticks((0.35, 0.7), (0.0, 0.0)));
    assert_eq!(out.dpad, DpadDirection::Right, "x past 0.3, y not past 0.8");
    let out = run(&mut p, &with_sticks((0.25, 0.85), (0.0, 0.0)));
    assert_eq!(out.dpad, DpadDirection::Up);
}

#[test]
fn four_way_presses_one_direction_and_keeps_it_through_the_diagonal() {
    let b = StickButtons {
        directions: StickDirections::Four,
        hysteresis: 0.05,
        ..dpad_buttons()
    };
    let mut p = ConfiguredProcessor::new(&left_buttons(b));
    let dpad =
        |p: &mut ConfiguredProcessor, x: f32, y: f32| run(p, &with_sticks((x, y), (0.0, 0.0))).dpad;
    use nexus_controller_core::DpadDirection as Dpad;
    assert_eq!(
        dpad(&mut p, 0.6, 0.8),
        Dpad::Up,
        "from the centre, the stronger wins"
    );
    // Rolling from up to right: never both, never a gap that flickers.
    let path = [
        (0.0, 0.9),
        (0.6, 0.7),
        (0.7, 0.6),
        (0.8, 0.5),
        (0.85, 0.44),
        (0.9, 0.0),
    ];
    let seen: Vec<Dpad> = path.iter().map(|&(x, y)| dpad(&mut p, x, y)).collect();
    assert_eq!(
        seen,
        [
            Dpad::Up,
            Dpad::Up,
            Dpad::Up,
            Dpad::Up,
            Dpad::Right,
            Dpad::Right
        ]
    );
}

#[test]
fn a_stick_can_press_any_button_including_a_full_trigger() {
    let b = StickButtons {
        enabled: true,
        up: Some(Button::RightTrigger),
        down: Some(Button::South),
        ..StickButtons::default()
    };
    let mut c = raw();
    c.right_stick.buttons = b;
    let mut p = ConfiguredProcessor::new(&c);
    let out = run(&mut p, &with_sticks((0.0, 0.0), (0.0, 0.9)));
    assert_eq!(out.right_trigger.value, 1.0);
    assert!(out.right_trigger.digital);
    let out = run(&mut p, &with_sticks((0.0, 0.0), (0.0, -0.9)));
    assert!(out.buttons.south && out.right_trigger.value == 0.0);
}

#[test]
fn stick_buttons_work_on_a_swapped_stick() {
    // Physical left stick: d-pad only. Physical right stick: the game's left stick.
    let mut c = routed(StickSource::Right, StickSource::Off);
    c.left_stick.buttons = dpad_buttons();
    let mut p = ConfiguredProcessor::new(&c);
    let out = run(&mut p, &with_sticks((-0.9, 0.0), (0.3, 0.4)));
    assert_eq!(out.dpad, DpadDirection::Left);
    assert!(close(out.left_stick.x, 0.3) && close(out.left_stick.y, 0.4));
    assert_eq!((out.right_stick.x, out.right_stick.y), (0.0, 0.0));
}

#[test]
fn switching_stick_buttons_off_releases_everything() {
    let mut p = ConfiguredProcessor::new(&left_buttons(dpad_buttons()));
    assert!(run(&mut p, &with_sticks((0.0, 0.9), (0.0, 0.0))).dpad_up());
    let mut p = ConfiguredProcessor::new(&raw());
    let out = run(&mut p, &with_sticks((0.0, 0.9), (0.0, 0.0)));
    assert!(!out.dpad_up());
    assert!(close(out.left_stick.y, 0.9), "plain analog stick again");
}

// ---- Settings --------------------------------------------------------------

#[test]
fn out_of_range_settings_are_clamped() {
    let mut c = raw();
    c.left_stick.buttons = StickButtons {
        threshold_x: 2.0,
        threshold_y: 0.0,
        hysteresis: 0.9,
        ..dpad_buttons()
    };
    let b = c.sanitized().left_stick.buttons;
    assert_eq!(b.threshold_x, 0.95);
    assert_eq!(b.threshold_y, 0.1);
    assert!(
        close(b.hysteresis, 0.05),
        "release point stays above the centre: {}",
        b.hysteresis
    );
}

#[test]
fn profiles_saved_before_stick_mapping_load_unchanged() {
    let old = r#"{"leftStick":{"deadzone":0.1},"rightStick":{}}"#;
    let c: ProcessingConfig = serde_json::from_str(old).unwrap();
    assert_eq!(c.stick_routing, StickRouting::default());
    assert_eq!(c.left_stick.buttons, StickButtons::default());
    assert!(!c.left_stick.buttons.enabled);
    // And the new fields round-trip.
    let mut n = raw();
    n.stick_routing.left_output = StickSource::Right;
    n.right_stick.buttons = dpad_buttons();
    let back: ProcessingConfig = serde_json::from_str(&serde_json::to_string(&n).unwrap()).unwrap();
    assert_eq!(back, n);
    assert!(serde_json::to_string(&n)
        .unwrap()
        .contains(r#""stickRouting":{"leftOutput":"right","rightOutput":"right"}"#));
}

#[test]
fn likely_mistakes_are_reported_as_conflicts() {
    let mut c = raw();
    c.left_stick.buttons.enabled = true;
    c.stick_routing.right_output = StickSource::Left;
    let msgs: Vec<String> = find_conflicts(&c, &[])
        .into_iter()
        .map(|x| x.message)
        .collect();
    assert!(
        msgs.iter().any(|m| m.contains("no direction has a button")),
        "{msgs:?}"
    );
    assert!(
        msgs.iter()
            .any(|m| m.contains("Both of the game's sticks follow the left stick")),
        "{msgs:?}"
    );
    assert!(find_conflicts(&raw(), &[]).is_empty());
}

#[test]
fn each_of_the_four_directions_presses_its_own_button() {
    let b = StickButtons {
        enabled: true,
        up: Some(Button::North),
        down: Some(Button::South),
        left: Some(Button::West),
        right: Some(Button::East),
        ..StickButtons::default()
    };
    for (stick_on, (x, y), want) in [
        (true, (0.0, 0.9), Button::North),
        (true, (0.0, -0.9), Button::South),
        (true, (-0.9, 0.0), Button::West),
        (true, (0.9, 0.0), Button::East),
        (false, (0.0, 0.9), Button::North),
        (false, (0.0, -0.9), Button::South),
        (false, (-0.9, 0.0), Button::West),
        (false, (0.9, 0.0), Button::East),
    ] {
        // Left stick and right stick alike.
        let mut c = raw();
        let input = if stick_on {
            c.left_stick.buttons = b;
            with_sticks((x, y), (0.0, 0.0))
        } else {
            c.right_stick.buttons = b;
            with_sticks((0.0, 0.0), (x, y))
        };
        let out = run(&mut ConfiguredProcessor::new(&c), &input);
        let pressed: Vec<Button> = Button::ALL
            .into_iter()
            .filter(|x| x.is_pressed(&out))
            .collect();
        assert_eq!(
            pressed,
            vec![want],
            "({x}, {y}) on the {} stick",
            if stick_on { "left" } else { "right" }
        );
    }
}

#[test]
fn thresholds_apply_after_the_deadzone_and_curve() {
    // 30 % deadzone: 0.5 physical → (0.5 − 0.3) / 0.7 ≈ 0.286 processed.
    let mut c = left_buttons(StickButtons {
        threshold_y: 0.3,
        hysteresis: 0.0,
        ..dpad_buttons()
    });
    c.left_stick.deadzone = 0.3;
    let mut p = ConfiguredProcessor::new(&c);
    assert!(!run(&mut p, &with_sticks((0.0, 0.5), (0.0, 0.0))).dpad_up());
    assert!(
        run(&mut p, &with_sticks((0.0, 0.55), (0.0, 0.0))).dpad_up(),
        "≈0.357 processed"
    );
    // Drift inside the deadzone never presses anything.
    assert!(!run(&mut p, &with_sticks((0.0, 0.25), (0.0, 0.0))).dpad_up());
    // A precise curve needs more travel for the same threshold.
    let mut c = left_buttons(StickButtons {
        threshold_y: 0.5,
        hysteresis: 0.0,
        ..dpad_buttons()
    });
    c.left_stick.curve = ResponseCurve::Power { exponent: 2.0 };
    let mut p = ConfiguredProcessor::new(&c);
    assert!(
        !run(&mut p, &with_sticks((0.0, 0.6), (0.0, 0.0))).dpad_up(),
        "0.6² = 0.36"
    );
    assert!(
        run(&mut p, &with_sticks((0.0, 0.75), (0.0, 0.0))).dpad_up(),
        "0.75² ≈ 0.56"
    );
}
