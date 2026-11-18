import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  CAMERA_TARGET, VIEWS, ZOOM, anchorOf, facesCamera, fitRadius, orbitBetween, orbitToOffset, visualFrom, visualKey,
  type Orbit, type ViewName,
} from "../../lib/controller3d";
import { describeState } from "../../lib/controllerView";
import type { ButtonMark } from "../../lib/buttonMapping";
import type { ControllerState, MacroButton } from "../../types/engine";
import { DualSenseModel } from "./DualSenseModel";

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
  /** Switch back to the 2D picture. */
  onFlat?: () => void;
}

const ALL_BUTTONS: MacroButton[] = [
  "south", "east", "west", "north", "leftShoulder", "rightShoulder", "leftTrigger", "rightTrigger", "leftStick", "rightStick",
  "start", "select", "home", "touchpad", "mute", "dpadUp", "dpadDown", "dpadLeft", "dpadRight",
];

type Request = { kind: "view"; view: ViewName; n: number } | { kind: "zoom"; factor: number; n: number };

/**
 * Interactive 3D controller. Renders on demand only: a frame is drawn when
 * the input changes, while the camera moves, or when the size changes —
 * nothing runs while everything is still.
 */
export default function Controller3D({ state, live, selected = null, onSelect, marks, onAnchors, onFlat }: Controller3DProps) {
  const vis = visualFrom(state, live);
  const visKey = visualKey(vis);
  // Same key → same object, so the memoised model skips identical updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableVis = useMemo(() => vis, [visKey]);
  const [hovered, setHovered] = useState<MacroButton | null>(null);
  const [request, setRequest] = useState<Request>({ kind: "view", view: "default", n: 0 });
  const [view, setView] = useState<ViewName | null>("default");
  const [interacted, setInteracted] = useState(false);
  const counter = useRef(0);
  const go = (v: ViewName) => { setView(v); setRequest({ kind: "view", view: v, n: ++counter.current }); };
  const zoom = (factor: number) => setRequest({ kind: "zoom", factor, n: ++counter.current });

  // Callers pass inline handlers; keep the latest in a ref so the model is not re-rendered for them.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const canPick = Boolean(onSelect);
  const pick = useMemo(() => canPick ? {
    over: (b: MacroButton) => setHovered(b),
    out: (b: MacroButton) => setHovered((h) => (h === b ? null : h)),
    click: (b: MacroButton) => selectRef.current?.(b),
  } : undefined, [canPick]);
  const anchorsRef = useRef(onAnchors);
  anchorsRef.current = onAnchors;
  const reportAnchors = useCallback((a: Anchors) => anchorsRef.current?.(a), []);
  const userMoved = useCallback(() => setView(null), []);
  const marksKey = JSON.stringify(marks ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableMarks = useMemo(() => marks, [marksKey]);

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
        <DualSenseModel vis={stableVis} visKey={visKey} selected={selected} hovered={hovered} marks={stableMarks} pick={pick} />
        {onAnchors && <AnchorReporter onAnchors={reportAnchors} />}
      </Canvas>

      {!vis.connected && <div className="c3d-status">No controller connected</div>}
      <div className="c3d-toolbar" role="toolbar" aria-label="3D view">
        {(["default", "front", "rear", "top"] as ViewName[]).map((v) => (
          <button key={v} type="button" className={view === v ? "selected" : ""} aria-pressed={view === v} onClick={() => go(v)}>
            {v === "default" ? "Reset" : v === "top" ? "Top" : v === "front" ? "Front" : "Rear"}
          </button>
        ))}
        <span className="c3d-sep" aria-hidden="true" />
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.18)}>−</button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1 / 1.18)}>+</button>
        {onFlat && <><span className="c3d-sep" aria-hidden="true" /><button type="button" onClick={onFlat} title="Show the flat picture">2D</button></>}
      </div>
      {!interacted && <div className="c3d-hint" aria-hidden="true">Drag to rotate · scroll to zoom</div>}
    </div>
  );
}

/** Lights, reflections and the soft contact shadow. */
function Scene() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // Studio-like reflections without any image file.
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
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
      <directionalLight position={[3.5, 7, 8]} intensity={2.1} castShadow
        shadow-mapSize={[1024, 1024]} shadow-radius={6} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-camera-near={1} shadow-camera-far={25} />
      <directionalLight position={[-7, 2, 5]} intensity={0.55} color="#cfd6ff" />
      {/* A faint warm rim from behind picks out the edges against the dark page. */}
      <directionalLight position={[0, 6, -7]} intensity={0.8} color="#f0cb72" />
      {/* Backdrop that only shows the shadow. */}
      <mesh position={[0, -0.2, -2.6]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
    </>
  );
}

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

/** Projects each control's position to the canvas when the camera or size changes. */
function AnchorReporter({ onAnchors }: { onAnchors: (a: Anchors) => void }) {
  const last = useRef("");
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    const sig = `${camera.position.toArray().map((n) => n.toFixed(3)).join()}|${size.width}x${size.height}`;
    if (sig === last.current) return;
    last.current = sig;
    const cam = camera.position.toArray() as [number, number, number];
    const out: Anchors = {};
    for (const b of ALL_BUTTONS) {
      const a = anchorOf(b);
      v.set(...a.pos).project(camera);
      out[b] = { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, visible: v.z < 1 && facesCamera(a, cam) };
    }
    onAnchors(out);
  });
  return null;
}
