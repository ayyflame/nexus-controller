import { memo, useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  DPAD, FACE, HOME, LIGHT_BARS, MUTE, SMALL_BUTTONS, STICKS, TRIGGER_SWING, TRIGGER_X, UNIT,
  anchorOf, toWorld, touchPoint, type StickPose, type Visual3D,
} from "../../lib/controller3d";
import type { ButtonMark } from "../../lib/buttonMapping";
import type { MacroButton } from "../../types/engine";
import * as G from "./geometry";

/** NEXUS colours (styles/global.css): gold = pressed, teal = selected. */
const GOLD = "#d6a54b";
const TEAL = "#4fa8b8";
const MARK_COLOURS = { disabled: "#e26a6a", remapped: "#4fa8b8", macro: "#d6a54b", special: "#9b9ea6" } as const;

export interface ModelProps {
  vis: Visual3D;
  /** visualKey(vis): the model re-renders only when this changes. */
  visKey: string;
  selected: MacroButton | null;
  hovered: MacroButton | null;
  marks?: Partial<Record<MacroButton, ButtonMark>>;
  /** Present when parts can be picked. */
  pick?: {
    over: (b: MacroButton) => void;
    out: (b: MacroButton) => void;
    click: (b: MacroButton) => void;
  };
}

/** Geometries are built once per model and disposed with it. */
function useGeometries() {
  const geo = useMemo(() => ({
    body: G.bodyGeometry(),
    touchpad: G.touchpadGeometry(),
    touchpadFrame: G.touchpadFrameGeometry(),
    l1: G.bumperGeometry("leftShoulder"),
    r1: G.bumperGeometry("rightShoulder"),
    trigger: G.triggerGeometry((TRIGGER_X.leftTrigger[1] - TRIGGER_X.leftTrigger[0]) * UNIT),
    dpadArm: G.dpadArmGeometry(),
    dpadArrow: G.dpadArrowGeometry(),
    dpadWell: G.wellGeometry(0, 0.66),
    face: G.faceButtonGeometry(FACE.r * UNIT),
    faceWell: G.wellGeometry(FACE.r * UNIT, FACE.r * UNIT + 0.035),
    symbols: {
      north: G.symbolGeometry("triangle"), east: G.symbolGeometry("circle"),
      south: G.symbolGeometry("cross"), west: G.symbolGeometry("square"),
    },
    stem: G.stickStemGeometry(),
    cap: G.stickCapGeometry(),
    rim: G.stickRimGeometry(),
    stickWell: G.stickWellGeometry(),
    home: G.homeGeometry(HOME.r * UNIT),
    homeWell: G.wellGeometry(HOME.r * UNIT, HOME.r * UNIT + 0.03),
    mute: G.muteGeometry(),
    small: G.pillGeometry(0.11, 0.28, 0.035),
    lightBars: LIGHT_BARS.map(G.lightBarGeometry),
    speaker: G.speakerGeometry(),
    usb: G.usbPortGeometry(),
    touch: new THREE.CircleGeometry(0.075, 24),
    mark: new THREE.SphereGeometry(0.055, 16, 12),
  }), []);
  useEffect(() => () => {
    const all: THREE.BufferGeometry[] = [];
    for (const v of Object.values(geo)) {
      if (v instanceof THREE.BufferGeometry) all.push(v);
      else if (Array.isArray(v)) all.push(...v);
      else all.push(...Object.values(v));
    }
    for (const g of all) g.dispose();
  }, [geo]);
  return geo;
}

/** How a control glows: gold when pressed, teal when selected, a hint of teal on hover. */
function glow(lit: boolean, selected: boolean, hovered: boolean, strength = 1): { emissive: string; emissiveIntensity: number } {
  if (lit) return { emissive: GOLD, emissiveIntensity: 0.55 * strength };
  if (selected) return { emissive: TEAL, emissiveIntensity: 0.38 };
  if (hovered) return { emissive: TEAL, emissiveIntensity: 0.18 };
  return { emissive: "#000000", emissiveIntensity: 0 };
}

const KEY = { color: "#141519", roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32 } as const;
const BODY_MAT = { color: "#1a1b20", roughness: 0.58, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.6, sheen: 0.25, sheenColor: "#3a3d46", sheenRoughness: 0.8 } as const;

function DualSenseModelImpl({ vis, selected, hovered, marks, pick }: ModelProps) {
  const geo = useGeometries();
  const lit = vis.lit;
  const state = (b: MacroButton) => ({ lit: lit[b], sel: selected === b, hov: hovered === b });
  /** Pointer handlers for one part (only when the view can pick). */
  const handlers = (b: MacroButton) => pick ? {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); pick.over(b); },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); pick.out(b); },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta <= 4) pick.click(b); // a drag that rotated the view is not a click
    },
  } : {};
  const w = (x: number, y: number, z = 0): [number, number, number] => [...toWorld(x, y), z];

  const faceButton = (b: "north" | "east" | "south" | "west", x: number, y: number) => {
    const st = state(b);
    const press = st.lit ? -0.03 : 0;
    return (
      <group key={b} position={w(x, y)} {...handlers(b)}>
        <mesh geometry={geo.faceWell} position={[0, 0, 0.004]} receiveShadow>
          <meshStandardMaterial color="#08090b" roughness={0.9} />
        </mesh>
        <group position={[0, 0, press]}>
          <mesh geometry={geo.face} castShadow receiveShadow>
            <meshPhysicalMaterial {...KEY} {...glow(st.lit, st.sel, st.hov, 0.55)} />
          </mesh>
          <mesh geometry={geo.symbols[b]} position={[0, 0, 0.127]}>
            <meshStandardMaterial color="#9a9ea6" roughness={0.45} {...(st.lit ? { emissive: GOLD, emissiveIntensity: 2.2 } : st.sel ? { emissive: TEAL, emissiveIntensity: 0.9 } : {})} />
          </mesh>
        </group>
      </group>
    );
  };

  const dpadArm = (b: "dpadUp" | "dpadRight" | "dpadDown" | "dpadLeft", angle: number) => {
    const st = state(b);
    return (
      <group key={b} rotation={[0, 0, angle]} position={[0, 0, st.lit ? -0.025 : 0]} {...handlers(b)}>
        <mesh geometry={geo.dpadArm} position={[0, 0, 0.012]} castShadow receiveShadow>
          <meshPhysicalMaterial {...KEY} {...glow(st.lit, st.sel, st.hov, 0.8)} />
        </mesh>
        <mesh geometry={geo.dpadArrow} position={[0, 0, 0.083]}>
          <meshStandardMaterial color="#6f737b" roughness={0.5} {...(st.lit ? { emissive: GOLD, emissiveIntensity: 2 } : {})} />
        </mesh>
      </group>
    );
  };

  const stick = (b: "leftStick" | "rightStick", pose: StickPose) => {
    const c = STICKS[b];
    const st = state(b);
    return (
      <group key={b} position={w(c.x, c.y)}>
        <mesh geometry={geo.stickWell} receiveShadow>
          <meshStandardMaterial color="#0c0d10" roughness={0.75} />
        </mesh>
        <group position={[0, 0, G.STICK_PIVOT_Z]} rotation={[pose.rotX, pose.rotY, 0]} {...handlers(b)}>
          <group position={[0, 0, pose.pressed ? -0.06 : 0]}>
            <mesh geometry={geo.stem}>
              <meshStandardMaterial color="#111216" roughness={0.6} />
            </mesh>
            <mesh geometry={geo.cap} castShadow receiveShadow>
              <meshPhysicalMaterial color="#1e2026" roughness={0.88} sheen={0.4} sheenColor="#454956" sheenRoughness={0.9}
                {...glow(st.lit, st.sel, st.hov, 0.45)} />
            </mesh>
            <mesh geometry={geo.rim} castShadow>
              <meshStandardMaterial color="#26282f" roughness={0.95} {...(st.lit ? { emissive: GOLD, emissiveIntensity: 1.1 } : st.sel ? { emissive: TEAL, emissiveIntensity: 0.6 } : {})} />
            </mesh>
          </group>
        </group>
      </group>
    );
  };

  const bumper = (b: "leftShoulder" | "rightShoulder") => {
    const st = state(b);
    return (
      <group key={b} position={[0, st.lit ? -0.03 : 0, 0]} {...handlers(b)}>
        <mesh geometry={b === "leftShoulder" ? geo.l1 : geo.r1} castShadow receiveShadow>
          <meshPhysicalMaterial {...KEY} color="#1d1e23" {...glow(st.lit, st.sel, st.hov, 0.9)} />
        </mesh>
      </group>
    );
  };

  /** L2/R2 swing in with their analog value; the glow follows the pressure. */
  const trigger = (b: "leftTrigger" | "rightTrigger", value: number) => {
    const [x0, x1] = TRIGGER_X[b];
    const st = state(b);
    const g = value > 0.004
      ? { emissive: GOLD, emissiveIntensity: 0.12 + value * 0.6 }
      : glow(false, st.sel, st.hov);
    return (
      <group key={b} position={[...toWorld((x0 + x1) / 2, 30), -0.66] as [number, number, number]}
        rotation={[-value * TRIGGER_SWING, 0, 0]} {...handlers(b)}>
        <mesh geometry={geo.trigger} castShadow receiveShadow>
          <meshPhysicalMaterial {...KEY} color="#1b1c21" {...g} />
        </mesh>
      </group>
    );
  };

  const small = (b: "select" | "start") => {
    const p = SMALL_BUTTONS[b];
    const st = state(b);
    return (
      <group key={b} position={w(p.x, p.y, st.lit ? -0.015 : 0)} rotation={[0, 0, (-p.angle * Math.PI) / 180]} {...handlers(b)}>
        <mesh geometry={geo.small} castShadow>
          <meshPhysicalMaterial {...KEY} {...glow(st.lit, st.sel, st.hov, 1.2)} />
        </mesh>
      </group>
    );
  };

  const homeSt = state("home");
  const muteSt = state("mute");
  const padSt = state("touchpad");
  const fx = FACE.x, fy = FACE.y, gp = FACE.gap;

  return (
    <group>
      {/* Body */}
      <mesh geometry={geo.body} castShadow receiveShadow>
        <meshPhysicalMaterial {...BODY_MAT} />
      </mesh>

      {/* Touchpad, its frame, and the light strips */}
      <mesh geometry={geo.touchpadFrame} receiveShadow>
        <meshStandardMaterial color="#0d0e11" roughness={0.8} />
      </mesh>
      <group position={[0, 0, padSt.lit ? -0.012 : 0]} {...handlers("touchpad")}>
        <mesh geometry={geo.touchpad} receiveShadow>
          <meshPhysicalMaterial color="#1c1d22" roughness={0.78} clearcoat={0.1} {...glow(padSt.lit, padSt.sel, padSt.hov, 0.35)} />
        </mesh>
        {vis.touches.map((t) => {
          const [x, y] = touchPoint(t.u, t.v);
          return (
            <mesh key={t.id} geometry={geo.touch} position={w(x, y, 0.05)}>
              <meshBasicMaterial color={GOLD} transparent opacity={0.9} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      {geo.lightBars.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#1b1d4a" emissive="#4b52ff" emissiveIntensity={vis.connected ? 1.8 : 0.08} roughness={0.4} />
        </mesh>
      ))}

      {/* D-pad */}
      <group position={w(DPAD.x, DPAD.y)}>
        <mesh geometry={geo.dpadWell} position={[0, 0, 0.003]} receiveShadow>
          <meshStandardMaterial color="#121317" roughness={0.85} />
        </mesh>
        {dpadArm("dpadUp", 0)}
        {dpadArm("dpadRight", -Math.PI / 2)}
        {dpadArm("dpadDown", Math.PI)}
        {dpadArm("dpadLeft", Math.PI / 2)}
      </group>

      {/* Face buttons */}
      {faceButton("north", fx, fy - gp)}
      {faceButton("east", fx + gp, fy)}
      {faceButton("south", fx, fy + gp)}
      {faceButton("west", fx - gp, fy)}

      {/* Create / Options */}
      {small("select")}
      {small("start")}

      {/* Speaker, sticks, PS and mute */}
      <mesh geometry={geo.speaker}>
        <meshStandardMaterial color="#050506" roughness={1} />
      </mesh>
      {stick("leftStick", vis.leftStick)}
      {stick("rightStick", vis.rightStick)}
      <group position={w(HOME.x, HOME.y)} {...handlers("home")}>
        <mesh geometry={geo.homeWell} position={[0, 0, 0.004]}>
          <meshStandardMaterial color="#08090b" roughness={0.9} />
        </mesh>
        <mesh geometry={geo.home} position={[0, 0, homeSt.lit ? -0.02 : 0]} castShadow>
          <meshPhysicalMaterial {...KEY} {...(homeSt.lit ? { emissive: GOLD, emissiveIntensity: 1.1 } : glow(false, homeSt.sel, homeSt.hov))} />
        </mesh>
      </group>
      <group position={w(MUTE.x, MUTE.y, muteSt.lit ? -0.01 : 0)} {...handlers("mute")}>
        <mesh geometry={geo.mute}>
          <meshPhysicalMaterial {...KEY} color="#16171b" {...(muteSt.lit ? { emissive: "#ff8a3c", emissiveIntensity: 1.3 } : glow(false, muteSt.sel, muteSt.hov))} />
        </mesh>
      </group>

      {/* Shoulders */}
      {bumper("leftShoulder")}
      {bumper("rightShoulder")}
      {trigger("leftTrigger", vis.l2)}
      {trigger("rightTrigger", vis.r2)}

      {/* USB-C port on the top edge */}
      <mesh geometry={geo.usb} position={[0, toWorld(400, 36)[1] + 0.005, -0.55]}>
        <meshStandardMaterial color="#030304" roughness={0.6} />
      </mesh>

      {/* Mapping marks: small dots above the controls (remapped, macro, disabled, layer/gyro). */}
      {marks && (Object.keys(marks) as MacroButton[]).map((b) => {
        const m = marks[b]!;
        const kinds = (["disabled", "remapped", "macro", "special"] as const).filter((k) => m[k]);
        const a = anchorOf(b);
        return kinds.map((k, i) => (
          <mesh key={`${b}-${k}`} geometry={geo.mark}
            position={[a.pos[0] + 0.2 + i * 0.13, a.pos[1] + 0.2, a.pos[2] + 0.06]}>
            <meshStandardMaterial color={MARK_COLOURS[k]} emissive={MARK_COLOURS[k]} emissiveIntensity={0.6} />
          </mesh>
        ));
      })}
    </group>
  );
}

/** Re-renders only when what is visible changes (input, selection, hover, marks). */
export const DualSenseModel = memo(DualSenseModelImpl, (a, b) =>
  a.visKey === b.visKey && a.selected === b.selected && a.hovered === b.hovered && a.marks === b.marks && a.pick === b.pick);
