import { useId, type KeyboardEvent, type ReactNode } from "react";
import type { ButtonMark } from "../lib/buttonMapping";
import { describeState, dpadLit, stickOffset, touchPosition, triggerFill } from "../lib/controllerView";
import type { ControllerState, MacroButton } from "../types/engine";

/**
 * Front view of a DualSense-style controller, drawn from scratch as SVG
 * (no logos or trademarks), driven only by real, parsed input.
 *
 * - `state` null: drawn dimmed in a neutral pose and never animated, so it
 *   cannot be mistaken for live data.
 * - `onSelect`: buttons become clickable (and keyboard-focusable) to show
 *   their mapping; `selected` is outlined in teal.
 * - `marks`: small indicators for remapped, disabled and macro buttons.
 */
export function ControllerVisual({ state, live, selected = null, onSelect, marks }: {
  state: ControllerState | null;
  live: boolean;
  selected?: MacroButton | null;
  onSelect?: (b: MacroButton) => void;
  marks?: Partial<Record<MacroButton, ButtonMark>>;
}) {
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

  // ---- Geometry (viewBox 800 x 520) --------------------------------------
  const DPAD = { x: 194, y: 204 };
  const FACE = { x: 606, y: 204, gap: 42, r: 19 };
  const LS = { x: 318, y: 310 };
  const RS = { x: 482, y: 310 };
  const TRAVEL = 14;
  const TP = { x: 290, y: 128, w: 220, h: 102 };

  const stick = (id: MacroButton, c: { x: number; y: number }, x: number, y: number, pressed: boolean | undefined, label: string) => {
    const [dx, dy] = stickOffset(x, y, TRAVEL);
    const moved = Math.hypot(dx, dy) > 1.5;
    return (
      <g {...part(id, pressed, label)}>
        <circle cx={c.x} cy={c.y} r={40} className="stick-well" />
        <circle cx={c.x} cy={c.y} r={TRAVEL} className="stick-range" />
        {moved && <line x1={c.x} y1={c.y} x2={c.x + dx} y2={c.y + dy} className="stick-vector" />}
        <circle cx={c.x + dx} cy={c.y + dy} r={28} className="stick-cap" />
        <circle cx={c.x + dx} cy={c.y + dy} r={20} className="stick-top" />
        <circle cx={c.x + dx} cy={c.y + dy} r={28} className="stick-ring" />
        {badge(id, c.x + 30, c.y - 34)}
      </g>
    );
  };

  /** L2/R2: a rounded tab above the shoulder, filled from the bottom by real pressure. */
  const trigger = (id: MacroButton, x: number, value: number, digital: boolean | undefined, label: string) => {
    const h = 48;
    const top = 36;
    const fill = triggerFill(value, h);
    const clip = `${uid}-${id}`;
    const shape = `M${x + 14} ${top + h}V${top + 14}Q${x + 14} ${top} ${x + 30} ${top}H${x + 110}Q${x + 126} ${top} ${x + 126} ${top + 14}V${top + h}Z`;
    return (
      <g {...part(id, digital, `${label}, ${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`)}>
        <clipPath id={clip}><path d={shape} /></clipPath>
        <path d={shape} className="trigger-body" />
        <rect x={x} y={top + h - fill} width={140} height={fill} clipPath={`url(#${clip})`} className="trigger-fill" />
        <text x={x + 70} y={top + 21} className="part-label">{label}</text>
        {value > 0.005 && <text x={x + 70} y={top + 35} className="part-value">{Math.round(value * 100)}%</text>}
        {badge(id, x + 112, top + 6)}
      </g>
    );
  };

  /** D-pad arm pointing up from the centre, rotated for the other directions. */
  const arm = (id: MacroButton, on: boolean, angle: number, label: string) => (
    <g {...part(id, on, label)} transform={`rotate(${angle} ${DPAD.x} ${DPAD.y})`}>
      <path
        d={`M${DPAD.x - 15} ${DPAD.y - 50}Q${DPAD.x - 15} ${DPAD.y - 54} ${DPAD.x - 11} ${DPAD.y - 54}H${DPAD.x + 11}Q${DPAD.x + 15} ${DPAD.y - 54} ${DPAD.x + 15} ${DPAD.y - 50}V${DPAD.y - 22}L${DPAD.x} ${DPAD.y - 9}L${DPAD.x - 15} ${DPAD.y - 22}Z`}
        className="key"
      />
      <path d={`M${DPAD.x} ${DPAD.y - 44}l-6 8h12z`} className="arrow" />
      {badge(id, DPAD.x + 12, DPAD.y - 58)}
    </g>
  );

  const face = (id: MacroButton, cx: number, cy: number, on: boolean | undefined, label: string, symbol: ReactNode) => (
    <g {...part(id, on, label)}>
      <circle cx={cx} cy={cy} r={FACE.r} className="key round" />
      {symbol}
      {badge(id, cx + 14, cy - 20)}
    </g>
  );

  const fx = FACE.x, fy = FACE.y, g = FACE.gap;
  const touch = s?.touchpad;

  return (
    <svg className={`controller dualsense${live ? " live" : " idle"}${onSelect ? " interactive" : ""}`}
      viewBox="0 0 800 520" role="group"
      aria-label={live ? `Live controller input. ${describeState(s)}` : "Controller (no live input)"}>
      <defs>
        <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f8fa" />
          <stop offset="0.55" stopColor="#e7e9ee" />
          <stop offset="1" stopColor="#cfd3da" />
        </linearGradient>
        <linearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2d33" />
          <stop offset="1" stopColor="#15171b" />
        </linearGradient>
        <radialGradient id={`${uid}-cap`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3b3f47" />
          <stop offset="1" stopColor="#16181c" />
        </radialGradient>
        <filter id={`${uid}-shadow`} x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* Triggers (behind) and bumpers */}
      {trigger("leftTrigger", 152, s?.leftTrigger.value ?? 0, s?.leftTrigger.digital, "L2")}
      {trigger("rightTrigger", 508, s?.rightTrigger.value ?? 0, s?.rightTrigger.digital, "R2")}
      <g {...part("leftShoulder", b?.leftShoulder, "L1")}>
        <path d="M146 120Q150 90 186 88H272Q296 89 302 110L304 120Z" className="key shoulder" />
        <text x={226} y={108} className="part-label light">L1</text>
        {badge("leftShoulder", 290, 86)}
      </g>
      <g {...part("rightShoulder", b?.rightShoulder, "R1")}>
        <path d="M654 120Q650 90 614 88H528Q504 89 498 110L496 120Z" className="key shoulder" />
        <text x={574} y={108} className="part-label light">R1</text>
        {badge("rightShoulder", 636, 86)}
      </g>

      {/* Body: white shell with long grips, dark centre plate */}
      <path filter={`url(#${uid}-shadow)`} fill={`url(#${uid}-shell)`} className="shell"
        d="M400 116C480 116 560 110 620 114C672 118 706 142 722 186C742 240 762 330 770 396C778 456 756 496 714 498C682 500 662 478 644 444C624 406 602 384 564 380H236C198 384 176 406 156 444C138 478 118 500 86 498C44 496 22 456 30 396C38 330 58 240 78 186C94 142 128 118 180 114C240 110 320 116 400 116Z" />
      <path className="plate" fill={`url(#${uid}-plate)`}
        d="M262 244H538C562 244 576 262 586 288C598 318 602 352 590 370C584 378 576 380 564 380H236C224 380 216 378 210 370C198 352 202 318 214 288C224 262 238 244 262 244Z" />
      <path className="seam" d="M180 118C146 126 116 146 100 188M620 118C654 126 684 146 700 188" />

      {/* Touchpad with light strips */}
      <g {...part("touchpad", b?.touchpad, "Touchpad click")}>
        <path className="lightbar" d={`M${TP.x - 8} ${TP.y + 6}Q${TP.x - 12} ${TP.y + 70} ${TP.x + 8} ${TP.y + TP.h + 4}`} />
        <path className="lightbar" d={`M${TP.x + TP.w + 8} ${TP.y + 6}Q${TP.x + TP.w + 12} ${TP.y + 70} ${TP.x + TP.w - 8} ${TP.y + TP.h + 4}`} />
        <path className="key touchpad"
          d={`M${TP.x + 14} ${TP.y}H${TP.x + TP.w - 14}Q${TP.x + TP.w} ${TP.y} ${TP.x + TP.w - 1} ${TP.y + 14}L${TP.x + TP.w - 10} ${TP.y + TP.h - 12}Q${TP.x + TP.w - 12} ${TP.y + TP.h} ${TP.x + TP.w - 26} ${TP.y + TP.h}H${TP.x + 26}Q${TP.x + 12} ${TP.y + TP.h} ${TP.x + 10} ${TP.y + TP.h - 12}L${TP.x + 1} ${TP.y + 14}Q${TP.x} ${TP.y} ${TP.x + 14} ${TP.y}Z`} />
        {touch?.points.filter((p) => p.active).map((p) => {
          const [x, y] = touchPosition(p, touch, TP);
          return <circle key={p.id} cx={x} cy={y} r={8} className="touch-point" />;
        })}
        {badge("touchpad", TP.x + TP.w - 14, TP.y + 12)}
      </g>

      {/* Create and Options */}
      <g {...part("select", b?.select, "Create")}>
        <rect x={252} y={128} width={11} height={26} rx={5.5} transform="rotate(-18 257 141)" className="key small" />
        <text x={256} y={172} className="part-caption">Create</text>
        {badge("select", 266, 122)}
      </g>
      <g {...part("start", b?.start, "Options")}>
        <rect x={537} y={128} width={11} height={26} rx={5.5} transform="rotate(18 543 141)" className="key small" />
        <text x={544} y={172} className="part-caption">Options</text>
        {badge("start", 552, 122)}
      </g>

      {/* D-pad */}
      {arm("dpadUp", d.up, 0, "D-pad up")}
      {arm("dpadRight", d.right, 90, "D-pad right")}
      {arm("dpadDown", d.down, 180, "D-pad down")}
      {arm("dpadLeft", d.left, 270, "D-pad left")}

      {/* Face buttons */}
      {face("north", fx, fy - g, b?.north, "Triangle", <path d={`M${fx} ${fy - g - 9}l9 15h-18z`} className="symbol" />)}
      {face("east", fx + g, fy, b?.east, "Circle", <circle cx={fx + g} cy={fy} r={8.5} className="symbol" />)}
      {face("south", fx, fy + g, b?.south, "Cross", <path d={`M${fx - 7.5} ${fy + g - 7.5}l15 15M${fx + 7.5} ${fy + g - 7.5}l-15 15`} className="symbol" />)}
      {face("west", fx - g, fy, b?.west, "Square", <rect x={fx - g - 7.5} y={fy - 7.5} width={15} height={15} className="symbol" />)}

      {/* Sticks */}
      {stick("leftStick", LS, s?.leftStick.x ?? 0, s?.leftStick.y ?? 0, b?.leftStick, "Left stick (L3)")}
      {stick("rightStick", RS, s?.rightStick.x ?? 0, s?.rightStick.y ?? 0, b?.rightStick, "Right stick (R3)")}

      {/* Home and mute */}
      <g {...part("home", b?.home, "PS button")}>
        <circle cx={400} cy={290} r={15} className="key round home" />
        {badge("home", 412, 272)}
      </g>
      <g {...part("mute", b?.mute, "Mute")}>
        <rect x={386} y={320} width={28} height={9} rx={4.5} className="key mute" />
        {badge("mute", 416, 316)}
      </g>
      <g className="speaker" pointerEvents="none">
        {[-12, -4, 4, 12].map((x) => <circle key={x} cx={400 + x} cy={352} r={1.6} />)}
      </g>
    </svg>
  );
}
