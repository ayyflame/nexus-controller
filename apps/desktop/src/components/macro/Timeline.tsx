import { useState } from "react";
import { formatMs } from "../../lib/macros";
import type { MacroStep } from "../../types/engine";
import { ButtonCombo } from "./ButtonChip";

interface Props {
  steps: MacroStep[];
  selectedId: string | null;
  /** Additional selected actions (multi-select). */
  selection?: string[];
  onSelect: (id: string, mode: "single" | "toggle" | "range") => void;
  onMove: (from: number, to: number) => void;
  /** Index of the step being previewed, and whether it is pressed. */
  playing: { step: number | null; pressed: boolean } | null;
  /** Indexes of actions whose wait is too short before the same button again. */
  riskyWaits?: Set<number>;
}

/** Horizontal sequence of action blocks with the waits between them. */
export function Timeline({ steps, selectedId, selection = [], onSelect, onMove, playing, riskyWaits }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <div className="timeline empty">
        <p>Your sequence is empty.</p>
        <p className="muted small">Record from your controller, or click buttons below to add actions.</p>
      </div>
    );
  }

  return (
    <div className="timeline" role="list" aria-label="Macro sequence">
      {steps.map((s, i) => {
        const isPlaying = playing?.step === i;
        return (
          <div key={s.id} className="tl-item" role="listitem">
            <button
              type="button"
              className={`tl-block${selectedId === s.id ? " selected" : ""}${selection.includes(s.id) && selectedId !== s.id ? " multi" : ""}${isPlaying && playing?.pressed ? " playing" : ""}${dropAt === i && dragFrom !== null && dragFrom !== i ? " drop-target" : ""}`}
              onClick={(e) => onSelect(s.id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single")}
              draggable
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); setDropAt(i); }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i);
                setDragFrom(null); setDropAt(null);
              }}
              onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
              data-tip="Click to edit · Ctrl/Shift-click to select several · drag to reorder"
              aria-label={`Action ${i + 1}`}
            >
              <span className="tl-index">{i + 1}</span>
              <ButtonCombo buttons={s.buttons} active={isPlaying && playing?.pressed} />
              <span className="tl-hold">
                <span className="tl-hold-bar" style={{ width: `${Math.min(100, 12 + Math.log10(s.holdMs) * 22)}%` }} />
                Press {formatMs(s.holdMs)}
              </span>
              <span className="tl-release muted small">then release</span>
            </button>
            {(i < steps.length - 1 || s.delayAfterMs > 0) && (
              <span className={`tl-wait${isPlaying && !playing?.pressed ? " playing" : ""}${riskyWaits?.has(i) ? " risky" : ""}`}
                data-tip={riskyWaits?.has(i) ? "Too short: the same button is pressed again, so a game may see one long press" : "Wait before the next action"}>
                <span className="tl-wait-line" />
                <span className="tl-wait-label">{riskyWaits?.has(i) ? "⚠ " : ""}wait {formatMs(s.delayAfterMs)}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
