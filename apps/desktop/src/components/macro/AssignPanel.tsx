import { useState } from "react";
import { Icon } from "../Icons";
import { BUTTONS, LIMITS, MODES, triggerBlockers } from "../../lib/macros";
import type { Macro, PlaybackMode, ValidationIssue } from "../../types/engine";
import { ButtonChip } from "./ButtonChip";
import { usePick } from "./ButtonPicker";
import { Advanced, Issues, MsInput, Switch } from "./common";

const MODE_ORDER: PlaybackMode[] = ["once", "repeatWhileHeld", "toggle"];
const MODE_ICON = { once: "play", repeatWhileHeld: "repeat", toggle: "power" } as const;

export function AssignPanel({ draft, others, onChange, issues }: {
  draft: Macro;
  others: Macro[];
  onChange: (patch: Partial<Macro>) => void;
  issues: ValidationIssue[];
}) {
  const blocked = triggerBlockers(draft, others);
  // Choosing uses the editor's controller: one click sets the button.
  const [choosing, setChoosing] = useState(false);
  usePick("trigger", choosing ? {
    priority: 2, kind: "choose", title: "Click the button that starts this macro",
    selected: draft.trigger ? [draft.trigger] : [], blocked,
    onPick: (b) => { onChange({ trigger: b }); setChoosing(false); }, onDone: () => setChoosing(false),
  } : null);
  const triggerInSequence = draft.trigger !== null
    && draft.steps.some((s) => s.buttons.includes(draft.trigger!));

  return (
    <div className="assign">
      <section>
        <h3 className="section-title">Starts with</h3>
        <div className="assign-summary">
          {draft.trigger ? <>
            <ButtonChip button={draft.trigger} size="lg" active />
            <strong>{BUTTONS[draft.trigger].name}</strong>
          </> : <span className="muted">No button yet</span>}
          <button type="button" className={choosing ? "btn-primary small" : "btn-ghost small"} aria-pressed={choosing}
            onClick={() => setChoosing((c) => !c)}>{choosing ? "Done" : draft.trigger ? "Change" : "Choose on controller"}</button>
          {draft.trigger && <button type="button" className="btn-ghost small" onClick={() => onChange({ trigger: null })}>Clear</button>}
        </div>
        {triggerInSequence && (
          <p className="muted small">The sequence also presses {BUTTONS[draft.trigger!].name}; games still receive it.</p>
        )}
        <Issues issues={issues} field="trigger" />
      </section>

      <section>
        <h3 className="section-title">Plays</h3>
        <div className="mode-cards" role="radiogroup" aria-label="Playback mode">
          {MODE_ORDER.map((mode) => (
            <button key={mode} type="button" role="radio" aria-checked={draft.mode === mode}
              className={`mode-card${draft.mode === mode ? " selected" : ""}`}
              onClick={() => onChange({ mode })}>
              <span className={`mode-icon mode-${mode}`} aria-hidden="true"><Icon name={MODE_ICON[mode]} size={15} /></span>
              <strong>{MODES[mode].title}</strong>
              <span className="muted small">{MODES[mode].description}</span>
            </button>
          ))}
        </div>
        {draft.mode === "once" && (
          <label className="repeat-count">
            <span className="field-label" data-tip="Times the sequence plays per press, with the pause between repeats in between">Play</span>
            <input className="text-input" type="number" min={1} max={LIMITS.maxRepeatCount} value={draft.repeatCount ?? 1}
              aria-label="Times to play per press"
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n)) onChange({ repeatCount: Math.max(1, Math.min(LIMITS.maxRepeatCount, n)) });
              }} />
            <span className="muted small">time{(draft.repeatCount ?? 1) === 1 ? "" : "s"} per press</span>
          </label>
        )}
      </section>

      <Advanced>
        <span data-tip="The trigger must be held this long before the macro reacts; a quick tap does nothing. 0: reacts at once.">
          <MsInput label="Hold to activate" value={draft.activationMs ?? 0} min={0} max={LIMITS.maxActivationMs}
            onChange={(activationMs) => onChange({ activationMs })} />
        </span>
        {(draft.mode !== "once" || (draft.repeatCount ?? 1) > 1) && (
          <MsInput label="Pause between repeats" value={draft.repeatDelayMs} min={0} max={LIMITS.maxDelayMs}
            onChange={(repeatDelayMs) => onChange({ repeatDelayMs })} />
        )}
        <Switch checked={draft.blockTrigger} onChange={(blockTrigger) => onChange({ blockTrigger })}
          label="Hide the trigger button from games"
          tip="When on, games see only the macro, not the trigger button itself. Turn off to keep the button's normal job too." />
      </Advanced>
    </div>
  );
}
