use crate::buttons::MacroButton;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const DEFAULT_HOLD_MS: u32 = 100;
pub const DEFAULT_DELAY_MS: u32 = 150;
pub const DEFAULT_REPEAT_DELAY_MS: u32 = 50;
pub const MIN_HOLD_MS: u32 = 20;
pub const MAX_HOLD_MS: u32 = 10_000;
pub const MAX_DELAY_MS: u32 = 10_000;
pub const MAX_STEPS: usize = 200;
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

/// One block in the timeline: press `buttons` together, hold, release, wait.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    /// Stable identifier for editing (assigned by the UI).
    #[serde(default)]
    pub id: String,
    pub buttons: Vec<MacroButton>,
    pub hold_ms: u32,
    pub delay_after_ms: u32,
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

impl Macro {
    /// Total length of one pass through the sequence.
    pub fn duration_ms(&self) -> u64 {
        self.steps
            .iter()
            .map(|s| s.hold_ms as u64 + s.delay_after_ms as u64)
            .sum()
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
        if !(MIN_HOLD_MS..=MAX_HOLD_MS).contains(&s.hold_ms) {
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
