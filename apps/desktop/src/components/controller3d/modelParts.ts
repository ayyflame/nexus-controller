// Turns a loaded controller model (DualSense or DualShock 4) into a scene
// where every control is its own object (with its own pivot and material),
// and applies live input to it. The geometry, materials and textures are the
// model's own; NEXUS only splits the meshes by control (see
// lib/dualsenseModel.ts and lib/dualshock4Model.ts) and adds glow and motion.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CAMERA_TARGET, VIEWS, orbitToOffset, triggerAngle, type Visual3D } from "../../lib/controller3d";
import {
  BLACK_FINISH_GLSL, MODEL_SCALE, PRESS_DEPTH, classifyIn, findIslands, frameIn, partAnchor,
  type Island, type ModelSpec, type Motion, type PartFrame, type V3,
} from "../../lib/dualsenseModel";
import type { MacroButton } from "../../types/engine";

export interface PartNode {
  button: MacroButton;
  /** How it moves when used. */
  kind: Motion;
  /** Positioned at the pivot; sticks and triggers rotate this. */
  pivot: THREE.Group;
  /** Inside the pivot; presses move this. */
  motion: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  /** Pivot / anchor / facing in scene units. */
  frame: PartFrame;
  min: V3;
  max: V3;
}

export type Finish = "white" | "black";

/**
 * Adds the Midnight Black recolouring to a material's shader. It is switched
 * by one uniform, so changing the finish needs no new textures and no shader
 * rebuild, and nothing reads texture pixels back (which a webview may refuse).
 */
function installFinish(m: THREE.MeshStandardMaterial): { value: number } {
  const uniform = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.nexusBlack = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${BLACK_FINISH_GLSL}`)
      .replace("#include <map_fragment>", `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  if ( nexusBlack > 0.5 ) sampledDiffuseColor.rgb = nexusBlackFinish( sampledDiffuseColor.rgb );
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  // All NEXUS controller materials share one compiled variant.
  m.customProgramCacheKey = () => "nexus-finish";
  return uniform;
}

export interface BuiltModel {
  root: THREE.Group;
  /**
   * This view's own materials (copies; the loaded model is never changed, so
   * it can be shown again later) with each one's original colour texture.
   */
  materials: THREE.MeshStandardMaterial[];
  /** Each material's finish switch (0 = white as made, 1 = Midnight Black). */
  finishUniforms: Array<{ value: number }>;
  /** Whether the white / Midnight Black finish applies to this model. */
  finishes: boolean;
  /** Every control the controller has (no Mute on a DualShock 4). */
  parts: Partial<Record<MacroButton, PartNode>>;
  /** Touch dots on the touchpad (two, like the hardware). */
  touchDots: THREE.Mesh[];
  dispose: () => void;
}

/** A new geometry holding only some triangles of `g` (attributes copied, vertices re-indexed). */
function subGeometry(g: THREE.BufferGeometry, triangles: number[]): THREE.BufferGeometry {
  const index = g.getIndex();
  const at = (k: number) => (index ? index.getX(k) : k);
  const remap = new Map<number, number>();
  const order: number[] = [];
  const newIndex: number[] = [];
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const v = at(3 * t + k);
      let n = remap.get(v);
      if (n === undefined) { n = order.length; remap.set(v, n); order.push(v); }
      newIndex.push(n);
    }
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes) as Array<[string, THREE.BufferAttribute]>) {
    const size = attr.itemSize;
    const arr = new (attr.array.constructor as Float32ArrayConstructor)(order.length * size);
    order.forEach((v, i) => { for (let c = 0; c < size; c++) arr[i * size + c] = attr.array[v * size + c]!; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized));
  }
  out.setIndex(newIndex);
  return out;
}

// Mark colours follow the app palette (styles/tokens.css): pressed = accent blue,
// selected = cyan, Mapping's selection = bright accent.
const GOLD = new THREE.Color("#4c8dff");
const TEAL = new THREE.Color("#5fd3e2");
/** NEXUS accent (--gold-bright): selection in the Mapping workspace. */
const ACCENT = new THREE.Color("#7aaeff");
const MUTE_ORANGE = new THREE.Color("#ff8a3c");
const BLACK = new THREE.Color(0, 0, 0);
/** Base colour: the textures carry the colour, so materials stay white. */
const WHITE = new THREE.Color(1, 1, 1);

/** The default camera position in model units: connector anchors are the points of each control seen from here. */
const DEFAULT_EYE: V3 = (() => {
  const o = orbitToOffset(VIEWS.default);
  return [0, 1, 2].map((k) => (CAMERA_TARGET[k]! + o[k]!) / MODEL_SCALE) as V3;
})();

/** A geometry's triangles as a flat list of corner coordinates. */
function triangleList(g: THREE.BufferGeometry): Float32Array {
  const pos = g.getAttribute("position");
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const v = idx ? idx.getX(k) : k;
    out[3 * k] = pos.getX(v); out[3 * k + 1] = pos.getY(v); out[3 * k + 2] = pos.getZ(v);
  }
  return out;
}

/** Splits the model's meshes into the fixed shell and one object per control. */
export function buildModel(gltf: GLTF, spec: ModelSpec): BuiltModel {
  const root = new THREE.Group();
  root.scale.setScalar(MODEL_SCALE);
  const created: Array<THREE.BufferGeometry | THREE.Material> = [];
  const pieces = new Map<MacroButton, Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }>>();
  const materials: THREE.MeshStandardMaterial[] = [];
  const finishUniforms: Array<{ value: number }> = [];
  const own = (m: THREE.MeshStandardMaterial) => { materials.push(m); finishUniforms.push(installFinish(m)); created.push(m); };

  const meshes: THREE.Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // Models stored in other units are moved into the shared frame on a copy of
  // each geometry (the loaded model stays as in the file).
  const toFrame = spec.normalise
    ? new THREE.Matrix4()
      .makeScale(spec.normalise.scale, spec.normalise.scale, spec.normalise.scale)
      .multiply(new THREE.Matrix4().makeTranslation(-spec.normalise.centre[0], -spec.normalise.centre[1], -spec.normalise.centre[2]))
    : null;
  for (const mesh of meshes) {
    let g = mesh.geometry as THREE.BufferGeometry;
    let framed: THREE.BufferGeometry | null = null;
    if (toFrame) {
      framed = g.clone();
      framed.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld));
      g = framed;
    }
    // A copy: the loaded (cached) model stays exactly as in the file.
    const source = mesh.material as THREE.MeshStandardMaterial;
    const material = source.clone();
    // The file marks two materials as see-through, but only the face-button
    // and D-pad caps really are (handled below); everything else is drawn
    // opaque, which avoids sorting artefacts.
    material.transparent = false;
    material.depthWrite = true;
    own(material);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const index = g.getIndex();
    const islands = findIslands(pos.array as ArrayLike<number>, index ? (index.array as ArrayLike<number>) : null);
    const fixed: number[] = [];
    const byButton = new Map<MacroButton, Island[]>();
    for (const isl of islands) {
      const b = classifyIn(spec.parts, material.name, isl);
      if (b) byButton.set(b, [...(byButton.get(b) ?? []), isl]);
      else fixed.push(...isl.triangles);
    }
    if (fixed.length) {
      const sg = subGeometry(g, fixed);
      created.push(sg);
      const shell = new THREE.Mesh(sg, material);
      shell.castShadow = true;
      shell.receiveShadow = true;
      root.add(shell);
    }
    for (const [b, isls] of byButton) {
      // Face buttons and D-pad arms: a clear cap over a solid inner piece that
      // carries the colour and the printed symbol. The cap stays see-through.
      const cap = spec.parts[b]!.clearCap ? isls.reduce((a, c) => (c.max[2] > a.max[2] ? c : a)) : null;
      const groups = cap ? [isls.filter((i) => i !== cap), [cap]] : [isls];
      for (const group of groups) {
        const pg = subGeometry(g, group.flatMap((i) => i.triangles));
        created.push(pg);
        // Own material per control so each can glow on its own (textures stay shared).
        const m = material.clone();
        if (group.includes(cap!)) {
          m.transparent = true;
          m.depthWrite = false;
        }
        own(m);
        pieces.set(b, [...(pieces.get(b) ?? []), { geometry: pg, material: m }]);
      }
    }
    framed?.dispose();
  }

  const parts: Partial<Record<MacroButton, PartNode>> = {};
  for (const b of Object.keys(spec.parts) as MacroButton[]) {
    const list = pieces.get(b);
    if (!list) throw new Error(`Controller model: ${b} not found`);
    const box = new THREE.Box3();
    for (const p of list) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    const min = box.min.toArray() as V3;
    const max = box.max.toArray() as V3;
    const f = frameIn(spec, b, min, max);
    // Where the Mapping connectors end: a visible point of this control.
    const tris = list.length === 1 ? triangleList(list[0]!.geometry) : Float32Array.from(list.flatMap((p) => Array.from(triangleList(p.geometry))));
    const anchor = partAnchor(spec, b, min, max, tris, DEFAULT_EYE);
    const pivot = new THREE.Group();
    pivot.position.set(...f.pivot);
    const motion = new THREE.Group();
    pivot.add(motion);
    for (const p of list) {
      p.geometry.translate(-f.pivot[0], -f.pivot[1], -f.pivot[2]);
      const mesh = new THREE.Mesh(p.geometry, p.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.button = b;
      motion.add(mesh);
    }
    root.add(pivot);
    const s = (v: V3): V3 => [v[0] * MODEL_SCALE, v[1] * MODEL_SCALE, v[2] * MODEL_SCALE];
    parts[b] = {
      button: b, kind: spec.parts[b]!.motion, pivot, motion, materials: list.map((p) => p.material),
      frame: { pivot: s(f.pivot), anchor: s(anchor), normal: f.normal }, min, max,
    };
  }

  // Touch points: small glowing discs that sit on the touchpad.
  const dotGeometry = new THREE.CircleGeometry(0.022, 24);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.92, toneMapped: false });
  created.push(dotGeometry, dotMaterial);
  const touchDots = [0, 1].map(() => {
    const m = new THREE.Mesh(dotGeometry, dotMaterial);
    m.visible = false;
    parts.touchpad!.motion.add(m);
    return m;
  });

  return {
    root, materials, finishUniforms, finishes: spec.finishes, parts, touchDots,
    dispose: () => { for (const c of created) c.dispose(); },
  };
}

/** Sets the controller's colour. */
export function applyFinish(model: BuiltModel, finish: Finish): void {
  // A model with its own colours (the DualShock 4) is shown as made.
  if (!model.finishes) return;
  for (const u of model.finishUniforms) u.value = finish === "black" ? 1 : 0;
  // Black plastic is a touch glossier than the white's matte finish.
  for (const m of model.materials) m.roughness = finish === "black" ? 0.85 : 1;
}

/** Colour multipliers so a lit or selected control reads clearly on white or black plastic. */
const GOLD_TINT = new THREE.Color(0.55, 0.72, 1);
const TEAL_TINT = new THREE.Color(0.6, 0.92, 0.98);

/** Applies one input state (plus selection and hover) to the model. */
export function applyVisual(
  model: BuiltModel, vis: Visual3D, selected: MacroButton | null, hovered: MacroButton | null, accent = false,
): void {
  const pick = accent ? ACCENT : TEAL;
  for (const node of Object.values(model.parts) as PartNode[]) {
    const b = node.button;
    const lit = vis.lit[b];
    let colour = BLACK, intensity = 0;
    if (b === "leftTrigger" || b === "rightTrigger") {
      const v = b === "leftTrigger" ? vis.l2 : vis.r2;
      if (v > 0.004) { colour = GOLD; intensity = 0.12 + v * 0.45; }
    } else if (lit) {
      colour = b === "mute" ? MUTE_ORANGE : GOLD;
      intensity = b === "home" || b === "mute" ? 0.9 : b === "touchpad" ? 0.18 : 0.35;
    }
    if (intensity === 0 && selected === b) { colour = pick; intensity = accent ? 0.42 : 0.32; }
    else if (intensity === 0 && hovered === b) { colour = pick; intensity = 0.16; }
    const tint = intensity === 0 ? null : colour === TEAL ? TEAL_TINT : GOLD_TINT;
    for (const m of node.materials) {
      m.emissive.copy(colour);
      m.emissiveIntensity = intensity;
      m.color.copy(WHITE);
      if (tint && colour !== MUTE_ORANGE) m.color.multiply(tint);
    }

    // Motion
    const motion = node.kind;
    node.motion.position.set(0, 0, 0);
    node.pivot.rotation.set(0, 0, 0);
    if (motion === "press" && lit) node.motion.position.z = -PRESS_DEPTH * (b === "touchpad" ? 0.5 : 1);
    if (motion === "bumper" && lit) node.motion.position.y = -PRESS_DEPTH;
    if (motion === "stick") {
      const pose = b === "leftStick" ? vis.leftStick : vis.rightStick;
      node.pivot.rotation.set(pose.rotX, pose.rotY, 0);
      if (pose.pressed) node.motion.position.z = -PRESS_DEPTH * 1.5;
    }
    if (motion === "trigger") {
      const v = b === "leftTrigger" ? vis.l2 : vis.r2;
      // The blade hangs down and back from its hinge; pulling swings the tip
      // towards the player and up into the body.
      node.pivot.rotation.x = triggerAngle(v);
    }
  }

  // Touch points on the touchpad surface (u across, v down).
  const tp = model.parts.touchpad!;
  model.touchDots.forEach((dot, i) => {
    const t = vis.touches[i];
    dot.visible = Boolean(t);
    if (!t) return;
    const x = tp.min[0] + 0.03 + t.u * (tp.max[0] - tp.min[0] - 0.06);
    const y = tp.max[1] - 0.03 - t.v * (tp.max[1] - tp.min[1] - 0.06);
    const p = tp.frame.pivot.map((c) => c / MODEL_SCALE);
    dot.position.set(x - p[0]!, y - p[1]!, tp.max[2] + 0.004 - p[2]!);
  });
}
