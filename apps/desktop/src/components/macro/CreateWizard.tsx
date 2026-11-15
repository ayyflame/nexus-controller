import { useState } from "react";
import { useHistory } from "../../hooks/useHistory";
import { engineApi, errorIssues, errorMessage } from "../../lib/engine";
import { LIMITS, newMacro, validateMacro } from "../../lib/macros";
import type { Macro, MacroStep, ValidationIssue } from "../../types/engine";
import { AssignPanel } from "./AssignPanel";
import { ConfirmDialog, Issues } from "./common";
import { SequenceEditor } from "./SequenceEditor";

const STEPS = ["Name your macro", "Create the sequence", "Assign your macro"] as const;
const STEP_OF_FIELD: Record<string, number> = { name: 0, description: 0, steps: 1, trigger: 2, repeatDelayMs: 2 };

export function CreateWizard({ others, onDone, onCancel }: {
  others: Macro[];
  onDone: (saved: Macro) => void;
  onCancel: () => void;
}) {
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Macro>(newMacro);
  const steps = useHistory<MacroStep[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const full: Macro = { ...draft, steps: steps.value };
  const patch = (p: Partial<Macro>) => setDraft((d) => ({ ...d, ...p }));
  const pageIssues = (n: number) =>
    validateMacro(full, others).filter((i) => (STEP_OF_FIELD[i.field] ?? 2) === n);

  const next = () => {
    const found = pageIssues(page);
    setIssues(found);
    if (found.length === 0) setPage(page + 1);
  };

  const save = async () => {
    const found = validateMacro(full, others);
    if (found.length > 0) {
      setIssues(found);
      setPage(Math.min(...found.map((i) => STEP_OF_FIELD[i.field] ?? 2)));
      return;
    }
    setSaving(true); setError(null);
    try {
      onDone(await engineApi.saveMacro(full));
    } catch (e) {
      const server = errorIssues(e);
      setIssues(server);
      setError(server.length ? null : errorMessage(e));
      if (server.length) setPage(Math.min(...server.map((i) => STEP_OF_FIELD[i.field] ?? 2)));
    } finally {
      setSaving(false);
    }
  };

  const dirty = draft.name.trim() !== "" || steps.value.length > 0;

  return (
    <div className="page wizard">
      <header className="page-header">
        <div>
          <button className="btn-back" onClick={() => (dirty ? setConfirmCancel(true) : onCancel())}>← All macros</button>
          <h1>Create Macro</h1>
        </div>
      </header>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i === page ? "current" : i < page ? "done" : ""} aria-current={i === page ? "step" : undefined}>
            <button type="button" disabled={i > page} onClick={() => { setIssues([]); setPage(i); }}>
              <span className="step-num">{i < page ? "✓" : i + 1}</span>
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="card wizard-body" key={page}>
        {page === 0 && (
          <div className="name-step">
            <label className="field">
              <span className="field-label">Name</span>
              <input autoFocus className="text-input big" value={draft.name} maxLength={LIMITS.maxNameLength}
                placeholder="e.g. Quick Reload" onChange={(e) => patch({ name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && next()} />
              <Issues issues={issues} field="name" />
            </label>
            <label className="field">
              <span className="field-label">Description <span className="muted">(optional)</span></span>
              <textarea className="text-input" rows={3} value={draft.description} maxLength={LIMITS.maxDescriptionLength}
                placeholder="What does this macro do?" onChange={(e) => patch({ description: e.target.value })} />
            </label>
          </div>
        )}

        {page === 1 && (
          <>
            <SequenceEditor history={steps} />
            <Issues issues={issues} field="steps" />
          </>
        )}

        {page === 2 && (
          <>
            <AssignPanel draft={full} others={others} onChange={patch} issues={issues} />
            {!draft.trigger && (
              <div className="notice dev small">You can save without choosing a button, but the macro won't run until you assign one.</div>
            )}
          </>
        )}
        {error && <div className="notice error">{error}</div>}
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={() => (page === 0 ? (dirty ? setConfirmCancel(true) : onCancel()) : (setIssues([]), setPage(page - 1)))}>
          {page === 0 ? "Cancel" : "← Back"}
        </button>
        {page < 2 ? (
          <button className="btn-primary" onClick={next}>Next →</button>
        ) : (
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save Macro"}
          </button>
        )}
      </div>

      {confirmCancel && (
        <ConfirmDialog title="Discard this macro?" body="Your new macro hasn't been saved yet."
          confirmLabel="Discard" danger onConfirm={onCancel} onCancel={() => setConfirmCancel(false)} />
      )}
    </div>
  );
}
