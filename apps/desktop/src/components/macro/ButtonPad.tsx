import { BUTTONS } from "../../lib/macros";
import type { MacroButton } from "../../types/engine";
import { ButtonChip } from "./ButtonChip";
import { useShownModel } from "../../hooks/useShownModel";

interface Props {
  selected: MacroButton[];
  onPick: (b: MacroButton) => void;
  /** Buttons that can't be picked, with the reason shown as a tooltip. */
  blocked?: Partial<Record<MacroButton, string>>;
  /** Buttons highlighted as "currently pressed" (live input / recording). */
  lit?: MacroButton[];
  label: string;
}

/**
 * Clickable controller layout. Buttons sit where they are on the controller
 * shown (DualSense or DualShock 4, which share the layout) so users find them
 * by position, not by name. A DualShock 4 has no Mute key and calls Create
 * "Share".
 */
export function ButtonPad({ selected, onPick, blocked = {}, lit = [], label }: Props) {
  const ds4 = useShownModel() === "dualShock4";
  const key = (b: MacroButton, extra = "") => {
    if (ds4 && b === "mute") return null;
    const name = ds4 && b === "select" ? "Share" : BUTTONS[b].name;
    const reason = blocked[b];
    const isSelected = selected.includes(b);
    return (
      <button
        type="button"
        key={b}
        className={`pad-key ${extra}${isSelected ? " selected" : ""}${lit.includes(b) ? " lit" : ""}`}
        onClick={() => onPick(b)}
        disabled={!!reason}
        aria-pressed={isSelected}
        aria-label={name + (reason ? ` (unavailable: ${reason})` : "")}
        data-tip={reason ?? name}
      >
        <ButtonChip button={b} size="lg" active={isSelected} label={ds4 && b === "select" ? "Share" : undefined} />
      </button>
    );
  };

  return (
    <div className="pad" role="group" aria-label={label}>
      <div className="pad-col">
        <div className="pad-row">{key("leftTrigger", "wide")}</div>
        <div className="pad-row">{key("leftShoulder", "wide")}</div>
        <div className="pad-cross">
          <span className="c-up">{key("dpadUp")}</span>
          <span className="c-left">{key("dpadLeft")}</span>
          <span className="c-right">{key("dpadRight")}</span>
          <span className="c-down">{key("dpadDown")}</span>
        </div>
        <div className="pad-row">{key("leftStick")}</div>
      </div>

      <div className="pad-col center">
        <div className="pad-row">{key("select", "wide")}{key("start", "wide")}</div>
        <div className="pad-row">{key("touchpad", "touch")}</div>
        <div className="pad-row">{key("home")}{key("mute")}</div>
      </div>

      <div className="pad-col">
        <div className="pad-row">{key("rightTrigger", "wide")}</div>
        <div className="pad-row">{key("rightShoulder", "wide")}</div>
        <div className="pad-cross">
          <span className="c-up">{key("north")}</span>
          <span className="c-left">{key("west")}</span>
          <span className="c-right">{key("east")}</span>
          <span className="c-down">{key("south")}</span>
        </div>
        <div className="pad-row">{key("rightStick")}</div>
      </div>
    </div>
  );
}
