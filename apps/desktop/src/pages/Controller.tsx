import { useEffect, useMemo, useRef, useState } from "react";
import { ControllerVisual } from "../components/ControllerVisual";
import { ButtonChip } from "../components/macro/ButtonChip";
import { Advanced, Switch } from "../components/macro/common";
import {
  CurveEditor, Panel, Segmented, Slider, StickPlot, TriggerMeter,
} from "../components/controller/widgets";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { backendReady, outputLabel } from "../lib/format";
import { doubleInputAdvice, HIDHIDE_RELEASES } from "../lib/hidhide";
import { outputSummary } from "../lib/outputStatus";
import { buttonMapping, buttonMarks, describeMapping } from "../lib/buttonMapping";
import { isCalibratedPhoto, savePhoto, useControllerPhoto } from "../lib/controllerPhoto";
import { useShownModel } from "../hooks/useShownModel";
import { saveViewMode, useViewMode } from "../lib/controllerViewMode";
import { BUTTONS, pressedButtons } from "../lib/macros";
import {
  EMPTY_HISTORY, recordEdit, redoRemap, setRemapAlso, setRemapTarget, undoRemap, type RemapHistory,
} from "../lib/mappingView";
import { MappingView } from "../components/controller/MappingView";
import { CopyText } from "../components/CopyText";
import { CombosPanel } from "../components/controller/CombosPanel";
import { StickButtonsPanel, StickRoutingPanel } from "../components/controller/StickMapping";
import {
  CURVE_PRESETS, STICK_PRESETS, applyStickPreset, curvePresetId, defaultProcessing, processStick, shapeMagnitude, triggerOutput, withDefaults,
} from "../lib/processing";
import {
  ButtonSelect, DeviceSelector, GyroTab, LayersPanel, LightingTab, StickCalibrationWizard, TouchpadTab,
  TriggerCalibrationWizard,
} from "../components/controller/advanced";
import type {
  ControllerState, RemapRule, DriverPresence, Macro, MacroButton, ProcessingConfig, StickConfig, TriggerConfig, VirtualOutputKind,
} from "../types/engine";

type Tab = "live" | "sticks" | "triggers" | "gyro" | "touchpad" | "buttons" | "output" | "lighting";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "live", label: "Live" },
  { id: "sticks", label: "Sticks" },
  { id: "triggers", label: "Triggers" },
  { id: "gyro", label: "Gyro" },
  { id: "touchpad", label: "Touchpad" },
  { id: "buttons", label: "Mapping" },
  { id: "output", label: "Virtual Output" },
  { id: "lighting", label: "Lighting & Haptics" },
];

type Save = "saved" | "saving" | { error: string };

/** Editing state for the active profile's processing settings, auto-saved. */
function useProcessingDraft() {
  const { profile, setProfile, connection } = useEngine();
  const [draft, setDraft] = useState<ProcessingConfig>(withDefaults(profile?.processing));
  const [save, setSave] = useState<Save>("saved");
  const lastSaved = useRef(JSON.stringify(withDefaults(profile?.processing)));
  const profileId = profile?.id;

  // Switching profile loads its settings.
  useEffect(() => {
    if (!profile) return;
    setDraft(withDefaults(profile.processing));
    lastSaved.current = JSON.stringify(withDefaults(profile.processing));
    setSave("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // The profile the draft belongs to (current at every render).
  const draftProfile = useRef(profileId);
  draftProfile.current = profileId;

  useEffect(() => {
    if (connection.kind !== "ready" || JSON.stringify(draft) === lastSaved.current) return;
    setSave("saving");
    const owner = profileId;
    const t = setTimeout(async () => {
      try {
        // Saved to the profile it was edited in, even if a game switched the
        // active profile meanwhile.
        const saved = await engineApi.setProcessing(draft, owner);
        if (draftProfile.current !== owner) return; // switched away: nothing to show
        lastSaved.current = JSON.stringify(draft);
        setProfile(saved);
        setSave("saved");
      } catch (e) {
        if (draftProfile.current === owner) setSave({ error: errorMessage(e) });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, connection.kind, setProfile]);

  return { draft, setDraft, save };
}

export function Controller({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? (initialTab as Tab) : "live");
  const { profile, connection } = useEngine();
  const { draft, setDraft, save } = useProcessingDraft();
  const ready = connection.kind === "ready";

  return (
    <div className="page controller-page">
      <header className="page-header">
        <div>
          <h1>Controller</h1>
          <p className="muted">Tune sticks and triggers, remap buttons and choose the virtual controller. Settings are saved to the profile <b>{profile?.name ?? "—"}</b> automatically.</p>
        </div>
        {ready && (
          <span className={`save-state ${typeof save === "string" && save === "saved" ? "ok" : typeof save === "object" ? "err" : ""}`} role="status">
            {save === "saved" ? "✓ Saved to profile" : save === "saving" ? "Saving…" : `Not saved: ${save.error}`}
          </span>
        )}
      </header>

      <DeviceSelector />

      <nav className="tabs" role="tablist" aria-label="Controller settings">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "selected" : ""}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      {!ready && tab !== "lighting" && <div className="notice dev">Controller settings are available in the desktop app.</div>}

      <div className="tab-body" key={tab}>
        {tab === "live" && <LiveTab config={draft} />}
        {tab === "sticks" && <SticksTab config={draft} onChange={setDraft} />}
        {tab === "triggers" && <TriggersTab config={draft} onChange={setDraft} />}
        {tab === "gyro" && <GyroTab config={draft} onChange={setDraft} />}
        {tab === "touchpad" && <TouchpadTab config={draft} onChange={setDraft} />}
        {tab === "buttons" && <><ButtonsTab key={profile?.id ?? 0} config={draft} onChange={setDraft} output={profile?.virtualOutput ?? "xbox360"}
          onOpenOutput={() => setTab("output")} /><LayersPanel config={draft} onChange={setDraft} /><CombosPanel config={draft} onChange={setDraft} /></>}
        {tab === "output" && <OutputTab />}
        {tab === "lighting" && <LightingTab config={draft} onChange={setDraft} />}
      </div>
    </div>
  );
}

// ---- Live ----------------------------------------------------------------

function LiveTab({ config }: { config: ProcessingConfig }) {
  const device = usePrimaryDevice();
  const { connection } = useEngine();
  const input = device?.input ?? null;
  const out = device?.processed ?? null;
  const [selected, setSelected] = useState<MacroButton | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  useEffect(() => {
    if (connection.kind === "ready") engineApi.listMacros().then(setMacros).catch(() => setMacros([]));
  }, [connection.kind]);
  const marks = useMemo(() => buttonMarks(BUTTON_ORDER, config, macros), [config, macros]);
  if (!input || !out) {
    return <div className="card"><p className="muted">Connect your controller to see live input. Nothing here is simulated.</p></div>;
  }
  const mapping = selected ? buttonMapping(selected, config, macros) : null;
  return (
    <div className="live-grid">
      <Panel title="Your controller" aside={<span className="muted small">click a button to see its mapping</span>}>
        <ControllerVisual state={input} live selected={selected} marks={marks}
          onSelect={(b) => setSelected((cur) => (cur === b ? null : b))} />
        <div className="controller-legend" aria-hidden="true">
          <span><i className="l-pressed" />Pressed</span>
          <span><i className="l-selected" />Selected</span>
          <span><i className="l-remapped" />Remapped</span>
          <span><i className="l-macro" />Starts a macro</span>
          <span><i className="l-disabled" />Disabled</span>
          <span><i className="l-special" />Layer or gyro</span>
        </div>
        <PhotoPicker />
        {mapping && (
          <div className="mapping-card" aria-live="polite">
            <h4>{BUTTONS[mapping.button].name}<span className="mapping-kind">{mapping.kind}</span></h4>
            <ul>{describeMapping(mapping, (b) => BUTTONS[b].name).map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="muted small">Change it under Buttons, Macro Studio or the layer settings.</p>
          </div>
        )}
      </Panel>
      <Panel title="Sent to the game" aside={<span className="muted small">after settings, remapping and macros</span>}>
        <ControllerVisual state={out} live flat />
      </Panel>
      <Panel title="Sticks">
        <div className="row gap wrap">
          <StickPlot label="Left stick" config={config.leftStick}
            raw={[input.leftStick.x, input.leftStick.y]} processed={[out.leftStick.x, out.leftStick.y]} />
          <StickPlot label="Right stick" config={config.rightStick}
            raw={[input.rightStick.x, input.rightStick.y]} processed={[out.rightStick.x, out.rightStick.y]} />
        </div>
      </Panel>
      <Panel title="Triggers">
        <TriggerMeter label="L2" raw={input.leftTrigger.value} processed={out.leftTrigger.value}
          deadzone={config.leftTrigger.deadzone} maxInput={config.leftTrigger.maxInput} />
        <TriggerMeter label="R2" raw={input.rightTrigger.value} processed={out.rightTrigger.value}
          deadzone={config.rightTrigger.deadzone} maxInput={config.rightTrigger.maxInput} />
      </Panel>
    </div>
  );
}

/**
 * Optional: show your own controller photo instead of the drawing. The file
 * stays on this PC (webview storage); NEXUS accepts only the image its
 * overlay was aligned to.
 */
function PhotoPicker() {
  const photo = useControllerPhoto();
  const mode = useViewMode();
  // The photo option is a DualSense photograph; a DualShock 4 is always drawn.
  const ds4 = useShownModel() === "dualShock4";
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    const bytes = await file.arrayBuffer();
    if (!(await isCalibratedPhoto(bytes))) {
      setMessage({ tone: "error", text: "This isn't the picture the overlay positions were measured on, so buttons wouldn't line up. NEXUS keeps the drawn controller." });
      return;
    }
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setMessage(savePhoto(url)
      ? { tone: "ok", text: "Photo set. It is kept on this PC only." }
      : { tone: "error", text: "Couldn't store the photo on this PC." });
  };
  return (
    <div className="photo-picker">
      <div className="segmented small" role="group" aria-label="Controller picture">
        <button type="button" className={mode === "3d" ? "selected" : ""} aria-pressed={mode === "3d"} onClick={() => saveViewMode("3d")}>3D</button>
        <button type="button" className={mode === "flat" ? "selected" : ""} aria-pressed={mode === "flat"} onClick={() => saveViewMode("flat")}>2D</button>
      </div>
      <span className="muted">{mode === "3d" ? "Interactive 3D model"
        : ds4 ? `2D picture: drawn DualShock 4${photo ? " (your photo is of a DualSense and shows with a DualSense)" : ""}`
        : `2D picture: ${photo ? "your photo" : "drawn"}`}</span>
      <input ref={input} type="file" accept="image/jpeg,image/png" hidden
        onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      {mode === "flat" && !ds4 && <button className="btn-ghost small" onClick={() => input.current?.click()}>Use my photo…</button>}
      {mode === "flat" && !ds4 && photo && <button className="btn-ghost small" onClick={() => { savePhoto(null); setMessage(null); }}>Use drawing</button>}
      {message && <span className={message.tone === "ok" ? "ok-text" : "warn-text"}>{message.text}</span>}
    </div>
  );
}

// ---- Sticks --------------------------------------------------------------

function SticksTab({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const [side, setSide] = useState<"leftStick" | "rightStick">("leftStick");
  const device = usePrimaryDevice();
  const c = config[side];
  const set = (patch: Partial<StickConfig>) => onChange({ ...config, [side]: { ...c, ...patch } });
  const physical = device?.input ? device.input[side] : null;
  const raw: [number, number] | null = physical ? [physical.x, physical.y] : null;
  const processed = raw ? processStick(c, raw[0], raw[1]) : null;
  const deflection = raw ? Math.min(1, Math.hypot(raw[0], raw[1])) : null;
  const liveN = deflection !== null && deflection > c.deadzone
    ? Math.min(1, (deflection - c.deadzone) / Math.max(1e-6, 1 - c.deadzone - c.outerDeadzone)) : null;

  return (
    <div className="tune-grid">
      <div className="tune-controls">
        <div className="row gap wrap">
          <Segmented label="Stick" value={side} onChange={setSide}
            options={[{ value: "leftStick", label: "Left stick" }, { value: "rightStick", label: "Right stick" }]} />
          <button className="btn-ghost" data-tip="Copy these settings to the other stick"
            onClick={() => onChange({ ...config, [side === "leftStick" ? "rightStick" : "leftStick"]: { ...c } })}>
            Copy to {side === "leftStick" ? "right" : "left"} stick
          </button>
        </div>

        <Panel title="Quick setup">
          <div className="preset-row">
            {STICK_PRESETS.map((p) => (
              <button key={p.id} className="preset" data-tip={p.hint} onClick={() => set(applyStickPreset(p, c))}>{p.label}</button>
            ))}
          </div>
        </Panel>

        <Panel title="Calibration">
          <p className="muted small">If your stick doesn't rest exactly at the centre or can't reach the edge, calibrate it.</p>
          <StickCalibrationWizard side={side} calibration={c.calibration} onSave={(calibration) => set({ calibration })} />
        </Panel>

        <Panel title="Deadzone and sensitivity">
          <Slider label="Deadzone" tip="Small movements below this are ignored (hides stick drift)"
            value={c.deadzone} max={0.5} onChange={(deadzone) => set({ deadzone })} />
          <Slider label="Sensitivity" tip="How strongly the stick responds" value={c.sensitivity}
            min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(sensitivity) => set({ sensitivity })} />
          <Advanced>
            <Slider label="Outer deadzone" tip="Reach full output before the stick hits its edge"
              value={c.outerDeadzone} max={0.5} onChange={(outerDeadzone) => set({ outerDeadzone })} />
            <Slider label="Anti-deadzone" tip="Minimum output once you move past the deadzone. Use it to cancel a game's own deadzone."
              value={c.antiDeadzone} max={0.9} onChange={(antiDeadzone) => set({ antiDeadzone })} />
            <div className="field-row">
              <span className="field-label" data-tip="Radial is recommended; axial treats each direction separately">Deadzone shape</span>
              <Segmented label="Deadzone shape" value={c.shape} onChange={(shape) => set({ shape })}
                options={[{ value: "radial", label: "Radial" }, { value: "axial", label: "Axial" }]} />
            </div>
            <Slider label="Left/right sensitivity" tip="Extra multiplier for horizontal movement" value={c.sensitivityX}
              min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(sensitivityX) => set({ sensitivityX })} />
            <Slider label="Up/down sensitivity" tip="Extra multiplier for vertical movement" value={c.sensitivityY}
              min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(sensitivityY) => set({ sensitivityY })} />
            <div className="field-row">
              <span className="field-label" data-tip="Circle: diagonals aren't faster. Square: full range on diagonals for games that expect it.">Output shape</span>
              <Segmented label="Output shape" value={c.squareOutput ? "square" : c.circular ? "circle" : "raw"}
                onChange={(v) => set({ squareOutput: v === "square", circular: v === "circle" })}
                options={[{ value: "circle", label: "Circle" }, { value: "square", label: "Square" }, { value: "raw", label: "Unchanged" }]} />
            </div>
            <Switch checked={c.invertX} onChange={(invertX) => set({ invertX })} label="Invert left/right" />
            <Switch checked={c.invertY} onChange={(invertY) => set({ invertY })} label="Invert up/down" />
          </Advanced>
        </Panel>

        <StickButtonsPanel key={side} side={side} buttons={c.buttons} onChange={(buttons) => set({ buttons })} processed={processed} />
        <StickRoutingPanel config={config} onChange={onChange} />
      </div>

      <div className="tune-preview">
        <Panel title="Response curve">
          <div className="preset-row">
            {CURVE_PRESETS.map((p) => (
              <button key={p.id} className={`preset${curvePresetId(c.curve) === p.id ? " selected" : ""}`} data-tip={p.hint}
                onClick={() => set({ curve: p.curve })}>{p.label}</button>
            ))}
            <button className={`preset${c.curve.type === "custom" ? " selected" : ""}`} data-tip="Draw your own curve"
              onClick={() => set({ curve: { type: "custom", points: [{ x: 0.5, y: 0.5 }] } })}>Custom</button>
          </div>
          <CurveEditor curve={c.curve} onChange={(curve) => set({ curve })} liveInput={liveN} />
          {c.curve.type === "power" && (
            <Slider label="Curve strength" tip="Above 1: more precise near the centre. Below 1: faster."
              value={c.curve.exponent} min={0.3} max={3} step={0.05} format={(v) => v.toFixed(2)}
              onChange={(exponent) => set({ curve: { type: "power", exponent } })} />
          )}
        </Panel>
        <Panel title="Preview">
          <StickPlot label={side === "leftStick" ? "Left stick" : "Right stick"} config={c} raw={raw} processed={processed} />
          {!raw && <p className="muted small">Connect your controller and move the stick to preview the settings.</p>}
          <p className="muted small">Half deflection gives {Math.round(shapeMagnitude(c, 0.5) * 100)}% output.</p>
        </Panel>
      </div>
    </div>
  );
}

// ---- Triggers ------------------------------------------------------------

function TriggersTab({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const device = usePrimaryDevice();
  const one = (key: "leftTrigger" | "rightTrigger", label: string) => {
    const c = config[key];
    const set = (patch: Partial<TriggerConfig>) => {
      const next = { ...c, ...patch };
      next.maxInput = Math.max(next.maxInput, next.deadzone + 0.05);
      next.outputMax = Math.max(next.outputMax, next.outputMin);
      onChange({ ...config, [key]: next });
    };
    const raw = device?.input ? device.input[key].value : 0;
    return (
      <Panel title={label}>
        <TriggerMeter label="Live" raw={raw} processed={triggerOutput(c, raw)} deadzone={c.deadzone} maxInput={c.maxInput} />
        <Slider label="Deadzone" tip="Light presses below this are ignored" value={c.deadzone} max={0.9}
          onChange={(deadzone) => set({ deadzone })} />
        <Slider label="Full press at" tip="Counts as fully pressed from this point (shorter trigger travel)"
          value={c.maxInput} min={0.1} max={1} onChange={(maxInput) => set({ maxInput })} />
        <Slider label="Click point" tip="How far you pull before the trigger counts as a button press (for remapping and digital games)"
          value={c.activation} min={0.01} max={1} onChange={(activation) => set({ activation })} />
        <Slider label="Sensitivity" tip="Below 1: reaches full output sooner. Above 1: more control at the start."
          value={c.curve} min={0.3} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(curve) => set({ curve })} />
        <TriggerCalibrationWizard side={key} rawMin={c.rawMin} rawMax={c.rawMax} onSave={(rawMin, rawMax) => set({ rawMin, rawMax })} />
        <Advanced title="Output range">
          <Slider label="Minimum output" tip="Output as soon as the trigger passes its deadzone" value={c.outputMin}
            onChange={(outputMin) => set({ outputMin })} />
          <Slider label="Maximum output" tip="Output at a full press" value={c.outputMax}
            onChange={(outputMax) => set({ outputMax })} />
        </Advanced>
        <button className="btn-ghost" onClick={() => onChange({ ...config, [key]: defaultProcessing()[key] })}>Reset {label}</button>
      </Panel>
    );
  };
  return (
    <div className="two-col">
      {one("leftTrigger", "L2 (left trigger)")}
      {one("rightTrigger", "R2 (right trigger)")}
      <p className="muted small span-2">Trigger settings apply to the analog value games receive. DualSense adaptive trigger effects are not available yet (see Lighting & Haptics).</p>
    </div>
  );
}

// ---- Buttons -------------------------------------------------------------

const BUTTON_ORDER: MacroButton[] = [
  "south", "east", "west", "north", "leftShoulder", "rightShoulder", "leftTrigger", "rightTrigger",
  "leftStick", "rightStick", "dpadUp", "dpadDown", "dpadLeft", "dpadRight", "select", "start", "touchpad", "home", "mute",
];

function ButtonsTab({ config, onChange, output, onOpenOutput }: {
  config: ProcessingConfig; onChange: (c: ProcessingConfig) => void; output: VirtualOutputKind; onOpenOutput: () => void;
}) {
  const device = usePrimaryDevice();
  const { connection } = useEngine();
  const [view, setView] = useState<"picture" | "list">(() => {
    try { return localStorage.getItem(MAPPING_VIEW_KEY) === "list" ? "list" : "picture"; } catch { return "picture"; }
  });
  const [history, setHistory] = useState<RemapHistory>(EMPTY_HISTORY);
  const [macros, setMacros] = useState<Macro[]>([]);
  useEffect(() => {
    if (connection.kind === "ready") engineApi.listMacros().then(setMacros).catch(() => setMacros([]));
  }, [connection.kind]);

  /** Every remap change goes through here so it can be undone. */
  const edit = (next: ProcessingConfig) => {
    setHistory((h) => recordEdit(h, config.remap, next.remap));
    onChange(next);
  };
  const step = (r: { history: RemapHistory; remap: RemapRule[] } | null) => {
    if (!r) return;
    setHistory(r.history);
    onChange({ ...config, remap: r.remap });
  };
  const chooseView = (v: "picture" | "list") => {
    setView(v);
    try { localStorage.setItem(MAPPING_VIEW_KEY, v); } catch { /* per-viewer convenience only */ }
  };
  const input = device?.input ?? null;

  return (
    <Panel title="Mapping" aside={
      <div className="row gap map-toolbar">
        <button type="button" className="btn-ghost small" disabled={history.past.length === 0}
          onClick={() => step(undoRemap(history, config.remap))} title="Undo">↶ Undo</button>
        <button type="button" className="btn-ghost small" disabled={history.future.length === 0}
          onClick={() => step(redoRemap(history, config.remap))} title="Redo">↷ Redo</button>
        <div className="segmented small" role="group" aria-label="View">
          <button type="button" className={view === "picture" ? "selected" : ""} aria-pressed={view === "picture"} onClick={() => chooseView("picture")}>Picture</button>
          <button type="button" className={view === "list" ? "selected" : ""} aria-pressed={view === "list"} onClick={() => chooseView("list")}>List</button>
        </div>
        <button type="button" className="btn-ghost small" disabled={config.remap.length === 0}
          onClick={() => edit({ ...config, remap: [] })}>Reset all</button>
      </div>
    }>
      <p className="muted small">
        {view === "picture" ? "Click any control on the pad to remap it. " : "Press a button on your controller to find it in the list. "}
        Saved to your profile. Games receive it once the <button type="button" className="map-link" onClick={onOpenOutput}>virtual controller</button> is
        on{output === "disabled" ? " (it is off in this profile)" : ""}. Macros are always started by the physical button.
      </p>
      {view === "picture"
        ? <MappingView config={config} onEdit={edit} input={input} output={output} macros={macros} onOpenOutput={onOpenOutput} />
        : <ButtonList config={config} onEdit={edit} input={input} />}
    </Panel>
  );
}

const MAPPING_VIEW_KEY = "nexus.mappingView";

/** The original list: one row per button with what it sends and an optional second button. */
function ButtonList({ config, onEdit, input }: { config: ProcessingConfig; onEdit: (c: ProcessingConfig) => void; input: ControllerState | null }) {
  const pressed = new Set(pressedButtons(input));
  return (
    <div className="remap-list">
      {BUTTON_ORDER.map((b) => {
        const rule = config.remap.find((r) => r.from === b);
        const value = !rule || rule.to === b ? "same" : rule.to === null ? "off" : rule.to;
        return (
          <div key={b} className={`remap-row${pressed.has(b) ? " lit" : ""}${rule ? " changed" : ""}`}>
            <ButtonChip button={b} size="lg" active={pressed.has(b)} />
            <span className="remap-name">{BUTTONS[b].name}</span>
            <span className="muted" aria-hidden="true">→</span>
            <select className="select" value={value} aria-label={`${BUTTONS[b].name} sends`}
              onChange={(e) => onEdit(setRemapTarget(config, b, e.target.value as MacroButton | "same" | "off"))}>
              <option value="same">{BUTTONS[b].name} (normal)</option>
              <option value="off">Disabled</option>
              {BUTTON_ORDER.filter((x) => x !== b).map((x) => <option key={x} value={x}>{BUTTONS[x].name}</option>)}
            </select>
            <ButtonSelect label={`${BUTTONS[b].name} also presses`} value={rule?.also?.[0] ?? null} noneLabel="+ also press…"
              onChange={(x) => onEdit(setRemapAlso(config, b, x))} />
          </div>
        );
      })}
    </div>
  );
}

// ---- Output --------------------------------------------------------------

const OUTPUTS: VirtualOutputKind[] = ["disabled", "xbox360", "dualShock4"];
export const VIGEMBUS_RELEASES = "https://github.com/nefarius/ViGEmBus/releases";

function presence(p: DriverPresence | undefined) {
  return p === "installed" ? <span className="ok-text">Installed</span>
    : p === "notInstalled" ? <span className="muted">Not installed</span>
      : <span className="muted">Unknown (Windows only)</span>;
}

function OutputTab() {
  const { status, profile, setProfile, connection } = useEngine();
  const device = usePrimaryDevice();
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = connection.kind === "ready";
  const requested = status?.requestedOutput ?? "disabled";
  const saved = profile?.virtualOutput ?? "disabled";
  const active = device?.output.active ?? null;
  const backend = status?.outputBackendStatus;
  const driverReady = !!backend && backendReady(backend);
  const outputError = device?.output.lastError ?? null;
  const summary = outputSummary({ output: device?.output ?? null, requested, consent, driverReady });

  useEffect(() => {
    if (ready) engineApi.getOutputConsent().then((c) => setConsent(c.enabled)).catch(() => setConsent(false));
  }, [ready]);

  const choose = async (mode: VirtualOutputKind) => {
    setError(null);
    try { setProfile(await engineApi.setVirtualOutput(mode)); } catch (e) { setError(errorMessage(e)); }
  };
  const toggleConsent = async (on: boolean) => {
    setError(null);
    try { setConsent((await engineApi.setOutputConsent(on)).enabled); } catch (e) { setError(errorMessage(e)); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(VIGEMBUS_RELEASES); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="two-col">
      <Panel title="Virtual controller (experimental)">
        <p className="muted small">
          Games receive your remaps and macros through a virtual <b>Xbox 360 controller</b> that NEXUS creates.
          This needs ViGEmBus, a free third-party driver that you install yourself. It was retired by its developer in 2023,
          so NEXUS treats it as experimental and may replace it later.
        </p>
        <Switch checked={!!consent} disabled={!ready || consent === null} onChange={(on) => void toggleConsent(on)}
          label="Use the experimental virtual controller"
          tip="Off removes the virtual controller immediately; your profile's choice is kept" />
        <div className="segmented" role="radiogroup" aria-label="Virtual output">
          {OUTPUTS.map((o) => {
            const unavailable = o === "dualShock4" || (o !== "disabled" && !consent);
            return (
              <button key={o} role="radio" aria-checked={requested === o} disabled={!ready || unavailable}
                title={o === "dualShock4" ? "Not available in this beta" : o !== "disabled" && !consent ? "Turn on the experimental virtual controller first" : undefined}
                className={requested === o ? "selected" : ""} onClick={() => void choose(o)}>
                {outputLabel[o]}{o === "dualShock4" ? " (later)" : ""}
              </button>
            );
          })}
        </div>
        <div className="kv-row"><span className="muted">Saved in this profile</span><span>{outputLabel[saved]}</span></div>
        <div className="kv-row"><span className="muted">Virtual controller now</span>
          <span className={summary.tone === "ok" ? "ok-text" : summary.tone === "warn" ? "warn-text" : undefined}>{summary.text}</span></div>
        {summary.detail && !outputError && <div className={summary.tone === "warn" ? "notice warn small" : "muted small"}>{summary.detail}</div>}
        {outputError && <div className="notice error">{outputError}</div>}
        {error && <div className="notice error">{error}</div>}
        {active && (
          <p className="muted small">
            Check it in Windows: press <kbd>Win</kbd> + <kbd>R</kbd>, type <code>joy.cpl</code> and press Enter. “Controller (XBOX 360 For Windows)”
            should be listed; its Properties page shows the buttons NEXUS sends, including macros.
          </p>
        )}
      </Panel>

      <Panel title="Driver" aside={<button className="btn-ghost" disabled={!ready}
        onClick={() => void engineApi.refreshDrivers()}>Check again</button>}>
        <div className="kv-row"><span>ViGEmBus <span className="muted small">(virtual Xbox 360)</span></span>
          {driverReady ? <span className="ok-text">Installed and ready</span> : presence(status?.drivers.vigembus)}</div>
        {!driverReady && backend?.state === "unavailable" && status?.drivers.vigembus === "installed" && (
          <div className="notice warn small">{backend.reason}</div>
        )}
        {!driverReady && (
          <ol className="small driver-steps">
            <li>Open the official ViGEmBus release page:{" "}
              <code className="mono break">{VIGEMBUS_RELEASES}</code>{" "}
              <button className="btn-ghost small" onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</button></li>
            <li>Download <b>ViGEmBus_1.22.0_x64_x86_arm64.exe</b> (the latest release) and run it. Windows asks for administrator approval: this is the driver's installer, not NEXUS.</li>
            <li>Come back here and click <b>Check again</b>.</li>
          </ol>
        )}
        <p className="muted small">
          NEXUS never installs or bundles drivers. To remove ViGEmBus later: Windows Settings › Apps › Installed apps ›
          “Nefarius Virtual Gamepad Emulation Bus Driver” › Uninstall. NEXUS keeps working without it; games then simply don't see a virtual controller.
        </p>
        <div className="kv-row"><span>HidHide <span className="muted small">(optional, see “Avoid double input” below)</span></span>{presence(status?.drivers.hidhide)}</div>
      </Panel>

      <div className="span-2">
        <DoubleInputPanel outputActive={!!active} controllerConnected={!!device} />
      </div>
    </div>
  );
}

/** Optional HidHide guide. NEXUS never installs HidHide or changes its settings. */
function DoubleInputPanel({ outputActive, controllerConnected }: { outputActive: boolean; controllerConnected: boolean }) {
  const { status, appInfo } = useEngine();
  const hidhide = status?.drivers.hidhide;
  const advice = doubleInputAdvice({ hidhide, outputActive, controllerConnected });
  return (
    <Panel title="Avoid double input (optional)">
      <p className="muted small">
        Games and Steam can see <b>both</b> your physical DualSense or DualShock 4 and the virtual Xbox controller, so a press may count twice.
        HidHide, a free optional driver by the same developer as ViGEmBus, can hide your controller from games while NEXUS keeps reading it.
        NEXUS never installs HidHide or changes its settings; you set it up once in HidHide's own app. It is not required.
      </p>
      <div className="kv-row"><span>HidHide</span>{presence(hidhide)}</div>
      {advice === "suggestHidHide" && (
        <div className="notice dev small">If a game or Steam reacts twice to one press, use HidHide (below) or turn off PlayStation controller support in that game or in Steam.</div>
      )}
      {advice === "checkApplicationsList" && (
        <div className="notice warn small">
          HidHide is installed and NEXUS sees no controller. If your controller is plugged in, HidHide may be hiding it from NEXUS too:
          add NEXUS to HidHide's <b>Applications</b> list (step 2 below), or untick <b>Enable device hiding</b>.
        </div>
      )}
      <div className="kv-row"><span className="muted">NEXUS program path</span>
        {appInfo?.exePath ? <CopyText text={appInfo.exePath} /> : <span className="muted">Unknown</span>}</div>

      <Advanced title="1. Install HidHide (once)">
        <ol className="small driver-steps">
          <li>Open the official release page: <CopyText text={HIDHIDE_RELEASES} /></li>
          <li>Download the latest <b>HidHide_…_x64.exe</b> and run it. Windows asks for administrator approval for the driver installer; NEXUS itself never needs it.</li>
          <li>Restart Windows if the installer asks, then click <b>Check again</b> in the Driver panel.</li>
        </ol>
      </Advanced>
      <Advanced title="2. Keep NEXUS allowed, hide your controller from games">
        <ol className="small driver-steps">
          <li>Start <b>HidHide Configuration Client</b> from the Start menu.</li>
          <li><b>Applications</b> tab: click <b>+</b> and choose the NEXUS program (path above). Only NEXUS goes here: not Steam, not games.</li>
          <li><b>Devices</b> tab: tick <b>DualSense Wireless Controller</b> (a DualShock 4 is listed as <b>Wireless Controller</b>). Do <b>not</b> tick the Xbox 360 controller; that one is NEXUS's output.</li>
          <li>Tick <b>Enable device hiding</b>.</li>
          <li>Check: in NEXUS the controller stays connected. In <code>joy.cpl</code> (Win + R) only “Controller (XBOX 360 For Windows)” is listed.</li>
        </ol>
        <p className="muted small">
          While hiding is on, games see <b>no</b> controller when NEXUS is closed. Untick <b>Enable device hiding</b> when you play without NEXUS.
          Plugging into a different USB port may show the controller as a new device: tick it again in the Devices tab.
        </p>
      </Advanced>
      <Advanced title="Undo or recover">
        <ul className="small driver-steps">
          <li><b>Show the controller to games again:</b> HidHide Configuration Client → untick <b>Enable device hiding</b>.</li>
          <li><b>NEXUS lost the controller after setup:</b> NEXUS is missing from the Applications list (or its path changed): add it again, or untick Enable device hiding.</li>
          <li><b>Remove HidHide completely:</b> Windows Settings › Apps › Installed apps › <b>HidHide</b> › Uninstall, then restart if asked. Every device is visible again; NEXUS keeps working.</li>
        </ul>
      </Advanced>
    </Panel>
  );
}

