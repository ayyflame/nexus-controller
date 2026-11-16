//! Minisign signature checks, compatible with the Tauri updater.
//!
//! Tauri stores both the public key and each `.sig` file as base64 of the
//! minisign text format. The plugin decodes both and verifies the installer
//! bytes before running them. These helpers do the same so the release
//! pipeline can prove, before publishing, that a signature matches the public
//! key embedded in the app. A mismatch here would mean every client rejects
//! the update.

use std::fmt;

use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureError {
    NotBase64,
    NotText,
    BadPublicKey(String),
    BadSignature(String),
    Mismatch(String),
    VersionMismatch { signed: String, expected: String },
}

impl fmt::Display for SignatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotBase64 => write!(f, "not valid base64"),
            Self::NotText => write!(f, "decoded value is not text"),
            Self::BadPublicKey(e) => write!(f, "invalid public key: {e}"),
            Self::BadSignature(e) => write!(f, "invalid signature: {e}"),
            Self::Mismatch(e) => write!(f, "signature does not match the file and public key: {e}"),
            Self::VersionMismatch { signed, expected } => {
                write!(
                    f,
                    "the file was signed for version {signed}, not {expected}"
                )
            }
        }
    }
}

impl std::error::Error for SignatureError {}

fn b64_text(s: &str) -> Result<String, SignatureError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|_| SignatureError::NotBase64)?;
    String::from_utf8(bytes).map_err(|_| SignatureError::NotText)
}

pub fn decode_public_key(pubkey_b64: &str) -> Result<PublicKey, SignatureError> {
    PublicKey::decode(&b64_text(pubkey_b64)?)
        .map_err(|e| SignatureError::BadPublicKey(e.to_string()))
}

pub fn decode_signature(sig_b64: &str) -> Result<Signature, SignatureError> {
    Signature::decode(&b64_text(sig_b64)?).map_err(|e| SignatureError::BadSignature(e.to_string()))
}

/// The `version:` field the Tauri CLI may record in the trusted comment.
pub fn signed_version(trusted_comment: &str) -> Option<&str> {
    trusted_comment
        .split('\t')
        .find_map(|f| f.strip_prefix("version:"))
}

/// Verifies `data` against a base64 `.sig` and base64 public key. If the
/// signature records a version, it must equal `expected_version`. Returns
/// the trusted comment.
pub fn verify(
    pubkey_b64: &str,
    data: &[u8],
    sig_b64: &str,
    expected_version: Option<&str>,
) -> Result<String, SignatureError> {
    let key = decode_public_key(pubkey_b64)?;
    let sig = decode_signature(sig_b64)?;
    key.verify(data, &sig, true)
        .map_err(|e| SignatureError::Mismatch(e.to_string()))?;
    let comment = sig.trusted_comment().to_owned();
    if let (Some(signed), Some(expected)) = (signed_version(&comment), expected_version) {
        let same = match (
            crate::version::parse(signed),
            crate::version::parse(expected),
        ) {
            (Ok(a), Ok(b)) => a == b,
            _ => signed == expected,
        };
        if !same {
            return Err(SignatureError::VersionMismatch {
                signed: signed.to_owned(),
                expected: expected.to_owned(),
            });
        }
    }
    Ok(comment)
}
