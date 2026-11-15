import type { ControllerState } from "../types/engine";

/**
 * Stylised controller diagram driven only by real, parsed input.
 * When `state` is null it renders in a neutral, dimmed pose and never
 * animates, so it cannot be mistaken for live data.
 */
export function ControllerVisual({ state, live }: { state: ControllerState | null; live: boolean }) {
  const s = state;
  const b = s?.buttons;
  const on = (v: boolean | undefined) => (live && v ? " on" : "");
  const STICK_TRAVEL = 17;

  const stick = (cx: number, cy: number, x: number, y: number, pressed: boolean | undefined, label: string) => (
    <g className={`stick${on(pressed)}`} aria-label={label}>
      <circle cx={cx} cy={cy} r={36} className="stick-well" />
      <circle cx={cx} cy={cy} r={STICK_TRAVEL + 1} className="stick-range" />
      <circle
        cx={cx + (live ? x : 0) * STICK_TRAVEL}
        cy={cy - (live ? y : 0) * STICK_TRAVEL}
        r={19}
        className="stick-cap"
      />
    </g>
  );

  const trigger = (x: number, value: number, digital: boolean | undefined, label: string) => {
    const h = 30;
    const fill = live ? value * h : 0;
    return (
      <g className={`trigger${on(digital)}`} aria-label={label}>
        <rect x={x} y={14} width={86} height={h} rx={9} className="trigger-bg" />
        <rect x={x} y={14 + h - fill} width={86} height={fill} rx={9} className="trigger-fill" />
        <text x={x + 43} y={34} className="glyph-label">{label}</text>
      </g>
    );
  };

  const dir = s?.dpad ?? "neutral";
  const dUp = ["up", "upLeft", "upRight"].includes(dir);
  const dDown = ["down", "downLeft", "downRight"].includes(dir);
  const dLeft = ["left", "upLeft", "downLeft"].includes(dir);
  const dRight = ["right", "upRight", "downRight"].includes(dir);

  const touchpad = s?.touchpad;
  const TP = { x: 236, y: 92, w: 168, h: 92 };

  return (
    <svg className={`controller${live ? " live" : " idle"}`} viewBox="0 0 640 400" role="img"
      aria-label={live ? "Live controller input" : "Controller (no live input)"}>
      <defs>
        <linearGradient id="body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2e34" />
          <stop offset="1" stopColor="#1a1c20" />
        </linearGradient>
      </defs>

      {trigger(132, s?.leftTrigger.value ?? 0, s?.leftTrigger.digital, "L2")}
      {trigger(422, s?.rightTrigger.value ?? 0, s?.rightTrigger.digital, "R2")}

      <rect x={122} y={54} width={106} height={20} rx={10} className={`btn shoulder${on(b?.leftShoulder)}`} />
      <rect x={412} y={54} width={106} height={20} rx={10} className={`btn shoulder${on(b?.rightShoulder)}`} />
      <text x={175} y={68} className="glyph-label small">L1</text>
      <text x={465} y={68} className="glyph-label small">R1</text>

      <path
        className="body"
        d="M200 80H440C500 80 540 95 562 140C592 202 616 292 602 336C592 366 556 372 535 346C510 312 490 282 450 278H190C150 282 130 312 105 346C84 372 48 366 38 336C24 292 48 202 78 140C100 95 140 80 200 80Z"
      />

      <rect x={TP.x} y={TP.y} width={TP.w} height={TP.h} rx={14} className={`touchpad${on(b?.touchpad)}`} />
      {live && touchpad?.points.filter((p) => p.active).map((p) => (
        <circle key={p.id}
          cx={TP.x + (p.x / touchpad.width) * TP.w}
          cy={TP.y + (p.y / touchpad.height) * TP.h}
          r={7} className="touch-point" />
      ))}

      <rect x={204} y={104} width={14} height={26} rx={7} className={`btn small${on(b?.select)}`} />
      <rect x={422} y={104} width={14} height={26} rx={7} className={`btn small${on(b?.start)}`} />

      <g className="dpad">
        <rect x={136} y={124} width={28} height={30} rx={6} className={`btn${on(dUp)}`} />
        <rect x={136} y={170} width={28} height={30} rx={6} className={`btn${on(dDown)}`} />
        <rect x={104} y={148} width={30} height={28} rx={6} className={`btn${on(dLeft)}`} />
        <rect x={166} y={148} width={30} height={28} rx={6} className={`btn${on(dRight)}`} />
      </g>

      <g className="face">
        <circle cx={490} cy={126} r={16} className={`btn${on(b?.north)}`} />
        <path d="M490 118l7.5 13h-15Z" className="glyph" />
        <circle cx={524} cy={160} r={16} className={`btn${on(b?.east)}`} />
        <circle cx={524} cy={160} r={7} className="glyph" />
        <circle cx={490} cy={194} r={16} className={`btn${on(b?.south)}`} />
        <path d="M484 188l12 12M496 188l-12 12" className="glyph" />
        <circle cx={456} cy={160} r={16} className={`btn${on(b?.west)}`} />
        <rect x={449} y={153} width={14} height={14} className="glyph" />
      </g>

      {stick(252, 230, s?.leftStick.x ?? 0, s?.leftStick.y ?? 0, b?.leftStick, "Left stick")}
      {stick(388, 230, s?.rightStick.x ?? 0, s?.rightStick.y ?? 0, b?.rightStick, "Right stick")}

      <circle cx={320} cy={234} r={12} className={`btn home${on(b?.home)}`} />
      <rect x={308} y={256} width={24} height={9} rx={4.5} className={`btn small${on(b?.mute)}`} />
    </svg>
  );
}
