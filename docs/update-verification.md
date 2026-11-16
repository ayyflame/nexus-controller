# Update verification checklist (Windows)

**None of these have been performed yet.** The updater was built and unit-tested in a Linux container. Real installation can only be verified on Windows, with two published versions. Until this checklist passes, do not consider automatic updates working.

Prerequisites:

- the one-time setup in [updater-setup.md](updater-setup.md);
- **v0.1.0** published as described in [releasing.md](releasing.md);
- a Windows 11 x64 PC or VM.

Data folder: `%APPDATA%\com.nexus.controllerengine\`, which holds `nexus.db` and `backups\`.

## A. Baseline: install 0.1.0

| # | Step | Expected | Result |
|---|---|---|---|
| U1 | Download `NEXUS_0.1.0_x64-setup.exe` from the v0.1.0 release and install it | Installs for the current user, without admin | |
| U2 | Settings → Updates | Current version 0.1.0, Channel Stable, Check automatically: On. **Not** "aren't set up in this build" | |
| U3 | Check for updates | "You're up to date (version 0.1.0)"; Last checked: Just now | |
| U4 | Create a profile with a stick calibration, a game `.exe`, and a macro; change some settings | Saved | |
| U5 | Note the profile and macro list (screenshot) | | |

## B. Offline and error handling (on 0.1.0)

| # | Step | Expected | Result |
|---|---|---|---|
| U6 | Disconnect the network, start NEXUS | Starts normally, no pop-up. After about 20 s Settings shows "Couldn't reach the update server…" | |
| U7 | Still offline, click Check for updates | Same message; app keeps working; Details shows the technical error | |
| U8 | Reconnect, Check for updates | Up to date | |
| U9 | Turn **Check automatically** off, restart NEXUS, wait 1 min | No check happens (Last checked unchanged) | |
| U10 | Turn it back on | | |

## C. Publish 0.1.1 and update

| # | Step | Expected | Result |
|---|---|---|---|
| U11 | `node scripts/bump-version.mjs 0.1.1`, commit, push, publish release `v0.1.1` with notes | Workflow succeeds, including "Verify the published update" | |
| U12 | Open `<UPDATE_PUBLIC_BASE_URL>/stable/latest.json` in a browser | Version 0.1.1, one `windows-x86_64-nsis` entry, `https://` URL | |
| U13 | In 0.1.0, Check for updates (or restart and wait 20 s) | Banner "Update available: NEXUS 0.1.1 (you have 0.1.0)"; **What's new** shows the notes | |
| U14 | Click **Later** | Banner disappears; Settings still shows 0.1.1 available. Restart NEXUS: banner stays hidden for 0.1.1 | |
| U15 | Settings → **Update now** | Progress bar with MB downloaded / total; Check for updates is disabled meanwhile | |
| U16 | When done | "Restart and install", "…signature verified" | |
| U17 | Click **Restart and install** | NEXUS closes; a small installer progress window appears (passive, no questions); NEXUS reopens by itself | |
| U18 | After reopening | Green banner "NEXUS was updated to 0.1.1…"; Settings → Current version 0.1.1 | |
| U19 | Compare with U5 | All profiles, calibration, games, macros and settings are unchanged | |
| U20 | Data folder `backups\` | `pre-update 0.1.0 to 0.1.1 <date>.db` exists | |
| U21 | Windows Settings → Apps | Exactly one "NEXUS" entry, version 0.1.1 | |
| U22 | Check for updates | Up to date (no downgrade offered) | |

## D. Negative cases (optional, needs a staging bucket)

Use a separate bucket and a separate `UPDATE_PUBLIC_BASE_URL` for a test build. Don't modify the production bucket.

| # | Step | Expected | Result |
|---|---|---|---|
| U23 | Replace the staging installer with a different file (keep `latest.json`) | Update now → "The update failed its security check…"; nothing installed | |
| U24 | Edit staging `latest.json` to invalid JSON | Check → "The update server sent information NEXUS couldn't read" | |
| U25 | Install the `.msi` of 0.1.0 instead, then check | "This copy was installed with the MSI package…"; nothing installed | |
| U26 | Close NEXUS during a download | Next start is normal; the update is offered again | |

## E. SmartScreen

| # | Step | Expected | Result |
|---|---|---|---|
| U27 | Note whether SmartScreen appears for the first manual install and during U17 | Record. Updater signing does **not** remove SmartScreen; only Authenticode code signing does | |
