//! Smart profiles: per-game executables, automatic switching setting and
//! built-in templates.

use crate::{now_ms, Profile, ProfileError, ProfileStore, KEY_AUTO_SWITCH, MAX_GAMES_PER_PROFILE};
use nexus_controller_core::{Button, VirtualOutputKind};
use nexus_input_processing::{GyroActivation, ProcessingConfig, ResponseCurve};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

/// App setting holding the id of the profile NEXUS starts with.
const DEFAULT_PROFILE_KEY: &str = "default_profile_id";

/// Normalises a game executable name: file name only, lower case, `.exe`.
pub fn normalize_game(input: &str) -> Result<String, ProfileError> {
    let name = input
        .trim()
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let bad = |m: &str| Err(ProfileError::InvalidGame(m.to_owned()));
    if name.is_empty() {
        return bad("Enter the game's program name, for example eldenring.exe.");
    }
    if !name.ends_with(".exe") || name.len() <= 4 {
        return bad("Use the game's program file name, ending in .exe.");
    }
    if name.len() > 100
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
    {
        return bad("That isn't a valid program file name.");
    }
    Ok(name)
}

impl ProfileStore {
    /// Sets the games that switch to a profile. A game belongs to at most
    /// one profile.
    pub fn set_profile_games(
        &mut self,
        id: i64,
        games: &[String],
    ) -> Result<Profile, ProfileError> {
        let profile = self.get_profile(id)?;
        let mut list: Vec<String> = Vec::new();
        for g in games {
            let g = normalize_game(g)?;
            if !list.contains(&g) {
                list.push(g);
            }
        }
        if list.len() > MAX_GAMES_PER_PROFILE {
            return Err(ProfileError::InvalidGame(format!(
                "A profile can have at most {MAX_GAMES_PER_PROFILE} games."
            )));
        }
        for other in self
            .list_profiles()?
            .into_iter()
            .filter(|p| p.id != profile.id)
        {
            if let Some(g) = list.iter().find(|g| other.games.contains(g)) {
                return Err(ProfileError::GameTaken {
                    game: g.clone(),
                    profile: other.name,
                });
            }
        }
        self.conn.execute(
            "UPDATE profiles SET games_json = ?1, updated_at_ms = ?2 WHERE id = ?3",
            params![
                serde_json::to_string(&list).expect("serialises"),
                now_ms(),
                id
            ],
        )?;
        self.get_profile(id)
    }

    /// The profile a game executable switches to, if any.
    pub fn profile_for_game(&self, exe: &str) -> Result<Option<Profile>, ProfileError> {
        let exe = exe.to_lowercase();
        Ok(self
            .list_profiles()?
            .into_iter()
            .find(|p| p.games.contains(&exe)))
    }

    pub fn auto_switch_enabled(&self) -> Result<bool, ProfileError> {
        let v: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                [KEY_AUTO_SWITCH],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v.as_deref() != Some("false"))
    }

    pub fn set_auto_switch_enabled(&mut self, enabled: bool) -> Result<(), ProfileError> {
        self.set_setting(KEY_AUTO_SWITCH, if enabled { "true" } else { "false" })
    }

    /// The profile NEXUS starts with, if one is chosen (an app setting, so
    /// no schema change). `None` if unset or if that profile no longer exists.
    pub fn default_profile(&self) -> Result<Option<i64>, ProfileError> {
        let Some(v) = self.get_setting(DEFAULT_PROFILE_KEY)? else {
            return Ok(None);
        };
        let Ok(id) = v.parse::<i64>() else {
            return Ok(None);
        };
        Ok(self
            .list_profiles()?
            .iter()
            .any(|p| p.id == id)
            .then_some(id))
    }

    /// Chooses (or with `None`, clears) the profile NEXUS starts with.
    pub fn set_default_profile(&mut self, id: Option<i64>) -> Result<Option<i64>, ProfileError> {
        match id {
            Some(id) => {
                self.get_profile(id)?;
                self.set_setting(DEFAULT_PROFILE_KEY, &id.to_string())?;
            }
            None => {
                self.conn.execute(
                    "DELETE FROM app_settings WHERE key = ?1",
                    [DEFAULT_PROFILE_KEY],
                )?;
            }
        }
        self.default_profile()
    }

    /// At start-up: switches to the default profile if one is chosen.
    /// Returns the profile that is active afterwards.
    pub fn activate_default_profile(&mut self) -> Result<Profile, ProfileError> {
        if let Some(id) = self.default_profile()? {
            if self.active_profile()?.id != id {
                return self.set_active_profile(id);
            }
        }
        self.active_profile()
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, ProfileError> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                [key],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_setting(&mut self, key: &str, value: &str) -> Result<(), ProfileError> {
        self.conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Creates a profile pre-configured from a built-in template.
    pub fn create_profile_from_template(
        &mut self,
        name: &str,
        template: &str,
    ) -> Result<Profile, ProfileError> {
        let t = TEMPLATES
            .iter()
            .find(|t| t.id == template)
            .ok_or_else(|| ProfileError::InvalidGame(format!("Unknown template “{template}”.")))?;
        let p = self.create_profile(name)?;
        self.set_processing(p.id, &(t.build)())?;
        self.set_virtual_output(p.id, t.output)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    #[serde(skip)]
    pub output: VirtualOutputKind,
    #[serde(skip)]
    pub build: fn() -> ProcessingConfig,
}

fn shooter() -> ProcessingConfig {
    let mut c = ProcessingConfig::default();
    c.right_stick.deadzone = 0.06;
    c.right_stick.curve = ResponseCurve::Power { exponent: 1.8 };
    c.left_trigger.activation = 0.2;
    c.right_trigger.activation = 0.2;
    c.gyro.activation = GyroActivation::WhileHeld;
    c.gyro.button = Some(Button::LeftTrigger);
    c
}

fn racing() -> ProcessingConfig {
    let mut c = ProcessingConfig::default();
    c.left_stick.deadzone = 0.03;
    c.left_stick.shape = nexus_input_processing::DeadzoneShape::Axial;
    c.left_stick.circular = false;
    c.left_trigger.deadzone = 0.02;
    c.right_trigger.deadzone = 0.02;
    c
}

fn relaxed() -> ProcessingConfig {
    let mut c = ProcessingConfig::default();
    c.left_stick.deadzone = 0.12;
    c.right_stick.deadzone = 0.12;
    c.right_stick.curve = ResponseCurve::Power { exponent: 1.4 };
    c
}

fn standard() -> ProcessingConfig {
    ProcessingConfig::default()
}

pub const TEMPLATES: &[ProfileTemplate] = &[
    ProfileTemplate {
        id: "standard",
        name: "Standard",
        description: "Recommended defaults: small deadzones, linear sticks.",
        output: VirtualOutputKind::Xbox360,
        build: standard,
    },
    ProfileTemplate {
        id: "shooter",
        name: "Shooter",
        description: "Precise right-stick curve, light trigger activation, gyro aiming while L2 is held (switch gyro on to use it).",
        output: VirtualOutputKind::Xbox360,
        build: shooter,
    },
    ProfileTemplate {
        id: "racing",
        name: "Racing",
        description: "Tiny deadzones, separate steering axis, full trigger range.",
        output: VirtualOutputKind::Xbox360,
        build: racing,
    },
    ProfileTemplate {
        id: "relaxed",
        name: "Relaxed / worn sticks",
        description: "Larger deadzones and a gentle curve for drifting sticks or casual play.",
        output: VirtualOutputKind::Xbox360,
        build: relaxed,
    },
];
