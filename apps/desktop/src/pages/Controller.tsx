import { useEffect, useRef, useState } from "react";
import { ControllerVisual } from "../components/ControllerVisual";
import { ButtonChip } from "../components/macro/ButtonChip";
import { Advanced, Switch } from "../components/macro/common";
import {
  CurveEditor, Panel, Segmented, Slider, StickPlot, TriggerMeter,
} from "../components/controller/widgets";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { backendReady, outputLabel } from "../lib/format";
import { BUTTONS, pressedButtons } from "../lib/macros";
import {
  CURVE_PRESETS, STICK_PRESETS, curvePresetId, defaultProcessing, processStick, shapeMagnitude, triggerOutput, withDefaults,
} from "../lib/processing";
import {
  ButtonSelect, DeviceSelector, GyroTab, LayersPanel, LightingTab, StickCalibrationWizard, TouchpadTab,
  TriggerCalibrationWizard,
} from "../components/controller/advanced";
import type {
  DriverPresence, MacroButton, ProcessingConfig, StickConfig, TriggerConfig, VirtualOutputKind,
} from "../types/engine";

type Tab = "live" | "sticks" | "triggers" | "gyro" | "touchpad" | "buttons" | "output" | "lighting";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "live", label: "Live" },
  { id: "sticks", label: "Sticks" },
  { id: "triggers", label: "Triggers" },
  { id: "gyro", label: "Gyro" },
  { id: "touchpad", label: "Touchpad" },
  { id: "buttons", label: "Buttons" },
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

  useEffect(() => {
    if (connection.kind !== "ready" || JSON.stringify(draft) === lastSaved.current) return;
    setSave("saving");
    const t = setTimeout(async () => {
      try {
        const saved = await engineApi.setProcessing(draft);
        lastSaved.current = JSON.stringify(draft);
        setProfile(saved);
        setSave("saved");
      } catch (e) {
        setSave({ error: errorMessage(e) });
      }
    }, 300);
    return () => clearTimeout(t);
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
        {tab === "buttons" && <><ButtonsTab config={draft} onChange={setDraft} /><LayersPanel config={draft} onChange={setDraft} /></>}
        {tab === "output" && <OutputTab />}
        {tab === "lighting" && <LightingTab config={draft} onChange={setDraft} />}
      </div>
    </div>
  );
}

// ---- Live ----------------------------------------------------------------

function LiveTab({ config }: { config: ProcessingConfig }) {
  const device = usePrimaryDevice();
  const input = device?.input ?? null;
  const out = device?.processed ?? null;
  if (!input || !out) {
    return <div className="card"><p className="muted">Connect your controller to see live input. Nothing here is simulated.</p></div>;
  }
  return (
    <div className="live-grid">
      <Panel title="Your controller">
        <ControllerVisual state={input} live />
      </Panel>
      <Panel title="Sent to the game" aside={<span className="muted small">after settings, remapping and macros</span>}>
        <ControllerVisual state={out} live />
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
              <button key={p.id} className="preset" data-tip={p.hint} onClick={() => set(p.apply(c))}>{p.label}</button>
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

function ButtonsTab({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const device = usePrimaryDevice();
  const target = (b: MacroButton) => config.remap.find((r) => r.from === b);
  const setTarget = (from: MacroButton, value: string) => {
    const prev = config.remap.find((r) => r.from === from);
    const rest = config.remap.filter((r) => r.from !== from);
    const remap = value === "same" && !prev?.also?.length ? rest
      : [...rest, { from, to: value === "same" ? from : value === "off" ? null : (value as MacroButton), also: prev?.also ?? [] }];
    onChange({ ...config, remap });
  };
  const setAlso = (from: MacroButton, b: MacroButton | null) => {
    const prev = config.remap.find((r) => r.from === from);
    const rest = config.remap.filter((r) => r.from !== from);
    const to = prev ? prev.to : from;
    const remap = !b && to === from ? rest : [...rest, { from, to, also: b ? [b] : [] }];
    onChange({ ...config, remap });
  };
  const pressed = new Set(pressedButtons(device?.input));
  return (
    <Panel title="Button remapping" aside={
      config.remap.length > 0 && <button className="btn-ghost" onClick={() => onChange({ ...config, remap: [] })}>Reset all</button>
    }>
      <p className="muted small">Choose what each button sends to the game, and optionally a second button pressed at the same time. Press a button on your controller to find it in the list. Macros are always started by the physical button.</p>
      <div className="remap-list">
        {BUTTON_ORDER.map((b) => {
          const rule = target(b);
          const value = !rule || rule.to === b ? "same" : rule.to === null ? "off" : rule.to;
          return (
            <div key={b} className={`remap-row${pressed.has(b) ? " lit" : ""}${rule ? " changed" : ""}`}>
              <ButtonChip button={b} size="lg" active={pressed.has(b)} />
              <span className="remap-name">{BUTTONS[b].name}</span>
              <span className="muted" aria-hidden="true">→</span>
              <select className="select" value={value} aria-label={`${BUTTONS[b].name} sends`}
                onChange={(e) => setTarget(b, e.target.value)}>
                <option value="same">{BUTTONS[b].name} (normal)</option>
                <option value="off">Disabled</option>
                {BUTTON_ORDER.filter((x) => x !== b).map((x) => <option key={x} value={x}>{BUTTONS[x].name}</option>)}
              </select>
              <ButtonSelect label={`${BUTTONS[b].name} also presses`} value={rule?.also?.[0] ?? null} noneLabel="+ also press…"
                onChange={(x) => setAlso(b, x)} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---- Output --------------------------------------------------------------

const OUTPUTS: VirtualOutputKind[] = ["disabled", "xbox360", "dualShock4"];

function presence(p: DriverPresence | undefined) {
  return p === "installed" ? <span className="ok-text">Installed</span>
    : p === "notInstalled" ? <span className="muted">Not installed</span>
      : <span className="muted">Unknown (Windows only)</span>;
}

function OutputTab() {
  const { status, profile, setProfile, connection } = useEngine();
  const device = usePrimaryDevice();
  const [error, setError] = useState<string | null>(null);
  const requested = status?.requestedOutput ?? profile?.virtualOutput ?? "disabled";
  const active = device?.output.active ?? null;
  const backend = status?.outputBackendStatus;

  const choose = async (mode: VirtualOutputKind) => {
    setError(null);
    try { setProfile(await engineApi.setVirtualOutput(mode)); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div className="two-col">
      <Panel title="Virtual controller">
        <p className="muted small">The controller type games will see. Only one virtual controller exists per physical controller; switching removes the old one before creating the new one.</p>
        <div className="segmented" role="radiogroup" aria-label="Virtual output">
          {OUTPUTS.map((o) => (
            <button key={o} role="radio" aria-checked={requested === o} disabled={connection.kind !== "ready"}
              className={requested === o ? "selected" : ""} onClick={() => void choose(o)}>{outputLabel[o]}</button>
          ))}
        </div>
        <div className="kv-row"><span className="muted">Selected in profile</span><span>{outputLabel[requested]}</span></div>
        <div className="kv-row"><span className="muted">Virtual controller now</span>
          <span>{active ? <span className="ok-text">{outputLabel[active]} connected</span> : "Not connected"}</span></div>
        {backend && !backendReady(backend) && (
          <div className="notice warn"><strong>Not available yet.</strong> {backend.state === "unavailable" ? backend.reason : ""} Your choice is saved and will be used once virtual output is enabled.</div>
        )}
        {error && <div className="notice error">{error}</div>}
      </Panel>

      <Panel title="Drivers" aside={<button className="btn-ghost" disabled={connection.kind !== "ready"}
        onClick={() => void engineApi.refreshDrivers()}>Check again</button>}>
        <div className="kv-row"><span>ViGEmBus <span className="muted small">(virtual Xbox 360 / DualShock 4)</span></span>{presence(status?.drivers.vigembus)}</div>
        <div className="kv-row"><span>HidHide <span className="muted small">(hides the physical controller from games)</span></span>{presence(status?.drivers.hidhide)}</div>
        <p className="muted small">NEXUS never installs drivers silently. Both are optional third-party drivers that will be offered as a separate, explained step once virtual output is enabled. ViGEmBus is retired (no further security updates); details are in the NEXUS documentation.</p>
        <Advanced title="Why might games see two controllers?">
          <p className="muted small">When a virtual controller is active, games can also see your physical DualSense and react to both. HidHide can hide the physical controller from games while NEXUS keeps reading it. Until then, turn off PlayStation controller support in the game or Steam if you see double input.</p>
        </Advanced>
      </Panel>
    </div>
  );
}

