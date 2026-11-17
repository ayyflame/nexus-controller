import { LIMITS } from "../../lib/macros";
import { commonValue, scaleTiming, setTiming } from "../../lib/macroTiming";
import type { MacroStep } from "../../types/engine";
import { useMsField } from "./common";

const SCALES = [
  { label: "2× faster", percent: 50 },
  { label: "Faster", percent: 75 },
  { label: "Slower", percent: 125 },
  { label: "2× slower", percent: 200 },
];

/**
 * A typed field for several actions at once. Changes nothing until you type
 * a value and press Enter, Set, or leave the field: tabbing through it never
 * alters the selected actions. Shows "varies" when the selected actions differ.
 */
function BulkField({ label, current, unit, min, max, onApply, apply = "Set" }: {
  label: string; current: number | null; unit: string; min: number; max: number;
  onApply: (n: number) => void; apply?: string;
}) {
  const f = useMsField({ value: current, min, max, unit, onCommit: onApply });
  return (
    <span className="ms-field">
      <label className="ms-input">
        <span>{label}</span>
        <input {...f.input} className="text-input mono" placeholder={current === null ? "varies" : undefined} aria-label={`${label} (${unit})`} />
        <span className="muted small">{unit}</span>
        {/* Keeps focus in the field so Set applies exactly once. */}
        <button type="button" className="btn-ghost small" onMouseDown={(e) => e.preventDefault()}
          onClick={f.apply}>{apply}</button>
      </label>
      {f.error && <span className="ms-error small" role="alert">{f.error}</span>}
    </span>
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
            Nothing changes until you press Enter or Set, or leave a field you typed in; Ctrl+Z undoes.
          </p>
        </div>
      </div>
      <div className="inspector-timing bulk-timing">
        <BulkField label="Press time" current={hold} unit="ms" min={LIMITS.minHoldMs} max={LIMITS.maxHoldMs} onApply={(holdMs) => onChange(setTiming(steps, ids, { holdMs }))} />
        <BulkField label="Wait after" current={wait} unit="ms" min={0} max={LIMITS.maxDelayMs} onApply={(delayAfterMs) => onChange(setTiming(steps, ids, { delayAfterMs }))} />
        <div>
          <span className="field-label" data-tip="Multiplies press times and waits, keeping the rhythm of a recording">Speed</span>
          <div className="preset-row">
            {SCALES.map((s) => (
              <button key={s.percent} className="chip" onClick={() => onChange(scaleTiming(steps, ids, s.percent))}>{s.label}</button>
            ))}
          </div>
          <BulkField label="Scale" current={100} unit="%" min={1} max={1000} apply="Apply" onApply={(p) => onChange(scaleTiming(steps, ids, p))} />
        </div>
        <p className="muted small">Press time {LIMITS.minHoldMs}–{LIMITS.maxHoldMs} ms · wait 0–{LIMITS.maxDelayMs} ms · scale 1–1000 %. A value outside these limits is not applied.</p>
      </div>
    </div>
  );
}
