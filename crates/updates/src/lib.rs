//! Update policy for NEXUS.
//!
//! This crate holds every decision the updater makes that can be tested
//! without a network, a signing key or Windows:
//!
//! - [`manifest`]: the `latest.json` format the app downloads, its
//!   validation (HTTPS, NSIS installer, Windows x64, permanent URL, signature
//!   present) and generation for the release pipeline.
//! - [`version`]: semantic-version rules. Only strictly newer stable releases
//!   are offered, so a normal check can never downgrade.
//! - [`signature`]: minisign verification, the same scheme and crate the
//!   Tauri updater plugin uses. CI uses it to prove a signature matches the
//!   public key embedded in the app *before* publishing.
//! - [`schedule`]: when automatic checks run (shortly after start-up, then
//!   every 6 hours, sooner after a failure).
//! - [`controller`]: the update state machine. It allows one operation at a
//!   time and turns every failure into a typed, user-readable error.
//!
//! Downloading and installing are done by the official Tauri updater plugin in
//! the desktop shell. It verifies the package signature before installing.
#![forbid(unsafe_code)]

pub mod controller;
pub mod manifest;
pub mod schedule;
pub mod signature;
pub mod version;

pub use controller::{
    verify_installed, ErrorKind, InstallOutcome, Phase, ReleaseInfo, UpdateBackend,
    UpdateController, UpdateError, UpdateState,
};
pub use manifest::{Manifest, ManifestError, Platform, WINDOWS_X64_NSIS};
pub use schedule::Schedule;

#[cfg(test)]
mod tests;
