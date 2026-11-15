//! Profile and settings persistence (SQLite).
//!
//! Milestone 1 scope: a versioned schema, a guaranteed default profile,
//! remembering the last-used profile, and each profile's selected virtual
//! output. Processing settings are stored later in the `settings_json`
//! column once their schema is defined.

#![forbid(unsafe_code)]

use nexus_controller_core::VirtualOutputKind;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

pub const DEFAULT_PROFILE_NAME: &str = "Default";
const SCHEMA_VERSION: i64 = 1;
const KEY_LAST_PROFILE: &str = "last_profile_id";

#[derive(Debug, Error)]
pub enum ProfileError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("profile {0} not found")]
    NotFound(i64),
    #[error("invalid profile name")]
    InvalidName,
    #[error("database schema version {found} is newer than supported version {supported}")]
    SchemaTooNew { found: i64, supported: i64 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub virtual_output: VirtualOutputKind,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub struct ProfileStore {
    conn: Connection,
}

fn now_ms() -> i64 {
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
        Self::init(Connection::open(path)?)
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
        Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            // Unknown values (from a newer build) degrade to Disabled.
            virtual_output: VirtualOutputKind::parse(&output).unwrap_or_default(),
            created_at_ms: row.get(3)?,
            updated_at_ms: row.get(4)?,
        })
    }

    const SELECT: &'static str =
        "SELECT id, name, virtual_output, created_at_ms, updated_at_ms FROM profiles";

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

    pub fn create_profile(&mut self, name: &str) -> Result<Profile, ProfileError> {
        let name = name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(ProfileError::InvalidName);
        }
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO profiles (name, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?2)",
            params![name, now],
        )?;
        self.get_profile(self.conn.last_insert_rowid())
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

    pub fn set_active_profile(&mut self, id: i64) -> Result<Profile, ProfileError> {
        let profile = self.get_profile(id)?;
        self.conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![KEY_LAST_PROFILE, id.to_string()],
        )?;
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
            Err(ProfileError::Database(_))
        ));
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
