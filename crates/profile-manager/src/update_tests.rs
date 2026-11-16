//! User data must survive an app update. An update replaces the program files
//! only. The database in the data folder is opened by the new version, which
//! has the same or a newer schema. These tests simulate that and also check
//! the pre-update snapshot.

use crate::ImportMode;
use crate::*;
use nexus_controller_core::Button;
use nexus_input_processing::{RemapRule, StickCalibration};
use nexus_macro_engine::{Macro, MacroButton, MacroStep, PlaybackMode};

fn dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("nexus-update-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Profiles, calibration, games, macros and app settings, everything a user owns.
fn populate(s: &mut ProfileStore) -> i64 {
    let p = s.create_profile("Shooter").unwrap();
    let mut cfg = ProcessingConfig::default();
    cfg.left_stick.deadzone = 0.12;
    cfg.left_stick.calibration = StickCalibration {
        center_x: 0.02,
        center_y: -0.01,
        min_x: -0.97,
        max_x: 0.98,
        min_y: -0.99,
        max_y: 0.96,
    };
    cfg.right_trigger.raw_min = 0.03;
    cfg.right_trigger.raw_max = 0.94;
    cfg.gyro.bias = [1.5, -2.0, 0.25];
    cfg.remap.push(RemapRule {
        from: Button::South,
        to: Some(Button::East),
        also: vec![],
    });
    s.set_processing(p.id, &cfg).unwrap();
    s.set_profile_games(p.id, &["game.exe".to_owned()]).unwrap();
    s.save_macro(Macro {
        id: String::new(),
        name: "Combo".into(),
        description: "two presses".into(),
        enabled: true,
        steps: vec![MacroStep {
            id: String::new(),
            buttons: vec![MacroButton::West],
            hold_ms: 80,
            delay_after_ms: 20,
        }],
        trigger: Some(MacroButton::RightStick),
        mode: PlaybackMode::Once,
        repeat_delay_ms: 50,
        block_trigger: true,
        created_at_ms: 0,
        updated_at_ms: 0,
    })
    .unwrap();
    s.set_setting("onboarding_done", "true").unwrap();
    s.set_auto_switch_enabled(true).unwrap();
    s.set_active_profile(p.id).unwrap();
    p.id
}

type Everything = (Vec<Profile>, Vec<Macro>, Profile, Option<String>, bool);

fn everything(s: &ProfileStore) -> Everything {
    (
        s.list_profiles().unwrap(),
        s.list_macros().unwrap(),
        s.active_profile().unwrap(),
        s.get_setting("onboarding_done").unwrap(),
        s.auto_switch_enabled().unwrap(),
    )
}

#[test]
fn user_data_is_intact_after_an_update() {
    let d = dir("intact");
    let db = d.join("nexus.db");
    let (before, active_id) = {
        let mut s = ProfileStore::open(&db).unwrap();
        let id = populate(&mut s);
        // The updater records what it is installing, then snapshots the database.
        s.set_setting("updates.expected_version", "0.1.1").unwrap();
        s.snapshot_to(&d.join("backups/pre-update 0.1.0 to 0.1.1.db"))
            .unwrap();
        (everything(&s), id)
        // Dropped here: the old version exits for the installer.
    };

    // The new version starts and opens the same file.
    let after = ProfileStore::open(&db).unwrap();
    assert_eq!(everything(&after), before);
    assert_eq!(after.active_profile().unwrap().id, active_id);
    let cal = after
        .active_profile()
        .unwrap()
        .processing
        .left_stick
        .calibration;
    assert_eq!(cal.max_x, 0.98, "calibration survives");
    assert_eq!(
        after.profile_for_game("game.exe").unwrap().map(|p| p.id),
        Some(active_id)
    );
    assert_eq!(
        after
            .get_setting("updates.expected_version")
            .unwrap()
            .as_deref(),
        Some("0.1.1")
    );

    // The pre-update snapshot is a complete, openable copy.
    let snap = ProfileStore::open(&d.join("backups/pre-update 0.1.0 to 0.1.1.db")).unwrap();
    assert_eq!(everything(&snap), before);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn snapshot_never_overwrites_an_existing_file() {
    let d = dir("snapshot");
    let s = ProfileStore::open(&d.join("nexus.db")).unwrap();
    let dest = d.join("copy.db");
    s.snapshot_to(&dest).unwrap();
    assert!(s.snapshot_to(&dest).is_err());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn edited_macro_timing_survives_save_duplicate_export_and_import() {
    let mut s = ProfileStore::open_in_memory().unwrap();
    // A recorded macro with uneven timing...
    let recorded = s
        .save_macro(Macro {
            id: String::new(),
            name: "Recorded".into(),
            description: String::new(),
            enabled: true,
            steps: vec![
                MacroStep {
                    id: String::new(),
                    buttons: vec![MacroButton::South],
                    hold_ms: 87,
                    delay_after_ms: 143,
                },
                MacroStep {
                    id: String::new(),
                    buttons: vec![MacroButton::East],
                    hold_ms: 112,
                    delay_after_ms: 0,
                },
            ],
            trigger: Some(MacroButton::RightStick),
            mode: PlaybackMode::RepeatWhileHeld,
            repeat_delay_ms: 50,
            block_trigger: true,
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
    // ...edited afterwards, without re-recording.
    let mut edited = recorded.clone();
    edited.steps[0].hold_ms = 40;
    edited.steps[0].delay_after_ms = 60;
    edited.steps[1].hold_ms = 30;
    edited.repeat_delay_ms = 20;
    s.save_macro(edited).unwrap();
    let timing = |m: &Macro| -> Vec<(u32, u32)> {
        m.steps
            .iter()
            .map(|x| (x.hold_ms, x.delay_after_ms))
            .collect()
    };
    let want = vec![(40, 60), (30, 0)];

    let saved = s
        .list_macros()
        .unwrap()
        .into_iter()
        .find(|m| m.id == recorded.id)
        .unwrap();
    assert_eq!(timing(&saved), want);
    assert_eq!(saved.repeat_delay_ms, 20);
    assert_eq!(saved.mode, PlaybackMode::RepeatWhileHeld, "mode untouched");

    let copy = s.duplicate_macro(&recorded.id).unwrap();
    assert_eq!(timing(&copy), want);

    let json = serde_json::to_string(&s.export_bundle(None, true, "test").unwrap()).unwrap();
    let mut other = ProfileStore::open_in_memory().unwrap();
    other.import_bundle(&json, ImportMode::Add).unwrap();
    let imported = other.list_macros().unwrap();
    assert_eq!(imported.len(), 2);
    assert!(imported
        .iter()
        .all(|m| timing(m) == want && m.repeat_delay_ms == 20));
}
