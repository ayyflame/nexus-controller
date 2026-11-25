# Macro Studio

Macro Studio lets anyone record or build a button sequence and start it with a single controller button.

> Games receive macros through NEXUS's virtual Xbox 360 controller, which needs the free ViGEmBus driver (Virtual Controller). Without it, macros still run inside NEXUS and can be tried under **Test with your controller**, but games don't see them.

## For users

**The workspace.** Macro Studio has its own place in the sidebar. On the left is every saved macro; the selected one is open on the right.

- **Find a macro:** search by name, description or trigger button (for example "R1"). Sort by *Last modified*, *Name* or *Newest*; the choice is remembered.
- **Pin** macros you use often: they stay at the top.
- **Each row shows** the trigger button, the mode, the number of actions, when it last changed, and the profiles it is on in. A gold bar marks macros that react to their button right now (assigned and on in the active profile); a pulsing dot marks one that is playing.
- **Actions** on the open macro: rename it and edit its description in place, switch it on or off in this profile, **Pin**, **Duplicate** (the copy has no button), **Export** (this macro alone to a file), **Delete** (asks first: it is removed from every profile). **Import** and **Export all** are at the top.

**Make a macro.**

1. **＋ New macro.** Give it a name and choose where it starts: an empty sequence or a template (double tap, triple tap, rapid press, long hold, tap then hold, hold L2 while tapping). You can also pick the button that starts it now or later.
2. **Create the sequence**, in one of two ways:
   - **Record:** press **Start Recording**, perform the presses on your controller, then **Stop Recording** and review what was captured (replace, append or discard). Recording stops on its own after 60 seconds or 200 presses.
   - **Build Manually:** choose what a click adds (**Press**, **Press & keep held** or **Release**), then click buttons on the controller layout.
3. **Edit the timeline:** click an action to change its buttons, kind and timing; drag to reorder; duplicate, delete, undo and redo (Ctrl+Z, Ctrl+Y, Delete). **Play preview** animates it on screen and never presses anything in a game.
4. **Button and playback:** the button that starts it and how it plays:
   - **Play Once:** one press plays the sequence, optionally **1–100 times** in a row with the pause between repeats.
   - **Repeat While Held:** repeats until you let go.
   - **Toggle On/Off:** press to start repeating, press again to stop.
   - **Advanced settings:** hold to activate, pause between repeats, whether the trigger button itself reaches games.

Edits save automatically when they're valid; the header shows *Saved* or what needs fixing. A new macro is created on its first valid save and later edits update it. Editing never changes the macro's button or which profiles it is on in.

**Action kinds.**

- **Press:** press, hold for the press time, release.
- **Press & keep held:** the button goes down and stays down while the next actions run, until a **Release** action lets go of it (or the sequence ends). Example: hold L2, tap R2 twice, release L2.
- **Release:** lets go of buttons an earlier action keeps held. Only held buttons can be chosen; a held button can't be pressed again until it is released. The timeline shows which buttons are still held under each action.

**Test.** The *Test* panel reads the engine's own state for this macro: *Waiting* for its button, *Arming* (hold to activate, with progress), *Running* with the current action, the pass (for example *pass 2 of 3*) and the buttons down, then back to *Waiting*. It shows the controller NEXUS sends to games, whether games receive it, and **Stop all macros**.

**With Mapping.**

- In Macro Studio, **Show in Mapping** opens Mapping with the macro's button selected on its *Macro* tab.
- In Mapping, a button's *Macro* tab lists the macros it starts, with **Edit in Macro Studio** and **Remove from (button)**. Removing keeps the macro, without a button. **＋ New macro for (button)** opens Macro Studio's new-macro dialog with that button chosen, and you can assign an existing macro from the list.

Rules that keep things simple and safe:

- **No conflicting triggers.** Two enabled macros can't share a trigger button. Buttons already in use are greyed out, with the reason shown.
- **PS is reserved.** The PS button can't start a macro.
- **Unique names.** Two macros can't have the same name.
- **Hidden trigger by default.** By default the trigger button itself is hidden from games. Change this under **Advanced settings**.
- **Shared across profiles.** Macros are available in every profile; each profile chooses which are on.
- **Files:** a macro that uses *Press & keep held*, *Release* or a repeat count is exported as format version 2. Older NEXUS builds refuse that file rather than play it differently. Other macros are exported as version 1, as before.

DualSense Edge back paddles are shown as *not supported yet*, because their input isn't decoded yet. Keyboard and mouse actions are not part of macros.

## How it works

| Piece | Where | Role |
|---|---|---|
| Model and validation | `crates/macro-engine/src/model.rs` | `Macro`, `MacroStep` (`StepKind`: tap, hold, release), `PlaybackMode`, repeat count; user-facing `ValidationIssue`s |
| Playback | `crates/macro-engine/src/playback.rs` | `MacroRunner`, one per controller, on its reader thread; run states (arming, running) for the Test panel |
| Recording | `crates/macro-engine/src/recorder.rs` | `MacroRecorder` turns physical input into steps |
| Engine wiring | `crates/engine/src/lib.rs` | physical → processing → **macros** → virtual output; recording API |
| Storage | `crates/profile-manager/src/macros.rs` | SQLite `macros` table (schema v2; new fields live in the stored JSON, no migration); pins and where each macro is on (`MacroMeta`) |
| Commands | `apps/desktop/src-tauri/src/commands.rs` | `list/save/delete/duplicate_macro`, `set_macro_enabled`, `export_macro`, `get_macro_meta`, `set_macro_pinned`, `start/stop/cancel_macro_recording` |
| UI | `apps/desktop/src/pages/MacroStudio.tsx`, `src/components/macro/`, `src/lib/macroStudio.ts` | Workspace list, editor, Test panel; no execution logic |

**Execution path.** For every controller report, the reader thread:

1. reads macro triggers from the **physical** state;
2. overlays the presses of every playing macro onto the **output** state;
3. sends that state to virtual output.

The engine status carries both states: `input` (physical) and `processed` (what games would receive). The dashboard shows `input`; Macro Studio's Test panel shows `processed`, and the status's `macroRuns` (which macros are arming or running, and since when). The UI works out the current action from that and the macro's timing, so the reader thread sends nothing extra per report.

**Safety:**

- **Disconnect.** When a controller disconnects, its runner stops every macro before the virtual device is released. Macro presses only exist in the computed output, so nothing can stay "stuck", including buttons a *Press & keep held* action is holding.
- **Turning a macro off, Stop all, switching profile.** Each stops the macro at once and the next report has its buttons released (tested with a held L2).
- **Shutdown.** Closing the app ends every session the same way.
- **Library edits.** Changing the library stops running macros. A trigger that is already held never starts a macro by itself; it must be pressed again.
- **Recording.** While recording, macros are paused, so pressing a trigger doesn't play a macro into your recording. A disconnect mid-recording stops it and keeps what was captured.

**Timing.** Macro output changes when the controller sends a report (about every 4 ms over USB), with an idle fallback, so timing resolution is a few milliseconds, plus Windows scheduling delay. Times are stored and shown in whole milliseconds, but NEXUS doesn't promise millisecond-exact playback; games then read the virtual controller once per frame.

**Scope.** Macros cover user-triggered button sequences only:

- They do not record or move sticks.
- They provide no aim assistance or recoil compensation.
- They never read or modify game memory.

## Testing

- **Rust:**
  - `macro-engine`: 32 tests covering the timeline, all three modes, chords, trigger blocking, library updates, suspension, recording with chords, overlaps, held-at-start, limits, and triggers and D-pad.
  - `profile-manager`: 6 macro storage tests, including v1→v2 migration.
  - `engine`: 5 end-to-end tests using synthetic DualSense reports (trigger → output, recording, interrupted recording, disconnect).
- **Frontend:** `npm test` (Node's built-in runner) covers the preview timeline (same cases as the engine), defaults, validation, conflicts and button mapping.
- **Hardware:** Repeat While Held through the virtual Xbox controller in an offline game has been verified by the owner; the remaining rows are in `tests/m4.5-test-plan.md`.

## Editing timing after recording

Recorded or built macros can be retimed at any time. There is no need to record again.

- **One action:** click it in the timeline.
  - The inspector shows when the action starts, and its **press time** and **wait after release**.
  - Press time and wait after release are typed millisecond fields next to their presets. **Exact timing** adds **Wait before** (for every action except the first, this edits the previous action's wait).
  - On the last action, the wait after release is the wait before a Repeat While Held or Toggle macro starts again. The **pause between repeats** (Assignment › Advanced settings) follows it.
  - The first action always starts as soon as the macro is triggered.
- **Several actions:** Ctrl+click, Shift+click or Ctrl+A in the timeline, then use the panel that appears:
  - set one press time or wait for all selected actions;
  - or change the speed (2× faster, faster, slower, 2× slower, or any 1–1000 %) while keeping the recorded rhythm.
  - Nothing changes until you press Enter or **Set**, or leave a field you typed in. Ctrl+Z undoes.
- **Timeline and preview:** the timeline and **Play preview** use the new values immediately.
- **Typing a value:** clicking a field selects its whole value, so you can type over it. A value is stored when you press Enter or leave the field, never while you type. Escape puts the stored value back.
- **Limits:** press time is 20–10,000 ms, wait is 0–10,000 ms, and a macro can have up to 200 actions. Only whole milliseconds are accepted. A value outside the limits is not stored and is not rounded or limited for you: on Enter the field keeps what you typed and says why; on leaving it shows the stored value again with a "Not changed" note.
- **Saving:** timing is part of the saved macro, so it is kept by saving, duplicating, exporting and importing.
- **Behaviour unchanged:** Play Once, Repeat While Held and Toggle work the same. Each mode simply plays the edited timing.
- **Precision:** timing follows controller reports, about every 4 ms over USB.

## Recording rules and timing checks

- **Combined actions:** a button joins a "pressed together" action only if it is pressed while the first button is still held, within 50 ms. A quick tap after a release is its own action, so a fast Square-then-Triangle stays two actions.
- **Minimum release gap:** recorded presses of the same button always keep at least a **20 ms release gap**, so playback never merges two taps into one long press. If needed the gap is taken from the press time.
- **Merge warnings:** the editor warns (⚠ on the wait in the timeline, a notice under the timeline, and in the action panel) when two consecutive actions press the same button less than 20 ms apart. It also warns when a looping macro's last and first actions do so across the repeat boundary (*wait after the last action + pause between repeats*). Warnings never block saving.
- **Preview:** for Repeat While Held and Toggle, **Play preview (loops)** repeats with the pause between repeats, exactly like the engine, until you press Stop.
- **Millisecond fields:** an empty or invalid field reverts. Out-of-range values are limited, and the field then shows the stored value. Leaving a field unchanged creates no undo step.
- **Overlapping holds:** when a button is still held while another is pressed (for example L2 held while tapping R2), the recording keeps it held: it becomes *Press & keep held* and a matching *Release*, so playback matches what you did.
- **Known limits:** timing resolution is one controller report (about 4 ms over USB). A press shorter than that can't be recorded.
