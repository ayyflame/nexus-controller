//! "Do my inputs reach Windows?": compares what NEXUS last sent to the
//! virtual Xbox 360 controller with what Windows reports for that controller
//! through XInput (the API games read). Read-only; nothing is sent.

use crate::EngineStatus;
use nexus_controller_core::VirtualOutputKind;
use nexus_virtual_controller::translate::to_xusb;
use nexus_virtual_controller::xinput::{differences, XInputPad};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OutputCheck {
    /// No controller is connected (or it hasn't sent a report yet).
    NoController,
    /// Virtual output is off, or isn't an Xbox 360 controller (only that one is readable through XInput).
    NotXbox { active: Option<VirtualOutputKind> },
    /// The virtual controller exists but Windows hasn't said which player slot it has.
    SlotUnknown,
    /// XInput couldn't be read (e.g. not Windows).
    Unavailable { reason: String },
    /// Windows reports no controller in the virtual controller's slot.
    Missing { slot: u8 },
    /// Both sides read: `differences` is empty when they match exactly.
    Compared {
        slot: u8,
        sent: XInputPad,
        read: XInputPad,
        differences: Vec<String>,
    },
}

/// Runs the check for the first controller, reading XInput through `read`.
pub fn check_output(
    status: &EngineStatus,
    read: impl Fn(u32) -> Result<Option<XInputPad>, String>,
) -> OutputCheck {
    let Some(device) = status.devices.iter().find(|d| d.processed.is_some()) else {
        return OutputCheck::NoController;
    };
    let active = device.output.active;
    if active != Some(VirtualOutputKind::Xbox360) {
        return OutputCheck::NotXbox { active };
    }
    let Some(slot) = device.output.player_index else {
        return OutputCheck::SlotUnknown;
    };
    let sent = XInputPad::as_game_sees(&to_xusb(device.processed.as_ref().expect("checked above")));
    match read(slot as u32) {
        Err(reason) => OutputCheck::Unavailable { reason },
        Ok(None) => OutputCheck::Missing { slot },
        Ok(Some(read)) => OutputCheck::Compared {
            slot,
            sent,
            read,
            differences: differences(&sent, &read),
        },
    }
}
