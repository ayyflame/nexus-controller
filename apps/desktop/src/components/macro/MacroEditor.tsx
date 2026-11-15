import { useEffect, useRef, useState } from "react";
import { useHistory } from "../../hooks/useHistory";
import { engineApi, errorIssues, errorMessage } from "../../lib/engine";
import { LIMITS, validateMacro } from "../../lib/macros";
import type { Macro, MacroStep, ValidationIssue } from "../../types/engine";
import { AssignPanel } from "./AssignPanel";
import { Issues, Switch } from "./common";
import { LiveTest } from "./LiveTest";
import { SequenceEditor } from "./SequenceEditor";

type SaveState = { kind: "saved" } | { kind: "pending" } | { kind: "saving" } | { kind: "invalid"; issues: ValidationIssue[] } | { kind: "error"; message: string };

const AUTOSAVE_MS = 700;

/** Editing an existing macro. Valid changes save automatically. */
export function MacroEditor({ initial, others, allMacros, onSaved, onBack }: {
  initial: Macro;
  others: Macro[];
  allMacros: Macro[];
  onSaved: (m: Macro) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<Macro>(initial);
  const steps = useHistory<MacroStep[]>(initial.steps);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const full: Macro = { ...draft, steps: steps.value };
  // Auto-save only when the content differs from what was last saved.
  const lastSaved = useRef(JSON.stringify(initial));
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
        lastSaved.current = JSON.stringify(sent);
        onSaved(saved);
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

  return (
    <div className="page editor">
      <header className="page-header">
        <div className="editor-title">
          <button className="btn-back" onClick={onBack}>← All macros</button>
          <input className="title-input" value={draft.name} maxLength={LIMITS.maxNameLength}
            aria-label="Macro name" onChange={(e) => patch({ name: e.target.value })} />
          <input className="text-input subtle" value={draft.description} maxLength={LIMITS.maxDescriptionLength}
            placeholder="Add a description (optional)" aria-label="Description"
            onChange={(e) => patch({ description: e.target.value })} />
          <Issues issues={issues} field="name" />
        </div>
        <div className="editor-meta">
          <Switch checked={draft.enabled} onChange={(enabled) => patch({ enabled })}
            label={draft.enabled ? "Enabled" : "Disabled"} tip="Turn this macro on or off" />
          <SaveIndicator state={save} />
        </div>
      </header>

      <div className="editor-grid">
        <div className="card">
          <h2>Sequence</h2>
          <SequenceEditor history={steps} initialSource="record" />
          <Issues issues={issues} field="steps" />
        </div>
        <div className="editor-side">
          <div className="card">
            <h2>Assignment</h2>
            <AssignPanel draft={full} others={others} onChange={patch} issues={issues} />
          </div>
          <LiveTest macros={allMacros} focus={full} />
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  switch (state.kind) {
    case "saved": return <span className="save-state ok" role="status">✓ All changes saved</span>;
    case "pending":
    case "saving": return <span className="save-state" role="status">Saving…</span>;
    case "invalid": return <span className="save-state warn" role="status" title={state.issues.map((i) => i.message).join("\n")}>Not saved: {state.issues[0]?.message}</span>;
    case "error": return <span className="save-state err" role="status">Not saved: {state.message}</span>;
  }
}
