import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ControllerVisual } from "../ControllerVisual";
import type { Anchors } from "../controller3d/Controller3D";
import { buttonMapping, buttonMarks } from "../../lib/buttonMapping";
import {
  CALLOUTS, CALLOUT_BUTTONS, calloutFor, calloutsFor, chooseRoute, shortName, gameLabel, resetButton, setRemapAlso, setRemapTarget,
  type Box, type Point, type Side,
} from "../../lib/mappingView";
import { BUTTONS, MODES, pressedButtons } from "../../lib/macros";
import { engineApi, errorMessage } from "../../lib/engine";
import { useShownModel } from "../../hooks/useShownModel";
import type { ViewModel } from "../../lib/controller3d";
import type { ControllerState, Macro, MacroButton, ProcessingConfig, VirtualOutputKind } from "../../types/engine";

/** Bottom band: the PS button's card beside Mute's, which sits right under the Mute button (straight connector). */
const BOTTOM_PLACE: Partial<Record<MacroButton, number>> = { home: 1, mute: 2 };

const SIDE_OF: Record<MacroButton, Side> = Object.fromEntries(
  (Object.keys(CALLOUTS) as Side[]).flatMap((side) => CALLOUTS[side].map((b) => [b, side])),
) as Record<MacroButton, Side>;

/** One connector: its polyline (card end first, control last) and whether the control faces away. */
export interface Connector { button: MacroButton; points: Point[]; hidden: boolean }

interface Props {
  config: ProcessingConfig;
  /** Applies a remap edit (recorded for undo by the caller). */
  onEdit: (next: ProcessingConfig) => void;
  input: ControllerState | null;
  output: VirtualOutputKind;
  macros: Macro[];
  /** Called after a macro's trigger button was changed here, with the saved macros. */
  onMacrosChanged: (macros: Macro[]) => void;
  onOpenOutput: () => void;
  /** Where the picture's view buttons go (the workspace toolbar), so they never sit under a connector. */
  toolbarHost?: HTMLElement | null;
}

/**
 * The Mapping workspace: the controller in the middle, a card per control
 * around it joined to the control by a connector, and the editor for the
 * selected control below. Click a card or the control on the controller to
 * select it. Uses the same remap rules as the list view.
 */
export function MappingView({ config, onEdit, input, output, macros, onMacrosChanged, onOpenOutput, toolbarHost }: Props) {
  const [selected, setSelected] = useState<MacroButton | null>(null);
  const [hover, setHover] = useState<MacroButton | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const visual = useRef<HTMLDivElement>(null);
  // With the 3D model, the connectors follow where each control is on screen as the view turns.
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const connectors = useConnectors(stage, visual, anchors);
  const pressed = new Set(pressedButtons(input));
  const marks = buttonMarks(CALLOUT_BUTTONS, config, macros);
  const toggle = (b: MacroButton) => setSelected((cur) => (cur === b ? null : b));
  // Cards and names follow the controller shown (no Mute card, "Share" on a DualShock 4).
  const model = useShownModel(input);
  const callouts = calloutsFor(model);
  // A control that isn't on the controller shown (Mute on a DualShock 4) can't stay selected.
  const shown = selected && !callouts.bottom.includes(selected) && SIDE_OF[selected] === "bottom" ? null : selected;

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  const cardFor = (b: MacroButton) => {
    const c = calloutFor(buttonMapping(b, config, macros), output);
    // Alone (DualShock 4), the PS card is centred under the PS button.
    const col = SIDE_OF[b] === "bottom" ? (callouts.bottom.length === 1 ? 2 : BOTTOM_PLACE[b]) : undefined;
    return (
      <button key={b} type="button" data-card={b} data-side={SIDE_OF[b]}
        className={`map-card tone-${c.tone}${shown === b ? " selected" : ""}${pressed.has(b) ? " lit" : ""}`}
        style={col ? { gridColumn: col } : undefined}
        aria-pressed={shown === b}
        aria-label={`${BUTTONS[b].name}: ${c.sends}${c.notes.length ? `. ${c.notes.join(". ")}` : ""}`}
        onClick={() => toggle(b)} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(b)} onBlur={() => setHover(null)}>
        <span className="map-card-name">{shortName(b, model)}</span>
        <span className="map-card-sends">{c.sends}</span>
        {c.notes.length > 0 && <span className="map-card-note">{c.notes.join(" · ")}</span>}
      </button>
    );
  };

  // The selected connector is drawn last, so it is never under another one.
  const ordered = [...connectors].sort((a, b) => Number(a.button === shown) - Number(b.button === shown));
  return (
    <div className="mapping">
      <div className="mapping-stage" ref={stage}>
        <div className="map-top">{callouts.top.map(cardFor)}</div>
        <div className="map-side map-left">{callouts.left.map(cardFor)}</div>
        <div className="map-visual" ref={visual}>
          <ControllerVisual state={input} live={input !== null} selected={shown} marks={marks} onSelect={toggle} onAnchors={setAnchors}
            accentSelection toolbarHost={toolbarHost} />
        </div>
        <div className="map-side map-right">{callouts.right.map(cardFor)}</div>
        <div className="map-bottom">{callouts.bottom.map(cardFor)}</div>
        <svg className="mapping-lines" aria-hidden="true">
          {ordered.map((l) => {
            const pts = l.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            const end = l.points[l.points.length - 1]!;
            const state = l.button === shown ? "selected" : l.button === hover || pressed.has(l.button) ? "hot" : "";
            return (
              <g key={l.button} data-line={l.button} className={`${state}${l.hidden ? " hidden-side" : ""}`}>
                <polyline className="halo" points={pts} />
                <polyline className="wire" points={pts} />
                {l.button === shown && <circle className="ring" cx={end.x} cy={end.y} r={7} />}
                <circle className="tip" cx={end.x} cy={end.y} r={l.button === shown ? 3 : 2.6} />
              </g>
            );
          })}
        </svg>
      </div>

      {shown
        ? <MappingEditor key={shown} button={shown} model={model} config={config} onEdit={onEdit} output={output} macros={macros}
            onMacrosChanged={onMacrosChanged} onClose={() => setSelected(null)} onOpenOutput={onOpenOutput} />
        : <p className="muted small mapping-hint">Select a card or a control on the controller to change what it does.</p>}
    </div>
  );
}

/**
 * Measures cards and controls (relative to the stage) and routes the
 * connectors. Each connector ends exactly on its own control's anchor: the
 * point the 3D model reports for that control (a visible point of it from
 * the default view), projected through the camera, so it moves when the
 * view is turned or the picture resized. Re-measured whenever the stage, the
 * picture or a card changes size, and when the model is swapped (DualSense ↔
 * DualShock 4), never per report. Without a 3D picture (no WebGL) there are
 * no connectors; the cards still select and edit controls.
 */
function useConnectors(
  stage: React.RefObject<HTMLDivElement | null>, visual: React.RefObject<HTMLDivElement | null>, anchors: Anchors | null,
): Connector[] {
  const [lines, setLines] = useState<Connector[]>([]);
  const measure = useCallback(() => {
    const root = stage.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const rel = (r: DOMRect): Box => ({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
    const cards = new Map<MacroButton, Box>();
    root.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
      const box = rel(el.getBoundingClientRect());
      if (box.width > 0) cards.set(el.dataset.card as MacroButton, box);
    });
    const canvas = anchors ? visual.current?.querySelector("canvas") : null;
    const area = canvas ? rel(canvas.getBoundingClientRect()) : null;
    const next: Connector[] = [];
    for (const [b, card] of cards) {
      const a = anchors?.[b];
      if (!a || !area) continue;
      // Kept inside the picture if the view is zoomed so far that the control is off-screen.
      const x = Math.min(area.width, Math.max(0, a.x)), y = Math.min(area.height, Math.max(0, a.y));
      const anchor: Point = { x: area.left + x, y: area.top + y };
      const hidden = !a.visible || x !== a.x || y !== a.y;
      const others = [...cards].filter(([o]) => o !== b).map(([, box]) => box);
      next.push({ button: b, points: chooseRoute(SIDE_OF[b], card, anchor, others), hidden });
    }
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [stage, visual, anchors]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (stage.current) {
      ro.observe(stage.current);
      stage.current.querySelectorAll("[data-card]").forEach((el) => ro.observe(el));
    }
    if (visual.current) ro.observe(visual.current);
    // The 3D canvas appears after the model loads, without necessarily resizing anything.
    const mo = new MutationObserver(() => requestAnimationFrame(measure));
    if (visual.current) mo.observe(visual.current, { childList: true, subtree: true });
    if (stage.current) mo.observe(stage.current, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [measure, stage, visual]);

  return lines;
}

type EditorTab = "controller" | "macro";

function MappingEditor({ button, model, config, onEdit, output, macros, onMacrosChanged, onClose, onOpenOutput }: {
  button: MacroButton; model: ViewModel; config: ProcessingConfig; onEdit: (c: ProcessingConfig) => void; output: VirtualOutputKind;
  macros: Macro[]; onMacrosChanged: (m: Macro[]) => void; onClose: () => void; onOpenOutput: () => void;
}) {
  const mapping = buttonMapping(button, config, macros);
  const [tab, setTab] = useState<EditorTab>("controller");
  const callout = calloutFor(mapping, output);
  const rule = config.remap.find((r) => r.from === button);
  const target = !rule || rule.to === button ? "same" : rule.to === null ? "off" : rule.to;
  const also = rule?.also?.[0] ?? null;
  // A DualShock 4 has no Mute button to choose.
  const others = CALLOUT_BUTTONS.filter((b) => b !== button && !(model === "dualShock4" && b === "mute"));
  const name = (b: MacroButton) => shortName(b, model);
  const own = gameLabel(button, output);
  const started = macros.filter((m) => m.trigger === button);
  const layerLines = [
    ...mapping.activatesLayers.map((l) => `Switches the layer “${l}” (not sent to the game itself).`),
    ...mapping.layers.map((l) => {
      const what = l.sends === null && l.also.length === 0 ? "nothing" : [...(l.sends ? [l.sends] : []), ...l.also].map(name).join(" + ");
      return `In the layer “${l.layer}”: sends ${what}.`;
    }),
    ...(mapping.gyroButtonHidden ? ["Switches gyro aiming (not sent to the game itself)."] : []),
  ];

  const chip = (key: string, active: boolean, title: string, sub: string | null | undefined, onClick: () => void, tone = "") => (
    <button key={key} type="button" className={`map-chip${active ? " active" : ""}${tone ? ` ${tone}` : ""}`}
      aria-pressed={active} onClick={onClick}>
      <span>{title}</span>{sub !== undefined && <small>{sub ?? "not sent"}</small>}
    </button>
  );

  // Each new selection brings the editor's options into view (only as far as needed).
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.querySelector(".map-tabs")?.scrollIntoView({ block: "nearest" }); }, []);

  return (
    <section className="map-editor" ref={panel} aria-label={`Edit ${BUTTONS[button].name}`}>
      <header>
        <div className="map-editor-title">
          <h3>{name(button)} <span className="map-arrow" aria-hidden="true">→</span> <span className={`tone-${callout.tone}`}>{callout.sends}</span></h3>
          {callout.notes.length > 0 && <span className="map-editor-notes">{callout.notes.join(" · ")}</span>}
        </div>
        <div className="row gap">
          <button type="button" className="btn-ghost small" disabled={!rule} onClick={() => onEdit(resetButton(config, button))}
            title={rule ? `Make ${name(button)} send ${own ?? "itself"} again` : "Already normal"}>Reset button</button>
          <button type="button" className="map-close" aria-label="Close editor" onClick={onClose}>✕</button>
        </div>
      </header>
      <nav className="map-tabs" role="tablist" aria-label="Assignment type">
        {([["controller", "Controller"], ["macro", `Macro${started.length ? ` (${started.length})` : ""}`]] as Array<[EditorTab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === "controller" && (
        <div className="map-editor-body">
          <div className="map-field">
            <span className="map-field-label">Sends</span>
            <div className="map-chips" role="group" aria-label={`${BUTTONS[button].name} sends`}>
              {chip("same", target === "same", "Normal", own, () => onEdit(setRemapTarget(config, button, "same")))}
              {chip("off", target === "off", "Disabled", "nothing", () => onEdit(setRemapTarget(config, button, "off")), "danger")}
              {others.map((b) => chip(b, target === b, name(b), gameLabel(b, output), () => onEdit(setRemapTarget(config, button, b))))}
            </div>
          </div>
          <div className="map-field map-field-inline">
            <label className="map-field-label" htmlFor={`also-${button}`}>Also press</label>
            <select id={`also-${button}`} className="select" value={also ?? ""}
              onChange={(e) => onEdit(setRemapAlso(config, button, (e.target.value || null) as MacroButton | null))}>
              <option value="">Nothing else</option>
              {others.map((b) => <option key={b} value={b}>{name(b)}{gameLabel(b, output) ? ` (${gameLabel(b, output)})` : " (not sent)"}</option>)}
            </select>
            <span className="muted small">A second button pressed at the same time as what {name(button)} sends.</span>
          </div>
          {layerLines.length > 0 && (
            <div className="map-field">
              <span className="map-field-label">Layers & gyro</span>
              <ul className="map-layer-list">{layerLines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {tab === "macro" && <MacroAssign button={button} label={name(button)} macros={macros} onMacrosChanged={onMacrosChanged} />}

      <footer className="muted small">
        {own === null && target === "same" && <span className="warn-text">The {output === "dualShock4" ? "DualShock 4" : "Xbox 360"} controller has no {name(button)} button, so games don't receive it. Pick a button above to use it. </span>}
        Output: <b>{output === "dualShock4" ? "DualShock 4" : "Xbox 360 (XInput)"}</b>{output === "disabled" && " (currently off)"}. Set on the{" "}
        <button type="button" className="map-link" onClick={onOpenOutput}>Virtual Controller</button> page.
      </footer>
    </section>
  );
}

/** Which macro the selected button starts: assign, replace or remove (saved to the macro, as in Macros). */
function MacroAssign({ button, label, macros, onMacrosChanged }: {
  button: MacroButton; label: string; macros: Macro[]; onMacrosChanged: (m: Macro[]) => void;
}) {
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = macros.filter((m) => m.trigger === button);
  const active = started.find((m) => m.enabled) ?? null;
  const candidates = macros.filter((m) => m.trigger !== button);
  const picked = candidates.find((m) => m.id === choice) ?? null;

  const save = async (changes: Macro[]) => {
    setBusy(true); setError(null);
    try {
      const saved: Macro[] = [];
      for (const m of changes) saved.push(await engineApi.saveMacro(m));
      onMacrosChanged(macros.map((m) => saved.find((s) => s.id === m.id) ?? m));
      setChoice("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // One enabled macro per button: assigning replaces the current one (it keeps its steps, just without a button).
  const assign = (m: Macro) => save([...(active && active.id !== m.id ? [{ ...active, trigger: null }] : []), { ...m, trigger: button }]);
  const openMacros = () => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page: "macro-studio" } }));

  if (button === "home") {
    return (
      <div className="map-editor-body">
        <p className="muted small">The PS button is reserved by the system, so it can't start a macro. Choose another button, or remap the PS button on the Controller tab.</p>
      </div>
    );
  }
  return (
    <div className="map-editor-body">
      <div className="map-field">
        <span className="map-field-label">Starts</span>
        {started.length === 0
          ? <p className="muted small">{label} doesn't start a macro.</p>
          : (
            <ul className="map-macro-list">
              {started.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong>
                  <span className="muted small">{MODES[m.mode].title}{m.enabled ? "" : " · turned off"}{m.blockTrigger ? ` · ${label} itself is not sent` : ""}</span>
                  <button type="button" className="btn-ghost small" disabled={busy} onClick={() => void save([{ ...m, trigger: null }])}>Remove from {label}</button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="map-field map-field-inline">
        <label className="map-field-label" htmlFor={`macro-${button}`}>{active ? "Replace with" : "Start a macro"}</label>
        <select id={`macro-${button}`} className="select" value={choice} disabled={busy || candidates.length === 0}
          onChange={(e) => setChoice(e.target.value)}>
          <option value="">{candidates.length === 0 ? "No other macros yet" : "Choose a macro…"}</option>
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>{m.name}{m.trigger ? ` (now on ${BUTTONS[m.trigger].name})` : ""}{m.enabled ? "" : " (turned off)"}</option>
          ))}
        </select>
        <button type="button" className="btn-primary small" disabled={!picked || busy} onClick={() => picked && void assign(picked)}>
          {busy ? "Saving…" : "Assign"}
        </button>
        <button type="button" className="btn-ghost small" onClick={openMacros}>Create or edit macros</button>
      </div>
      {picked && (picked.trigger || active) && (
        <p className="muted small">
          {picked.trigger ? `“${picked.name}” moves from ${BUTTONS[picked.trigger].name} to ${label}. ` : ""}
          {active ? `“${active.name}” stays saved without a button.` : ""}
        </p>
      )}
      {error && <div className="notice error small">{error}</div>}
      <p className="muted small">Macros start from the physical button, whatever it is mapped to.</p>
    </div>
  );
}
