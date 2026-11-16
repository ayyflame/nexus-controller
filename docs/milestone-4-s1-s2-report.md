# Milestone 4: S1 (USB reliability) and S2 (Report Inspector) report

## 1. Verified on real hardware

**Nothing new.** This work was done in a Linux cloud container with no Windows PC and no controller attached, so no physical test could be run. The only hardware facts remain the owner's earlier report:

- the PS5 DualSense over USB works;
- 73,835 reports;
- 0 parse errors;
- about 250 Hz.

All results below are automated (simulated) or still pending your hardware run.

## 2. Automated test results

| Suite | Result |
|---|---|
| Rust workspace (`cargo test --workspace --locked`) | **262 passed, 0 failed** (242 before this milestone) |
| `cargo clippy --workspace --all-targets -D warnings` (Linux) | Clean |
| `cargo clippy` Windows target (device-manager incl. new Windows HID code, updates, app-detect) | Clean |
| `cargo fmt --check` | Clean |
| Frontend: `npm run typecheck`, `npm test` (21), `npm run build` | Pass |
| GitHub Actions Windows build + installer | See the final message for this run's result |

**A fix found by Windows CI.** The updater test fixture was checked out with CRLF line endings on Windows, which changed its bytes and broke the signature test. The fixtures are now marked binary in `.gitattributes`. Real installers were never affected, because they are binary files.

### New simulated tests

USB reliability (`device-manager`, mock HID backend):

- `new_hid_path_with_same_serial_replaces_the_old_session`: Windows gives a re-plugged controller a new path while the old handle has not failed yet. The old session is closed as Removed, the new one opens, and the old handle is released.
- `new_hid_path_without_serial_reconnects_once`: the same with no serial number (common for a USB DualSense).
- `repeated_replug_cycles_never_duplicate_or_leak`: 100 unplug/re-plug cycles alternating between two paths give exactly 100 connects and 100 disconnects. There is never more than one session, no handle leaks, and all reader threads are joined. It was rerun 3× with no flakes.
- `reports_from_a_removed_session_never_reach_the_new_one`: no stale input stream.
- `shutdown_and_restart_reopen_the_same_controller_once`: 5 start/stop cycles, handle released each time.

Report timing (`telemetry`, `engine`):

- `report_intervals_track_min_mean_max_and_late_reports`;
- `report_intervals_are_published_for_usb_stability_checks`.

Report Inspector (`engine`, synthetic DualSense reports with realistic noise):

- **Nothing pressed:** reports "no change". Counter, timestamp, gyro and stick jitter are detected as noise.
- **Paddle mapped to Cross:** reported as **Cross**, never as a paddle.
- **Undecoded bits:** an undecoded bit (byte 10, 0x40) or a reserved byte is flagged as a *candidate*.
- **Mixed and analog:** mixed changes are classified correctly, and stick-only changes are reported as analog only.
- **Short presses and odd reports:** brief presses and non-standard report formats produce warnings.
- **Session rules:** a baseline is required; a different controller is rejected; a new baseline starts over; the export contains every raw report.
- **Capture:** it records only the connected controller, refuses a second capture while one runs, and needs a connected controller.
- **Interface listing:** it returns the controller's own interfaces plus a vendor-defined sibling interface on the same USB device. It excludes another controller on a different port.

The simulated tests cannot show how Windows actually assigns device paths, how fast removal is reported, the real report timing, or what the MZ Titan sends. Those need the hardware rows below.

## 3. What was built

**S1: USB reliability**

- Five new reliability tests (above).
- **Report timing** on the Performance page and in the diagnostics report:
  - minimum, average and maximum time between reports;
  - number of reports later than 8 ms and later than 50 ms since connect.
- Connection statistics and sequence gaps are added to the diagnostics report.
- **Bluetooth is removed** from the UI text, onboarding, docs and checklist. The parser code is kept, unused.
- The hidden "colour shows the connection" option can no longer lock the lightbar colour picker.

**S2: Report Inspector** (*Settings → Report Inspector*, read-only)

1. **Record baseline:** 2 s, hands off. This learns which bytes are naturally noisy.
2. **Record while holding:** 3 s. Pick *Left paddle*, *Right paddle*, *Both paddles*, *Cross (reference)* or a custom label.

For each capture it shows:

- every changed byte, its field name, the rest and pressed values, and the changed bits;
- whether NEXUS decodes those bits;
- a verdict.

Verdicts:

- "Reported as Cross" means mapped mode, and is never called a paddle.
- "Candidate independent input" means bits NEXUS doesn't decode changed.
- "No change" means the press is not visible in the report.

Further functions:

- **List interfaces** shows every HID interface of the controller's USB device, including ones NEXUS doesn't read. It gives each interface's type and the buttons and value fields its descriptor declares. Only interfaces of that same USB device are queried; other devices are never opened.
- **Export captures** writes JSON to `Documents\NEXUS\Captures` with:
  - every raw report as hex;
  - the analyses;
  - the interfaces;
  - the controller model and timing (no serial numbers).

**Code finding confirmed:** NEXUS ignores bits 3–7 of USB byte 10. Public reverse-engineering (e.g. SDL) puts the DualSense Edge's Fn and back buttons there. This is unconfirmed by us. The inspector labels those bits, but nothing is decoded until a capture proves it.

## 4. Hardware tests for you to run

Use the installer from this run's Windows build. Follow `tests/hardware-verification.md`:

- **Rows 53–62:** USB start-up, unplug, different port, 20 quick re-plugs, a 10-minute soak with timing numbers, and restart.
- **T1–T10:** MZ Titan in mapped mode and in independent/native mode.

Please send:

- the diagnostics report after the soak (row 62);
- the exported capture JSON files (T10);
- screenshots of *List interfaces* in both MZ Titan modes (T1, T3).

## 5. Updated recommendations

1. **Run rows 53–62 and T1–T10 before any virtual-output work.** This follows your instruction. S4 stays on hold.
2. **Next paddle step depends on what the captures show:**

   | Outcome | Next step |
   |---|---|
   | Consistent undecoded bits in the standard report | Add **Paddle Left / Paddle Right** as inputs: buttons, macros, shift layers and the input monitor. The capability appears only after a paddle bit is actually seen on the device, so a mapped button is never shown as a paddle. No database migration is needed (additive JSON). |
   | Extra interface on the same USB device | Read that interface as a second input source for the same controller. User-mode HID only; no driver. |
   | No change and no extra interface | Paddles are not visible to Windows in that mode. Document it and recommend mapped mode, which works today. |

3. **USB:** if the soak shows late reports over 50 ms or dropped reports, investigate before S4:
   - the HID input buffer count;
   - reader-thread priority;
   - USB power management.

   If the numbers are clean, S1 is complete.
4. **Virtual output (S4, conditional ViGEmBus approval):** unchanged.
   - Opt-in, user-installed, never bundled, behind the replaceable backend.
   - Before claiming any game works, the S4 test plan will include a **duplicate-input test**: a gamepad tester and Steam with both the physical and the virtual pad visible, with the limitation documented (HidHide deferred).
   - Long-term alternatives to keep evaluating:
     - a commercial licence for Nefarius VirtualPad;
     - Windows' built-in gamepad injection, if Microsoft makes it usable for XInput games.
