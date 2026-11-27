import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import { useHistory } from "../../hooks/useHistory";
import { engineApi, errorIssues, errorMessage } from "../../lib/engine";
import { LIMITS, validateMacro } from "../../lib/macros";
import { MacroSaver, reportMacroSaveFailure, setOpenMacroEditor } from "../../lib/macroSaves";
import { usageOf, usageText } from "../../lib/macroStudio";
import type { Macro, MacroMeta, MacroStep, Profile, ValidationIssue } from "../../types/engine";
import { AssignPanel } from "./AssignPanel";
import { ButtonPicker, PickerProvider } from "./ButtonPicker";
import { Issues, Switch } from "./common";
import { MacroTestPanel } from "./MacroTestPanel";
import { SequenceEditor } from "./SequenceEditor";

type SaveState = { kind: "saved" } | { kind: "pending" } | { kind: "saving" } | { kind: "invalid"; issues: ValidationIssue[] } | { kind: "error"; message: string };

const AUTOSAVE_MS = 700;
const go = (page: string, tab?: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page, tab } }));

/**
 * One macro's editor, shown on its own Macro Studio page. Valid
 * changes save automatically (a new macro is created on its first valid
 * save), and at once when you leave the page or do something that needs the
 * saved macro (Duplicate, Export, Show in Mapping); editing never changes its
 * button assignment unless you do.
 */
export function MacroEditor({ initial, others, profiles, meta, activeProfileId, onSaved, onDuplicate, onExport, onDelete, onPin }: {
  initial: Macro;
  others: Macro[];
  profiles: Profile[];
  meta: MacroMeta;
  activeProfileId: number | null;
  /** `open`: false when the save finished after the editor had closed. */
  onSaved: (m: Macro, wasNew: boolean, open: boolean) => void;
  onDuplicate: (m: Macro) => void;
  onExport: (m: Macro) => void;
  onDelete: (m: Macro) => void;
  onPin: (m: Macro, pinned: boolean) => void;
}) {
  const [draft, setDraft] = useState<Macro>(initial);
  const steps = useHistory<MacroStep[]>(initial.steps);
  const [save, setSave] = useState<SaveState>(initial.id ? { kind: "saved" } : { kind: "pending" });
  const [savedEnabled, setSavedEnabled] = useState(initial.id ? initial.enabled : false);
  const full: Macro = { ...draft, steps: steps.value };
  // Read by saves when they start, and after the editor has closed: always the latest.
  const fullRef = useRef(full);
  fullRef.current = full;
  const othersRef = useRef(others);
  othersRef.current = others;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const mounted = useRef(false);
  // Set as the app starts navigating away (before this unmounts): from then on
  // nothing here navigates, and failures are reported to the library instead.
  const leaving = useRef(false);
  const isOpen = () => mounted.current && !leaving.current;
  const refreshRef = useRef<(restart: boolean) => void>(() => undefined);

  // One save at a time, of the latest content (see MacroSaver); results
  // after the editor has closed don't touch it.
  const [saver] = useState(() => new MacroSaver(initial, {
    latest: () => fullRef.current,
    save: (m) => engineApi.saveMacro(m),
    validate: (m) => validateMacro(m, othersRef.current),
    onStart: () => { if (mounted.current) setSave({ kind: "saving" }); },
    onSaved: (saved, wasNew) => {
      const open = isOpen();
      if (open) {
        // Keep the id (and date) the engine gave it.
        if (wasNew) setDraft((d) => ({ ...d, id: saved.id, createdAtMs: saved.createdAtMs }));
        setSavedEnabled(saved.enabled);
        refreshRef.current(false);
      }
      onSavedRef.current(saved, wasNew, open);
    },
    onFailed: (e, sent) => {
      const issues = errorIssues(e);
      if (isOpen()) {
        setSave(issues.length ? { kind: "invalid", issues } : { kind: "error", message: errorMessage(e) });
      } else {
        reportMacroSaveFailure(`Your last change to “${sent.name || "the new macro"}” wasn't saved: ${issues[0]?.message ?? errorMessage(e)}`);
      }
    },
  }, AUTOSAVE_MS));

  /** Shows whether the content is saved, and saves valid changes after a pause (`restart`: wait again from now). */
  const refresh = (restart: boolean) => {
    const cur = fullRef.current;
    if (saver.isSaved(cur)) { saver.cancel(); setSave({ kind: "saved" }); return; }
    const local = validateMacro(saver.normalize(cur), othersRef.current);
    if (local.length > 0) { saver.cancel(); setSave({ kind: "invalid", issues: local }); return; }
    setSave({ kind: "pending" });
    if (restart || !saver.scheduled) saver.schedule();
  };
  refreshRef.current = refresh;

  const patch = (p: Partial<Macro>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => { refresh(true); }, [draft, steps.value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page (any way: links, sidebar, Back/Forward, Ctrl+K, closing
  // the window) saves a change still waiting for the pause. App calls `leave`
  // as it starts navigating, so the latest change is saved before the next page
  // loads and nothing finishing later navigates; unmounting is the safety net.
  useEffect(() => {
    mounted.current = true;
    leaving.current = false;
    const unregister = setOpenMacroEditor({
      flush: () => saver.flush(),
      leave: () => { leaving.current = true; return saver.flush(); },
      discard: () => saver.close(),
    });
    const onHide = () => { void saver.flush(); };
    window.addEventListener("pagehide", onHide);
    return () => {
      mounted.current = false;
      unregister();
      window.removeEventListener("pagehide", onHide);
      void saver.flush();
    };
  }, [saver]);

  /** Saves the latest change, then (if it saved and the editor is still open, not being left) does `then`. */
  const afterSave = (then: (m: Macro) => void) => async () => {
    const r = await saver.flush();
    if (r !== "failed" && isOpen()) then(fullRef.current);
  };

  const issues = save.kind === "invalid" ? save.issues : [];
  const saved = !!draft.id;
  const pinned = meta.pinned.includes(draft.id);
  const usage = usageOf(full, meta, profiles, activeProfileId);

  return (
    <PickerProvider>
    <section className="ms-editor" aria-label={`Macro ${draft.name || "(new)"}`}>
      <header className="ms-editor-head">
        <div className="ms-title">
          <input className="title-input" value={draft.name} maxLength={LIMITS.maxNameLength} placeholder="Name your macro"
            aria-label="Macro name" onChange={(e) => patch({ name: e.target.value })} />
          <input className="text-input subtle" value={draft.description} maxLength={LIMITS.maxDescriptionLength}
            placeholder="Add a description (optional)" aria-label="Description"
            onChange={(e) => patch({ description: e.target.value })} />
          <Issues issues={issues} field="name" />
        </div>
        <div className="ms-head-side">
          <Switch checked={draft.enabled} onChange={(enabled) => patch({ enabled })}
            label={draft.enabled ? "On in this profile" : "Off in this profile"} tip="Switch this macro on or off in the active profile" />
          <SaveIndicator state={save} isNew={!saved} />
        </div>
      </header>

      <div className="ms-toolbar">
        <span className="ms-usage" title="Its button, and the profiles it is switched on in">
          {usageText(usage)}{usage.activeNow ? " · active now" : ""}
        </span>
        {draft.trigger && (
          <button className="map-link" onClick={afterSave((m) => { if (m.trigger) go("mapping", m.trigger); })} title="Show this button in Mapping">Show in Mapping</button>
        )}
        <span className="ms-toolbar-actions">
          <button className={`pm-pin-btn${pinned ? " on" : ""}`} disabled={!saved} aria-pressed={pinned}
            onClick={() => onPin(full, !pinned)}><Icon name="star" size={14} filled={pinned} /> {pinned ? "Pinned" : "Pin"}</button>
          <button className="btn-ghost small" disabled={!saved} onClick={afterSave(onDuplicate)} title="A copy without a button assigned">Duplicate</button>
          <button className="btn-ghost small" disabled={!saved} onClick={afterSave(onExport)} title="Save this macro to a file">Export</button>
          <button className="btn-ghost small danger" disabled={!saved} onClick={() => onDelete(full)}>Delete</button>
        </span>
      </div>

      <div className="ms-editor-grid">
        <div className="ms-editor-main">
          <div className="card ms-sequence">
            <h2>Sequence</h2>
            <SequenceEditor history={steps} initialSource={initial.steps.length ? "manual" : "record"} library={others}
              mode={full.mode} repeatDelayMs={full.repeatDelayMs} repeatCount={full.repeatCount ?? 1} />
            <Issues issues={issues} field="steps" />
          </div>
          <div className="card">
            <h2>Button and playback</h2>
            <AssignPanel draft={full} others={others} onChange={patch} issues={issues} />
            <Issues issues={issues} field="repeatCount" />
          </div>
          <MacroTestPanel macro={full} savedEnabled={saved && savedEnabled && save.kind === "saved"} />
        </div>
        <aside className="ms-editor-side"><ButtonPicker /></aside>
      </div>
    </section>
    </PickerProvider>
  );
}

function SaveIndicator({ state, isNew }: { state: SaveState; isNew: boolean }) {
  switch (state.kind) {
    case "saved": return <span className="save-state ok" role="status"><Icon name="check" size={14} /> Saved</span>;
    case "pending":
    case "saving": return <span className="save-state" role="status">{isNew ? "Not saved yet" : "Saving…"}</span>;
    case "invalid": return <span className="save-state warn" role="status" title={state.issues.map((i) => i.message).join("\n")}>Not saved: {state.issues[0]?.message}</span>;
    case "error": return <span className="save-state err" role="status">Not saved: {state.message}</span>;
  }
}
