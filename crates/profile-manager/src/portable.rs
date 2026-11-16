//! Configuration export, import and backup.
//!
//! Files are JSON with a format tag and version. Imports are size-limited
//! and fully validated; anything malformed is rejected without changing the
//! database. `Add` never overwrites (name clashes are renamed); `Replace`
//! swaps everything in one transaction (callers make a backup first).

use crate::{now_ms, Profile, ProfileError, ProfileStore, MAX_PROFILE_NAME_LEN};
use nexus_controller_core::VirtualOutputKind;
use nexus_input_processing::ProcessingConfig;
use nexus_macro_engine::{validate_macro, Macro, MAX_NAME_LEN};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const BUNDLE_FORMAT: &str = "nexus-config";
pub const BUNDLE_VERSION: u32 = 1;
const MAX_BUNDLE_BYTES: usize = 5 * 1024 * 1024;
const MAX_PROFILES: usize = 100;
const MAX_MACROS: usize = 500;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableProfile {
    pub name: String,
    pub virtual_output: VirtualOutputKind,
    #[serde(default)]
    pub processing: ProcessingConfig,
    #[serde(default)]
    pub games: Vec<String>,
    /// IDs (within this file) of macros switched on in this profile.
    #[serde(default)]
    pub enabled_macros: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundle {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub exported_at_ms: i64,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub profiles: Vec<PortableProfile>,
    #[serde(default)]
    pub macros: Vec<Macro>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    /// Add everything as new; never touches existing profiles or macros.
    Add,
    /// Replace all profiles and macros with the file's contents.
    Replace,
}

/// What an import would do, shown to the user before confirming.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub profiles: Vec<String>,
    pub macros: Vec<String>,
    /// "Old name → new name" for items renamed to avoid clashes (Add mode).
    pub renamed: Vec<String>,
    pub exported_at_ms: i64,
    pub app_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub profiles_added: usize,
    pub macros_added: usize,
    pub renamed: Vec<String>,
    /// Macros left switched off because their button clashed in a profile.
    pub disabled_for_conflicts: Vec<String>,
}

fn bad(m: impl Into<String>) -> ProfileError {
    ProfileError::InvalidImport(m.into())
}

/// Parses and validates a bundle without touching any database.
pub fn parse_bundle(json: &str) -> Result<ConfigBundle, ProfileError> {
    if json.len() > MAX_BUNDLE_BYTES {
        return Err(bad("the file is larger than 5 MB."));
    }
    let b: ConfigBundle = serde_json::from_str(json)
        .map_err(|e| bad(format!("it isn't a valid NEXUS configuration ({e}).")))?;
    if b.format != BUNDLE_FORMAT {
        return Err(bad("it isn't a NEXUS configuration file."));
    }
    if b.version > BUNDLE_VERSION {
        return Err(bad(
            "it was made by a newer version of NEXUS. Update NEXUS first.",
        ));
    }
    if b.profiles.len() > MAX_PROFILES || b.macros.len() > MAX_MACROS {
        return Err(bad("it contains too many profiles or macros."));
    }
    let mut ids = std::collections::HashSet::new();
    for m in &b.macros {
        if m.id.trim().is_empty() || !ids.insert(m.id.clone()) {
            return Err(bad("two macros share an ID, or one has none."));
        }
        let mut solo = m.clone();
        solo.enabled = false; // trigger clashes are resolved per profile later
        let issues = validate_macro(&solo, &[]);
        if let Some(i) = issues.first() {
            return Err(bad(format!("macro “{}”: {}", m.name, i.message)));
        }
    }
    for p in &b.profiles {
        if p.name.trim().is_empty() || p.name.chars().count() > MAX_PROFILE_NAME_LEN {
            return Err(bad("a profile has an invalid name."));
        }
        for g in &p.games {
            crate::normalize_game(g).map_err(|e| bad(format!("profile “{}”: {e}", p.name)))?;
        }
        if let Some(missing) = p.enabled_macros.iter().find(|id| !ids.contains(*id)) {
            return Err(bad(format!(
                "profile “{}” refers to a missing macro ({missing}).",
                p.name
            )));
        }
    }
    Ok(b)
}

fn unique_name(base: &str, taken: &mut Vec<String>, max: usize) -> String {
    let base: String = base.trim().chars().take(max - 12).collect();
    let name = (1..)
        .map(|n| {
            if n == 1 {
                base.clone()
            } else if n == 2 {
                format!("{base} (imported)")
            } else {
                format!("{base} (imported {})", n - 1)
            }
        })
        .find(|c| !taken.contains(&c.to_lowercase()))
        .expect("an unused name exists");
    taken.push(name.to_lowercase());
    name
}

impl ProfileStore {
    /// Exports the given profiles (all if `None`) and every macro they use.
    /// With `include_all_macros`, the whole macro library is included.
    pub fn export_bundle(
        &self,
        profile_ids: Option<&[i64]>,
        include_all_macros: bool,
        app_version: &str,
    ) -> Result<ConfigBundle, ProfileError> {
        let profiles: Vec<Profile> = match profile_ids {
            None => self.list_profiles()?,
            Some(ids) => ids
                .iter()
                .map(|id| self.get_profile(*id))
                .collect::<Result<_, _>>()?,
        };
        let library = self.list_macros_for(profiles.first().map_or(0, |p| p.id))?;
        let mut used = std::collections::HashSet::new();
        let mut portable = Vec::new();
        for p in &profiles {
            let enabled: Vec<String> = self
                .list_macros_for(p.id)?
                .into_iter()
                .filter(|m| m.enabled)
                .map(|m| m.id)
                .collect();
            used.extend(enabled.iter().cloned());
            portable.push(PortableProfile {
                name: p.name.clone(),
                virtual_output: p.virtual_output,
                processing: p.processing.clone(),
                games: p.games.clone(),
                enabled_macros: enabled,
            });
        }
        let macros = library
            .into_iter()
            .filter(|m| include_all_macros || used.contains(&m.id))
            .map(|mut m| {
                m.enabled = false;
                m
            })
            .collect();
        Ok(ConfigBundle {
            format: BUNDLE_FORMAT.into(),
            version: BUNDLE_VERSION,
            exported_at_ms: now_ms(),
            app_version: app_version.into(),
            profiles: portable,
            macros,
        })
    }

    /// Validates a file and describes what importing it would do.
    pub fn preview_import(
        &self,
        json: &str,
        mode: ImportMode,
    ) -> Result<ImportPreview, ProfileError> {
        let b = parse_bundle(json)?;
        if mode == ImportMode::Replace && b.profiles.is_empty() {
            return Err(bad(
                "it contains no profiles, so it can't replace your configuration.",
            ));
        }
        let mut renamed = Vec::new();
        if mode == ImportMode::Add {
            let mut taken: Vec<String> = self
                .list_profiles()?
                .into_iter()
                .map(|p| p.name.to_lowercase())
                .collect();
            for p in &b.profiles {
                let n = unique_name(&p.name, &mut taken, MAX_PROFILE_NAME_LEN);
                if n != p.name.trim() {
                    renamed.push(format!("{} → {n}", p.name));
                }
            }
            let mut taken: Vec<String> = self
                .list_macros()?
                .into_iter()
                .map(|m| m.name.to_lowercase())
                .collect();
            for m in &b.macros {
                let n = unique_name(&m.name, &mut taken, MAX_NAME_LEN);
                if n != m.name.trim() {
                    renamed.push(format!("{} → {n}", m.name));
                }
            }
        }
        Ok(ImportPreview {
            profiles: b.profiles.iter().map(|p| p.name.clone()).collect(),
            macros: b.macros.iter().map(|m| m.name.clone()).collect(),
            renamed,
            exported_at_ms: b.exported_at_ms,
            app_version: b.app_version,
        })
    }

    /// Imports a validated file. All-or-nothing: any failure rolls back.
    pub fn import_bundle(
        &mut self,
        json: &str,
        mode: ImportMode,
    ) -> Result<ImportReport, ProfileError> {
        let b = parse_bundle(json)?;
        if mode == ImportMode::Replace && b.profiles.is_empty() {
            return Err(bad(
                "it contains no profiles, so it can't replace your configuration.",
            ));
        }
        let active_before = self.active_profile()?.id;
        let tx = self.conn.transaction()?;
        if mode == ImportMode::Replace {
            tx.execute_batch(
                "DELETE FROM profile_macros; DELETE FROM macros; DELETE FROM profiles;",
            )?;
        }
        let (mut taken_p, mut taken_m): (Vec<String>, Vec<String>) = if mode == ImportMode::Add {
            let mut s1 = tx.prepare("SELECT lower(name) FROM profiles")?;
            let p = s1.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            let mut s2 = tx.prepare("SELECT data_json FROM macros")?;
            let m = s2
                .query_map([], |r| r.get::<_, String>(0))?
                .filter_map(|j| j.ok().and_then(|j| serde_json::from_str::<Macro>(&j).ok()))
                .map(|m| m.name.to_lowercase())
                .collect();
            (p, m)
        } else {
            (Vec::new(), Vec::new())
        };
        let mut renamed = Vec::new();
        let now = now_ms();
        let first_position: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM macros",
            [],
            |r| r.get(0),
        )?;
        let mut id_map: HashMap<String, Macro> = HashMap::new();
        for (i, m) in b.macros.iter().enumerate() {
            let mut m = m.clone();
            let name = unique_name(&m.name, &mut taken_m, MAX_NAME_LEN);
            if name != m.name.trim() {
                renamed.push(format!("{} → {name}", m.name));
            }
            let old_id = m.id.clone();
            m.id = format!("m{now:x}i{i:x}");
            m.name = name;
            m.enabled = false;
            m.created_at_ms = now;
            m.updated_at_ms = now;
            tx.execute(
                "INSERT INTO macros (id, position, data_json, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?4)",
                rusqlite::params![m.id, first_position + i as i64, serde_json::to_string(&m).expect("serialises"), now],
            )?;
            id_map.insert(old_id, m);
        }
        let mut disabled = Vec::new();
        let mut first_profile = None;
        let mut games_taken: Vec<String> = if mode == ImportMode::Add {
            let mut st = tx.prepare("SELECT games_json FROM profiles")?;
            let rows: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            rows.iter()
                .flat_map(|j| serde_json::from_str::<Vec<String>>(j).unwrap_or_default())
                .collect()
        } else {
            Vec::new()
        };
        for p in &b.profiles {
            let name = unique_name(&p.name, &mut taken_p, MAX_PROFILE_NAME_LEN);
            if name != p.name.trim() {
                renamed.push(format!("{} → {name}", p.name));
            }
            // A game already linked elsewhere stays with its current profile.
            let games: Vec<String> = p
                .games
                .iter()
                .filter_map(|g| crate::normalize_game(g).ok())
                .filter(|g| !games_taken.contains(g))
                .collect();
            games_taken.extend(games.iter().cloned());
            tx.execute(
                "INSERT INTO profiles (name, virtual_output, settings_json, games_json, created_at_ms, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                rusqlite::params![
                    name,
                    p.virtual_output.as_str(),
                    serde_json::to_string(&p.processing.sanitized()).expect("serialises"),
                    serde_json::to_string(&games).expect("serialises"),
                    now
                ],
            )?;
            let pid = tx.last_insert_rowid();
            first_profile.get_or_insert(pid);
            let mut on: Vec<Macro> = Vec::new();
            for old in &p.enabled_macros {
                let m = &id_map[old];
                let mut candidate = m.clone();
                candidate.enabled = true;
                if validate_macro(&candidate, &on).is_empty() {
                    on.push(candidate);
                    tx.execute(
                        "INSERT INTO profile_macros (profile_id, macro_id) VALUES (?1, ?2)",
                        rusqlite::params![pid, m.id],
                    )?;
                } else {
                    disabled.push(format!("{} (in {name})", m.name));
                }
            }
        }
        tx.commit()?;
        if mode == ImportMode::Replace {
            self.set_active_profile(first_profile.expect("at least one profile"))?;
        } else {
            self.set_active_profile(active_before)?;
        }
        Ok(ImportReport {
            profiles_added: b.profiles.len(),
            macros_added: b.macros.len(),
            renamed,
            disabled_for_conflicts: disabled,
        })
    }
}
