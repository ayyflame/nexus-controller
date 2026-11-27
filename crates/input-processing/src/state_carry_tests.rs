//! New settings rebuild the processor; what it was in the middle of must
//! carry over (synthetic inputs).

use crate::*;
use nexus_controller_core::{Button, ControllerState, StickState};

fn pipeline(c: &ProcessingConfig) -> ProcessingPipeline {
    let mut p = ProcessingPipeline::new();
    p.push(Box::new(ConfiguredProcessor::new(c)));
    p
}

fn held(buttons: &[Button]) -> ControllerState {
    let mut s = ControllerState::default();
    for b in buttons {
        b.set(&mut s, true);
    }
    s
}

fn toggle_layer() -> ProcessingConfig {
    ProcessingConfig {
        layers: vec![MappingLayer {
            name: "Shift".into(),
            activator: Button::LeftStick,
            mode: LayerMode::Toggle,
            remap: vec![RemapRule::new(Button::South, Some(Button::East))],
        }],
        ..ProcessingConfig::passthrough()
    }
}

/// Rebuild as the engine does after new settings.
fn rebuild(
    old: &ProcessingPipeline,
    c: &ProcessingConfig,
    keep_toggles: bool,
) -> ProcessingPipeline {
    let mut p = pipeline(c);
    p.carry_state_from(old, keep_toggles);
    p
}

#[test]
fn an_edit_keeps_a_toggled_layer_on_a_profile_switch_turns_it_off() {
    let c = toggle_layer();
    let mut p = pipeline(&c);
    p.run(&held(&[Button::LeftStick])); // toggle on
    p.run(&held(&[]));
    assert_eq!(p.active_layer(), Some(0));
    let mut edited = rebuild(&p, &c, true);
    assert_eq!(
        edited.active_layer(),
        Some(0),
        "changing a slider doesn't switch the layer off"
    );
    assert!(edited.run(&held(&[Button::South])).buttons.east);
    let switched = rebuild(&p, &c, false);
    assert_eq!(
        switched.active_layer(),
        None,
        "another profile starts with toggles off"
    );
}

#[test]
fn a_toggle_button_held_during_a_rebuild_does_not_toggle_again() {
    let c = toggle_layer();
    let mut p = pipeline(&c);
    p.run(&held(&[Button::LeftStick])); // pressed: on, still held
    for keep in [true, false] {
        let mut next = rebuild(&p, &c, keep);
        next.run(&held(&[Button::LeftStick])); // still the same press
        let expected = if keep { Some(0) } else { None };
        assert_eq!(next.active_layer(), expected, "keep_toggles = {keep}");
    }
}

#[test]
fn hidden_combination_buttons_stay_hidden_until_released() {
    let c = ProcessingConfig {
        combos: vec![ComboRule {
            buttons: vec![Button::LeftShoulder, Button::RightShoulder],
            sends: vec![Button::North],
            hide_inputs: true,
        }],
        ..ProcessingConfig::passthrough()
    };
    let mut p = pipeline(&c);
    p.run(&held(&[Button::LeftShoulder, Button::RightShoulder]));
    // R1 released first; L1 still held and still hidden...
    assert!(!p.run(&held(&[Button::LeftShoulder])).buttons.left_shoulder);
    // ...and still hidden after new settings arrive mid-release.
    let mut next = rebuild(&p, &c, true);
    assert!(
        !next
            .run(&held(&[Button::LeftShoulder]))
            .buttons
            .left_shoulder,
        "no stray LB"
    );
    next.run(&held(&[]));
    assert!(
        next.run(&held(&[Button::LeftShoulder]))
            .buttons
            .left_shoulder,
        "a fresh press works"
    );
}

#[test]
fn a_toggled_gyro_stays_on_after_an_edit_only_if_the_same_button_toggles_it() {
    let mut c = ProcessingConfig::passthrough();
    c.gyro.enabled = true;
    c.gyro.activation = GyroActivation::Toggle;
    c.gyro.button = Some(Button::Touchpad);
    let mut p = pipeline(&c);
    p.run(&held(&[Button::Touchpad]));
    p.run(&held(&[]));
    let state = |pl: &ProcessingPipeline| pl.stages_state();
    assert_eq!(state(&p).gyro_toggled, Some(Button::Touchpad));
    assert_eq!(
        state(&rebuild(&p, &c, true)).gyro_toggled,
        Some(Button::Touchpad)
    );
    let mut other = c.clone();
    other.gyro.button = Some(Button::Mute);
    assert_eq!(
        state(&rebuild(&p, &other, true)).gyro_toggled,
        None,
        "a different button: starts off"
    );
}

#[test]
fn stick_button_release_margin_survives_an_edit() {
    let mut c = ProcessingConfig::passthrough();
    c.left_stick.buttons = StickButtons {
        enabled: true,
        up: Some(Button::DpadUp),
        threshold_y: 0.5,
        hysteresis: 0.1,
        ..StickButtons::default()
    };
    let stick = |y: f32| ControllerState {
        left_stick: StickState {
            x: 0.0,
            y,
            raw_x: 128,
            raw_y: 128,
        },
        ..Default::default()
    };
    let mut p = pipeline(&c);
    assert!(Button::DpadUp.is_pressed(&p.run(&stick(0.6))));
    let mut next = rebuild(&p, &c, true);
    assert!(
        Button::DpadUp.is_pressed(&next.run(&stick(0.45))),
        "within the margin: still held, no flicker"
    );
}
