// Controller Studio: the skin format, components, finishes, presets and the
// rules for editing, validating and migrating skins. Pure (no three.js, no
// storage), so it is unit-tested. A skin only changes how the 3D controller
// looks; it never touches input, mappings, macros or game output.

import type { MacroButton } from "../types/engine";

// ---- Components ------------------------------------------------------------

/** Parts of the shell (split from the model by its paint regions). */
export type ShellZone =
  | "frontShell" | "rearShell" | "gripLeft" | "gripRight" | "centerTrim" | "lightBar" | "stickBases";

/** Everything that can be styled: shell zones and every control. */
export type ComponentId = ShellZone | MacroButton;

export type ComponentGroup = "Shell" | "Buttons" | "D-pad" | "Shoulders" | "Sticks" | "Centre";

export interface ComponentInfo {
  id: ComponentId;
  label: string;
  group: ComponentGroup;
  /** Extra words for the search box. */
  keywords: string;
  /** A decal (uploaded graphic) can be placed on it. */
  decals?: boolean;
  /** Only a glow colour (the light bar). */
  lightOnly?: boolean;
}

export const COMPONENTS: ComponentInfo[] = [
  { id: "frontShell", label: "Front shell", group: "Shell", keywords: "face plate top body", decals: true },
  { id: "rearShell", label: "Rear shell", group: "Shell", keywords: "back housing underside", decals: true },
  { id: "gripLeft", label: "Left grip", group: "Shell", keywords: "handle", decals: true },
  { id: "gripRight", label: "Right grip", group: "Shell", keywords: "handle", decals: true },
  { id: "centerTrim", label: "Centre trim", group: "Shell", keywords: "core middle black panel" },
  { id: "touchpad", label: "Touchpad", group: "Shell", keywords: "pad", decals: true },
  { id: "lightBar", label: "Light bar", group: "Shell", keywords: "led glow rgb lighting", lightOnly: true },
  { id: "north", label: "Triangle", group: "Buttons", keywords: "face button y" },
  { id: "east", label: "Circle", group: "Buttons", keywords: "face button b" },
  { id: "south", label: "Cross", group: "Buttons", keywords: "face button x a" },
  { id: "west", label: "Square", group: "Buttons", keywords: "face button x" },
  { id: "dpadUp", label: "D-pad up", group: "D-pad", keywords: "arrow direction" },
  { id: "dpadRight", label: "D-pad right", group: "D-pad", keywords: "arrow direction" },
  { id: "dpadDown", label: "D-pad down", group: "D-pad", keywords: "arrow direction" },
  { id: "dpadLeft", label: "D-pad left", group: "D-pad", keywords: "arrow direction" },
  { id: "leftShoulder", label: "L1", group: "Shoulders", keywords: "bumper left shoulder lb" },
  { id: "rightShoulder", label: "R1", group: "Shoulders", keywords: "bumper right shoulder rb" },
  { id: "leftTrigger", label: "L2", group: "Shoulders", keywords: "trigger left lt" },
  { id: "rightTrigger", label: "R2", group: "Shoulders", keywords: "trigger right rt" },
  { id: "leftStick", label: "Left stick cap", group: "Sticks", keywords: "thumbstick analog l3" },
  { id: "rightStick", label: "Right stick cap", group: "Sticks", keywords: "thumbstick analog r3" },
  { id: "stickBases", label: "Stick bases", group: "Sticks", keywords: "ring collar thumbstick" },
  { id: "home", label: "PS button", group: "Centre", keywords: "home logo playstation" },
  { id: "select", label: "Create", group: "Centre", keywords: "share back" },
  { id: "start", label: "Options", group: "Centre", keywords: "menu start" },
  { id: "mute", label: "Mute", group: "Centre", keywords: "microphone mic" },
];

export const COMPONENT_IDS = COMPONENTS.map((c) => c.id);
export const componentInfo = (id: ComponentId): ComponentInfo => COMPONENTS.find((c) => c.id === id)!;

/** Search across labels, groups and keywords. */
export function searchComponents(query: string): ComponentInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return COMPONENTS;
  return COMPONENTS.filter((c) => {
    const hay = `${c.label} ${c.group} ${c.keywords}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---- Finishes, patterns, lighting -------------------------------------------

export type FinishId = "original" | "matte" | "satin" | "gloss" | "metallic" | "chrome" | "carbon" | "rubber" | "brushed";

/** Physical material settings per finish (three.js MeshPhysicalMaterial). */
export interface FinishParams {
  label: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  /** Brushed metal: stretched highlights. */
  anisotropy: number;
  /** A built-in surface texture (carbon weave, rubber grain, brushing). */
  texture: "carbon" | "rubber" | "brushed" | null;
}

export const FINISHES: Record<FinishId, FinishParams> = {
  original: { label: "As modelled", roughness: 1, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, sheen: 0, anisotropy: 0, texture: null },
  matte: { label: "Matte", roughness: 0.92, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, sheen: 0.15, anisotropy: 0, texture: null },
  satin: { label: "Satin", roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0, anisotropy: 0, texture: null },
  gloss: { label: "Gloss", roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0, anisotropy: 0, texture: null },
  metallic: { label: "Metallic", roughness: 0.32, metalness: 0.75, clearcoat: 0.7, clearcoatRoughness: 0.1, sheen: 0, anisotropy: 0, texture: null },
  chrome: { label: "Chrome", roughness: 0.05, metalness: 1, clearcoat: 0, clearcoatRoughness: 0, sheen: 0, anisotropy: 0, texture: null },
  carbon: { label: "Carbon fibre", roughness: 0.4, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0, anisotropy: 0, texture: "carbon" },
  rubber: { label: "Textured rubber", roughness: 1, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, sheen: 0.35, anisotropy: 0, texture: "rubber" },
  brushed: { label: "Brushed metal", roughness: 0.38, metalness: 0.92, clearcoat: 0, clearcoatRoughness: 0, sheen: 0, anisotropy: 0.75, texture: "brushed" },
};
export const FINISH_IDS = Object.keys(FINISHES) as FinishId[];

export type PatternId = "camo" | "hex" | "stripes" | "dots" | "digital" | "waves" | "checker" | "carbon";
export const PATTERNS: Record<PatternId, string> = {
  camo: "Camouflage", hex: "Hexagons", stripes: "Stripes", dots: "Dots", digital: "Digital camo",
  waves: "Waves", checker: "Checker", carbon: "Carbon weave",
};
export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export type LightingId = "studio" | "showroom" | "night" | "neon" | "sunset";
export const LIGHTING: Record<LightingId, string> = {
  studio: "Studio", showroom: "Showroom", night: "Night", neon: "Neon", sunset: "Sunset",
};
export const LIGHTING_IDS = Object.keys(LIGHTING) as LightingId[];

// ---- The skin format -------------------------------------------------------

export interface Gradient { to: string; angle: number }
export interface PatternStyle { id: PatternId; color: string; scale: number; opacity: number }

export interface ComponentStyle {
  /** Solid colour (#rrggbb); null keeps the colours the model was painted with. */
  color: string | null;
  finish: FinishId;
  /** Second colour blended across the part. */
  gradient: Gradient | null;
  pattern: PatternStyle | null;
}

export interface Decal {
  id: string;
  component: ComponentId;
  /** Validated, re-encoded PNG as a data URL. */
  image: string;
  /** Centre within the part's front (or back) outline, 0…1. */
  x: number;
  y: number;
  /** Width as a share of the part's width, 0.05…1.5. */
  scale: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
}

export const SKIN_FORMAT = "nexus-skin";
export const SKIN_VERSION = 1;

export interface Skin {
  format: typeof SKIN_FORMAT;
  version: typeof SKIN_VERSION;
  id: string;
  name: string;
  /** How parts without a colour look: the model's white, or Midnight Black. */
  base: "white" | "black";
  components: Partial<Record<ComponentId, ComponentStyle>>;
  lightBar: string;
  lighting: LightingId;
  decals: Decal[];
  createdAt: number;
  updatedAt: number;
  /** Small PNG preview (data URL), made when saved. */
  thumbnail?: string;
}

export const DEFAULT_LIGHT_BAR = "#4b6bff";

export const PLAIN: ComponentStyle = { color: null, finish: "original", gradient: null, pattern: null };

export function styleOf(skin: Skin, id: ComponentId): ComponentStyle {
  return skin.components[id] ?? PLAIN;
}

export function isPlain(s: ComponentStyle): boolean {
  return s.color === null && s.finish === "original" && !s.gradient && !s.pattern;
}

export function newSkin(name = "Custom", base: Skin["base"] = "black", now = Date.now()): Skin {
  return {
    format: SKIN_FORMAT, version: SKIN_VERSION, id: `skin-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name, base, components: {}, lightBar: DEFAULT_LIGHT_BAR, lighting: "studio", decals: [], createdAt: now, updatedAt: now,
  };
}

// ---- Editing (each returns a new skin) --------------------------------------

export function setStyle(skin: Skin, id: ComponentId, patch: Partial<ComponentStyle>): Skin {
  const next = { ...styleOf(skin, id), ...patch };
  const components = { ...skin.components };
  if (isPlain(next)) delete components[id]; else components[id] = next;
  return { ...skin, components };
}

export function resetComponent(skin: Skin, id: ComponentId): Skin {
  const components = { ...skin.components };
  delete components[id];
  const decals = skin.decals.filter((d) => d.component !== id);
  return { ...skin, components, decals, ...(id === "lightBar" ? { lightBar: DEFAULT_LIGHT_BAR } : {}) };
}

/** Back to the plain controller, keeping the skin's name and identity. */
export function resetAll(skin: Skin): Skin {
  return { ...skin, components: {}, decals: [], lightBar: DEFAULT_LIGHT_BAR, lighting: "studio" };
}

/** Copies one component's style onto others (decals are not copied). */
export function copyStyle(skin: Skin, from: ComponentId, to: ComponentId[]): Skin {
  const s = styleOf(skin, from);
  return to.reduce((acc, id) => (id === from || componentInfo(id).lightOnly ? acc : setStyle(acc, id, { ...s })), skin);
}

export function pasteStyle(skin: Skin, style: ComponentStyle, to: ComponentId[]): Skin {
  return to.reduce((acc, id) => (componentInfo(id).lightOnly ? acc : setStyle(acc, id, { ...style })), skin);
}

// ---- Colours ---------------------------------------------------------------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc", "abc", "#AABBCC" → "#aabbcc"; anything else → null. */
export function normalizeHex(v: string): string | null {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, Number.isFinite(v) ? v : 0))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Perceived lightness 0…1 (for choosing printed-symbol contrast). */
export function lightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Most recent first, no duplicates, at most `max`. */
export function pushRecent(list: string[], hex: string, max = 12): string[] {
  const h = normalizeHex(hex);
  if (!h) return list;
  return [h, ...list.filter((x) => x !== h)].slice(0, max);
}

export const QUICK_PALETTES: Array<{ name: string; colors: string[] }> = [
  { name: "Neutrals", colors: ["#0d0e10", "#1b1c21", "#3a3c42", "#8b8f98", "#d9dbe0", "#f4f4f6"] },
  { name: "NEXUS", colors: ["#d4a94f", "#f0cb72", "#a57d2c", "#4fa8b8", "#62c483", "#e26a6a"] },
  { name: "Neon", colors: ["#ff2bd6", "#00f0ff", "#39ff14", "#fffb00", "#ff6a00", "#7b2bff"] },
  { name: "Metals", colors: ["#c0c3c8", "#9aa0a8", "#b08d57", "#d4af37", "#b87333", "#5a5f66"] },
  { name: "Deep", colors: ["#7a0c14", "#0b2a6b", "#123d2a", "#3d1660", "#5b2a00", "#20262e"] },
];

// ---- Presets ----------------------------------------------------------------

type PresetSpec = Omit<Skin, "format" | "version" | "id" | "createdAt" | "updatedAt" | "decals" | "thumbnail">;
const st = (color: string | null, finish: FinishId = "original", extra: Partial<ComponentStyle> = {}): ComponentStyle =>
  ({ color, finish, gradient: null, pattern: null, ...extra });
const each = (ids: ComponentId[], s: ComponentStyle) => Object.fromEntries(ids.map((id) => [id, s])) as Partial<Record<ComponentId, ComponentStyle>>;
const FACE: ComponentId[] = ["north", "east", "south", "west"];
const DPAD: ComponentId[] = ["dpadUp", "dpadRight", "dpadDown", "dpadLeft"];
const SHOULDERS: ComponentId[] = ["leftShoulder", "rightShoulder", "leftTrigger", "rightTrigger"];
const STICKS: ComponentId[] = ["leftStick", "rightStick"];
const SHELL: ComponentId[] = ["frontShell", "rearShell", "gripLeft", "gripRight"];

export const PRESETS: Array<{ id: string; spec: PresetSpec }> = [
  { id: "preset-midnight", spec: { name: "Midnight Black", base: "black", components: {}, lightBar: DEFAULT_LIGHT_BAR, lighting: "studio" } },
  { id: "preset-arctic", spec: { name: "Arctic White", base: "white", components: {}, lightBar: DEFAULT_LIGHT_BAR, lighting: "showroom" } },
  {
    id: "preset-cyberpunk", spec: {
      name: "Cyberpunk", base: "black", lightBar: "#00f0ff", lighting: "neon",
      components: {
        ...each(SHELL, st("#fcee0a", "gloss")), centerTrim: st("#111216", "matte"), touchpad: st("#111216", "satin"),
        ...each(FACE, st("#00f0ff", "gloss")), ...each(DPAD, st("#1b1c21", "gloss")), ...each(SHOULDERS, st("#ff2bd6", "metallic")),
        ...each(STICKS, st("#111216", "rubber")), stickBases: st("#ff2bd6", "metallic"),
      },
    },
  },
  {
    id: "preset-neon", spec: {
      name: "Neon RGB", base: "black", lightBar: "#ff2bd6", lighting: "neon",
      components: {
        ...each(SHELL, st("#0d0e10", "gloss", { gradient: { to: "#1b0b33", angle: 90 } })),
        north: st("#39ff14", "gloss"), east: st("#ff2bd6", "gloss"), south: st("#00f0ff", "gloss"), west: st("#fffb00", "gloss"),
        ...each(DPAD, st("#7b2bff", "gloss")), ...each(SHOULDERS, st("#00f0ff", "gloss")), stickBases: st("#ff2bd6", "gloss"),
      },
    },
  },
  {
    id: "preset-carbon", spec: {
      name: "Carbon Fiber", base: "black", lightBar: "#d4a94f", lighting: "studio",
      components: {
        ...each(SHELL, st("#2a2c31", "carbon")), centerTrim: st("#15161a", "satin"),
        ...each(SHOULDERS, st("#2a2c31", "carbon")), stickBases: st("#9aa0a8", "brushed"), home: st("#9aa0a8", "brushed"),
      },
    },
  },
  {
    id: "preset-stealth", spec: {
      name: "Stealth", base: "black", lightBar: "#2b2f3a", lighting: "night",
      components: {
        ...each(SHELL, st("#121316", "matte")), centerTrim: st("#0b0c0e", "matte"), touchpad: st("#121316", "matte"),
        ...each([...FACE, ...DPAD, ...SHOULDERS], st("#16171b", "matte")), ...each(STICKS, st("#121316", "rubber")),
      },
    },
  },
  {
    id: "preset-blood", spec: {
      name: "Blood Red", base: "black", lightBar: "#ff1a2b", lighting: "studio",
      components: {
        ...each(SHELL, st("#7a0c14", "gloss")), centerTrim: st("#120708", "satin"),
        ...each(FACE, st("#1b0a0c", "gloss")), ...each(SHOULDERS, st("#b5121f", "metallic")), stickBases: st("#b5121f", "metallic"),
      },
    },
  },
  {
    id: "preset-purple", spec: {
      name: "Purple Haze", base: "black", lightBar: "#b46bff", lighting: "sunset",
      components: {
        ...each(SHELL, st("#3d1660", "satin", { gradient: { to: "#b46bff", angle: 135 } })), centerTrim: st("#1a0b2a", "satin"),
        ...each(FACE, st("#e6d4ff", "gloss")), ...each(SHOULDERS, st("#7b2bff", "metallic")),
      },
    },
  },
  {
    id: "preset-titanium", spec: {
      name: "Titanium", base: "black", lightBar: "#c0c3c8", lighting: "showroom",
      components: {
        ...each(SHELL, st("#9aa0a8", "brushed")), centerTrim: st("#2a2c31", "metallic"), touchpad: st("#5a5f66", "satin"),
        ...each([...FACE, ...DPAD], st("#c0c3c8", "chrome")), ...each(SHOULDERS, st("#5a5f66", "brushed")), stickBases: st("#c0c3c8", "chrome"),
      },
    },
  },
  { id: "preset-custom", spec: { name: "Custom", base: "white", components: {}, lightBar: DEFAULT_LIGHT_BAR, lighting: "studio" } },
];

/** A preset as a full skin (stable id, so it can be the active skin). */
export function presetSkin(id: string): Skin | null {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return null;
  return { format: SKIN_FORMAT, version: SKIN_VERSION, id: p.id, decals: [], createdAt: 0, updatedAt: 0, ...structuredClone(p.spec) };
}

export const isPreset = (id: string) => id.startsWith("preset-");

// ---- Random skins -------------------------------------------------------------

/** Small deterministic RNG (mulberry32) so a seed always gives the same skin. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** A random but coherent skin: a main colour, an accent from a colour scheme, and matching finishes. */
export function randomSkin(base: Skin, seed: number): Skin {
  const r = rng(seed);
  const hue = r() * 360;
  const scheme = [180, 150, 210, 30, 120][Math.floor(r() * 5)]!;
  const main = hsl(hue, 0.45 + r() * 0.4, 0.18 + r() * 0.5);
  const accent = hsl((hue + scheme) % 360, 0.7 + r() * 0.3, 0.45 + r() * 0.2);
  const dark = hsl(hue, 0.15, 0.08 + r() * 0.06);
  const shellFinish = (["gloss", "satin", "matte", "metallic", "carbon"] as FinishId[])[Math.floor(r() * 5)]!;
  const buttonFinish = (["gloss", "satin", "chrome", "metallic"] as FinishId[])[Math.floor(r() * 4)]!;
  const gradient = r() < 0.35 ? { to: hsl((hue + 30) % 360, 0.6, 0.35), angle: Math.round(r() * 180) } : null;
  const pattern = r() < 0.25 ? { id: PATTERN_IDS[Math.floor(r() * PATTERN_IDS.length)]!, color: dark, scale: 1, opacity: 0.5 } : null;
  return {
    ...base,
    components: {
      ...each(["frontShell", "gripLeft", "gripRight"], st(main, shellFinish, { gradient, pattern })),
      rearShell: st(main, shellFinish), centerTrim: st(dark, "satin"), touchpad: st(dark, "satin"),
      ...each(FACE, st(r() < 0.5 ? accent : dark, buttonFinish)), ...each(DPAD, st(dark, buttonFinish)),
      ...each(SHOULDERS, st(accent, buttonFinish)), ...each(STICKS, st(dark, "rubber")), stickBases: st(accent, "metallic"),
    },
    lightBar: accent,
  };
}

// ---- Validation, import/export, migration ----------------------------------------

export const LIMITS = {
  nameLength: 40,
  decals: 8,
  /** Re-encoded decal image, as data URL characters. */
  decalChars: 1_500_000,
  /** Whole exported file. */
  fileBytes: 12_000_000,
};

const clampNum = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : d);
const hexOr = (v: unknown, d: string | null) => (typeof v === "string" ? normalizeHex(v) ?? d : d);

/** Only PNG/JPEG/WebP data URLs are accepted as decal images (no SVG or other active content). */
export function isSafeImageDataUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= LIMITS.decalChars && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v);
}

function cleanStyle(v: unknown): ComponentStyle | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const g = o.gradient as Record<string, unknown> | null | undefined;
  const p = o.pattern as Record<string, unknown> | null | undefined;
  const style: ComponentStyle = {
    color: hexOr(o.color, null),
    finish: oneOf(o.finish, FINISH_IDS, "original"),
    gradient: g && typeof g === "object" && hexOr(g.to, null) ? { to: hexOr(g.to, "#000000")!, angle: clampNum(g.angle, 0, 360, 90) } : null,
    pattern: p && typeof p === "object" && oneOf(p.id, PATTERN_IDS, "camo") === p.id
      ? { id: p.id as PatternId, color: hexOr(p.color, "#000000")!, scale: clampNum(p.scale, 0.25, 4, 1), opacity: clampNum(p.opacity, 0, 1, 0.6) }
      : null,
  };
  return isPlain(style) ? null : style;
}

/**
 * Turns anything (an imported file, a stored record, an older version) into a
 * valid current skin, or explains why it can't. Unknown fields are dropped,
 * numbers are limited to their ranges, and unsafe images are removed.
 */
export function migrateSkin(raw: unknown, now = Date.now()): { ok: true; skin: Skin; warnings: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "This isn't a NEXUS skin file." };
  const o = raw as Record<string, unknown>;
  if (o.format !== SKIN_FORMAT) return { ok: false, error: "This isn't a NEXUS skin file." };
  const version = typeof o.version === "number" ? o.version : 0;
  if (version > SKIN_VERSION) return { ok: false, error: `This skin was made with a newer NEXUS (format ${version}). Update NEXUS to open it.` };
  // Version 1 is the first format; older versions would be upgraded here, step by step.
  const warnings: string[] = [];
  const components: Skin["components"] = {};
  const rawComponents = (o.components && typeof o.components === "object" ? o.components : {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(rawComponents)) {
    if (!(COMPONENT_IDS as string[]).includes(id)) { warnings.push(`Unknown part "${id}" ignored.`); continue; }
    const s = cleanStyle(v);
    if (s) components[id as ComponentId] = s;
  }
  const decals: Decal[] = [];
  for (const d of Array.isArray(o.decals) ? o.decals : []) {
    if (decals.length >= LIMITS.decals) { warnings.push(`Only ${LIMITS.decals} graphics are kept.`); break; }
    const x = d as Record<string, unknown>;
    const component = x.component as ComponentId;
    if (!COMPONENTS.some((c) => c.id === component && c.decals)) { warnings.push("A graphic on an unsupported part was removed."); continue; }
    if (!isSafeImageDataUrl(x.image)) { warnings.push("A graphic that isn't a PNG, JPEG or WebP image (or is too large) was removed."); continue; }
    decals.push({
      id: typeof x.id === "string" ? x.id.slice(0, 40) : `decal-${decals.length}`, component, image: x.image,
      x: clampNum(x.x, 0, 1, 0.5), y: clampNum(x.y, 0, 1, 0.5), scale: clampNum(x.scale, 0.05, 1.5, 0.4),
      rotation: clampNum(x.rotation, -180, 180, 0), opacity: clampNum(x.opacity, 0, 1, 1),
    });
  }
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, LIMITS.nameLength) : "Imported skin";
  const skin: Skin = {
    format: SKIN_FORMAT, version: SKIN_VERSION,
    id: typeof o.id === "string" && /^[\w-]{1,60}$/.test(o.id) ? o.id : newSkin(name, "black", now).id,
    name, base: o.base === "white" ? "white" : "black", components, lightBar: hexOr(o.lightBar, DEFAULT_LIGHT_BAR)!,
    lighting: oneOf(o.lighting, LIGHTING_IDS, "studio"), decals,
    createdAt: clampNum(o.createdAt, 0, 8.64e15, now), updatedAt: clampNum(o.updatedAt, 0, 8.64e15, now),
    ...(isSafeImageDataUrl(o.thumbnail) ? { thumbnail: o.thumbnail } : {}),
  };
  return { ok: true, skin, warnings };
}

/** The exported file: the skin itself (thumbnail left out; it's remade on save). */
export function exportSkin(skin: Skin): string {
  const { thumbnail: _t, ...rest } = skin;
  return JSON.stringify(rest, null, 2);
}

/**
 * Reads an exported file. The imported skin always gets a new id, so it can
 * never overwrite a skin you already have.
 */
export function importSkin(text: string, now = Date.now()): { ok: true; skin: Skin; warnings: string[] } | { ok: false; error: string } {
  if (text.length > LIMITS.fileBytes) return { ok: false, error: "The file is too large to be a NEXUS skin." };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "The file isn't valid JSON." }; }
  const r = migrateSkin(raw, now);
  if (!r.ok) return r;
  return { ...r, skin: { ...r.skin, id: newSkin(r.skin.name, r.skin.base, now).id, createdAt: now, updatedAt: now } };
}

/** File-name-safe version of a skin name. */
export function fileNameFor(skin: Skin): string {
  return `${skin.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "skin"}.nexusskin.json`;
}

// ---- Decal images ------------------------------------------------------------

export const DECAL_LIMITS = { fileBytes: 4_000_000, maxSide: 1024, minSide: 8 };

/** Checks an uploaded file's real type from its first bytes (not its name). */
export function sniffImage(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

/** Size to re-encode an image to, keeping its shape, at most maxSide on the long edge. */
export function fitWithin(w: number, h: number, maxSide = DECAL_LIMITS.maxSide): [number, number] {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
