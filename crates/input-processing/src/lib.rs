//! Input processing: transforms normalized controller state before output.
//!
//! Milestone 1 provides the stage interface and an ordered pipeline only.
//! Deadzones, response curves, trigger tuning and similar stages arrive in
//! later milestones as additional [`InputProcessor`] implementations; the
//! engine and output layers will not need to change.

#![forbid(unsafe_code)]

use nexus_controller_core::ControllerState;

/// One processing stage. Stages run on the controller's reader thread, so
/// they must be fast, non-blocking and allocation-free in steady state.
pub trait InputProcessor: Send {
    fn name(&self) -> &'static str;
    fn process(&mut self, state: &mut ControllerState);
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
