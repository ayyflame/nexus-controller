//! Running in the background: what closing and minimising the window do, and
//! whether the window opens when Windows starts NEXUS at sign-in.
//!
//! The controller engine never depends on the window. Hidden or not, NEXUS
//! keeps reading the DualSense and driving the virtual controller; only the
//! UI's status stream pauses while nobody can see it. Quitting (tray › Quit,
//! or closing the window with "close to tray" off) stops the engine, which
//! releases every button and removes the virtual controller.

use serde::{Deserialize, Serialize};

/// Key in the profile database's `app_settings` table (JSON value).
pub const SETTINGS_KEY: &str = "window_behaviour";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowBehaviour {
    /// The close button hides NEXUS to the tray instead of quitting, so the
    /// virtual controller stays available to games.
    pub close_to_tray: bool,
    /// Minimising hides NEXUS to the tray (no taskbar button).
    pub minimize_to_tray: bool,
    /// When Windows starts NEXUS at sign-in, start in the tray without
    /// opening the window.
    pub start_hidden: bool,
}

impl Default for WindowBehaviour {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            minimize_to_tray: false,
            start_hidden: true,
        }
    }
}

impl WindowBehaviour {
    /// Settings saved by this or an older version; anything unreadable
    /// falls back to the defaults rather than failing start-up.
    pub fn from_saved(saved: Option<&str>) -> Self {
        saved
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    }

    pub fn to_saved(self) -> String {
        serde_json::to_string(&self).expect("plain struct serialises")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseAction {
    HideToTray,
    Quit,
}

pub fn on_close(b: WindowBehaviour) -> CloseAction {
    if b.close_to_tray {
        CloseAction::HideToTray
    } else {
        CloseAction::Quit
    }
}

/// The window was just minimised: hide it to the tray?
pub fn hide_when_minimised(b: WindowBehaviour, minimised: bool) -> bool {
    minimised && b.minimize_to_tray
}

/// Should the window open at launch?
pub fn show_at_launch(b: WindowBehaviour, started_at_sign_in: bool) -> bool {
    !(started_at_sign_in && b.start_hidden)
}

/// A second copy of NEXUS was started. NEXUS runs once (two copies would
/// fight over the DualSense and create two virtual controllers), so the
/// running copy shows its window instead, unless the second start came from
/// Windows at sign-in.
pub fn show_on_second_launch(started_at_sign_in: bool) -> bool {
    !started_at_sign_in
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_keep_games_working_when_the_window_is_closed() {
        let b = WindowBehaviour::default();
        assert_eq!(on_close(b), CloseAction::HideToTray);
        assert!(
            !hide_when_minimised(b, true),
            "minimise stays a normal minimise"
        );
        assert!(!show_at_launch(b, true), "sign-in start stays in the tray");
        assert!(show_at_launch(b, false), "a normal start opens the window");
    }

    #[test]
    fn every_behaviour_can_be_switched() {
        let b = WindowBehaviour {
            close_to_tray: false,
            minimize_to_tray: true,
            start_hidden: false,
        };
        assert_eq!(on_close(b), CloseAction::Quit);
        assert!(hide_when_minimised(b, true));
        assert!(!hide_when_minimised(b, false), "restoring never hides");
        assert!(show_at_launch(b, true));
    }

    #[test]
    fn saved_settings_round_trip_and_bad_ones_fall_back() {
        let b = WindowBehaviour {
            close_to_tray: false,
            minimize_to_tray: true,
            start_hidden: false,
        };
        assert_eq!(WindowBehaviour::from_saved(Some(&b.to_saved())), b);
        assert_eq!(
            WindowBehaviour::from_saved(None),
            WindowBehaviour::default()
        );
        assert_eq!(
            WindowBehaviour::from_saved(Some("not json")),
            WindowBehaviour::default()
        );
        // A setting added later keeps its default for older saved values.
        assert_eq!(
            WindowBehaviour::from_saved(Some(r#"{"closeToTray":false}"#)),
            WindowBehaviour {
                close_to_tray: false,
                ..Default::default()
            }
        );
    }

    #[test]
    fn a_second_start_shows_the_running_copy_unless_it_came_from_sign_in() {
        assert!(show_on_second_launch(false));
        assert!(!show_on_second_launch(true));
    }
}
