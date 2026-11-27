// Sticks, Triggers, Motion, Touchpad and Lighting & Haptics: one page each,
// all editing the active profile's processing settings (auto-saved).

import { useState } from "react";
import { Advanced, Switch } from "../components/macro/common";
import { CurveEditor, Panel, Segmented, Slider, StickPlot, TriggerMeter } from "../components/controller/widgets";
import { ProcessingPage } from "../components/controller/ProcessingPage";
import { StickButtonsPanel, StickRoutingPanel } from "../components/controller/StickMapping";
import { GyroTab, LightingTab, StickCalibrationWizard, TouchpadTab, TriggerCalibrationWizard } from "../components/controller/advanced";
import { usePrimaryDevice } from "../hooks/useEngine";
import {
  CURVE_PRESETS, STICK_PRESETS, applyStickPreset, curvePresetId, defaultProcessing, processStick, shapeMagnitude, triggerOutput,
} from "../lib/processing";
import type { ProcessingConfig, StickConfig, TriggerConfig } from "../types/engine";

export function SticksPage() {
  return (
    <ProcessingPage title="Sticks" description="Deadzones, sensitivity, response curves and calibration for both sticks. Saved to the active profile automatically.">
      {(config, onChange) => <SticksTab config={config} onChange={onChange} />}
    </ProcessingPage>
  );
}

export function TriggersPage() {
  return (
    <ProcessingPage title="Triggers" description="How far L2 and R2 travel, where they click and what range games receive. Saved to the active profile automatically.">
      {(config, onChange) => <TriggersTab config={config} onChange={onChange} />}
    </ProcessingPage>
  );
}

export function MotionPage() {
  return (
    <ProcessingPage title="Motion" description="Aim with the controller's gyroscope: when it is active, how sensitive it is and which stick it moves. Saved to the active profile automatically.">
      {(config, onChange) => <div className="tab-body"><GyroTab config={config} onChange={onChange} /></div>}
    </ProcessingPage>
  );
}

export function TouchpadPage() {
  return (
    <ProcessingPage title="Touchpad" description="Split the touchpad into zones and turn swipes into buttons. Saved to the active profile automatically.">
      {(config, onChange) => <div className="tab-body"><TouchpadTab config={config} onChange={onChange} /></div>}
    </ProcessingPage>
  );
}

export function LightingPage() {
  return (
    <ProcessingPage title="Lighting & Haptics" needsEngine={false}
      description="Lightbar colour, player lights and vibration. Saved to the active profile automatically.">
      {(config, onChange) => <div className="tab-body"><LightingTab config={config} onChange={onChange} /></div>}
    </ProcessingPage>
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
