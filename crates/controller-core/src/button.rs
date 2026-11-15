use crate::state::{ControllerState, DpadDirection, TriggerState};
use serde::{Deserialize, Serialize};

/// Every digital input NEXUS can read, remap, press or use as a macro
/// trigger. Analog triggers count as pressed at half travel and are pressed
/// fully when set.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Button {
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

impl Button {
    /// Bit used in compact button sets (`u32` masks).
    pub fn bit(self) -> u32 {
        1 << (self as u32)
    }

    /// All buttons whose bit is set in `mask`.
    pub fn from_mask(mask: u32) -> impl Iterator<Item = Button> {
        Self::ALL.into_iter().filter(move |b| mask & b.bit() != 0)
    }

    /// Mask of every button pressed in `s`.
    pub fn mask_of(s: &ControllerState) -> u32 {
        Self::ALL
            .iter()
            .filter(|b| b.is_pressed(s))
            .fold(0, |m, b| m | b.bit())
    }

    pub const ALL: [Button; 19] = [
        Button::South,
        Button::East,
        Button::West,
        Button::North,
        Button::LeftShoulder,
        Button::RightShoulder,
        Button::LeftTrigger,
        Button::RightTrigger,
        Button::LeftStick,
        Button::RightStick,
        Button::Start,
        Button::Select,
        Button::Home,
        Button::Touchpad,
        Button::Mute,
        Button::DpadUp,
        Button::DpadDown,
        Button::DpadLeft,
        Button::DpadRight,
    ];

    /// Whether this button may start a macro. The PS button is reserved for
    /// the system.
    pub fn can_trigger(self) -> bool {
        self != Button::Home
    }

    pub fn is_pressed(self, s: &ControllerState) -> bool {
        let b = &s.buttons;
        match self {
            Button::South => b.south,
            Button::East => b.east,
            Button::West => b.west,
            Button::North => b.north,
            Button::LeftShoulder => b.left_shoulder,
            Button::RightShoulder => b.right_shoulder,
            Button::LeftTrigger => s.left_trigger.value >= TRIGGER_THRESHOLD,
            Button::RightTrigger => s.right_trigger.value >= TRIGGER_THRESHOLD,
            Button::LeftStick => b.left_stick,
            Button::RightStick => b.right_stick,
            Button::Start => b.start,
            Button::Select => b.select,
            Button::Home => b.home,
            Button::Touchpad => b.touchpad,
            Button::Mute => b.mute,
            Button::DpadUp => s.dpad.up(),
            Button::DpadDown => s.dpad.down(),
            Button::DpadLeft => s.dpad.left(),
            Button::DpadRight => s.dpad.right(),
        }
    }

    /// Sets this button pressed or released in `s`.
    pub fn set(self, s: &mut ControllerState, pressed: bool) {
        let b = &mut s.buttons;
        match self {
            Button::South => b.south = pressed,
            Button::East => b.east = pressed,
            Button::West => b.west = pressed,
            Button::North => b.north = pressed,
            Button::LeftShoulder => b.left_shoulder = pressed,
            Button::RightShoulder => b.right_shoulder = pressed,
            Button::LeftTrigger => set_trigger(&mut s.left_trigger, pressed),
            Button::RightTrigger => set_trigger(&mut s.right_trigger, pressed),
            Button::LeftStick => b.left_stick = pressed,
            Button::RightStick => b.right_stick = pressed,
            Button::Start => b.start = pressed,
            Button::Select => b.select = pressed,
            Button::Home => b.home = pressed,
            Button::Touchpad => b.touchpad = pressed,
            Button::Mute => b.mute = pressed,
            // D-pad presses are applied here; releases in `clear_dpad`.
            Button::DpadUp if pressed => set_dpad(s, Some(true), None),
            Button::DpadDown if pressed => set_dpad(s, Some(false), None),
            Button::DpadLeft if pressed => set_dpad(s, None, Some(true)),
            Button::DpadRight if pressed => set_dpad(s, None, Some(false)),
            Button::DpadUp | Button::DpadDown | Button::DpadLeft | Button::DpadRight => {}
        }
        if !pressed {
            self.clear_dpad(s);
        }
    }

    fn clear_dpad(self, s: &mut ControllerState) {
        let (up, down, left, right) = (s.dpad.up(), s.dpad.down(), s.dpad.left(), s.dpad.right());
        let (up, down, left, right) = match self {
            Button::DpadUp => (false, down, left, right),
            Button::DpadDown => (up, false, left, right),
            Button::DpadLeft => (up, down, false, right),
            Button::DpadRight => (up, down, left, false),
            _ => return,
        };
        s.dpad = dpad_from(up, down, left, right);
    }
}

fn set_trigger(t: &mut TriggerState, pressed: bool) {
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
        for b in Button::ALL {
            let mut s = ControllerState::default();
            b.set(&mut s, true);
            assert!(b.is_pressed(&s), "{b:?} not pressed after set");
            for other in Button::ALL.iter().filter(|o| **o != b) {
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
        Button::DpadUp.set(&mut s, true);
        Button::DpadRight.set(&mut s, true);
        assert_eq!(s.dpad, DpadDirection::UpRight);
        Button::DpadUp.set(&mut s, false);
        assert_eq!(s.dpad, DpadDirection::Right);
    }

    #[test]
    fn analog_trigger_threshold() {
        let mut s = ControllerState::default();
        s.left_trigger.value = 0.49;
        assert!(!Button::LeftTrigger.is_pressed(&s));
        s.left_trigger.value = 0.5;
        assert!(Button::LeftTrigger.is_pressed(&s));
    }

    #[test]
    fn home_cannot_trigger() {
        assert!(!Button::Home.can_trigger());
        assert!(Button::RightStick.can_trigger());
    }
}
