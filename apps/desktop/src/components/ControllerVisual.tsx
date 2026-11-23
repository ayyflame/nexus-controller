import { Component, Suspense, lazy, useId, type KeyboardEvent, type ReactNode } from "react";
import type { Anchors } from "./controller3d/Controller3D";
import { saveViewMode, useViewMode, webglAvailable } from "../lib/controllerViewMode";
import type { ButtonMark } from "../lib/buttonMapping";
import { HOTSPOTS, PHOTO, STICK_TRAVEL, TOUCH_BOX, TRIGGER_SHAPES, VIEW, useControllerPhoto, useCutoutPhoto, type Hotspot } from "../lib/controllerPhoto";
import { describeState, dpadLit, stickOffset, touchPosition, triggerLevel, triggerPath, type TriggerShape } from "../lib/controllerView";
import type { ControllerState, MacroButton } from "../types/engine";
import { DS4_ART, DS4_OUTLINES, DS4_TOUCH_BOX, DS4_TRIGGERS, artPosition } from "../lib/dualshock4Art";
import { useShownModel } from "../hooks/useShownModel";

/**
 * Front view of a DualSense-style controller in matte black with blue light
 * strips, drawn from scratch as SVG (no logos or trademarks), driven only by
 * real, parsed input. Gold marks a pressed control, teal the selected one.
 *
 * - `state` null: drawn dimmed in a neutral pose and never animated, so it
 *   cannot be mistaken for live data.
 * - `onSelect`: buttons become clickable (and keyboard-focusable) to show
 *   their mapping; `selected` is outlined in teal.
 * - `marks`: small indicators for remapped, disabled and macro buttons.
 */
interface VisualProps {
  state: ControllerState | null;
  live: boolean;
  selected?: MacroButton | null;
  onSelect?: (b: MacroButton) => void;
  marks?: Partial<Record<MacroButton, ButtonMark>>;
  /** Always the flat picture (small secondary previews). */
  flat?: boolean;
  /** 3D only: wording of the badge shown while there is no live input. */
  offlineLabel?: string;
  /** 3D only: projected positions of the controls, for leader lines. */
  onAnchors?: (a: Anchors) => void;
}

/** The 3D view is loaded on first use, so pages that only show the flat picture stay light. */
const Controller3D = lazy(() => import("./controller3d/Controller3D"));

/**
 * The controller picture used across NEXUS: the interactive 3D model by
 * default, or the flat picture (drawing or the user's photo) when chosen,
 * when `flat` is set, or when this PC can't draw WebGL.
 */
export function ControllerVisual({ flat, onAnchors, offlineLabel, ...props }: VisualProps) {
  const mode = useViewMode();
  if (!flat && mode === "3d" && webglAvailable()) {
    return (
      <Fallback3D fallback={<FlatController {...props} />}>
        <Suspense fallback={<div className="c3d c3d-loading" aria-label="Loading the 3D controller" />}>
          <Controller3D {...props} onAnchors={onAnchors} offlineLabel={offlineLabel} onFlat={() => saveViewMode("flat")} />
        </Suspense>
      </Fallback3D>
    );
  }
  // 2D chosen by the user (not forced): offer the way back to 3D right on the picture.
  if (!flat && mode === "flat" && webglAvailable()) {
    return (
      <div className="flat-view">
        <FlatController {...props} />
        <button type="button" className="flat-to-3d" onClick={() => saveViewMode("3d")} title="Show the interactive 3D controller">3D</button>
      </div>
    );
  }
  return <FlatController {...props} />;
}

/** If the 3D view fails (e.g. the graphics driver refuses WebGL), show the flat picture instead. */
class Fallback3D extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn("3D controller view unavailable; showing the flat picture.", e); }
  render() {
    return this.state.failed
      ? <>{this.props.fallback}<p className="muted small c3d-note">The 3D view isn't available on this PC, so the flat picture is shown.</p></>
      : this.props.children;
  }
}

/**
 * Shows the user's own controller photo with live overlays when they chose
 * the calibrated image (Controller › Live › Controller picture); otherwise
 * the drawn controller below. A DualShock 4 is always drawn as a DualShock 4
 * (the photo is of a DualSense).
 */
function FlatController(props: Omit<VisualProps, "flat" | "onAnchors" | "offlineLabel">) {
  const model = useShownModel(props.state);
  const photo = useControllerPhoto();
  const cutout = useCutoutPhoto(photo);
  if (model === "dualShock4") return <DrawnDualShock4 {...props} />;
  if (photo && !cutout) return <div className="controller-photo" style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}` }} />;
  return cutout ? <PhotoController photo={cutout} {...props} /> : <DrawnController {...props} />;
}

/** Common props for every pressable part (selection, keyboard, labels). */
function partProps(
  id: MacroButton, pressed: boolean | undefined, label: string,
  { selected, onSelect, marks }: Pick<VisualProps, "selected" | "onSelect" | "marks">,
) {
  const mark = marks?.[id];
  const cls = ["part", pressed ? "on" : "", selected === id ? "selected" : "", mark?.disabled ? "disabled" : "",
    onSelect ? "pickable" : ""].filter(Boolean).join(" ");
  const select = onSelect ? () => onSelect(id) : undefined;
  return {
    className: cls,
    "data-button": id,
    ...(onSelect ? {
      role: "button",
      tabIndex: 0,
      "aria-label": `${label}${pressed ? ", pressed" : ""}`,
      "aria-pressed": selected === id,
      onClick: select,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select?.(); }
      },
    } : {}),
  };
}

/** Indicator dots: teal = remapped, gold = macro, red = disabled, outline = layer/gyro. */
function markDots(mark: ButtonMark | undefined, x: number, y: number, r: number): ReactNode {
  if (!mark) return null;
  const dots: Array<[string, string]> = [];
  if (mark.disabled) dots.push(["mark-disabled", "Disabled"]);
  if (mark.remapped) dots.push(["mark-remapped", "Remapped"]);
  if (mark.macro) dots.push(["mark-macro", "Starts a macro"]);
  if (mark.special) dots.push(["mark-special", "Used by a layer or gyro"]);
  return (
    <g className="marks" pointerEvents="none">
      {dots.map(([c, t], i) => <circle key={c} cx={x + i * r * 2.2} cy={y} r={r} className={c}><title>{t}</title></circle>)}
    </g>
  );
}

const LABELS: Record<MacroButton, string> = {
  south: "Cross", east: "Circle", west: "Square", north: "Triangle", leftShoulder: "L1", rightShoulder: "R1",
  leftTrigger: "L2", rightTrigger: "R2", leftStick: "Left stick (L3)", rightStick: "Right stick (R3)",
  start: "Options", select: "Create", home: "PS button", touchpad: "Touchpad click", mute: "Mute",
  dpadUp: "D-pad up", dpadDown: "D-pad down", dpadLeft: "D-pad left", dpadRight: "D-pad right",
};

function hotspotShape(h: Hotspot, className: string): ReactNode {
  if (h.kind === "circle") return <circle cx={h.cx} cy={h.cy} r={h.r} className={className} />;
  if (h.kind === "polygon") return <polygon points={h.points.map((p) => p.join(",")).join(" ")} className={className} />;
  const t = h.rotate ? `rotate(${h.rotate} ${h.x + h.w / 2} ${h.y + h.h / 2})` : undefined;
  return <rect x={h.x} y={h.y} width={h.w} height={h.h} rx={h.rx} transform={t} className={className} />;
}

function hotspotCorner(h: Hotspot): [number, number] {
  if (h.kind === "circle") return [h.cx + h.r * 0.75, h.cy - h.r * 0.85];
  if (h.kind === "rect") return [h.x + h.w, h.y];
  const xs = h.points.map((p) => p[0]); const ys = h.points.map((p) => p[1]);
  return [Math.max(...xs) - 6, Math.min(...ys) + 4];
}

/**
 * The chosen photograph, shown unchanged at its own aspect ratio, with an SVG
 * overlay in the photo's pixel coordinates (viewBox = image size), so every
 * overlay scales with the image. Overlays are invisible while inactive.
 */
function PhotoController({ photo, state, live, selected = null, onSelect, marks }: VisualProps & { photo: string }) {
  const uid = useId().replace(/:/g, "");
  const s = live ? state : null;
  const b = s?.buttons;
  const d = dpadLit(s?.dpad);
  const pressed: Partial<Record<MacroButton, boolean>> = {
    south: b?.south, east: b?.east, west: b?.west, north: b?.north,
    leftShoulder: b?.leftShoulder, rightShoulder: b?.rightShoulder, leftStick: b?.leftStick, rightStick: b?.rightStick,
    start: b?.start, select: b?.select, home: b?.home, touchpad: b?.touchpad, mute: b?.mute,
    dpadUp: d.up, dpadDown: d.down, dpadLeft: d.left, dpadRight: d.right,
  };
  const ctx = { selected, onSelect, marks };
  const touch = s?.touchpad;

  const stick = (id: "leftStick" | "rightStick", x: number, y: number) => {
    const h = HOTSPOTS[id] as Extract<Hotspot, { kind: "circle" }>;
    const [dx, dy] = stickOffset(x, y, STICK_TRAVEL);
    const moved = Math.hypot(dx, dy) > 0.6;
    return (
      <g key={id} {...partProps(id, pressed[id], LABELS[id], ctx)}>
        <circle cx={h.cx} cy={h.cy} r={h.r} className="hit" />
        <circle cx={h.cx} cy={h.cy} r={h.r} className="press-ring" />
        {live && moved && <line x1={h.cx} y1={h.cy} x2={h.cx + dx} y2={h.cy + dy} className="stick-vector" />}
        {live && moved && <circle cx={h.cx + dx} cy={h.cy + dy} r={3.6} className="stick-dot" />}
        {markDots(marks?.[id], ...hotspotCorner(h), 1.8)}
      </g>
    );
  };

  const trigger = (id: "leftTrigger" | "rightTrigger", value: number, digital: boolean | undefined) => {
    const t = TRIGGER_SHAPES[id];
    const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    const label = id === "leftTrigger" ? "L2" : "R2";
    return (
      <g key={id} {...partProps(id, digital, `${label}, ${Math.round(v * 100)}%`, ctx)}>
        <TriggerTab id={`${uid}-${id}`} shape={t} value={v} label={label} fontSize={5.4} />
        {v > 0.005 && <text x={(t.outer + t.inner) / 2} y={t.top - 3} className="trigger-readout" textAnchor="middle">{Math.round(v * 100)}%</text>}
        {markDots(marks?.[id], t.inner, t.top - 2, 1.8)}
      </g>
    );
  };

  return (
    <div className={`controller-photo${live ? " live" : " idle"}${onSelect ? " interactive" : ""}`}
      style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}` }}>
      {/* Whole photo, scaled so the VIEW box fills the frame (only empty, now transparent, margins fall outside). */}
      <img src={photo} alt="" draggable={false} style={{
        width: `${(PHOTO.width / VIEW.w) * 100}%`, height: `${(PHOTO.height / VIEW.h) * 100}%`,
        left: `${(-VIEW.x / VIEW.w) * 100}%`, top: `${(-VIEW.y / VIEW.h) * 100}%`,
      }} />
      <svg className="controller controller-overlay" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} role="group"
        aria-label={live ? `Live controller input. ${describeState(s)}` : "Controller (no live input)"}>
        {trigger("leftTrigger", s?.leftTrigger.value ?? 0, s?.leftTrigger.digital)}
        {trigger("rightTrigger", s?.rightTrigger.value ?? 0, s?.rightTrigger.digital)}
        {(Object.keys(HOTSPOTS) as MacroButton[]).filter((id) => id !== "leftStick" && id !== "rightStick").map((id) => {
          const h = HOTSPOTS[id]!;
          return (
            <g key={id} {...partProps(id, pressed[id], LABELS[id], ctx)}>
              {hotspotShape(h, "hit")}
              {id === "touchpad" && touch?.points.filter((p) => p.active).map((p) => {
                const [x, y] = touchPosition(p, touch, TOUCH_BOX);
                return <circle key={p.id} cx={x} cy={y} r={2.8} className="touch-point" />;
              })}
              {markDots(marks?.[id], ...hotspotCorner(h), 1.8)}
            </g>
          );
        })}
        {stick("leftStick", s?.leftStick.x ?? 0, s?.leftStick.y ?? 0)}
        {stick("rightStick", s?.rightStick.x ?? 0, s?.rightStick.y ?? 0)}
      </svg>
    </div>
  );
}

function DrawnController({ state, live, selected = null, onSelect, marks }: VisualProps) {
  const uid = useId().replace(/:/g, "");
  const s = live ? state : null;
  const b = s?.buttons;
  const d = dpadLit(s?.dpad);

  /** Props shared by every pressable part. */
  const part = (id: MacroButton, pressed: boolean | undefined, label: string) => {
    const mark = marks?.[id];
    const cls = ["part", pressed ? "on" : "", selected === id ? "selected" : "", mark?.disabled ? "disabled" : "",
      onSelect ? "pickable" : ""].filter(Boolean).join(" ");
    const select = onSelect ? () => onSelect(id) : undefined;
    return {
      className: cls,
      "data-button": id,
      ...(onSelect ? {
        role: "button",
        tabIndex: 0,
        "aria-label": `${label}${pressed ? ", pressed" : ""}`,
        "aria-pressed": selected === id,
        onClick: select,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select?.(); }
        },
      } : {}),
    };
  };

  /** Indicator dots at (x, y): teal = remapped, gold = macro, red = disabled, outline = layer/gyro. */
  const badge = (id: MacroButton, x: number, y: number): ReactNode => {
    const m = marks?.[id];
    if (!m) return null;
    const dots: Array<[string, string]> = [];
    if (m.disabled) dots.push(["mark-disabled", "Disabled"]);
    if (m.remapped) dots.push(["mark-remapped", "Remapped"]);
    if (m.macro) dots.push(["mark-macro", "Starts a macro"]);
    if (m.special) dots.push(["mark-special", "Used by a layer or gyro"]);
    return (
      <g className="marks" pointerEvents="none">
        {dots.map(([c, t], i) => <circle key={c} cx={x + i * 9} cy={y} r={4} className={c}><title>{t}</title></circle>)}
      </g>
    );
  };

  // ---- Geometry (viewBox 800 x 520) ------------------------------------
  // Measured from the front-view reference (400 px image, controller box
  // x 80–323, y 127–290) and scaled by 2.963: X = 40 + (x − 80) · 2.963,
  // Y = 24 + (y − 127) · 2.963.
  const DPAD = { x: 176, y: 150 };
  const FACE = { x: 621, y: 157, gap: 47, r: 24 };
  const LS = { x: 286, y: 255 };
  const RS = { x: 514, y: 255 };
  const TRAVEL = 20;
  /** Length of the direction line at full deflection. */
  const REACH = 58;
  const TP = { x: 262, y: 36, w: 276, h: 139 };
  const SHELL = "M400 36L548 36C590 34 640 32 664 42C684 54 698 84 704 107C716 150 730 182 739 214C748 248 756 290 758 330C760 370 758 410 752 440C746 468 734 486 718 496C704 504 688 508 672 507C660 506 652 500 648 488C642 470 638 460 634 450C624 426 614 402 606 388C598 372 592 354 582 344C574 338 566 336 556 336L400 338L244 336C234 336 226 338 218 344C208 354 202 372 194 388C186 402 176 426 166 450C162 460 158 470 152 488C148 500 140 506 128 507C112 508 96 504 82 496C66 486 54 468 48 440C42 410 40 370 42 330C44 290 52 248 61 214C70 182 84 150 96 107C102 84 116 54 136 42C160 32 210 34 252 36L400 36Z";
  /** Touchpad: flush with the top edge, narrowing slightly to a rounded bottom. */
  const TP_PATH =
    `M${TP.x} ${TP.y}H${TP.x + TP.w}L${TP.x + TP.w - 13} ${TP.y + TP.h - 16}` +
    `Q${TP.x + TP.w - 16} ${TP.y + TP.h} ${TP.x + TP.w - 32} ${TP.y + TP.h}H${TP.x + 32}` +
    `Q${TP.x + 16} ${TP.y + TP.h} ${TP.x + 13} ${TP.y + TP.h - 16}Z`;

  const stick = (id: MacroButton, c: { x: number; y: number }, x: number, y: number, pressed: boolean | undefined, label: string) => {
    const [dx, dy] = stickOffset(x, y, TRAVEL);
    const [vx, vy] = stickOffset(x, y, REACH);
    const moved = Math.hypot(dx, dy) > 1.5;
    return (
      <g {...part(id, pressed, label)}>
        <circle cx={c.x} cy={c.y} r={46} className="stick-well" />
        <circle cx={c.x} cy={c.y} r={TRAVEL} className="stick-range" />
        {moved && <line x1={c.x} y1={c.y} x2={c.x + vx} y2={c.y + vy} className="stick-vector" />}
        <circle cx={c.x + dx} cy={c.y + dy + 2} r={41} className="stick-shadow" />
        <circle cx={c.x + dx} cy={c.y + dy} r={41} className="stick-cap" fill={`url(#${uid}-cap)`} />
        <circle cx={c.x + dx} cy={c.y + dy} r={29} className="stick-top" fill={`url(#${uid}-dish)`} />
        <circle cx={c.x + dx} cy={c.y + dy} r={41} className="stick-ring" />
        {moved && <line x1={c.x + dx} y1={c.y + dy} x2={c.x + vx} y2={c.y + vy} className="stick-vector front" />}
        {moved && <circle cx={c.x + vx} cy={c.y + vy} r={7} className="stick-dot" />}
        {badge(id, c.x + 36, c.y - 42)}
      </g>
    );
  };

  /** L2/R2 rise from behind the bumpers, following their outline; pressure fills them from below. */
  const trigger = (id: "leftTrigger" | "rightTrigger", value: number, digital: boolean | undefined, label: string) => {
    const t = DRAWN_TRIGGERS[id];
    const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    return (
      <g {...part(id, digital, `${label}, ${Math.round(v * 100)}%`)}>
        <TriggerTab id={`${uid}-${id}`} shape={t} value={v} label={label} fontSize={15} />
        {v > 0.005 && <text x={(t.outer + t.inner) / 2} y={t.top - 8} className="trigger-readout" textAnchor="middle">{Math.round(v * 100)}%</text>}
        {badge(id, t.inner - (t.inner > t.outer ? 8 : -8), t.top - 2)}
      </g>
    );
  };

  /** D-pad arm pointing up from the centre, rotated for the other directions. */
  const arm = (id: MacroButton, on: boolean, angle: number, label: string) => (
    <g {...part(id, on, label)} transform={`rotate(${angle} ${DPAD.x} ${DPAD.y})`}>
      <path
        d={`M${DPAD.x - 18} ${DPAD.y - 55}Q${DPAD.x - 18} ${DPAD.y - 62} ${DPAD.x - 11} ${DPAD.y - 62}H${DPAD.x + 11}Q${DPAD.x + 18} ${DPAD.y - 62} ${DPAD.x + 18} ${DPAD.y - 55}V${DPAD.y - 29}L${DPAD.x} ${DPAD.y - 12}L${DPAD.x - 18} ${DPAD.y - 29}Z`}
        className="key" fill="#1f2024"
      />
      <path d={`M${DPAD.x} ${DPAD.y - 50}l-4.5 6h9z`} className="arrow" />
      {badge(id, DPAD.x + 13, DPAD.y - 63)}
    </g>
  );

  const face = (id: MacroButton, cx: number, cy: number, on: boolean | undefined, label: string, symbol: ReactNode) => (
    <g {...part(id, on, label)}>
      <circle cx={cx} cy={cy + 2} r={FACE.r} className="key-shadow" />
      <circle cx={cx} cy={cy} r={FACE.r} className="key round" fill={`url(#${uid}-key)`} />
      {symbol}
      {badge(id, cx + 14, cy - 20)}
    </g>
  );

  const fx = FACE.x, fy = FACE.y, g = FACE.gap;
  const touch = s?.touchpad;

  return (
    <svg className={`controller dualsense${live ? " live" : " idle"}${onSelect ? " interactive" : ""}`}
      viewBox="0 -38 800 558" role="group"
      aria-label={live ? `Live controller input. ${describeState(s)}` : "Controller (no live input)"}>
      <defs>
        <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e2f33" />
          <stop offset="0.45" stopColor="#25262a" />
          <stop offset="1" stopColor="#131418" />
        </linearGradient>
        <linearGradient id={`${uid}-pad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2b30" />
          <stop offset="1" stopColor="#232429" />
        </linearGradient>
        <linearGradient id={`${uid}-key`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24262b" />
          <stop offset="1" stopColor="#101114" />
        </linearGradient>
        <radialGradient id={`${uid}-cap`} cx="0.42" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#363a45" />
          <stop offset="1" stopColor="#22252d" />
        </radialGradient>
        <radialGradient id={`${uid}-dish`} cx="0.5" cy="0.62" r="0.65">
          <stop offset="0" stopColor="#2c2f39" />
          <stop offset="1" stopColor="#1f2128" />
        </radialGradient>
        <filter id={`${uid}-shadow`} x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity="0.7" />
        </filter>
        <filter id={`${uid}-glow`} x="-50%" y="-20%" width="200%" height="140%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Triggers (behind) and bumpers */}
      {trigger("leftTrigger", s?.leftTrigger.value ?? 0, s?.leftTrigger.digital, "L2")}
      {trigger("rightTrigger", s?.rightTrigger.value ?? 0, s?.rightTrigger.digital, "R2")}
      <g {...part("leftShoulder", b?.leftShoulder, "L1")}>
        <path d="M134 46Q140 22 170 20H202Q222 21 228 38L230 46Z" className="key shoulder" />
        {badge("leftShoulder", 226, 18)}
      </g>
      <g {...part("rightShoulder", b?.rightShoulder, "R1")}>
        <path d="M666 46Q660 22 630 20H598Q578 21 572 38L570 46Z" className="key shoulder" />
        {badge("rightShoulder", 662, 18)}
      </g>

      {/* Body: one matte-black shell */}
      <path d={SHELL} filter={`url(#${uid}-shadow)`} fill={`url(#${uid}-shell)`} className="shell" />

      {/* Touchpad with the blue light strips along both sides */}
      <g {...part("touchpad", b?.touchpad, "Touchpad click")}>
        <path className="key touchpad" d={TP_PATH} fill={`url(#${uid}-pad)`} />
        {touch?.points.filter((p) => p.active).map((p) => {
          const [x, y] = touchPosition(p, touch, TP);
          return <circle key={p.id} cx={x} cy={y} r={8} className="touch-point" />;
        })}
        {badge("touchpad", TP.x + TP.w - 18, TP.y + 14)}
      </g>
      <g className="lightbar" filter={`url(#${uid}-glow)`} pointerEvents="none">
        <path d="M253 50L271 166" />
        <path d="M547 50L529 166" />
      </g>

      {/* Create and Options */}
      <g {...part("select", b?.select, "Create")}>
        <title>Create</title>
        <rect x={233} y={66} width={11} height={28} rx={5.5} transform="rotate(-15 238.5 80)" className="key small" fill={`url(#${uid}-key)`} />
        {badge("select", 250, 64)}
      </g>
      <g {...part("start", b?.start, "Options")}>
        <title>Options</title>
        <rect x={556} y={66} width={11} height={28} rx={5.5} transform="rotate(15 561.5 80)" className="key small" fill={`url(#${uid}-key)`} />
        {badge("start", 574, 64)}
      </g>

      {/* D-pad */}
      {arm("dpadUp", d.up, 0, "D-pad up")}
      {arm("dpadRight", d.right, 90, "D-pad right")}
      {arm("dpadDown", d.down, 180, "D-pad down")}
      {arm("dpadLeft", d.left, 270, "D-pad left")}

      {/* Face buttons */}
      {face("north", fx, fy - g, b?.north, "Triangle", <path d={`M${fx} ${fy - g - 10}l10 16.5h-20z`} className="symbol" />)}
      {face("east", fx + g, fy, b?.east, "Circle", <circle cx={fx + g} cy={fy} r={9.5} className="symbol" />)}
      {face("south", fx, fy + g, b?.south, "Cross", <path d={`M${fx - 8.5} ${fy + g - 8.5}l17 17M${fx + 8.5} ${fy + g - 8.5}l-17 17`} className="symbol" />)}
      {face("west", fx - g, fy, b?.west, "Square", <rect x={fx - g - 8.5} y={fy - 8.5} width={17} height={17} rx={1} className="symbol" />)}

      {/* Speaker grille */}
      <g className="speaker" pointerEvents="none">
        {[-3, -2, -1, 0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => (
          <rect key={`${c}${r}`} x={400 + c * 7 - 2} y={196 + r * 7} width={4} height={4} rx={1} />
        )))}
      </g>

      {/* Sticks */}
      {stick("leftStick", LS, s?.leftStick.x ?? 0, s?.leftStick.y ?? 0, b?.leftStick, "Left stick (L3)")}
      {stick("rightStick", RS, s?.rightStick.x ?? 0, s?.rightStick.y ?? 0, b?.rightStick, "Right stick (R3)")}

      {/* Home and mute */}
      <g {...part("home", b?.home, "PS button")}>
        <circle cx={400} cy={255} r={13} className="key round home" fill={`url(#${uid}-key)`} />
        {badge("home", 411, 238)}
      </g>
      <g {...part("mute", b?.mute, "Mute")}>
        <rect x={384} y={292} width={32} height={9} rx={4.5} className="key mute" />
        {badge("mute", 420, 288)}
      </g>
    </svg>
  );
}

/**
 * Front view of a DualShock 4 in the same size, style and viewBox as the
 * DualSense drawing above. Outlines are traced from the DualShock 4 3D model
 * and every control sits where the model has it (lib/dualshock4Art.ts).
 * Same behaviour: gold while pressed, teal when selected, mark dots,
 * clickable parts with `data-button` for the Mapping screen's leader lines.
 * No Mute button.
 */
function DrawnDualShock4({ state, live, selected = null, onSelect, marks }: VisualProps) {
  const uid = useId().replace(/:/g, "");
  const s = live ? state : null;
  const b = s?.buttons;
  const d = dpadLit(s?.dpad);
  const ctx = { selected, onSelect, marks };
  const part = (id: MacroButton, pressed: boolean | undefined) => partProps(id, pressed, DS4_LABELS[id], ctx);
  const badge = (id: MacroButton, x: number, y: number) => markDots(marks?.[id], x, y, 4);

  const DP = { x: (artPosition("dpadLeft").x + artPosition("dpadRight").x) / 2, y: (artPosition("dpadUp").y + artPosition("dpadDown").y) / 2 };
  const FC = { x: (artPosition("west").x + artPosition("east").x) / 2, y: (artPosition("north").y + artPosition("south").y) / 2 };
  const TRAVEL = 20, REACH = 58;

  const stick = (id: "leftStick" | "rightStick", x: number, y: number) => {
    const c = artPosition(id);
    const [dx, dy] = stickOffset(x, y, TRAVEL);
    const [vx, vy] = stickOffset(x, y, REACH);
    const moved = Math.hypot(dx, dy) > 1.5;
    return (
      <g {...part(id, b?.[id])}>
        <circle cx={c.x} cy={c.y} r={46} className="stick-well" />
        <circle cx={c.x} cy={c.y} r={TRAVEL} className="stick-range" />
        {moved && <line x1={c.x} y1={c.y} x2={c.x + vx} y2={c.y + vy} className="stick-vector" />}
        <circle cx={c.x + dx} cy={c.y + dy + 2} r={41} className="stick-shadow" />
        <circle cx={c.x + dx} cy={c.y + dy} r={41} className="stick-cap" fill={`url(#${uid}-cap)`} />
        <circle cx={c.x + dx} cy={c.y + dy} r={29} className="stick-top" fill={`url(#${uid}-dish)`} />
        <circle cx={c.x + dx} cy={c.y + dy} r={41} className="stick-ring" />
        {moved && <line x1={c.x + dx} y1={c.y + dy} x2={c.x + vx} y2={c.y + vy} className="stick-vector front" />}
        {moved && <circle cx={c.x + vx} cy={c.y + vy} r={7} className="stick-dot" />}
        {badge(id, c.x + 36, c.y - 42)}
      </g>
    );
  };

  const trigger = (id: "leftTrigger" | "rightTrigger", value: number, digital: boolean | undefined, label: string) => {
    const t = DS4_TRIGGERS[id];
    const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    return (
      <g {...partProps(id, digital, `${label}, ${Math.round(v * 100)}%`, ctx)}>
        <TriggerTab id={`${uid}-${id}`} shape={t} value={v} label={label} fontSize={15} />
        {v > 0.005 && <text x={(t.outer + t.inner) / 2} y={t.top - 8} className="trigger-readout" textAnchor="middle">{Math.round(v * 100)}%</text>}
        {badge(id, t.inner - (t.inner > t.outer ? 8 : -8), t.top - 2)}
      </g>
    );
  };

  /** A D-pad arm pointing up from the D-pad centre (rotated for the others), sized and placed as in the model. */
  const hw = DS4_ART.armWidth / 2;
  const outer = DP.y - artPosition("dpadUp").y + DS4_ART.armLength / 2;
  const inner = outer - DS4_ART.armLength;
  const arm = (id: MacroButton, on: boolean, angle: number) => (
    <g {...part(id, on)} transform={`rotate(${angle} ${DP.x} ${DP.y})`}>
      <path className="key" fill="#1f2024"
        d={`M${DP.x - hw} ${DP.y - outer + 7}Q${DP.x - hw} ${DP.y - outer} ${DP.x - hw + 7} ${DP.y - outer}H${DP.x + hw - 7}Q${DP.x + hw} ${DP.y - outer} ${DP.x + hw} ${DP.y - outer + 7}V${DP.y - inner - hw * 0.9}L${DP.x} ${DP.y - inner}L${DP.x - hw} ${DP.y - inner - hw * 0.9}Z`} />
      <path d={`M${DP.x} ${DP.y - outer + 9}l-4.5 6h9z`} className="arrow" />
      {badge(id, DP.x + hw - 6, DP.y - outer - 1)}
    </g>
  );

  const fr = DS4_ART.faceRadius;
  const face = (id: MacroButton, on: boolean | undefined, symbol: (x: number, y: number) => ReactNode) => {
    const { x, y } = artPosition(id);
    return (
      <g {...part(id, on)}>
        <circle cx={x} cy={y + 2} r={fr} className="key-shadow" />
        <circle cx={x} cy={y} r={fr} className="key round" fill={`url(#${uid}-key)`} />
        {symbol(x, y)}
        {badge(id, x + 14, y - 20)}
      </g>
    );
  };
  const small = (id: "select" | "start") => {
    const { x, y } = artPosition(id);
    const w = 12, h = 24;
    return (
      <g {...part(id, b?.[id])}>
        <title>{DS4_LABELS[id]}</title>
        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} className="key small" fill={`url(#${uid}-key)`} />
        {badge(id, x + 12, y - 16)}
      </g>
    );
  };
  const touch = s?.touchpad;
  const ps = artPosition("home");

  return (
    <svg className={`controller dualshock4${live ? " live" : " idle"}${onSelect ? " interactive" : ""}`}
      viewBox="0 -38 800 558" role="group"
      aria-label={live ? `Live controller input. ${describeState(s)}` : "Controller (no live input)"}>
      <defs>
        <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e2f33" />
          <stop offset="0.45" stopColor="#25262a" />
          <stop offset="1" stopColor="#131418" />
        </linearGradient>
        <linearGradient id={`${uid}-pad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2b30" />
          <stop offset="1" stopColor="#232429" />
        </linearGradient>
        <linearGradient id={`${uid}-key`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24262b" />
          <stop offset="1" stopColor="#101114" />
        </linearGradient>
        <radialGradient id={`${uid}-cap`} cx="0.42" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#363a45" />
          <stop offset="1" stopColor="#22252d" />
        </radialGradient>
        <radialGradient id={`${uid}-dish`} cx="0.5" cy="0.62" r="0.65">
          <stop offset="0" stopColor="#2c2f39" />
          <stop offset="1" stopColor="#1f2128" />
        </radialGradient>
        <filter id={`${uid}-shadow`} x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity="0.7" />
        </filter>
      </defs>

      {/* Triggers (behind) and bumpers */}
      {trigger("leftTrigger", s?.leftTrigger.value ?? 0, s?.leftTrigger.digital, "L2")}
      {trigger("rightTrigger", s?.rightTrigger.value ?? 0, s?.rightTrigger.digital, "R2")}
      <g {...part("leftShoulder", b?.leftShoulder)}>
        <path d={DS4_OUTLINES.leftShoulder} className="key shoulder" />
        {badge("leftShoulder", DS4_TRIGGERS.leftTrigger.inner, 18)}
      </g>
      <g {...part("rightShoulder", b?.rightShoulder)}>
        <path d={DS4_OUTLINES.rightShoulder} className="key shoulder" />
        {badge("rightShoulder", DS4_TRIGGERS.rightTrigger.outer - 4, 18)}
      </g>

      {/* Body, traced from the model */}
      <path d={DS4_OUTLINES.body} filter={`url(#${uid}-shadow)`} fill={`url(#${uid}-shell)`} className="shell" />
      <circle cx={DP.x} cy={DP.y} r={DS4_ART.wellRadius} className="ds4-well" pointerEvents="none" />
      <circle cx={FC.x} cy={FC.y} r={DS4_ART.wellRadius} className="ds4-well" pointerEvents="none" />

      {/* Touchpad, traced from the model */}
      <g {...part("touchpad", b?.touchpad)}>
        <path className="key touchpad" d={DS4_OUTLINES.touchpad} fill={`url(#${uid}-pad)`} />
        {touch?.points.filter((p) => p.active).map((p) => {
          const [x, y] = touchPosition(p, touch, DS4_TOUCH_BOX);
          return <circle key={p.id} cx={x} cy={y} r={8} className="touch-point" />;
        })}
        {badge("touchpad", DS4_TOUCH_BOX.x + DS4_TOUCH_BOX.w - 18, DS4_TOUCH_BOX.y + 14)}
      </g>

      {small("select")}
      {small("start")}

      {arm("dpadUp", d.up, 0)}
      {arm("dpadRight", d.right, 90)}
      {arm("dpadDown", d.down, 180)}
      {arm("dpadLeft", d.left, 270)}

      {/* Face buttons, with the DualShock 4's coloured symbols */}
      {face("north", b?.north, (x, y) => <path d={`M${x} ${y - 10}l10 16.5h-20z`} className="symbol ds4-triangle" />)}
      {face("east", b?.east, (x, y) => <circle cx={x} cy={y} r={9.5} className="symbol ds4-circle" />)}
      {face("south", b?.south, (x, y) => <path d={`M${x - 8.5} ${y - 8.5}l17 17M${x + 8.5} ${y - 8.5}l-17 17`} className="symbol ds4-cross" />)}
      {face("west", b?.west, (x, y) => <rect x={x - 8.5} y={y - 8.5} width={17} height={17} rx={1} className="symbol ds4-square" />)}

      {/* Speaker grille */}
      <g className="speaker" pointerEvents="none">
        {[-3, -2, -1, 0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => (
          <rect key={`${c}${r}`} x={400 + c * 7 - 2} y={204 + r * 7} width={4} height={4} rx={1} />
        )))}
      </g>

      {stick("leftStick", s?.leftStick.x ?? 0, s?.leftStick.y ?? 0)}
      {stick("rightStick", s?.rightStick.x ?? 0, s?.rightStick.y ?? 0)}

      <g {...part("home", b?.home)}>
        <circle cx={ps.x} cy={ps.y} r={DS4_ART.homeRadius} className="key round home" fill={`url(#${uid}-key)`} />
        {badge("home", ps.x + 11, ps.y - 17)}
      </g>
    </svg>
  );
}

/** Accessible names on the DualShock 4 drawing (Share instead of Create; no Mute). */
const DS4_LABELS: Record<MacroButton, string> = { ...LABELS, select: "Share" };

/** Drawn controller: L2/R2 behind the bumpers (L1 spans x 134–230, top y 20). */
const DRAWN_TRIGGERS: Record<"leftTrigger" | "rightTrigger", TriggerShape> = {
  leftTrigger: { outer: 138, inner: 226, top: -20, visibleBottom: 24, bottom: 44, dip: 6 },
  rightTrigger: { outer: 662, inner: 574, top: -20, visibleBottom: 24, bottom: 44, dip: 6 },
};

/**
 * One trigger: its body in the controller's colour, the pressure fill rising
 * from the bumper, and the label. The whole tab dips a little as it is pressed.
 * The body comes first so the Mapping screen anchors its line to the trigger at rest.
 */
function TriggerTab({ id, shape, value, label, fontSize }: { id: string; shape: TriggerShape; value: number; label: string; fontSize: number }) {
  const d = triggerPath(shape);
  const { fillTop, dip } = triggerLevel(value, shape);
  const x0 = Math.min(shape.outer, shape.inner);
  const w = Math.abs(shape.inner - shape.outer);
  const mid = (shape.top + shape.visibleBottom) / 2;
  return (
    <>
      <path d={d} className="trigger-hit" />
      <g transform={dip ? `translate(0 ${dip})` : undefined}>
        <defs>
          <clipPath id={`${id}-clip`}><path d={d} /></clipPath>
          <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#34363c" />
            <stop offset="0.35" stopColor="#24262b" />
            <stop offset="1" stopColor="#141519" />
          </linearGradient>
        </defs>
        <path d={d} className="trigger-body" fill={`url(#${id}-body)`} />
        <rect x={x0} y={fillTop} width={w} height={Math.max(0, shape.bottom - fillTop)} clipPath={`url(#${id}-clip)`} className="trigger-fill" />
        <path d={d} className="trigger-edge" />
        {/* The label is light on the body and dark where the fill has reached it. */}
        <clipPath id={`${id}-filled`}><rect x={x0} y={fillTop} width={w} height={Math.max(0, shape.bottom - fillTop)} /></clipPath>
        <text x={x0 + w / 2} y={mid + fontSize * 0.36} className="trigger-label" textAnchor="middle" style={{ fontSize }}>{label}</text>
        <text x={x0 + w / 2} y={mid + fontSize * 0.36} className="trigger-label filled" textAnchor="middle" style={{ fontSize }}
          clipPath={`url(#${id}-filled)`} aria-hidden="true">{label}</text>
      </g>
    </>
  );
}
