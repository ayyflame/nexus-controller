import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon } from "../Icons";
import type { ValidationIssue } from "../../types/engine";
import { msFieldCommit } from "../../lib/macroTiming";

export function Switch({ checked, onChange, label, disabled, tip }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; tip?: string;
}) {
  return (
    <label className={`switch${disabled ? " disabled" : ""}`} data-tip={tip}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch-track"><span className="switch-thumb" /></span>
      <span className="switch-label">{label}</span>
    </label>
  );
}

/** Collapsible section for options beginners don't need. */
export function Advanced({ children, title = "Advanced settings" }: { children: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`advanced${open ? " open" : ""}`}>
      <button type="button" className="advanced-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev" aria-hidden="true"><Icon name="chevronRight" size={14} /></span> {title}
      </button>
      {open && <div className="advanced-body">{children}</div>}
    </div>
  );
}

export function Issues({ issues, field }: { issues: ValidationIssue[]; field?: string }) {
  const list = field ? issues.filter((i) => i.field === field) : issues;
  if (list.length === 0) return null;
  return (
    <ul className="issues" role="alert">
      {list.map((i, n) => <li key={n}>{i.message}</li>)}
    </ul>
  );
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}>
        <h2 id="modal-title">{title}</h2>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Choice chips plus a typed millisecond field, for durations. */
export function DurationPicker({ label, value, onChange, presets, min, max, tip, note }: {
  label: string; value: number; onChange: (ms: number) => void;
  presets: Array<{ label: string; ms: number; hint: string }>; min: number; max: number; tip: string;
  note?: ReactNode;
}) {
  return (
    <div className="duration">
      <div className="duration-head">
        <span className="field-label" data-tip={tip}>{label}</span>
        <MsInput label={label} value={value} min={min} max={max} onChange={onChange} hideLabel />
      </div>
      <div className="preset-row">
        {presets.map((p) => (
          <button key={p.label} type="button" data-tip={p.hint}
            className={`preset${value === p.ms ? " selected" : ""}`} onClick={() => onChange(p.ms)}>
            {p.label}
          </button>
        ))}
      </div>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

/**
 * Typed millisecond field state. The stored value is shown again only while
 * you are not editing, so nothing changes under your cursor; what you type
 * is checked and stored on Enter or when you leave the field. Escape puts
 * the stored value back.
 */
export function useMsField({ value, min, max, unit = "ms", onCommit }: {
  value: number | null; min: number; max: number; unit?: string; onCommit: (n: number) => void;
}) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  const edited = useRef(false);
  useEffect(() => { if (!editing.current) setText(shown); }, [shown]);
  const finish = (how: "enter" | "leave") => {
    const r = msFieldCommit(text, value, edited.current, min, max, how, unit);
    setText(r.text);
    setError(r.error);
    if (r.error === null || how === "leave") edited.current = false;
    if (r.store !== null) onCommit(r.store);
  };
  return {
    error,
    /** Same as pressing Enter in the field (for a Set button). */
    apply: () => finish("enter"),
    input: {
      type: "text" as const,
      inputMode: "numeric" as const,
      autoComplete: "off",
      spellCheck: false,
      value: text,
      "aria-invalid": error !== null,
      onFocus: (e: FocusEvent<HTMLInputElement>) => { editing.current = true; e.currentTarget.select(); },
      onChange: (e: ChangeEvent<HTMLInputElement>) => { edited.current = true; setError(null); setText(e.target.value); },
      onBlur: () => { editing.current = false; finish("leave"); },
      onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); finish("enter"); }
        else if (e.key === "Escape") { edited.current = false; setError(null); setText(shown); }
      },
    },
  };
}

/** A millisecond value you type: commits on Enter or when leaving the field. */
export function MsInput({ label, value, onChange, min, max, hideLabel }: {
  label: string; value: number; onChange: (ms: number) => void; min: number; max: number; hideLabel?: boolean;
}) {
  const f = useMsField({ value, min, max, onCommit: onChange });
  return (
    <span className="ms-field">
      <label className="ms-input">
        {!hideLabel && <span>{label}</span>}
        <input {...f.input} aria-label={`${label} (milliseconds)`} />
        <span className="muted small">ms</span>
      </label>
      {f.error && <span className="ms-error small" role="alert">{f.error}</span>}
    </span>
  );
}
