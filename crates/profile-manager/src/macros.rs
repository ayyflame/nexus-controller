//! Macro library persistence. Macros are stored once and are available in
//! every profile.

use crate::{now_ms, ProfileError, ProfileStore};
use nexus_macro_engine::{validate_macro, Macro, MAX_NAME_LEN};
use rusqlite::{params, OptionalExtension};
use std::sync::atomic::{AtomicU32, Ordering};

static ID_COUNTER: AtomicU32 = AtomicU32::new(0);

fn new_id(prefix: &str) -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}{:x}{:04x}", now_ms(), n & 0xFFFF)
}

impl ProfileStore {
    /// All macros in display order. Rows that cannot be read (for example,
    /// written by a newer NEXUS) are skipped but left untouched.
    pub fn list_macros(&self) -> Result<Vec<Macro>, ProfileError> {
        let mut stmt = self
            .conn
            .prepare("SELECT data_json FROM macros ORDER BY position, created_at_ms")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for json in rows {
            if let Ok(m) = serde_json::from_str::<Macro>(&json?) {
                out.push(m);
            }
        }
        Ok(out)
    }

    pub fn get_macro(&self, id: &str) -> Result<Macro, ProfileError> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT data_json FROM macros WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        json.and_then(|j| serde_json::from_str(&j).ok())
            .ok_or_else(|| ProfileError::MacroNotFound(id.to_owned()))
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
        Ok(m)
    }

    pub fn delete_macro(&mut self, id: &str) -> Result<(), ProfileError> {
        match self
            .conn
            .execute("DELETE FROM macros WHERE id = ?1", [id])?
        {
            0 => Err(ProfileError::MacroNotFound(id.to_owned())),
            _ => Ok(()),
        }
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
            }],
            trigger,
            mode: PlaybackMode::Once,
            repeat_delay_ms: 50,
            block_trigger: true,
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
}
