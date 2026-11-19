import { ButtonSelect } from "./advanced";
import { Panel } from "./widgets";
import { Switch } from "../macro/common";
import { MAX_COMBOS, MAX_COMBO_BUTTONS, MAX_COMBO_SENDS, comboProblem, newCombo, setSlot } from "../../lib/combos";
import type { ComboRule, MacroButton, ProcessingConfig } from "../../types/engine";

/**
 * Controller › Mapping › Button combinations: holding 2–3 buttons together
 * presses 1–3 others (e.g. L1 + R1 → Triangle). Saved in the profile.
 */
export function CombosPanel({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const combos = config.combos;
  const set = (i: number, c: ComboRule | null) =>
    onChange({ ...config, combos: c ? combos.map((x, j) => (j === i ? c : x)) : combos.filter((_, j) => j !== i) });
  const slots = (list: MacroButton[], max: number, onPick: (l: MacroButton[]) => void, label: string) => (
    <span className="combo-slots">
      {[...list, null].slice(0, max).map((b, k) => (
        <ButtonSelect key={k} label={`${label} ${k + 1}`} value={b} noneLabel={b ? "— remove —" : "+ add"}
          exclude={list.filter((x) => x !== b)} onChange={(x) => onPick(setSlot(list, k, x, max))} />
      ))}
    </span>
  );
  return (
    <Panel title="Button combinations" aside={
      <button type="button" className="btn-ghost" disabled={combos.length >= MAX_COMBOS}
        onClick={() => onChange({ ...config, combos: [...combos, newCombo()] })}>+ Add combination</button>
    }>
      <p className="muted small">
        Hold two or three buttons together to press other buttons, e.g. L1 + R1 → Triangle. With <b>Hide the held buttons</b> on, the game doesn't see them while the combination is used,
        and each stays hidden until you let go of it. Pressing one of them on its own works as normal; it may show for an instant before the second button joins.
      </p>
      {combos.length === 0 && <p className="muted small">No combinations yet.</p>}
      {combos.map((c, i) => {
        const problem = comboProblem(c, combos);
        return (
          <div key={i} className={`combo-row${problem ? " invalid" : ""}`}>
            <span className="combo-label">Hold</span>
            {slots(c.buttons, MAX_COMBO_BUTTONS, (l) => set(i, { ...c, buttons: l }), "Held button")}
            <span className="combo-arrow" aria-hidden="true">→</span>
            {slots(c.sends, MAX_COMBO_SENDS, (l) => set(i, { ...c, sends: l }), "Presses")}
            <span className="combo-hide"><Switch checked={c.hideInputs} onChange={(v) => set(i, { ...c, hideInputs: v })} label="Hide the held buttons" /> Hide the held buttons</span>
            <button type="button" className="btn-ghost small danger" onClick={() => set(i, null)}>Remove</button>
            {problem && <p className="warn-text small combo-problem">{problem}</p>}
          </div>
        );
      })}
    </Panel>
  );
}
