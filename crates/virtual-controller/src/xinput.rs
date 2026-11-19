//! Reading the virtual Xbox 360 controller back through XInput, the same API
//! games use, to check that what NEXUS sends is what Windows delivers.
//! Read-only: it never sends anything and never touches a game.

use crate::translate::{xusb, XusbReport};
use serde::Serialize;

/// One XInput player slot as a game reads it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XInputPad {
    pub buttons: u16,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub thumb_lx: i16,
    pub thumb_ly: i16,
    pub thumb_rx: i16,
    pub thumb_ry: i16,
}

impl XInputPad {
    /// What a game reads for a frame NEXUS sent. XInput never reports the
    /// Guide button to games (Windows keeps it for the Game Bar).
    pub fn as_game_sees(r: &XusbReport) -> Self {
        Self {
            buttons: r.buttons & !xusb::GUIDE,
            left_trigger: r.left_trigger,
            right_trigger: r.right_trigger,
            thumb_lx: r.thumb_lx,
            thumb_ly: r.thumb_ly,
            thumb_rx: r.thumb_rx,
            thumb_ry: r.thumb_ry,
        }
    }
}

/// Button names as games show them, in XInput bit order.
const BUTTONS: [(u16, &str); 14] = [
    (xusb::A, "A"),
    (xusb::B, "B"),
    (xusb::X, "X"),
    (xusb::Y, "Y"),
    (xusb::LEFT_SHOULDER, "LB"),
    (xusb::RIGHT_SHOULDER, "RB"),
    (xusb::BACK, "Back"),
    (xusb::START, "Start"),
    (xusb::LEFT_THUMB, "Left stick click"),
    (xusb::RIGHT_THUMB, "Right stick click"),
    (xusb::DPAD_UP, "D-pad up"),
    (xusb::DPAD_DOWN, "D-pad down"),
    (xusb::DPAD_LEFT, "D-pad left"),
    (xusb::DPAD_RIGHT, "D-pad right"),
];

/// Every field where Windows reports something other than what NEXUS sent,
/// in words. Empty means they match exactly.
pub fn differences(sent: &XInputPad, read: &XInputPad) -> Vec<String> {
    let mut out = Vec::new();
    for (bit, name) in BUTTONS {
        let (s, r) = (sent.buttons & bit != 0, read.buttons & bit != 0);
        if s != r {
            let state = |on: bool| if on { "pressed" } else { "released" };
            out.push(format!(
                "{name}: sent {}, Windows reads {}",
                state(s),
                state(r)
            ));
        }
    }
    let axes = [
        ("LT", sent.left_trigger as i32, read.left_trigger as i32),
        ("RT", sent.right_trigger as i32, read.right_trigger as i32),
        ("Left stick X", sent.thumb_lx as i32, read.thumb_lx as i32),
        ("Left stick Y", sent.thumb_ly as i32, read.thumb_ly as i32),
        ("Right stick X", sent.thumb_rx as i32, read.thumb_rx as i32),
        ("Right stick Y", sent.thumb_ry as i32, read.thumb_ry as i32),
    ];
    for (name, s, r) in axes {
        if s != r {
            out.push(format!("{name}: sent {s}, Windows reads {r}"));
        }
    }
    out
}

/// Reads one XInput slot (0–3): `Ok(None)` if nothing is connected there.
/// The only unsafe code is the single read-only XInputGetState call.
#[cfg(windows)]
#[allow(unsafe_code)]
pub fn read_slot(slot: u32) -> Result<Option<XInputPad>, String> {
    #[repr(C)]
    #[derive(Default)]
    struct Gamepad {
        buttons: u16,
        left_trigger: u8,
        right_trigger: u8,
        thumb_lx: i16,
        thumb_ly: i16,
        thumb_rx: i16,
        thumb_ry: i16,
    }
    #[repr(C)]
    #[derive(Default)]
    struct State {
        packet: u32,
        gamepad: Gamepad,
    }
    #[link(name = "xinput1_4", kind = "raw-dylib")]
    extern "system" {
        fn XInputGetState(user_index: u32, state: *mut State) -> u32;
    }
    const ERROR_SUCCESS: u32 = 0;
    const ERROR_DEVICE_NOT_CONNECTED: u32 = 1167;
    if slot > 3 {
        return Err(format!("XInput has slots 0–3, not {slot}"));
    }
    let mut s = State::default();
    // SAFETY: `s` is a valid, writable XINPUT_STATE for the duration of the call.
    let code = unsafe { XInputGetState(slot, &mut s) };
    match code {
        ERROR_SUCCESS => Ok(Some(XInputPad {
            buttons: s.gamepad.buttons,
            left_trigger: s.gamepad.left_trigger,
            right_trigger: s.gamepad.right_trigger,
            thumb_lx: s.gamepad.thumb_lx,
            thumb_ly: s.gamepad.thumb_ly,
            thumb_rx: s.gamepad.thumb_rx,
            thumb_ry: s.gamepad.thumb_ry,
        })),
        ERROR_DEVICE_NOT_CONNECTED => Ok(None),
        other => Err(format!(
            "XInputGetState({slot}) failed with Windows error {other}"
        )),
    }
}

#[cfg(not(windows))]
pub fn read_slot(_slot: u32) -> Result<Option<XInputPad>, String> {
    Err("XInput is only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translate::to_xusb;
    use nexus_controller_core::ControllerState;

    #[test]
    fn identical_frames_have_no_differences() {
        let mut s = ControllerState::default();
        s.buttons.south = true;
        s.left_stick.x = 0.5;
        let sent = XInputPad::as_game_sees(&to_xusb(&s));
        assert!(differences(&sent, &sent).is_empty());
    }

    #[test]
    fn guide_is_left_out_because_games_never_see_it() {
        let mut s = ControllerState::default();
        s.buttons.home = true;
        let sent = XInputPad::as_game_sees(&to_xusb(&s));
        assert_eq!(sent.buttons & xusb::GUIDE, 0);
        assert!(differences(&sent, &XInputPad::default()).is_empty());
    }

    #[test]
    fn each_difference_is_named() {
        let mut s = ControllerState::default();
        s.buttons.south = true;
        s.right_trigger.value = 1.0;
        let sent = XInputPad::as_game_sees(&to_xusb(&s));
        let read = XInputPad {
            buttons: xusb::B,
            thumb_ly: 100,
            ..Default::default()
        };
        let d = differences(&sent, &read);
        assert_eq!(
            d,
            vec![
                "A: sent pressed, Windows reads released".to_string(),
                "B: sent released, Windows reads pressed".to_string(),
                "RT: sent 255, Windows reads 0".to_string(),
                "Left stick Y: sent 0, Windows reads 100".to_string(),
            ]
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn reading_xinput_off_windows_says_so() {
        assert!(read_slot(0)
            .unwrap_err()
            .contains("only available on Windows"));
    }
}
