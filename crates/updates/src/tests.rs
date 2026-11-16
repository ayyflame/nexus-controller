use std::collections::BTreeMap;

use crate::controller::{verify_installed, InstallOutcome};
use crate::manifest::{format_rfc3339_utc, is_rfc3339_utc};
use crate::schedule::Attempt;
use crate::*;

// Fixtures were produced once with `tauri signer` and a throwaway key whose
// private half was destroyed. They are NOT the production key.
const TEST_PUBKEY: &str = include_str!("../tests/fixtures/test-only.pub");
const PAYLOAD: &[u8] = include_bytes!("../tests/fixtures/payload.bin");
const PAYLOAD_SIG: &str = include_str!("../tests/fixtures/payload.bin.sig");

const URL: &str = "https://updates.example.com/stable/0.1.1/NEXUS_0.1.1_x64-setup.exe";

fn manifest(version: &str) -> Manifest {
    Manifest {
        version: version.into(),
        notes: "Bug fixes".into(),
        pub_date: Some("2026-11-20T12:00:00Z".into()),
        platforms: BTreeMap::from([(
            WINDOWS_X64_NSIS.to_owned(),
            Platform {
                url: URL.replace("0.1.1", version),
                signature: PAYLOAD_SIG.trim().into(),
            },
        )]),
    }
}

fn release(v: &str) -> ReleaseInfo {
    ReleaseInfo {
        version: v.into(),
        notes: format!("Notes for {v}"),
        pub_date: None,
    }
}

// ---- versions ---------------------------------------------------------------

#[test]
fn version_comparison_is_semantic_and_never_downgrades() {
    use crate::version::is_update_str as up;
    assert!(up("0.1.0", "0.1.1"));
    assert!(up("0.1.0", "v0.2.0"));
    assert!(up("0.9.9", "0.10.0"), "numeric, not lexical");
    assert!(up("1.9.0", "2.0.0"));
    assert!(!up("0.1.1", "0.1.1"), "equal is not an update");
    assert!(!up("0.2.0", "0.1.9"), "older is never offered");
    assert!(
        !up("0.1.0", "0.2.0-beta.1"),
        "pre-releases are not on Stable"
    );
    assert!(!up("0.1.0", "latest"), "garbage is not an update");
    assert!(!up("garbage", "0.1.1"));
}

// ---- manifest ---------------------------------------------------------------

#[test]
fn valid_manifest_targets_windows_x64_nsis_and_round_trips() {
    let m = manifest("0.1.1");
    m.validate().unwrap();
    let p = m.windows_x64().unwrap();
    assert!(p.url.starts_with("https://") && p.url.ends_with("_x64-setup.exe"));
    assert_eq!(
        m.platforms.keys().collect::<Vec<_>>(),
        vec!["windows-x86_64-nsis"]
    );
    let json = m.to_json();
    assert_eq!(Manifest::parse(&json).unwrap(), m);
    // Exactly the fields the Tauri updater reads.
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    for k in ["version", "notes", "pub_date", "platforms"] {
        assert!(v.get(k).is_some(), "{k}");
    }
    assert!(v["platforms"]["windows-x86_64-nsis"]["signature"].is_string());
}

#[test]
fn invalid_manifests_are_rejected() {
    assert!(matches!(
        Manifest::parse("{not json"),
        Err(ManifestError::Json(_))
    ));
    assert!(matches!(
        Manifest::parse(r#"{"version":"0.1.1"}"#),
        Err(ManifestError::Json(_))
    ));

    let check = |f: &dyn Fn(&mut Manifest)| {
        let mut m = manifest("0.1.1");
        f(&mut m);
        m.validate().unwrap_err()
    };
    let entry = |m: &mut Manifest| m.platforms.get_mut(WINDOWS_X64_NSIS).unwrap().clone();
    let set = |m: &mut Manifest, p: Platform| {
        m.platforms.insert(WINDOWS_X64_NSIS.into(), p);
    };

    assert!(matches!(
        check(&|m| m.version = "1.2".into()),
        ManifestError::BadVersion(_)
    ));
    assert!(matches!(
        check(&|m| m.version = "0.1.1-rc.1".into()),
        ManifestError::PrereleaseOnStable(_)
    ));
    assert!(matches!(
        check(&|m| m.pub_date = Some("yesterday".into())),
        ManifestError::BadDate(_)
    ));
    assert!(matches!(
        check(&|m| m.notes = "x".repeat(20_001)),
        ManifestError::NotesTooLong(_)
    ));
    assert_eq!(
        check(&|m| m.platforms.clear()),
        ManifestError::MissingWindowsX64
    );
    // Only NSIS: no generic or MSI keys that would mix installer formats.
    for k in ["windows-x86_64", "windows-x86_64-msi"] {
        let e = check(&|m| {
            let p = entry(m);
            m.platforms.insert(k.into(), p);
        });
        assert_eq!(e, ManifestError::WrongFormatKey(k.into()));
    }
    let with_url = |u: &'static str| {
        move |m: &mut Manifest| {
            let mut p = entry(m);
            p.url = u.into();
            set(m, p);
        }
    };
    assert!(matches!(
        check(&with_url(
            "http://updates.example.com/stable/0.1.1/NEXUS_0.1.1_x64-setup.exe"
        )),
        ManifestError::InsecureUrl(_)
    ));
    assert!(matches!(
        check(&with_url(
            "https://x.example.com/0.1.1/NEXUS_0.1.1_x64-setup.exe?X-Amz-Signature=abc"
        )),
        ManifestError::TemporaryUrl(_)
    ));
    assert!(matches!(
        check(&with_url(
            "https://x.example.com/0.1.1/NEXUS_0.1.1_x64_en-US.msi"
        )),
        ManifestError::NotNsisInstaller(_)
    ));
    assert!(matches!(
        check(&with_url(
            "https://x.example.com/0.1.0/NEXUS_0.1.0_x64-setup.exe"
        )),
        ManifestError::UrlVersionMismatch { .. }
    ));
    let with_sig = |s: &'static str| {
        move |m: &mut Manifest| {
            let mut p = entry(m);
            p.signature = s.into();
            set(m, p);
        }
    };
    assert_eq!(check(&with_sig("  ")), ManifestError::MissingSignature);
    assert!(matches!(
        check(&with_sig("not base64!")),
        ManifestError::BadSignature(_)
    ));
    assert!(matches!(
        check(&with_sig("aGVsbG8gd29ybGQ=")),
        ManifestError::BadSignature(_)
    ));
}

#[test]
fn publishing_requires_a_newer_version() {
    let new = manifest("0.1.1");
    new.validate_against_published(None).unwrap();
    new.validate_against_published(Some(&manifest("0.1.0")))
        .unwrap();
    for old in ["0.1.1", "0.2.0"] {
        assert!(matches!(
            new.validate_against_published(Some(&manifest(old))),
            Err(ManifestError::NotNewer { .. })
        ));
    }
}

#[test]
fn dates_are_rfc3339_utc() {
    assert_eq!(format_rfc3339_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(format_rfc3339_utc(951_782_400), "2000-02-29T00:00:00Z");
    assert_eq!(format_rfc3339_utc(1_794_805_962), "2026-11-16T05:12:42Z");
    assert!(is_rfc3339_utc("2026-11-20T12:00:00Z"));
    assert!(is_rfc3339_utc("2026-11-20T12:00:00.123Z"));
    for bad in [
        "2026-11-20",
        "2026-13-01T00:00:00Z",
        "2026-11-20T12:00:00+01:00",
        "2026-11-20T25:00:00Z",
        "2026-11-20T12:00:00.Z",
    ] {
        assert!(!is_rfc3339_utc(bad), "{bad}");
    }
}

// ---- signatures -------------------------------------------------------------

#[test]
fn valid_signature_verifies() {
    let comment = signature::verify(TEST_PUBKEY, PAYLOAD, PAYLOAD_SIG, Some("0.1.1")).unwrap();
    assert!(comment.contains("file:payload.bin"));
}

#[test]
fn invalid_signatures_are_rejected() {
    use crate::signature::{verify, SignatureError};
    let mut tampered = PAYLOAD.to_vec();
    tampered[0] ^= 1;
    assert!(matches!(
        verify(TEST_PUBKEY, &tampered, PAYLOAD_SIG, None),
        Err(SignatureError::Mismatch(_))
    ));

    // A signature for different data (re-encoded with one byte of the
    // signature changed) must fail too.
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD;
    let text = String::from_utf8(b64.decode(PAYLOAD_SIG.trim()).unwrap()).unwrap();
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let mut sig_bytes = b64.decode(&lines[1]).unwrap();
    sig_bytes[20] ^= 0xff;
    lines[1] = b64.encode(sig_bytes);
    let forged = b64.encode(lines.join("\n") + "\n");
    assert!(verify(TEST_PUBKEY, PAYLOAD, &forged, None).is_err());

    // A trusted comment edited to claim another file breaks the global signature.
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    lines[2] = "trusted comment: timestamp:1\tfile:other.exe\tversion:9.9.9".into();
    let edited = b64.encode(lines.join("\n") + "\n");
    assert!(verify(TEST_PUBKEY, PAYLOAD, &edited, None).is_err());

    // Some other public key.
    let other_key = b64.encode("untrusted comment: minisign public key: 0000000000000000\nRWQAAAAAAAAAAH4c/iyeF0xdN0V5XEB3MnhPCK0R0ZYeUnlz3QSboMSX\n");
    assert!(verify(&other_key, PAYLOAD, PAYLOAD_SIG, None).is_err());
    assert_eq!(
        verify("%%%", PAYLOAD, PAYLOAD_SIG, None),
        Err(SignatureError::NotBase64)
    );
    assert!(matches!(
        verify(TEST_PUBKEY, PAYLOAD, "", None),
        Err(SignatureError::BadSignature(_))
    ));
}

#[test]
fn signed_version_is_read_from_the_trusted_comment() {
    use crate::signature::signed_version;
    assert_eq!(
        signed_version("timestamp:1\tfile:a.exe\tversion:0.1.1"),
        Some("0.1.1")
    );
    assert_eq!(signed_version("timestamp:1\tfile:a.exe"), None);
}

// ---- schedule ---------------------------------------------------------------

#[test]
fn checks_run_shortly_after_start_then_every_six_hours() {
    let s = Schedule::default();
    let start = 1_000_000;
    let due = |now, last| s.should_check(now, start, last, true, true);
    assert!(!due(start, None), "never during start-up itself");
    assert!(!due(start + 19, None));
    assert!(due(start + 20, None));
    let ok = Some(Attempt {
        at: start + 20,
        ok: true,
    });
    assert!(!due(start + 20 + 6 * 3600 - 1, ok));
    assert!(due(start + 20 + 6 * 3600, ok));
    // Offline: retry after an hour, not six.
    let failed = Some(Attempt {
        at: start + 20,
        ok: false,
    });
    assert!(!due(start + 20 + 3599, failed));
    assert!(due(start + 20 + 3600, failed));
    // A manual check right after launch postpones the first automatic one.
    assert_eq!(
        s.next_due(
            start,
            Some(Attempt {
                at: start + 5,
                ok: true
            })
        ),
        start + 5 + 6 * 3600
    );
}

#[test]
fn disabled_or_unconfigured_never_auto_checks() {
    let s = Schedule::default();
    assert!(
        !s.should_check(u64::MAX, 0, None, false, true),
        "auto-check off"
    );
    assert!(
        !s.should_check(u64::MAX, 0, None, true, false),
        "not configured"
    );
}

// ---- controller -------------------------------------------------------------

#[derive(Default)]
struct Mock {
    check: Option<Result<Option<ReleaseInfo>, UpdateError>>,
    download: Option<Result<u64, UpdateError>>,
    install: Option<Result<(), UpdateError>>,
    checks: usize,
    downloads: usize,
    installs: usize,
}

impl UpdateBackend for Mock {
    fn check(&mut self) -> Result<Option<ReleaseInfo>, UpdateError> {
        self.checks += 1;
        self.check.clone().unwrap_or(Ok(None))
    }
    fn download(&mut self, progress: &mut dyn FnMut(u64, Option<u64>)) -> Result<u64, UpdateError> {
        self.downloads += 1;
        progress(1000, Some(3000));
        progress(2000, Some(3000));
        self.download.clone().unwrap_or(Ok(3000))
    }
    fn install(&mut self) -> Result<(), UpdateError> {
        self.installs += 1;
        self.install.clone().unwrap_or(Ok(()))
    }
}

fn err(kind: ErrorKind) -> UpdateError {
    UpdateError::new(kind, "detail")
}

#[test]
fn no_update_reports_up_to_date_and_records_the_check() {
    let mut c = UpdateController::new("0.1.0", true);
    let mut b = Mock::default();
    c.run_check(&mut b, true, 42).unwrap();
    assert_eq!(c.state(), &UpdateState::UpToDate);
    assert_eq!(c.last_success, Some(42));
    assert!(!c.banner_visible());
}

#[test]
fn new_update_is_offered_downloaded_and_installed() {
    let mut c = UpdateController::new("0.1.0", true);
    let mut b = Mock {
        check: Some(Ok(Some(release("0.1.1")))),
        ..Default::default()
    };
    c.run_check(&mut b, false, 1).unwrap();
    assert_eq!(
        c.state(),
        &UpdateState::Available {
            release: release("0.1.1")
        }
    );
    assert!(c.banner_visible());

    // Install is refused until the package is downloaded and verified.
    assert_eq!(c.begin_install().unwrap_err().kind, ErrorKind::Install);

    c.run_download(&mut b).unwrap();
    assert_eq!(
        c.state(),
        &UpdateState::ReadyToInstall {
            release: release("0.1.1"),
            size: 3000
        }
    );
    c.run_install(&mut b).unwrap();
    assert_eq!(
        c.state(),
        &UpdateState::Installing {
            release: release("0.1.1")
        }
    );
    assert_eq!((b.checks, b.downloads, b.installs), (1, 1, 1));
}

#[test]
fn download_progress_accumulates() {
    let mut c = UpdateController::new("0.1.0", true);
    let mut b = Mock {
        check: Some(Ok(Some(release("0.1.1")))),
        ..Default::default()
    };
    c.run_check(&mut b, true, 1).unwrap();
    c.begin_download().unwrap();
    c.progress(1000, Some(3000));
    c.progress(500, None);
    assert_eq!(
        c.state(),
        &UpdateState::Downloading {
            release: release("0.1.1"),
            downloaded: 1500,
            total: Some(3000)
        }
    );
}

#[test]
fn server_versions_that_are_not_newer_are_ignored() {
    for v in ["0.1.0", "0.0.9", "0.2.0-beta.1", "nonsense"] {
        let mut c = UpdateController::new("0.1.0", true);
        let mut b = Mock {
            check: Some(Ok(Some(release(v)))),
            ..Default::default()
        };
        c.run_check(&mut b, true, 1).unwrap();
        assert_eq!(c.state(), &UpdateState::UpToDate, "{v}");
    }
}

#[test]
fn invalid_manifest_and_offline_are_reported() {
    for kind in [ErrorKind::InvalidManifest, ErrorKind::Offline] {
        let mut c = UpdateController::new("0.1.0", true);
        let mut b = Mock {
            check: Some(Err(err(kind))),
            ..Default::default()
        };
        assert_eq!(c.run_check(&mut b, true, 1).unwrap_err().kind, kind);
        assert!(
            matches!(c.state(), UpdateState::Failed { error, release: None } if error.kind == kind)
        );
        assert_eq!(
            c.last_success, None,
            "a failed check is not a successful check"
        );
        assert!(!c.banner_visible(), "failures never pop up");
    }
}

#[test]
fn background_offline_check_keeps_a_known_update() {
    let mut c = UpdateController::new("0.1.0", true);
    let mut b = Mock {
        check: Some(Ok(Some(release("0.1.1")))),
        ..Default::default()
    };
    c.run_check(&mut b, false, 1).unwrap();
    b.check = Some(Err(err(ErrorKind::Offline)));
    let _ = c.run_check(&mut b, false, 2);
    assert_eq!(
        c.state(),
        &UpdateState::Available {
            release: release("0.1.1")
        }
    );
    // A manual check shows the failure.
    let _ = c.run_check(&mut b, true, 3);
    assert!(matches!(c.state(), UpdateState::Failed { .. }));
}

#[test]
fn invalid_signature_or_failed_download_installs_nothing() {
    for kind in [ErrorKind::InvalidSignature, ErrorKind::Download] {
        let mut c = UpdateController::new("0.1.0", true);
        let mut b = Mock {
            check: Some(Ok(Some(release("0.1.1")))),
            download: Some(Err(err(kind))),
            ..Default::default()
        };
        c.run_check(&mut b, true, 1).unwrap();
        assert_eq!(c.run_download(&mut b).unwrap_err().kind, kind);
        assert!(
            matches!(c.state(), UpdateState::Failed { error, release: Some(r) } if error.kind == kind && r.version == "0.1.1")
        );
        assert_eq!(c.run_install(&mut b).unwrap_err().kind, ErrorKind::Install);
        assert_eq!(b.installs, 0, "an unverified package is never installed");
        // Retry works.
        b.download = None;
        c.run_download(&mut b).unwrap();
        assert!(matches!(c.state(), UpdateState::ReadyToInstall { .. }));
    }
}

#[test]
fn install_failure_returns_to_a_retryable_state() {
    let mut c = UpdateController::new("0.1.0", true);
    let mut b = Mock {
        check: Some(Ok(Some(release("0.1.1")))),
        install: Some(Err(err(ErrorKind::Install))),
        ..Default::default()
    };
    c.run_check(&mut b, true, 1).unwrap();
    c.run_download(&mut b).unwrap();
    assert_eq!(c.run_install(&mut b).unwrap_err().kind, ErrorKind::Install);
    assert!(
        matches!(c.state(), UpdateState::Failed { error, release: Some(_) } if error.kind == ErrorKind::Install)
    );
    assert!(c.begin_download().is_ok(), "the user can try again");
}

#[test]
fn later_hides_the_banner_for_that_version_only() {
    let mut c = UpdateController::new("0.1.0", true);
    let mut b = Mock {
        check: Some(Ok(Some(release("0.1.1")))),
        ..Default::default()
    };
    c.run_check(&mut b, false, 1).unwrap();
    assert_eq!(c.postpone(), Some("0.1.1".into()));
    assert!(!c.banner_visible());
    assert!(
        matches!(c.state(), UpdateState::Available { .. }),
        "still visible in Settings"
    );
    c.run_check(&mut b, false, 2).unwrap();
    assert!(!c.banner_visible(), "same version stays postponed");
    b.check = Some(Ok(Some(release("0.1.2"))));
    c.run_check(&mut b, false, 3).unwrap();
    assert!(c.banner_visible(), "a newer version is shown again");
    // Nothing to postpone when up to date.
    let mut idle = UpdateController::new("0.1.0", true);
    assert_eq!(idle.postpone(), None);
}

#[test]
fn only_one_operation_runs_at_a_time() {
    let mut c = UpdateController::new("0.1.0", true);
    c.begin_check(true).unwrap();
    assert_eq!(c.begin_check(false).unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(c.begin_download().unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(c.begin_install().unwrap_err().kind, ErrorKind::Busy);
    c.finish_check(Ok(Some(release("0.1.1"))), 1);

    c.begin_download().unwrap();
    let during = c.state().clone();
    assert_eq!(c.begin_download().unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(c.begin_check(true).unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(c.begin_install().unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(
        c.state(),
        &during,
        "refused requests don't disturb the download"
    );
    c.finish_download(Ok(10));

    // A downloaded update is not thrown away by a background check.
    assert_eq!(c.begin_check(false).unwrap_err().kind, ErrorKind::Busy);
    c.begin_install().unwrap();
    assert_eq!(c.begin_install().unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(c.begin_check(true).unwrap_err().kind, ErrorKind::Busy);
}

#[test]
fn unconfigured_builds_never_check() {
    let mut c = UpdateController::new("0.1.0", false);
    let mut b = Mock::default();
    assert_eq!(
        c.run_check(&mut b, true, 1).unwrap_err().kind,
        ErrorKind::NotConfigured
    );
    assert_eq!(b.checks, 0);
    assert_eq!(c.state(), &UpdateState::NotConfigured);
}

#[test]
fn stale_completions_are_ignored() {
    let mut c = UpdateController::new("0.1.0", true);
    c.finish_check(Ok(Some(release("0.1.1"))), 1);
    c.finish_download(Ok(1));
    c.finish_install(Err(err(ErrorKind::Install)));
    assert_eq!(c.state(), &UpdateState::Idle);
}

#[test]
fn installed_version_is_verified_after_relaunch() {
    assert_eq!(
        verify_installed("0.1.1", "0.1.1"),
        InstallOutcome::Updated {
            version: "0.1.1".into()
        }
    );
    assert_eq!(
        verify_installed("v0.1.1", "0.1.1"),
        InstallOutcome::Updated {
            version: "0.1.1".into()
        }
    );
    assert_eq!(
        verify_installed("0.1.1", "0.1.0"),
        InstallOutcome::NotApplied {
            expected: "0.1.1".into(),
            running: "0.1.0".into()
        }
    );
}

#[test]
fn state_json_shape_matches_the_ui_contract() {
    let s = UpdateState::Downloading {
        release: release("0.1.1"),
        downloaded: 5,
        total: Some(9),
    };
    assert_eq!(
        serde_json::to_value(&s).unwrap(),
        serde_json::json!({
            "kind": "downloading",
            "release": { "version": "0.1.1", "notes": "Notes for 0.1.1", "pubDate": null },
            "downloaded": 5, "total": 9
        })
    );
    let f = UpdateState::Failed {
        error: err(ErrorKind::InvalidSignature),
        release: None,
    };
    let v = serde_json::to_value(&f).unwrap();
    assert_eq!(v["kind"], "failed");
    assert_eq!(v["error"]["kind"], "invalidSignature");
    assert_eq!(
        serde_json::to_value(UpdateState::ReadyToInstall {
            release: release("1.0.0"),
            size: 3
        })
        .unwrap()["kind"],
        "readyToInstall"
    );
    assert_eq!(
        serde_json::to_value(UpdateState::Checking { manual: true }).unwrap(),
        serde_json::json!({"kind":"checking","manual":true})
    );
    assert_eq!(
        serde_json::to_value(UpdateState::NotConfigured).unwrap()["kind"],
        "notConfigured"
    );
    assert_eq!(
        serde_json::to_value(UpdateState::UpToDate).unwrap()["kind"],
        "upToDate"
    );
}
