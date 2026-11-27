//! Release-pipeline tool. Builds and checks `latest.json`.
//!
//! ```text
//! make-manifest create --version 0.1.1 --notes-file notes.md \
//!     --url https://updates.example.com/stable/0.1.1/NEXUS_0.1.1_x64-setup.exe \
//!     --installer NEXUS_0.1.1_x64-setup.exe --signature-file NEXUS_0.1.1_x64-setup.exe.sig \
//!     [--published old-latest.json] --out latest.json
//! make-manifest verify --manifest latest.json --installer downloaded.exe [--expect-version 0.1.1]
//! ```
//!
//! The public key comes from the `TAURI_UPDATER_PUBKEY` environment variable
//! (base64, the same value that is embedded in the app). `create` refuses to
//! write a manifest unless the installer's signature verifies against that key
//! and the version is newer than the currently published one. Nothing secret
//! is read or printed.

use std::collections::BTreeMap;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use nexus_updates::manifest::{format_rfc3339_utc, Manifest, Platform, WINDOWS_X64_NSIS};
use nexus_updates::signature;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn need(args: &[String], name: &str) -> Result<String, String> {
    arg(args, name).ok_or_else(|| format!("missing {name}"))
}

fn read(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("can't read {path}: {e}"))
}

fn pubkey() -> Result<String, String> {
    let key = std::env::var("TAURI_UPDATER_PUBKEY").unwrap_or_default();
    if key.trim().is_empty() {
        return Err("TAURI_UPDATER_PUBKEY is not set".into());
    }
    signature::decode_public_key(&key).map_err(|e| format!("TAURI_UPDATER_PUBKEY: {e}"))?;
    Ok(key.trim().to_owned())
}

fn create(args: &[String]) -> Result<(), String> {
    let key = pubkey()?;
    let version = need(args, "--version")?;
    let url = need(args, "--url")?;
    let out = need(args, "--out")?;
    let notes = String::from_utf8(read(&need(args, "--notes-file")?)?)
        .map_err(|_| "notes are not UTF-8")?;
    let notes = notes.trim().to_owned();
    if notes.is_empty() {
        return Err("release notes are empty".into());
    }
    let sig = String::from_utf8(read(&need(args, "--signature-file")?)?)
        .map_err(|_| "signature is not UTF-8")?;
    let sig = sig.trim().to_owned();
    let installer_path = need(args, "--installer")?;
    let installer_name = std::path::Path::new(&installer_path)
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !nexus_updates::manifest::url_names_installer(&url, &installer_name) {
        return Err(format!(
            "the download URL {url} doesn't name the signed installer {installer_name}"
        ));
    }
    let installer = read(&installer_path)?;
    let comment = signature::verify(&key, &installer, &sig, Some(&version))
        .map_err(|e| format!("installer signature check failed: {e}"))?;

    let published = match arg(args, "--published") {
        Some(p) if std::path::Path::new(&p).exists() => {
            let text =
                String::from_utf8(read(&p)?).map_err(|_| "published manifest is not UTF-8")?;
            Some(Manifest::parse(&text).map_err(|e| format!("published manifest: {e}"))?)
        }
        _ => None,
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let manifest = Manifest {
        version: version.trim_start_matches('v').to_owned(),
        notes,
        pub_date: Some(arg(args, "--pub-date").unwrap_or_else(|| format_rfc3339_utc(now))),
        platforms: BTreeMap::from([(
            WINDOWS_X64_NSIS.to_owned(),
            Platform {
                url,
                signature: sig,
            },
        )]),
    };
    manifest
        .validate_against_published(published.as_ref())
        .map_err(|e| e.to_string())?;
    std::fs::write(&out, manifest.to_json() + "\n")
        .map_err(|e| format!("can't write {out}: {e}"))?;
    println!(
        "latest.json written for {} (previously published: {}); signature verified ({comment})",
        manifest.version,
        published.map_or_else(|| "none".to_owned(), |m| m.version)
    );
    Ok(())
}

fn verify(args: &[String]) -> Result<(), String> {
    let text = String::from_utf8(read(&need(args, "--manifest")?)?)
        .map_err(|_| "manifest is not UTF-8")?;
    let manifest = Manifest::parse(&text).map_err(|e| e.to_string())?;
    manifest.validate().map_err(|e| e.to_string())?;
    if let Some(expect) = arg(args, "--expect-version") {
        if manifest.version != expect.trim_start_matches('v') {
            return Err(format!(
                "published version is {}, expected {expect}",
                manifest.version
            ));
        }
    }
    let platform = manifest.windows_x64().expect("validated");
    let installer = read(&need(args, "--installer")?)?;
    signature::verify(
        &pubkey()?,
        &installer,
        &platform.signature,
        Some(&manifest.version),
    )
    .map_err(|e| format!("published installer does not verify: {e}"))?;
    println!("published manifest {} verified: HTTPS NSIS x64 entry, signature matches the embedded public key", manifest.version);
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("create") => create(&args),
        Some("verify") => verify(&args),
        _ => Err("usage: make-manifest create|verify [options] (see source for options)".into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("make-manifest: {e}");
            ExitCode::FAILURE
        }
    }
}
