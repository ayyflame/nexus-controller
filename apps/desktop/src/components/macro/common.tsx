import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ValidationIssue } from "../../types/engine";
import { parseMs } from "../../lib/macroTiming";

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
        <span className="chev" aria-hidden="true">›</span> {title}
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

/** Choice chips plus a slider, for durations. */
export function DurationPicker({ label, value, onChange, presets, min, max, tip }: {
  label: string; value: number; onChange: (ms: number) => void;
  presets: Array<{ label: string; ms: number; hint: string }>; min: number; max: number; tip: string;
}) {
  const sliderMax = Math.min(max, 2000);
  return (
    <div className="duration">
      <div className="duration-head">
        <span className="field-label" data-tip={tip}>{label}</span>
        <span className="duration-value mono">{value} ms</span>
      </div>
      <div className="preset-row">
        {presets.map((p) => (
          <button key={p.label} type="button" data-tip={p.hint}
            className={`preset${value === p.ms ? " selected" : ""}`} onClick={() => onChange(p.ms)}>
            {p.label}
          </button>
        ))}
      </div>
      <input type="range" min={min} max={sliderMax} step={10} value={Math.min(value, sliderMax)}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="slider" />
    </div>
  );
}

export function MsInput({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (ms: number) => void; min: number; max: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    // Empty or invalid reverts; out-of-range is limited and the field shows
    // the stored value. Unchanged values don't create an undo step.
    const n = parseMs(text, min, max);
    if (n === null) { setText(String(value)); return; }
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <label className="ms-input">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={1} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()} />
      <span className="muted small">ms</span>
    </label>
  );
}
