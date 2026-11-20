//! Restore points: every backup NEXUS made, listed so it can be restored
//! from the app, plus one automatic backup per day.
//!
//! Where they live:
//! - `%APPDATA%\com.nexus.controllerengine\backups` (NEXUS's own copies):
//!   `auto …` (daily), `pre-restore …` (taken before a restore replaces
//!   everything) and `pre-update … .db` (taken before an update installs).
//! - `Documents\NEXUS\Backups`: backups made with *Create backup*.
//!
//! Only files in those folders with those names can be read, so the UI can't
//! be used to read arbitrary files.

use nexus_profile_manager::ProfileStore;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Daily automatic backups kept; older ones are deleted. Other kinds are
/// never deleted automatically.
pub const KEEP_DAILY: usize = 14;
const DAILY_PREFIX: &str = "auto ";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreKind {
    /// Made with *Create backup*.
    Manual,
    /// Made automatically once a day.
    Daily,
    /// Saved before a restore replaced everything.
    BeforeRestore,
    /// Saved before an update was installed.
    BeforeUpdate,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePoint {
    /// Identifies the file for [`read`] (its full path).
    pub id: String,
    pub name: String,
    pub kind: RestoreKind,
    pub modified_ms: u64,
    pub bytes: u64,
}

/// What a backup file is, from its name; `None` for anything else.
pub fn kind_of(name: &str) -> Option<RestoreKind> {
    let lower = name.to_lowercase();
    if lower.ends_with(".nexus.json") {
        if lower.starts_with("nexus-backup ") {
            return Some(RestoreKind::Manual);
        }
        if lower.starts_with(DAILY_PREFIX) {
            return Some(RestoreKind::Daily);
        }
        if lower.starts_with("pre-restore ") {
            return Some(RestoreKind::BeforeRestore);
        }
    }
    if lower.starts_with("pre-update ") && lower.ends_with(".db") {
        return Some(RestoreKind::BeforeUpdate);
    }
    None
}

fn modified_ms(m: &std::fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

/// Every restore point in `dirs`, newest first.
pub fn list(dirs: &[PathBuf]) -> Vec<RestorePoint> {
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let (Some(kind), Ok(meta)) = (kind_of(&name), e.metadata()) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            out.push(RestorePoint {
                id: e.path().display().to_string(),
                name,
                kind,
                modified_ms: modified_ms(&meta),
                bytes: meta.len(),
            });
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(b.name.cmp(&a.name)));
    out
}

/// The file `id` if it is a restore point directly inside one of `dirs`.
fn checked(dirs: &[PathBuf], id: &str) -> Result<PathBuf, String> {
    let refuse = || "That isn't one of NEXUS's backups.".to_owned();
    let path = Path::new(id).canonicalize().map_err(|_| refuse())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(refuse)?;
    kind_of(&name).ok_or_else(refuse)?;
    let parent = path.parent().ok_or_else(refuse)?;
    let inside = dirs
        .iter()
        .filter_map(|d| d.canonicalize().ok())
        .any(|d| d == parent);
    if inside {
        Ok(path)
    } else {
        Err(refuse())
    }
}

/// The restore point as a NEXUS configuration file (the import format), so
/// the normal preview → replace flow restores it. A pre-update database is
/// read from a temporary copy, so the backup itself is never modified.
pub fn read(dirs: &[PathBuf], id: &str, app_version: &str) -> Result<String, String> {
    let path = checked(dirs, id)?;
    if kind_of(&path.file_name().unwrap_or_default().to_string_lossy())
        != Some(RestoreKind::BeforeUpdate)
    {
        return std::fs::read_to_string(&path)
            .map_err(|e| format!("Couldn't read the backup: {e}"));
    }
    let tmp = std::env::temp_dir().join(format!(
        "nexus-restore-{}-{}",
        std::process::id(),
        modified_ms(&std::fs::metadata(&path).map_err(|e| e.to_string())?)
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let copy = tmp.join("nexus.db");
    let result = (|| {
        std::fs::copy(&path, &copy).map_err(|e| format!("Couldn't read the backup: {e}"))?;
        let store = ProfileStore::open(&copy)
            .map_err(|e| format!("The backup database couldn't be opened: {e}"))?;
        let bundle = store
            .export_bundle(None, true, app_version)
            .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// Once per day (by `date`, `YYYY-MM-DD`): saves a full backup to `dir` and
/// deletes daily backups beyond [`KEEP_DAILY`]. Returns the new file, or
/// `None` if today's already exists.
pub fn daily_backup(
    store: &ProfileStore,
    dir: &Path,
    stamp: &str,
    app_version: &str,
) -> Result<Option<PathBuf>, String> {
    let date = stamp.get(..10).unwrap_or(stamp);
    let today = format!("{DAILY_PREFIX}{date}");
    let existing: Vec<String> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    if existing.iter().any(|n| n.starts_with(&today)) {
        return Ok(None);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let bundle = store
        .export_bundle(None, true, app_version)
        .map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{DAILY_PREFIX}{stamp}.nexus.json"));
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    prune_daily(dir, KEEP_DAILY);
    Ok(Some(path))
}

/// Deletes the oldest daily backups beyond `keep` (by name: they start with
/// the date). Manual, pre-restore and pre-update backups are never touched.
pub fn prune_daily(dir: &Path, keep: usize) {
    let mut daily: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| kind_of(&n.to_string_lossy()) == Some(RestoreKind::Daily))
                })
                .collect()
        })
        .unwrap_or_default();
    daily.sort();
    let excess = daily.len().saturating_sub(keep);
    for old in daily.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("nexus-restore-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn backup_files_are_recognised_by_name() {
        assert_eq!(
            kind_of("nexus-backup 2026-11-20_10-00-00.nexus.json"),
            Some(RestoreKind::Manual)
        );
        assert_eq!(
            kind_of("auto 2026-11-20_10-00-00.nexus.json"),
            Some(RestoreKind::Daily)
        );
        assert_eq!(
            kind_of("pre-restore 2026-11-20_10-00-00.nexus.json"),
            Some(RestoreKind::BeforeRestore)
        );
        assert_eq!(
            kind_of("pre-update 0.1.0 to 0.1.1 2026-11-20_10-00-00.db"),
            Some(RestoreKind::BeforeUpdate)
        );
        for other in [
            "nexus.db",
            "notes.txt",
            "auto.exe",
            "pre-update.json",
            "My profile 2026.nexus.json",
        ] {
            assert_eq!(kind_of(other), None, "{other}");
        }
    }

    #[test]
    fn a_daily_backup_is_made_once_a_day_and_old_ones_are_pruned() {
        let dir = temp("daily");
        let store = ProfileStore::open_in_memory().unwrap();
        let first = daily_backup(&store, &dir, "2026-11-20_08-00-00", "0.1.0").unwrap();
        assert!(first.is_some());
        assert_eq!(
            daily_backup(&store, &dir, "2026-11-20_21-00-00", "0.1.0").unwrap(),
            None,
            "once per day"
        );
        std::fs::write(dir.join("pre-restore 2026-01-01_00-00-00.nexus.json"), "{}").unwrap();
        for day in 1..=20 {
            daily_backup(&store, &dir, &format!("2026-12-{day:02}_08-00-00"), "0.1.0").unwrap();
        }
        let points = list(std::slice::from_ref(&dir));
        let daily: Vec<_> = points
            .iter()
            .filter(|p| p.kind == RestoreKind::Daily)
            .collect();
        assert_eq!(daily.len(), KEEP_DAILY);
        assert!(
            daily.iter().all(|p| !p.name.contains("2026-11-20")),
            "the oldest went first"
        );
        assert!(
            points.iter().any(|p| p.kind == RestoreKind::BeforeRestore),
            "other kinds are never pruned"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_restore_point_reads_back_as_the_import_format() {
        let dir = temp("read");
        let mut store = ProfileStore::open_in_memory().unwrap();
        store.create_profile("Warzone").unwrap();
        let path = daily_backup(&store, &dir, "2026-11-20_08-00-00", "0.1.0")
            .unwrap()
            .unwrap();
        let json = read(
            std::slice::from_ref(&dir),
            &path.display().to_string(),
            "0.1.0",
        )
        .unwrap();
        let preview = ProfileStore::open_in_memory()
            .unwrap()
            .preview_import(&json, nexus_profile_manager::ImportMode::Replace)
            .unwrap();
        assert!(preview.profiles.iter().any(|p| p == "Warzone"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pre_update_database_restores_without_being_modified() {
        let dir = temp("db");
        let mut store = ProfileStore::open_in_memory().unwrap();
        store.create_profile("Before the update").unwrap();
        let db = dir.join("pre-update 0.1.0 to 0.1.1 2026-11-20_08-00-00.db");
        store.snapshot_to(&db).unwrap();
        let before = std::fs::read(&db).unwrap();
        let json = read(
            std::slice::from_ref(&dir),
            &db.display().to_string(),
            "0.1.1",
        )
        .unwrap();
        assert!(json.contains("Before the update"));
        assert_eq!(
            std::fs::read(&db).unwrap(),
            before,
            "the backup file is untouched"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_backups_inside_the_backup_folders_can_be_read() {
        let dir = temp("guard");
        let outside = temp("outside");
        std::fs::write(outside.join("nexus-backup x.nexus.json"), "{}").unwrap();
        std::fs::write(dir.join("secrets.txt"), "x").unwrap();
        let dirs = [dir.clone()];
        for id in [
            outside
                .join("nexus-backup x.nexus.json")
                .display()
                .to_string(),
            dir.join("secrets.txt").display().to_string(),
            dir.join("..").join("x").display().to_string(),
            "C:\\Windows\\win.ini".into(),
        ] {
            assert!(read(&dirs, &id, "0.1.0").is_err(), "{id}");
        }
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
