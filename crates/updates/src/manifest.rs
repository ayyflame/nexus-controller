//! The static update manifest (`latest.json`).
//!
//! ```json
//! {
//!   "version": "0.1.1",
//!   "notes": "What changed",
//!   "pub_date": "2026-11-20T12:00:00Z",
//!   "platforms": {
//!     "windows-x86_64-nsis": {
//!       "url": "https://updates.example.com/stable/0.1.1/NEXUS_0.1.1_x64-setup.exe",
//!       "signature": "<contents of the .sig file>"
//!     }
//!   }
//! }
//! ```
//!
//! Only the `windows-x86_64-nsis` key is published, on purpose. The Tauri
//! updater looks up `windows-x86_64-<installer>` first and then
//! `windows-x86_64`. With no generic key, an MSI installation never runs the
//! NSIS installer (which would create a second, separate installation). It
//! reports that automatic updates need the NSIS installer instead.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::version;

/// Platform key for the Windows x64 NSIS installer.
pub const WINDOWS_X64_NSIS: &str = "windows-x86_64-nsis";
/// Keys that would make an updater install the wrong package format.
const FORBIDDEN_KEYS: [&str; 2] = ["windows-x86_64", "windows-x86_64-msi"];
/// Release notes longer than this are rejected (the UI shows them in full).
pub const MAX_NOTES_LEN: usize = 20_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Platform {
    pub url: String,
    pub signature: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pub_date: Option<String>,
    pub platforms: BTreeMap<String, Platform>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManifestError {
    Json(String),
    BadVersion(String),
    PrereleaseOnStable(String),
    NotNewer { version: String, published: String },
    BadDate(String),
    NotesTooLong(usize),
    MissingWindowsX64,
    WrongFormatKey(String),
    InsecureUrl(String),
    TemporaryUrl(String),
    NotNsisInstaller(String),
    UrlVersionMismatch { url: String, version: String },
    MissingSignature,
    BadSignature(String),
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(e) => write!(f, "the manifest is not valid JSON: {e}"),
            Self::BadVersion(v) => write!(f, "“{v}” is not a semantic version (MAJOR.MINOR.PATCH)"),
            Self::PrereleaseOnStable(v) => {
                write!(f, "{v} is a pre-release and can't be published on the Stable channel")
            }
            Self::NotNewer { version, published } => write!(
                f,
                "version {version} is not newer than the published version {published}; bump the version first"
            ),
            Self::BadDate(d) => write!(f, "pub_date “{d}” is not an RFC 3339 UTC time like 2026-11-20T12:00:00Z"),
            Self::NotesTooLong(n) => write!(f, "release notes are {n} characters; the limit is {MAX_NOTES_LEN}"),
            Self::MissingWindowsX64 => write!(f, "the manifest has no “{WINDOWS_X64_NSIS}” entry"),
            Self::WrongFormatKey(k) => write!(
                f,
                "the manifest must not contain “{k}”: only the NSIS installer is published for updates"
            ),
            Self::InsecureUrl(u) => write!(f, "download URL must use HTTPS: {u}"),
            Self::TemporaryUrl(u) => write!(
                f,
                "download URL looks temporary (it has a query string or fragment); use a permanent public URL: {u}"
            ),
            Self::NotNsisInstaller(u) => write!(f, "download URL must be the NSIS “-setup.exe” installer: {u}"),
            Self::UrlVersionMismatch { url, version } => {
                write!(f, "download URL does not contain version {version}: {url}")
            }
            Self::MissingSignature => write!(f, "the update has no signature"),
            Self::BadSignature(e) => write!(f, "the update signature is malformed: {e}"),
        }
    }
}

impl std::error::Error for ManifestError {}

impl Manifest {
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        serde_json::from_str(json).map_err(|e| ManifestError::Json(e.to_string()))
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("manifest serializes")
    }

    /// The Windows x64 NSIS entry, if present.
    pub fn windows_x64(&self) -> Option<&Platform> {
        self.platforms.get(WINDOWS_X64_NSIS)
    }

    /// Checks everything the app and the release pipeline rely on.
    pub fn validate(&self) -> Result<(), ManifestError> {
        let v = version::parse(&self.version)
            .map_err(|_| ManifestError::BadVersion(self.version.clone()))?;
        if !v.pre.is_empty() {
            return Err(ManifestError::PrereleaseOnStable(self.version.clone()));
        }
        if let Some(date) = &self.pub_date {
            if !is_rfc3339_utc(date) {
                return Err(ManifestError::BadDate(date.clone()));
            }
        }
        if self.notes.chars().count() > MAX_NOTES_LEN {
            return Err(ManifestError::NotesTooLong(self.notes.chars().count()));
        }
        if let Some(k) = FORBIDDEN_KEYS
            .iter()
            .find(|k| self.platforms.contains_key(**k))
        {
            return Err(ManifestError::WrongFormatKey((*k).to_owned()));
        }
        let p = self.windows_x64().ok_or(ManifestError::MissingWindowsX64)?;
        validate_url(&p.url, &v.to_string())?;
        if p.signature.trim().is_empty() {
            return Err(ManifestError::MissingSignature);
        }
        crate::signature::decode_signature(&p.signature)
            .map_err(|e| ManifestError::BadSignature(e.to_string()))?;
        Ok(())
    }

    /// Validates and also refuses to replace a published manifest with an
    /// equal or older version.
    pub fn validate_against_published(
        &self,
        published: Option<&Manifest>,
    ) -> Result<(), ManifestError> {
        self.validate()?;
        if let Some(old) = published {
            if !version::is_update_str(&old.version, &self.version) {
                return Err(ManifestError::NotNewer {
                    version: self.version.clone(),
                    published: old.version.clone(),
                });
            }
        }
        Ok(())
    }
}

fn validate_url(url: &str, version: &str) -> Result<(), ManifestError> {
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| ManifestError::InsecureUrl(url.to_owned()))?;
    let host = rest.split('/').next().unwrap_or("");
    if host.is_empty() || host.contains('@') || host.contains(' ') {
        return Err(ManifestError::InsecureUrl(url.to_owned()));
    }
    if url.contains('?') || url.contains('#') {
        return Err(ManifestError::TemporaryUrl(url.to_owned()));
    }
    let file = url.rsplit('/').next().unwrap_or("");
    if !file.to_ascii_lowercase().ends_with("-setup.exe") {
        return Err(ManifestError::NotNsisInstaller(url.to_owned()));
    }
    if !url.contains(version) {
        return Err(ManifestError::UrlVersionMismatch {
            url: url.to_owned(),
            version: version.to_owned(),
        });
    }
    Ok(())
}

/// Accepts `YYYY-MM-DDTHH:MM:SS[.fff]Z` (what the pipeline writes).
pub fn is_rfc3339_utc(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 20 || !s.ends_with('Z') {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    let num = |r: std::ops::Range<usize>| s[r].parse::<u32>().unwrap_or(99);
    let shape = digits(0..4)
        && b[4] == b'-'
        && digits(5..7)
        && b[7] == b'-'
        && digits(8..10)
        && b[10] == b'T'
        && digits(11..13)
        && b[13] == b':'
        && digits(14..16)
        && b[16] == b':'
        && digits(17..19);
    if !shape {
        return false;
    }
    let frac = &s[19..s.len() - 1];
    let frac_ok = frac.is_empty()
        || (frac.len() > 1
            && frac.starts_with('.')
            && frac[1..].bytes().all(|c| c.is_ascii_digit()));
    frac_ok
        && (1..=12).contains(&num(5..7))
        && (1..=31).contains(&num(8..10))
        && num(11..13) < 24
        && num(14..16) < 60
        && num(17..19) < 61
}

/// Formats a Unix time as `YYYY-MM-DDTHH:MM:SSZ` (civil-from-days algorithm).
pub fn format_rfc3339_utc(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}
