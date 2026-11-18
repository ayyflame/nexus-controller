import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import {
  DIRECTIONS, adviseDeadzone, applyCalibration, measureCenter, measureRange, measureTrigger, restoreSnapshot, snapshotOf,
  stickCalibrationFrom, type CalibrationSnapshot, type CenterResult, type Measured, type PendingCalibration,
  type RangeResult, type Sample, type TriggerResult,
} from "../lib/calibration";
import { engineApi, errorMessage } from "../lib/engine";
import { processStick, triggerOutput, withDefaults } from "../lib/processing";
import type { ControllerState, ProcessingConfig } from "../types/engine";

type StickSide = "leftStick" | "rightStick";
type TriggerSide = "leftTrigger" | "rightTrigger";
type Part = StickSide | TriggerSide;
const PARTS: Array<{ id: Part; label: string }> = [
  { id: "leftStick", label: "Left stick" }, { id: "rightStick", label: "Right stick" },
  { id: "leftTrigger", label: "L2" }, { id: "rightTrigger", label: "R2" },
];
const isStick = (p: Part): p is StickSide => p === "leftStick" || p === "rightStick";

interface StickMeasure { center?: Measured<CenterResult>; range?: Measured<RangeResult>; deadzone?: number }
interface TriggerMeasure { result?: Measured<TriggerResult> }
type Stage =
  | { kind: "choose" }
  | { kind: "center"; part: StickSide; recording: boolean }
  | { kind: "deadzone"; part: StickSide }
  | { kind: "range"; part: StickSide }
  | { kind: "released"; part: TriggerSide; recording: boolean }
  | { kind: "pressed"; part: TriggerSide }
  | { kind: "results" }
  | { kind: "applied"; previous: CalibrationSnapshot; profile: string };

const CENTER_MS = 3000;
const RELEASED_MS = 1500;
const p1 = (v: number) => `${(v * 100).toFixed(1)} %`;
const p2 = (v: number) => `${(v * 100).toFixed(2)} %`;

/**
 * Guided calibration of the sticks and triggers. Measures from raw input
 * only; nothing is changed until "Apply and save" on the results screen.
 */
export function CalibrationWizard() {
  const device = usePrimaryDevice();
  const { profile, setProfile } = useEngine();
  const config = useMemo(() => withDefaults(profile?.processing), [profile?.processing]);
  const input = device?.input ?? null;
  const [selected, setSelected] = useState<Part[]>(PARTS.map((p) => p.id));
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [sticks, setSticks] = useState<Record<StickSide, StickMeasure>>({ leftStick: {}, rightStick: {} });
  const [triggers, setTriggers] = useState<Record<TriggerSide, TriggerMeasure>>({ leftTrigger: {}, rightTrigger: {} });
  const [apply, setApply] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const buf = useRef<{ samples: Sample[]; released: number[]; pressed: number[] }>({ samples: [], released: [], pressed: [] });
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Recording: one sample per state update from the engine (about 60/s).
  useEffect(() => {
    if (!input) return;
    const t = performance.now();
    if ((stage.kind === "center" && stage.recording) || stage.kind === "range") {
      const st = input[stage.part];
      buf.current.samples.push({ t, x: st.x, y: st.y });
    } else if (stage.kind === "released" && stage.recording) {
      buf.current.released.push(input[stage.part].raw);
    } else if (stage.kind === "pressed") {
      buf.current.pressed.push(input[stage.part].raw);
    }
  }, [input, stage]);

  useEffect(() => {
    if (until === null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [until]);

  useEffect(() => {
    if (until === null || now < until) return;
    setUntil(null);
    if (stage.kind === "center") {
      const center = measureCenter(buf.current.samples);
      setSticks((s) => ({ ...s, [stage.part]: { ...s[stage.part], center, deadzone: center.ok ? adviseDeadzone(center.value).recommended : undefined } }));
      setStage(center.ok ? { kind: "deadzone", part: stage.part } : { kind: "center", part: stage.part, recording: false });
    } else if (stage.kind === "released") {
      setStage({ kind: "pressed", part: stage.part });
    }
  }, [now, until, stage]);

  if (!device || !input) return <div className="card"><p className="muted">Connect your DualSense with a USB cable to calibrate.</p></div>;

  const order = PARTS.map((p) => p.id).filter((p) => selected.includes(p));
  const firstStage = (p: Part): Stage => (isStick(p) ? { kind: "center", part: p, recording: false } : { kind: "released", part: p, recording: false });
  const next = (from: Part) => {
    const i = order.indexOf(from);
    const n = order[i + 1];
    setStage(n ? firstStage(n) : { kind: "results" });
  };
  const record = (s: Stage, ms: number) => {
    buf.current = { samples: [], released: [], pressed: [] };
    setNow(Date.now());
    setUntil(Date.now() + ms);
    setStage(s);
  };

  // ---- pending changes from the measurements ----
  const pending = (): { p: PendingCalibration; warnings: Record<Part, string[]> } => {
    const p: PendingCalibration = {};
    const warnings: Record<Part, string[]> = { leftStick: [], rightStick: [], leftTrigger: [], rightTrigger: [] };
    for (const side of ["leftStick", "rightStick"] as const) {
      const m = sticks[side];
      if (!selected.includes(side)) continue;
      if (!m.center?.ok) { warnings[side].push("Centre not measured."); continue; }
      const range = m.range?.ok ? m.range.value : null;
      if (m.range && !m.range.ok) warnings[side].push(m.range.reason);
      else if (range && !range.complete) warnings[side].push("Full range incomplete: not every direction or the whole circle was reached.");
      if (range && !range.reachesExpected) warnings[side].push("This stick doesn't reach 95 % in every straight direction.");
      const c = stickCalibrationFrom(m.center.value, range, config[side].calibration);
      warnings[side].push(...c.warnings);
      p[side] = {
        ...(apply[`${side}.cal`] !== false ? { calibration: c.calibration } : {}),
        ...(apply[`${side}.dz`] !== false && m.deadzone !== undefined ? { deadzone: m.deadzone } : {}),
      };
    }
    for (const side of ["leftTrigger", "rightTrigger"] as const) {
      const m = triggers[side].result;
      if (!selected.includes(side)) continue;
      if (!m?.ok) { warnings[side].push(m ? m.reason : "Not measured."); continue; }
      if (m.value.incomplete) warnings[side].push(`Reaches only ${m.value.pressedMax} of 255; the calibration makes that point full output.`);
      if (apply[`${side}.cal`] !== false) p[side] = { rawMin: m.value.rawMin, rawMax: m.value.rawMax };
    }
    return { p, warnings };
  };

  const doApply = async () => {
    setError(null);
    const previous = snapshotOf(config);
    try {
      const saved = await engineApi.setProcessing(applyCalibration(config, pending().p));
      setProfile(saved);
      setStage({ kind: "applied", previous, profile: saved.name });
    } catch (e) { setError(errorMessage(e)); }
  };
  const doRestore = async (previous: CalibrationSnapshot) => {
    setError(null);
    try {
      setProfile(await engineApi.setProcessing(restoreSnapshot(config, previous)));
      setStage({ kind: "choose" });
    } catch (e) { setError(errorMessage(e)); }
  };
  const cancel = () => {
    setUntil(null);
    setSticks({ leftStick: {}, rightStick: {} });
    setTriggers({ leftTrigger: {}, rightTrigger: {} });
    setApply({});
    setStage({ kind: "choose" });
  };
  const remaining = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
  const steps = order.length;
  const progress = stage.kind !== "choose" && stage.kind !== "results" && stage.kind !== "applied" ? `${order.indexOf(stage.part) + 1} of ${steps}` : "";

  return (
    <div className="card cal">
      <div className="card-title-row">
        <h2>Calibration{progress ? ` · ${PARTS.find((p) => "part" in stage && p.id === stage.part)?.label} (${progress})` : ""}</h2>
        {stage.kind !== "choose" && stage.kind !== "applied" && <button className="btn-ghost" onClick={cancel}>Cancel</button>}
      </div>
      {error && <div className="notice error">{error}</div>}

      {stage.kind === "choose" && (
        <>
          <p>Measures your controller and suggests calibration for the current profile, <b>{profile?.name ?? "—"}</b>. Nothing changes until you review the results and press <b>Apply and save</b>.</p>
          <div className="row gap wrap">
            {PARTS.map((p) => (
              <label key={p.id} className="cal-check">
                <input type="checkbox" checked={selected.includes(p.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                {p.label}
              </label>
            ))}
          </div>
          <p className="muted small">Sticks: centre (3 s, hands off), deadzone, full range. Triggers: released and fully pressed. While calibrating, your controller keeps working as usual (macros and the virtual controller are not paused).</p>
          <button className="btn-primary" disabled={order.length === 0} onClick={() => setStage(firstStage(order[0]!))}>Start</button>
        </>
      )}

      {stage.kind === "center" && (
        <>
          <h3>1. Centre</h3>
          <p>Put the controller down and <b>don't touch the {stage.part === "leftStick" ? "left" : "right"} stick</b>. NEXUS records its resting position for {CENTER_MS / 1000} seconds.</p>
          <LiveStick input={input} side={stage.part} config={config} />
          {sticks[stage.part].center && !sticks[stage.part].center!.ok && <div className="notice warn">{(sticks[stage.part].center as { reason: string }).reason}</div>}
          <button className="btn-primary" disabled={until !== null} onClick={() => record({ kind: "center", part: stage.part, recording: true }, CENTER_MS)}>
            {until !== null ? `Measuring… ${remaining} s` : sticks[stage.part].center ? "Measure again" : "Start measuring"}
          </button>
        </>
      )}

      {stage.kind === "deadzone" && sticks[stage.part].center?.ok && (
        <DeadzoneStep side={stage.part} input={input} config={config} center={(sticks[stage.part].center as { value: CenterResult }).value}
          value={sticks[stage.part].deadzone ?? config[stage.part].deadzone}
          onChange={(deadzone) => setSticks((s) => ({ ...s, [stage.part]: { ...s[stage.part], deadzone } }))}
          onBack={() => setStage({ kind: "center", part: stage.part, recording: false })}
          onNext={() => { buf.current = { samples: [], released: [], pressed: [] }; setStage({ kind: "range", part: stage.part }); }} />
      )}

      {stage.kind === "range" && sticks[stage.part].center?.ok && (
        <RangeStep side={stage.part} input={input} samples={buf.current.samples}
          center={(sticks[stage.part].center as { value: CenterResult }).value.center}
          onRestart={() => { buf.current = { samples: [], released: [], pressed: [] }; setNow(Date.now()); }}
          onDone={(range) => { setSticks((s) => ({ ...s, [stage.part]: { ...s[stage.part], range } })); next(stage.part); }} />
      )}

      {stage.kind === "released" && (
        <>
          <h3>1. Released</h3>
          <p>Take your finger off <b>{stage.part === "leftTrigger" ? "L2" : "R2"}</b> completely.</p>
          <LiveTrigger input={input} side={stage.part} config={config} />
          <button className="btn-primary" disabled={until !== null} onClick={() => record({ kind: "released", part: stage.part, recording: true }, RELEASED_MS)}>
            {until !== null ? `Measuring… ${remaining} s` : "Start"}
          </button>
        </>
      )}

      {stage.kind === "pressed" && (
        <>
          <h3>2. Fully pressed</h3>
          <p>Press <b>{stage.part === "leftTrigger" ? "L2" : "R2"}</b> all the way down, hold it for a moment, then press <b>Done</b>.</p>
          <LiveTrigger input={input} side={stage.part} config={config} />
          <p className="muted small">Highest so far: {Math.max(0, ...buf.current.pressed)} of 255</p>
          <div className="row gap-sm">
            <button className="btn-primary" onClick={() => {
              const result = measureTrigger(buf.current.released, buf.current.pressed);
              setTriggers((t) => ({ ...t, [stage.part]: { result } }));
              if (result.ok) next(stage.part);
              else setStage({ kind: "released", part: stage.part, recording: false });
            }}>Done</button>
            {triggers[stage.part].result && !triggers[stage.part].result!.ok && <span className="warn-text small">{(triggers[stage.part].result as { reason: string }).reason}</span>}
          </div>
        </>
      )}

      {stage.kind === "results" && (() => {
        const { p, warnings } = pending();
        const nextConfig = applyCalibration(config, p);
        return (
          <>
            <h3>Results</h3>
            <p className="muted small">Measured values come from your controller; the deadzone is a setting. Tick what to apply to <b>{profile?.name}</b>.</p>
            <div className="cal-results">
              {order.map((part) => (
                <ResultCard key={part} part={part} sticks={sticks} triggers={triggers} config={config} next={nextConfig}
                  warnings={warnings[part]} apply={apply} setApply={setApply}
                  onRetry={() => setStage(firstStage(part))} />
              ))}
            </div>
            <div className="row gap-sm wrap" style={{ marginTop: 12 }}>
              <button className="btn-primary" disabled={Object.keys(p).length === 0} onClick={() => void doApply()}>Apply and save to {profile?.name}</button>
              <button className="btn-ghost" onClick={cancel}>Cancel (change nothing)</button>
            </div>
          </>
        );
      })()}

      {stage.kind === "applied" && (
        <>
          <p className="ok-text">✓ Calibration applied and saved to {stage.profile}. Games receive it through the virtual controller right away.</p>
          <div className="row gap-sm wrap">
            <button className="btn-secondary" onClick={() => void doRestore(stage.previous)}>Reset to previous calibration</button>
            <button className="btn-ghost" onClick={cancel}>Done</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Steps ------------------------------------------------------------------------

function LiveStick({ input, side, config }: { input: ControllerState; side: StickSide; config: ProcessingConfig }) {
  const st = input[side];
  const [px, py] = processStick(config[side], st.x, st.y);
  return (
    <div className="kv-row mono small">
      <span>Raw {st.rawX} / {st.rawY} → {st.x.toFixed(3)} / {st.y.toFixed(3)}</span>
      <span className="muted">sent to game now {px.toFixed(3)} / {py.toFixed(3)}</span>
    </div>
  );
}

function LiveTrigger({ input, side, config }: { input: ControllerState; side: TriggerSide; config: ProcessingConfig }) {
  const t = input[side];
  return (
    <div className="kv-row mono small">
      <span>Raw {t.raw} of 255 ({p1(t.value)})</span>
      <span className="muted">sent to game now {p1(triggerOutput(config[side], t.value))}</span>
    </div>
  );
}

function DeadzoneStep({ side, input, config, center, value, onChange, onBack, onNext }: {
  side: StickSide; input: ControllerState; config: ProcessingConfig; center: CenterResult; value: number;
  onChange: (v: number) => void; onBack: () => void; onNext: () => void;
}) {
  const advice = adviseDeadzone(center);
  const [text, setText] = useState(() => (value * 100).toFixed(1));
  useEffect(() => setText((value * 100).toFixed(1)), [value]);
  const st = input[side];
  // Preview with the measured centre and the chosen deadzone (not yet applied).
  const preview = { ...config[side], deadzone: value, calibration: { ...config[side].calibration, centerX: center.center.x, centerY: center.center.y } };
  const [px, py] = processStick(preview, st.x, st.y);
  const S = 100, R = 90;
  const toXY = (x: number, y: number) => [S + x * R, S - y * R] as const;
  const [cx, cy] = toXY(center.center.x, center.center.y);
  const [dx, dy] = toXY(st.x, st.y);
  return (
    <>
      <h3>2. Deadzone</h3>
      <div className="row gap wrap">
        <svg viewBox="0 0 200 200" className="cal-plot" role="img" aria-label="Deadzone preview">
          <circle cx={S} cy={S} r={R} className="cal-gate" />
          <path d={`M${S} ${S - R}V${S + R}M${S - R} ${S}H${S + R}`} className="cal-axes" />
          <circle cx={cx} cy={cy} r={Math.max(1, advice.restingMovement * R)} className="cal-noise" />
          <circle cx={cx} cy={cy} r={advice.recommended * R} className="cal-dz-rec" />
          <circle cx={cx} cy={cy} r={value * R} className="cal-dz" />
          <path d={`M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} className="cal-center" />
          <circle cx={dx} cy={dy} r={3.5} className="cal-dot" />
        </svg>
        <div className="lv-stats">
          <div className="kv-row"><span className="muted">Measured centre (hardware)</span><span className="mono">{center.center.x.toFixed(3)} / {center.center.y.toFixed(3)}</span></div>
          <div className="kv-row"><span className="muted">Centre offset (hardware)</span><span className="mono">{p2(center.offset)}</span></div>
          <div className="kv-row"><span className="muted">Resting movement (hardware)</span><span className="mono">{p2(advice.restingMovement)}</span></div>
          <div className="kv-row"><span className="muted">Jitter, RMS (hardware)</span><span className="mono">{p2(center.jitter)}</span></div>
          <div className="kv-row"><span className="muted">Drift in {(center.durationMs / 1000).toFixed(1)} s (hardware)</span><span className="mono">{p2(center.drift)}</span></div>
          <div className="kv-row"><span className="muted">Smallest reliably detectable movement</span><span className="mono">{p2(advice.minDetectable)}</span></div>
          <div className="kv-row"><span className="muted">Recommended deadzone (setting)</span><span className="mono">{p1(advice.recommended)}</span></div>
          <div className="kv-row"><span className="muted">Needed without centre calibration</span><span className="mono">{p1(advice.withoutCalibration)}</span></div>
          <div className="kv-row"><span className="muted">Current deadzone in this profile</span><span className="mono">{p1(config[side].deadzone)}</span></div>
          <label className="ms-input" style={{ marginTop: 8 }}>
            <span>Preview deadzone</span>
            <input className="text-input mono" inputMode="decimal" value={text} aria-label="Preview deadzone (percent)"
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { const n = Number(text); if (Number.isFinite(n)) onChange(Math.max(0, Math.min(50, n)) / 100); else setText((value * 100).toFixed(1)); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            <span className="muted small">%</span>
          </label>
          <div className="row gap-sm" style={{ marginTop: 6 }}>
            <button className="btn-ghost small" onClick={() => onChange(advice.recommended)}>Use recommended</button>
            <button className="btn-ghost small" onClick={() => onChange(config[side].deadzone)}>Keep current</button>
          </div>
          <p className="mono small">Preview output now: {px.toFixed(3)} / {py.toFixed(3)}</p>
        </div>
      </div>
      <p className="muted small">Gold cross: measured centre. Teal dot: the stick now. Grey: resting movement measured. Dashed: recommended deadzone. Gold ring: the deadzone you're previewing. The deadzone is a software setting that hides the measured hardware movement; it is only changed if you apply it.</p>
      <div className="row gap-sm"><button className="btn-ghost" onClick={onBack}>Measure centre again</button><button className="btn-primary" onClick={onNext}>Next: full range</button></div>
    </>
  );
}

function RangeStep({ side, input, samples, center, onRestart, onDone }: {
  side: StickSide; input: ControllerState; samples: Sample[]; center: { x: number; y: number };
  onRestart: () => void; onDone: (r: Measured<RangeResult>) => void;
}) {
  const m = measureRange(samples, center);
  const r = m.ok ? m.value : null;
  const S = 100, R = 85;
  const st = input[side];
  const pts = r ? r.reach.map((v, i) => { const a = (i * 45 * Math.PI) / 180; return `${S + Math.cos(a) * v * R},${S - Math.sin(a) * v * R}`; }).join(" ") : "";
  return (
    <>
      <h3>3. Full range</h3>
      <p>Push the stick fully <b>up, down, left and right</b>, then into the <b>four diagonals</b>, then roll it slowly around the whole edge two or three times.</p>
      <div className="row gap wrap">
        <svg viewBox="0 0 200 200" className="cal-plot" role="img" aria-label="Measured range">
          <circle cx={S} cy={S} r={R} className="cal-gate" />
          <circle cx={S} cy={S} r={R * 0.95} className="cal-expected" />
          <path d={`M${S} ${S - R}V${S + R}M${S - R} ${S}H${S + R}`} className="cal-axes" />
          {r && <polygon points={pts} className="cal-reach" />}
          {samples.filter((_, i) => i % 3 === 0).map((s, i) => <circle key={i} cx={S + (s.x - center.x) * R} cy={S - (s.y - center.y) * R} r={0.9} className="cal-trace" />)}
          <circle cx={S + (st.x - center.x) * R} cy={S - (st.y - center.y) * R} r={3.5} className="cal-dot" />
        </svg>
        <div className="lv-stats">
          <div className="cal-dirs">
            {DIRECTIONS.map((d, i) => <span key={d} className={`lv-chip${r && r.reach[i]! >= 0.9 ? " seen" : ""}`}>{r && r.reach[i]! >= 0.9 ? "✓ " : ""}{d} {r ? p1(r.reach[i]!) : ""}</span>)}
          </div>
          {r ? (
            <>
              <div className="kv-row"><span className="muted">X min / max</span><span className="mono">{r.minX.toFixed(3)} / {r.maxX.toFixed(3)}</span></div>
              <div className="kv-row"><span className="muted">Y min / max</span><span className="mono">{r.minY.toFixed(3)} / {r.maxY.toFixed(3)}</span></div>
              <div className="kv-row"><span className="muted">Furthest from centre</span><span className="mono">{p1(r.maxRadius)}</span></div>
              <div className="kv-row"><span className="muted">Diagonal ÷ straight reach</span><span className="mono">{r.diagonalRatio.toFixed(2)}</span></div>
              <div className="kv-row"><span className="muted">Circle covered</span><span className="mono">{Math.round(r.coverage * 100)} %</span></div>
              <div className="kv-row"><span className="muted">Reaches 95 % straight</span><span className={r.reachesExpected ? "ok-text" : "warn-text"}>{r.reachesExpected ? "Yes" : "Not yet"}</span></div>
            </>
          ) : <p className="muted small">{m.ok ? "" : m.reason}</p>}
        </div>
      </div>
      <p className="muted small">The polygon is exactly the furthest point measured in each of eight directions; the dashed circle is 95 %. Nothing is scaled up for display.</p>
      <div className="row gap-sm">
        <button className="btn-ghost" onClick={onRestart}>Start range again</button>
        <button className="btn-primary" disabled={!m.ok} onClick={() => onDone(m)}>{r?.complete ? "Done" : "Use what was measured"}</button>
      </div>
    </>
  );
}

function ResultCard({ part, sticks, triggers, config, next, warnings, apply, setApply, onRetry }: {
  part: Part; sticks: Record<StickSide, StickMeasure>; triggers: Record<TriggerSide, TriggerMeasure>;
  config: ProcessingConfig; next: ProcessingConfig; warnings: string[];
  apply: Record<string, boolean>; setApply: (f: (a: Record<string, boolean>) => Record<string, boolean>) => void; onRetry: () => void;
}) {
  const label = PARTS.find((p) => p.id === part)!.label;
  const tick = (key: string, text: string) => (
    <label className="cal-check"><input type="checkbox" checked={apply[key] !== false} onChange={(e) => setApply((a) => ({ ...a, [key]: e.target.checked }))} />{text}</label>
  );
  const row = (k: string, v: string) => <div className="kv-row"><span className="muted">{k}</span><span className="mono">{v}</span></div>;
  if (isStick(part)) {
    const m = sticks[part];
    const c = m.center?.ok ? m.center.value : null;
    const r = m.range?.ok ? m.range.value : null;
    const cal = next[part].calibration;
    return (
      <div className="cal-result">
        <h4>{label}</h4>
        {c ? <>
          {row("Measured centre", `${c.center.x.toFixed(3)} / ${c.center.y.toFixed(3)} (offset ${p2(c.offset)})`)}
          {row("Resting movement · jitter · drift", `${p2(c.maxDeviation)} · ${p2(c.jitter)} · ${p2(c.drift)}`)}
        </> : row("Centre", "not measured")}
        {r ? <>
          {row("X range · Y range", `${r.minX.toFixed(2)}…${r.maxX.toFixed(2)} · ${r.minY.toFixed(2)}…${r.maxY.toFixed(2)}`)}
          {row("Furthest · diagonal ratio · circle", `${p1(r.maxRadius)} · ${r.diagonalRatio.toFixed(2)} · ${Math.round(r.coverage * 100)} %`)}
        </> : row("Full range", "not measured")}
        {row("Deadzone", `${p1(config[part].deadzone)} → ${p1(next[part].deadzone)}`)}
        {row("Stored calibration", `centre ${cal.centerX.toFixed(3)}/${cal.centerY.toFixed(3)}, X ${cal.minX.toFixed(2)}…${cal.maxX.toFixed(2)}, Y ${cal.minY.toFixed(2)}…${cal.maxY.toFixed(2)}`)}
        {c && <div className="row gap wrap">{tick(`${part}.cal`, "Apply centre and range")}{tick(`${part}.dz`, "Apply deadzone")}</div>}
        {warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
        <button className="btn-ghost small" onClick={onRetry}>Retry {label}</button>
      </div>
    );
  }
  const m = triggers[part].result;
  return (
    <div className="cal-result">
      <h4>{label}</h4>
      {m?.ok ? <>
        {row("Released (raw)", `${m.value.releasedMin}–${m.value.releasedMax} of 255`)}
        {row("Fully pressed (raw)", `${m.value.pressedMax} of 255`)}
        {row("Endpoints", `${p1(config[part].rawMin)}–${p1(config[part].rawMax)} → ${p1(next[part].rawMin)}–${p1(next[part].rawMax)}`)}
        {tick(`${part}.cal`, "Apply endpoints")}
      </> : row("Measurement", "not usable")}
      {warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
      <button className="btn-ghost small" onClick={onRetry}>Retry {label}</button>
    </div>
  );
}
