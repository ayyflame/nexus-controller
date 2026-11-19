use crate::model::{Macro, MacroStep, PlaybackMode};
use crate::MacroButton;
use nexus_controller_core::ControllerState;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Instant;

/// Where a sequence is at a given time since it started.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequencePoint {
    /// Index of the current step (holding or waiting after it).
    pub step: Option<usize>,
    /// Whether that step's buttons are held right now.
    pub pressed: bool,
    /// The whole sequence has finished.
    pub finished: bool,
}

/// Pure timeline evaluation, shared by playback and tests.
pub fn sequence_at(steps: &[MacroStep], elapsed_ms: u64) -> SequencePoint {
    let mut t = 0u64;
    for (i, s) in steps.iter().enumerate() {
        t += s.hold_ms as u64;
        if elapsed_ms < t {
            return SequencePoint {
                step: Some(i),
                pressed: true,
                finished: false,
            };
        }
        t += s.delay_after_ms as u64;
        if elapsed_ms < t {
            return SequencePoint {
                step: Some(i),
                pressed: false,
                finished: false,
            };
        }
    }
    SequencePoint {
        step: None,
        pressed: false,
        finished: true,
    }
}

/// The set of macros the engine runs, shared between the UI-facing engine
/// API and every controller's [`MacroRunner`]. Updates are picked up by
/// runners on their next report without locking on the hot path.
#[derive(Default)]
pub struct MacroLibrary {
    macros: RwLock<Arc<Vec<Macro>>>,
    generation: AtomicU64,
    suspended: AtomicBool,
    stop_requests: AtomicU64,
}

impl MacroLibrary {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the library. Running macros are stopped and restarted only by
    /// a fresh trigger press.
    pub fn set(&self, macros: Vec<Macro>) {
        *self.macros.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(macros);
        self.generation.fetch_add(1, Ordering::AcqRel);
    }

    pub fn get(&self) -> Arc<Vec<Macro>> {
        self.macros
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    /// While suspended (e.g. while recording) no macro reacts to its trigger
    /// and running macros stop.
    pub fn set_suspended(&self, suspended: bool) {
        self.suspended.store(suspended, Ordering::Release);
    }

    pub fn is_suspended(&self) -> bool {
        self.suspended.load(Ordering::Acquire)
    }

    /// Stops every running macro on every controller (including toggled
    /// ones). Each starts again only on a fresh trigger press.
    pub fn request_stop_all(&self) {
        self.stop_requests.fetch_add(1, Ordering::AcqRel);
    }

    fn stop_requests(&self) -> u64 {
        self.stop_requests.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct Slot {
    trigger_was_down: bool,
    /// When the trigger went down (for hold to activate).
    down_since: Option<Instant>,
    /// The hold-to-activate time was reached during this press.
    activated: bool,
    toggled_on: bool,
    started: Option<Instant>,
    /// Set by a stop: the trigger must be released before the macro can
    /// start again (otherwise a held trigger would restart it at once).
    latched: bool,
}

impl Slot {
    /// State after a reload or resume. A trigger that is held right now is
    /// latched: it must be released and pressed again before its macro runs
    /// (all modes, including Repeat While Held). It stays hidden if the macro
    /// blocks its trigger.
    fn fresh(m: &Macro, physical: &ControllerState) -> Self {
        let down = m.trigger.is_some_and(|t| t.is_pressed(physical));
        Slot {
            trigger_was_down: down,
            latched: down,
            ..Slot::default()
        }
    }
}

/// Runs macros for one physical controller. Owned by that controller's
/// reader thread; dropping it releases every macro press because presses
/// only ever exist in the output state computed by [`MacroRunner::process`].
pub struct MacroRunner {
    library: Arc<MacroLibrary>,
    generation: Option<u64>,
    stops_seen: u64,
    macros: Arc<Vec<Macro>>,
    slots: Vec<Slot>,
    /// Which slots were playing when [`MacroRunner::take_playing_changed`]
    /// last ran; reused so the per-report check never allocates.
    playing_seen: Vec<bool>,
    /// Set when a reload discarded slots that were playing.
    playing_dirty: bool,
}

impl MacroRunner {
    pub fn new(library: Arc<MacroLibrary>) -> Self {
        Self {
            stops_seen: library.stop_requests(),
            library,
            generation: None,
            macros: Arc::new(Vec::new()),
            slots: Vec::new(),
            playing_seen: Vec::new(),
            playing_dirty: false,
        }
    }

    /// True if the set of playing macros changed since the previous call.
    /// Allocation-free, for the per-report path; call [`MacroRunner::playing`]
    /// only when this returns true.
    pub fn take_playing_changed(&mut self) -> bool {
        let mut changed = std::mem::take(&mut self.playing_dirty);
        if self.playing_seen.len() != self.slots.len() {
            self.playing_seen.resize(self.slots.len(), false);
        }
        for (seen, slot) in self.playing_seen.iter_mut().zip(&self.slots) {
            let now = slot.started.is_some();
            if *seen != now {
                *seen = now;
                changed = true;
            }
        }
        changed
    }

    /// Reads triggers from `physical` and writes macro presses into `output`.
    pub fn process(
        &mut self,
        physical: &ControllerState,
        output: &mut ControllerState,
        now: Instant,
    ) {
        self.reload_if_changed(physical);

        let stops = self.library.stop_requests();
        if stops != self.stops_seen {
            self.stops_seen = stops;
            self.stop_all();
        }

        if self.library.is_suspended() {
            for (m, slot) in self.macros.iter().zip(&mut self.slots) {
                *slot = Slot::fresh(m, physical);
            }
            return;
        }

        let mut blocked = 0u32;
        let mut pressed = 0u32;
        for (m, slot) in self.macros.iter().zip(&mut self.slots) {
            let Some(trigger) = m.trigger.filter(|_| m.is_armed()) else {
                continue;
            };
            let down = trigger.is_pressed(physical);
            let press = down && !slot.trigger_was_down;
            slot.trigger_was_down = down;
            if press {
                slot.down_since = Some(now);
                slot.activated = false;
            }
            if !down {
                slot.latched = false;
                slot.down_since = None;
                slot.activated = false;
            }
            // Hold to activate: "edge" is the moment the hold time is reached,
            // "down" means held at least that long. With 0 they are the press.
            let (edge, down) = if m.activation_ms == 0 {
                (press, down)
            } else {
                let held = slot.down_since.is_some_and(|t| {
                    now.saturating_duration_since(t).as_millis() as u64 >= m.activation_ms as u64
                });
                let first = held && !slot.activated;
                if first {
                    slot.activated = true;
                }
                (first, held)
            };
            if slot.latched {
                // Keep hiding the trigger, but play nothing until released.
                if m.block_trigger {
                    blocked |= trigger.bit();
                }
                continue;
            }
            if m.block_trigger {
                blocked |= trigger.bit();
            }

            match m.mode {
                PlaybackMode::Once => {
                    if edge && slot.started.is_none() {
                        slot.started = Some(now);
                    }
                }
                PlaybackMode::RepeatWhileHeld => {
                    if !down {
                        slot.started = None;
                    } else if slot.started.is_none() {
                        slot.started = Some(now);
                    }
                }
                PlaybackMode::Toggle => {
                    if edge {
                        slot.toggled_on = !slot.toggled_on;
                        slot.started = slot.toggled_on.then_some(now);
                    }
                }
            }

            let Some(started) = slot.started else {
                continue;
            };
            let elapsed = now.saturating_duration_since(started).as_millis() as u64;
            let elapsed = match m.mode {
                PlaybackMode::Once => elapsed,
                // Loop: one cycle is the sequence plus the pause between repeats.
                _ => elapsed % (m.duration_ms() + m.repeat_delay_ms as u64).max(1),
            };
            let point = sequence_at(&m.steps, elapsed);
            if point.finished && m.mode == PlaybackMode::Once {
                slot.started = None;
                continue;
            }
            if let (Some(i), true) = (point.step, point.pressed) {
                pressed |= m.steps[i].buttons.iter().fold(0, |acc, b| acc | b.bit());
            }
        }

        // Blocked triggers are hidden first so a macro may still press them.
        for b in MacroButton::from_mask(blocked & !pressed) {
            b.set(output, false);
        }
        for b in MacroButton::from_mask(pressed) {
            b.set(output, true);
        }
    }

    /// Picks up library changes without producing output. Call it when no
    /// report arrived, so a new macro is ready before its trigger is pressed.
    pub fn refresh(&mut self, physical: &ControllerState) {
        self.reload_if_changed(physical);
    }

    fn reload_if_changed(&mut self, physical: &ControllerState) {
        let generation = self.library.generation();
        if self.generation == Some(generation) {
            return;
        }
        self.generation = Some(generation);
        if self.playing_seen.iter().any(|p| *p) {
            self.playing_dirty = true;
        }
        self.playing_seen.iter_mut().for_each(|p| *p = false);
        self.macros = self.library.get();
        // Start from the current physical state so a trigger already held
        // during an edit or profile switch does not fire the macro by itself.
        self.slots = self
            .macros
            .iter()
            .map(|m| Slot::fresh(m, physical))
            .collect();
    }

    /// IDs of macros currently playing (including toggled-on macros in their
    /// pause between repeats).
    pub fn playing(&self) -> Vec<String> {
        self.macros
            .iter()
            .zip(&self.slots)
            .filter(|(_, s)| s.started.is_some())
            .map(|(m, _)| m.id.clone())
            .collect()
    }

    /// Stops every macro immediately. A macro starts again only after its
    /// trigger has been released and pressed again.
    pub fn stop_all(&mut self) {
        for slot in &mut self.slots {
            slot.started = None;
            slot.toggled_on = false;
            slot.latched = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::tests::{sample, step};
    use std::time::Duration;

    fn at(t0: Instant, ms: u64) -> Instant {
        t0 + Duration::from_millis(ms)
    }

    fn pressed(b: MacroButton) -> ControllerState {
        let mut s = ControllerState::default();
        b.set(&mut s, true);
        s
    }

    /// Runs one frame and returns the output.
    fn frame(r: &mut MacroRunner, physical: &ControllerState, now: Instant) -> ControllerState {
        let mut out = *physical;
        r.process(physical, &mut out, now);
        out
    }

    fn runner(macros: Vec<Macro>) -> (Arc<MacroLibrary>, MacroRunner) {
        let lib = Arc::new(MacroLibrary::new());
        lib.set(macros);
        let mut r = MacroRunner::new(lib.clone());
        // A real session starts with the controller at rest.
        let idle = ControllerState::default();
        r.process(&idle, &mut idle.clone(), Instant::now());
        (lib, r)
    }

    /// Cross 100 ms, wait 50, Circle 100 ms, wait 0  → total 250 ms.
    fn two_step(mode: PlaybackMode) -> Macro {
        let mut m = sample("m", Some(MacroButton::RightStick));
        m.steps = vec![
            step(&[MacroButton::South], 100, 50),
            step(&[MacroButton::East], 100, 0),
        ];
        m.mode = mode;
        m.repeat_delay_ms = 50;
        m
    }

    #[test]
    fn sequence_timeline() {
        let steps = vec![
            step(&[MacroButton::South], 100, 50),
            step(&[MacroButton::East], 100, 0),
        ];
        assert_eq!(
            sequence_at(&steps, 0),
            SequencePoint {
                step: Some(0),
                pressed: true,
                finished: false
            }
        );
        assert!(sequence_at(&steps, 99).pressed);
        assert_eq!(
            sequence_at(&steps, 100),
            SequencePoint {
                step: Some(0),
                pressed: false,
                finished: false
            }
        );
        assert_eq!(
            sequence_at(&steps, 150),
            SequencePoint {
                step: Some(1),
                pressed: true,
                finished: false
            }
        );
        assert!(sequence_at(&steps, 250).finished);
        assert!(sequence_at(&[], 0).finished);
    }

    fn hold_to_activate(mode: PlaybackMode) -> Macro {
        let mut m = two_step(mode);
        m.activation_ms = 300;
        m
    }

    #[test]
    fn hold_to_activate_once_plays_only_after_the_hold() {
        let (_lib, mut r) = runner(vec![hold_to_activate(PlaybackMode::Once)]);
        let t0 = Instant::now();
        let held = pressed(MacroButton::RightStick);
        assert!(!frame(&mut r, &held, t0).buttons.south, "not on press");
        assert!(
            !frame(&mut r, &held, at(t0, 299)).buttons.south,
            "not before 300 ms"
        );
        assert!(
            frame(&mut r, &held, at(t0, 300)).buttons.south,
            "plays once held 300 ms"
        );
        // Keeps playing to the end like any Once macro, then stops.
        let idle = ControllerState::default();
        assert!(frame(&mut r, &idle, at(t0, 360)).buttons.south);
        assert!(
            !frame(&mut r, &idle, at(t0, 700)).buttons.south
                && !frame(&mut r, &idle, at(t0, 700)).buttons.east
        );
    }

    #[test]
    fn a_quick_tap_does_nothing_with_hold_to_activate() {
        for mode in [
            PlaybackMode::Once,
            PlaybackMode::RepeatWhileHeld,
            PlaybackMode::Toggle,
        ] {
            let (_lib, mut r) = runner(vec![hold_to_activate(mode)]);
            let t0 = Instant::now();
            frame(&mut r, &pressed(MacroButton::RightStick), t0);
            let idle = ControllerState::default();
            for ms in [150, 400, 800] {
                let out = frame(&mut r, &idle, at(t0, ms));
                assert!(
                    !out.buttons.south && !out.buttons.east,
                    "{mode:?} at {ms} ms"
                );
            }
            assert!(r.playing().is_empty(), "{mode:?}");
        }
    }

    #[test]
    fn hold_to_activate_repeat_starts_after_the_hold_and_stops_on_release() {
        let (_lib, mut r) = runner(vec![hold_to_activate(PlaybackMode::RepeatWhileHeld)]);
        let t0 = Instant::now();
        let held = pressed(MacroButton::RightStick);
        frame(&mut r, &held, t0);
        assert!(!frame(&mut r, &held, at(t0, 200)).buttons.south);
        assert!(frame(&mut r, &held, at(t0, 310)).buttons.south);
        let out = frame(&mut r, &ControllerState::default(), at(t0, 320));
        assert!(
            !out.buttons.south && !out.buttons.east,
            "release stops at once"
        );
        assert!(r.playing().is_empty());
    }

    #[test]
    fn hold_to_activate_toggle_needs_a_long_press_each_way() {
        let (_lib, mut r) = runner(vec![hold_to_activate(PlaybackMode::Toggle)]);
        let t0 = Instant::now();
        let held = pressed(MacroButton::RightStick);
        let idle = ControllerState::default();
        frame(&mut r, &held, t0);
        frame(&mut r, &held, at(t0, 300)); // long press: on
        frame(&mut r, &idle, at(t0, 320));
        assert_eq!(r.playing().len(), 1, "toggled on");
        frame(&mut r, &held, at(t0, 400)); // quick tap: still on
        frame(&mut r, &idle, at(t0, 450));
        assert_eq!(r.playing().len(), 1, "a tap doesn't toggle off");
        frame(&mut r, &held, at(t0, 500)); // long press: off
        frame(&mut r, &held, at(t0, 800));
        frame(&mut r, &idle, at(t0, 820));
        assert!(r.playing().is_empty(), "toggled off");
        let out = frame(&mut r, &idle, at(t0, 900));
        assert!(
            !out.buttons.south && !out.buttons.east,
            "nothing left pressed"
        );
    }

    #[test]
    fn stop_all_during_a_hold_needs_a_fresh_press() {
        let (lib, mut r) = runner(vec![hold_to_activate(PlaybackMode::RepeatWhileHeld)]);
        let t0 = Instant::now();
        let held = pressed(MacroButton::RightStick);
        frame(&mut r, &held, t0);
        frame(&mut r, &held, at(t0, 310));
        lib.request_stop_all();
        let out = frame(&mut r, &held, at(t0, 320));
        assert!(!out.buttons.south && r.playing().is_empty());
        assert!(
            !frame(&mut r, &held, at(t0, 900)).buttons.south,
            "still held: stays stopped"
        );
    }

    #[test]
    fn play_once_runs_full_sequence_even_after_release() {
        let t0 = Instant::now();
        let (_, mut r) = runner(vec![two_step(PlaybackMode::Once)]);
        let idle = ControllerState::default();
        let trig = pressed(MacroButton::RightStick);

        frame(&mut r, &idle, t0);
        let out = frame(&mut r, &trig, at(t0, 0));
        assert!(out.buttons.south, "first step pressed immediately");
        assert!(!out.buttons.right_stick, "trigger hidden from output");
        let out = frame(&mut r, &idle, at(t0, 120)); // released trigger
        assert!(!out.buttons.south && !out.buttons.east, "in the wait");
        let out = frame(&mut r, &idle, at(t0, 160));
        assert!(out.buttons.east);
        assert_eq!(r.playing(), vec!["m".to_string()]);
        let out = frame(&mut r, &idle, at(t0, 260));
        assert_eq!(out, idle, "finished: nothing pressed");
        assert!(r.playing().is_empty());
    }

    #[test]
    fn play_once_ignores_presses_while_playing_and_replays_after() {
        let t0 = Instant::now();
        let (_, mut r) = runner(vec![two_step(PlaybackMode::Once)]);
        let idle = ControllerState::default();
        let trig = pressed(MacroButton::RightStick);
        frame(&mut r, &trig, t0);
        frame(&mut r, &idle, at(t0, 50));
        frame(&mut r, &trig, at(t0, 60)); // second press mid-sequence: ignored
        assert!(
            frame(&mut r, &trig, at(t0, 160)).buttons.east,
            "original timing kept"
        );
        frame(&mut r, &idle, at(t0, 300));
        assert!(
            frame(&mut r, &trig, at(t0, 310)).buttons.south,
            "replays on next press"
        );
    }

    #[test]
    fn repeat_while_held_loops_and_stops_on_release() {
        let t0 = Instant::now();
        let (_, mut r) = runner(vec![two_step(PlaybackMode::RepeatWhileHeld)]);
        let trig = pressed(MacroButton::RightStick);
        assert!(frame(&mut r, &trig, t0).buttons.south);
        // Cycle = 250 + 50 repeat pause = 300 ms.
        assert!(
            !frame(&mut r, &trig, at(t0, 270)).buttons.south,
            "repeat pause"
        );
        assert!(
            frame(&mut r, &trig, at(t0, 310)).buttons.south,
            "second pass"
        );
        let out = frame(&mut r, &ControllerState::default(), at(t0, 320));
        assert_eq!(out, ControllerState::default(), "release stops at once");
        assert!(r.playing().is_empty());
    }

    #[test]
    fn toggle_starts_and_stops_on_presses() {
        let t0 = Instant::now();
        let (_, mut r) = runner(vec![two_step(PlaybackMode::Toggle)]);
        let idle = ControllerState::default();
        let trig = pressed(MacroButton::RightStick);
        frame(&mut r, &trig, t0);
        frame(&mut r, &idle, at(t0, 30));
        assert!(
            frame(&mut r, &idle, at(t0, 610)).buttons.south,
            "still looping (3rd pass)"
        );
        frame(&mut r, &trig, at(t0, 700)); // toggle off
        assert_eq!(frame(&mut r, &idle, at(t0, 710)), idle);
        assert!(r.playing().is_empty());
    }

    #[test]
    fn disabled_unassigned_or_empty_macros_do_nothing() {
        let t0 = Instant::now();
        let mut disabled = two_step(PlaybackMode::Once);
        disabled.enabled = false;
        let unassigned = sample("u", None);
        let mut empty = sample("e", Some(MacroButton::LeftStick));
        empty.steps.clear();
        let (_, mut r) = runner(vec![disabled, unassigned, empty]);
        for b in [MacroButton::RightStick, MacroButton::LeftStick] {
            let s = pressed(b);
            assert_eq!(
                frame(&mut r, &s, t0),
                s,
                "disabled macro must pass input through"
            );
        }
    }

    #[test]
    fn block_trigger_can_be_turned_off() {
        let t0 = Instant::now();
        let mut m = two_step(PlaybackMode::Once);
        m.block_trigger = false;
        let (_, mut r) = runner(vec![m]);
        let out = frame(&mut r, &pressed(MacroButton::RightStick), t0);
        assert!(out.buttons.right_stick && out.buttons.south);
    }

    #[test]
    fn trigger_held_when_runner_starts_does_not_fire() {
        let lib = Arc::new(MacroLibrary::new());
        lib.set(vec![two_step(PlaybackMode::Once)]);
        let mut r = MacroRunner::new(lib);
        let t0 = Instant::now();
        let trig = pressed(MacroButton::RightStick);
        assert!(!frame(&mut r, &trig, t0).buttons.south);
        frame(&mut r, &ControllerState::default(), at(t0, 10));
        assert!(frame(&mut r, &trig, at(t0, 20)).buttons.south);
    }

    #[test]
    fn library_update_stops_playback_and_needs_fresh_press() {
        let t0 = Instant::now();
        let (lib, mut r) = runner(vec![two_step(PlaybackMode::RepeatWhileHeld)]);
        let trig = pressed(MacroButton::RightStick);
        assert!(frame(&mut r, &trig, t0).buttons.south);
        let mut once = two_step(PlaybackMode::Once);
        once.steps[0].buttons = vec![MacroButton::North];
        lib.set(vec![once]);
        // Trigger still held across the update: must not auto-fire.
        let out = frame(&mut r, &trig, at(t0, 10));
        assert!(!out.buttons.north && !out.buttons.south);
        frame(&mut r, &ControllerState::default(), at(t0, 20));
        assert!(frame(&mut r, &trig, at(t0, 30)).buttons.north);
    }

    #[test]
    fn reload_while_held_requires_release_and_fresh_press_in_every_mode() {
        // A profile switch reloads the macros. A trigger still held must not
        // restart a Repeat While Held (or any) macro by itself.
        for mode in [
            PlaybackMode::RepeatWhileHeld,
            PlaybackMode::Toggle,
            PlaybackMode::Once,
        ] {
            let t0 = Instant::now();
            let (lib, mut r) = runner(vec![two_step(mode)]);
            let trig = pressed(MacroButton::RightStick);
            assert!(frame(&mut r, &trig, t0).buttons.south, "{mode:?} starts");
            lib.set(vec![two_step(mode)]); // same macro, new generation
            for ms in [10, 120, 310, 620] {
                let out = frame(&mut r, &trig, at(t0, ms));
                assert!(
                    !out.buttons.south,
                    "{mode:?}: no restart while held at {ms} ms"
                );
                assert!(!out.buttons.right_stick, "{mode:?}: trigger stays hidden");
            }
            assert!(r.playing().is_empty(), "{mode:?}");
            frame(&mut r, &ControllerState::default(), at(t0, 700));
            assert!(
                frame(&mut r, &trig, at(t0, 710)).buttons.south,
                "{mode:?}: fresh press starts it"
            );
        }
    }

    /// Uneven "recorded" timing, then edited: playback follows the edited
    /// values exactly (to the millisecond of each frame) in every mode.
    #[test]
    fn edited_timing_is_played_exactly_in_every_mode() {
        let recorded = || {
            let mut m = sample("rec", Some(MacroButton::RightStick));
            m.steps = vec![
                step(&[MacroButton::South], 87, 143),
                step(&[MacroButton::East], 112, 0),
            ];
            m.repeat_delay_ms = 0;
            m
        };
        // Edit after recording: Cross 40 ms, wait 60; Circle 30 ms; repeat pause 20.
        let mut edited = recorded();
        edited.steps[0].hold_ms = 40;
        edited.steps[0].delay_after_ms = 60;
        edited.steps[1].hold_ms = 30;
        edited.repeat_delay_ms = 20;
        assert_eq!(edited.duration_ms(), 130);

        let trig = pressed(MacroButton::RightStick);
        let idle = ControllerState::default();
        // (time ms, Cross, Circle). Cycle = 130 + 20 = 150 ms.
        let expect: [(u64, bool, bool); 9] = [
            (0, true, false),
            (39, true, false),
            (40, false, false), // released after exactly 40 ms
            (99, false, false),
            (100, false, true), // Circle starts after the 60 ms wait
            (129, false, true),
            (130, false, false), // released after 30 ms
            (149, false, false), // repeat pause
            (150, true, false),  // next repeat (looping modes)
        ];
        for mode in [
            PlaybackMode::RepeatWhileHeld,
            PlaybackMode::Toggle,
            PlaybackMode::Once,
        ] {
            let mut m = edited.clone();
            m.mode = mode;
            let t0 = Instant::now();
            let (_, mut r) = runner(vec![m]);
            for (ms, cross, circle) in expect {
                let input = if mode == PlaybackMode::RepeatWhileHeld || ms == 0 {
                    &trig
                } else {
                    &idle
                };
                let out = frame(&mut r, input, at(t0, ms));
                let looping = mode != PlaybackMode::Once;
                let (cross, circle) = if ms >= 150 && !looping {
                    (false, false)
                } else {
                    (cross, circle)
                };
                assert_eq!(
                    (out.buttons.south, out.buttons.east),
                    (cross, circle),
                    "{mode:?} at {ms} ms"
                );
            }
        }
        // The unedited recording keeps its own timing.
        let t0 = Instant::now();
        let mut m = recorded();
        m.mode = PlaybackMode::RepeatWhileHeld;
        let (_, mut r) = runner(vec![m]);
        assert!(
            frame(&mut r, &trig, t0).buttons.south,
            "starts on the trigger"
        );
        assert!(frame(&mut r, &trig, at(t0, 86)).buttons.south);
        assert!(!frame(&mut r, &trig, at(t0, 87)).buttons.south);
        assert!(frame(&mut r, &trig, at(t0, 230)).buttons.east);
    }

    #[test]
    fn playing_changes_are_reported_once_and_match_playing() {
        let t0 = Instant::now();
        let (lib, mut r) = runner(vec![two_step(PlaybackMode::RepeatWhileHeld)]);
        assert!(!r.take_playing_changed(), "idle: nothing to report");
        let trig = pressed(MacroButton::RightStick);
        frame(&mut r, &trig, t0);
        assert!(r.take_playing_changed(), "started");
        assert_eq!(r.playing(), vec!["m".to_string()]);
        for ms in [10, 120, 270, 310] {
            frame(&mut r, &trig, at(t0, ms));
            assert!(
                !r.take_playing_changed(),
                "still playing at {ms} ms (incl. repeat pause)"
            );
        }
        frame(&mut r, &ControllerState::default(), at(t0, 320));
        assert!(r.take_playing_changed(), "stopped on release");
        assert!(r.playing().is_empty());
        // A reload that discards a playing macro is reported too.
        frame(&mut r, &ControllerState::default(), at(t0, 330));
        frame(&mut r, &trig, at(t0, 340));
        assert!(r.take_playing_changed());
        lib.set(vec![two_step(PlaybackMode::RepeatWhileHeld)]);
        frame(&mut r, &trig, at(t0, 350));
        assert!(r.take_playing_changed(), "reload stopped it");
        assert!(r.playing().is_empty());
        assert!(!r.take_playing_changed());
    }

    #[test]
    fn suspension_stops_everything() {
        let t0 = Instant::now();
        let (lib, mut r) = runner(vec![two_step(PlaybackMode::Toggle)]);
        let trig = pressed(MacroButton::RightStick);
        frame(&mut r, &trig, t0);
        lib.set_suspended(true);
        let out = frame(&mut r, &trig, at(t0, 5));
        assert_eq!(
            out, trig,
            "pass-through while suspended, trigger not hidden"
        );
        assert!(r.playing().is_empty());
        lib.set_suspended(false);
        assert!(
            !frame(&mut r, &trig, at(t0, 10)).buttons.south,
            "held trigger is not a new press"
        );
    }

    #[test]
    fn several_macros_combine_and_chords_press_together() {
        let t0 = Instant::now();
        let mut a = two_step(PlaybackMode::Once);
        a.steps = vec![step(
            &[MacroButton::LeftShoulder, MacroButton::RightShoulder],
            100,
            0,
        )];
        let mut b = sample("b", Some(MacroButton::LeftStick));
        b.steps = vec![step(&[MacroButton::DpadUp], 100, 0)];
        let (_, mut r) = runner(vec![a, b]);
        let mut both = pressed(MacroButton::RightStick);
        MacroButton::LeftStick.set(&mut both, true);
        let out = frame(&mut r, &both, t0);
        assert!(out.buttons.left_shoulder && out.buttons.right_shoulder && out.dpad.up());
        assert!(!out.buttons.left_stick && !out.buttons.right_stick);
        assert_eq!(r.playing().len(), 2);
    }

    #[test]
    fn stop_request_cancels_toggled_and_held_macros() {
        let t0 = Instant::now();
        let mut held = two_step(PlaybackMode::RepeatWhileHeld);
        held.id = "held".into();
        held.trigger = Some(MacroButton::LeftStick);
        let (lib, mut r) = runner(vec![two_step(PlaybackMode::Toggle), held]);
        let mut both = pressed(MacroButton::RightStick);
        MacroButton::LeftStick.set(&mut both, true);
        frame(&mut r, &both, t0);
        assert_eq!(r.playing().len(), 2);
        lib.request_stop_all();
        // Trigger still held: nothing restarts until it is pressed again.
        let out = frame(&mut r, &both, at(t0, 5));
        assert!(!out.buttons.south, "no macro output after stop");
        assert!(r.playing().is_empty());
        frame(&mut r, &ControllerState::default(), at(t0, 10));
        assert!(
            frame(&mut r, &pressed(MacroButton::RightStick), at(t0, 20))
                .buttons
                .south,
            "can start again"
        );
    }

    #[test]
    fn stop_all_and_drop_release_presses() {
        let t0 = Instant::now();
        let (_, mut r) = runner(vec![two_step(PlaybackMode::Toggle)]);
        frame(&mut r, &pressed(MacroButton::RightStick), t0);
        r.stop_all();
        let idle = ControllerState::default();
        assert_eq!(frame(&mut r, &idle, at(t0, 5)), idle);
    }
}
