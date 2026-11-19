import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import modelUrl from "../../assets/models/dualsense.glb?url";
import {
  CAMERA_TARGET, VIEWS, ZOOM, facesCamera, fitRadius, orbitBetween, orbitToOffset, visualFrom, visualKey, visuallyDifferent,
  type Orbit, type ViewName, type Visual3D,
} from "../../lib/controller3d";
import { describeState } from "../../lib/controllerView";
import type { ButtonMark } from "../../lib/buttonMapping";
import type { ControllerState, MacroButton } from "../../types/engine";
import { applySkin, applyVisual, buildModel, type BuiltModel } from "./modelParts";
import { useActiveSkin } from "../../lib/skinStore";
import { VIEWS as ORBITS } from "../../lib/controller3d";
import type { ComponentId, LightingId, Skin } from "../../lib/skin";

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
  /** Badge text while there is no live input. */
  offlineLabel?: string;
  /** Show this skin instead of the active one (Controller Studio's working copy). */
  skin?: Skin;
  /** Components not drawn (Studio's visibility toggles). */
  hidden?: ReadonlySet<ComponentId>;
  /** Gives the caller a way to capture images of the view. */
  onReady?: (api: Capture) => void;
  /** Hide the "Studio" shortcut (inside Controller Studio itself). */
  inStudio?: boolean;
  /** Pick any component, shell zones included (Controller Studio). Takes the place of onSelect. */
  onSelectComponent?: (c: ComponentId) => void;
}

/** Captures the view as a PNG data URL; optionally with another skin and from the default angle (thumbnails). */
export interface Capture {
  image(opts?: { skin?: Skin; defaultAngle?: boolean; width?: number }): string;
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

type Request = { kind: "view"; view: ViewName; n: number } | { kind: "zoom"; factor: number; n: number };
type Pick = { all: boolean; over: (c: ComponentId) => void; out: (c: ComponentId) => void; click: (c: ComponentId) => void };
const SHELL_ZONES = new Set(["frontShell", "rearShell", "gripLeft", "gripRight", "centerTrim", "lightBar", "stickBases"]);
const isShellZone = (c: ComponentId): c is Exclude<ComponentId, MacroButton> => SHELL_ZONES.has(c);

const MARK_COLOURS = { disabled: "#e26a6a", remapped: "#4fa8b8", macro: "#d6a54b", special: "#9b9ea6" } as const;

/**
 * Interactive 3D controller. Renders on demand only: a frame is drawn when
 * the input changes, while the camera moves, or when the size changes —
 * nothing runs while everything is still.
 */
export default function Controller3D({ state, live, selected = null, onSelect, marks, onAnchors, onFlat, offlineLabel, skin: skinProp, hidden, onReady, inStudio, onSelectComponent }: Controller3DProps) {
  const activeSkin = useActiveSkin();
  const skin = skinProp ?? activeSkin;
  // Only a visible change replaces what is drawn: sensor jitter on a resting
  // stick doesn't cause a redraw (see visuallyDifferent).
  const drawn = useRef<Visual3D>(visualFrom(state, live));
  const next = visualFrom(state, live);
  if (visuallyDifferent(drawn.current, next)) drawn.current = next;
  const vis = drawn.current;
  const stableVis = vis;
  const visKey = useMemo(() => visualKey(vis), [vis]);
  const [hovered, setHovered] = useState<MacroButton | null>(null);
  const [request, setRequest] = useState<Request>({ kind: "view", view: "default", n: 0 });
  const [view, setView] = useState<ViewName | null>("default");
  const [interacted, setInteracted] = useState(false);
  const [credit, setCredit] = useState(false);
  const counter = useRef(0);
  const go = (v: ViewName) => { setView(v); setRequest({ kind: "view", view: v, n: ++counter.current }); };
  const zoom = (factor: number) => setRequest({ kind: "zoom", factor, n: ++counter.current });

  // Callers pass inline handlers; keep the latest in refs so the scene isn't redrawn for them.
  const selectRef = useRef<((c: ComponentId) => void) | undefined>(undefined);
  selectRef.current = onSelectComponent ?? (onSelect ? (c: ComponentId) => { if (!isShellZone(c)) onSelect(c); } : undefined);
  const canPick = Boolean(onSelect || onSelectComponent);
  const pickAll = Boolean(onSelectComponent);
  const pick = useMemo<Pick | undefined>(() => canPick ? {
    all: pickAll,
    over: (b) => setHovered(isShellZone(b) ? null : b),
    out: (b) => setHovered((h) => (h === b ? null : h)),
    click: (b) => selectRef.current?.(b),
  } : undefined, [canPick, pickAll]);
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
        <Scene lighting={skin.lighting} />
        <CameraRig request={request} onUserMove={userMoved} />
        <DualSense vis={stableVis} visKey={visKey} selected={selected} hovered={hovered} marks={stableMarks} pick={pick} skin={skin} hidden={hidden ?? NONE_HIDDEN} onReady={onReady}
          onAnchors={onAnchors ? reportAnchors : undefined} />
      </Canvas>

      {!vis.connected && <div className="c3d-status" role="status">{offlineLabel ?? "No controller connected"}</div>}
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
        {!inStudio && (
          <button type="button" className="c3d-studio" title={`Skin: ${skin.name}. Open Controller Studio to customise`}
            aria-label={`Skin: ${skin.name}. Open Controller Studio`}
            onClick={() => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page: "studio" } }))}>
            <i style={{ background: swatchOf(skin) }} />Studio
          </button>
        )}
        {onFlat && <button type="button" onClick={onFlat} title="Show the flat picture">2D</button>}
        <span className="c3d-sep" aria-hidden="true" />
        <button type="button" aria-label="3D model credit" aria-expanded={credit} title="3D model credit" onClick={() => setCredit((c) => !c)}>ⓘ</button>
      </div>
      {credit && (
        <div className="c3d-credit" role="note">
          3D model: “{MODEL_CREDIT.title}” by {MODEL_CREDIT.author} (Sketchfab), licensed {MODEL_CREDIT.license}.
          Changes: {MODEL_CREDIT.changes}.
        </div>
      )}
      {!interacted && !credit && <div className="c3d-hint" aria-hidden="true">Drag to rotate · scroll to zoom</div>}
    </div>
  );
}

/** Lighting presets: key, fill and rim lights plus how strong the reflections are. */
const LIGHTS: Record<LightingId, { env: number; hemi: number; key: [string, number]; fill: [string, number]; rim: [string, number] }> = {
  studio: { env: 0.6, hemi: 0.35, key: ["#ffffff", 2.0], fill: ["#cfd6ff", 0.5], rim: ["#f0cb72", 0.7] },
  showroom: { env: 0.95, hemi: 0.5, key: ["#ffffff", 2.4], fill: ["#ffffff", 0.8], rim: ["#ffffff", 0.6] },
  night: { env: 0.22, hemi: 0.12, key: ["#9fb4ff", 0.9], fill: ["#30406e", 0.25], rim: ["#4fe3ff", 1.2] },
  neon: { env: 0.3, hemi: 0.15, key: ["#ffffff", 1.0], fill: ["#ff2bd6", 1.3], rim: ["#00f0ff", 1.5] },
  sunset: { env: 0.45, hemi: 0.25, key: ["#ffb070", 2.0], fill: ["#8a6bff", 0.55], rim: ["#ff7a3c", 1.1] },
};

/** Lights, reflections and the soft shadow behind the controller. */
function Scene({ lighting }: { lighting: LightingId }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const L = LIGHTS[lighting] ?? LIGHTS.studio;
  useEffect(() => {
    // Studio-like reflections generated in code, no image file.
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
      (room as unknown as { dispose?: () => void }).dispose?.();
    };
  }, [gl, scene]);
  useEffect(() => { scene.environmentIntensity = L.env; }, [scene, L.env]);
  return (
    <>
      <hemisphereLight args={["#c9ccd6", "#0b0b0d", L.hemi]} />
      <directionalLight position={[3.5, 7, 8]} intensity={L.key[1]} color={L.key[0]} castShadow
        shadow-mapSize={[1024, 1024]} shadow-radius={6} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-camera-near={1} shadow-camera-far={25} />
      <directionalLight position={[-7, 2, 5]} intensity={L.fill[1]} color={L.fill[0]} />
      {/* A rim light from behind picks out the edges against the dark page. */}
      <directionalLight position={[0, 6, -7]} intensity={L.rim[1]} color={L.rim[0]} />
      {/* Backdrop that only shows the shadow. */}
      <mesh position={[0, -0.2, -2.8]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
    </>
  );
}

const NONE_HIDDEN: ReadonlySet<ComponentId> = new Set();

/** The swatch on the Studio button: the skin's front shell colour (or its base). */
function swatchOf(skin: Skin): string {
  return skin.components.frontShell?.color ?? (skin.base === "white" ? "#e9e8ee" : "#1b1c21");
}

/** The model: loaded once, split into controls, updated only when what is visible changes. */
function DualSense({ vis, visKey, selected, hovered, marks, pick, onAnchors, skin, hidden, onReady }: {
  vis: Visual3D; visKey: string; selected: MacroButton | null; hovered: MacroButton | null;
  marks?: Partial<Record<MacroButton, ButtonMark>>; pick?: Pick; onAnchors?: (a: Anchors) => void;
  skin: Skin; hidden: ReadonlySet<ComponentId>; onReady?: (api: Capture) => void;
}) {
  const gltf = useLoader(GLTFLoader, modelUrl);
  const model = useMemo(() => buildModel(gltf), [gltf]);
  useEffect(() => () => model.dispose(), [model]);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // The skin only changes materials; input only changes transforms and glow.
  useLayoutEffect(() => {
    applySkin(model, skin, hidden, invalidate);
    applyVisual(model, vis, selected, hovered);
    invalidate();
  }, [model, skin, hidden, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    applyVisual(model, vis, selected, hovered);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, visKey, selected, hovered, invalidate]);

  // Image capture (screenshots, skin thumbnails). Renders once on demand and restores everything.
  const current = useRef({ skin, hidden, vis, selected, hovered });
  current.current = { skin, hidden, vis, selected, hovered };
  useEffect(() => {
    if (!onReady) return;
    onReady({
      image: (opts = {}) => {
        const c = current.current;
        const saved = camera.position.clone();
        if (opts.defaultAngle) {
          const [x, y, z] = orbitToOffset(ORBITS.default);
          camera.position.set(CAMERA_TARGET[0] + x, CAMERA_TARGET[1] + y, CAMERA_TARGET[2] + z);
          camera.lookAt(...CAMERA_TARGET);
        }
        if (opts.skin) { applySkin(model, opts.skin, NONE_HIDDEN, invalidate); applyVisual(model, c.vis, null, null); }
        gl.render(scene, camera);
        let url = gl.domElement.toDataURL("image/png");
        if (opts.width && opts.width < gl.domElement.width) {
          const k = opts.width / gl.domElement.width;
          const small = document.createElement("canvas");
          small.width = Math.round(gl.domElement.width * k);
          small.height = Math.round(gl.domElement.height * k);
          small.getContext("2d")?.drawImage(gl.domElement, 0, 0, small.width, small.height);
          url = small.toDataURL("image/png");
        }
        if (opts.defaultAngle) { camera.position.copy(saved); camera.lookAt(...CAMERA_TARGET); }
        if (opts.skin) { applySkin(model, c.skin, c.hidden, invalidate); applyVisual(model, c.vis, c.selected, c.hovered); }
        invalidate();
        return url;
      },
    });
  }, [onReady, model, gl, scene, camera, invalidate]);

  // Created once per `pick`: new handler functions on every render would count
  // as changed properties and make the view redraw on every status update.
  const handlers = useMemo(() => {
    if (!pick) return {};
    /** The control (or, in Studio, any component) under the pointer. */
    const buttonOf = (e: ThreeEvent<PointerEvent | MouseEvent>): ComponentId | null => {
      for (let o: THREE.Object3D | null = e.object; o; o = o.parent) {
        if (o.userData.button) return o.userData.button as MacroButton;
        if (pick.all && o.userData.component) return o.userData.component as ComponentId;
      }
      return null;
    };
    return {
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
    };
  }, [pick]);

  return (
    <>
      <primitive object={model.root} {...handlers} />
      {marks && <Marks model={model} marks={marks} />}
      {onAnchors && <AnchorReporter model={model} onAnchors={onAnchors} />}
    </>
  );
}

/** Mapping marks: small dots beside a control (remapped, macro, disabled, layer/gyro). */
function Marks({ model, marks }: { model: BuiltModel; marks: Partial<Record<MacroButton, ButtonMark>> }) {
  return (
    <>
      {(Object.keys(marks) as MacroButton[]).map((b) => {
        const m = marks[b]!;
        const a = model.parts[b].frame.anchor;
        return (["disabled", "remapped", "macro", "special"] as const).filter((k) => m[k]).map((k, i) => (
          <mesh key={`${b}-${k}`} position={[a[0] + 0.24 + i * 0.14, a[1] + 0.22, a[2] + 0.06]}>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshStandardMaterial color={MARK_COLOURS[k]} emissive={MARK_COLOURS[k]} emissiveIntensity={0.6} />
          </mesh>
        ));
      })}
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
    for (const node of Object.values(model.parts)) {
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
