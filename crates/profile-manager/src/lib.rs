//! Profile and settings persistence (SQLite).
//!
//! * Profiles: name, virtual output, and processing settings (sticks,
//!   triggers, remapping) as JSON in `settings_json`.
//! * The last-used profile is remembered and loaded at start-up.
//! * Macros live in one shared library; which macros are switched on is
//!   stored per profile (`profile_macros`, schema v3).
//! * Every schema change is a numbered migration run in a transaction, so
//!   existing user data is preserved across upgrades.

#![forbid(unsafe_code)]

use nexus_controller_core::VirtualOutputKind;
use nexus_input_processing::ProcessingConfig;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

pub const DEFAULT_PROFILE_NAME: &str = "Default";
pub(crate) const SCHEMA_VERSION: i64 = 4;
pub(crate) const KEY_AUTO_SWITCH: &str = "auto_switch_enabled";
pub const MAX_GAMES_PER_PROFILE: usize = 20;
pub const MAX_PROFILE_NAME_LEN: usize = 40;
const KEY_LAST_PROFILE: &str = "last_profile_id";

mod macros;
mod meta;
mod portable;
mod smart;

pub use macros::MacroMeta;
pub use meta::ProfileMeta;
pub use portable::{
    ConfigBundle, ImportMode, ImportPreview, ImportReport, PortableProfile, BUNDLE_FORMAT,
};
pub use smart::{normalize_game, ProfileTemplate, TEMPLATES};

#[cfg(test)]
mod profile_tests;

#[cfg(test)]
mod smart_tests;

#[cfg(test)]
mod update_tests;

#[derive(Debug, Error)]
pub enum ProfileError {
    #[error("{}", .0.iter().map(|i| i.message.as_str()).collect::<Vec<_>>().join(" "))]
    InvalidMacro(Vec<nexus_macro_engine::ValidationIssue>),
    #[error("macro {0} not found")]
    MacroNotFound(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("profile {0} not found")]
    NotFound(i64),
    #[error("Give the profile a name (up to 40 characters).")]
    InvalidName,
    #[error("A profile called “{0}” already exists.")]
    NameTaken(String),
    #[error("You can't delete your only profile.")]
    LastProfile,
    #[error("“{0}” is the profile NEXUS starts with, so it is protected. Choose another start-up profile first, then delete it.")]
    Protected(String),
    #[error("{0}")]
    InvalidGame(String),
    #[error("“{game}” already switches to the profile “{profile}”.")]
    GameTaken { game: String, profile: String },
    #[error("This file can't be imported: {0}")]
    InvalidImport(String),
    #[error("database schema version {found} is newer than supported version {supported}")]
    SchemaTooNew { found: i64, supported: i64 },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub virtual_output: VirtualOutputKind,
    /// Sticks, triggers and button remapping.
    pub processing: ProcessingConfig,
    /// Game executables (e.g. `eldenring.exe`) that switch to this profile.
    pub games: Vec<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub struct ProfileStore {
    conn: Connection,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl ProfileStore {
    /// Opens (creating if needed) the database at `path`.
    pub fn open(path: &Path) -> Result<Self, ProfileError> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::backup_before_migration(path)?;
        Self::init(Connection::open(path)?)
    }

    /// If an existing database is older than this build, copies it to
    /// `<name>.v<old>.bak` before any migration runs, so an interrupted or
    /// failed upgrade can always be recovered. Returns the backup path.
    pub fn backup_before_migration(
        path: &Path,
    ) -> Result<Option<std::path::PathBuf>, ProfileError> {
        if !path.exists() {
            return Ok(None);
        }
        let version: i64 = {
            let conn = Connection::open(path)?;
            conn.pragma_query_value(None, "user_version", |r| r.get(0))?
        };
        if version == 0 || version >= SCHEMA_VERSION {
            return Ok(None);
        }
        let file = path
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
        let backup = path.with_file_name(format!("{file}.v{version}.bak"));
        if !backup.exists() {
            // VACUUM INTO writes a consistent copy even with a WAL file present.
            let conn = Connection::open(path)?;
            conn.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])?;
        }
        Ok(Some(backup))
    }

    /// Writes a consistent copy of the whole database to `dest` (used before
    /// an app update is installed). Fails if `dest` already exists.
    pub fn snapshot_to(&self, dest: &Path) -> Result<(), ProfileError> {
        if let Some(dir) = dest.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        self.conn
            .execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])?;
        Ok(())
    }

    pub fn open_in_memory() -> Result<Self, ProfileError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, ProfileError> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let mut store = Self { conn };
        store.migrate()?;
        store.ensure_default()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<(), ProfileError> {
        let version: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(ProfileError::SchemaTooNew {
                found: version,
                supported: SCHEMA_VERSION,
            });
        }
        if version < 1 {
            let tx = self.conn.transaction()?;
            tx.execute_batch(
                "CREATE TABLE profiles (
                    id             INTEGER PRIMARY KEY,
                    name           TEXT NOT NULL UNIQUE,
                    virtual_output TEXT NOT NULL DEFAULT 'disabled',
                    settings_json  TEXT NOT NULL DEFAULT '{}',
                    created_at_ms  INTEGER NOT NULL,
                    updated_at_ms  INTEGER NOT NULL
                );
                CREATE TABLE app_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                PRAGMA user_version = 1;",
            )?;
            tx.commit()?;
        }
        if version < 2 {
            // v2: macro library. Macros are shared by every profile.
            let tx = self.conn.transaction()?;
            tx.execute_batch(
                "CREATE TABLE macros (
                    id            TEXT PRIMARY KEY,
                    position      INTEGER NOT NULL,
                    data_json     TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL
                );
                PRAGMA user_version = 2;",
            )?;
            tx.commit()?;
        }
        if version < 3 {
            // v3: which macros are on is stored per profile. Macros that were
            // enabled before become enabled in every existing profile, so
            // behaviour is unchanged after the upgrade.
            let tx = self.conn.transaction()?;
            tx.execute_batch(
                "CREATE TABLE profile_macros (
                    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                    macro_id   TEXT NOT NULL REFERENCES macros(id) ON DELETE CASCADE,
                    PRIMARY KEY (profile_id, macro_id)
                );",
            )?;
            let enabled: Vec<String> = {
                let mut stmt = tx.prepare("SELECT id, data_json FROM macros")?;
                let rows =
                    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
                let mut ids = Vec::new();
                for row in rows {
                    let (id, json) = row?;
                    let on = serde_json::from_str::<serde_json::Value>(&json)
                        .ok()
                        .and_then(|v| v.get("enabled").and_then(|e| e.as_bool()))
                        .unwrap_or(false);
                    if on {
                        ids.push(id);
                    }
                }
                ids
            };
            for id in &enabled {
                tx.execute(
                    "INSERT INTO profile_macros (profile_id, macro_id) SELECT id, ?1 FROM profiles",
                    [id],
                )?;
            }
            tx.execute_batch("PRAGMA user_version = 3;")?;
            tx.commit()?;
        }
        if version < 4 {
            // v4: per-game automatic switching.
            let tx = self.conn.transaction()?;
            tx.execute_batch(
                "ALTER TABLE profiles ADD COLUMN games_json TEXT NOT NULL DEFAULT '[]';
                 PRAGMA user_version = 4;",
            )?;
            tx.commit()?;
        }
        Ok(())
    }

    fn ensure_default(&mut self) -> Result<(), ProfileError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))?;
        if count == 0 {
            self.create_profile(DEFAULT_PROFILE_NAME)?;
        }
        Ok(())
    }

    fn row_to_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
        let output: String = row.get(2)?;
        let settings: String = row.get(5)?;
        let games: String = row.get(6)?;
        Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            // Unknown values (from a newer build) degrade to Disabled.
            virtual_output: VirtualOutputKind::parse(&output).unwrap_or_default(),
            // Missing or unreadable settings fall back to defaults; known
            // fields are kept even if unknown ones are present.
            processing: serde_json::from_str::<ProcessingConfig>(&settings)
                .unwrap_or_default()
                .sanitized(),
            games: serde_json::from_str(&games).unwrap_or_default(),
            created_at_ms: row.get(3)?,
            updated_at_ms: row.get(4)?,
        })
    }

    const SELECT: &'static str =
        "SELECT id, name, virtual_output, created_at_ms, updated_at_ms, settings_json, games_json FROM profiles";

    fn check_profile_name(&self, name: &str, except: Option<i64>) -> Result<String, ProfileError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_PROFILE_NAME_LEN {
            return Err(ProfileError::InvalidName);
        }
        let taken = self
            .list_profiles()?
            .into_iter()
            .any(|p| Some(p.id) != except && p.name.eq_ignore_ascii_case(name));
        if taken {
            return Err(ProfileError::NameTaken(name.to_owned()));
        }
        Ok(name.to_owned())
    }

    pub fn list_profiles(&self) -> Result<Vec<Profile>, ProfileError> {
        let mut stmt = self
            .conn
            .prepare(&format!("{} ORDER BY id", Self::SELECT))?;
        let rows = stmt.query_map([], Self::row_to_profile)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_profile(&self, id: i64) -> Result<Profile, ProfileError> {
        self.conn
            .query_row(
                &format!("{} WHERE id = ?1", Self::SELECT),
                [id],
                Self::row_to_profile,
            )
            .optional()?
            .ok_or(ProfileError::NotFound(id))
    }

    /// Creates a profile with default settings and no macros switched on.
    pub fn create_profile(&mut self, name: &str) -> Result<Profile, ProfileError> {
        let name = self.check_profile_name(name, None)?;
        let now = now_ms();
        let settings = serde_json::to_string(&ProcessingConfig::default()).expect("serialises");
        self.conn.execute(
            "INSERT INTO profiles (name, settings_json, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?3)",
            params![name, settings, now],
        )?;
        self.get_profile(self.conn.last_insert_rowid())
    }

    pub fn rename_profile(&mut self, id: i64, name: &str) -> Result<Profile, ProfileError> {
        self.get_profile(id)?;
        let name = self.check_profile_name(name, Some(id))?;
        self.conn.execute(
            "UPDATE profiles SET name = ?1, updated_at_ms = ?2 WHERE id = ?3",
            params![name, now_ms(), id],
        )?;
        self.get_profile(id)
    }

    /// Copies a profile: settings, virtual output and which macros are on.
    /// Linked games stay with the original (a game switches to one profile).
    pub fn duplicate_profile(&mut self, id: i64) -> Result<Profile, ProfileError> {
        self.duplicate_profile_named(id, None)
    }

    /// Copies a profile under `name`, or "<name> (copy)" etc. when `None`.
    pub fn duplicate_profile_named(
        &mut self,
        id: i64,
        name: Option<&str>,
    ) -> Result<Profile, ProfileError> {
        let source = self.get_profile(id)?;
        let name = match name {
            Some(n) => self.check_profile_name(n, None)?,
            None => {
                let names: Vec<String> = self
                    .list_profiles()?
                    .into_iter()
                    .map(|p| p.name.to_lowercase())
                    .collect();
                let base: String = source
                    .name
                    .chars()
                    .take(MAX_PROFILE_NAME_LEN - 10)
                    .collect();
                (1..)
                    .map(|n| {
                        if n == 1 {
                            format!("{base} (copy)")
                        } else {
                            format!("{base} (copy {n})")
                        }
                    })
                    .find(|c| !names.contains(&c.to_lowercase()))
                    .expect("an unused name exists")
            }
        };
        let now = now_ms();
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO profiles (name, virtual_output, settings_json, created_at_ms, updated_at_ms)
             SELECT ?1, virtual_output, settings_json, ?2, ?2 FROM profiles WHERE id = ?3",
            params![name, now, id],
        )?;
        let new_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO profile_macros (profile_id, macro_id) SELECT ?1, macro_id FROM profile_macros WHERE profile_id = ?2",
            params![new_id, id],
        )?;
        tx.commit()?;
        self.get_profile(new_id)
    }

    /// Deletes a profile: its settings, linked games and which macros it
    /// switches on. Nothing else (the macros themselves, other profiles, app
    /// settings) is touched. The last profile and the protected profile
    /// ([`ProfileStore::protected_profile`]) can't be deleted; deleting the
    /// active profile makes the protected profile active.
    pub fn delete_profile(&mut self, id: i64) -> Result<Profile, ProfileError> {
        let profile = self.get_profile(id)?;
        if self.list_profiles()?.len() <= 1 {
            return Err(ProfileError::LastProfile);
        }
        if self.protected_profile()? == id {
            return Err(ProfileError::Protected(profile.name));
        }
        let was_active = self.active_profile()?.id == id;
        self.conn
            .execute("DELETE FROM profiles WHERE id = ?1", [id])?;
        self.forget_profile_meta(id)?;
        if was_active {
            let fallback = self.protected_profile()?;
            self.set_active_profile(fallback)?;
        }
        self.active_profile()
    }

    /// The profile that can't be deleted: the one NEXUS starts with, or (if
    /// none is chosen) the oldest profile, which NEXUS falls back to.
    pub fn protected_profile(&self) -> Result<i64, ProfileError> {
        if let Some(id) = self.default_profile()? {
            return Ok(id);
        }
        Ok(self
            .conn
            .query_row("SELECT id FROM profiles ORDER BY id LIMIT 1", [], |r| {
                r.get(0)
            })?)
    }

    pub fn set_processing(
        &mut self,
        id: i64,
        config: &ProcessingConfig,
    ) -> Result<Profile, ProfileError> {
        let json = serde_json::to_string(&config.sanitized()).expect("serialises");
        let changed = self.conn.execute(
            "UPDATE profiles SET settings_json = ?1, updated_at_ms = ?2 WHERE id = ?3",
            params![json, now_ms(), id],
        )?;
        if changed == 0 {
            return Err(ProfileError::NotFound(id));
        }
        self.get_profile(id)
    }

    /// The last-used profile, falling back to the oldest profile if the
    /// stored ID is missing or no longer exists.
    pub fn active_profile(&self) -> Result<Profile, ProfileError> {
        let stored: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                [KEY_LAST_PROFILE],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = stored.and_then(|v| v.parse::<i64>().ok()) {
            match self.get_profile(id) {
                Ok(p) => return Ok(p),
                Err(ProfileError::NotFound(_)) => {}
                Err(e) => return Err(e),
            }
        }
        self.conn
            .query_row(
                &format!("{} ORDER BY id LIMIT 1", Self::SELECT),
                [],
                Self::row_to_profile,
            )
            .map_err(Into::into)
    }

    /// Makes a profile active (by hand, at start-up or by a game) and
    /// records when it was last used.
    pub fn set_active_profile(&mut self, id: i64) -> Result<Profile, ProfileError> {
        let profile = self.get_profile(id)?;
        self.conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![KEY_LAST_PROFILE, id.to_string()],
        )?;
        self.record_profile_used(id, now_ms())?;
        Ok(profile)
    }

    pub fn set_virtual_output(
        &mut self,
        id: i64,
        kind: VirtualOutputKind,
    ) -> Result<Profile, ProfileError> {
        let changed = self.conn.execute(
            "UPDATE profiles SET virtual_output = ?1, updated_at_ms = ?2 WHERE id = ?3",
            params![kind.as_str(), now_ms(), id],
        )?;
        if changed == 0 {
            return Err(ProfileError::NotFound(id));
        }
        self.get_profile(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_has_default_profile() {
        let store = ProfileStore::open_in_memory().unwrap();
        let profiles = store.list_profiles().unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, DEFAULT_PROFILE_NAME);
        assert_eq!(profiles[0].virtual_output, VirtualOutputKind::Disabled);
        assert_eq!(store.active_profile().unwrap().id, profiles[0].id);
    }

    #[test]
    fn last_used_profile_survives_reopen() {
        let dir = std::env::temp_dir().join(format!("nexus-test-{}", std::process::id()));
        let path = dir.join("profiles.db");
        let _ = std::fs::remove_file(&path);
        let id = {
            let mut s = ProfileStore::open(&path).unwrap();
            let p = s.create_profile("Racing").unwrap();
            s.set_virtual_output(p.id, VirtualOutputKind::DualShock4)
                .unwrap();
            s.set_active_profile(p.id).unwrap();
            p.id
        };
        let s = ProfileStore::open(&path).unwrap();
        let active = s.active_profile().unwrap();
        assert_eq!(active.id, id);
        assert_eq!(active.name, "Racing");
        assert_eq!(active.virtual_output, VirtualOutputKind::DualShock4);
        assert_eq!(s.list_profiles().unwrap().len(), 2, "no duplicate default");
        drop(s);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn dangling_last_profile_falls_back_to_first() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        s.conn
            .execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, '999')",
                [KEY_LAST_PROFILE],
            )
            .unwrap();
        assert_eq!(s.active_profile().unwrap().name, DEFAULT_PROFILE_NAME);
        assert!(matches!(
            s.set_active_profile(999),
            Err(ProfileError::NotFound(999))
        ));
        assert!(matches!(
            s.set_virtual_output(999, VirtualOutputKind::Xbox360),
            Err(ProfileError::NotFound(999))
        ));
    }

    #[test]
    fn rejects_invalid_and_duplicate_names() {
        let mut s = ProfileStore::open_in_memory().unwrap();
        assert!(matches!(
            s.create_profile("   "),
            Err(ProfileError::InvalidName)
        ));
        assert!(matches!(
            s.create_profile(DEFAULT_PROFILE_NAME),
            Err(ProfileError::NameTaken(_))
        ));
        assert!(
            matches!(s.create_profile("default"), Err(ProfileError::NameTaken(_))),
            "case-insensitive"
        );
    }

    #[test]
    fn refuses_newer_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        assert!(matches!(
            ProfileStore::init(conn),
            Err(ProfileError::SchemaTooNew { found: 99, .. })
        ));
    }
}
