import { DELAY_PRESETS, HOLD_PRESETS, LIMITS, buttonNames } from "../../lib/macros";
import type { MacroButton, MacroStep } from "../../types/engine";
import { ButtonPad } from "./ButtonPad";
import { Advanced, DurationPicker, MsInput } from "./common";

interface Props {
  step: MacroStep;
  index: number;
  count: number;
  onChange: (s: MacroStep) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Editor for the selected action block. */
export function StepInspector({ step, index, count, onChange, onMove, onDuplicate, onDelete }: Props) {
  const toggle = (b: MacroButton) => {
    const has = step.buttons.includes(b);
    if (has && step.buttons.length === 1) return; // an action always has a button
    onChange({ ...step, buttons: has ? step.buttons.filter((x) => x !== b) : [...step.buttons, b] });
  };

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <h3>Action {index + 1}</h3>
          <p className="muted small">Press <b>{buttonNames(step.buttons)}</b>, hold for {step.holdMs} ms, release, then wait {step.delayAfterMs} ms.</p>
        </div>
        <div className="row gap-sm">
          <button className="btn-icon" onClick={() => onMove(-1)} disabled={index === 0}
            data-tip="Move earlier" aria-label="Move earlier">←</button>
          <button className="btn-icon" onClick={() => onMove(1)} disabled={index === count - 1}
            data-tip="Move later" aria-label="Move later">→</button>
          <button className="btn-ghost" onClick={onDuplicate} data-tip="Insert a copy right after this action">Duplicate</button>
          <button className="btn-ghost danger" onClick={onDelete} data-tip="Remove this action (you can undo)">Delete</button>
        </div>
      </div>

      <div className="inspector-grid">
        <div>
          <span className="field-label" data-tip="Click buttons to add or remove them. Several buttons are pressed together.">
            Buttons pressed together
          </span>
          <ButtonPad selected={step.buttons} onPick={toggle} label="Buttons for this action" />
        </div>
        <div className="inspector-timing">
          <DurationPicker label="Press time" tip="How long the button is held down"
            value={step.holdMs} presets={HOLD_PRESETS} min={LIMITS.minHoldMs} max={LIMITS.maxHoldMs}
            onChange={(holdMs) => onChange({ ...step, holdMs })} />
          <DurationPicker label="Wait after release" tip="Pause before the next action starts"
            value={step.delayAfterMs} presets={DELAY_PRESETS} min={0} max={LIMITS.maxDelayMs}
            onChange={(delayAfterMs) => onChange({ ...step, delayAfterMs })} />
          <Advanced title="Exact timing">
            <MsInput label="Press time" value={step.holdMs} min={LIMITS.minHoldMs} max={LIMITS.maxHoldMs}
              onChange={(holdMs) => onChange({ ...step, holdMs })} />
            <MsInput label="Wait after" value={step.delayAfterMs} min={0} max={LIMITS.maxDelayMs}
              onChange={(delayAfterMs) => onChange({ ...step, delayAfterMs })} />
            <p className="muted small">Press time {LIMITS.minHoldMs}–{LIMITS.maxHoldMs} ms · wait 0–{LIMITS.maxDelayMs} ms.
              Timing follows controller reports (about every 4 ms over USB).</p>
          </Advanced>
        </div>
      </div>
    </div>
  );
}
