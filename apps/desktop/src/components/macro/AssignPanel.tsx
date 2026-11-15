import { usePrimaryDevice } from "../../hooks/useEngine";
import { BUTTONS, LIMITS, MODES, pressedButtons, triggerBlockers } from "../../lib/macros";
import type { Macro, PlaybackMode, ValidationIssue } from "../../types/engine";
import { ButtonChip } from "./ButtonChip";
import { ButtonPad } from "./ButtonPad";
import { Advanced, Issues, MsInput, Switch } from "./common";

const MODE_ORDER: PlaybackMode[] = ["once", "repeatWhileHeld", "toggle"];

export function AssignPanel({ draft, others, onChange, issues }: {
  draft: Macro;
  others: Macro[];
  onChange: (patch: Partial<Macro>) => void;
  issues: ValidationIssue[];
}) {
  const device = usePrimaryDevice();
  const live = pressedButtons(device?.input);
  const blocked = triggerBlockers(draft, others);
  const triggerInSequence = draft.trigger !== null
    && draft.steps.some((s) => s.buttons.includes(draft.trigger!));

  return (
    <div className="assign">
      <section>
        <h3 className="section-title">Which button starts this macro?</h3>
        <p className="muted small">
          Click a button.{device?.input ? " Tip: press it on your controller to see it light up here." : ""}
          {" "}Buttons used by other macros are greyed out.
        </p>
        <div className="assign-pad">
          <ButtonPad
            selected={draft.trigger ? [draft.trigger] : []}
            onPick={(b) => onChange({ trigger: draft.trigger === b ? null : b })}
            blocked={blocked}
            lit={live}
            label="Trigger button"
          />
          <div className="assign-summary">
            {draft.trigger ? (
              <>
                <span className="muted small">Starts with</span>
                <ButtonChip button={draft.trigger} size="lg" active />
                <strong>{BUTTONS[draft.trigger].name}</strong>
                <button className="btn-ghost" onClick={() => onChange({ trigger: null })}>Clear</button>
              </>
            ) : (
              <span className="muted">No button chosen yet</span>
            )}
          </div>
        </div>
        <div className="paddle-note" data-tip="Back paddle input isn't read yet; this will be added in a later update.">
          <span className="chip chip-md">LB</span><span className="chip chip-md">RB</span>
          <span>DualSense Edge back paddles: <b>not supported yet</b></span>
        </div>
        {triggerInSequence && (
          <div className="notice dev small">
            Your sequence also presses {BUTTONS[draft.trigger!].name}. That's allowed: games will still receive it from the macro.
          </div>
        )}
        <Issues issues={issues} field="trigger" />
      </section>

      <section>
        <h3 className="section-title">How should it play?</h3>
        <div className="mode-cards" role="radiogroup" aria-label="Playback mode">
          {MODE_ORDER.map((mode) => (
            <button key={mode} type="button" role="radio" aria-checked={draft.mode === mode}
              className={`mode-card${draft.mode === mode ? " selected" : ""}`}
              onClick={() => onChange({ mode })}>
              <span className={`mode-icon mode-${mode}`} aria-hidden="true" />
              <strong>{MODES[mode].title}</strong>
              <span className="muted small">{MODES[mode].description}</span>
            </button>
          ))}
        </div>
      </section>

      <Advanced>
        {draft.mode !== "once" && (
          <MsInput label="Pause between repeats" value={draft.repeatDelayMs} min={0} max={LIMITS.maxDelayMs}
            onChange={(repeatDelayMs) => onChange({ repeatDelayMs })} />
        )}
        <Switch checked={draft.blockTrigger} onChange={(blockTrigger) => onChange({ blockTrigger })}
          label="Hide the trigger button from games"
          tip="When on, games don't see the trigger button itself, only the macro." />
        <p className="muted small">Turn this off if you want the trigger button to keep its normal job in the game as well.</p>
      </Advanced>
    </div>
  );
}
