use crate::*;
use nexus_controller_core::Button;
use nexus_macro_engine::{Macro, MacroButton, MacroStep, PlaybackMode};

fn mac(name: &str, trigger: Option<MacroButton>) -> Macro {
    Macro {
        id: String::new(),
        name: name.into(),
        description: String::new(),
        enabled: true,
        steps: vec![MacroStep {
            id: String::new(),
            buttons: vec![MacroButton::South],
            hold_ms: 100,
            delay_after_ms: 0,
        }],
        trigger,
        mode: PlaybackMode::Once,
        repeat_delay_ms: 50,
        block_trigger: true,
        activation_ms: 0,
        created_at_ms: 0,
        updated_at_ms: 0,
    }
}

// ---- Games and auto-switch --------------------------------------------------

#[test]
fn game_names_are_normalised_and_validated() {
    assert_eq!(
        normalize_game(r"C:\Games\Elden Ring\EldenRing.EXE").unwrap(),
        "eldenring.exe"
    );
    assert_eq!(normalize_game("  Game.exe ").unwrap(), "game.exe");
    for bad in ["", "notepad", ".exe", "a<b>.exe"] {
        assert!(normalize_game(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn a_game_switches_to_exactly_one_profile() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    let racing = s.create_profile("Racing").unwrap();
    let p = s
        .set_profile_games(
            racing.id,
            &["Forza.exe".into(), "forza.exe".into(), "gt7.exe".into()],
        )
        .unwrap();
    assert_eq!(p.games, vec!["forza.exe", "gt7.exe"], "deduplicated");
    assert_eq!(
        s.profile_for_game("FORZA.EXE").unwrap().unwrap().id,
        racing.id
    );
    assert!(s.profile_for_game("other.exe").unwrap().is_none());
    let default = s.list_profiles().unwrap()[0].id;
    assert!(matches!(
        s.set_profile_games(default, &["gt7.exe".into()]),
        Err(ProfileError::GameTaken { .. })
    ));
    let many: Vec<String> = (0..21).map(|i| format!("g{i}.exe")).collect();
    assert!(matches!(
        s.set_profile_games(racing.id, &many),
        Err(ProfileError::InvalidGame(_))
    ));
    assert!(
        s.duplicate_profile(racing.id).unwrap().games.is_empty(),
        "copies don't steal games"
    );
}

#[test]
fn auto_switch_setting_defaults_on_and_persists() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    assert!(s.auto_switch_enabled().unwrap());
    s.set_auto_switch_enabled(false).unwrap();
    assert!(!s.auto_switch_enabled().unwrap());
}

#[test]
fn templates_create_configured_profiles() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    let p = s
        .create_profile_from_template("My shooter", "shooter")
        .unwrap();
    assert_eq!(
        p.virtual_output,
        nexus_controller_core::VirtualOutputKind::Xbox360
    );
    assert_eq!(p.processing.gyro.button, Some(Button::LeftTrigger));
    assert!(
        !p.processing.gyro.enabled,
        "gyro stays off until the user enables it"
    );
    assert!(s.create_profile_from_template("X", "nope").is_err());
    assert_eq!(TEMPLATES.len(), 4);
}

// ---- Export / import ------------------------------------------------------

fn populated() -> ProfileStore {
    let mut s = ProfileStore::open_in_memory().unwrap();
    let a = s
        .save_macro(mac("Jump", Some(MacroButton::RightStick)))
        .unwrap();
    s.save_macro(mac("Unused", None)).unwrap();
    let racing = s.create_profile("Racing").unwrap();
    s.set_profile_games(racing.id, &["forza.exe".into()])
        .unwrap();
    let mut cfg = racing.processing.clone();
    cfg.left_stick.deadzone = 0.2;
    s.set_processing(racing.id, &cfg).unwrap();
    s.set_active_profile(racing.id).unwrap();
    s.set_macro_enabled(&a.id, true).unwrap();
    s
}

#[test]
fn export_then_import_into_another_install() {
    let s = populated();
    let bundle = s.export_bundle(None, true, "0.1.0").unwrap();
    assert_eq!(bundle.profiles.len(), 2);
    assert_eq!(bundle.macros.len(), 2);
    let json = serde_json::to_string(&bundle).unwrap();

    let mut other = ProfileStore::open_in_memory().unwrap();
    let preview = other.preview_import(&json, ImportMode::Add).unwrap();
    assert_eq!(preview.profiles, vec!["Default", "Racing"]);
    assert_eq!(preview.renamed, vec!["Default → Default (imported)"]);
    let report = other.import_bundle(&json, ImportMode::Add).unwrap();
    assert_eq!((report.profiles_added, report.macros_added), (2, 2));
    let racing = other
        .list_profiles()
        .unwrap()
        .into_iter()
        .find(|p| p.name == "Racing")
        .unwrap();
    assert_eq!(racing.processing.left_stick.deadzone, 0.2);
    assert_eq!(racing.games, vec!["forza.exe"]);
    let macros = other.list_macros_for(racing.id).unwrap();
    assert!(
        macros.iter().find(|m| m.name == "Jump").unwrap().enabled,
        "per-profile macro state kept"
    );
    assert!(!macros.iter().find(|m| m.name == "Unused").unwrap().enabled);
    assert_eq!(
        other.active_profile().unwrap().name,
        "Default",
        "import doesn't switch profile"
    );
}

#[test]
fn add_import_never_overwrites_and_renames_clashes() {
    let mut s = populated();
    let before = s.list_profiles().unwrap();
    let json = serde_json::to_string(&s.export_bundle(None, true, "x").unwrap()).unwrap();
    let report = s.import_bundle(&json, ImportMode::Add).unwrap();
    assert!(report
        .renamed
        .contains(&"Racing → Racing (imported)".to_string()));
    assert!(report
        .renamed
        .contains(&"Jump → Jump (imported)".to_string()));
    let after = s.list_profiles().unwrap();
    assert_eq!(after.len(), 4);
    for p in &before {
        assert!(after.contains(p), "existing profile untouched: {}", p.name);
    }
    let copy = after
        .iter()
        .find(|p| p.name == "Racing (imported)")
        .unwrap();
    assert!(
        copy.games.is_empty(),
        "forza.exe stays with the existing Racing profile"
    );
}

#[test]
fn replace_restores_a_backup_exactly() {
    let backup =
        serde_json::to_string(&populated().export_bundle(None, true, "x").unwrap()).unwrap();
    let mut s = ProfileStore::open_in_memory().unwrap();
    s.create_profile("Temporary").unwrap();
    s.save_macro(mac("Temp macro", None)).unwrap();
    s.import_bundle(&backup, ImportMode::Replace).unwrap();
    let names: Vec<String> = s
        .list_profiles()
        .unwrap()
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, vec!["Default", "Racing"]);
    let macros: Vec<String> = s
        .list_macros()
        .unwrap()
        .into_iter()
        .map(|m| m.name)
        .collect();
    assert_eq!(macros, vec!["Jump", "Unused"]);
    assert_eq!(s.active_profile().unwrap().name, "Default");
}

#[test]
fn malformed_or_unsafe_files_are_rejected_without_changes() {
    let mut s = populated();
    let good = s.export_bundle(None, true, "x").unwrap();
    let mut cases: Vec<String> = vec![
        "not json".into(),
        "{}".into(),
        r#"{"format":"other","version":1}"#.into(),
        r#"{"format":"nexus-config","version":99}"#.into(),
        "x".repeat(6 * 1024 * 1024),
    ];
    let mut missing = good.clone();
    missing.profiles[0].enabled_macros.push("nope".into());
    cases.push(serde_json::to_string(&missing).unwrap());
    let mut invalid_macro = good.clone();
    invalid_macro.macros[0].steps.clear();
    cases.push(serde_json::to_string(&invalid_macro).unwrap());
    let mut dup = good.clone();
    dup.macros[1].id = dup.macros[0].id.clone();
    cases.push(serde_json::to_string(&dup).unwrap());
    let mut bad_game = good.clone();
    bad_game.profiles[0].games = vec!["notepad".into()];
    cases.push(serde_json::to_string(&bad_game).unwrap());
    let mut empty = good;
    empty.profiles.clear();

    let before = (s.list_profiles().unwrap(), s.list_macros().unwrap());
    for (i, json) in cases.iter().enumerate() {
        assert!(
            matches!(
                s.import_bundle(json, ImportMode::Add),
                Err(ProfileError::InvalidImport(_))
            ),
            "case {i}"
        );
    }
    let empty = serde_json::to_string(&empty).unwrap();
    assert!(
        s.import_bundle(&empty, ImportMode::Replace).is_err(),
        "replace with nothing refused"
    );
    assert_eq!(
        (s.list_profiles().unwrap(), s.list_macros().unwrap()),
        before,
        "database untouched"
    );
}

#[test]
fn conflicting_macro_triggers_in_an_imported_profile_are_left_off() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    let mut b = s.export_bundle(None, false, "x").unwrap();
    for (i, n) in ["A", "B"].iter().enumerate() {
        let mut m = mac(n, Some(MacroButton::North));
        m.id = format!("id{i}");
        b.macros.push(m);
    }
    b.profiles[0].name = "Imported".into();
    b.profiles[0].enabled_macros = vec!["id0".into(), "id1".into()];
    let report = s
        .import_bundle(&serde_json::to_string(&b).unwrap(), ImportMode::Add)
        .unwrap();
    assert_eq!(report.disabled_for_conflicts, vec!["B (in Imported)"]);
}

#[test]
fn v3_database_migrates_to_v4() {
    let dir = std::env::temp_dir().join(format!("nexus-v3-v4-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("p.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            r#"CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                 virtual_output TEXT NOT NULL DEFAULT 'disabled', settings_json TEXT NOT NULL DEFAULT '{}',
                 created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
               CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
               CREATE TABLE macros (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data_json TEXT NOT NULL,
                 created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
               CREATE TABLE profile_macros (profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                 macro_id TEXT NOT NULL REFERENCES macros(id) ON DELETE CASCADE, PRIMARY KEY (profile_id, macro_id));
               INSERT INTO profiles (name, settings_json, created_at_ms, updated_at_ms) VALUES ('Kept', '{"leftStick":{"deadzone":0.3}}', 1, 1);
               PRAGMA user_version = 3;"#,
        )
        .unwrap();
    }
    let s = ProfileStore::open(&path).unwrap();
    let p = s.active_profile().unwrap();
    assert_eq!(
        (p.name.as_str(), p.processing.left_stick.deadzone),
        ("Kept", 0.3)
    );
    assert!(p.games.is_empty());
    assert!(
        dir.join("p.db.v3.bak").exists(),
        "backed up before migrating"
    );
    drop(s);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn macro_only_export_imports_into_the_library() {
    let s = populated();
    let b = s.export_bundle(Some(&[]), true, "x").unwrap();
    assert!(b.profiles.is_empty());
    assert_eq!(b.macros.len(), 2);
    let mut other = ProfileStore::open_in_memory().unwrap();
    let r = other
        .import_bundle(&serde_json::to_string(&b).unwrap(), ImportMode::Add)
        .unwrap();
    assert_eq!((r.profiles_added, r.macros_added), (0, 2));
    assert_eq!(other.list_macros().unwrap().len(), 2);
    assert!(
        other.list_macros().unwrap().iter().all(|m| !m.enabled),
        "imported macros start switched off"
    );
}
