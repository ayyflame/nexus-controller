import { BUTTONS } from "../../lib/macros";
import type { MacroButton } from "../../types/engine";

function Shape({ shape }: { shape: NonNullable<(typeof BUTTONS)[MacroButton]["shape"]> }) {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" className={`shape shape-${shape}`}>
      {shape === "triangle" && <path d="M10 3.5 17 16H3Z" />}
      {shape === "circle" && <circle cx="10" cy="10" r="6.5" />}
      {shape === "cross" && <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" />}
      {shape === "square" && <rect x="4" y="4" width="12" height="12" rx="1" />}
    </svg>
  );
}

/** A controller button drawn as a small key cap. `label` overrides its text (e.g. "Share" on a DualShock 4). */
export function ButtonChip({ button, size = "md", active = false, label }: {
  button: MacroButton; size?: "sm" | "md" | "lg"; active?: boolean; label?: string;
}) {
  const info = BUTTONS[button];
  return (
    <span className={`chip chip-${size}${active ? " active" : ""}${info.shape ? " round" : ""}`} title={label ?? info.name}>
      {info.shape ? <Shape shape={info.shape} /> : label ?? info.short}
    </span>
  );
}

export function ButtonCombo({ buttons, size = "md", active = false }: {
  buttons: MacroButton[]; size?: "sm" | "md" | "lg"; active?: boolean;
}) {
  if (buttons.length === 0) return <span className="muted small">No button</span>;
  return (
    <span className="combo">
      {buttons.map((b, i) => (
        <span key={b} className="combo-item">
          {i > 0 && <span className="combo-plus">+</span>}
          <ButtonChip button={b} size={size} active={active} />
        </span>
      ))}
    </span>
  );
}
