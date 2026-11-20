use crate::*;
use nexus_controller_core::Button;
use nexus_input_processing::{RemapRule, ResponseCurve};

#[test]
fn create_rename_duplicate_delete_switch() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    let default = s.active_profile().unwrap();
    let fps = s.create_profile("  FPS  ").unwrap();
    assert_eq!(fps.name, "FPS");
    assert_eq!(fps.processing, ProcessingConfig::default());

    let renamed = s.rename_profile(fps.id, "Shooter").unwrap();
    assert_eq!(renamed.name, "Shooter");
    assert!(matches!(
        s.rename_profile(fps.id, "default"),
        Err(ProfileError::NameTaken(_))
    ));
    assert!(matches!(
        s.rename_profile(fps.id, ""),
        Err(ProfileError::InvalidName)
    ));
    assert!(matches!(
        s.rename_profile(fps.id, &"x".repeat(41)),
        Err(ProfileError::InvalidName)
    ));
    assert_eq!(
        s.rename_profile(fps.id, "SHOOTER").unwrap().name,
        "SHOOTER",
        "own name, new case"
    );

    let mut cfg = ProcessingConfig::default();
    cfg.right_stick.curve = ResponseCurve::Power { exponent: 1.8 };
    cfg.remap = vec![RemapRule::new(Button::South, Some(Button::East))];
    s.set_processing(fps.id, &cfg).unwrap();
    s.set_virtual_output(fps.id, VirtualOutputKind::Xbox360)
        .unwrap();

    let copy = s.duplicate_profile(fps.id).unwrap();
    assert_eq!(copy.name, "SHOOTER (copy)");
    assert_eq!(copy.processing, cfg);
    assert_eq!(copy.virtual_output, VirtualOutputKind::Xbox360);
    assert_eq!(
        s.duplicate_profile(fps.id).unwrap().name,
        "SHOOTER (copy 2)"
    );

    s.set_active_profile(copy.id).unwrap();
    let now_active = s.delete_profile(copy.id).unwrap();
    assert_eq!(now_active.id, default.id, "falls back to the first profile");
    assert!(matches!(
        s.get_profile(copy.id),
        Err(ProfileError::NotFound(_))
    ));
}

#[test]
fn cannot_delete_the_last_profile() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    let only = s.active_profile().unwrap();
    assert!(matches!(
        s.delete_profile(only.id),
        Err(ProfileError::LastProfile)
    ));
    assert!(matches!(
        s.delete_profile(999),
        Err(ProfileError::NotFound(999))
    ));
}

#[test]
fn processing_settings_are_sanitised_and_survive_reopen() {
    let dir = std::env::temp_dir().join(format!("nexus-profile-v3-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = dir.join("p.db");
    let id = {
        let mut s = ProfileStore::open(&path).unwrap();
        let mut cfg = ProcessingConfig::default();
        cfg.left_stick.deadzone = 7.0; // out of range
        cfg.left_trigger.deadzone = 0.2;
        let id = s.active_profile().unwrap().id;
        let saved = s.set_processing(id, &cfg).unwrap();
        assert_eq!(saved.processing.left_stick.deadzone, 0.9);
        id
    };
    let s = ProfileStore::open(&path).unwrap();
    let p = s.get_profile(id).unwrap();
    assert_eq!(p.processing.left_trigger.deadzone, 0.2);
    drop(s);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn unreadable_settings_fall_back_to_defaults() {
    let s = ProfileStore::open_in_memory().unwrap();
    let id = s.active_profile().unwrap().id;
    s.conn
        .execute(
            "UPDATE profiles SET settings_json = '{broken' WHERE id = ?1",
            [id],
        )
        .unwrap();
    assert_eq!(
        s.get_profile(id).unwrap().processing,
        ProcessingConfig::default()
    );
    s.conn
        .execute(r#"UPDATE profiles SET settings_json = '{"leftStick":{"deadzone":0.3},"futureField":1}' WHERE id = ?1"#, [id])
        .unwrap();
    assert_eq!(
        s.get_profile(id).unwrap().processing.left_stick.deadzone,
        0.3,
        "unknown fields ignored"
    );
}

#[test]
fn v2_database_migrates_to_v3_preserving_macros_and_enabled_state() {
    let dir = std::env::temp_dir().join(format!("nexus-v2-v3-{}", std::process::id()));
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
               INSERT INTO profiles (name, virtual_output, created_at_ms, updated_at_ms) VALUES ('Mine', 'dualShock4', 1, 1), ('Two', 'disabled', 2, 2);
               INSERT INTO app_settings VALUES ('last_profile_id', '2');
               INSERT INTO macros VALUES ('on', 0, '{"id":"on","name":"On","enabled":true,"steps":[{"buttons":["south"],"holdMs":100,"delayAfterMs":0}],"trigger":"north"}', 1, 1);
               INSERT INTO macros VALUES ('off', 1, '{"id":"off","name":"Off","enabled":false,"steps":[{"buttons":["east"],"holdMs":100,"delayAfterMs":0}]}', 1, 1);
               PRAGMA user_version = 2;"#,
        )
        .unwrap();
    }
    let s = ProfileStore::open(&path).unwrap();
    let version: i64 = s
        .conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(
        version,
        crate::SCHEMA_VERSION,
        "migrated to the current schema"
    );
    assert_eq!(
        s.active_profile().unwrap().name,
        "Two",
        "last-used profile kept"
    );
    let profiles = s.list_profiles().unwrap();
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].virtual_output, VirtualOutputKind::DualShock4);
    assert_eq!(
        profiles[0].processing,
        ProcessingConfig::default(),
        "'{{}}' settings load as defaults"
    );
    for p in &profiles {
        let m = s.list_macros_for(p.id).unwrap();
        assert_eq!(m.len(), 2);
        assert!(
            m.iter().find(|x| x.id == "on").unwrap().enabled,
            "enabled macro on in {}",
            p.name
        );
        assert!(!m.iter().find(|x| x.id == "off").unwrap().enabled);
    }
    drop(s);
    // Re-opening does not migrate again.
    let s = ProfileStore::open(&path).unwrap();
    assert_eq!(s.list_macros().unwrap().len(), 2);
    drop(s);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn old_database_is_backed_up_before_migration() {
    let dir = std::env::temp_dir().join(format!("nexus-backup-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("nexus.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
               virtual_output TEXT NOT NULL DEFAULT 'disabled', settings_json TEXT NOT NULL DEFAULT '{}',
               created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
             CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO profiles (name, created_at_ms, updated_at_ms) VALUES ('Old', 1, 1);
             PRAGMA user_version = 1;",
        )
        .unwrap();
    }
    let s = ProfileStore::open(&path).unwrap();
    assert_eq!(s.active_profile().unwrap().name, "Old");
    drop(s);
    let backup = dir.join("nexus.db.v1.bak");
    assert!(backup.exists(), "backup written");
    let b = rusqlite::Connection::open(&backup).unwrap();
    let v: i64 = b
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(v, 1, "backup is the untouched old version");
    // A current database is not backed up again.
    assert_eq!(ProfileStore::backup_before_migration(&path).unwrap(), None);
    let _ = std::fs::remove_dir_all(dir);
}

// ---- Calibration is stored per profile -----------------------------------------

#[test]
fn calibration_is_kept_per_profile_across_switching_and_reopening() {
    use nexus_input_processing::StickCalibration;
    let dir = std::env::temp_dir().join(format!("nexus-cal-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("nexus.db");
    let cal = StickCalibration {
        center_x: 0.04,
        center_y: -0.03,
        min_x: -0.9,
        max_x: 0.95,
        min_y: -0.92,
        max_y: 0.97,
    };
    let (a_id, b_id) = {
        let mut s = ProfileStore::open(&path).unwrap();
        let a = s.active_profile().unwrap();
        let b = s.create_profile("Racing").unwrap();
        let mut cfg = a.processing.clone();
        cfg.left_stick.calibration = cal;
        cfg.left_stick.deadzone = 0.06;
        cfg.right_trigger.raw_min = 0.01;
        cfg.right_trigger.raw_max = 0.9;
        cfg.remap = vec![RemapRule::new(Button::South, Some(Button::East))];
        s.set_processing(a.id, &cfg).unwrap();
        // Switching profiles loads the other profile's (default) calibration.
        let now_b = s.set_active_profile(b.id).unwrap();
        assert_eq!(
            now_b.processing.left_stick.calibration,
            StickCalibration::default()
        );
        assert_eq!(now_b.processing.right_trigger.raw_max, 1.0);
        (a.id, b.id)
    };
    // After reopening (an app restart), each profile still has its own values.
    let mut s = ProfileStore::open(&path).unwrap();
    assert_eq!(s.active_profile().unwrap().id, b_id, "last-used profile");
    let a = s.set_active_profile(a_id).unwrap();
    assert_eq!(a.processing.left_stick.calibration, cal);
    assert_eq!(a.processing.left_stick.deadzone, 0.06);
    assert_eq!(
        (
            a.processing.right_trigger.raw_min,
            a.processing.right_trigger.raw_max
        ),
        (0.01, 0.9)
    );
    assert_eq!(a.processing.remap.len(), 1, "mappings kept alongside");
    assert_eq!(
        s.get_profile(b_id)
            .unwrap()
            .processing
            .left_stick
            .calibration,
        StickCalibration::default()
    );
    drop(s);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn out_of_range_calibration_is_limited_when_saved() {
    use nexus_input_processing::StickCalibration;
    let mut s = ProfileStore::open_in_memory().unwrap();
    let p = s.active_profile().unwrap();
    let mut cfg = p.processing.clone();
    cfg.left_stick.calibration = StickCalibration {
        center_x: 0.9,
        center_y: f32::NAN,
        min_x: 0.5,
        max_x: -0.5,
        min_y: -1.0,
        max_y: 1.0,
    };
    cfg.left_trigger.raw_min = 0.95;
    let saved = s.set_processing(p.id, &cfg).unwrap().processing;
    let c = saved.left_stick.calibration;
    assert_eq!((c.center_x, c.center_y), (0.5, 0.0));
    assert!(c.min_x <= -0.2 && c.max_x >= 0.2);
    assert!(saved.left_trigger.raw_min <= 0.5);
}

#[test]
fn default_profile_is_used_at_start_and_cleared_when_deleted() {
    let dir = std::env::temp_dir().join(format!("nexus-default-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("profiles.db");
    let _ = std::fs::remove_file(&path);
    let (game, other);
    {
        let mut s = ProfileStore::open(&path).unwrap();
        assert_eq!(s.default_profile().unwrap(), None, "none chosen at first");
        game = s.create_profile("Warzone").unwrap().id;
        other = s.create_profile("Other").unwrap().id;
        assert_eq!(s.set_default_profile(Some(game)).unwrap(), Some(game));
        s.set_active_profile(other).unwrap();
    }
    {
        // Next start: the default profile is switched on.
        let mut s = ProfileStore::open(&path).unwrap();
        assert_eq!(s.activate_default_profile().unwrap().id, game);
        assert_eq!(s.active_profile().unwrap().id, game);
        // Unknown ids are refused; clearing works.
        assert!(s.set_default_profile(Some(9999)).is_err());
        assert_eq!(s.set_default_profile(None).unwrap(), None);
        s.set_default_profile(Some(other)).unwrap();
        // Deleting the default profile leaves no default (and start-up keeps the active one).
        s.set_active_profile(game).unwrap();
        s.delete_profile(other).unwrap();
        assert_eq!(s.default_profile().unwrap(), None);
        assert_eq!(s.activate_default_profile().unwrap().id, game);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stick_swap_and_stick_buttons_are_kept_per_profile_across_restarts() {
    use nexus_input_processing::{StickButtons, StickDirections, StickRouting, StickSource};
    let dir = std::env::temp_dir().join(format!("nexus-sticks-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("nexus.db");
    let buttons = StickButtons {
        enabled: true,
        up: Some(Button::DpadUp),
        down: Some(Button::DpadDown),
        left: Some(Button::DpadLeft),
        right: Some(Button::RightTrigger),
        threshold_x: 0.35,
        threshold_y: 0.7,
        hysteresis: 0.15,
        directions: StickDirections::Four,
        passthrough: true,
    };
    let routing = StickRouting {
        left_output: StickSource::Right,
        right_output: StickSource::Left,
    };
    let (a_id, b_id) = {
        let mut s = ProfileStore::open(&path).unwrap();
        let a = s.active_profile().unwrap();
        let b = s.create_profile("Menus").unwrap();
        let mut cfg = a.processing.clone();
        cfg.stick_routing = routing;
        cfg.left_stick.buttons = buttons;
        cfg.left_stick.deadzone = 0.12;
        s.set_processing(a.id, &cfg).unwrap();
        let now_b = s.set_active_profile(b.id).unwrap();
        assert_eq!(
            now_b.processing.stick_routing,
            StickRouting::default(),
            "other profile untouched"
        );
        assert!(!now_b.processing.left_stick.buttons.enabled);
        (a.id, b.id)
    };
    let mut s = ProfileStore::open(&path).unwrap();
    let a = s.set_active_profile(a_id).unwrap();
    assert_eq!(a.processing.stick_routing, routing);
    assert_eq!(a.processing.left_stick.buttons, buttons);
    assert_eq!(
        a.processing.left_stick.deadzone, 0.12,
        "existing settings kept alongside"
    );
    assert_eq!(
        s.get_profile(b_id).unwrap().processing.stick_routing,
        StickRouting::default()
    );
    drop(s);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn app_settings_survive_a_restart() {
    // Settings › Windows (close/minimise to tray, start hidden) is stored here.
    let dir = std::env::temp_dir().join(format!("nexus-settings-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("nexus.db");
    {
        let mut s = ProfileStore::open(&path).unwrap();
        assert_eq!(s.get_setting("window_behaviour").unwrap(), None);
        s.set_setting("window_behaviour", r#"{"closeToTray":false}"#)
            .unwrap();
        s.set_setting(
            "window_behaviour",
            r#"{"closeToTray":true,"minimizeToTray":true}"#,
        )
        .unwrap();
    }
    let s = ProfileStore::open(&path).unwrap();
    assert_eq!(
        s.get_setting("window_behaviour").unwrap().as_deref(),
        Some(r#"{"closeToTray":true,"minimizeToTray":true}"#),
        "the latest value, once"
    );
    drop(s);
    let _ = std::fs::remove_dir_all(&dir);
}
