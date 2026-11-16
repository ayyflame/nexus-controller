//! End-to-end tests of the release tool with the signed test fixtures.

use std::path::{Path, PathBuf};
use std::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_make-manifest");

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("nexus-make-manifest-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn pubkey() -> String {
    std::fs::read_to_string(fixtures().join("test-only.pub")).unwrap()
}

fn create(
    dir: &Path,
    version: &str,
    installer: &Path,
    published: Option<&Path>,
) -> std::process::Output {
    std::fs::write(dir.join("notes.md"), "Bug fixes and improvements.\n").unwrap();
    let mut cmd = Command::new(BIN);
    cmd.env("TAURI_UPDATER_PUBKEY", pubkey())
        .arg("create")
        .args(["--version", version])
        .args(["--notes-file"])
        .arg(dir.join("notes.md"))
        .args([
            "--url",
            &format!("https://updates.example.com/stable/{version}/NEXUS_{version}_x64-setup.exe"),
        ])
        .args(["--installer"])
        .arg(installer)
        .args(["--signature-file"])
        .arg(fixtures().join("payload.bin.sig"))
        .args(["--pub-date", "2026-11-20T12:00:00Z"])
        .args(["--out"])
        .arg(dir.join("latest.json"));
    if let Some(p) = published {
        cmd.args(["--published"]).arg(p);
    }
    cmd.output().unwrap()
}

#[test]
fn creates_and_verifies_a_signed_manifest() {
    let dir = tmp("ok");
    let out = create(&dir, "0.1.1", &fixtures().join("payload.bin"), None);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("latest.json")).unwrap()).unwrap();
    assert_eq!(json["version"], "0.1.1");
    assert_eq!(json["pub_date"], "2026-11-20T12:00:00Z");
    assert_eq!(json["platforms"].as_object().unwrap().len(), 1);
    assert!(json["platforms"]["windows-x86_64-nsis"]["url"]
        .as_str()
        .unwrap()
        .ends_with("NEXUS_0.1.1_x64-setup.exe"));

    let verify = Command::new(BIN)
        .env("TAURI_UPDATER_PUBKEY", pubkey())
        .args(["verify", "--expect-version", "0.1.1", "--manifest"])
        .arg(dir.join("latest.json"))
        .arg("--installer")
        .arg(fixtures().join("payload.bin"))
        .output()
        .unwrap();
    assert!(
        verify.status.success(),
        "{}",
        String::from_utf8_lossy(&verify.stderr)
    );
}

#[test]
fn refuses_an_installer_that_does_not_match_its_signature() {
    let dir = tmp("tampered");
    let bad = dir.join("tampered.exe");
    std::fs::write(&bad, b"something else").unwrap();
    let out = create(&dir, "0.1.1", &bad, None);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("signature check failed"));
    assert!(!dir.join("latest.json").exists(), "nothing is written");
}

#[test]
fn refuses_to_publish_an_equal_or_older_version() {
    let dir = tmp("older");
    let first = create(&dir, "0.1.1", &fixtures().join("payload.bin"), None);
    assert!(first.status.success());
    let published = dir.join("published.json");
    std::fs::rename(dir.join("latest.json"), &published).unwrap();
    for v in ["0.1.1", "0.1.0"] {
        let out = create(&dir, v, &fixtures().join("payload.bin"), Some(&published));
        assert!(!out.status.success(), "{v}");
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("not newer"),
            "{v}"
        );
    }
    let next = create(
        &dir,
        "0.1.2",
        &fixtures().join("payload.bin"),
        Some(&published),
    );
    assert!(
        next.status.success(),
        "{}",
        String::from_utf8_lossy(&next.stderr)
    );
}

#[test]
fn refuses_to_run_without_the_public_key() {
    let dir = tmp("nokey");
    std::fs::write(dir.join("notes.md"), "x").unwrap();
    let out = Command::new(BIN)
        .env_remove("TAURI_UPDATER_PUBKEY")
        .args([
            "create",
            "--version",
            "0.1.1",
            "--url",
            "https://a.example.com/0.1.1/NEXUS_0.1.1_x64-setup.exe",
            "--out",
        ])
        .arg(dir.join("latest.json"))
        .args(["--notes-file"])
        .arg(dir.join("notes.md"))
        .args(["--installer"])
        .arg(fixtures().join("payload.bin"))
        .args(["--signature-file"])
        .arg(fixtures().join("payload.bin.sig"))
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("TAURI_UPDATER_PUBKEY is not set"));
}
