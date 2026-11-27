import { useEffect, useState } from "react";
import { Icon } from "../Icons";
import { BUTTONS, DELAY_PRESETS, HOLD_PRESETS, LIMITS, buttonNames, kindOf } from "../../lib/macros";
import { describeStep } from "../../lib/macroStudio";
import type { MacroButton, MacroStep, StepKind } from "../../types/engine";
import { ButtonChip } from "./ButtonChip";
import { usePick } from "./ButtonPicker";
import { Advanced, DurationPicker, MsInput } from "./common";

interface Props {
  step: MacroStep;
  index: number;
  count: number;
  /** The whole sequence (for the plain-language description). */
  steps: MacroStep[];
  /** Buttons held by earlier hold actions when this action starts. */
  held: MacroButton[];
  onChange: (s: MacroStep) => void;
  /** Pause before this action (the previous action's wait) and when it starts. */
  waitBefore: number;
  startsAt: number;
  onWaitBefore: (ms: number) => void;
  /** The wait after this action is too short before the same button again. */
  gapWarning?: boolean;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const KINDS: Array<{ id: StepKind; label: string; tip: string }> = [
  { id: "tap", label: "Press", tip: "Press, hold for the press time, release" },
  { id: "hold", label: "Press & keep held", tip: "Press and keep held while the next actions run, until a Release action (or the end)" },
  { id: "release", label: "Release", tip: "Let go of buttons an earlier action keeps held" },
];

/** Editor for the selected action. */
export function StepInspector({ step, index, count, steps, held, onChange, waitBefore, startsAt, onWaitBefore, gapWarning, onMove, onDuplicate, onDelete }: Props) {
  const kind = kindOf(step);
  const toggle = (b: MacroButton) => {
    const has = step.buttons.includes(b);
    if (has && step.buttons.length === 1) return; // an action always has a button
    onChange({ ...step, buttons: has ? step.buttons.filter((x) => x !== b) : [...step.buttons, b] });
  };
  const setKind = (k: StepKind) => {
    if (k === kind) return;
    // A release needs held buttons: default to those; press time only matters for a tap.
    const kept = held.filter((b) => step.buttons.includes(b));
    const buttons = k === "release" ? (kept.length ? kept : held) : step.buttons;
    const next: MacroStep = { ...step, holdMs: k === "tap" ? (step.holdMs || 100) : 0, buttons };
    if (k === "tap") delete next.kind; else next.kind = k;
    onChange(next);
  };
  // A release can only let go of held buttons; a press can't use a button that is held.
  const blocked: Partial<Record<MacroButton, string>> = {};
  for (const b of Object.keys(BUTTONS) as MacroButton[]) {
    if (kind === "release" && !held.includes(b)) blocked[b] = "not held at this point";
    if (kind !== "release" && held.includes(b) && !step.buttons.includes(b)) blocked[b] = "held by an earlier action: release it first";
    if (step.buttons.length === 1 && step.buttons[0] === b) blocked[b] = "an action needs at least one button";
  }
  // Changing the buttons uses the editor's controller until Done (or another action is chosen).
  const [changing, setChanging] = useState(false);
  useEffect(() => { setChanging(false); }, [step.id]);
  usePick("step", changing ? {
    priority: 2, kind: "toggle", title: `Click buttons to add or remove them in action ${index + 1}`,
    selected: step.buttons, blocked, onPick: toggle, onDone: () => setChanging(false),
  } : null);

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <h3>Action {index + 1}</h3>
          <p className="muted small">
            <b>{describeStep(steps, index)}.</b> Starts at {startsAt} ms.
            {held.length > 0 && kind !== "release" && <> Held: {buttonNames(held)}.</>}
          </p>
        </div>
        <div className="row gap-sm">
          <button className="btn-icon" onClick={() => onMove(-1)} disabled={index === 0}
            data-tip="Move earlier" aria-label="Move earlier"><Icon name="arrowLeft" size={16} /></button>
          <button className="btn-icon" onClick={() => onMove(1)} disabled={index === count - 1}
            data-tip="Move later" aria-label="Move later"><Icon name="arrowRight" size={16} /></button>
          <button className="btn-ghost" onClick={onDuplicate} data-tip="Insert a copy right after this action">Duplicate</button>
          <button className="btn-ghost danger" onClick={onDelete} data-tip="Remove this action (you can undo)">Delete</button>
        </div>
      </div>

      <div className="segmented small step-kind" role="radiogroup" aria-label="What this action does">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={kind === k.id ? "selected" : ""}
            data-tip={k.tip} disabled={k.id === "release" && held.length === 0 && kind !== "release"} onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
      </div>

      <div className="inspector-grid">
        <div>
          <span className="field-label" data-tip="Several buttons act together">
            {kind === "release" ? "Buttons to release" : "Buttons pressed together"}
          </span>
          <div className="step-buttons">
            {step.buttons.map((b) => <ButtonChip key={b} button={b} size="md" active />)}
            <button type="button" className={changing ? "btn-primary small" : "btn-ghost small"} aria-pressed={changing}
              onClick={() => setChanging((c) => !c)}>{changing ? "Done" : "Change on controller"}</button>
          </div>
        </div>
        <div className="inspector-timing">
          {kind === "tap" && (
            <DurationPicker label="Press time" tip="How long the button is held down"
              value={step.holdMs} presets={HOLD_PRESETS} min={LIMITS.minHoldMs} max={LIMITS.maxHoldMs}
              onChange={(holdMs) => onChange({ ...step, holdMs })} />
          )}
          {kind === "hold" && <p className="muted small">Held until a Release (or the end).</p>}
          {gapWarning && (
            <div className="notice warn small">Same button next: wait at least {LIMITS.minReleaseGapMs} ms, or a game may see one long press.</div>
          )}
          <DurationPicker label={kind === "tap" ? "Wait after release" : "Wait after"} tip="Pause before the next action starts"
            value={step.delayAfterMs} presets={DELAY_PRESETS} min={0} max={LIMITS.maxDelayMs}
            onChange={(delayAfterMs) => onChange({ ...step, delayAfterMs })} />
          <Advanced title="Exact timing">
            {index > 0 && (
              <MsInput label="Wait before" value={waitBefore} min={0} max={LIMITS.maxDelayMs} onChange={onWaitBefore} />
            )}
            {kind === "tap" && (
              <MsInput label="Press time" value={step.holdMs} min={LIMITS.minHoldMs} max={LIMITS.maxHoldMs}
                onChange={(holdMs) => onChange({ ...step, holdMs })} />
            )}
            <MsInput label="Wait after" value={step.delayAfterMs} min={0} max={LIMITS.maxDelayMs}
              onChange={(delayAfterMs) => onChange({ ...step, delayAfterMs })} />
            <p className="muted small" data-tip="Macros act on each controller report (about every 4 ms over USB) plus Windows scheduling delay, so timing isn't millisecond-exact.">
              Press {LIMITS.minHoldMs}–{LIMITS.maxHoldMs} ms · wait 0–{LIMITS.maxDelayMs} ms · about 4 ms steps</p>
          </Advanced>
        </div>
      </div>
    </div>
  );
}
