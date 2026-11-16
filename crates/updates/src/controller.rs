//! The update state machine.
//!
//! ```text
//!            check                 found newer             Update now
//!  Idle ───────────► Checking ───────────────► Available ───────────► Downloading
//!   ▲                  │  │ none                   ▲  │ Later               │
//!   │                  │  └──────► UpToDate        │  └ (banner hidden)     │ done
//!   │                  │ error                     │                        ▼
//!   └──── Failed ◄─────┴───────────────────────────┴──── error ──── ReadyToInstall
//!                                                                          │ Restart
//!                                                                          ▼
//!                                                                     Installing
//! ```
//!
//! Only one operation runs at a time: starting a check while downloading (or
//! a second download) is refused with [`ErrorKind::Busy`] and does not change
//! the current state.

use serde::Serialize;

use crate::version::{self, Version};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub notes: String,
    pub pub_date: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// This build has no update server or public key (development builds).
    NotConfigured,
    /// The update server could not be reached.
    Offline,
    /// The server answered with something that is not a valid manifest.
    InvalidManifest,
    /// The package's signature is missing, malformed or does not match.
    InvalidSignature,
    /// This installation type (e.g. MSI) cannot be updated automatically.
    UnsupportedInstall,
    /// The download started but did not finish.
    Download,
    /// The installer could not be started, or the update did not complete.
    Install,
    /// Another update operation is already running.
    Busy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateError {
    pub kind: ErrorKind,
    /// Plain-language explanation for the UI.
    pub message: String,
    /// Technical detail, shown under "Details".
    pub detail: String,
}

impl UpdateError {
    pub fn new(kind: ErrorKind, detail: impl Into<String>) -> Self {
        let message = match kind {
            ErrorKind::NotConfigured => {
                "Automatic updates aren't set up in this build. Install a release build to get updates."
            }
            ErrorKind::Offline => {
                "Couldn't reach the update server. Check your internet connection; NEXUS will try again later."
            }
            ErrorKind::InvalidManifest => {
                "The update server sent information NEXUS couldn't read. Nothing was downloaded."
            }
            ErrorKind::InvalidSignature => {
                "The update failed its security check, so it was not installed. Your current version is unchanged."
            }
            ErrorKind::UnsupportedInstall => {
                "This copy was installed with the MSI package, which can't update itself. Download the new setup .exe from the Releases page."
            }
            ErrorKind::Download => "The download didn't finish. Nothing was installed; you can try again.",
            ErrorKind::Install => "The update couldn't be installed. Your current version is unchanged.",
            ErrorKind::Busy => "An update is already in progress.",
        };
        Self {
            kind,
            message: message.to_owned(),
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.detail.is_empty() {
            f.write_str(&self.message)
        } else {
            write!(f, "{} ({})", self.message, self.detail)
        }
    }
}

impl std::error::Error for UpdateError {}

/// Which operation an error came from (used to classify plugin errors).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Check,
    Download,
    Install,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateState {
    NotConfigured,
    Idle,
    #[serde(rename_all = "camelCase")]
    Checking {
        manual: bool,
    },
    UpToDate,
    Available {
        release: ReleaseInfo,
    },
    Downloading {
        release: ReleaseInfo,
        downloaded: u64,
        total: Option<u64>,
    },
    ReadyToInstall {
        release: ReleaseInfo,
        size: u64,
    },
    Installing {
        release: ReleaseInfo,
    },
    Failed {
        error: UpdateError,
        release: Option<ReleaseInfo>,
    },
}

impl UpdateState {
    fn busy(&self) -> bool {
        matches!(
            self,
            Self::Checking { .. }
                | Self::Downloading { .. }
                | Self::ReadyToInstall { .. }
                | Self::Installing { .. }
        )
    }
}

/// Network and installer operations, implemented by the Tauri updater in the
/// app and by mocks in tests.
pub trait UpdateBackend {
    fn check(&mut self) -> Result<Option<ReleaseInfo>, UpdateError>;
    /// Downloads and verifies the package; returns its size in bytes.
    fn download(&mut self, progress: &mut dyn FnMut(u64, Option<u64>)) -> Result<u64, UpdateError>;
    /// Starts the installer. On Windows a successful call does not return:
    /// the app exits and the installer reopens it.
    fn install(&mut self) -> Result<(), UpdateError>;
}

#[derive(Clone, Debug)]
pub struct UpdateController {
    current: Version,
    state: UpdateState,
    /// State to restore when a background check fails while an update is
    /// already known, so a dropped connection doesn't hide it.
    before_check: Option<UpdateState>,
    pub last_success: Option<u64>,
    pub postponed: Option<String>,
}

impl UpdateController {
    pub fn new(current_version: &str, configured: bool) -> Self {
        let current = version::parse(current_version).unwrap_or_else(|_| Version::new(0, 0, 0));
        Self {
            current,
            state: if configured {
                UpdateState::Idle
            } else {
                UpdateState::NotConfigured
            },
            before_check: None,
            last_success: None,
            postponed: None,
        }
    }

    pub fn current_version(&self) -> String {
        self.current.to_string()
    }

    pub fn state(&self) -> &UpdateState {
        &self.state
    }

    pub fn configured(&self) -> bool {
        self.state != UpdateState::NotConfigured
    }

    /// The "Update available" banner shows unless the user chose "Later" for
    /// this exact version. A newer release shows it again.
    pub fn banner_visible(&self) -> bool {
        match &self.state {
            UpdateState::Available { release } => {
                self.postponed.as_deref() != Some(release.version.as_str())
            }
            UpdateState::Downloading { .. }
            | UpdateState::ReadyToInstall { .. }
            | UpdateState::Installing { .. } => true,
            _ => false,
        }
    }

    // ---- check --------------------------------------------------------------

    pub fn begin_check(&mut self, manual: bool) -> Result<(), UpdateError> {
        if !self.configured() {
            return Err(UpdateError::new(ErrorKind::NotConfigured, ""));
        }
        if self.state.busy() {
            return Err(UpdateError::new(ErrorKind::Busy, ""));
        }
        let prev = std::mem::replace(&mut self.state, UpdateState::Checking { manual });
        self.before_check = Some(prev);
        Ok(())
    }

    pub fn finish_check(&mut self, result: Result<Option<ReleaseInfo>, UpdateError>, now: u64) {
        let UpdateState::Checking { manual } = self.state else {
            return;
        };
        let before = self.before_check.take();
        self.state = match result {
            Ok(found) => {
                self.last_success = Some(now);
                match found {
                    // Defence in depth: never offer an equal, older or pre-release version.
                    Some(r) if version::is_update_str(&self.current.to_string(), &r.version) => {
                        UpdateState::Available { release: r }
                    }
                    _ => UpdateState::UpToDate,
                }
            }
            Err(error) => match before {
                Some(prev @ UpdateState::Available { .. }) if !manual => prev,
                _ => UpdateState::Failed {
                    error,
                    release: None,
                },
            },
        };
    }

    // ---- download -----------------------------------------------------------

    /// Starts downloading the available update ("Update now"). Also used to
    /// retry after a failed download.
    pub fn begin_download(&mut self) -> Result<ReleaseInfo, UpdateError> {
        let release = match &self.state {
            UpdateState::Available { release } => release.clone(),
            UpdateState::Failed {
                release: Some(release),
                ..
            } => release.clone(),
            s if s.busy() => return Err(UpdateError::new(ErrorKind::Busy, "")),
            _ => {
                return Err(UpdateError::new(
                    ErrorKind::Download,
                    "no update is available to download",
                ))
            }
        };
        self.postponed = None;
        self.state = UpdateState::Downloading {
            release: release.clone(),
            downloaded: 0,
            total: None,
        };
        Ok(release)
    }

    pub fn progress(&mut self, chunk: u64, total: Option<u64>) {
        if let UpdateState::Downloading {
            downloaded,
            total: t,
            ..
        } = &mut self.state
        {
            *downloaded = downloaded.saturating_add(chunk);
            if total.is_some() {
                *t = total;
            }
        }
    }

    pub fn finish_download(&mut self, result: Result<u64, UpdateError>) {
        let UpdateState::Downloading { release, .. } = &self.state else {
            return;
        };
        let release = release.clone();
        self.state = match result {
            Ok(size) => UpdateState::ReadyToInstall { release, size },
            Err(error) => UpdateState::Failed {
                error,
                release: Some(release),
            },
        };
    }

    // ---- install ------------------------------------------------------------

    pub fn begin_install(&mut self) -> Result<ReleaseInfo, UpdateError> {
        match &self.state {
            UpdateState::ReadyToInstall { release, .. } => {
                let release = release.clone();
                self.state = UpdateState::Installing {
                    release: release.clone(),
                };
                Ok(release)
            }
            UpdateState::Checking { .. }
            | UpdateState::Downloading { .. }
            | UpdateState::Installing { .. } => Err(UpdateError::new(ErrorKind::Busy, "")),
            _ => Err(UpdateError::new(
                ErrorKind::Install,
                "the update has not been downloaded",
            )),
        }
    }

    pub fn finish_install(&mut self, result: Result<(), UpdateError>) {
        let UpdateState::Installing { release } = &self.state else {
            return;
        };
        if let Err(error) = result {
            // The downloaded bytes were consumed; the user can download again.
            let release = release.clone();
            self.state = UpdateState::Failed {
                error,
                release: Some(release),
            };
        }
    }

    // ---- user choices -------------------------------------------------------

    /// "Later": hides the banner for this version only. No forced updates.
    pub fn postpone(&mut self) -> Option<String> {
        let release = match &self.state {
            UpdateState::Available { release }
            | UpdateState::Failed {
                release: Some(release),
                ..
            } => release.clone(),
            _ => return None,
        };
        self.postponed = Some(release.version.clone());
        self.state = UpdateState::Available {
            release: release.clone(),
        };
        Some(release.version)
    }

    // ---- drivers (used with synchronous backends, e.g. tests) --------------

    pub fn run_check(
        &mut self,
        backend: &mut dyn UpdateBackend,
        manual: bool,
        now: u64,
    ) -> Result<(), UpdateError> {
        self.begin_check(manual)?;
        let result = backend.check();
        let err = result.as_ref().err().cloned();
        self.finish_check(result, now);
        err.map_or(Ok(()), Err)
    }

    pub fn run_download(&mut self, backend: &mut dyn UpdateBackend) -> Result<(), UpdateError> {
        self.begin_download()?;
        let mut events = Vec::new();
        let result = backend.download(&mut |c, t| events.push((c, t)));
        for (c, t) in events {
            self.progress(c, t);
        }
        let err = result.as_ref().err().cloned();
        self.finish_download(result);
        err.map_or(Ok(()), Err)
    }

    pub fn run_install(&mut self, backend: &mut dyn UpdateBackend) -> Result<(), UpdateError> {
        self.begin_install()?;
        let result = backend.install();
        let err = result.as_ref().err().cloned();
        self.finish_install(result);
        err.map_or(Ok(()), Err)
    }
}

/// After an update, the new process compares the version it was asked to
/// install with the version that is actually running.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallOutcome {
    /// The expected version is running.
    Updated { version: String },
    /// A different version is running, so the update did not complete.
    NotApplied { expected: String, running: String },
}

pub fn verify_installed(expected: &str, running: &str) -> InstallOutcome {
    let same = match (version::parse(expected), version::parse(running)) {
        (Ok(a), Ok(b)) => a == b,
        _ => expected == running,
    };
    if same {
        InstallOutcome::Updated {
            version: running.to_owned(),
        }
    } else {
        InstallOutcome::NotApplied {
            expected: expected.to_owned(),
            running: running.to_owned(),
        }
    }
}
