import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../Icons";
import { evaluateCurve, pct } from "../../lib/processing";
import type { CurvePoint, ResponseCurve, StickConfig } from "../../types/engine";

/** Labelled slider for a 0–1 (or custom range) value. */
export function Slider({ label, tip, value, min = 0, max = 1, step = 0.01, format = pct, onChange }: {
  label: string; tip: string; value: number; min?: number; max?: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="slider-field">
      <span className="slider-head">
        <span className="field-label" data-tip={tip}>{label}</span>
        <span className="mono gold small">{format(value)}</span>
      </span>
      <input type="range" className="slider" min={min} max={max} step={step} value={value}
        // The filled part of the track (display only).
        style={{ "--fill": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}

const SIZE = 220;
const R = SIZE / 2 - 10;

/**
 * Stick position: physical input (grey) and processed output (accent), with
 * the deadzone and outer deadzone drawn to scale.
 */
export function StickPlot({ config, raw, processed, label }: {
  config: StickConfig;
  raw: [number, number] | null;
  processed: [number, number] | null;
  label: string;
}) {
  const c = SIZE / 2;
  const toPx = ([x, y]: [number, number]) => [c + x * R, c - y * R] as const;
  const dz = config.deadzone * R;
  const outer = (1 - config.outerDeadzone) * R;
  return (
    <figure className="stick-plot">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label} position`}>
        <rect x={c - R} y={c - R} width={2 * R} height={2 * R} rx={14} className="sp-bg" />
        <circle cx={c} cy={c} r={R} className="sp-ring" />
        <line x1={c - R} y1={c} x2={c + R} y2={c} className="sp-axis" />
        <line x1={c} y1={c - R} x2={c} y2={c + R} className="sp-axis" />
        {config.outerDeadzone > 0 && <circle cx={c} cy={c} r={outer} className="sp-outer" />}
        {config.shape === "radial"
          ? <circle cx={c} cy={c} r={dz} className="sp-deadzone" />
          : <>
              <rect x={c - dz} y={c - R} width={2 * dz} height={2 * R} className="sp-deadzone" />
              <rect x={c - R} y={c - dz} width={2 * R} height={2 * dz} className="sp-deadzone" />
            </>}
        {raw && (() => { const [x, y] = toPx(raw); return <circle cx={x} cy={y} r={6} className="sp-raw" />; })()}
        {processed && (() => { const [x, y] = toPx(processed); return <circle cx={x} cy={y} r={7} className="sp-out" />; })()}
      </svg>
      <figcaption>
        <strong>{label}</strong>
        <span className="legend"><i className="dot-raw" /> Your stick <i className="dot-out" /> Sent to game</span>
        {processed && <span className="mono small muted">{processed[0].toFixed(2)}, {processed[1].toFixed(2)}</span>}
      </figcaption>
    </figure>
  );
}

const G = 240;
const PAD = 16;
const SPAN = G - 2 * PAD;

/**
 * Response curve graph. Custom curves can be edited by dragging points;
 * a point is removed by right-click, or by selecting it (click or Tab) and
 * pressing Delete or using "Remove point".
 */
export function CurveEditor({ curve, onChange, liveInput }: {
  curve: ResponseCurve;
  onChange: (c: ResponseCurve) => void;
  /** Current deflection (0–1) to mark on the curve. */
  liveInput: number | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  // The point chosen for keyboard removal, and the point to focus after one is removed.
  const [sel, setSel] = useState<number | null>(null);
  const pointEls = useRef(new Map<number, SVGCircleElement>());
  const focusAfter = useRef<number | null>(null);
  const px = (x: number) => PAD + x * SPAN;
  const py = (y: number) => G - PAD - y * SPAN;
  const path = Array.from({ length: 61 }, (_, i) => {
    const x = i / 60;
    return `${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(evaluateCurve(curve, x)).toFixed(1)}`;
  }).join(" ");
  const points = curve.type === "custom" ? curve.points : [];

  const toValue = (e: React.PointerEvent): CurvePoint => {
    const r = svg.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * G;
    const sy = ((e.clientY - r.top) / r.height) * G;
    return {
      x: Math.min(0.98, Math.max(0.02, (sx - PAD) / SPAN)),
      y: Math.min(1, Math.max(0, (G - PAD - sy) / SPAN)),
    };
  };

  const setPoints = (pts: CurvePoint[]) =>
    onChange({ type: "custom", points: [...pts].sort((a, b) => a.x - b.x).slice(0, 8) });
  // The same removal as right-click; from the keyboard, focus moves to the neighbouring point.
  const removePoint = (i: number, fromKeyboard: boolean) => {
    const rest = points.filter((_, j) => j !== i);
    setPoints(rest);
    const next = rest.length ? Math.min(i, rest.length - 1) : null;
    setSel(next);
    focusAfter.current = fromKeyboard ? next : null;
  };
  useEffect(() => {
    if (focusAfter.current === null) return;
    pointEls.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  });
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="curve-editor">
      <svg ref={svg} width={G} height={G} viewBox={`0 0 ${G} ${G}`} className={curve.type === "custom" ? "editable" : ""}
        onPointerMove={(e) => {
          if (drag === null || curve.type !== "custom") return;
          const v = toValue(e);
          setPoints(points.map((p, i) => (i === drag ? v : p)));
        }}
        onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}
        onDoubleClick={(e) => {
          if (curve.type !== "custom" || points.length >= 8) return;
          setPoints([...points, toValue(e as unknown as React.PointerEvent)]);
        }}
        role={curve.type === "custom" ? "group" : "img"} aria-label="Response curve">
        <rect x={PAD} y={PAD} width={SPAN} height={SPAN} className="cg-bg" />
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t}>
            <line x1={px(t)} y1={PAD} x2={px(t)} y2={G - PAD} className="cg-grid" />
            <line x1={PAD} y1={py(t)} x2={G - PAD} y2={py(t)} className="cg-grid" />
          </g>
        ))}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="cg-diag" />
        <path d={path} className="cg-curve" />
        {liveInput !== null && liveInput > 0 && (
          <circle cx={px(liveInput)} cy={py(evaluateCurve(curve, liveInput))} r={5} className="cg-live" />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r={7} className={`cg-point${sel === i ? " selected" : ""}`}
            ref={(el) => { if (el) pointEls.current.set(i, el); else pointEls.current.delete(i); }}
            tabIndex={0} role="button" aria-pressed={sel === i}
            aria-label={`Curve point ${i + 1}: stick ${pct(p.x)}, output ${pct(p.y)}. Delete removes it.`}
            onFocus={() => setSel(i)}
            onKeyDown={(e) => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removePoint(i, true); } }}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setDrag(i); setSel(i); }}
            onContextMenu={(e) => { e.preventDefault(); removePoint(i, false); }} />
        ))}
        <text x={PAD} y={G - 2} className="cg-label">Stick</text>
        <text x={G - PAD} y={PAD - 4} className="cg-label end">Output</text>
      </svg>
      {curve.type === "custom" && <>
        <div className="cg-actions">
          <button type="button" className="btn-ghost small" disabled={sel === null || !points[sel]}
            onClick={() => { if (sel !== null && points[sel]) removePoint(sel, false); }}>
            <Icon name="trash" size={13} /> {sel !== null && points[sel] ? `Remove point ${sel + 1}` : "Remove point"}
          </button>
        </div>
        <p className="muted small">Drag points to shape the curve. Double-click to add a point (up to 8). To remove one, right-click it, or select it (click or Tab) and press Delete.</p>
      </>}
    </div>
  );
}

export function TriggerMeter({ label, raw, processed, deadzone, maxInput }: {
  label: string; raw: number; processed: number; deadzone: number; maxInput: number;
}) {
  return (
    <div className="trigger-meter">
      <div className="tm-head"><strong>{label}</strong><span className="mono small muted">{pct(raw)} → <span className="gold">{pct(processed)}</span></span></div>
      <div className="tm-track" aria-hidden="true">
        <div className="tm-dead" style={{ width: `${deadzone * 100}%` }} />
        <div className="tm-sat" style={{ left: `${maxInput * 100}%` }} />
        <div className="tm-raw" style={{ width: `${raw * 100}%` }} />
      </div>
      <div className="tm-track out" aria-hidden="true"><div className="tm-out" style={{ width: `${processed * 100}%` }} /></div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string; tip?: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented small-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? "selected" : ""} data-tip={o.tip} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card panel">
      <div className="card-title-row"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}
