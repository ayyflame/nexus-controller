import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ControllerVisual } from "../ControllerVisual";
import type { Anchors } from "../controller3d/Controller3D";
import { buttonMapping, buttonMarks, describeMapping } from "../../lib/buttonMapping";
import {
  CALLOUTS, CALLOUT_BUTTONS, SHORT_NAMES, calloutFor, gameLabel, leaderLine, resetButton, setRemapAlso, setRemapTarget,
  type Box, type Point,
} from "../../lib/mappingView";
import { BUTTONS, pressedButtons } from "../../lib/macros";
import type { ControllerState, Macro, MacroButton, ProcessingConfig, VirtualOutputKind } from "../../types/engine";

type Side = keyof typeof CALLOUTS;
interface Line { button: MacroButton; from: Point; to: Point }

/** Where the top cards sit: L2/R2 on the outside row, L1/Touchpad/R1 below them. */
const TOP_PLACE: Partial<Record<MacroButton, { col: number; row: number }>> = {
  leftTrigger: { col: 1, row: 1 }, rightTrigger: { col: 3, row: 1 },
  leftShoulder: { col: 1, row: 2 }, touchpad: { col: 2, row: 2 }, rightShoulder: { col: 3, row: 2 },
};

const SIDE_OF: Record<MacroButton, Side> = Object.fromEntries(
  (Object.keys(CALLOUTS) as Side[]).flatMap((side) => CALLOUTS[side].map((b) => [b, side])),
) as Record<MacroButton, Side>;

interface Props {
  config: ProcessingConfig;
  /** Applies an edit (recorded for undo by the caller). */
  onEdit: (next: ProcessingConfig) => void;
  input: ControllerState | null;
  output: VirtualOutputKind;
  macros: Macro[];
  onOpenOutput: () => void;
}

/**
 * Controller › Mapping: the controller picture with a card per button around
 * it, joined by leader lines. Click a card or the button on the picture to
 * edit it below. Uses the same remap rules as the list view.
 */
export function MappingView({ config, onEdit, input, output, macros, onOpenOutput }: Props) {
  const [selected, setSelected] = useState<MacroButton | null>(null);
  const [hover, setHover] = useState<MacroButton | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const visual = useRef<HTMLDivElement>(null);
  // With the 3D model, the lines follow where each control is on screen as the view turns.
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const lines = useLeaderLines(stage, visual, anchors);
  const pressed = new Set(pressedButtons(input));
  const marks = buttonMarks(CALLOUT_BUTTONS, config, macros);
  const toggle = (b: MacroButton) => setSelected((cur) => (cur === b ? null : b));

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const cardFor = (b: MacroButton) => {
    const c = calloutFor(buttonMapping(b, config, macros), output);
    const place = TOP_PLACE[b];
    return (
      <button key={b} type="button" data-card={b}
        className={`map-card tone-${c.tone}${selected === b ? " selected" : ""}${pressed.has(b) ? " lit" : ""}`}
        style={place ? { gridColumn: place.col, gridRow: place.row } : undefined}
        aria-pressed={selected === b}
        aria-label={`${BUTTONS[b].name}: ${c.sends}${c.notes.length ? `. ${c.notes.join(". ")}` : ""}`}
        onClick={() => toggle(b)} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(b)} onBlur={() => setHover(null)}>
        <span className="map-card-name">{SHORT_NAMES[b]}</span>
        <span className="map-card-sends">{c.sends}</span>
        {c.notes.length > 0 && <span className="map-card-note">{c.notes.join(" · ")}</span>}
      </button>
    );
  };

  return (
    <div className="mapping">
      <div className="mapping-stage" ref={stage}>
        <svg className="mapping-lines" aria-hidden="true">
          {lines.map((l) => {
            const hot = l.button === selected || l.button === hover || pressed.has(l.button);
            return (
              <g key={l.button} className={hot ? "hot" : ""}>
                <line x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} />
                <circle cx={l.to.x} cy={l.to.y} r={hot ? 3.5 : 2.2} />
              </g>
            );
          })}
        </svg>
        <div className="map-top">{CALLOUTS.top.map(cardFor)}</div>
        <div className="map-side map-left">{CALLOUTS.left.map(cardFor)}</div>
        <div className="map-visual" ref={visual}>
          <ControllerVisual state={input} live={input !== null} selected={selected} marks={marks} onSelect={toggle} onAnchors={setAnchors} />
        </div>
        <div className="map-side map-right">{CALLOUTS.right.map(cardFor)}</div>
        <div className="map-bottom">{CALLOUTS.bottom.map(cardFor)}</div>
      </div>

      {selected
        ? <MappingEditor key={selected} button={selected} config={config} onEdit={onEdit} output={output} macros={macros}
            onClose={() => setSelected(null)} onOpenOutput={onOpenOutput} />
        : <p className="muted small mapping-hint">Click a card or a button on the controller to change what it sends.</p>}
    </div>
  );
}

/**
 * Measures card and button positions (relative to the stage) and returns the
 * leader lines. Positions only change with the layout, not with input, so
 * this runs on resize and when the picture is swapped (drawing / photo), not
 * on every report.
 */
function useLeaderLines(
  stage: React.RefObject<HTMLDivElement | null>, visual: React.RefObject<HTMLDivElement | null>, anchors: Anchors | null,
): Line[] {
  const [lines, setLines] = useState<Line[]>([]);
  const measure = useCallback(() => {
    const root = stage.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const rel = (r: DOMRect): Box => ({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
    const next: Line[] = [];
    // 3D: the model reports where each control is inside its canvas.
    const canvas = anchors ? visual.current?.querySelector("canvas") : null;
    if (anchors && canvas) {
      const c = rel(canvas.getBoundingClientRect());
      for (const b of CALLOUT_BUTTONS) {
        const card = root.querySelector(`[data-card="${b}"]`);
        const a = anchors[b];
        if (!card || !a || !a.visible) continue;
        next.push({ button: b, ...leaderLine(SIDE_OF[b], rel(card.getBoundingClientRect()), { left: c.left + a.x, top: c.top + a.y, width: 0, height: 0 }) });
      }
      setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      return;
    }
    for (const b of CALLOUT_BUTTONS) {
      const card = root.querySelector(`[data-card="${b}"]`);
      const part = root.querySelector(`.map-visual [data-button="${b}"]`);
      // The first drawn shape is the part at rest (stick well, trigger body…), so the
      // anchor does not follow a deflected stick.
      const shape = part ? Array.from(part.children).find((c) => c.tagName !== "clipPath") ?? part : null;
      if (!card || !shape) continue;
      const box = rel(shape.getBoundingClientRect());
      if (box.width === 0 && box.height === 0) continue;
      next.push({ button: b, ...leaderLine(SIDE_OF[b], rel(card.getBoundingClientRect()), box) });
    }
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [stage, visual, anchors]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    if (visual.current) ro.observe(visual.current);
    // Drawing ↔ photo swaps the picture element without necessarily resizing it.
    const mo = new MutationObserver(() => requestAnimationFrame(measure));
    if (visual.current) mo.observe(visual.current, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [measure, stage, visual]);

  return lines;
}

type EditorTab = "button" | "also" | "more";

function MappingEditor({ button, config, onEdit, output, macros, onClose, onOpenOutput }: {
  button: MacroButton; config: ProcessingConfig; onEdit: (c: ProcessingConfig) => void; output: VirtualOutputKind;
  macros: Macro[]; onClose: () => void; onOpenOutput: () => void;
}) {
  const [tab, setTab] = useState<EditorTab>("button");
  const mapping = buttonMapping(button, config, macros);
  const callout = calloutFor(mapping, output);
  const rule = config.remap.find((r) => r.from === button);
  const target = !rule || rule.to === button ? "same" : rule.to === null ? "off" : rule.to;
  const also = rule?.also?.[0] ?? null;
  const others = CALLOUT_BUTTONS.filter((b) => b !== button);
  const own = gameLabel(button, output);
  const extra = mapping.macros.length + mapping.layers.length + mapping.activatesLayers.length + (mapping.gyroButtonHidden ? 1 : 0);

  const chip = (key: string, active: boolean, title: string, sub: string | null | undefined, onClick: () => void, tone = "") => (
    <button key={key} type="button" className={`map-chip${active ? " active" : ""}${tone ? ` ${tone}` : ""}`}
      aria-pressed={active} onClick={onClick}>
      <span>{title}</span>{sub !== undefined && <small>{sub ?? "not sent"}</small>}
    </button>
  );

  return (
    <section className="map-editor" aria-label={`Edit ${BUTTONS[button].name}`}>
      <header>
        <h3>{SHORT_NAMES[button]} <span className="map-arrow" aria-hidden="true">→</span> <span className={`tone-${callout.tone}`}>{callout.sends}</span></h3>
        <div className="row gap">
          <button type="button" className="btn-ghost small" disabled={!rule} onClick={() => onEdit(resetButton(config, button))}>Reset button</button>
          <button type="button" className="map-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
      </header>
      <nav className="map-tabs" role="tablist" aria-label="What to change">
        {([["button", "Sends"], ["also", "Also press"], ["more", `Macros & layers${extra ? ` (${extra})` : ""}`]] as Array<[EditorTab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === "button" && (
        <div className="map-chips" role="group" aria-label={`${BUTTONS[button].name} sends`}>
          {chip("same", target === "same", "Normal", own, () => onEdit(setRemapTarget(config, button, "same")))}
          {chip("off", target === "off", "Disabled", "nothing", () => onEdit(setRemapTarget(config, button, "off")), "danger")}
          {others.map((b) => chip(b, target === b, SHORT_NAMES[b], gameLabel(b, output), () => onEdit(setRemapTarget(config, button, b))))}
        </div>
      )}
      {tab === "also" && (
        <>
          <p className="muted small">A second button pressed at the same time as what {SHORT_NAMES[button]} sends.</p>
          <div className="map-chips" role="group" aria-label={`${BUTTONS[button].name} also presses`}>
            {chip("none", also === null, "None", undefined, () => onEdit(setRemapAlso(config, button, null)))}
            {others.map((b) => chip(b, also === b, SHORT_NAMES[b], gameLabel(b, output), () => onEdit(setRemapAlso(config, button, b))))}
          </div>
        </>
      )}
      {tab === "more" && (
        <div className="map-more">
          <ul>{describeMapping(mapping, (b) => BUTTONS[b].name).map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="muted small">Macros start from the physical button, whatever it is mapped to. Shift layers are set up below.</p>
          <button type="button" className="btn-ghost small"
            onClick={() => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page: "macro-studio" } }))}>
            Open Macro Studio
          </button>
        </div>
      )}

      <footer className="muted small">
        {own === null && target === "same" && <span className="warn-text">The {output === "dualShock4" ? "DualShock 4" : "Xbox 360"} controller has no {SHORT_NAMES[button]} button, so games don't receive it. Pick a button above to use it. </span>}
        Output: <b>{output === "dualShock4" ? "DualShock 4" : "Xbox 360 (XInput)"}</b>{output === "disabled" && " — currently off"}.{" "}
        <button type="button" className="map-link" onClick={onOpenOutput}>Change on the Virtual Output tab</button>
      </footer>
    </section>
  );
}
