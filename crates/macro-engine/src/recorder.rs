use crate::model::{MacroStep, MAX_DELAY_MS, MAX_HOLD_MS, MIN_HOLD_MS, MIN_RELEASE_GAP_MS};
use crate::MacroButton;
use nexus_controller_core::ControllerState;
use serde::Serialize;
use std::time::Instant;

/// Recording stops on its own after this long.
pub const MAX_RECORDING_MS: u64 = 60_000;
/// …or after this many button presses.
pub const MAX_RECORDED_PRESSES: usize = 200;
/// Presses starting within this window become one combined action.
const CHORD_WINDOW_MS: u64 = 50;

#[derive(Clone, Copy, Debug)]
struct Event {
    at_ms: u64,
    button: MacroButton,
    down: bool,
}

/// Captures button presses, releases and timing from live physical input.
///
/// Buttons already held when recording starts are ignored until they are
/// released, so the press that started recording is not captured.
#[derive(Debug)]
pub struct MacroRecorder {
    began: Instant,
    last_mask: Option<u32>,
    ignore_mask: u32,
    events: Vec<Event>,
    presses: usize,
    limit_reached: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub steps: Vec<MacroStep>,
    /// Time from the first press to the last release.
    pub duration_ms: u64,
    pub presses: usize,
    /// Recording hit the time or press limit and stopped early.
    pub limit_reached: bool,
}

impl MacroRecorder {
    pub fn new(now: Instant) -> Self {
        Self {
            began: now,
            last_mask: None,
            ignore_mask: 0,
            events: Vec::new(),
            presses: 0,
            limit_reached: false,
        }
    }

    fn ms(&self, now: Instant) -> u64 {
        now.saturating_duration_since(self.began).as_millis() as u64
    }

    /// Feeds one physical input report. Returns `false` once a limit is hit.
    pub fn feed(&mut self, state: &ControllerState, now: Instant) -> bool {
        if self.limit_reached {
            return false;
        }
        let at_ms = self.ms(now);
        if at_ms > MAX_RECORDING_MS {
            self.limit_reached = true;
            return false;
        }
        let mask = MacroButton::mask_of(state);
        let Some(last) = self.last_mask else {
            self.last_mask = Some(mask);
            self.ignore_mask = mask;
            return true;
        };
        let changed = mask ^ last;
        for button in MacroButton::from_mask(changed) {
            let down = mask & button.bit() != 0;
            if self.ignore_mask & button.bit() != 0 {
                if !down {
                    self.ignore_mask &= !button.bit();
                }
                continue;
            }
            if down {
                if self.presses == MAX_RECORDED_PRESSES {
                    self.limit_reached = true;
                    break;
                }
                self.presses += 1;
            }
            self.events.push(Event {
                at_ms,
                button,
                down,
            });
        }
        self.last_mask = Some(mask);
        !self.limit_reached
    }

    pub fn elapsed_ms(&self, now: Instant) -> u64 {
        self.ms(now).min(MAX_RECORDING_MS)
    }

    pub fn presses(&self) -> usize {
        self.presses
    }

    pub fn limit_reached(&self) -> bool {
        self.limit_reached
    }

    /// Buttons currently held that are being recorded.
    pub fn held(&self) -> Vec<MacroButton> {
        let mask = self.last_mask.unwrap_or(0) & !self.ignore_mask;
        MacroButton::from_mask(mask).collect()
    }

    /// Converts the captured events into timeline steps.
    ///
    /// * Presses that start within 50 ms of each other become one combined
    ///   action (e.g. L1 + R1).
    /// * Buttons still held when recording stops are released at `now`.
    /// * Overlapping presses are made sequential: an action is released when
    ///   the next one starts.
    /// * Times are clamped to the editor's limits.
    pub fn finish(self, now: Instant) -> RecordingResult {
        let end_ms = self.ms(now).min(MAX_RECORDING_MS);
        // (button, start, end) intervals.
        let mut intervals: Vec<(MacroButton, u64, u64)> = Vec::new();
        let mut open: Vec<(MacroButton, u64)> = Vec::new();
        for e in &self.events {
            if e.down {
                open.push((e.button, e.at_ms));
            } else if let Some(i) = open.iter().position(|(b, _)| *b == e.button) {
                let (b, start) = open.remove(i);
                intervals.push((b, start, e.at_ms));
            }
        }
        intervals.extend(open.into_iter().map(|(b, start)| (b, start, end_ms)));
        intervals.sort_by_key(|&(b, start, _)| (start, b));

        // Group into chords: (start, end, buttons).
        let mut groups: Vec<(u64, u64, Vec<MacroButton>)> = Vec::new();
        for (b, start, end) in intervals {
            match groups.last_mut() {
                // Only presses that start while the group is still held
                // are "pressed together"; a quick tap after a release is
                // its own action.
                Some(g) if start - g.0 <= CHORD_WINDOW_MS && start < g.1 && !g.2.contains(&b) => {
                    g.1 = g.1.max(end);
                    g.2.push(b);
                }
                _ => groups.push((start, end, vec![b])),
            }
        }

        let first = groups.first().map_or(0, |g| g.0);
        let last_end = groups.iter().map(|g| g.1).max().unwrap_or(first);
        let mut steps = Vec::with_capacity(groups.len());
        for (i, (start, end, buttons)) in groups.iter().enumerate() {
            let next_start = groups.get(i + 1).map(|g| g.0);
            let mut hold = end - start;
            if let Some(next) = next_start {
                hold = hold.min(next - start);
            }
            let hold = (hold as u32).clamp(MIN_HOLD_MS, MAX_HOLD_MS);
            let delay = next_start
                .map(|next| next.saturating_sub(start + hold as u64))
                .unwrap_or(0)
                .min(MAX_DELAY_MS as u64) as u32;
            steps.push(MacroStep {
                id: format!("rec-{i}"),
                buttons: buttons.clone(),
                hold_ms: hold,
                delay_after_ms: delay,
            });
        }

        keep_release_gaps(&mut steps);

        RecordingResult {
            steps,
            duration_ms: last_end - first,
            presses: self.presses,
            limit_reached: self.limit_reached,
        }
    }
}

/// Two consecutive actions that press the same button need a release in
/// between, or playback would merge them into one long press. Takes the gap
/// from the first action's press time where possible, otherwise adds it.
fn keep_release_gaps(steps: &mut [MacroStep]) {
    for i in 1..steps.len() {
        let shares = steps[i]
            .buttons
            .iter()
            .any(|b| steps[i - 1].buttons.contains(b));
        let prev = &mut steps[i - 1];
        if !shares || prev.delay_after_ms >= MIN_RELEASE_GAP_MS {
            continue;
        }
        let needed = MIN_RELEASE_GAP_MS - prev.delay_after_ms;
        let take = needed.min(prev.hold_ms.saturating_sub(MIN_HOLD_MS));
        prev.hold_ms -= take;
        prev.delay_after_ms = (prev.delay_after_ms + take).max(MIN_RELEASE_GAP_MS);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct Script {
        rec: MacroRecorder,
        t0: Instant,
        state: ControllerState,
    }

    impl Script {
        fn new() -> Self {
            let t0 = Instant::now();
            let mut rec = MacroRecorder::new(t0);
            let state = ControllerState::default();
            rec.feed(&state, t0);
            Self { rec, t0, state }
        }
        fn set(&mut self, ms: u64, b: MacroButton, down: bool) -> &mut Self {
            b.set(&mut self.state, down);
            self.rec
                .feed(&self.state, self.t0 + Duration::from_millis(ms));
            self
        }
        fn finish(self, ms: u64) -> RecordingResult {
            self.rec.finish(self.t0 + Duration::from_millis(ms))
        }
    }

    fn summary(r: &RecordingResult) -> Vec<(Vec<MacroButton>, u32, u32)> {
        r.steps
            .iter()
            .map(|s| (s.buttons.clone(), s.hold_ms, s.delay_after_ms))
            .collect()
    }

    #[test]
    fn records_sequential_presses_with_timing_and_trims_leading_silence() {
        let mut s = Script::new();
        s.set(1000, MacroButton::South, true)
            .set(1120, MacroButton::South, false)
            .set(1300, MacroButton::East, true)
            .set(1380, MacroButton::East, false);
        let r = s.finish(2000);
        assert_eq!(
            summary(&r),
            vec![
                (vec![MacroButton::South], 120, 180),
                (vec![MacroButton::East], 80, 0),
            ]
        );
        assert_eq!(r.duration_ms, 380);
        assert_eq!(r.presses, 2);
    }

    #[test]
    fn near_simultaneous_presses_become_one_combined_action() {
        let mut s = Script::new();
        s.set(100, MacroButton::LeftShoulder, true)
            .set(130, MacroButton::RightShoulder, true)
            .set(300, MacroButton::LeftShoulder, false)
            .set(320, MacroButton::RightShoulder, false);
        let r = s.finish(500);
        assert_eq!(
            summary(&r),
            vec![(
                vec![MacroButton::LeftShoulder, MacroButton::RightShoulder],
                220,
                0
            )]
        );
    }

    #[test]
    fn overlapping_presses_are_made_sequential() {
        let mut s = Script::new();
        s.set(0, MacroButton::South, true)
            .set(200, MacroButton::East, true) // Cross still held
            .set(300, MacroButton::South, false)
            .set(400, MacroButton::East, false);
        let r = s.finish(500);
        assert_eq!(
            summary(&r),
            vec![
                (vec![MacroButton::South], 200, 0),
                (vec![MacroButton::East], 200, 0)
            ]
        );
    }

    #[test]
    fn button_held_at_start_is_ignored_until_pressed_again() {
        let t0 = Instant::now();
        let mut rec = MacroRecorder::new(t0);
        let mut st = ControllerState::default();
        MacroButton::RightStick.set(&mut st, true);
        rec.feed(&st, t0); // already held
        assert!(rec.held().is_empty());
        MacroButton::RightStick.set(&mut st, false);
        rec.feed(&st, t0 + Duration::from_millis(50));
        MacroButton::North.set(&mut st, true);
        rec.feed(&st, t0 + Duration::from_millis(100));
        assert_eq!(rec.held(), vec![MacroButton::North]);
        let r = rec.finish(t0 + Duration::from_millis(400)); // still held at stop
        assert_eq!(summary(&r), vec![(vec![MacroButton::North], 300, 0)]);
    }

    #[test]
    fn very_short_taps_are_clamped_to_minimum_hold() {
        let mut s = Script::new();
        s.set(10, MacroButton::West, true)
            .set(14, MacroButton::West, false);
        assert_eq!(
            summary(&s.finish(100)),
            vec![(vec![MacroButton::West], MIN_HOLD_MS, 0)]
        );
    }

    #[test]
    fn quick_taps_of_different_buttons_stay_separate_actions() {
        // Square released before Triangle is pressed, 40 ms apart: two
        // actions, not a combined "pressed together" action.
        let mut s = Script::new();
        s.set(0, MacroButton::West, true)
            .set(30, MacroButton::West, false)
            .set(40, MacroButton::North, true)
            .set(70, MacroButton::North, false);
        assert_eq!(
            summary(&s.finish(200)),
            vec![
                (vec![MacroButton::West], 30, 10),
                (vec![MacroButton::North], 30, 0)
            ]
        );
    }

    #[test]
    fn rapid_taps_of_the_same_button_keep_a_release_gap() {
        // Very fast taps (10 ms press, 15 ms apart) must not merge into one
        // long press when played back.
        let mut s = Script::new();
        for k in 0..3u64 {
            s.set(k * 25, MacroButton::North, true)
                .set(k * 25 + 10, MacroButton::North, false);
        }
        let r = s.finish(200);
        assert_eq!(r.steps.len(), 3);
        for w in r.steps.windows(2) {
            assert!(
                w[0].delay_after_ms >= MIN_RELEASE_GAP_MS,
                "{:?}",
                summary(&r)
            );
            assert!(w[0].hold_ms >= MIN_HOLD_MS);
        }
    }

    #[test]
    fn twenty_rapid_taps_are_all_recorded_with_their_timing() {
        let mut s = Script::new();
        for k in 0..20u64 {
            s.set(k * 80, MacroButton::North, true)
                .set(k * 80 + 40, MacroButton::North, false);
        }
        let r = s.finish(2000);
        assert_eq!(r.presses, 20);
        assert_eq!(r.steps.len(), 20);
        assert!(r.steps[..19]
            .iter()
            .all(|x| (x.hold_ms, x.delay_after_ms) == (40, 40)));
        assert_eq!((r.steps[19].hold_ms, r.steps[19].delay_after_ms), (40, 0));
    }

    #[test]
    fn nothing_pressed_gives_empty_result() {
        let r = Script::new().finish(3000);
        assert!(r.steps.is_empty());
        assert_eq!(r.duration_ms, 0);
    }

    #[test]
    fn press_limit_stops_recording() {
        let mut s = Script::new();
        let mut t = 0;
        for _ in 0..(MAX_RECORDED_PRESSES + 5) {
            s.set(t, MacroButton::South, true);
            s.set(t + 20, MacroButton::South, false);
            t += 100;
        }
        assert!(s.rec.limit_reached());
        let r = s.finish(t);
        assert_eq!(r.steps.len(), MAX_RECORDED_PRESSES);
        assert!(r.limit_reached);
    }

    #[test]
    fn time_limit_stops_recording() {
        let mut s = Script::new();
        s.set(MAX_RECORDING_MS + 1, MacroButton::South, true);
        assert!(s.rec.limit_reached());
        assert!(s.finish(MAX_RECORDING_MS + 10).steps.is_empty());
    }

    #[test]
    fn analog_triggers_and_dpad_are_recorded() {
        let mut s = Script::new();
        s.state.right_trigger.value = 0.8;
        s.rec.feed(&s.state, s.t0 + Duration::from_millis(100));
        s.state.right_trigger.value = 0.1;
        s.rec.feed(&s.state, s.t0 + Duration::from_millis(250));
        s.set(400, MacroButton::DpadLeft, true)
            .set(450, MacroButton::DpadLeft, false);
        assert_eq!(
            summary(&s.finish(600)),
            vec![
                (vec![MacroButton::RightTrigger], 150, 150),
                (vec![MacroButton::DpadLeft], 50, 0),
            ]
        );
    }
}
