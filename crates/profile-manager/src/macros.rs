//! Macro library persistence. Macros are stored once and are available in
//! every profile; whether a macro is switched on is stored per profile
//! (`profile_macros`). `Macro::enabled` as returned here always means
//! "on in the active profile" unless a profile is named explicitly.

use crate::{now_ms, ProfileError, ProfileStore};
use nexus_macro_engine::{validate_macro, Macro, MAX_NAME_LEN};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, Ordering};

static ID_COUNTER: AtomicU32 = AtomicU32::new(0);

/// App setting holding the pinned macros (no schema change).
const KEY_PINNED_MACROS: &str = "pinned_macros";

/// Organisation data for Macro Studio.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroMeta {
    /// Pinned macros, in the order they were pinned.
    pub pinned: Vec<String>,
    /// For each macro, the profiles it is switched on in (in profile order).
    pub profiles: BTreeMap<String, Vec<i64>>,
}

fn new_id(prefix: &str) -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}{:x}{:04x}", now_ms(), n & 0xFFFF)
}

impl ProfileStore {
    /// All macros in display order. Rows that cannot be read (for example,
    /// written by a newer NEXUS) are skipped but left untouched.
    pub fn list_macros(&self) -> Result<Vec<Macro>, ProfileError> {
        let profile = self.active_profile()?.id;
        self.list_macros_for(profile)
    }

    /// The library with `enabled` set for the given profile.
    pub fn list_macros_for(&self, profile_id: i64) -> Result<Vec<Macro>, ProfileError> {
        let enabled = self.enabled_macro_ids(profile_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT data_json FROM macros ORDER BY position, created_at_ms")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for json in rows {
            if let Ok(mut m) = serde_json::from_str::<Macro>(&json?) {
                m.enabled = enabled.contains(&m.id);
                out.push(m);
            }
        }
        Ok(out)
    }

    fn enabled_macro_ids(&self, profile_id: i64) -> Result<Vec<String>, ProfileError> {
        let mut stmt = self
            .conn
            .prepare("SELECT macro_id FROM profile_macros WHERE profile_id = ?1")?;
        let rows = stmt.query_map([profile_id], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn set_enabled_in(
        &self,
        profile_id: i64,
        macro_id: &str,
        enabled: bool,
    ) -> Result<(), ProfileError> {
        if enabled {
            self.conn.execute(
                "INSERT OR IGNORE INTO profile_macros (profile_id, macro_id) VALUES (?1, ?2)",
                params![profile_id, macro_id],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM profile_macros WHERE profile_id = ?1 AND macro_id = ?2",
                params![profile_id, macro_id],
            )?;
        }
        Ok(())
    }

    pub fn get_macro(&self, id: &str) -> Result<Macro, ProfileError> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT data_json FROM macros WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        let mut m: Macro = json
            .and_then(|j| serde_json::from_str(&j).ok())
            .ok_or_else(|| ProfileError::MacroNotFound(id.to_owned()))?;
        let profile = self.active_profile()?.id;
        m.enabled = self.enabled_macro_ids(profile)?.contains(&m.id);
        Ok(m)
    }

    /// Creates (empty `id`) or updates a macro after validating it against
    /// the rest of the library. Returns the stored macro.
    pub fn save_macro(&mut self, mut m: Macro) -> Result<Macro, ProfileError> {
        m.name = m.name.trim().to_owned();
        m.description = m.description.trim().to_owned();
        let existing = if m.id.is_empty() {
            None
        } else {
            Some(self.get_macro(&m.id)?)
        };
        let others: Vec<Macro> = self
            .list_macros()?
            .into_iter()
            .filter(|o| o.id != m.id)
            .collect();
        let issues = validate_macro(&m, &others);
        if !issues.is_empty() {
            return Err(ProfileError::InvalidMacro(issues));
        }

        let now = now_ms();
        for step in &mut m.steps {
            if step.id.is_empty() {
                step.id = new_id("s");
            }
        }
        m.updated_at_ms = now;
        match existing {
            Some(prev) => {
                m.created_at_ms = prev.created_at_ms;
                self.conn.execute(
                    "UPDATE macros SET data_json = ?1, updated_at_ms = ?2 WHERE id = ?3",
                    params![
                        serde_json::to_string(&m).expect("macro serialises"),
                        now,
                        m.id
                    ],
                )?;
            }
            None => {
                m.id = new_id("m");
                m.created_at_ms = now;
                let position: i64 = self.conn.query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM macros",
                    [],
                    |r| r.get(0),
                )?;
                self.conn.execute(
                    "INSERT INTO macros (id, position, data_json, created_at_ms, updated_at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![
                        m.id,
                        position,
                        serde_json::to_string(&m).expect("macro serialises"),
                        now
                    ],
                )?;
            }
        }
        // On/off belongs to the active profile.
        let profile = self.active_profile()?.id;
        self.set_enabled_in(profile, &m.id, m.enabled)?;
        Ok(m)
    }

    /// Deletes a macro: from the library, every profile and the pinned list.
    pub fn delete_macro(&mut self, id: &str) -> Result<(), ProfileError> {
        match self
            .conn
            .execute("DELETE FROM macros WHERE id = ?1", [id])?
        {
            0 => Err(ProfileError::MacroNotFound(id.to_owned())),
            _ => {
                let mut pinned = self.pinned_macros()?;
                if pinned.contains(&id.to_owned()) {
                    pinned.retain(|p| p != id);
                    self.set_setting(
                        KEY_PINNED_MACROS,
                        &serde_json::to_string(&pinned).expect("serialises"),
                    )?;
                }
                Ok(())
            }
        }
    }

    fn pinned_macros(&self) -> Result<Vec<String>, ProfileError> {
        Ok(self
            .get_setting(KEY_PINNED_MACROS)?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default())
    }

    /// Pinned macros and where each macro is switched on.
    pub fn macro_meta(&self) -> Result<MacroMeta, ProfileError> {
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT id FROM macros")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        let mut pinned = self.pinned_macros()?;
        pinned.retain(|p| ids.contains(p));
        let mut profiles: BTreeMap<String, Vec<i64>> = BTreeMap::new();
        let mut stmt = self
            .conn
            .prepare("SELECT macro_id, profile_id FROM profile_macros ORDER BY profile_id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (m, p) = row?;
            profiles.entry(m).or_default().push(p);
        }
        Ok(MacroMeta { pinned, profiles })
    }

    /// Pins or unpins a macro (shown first in Macro Studio).
    pub fn set_macro_pinned(&mut self, id: &str, pinned: bool) -> Result<MacroMeta, ProfileError> {
        self.get_macro(id)?;
        let mut list = self.pinned_macros()?;
        list.retain(|p| p != id);
        if pinned {
            list.push(id.to_owned());
        }
        self.set_setting(
            KEY_PINNED_MACROS,
            &serde_json::to_string(&list).expect("serialises"),
        )?;
        self.macro_meta()
    }

    /// Copies a macro under a new name. The copy has no trigger, so it can
    /// never conflict with the original.
    pub fn duplicate_macro(&mut self, id: &str) -> Result<Macro, ProfileError> {
        let source = self.get_macro(id)?;
        let names: Vec<String> = self
            .list_macros()?
            .into_iter()
            .map(|m| m.name.to_lowercase())
            .collect();
        let base: String = source.name.chars().take(MAX_NAME_LEN - 10).collect();
        let name = (1..)
            .map(|n| match n {
                1 => format!("{base} (copy)"),
                n => format!("{base} (copy {n})"),
            })
            .find(|candidate| !names.contains(&candidate.to_lowercase()))
            .expect("an unused name exists");
        let mut copy = source;
        copy.id = String::new();
        copy.name = name;
        copy.trigger = None;
        for step in &mut copy.steps {
            step.id = String::new();
        }
        self.save_macro(copy)
    }

    pub fn set_macro_enabled(&mut self, id: &str, enabled: bool) -> Result<Macro, ProfileError> {
        let mut m = self.get_macro(id)?;
        m.enabled = enabled;
        self.save_macro(m)
    }
}

#[cfg(test)]
mod tests {
    use crate::{ProfileError, ProfileStore};
    use nexus_macro_engine::{Macro, MacroButton, MacroStep, PlaybackMode};

    fn draft(name: &str, trigger: Option<MacroButton>) -> Macro {
        Macro {
            id: String::new(),
            name: name.into(),
            description: "  desc  ".into(),
            enabled: true,
            steps: vec![MacroStep {
                id: String::new(),
                buttons: vec![MacroButton::South],
                hold_ms: 100,
                delay_after_ms: 150,
                kind: nexus_macro_engine::StepKind::Tap,
            }],
            trigger,
            mode: PlaybackMode::Once,
            repeat_delay_ms: 50,
            block_trigger: true,
            activation_ms: 0,
            repeat_count: 1,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn create_update_list_delete() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        let a = s
            .save_macro(draft(" Quick Jump ", Some(MacroButton::RightStick)))
            .unwrap();
        assert!(!a.id.is_empty());
        assert!(!a.steps[0].id.is_empty());
        assert_eq!(a.name, "Quick Jump");
        assert_eq!(a.description, "desc");
        assert!(a.created_at_ms > 0);

        let mut edited = a.clone();
        edited.mode = PlaybackMode::Toggle;
        let edited = s.save_macro(edited).unwrap();
        assert_eq!(edited.created_at_ms, a.created_at_ms);

        let b = s.save_macro(draft("Second", None)).unwrap();
        let list = s.list_macros().unwrap();
        assert_eq!(
            list.iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
            vec![a.id.clone(), b.id]
        );
        assert_eq!(list[0].mode, PlaybackMode::Toggle);

        s.delete_macro(&a.id).unwrap();
        assert!(matches!(
            s.delete_macro(&a.id),
            Err(ProfileError::MacroNotFound(_))
        ));
        assert_eq!(s.list_macros().unwrap().len(), 1);
    }

    #[test]
    fn invalid_or_conflicting_macros_are_rejected() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        s.save_macro(draft("A", Some(MacroButton::RightStick)))
            .unwrap();
        match s.save_macro(draft("B", Some(MacroButton::RightStick))) {
            Err(ProfileError::InvalidMacro(issues)) => assert_eq!(issues[0].field, "trigger"),
            other => panic!("expected conflict, got {other:?}"),
        }
        assert!(matches!(
            s.save_macro(draft("a", None)),
            Err(ProfileError::InvalidMacro(_))
        ));
        let mut unknown = draft("C", None);
        unknown.id = "does-not-exist".into();
        assert!(matches!(
            s.save_macro(unknown),
            Err(ProfileError::MacroNotFound(_))
        ));
        assert_eq!(s.list_macros().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_gets_unique_name_and_no_trigger() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        let a = s
            .save_macro(draft("Combo", Some(MacroButton::LeftStick)))
            .unwrap();
        let c1 = s.duplicate_macro(&a.id).unwrap();
        let c2 = s.duplicate_macro(&a.id).unwrap();
        assert_eq!(c1.name, "Combo (copy)");
        assert_eq!(c2.name, "Combo (copy 2)");
        assert_eq!(c1.trigger, None);
        assert_ne!(c1.id, a.id);
        assert_ne!(c1.steps[0].id, a.steps[0].id);
        assert_eq!(c1.steps[0].buttons, a.steps[0].buttons);
    }

    #[test]
    fn enabling_checks_conflicts() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        s.save_macro(draft("A", Some(MacroButton::North))).unwrap();
        let mut b = draft("B", Some(MacroButton::North));
        b.enabled = false;
        let b = s.save_macro(b).unwrap();
        assert!(matches!(
            s.set_macro_enabled(&b.id, true),
            Err(ProfileError::InvalidMacro(_))
        ));
        assert!(!s.get_macro(&b.id).unwrap().enabled);
    }

    #[test]
    fn macros_survive_reopen_and_v1_databases_migrate() {
        let dir = std::env::temp_dir().join(format!("nexus-macro-test-{}", std::process::id()));
        let path = dir.join("profiles.db");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        {
            // Simulate a Milestone 1 (schema v1) database.
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                   virtual_output TEXT NOT NULL DEFAULT 'disabled', settings_json TEXT NOT NULL DEFAULT '{}',
                   created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
                 CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO profiles (name, created_at_ms, updated_at_ms) VALUES ('Mine', 1, 1);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        }
        let id = {
            let mut s = ProfileStore::open(&path).unwrap();
            assert_eq!(s.active_profile().unwrap().name, "Mine", "v1 data kept");
            s.save_macro(draft("Kept", Some(MacroButton::East)))
                .unwrap()
                .id
        };
        let s = ProfileStore::open(&path).unwrap();
        assert_eq!(s.get_macro(&id).unwrap().name, "Kept");
        drop(s);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn macro_on_off_is_per_profile() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        let racing = s.create_profile("Racing").unwrap();
        let m = s
            .save_macro(draft("Boost", Some(MacroButton::North)))
            .unwrap();
        assert!(
            s.get_macro(&m.id).unwrap().enabled,
            "on in the active (Default) profile"
        );
        assert!(
            !s.list_macros_for(racing.id).unwrap()[0].enabled,
            "off in Racing"
        );
        s.set_active_profile(racing.id).unwrap();
        assert!(!s.list_macros().unwrap()[0].enabled);
        // The same trigger can be used by another macro in this profile…
        s.save_macro(draft("Other", Some(MacroButton::North)))
            .unwrap();
        // …but not twice within one profile.
        assert!(matches!(
            s.set_macro_enabled(&m.id, true),
            Err(ProfileError::InvalidMacro(_))
        ));
    }

    #[test]
    fn deleting_macro_or_profile_cleans_up_assignments() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        let m = s.save_macro(draft("Gone", None)).unwrap();
        let p = s.duplicate_profile(s.active_profile().unwrap().id).unwrap();
        assert!(
            s.list_macros_for(p.id).unwrap()[0].enabled,
            "duplicate keeps macros on"
        );
        s.delete_macro(&m.id).unwrap();
        let rows: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM profile_macros", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        let m2 = s.save_macro(draft("Again", None)).unwrap();
        s.set_active_profile(p.id).unwrap();
        s.set_macro_enabled(&m2.id, true).unwrap();
        s.delete_profile(p.id).unwrap();
        let rows: i64 = s
            .conn
            .query_row(
                "SELECT COUNT(*) FROM profile_macros WHERE profile_id = ?1",
                [p.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0, "foreign-key cascade");
    }

    #[test]
    fn unreadable_rows_are_skipped_not_deleted() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        s.save_macro(draft("Good", None)).unwrap();
        s.conn
            .execute(
                "INSERT INTO macros (id, position, data_json, created_at_ms, updated_at_ms)
                 VALUES ('bad', 9, '{not json', 0, 0)",
                [],
            )
            .unwrap();
        assert_eq!(s.list_macros().unwrap().len(), 1);
        let rows: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM macros", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[test]
    fn macro_studio_meta_pins_and_profile_use() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        let first = s.active_profile().unwrap().id;
        let a = s
            .save_macro(draft("A", Some(MacroButton::RightStick)))
            .unwrap();
        let mut off = draft("B", None);
        off.enabled = false;
        let b = s.save_macro(off).unwrap();
        let second = s.create_profile("Second").unwrap().id;
        s.set_active_profile(second).unwrap();
        s.set_macro_enabled(&a.id, true).unwrap();
        let meta = s.macro_meta().unwrap();
        assert_eq!(
            meta.profiles.get(&a.id),
            Some(&vec![first, second]),
            "on in both profiles"
        );
        assert_eq!(meta.profiles.get(&b.id), None, "on nowhere");
        assert!(meta.pinned.is_empty());
        s.set_macro_pinned(&b.id, true).unwrap();
        assert_eq!(
            s.set_macro_pinned(&a.id, true).unwrap().pinned,
            vec![b.id.clone(), a.id.clone()]
        );
        assert_eq!(
            s.set_macro_pinned(&b.id, false).unwrap().pinned,
            vec![a.id.clone()]
        );
        assert!(s.set_macro_pinned("nope", true).is_err());
        // Deleting a macro unpins it and removes it from every profile.
        s.delete_macro(&a.id).unwrap();
        let meta = s.macro_meta().unwrap();
        assert!(meta.pinned.is_empty() && !meta.profiles.contains_key(&a.id));
    }

    #[test]
    fn renaming_or_editing_keeps_the_assignment() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        let m = s
            .save_macro(draft("Rapid", Some(MacroButton::RightShoulder)))
            .unwrap();
        let mut edited = m.clone();
        edited.name = "Rapid fire".into();
        edited.steps[0].hold_ms = 40;
        let saved = s.save_macro(edited).unwrap();
        assert_eq!(saved.id, m.id);
        assert_eq!(
            saved.trigger,
            Some(MacroButton::RightShoulder),
            "still on R1"
        );
        assert!(saved.enabled, "still on in the profile");
        assert!(saved.updated_at_ms >= m.updated_at_ms);
        assert_eq!(
            s.macro_meta().unwrap().profiles[&m.id],
            vec![s.active_profile().unwrap().id]
        );
        // Removing the assignment keeps the macro.
        let mut unassigned = saved.clone();
        unassigned.trigger = None;
        s.save_macro(unassigned).unwrap();
        assert!(s.get_macro(&m.id).is_ok());
    }

    #[test]
    fn exporting_chosen_macros_marks_files_that_need_a_newer_build() {
        use nexus_macro_engine::StepKind;
        let mut s = ProfileStore::open_in_memory().unwrap();
        let plain = s.save_macro(draft("Plain", None)).unwrap();
        let mut aim = draft("Aim", None);
        aim.steps = vec![
            MacroStep {
                kind: StepKind::Hold,
                hold_ms: 0,
                delay_after_ms: 100,
                ..aim.steps[0].clone()
            },
            MacroStep {
                kind: StepKind::Release,
                hold_ms: 0,
                delay_after_ms: 0,
                ..aim.steps[0].clone()
            },
        ];
        aim.repeat_count = 3;
        let aim = s.save_macro(aim).unwrap();
        let b = s
            .export_macros_bundle(std::slice::from_ref(&plain.id), "x")
            .unwrap();
        assert_eq!(
            (b.version, b.profiles.len(), b.macros.len()),
            (1, 0, 1),
            "plain macros stay version 1"
        );
        assert!(!b.macros[0].enabled, "exported switched off");
        let b = s
            .export_macros_bundle(&[plain.id.clone(), aim.id.clone()], "x")
            .unwrap();
        assert_eq!(b.version, 2);
        assert!(s.export_macros_bundle(&["missing".into()], "x").is_err());
        // A version-2 file imports here with its hold/release actions and repeat count.
        let json = serde_json::to_string(&b).unwrap();
        let mut other = ProfileStore::open_in_memory().unwrap();
        other.import_bundle(&json, crate::ImportMode::Add).unwrap();
        let imported = other
            .list_macros()
            .unwrap()
            .into_iter()
            .find(|m| m.name == "Aim")
            .unwrap();
        assert_eq!(imported.repeat_count, 3);
        assert_eq!(imported.steps[0].kind, StepKind::Hold);
        // A file from an even newer build is refused.
        let newer = json.replace("\"version\":2", "\"version\":3");
        assert!(matches!(
            crate::portable::parse_bundle(&newer),
            Err(ProfileError::InvalidImport(_))
        ));
    }

    #[test]
    fn macros_saved_before_hold_and_release_existed_still_load_as_taps() {
        let s = ProfileStore::open_in_memory().unwrap();
        s.conn
            .execute(
                "INSERT INTO macros (id, position, data_json, created_at_ms, updated_at_ms) VALUES ('old', 0, ?1, 1, 1)",
                [r#"{"id":"old","name":"Old","enabled":false,"steps":[{"id":"s","buttons":["south"],"holdMs":80,"delayAfterMs":20}],"trigger":"rightStick","mode":"toggle","repeatDelayMs":50,"blockTrigger":true,"activationMs":0,"createdAtMs":1,"updatedAtMs":1}"#],
            )
            .unwrap();
        let m = s.get_macro("old").unwrap();
        assert_eq!(m.steps[0].kind, nexus_macro_engine::StepKind::Tap);
        assert_eq!(m.repeat_count, 1);
        assert_eq!(m.mode, PlaybackMode::Toggle);
    }
}
