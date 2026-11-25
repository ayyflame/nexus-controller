import { useEffect, useRef, useState } from "react";
import { useHistory } from "../../hooks/useHistory";
import { engineApi, errorIssues, errorMessage } from "../../lib/engine";
import { LIMITS, MODES, formatMs, validateMacro } from "../../lib/macros";
import { playTime, usageOf, usageText } from "../../lib/macroStudio";
import type { Macro, MacroMeta, MacroStep, Profile, ValidationIssue } from "../../types/engine";
import { AssignPanel } from "./AssignPanel";
import { Issues, Switch } from "./common";
import { MacroTestPanel } from "./MacroTestPanel";
import { SequenceEditor } from "./SequenceEditor";

type SaveState = { kind: "saved" } | { kind: "pending" } | { kind: "saving" } | { kind: "invalid"; issues: ValidationIssue[] } | { kind: "error"; message: string };

const AUTOSAVE_MS = 700;
const go = (page: string, tab?: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page, tab } }));

/**
 * The selected macro, edited in place in the Macro Studio workspace. Valid
 * changes save automatically (a new macro is created on its first valid
 * save); editing never changes its button assignment unless you do.
 */
export function MacroEditor({ initial, others, profiles, meta, activeProfileId, onSaved, onDuplicate, onExport, onDelete, onPin }: {
  initial: Macro;
  others: Macro[];
  profiles: Profile[];
  meta: MacroMeta;
  activeProfileId: number | null;
  onSaved: (m: Macro, wasNew: boolean) => void;
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
  // Auto-save only when the content differs from what was last saved.
  const lastSaved = useRef(initial.id ? JSON.stringify(initial) : "");
  const fullRef = useRef(full);
  fullRef.current = full;

  const patch = (p: Partial<Macro>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => {
    if (JSON.stringify(fullRef.current) === lastSaved.current) { setSave({ kind: "saved" }); return; }
    const local = validateMacro(fullRef.current, others);
    if (local.length > 0) { setSave({ kind: "invalid", issues: local }); return; }
    setSave({ kind: "pending" });
    const timer = setTimeout(async () => {
      setSave({ kind: "saving" });
      try {
        const sent = fullRef.current;
        const saved = await engineApi.saveMacro(sent);
        const wasNew = !sent.id;
        // Keep the id (and dates) the engine gave it, so the next save updates this macro.
        const stored = { ...sent, id: saved.id, createdAtMs: saved.createdAtMs, updatedAtMs: sent.updatedAtMs };
        lastSaved.current = JSON.stringify(stored);
        if (wasNew) setDraft((d) => ({ ...d, id: saved.id, createdAtMs: saved.createdAtMs }));
        setSavedEnabled(saved.enabled);
        onSaved(saved, wasNew);
        setSave({ kind: "saved" });
      } catch (e) {
        const issues = errorIssues(e);
        setSave(issues.length ? { kind: "invalid", issues } : { kind: "error", message: errorMessage(e) });
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, steps.value]);

  const issues = save.kind === "invalid" ? save.issues : [];
  const saved = !!draft.id;
  const pinned = meta.pinned.includes(draft.id);
  const usage = usageOf(full, meta, profiles, activeProfileId);

  return (
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
          <button className="map-link" onClick={() => go("mapping", draft.trigger!)} title="Show this button in Mapping">Show in Mapping</button>
        )}
        <span className="ms-meta muted small">{MODES[draft.mode].title} · {steps.value.length} action{steps.value.length === 1 ? "" : "s"} · {formatMs(playTime(full))}{draft.mode === "once" ? "" : " per cycle"}</span>
        <span className="ms-toolbar-actions">
          <button className={`pm-pin-btn${pinned ? " on" : ""}`} disabled={!saved} aria-pressed={pinned}
            onClick={() => onPin(full, !pinned)}>{pinned ? "★ Pinned" : "☆ Pin"}</button>
          <button className="btn-ghost small" disabled={!saved} onClick={() => onDuplicate(full)} title="A copy without a button assigned">Duplicate</button>
          <button className="btn-ghost small" disabled={!saved} onClick={() => onExport(full)} title="Save this macro to a file">Export</button>
          <button className="btn-ghost small danger" disabled={!saved} onClick={() => onDelete(full)}>Delete</button>
        </span>
      </div>

      <div className="ms-editor-grid">
        <div className="card ms-sequence">
          <h2>Sequence</h2>
          <SequenceEditor history={steps} initialSource={initial.steps.length ? "manual" : "record"} library={others}
            mode={full.mode} repeatDelayMs={full.repeatDelayMs} repeatCount={full.repeatCount ?? 1} />
          <Issues issues={issues} field="steps" />
        </div>
        <div className="ms-side">
          <div className="card">
            <h2>Button and playback</h2>
            <AssignPanel draft={full} others={others} onChange={patch} issues={issues} />
            <Issues issues={issues} field="repeatCount" />
          </div>
          <MacroTestPanel macro={full} savedEnabled={saved && savedEnabled && save.kind === "saved"} />
        </div>
      </div>
    </section>
  );
}

function SaveIndicator({ state, isNew }: { state: SaveState; isNew: boolean }) {
  switch (state.kind) {
    case "saved": return <span className="save-state ok" role="status">✓ Saved</span>;
    case "pending":
    case "saving": return <span className="save-state" role="status">{isNew ? "Not saved yet" : "Saving…"}</span>;
    case "invalid": return <span className="save-state warn" role="status" title={state.issues.map((i) => i.message).join("\n")}>Not saved: {state.issues[0]?.message}</span>;
    case "error": return <span className="save-state err" role="status">Not saved: {state.message}</span>;
  }
}
