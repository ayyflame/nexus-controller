# Releasing NEXUS

Versions follow semantic versioning, `MAJOR.MINOR.PATCH`:

| Change | Bump | Example |
|---|---|---|
| Bug fixes only | PATCH | 0.1.0 → 0.1.1 |
| New features, compatible with saved profiles | MINOR | 0.1.1 → 0.2.0 |
| Breaking changes (e.g. profiles can't be read by older versions) | MAJOR | 0.9.0 → 1.0.0 |

The Stable channel only ever moves forward. Clients ignore any version that is equal, older or a pre-release (e.g. `0.2.0-beta.1`), and the pipeline refuses to publish one. A normal update check can never downgrade anyone. Each version is published once and its files are never replaced.

Prerequisite: the one-time setup in [release-setup-checklist.md](release-setup-checklist.md) (update host, updater key, Authenticode signing). Without **all** of it, a release fails at the start with a list of what's missing (`scripts/check-release-config.ps1`). Nothing is half-published. The first public release is **0.2.0** (see the checklist).

## Steps (example: 0.1.1)

1. **Bump the version** in every file that records it (from the repository root):
   ```bash
   node scripts/bump-version.mjs 0.1.1
   ```
   This updates `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json` and `tauri.conf.json`. It refuses versions that are not newer.
2. **Write the release notes** in `release-notes/v0.1.1.md`. Users see the first few lines in the update notice, and the whole text under *Show all notes*. Keep it short, user-facing and in plain text or simple Markdown. It must not be empty.
3. **Commit both and push to `main`**, e.g. `Release 0.1.1`. That is all. (Every other push to `main` that changes the app is built automatically as a development build: it refreshes the README's **Latest build** download but publishes no release or update. Only a push that adds or changes `release-notes/v<version>.md` releases that version.)
4. **CI does the rest** (Actions → *Windows release build*, about 15–25 min). The push adds a release-notes file for a version that has no release yet, so the workflow:
   1. checks the version, the notes, that the commit is on `main`, and that updates **and** signing are fully configured
   2. runs all Rust and frontend tests (Rust 1.100.0, Node 22.23.5 and every action pinned)
   3. builds the installers. They are Authenticode-signed during the build (Trusted Signing or a certificate), or after it by SignPath, which waits for your approval in SignPath.
   4. stops unless every file has a valid, timestamped signature from the expected signer, then runs the installer and uninstaller checks on the signed files
   5. creates the updater signature over the final setup (`tauri signer sign`), records `SHA256SUMS.txt`, `build-info.txt` and a provenance attestation
   6. generates `latest.json`, refusing a URL that doesn't name that setup, a signature that doesn't verify, or a version that isn't newer
   7. uploads the installer, then `latest.json`
   8. re-downloads both from the public URL: the manifest must name exactly `stable/<version>/<installer>`, and the downloaded installer must be byte-for-byte the one it signed
   9. creates the GitHub Release `v0.1.1` with the notes, the `.exe`, the `.msi`, `SHA256SUMS.txt` and `build-info.txt`
5. **Installed copies pick it up** about 20 s after their next start, every 6 hours while running, or at once with **Settings → Updates → Check for updates**.

Pushes that don't add release notes, or that are for an already released version, only build and test. They never publish.

### Alternative: publish from the GitHub website

Still supported: after step 1, push, then **Releases → Draft a new release**:
- tag `v0.1.1` targeting `main`;
- the notes as the description;
- not a pre-release.

The workflow then does the same as above and attaches the installers to that release. A pre-release gets signed installers but is not offered to users.

## If something fails

- **Before the "Publish update" step:** nothing was uploaded. Fix the problem. The tag and GitHub Release are only created at the very end, so to retry the same version just push again (for example, a small edit to its release-notes file). If a Release from the website flow exists, delete it **and** its tag first.
- **After the installer upload but before `latest.json`:** clients don't see anything yet. The versioned path now exists, so the pipeline refuses to overwrite it. Bump to the next patch version and release again.
- **Bad release already live:** you can't roll clients back, because there are no downgrades. Publish a fixed, higher version.

## Manual (non-update) builds

**Actions → Windows release build → Run workflow** still builds and tests everything and offers the installers as a downloadable artifact. These builds have no update settings, so they never check for updates, and nothing is published.

## Reproducibility and checking a download

Release builds use pinned inputs: Rust 1.100.0, Node 22.23.5, the Tauri CLI and npm packages from `package-lock.json`, crates from `Cargo.lock` (`--locked`), and every GitHub Action by commit SHA. `build-info.txt` records the commit, workflow run, compiler versions and runner image. Rebuilding the same commit gives functionally identical binaries; they aren't byte-identical, because installers and signatures embed timestamps.

To check that a file came from this repository's workflow:

```bash
gh attestation verify NEXUS_0.2.0_x64-setup.exe --repo ayyflame/nexus-controller
```

and compare its SHA-256 with `SHA256SUMS.txt`.
