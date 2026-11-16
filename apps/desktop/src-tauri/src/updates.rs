//! Automatic updates, using the official Tauri updater plugin.
//!
//! - All network and install work happens here in Rust. The webview gets no
//!   updater, HTTP or shell permission.
//! - Policy (versions, schedule, one operation at a time, error kinds) lives
//!   in the `nexus-updates` crate and is unit-tested there.
//! - The update server and public key are set only in release builds. CI
//!   injects them with `tauri build --config`. Development builds report "not
//!   configured" and never contact anything.
//! - The plugin verifies the installer's minisign signature after downloading
//!   and again before installing. An unsigned or tampered package is never run.
//! - Install (Windows, NSIS, passive): NEXUS backs up the database, records the
//!   version it expects, stops the controller engine, starts the installer and
//!   exits. The installer then reopens NEXUS, which checks that the expected
//!   version is running.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use nexus_updates::controller::{verify_installed, InstallOutcome, Phase};
use nexus_updates::schedule::{Attempt, Schedule};
use nexus_updates::{ErrorKind, ReleaseInfo, UpdateController, UpdateError, UpdateState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Error as PluginError, Update, UpdaterExt};

use crate::AppState;

pub const EVENT: &str = "nexus://update";
pub const CHANNEL: &str = "stable";

const KEY_AUTO: &str = "updates.auto_check";
const KEY_LAST_SUCCESS: &str = "updates.last_success";
const KEY_POSTPONED: &str = "updates.postponed";
const KEY_EXPECTED: &str = "updates.expected_version";

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// What the UI shows in Settings → Updates and the update banner.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub configured: bool,
    pub current_version: String,
    pub channel: &'static str,
    pub auto_check: bool,
    /// Unix milliseconds of the last successful check.
    pub last_success_ms: Option<u64>,
    pub state: UpdateState,
    pub banner: bool,
    pub postponed: Option<String>,
    /// Result of the update installed before this launch, if any.
    pub outcome: Option<InstallOutcome>,
}

pub struct UpdateService {
    ctl: Mutex<UpdateController>,
    pending: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
    auto_check: AtomicBool,
    started_at: u64,
    last_attempt: Mutex<Option<Attempt>>,
    outcome: Mutex<Option<InstallOutcome>>,
    stop: AtomicBool,
}

/// Whether this build has an update server and public key.
pub fn configured(app: &AppHandle) -> bool {
    let Some(cfg) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let pubkey = cfg.get("pubkey").and_then(|v| v.as_str()).unwrap_or("");
    let endpoints = cfg
        .get("endpoints")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    !pubkey.trim().is_empty()
        && nexus_updates::signature::decode_public_key(pubkey).is_ok()
        && !endpoints.is_empty()
        && endpoints
            .iter()
            .all(|e| e.as_str().is_some_and(|s| s.starts_with("https://")))
}

impl UpdateService {
    /// Reads saved preferences and verifies the result of a previous update.
    pub fn init(app: &AppHandle, state: &AppState) -> Self {
        let current = env!("CARGO_PKG_VERSION");
        let mut ctl = UpdateController::new(current, configured(app));
        let (auto, outcome) = match state.store.lock() {
            Ok(mut store) => {
                let get = |k| store.get_setting(k).ok().flatten();
                let auto = get(KEY_AUTO).is_none_or(|v| v != "false");
                ctl.last_success = get(KEY_LAST_SUCCESS).and_then(|v| v.parse().ok());
                ctl.postponed = get(KEY_POSTPONED);
                let outcome = get(KEY_EXPECTED)
                    .filter(|v| !v.is_empty())
                    .map(|expected| verify_installed(&expected, current));
                if outcome.is_some() {
                    let _ = store.set_setting(KEY_EXPECTED, "");
                }
                (auto, outcome)
            }
            Err(_) => (true, None),
        };
        Self {
            ctl: Mutex::new(ctl),
            pending: Mutex::new(None),
            bytes: Mutex::new(None),
            auto_check: AtomicBool::new(auto),
            started_at: now(),
            last_attempt: Mutex::new(None),
            outcome: Mutex::new(outcome),
            stop: AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> UpdateStatus {
        let ctl = self.ctl.lock().expect("update state");
        UpdateStatus {
            configured: ctl.configured(),
            current_version: ctl.current_version(),
            channel: CHANNEL,
            auto_check: self.auto_check.load(Ordering::Relaxed),
            last_success_ms: ctl.last_success.map(|s| s * 1000),
            state: ctl.state().clone(),
            banner: ctl.banner_visible(),
            postponed: ctl.postponed.clone(),
            outcome: self.outcome.lock().ok().and_then(|o| o.clone()),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn service(app: &AppHandle) -> tauri::State<'_, UpdateService> {
    app.state::<UpdateService>()
}

fn emit(app: &AppHandle) {
    let _ = app.emit(EVENT, service(app).status());
}

fn save_setting(app: &AppHandle, key: &str, value: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut store) = state.store.lock() {
            let _ = store.set_setting(key, value);
        }
    }
}

/// Maps plugin errors to the kinds the UI understands.
pub fn classify(e: &PluginError, phase: Phase) -> UpdateError {
    use PluginError as E;
    let fallback = match phase {
        Phase::Check => ErrorKind::InvalidManifest,
        Phase::Download => ErrorKind::Download,
        Phase::Install => ErrorKind::Install,
    };
    let kind = match e {
        E::EmptyEndpoints | E::InsecureTransportProtocol => ErrorKind::NotConfigured,
        E::Reqwest(r) if r.is_decode() => ErrorKind::InvalidManifest,
        E::Reqwest(_) if phase == Phase::Check => ErrorKind::Offline,
        E::Reqwest(_) => ErrorKind::Download,
        E::ReleaseNotFound | E::Serialization(_) | E::Semver(_) | E::UrlParse(_) => {
            ErrorKind::InvalidManifest
        }
        E::TargetsNotFound(targets) if targets.iter().any(|t| t.ends_with("-msi")) => {
            ErrorKind::UnsupportedInstall
        }
        E::TargetNotFound(_) | E::TargetsNotFound(_) => ErrorKind::InvalidManifest,
        E::UnsupportedArch | E::UnsupportedOs => ErrorKind::UnsupportedInstall,
        E::Minisign(_)
        | E::Base64(_)
        | E::SignatureUtf8(_)
        | E::SignedVersionMismatch { .. }
        | E::MissingSignedVersion => ErrorKind::InvalidSignature,
        E::Network(_) => fallback,
        _ => fallback,
    };
    UpdateError::new(kind, e.to_string())
}

/// Stops everything that holds a controller or the database open. Used on
/// normal exit and right before the installer replaces the program files.
pub fn shutdown_runtime(app: &AppHandle) {
    if let Some(s) = app.try_state::<UpdateService>() {
        s.stop();
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(w) = state.game_watch.get() {
            w.stop();
        }
        state.bridge.stop();
        // Releases controller handles and any virtual devices.
        state.engine.shutdown();
    }
}

// ---- operations ---------------------------------------------------------------

async fn fetch(app: &AppHandle) -> Result<Option<(ReleaseInfo, Update)>, UpdateError> {
    let handle = app.clone();
    let updater = app
        .updater_builder()
        // Our rules: strictly newer stable releases only (no downgrades).
        .version_comparator(|current, release| {
            nexus_updates::version::is_update(&current, &release.version)
        })
        .timeout(Duration::from_secs(60))
        .on_before_exit(move || {
            shutdown_runtime(&handle);
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(|e| classify(&e, Phase::Check))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|e| classify(&e, Phase::Check))?
    else {
        return Ok(None);
    };
    if update.download_url.scheme() != "https" {
        return Err(UpdateError::new(
            ErrorKind::InvalidManifest,
            format!("download URL is not HTTPS: {}", update.download_url),
        ));
    }
    let info = ReleaseInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        pub_date: update
            .raw_json
            .get("pub_date")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
    };
    Ok(Some((info, update)))
}

/// Returns false if no check ran (not configured, or another operation is
/// in progress; the current state already says so).
pub async fn check(app: &AppHandle, manual: bool) -> bool {
    let svc = service(app);
    if svc
        .ctl
        .lock()
        .expect("update state")
        .begin_check(manual)
        .is_err()
    {
        emit(app);
        return false;
    }
    emit(app);
    let result = fetch(app).await;
    let at = now();
    *svc.last_attempt.lock().expect("attempt") = Some(Attempt {
        at,
        ok: result.is_ok(),
    });
    let result = result.map(|found| {
        found.map(|(info, update)| {
            *svc.pending.lock().expect("pending") = Some(update);
            info
        })
    });
    if let Err(e) = &result {
        eprintln!("NEXUS: update check failed: {e}");
    }
    let ok = result.is_ok();
    svc.ctl
        .lock()
        .expect("update state")
        .finish_check(result, at);
    if ok {
        save_setting(app, KEY_LAST_SUCCESS, &at.to_string());
    }
    emit(app);
    true
}

pub async fn download(app: &AppHandle) {
    let svc = service(app);
    if svc
        .ctl
        .lock()
        .expect("update state")
        .begin_download()
        .is_err()
    {
        emit(app);
        return;
    }
    save_setting(app, KEY_POSTPONED, "");
    emit(app);
    let update = svc.pending.lock().expect("pending").clone();
    let result = match update {
        None => Err(UpdateError::new(
            ErrorKind::Download,
            "check for updates again first",
        )),
        Some(update) => {
            let mut last = Instant::now();
            let progress_app = app.clone();
            let r = update
                .download(
                    |chunk, total| {
                        let s = service(&progress_app);
                        s.ctl
                            .lock()
                            .expect("update state")
                            .progress(chunk as u64, total);
                        if last.elapsed() >= Duration::from_millis(150) {
                            last = Instant::now();
                            emit(&progress_app);
                        }
                    },
                    || {},
                )
                .await;
            // `download` has verified the signature at this point.
            r.map_err(|e| classify(&e, Phase::Download)).map(|bytes| {
                let size = bytes.len() as u64;
                *svc.bytes.lock().expect("bytes") = Some(bytes);
                size
            })
        }
    };
    if let Err(e) = &result {
        eprintln!("NEXUS: update download failed: {e}");
    }
    svc.ctl
        .lock()
        .expect("update state")
        .finish_download(result);
    emit(app);
}

/// Backs up the database, then starts the installer. On Windows a successful
/// install exits this process; the installer reopens NEXUS.
pub async fn install(app: &AppHandle) {
    let svc = service(app);
    let release = match svc.ctl.lock().expect("update state").begin_install() {
        Ok(r) => r,
        Err(_) => {
            emit(app);
            return;
        }
    };
    emit(app);
    let result = prepare_and_install(app, &release);
    // Only reached if the installer could not be started (or on platforms
    // where installing does not exit).
    match result {
        Ok(()) => app.restart(),
        Err(e) => {
            eprintln!("NEXUS: update install failed: {e}");
            save_setting(app, KEY_EXPECTED, "");
            svc.ctl.lock().expect("update state").finish_install(Err(e));
            emit(app);
        }
    }
}

fn prepare_and_install(app: &AppHandle, release: &ReleaseInfo) -> Result<(), UpdateError> {
    let svc = service(app);
    let bytes = svc.bytes.lock().expect("bytes").take();
    let update = svc.pending.lock().expect("pending").clone();
    let (Some(bytes), Some(update)) = (bytes, update) else {
        return Err(UpdateError::new(
            ErrorKind::Install,
            "download the update again",
        ));
    };
    // 1. A consistent copy of profiles, macros, calibration and settings.
    if let Some(state) = app.try_state::<AppState>() {
        let store = state
            .store
            .lock()
            .map_err(|_| UpdateError::new(ErrorKind::Install, "store poisoned"))?;
        if let Some(dir) = state.data_dir.as_ref() {
            let name = format!(
                "pre-update {} to {} {}.db",
                env!("CARGO_PKG_VERSION"),
                release.version,
                crate::commands::stamp()
            );
            store
                .snapshot_to(&dir.join("backups").join(name))
                .map_err(|e| {
                    UpdateError::new(
                        ErrorKind::Install,
                        format!("couldn't back up your data first, so nothing was installed: {e}"),
                    )
                })?;
        }
    }
    // 2. Remember what we expect to be running after the restart.
    save_setting(app, KEY_EXPECTED, &release.version);
    // 3. Verifies the signature again, stops the engine (on_before_exit),
    //    starts the NSIS installer in passive mode and exits.
    update
        .install(bytes)
        .map_err(|e| classify(&e, Phase::Install))
}

pub fn postpone(app: &AppHandle) {
    let v = service(app).ctl.lock().expect("update state").postpone();
    if let Some(v) = v {
        save_setting(app, KEY_POSTPONED, &v);
    }
    emit(app);
}

pub fn set_auto_check(app: &AppHandle, enabled: bool) {
    service(app).auto_check.store(enabled, Ordering::Relaxed);
    save_setting(app, KEY_AUTO, if enabled { "true" } else { "false" });
    emit(app);
}

pub fn dismiss_outcome(app: &AppHandle) {
    *service(app).outcome.lock().expect("outcome") = None;
    emit(app);
}

/// Background thread for automatic checks. It never blocks start-up: the
/// first check runs ~20 s after launch, and failures are only shown quietly in
/// Settings.
pub fn spawn_scheduler(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("nexus-updates".into())
        .spawn(move || {
            let schedule = Schedule::default();
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let svc = service(&app);
                if svc.stop.load(Ordering::Relaxed) {
                    return;
                }
                let last = *svc.last_attempt.lock().expect("attempt");
                let configured = svc.ctl.lock().expect("update state").configured();
                let auto = svc.auto_check.load(Ordering::Relaxed);
                let due = schedule.should_check(now(), svc.started_at, last, auto, configured);
                // If busy (e.g. a download is running), try again next interval.
                if due && !tauri::async_runtime::block_on(check(&app, false)) {
                    *svc.last_attempt.lock().expect("attempt") = Some(Attempt {
                        at: now(),
                        ok: true,
                    });
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_errors_map_to_user_facing_kinds() {
        let k = |e: PluginError, p| classify(&e, p).kind;
        assert_eq!(
            k(PluginError::EmptyEndpoints, Phase::Check),
            ErrorKind::NotConfigured
        );
        assert_eq!(
            k(PluginError::InsecureTransportProtocol, Phase::Check),
            ErrorKind::NotConfigured
        );
        assert_eq!(
            k(PluginError::ReleaseNotFound, Phase::Check),
            ErrorKind::InvalidManifest
        );
        let json_err = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
        assert_eq!(
            k(PluginError::Serialization(json_err), Phase::Check),
            ErrorKind::InvalidManifest
        );
        assert_eq!(
            k(PluginError::Network("status 404".into()), Phase::Check),
            ErrorKind::InvalidManifest
        );
        assert_eq!(
            k(PluginError::Network("status 500".into()), Phase::Download),
            ErrorKind::Download
        );
        assert_eq!(
            k(
                PluginError::TargetsNotFound(vec![
                    "windows-x86_64-msi".into(),
                    "windows-x86_64".into()
                ]),
                Phase::Check
            ),
            ErrorKind::UnsupportedInstall,
            "MSI installs are told to use the setup .exe"
        );
        assert_eq!(
            k(
                PluginError::TargetsNotFound(vec![
                    "windows-x86_64-nsis".into(),
                    "windows-x86_64".into()
                ]),
                Phase::Check
            ),
            ErrorKind::InvalidManifest
        );
        assert_eq!(
            k(PluginError::SignatureUtf8("x".into()), Phase::Download),
            ErrorKind::InvalidSignature
        );
        assert_eq!(
            k(
                PluginError::SignedVersionMismatch {
                    signed: "0.1.0".into(),
                    announced: "0.1.1".into()
                },
                Phase::Download
            ),
            ErrorKind::InvalidSignature
        );
        assert_eq!(
            k(PluginError::MissingSignedVersion, Phase::Install),
            ErrorKind::InvalidSignature
        );
        assert_eq!(
            k(
                PluginError::Io(std::io::Error::other("denied")),
                Phase::Install
            ),
            ErrorKind::Install
        );
        assert_eq!(
            k(
                PluginError::Io(std::io::Error::other("disk full")),
                Phase::Download
            ),
            ErrorKind::Download
        );
    }

    #[test]
    fn error_detail_is_kept_for_diagnostics() {
        let e = classify(
            &PluginError::Network("Download request failed with status: 403".into()),
            Phase::Download,
        );
        assert!(e.detail.contains("403"));
        assert!(!e.message.is_empty());
    }
}
