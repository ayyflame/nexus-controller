//! Input processing: transforms normalized controller state before output.
//!
//! [`ConfiguredProcessor`] implements the user's settings from a
//! [`ProcessingConfig`]: stick deadzones (radial or axial), outer deadzone,
//! anti-deadzone, response curves, sensitivity, circular output, axis
//! inversion, trigger deadzones and output ranges, and button remapping.
//! Stages run on the controller's reader thread and never allocate.

#![forbid(unsafe_code)]

mod config;
mod processor;

pub use config::{
    find_conflicts, ComboRule, ConfigConflict, CurvePoint, DeadzoneShape, FeedbackConfig,
    GyroActivation, GyroConfig, GyroHorizontalAxis, LayerMode, MappingLayer, ProcessingConfig,
    RemapRule, ResponseCurve, StickButtons, StickCalibration, StickConfig, StickDirections,
    StickRouting, StickSource, TouchLayout, TouchpadConfig, TriggerConfig, MAX_COMBOS,
    MAX_COMBO_BUTTONS, MAX_COMBO_SENDS, MAX_CURVE_POINTS, MAX_EXTRA_ACTIONS, MAX_LAYERS,
};
pub use processor::{
    evaluate_curve, process_stick, process_trigger, shape_magnitude, stick_directions,
    trigger_output, ConfiguredProcessor, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, GYRO_LSB_PER_DPS,
};

use nexus_controller_core::{Button, ControllerState};

/// One processing stage. Stages run on the controller's reader thread, so
/// they must be fast, non-blocking and allocation-free in steady state.
pub trait InputProcessor: Send {
    fn name(&self) -> &'static str;
    fn process(&mut self, state: &mut ControllerState);
    /// Index of the mapping layer this stage has active, if it has layers.
    fn active_layer(&self) -> Option<usize> {
        None
    }
    /// What this stage remembers between reports (held buttons, toggles,
    /// hidden combination buttons), so a rebuilt stage can continue from it.
    fn runtime_state(&self) -> Option<RuntimeState> {
        None
    }
    /// Continues from a previous stage's state. `keep_toggles`: toggled
    /// layers and gyro stay on (a settings edit), or start off (a profile switch).
    fn restore_runtime_state(&mut self, _state: &RuntimeState, _keep_toggles: bool) {}
}

/// State a [`ConfiguredProcessor`] carries from one report to the next.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RuntimeState {
    pub prev_physical: u32,
    pub combo_latched: u32,
    pub stick_dirs: [u8; 2],
    pub gyro_button_was_down: bool,
    pub gyro_toggled: Option<Button>,
    /// Toggle layers that are on, by activator.
    pub layers_on: Vec<Button>,
}

/// Ordered chain of stages. An empty pipeline is a pass-through.
#[derive(Default)]
pub struct ProcessingPipeline {
    stages: Vec<Box<dyn InputProcessor>>,
}

impl ProcessingPipeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, stage: Box<dyn InputProcessor>) {
        self.stages.push(stage);
    }

    /// The active mapping layer of the first stage that has one (read-only;
    /// for display).
    pub fn active_layer(&self) -> Option<usize> {
        self.stages.iter().find_map(|s| s.active_layer())
    }

    /// Continues each stage from the matching stage of `old` (after new
    /// settings were applied). Without this, a rebuilt stage would forget
    /// held buttons (a held toggle button would toggle again), hidden
    /// combination buttons (they would leak to the game while still held)
    /// and, with `keep_toggles`, toggled layers and gyro.
    pub fn carry_state_from(&mut self, old: &ProcessingPipeline, keep_toggles: bool) {
        for (new, old) in self.stages.iter_mut().zip(&old.stages) {
            if let Some(s) = old.runtime_state() {
                new.restore_runtime_state(&s, keep_toggles);
            }
        }
    }

    /// The first stage's runtime state (tests and diagnostics).
    pub fn stages_state(&self) -> RuntimeState {
        self.stages
            .iter()
            .find_map(|s| s.runtime_state())
            .unwrap_or_default()
    }

    pub fn stage_names(&self) -> Vec<&'static str> {
        self.stages.iter().map(|s| s.name()).collect()
    }

    pub fn run(&mut self, input: &ControllerState) -> ControllerState {
        let mut state = *input;
        for stage in &mut self.stages {
            stage.process(&mut state);
        }
        state
    }
}

#[cfg(test)]
mod processing_tests;

#[cfg(test)]
mod advanced_tests;

#[cfg(test)]
mod stick_mapping_tests;

#[cfg(test)]
mod state_carry_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use nexus_controller_core::StickState;

    struct Scale(f32, &'static str);
    impl InputProcessor for Scale {
        fn name(&self) -> &'static str {
            self.1
        }
        fn process(&mut self, s: &mut ControllerState) {
            s.left_stick.x *= self.0;
        }
    }
    struct AddOffset(f32);
    impl InputProcessor for AddOffset {
        fn name(&self) -> &'static str {
            "offset"
        }
        fn process(&mut self, s: &mut ControllerState) {
            s.left_stick.x += self.0;
        }
    }

    #[test]
    fn empty_pipeline_is_passthrough() {
        let input = ControllerState {
            left_stick: StickState::from_u8(10, 200),
            ..Default::default()
        };
        assert_eq!(ProcessingPipeline::new().run(&input), input);
    }

    #[test]
    fn stages_run_in_order_without_mutating_input() {
        let mut p = ProcessingPipeline::new();
        p.push(Box::new(Scale(0.5, "half")));
        p.push(Box::new(AddOffset(0.25)));
        let input = ControllerState {
            left_stick: StickState::from_u8(255, 128),
            ..Default::default()
        };
        let out = p.run(&input);
        assert_eq!(out.left_stick.x, 0.75); // (1.0 * 0.5) + 0.25, not (1.0 + 0.25) * 0.5
        assert_eq!(input.left_stick.x, 1.0);
        assert_eq!(p.stage_names(), vec!["half", "offset"]);
    }
}
