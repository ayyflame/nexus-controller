import { useEffect, useState } from "react";
import { LIMITS } from "../../lib/macros";
import { commonValue, scaleTiming, setTiming } from "../../lib/macroTiming";
import type { MacroStep } from "../../types/engine";

const SCALES = [
  { label: "2× faster", percent: 50 },
  { label: "Faster", percent: 75 },
  { label: "Slower", percent: 125 },
  { label: "2× slower", percent: 200 },
];

/**
 * A number field that changes nothing until you type a value and press
 * Enter or "Set": tabbing through it never alters the selected actions.
 * Shows "varies" when the selected actions differ.
 */
function BulkField({ label, current, unit, onApply, apply = "Set" }: {
  label: string; current: number | null; unit: string; onApply: (n: number) => void; apply?: string;
}) {
  const [text, setText] = useState(current === null ? "" : String(current));
  useEffect(() => setText(current === null ? "" : String(current)), [current]);
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n);
  const changed = valid && n !== current;
  const commit = () => { if (changed) onApply(n); };
  return (
    <label className="ms-input">
      <span>{label}</span>
      <input className="text-input mono" inputMode="numeric" value={text} placeholder={current === null ? "varies" : undefined}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} aria-label={label} />
      <span className="muted small">{unit}</span>
      <button type="button" className="btn-ghost small" disabled={!changed} onClick={commit}>{apply}</button>
    </label>
  );
}

/** Changes the timing of several selected actions at once (undo with Ctrl+Z). */
export function BulkTiming({ steps, ids, onChange }: {
  steps: MacroStep[]; ids: string[]; onChange: (next: MacroStep[]) => void;
}) {
  const hold = commonValue(steps, ids, "holdMs");
  const wait = commonValue(steps, ids, "delayAfterMs");
  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <h3>{ids.length} actions selected</h3>
          <p className="muted small">
            Change their timing together. Press time {hold === null ? "varies" : `${hold} ms`} · wait after {wait === null ? "varies" : `${wait} ms`}.
            Nothing changes until you press Enter or Set; Ctrl+Z undoes.
          </p>
        </div>
      </div>
      <div className="inspector-timing bulk-timing">
        <BulkField label="Press time" current={hold} unit="ms" onApply={(holdMs) => onChange(setTiming(steps, ids, { holdMs }))} />
        <BulkField label="Wait after" current={wait} unit="ms" onApply={(delayAfterMs) => onChange(setTiming(steps, ids, { delayAfterMs }))} />
        <div>
          <span className="field-label" data-tip="Multiplies press times and waits, keeping the rhythm of a recording">Speed</span>
          <div className="preset-row">
            {SCALES.map((s) => (
              <button key={s.percent} className="chip" onClick={() => onChange(scaleTiming(steps, ids, s.percent))}>{s.label}</button>
            ))}
          </div>
          <BulkField label="Scale" current={100} unit="%" apply="Apply" onApply={(p) => onChange(scaleTiming(steps, ids, p))} />
        </div>
        <p className="muted small">Press time {LIMITS.minHoldMs}–{LIMITS.maxHoldMs} ms · wait 0–{LIMITS.maxDelayMs} ms · scale 1–1000 %. Values outside are limited automatically.</p>
      </div>
    </div>
  );
}
