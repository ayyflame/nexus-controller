import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEngine, usePrimaryDevice } from "../../hooks/useEngine";
import { engineApi, errorMessage } from "../../lib/engine";
import { connectionLabel, modelLabel } from "../../lib/format";
import { BUTTONS } from "../../lib/macros";
import { DEFAULT_CALIBRATION, pct, processStick } from "../../lib/processing";
import type {
  ConfigConflict, GyroConfig, LayerMode, MacroButton, MappingLayer, ProcessingConfig, RemapRule,
  StickCalibration, TouchLayout,
} from "../../types/engine";
import { ButtonChip } from "../macro/ButtonChip";
import { Advanced, ConfirmDialog, Switch } from "../macro/common";
import { Panel, Segmented, Slider, StickPlot } from "./widgets";

export const ALL_BUTTONS: MacroButton[] = [
  "south", "east", "west", "north", "leftShoulder", "rightShoulder", "leftTrigger", "rightTrigger",
  "leftStick", "rightStick", "dpadUp", "dpadDown", "dpadLeft", "dpadRight", "select", "start", "touchpad", "home", "mute",
];

/** Dropdown of controller buttons, with an optional "none" choice. */
export function ButtonSelect({ value, onChange, noneLabel, label, exclude = [] }: {
  value: MacroButton | null; onChange: (b: MacroButton | null) => void; noneLabel?: string; label: string;
  exclude?: MacroButton[];
}) {
  return (
    <select className="select" aria-label={label} value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? (e.target.value as MacroButton) : null)}>
      {noneLabel !== undefined && <option value="">{noneLabel}</option>}
      {ALL_BUTTONS.filter((b) => !exclude.includes(b) || b === value).map((b) => (
        <option key={b} value={b}>{BUTTONS[b].name}</option>
      ))}
    </select>
  );
}

export function Unverified({ children }: { children?: ReactNode }) {
  return (
    <div className="notice dev small">
      <strong>Not yet verified with a real DualSense.</strong> {children}
    </div>
  );
}

// ---- Multiple controllers -----------------------------------------------------

export function DeviceSelector() {
  const { status, selectedDeviceId, setSelectedDeviceId } = useEngine();
  const devices = status?.devices ?? [];
  if (devices.length < 2) return null;
  const current = selectedDeviceId ?? devices[0]!.device.id;
  return (
    <div className="device-selector" role="radiogroup" aria-label="Controller">
      {devices.map((d, i) => (
        <button key={d.device.id} role="radio" aria-checked={current === d.device.id}
          className={current === d.device.id ? "selected" : ""} onClick={() => setSelectedDeviceId(d.device.id)}>
          <strong>Controller {i + 1}</strong>
          <span className="muted small">{modelLabel[d.device.model]} · {connectionLabel[d.device.connection]}</span>
        </button>
      ))}
    </div>
  );
}

// ---- Calibration wizards ------------------------------------------------------

type CalStep = "idle" | "center" | "range" | "done";

/** Measures a stick's resting centre and full travel from live input. */
export function StickCalibrationWizard({ side, calibration, onSave }: {
  side: "leftStick" | "rightStick"; calibration: StickCalibration; onSave: (c: StickCalibration) => void;
}) {
  const device = usePrimaryDevice();
  const [step, setStep] = useState<CalStep>("idle");
  const acc = useRef({ n: 0, sx: 0, sy: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const stick = device?.input?.[side];
  const custom = JSON.stringify(calibration) !== JSON.stringify(DEFAULT_CALIBRATION);

  useEffect(() => {
    if (!stick) return;
    const a = acc.current;
    if (step === "center") { a.n += 1; a.sx += stick.x; a.sy += stick.y; }
    if (step === "range") {
      a.minX = Math.min(a.minX, stick.x); a.maxX = Math.max(a.maxX, stick.x);
      a.minY = Math.min(a.minY, stick.y); a.maxY = Math.max(a.maxY, stick.y);
    }
  }, [stick, step]);

  useEffect(() => {
    if (step !== "center") return;
    const t = setTimeout(() => setStep("range"), 1500);
    return () => clearTimeout(t);
  }, [step]);

  const start = () => { acc.current = { n: 0, sx: 0, sy: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 }; setStep("center"); };
  const finish = () => {
    const a = acc.current;
    const cx = a.n ? a.sx / a.n : 0, cy = a.n ? a.sy / a.n : 0;
    if (a.maxX - a.minX < 1 || a.maxY - a.minY < 1) { setStep("idle"); return; }
    onSave({ centerX: cx, centerY: cy, minX: a.minX, maxX: a.maxX, minY: a.minY, maxY: a.maxY });
    setStep("done");
  };

  if (!stick) return <p className="muted small">Connect your controller to calibrate.</p>;
  return (
    <div className="wizard-inline" aria-live="polite">
      {step === "idle" || step === "done" ? (
        <div className="row gap wrap">
          <button className="btn-secondary" onClick={start}>Calibrate {side === "leftStick" ? "left" : "right"} stick</button>
          {custom && <button className="btn-ghost" onClick={() => onSave({ ...DEFAULT_CALIBRATION })}>Reset calibration</button>}
          <span className="muted small">{step === "done" ? "✓ Calibration saved." : custom ? "Custom calibration active." : "Not calibrated (factory range)."}</span>
        </div>
      ) : step === "center" ? (
        <p><strong>Step 1 of 2:</strong> let go of the stick and keep it still…</p>
      ) : (
        <div className="row gap wrap">
          <p><strong>Step 2 of 2:</strong> rotate the stick slowly around its edge two or three times.</p>
          <button className="btn-primary" onClick={finish}>Done</button>
          <button className="btn-ghost" onClick={() => setStep("idle")}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/** Measures a trigger's resting and fully pressed values. */
export function TriggerCalibrationWizard({ side, rawMin, rawMax, onSave }: {
  side: "leftTrigger" | "rightTrigger"; rawMin: number; rawMax: number; onSave: (min: number, max: number) => void;
}) {
  const device = usePrimaryDevice();
  const [step, setStep] = useState<"idle" | "release" | "press" | "done">("idle");
  const acc = useRef({ min: 1, max: 0 });
  const v = device?.input?.[side].value;
  useEffect(() => {
    if (v === undefined) return;
    if (step === "release") acc.current.min = Math.min(acc.current.min, v);
    if (step === "press") acc.current.max = Math.max(acc.current.max, v);
  }, [v, step]);
  if (v === undefined) return null;
  const custom = rawMin !== 0 || rawMax !== 1;
  return (
    <div className="wizard-inline">
      {step === "idle" || step === "done" ? (
        <div className="row gap wrap">
          <button className="btn-ghost" onClick={() => { acc.current = { min: 1, max: 0 }; setStep("release"); }}>Calibrate</button>
          {custom && <button className="btn-ghost" onClick={() => onSave(0, 1)}>Reset</button>}
          <span className="muted small">{step === "done" ? "✓ Saved." : custom ? `Range ${pct(rawMin)}–${pct(rawMax)}` : "Factory range"}</span>
        </div>
      ) : step === "release" ? (
        <div className="row gap"><span>Let go of the trigger completely.</span><button className="btn-primary" onClick={() => setStep("press")}>Next</button></div>
      ) : (
        <div className="row gap"><span>Now press it all the way down and release.</span>
          <button className="btn-primary" onClick={() => {
            const { min, max } = acc.current;
            if (max - min > 0.3) { onSave(Math.min(0.5, min), Math.max(min + 0.2, max)); setStep("done"); } else setStep("idle");
          }}>Done</button></div>
      )}
    </div>
  );
}

// ---- Gyro -----------------------------------------------------------------------

const GYRO_LSB_PER_DPS = 16.384;

export function GyroTab({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const device = usePrimaryDevice();
  const { status } = useEngine();
  const g = config.gyro;
  const set = (patch: Partial<GyroConfig>) => onChange({ ...config, gyro: { ...g, ...patch } });
  const [cal, setCal] = useState<string | null>(null);
  const motion = device?.input?.motion;
  const dps = motion ? motion.gyroRaw.map((v, i) => (v - g.bias[i]!) / GYRO_LSB_PER_DPS) : null;
  const out = device?.processed?.rightStick;

  const calibrate = async () => {
    setCal("Keep the controller still on a flat surface…");
    try {
      await engineApi.startGyroCalibration();
      await new Promise((r) => setTimeout(r, 2000));
      const r = await engineApi.finishGyroCalibration();
      set({ bias: r.bias });
      setCal(r.steady ? `✓ Calibrated from ${r.samples} readings.` : "Calibrated, but the controller moved. Try again with it resting on a table for best results.");
    } catch (e) { setCal(errorMessage(e)); }
  };

  return (
    <div className="tune-grid">
      <div className="tune-controls">
        <Panel title="Motion aiming">
          <p className="muted small">Turn and tilt your controller to move the right stick, like aiming with your hands. Your real right stick keeps working too.</p>
          <Switch checked={g.enabled} onChange={(enabled) => set({ enabled })} label={g.enabled ? "Gyro on" : "Gyro off"} />
          <div className="field-row">
            <span className="field-label" data-tip="When the gyro moves the stick">Active</span>
            <Segmented label="Gyro activation" value={g.activation} onChange={(activation) => set({ activation })}
              options={[{ value: "always", label: "Always" }, { value: "whileHeld", label: "While holding" }, { value: "toggle", label: "Toggle" }]} />
          </div>
          {g.activation !== "always" && (
            <div className="field-row">
              <span className="field-label">Button</span>
              <ButtonSelect label="Gyro button" value={g.button} noneLabel="Choose a button…" onChange={(button) => set({ button })} />
            </div>
          )}
          {g.activation !== "always" && (
            <Switch checked={g.suppressButton} onChange={(suppressButton) => set({ suppressButton })}
              label="Hide this button from games" tip="Turn on if the button should only control the gyro" />
          )}
          <Slider label="Sensitivity" tip="How far the stick moves for a given turn" value={g.sensitivityX}
            min={0.1} max={5} step={0.05} format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set({ sensitivityX: v, sensitivityY: v * (g.sensitivityY / g.sensitivityX) })} />
          <Slider label="Smoothing" tip="Higher is steadier but slightly slower" value={g.smoothing} max={0.95}
            onChange={(smoothing) => set({ smoothing })} />
          <Advanced>
            <Slider label="Vertical sensitivity" tip="Up/down relative to left/right" value={g.sensitivityY}
              min={0.1} max={5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(sensitivityY) => set({ sensitivityY })} />
            <Slider label="Turn speed for full stick" tip="Degrees per second that move the stick fully" value={g.fullScaleDps}
              min={30} max={1000} step={10} format={(v) => `${v.toFixed(0)} °/s`} onChange={(fullScaleDps) => set({ fullScaleDps })} />
            <Slider label="Motion threshold" tip="Slower movement is ignored so a resting hand doesn't drift" value={g.thresholdDps}
              min={0} max={20} step={0.5} format={(v) => `${v.toFixed(1)} °/s`} onChange={(thresholdDps) => set({ thresholdDps })} />
            <div className="field-row">
              <span className="field-label">Left/right uses</span>
              <Segmented label="Horizontal axis" value={g.horizontalAxis} onChange={(horizontalAxis) => set({ horizontalAxis })}
                options={[{ value: "yaw", label: "Turning" }, { value: "roll", label: "Tilting" }]} />
            </div>
            <Switch checked={g.invertX} onChange={(invertX) => set({ invertX })} label="Invert left/right" />
            <Switch checked={g.invertY} onChange={(invertY) => set({ invertY })} label="Invert up/down" />
          </Advanced>
        </Panel>
      </div>
      <div className="tune-preview">
        <Panel title="Live motion">
          {dps ? (
            <>
              {(["Tilt up/down", "Turn left/right", "Tilt left/right"] as const).map((label, i) => (
                <div key={label} className="axis">
                  <span className="axis-label wide">{label}</span>
                  <div className="axis-track"><div className="axis-centre" />
                    <div className="axis-thumb" style={{ left: `${50 + Math.max(-50, Math.min(50, dps[i]! / 4))}%` }} /></div>
                  <span className="mono axis-num">{dps[i]!.toFixed(0)}°/s</span>
                </div>
              ))}
              {out && <StickPlot label="Right stick sent to game" config={config.rightStick} raw={null} processed={[out.x, out.y]} />}
            </>
          ) : <p className="muted small">{device ? "No motion data yet." : "Connect your controller to see motion."}</p>}
          <button className="btn-secondary" disabled={!motion || (status?.gyroCalibrating ?? false)} onClick={() => void calibrate()}>
            Calibrate gyro
          </button>
          {cal && <p className="small">{cal}</p>}
        </Panel>
        <Unverified>Gyro axes and scale follow the published DualSense layout; use Invert if a direction feels reversed.</Unverified>
      </div>
    </div>
  );
}

// ---- Touchpad -----------------------------------------------------------------------

const ZONE_NAMES: Record<TouchLayout, string[]> = {
  whole: ["Whole touchpad"],
  leftRight: ["Left half", "Right half"],
  quadrants: ["Top left", "Top right", "Bottom left", "Bottom right"],
};

export function TouchpadTab({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const device = usePrimaryDevice();
  const t = config.touchpad;
  const set = (patch: Partial<typeof t>) => onChange({ ...config, touchpad: { ...t, ...patch } });
  const [zone, setZone] = useState(0);
  const tp = device?.input?.touchpad;
  const W = 480, H = 270;
  const zones = ZONE_NAMES[t.layout];
  const rects = t.layout === "leftRight"
    ? [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]]
    : t.layout === "quadrants"
      ? [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]]
      : [[0, 0, W, H]];

  return (
    <div className="tune-grid">
      <div className="tune-controls">
        <Panel title="Click zones">
          <p className="muted small">Split the touchpad into zones so clicking different parts presses different buttons.</p>
          <Segmented label="Touchpad layout" value={t.layout} onChange={(layout) => { set({ layout }); setZone(0); }}
            options={[{ value: "whole", label: "One button" }, { value: "leftRight", label: "Left / right" }, { value: "quadrants", label: "Four zones" }]} />
          <svg viewBox={`0 0 ${W} ${H}`} className="touch-editor" role="img" aria-label="Touchpad zones">
            {rects.map(([x, y, w, h], i) => (
              <g key={i} onClick={() => setZone(i)} className={`tz${zone === i && t.layout !== "whole" ? " selected" : ""}`}>
                <rect x={x! + 3} y={y! + 3} width={w! - 6} height={h! - 6} rx={14} />
                <text x={x! + w! / 2} y={y! + h! / 2 - 6}>{zones[i]}</text>
                <text x={x! + w! / 2} y={y! + h! / 2 + 16} className="tz-btn">
                  {t.layout === "whole" ? "Touchpad click" : t.zones[i] ? BUTTONS[t.zones[i]!].name : "Touchpad click"}
                </text>
              </g>
            ))}
            {tp?.points.filter((p) => p.active).map((p) => (
              <circle key={p.id} cx={(p.x / tp.width) * W} cy={(p.y / tp.height) * H} r={9} className="tz-touch" />
            ))}
          </svg>
          {t.layout !== "whole" && (
            <div className="field-row">
              <span className="field-label">{zones[zone]} presses</span>
              <ButtonSelect label={`${zones[zone]} button`} value={t.zones[zone] ?? null} noneLabel="Touchpad click (normal)"
                onChange={(b) => { const z = [...t.zones] as typeof t.zones; z[zone] = b; set({ zones: z }); }} />
            </div>
          )}
        </Panel>
      </div>
      <div className="tune-preview">
        <Panel title="Swipes">
          <Switch checked={t.swipesEnabled} onChange={(swipesEnabled) => set({ swipesEnabled })} label="Swipe gestures" />
          {(["swipeUp", "swipeDown", "swipeLeft", "swipeRight"] as const).map((k) => (
            <div key={k} className="field-row">
              <span className="field-label">{k.replace("swipe", "Swipe ")}</span>
              <ButtonSelect label={k} value={t[k]} noneLabel="Nothing" onChange={(b) => set({ [k]: b })} />
            </div>
          ))}
          <Advanced title="Gesture sensitivity">
            <Slider label="Swipe length" tip="How far you must swipe (share of the touchpad width)" value={t.swipeDistance}
              min={0.05} max={0.9} onChange={(swipeDistance) => set({ swipeDistance })} />
            <Slider label="Maximum swipe time" tip="Slower movements are not swipes" value={t.swipeMaxMs}
              min={100} max={2000} step={50} format={(v) => `${v} ms`} onChange={(swipeMaxMs) => set({ swipeMaxMs })} />
            <Slider label="Button press length" tip="How long the swipe's button is held" value={t.swipePressMs}
              min={20} max={500} step={10} format={(v) => `${v} ms`} onChange={(swipePressMs) => set({ swipePressMs })} />
          </Advanced>
        </Panel>
        <Unverified>Touch coordinates follow the DualSense touch report (1920 × 1080).</Unverified>
      </div>
    </div>
  );
}

// ---- Layers and multi-action ------------------------------------------------------

function RuleRow({ rule, onChange, onRemove }: { rule: RemapRule; onChange: (r: RemapRule) => void; onRemove: () => void }) {
  return (
    <div className="rule-row">
      <ButtonChip button={rule.from} />
      <span className="muted">→</span>
      <ButtonSelect label="Sends" value={rule.to} noneLabel="Disabled" onChange={(to) => onChange({ ...rule, to })} />
      <ButtonSelect label="Also presses" value={rule.also?.[0] ?? null} noneLabel="+ also press…"
        onChange={(b) => onChange({ ...rule, also: b ? [b] : [] })} />
      <button className="btn-icon" aria-label="Remove" data-tip="Remove" onClick={onRemove}>✕</button>
    </div>
  );
}

function RuleList({ rules, onChange, exclude }: { rules: RemapRule[]; onChange: (r: RemapRule[]) => void; exclude: MacroButton[] }) {
  const used = rules.map((r) => r.from);
  return (
    <div className="rule-list">
      {rules.map((r, i) => (
        <RuleRow key={r.from} rule={r} onChange={(nr) => onChange(rules.map((x, j) => (j === i ? nr : x)))}
          onRemove={() => onChange(rules.filter((_, j) => j !== i))} />
      ))}
      <div className="row gap-sm">
        <span className="muted small">Add a button:</span>
        <ButtonSelect label="Add button" value={null} noneLabel="Choose…" exclude={[...used, ...exclude]}
          onChange={(b) => b && onChange([...rules, { from: b, to: b }])} />
      </div>
    </div>
  );
}

export function LayersPanel({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const [conflicts, setConflicts] = useState<ConfigConflict[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { engineApi.findConflicts(config).then(setConflicts).catch(() => setConflicts([])); }, 250);
    return () => clearTimeout(t);
  }, [config]);
  const layers = config.layers;
  const setLayers = (l: MappingLayer[]) => onChange({ ...config, layers: l });
  const used = layers.map((l) => l.activator);

  return (
    <>
      {conflicts.length > 0 && (
        <div className="notice warn" role="alert">
          <strong>Check your mapping:</strong>
          <ul className="conflicts">{conflicts.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
        </div>
      )}
      <Panel title="Shift layers" aside={
        <div className="row gap-sm">
          {layers.length < 4 && (
            <button className="btn-secondary" onClick={() => {
              const activator = ALL_BUTTONS.find((b) => !used.includes(b) && b !== "home") ?? "leftShoulder";
              setLayers([...layers, { name: `Layer ${layers.length + 1}`, activator, mode: "hold", remap: [] }]);
            }}>＋ Add layer</button>
          )}
          {(layers.length > 0 || config.remap.length > 0) && (
            <button className="btn-ghost" onClick={() => setConfirmReset(true)}>Restore default mapping</button>
          )}
        </div>
      }>
        <p className="muted small">A layer gives buttons a second job while you hold (or toggle) its button, like Shift on a keyboard. The layer button itself isn't sent to games.</p>
        {layers.length === 0 && <p className="muted small">No layers yet.</p>}
        {layers.map((l, i) => (
          <div key={i} className="layer-card">
            <div className="row gap wrap">
              <input className="text-input layer-name" value={l.name} maxLength={30} aria-label="Layer name"
                onChange={(e) => setLayers(layers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <span className="muted small">Button</span>
              <ButtonSelect label="Layer button" value={l.activator} exclude={used.filter((u) => u !== l.activator)}
                onChange={(b) => b && setLayers(layers.map((x, j) => (j === i ? { ...x, activator: b } : x)))} />
              <Segmented<LayerMode> label="Layer mode" value={l.mode}
                onChange={(mode) => setLayers(layers.map((x, j) => (j === i ? { ...x, mode } : x)))}
                options={[{ value: "hold", label: "Hold" }, { value: "toggle", label: "Toggle" }]} />
              <button className="btn-ghost danger" onClick={() => setLayers(layers.filter((_, j) => j !== i))}>Remove layer</button>
            </div>
            <RuleList rules={l.remap} exclude={[l.activator]}
              onChange={(remap) => setLayers(layers.map((x, j) => (j === i ? { ...x, remap } : x)))} />
          </div>
        ))}
      </Panel>
      {confirmReset && (
        <ConfirmDialog title="Restore default mapping?" body="All remapped buttons and layers in this profile will be removed."
          confirmLabel="Restore defaults" danger onCancel={() => setConfirmReset(false)}
          onConfirm={() => { setConfirmReset(false); onChange({ ...config, remap: [], layers: [] }); }} />
      )}
    </>
  );
}

// ---- Lighting & haptics ---------------------------------------------------------------

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

export function LightingTab({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const device = usePrimaryDevice();
  const f = config.feedback;
  const set = (patch: Partial<typeof f>) => onChange({ ...config, feedback: { ...f, ...patch } });
  const [msg, setMsg] = useState<string | null>(null);
  const preview = f.lightbarEnabled
    ? (f.connectionColors ? (device?.device.connection === "bluetooth" ? f.bluetoothColor : f.usbColor) : f.color).map((v) => Math.round(v * f.brightness))
    : null;

  return (
    <div className="two-col">
      <Panel title="Lightbar">
        <p className="muted small">These settings control your physical DualSense. They are separate from the virtual Xbox / DualShock controller games see.</p>
        <Switch checked={f.lightbarEnabled} onChange={(lightbarEnabled) => set({ lightbarEnabled })}
          label="Let NEXUS set the lightbar" tip="Off leaves the controller's own light alone" />
        <div className="lightbar-preview" style={{ background: preview ? `rgb(${preview.join(",")})` : undefined }}
          aria-label="Lightbar preview">{preview ? "" : "Controller default"}</div>
        <div className="field-row"><span className="field-label">Colour</span>
          <input type="color" value={hex(f.connectionColors ? f.usbColor : f.color)} disabled={!f.lightbarEnabled} aria-label="Lightbar colour"
            onChange={(e) => set({ color: rgb(e.target.value), connectionColors: false })} /></div>
        <Slider label="Brightness" tip="Dims the colour" value={f.brightness} onChange={(brightness) => set({ brightness })} />
        {/* "Colour shows the connection" is hidden: NEXUS supports USB only. The
            saved fields are kept so existing profiles load unchanged. */}
        <Switch checked={f.playerLedsEnabled} onChange={(playerLedsEnabled) => set({ playerLedsEnabled })} label="Player indicator lights" />
        {f.playerLedsEnabled && (
          <div className="player-leds" role="group" aria-label="Player LEDs">
            {[0, 1, 2, 3, 4].map((i) => (
              <button key={i} className={`led${f.playerLeds & (1 << i) ? " on" : ""}`} aria-pressed={!!(f.playerLeds & (1 << i))}
                aria-label={`LED ${i + 1}`} onClick={() => set({ playerLeds: f.playerLeds ^ (1 << i) })} />
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Vibration">
        <Slider label="Vibration strength" tip="Scales vibration NEXUS sends to your DualSense" value={f.rumbleIntensity}
          onChange={(rumbleIntensity) => set({ rumbleIntensity })} />
        <button className="btn-secondary" disabled={!device} onClick={async () => {
          setMsg(null);
          try { await engineApi.testVibration(0.7, 600); setMsg("Your controller should vibrate briefly."); } catch (e) { setMsg(errorMessage(e)); }
        }}>Test vibration</button>
        {msg && <p className="small">{msg}</p>}
        <p className="muted small">Game vibration will reach your controller through the virtual controller once virtual output is enabled.</p>
        <div className="feature-row"><strong>Adaptive triggers</strong><span className="badge dev">Not available</span>
          <span className="muted small">Trigger effects aren't publicly documented well enough to implement reliably yet.</span></div>
      </Panel>
      <div className="span-2"><Unverified>Lightbar, player lights and vibration use the DualSense output report from the Linux driver. Rumble uses the original vibration mode, which may feel weaker on newer controller firmware.</Unverified></div>
    </div>
  );
}

/** Preview helper: processed position for a stick setting. */
export function previewStick(config: ProcessingConfig, side: "leftStick" | "rightStick", x: number, y: number) {
  return processStick(config[side], x, y);
}
