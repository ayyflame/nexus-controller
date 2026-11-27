use crate::MacroButton;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const DEFAULT_HOLD_MS: u32 = 100;
pub const DEFAULT_DELAY_MS: u32 = 150;
pub const DEFAULT_REPEAT_DELAY_MS: u32 = 50;
pub const MIN_HOLD_MS: u32 = 20;
/// Release time needed between two presses of the same button so a game
/// (reading the controller once per frame) sees two presses, not one long
/// press. Recording keeps at least this gap; the editor warns below it.
pub const MIN_RELEASE_GAP_MS: u32 = 20;
pub const MAX_HOLD_MS: u32 = 10_000;
/// Longest "hold to activate" time.
pub const MAX_ACTIVATION_MS: u32 = 3_000;
pub const MAX_DELAY_MS: u32 = 10_000;
pub const MAX_STEPS: usize = 200;
/// Most passes a Play Once macro can make per trigger press.
pub const MAX_REPEAT_COUNT: u32 = 100;
pub const MAX_NAME_LEN: usize = 60;
const MAX_DESCRIPTION_LEN: usize = 300;

/// How the trigger button starts and stops a macro.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackMode {
    /// Press once: the whole sequence plays once.
    #[default]
    Once,
    /// The sequence repeats while the trigger is held and stops on release.
    RepeatWhileHeld,
    /// Press to start repeating, press again to stop.
    Toggle,
}

/// What an action does with its buttons.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    /// Press, hold for `hold_ms`, release, then wait `delay_after_ms`.
    #[default]
    Tap,
    /// Press and keep held until a later [`StepKind::Release`] action (or
    /// the end of the sequence), then wait `delay_after_ms`. Lets one button
    /// stay down while other actions run (e.g. hold L2 while tapping R2).
    Hold,
    /// Release buttons held by an earlier [`StepKind::Hold`], then wait
    /// `delay_after_ms`.
    Release,
}

impl StepKind {
    pub fn is_tap(&self) -> bool {
        *self == StepKind::Tap
    }
}

/// One action in the timeline. A tap presses `buttons` together, holds,
/// releases and waits; a hold or release changes which buttons stay down,
/// then waits.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    /// Stable identifier for editing (assigned by the UI).
    #[serde(default)]
    pub id: String,
    pub buttons: Vec<MacroButton>,
    /// Press time of a tap (unused by hold and release actions).
    pub hold_ms: u32,
    pub delay_after_ms: u32,
    /// Absent in files written before hold and release actions existed: a tap.
    #[serde(default, skip_serializing_if = "StepKind::is_tap")]
    pub kind: StepKind,
}

impl MacroStep {
    /// How long the buttons are pressed by the action itself (taps only).
    pub fn press_ms(&self) -> u32 {
        if self.kind.is_tap() {
            self.hold_ms
        } else {
            0
        }
    }

    /// Time from this action's start to the next action's start.
    pub fn length_ms(&self) -> u64 {
        self.press_ms() as u64 + self.delay_after_ms as u64
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub enabled: bool,
    pub steps: Vec<MacroStep>,
    /// Physical button that starts the macro. `None` = not assigned yet.
    #[serde(default)]
    pub trigger: Option<MacroButton>,
    #[serde(default)]
    pub mode: PlaybackMode,
    /// Pause between repetitions (repeat and toggle modes).
    #[serde(default = "default_repeat_delay")]
    pub repeat_delay_ms: u32,
    /// Hide the trigger button itself from games while it starts a macro.
    #[serde(default = "default_true")]
    pub block_trigger: bool,
    /// Hold to activate: the trigger must be held this long before the macro
    /// acts (0 = on press). Once: plays after the hold. Repeat While Held:
    /// starts repeating after the hold. Toggle: a long press toggles, a tap
    /// doesn't. Releasing still stops at once.
    #[serde(default)]
    pub activation_ms: u32,
    /// Play Once: how many times the sequence plays per trigger press, with
    /// the pause between repeats in between. The looping modes ignore it.
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub repeat_count: u32,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
}

fn default_repeat_delay() -> u32 {
    DEFAULT_REPEAT_DELAY_MS
}
fn default_true() -> bool {
    true
}
fn one() -> u32 {
    1
}
fn is_one(n: &u32) -> bool {
    *n == 1
}

impl Macro {
    /// Total length of one pass through the sequence.
    pub fn duration_ms(&self) -> u64 {
        self.steps.iter().map(MacroStep::length_ms).sum()
    }

    /// Whether this macro needs a build that knows hold/release actions or
    /// repeat counts (used to mark exported files with a newer version).
    pub fn uses_newer_features(&self) -> bool {
        self.repeat_count != 1 || self.steps.iter().any(|s| !s.kind.is_tap())
    }

    /// Whether the engine should react to this macro's trigger.
    pub fn is_armed(&self) -> bool {
        self.enabled && self.trigger.is_some() && !self.steps.is_empty()
    }
}

/// A problem that prevents saving or enabling a macro. `field` tells the UI
/// where to show it; `message` is written for end users.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub field: &'static str,
    pub message: String,
}

/// The button's name on a PlayStation controller, for messages.
fn label(b: MacroButton) -> &'static str {
    match b {
        MacroButton::South => "Cross",
        MacroButton::East => "Circle",
        MacroButton::West => "Square",
        MacroButton::North => "Triangle",
        MacroButton::LeftShoulder => "L1",
        MacroButton::RightShoulder => "R1",
        MacroButton::LeftTrigger => "L2",
        MacroButton::RightTrigger => "R2",
        MacroButton::LeftStick => "L3",
        MacroButton::RightStick => "R3",
        MacroButton::Start => "Options",
        MacroButton::Select => "Create/Share",
        MacroButton::Home => "PS",
        MacroButton::Touchpad => "Touchpad",
        MacroButton::Mute => "Mute",
        MacroButton::DpadUp => "D-pad up",
        MacroButton::DpadDown => "D-pad down",
        MacroButton::DpadLeft => "D-pad left",
        MacroButton::DpadRight => "D-pad right",
    }
}

fn issue(field: &'static str, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue {
        field,
        message: message.into(),
    }
}

/// Validates one macro against the rest of the library (`others` must not
/// contain `m` itself). Returns every problem found.
pub fn validate_macro(m: &Macro, others: &[Macro]) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let name = m.name.trim();
    if name.is_empty() {
        issues.push(issue("name", "Give your macro a name."));
    } else if name.chars().count() > MAX_NAME_LEN {
        issues.push(issue(
            "name",
            format!("Keep the name under {MAX_NAME_LEN} characters."),
        ));
    } else if others
        .iter()
        .any(|o| o.id != m.id && o.name.trim().eq_ignore_ascii_case(name))
    {
        issues.push(issue(
            "name",
            format!("You already have a macro called “{name}”."),
        ));
    }
    if m.description.chars().count() > MAX_DESCRIPTION_LEN {
        issues.push(issue(
            "description",
            format!("Keep the description under {MAX_DESCRIPTION_LEN} characters."),
        ));
    }
    if m.steps.is_empty() {
        issues.push(issue("steps", "Add at least one action to the sequence."));
    }
    if m.steps.len() > MAX_STEPS {
        issues.push(issue(
            "steps",
            format!("A macro can have at most {MAX_STEPS} actions."),
        ));
    }
    // Buttons held by hold actions: (button, action number, held since ms).
    let mut held: Vec<(MacroButton, usize, u64)> = Vec::new();
    let mut t = 0u64;
    for (i, s) in m.steps.iter().enumerate() {
        let n = i + 1;
        if s.buttons.is_empty() {
            issues.push(issue("steps", format!("Action {n} has no button.")));
        }
        let unique: HashSet<_> = s.buttons.iter().collect();
        if unique.len() != s.buttons.len() {
            issues.push(issue(
                "steps",
                format!("Action {n} lists the same button twice."),
            ));
        }
        if s.kind.is_tap() && !(MIN_HOLD_MS..=MAX_HOLD_MS).contains(&s.hold_ms) {
            issues.push(issue(
                "steps",
                format!("Action {n}: press time must be {MIN_HOLD_MS}–{MAX_HOLD_MS} ms."),
            ));
        }
        if s.delay_after_ms > MAX_DELAY_MS {
            issues.push(issue(
                "steps",
                format!("Action {n}: wait time must be at most {MAX_DELAY_MS} ms."),
            ));
        }
        for b in &s.buttons {
            let at = held.iter().position(|(h, _, _)| h == b);
            match (s.kind, at) {
                (StepKind::Tap | StepKind::Hold, Some(k)) => issues.push(issue(
                    "steps",
                    format!(
                        "Action {n} presses {}, which action {} is still holding. Release it first.",
                        label(*b),
                        held[k].1
                    ),
                )),
                (StepKind::Hold, None) => held.push((*b, n, t)),
                (StepKind::Release, None) => issues.push(issue(
                    "steps",
                    format!(
                        "Action {n} releases {}, which isn't held at that point.",
                        label(*b)
                    ),
                )),
                (StepKind::Release, Some(k)) => {
                    if t - held[k].2 < MIN_HOLD_MS as u64 {
                        issues.push(issue(
                            "steps",
                            format!(
                                "Action {n} releases {} {} ms after action {} pressed it; keep it down at least {MIN_HOLD_MS} ms.",
                                label(*b),
                                t - held[k].2,
                                held[k].1
                            ),
                        ));
                    }
                    held.remove(k);
                }
                (StepKind::Tap, None) => {}
            }
        }
        t += s.length_ms();
    }
    if !(1..=MAX_REPEAT_COUNT).contains(&m.repeat_count) {
        issues.push(issue(
            "repeatCount",
            format!("Repeat count must be 1–{MAX_REPEAT_COUNT}."),
        ));
    }
    if m.activation_ms > MAX_ACTIVATION_MS {
        issues.push(issue(
            "activationMs",
            format!("Hold-to-activate time must be at most {MAX_ACTIVATION_MS} ms."),
        ));
    }
    if m.repeat_delay_ms > MAX_DELAY_MS {
        issues.push(issue(
            "repeatDelayMs",
            format!("Pause between repeats must be at most {MAX_DELAY_MS} ms."),
        ));
    }
    if let Some(t) = m.trigger {
        if !t.can_trigger() {
            issues.push(issue(
                "trigger",
                "The PS button is reserved by the system. Choose another button.",
            ));
        }
        if m.enabled {
            if let Some(other) = others
                .iter()
                .find(|o| o.id != m.id && o.enabled && o.trigger == Some(t))
            {
                issues.push(issue(
                    "trigger",
                    format!(
                        "This button already starts “{}”. Choose another button or turn that macro off.",
                        other.name.trim()
                    ),
                ));
            }
        }
    }
    issues
}

/// Validates a whole library (used before handing it to the engine).
pub fn validate_library(macros: &[Macro]) -> Vec<(String, ValidationIssue)> {
    let mut out = Vec::new();
    for (i, m) in macros.iter().enumerate() {
        let others: Vec<Macro> = macros
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, o)| o.clone())
            .collect();
        for issue in validate_macro(m, &others) {
            out.push((m.id.clone(), issue));
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn step(buttons: &[MacroButton], hold_ms: u32, delay_after_ms: u32) -> MacroStep {
        MacroStep {
            id: String::new(),
            buttons: buttons.to_vec(),
            hold_ms,
            delay_after_ms,
            kind: StepKind::Tap,
        }
    }

    pub fn hold(buttons: &[MacroButton], delay_after_ms: u32) -> MacroStep {
        MacroStep {
            kind: StepKind::Hold,
            ..step(buttons, 0, delay_after_ms)
        }
    }

    pub fn release(buttons: &[MacroButton], delay_after_ms: u32) -> MacroStep {
        MacroStep {
            kind: StepKind::Release,
            ..step(buttons, 0, delay_after_ms)
        }
    }

    pub fn sample(id: &str, trigger: Option<MacroButton>) -> Macro {
        Macro {
            id: id.into(),
            name: format!("Macro {id}"),
            description: String::new(),
            enabled: true,
            steps: vec![step(&[MacroButton::South], 100, 50)],
            trigger,
            mode: PlaybackMode::Once,
            repeat_delay_ms: DEFAULT_REPEAT_DELAY_MS,
            block_trigger: true,
            activation_ms: 0,
            repeat_count: 1,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn valid_macro_has_no_issues() {
        assert!(validate_macro(&sample("a", Some(MacroButton::RightStick)), &[]).is_empty());
    }

    #[test]
    fn reports_user_friendly_issues() {
        let mut m = sample("a", Some(MacroButton::Home));
        m.name = "  ".into();
        m.steps = vec![
            step(&[], 5, 20_000),
            step(&[MacroButton::East, MacroButton::East], 100, 0),
        ];
        let fields: Vec<_> = validate_macro(&m, &[]).iter().map(|i| i.field).collect();
        assert!(fields.contains(&"name"));
        assert!(fields.contains(&"trigger"));
        assert_eq!(fields.iter().filter(|f| **f == "steps").count(), 4);
    }

    #[test]
    fn empty_sequence_is_invalid() {
        let mut m = sample("a", None);
        m.steps.clear();
        assert_eq!(validate_macro(&m, &[])[0].field, "steps");
    }

    #[test]
    fn conflicting_triggers_only_between_enabled_macros() {
        let a = sample("a", Some(MacroButton::RightStick));
        let b = sample("b", Some(MacroButton::RightStick));
        let issues = validate_macro(&b, std::slice::from_ref(&a));
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("Macro a"));

        let mut b = b;
        b.name = "Different".into();
        let mut disabled = b.clone();
        disabled.enabled = false;
        assert!(validate_macro(&disabled, std::slice::from_ref(&a)).is_empty());
        assert_eq!(validate_library(&[a, b]).len(), 2);
    }

    #[test]
    fn duplicate_names_are_rejected_case_insensitively() {
        let a = sample("a", None);
        let mut b = sample("b", None);
        b.name = "  MACRO A ".into();
        let issues = validate_macro(&b, &[a]);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].field, "name");
    }

    #[test]
    fn json_round_trip_and_defaults() {
        let m = sample("a", Some(MacroButton::DpadUp));
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains(r#""trigger":"dpadUp""#));
        assert!(json.contains(r#""mode":"once""#));
        assert_eq!(serde_json::from_str::<Macro>(&json).unwrap(), m);

        let minimal: Macro = serde_json::from_str(
            r#"{"name":"x","steps":[{"buttons":["south"],"holdMs":100,"delayAfterMs":0}]}"#,
        )
        .unwrap();
        assert_eq!(minimal.repeat_delay_ms, DEFAULT_REPEAT_DELAY_MS);
        assert!(minimal.block_trigger);
        assert!(!minimal.enabled);
        assert_eq!(minimal.mode, PlaybackMode::Once);
    }

    #[test]
    fn hold_and_release_actions_are_checked() {
        use MacroButton::{LeftTrigger as L2, RightTrigger as R2};
        let mut m = sample("a", Some(MacroButton::RightStick));
        m.steps = vec![hold(&[L2], 50), step(&[R2], 40, 30), release(&[L2], 0)];
        assert!(
            validate_macro(&m, &[]).is_empty(),
            "{:?}",
            validate_macro(&m, &[])
        );
        assert_eq!(
            m.duration_ms(),
            120,
            "hold and release take only their wait"
        );
        let msgs = |steps: Vec<MacroStep>| {
            let mut m = m.clone();
            m.steps = steps;
            validate_macro(&m, &[])
                .into_iter()
                .map(|i| i.message)
                .collect::<Vec<_>>()
        };
        assert!(msgs(vec![release(&[L2], 0)])[0].contains("releases L2, which isn't held"));
        assert!(msgs(vec![hold(&[L2], 50), step(&[L2], 40, 0)])[0]
            .contains("presses L2, which action 1 is still holding"));
        assert!(msgs(vec![hold(&[L2], 50), hold(&[L2], 50)])[0].contains("still holding"));
        assert!(msgs(vec![hold(&[L2], 5), release(&[L2], 0)])[0].contains("5 ms after action 1"));
        // Hold and release ignore the press time; taps still need one.
        assert!(msgs(vec![hold(&[L2], 50), release(&[L2], 0)]).is_empty());
        m.repeat_count = 0;
        assert_eq!(validate_macro(&m, &[])[0].field, "repeatCount");
        m.repeat_count = MAX_REPEAT_COUNT + 1;
        assert_eq!(validate_macro(&m, &[])[0].field, "repeatCount");
    }

    #[test]
    fn files_without_the_new_fields_read_as_before_and_taps_are_written_as_before() {
        let old: Macro = serde_json::from_str(
            r#"{"name":"x","steps":[{"buttons":["south"],"holdMs":100,"delayAfterMs":0}]}"#,
        )
        .unwrap();
        assert_eq!(old.steps[0].kind, StepKind::Tap);
        assert_eq!(old.repeat_count, 1);
        assert!(!old.uses_newer_features());
        let json = serde_json::to_string(&old).unwrap();
        assert!(
            !json.contains("kind") && !json.contains("repeatCount"),
            "unchanged format for unchanged macros: {json}"
        );
        let mut new = old.clone();
        new.steps = vec![
            hold(&[MacroButton::LeftTrigger], 50),
            release(&[MacroButton::LeftTrigger], 0),
        ];
        new.repeat_count = 2;
        let json = serde_json::to_string(&new).unwrap();
        assert!(json.contains(r#""kind":"hold""#) && json.contains(r#""repeatCount":2"#));
        assert_eq!(serde_json::from_str::<Macro>(&json).unwrap(), new);
        assert!(new.uses_newer_features());
    }

    #[test]
    fn duration_and_armed() {
        let mut m = sample("a", None);
        m.steps.push(step(&[MacroButton::North], 200, 100));
        assert_eq!(m.duration_ms(), 450);
        assert!(!m.is_armed(), "no trigger");
        m.trigger = Some(MacroButton::LeftStick);
        assert!(m.is_armed());
        m.enabled = false;
        assert!(!m.is_armed());
    }
}
