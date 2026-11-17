import { useId, type KeyboardEvent, type ReactNode } from "react";
import type { ButtonMark } from "../lib/buttonMapping";
import { describeState, dpadLit, stickOffset, touchPosition, triggerFill } from "../lib/controllerView";
import type { ControllerState, MacroButton } from "../types/engine";

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

  // ---- Geometry (viewBox 800 x 520), proportions of the front view -------
  const DPAD = { x: 226, y: 222 };
  const FACE = { x: 574, y: 222, gap: 42, r: 19 };
  const LS = { x: 324, y: 318 };
  const RS = { x: 476, y: 318 };
  const TRAVEL = 13;
  const TP = { x: 284, y: 116, w: 232, h: 132 };
  const SHELL =
    "M400 112C470 112 545 108 600 110C640 112 668 118 690 130C722 148 742 190 752 240C762 290 770 350 768 410" +
    "C766 458 742 492 706 494C676 496 656 476 640 450C620 418 600 398 568 394C520 388 460 386 400 386" +
    "C340 386 280 388 232 394C200 398 180 418 160 450C144 476 124 496 94 494C58 492 34 458 32 410" +
    "C30 350 38 290 48 240C58 190 78 148 110 130C132 118 160 112 200 110C255 108 330 112 400 112Z";
  /** The lower deck around the sticks: same black, a slightly different finish. */
  const DECK =
    "M262 262C300 256 352 254 400 254C448 254 500 256 538 262C566 268 586 290 594 318C600 342 596 368 584 382" +
    "C548 387 480 388 400 388C320 388 252 387 216 382C204 368 200 342 206 318C214 290 234 268 262 262Z";
  /** Touchpad: wide at the top edge, slightly narrower and rounded at the bottom. */
  const TP_PATH =
    `M${TP.x + 4} ${TP.y}H${TP.x + TP.w - 4}Q${TP.x + TP.w + 2} ${TP.y} ${TP.x + TP.w} ${TP.y + 8}` +
    `L${TP.x + TP.w - 12} ${TP.y + TP.h - 18}Q${TP.x + TP.w - 16} ${TP.y + TP.h} ${TP.x + TP.w - 34} ${TP.y + TP.h}` +
    `H${TP.x + 34}Q${TP.x + 16} ${TP.y + TP.h} ${TP.x + 12} ${TP.y + TP.h - 18}L${TP.x} ${TP.y + 8}Q${TP.x - 2} ${TP.y} ${TP.x + 4} ${TP.y}Z`;

  const stick = (id: MacroButton, c: { x: number; y: number }, x: number, y: number, pressed: boolean | undefined, label: string) => {
    const [dx, dy] = stickOffset(x, y, TRAVEL);
    const moved = Math.hypot(dx, dy) > 1.5;
    return (
      <g {...part(id, pressed, label)}>
        <circle cx={c.x} cy={c.y} r={41} className="stick-well" />
        <circle cx={c.x} cy={c.y} r={TRAVEL} className="stick-range" />
        {moved && <line x1={c.x} y1={c.y} x2={c.x + dx} y2={c.y + dy} className="stick-vector" />}
        <circle cx={c.x + dx} cy={c.y + dy + 3} r={30} className="stick-shadow" />
        <circle cx={c.x + dx} cy={c.y + dy} r={30} className="stick-cap" fill={`url(#${uid}-cap)`} />
        <circle cx={c.x + dx} cy={c.y + dy} r={21} className="stick-top" fill={`url(#${uid}-dish)`} />
        <circle cx={c.x + dx} cy={c.y + dy} r={30} className="stick-ring" />
        {badge(id, c.x + 30, c.y - 36)}
      </g>
    );
  };

  /** L2/R2 peek out above the bumpers; real pressure fills them from the bottom. */
  const trigger = (id: MacroButton, x: number, value: number, digital: boolean | undefined, label: string) => {
    const h = 44;
    const top = 52;
    const fill = triggerFill(value, h);
    const clip = `${uid}-${id}`;
    const shape = `M${x + 8} ${top + h}V${top + 16}Q${x + 8} ${top} ${x + 26} ${top}H${x + 90}Q${x + 108} ${top} ${x + 108} ${top + 16}V${top + h}Z`;
    return (
      <g {...part(id, digital, `${label}, ${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`)}>
        <clipPath id={clip}><path d={shape} /></clipPath>
        <path d={shape} className="trigger-body" fill={`url(#${uid}-key)`} />
        <rect x={x} y={top + h - fill} width={116} height={fill} clipPath={`url(#${clip})`} className="trigger-fill" />
        <text x={x + 58} y={top + 21} className="part-label">{label}</text>
        {value > 0.005 && <text x={x + 58} y={top + 35} className="part-value">{Math.round(value * 100)}%</text>}
        {badge(id, x + 96, top + 6)}
      </g>
    );
  };

  /** D-pad arm pointing up from the centre, rotated for the other directions. */
  const arm = (id: MacroButton, on: boolean, angle: number, label: string) => (
    <g {...part(id, on, label)} transform={`rotate(${angle} ${DPAD.x} ${DPAD.y})`}>
      <path
        d={`M${DPAD.x - 14} ${DPAD.y - 46}Q${DPAD.x - 14} ${DPAD.y - 51} ${DPAD.x - 9} ${DPAD.y - 51}H${DPAD.x + 9}Q${DPAD.x + 14} ${DPAD.y - 51} ${DPAD.x + 14} ${DPAD.y - 46}V${DPAD.y - 21}L${DPAD.x} ${DPAD.y - 10}L${DPAD.x - 14} ${DPAD.y - 21}Z`}
        className="key" fill={`url(#${uid}-key)`}
      />
      <path d={`M${DPAD.x} ${DPAD.y - 42}l-5 7h10z`} className="arrow" />
      {badge(id, DPAD.x + 12, DPAD.y - 56)}
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
      viewBox="0 0 800 520" role="group"
      aria-label={live ? `Live controller input. ${describeState(s)}` : "Controller (no live input)"}>
      <defs>
        <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1d21" />
          <stop offset="1" stopColor="#141518" />
        </linearGradient>
        <linearGradient id={`${uid}-pad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1b1f" />
          <stop offset="1" stopColor="#111215" />
        </linearGradient>
        <linearGradient id={`${uid}-key`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24262b" />
          <stop offset="1" stopColor="#101114" />
        </linearGradient>
        <radialGradient id={`${uid}-cap`} cx="0.42" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#34373e" />
          <stop offset="1" stopColor="#141518" />
        </radialGradient>
        <radialGradient id={`${uid}-dish`} cx="0.5" cy="0.62" r="0.65">
          <stop offset="0" stopColor="#202227" />
          <stop offset="1" stopColor="#0e0f11" />
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
      {trigger("leftTrigger", 142, s?.leftTrigger.value ?? 0, s?.leftTrigger.digital, "L2")}
      {trigger("rightTrigger", 542, s?.rightTrigger.value ?? 0, s?.rightTrigger.digital, "R2")}
      <g {...part("leftShoulder", b?.leftShoulder, "L1")}>
        <path d="M118 128Q124 94 168 92H222Q244 93 250 112L254 124Z" className="key shoulder" fill={`url(#${uid}-key)`} />
        <text x={186} y={106} className="part-label">L1</text>
        {badge("leftShoulder", 240, 90)}
      </g>
      <g {...part("rightShoulder", b?.rightShoulder, "R1")}>
        <path d="M682 128Q676 94 632 92H578Q556 93 550 112L546 124Z" className="key shoulder" fill={`url(#${uid}-key)`} />
        <text x={614} y={106} className="part-label">R1</text>
        {badge("rightShoulder", 650, 90)}
      </g>

      {/* Body: one matte-black shell, lower deck around the sticks */}
      <path d={SHELL} filter={`url(#${uid}-shadow)`} fill={`url(#${uid}-shell)`} className="shell" />
      <path className="rim" d="M120 128C150 116 180 112 200 110C255 108 330 112 400 112C470 112 545 108 600 110C620 112 650 116 680 128" />
      <path d={DECK} fill="none" className="deck" />
      <path className="seam" d="M110 136C86 152 66 186 56 230M690 136C714 152 734 186 744 230" />

      {/* Touchpad with the blue light strips along both sides */}
      <g {...part("touchpad", b?.touchpad, "Touchpad click")}>
        <path className="key touchpad" d={TP_PATH} fill={`url(#${uid}-pad)`} />
        <path className="touchpad-edge" d={`M${TP.x + 10} ${TP.y + 3}H${TP.x + TP.w - 10}`} />
        {touch?.points.filter((p) => p.active).map((p) => {
          const [x, y] = touchPosition(p, touch, TP);
          return <circle key={p.id} cx={x} cy={y} r={8} className="touch-point" />;
        })}
        {badge("touchpad", TP.x + TP.w - 18, TP.y + 14)}
      </g>
      <g className="lightbar" filter={`url(#${uid}-glow)`} pointerEvents="none">
        <path d={`M${TP.x - 3} ${TP.y + 4}L${TP.x + 9} ${TP.y + TP.h - 24}`} />
        <path d={`M${TP.x + TP.w + 3} ${TP.y + 4}L${TP.x + TP.w - 9} ${TP.y + TP.h - 24}`} />
      </g>

      {/* Create and Options */}
      <g {...part("select", b?.select, "Create")}>
        <title>Create</title>
        <rect x={256} y={126} width={10} height={24} rx={5} transform="rotate(-20 261 138)" className="key small" fill={`url(#${uid}-key)`} />
        {badge("select", 270, 120)}
      </g>
      <g {...part("start", b?.start, "Options")}>
        <title>Options</title>
        <rect x={534} y={126} width={10} height={24} rx={5} transform="rotate(20 539 138)" className="key small" fill={`url(#${uid}-key)`} />
        {badge("start", 548, 120)}
      </g>

      {/* D-pad */}
      {arm("dpadUp", d.up, 0, "D-pad up")}
      {arm("dpadRight", d.right, 90, "D-pad right")}
      {arm("dpadDown", d.down, 180, "D-pad down")}
      {arm("dpadLeft", d.left, 270, "D-pad left")}

      {/* Face buttons */}
      {face("north", fx, fy - g, b?.north, "Triangle", <path d={`M${fx} ${fy - g - 8.5}l8.5 14h-17z`} className="symbol" />)}
      {face("east", fx + g, fy, b?.east, "Circle", <circle cx={fx + g} cy={fy} r={8} className="symbol" />)}
      {face("south", fx, fy + g, b?.south, "Cross", <path d={`M${fx - 7} ${fy + g - 7}l14 14M${fx + 7} ${fy + g - 7}l-14 14`} className="symbol" />)}
      {face("west", fx - g, fy, b?.west, "Square", <rect x={fx - g - 7} y={fy - 7} width={14} height={14} rx={1} className="symbol" />)}

      {/* Speaker grille */}
      <g className="speaker" pointerEvents="none">
        {[0, 1, 2].flatMap((row) => [-3, -2, -1, 0, 1, 2, 3].slice(row === 1 ? 0 : 1, row === 1 ? 7 : 6).map((col) => (
          <circle key={`${row}${col}`} cx={400 + col * 7 + (row === 1 ? 0 : 0)} cy={262 + row * 6} r={1.5} />
        )))}
      </g>

      {/* Sticks */}
      {stick("leftStick", LS, s?.leftStick.x ?? 0, s?.leftStick.y ?? 0, b?.leftStick, "Left stick (L3)")}
      {stick("rightStick", RS, s?.rightStick.x ?? 0, s?.rightStick.y ?? 0, b?.rightStick, "Right stick (R3)")}

      {/* Home and mute */}
      <g {...part("home", b?.home, "PS button")}>
        <circle cx={400} cy={306} r={14} className="key round home" fill={`url(#${uid}-key)`} />
        {badge("home", 411, 289)}
      </g>
      <g {...part("mute", b?.mute, "Mute")}>
        <rect x={389} y={334} width={22} height={7} rx={3.5} className="key mute" />
        {badge("mute", 414, 330)}
      </g>
    </svg>
  );
}
