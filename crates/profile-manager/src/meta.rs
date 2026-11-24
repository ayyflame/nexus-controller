//! Profile organisation: pinned profiles and when each was last used.
//!
//! Kept as two app settings (JSON) rather than new columns, so no schema
//! migration is needed and older builds simply ignore them. Ids of profiles
//! that no longer exist are dropped when read, and a deleted profile is
//! removed from both.

use crate::{ProfileError, ProfileStore};
use serde::Serialize;
use std::collections::BTreeMap;

const KEY_PINNED: &str = "pinned_profiles";
const KEY_LAST_USED: &str = "profile_last_used";

/// Organisation data for the Profile Manager.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    /// Pinned profiles, in the order they were pinned.
    pub pinned: Vec<i64>,
    /// When each profile was last made active (ms since 1970).
    pub last_used_ms: BTreeMap<i64, i64>,
    /// The profile NEXUS starts with, if one is chosen.
    pub startup: Option<i64>,
    /// The profile that can't be deleted (see `protected_profile`).
    pub protected: i64,
}

impl ProfileStore {
    fn read_json<T: serde::de::DeserializeOwned + Default>(
        &self,
        key: &str,
    ) -> Result<T, ProfileError> {
        // Unreadable values (hand-edited, or from a newer build) count as empty.
        Ok(self
            .get_setting(key)?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default())
    }

    fn existing_ids(&self) -> Result<Vec<i64>, ProfileError> {
        let mut stmt = self.conn.prepare("SELECT id FROM profiles")?;
        let ids = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(ids)
    }

    pub fn profile_meta(&self) -> Result<ProfileMeta, ProfileError> {
        let ids = self.existing_ids()?;
        let mut pinned: Vec<i64> = self.read_json(KEY_PINNED)?;
        pinned.retain(|id| ids.contains(id));
        let mut last_used_ms: BTreeMap<i64, i64> = self.read_json(KEY_LAST_USED)?;
        last_used_ms.retain(|id, _| ids.contains(id));
        Ok(ProfileMeta {
            pinned,
            last_used_ms,
            startup: self.default_profile()?,
            protected: self.protected_profile()?,
        })
    }

    /// Pins or unpins a profile (shown first in the Profile Manager).
    pub fn set_profile_pinned(
        &mut self,
        id: i64,
        pinned: bool,
    ) -> Result<ProfileMeta, ProfileError> {
        self.get_profile(id)?;
        let mut list: Vec<i64> = self.read_json(KEY_PINNED)?;
        list.retain(|p| *p != id);
        if pinned {
            list.push(id);
        }
        self.set_setting(
            KEY_PINNED,
            &serde_json::to_string(&list).expect("serialises"),
        )?;
        self.profile_meta()
    }

    pub(crate) fn record_profile_used(&mut self, id: i64, at_ms: i64) -> Result<(), ProfileError> {
        let mut map: BTreeMap<i64, i64> = self.read_json(KEY_LAST_USED)?;
        map.insert(id, at_ms);
        self.set_setting(
            KEY_LAST_USED,
            &serde_json::to_string(&map).expect("serialises"),
        )
    }

    /// Removes a deleted profile from the organisation data.
    pub(crate) fn forget_profile_meta(&mut self, id: i64) -> Result<(), ProfileError> {
        let mut pinned: Vec<i64> = self.read_json(KEY_PINNED)?;
        let mut map: BTreeMap<i64, i64> = self.read_json(KEY_LAST_USED)?;
        let had = pinned.contains(&id) || map.contains_key(&id);
        if !had {
            return Ok(());
        }
        pinned.retain(|p| *p != id);
        map.remove(&id);
        self.set_setting(
            KEY_PINNED,
            &serde_json::to_string(&pinned).expect("serialises"),
        )?;
        self.set_setting(
            KEY_LAST_USED,
            &serde_json::to_string(&map).expect("serialises"),
        )
    }
}
