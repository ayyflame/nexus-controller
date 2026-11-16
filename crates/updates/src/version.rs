//! Version rules. NEXUS uses semantic versioning (`MAJOR.MINOR.PATCH`).

pub use semver::Version;

/// Parses `1.2.3` or `v1.2.3`.
pub fn parse(v: &str) -> Result<Version, semver::Error> {
    Version::parse(v.trim().trim_start_matches(['v', 'V']))
}

/// True only when `candidate` is strictly newer than `current` and is a
/// stable release (no `-beta` style suffix). Equal and older versions are
/// never offered, so a normal check cannot downgrade the app.
pub fn is_update(current: &Version, candidate: &Version) -> bool {
    candidate.pre.is_empty() && candidate > current
}

/// String form of [`is_update`]; anything that does not parse is not an update.
pub fn is_update_str(current: &str, candidate: &str) -> bool {
    match (parse(current), parse(candidate)) {
        (Ok(c), Ok(n)) => is_update(&c, &n),
        _ => false,
    }
}
