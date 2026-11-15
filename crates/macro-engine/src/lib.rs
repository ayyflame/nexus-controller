//! NEXUS macro engine: data model, validation, playback and recording.
//!
//! A macro is a sequence of **steps**. Each step presses one or more buttons
//! together, holds them for `hold_ms`, releases them, then waits
//! `delay_after_ms` before the next step. A macro is started by its
//! **trigger** button on the physical controller, in one of three modes
//! (play once, repeat while held, toggle).
//!
//! * [`MacroRunner`] runs on each controller's reader thread. It reads
//!   triggers from the *physical* state and overlays macro presses onto the
//!   *output* state. It never blocks, allocates only when a macro starts or
//!   stops, and releases everything when it is dropped (controller
//!   disconnect, application shutdown).
//! * [`MacroRecorder`] turns live physical input into steps.
//! * The UI is independent: it edits [`Macro`] values and hands them to the
//!   engine; nothing here knows about Tauri or React.
//!
//! Scope: user-triggered button sequences only. No stick automation, aim
//! assistance, recoil compensation, or game-memory access.

#![forbid(unsafe_code)]

mod model;
mod playback;
mod recorder;

pub use model::{
    validate_library, validate_macro, Macro, MacroStep, PlaybackMode, ValidationIssue,
    DEFAULT_DELAY_MS, DEFAULT_HOLD_MS, DEFAULT_REPEAT_DELAY_MS, MAX_DELAY_MS, MAX_HOLD_MS,
    MAX_NAME_LEN, MAX_STEPS, MIN_HOLD_MS,
};
/// Buttons are defined in `controller-core`; macros use the same identity.
pub use nexus_controller_core::Button as MacroButton;
pub use playback::{sequence_at, MacroLibrary, MacroRunner, SequencePoint};
pub use recorder::{MacroRecorder, RecordingResult, MAX_RECORDED_PRESSES, MAX_RECORDING_MS};
