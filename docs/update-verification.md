# Update verification checklist (Windows)

## Automated Windows result (2026-11-18)

[`update-e2e.yml`](../.github/workflows/update-e2e.yml) ([run 44239087021](https://github.com/ayyflame/nexus-controller/actions/runs/44239087021), commit `4b9ac93`) passed **12/12** on a GitHub Windows Server 2025 x64 runner.

**Setup:**
- Two real, signed NEXUS builds, 0.1.0 and 0.1.1.
- A throwaway signing key, created for that run only.
- An HTTPS test host on that machine.
- The real installer, the real updater and the real UI, driven through WebView2 DevTools.

| # | Step | Result |
|---|---|---|
| T1 | Install 0.1.0 with its installer | Pass |
| T2 | Start 0.1.0; create a profile, a mapping, a macro and settings | Pass |
| T3 | Update server unavailable | Pass: "Couldn't reach the update server…"; NEXUS kept working; retry available |
| T4 | No update available | Pass: "You're up to date (version 0.1.0)", no notice |
| T5 | Incorrectly signed update (modified installer) | Pass: "The update failed its security check…", nothing installed |
| T6 | Notice content | Pass: "Update available: NEXUS 0.1.1 (you have 0.1.0)", notes, **Update now**, **Remind me later** |
| T7 | Remind me later, same session | Pass: not shown again after a new check |
| T8 | After restarting NEXUS | Pass: offered again |
| T9 | Update now | Pass: background download, progress bar to 100 %, "signature verified" |
| T10 | Restart and install | Pass: 0.1.1 installed; NEXUS **restarted by itself** on 0.1.1; "NEXUS was updated to 0.1.1…" |
| T11 | Data | Pass: profiles, mappings, macros and settings identical; `pre-update 0.1.0 to 0.1.1 ….db` backup created |
| T12 | Afterwards | Pass: exactly one NEXUS installation (0.1.1); up to date |

**Differences from a real release:**
- the signing key is a test key;
- the host is `https://localhost` with a certificate trusted only on the test machine;
- the OS is Windows Server 2025, not Windows 11;
- the test builds also open WebView2's DevTools port so the test can click the UI.

The updater code, signature checks, installer and restart are the same as in release builds. The manual checklist below repeats this with your real key and host on a Windows 11 PC.

## Manual checklist (your PC, after the one-time setup)

**Not performed yet.** It needs the one-time setup and two published versions.

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
