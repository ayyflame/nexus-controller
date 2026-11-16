# Milestone 5: Production Readiness and Release Candidate: Plan (for approval)

**Status:** plan only. No Milestone 5 implementation has started.

---

## 0. Milestone 4 review and remaining blockers

**Milestone 4 is not complete.** The milestone says Milestone 5 begins only after Milestone 4 is complete and approved, so these are blockers:

| # | Blocker | Owner | Blocks |
|---|---|---|---|
| B1 | **Hardware results for S1/S2 not received**: USB rows 53–62 and MZ Titan T1–T10 (`tests/hardware-verification.md`) | You (physical PC) | M4 sign-off, §2 paddles, §4 |
| B2 | **M4 S3 (paddles) not started**: depends on B1 captures | Me, after B1 | §2 paddle rows |
| B3 | **M4 S4 (virtual output) not started**: on hold by your instruction | Me, after approval | §1, §2, §4 entirely |
| B4 | **No production-grade virtual-controller driver exists yet** (see §1) | Your licensing decision | Production release |
| B5 | **Updater not live**: no signing key, host or secrets; 0.1.0 → 0.1.1 never run on Windows | You (one-time setup) | §5 |
| B6 | **Installer not Authenticode-signed**, so SmartScreen warns. Needs a code-signing certificate (recurring cost). | Your decision | "Ordinary users" polish |
| B7 | **Earlier checklist rows 1–52 not recorded** (USB parts) | You | Verified feature list |

What *is* done and verified:

- automated tests: 262 Rust and 21 frontend, Windows CI green;
- signed-update pipeline (implemented, not live);
- Report Inspector;
- USB reliability logic (simulated);
- physical USB input (your report: 0 parse errors, about 250 Hz).

**Proposed order:** finish M4 (B1 → S3 → S4 as an approved backend), then M5 stages A–G below. Work that doesn't depend on hardware can start in parallel once approved: §3 data model, §6 installer polish, §7 UI audit, §8 audit tooling.

---

## 1. Production virtual-controller backend: final evaluation

Nothing below is based only on vendor claims. Items marked *claim* come from the project's own docs and must be checked in a test VM before any decision.

| | **ViGEmBus 1.22** | **Nefarius VirtualPad** | **LizardByte Virtual HID Driver** | **HIDMaestro** | **Windows InputInjector** |
|---|---|---|---|---|---|
| Xbox 360 / XInput | Yes (long-standing, very widely used) | Yes (*claim*) | Via an "XUSB companion" (*claim*) | Yes (*claim*: XInput, DInput, SDL3, WGI) | WGI only; XInput unconfirmed |
| DualShock 4 | Yes (incl. extended report) | Yes (*claim*) | Yes, answers DS4 feature reports (*claim*) | Yes, byte-exact profiles (*claim*) | No |
| Windows 11 x64 | Works today | Yes (*claim*) | Yes, AMD64 installer | Yes (*claim*) | Yes |
| Driver type | Kernel bus driver (theirs, not ours) | Commercial driver | UMDF2 on Windows VHF (user mode) | UMDF2 HID minidriver (user mode); composite USB personas need usbip-win2 (kernel) | No driver |
| Signing | **Microsoft-signed** release | Vendor-signed (*claim*) | Vendor-signed package (*claim*) | **Self-signed certificate created on the user's PC and added to the machine *Root* and *TrustedPublisher* stores** | n/a |
| Install | Official installer, UAC | Vendor | Vendor installer, UAC | SDK `InstallDriver()` needs admin; needs .NET 10 | Restricted capability: MSIX plus Microsoft approval |
| Redistribution | BSD-3 code, but archived; we don't bundle it | **Partner-only commercial; terms and price not public** | **Paid per-machine licence for gamepads** | Licence to verify | n/a |
| External service | None | Unknown | **Internet licence check when creating a gamepad** | None (*claim*) | None |
| Maintenance | **Archived Nov 2023**, no fixes | Maintained | Maintained (new, 2026) | Active open-source project (single maintainer) | Microsoft |
| Real game results | Huge install base; none tested by us | None known to us | Too new; none tested by us | Used by PadForge; none tested by us | Unknown |

### Assessment

**ViGEmBus**
- *Fits:* the only option that is signed by Microsoft and free of licensing and online dependencies.
- *Against:* archived, so a future Windows update could break it with no fix coming.
- *Verdict:* acceptable **only** as an opt-in, user-installed backend clearly labelled as retired upstream. This is your conditional M4 approval.

**Nefarius VirtualPad**
- *Fits:* the natural successor, and maintained.
- *Against:* commercial and partner-only, with unknown price, per-machine terms and redistribution rights.
- *Verdict:* **request terms from Nefarius Software Solutions.** It can't be evaluated technically without a licence.

**LizardByte Virtual HID Driver**
- *Fits:* technically attractive (user mode, DS4 and DualSense profiles).
- *Against:*
  - **paid per-machine licence**, effectively a cost per customer;
  - **mandatory online licence check**, which breaks offline use;
  - Xbox 360 goes through an extra XUSB component.
- *Verdict:* conflicts with "no unexpected subscriptions or external-service dependencies" unless you accept a commercial agreement.

**HIDMaestro**
- *Fits:* the most capable on paper.
- *Against:* it gets around driver signing by **installing a self-signed root certificate on every customer PC**. If that certificate's private key stays on the machine, any local admin-level malware could sign code the PC trusts. Its USB personas also need a kernel component, and it needs the .NET 10 runtime.
- *Verdict:* **not recommended for a consumer production component**, as an exception to "do not ship unsigned experimental drivers". It could be revisited if the project moves to properly signed packages.

**Windows InputInjector**
- *Verdict:* not viable for a Win32 app shipped outside the Store, and has no DS4.

**Custom driver**
- *Verdict:* excluded by the rules.

### Final recommendation (for approval)

1. **Release candidate:**
   - ship with **ViGEmBus as an optional, user-installed backend**: detected, never bundled, never silently installed, labelled "retired upstream";
   - output stays **off** until the user installs it;
   - everything else in NEXUS works without any driver.
2. **In parallel:** request written VirtualPad terms (price, per-machine fees, redistribution, offline use) and LizardByte commercial terms. **No production release that depends on a paid driver** until you approve the terms in writing.
3. **Keep `VirtualControllerBackend` the only seam.** Each candidate becomes one file in `crates/virtual-controller/src/`, so switching later touches no engine or UI code.
4. **Technical spike (test VM only, nothing shipped):** HIDMaestro and the LizardByte trial, to compare XInput/DS4 visibility, latency and cleanup against ViGEmBus with a reproducible test harness. Results go into the comparison doc.

**Decision needed (D1):** approve this ViGEmBus-for-RC plan, and whether to contact Nefarius and LizardByte for terms.

---

## 2. Complete controller functionality: validation plan

**Automated (mock HID plus mock virtual backend that records every submitted report):** a new end-to-end suite feeds synthetic DualSense reports and asserts the exact XUSB / DS4 report the backend receives. It covers:

| Feature | Xbox 360 output | DS4 output | Automated test |
|---|---|---|---|
| Face, shoulder, Start/Back, L3/R3, Guide | Yes | Yes | Per-button mapping table |
| Create / touchpad click / mute | Back / — / — | Share / touchpad click / — | Documented unmappables |
| Sticks (deadzones, curves, calibration) | 16-bit signed | 8-bit | Value ranges, inversion, Y direction |
| Triggers | 0–255 analog | Analog plus digital bits | Thresholds |
| D-pad, incl. diagonals | Buttons | Hat | All 8 directions |
| Touchpad | **Not representable**: zones/swipes map to buttons | Touch points through the extended report | Both paths |
| Gyro | **Not representable**: gyro-to-stick | Motion through the extended report, if the backend supports it (else gyro-to-stick) | Both |
| Vibration | Large/small motors **from** the game back to the DualSense | Same | Feedback path |
| Adaptive triggers, haptics | **Not representable by either protocol** | Same | Documented limitation |
| Remap, multi-action, shift layers | Yes | Yes | Through the pipeline |
| Macros, all activation modes | Yes | Yes | Once / repeat / toggle / hold reach the backend |
| MZ Titan mapped paddles | As the mapped button | Same | Existing |
| MZ Titan native paddles | Only through a user mapping to an output button | Same | Only if M4 S3 proves detection |

**Physical:** each row repeated with the real DualSense and a gamepad tester (Windows `joy.cpl`, the browser Gamepad API page and Steam's controller test).

**Acceptance:**

- every row has an automated test;
- every physical row is recorded as Pass, Fail or Not testable;
- the UI hides or labels features the selected output can't carry;
- no claim without a recorded result.

---

## 3. Multi-controller support

**Today:** the engine holds **one** processing configuration, **one** virtual-output choice and **one** set of active macros, shared by all connected controllers. The active profile is a single global setting.

**Design:**

- **Controller identity:** at connect, read the DualSense **pairing-info feature report (0x09)**, which contains the controller's unique MAC address. This uses `HidConnection::get_feature_report`, which already exists and has no side effects.
  - Store only a **salted hash** as the controller key, plus a user-editable name ("Controller 1", "MZ Titan"). The raw MAC is never stored, logged or exported.
  - Fallback if the read fails: per-session identity, labelled "Unrecognised controller (settings not remembered)".
- **Engine:** move processing, macros, output kind and feedback from `Shared` into a **per-device slot** keyed by `DeviceId`, each with its own generation counter.
  - The hot path still never locks or allocates.
  - `set_processing(device, …)` etc. touch only that device.
  - Disconnecting one device drops only its slot and its virtual device.
- **Virtual output:** one virtual device per physical controller (already the policy), with an output kind per controller.
- **Profiles:** each controller has its own active profile. Auto-switch by game applies to a chosen controller (default: controller 1).
- **UI:** a controller selector already exists (M3). All settings pages edit the **selected** controller's profile, and a header chip shows which one.

**Database migration v4 → v5 (needed: per-controller assignments must persist):**

- New table `controllers(key TEXT PRIMARY KEY, name TEXT, profile_id INTEGER REFERENCES profiles ON DELETE SET NULL, virtual_output TEXT, last_seen_ms INTEGER)`.
- No existing table changes.
- An unknown controller gets the current global active profile, so existing users see exactly today's behaviour with one controller.
- Uses the existing protections:
  - automatic backup `nexus.db.v4.bak` before migrating;
  - migration in a transaction;
  - refuse to open newer schemas.
- Tests:
  - v4 fixture migrates with data unchanged;
  - two controllers with independent profiles;
  - deleting a profile in use falls back safely;
  - downgrade is refused.

**Acceptance:**

- two DualSense controllers on USB keep separate profiles, output types and macros;
- unplugging one doesn't affect the other's input, timing or virtual device;
- assignments survive a restart and an update;
- existing single-controller users notice no change.

---

## 4. Input duplication and game compatibility

**Test matrix** (recorded in a new `docs/compatibility.md`, one row per game and configuration, with date, NEXUS version, driver version and result):

| Check | Method |
|---|---|
| Duplicate input | Gamepad tester and Steam with output on: are both the physical DualSense and the virtual pad visible? Does a press register twice? |
| XInput game | At least 2 titles you own |
| DS4/DirectInput game | At least 2 titles |
| Steam Input on / off | Same titles; Steam's PlayStation and Xbox configuration support toggles |
| Reconnect mid-game | Unplug the physical pad: the virtual pad must stay or reappear predictably, and the game must not see a stuck input |
| Switch Xbox ↔ DS4 mid-session | No leftover devices; the game re-detects |

**HidHide:** only if the duplicate-input test shows real games double-reading.

- Optional and explicit; the user hides the device in HidHide's own UI or with consent.
- Recovery documented: "Uninstall HidHide or unhide in its UI".
- NEXUS never hides devices by itself.

**Anti-cheat:** no promises; the report lists exactly what was tested.

**Acceptance:**

- the compatibility report exists with only real results;
- the duplicate-input behaviour is documented with the recommended setup;
- no "compatible" claim without a row.

---

## 5. Updater production readiness

The work is mostly yours (one-time) plus verification by me.

1. **You:** create the signing key and back it up (`docs/updater-setup.md`), create the R2 bucket, and add the GitHub secrets and variables.
2. **Me:** a dry-run workflow mode against a **staging** bucket, to exercise signing, manifest creation, upload and public verification without a public release.
3. **You and me:** publish **v0.1.0**, install it, publish **v0.1.1**, and run `docs/update-verification.md` U1–U27, including:
   - failed download;
   - interrupted update;
   - a tampered package on staging;
   - data surviving the update.
4. **Me:** add any fixes found. Document key backup and recovery (already written; I'll review it with you).

**Acceptance:**

- U1–U27 recorded;
- one real installed version updated itself on Windows;
- only then do docs say "automatic updates are live".

---

## 6. Installer and driver management

- **Metadata:**
  - product name, publisher, version, icon, Add/Remove Programs entry, Start-menu shortcut;
  - the NSIS installer stays primary (per-user, no admin);
  - the MSI stays an optional per-machine package.
- **First launch:** onboarding gets a "Virtual controller (optional)" step. It explains what the driver is and shows it as not installed or installed, with **Install guide** linking to the official installer. No auto-install.
- **Driver management page** (Controller › Virtual Output):
  - **detect:** present, version, running, retired-upstream notice;
  - **install:** guided, with explicit consent; opens the official signed installer; NEXUS stays non-admin;
  - **repair:** re-detect, plus how to reinstall;
  - **remove:** how to uninstall from Windows Apps;
  - clear errors for "installed but service stopped" and "access denied".
- **Uninstall:** keeps `%APPDATA%\com.nexus.controllerengine` by default, which is the NSIS default. The removal checkbox stays opt-in.
- **Code signing (B6):** recommend an Authenticode certificate. Azure Trusted Signing, or an OV/EV certificate, is a recurring cost and your decision (**D3**). Without it, SmartScreen warns on install. That is documented, not hidden.

**Acceptance:** recorded on a clean Windows 11 VM:

- clean install;
- upgrade install;
- repair (reinstall the same version);
- uninstall with data kept;
- uninstall with data removed;
- the driver flows above.

---

## 7. UI and UX audit

A screen-by-screen review against a written checklist, with before/after screenshots in the PR. It keeps the graphite and gold identity, and redesigns only where there is a usability gain.

| Area | Known items to check or fix |
|---|---|
| Onboarding | USB-only wording (done in M4). Add the optional-driver step. Skip and resume. |
| Connection status | One consistent status chip. Explicit "Awaiting input" vs "Connected". Per-controller names. |
| Profiles | Per-controller assignment (§3). Delete confirmations. Import errors in plain language. |
| Mapping / layers / multi-action | Show output-protocol limits (§2). Conflict warnings already exist; review the wording. |
| Macro Studio | Empty states, recording countdown, activation-mode explanations |
| Sticks / triggers / gyro / touchpad | Units and ranges. "Not available on Xbox 360 output" labels. |
| Lighting / vibration | Test buttons disabled without a controller, with the reason |
| Performance / diagnostics | Timing numbers (M4). Plain-language thresholds. |
| Settings search | Index every new setting |
| Errors / empty / loading / tooltips / dialogs | Inventory every `notice`, `empty-state` and `confirm`. One wording style; no technical errors without "Details". |
| Accessibility | Keyboard navigation, focus rings, contrast check on gold-on-graphite |

**Acceptance:** the checklist is completed with screenshots, and no screen shows a raw technical error or dead-end state.

---

## 8. Reliability, security and performance audit

| Check | Method |
|---|---|
| Memory leaks, task cleanup | 8-hour soak on Windows with Task Manager / `typeperf` logging of memory and handle count. Automated: thread and handle counts after 1,000 mock reconnects. |
| CPU idle / active | Recorded on Windows. Targets: < 0.5 % idle with no controller, < 2 % with input at 250 Hz (to confirm). |
| Latency, dropped reports | Existing per-report latency (p50/p99/max), plus M4 interval statistics and sequence gaps |
| DB integrity, corruption recovery | `PRAGMA integrity_check` at start-up. On failure, offer to restore the newest backup; never delete the original. Test with corrupted fixtures. |
| Import validation | Fuzz the importer with malformed and oversized files (existing validation plus a size cap) |
| Update and driver security | Review: HTTPS only, signature always checked, no secrets in the binary, NEXUS never elevates, driver installers only from official URLs |
| Privacy | Diagnostics, logs and exports reviewed: serials and MACs masked, no user paths (data-folder line excepted), no usernames, nothing sent anywhere automatically |
| Scope | No game-process access, aim assistance or recoil features (unchanged rule) |

**Acceptance:** soak and CPU numbers recorded, corruption recovery tested, privacy review checklist signed off.

---

## 9. Testing and reporting

Every report is split into four sections, so nothing untested reads as verified:

1. **Automated:**
   - Rust tests, clippy, fmt;
   - frontend typecheck, tests, build;
   - migration, update and lifecycle suites;
   - mock virtual-backend end-to-end.
2. **Windows CI:** release build, installers, VC++ runtime check.
3. **Physical:** your recorded rows, with dates and versions.
4. **Games:** the compatibility report.

---

## 10. Release candidate

The **gate** is that all of the following are true:

- §1 backend decision approved;
- the driver flows tested on a clean VM;
- §2 physical rows pass for the supported features;
- §3 acceptance met;
- the §4 compatibility report has at least the minimum titles;
- U1–U27 pass;
- §6 install, upgrade and uninstall pass;
- no open critical bugs.

**Deliverables:**

- installer and versioned artifacts (`v1.0.0-rc.1` as a GitHub pre-release; not offered to the Stable update channel);
- release notes;
- install, driver setup, troubleshooting, update and uninstall guides;
- the supported controller list (DualSense USB; MZ Titan with stated limits);
- the **verified feature list** (only recorded passes) and known limitations.

**Not** a production release until the B4 licensing decision and the B6 signing decision are made and verified.

---

## Files and modules expected to change

| Area | Files |
|---|---|
| Virtual output | new `crates/virtual-controller/src/vigem.rs`; `lib.rs`, `drivers.rs`, `translate.rs` (DS4 extended report); `crates/engine/src/lib.rs` (output lifecycle); new `crates/engine/src/e2e_tests.rs` (mock backend that records reports) |
| Multi-controller | `crates/engine/src/lib.rs` (per-device slots); `crates/dualsense/src/driver.rs` (0x09 identity read); `crates/profile-manager/src/{lib.rs,smart.rs}` (+ schema v5, `controllers` table) and tests; `apps/desktop/src-tauri/src/commands.rs`; `apps/desktop/src/hooks/useEngine.tsx`, controller selector, all settings pages |
| Driver management and onboarding | `apps/desktop/src/pages/Controller.tsx` (Virtual Output tab), `components/Onboarding.tsx`, new `components/DriverSetup.tsx` |
| Reliability | `crates/profile-manager` (integrity check and restore), `portable.rs` (size cap), soak tooling in `tests/` |
| Installer | `apps/desktop/src-tauri/tauri.conf.json` (metadata), icons, workflow (optional signing step) |
| Docs | `docs/compatibility.md`, `docs/driver-setup.md`, `docs/troubleshooting.md`, `docs/supported-controllers.md`, release notes, README |

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Archived ViGEmBus breaks on a Windows update | Virtual output stops | Opt-in, clearly labelled; backend replaceable; licence talks for successors |
| Commercial driver costs or online checks | Per-customer cost, offline failure | Written terms before any adoption; your approval |
| Self-signed-root drivers (HIDMaestro) | Weakens customer PC security | Not used in production |
| Schema v5 migration | Data loss if wrong | Backup before migration, transaction, fixtures, refuse newer schemas |
| Pairing-report identity read fails on some firmware or clones (MZ Titan) | Settings not remembered per controller | Fallback identity, clearly labelled |
| Duplicate input in games | Double presses | Measured; HidHide optional only if needed |
| Anti-cheat rejects virtual pads | Some games unusable with output on | Documented per tested game; no promises |
| SmartScreen without code signing | Customer distrust | D3 decision; documented |
| Hardware tests depend on you | Schedule | Short, scripted checklists with exports |

---

## Decisions requested

- **D1:** RC backend: ViGEmBus as optional and user-installed (recommended). Contact Nefarius (VirtualPad) and LizardByte for written commercial terms: yes/no.
- **D2:** Approve the multi-controller design, including **schema v5** (`controllers` table, backup-protected) and the MAC-hash identity from feature report 0x09.
- **D3:** Authenticode code signing: buy a certificate or use Azure Trusted Signing (recurring cost), or ship the RC unsigned with a documented SmartScreen warning.
- **D4:** Order: finish M4 (your hardware results → S3 paddles → S4 ViGEmBus backend) before M5 implementation. Allow §3, §6, §7 and §8 groundwork in parallel once approved.
- **D5:** Minimum game list for §4: please name 2 XInput and 2 DS4/DirectInput titles you own and can test.

## Sources (driver research)

- [HIDMaestro (GitHub)](https://github.com/hifihedgehog/HIDMaestro), [hidmaestro.org](https://hidmaestro.org/), [HIDMaestro docs: start](https://hidmaestro.org/docs/start/), [HIDMaestro specs](https://hidmaestro.org/specs.html), [HIDMaestro releases](https://github.com/hifihedgehog/HIDMaestro/releases), [PadForge](https://github.com/hifihedgehog/PadForge)
- [LizardByte libvirtualhid: Windows driver](https://docs.lizardbyte.dev/projects/libvirtualhid/latest/md_docs_2windows-driver.html), [Introducing libvirtualhid and Virtual HID Driver](https://app.lizardbyte.dev/2026-08-16-introducing-libvirtualhid-and-virtual-hid-driver/), [LizardByte roadmap: replace ViGEmBus](https://github.com/LizardByte/roadmap/issues/10)
- [Nefarius VirtualPad docs](https://docs.nefarius.at/projects/VirtualPad/), [Nefarius downloads](https://docs.nefarius.at/Downloads/)
- [ViGEmBus](https://vigembusdriver.com/), [Coda: ViGEmBus in 2026](https://coda-apps.com/guides/what-is-vigembus)
- [Microsoft: signing a driver for public release](https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/signing-a-driver-for-public-release), [Microsoft: InputInjector gamepad](https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.preview.injection.inputinjector.injectgamepadinput?view=winrt-26100)
