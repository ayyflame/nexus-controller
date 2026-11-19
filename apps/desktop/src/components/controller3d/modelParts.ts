// Turns the loaded DualSense model into a scene where every control and every
// shell zone is its own object with its own material, applies a skin
// (Controller Studio) and applies live input. The geometry and textures are
// the model's own; NEXUS splits the meshes (lib/dualsenseModel.ts), adds
// physical materials, a styling stage in the shader, glow and motion.
// Skins only change materials; live input only changes transforms and glow.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { triggerAngle, type Visual3D } from "../../lib/controller3d";
import {
  BLACK_FINISH_GLSL, FINISH_BANDS, GRIP, MODEL_SCALE, PARTS, PRESS_DEPTH, classify, findIslands, frameOf, isStickBase, shellZoneOf,
  type Island, type PartFrame, type V3,
} from "../../lib/dualsenseModel";
import { TILE, tilePixels, type TileId } from "../../lib/patterns";
import { FINISHES, lightness, styleOf, type ComponentId, type Decal, type Skin } from "../../lib/skin";
import type { MacroButton } from "../../types/engine";

export interface PartNode {
  button: MacroButton;
  /** Positioned at the pivot; sticks and triggers rotate this. */
  pivot: THREE.Group;
  /** Inside the pivot; presses move this. */
  motion: THREE.Group;
  materials: THREE.MeshPhysicalMaterial[];
  /** Pivot / anchor / facing in scene units. */
  frame: PartFrame;
  min: V3;
  max: V3;
}

/** One drawable piece: a mesh, its own material and styling uniforms. */
interface Piece {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  component: ComponentId;
  u: SkinUniforms;
  /** The clear cap over a face button or D-pad arm: keeps its see-through look. */
  clearCap: boolean;
  /** The model's own maps and values, restored for the "As modelled" finish. */
  original: { roughnessMap: THREE.Texture | null; metalnessMap: THREE.Texture | null; metalness: number };
}

export interface BuiltModel {
  root: THREE.Group;
  pieces: Piece[];
  /** Model-space bounds of each component (for gradients and decal placement). */
  bounds: Map<ComponentId, THREE.Box3>;
  parts: Record<MacroButton, PartNode>;
  /** Touch dots on the touchpad (two, like the hardware). */
  touchDots: THREE.Mesh[];
  /** Decal textures by image, loaded on demand. */
  decalTextures: Map<string, THREE.Texture>;
  lightBar: THREE.Color;
  dispose: () => void;
}

// ---- The styling stage in the shader ------------------------------------------

interface SkinUniforms {
  [name: string]: { value: unknown };
  nexusMode: { value: number };
  nexusColor: { value: THREE.Color };
  nexusPrint: { value: THREE.Color };
  nexusGradOn: { value: number };
  nexusColor2: { value: THREE.Color };
  nexusGradDir: { value: THREE.Vector2 };
  nexusGradRange: { value: THREE.Vector2 };
  nexusPatternOn: { value: number };
  nexusPatternMap: { value: THREE.Texture };
  nexusPatternColor: { value: THREE.Color };
  nexusPatternScale: { value: number };
  nexusPatternOpacity: { value: number };
  nexusFinishOn: { value: number };
  nexusFinishMap: { value: THREE.Texture };
  nexusFinishScale: { value: number };
  nexusFinishStrength: { value: number };
  nexusDecalOn: { value: number };
  nexusDecalMap: { value: THREE.Texture };
  nexusDecalCenter: { value: THREE.Vector2 };
  nexusDecalAxisX: { value: THREE.Vector2 };
  nexusDecalAxisY: { value: THREE.Vector2 };
  nexusDecalSide: { value: number };
  nexusDecalOpacity: { value: number };
  nexusOffset: { value: THREE.Vector3 };
  /** Shell pieces: 0 = one style; 1 = this zone is the white plastic, 2 = it is the dark core. */
  nexusSplit: { value: number };
  nexusOtherMode: { value: number };
  nexusOtherColor: { value: THREE.Color };
  nexusOtherPrint: { value: THREE.Color };
  /** Shell pieces: pick front/rear vs grip style per pixel from its position (1 = on). */
  nexusGripSplit: { value: number };
  /** Which region this piece's own zone is: 0 = upper (front or rear shell), 1 = left grip, 2 = right grip. */
  nexusMyRegion: { value: number };
  nexusRegionMode: { value: THREE.Vector3 };
  nexusRegionColor0: { value: THREE.Color };
  nexusRegionColor1: { value: THREE.Color };
  nexusRegionColor2: { value: THREE.Color };
  nexusRegionPrint0: { value: THREE.Color };
  nexusRegionPrint1: { value: THREE.Color };
  nexusRegionPrint2: { value: THREE.Color };
}

/**
 * Colour pipeline per pixel, after the model's colour texture is read:
 *  mode 0 = as painted, 1 = Midnight Black (repainted), 2 = a chosen colour
 *  (with the printed symbols kept in a contrasting shade, optionally a
 *  gradient), then a pattern, the finish's own texture, and a decal.
 * Patterns and finish textures are projected from three sides (triplanar) in
 * model space, so they flow across the parts instead of following the
 * model's texture layout.
 */
const SKIN_FRAGMENT = `
${BLACK_FINISH_GLSL}
uniform float nexusMode;
uniform vec3 nexusColor;
uniform vec3 nexusPrint;
uniform float nexusGradOn;
uniform vec3 nexusColor2;
uniform vec2 nexusGradDir;
uniform vec2 nexusGradRange;
uniform float nexusPatternOn;
uniform sampler2D nexusPatternMap;
uniform vec3 nexusPatternColor;
uniform float nexusPatternScale;
uniform float nexusPatternOpacity;
uniform float nexusFinishOn;
uniform sampler2D nexusFinishMap;
uniform float nexusFinishScale;
uniform float nexusFinishStrength;
uniform float nexusDecalOn;
uniform sampler2D nexusDecalMap;
uniform vec2 nexusDecalCenter;
uniform vec2 nexusDecalAxisX;
uniform vec2 nexusDecalAxisY;
uniform float nexusDecalSide;
uniform float nexusDecalOpacity;
uniform float nexusSplit;
uniform float nexusOtherMode;
uniform vec3 nexusOtherColor;
uniform vec3 nexusOtherPrint;
uniform float nexusGripSplit;
uniform float nexusMyRegion;
uniform vec3 nexusRegionMode;
uniform vec3 nexusRegionColor0;
uniform vec3 nexusRegionColor1;
uniform vec3 nexusRegionColor2;
uniform vec3 nexusRegionPrint0;
uniform vec3 nexusRegionPrint1;
uniform vec3 nexusRegionPrint2;
varying vec3 vNexusPos;
varying vec3 vNexusNormal;

float nexusTriplanar( sampler2D tex, float scale ) {
  vec3 w = pow( abs( normalize( vNexusNormal ) ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-5 );
  vec3 p = vNexusPos * scale;
  return texture2D( tex, p.yz ).r * w.x + texture2D( tex, p.xz ).r * w.y + texture2D( tex, p.xy ).r * w.z;
}

/** One style: as painted (0), Midnight Black (1) or a colour (2) keeping printed symbols in a contrasting shade. */
vec3 nexusPaint( vec3 tex, float mode, vec3 base, vec3 printColour, float print ) {
  if ( mode > 1.5 ) return mix( base, printColour, print );
  if ( mode > 0.5 ) return nexusBlackFinish( tex );
  return tex;
}

vec3 nexusStyle( vec3 tex ) {
  vec3 s = pow( clamp( tex, 0.0, 1.0 ), vec3( 1.0 / 2.2 ) );
  float l = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
  float white = smoothstep( ${FINISH_BANDS.white[0].toFixed(4)}, ${FINISH_BANDS.white[1].toFixed(4)}, l );
  float print = smoothstep( ${FINISH_BANDS.print[0].toFixed(4)}, ${FINISH_BANDS.print[1].toFixed(4)}, l ) * ( 1.0 - white );
  vec3 base = nexusColor;
  if ( nexusGradOn > 0.5 ) {
    float t = clamp( ( dot( vNexusPos.xy, nexusGradDir ) - nexusGradRange.x ) / max( nexusGradRange.y - nexusGradRange.x, 1e-4 ), 0.0, 1.0 );
    base = mix( nexusColor, nexusColor2, t );
  }
  vec3 c = nexusPaint( tex, nexusMode, base, nexusPrint, print );
  // Shell: the grips start at a straight line, which runs through triangles;
  // each pixel takes the style of the region it is in (front/rear or a grip).
  float mine = 1.0;
  if ( nexusGripSplit > 0.5 ) {
    float g = step( vNexusPos.y, ${GRIP.y.toFixed(4)} ) * step( ${GRIP.x.toFixed(4)}, abs( vNexusPos.x ) );
    float region = g > 0.5 ? ( vNexusPos.x < 0.0 ? 1.0 : 2.0 ) : 0.0;
    if ( abs( region - nexusMyRegion ) > 0.5 ) {
      mine = 0.0;
      float m = region < 0.5 ? nexusRegionMode.x : region < 1.5 ? nexusRegionMode.y : nexusRegionMode.z;
      vec3 col = region < 0.5 ? nexusRegionColor0 : region < 1.5 ? nexusRegionColor1 : nexusRegionColor2;
      vec3 pr = region < 0.5 ? nexusRegionPrint0 : region < 1.5 ? nexusRegionPrint1 : nexusRegionPrint2;
      c = nexusPaint( tex, m, col, pr, print );
    }
  }
  // Shell: the boundary between white plastic and the dark core runs through
  // triangles, so each pixel takes the style of the region it is painted as.
  float own = 1.0;
  if ( nexusSplit > 0.5 ) {
    own = nexusSplit < 1.5 ? clamp( white + print, 0.0, 1.0 ) : 1.0 - white;
    c = mix( nexusPaint( tex, nexusOtherMode, nexusOtherColor, nexusOtherPrint, print ), c, own );
  }
  if ( nexusPatternOn > 0.5 ) {
    c = mix( c, nexusPatternColor, clamp( nexusTriplanar( nexusPatternMap, nexusPatternScale ), 0.0, 1.0 ) * nexusPatternOpacity * own * mine );
  }
  if ( nexusFinishOn > 0.5 ) {
    c *= mix( 1.0, 0.45 + 1.1 * nexusTriplanar( nexusFinishMap, nexusFinishScale ), nexusFinishStrength );
  }
  if ( nexusDecalOn > 0.5 && mine > 0.5 && normalize( vNexusNormal ).z * nexusDecalSide > 0.15 ) {
    vec2 d = vNexusPos.xy - nexusDecalCenter;
    vec2 uv = vec2( dot( d, nexusDecalAxisX ), dot( d, nexusDecalAxisY ) ) + 0.5;
    if ( uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 ) {
      vec4 dc = texture2D( nexusDecalMap, uv );
      c = mix( c, dc.rgb, dc.a * nexusDecalOpacity );
    }
  }
  return c;
}
`;

/** A 1×1 white texture for samplers that are switched off. */
const BLANK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

const tileTextures = new Map<TileId, THREE.DataTexture>();
/** Shared, generated tiles (patterns and finish textures). */
function tileTexture(id: TileId): THREE.DataTexture {
  let t = tileTextures.get(id);
  if (!t) {
    t = new THREE.DataTexture(tilePixels(id), TILE, TILE, THREE.RedFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    tileTextures.set(id, t);
  }
  return t;
}

function skinUniforms(offset: THREE.Vector3): SkinUniforms {
  return {
    nexusMode: { value: 0 }, nexusColor: { value: new THREE.Color(1, 1, 1) }, nexusPrint: { value: new THREE.Color(0.7, 0.7, 0.72) },
    nexusGradOn: { value: 0 }, nexusColor2: { value: new THREE.Color() }, nexusGradDir: { value: new THREE.Vector2(0, 1) },
    nexusGradRange: { value: new THREE.Vector2(0, 1) },
    nexusPatternOn: { value: 0 }, nexusPatternMap: { value: BLANK }, nexusPatternColor: { value: new THREE.Color() },
    nexusPatternScale: { value: 3 }, nexusPatternOpacity: { value: 0.6 },
    nexusFinishOn: { value: 0 }, nexusFinishMap: { value: BLANK }, nexusFinishScale: { value: 12 }, nexusFinishStrength: { value: 0 },
    nexusDecalOn: { value: 0 }, nexusDecalMap: { value: BLANK }, nexusDecalCenter: { value: new THREE.Vector2() },
    nexusDecalAxisX: { value: new THREE.Vector2(1, 0) }, nexusDecalAxisY: { value: new THREE.Vector2(0, 1) },
    nexusDecalSide: { value: 1 }, nexusDecalOpacity: { value: 1 },
    nexusOffset: { value: offset },
    nexusSplit: { value: 0 }, nexusOtherMode: { value: 0 }, nexusOtherColor: { value: new THREE.Color() },
    nexusOtherPrint: { value: new THREE.Color() },
    nexusGripSplit: { value: 0 }, nexusMyRegion: { value: 0 }, nexusRegionMode: { value: new THREE.Vector3() },
    nexusRegionColor0: { value: new THREE.Color() }, nexusRegionColor1: { value: new THREE.Color() }, nexusRegionColor2: { value: new THREE.Color() },
    nexusRegionPrint0: { value: new THREE.Color() }, nexusRegionPrint1: { value: new THREE.Color() }, nexusRegionPrint2: { value: new THREE.Color() },
  };
}

/** Adds the styling stage to a material's shader (uniforms switch it; no rebuild per change). */
function installSkin(m: THREE.MeshPhysicalMaterial, u: SkinUniforms): void {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec3 nexusOffset;\nvarying vec3 vNexusPos;\nvarying vec3 vNexusNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvNexusPos = position + nexusOffset;\nvNexusNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SKIN_FRAGMENT}`)
      .replace("#include <map_fragment>", `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
#else
  vec4 sampledDiffuseColor = vec4( 1.0 );
#endif
  sampledDiffuseColor.rgb = nexusStyle( sampledDiffuseColor.rgb );
  diffuseColor *= sampledDiffuseColor;`);
  };
  m.customProgramCacheKey = () => "nexus-skin";
}

/** A physical material copied from the model's (standard) material, so clearcoat, sheen and anisotropy are available. */
function physicalFrom(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(m, source);
  m.defines = { STANDARD: "", PHYSICAL: "" };
  return m;
}

/** Reads a texture's pixels once, to sort shell triangles by paint region. Null if the pixels can't be read. */
function texturePixels(t: THREE.Texture | null): { w: number; h: number; data: Uint8ClampedArray; flipY: boolean } | null {
  const img = t?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!t || !img || !img.width) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data, flipY: t.flipY };
  } catch {
    return null;
  }
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
const WHITE = new THREE.Color(1, 1, 1);

/** Splits the model's meshes into shell zones and one object per control. */
export function buildModel(gltf: GLTF): BuiltModel {
  const root = new THREE.Group();
  root.scale.setScalar(MODEL_SCALE);
  const created: Array<THREE.BufferGeometry | THREE.Material> = [];
  const pieces: Piece[] = [];
  const partPieces = new Map<MacroButton, Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshPhysicalMaterial; clearCap: boolean; original: Piece["original"] }>>();

  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    // Copies: the loaded (cached) model stays exactly as in the file.
    const source = mesh.material as THREE.MeshStandardMaterial;
    const original = { roughnessMap: source.roughnessMap, metalnessMap: source.metalnessMap, metalness: source.metalness };
    const fresh = () => {
      const m = physicalFrom(source);
      // The file marks two materials as see-through, but only the face-button
      // and D-pad caps really are (handled below).
      m.transparent = false;
      m.depthWrite = true;
      created.push(m);
      return m;
    };
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const index = g.getIndex();
    const at = (k: number) => (index ? index.getX(k) : k);
    const islands = findIslands(pos.array as ArrayLike<number>, index ? (index.array as ArrayLike<number>) : null);
    const byButton = new Map<MacroButton, Island[]>();
    const byZone = new Map<ComponentId, number[]>();
    const addZone = (z: ComponentId, tris: number[]) => byZone.set(z, [...(byZone.get(z) ?? []), ...tris]);

    // Paint regions come from the colour and glow textures (read once).
    const colour = texturePixels(source.map);
    const glow = source.name === "1011" ? texturePixels(source.emissiveMap) : null;
    const sample = (px: ReturnType<typeof texturePixels>, u: number, v: number): number => {
      if (!px) return -1;
      const x = Math.min(px.w - 1, Math.floor((((u % 1) + 1) % 1) * px.w));
      const vv = (((v % 1) + 1) % 1);
      const y = Math.min(px.h - 1, Math.floor((px.flipY ? 1 - vv : vv) * px.h));
      const o = (y * px.w + x) * 4;
      return (0.2126 * px.data[o]! + 0.7152 * px.data[o + 1]! + 0.0722 * px.data[o + 2]!) / 255;
    };

    for (const isl of islands) {
      const b = classify(source.name, isl);
      if (b) { byButton.set(b, [...(byButton.get(b) ?? []), isl]); continue; }
      if (isStickBase(source.name, isl)) { addZone("stickBases", isl.triangles); continue; }
      for (const t of isl.triangles) {
        const c: V3 = [0, 0, 0];
        let tu = 0, tv = 0;
        for (let k = 0; k < 3; k++) {
          const i = at(3 * t + k);
          c[0] += pos.getX(i) / 3; c[1] += pos.getY(i) / 3; c[2] += pos.getZ(i) / 3;
          if (uv) { tu += uv.getX(i) / 3; tv += uv.getY(i) / 3; }
        }
        // Without readable pixels everything of 1011 counts as front shell (still customisable).
        const l = source.name === "1002" ? 1 : colour ? sample(colour, tu, tv) : 1;
        const e = glow ? sample(glow, tu, tv) : 0;
        addZone(shellZoneOf(source.name, c, l, e), [t]);
      }
    }

    for (const [zone, tris] of byZone) {
      const sg = subGeometry(g, tris);
      created.push(sg);
      const m = fresh();
      const u = skinUniforms(new THREE.Vector3());
      installSkin(m, u);
      if (zone !== "lightBar") m.emissiveIntensity = 0;
      const shell = new THREE.Mesh(sg, m);
      shell.castShadow = true;
      shell.receiveShadow = true;
      shell.userData.component = zone;
      root.add(shell);
      pieces.push({ mesh: shell, material: m, component: zone, u, clearCap: false, original });
    }
    for (const [b, isls] of byButton) {
      // Face buttons and D-pad arms: a clear cap over a solid inner piece that
      // carries the colour and the printed symbol. The cap stays see-through.
      const cap = PARTS[b].clearCap ? isls.reduce((a, c) => (c.max[2] > a.max[2] ? c : a)) : null;
      const groups = cap ? [isls.filter((i) => i !== cap), [cap]] : [isls];
      for (const group of groups) {
        const pg = subGeometry(g, group.flatMap((i) => i.triangles));
        created.push(pg);
        const m = fresh();
        const isCap = group.includes(cap!);
        if (isCap) { m.transparent = true; m.depthWrite = false; }
        partPieces.set(b, [...(partPieces.get(b) ?? []), { geometry: pg, material: m, clearCap: isCap, original }]);
      }
    }
  }

  const parts = {} as Record<MacroButton, PartNode>;
  for (const b of Object.keys(PARTS) as MacroButton[]) {
    const list = partPieces.get(b);
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
      // The styling stage works in model space: tell it where this piece's geometry came from.
      const u = skinUniforms(new THREE.Vector3(...f.pivot));
      installSkin(p.material, u);
      const mesh = new THREE.Mesh(p.geometry, p.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.button = b;
      mesh.userData.component = b;
      motion.add(mesh);
      pieces.push({ mesh, material: p.material, component: b, u, clearCap: p.clearCap, original: p.original });
    }
    root.add(pivot);
    const s = (v: V3): V3 => [v[0] * MODEL_SCALE, v[1] * MODEL_SCALE, v[2] * MODEL_SCALE];
    parts[b] = {
      button: b, pivot, motion, materials: list.map((p) => p.material),
      frame: { pivot: s(f.pivot), anchor: s(f.anchor), normal: f.normal }, min, max,
    };
  }

  // Model-space bounds of every component (parts: geometry was moved to its pivot, so add it back).
  const bounds = new Map<ComponentId, THREE.Box3>();
  for (const p of pieces) {
    p.mesh.geometry.computeBoundingBox();
    const box = p.mesh.geometry.boundingBox!.clone().translate(p.u.nexusOffset.value);
    bounds.set(p.component, (bounds.get(p.component) ?? new THREE.Box3()).union(box));
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

  const decalTextures = new Map<string, THREE.Texture>();
  return {
    root, pieces, bounds, parts, touchDots, decalTextures, lightBar: new THREE.Color("#4b6bff"),
    dispose: () => {
      for (const c of created) c.dispose();
      for (const t of decalTextures.values()) t.dispose();
    },
  };
}

// ---- Applying a skin -------------------------------------------------------------

/** Loads (once) the texture for a decal image; calls `ready` when it can be drawn. */
function decalTexture(model: BuiltModel, image: string, ready: () => void): THREE.Texture | null {
  const hit = model.decalTextures.get(image);
  if (hit) return hit.image ? hit : null;
  const t = new THREE.TextureLoader().load(image, () => ready());
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  model.decalTextures.set(image, t);
  return null;
}

/** Shader uniforms that place a decal on its component (front or, for the rear shell, back projection). */
function placeDecal(u: SkinUniforms, d: Decal, box: THREE.Box3, aspect: number): void {
  const size = box.getSize(new THREE.Vector3());
  const rear = d.component === "rearShell";
  const w = Math.max(1e-3, d.scale * size.x);
  const h = w / Math.max(0.05, aspect);
  // x/y are 0…1 across the part as you look at it (from behind for the rear shell).
  const cx = rear ? box.max.x - d.x * size.x : box.min.x + d.x * size.x;
  const cy = box.max.y - d.y * size.y;
  const a = (d.rotation * Math.PI) / 180;
  const dir = rear ? -1 : 1;
  u.nexusDecalCenter.value.set(cx, cy);
  u.nexusDecalAxisX.value.set((Math.cos(a) * dir) / w, Math.sin(a) / w);
  u.nexusDecalAxisY.value.set((-Math.sin(a) * dir) / h, Math.cos(a) / h);
  u.nexusDecalSide.value = rear ? -1 : 1;
  u.nexusDecalOpacity.value = d.opacity;
}

/**
 * Applies a skin to every piece. `ready` is called when something loaded later
 * (a decal image) so the view can redraw. Hidden components are not drawn.
 */
/** Shell zones that share one gradient across the whole controller. */
const SHELL_GRADIENT: ReadonlySet<ComponentId> = new Set<ComponentId>(["frontShell", "rearShell", "gripLeft", "gripRight", "centerTrim"]);
/** White-plastic zones of material 1011 that meet the dark core inside triangles. */
const WHITE_SIDE: ReadonlySet<ComponentId> = new Set<ComponentId>(["frontShell", "gripLeft", "gripRight"]);

export function applySkin(model: BuiltModel, skin: Skin, hidden: ReadonlySet<ComponentId>, ready: () => void): void {
  model.lightBar.set(skin.lightBar);
  const shellBox = new THREE.Box3();
  for (const z of SHELL_GRADIENT) { const b = model.bounds.get(z); if (b) shellBox.union(b); }
  const front = styleOf(skin, "frontShell");
  const trim = styleOf(skin, "centerTrim");
  const modeOf = (st: { color: string | null }) => (st.color !== null ? 2 : skin.base === "black" ? 1 : 0);
  for (const p of model.pieces) {
    const s = styleOf(skin, p.component);
    const m = p.material;
    const u = p.u;
    p.mesh.visible = !hidden.has(p.component);

    // Colour
    const solid = s.color !== null && !p.clearCap && p.component !== "lightBar";
    u.nexusMode.value = solid ? 2 : skin.base === "black" ? 1 : 0;
    if (solid) {
      u.nexusColor.value.set(s.color!);
      u.nexusPrint.value.set(lightness(s.color!) > 0.5 ? "#2a2b30" : "#c9cbd1");
      u.nexusGradOn.value = s.gradient ? 1 : 0;
      if (s.gradient) {
        u.nexusColor2.value.set(s.gradient.to);
        const a = (s.gradient.angle * Math.PI) / 180;
        const dir = u.nexusGradDir.value.set(Math.cos(a), -Math.sin(a));
        const box = SHELL_GRADIENT.has(p.component) ? shellBox : model.bounds.get(p.component)!;
        const proj = [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].map((y) => x * dir.x + y * dir.y));
        u.nexusGradRange.value.set(Math.min(...proj), Math.max(...proj));
      }
    } else u.nexusGradOn.value = 0;

    // Front/rear shell and grips meet along a straight line through triangles: per-pixel regions.
    const regionZones = ["frontShell", "rearShell", "gripLeft", "gripRight"] as const;
    if ((regionZones as readonly string[]).includes(p.component)) {
      const upper = p.material.name === "1002" ? "rearShell" : "frontShell";
      const zones: ComponentId[] = [upper, "gripLeft", "gripRight"];
      u.nexusGripSplit.value = 1;
      u.nexusMyRegion.value = p.component === "gripLeft" ? 1 : p.component === "gripRight" ? 2 : 0;
      const modes = zones.map((z) => modeOf(styleOf(skin, z)));
      u.nexusRegionMode.value.set(modes[0]!, modes[1]!, modes[2]!);
      zones.forEach((z, i) => {
        const c = styleOf(skin, z).color;
        if (!c) return;
        (u[`nexusRegionColor${i}`] as { value: THREE.Color }).value.set(c);
        (u[`nexusRegionPrint${i}`] as { value: THREE.Color }).value.set(lightness(c) > 0.5 ? "#2a2b30" : "#c9cbd1");
      });
    } else u.nexusGripSplit.value = 0;

    // Where white plastic meets the dark core inside a 1011 shell triangle, each side keeps its own colour.
    const isWhite = WHITE_SIDE.has(p.component) && p.material.name === "1011";
    const isTrim = p.component === "centerTrim";
    u.nexusSplit.value = isWhite ? 1 : isTrim ? 2 : 0;
    if (isWhite || isTrim) {
      const other = isWhite ? trim : front;
      u.nexusOtherMode.value = modeOf(other);
      if (other.color) {
        u.nexusOtherColor.value.set(other.color);
        u.nexusOtherPrint.value.set(lightness(other.color) > 0.5 ? "#2a2b30" : "#c9cbd1");
      }
    }

    // Pattern
    u.nexusPatternOn.value = s.pattern && !p.clearCap ? 1 : 0;
    if (s.pattern) {
      u.nexusPatternMap.value = tileTexture(s.pattern.id);
      u.nexusPatternColor.value.set(s.pattern.color);
      u.nexusPatternScale.value = 3 * s.pattern.scale;
      u.nexusPatternOpacity.value = s.pattern.opacity;
    }

    // Finish: real material settings, plus the finish's own surface texture.
    const f = FINISHES[s.finish];
    const original = s.finish === "original";
    const wantMaps = original;
    if ((m.roughnessMap !== null) !== (wantMaps && p.original.roughnessMap !== null)) m.needsUpdate = true;
    m.roughnessMap = wantMaps ? p.original.roughnessMap : null;
    m.metalnessMap = wantMaps ? p.original.metalnessMap : null;
    if (original) {
      m.roughness = skin.base === "black" ? 0.85 : 1;
      m.metalness = p.original.metalness;
      m.clearcoat = 0; m.sheen = 0; m.anisotropy = 0;
    } else {
      m.roughness = f.roughness;
      m.metalness = f.metalness;
      m.clearcoat = f.clearcoat;
      m.clearcoatRoughness = f.clearcoatRoughness;
      m.sheen = f.sheen;
      m.sheenColor.set(s.color ?? "#ffffff");
      m.sheenRoughness = 0.8;
      m.anisotropy = f.anisotropy;
    }
    if (p.clearCap) { m.clearcoat = Math.max(m.clearcoat, 0.6); m.clearcoatRoughness = 0.08; }
    const tex = f.texture && !p.clearCap ? f.texture : null;
    u.nexusFinishOn.value = tex ? 1 : 0;
    if (tex) {
      u.nexusFinishMap.value = tileTexture(tex);
      u.nexusFinishScale.value = tex === "carbon" ? 7 : tex === "rubber" ? 14 : 3;
      u.nexusFinishStrength.value = tex === "carbon" ? 0.9 : tex === "rubber" ? 0.35 : 0.45;
    }

    // Decal (one per component)
    const d = skin.decals.find((x) => x.component === p.component);
    const t = d ? decalTexture(model, d.image, ready) : null;
    u.nexusDecalOn.value = d && t && !p.clearCap ? 1 : 0;
    if (d && t) {
      const img = t.image as { width: number; height: number };
      placeDecal(u, d, model.bounds.get(p.component)!, img.width / Math.max(1, img.height));
      u.nexusDecalMap.value = t;
    }
  }
  // Forget images no longer used by this skin.
  for (const [img, t] of model.decalTextures) {
    if (!skin.decals.some((d) => d.image === img)) { t.dispose(); model.decalTextures.delete(img); }
  }
}

/** Colour multipliers so a lit or selected control reads clearly on any colour. */
const GOLD_TINT = new THREE.Color(1, 0.74, 0.36);
const TEAL_TINT = new THREE.Color(0.62, 0.9, 0.96);

/** Applies one input state (plus selection and hover) to the model. */
export function applyVisual(model: BuiltModel, vis: Visual3D, selected: MacroButton | null, hovered: MacroButton | null): void {
  // The light bar glows in the skin's colour while a controller is connected.
  for (const p of model.pieces) {
    if (p.component !== "lightBar") continue;
    p.material.emissive.copy(model.lightBar);
    p.material.emissiveIntensity = vis.connected ? 1.6 : 0.06;
  }
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
      m.color.copy(WHITE);
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
