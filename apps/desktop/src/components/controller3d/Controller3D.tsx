import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import modelUrl from "../../assets/models/dualsense.glb?url";
import ds4ModelUrl from "../../assets/models/dualshock4.glb?url";
import {
  CAMERA_TARGET, VIEWS, ZOOM, facesCamera, fitRadius, orbitBetween, orbitToOffset, visualFrom, visualKey,
  type Orbit, type ViewModel, type ViewName, type Visual3D,
} from "../../lib/controller3d";
import { DUALSENSE_SPEC, type ModelSpec } from "../../lib/dualsenseModel";
import { DS4_MODEL_CREDIT, DUALSHOCK4_SPEC } from "../../lib/dualshock4Model";
import { useShownModel } from "../../hooks/useShownModel";
import { describeState } from "../../lib/controllerView";
import type { ButtonMark } from "../../lib/buttonMapping";
import type { ControllerState, MacroButton } from "../../types/engine";
import { applyFinish, applyVisual, buildModel, type BuiltModel, type Finish, type PartNode } from "./modelParts";
import { useFinish } from "../../lib/controllerViewMode";
import { useWindowActive } from "../../hooks/useWindowActive";

/** Screen position of each control inside the canvas (CSS px), for leader lines. */
export type Anchors = Partial<Record<MacroButton, { x: number; y: number; visible: boolean }>>;

export interface Controller3DProps {
  state: ControllerState | null;
  live: boolean;
  selected?: MacroButton | null;
  onSelect?: (b: MacroButton) => void;
  marks?: Partial<Record<MacroButton, ButtonMark>>;
  /** Called when the projected control positions change (camera moved or resized). */
  onAnchors?: (a: Anchors) => void;
  /** Selected and hovered controls in the NEXUS accent colour instead of teal. */
  accentSelection?: boolean;
  /** Show the view buttons in this element (outside the picture) instead of over the picture. */
  toolbarHost?: HTMLElement | null;
  /** Switch back to the 2D picture. */
  onFlat?: () => void;
  /** Badge text while there is no live input. */
  offlineLabel?: string;
}

/** Credit required by the model's licence (CC BY 4.0). */
export const MODEL_CREDIT = {
  title: "Playstation 5 Dualsense",
  author: "AHarmlessPotato",
  source: "https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  changes: "split into separate controls, recoloured glow, animated by NEXUS",
} as const;

/** Each 3D model: its file, how it is read, and its credit. */
const MODELS: Record<ViewModel, { url: string; spec: ModelSpec; credit: typeof MODEL_CREDIT | typeof DS4_MODEL_CREDIT }> = {
  dualSense: { url: modelUrl, spec: DUALSENSE_SPEC, credit: MODEL_CREDIT },
  dualShock4: { url: ds4ModelUrl, spec: DUALSHOCK4_SPEC, credit: DS4_MODEL_CREDIT },
};

type Request = { kind: "view"; view: ViewName; n: number } | { kind: "zoom"; factor: number; n: number };
type Pick = { over: (b: MacroButton) => void; out: (b: MacroButton) => void; click: (b: MacroButton) => void };

const MARK_COLOURS = { disabled: "#e26a6a", remapped: "#4fa8b8", macro: "#d6a54b", special: "#9b9ea6" } as const;

/**
 * Interactive 3D controller. Renders on demand only: a frame is drawn when
 * the input changes, while the camera moves, or when the size changes —
 * nothing runs while everything is still.
 */
export default function Controller3D({ state, live, selected = null, onSelect, marks, onAnchors, onFlat, offlineLabel, accentSelection = false, toolbarHost = null }: Controller3DProps) {
  const vis = visualFrom(state, live);
  const visKey = visualKey(vis);
  // Follows the controller: the DualShock 4 model for a DualShock 4, the
  // DualSense model otherwise. Switching loads the other file once (cached).
  const which = useShownModel(state);
  const shown = MODELS[which];
  // Same key → same object, so identical status updates do nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableVis = useMemo(() => vis, [visKey]);
  const [hovered, setHovered] = useState<MacroButton | null>(null);
  const [request, setRequest] = useState<Request>({ kind: "view", view: "default", n: 0 });
  const [view, setView] = useState<ViewName | null>("default");
  const [interacted, setInteracted] = useState(false);
  const [credit, setCredit] = useState(false);
  const [finish, setFinish] = useFinish();
  const counter = useRef(0);
  const go = (v: ViewName) => { setView(v); setRequest({ kind: "view", view: v, n: ++counter.current }); };
  const zoom = (factor: number) => setRequest({ kind: "zoom", factor, n: ++counter.current });

  // Callers pass inline handlers; keep the latest in refs so the scene isn't redrawn for them.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const canPick = Boolean(onSelect);
  const pick = useMemo<Pick | undefined>(() => canPick ? {
    over: (b) => setHovered(b),
    out: (b) => setHovered((h) => (h === b ? null : h)),
    click: (b) => selectRef.current?.(b),
  } : undefined, [canPick]);
  const anchorsRef = useRef(onAnchors);
  anchorsRef.current = onAnchors;
  const reportAnchors = useCallback((a: Anchors) => anchorsRef.current?.(a), []);
  const userMoved = useCallback(() => setView(null), []);
  const marksKey = JSON.stringify(marks ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableMarks = useMemo(() => marks, [marksKey]);

  const toolbar = (
  <div className="c3d-toolbar" role="toolbar" aria-label="3D view">
    {(["default", "front", "rear", "top"] as ViewName[]).map((v) => (
      <button key={v} type="button" className={view === v ? "selected" : ""} aria-pressed={view === v} onClick={() => go(v)}>
        {v === "default" ? "Reset" : v === "top" ? "Top" : v === "front" ? "Front" : "Rear"}
      </button>
    ))}
    <span className="c3d-sep" aria-hidden="true" />
    <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.18)}>−</button>
    <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1 / 1.18)}>+</button>
    <span className="c3d-sep" aria-hidden="true" />
    {shown.spec.finishes && <button type="button" className={`c3d-finish ${finish}`} onClick={() => setFinish(finish === "black" ? "white" : "black")}
      title={`Colour: ${finish === "black" ? "Midnight Black" : "White"} (click to change)`}
      aria-label={`Controller colour: ${finish === "black" ? "Midnight Black" : "White"}. Change`}><i /></button>}
    {onFlat && <button type="button" onClick={onFlat} title="Show the flat picture">2D</button>}
    <span className="c3d-sep" aria-hidden="true" />
    <button type="button" aria-label="3D model credit" aria-expanded={credit} title="3D model credit" onClick={() => setCredit((c) => !c)}>ⓘ</button>
  </div>
  );

  return (
    <div className={`c3d${vis.connected ? " live" : " idle"}${hovered ? " hovering" : ""}`}
      role="group" aria-label={vis.connected ? `3D controller. ${describeState(state)}` : "3D controller (no controller connected)"}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{ antialias: true, powerPreference: "default" }}
        camera={{ fov: 32, near: 0.5, far: 60, position: [0, 4, 9] }}
        onPointerMissed={() => setHovered(null)}
        onPointerDown={() => setInteracted(true)}
      >
        <Scene />
        <CameraRig request={request} onUserMove={userMoved} />
        <ControllerModel key={which} url={shown.url} spec={shown.spec}
          vis={stableVis} visKey={visKey} selected={selected} hovered={hovered} marks={stableMarks} pick={pick} finish={finish} accent={accentSelection}
          onAnchors={onAnchors ? reportAnchors : undefined} />
      </Canvas>

      {!vis.connected && <div className="c3d-status" role="status">{offlineLabel ?? "No controller connected"}</div>}
      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
      {credit && (
        <div className="c3d-credit" role="note">
          3D model: “{shown.credit.title}” by {shown.credit.author} (Sketchfab), licensed {shown.credit.license}.
          Changes: {shown.credit.changes}.
        </div>
      )}
      {!interacted && !credit && <div className="c3d-hint" aria-hidden="true">Drag to rotate · scroll to zoom</div>}
    </div>
  );
}

/** Lights, reflections and the soft shadow behind the controller. */
function Scene() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // Studio-like reflections generated in code, no image file.
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
      (room as unknown as { dispose?: () => void }).dispose?.();
    };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={["#c9ccd6", "#0b0b0d", 0.35]} />
      <directionalLight position={[3.5, 7, 8]} intensity={2.0} castShadow
        shadow-mapSize={[1024, 1024]} shadow-radius={6} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-camera-near={1} shadow-camera-far={25} />
      <directionalLight position={[-7, 2, 5]} intensity={0.5} color="#cfd6ff" />
      {/* A faint warm rim from behind picks out the edges against the dark page. */}
      <directionalLight position={[0, 6, -7]} intensity={0.7} color="#f0cb72" />
      {/* Backdrop that only shows the shadow. */}
      <mesh position={[0, -0.2, -2.8]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
    </>
  );
}

/** The model: loaded once, split into controls, updated only when what is visible changes. */
function ControllerModel({ url, spec, vis, visKey, selected, hovered, marks, pick, onAnchors, finish, accent }: {
  url: string; spec: ModelSpec; accent: boolean;
  vis: Visual3D; visKey: string; selected: MacroButton | null; hovered: MacroButton | null; finish: Finish;
  marks?: Partial<Record<MacroButton, ButtonMark>>; pick?: Pick; onAnchors?: (a: Anchors) => void;
}) {
  const gltf = useLoader(GLTFLoader, url);
  const model = useMemo(() => buildModel(gltf, spec), [gltf, spec]);
  useEffect(() => () => model.dispose(), [model]);
  const invalidate = useThree((s) => s.invalidate);
  // While a game is in front, the scene is not redrawn for input changes:
  // each redraw (shadow pass, anti-aliasing) is GPU work competing with the
  // game. The latest state is drawn as soon as NEXUS is focused again.
  const active = useWindowActive();
  useLayoutEffect(() => {
    if (!active) return;
    applyFinish(model, finish);
    applyVisual(model, vis, selected, hovered, accent);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, visKey, selected, hovered, finish, invalidate, active, accent]);

  // Stable across renders: new handler props would make the 3D library
  // schedule a redraw on every status update.
  const handlers = useMemo(() => pick ? {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const b = buttonOf(e);
      if (b) { e.stopPropagation(); pick.over(b); }
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => { const b = buttonOf(e); if (b) pick.out(b); },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const b = buttonOf(e);
      // A drag that rotated the view is not a click.
      if (b && e.delta <= 4) { e.stopPropagation(); pick.click(b); }
    },
  } : {}, [pick]);

  return (
    <>
      <primitive object={model.root} {...handlers} />
      {marks && <Marks model={model} marks={marks} />}
      {onAnchors && <AnchorReporter model={model} onAnchors={onAnchors} />}
    </>
  );
}

function buttonOf(e: ThreeEvent<PointerEvent | MouseEvent>): MacroButton | null {
  for (let o: THREE.Object3D | null = e.object; o; o = o.parent) {
    if (o.userData.button) return o.userData.button as MacroButton;
  }
  return null;
}

/** Mapping marks: small dots beside a control (remapped, macro, disabled, layer/gyro).
 *  Memoised: re-rendering them would redraw the scene on every status update. */
const Marks = memo(function Marks({ model, marks }: { model: BuiltModel; marks: Partial<Record<MacroButton, ButtonMark>> }) {
  return (
    <>
      {(Object.keys(marks) as MacroButton[]).filter((b) => model.parts[b]).map((b) => {
        const m = marks[b]!;
        const a = model.parts[b]!.frame.anchor;
        return (["disabled", "remapped", "macro", "special"] as const).filter((k) => m[k]).map((k, i) => (
          <mesh key={`${b}-${k}`} position={[a[0] + 0.24 + i * 0.14, a[1] + 0.22, a[2] + 0.06]}>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshStandardMaterial color={MARK_COLOURS[k]} emissive={MARK_COLOURS[k]} emissiveIntensity={0.6} />
          </mesh>
        ));
      })}
    </>
  );
});

/** Orbit controls (drag to rotate, wheel to zoom) and smooth moves to the preset views. */
function CameraRig({ request, onUserMove }: { request: Request; onUserMove: () => void }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  const tween = useRef<{ from: Orbit; to: Orbit; start: number; ms: number } | null>(null);
  const target = useMemo(() => new THREE.Vector3(...CAMERA_TARGET), []);
  const aspect = size.width / Math.max(1, size.height);

  const current = useCallback((): Orbit => {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
    return { radius: s.radius, phi: s.phi, theta: s.theta };
  }, [camera, target]);
  const place = useCallback((o: Orbit) => {
    const [x, y, z] = orbitToOffset(o);
    camera.position.set(target.x + x, target.y + y, target.z + z);
    camera.lookAt(target);
  }, [camera, target]);

  useEffect(() => {
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.7;
    controls.enablePan = false;
    controls.minDistance = ZOOM.min;
    controls.maxDistance = ZOOM.max;
    const onChange = () => invalidate();
    const onStart = () => { tween.current = null; onUserMove(); };
    controls.addEventListener("change", onChange);
    controls.addEventListener("start", onStart);
    return () => {
      controls.removeEventListener("change", onChange);
      controls.removeEventListener("start", onStart);
      controls.dispose();
    };
  }, [controls, target, invalidate, onUserMove]);

  // First placement: the default view, fitted to the panel's shape.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || size.width === 0) return;
    placed.current = true;
    const d = VIEWS.default;
    place({ ...d, radius: fitRadius(d.radius, aspect) });
    controls.update();
    invalidate();
  }, [size.width, aspect, place, controls, invalidate]);

  // Preset views and zoom buttons glide there instead of jumping.
  useEffect(() => {
    if (request.n === 0) return;
    const from = current();
    const to = request.kind === "view"
      ? { ...VIEWS[request.view], radius: fitRadius(VIEWS[request.view].radius, aspect) }
      : { ...from, radius: Math.min(ZOOM.max, Math.max(ZOOM.min, from.radius * request.factor)) };
    tween.current = { from, to, start: performance.now(), ms: request.kind === "view" ? 650 : 220 };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.n]);

  useFrame(() => {
    const t = tween.current;
    if (t) {
      const k = Math.min(1, (performance.now() - t.start) / t.ms);
      place(orbitBetween(t.from, t.to, k));
      if (k >= 1) tween.current = null;
      invalidate();
    }
    // Damping keeps easing after a drag; update() fires "change" while it does.
    controls.update();
  });
  return null;
}

/** Projects each control's anchor to the canvas when the camera or size changes. */
function AnchorReporter({ model, onAnchors }: { model: BuiltModel; onAnchors: (a: Anchors) => void }) {
  const last = useRef("");
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    const sig = `${camera.position.toArray().map((n) => n.toFixed(3)).join()}|${size.width}x${size.height}`;
    if (sig === last.current) return;
    last.current = sig;
    const cam = camera.position.toArray() as [number, number, number];
    const out: Anchors = {};
    for (const node of Object.values(model.parts) as PartNode[]) {
      const { anchor, normal } = node.frame;
      v.set(...anchor).project(camera);
      out[node.button] = {
        x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height,
        visible: v.z < 1 && facesCamera({ pos: anchor, normal }, cam),
      };
    }
    onAnchors(out);
  });
  return null;
}

// Start downloading the model as soon as the 3D view is first imported.
useLoader.preload(GLTFLoader, modelUrl);
