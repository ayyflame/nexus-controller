// Turns the loaded DualSense model into a scene where every control is its
// own object (with its own pivot and material), and applies live input to it.
// The geometry, materials and textures are the model's own; NEXUS only splits
// the meshes by control (see lib/dualsenseModel.ts) and adds glow and motion.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { triggerAngle, type Visual3D } from "../../lib/controller3d";
import { MODEL_SCALE, PARTS, PRESS_DEPTH, classify, findIslands, frameOf, type PartFrame, type V3 } from "../../lib/dualsenseModel";
import type { MacroButton } from "../../types/engine";

export interface PartNode {
  button: MacroButton;
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
 * Base colours per model material (the textures carry the detail). "white"
 * is the model as made; "black" tints it to a Midnight Black DualSense.
 */
const FINISHES: Record<Finish, Record<string, string>> = {
  white: { "1001": "#ffffff", "1011": "#ffffff", "1002": "#ffffff" },
  black: { "1001": "#4a4c53", "1011": "#3c3e44", "1002": "#1d1e22" },
};

export interface BuiltModel {
  root: THREE.Group;
  /** Every material in the scene with its model material name (for the finish). */
  materials: THREE.MeshStandardMaterial[];
  parts: Record<MacroButton, PartNode>;
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

const GOLD = new THREE.Color("#d6a54b");
const TEAL = new THREE.Color("#4fa8b8");
const MUTE_ORANGE = new THREE.Color("#ff8a3c");
const BLACK = new THREE.Color(0, 0, 0);

/** Splits the model's meshes into the fixed shell and one object per control. */
export function buildModel(gltf: GLTF): BuiltModel {
  const root = new THREE.Group();
  root.scale.setScalar(MODEL_SCALE);
  const created: Array<THREE.BufferGeometry | THREE.Material> = [];
  const pieces = new Map<MacroButton, Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }>>();
  const materials: THREE.MeshStandardMaterial[] = [];

  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const material = mesh.material as THREE.MeshStandardMaterial;
    // The file marks two materials as see-through although they are solid
    // plastic; drawing them opaque avoids sorting artefacts.
    material.transparent = false;
    material.depthWrite = true;
    material.userData.base = material.color.clone();
    if (!materials.includes(material)) materials.push(material);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const index = g.getIndex();
    const islands = findIslands(pos.array as ArrayLike<number>, index ? (index.array as ArrayLike<number>) : null);
    const fixed: number[] = [];
    const byButton = new Map<MacroButton, number[]>();
    for (const isl of islands) {
      const b = classify(material.name, isl);
      if (b) byButton.set(b, [...(byButton.get(b) ?? []), ...isl.triangles]);
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
    for (const [b, tris] of byButton) {
      const pg = subGeometry(g, tris);
      created.push(pg);
      // Own material per control so each can glow on its own (textures stay shared).
      const m = material.clone();
      m.userData.base = material.color.clone();
      materials.push(m);
      created.push(m);
      pieces.set(b, [...(pieces.get(b) ?? []), { geometry: pg, material: m }]);
    }
  }

  const parts = {} as Record<MacroButton, PartNode>;
  for (const b of Object.keys(PARTS) as MacroButton[]) {
    const list = pieces.get(b);
    if (!list) throw new Error(`Controller model: ${b} not found`);
    const box = new THREE.Box3();
    for (const p of list) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    const min = box.min.toArray() as V3;
    const max = box.max.toArray() as V3;
    const f = frameOf(b, min, max);
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
      button: b, pivot, motion, materials: list.map((p) => p.material),
      frame: { pivot: s(f.pivot), anchor: s(f.anchor), normal: f.normal }, min, max,
    };
  }

  // Touch points: small glowing discs that sit on the touchpad.
  const dotGeometry = new THREE.CircleGeometry(0.022, 24);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.92, toneMapped: false });
  created.push(dotGeometry, dotMaterial);
  const touchDots = [0, 1].map(() => {
    const m = new THREE.Mesh(dotGeometry, dotMaterial);
    m.visible = false;
    parts.touchpad.motion.add(m);
    return m;
  });

  return {
    root, materials, parts, touchDots,
    dispose: () => { for (const c of created) c.dispose(); },
  };
}

/** Sets the controller's colour. */
export function applyFinish(model: BuiltModel, finish: Finish): void {
  for (const m of model.materials) {
    const base = (m.userData.base as THREE.Color);
    base.set(FINISHES[finish][m.name] ?? "#ffffff");
    m.color.copy(base);
  }
}

/** Colour multipliers so a lit or selected control reads clearly on white or black plastic. */
const GOLD_TINT = new THREE.Color(1, 0.74, 0.36);
const TEAL_TINT = new THREE.Color(0.62, 0.9, 0.96);

/** Applies one input state (plus selection and hover) to the model. */
export function applyVisual(model: BuiltModel, vis: Visual3D, selected: MacroButton | null, hovered: MacroButton | null): void {
  for (const node of Object.values(model.parts)) {
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
    if (intensity === 0 && selected === b) { colour = TEAL; intensity = 0.32; }
    else if (intensity === 0 && hovered === b) { colour = TEAL; intensity = 0.16; }
    const tint = intensity === 0 ? null : colour === TEAL ? TEAL_TINT : GOLD_TINT;
    for (const m of node.materials) {
      m.emissive.copy(colour);
      m.emissiveIntensity = intensity;
      m.color.copy(m.userData.base as THREE.Color);
      if (tint && colour !== MUTE_ORANGE) m.color.multiply(tint);
    }

    // Motion
    const motion = PARTS[b].motion;
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
  const tp = model.parts.touchpad;
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
