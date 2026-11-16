# Macro Studio

Macro Studio lets anyone record or build a button sequence and start it with a single controller button.

> **Current limitation: macros don't reach games yet.** Games only see NEXUS input through a virtual controller, and the virtual controller driver (experimental ViGEmBus backend) is still waiting on hardware validation. Until then, macros run inside NEXUS and can be tested with your real controller under **Test with your controller**. The app says this clearly everywhere it matters.

## For users

1. **Macro Studio → Create Macro.**
2. **Name your macro.** Add a description if you like.
3. **Create the sequence**, in one of two ways:
   - **Record:** press **Start Recording**, perform the presses on your controller, then press **Stop Recording**. Presses, releases and timing are captured automatically. Buttons pressed within 50 ms of each other become one combined action (for example L1 + R1).
   - **Build Manually:** click buttons on the controller layout to add actions.

   Then edit the timeline:
   - Click an action to change its buttons, its **press time** and the **wait after release**. Presets are Tap, Press, Hold and Long hold; exact milliseconds are under **Exact timing**.
   - Drag actions to reorder them, or use ← →. **Duplicate**, **Delete**, **Undo** and **Redo** are all available, with keyboard shortcuts Ctrl+Z, Ctrl+Y and Delete.
   - **Play preview** animates the sequence on screen. It never presses anything in a game.
4. **Assign your macro.** Pick the button that starts it, then how it plays:
   - **Play Once:** one press plays the whole sequence.
   - **Repeat While Held:** repeats until you let go.
   - **Toggle On/Off:** press to start repeating, press again to stop.
5. **Save Macro.** After that, edits save automatically when they're valid. The editor shows *All changes saved* or what needs fixing.

Rules that keep things simple and safe:

- **No conflicting triggers.** Two enabled macros can't share a trigger button. Buttons already in use are greyed out, with the reason shown.
- **PS is reserved.** The PS button can't start a macro.
- **Unique names.** Two macros can't have the same name.
- **Hidden trigger by default.** By default the trigger button itself is hidden from games. Change this under **Advanced settings**.
- **Deleting needs confirmation.**
- **Shared across profiles.** Macros are available in every profile.

DualSense Edge back paddles are shown as *not supported yet*, because their input isn't decoded yet.

## How it works

| Piece | Where | Role |
|---|---|---|
| Model and validation | `crates/macro-engine/src/model.rs` | `Macro`, `MacroStep`, `PlaybackMode`; user-facing `ValidationIssue`s |
| Playback | `crates/macro-engine/src/playback.rs` | `MacroRunner`, one per controller, on its reader thread |
| Recording | `crates/macro-engine/src/recorder.rs` | `MacroRecorder` turns physical input into steps |
| Engine wiring | `crates/engine/src/lib.rs` | physical → processing → **macros** → virtual output; recording API |
| Storage | `crates/profile-manager/src/macros.rs` | SQLite `macros` table (schema v2); migration from v1 |
| Commands | `apps/desktop/src-tauri/src/commands.rs` | `list/save/delete/duplicate_macro`, `set_macro_enabled`, `start/stop/cancel_macro_recording` |
| UI | `apps/desktop/src/pages/MacroStudio.tsx`, `src/components/macro/` | List, wizard, editor; no execution logic |

**Execution path.** For every controller report, the reader thread:

1. reads macro triggers from the **physical** state;
2. overlays the presses of every playing macro onto the **output** state;
3. sends that state to virtual output.

The engine status carries both states: `input` (physical) and `processed` (what games would receive). The dashboard shows `input`; Macro Studio's live test shows `processed`.

**Safety:**

- **Disconnect.** When a controller disconnects, its runner stops every macro before the virtual device is released. Macro presses only exist in the computed output, so nothing can stay "stuck".
- **Shutdown.** Closing the app ends every session the same way.
- **Library edits.** Changing the library stops running macros. A trigger that is already held never starts a macro by itself; it must be pressed again.
- **Recording.** While recording, macros are paused, so pressing a trigger doesn't play a macro into your recording. A disconnect mid-recording stops it and keeps what was captured.

**Timing.** Macro output changes when the controller sends a report (about every 4 ms over USB), with an idle fallback, so timing resolution is a few milliseconds.

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
- **Not yet verified:** recording and playback with a physical DualSense, and macros reaching a game. The latter needs virtual output.

## Editing timing after recording

Recorded or built macros can be retimed at any time. There is no need to record again.

- **One action:** click it in the timeline.
  - The inspector shows when the action starts, and its **press time** and **wait after release**.
  - It has presets and sliders, plus **Exact timing** for millisecond entry, including **Wait before** (for every action except the first, this edits the previous action's wait).
  - The first action always starts as soon as the macro is triggered.
- **Several actions:** Ctrl+click, Shift+click or Ctrl+A in the timeline, then use the panel that appears:
  - set one press time or wait for all selected actions;
  - or change the speed (2× faster, faster, slower, 2× slower, or any 1–1000 %) while keeping the recorded rhythm.
  - Nothing changes until you press Enter or **Set**, and Ctrl+Z undoes.
- **Timeline and preview:** the timeline and **Play preview** use the new values immediately.
- **Limits:** values are always kept within the limits the engine accepts. Press time is 20–10,000 ms, wait is 0–10,000 ms, and a macro can have up to 200 actions.
- **Saving:** timing is part of the saved macro, so it is kept by saving, duplicating, exporting and importing.
- **Behaviour unchanged:** Play Once, Repeat While Held and Toggle work the same. Each mode simply plays the edited timing.
- **Precision:** timing follows controller reports, about every 4 ms over USB.
