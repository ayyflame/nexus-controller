use nexus_controller_core::{ControllerState, DpadDirection};
use serde::{Deserialize, Serialize};

/// Every digital input a macro can press or be triggered by. Analog triggers
/// count as pressed at half travel and are pressed fully by macros.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MacroButton {
    South,
    East,
    West,
    North,
    LeftShoulder,
    RightShoulder,
    LeftTrigger,
    RightTrigger,
    LeftStick,
    RightStick,
    Start,
    Select,
    Home,
    Touchpad,
    Mute,
    DpadUp,
    DpadDown,
    DpadLeft,
    DpadRight,
}

/// Analog trigger travel at which a trigger counts as pressed.
pub const TRIGGER_THRESHOLD: f32 = 0.5;

impl MacroButton {
    /// Bit used in compact button sets (`u32` masks).
    pub fn bit(self) -> u32 {
        1 << (self as u32)
    }

    /// All buttons whose bit is set in `mask`.
    pub fn from_mask(mask: u32) -> impl Iterator<Item = MacroButton> {
        Self::ALL.into_iter().filter(move |b| mask & b.bit() != 0)
    }

    /// Mask of every button pressed in `s`.
    pub fn mask_of(s: &ControllerState) -> u32 {
        Self::ALL
            .iter()
            .filter(|b| b.is_pressed(s))
            .fold(0, |m, b| m | b.bit())
    }

    pub const ALL: [MacroButton; 19] = [
        MacroButton::South,
        MacroButton::East,
        MacroButton::West,
        MacroButton::North,
        MacroButton::LeftShoulder,
        MacroButton::RightShoulder,
        MacroButton::LeftTrigger,
        MacroButton::RightTrigger,
        MacroButton::LeftStick,
        MacroButton::RightStick,
        MacroButton::Start,
        MacroButton::Select,
        MacroButton::Home,
        MacroButton::Touchpad,
        MacroButton::Mute,
        MacroButton::DpadUp,
        MacroButton::DpadDown,
        MacroButton::DpadLeft,
        MacroButton::DpadRight,
    ];

    /// Whether this button may start a macro. The PS button is reserved for
    /// the system.
    pub fn can_trigger(self) -> bool {
        self != MacroButton::Home
    }

    pub fn is_pressed(self, s: &ControllerState) -> bool {
        let b = &s.buttons;
        match self {
            MacroButton::South => b.south,
            MacroButton::East => b.east,
            MacroButton::West => b.west,
            MacroButton::North => b.north,
            MacroButton::LeftShoulder => b.left_shoulder,
            MacroButton::RightShoulder => b.right_shoulder,
            MacroButton::LeftTrigger => s.left_trigger.value >= TRIGGER_THRESHOLD,
            MacroButton::RightTrigger => s.right_trigger.value >= TRIGGER_THRESHOLD,
            MacroButton::LeftStick => b.left_stick,
            MacroButton::RightStick => b.right_stick,
            MacroButton::Start => b.start,
            MacroButton::Select => b.select,
            MacroButton::Home => b.home,
            MacroButton::Touchpad => b.touchpad,
            MacroButton::Mute => b.mute,
            MacroButton::DpadUp => s.dpad.up(),
            MacroButton::DpadDown => s.dpad.down(),
            MacroButton::DpadLeft => s.dpad.left(),
            MacroButton::DpadRight => s.dpad.right(),
        }
    }

    /// Sets this button pressed or released in `s`.
    pub fn set(self, s: &mut ControllerState, pressed: bool) {
        let b = &mut s.buttons;
        match self {
            MacroButton::South => b.south = pressed,
            MacroButton::East => b.east = pressed,
            MacroButton::West => b.west = pressed,
            MacroButton::North => b.north = pressed,
            MacroButton::LeftShoulder => b.left_shoulder = pressed,
            MacroButton::RightShoulder => b.right_shoulder = pressed,
            MacroButton::LeftTrigger => set_trigger(&mut s.left_trigger, pressed),
            MacroButton::RightTrigger => set_trigger(&mut s.right_trigger, pressed),
            MacroButton::LeftStick => b.left_stick = pressed,
            MacroButton::RightStick => b.right_stick = pressed,
            MacroButton::Start => b.start = pressed,
            MacroButton::Select => b.select = pressed,
            MacroButton::Home => b.home = pressed,
            MacroButton::Touchpad => b.touchpad = pressed,
            MacroButton::Mute => b.mute = pressed,
            // D-pad presses are applied here; releases in `clear_dpad`.
            MacroButton::DpadUp if pressed => set_dpad(s, Some(true), None),
            MacroButton::DpadDown if pressed => set_dpad(s, Some(false), None),
            MacroButton::DpadLeft if pressed => set_dpad(s, None, Some(true)),
            MacroButton::DpadRight if pressed => set_dpad(s, None, Some(false)),
            MacroButton::DpadUp
            | MacroButton::DpadDown
            | MacroButton::DpadLeft
            | MacroButton::DpadRight => {}
        }
        if !pressed {
            self.clear_dpad(s);
        }
    }

    fn clear_dpad(self, s: &mut ControllerState) {
        let (up, down, left, right) = (s.dpad.up(), s.dpad.down(), s.dpad.left(), s.dpad.right());
        let (up, down, left, right) = match self {
            MacroButton::DpadUp => (false, down, left, right),
            MacroButton::DpadDown => (up, false, left, right),
            MacroButton::DpadLeft => (up, down, false, right),
            MacroButton::DpadRight => (up, down, left, false),
            _ => return,
        };
        s.dpad = dpad_from(up, down, left, right);
    }
}

fn set_trigger(t: &mut nexus_controller_core::TriggerState, pressed: bool) {
    if pressed {
        t.value = 1.0;
        t.raw = 255;
        t.digital = true;
    } else {
        t.value = 0.0;
        t.raw = 0;
        t.digital = false;
    }
}

/// Presses a vertical (`Some(true)` = up) and/or horizontal (`Some(true)` =
/// left) D-pad direction, keeping the other axis as it is.
fn set_dpad(s: &mut ControllerState, vertical: Option<bool>, horizontal: Option<bool>) {
    let (mut up, mut down, mut left, mut right) =
        (s.dpad.up(), s.dpad.down(), s.dpad.left(), s.dpad.right());
    if let Some(v) = vertical {
        up = v;
        down = !v;
    }
    if let Some(h) = horizontal {
        left = h;
        right = !h;
    }
    s.dpad = dpad_from(up, down, left, right);
}

fn dpad_from(up: bool, down: bool, left: bool, right: bool) -> DpadDirection {
    match (up && !down, down && !up, left && !right, right && !left) {
        (true, _, true, _) => DpadDirection::UpLeft,
        (true, _, _, true) => DpadDirection::UpRight,
        (_, true, true, _) => DpadDirection::DownLeft,
        (_, true, _, true) => DpadDirection::DownRight,
        (true, _, _, _) => DpadDirection::Up,
        (_, true, _, _) => DpadDirection::Down,
        (_, _, true, _) => DpadDirection::Left,
        (_, _, _, true) => DpadDirection::Right,
        _ => DpadDirection::Neutral,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_then_read_round_trips_for_every_button() {
        for b in MacroButton::ALL {
            let mut s = ControllerState::default();
            b.set(&mut s, true);
            assert!(b.is_pressed(&s), "{b:?} not pressed after set");
            for other in MacroButton::ALL.iter().filter(|o| **o != b) {
                assert!(!other.is_pressed(&s), "{b:?} also pressed {other:?}");
            }
            b.set(&mut s, false);
            assert!(!b.is_pressed(&s), "{b:?} still pressed after release");
            assert_eq!(s, ControllerState::default(), "{b:?} release left residue");
        }
    }

    #[test]
    fn dpad_diagonals_combine_and_release_independently() {
        let mut s = ControllerState::default();
        MacroButton::DpadUp.set(&mut s, true);
        MacroButton::DpadRight.set(&mut s, true);
        assert_eq!(s.dpad, DpadDirection::UpRight);
        MacroButton::DpadUp.set(&mut s, false);
        assert_eq!(s.dpad, DpadDirection::Right);
    }

    #[test]
    fn analog_trigger_threshold() {
        let mut s = ControllerState::default();
        s.left_trigger.value = 0.49;
        assert!(!MacroButton::LeftTrigger.is_pressed(&s));
        s.left_trigger.value = 0.5;
        assert!(MacroButton::LeftTrigger.is_pressed(&s));
    }

    #[test]
    fn home_cannot_trigger() {
        assert!(!MacroButton::Home.can_trigger());
        assert!(MacroButton::RightStick.can_trigger());
    }
}
