# Releasing NEXUS

Versions follow semantic versioning, `MAJOR.MINOR.PATCH`:

| Change | Bump | Example |
|---|---|---|
| Bug fixes only | PATCH | 0.1.0 → 0.1.1 |
| New features, compatible with saved profiles | MINOR | 0.1.1 → 0.2.0 |
| Breaking changes (e.g. profiles can't be read by older versions) | MAJOR | 0.9.0 → 1.0.0 |

The Stable channel only ever moves forward. Clients ignore any version that is equal, older or a pre-release (e.g. `0.2.0-beta.1`), and the pipeline refuses to publish one. A normal update check can never downgrade anyone. Each version is published once and its files are never replaced.

Prerequisite: the one-time setup in [updater-setup.md](updater-setup.md). Without it, publishing a release fails with a list of what is missing. Nothing is half-published.

## Steps (example: 0.1.1)

1. **Bump the version** in every file that records it (from the repository root):
   ```bash
   node scripts/bump-version.mjs 0.1.1
   ```
   This updates `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json` and `tauri.conf.json`. It refuses versions that are not newer.
2. **Run the checks locally** (optional; CI runs them too): `cargo test --workspace`, then `npm run typecheck` and `npm test` in `apps/desktop`.
3. **Commit and push** to `main`, e.g. `Release 0.1.1`.
4. **Publish the release.** On GitHub: **Releases → Draft a new release**:
   - Tag: `v0.1.1`, created on publish, target `main`. It must equal `v` + the version from step 1, or the build fails.
   - Title: `NEXUS 0.1.1`.
   - Description: the release notes users will see in the app's update banner. Plain text or simple Markdown, short and user-facing. It must not be empty.
   - Leave **Set as a pre-release** unchecked for a Stable update. A pre-release gets signed installers attached but is not offered to users.
   - **Publish release.**
5. **CI does the rest** (Actions → *Windows release build*, about 15–25 min):
   1. version and tag check, secrets check
   2. all Rust and frontend tests
   3. signed build (`createUpdaterArtifacts`, NSIS `.sig`)
   4. `latest.json` generated and signature-checked against the public key
   5. installer uploaded, then `latest.json`
   6. both re-downloaded from the public URL and verified
   7. `.exe`, `.msi` and `SHA256SUMS.txt` attached to the release
6. **Clients pick it up** within 6 hours, or immediately with **Settings → Updates → Check for updates**, or at their next start (about 20 s after launch).

## If something fails

- **Before the "Publish update" step:** nothing was uploaded. Fix the problem. To rebuild the same version, delete the GitHub Release **and** its tag, then publish it again.
- **After the installer upload but before `latest.json`:** clients don't see anything yet. The versioned path now exists, so the pipeline refuses to overwrite it. Bump to the next patch version and release again.
- **Bad release already live:** you can't roll clients back, because there are no downgrades. Publish a fixed, higher version.

## Manual (non-update) builds

**Actions → Windows release build → Run workflow** still builds and tests everything and offers the installers as a downloadable artifact. These builds have no update settings, so they never check for updates, and nothing is published.
