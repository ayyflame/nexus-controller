import { PhotoPicker } from "../components/controller/PhotoPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalibrationWizard } from "../components/CalibrationWizard";
import { ControllerVisual } from "../components/ControllerVisual";
import { OutputCheck } from "../components/OutputCheck";
import { calibrationStatus } from "../lib/calibration";
import { Panel, StickPlot, TriggerMeter, Segmented } from "../components/controller/widgets";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { buttonMapping, buttonMarks, describeMapping } from "../lib/buttonMapping";
import {
  addStickSample, addTriggerSample, emptyStickRange, emptyTriggerRange, pct, signed, stickRangeResult, triggerRangeResult,
  type StickRange, type TriggerRange,
} from "../lib/diagAnalog";
import { activeControls, controlsFor, mergeSeen, type ControlId } from "../lib/diagDetected";
import { analyzeDrift, compareToReference, invalidReason, type DriftSample } from "../lib/diagDrift";
import { freshness, freshnessText, healthItems, reportAge, type Source } from "../lib/diagHealth";
import { accelG, gyroDps, motionAvailability, tiltFrom, type Vec3 } from "../lib/diagMotion";
import {
  checkProgress, feed, goTo, markFailed, retry, startTest, stepsFor, summary, type TestState,
} from "../lib/diagTest";
import { engineApi } from "../lib/engine";
import { connectionLabel, describeDeviceEvent, formatLabel, modelLabel, modelWithRevision } from "../lib/format";
import { BUTTONS } from "../lib/macros";
import { withDefaults } from "../lib/processing";
import type { ControllerModel, ControllerState, DeviceSnapshot, Macro, MacroButton, ProcessingConfig } from "../types/engine";

type Tab = "live" | "analog" | "motion" | "health" | "test" | "output" | "drift" | "calibration";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "live", label: "Live" },
  { id: "analog", label: "Sticks & Triggers" },
  { id: "motion", label: "Motion" },
  { id: "health", label: "Health" },
  { id: "test", label: "Controller Test" },
  { id: "output", label: "Output Check" },
  { id: "drift", label: "Drift Test" },
  { id: "calibration", label: "Calibration" },
];

const BUTTON_IDS = Object.keys(BUTTONS) as MacroButton[];

/**
 * Live Viewer: read-only diagnostics built on the controller state NEXUS
 * already publishes (about 60 updates a second to the UI). It never polls
 * the controller, never changes a setting, and closing it changes nothing in
 * controller processing, macros or virtual output.
 */
export function LiveViewer({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? (initialTab as Tab) : "live");
  useEffect(() => { if (TABS.some((t) => t.id === initialTab)) setTab(initialTab as Tab); }, [initialTab]);
  const device = usePrimaryDevice();
  const { profile } = useEngine();
  const config = useMemo(() => withDefaults(profile?.processing), [profile?.processing]);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Live Viewer</h1>
        <p className="muted">Everything here is read from your controller as NEXUS receives it. Nothing is simulated and no setting is changed.</p>
      </header>
      <nav className="tabs" role="tablist" aria-label="Live Viewer">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "selected" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      {!device ? (
        <div className="card"><p className="muted">Connect your DualSense or DualShock 4 with a USB cable. Nothing is shown until NEXUS receives real input.</p></div>
      ) : (
        <div className="tab-body" key={tab}>
          <StaleNotice device={device} />
          {tab === "live" && <LiveTab device={device} config={config} onCalibrate={() => setTab("calibration")} />}
          {tab === "analog" && <AnalogTab device={device} config={config} />}
          {tab === "motion" && <MotionTab input={device.input} />}
          {tab === "health" && <HealthTab device={device} />}
          {tab === "test" && <TestTab input={device.input} model={device.device.model} />}
          {tab === "output" && <OutputCheck />}
          {tab === "drift" && <DriftTab input={device.input} config={config} />}
          {tab === "calibration" && <CalibrationWizard />}
        </div>
      )}
    </div>
  );
}

function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function StaleNotice({ device }: { device: DeviceSnapshot }) {
  const now = useNow();
  const age = reportAge(device.lastReportMs, now);
  const f = freshness(age);
  if (f === "live" || f === "slow") return null;
  return <div className="notice warn" role="status">{freshnessText(f, age)}. The values below are the last ones received.</div>;
}

// ---- Live ----------------------------------------------------------------------

function LiveTab({ device, config, onCalibrate }: { device: DeviceSnapshot; config: ProcessingConfig; onCalibrate: () => void }) {
  const { connection } = useEngine();
  const input = device.input;
  const out = device.processed;
  const [macros, setMacros] = useState<Macro[]>([]);
  const [selected, setSelected] = useState<MacroButton | null>(null);
  const [seen, setSeen] = useState<Set<ControlId>>(() => new Set());
  useEffect(() => {
    if (connection.kind === "ready") engineApi.listMacros().then(setMacros).catch(() => setMacros([]));
  }, [connection.kind]);
  useEffect(() => { setSeen((s) => mergeSeen(s, input)); }, [input]);
  const marks = useMemo(() => buttonMarks(BUTTON_IDS, config, macros), [config, macros]);
  const layerName = device.activeLayer !== null ? config.layers[device.activeLayer]?.name ?? `Layer ${device.activeLayer + 1}` : null;
  const active = activeControls(input);
  const mapping = selected ? buttonMapping(selected, config, macros) : null;
  return (
    <div className="lv-grid">
      <Panel title="Your controller" aside={<span className={`badge ${layerName ? "tone-ok" : "tone-neutral"}`}>{layerName ? `Layer active: ${layerName}` : "Base layout (no shift layer)"}</span>}>
        <ControllerVisual state={input} live selected={selected} marks={marks} onSelect={(b) => setSelected((c) => (c === b ? null : b))} />
        <div className="controller-legend" aria-hidden="true">
          <span><i className="l-pressed" />Pressed</span><span><i className="l-selected" />Selected</span>
          <span><i className="l-remapped" />Remapped</span><span><i className="l-macro" />Starts a macro</span>
          <span><i className="l-disabled" />Disabled</span><span><i className="l-special" />Layer or gyro</span>
        </div>
        <PhotoPicker />
        {mapping && (
          <div className="mapping-card" aria-live="polite">
            <h4>{BUTTONS[mapping.button].name}<span className="mapping-kind">{mapping.kind}</span></h4>
            <ul>{describeMapping(mapping, (b) => BUTTONS[b].name).map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        )}
      </Panel>
      <Panel title="Sent to the game" aside={<span className="muted small">after settings, remapping and macros</span>}>
        <ControllerVisual state={out} live flat />
        <p className="muted small">Playing macros: {device.playingMacros.length ? device.playingMacros.length : "none"}</p>
      </Panel>
      <Panel title="Analog values">
        <AnalogTable input={input} out={out} />
      </Panel>
      <CalibrationStatusPanel config={config} onCalibrate={onCalibrate} />
      <Panel title="Detected this session" aside={<button className="btn-ghost small" onClick={() => setSeen(new Set())}>Reset</button>}>
        <p className="muted small">Each control lights while it's in use and gets a tick once NEXUS has seen it. Anything that never ticks isn't reaching NEXUS.</p>
        <div className="lv-detected">
          {controlsFor(device.device.model).map((c) => (
            <span key={c.id} className={`lv-chip${active.has(c.id) ? " on" : ""}${seen.has(c.id) ? " seen" : ""}`}>
              {seen.has(c.id) ? "✓ " : ""}{c.label}
            </span>
          ))}
        </div>
        <p className="muted small">{seen.size} of {controlsFor(device.device.model).length} controls detected.</p>
      </Panel>
    </div>
  );
}

function AnalogTable({ input, out }: { input: ControllerState | null; out: ControllerState | null }) {
  if (!input) return <p className="muted">No input yet.</p>;
  const row = (label: string, raw: string, value: string, processed: string) => (
    <tr key={label}><td>{label}</td><td className="mono">{raw}</td><td className="mono">{value}</td><td className="mono">{processed}</td></tr>
  );
  return (
    <table className="table lv-table">
      <thead><tr><th>Control</th><th>Raw (0–255)</th><th>Value</th><th>Sent to game</th></tr></thead>
      <tbody>
        {row("Left stick X", String(input.leftStick.rawX), signed(input.leftStick.x), out ? signed(out.leftStick.x) : "—")}
        {row("Left stick Y", String(input.leftStick.rawY), signed(input.leftStick.y), out ? signed(out.leftStick.y) : "—")}
        {row("Right stick X", String(input.rightStick.rawX), signed(input.rightStick.x), out ? signed(out.rightStick.x) : "—")}
        {row("Right stick Y", String(input.rightStick.rawY), signed(input.rightStick.y), out ? signed(out.rightStick.y) : "—")}
        {row("L2", String(input.leftTrigger.raw), pct(input.leftTrigger.value), out ? pct(out.leftTrigger.value) : "—")}
        {row("R2", String(input.rightTrigger.raw), pct(input.rightTrigger.value), out ? pct(out.rightTrigger.value) : "—")}
      </tbody>
    </table>
  );
}

function CalibrationStatusPanel({ config, onCalibrate }: { config: ProcessingConfig; onCalibrate: () => void }) {
  const { profile } = useEngine();
  const s = calibrationStatus(config);
  const all = s.sticks.every((x) => x.calibrated) && s.triggers.every((x) => x.calibrated);
  return (
    <Panel title={`Calibration · ${profile?.name ?? "profile"}`} aside={<button className="btn-ghost small" onClick={onCalibrate}>{all ? "Calibrate again" : "Run calibration"}</button>}>
      <table className="table lv-table"><tbody>
        {s.sticks.map((x) => (
          <tr key={x.side}><td>{x.side === "leftStick" ? "Left stick" : "Right stick"}</td>
            <td className={x.calibrated ? "ok-text" : "muted"}>{x.calibrated ? "Calibrated" : "Not calibrated"}</td>
            <td className="mono">centre offset {(x.centerOffset * 100).toFixed(1)} %</td><td className="mono">deadzone {(x.deadzone * 100).toFixed(1)} %</td></tr>
        ))}
        {s.triggers.map((x) => (
          <tr key={x.side}><td>{x.side === "leftTrigger" ? "L2" : "R2"}</td>
            <td className={x.calibrated ? "ok-text" : "muted"}>{x.calibrated ? "Calibrated" : "Not calibrated"}</td>
            <td className="mono" colSpan={2}>endpoints {(x.rawMin * 100).toFixed(1)} – {(x.rawMax * 100).toFixed(1)} %</td></tr>
        ))}
      </tbody></table>
    </Panel>
  );
}

// ---- Sticks & triggers ------------------------------------------------------------

function useRange<T>(empty: () => T, add: (r: T, s: ControllerState) => T, input: ControllerState | null): [T, () => void] {
  const [r, setR] = useState<T>(empty);
  useEffect(() => { if (input) setR((cur) => add(cur, input)); }, [input]); // eslint-disable-line react-hooks/exhaustive-deps
  return [r, () => setR(empty())];
}

function AnalogTab({ device, config }: { device: DeviceSnapshot; config: ProcessingConfig }) {
  const input = device.input, out = device.processed;
  const [ls, resetLs] = useRange<StickRange>(emptyStickRange, (r, s) => addStickSample(r, s.leftStick.x, s.leftStick.y), input);
  const [rs, resetRs] = useRange<StickRange>(emptyStickRange, (r, s) => addStickSample(r, s.rightStick.x, s.rightStick.y), input);
  const [lt, resetLt] = useRange<TriggerRange>(emptyTriggerRange, (r, s) => addTriggerSample(r, s.leftTrigger.raw), input);
  const [rt, resetRt] = useRange<TriggerRange>(emptyTriggerRange, (r, s) => addTriggerSample(r, s.rightTrigger.raw), input);
  if (!input) return <div className="card"><p className="muted">No input yet.</p></div>;
  return (
    <div className="lv-grid">
      {([["Left stick", "leftStick", ls, resetLs], ["Right stick", "rightStick", rs, resetRs]] as const).map(([label, side, range, reset]) => {
        const st = input[side];
        const res = stickRangeResult(range);
        return (
          <Panel key={side} title={label} aside={<button className="btn-ghost small" onClick={reset}>Reset range</button>}>
            <div className="row gap wrap">
              <StickPlot label={label} config={config[side]} raw={[st.x, st.y]} processed={out ? [out[side].x, out[side].y] : null} />
              <div className="lv-stats">
                <Stat k="X / Y (raw bytes)" v={`${st.rawX} / ${st.rawY}`} />
                <Stat k="X / Y" v={`${signed(st.x)} / ${signed(st.y)}`} />
                <Stat k="Distance from centre" v={pct(Math.hypot(st.x, st.y))} />
                <Stat k="Deadzone (this profile)" v={pct(config[side].deadzone)} />
                <Stat k="Sent to game" v={out ? `${signed(out[side].x)} / ${signed(out[side].y)}` : "—"} />
                <h4 className="lv-sub">Full-range test</h4>
                <p className="muted small">Roll the stick slowly around the edge.</p>
                <Stat k="Left · Right · Up · Down" v={[res.left, res.right, res.up, res.down].map((b) => (b ? "✓" : "–")).join("  ")} />
                <Stat k="Directions reached" v={`${res.sectorsReached} of 8`} />
                <Stat k="Furthest reached" v={pct(range.maxRadius)} />
                <Stat k="Result" v={res.complete ? "Full range reached" : range.samples ? "Not yet" : "—"} ok={res.complete} />
              </div>
            </div>
          </Panel>
        );
      })}
      {([["L2", "leftTrigger", lt, resetLt], ["R2", "rightTrigger", rt, resetRt]] as const).map(([label, side, range, reset]) => {
        const t = input[side];
        const res = triggerRangeResult(range);
        return (
          <Panel key={side} title={`${label} trigger`} aside={<button className="btn-ghost small" onClick={reset}>Reset range</button>}>
            <TriggerMeter label={label} raw={t.value} processed={out ? out[side].value : t.value}
              deadzone={config[side].deadzone} maxInput={config[side].maxInput} />
            <div className="lv-stats">
              <Stat k="Raw / travel" v={`${t.raw} / ${pct(t.value)}`} />
              <Stat k="Sent to game" v={out ? pct(out[side].value) : "—"} />
              <Stat k="Lowest · highest seen" v={range.samples ? `${range.minRaw} · ${range.maxRaw}` : "—"} />
              <Stat k="Fully released (≤ 2)" v={res.fullRelease ? "✓" : "–"} ok={res.fullRelease} />
              <Stat k="Fully pressed (≥ 253)" v={res.fullPress ? "✓" : "–"} ok={res.fullPress} />
            </div>
            {res.incomplete && <div className="notice warn small">{res.incomplete}</div>}
          </Panel>
        );
      })}
      <p className="muted small span-2">Values update about 60 times a second here. Nothing on this page changes calibration; use the Sticks or Triggers page to change settings.</p>
    </div>
  );
}

function Stat({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return <div className="kv-row"><span className="muted">{k}</span><span className={`mono${ok ? " ok-text" : ""}`}>{v}</span></div>;
}

// ---- Motion -----------------------------------------------------------------------

function MotionTab({ input }: { input: ControllerState | null }) {
  const avail = motionAvailability(input);
  if (!avail.available) return <div className="card"><p className="muted">Motion data unavailable: {avail.reason}</p></div>;
  const m = input!.motion!;
  const dps = gyroDps(m.gyroRaw);
  const g = accelG(m.accelRaw);
  const tilt = tiltFrom(g);
  return (
    <div className="lv-grid">
      <Panel title="Gyroscope" aside={<span className="muted small">raw counts exact · °/s estimated</span>}>
        <Axes labels={["X (pitch)", "Y (yaw)", "Z (roll)"]} raw={m.gyroRaw} values={dps} unit="°/s" range={500} />
      </Panel>
      <Panel title="Accelerometer" aside={<span className="muted small">raw counts exact · g estimated</span>}>
        <Axes labels={["X", "Y", "Z"]} raw={m.accelRaw} values={g} unit="g" range={2} />
      </Panel>
      <Panel title="Tilt (from gravity)">
        {tilt ? (
          <div className="row gap wrap">
            <TiltLevel pitch={tilt.pitchDeg} roll={tilt.rollDeg} steady={tilt.steady} />
            <div className="lv-stats">
              <Stat k="Forward / back" v={`${tilt.pitchDeg.toFixed(1)}°`} />
              <Stat k="Left / right" v={`${tilt.rollDeg.toFixed(1)}°`} />
              <Stat k="Total acceleration" v={`${tilt.magnitudeG.toFixed(2)} g`} />
              <Stat k="Reading" v={tilt.steady ? "Steady (about 1 g): tilt is meaningful" : "Moving: tilt is approximate"} ok={tilt.steady} />
            </div>
          </div>
        ) : <p className="muted">No gravity reading (the accelerometer reads near zero).</p>}
        <p className="muted small">Tilt comes only from gravity. Turning the controller flat on a table (yaw) can't be measured this way, so it isn't shown. Units are estimates: NEXUS doesn't apply the controller's factory IMU calibration.</p>
      </Panel>
      <Panel title="Sensor clock">
        <Stat k="Sensor timestamp" v={String(m.sensorTimestamp)} />
        <p className="muted small">Counts up with every motion sample; a frozen value means the motion sensor stopped updating.</p>
      </Panel>
    </div>
  );
}

function Axes({ labels, raw, values, unit, range }: { labels: string[]; raw: Vec3; values: Vec3; unit: string; range: number }) {
  return (
    <div className="lv-axes">
      {labels.map((l, i) => {
        const v = values[i]!;
        const f = Math.max(-1, Math.min(1, v / range));
        return (
          <div key={l} className="lv-axis">
            <span className="muted">{l}</span>
            <span className="lv-bar"><span className="lv-bar-mid" /><span className="lv-bar-fill" style={{ left: f < 0 ? `${50 + f * 50}%` : "50%", width: `${Math.abs(f) * 50}%` }} /></span>
            <span className="mono">{raw[i]}</span>
            <span className="mono">{v.toFixed(unit === "g" ? 2 : 0)} {unit}</span>
          </div>
        );
      })}
    </div>
  );
}

function TiltLevel({ pitch, roll, steady }: { pitch: number; roll: number; steady: boolean }) {
  const k = 45 / 90;
  const x = 60 + Math.max(-1, Math.min(1, roll / 90)) * 45;
  const y = 60 - Math.max(-1, Math.min(1, pitch / 90)) * 45;
  return (
    <svg viewBox="0 0 120 120" className="lv-level" role="img" aria-label={`Tilt: ${pitch.toFixed(0)}° forward, ${roll.toFixed(0)}° sideways`}>
      <circle cx="60" cy="60" r="50" className="lv-level-ring" />
      <circle cx="60" cy="60" r={50 * k * 0.33} className="lv-level-ring inner" />
      <path d="M60 10v100M10 60h100" className="lv-level-cross" />
      <circle cx={x} cy={y} r="8" className={`lv-level-bubble${steady ? "" : " moving"}`} />
    </svg>
  );
}

// ---- Health -----------------------------------------------------------------------

const SOURCE_LABEL: Record<Source, string> = { measured: "measured", reported: "from controller", estimate: "estimate" };

function HealthTab({ device }: { device: DeviceSnapshot }) {
  const { deviceEvents } = useEngine();
  const now = useNow(500);
  const d = device.device;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  const items = healthItems(device, now);
  return (
    <div className="lv-grid">
      <Panel title="Controller">
        <Stat k="Name" v={d.productName ?? modelLabel[d.model]} />
        <Stat k="Model" v={modelWithRevision(d.model, d.productId)} />
        <Stat k="Connection" v={connectionLabel[d.connection]} />
        <Stat k="Vendor : product ID" v={`${hex(d.vendorId)} : ${hex(d.productId)}`} />
        <Stat k="Report format" v={device.input ? formatLabel[device.input.format] : "—"} />
        <Stat k="Connected for" v={`${Math.max(0, Math.round((now - device.connectedAtMs) / 1000))} s`} />
        <Stat k="Last report" v={device.lastReportMs ? new Date(device.lastReportMs).toLocaleTimeString() : "—"} />
        {device.lastParseError && <Stat k="Last unreadable report" v={device.lastParseError} />}
      </Panel>
      <Panel title="Input health">
        <table className="table lv-table">
          <tbody>
            {items.map((i) => (
              <tr key={i.label} className={i.warn ? "lv-warn" : undefined}>
                <td>{i.label}</td><td className="mono">{i.value}</td><td className="muted small">{SOURCE_LABEL[i.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Measured: counted by NEXUS. From controller: as the controller reports it (battery in 10 % steps). Estimate: inferred (dropped reports from gaps in the controller's report counter).</p>
      </Panel>
      <Panel title="Connection events">
        {deviceEvents.length === 0 ? <p className="muted">No connection events since NEXUS started.</p> : (
          <ul className="lv-events">
            {deviceEvents.slice(-30).reverse().map((e, i) => (
              <li key={`${e.at}-${i}`}><span className="mono muted">{new Date(e.at).toLocaleTimeString()}</span> {describeDeviceEvent(e.event)}</li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ---- Controller test --------------------------------------------------------------------

function TestTab({ input, model }: { input: ControllerState | null; model: ControllerModel }) {
  const [t, setT] = useState<TestState | null>(null);
  useEffect(() => { setT((cur) => (cur ? feed(cur, input) : cur)); }, [input]);
  if (!t) {
    return (
      <div className="card">
        <h2>Controller Test</h2>
        <p>Walks through every control in {stepsFor(model).length} steps and checks that each one works fully: buttons press and release, triggers reach both ends, sticks reach every direction.</p>
        <p className="muted small">The test only reads input. It doesn't change mappings, calibration, profiles or macros. Your presses still reach NEXUS as usual, so macros can play and the virtual controller receives them; you may want to stay out of games meanwhile.</p>
        <button className="btn-primary" onClick={() => setT(startTest(model))}>Start the test</button>
      </div>
    );
  }
  const s = summary(t);
  if (t.finished) {
    return (
      <div className="card">
        <h2>Test summary</h2>
        <p>{s.pass} passed · {s.fail} failed · {s.untested} not tested</p>
        <table className="table lv-table"><tbody>
          {t.steps.map((st, i) => (
            <tr key={st.id}><td>{st.title}</td><td className={t.results[st.id] === "pass" ? "ok-text" : t.results[st.id] === "fail" ? "err-text" : "muted"}>{resultText(t.results[st.id]!)}</td>
              <td><button className="btn-ghost small" onClick={() => setT(retry(goTo(t, i)))}>Test again</button></td></tr>
          ))}
        </tbody></table>
        <button className="btn-secondary" onClick={() => setT(startTest(model))}>Start over</button>
      </div>
    );
  }
  const step = t.steps[t.step]!;
  const result = t.results[step.id]!;
  return (
    <div className="card lv-test">
      <div className="row gap wrap">
        {t.steps.map((st, i) => (
          <button key={st.id} className={`lv-step${i === t.step ? " current" : ""} r-${t.results[st.id]}`} onClick={() => setT(goTo(t, i))}>{i + 1}</button>
        ))}
      </div>
      <h2>{t.step + 1}. {step.title}</h2>
      <p>{step.hint}</p>
      <ul className="lv-checks">
        {step.checks.map((c) => {
          const p = checkProgress(t, c.id);
          return <li key={c.id} className={p?.done ? "ok-text" : undefined}>{p?.done ? "✓" : "○"} {c.label}{p ? progressText(p) : ""}</li>;
        })}
      </ul>
      <p className={result === "pass" ? "ok-text" : result === "fail" ? "err-text" : "muted"}>{result === "untested" ? "Waiting for input…" : resultText(result)}</p>
      <div className="row gap-sm wrap">
        <button className="btn-ghost" disabled={t.step === 0} onClick={() => setT(goTo(t, t.step - 1))}>Back</button>
        {result === "untested" && <button className="btn-ghost danger" onClick={() => setT(markFailed(t))}>Mark as failed</button>}
        <button className="btn-ghost" onClick={() => setT(retry(t))}>Retry</button>
        <button className="btn-primary" onClick={() => setT(goTo(t, t.step + 1))}>{t.step === t.steps.length - 1 ? "Finish" : result === "untested" ? "Skip" : "Next"}</button>
      </div>
      <p className="muted small">{s.pass} passed · {s.fail} failed · {s.untested} not tested. Presses shorter than about 20 ms may not register here (the view updates about 60 times a second).</p>
    </div>
  );
}

function resultText(r: string): string { return r === "pass" ? "Passed" : r === "fail" ? "Failed" : "Not tested"; }

function progressText(p: NonNullable<ReturnType<typeof checkProgress>>): string {
  if (p.done) return "";
  switch (p.kind) {
    case "button": return p.pressed ? " — pressed, now release it" : "";
    case "trigger": return p.range.samples ? ` — highest ${p.range.maxRaw} of 255${p.pressedEnd ? ", now release it fully" : ""}` : "";
    case "stick": { const r = stickRangeResult(p.range); return p.range.samples ? ` — ${r.sectorsReached} of 8 directions${r.complete ? ", now let it go" : ""}` : ""; }
    case "touch": return p.touched || p.clicked ? ` — ${p.touched ? "touch ✓" : "touch –"}, ${p.clicked ? "click ✓" : "click –"}` : "";
  }
}

// ---- Drift test ---------------------------------------------------------------------------

function DriftTab({ input, config }: { input: ControllerState | null; config: ProcessingConfig }) {
  const [side, setSide] = useState<"leftStick" | "rightStick">("leftStick");
  const [seconds, setSeconds] = useState<"5" | "10" | "30">("10");
  const [refText, setRefText] = useState(() => (config[side].deadzone * 100).toFixed(1));
  const [running, setRunning] = useState<{ until: number; side: "leftStick" | "rightStick" } | null>(null);
  const samples = useRef<DriftSample[]>([]);
  const [result, setResult] = useState<{ r: ReturnType<typeof analyzeDrift>; seconds: number } | null>(null);
  const now = useNow(100);
  useEffect(() => { setRefText((config[side].deadzone * 100).toFixed(1)); }, [side, config]);
  useEffect(() => {
    if (!running || !input) return;
    const st = input[running.side];
    samples.current.push({ t: performance.now(), x: st.x, y: st.y });
  }, [input, running]);
  useEffect(() => {
    if (running && now >= running.until) { setResult({ r: analyzeDrift(samples.current), seconds: Number(seconds) }); setRunning(null); }
  }, [now, running, seconds]);
  const ref = Math.max(0, Math.min(100, Number(refText))) / 100;
  const st = input?.[side];
  const p = (v: number) => `${(v * 100).toFixed(2)} %`;
  return (
    <div className="lv-grid">
      <Panel title="Stick drift test">
        <p>Put the controller down and don't touch the sticks. NEXUS records the raw stick position (before any deadzone) and reports what it measured.</p>
        <div className="row gap wrap">
          <Segmented label="Stick" value={side} onChange={setSide}
            options={[{ value: "leftStick", label: "Left stick" }, { value: "rightStick", label: "Right stick" }]} />
          <Segmented label="Duration" value={seconds} onChange={setSeconds}
            options={[{ value: "5", label: "5 s" }, { value: "10", label: "10 s" }, { value: "30", label: "30 s" }]} />
        </div>
        <label className="ms-input" style={{ marginTop: 10 }}>
          <span>Reference radius</span>
          <input className="text-input mono" inputMode="decimal" value={refText} onChange={(e) => setRefText(e.target.value)} aria-label="Reference radius (percent)" />
          <span className="muted small">% (default: this profile's deadzone)</span>
        </label>
        <div className="row gap-sm" style={{ marginTop: 12 }}>
          <button className="btn-primary" disabled={!!running || !input} onClick={() => {
            samples.current = []; setResult(null);
            setRunning({ until: Date.now() + Number(seconds) * 1000, side });
          }}>{running ? `Measuring… ${Math.max(0, Math.ceil((running.until - now) / 1000))} s` : "Start measuring"}</button>
          {running && <button className="btn-ghost" onClick={() => setRunning(null)}>Cancel</button>}
        </div>
        {st && <div className="lv-stats" style={{ marginTop: 12 }}>
          <Stat k="Current X / Y (raw bytes)" v={`${st.rawX} / ${st.rawY}`} />
          <Stat k="Current X / Y" v={`${signed(st.x)} / ${signed(st.y)}`} />
          <Stat k="Current offset from centre" v={p(Math.hypot(st.x, st.y))} />
        </div>}
      </Panel>
      <Panel title="Result">
        {!result ? <p className="muted">{running ? "Recording… keep the controller still." : "No measurement yet."}</p>
          : invalidReason(result.r, result.seconds) ? <div className="notice warn">{invalidReason(result.r, result.seconds)}</div> : (
          <DriftResultView result={result.r!} reference={ref} />
        )}
      </Panel>
    </div>
  );
}

function DriftResultView({ result, reference: ref }: { result: NonNullable<ReturnType<typeof analyzeDrift>>; reference: number }) {
  const p = (v: number) => `${(v * 100).toFixed(2)} %`;
  return (
          <>
            {result.disturbed && <div className="notice warn small">The stick moved a lot during the measurement. Measure again without touching it.</div>}
            <div className="lv-stats">
              <Stat k="Samples / duration" v={`${result.samples} / ${(result.durationMs / 1000).toFixed(1)} s`} />
              <Stat k="Average resting position" v={`${signed(result.mean.x)} / ${signed(result.mean.y)}`} />
              <Stat k="Centre offset (average)" v={p(result.centerOffset)} />
              <Stat k="Maximum deviation from centre" v={p(result.maxDeviation)} />
              <Stat k="Jitter (largest change around average)" v={p(result.maxSpread)} />
              <Stat k="Drift (first second → last second)" v={p(result.drift)} />
            </div>
            <p>{compareToReference(result, ref)}</p>
            <p className="muted small">These are measurements, not a verdict. A small resting offset is normal for analog sticks; a deadzone a little larger than the maximum deviation hides it. Sampled about 60 times a second.</p>
          </>
  );
}
