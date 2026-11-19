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
    RemapRule, ResponseCurve, StickCalibration, StickConfig, TouchLayout, TouchpadConfig,
    TriggerConfig, MAX_COMBOS, MAX_COMBO_BUTTONS, MAX_COMBO_SENDS, MAX_CURVE_POINTS,
    MAX_EXTRA_ACTIONS, MAX_LAYERS,
};
pub use processor::{
    evaluate_curve, process_stick, process_trigger, shape_magnitude, trigger_output,
    ConfiguredProcessor, GYRO_LSB_PER_DPS,
};

use nexus_controller_core::ControllerState;

/// One processing stage. Stages run on the controller's reader thread, so
/// they must be fast, non-blocking and allocation-free in steady state.
pub trait InputProcessor: Send {
    fn name(&self) -> &'static str;
    fn process(&mut self, state: &mut ControllerState);
    /// Index of the mapping layer this stage has active, if it has layers.
    fn active_layer(&self) -> Option<usize> {
        None
    }
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
