// Optional photo mode for the controller picture.
//
// NEXUS does not ship or download any photograph. The user picks an image
// file once; it is kept only in this PC's webview storage. The overlay
// positions below were measured on one specific front-view image (400 x 400
// px), so NEXUS accepts only that exact file, checked by its SHA-256
// fingerprint, and otherwise keeps the drawn controller. Coordinates are in
// that image's pixels and drawn in an SVG with the same viewBox, so they stay
// aligned at any size.

import type { TriggerShape } from "./controllerView";
import { useEffect, useState } from "react";
import type { MacroButton } from "../types/engine";

export const PHOTO = {
  width: 400,
  height: 400,
  sha256: "b337756a4eb35b87944827d5fe7315016be86f197c62e42e153309c2dcad8b13",
} as const;

export type Hotspot =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx: number; rotate?: number }
  | { kind: "polygon"; points: Array<[number, number]> };

/** Measured on the reference image (see docs/controller-photo.md). */
export const HOTSPOTS: Partial<Record<MacroButton, Hotspot>> = {
  dpadUp: { kind: "rect", x: 118.5, y: 150.5, w: 13, h: 14, rx: 3 },
  dpadDown: { kind: "rect", x: 117.5, y: 180, w: 13, h: 14, rx: 3 },
  dpadLeft: { kind: "rect", x: 103, y: 166, w: 14, h: 13, rx: 3 },
  dpadRight: { kind: "rect", x: 133.5, y: 166.5, w: 14, h: 13, rx: 3 },
  north: { kind: "circle", cx: 276.8, cy: 155, r: 8 },
  west: { kind: "circle", cx: 259.4, cy: 173.2, r: 8 },
  east: { kind: "circle", cx: 295.4, cy: 172.6, r: 8 },
  south: { kind: "circle", cx: 277.2, cy: 190.7, r: 8 },
  select: { kind: "rect", x: 145.5, y: 137, w: 6, h: 11, rx: 3, rotate: -15 },
  start: { kind: "rect", x: 252.5, y: 137, w: 6, h: 11, rx: 3, rotate: 15 },
  leftShoulder: { kind: "rect", x: 112, y: 126, w: 30, h: 7, rx: 3.5 },
  rightShoulder: { kind: "rect", x: 262, y: 126, w: 30, h: 7, rx: 3.5 },
  touchpad: { kind: "polygon", points: [[154, 133], [250.5, 133], [240, 180.5], [163, 180.5]] },
  home: { kind: "circle", cx: 202, cy: 205, r: 6.5 },
  mute: { kind: "rect", x: 196, y: 217.5, w: 11, h: 4.5, rx: 2.2 },
  leftStick: { kind: "circle", cx: 162, cy: 205, r: 14 },
  rightStick: { kind: "circle", cx: 240, cy: 205, r: 14 },
};

/** How far a stick indicator moves at full deflection (image pixels). */
export const STICK_TRAVEL = 12;

/** L2 and R2 are hidden behind L1/R1 in this front view, so they are drawn
 *  rising from behind the bumpers (L1 x 112–142, R1 x 262–292, top y 126),
 *  in the controller's own colour; pressure fills them from below. */
export const TRIGGER_SHAPES: Record<"leftTrigger" | "rightTrigger", TriggerShape> = {
  leftTrigger: { outer: 112.5, inner: 141.5, top: 110, visibleBottom: 127, bottom: 128, dip: 2.2 },
  rightTrigger: { outer: 291.5, inner: 262.5, top: 110, visibleBottom: 127, bottom: 128, dip: 2.2 },
};

/** Part of the photo shown once its background is removed: the controller
 *  plus L2/R2 and their pressure readout, without the empty margins. Image and overlay use
 *  the same box, so they stay aligned. */
export const VIEW = { x: 70, y: 92, w: 264, h: 206 } as const;

/** Touch coordinates are drawn inside this box (the touchpad's bounds). */
export const TOUCH_BOX = { x: 156, y: 134, w: 92, h: 45 };

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True only for the exact image the overlay positions were measured on. */
export async function isCalibratedPhoto(bytes: ArrayBuffer): Promise<boolean> {
  return (await sha256Hex(bytes)) === PHOTO.sha256;
}

// ---- Local storage (this PC only; never sent anywhere) ---------------------

const KEY = "nexus.controllerPhoto.v1";
const EVENT = "nexus:controller-photo";

export function loadPhoto(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.startsWith("data:image/") ? v : null;
  } catch {
    return null;
  }
}

export function savePhoto(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(KEY, dataUrl);
    else localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* not in a browser */ }
  return true;
}

/** The chosen photo with its white background removed (null while working). */
export function useCutoutPhoto(photo: string | null): string | null {
  const [out, setOut] = useState<{ src: string; cut: string } | null>(null);
  useEffect(() => {
    if (!photo) return;
    let alive = true;
    import("./photoBackground").then(({ cutOutBackground }) => cutOutBackground(photo))
      .then((cut) => { if (alive) setOut({ src: photo, cut }); })
      .catch(() => { if (alive) setOut({ src: photo, cut: photo }); });
    return () => { alive = false; };
  }, [photo]);
  return photo && out?.src === photo ? out.cut : null;
}

/** The chosen photo as a data URL, or null for the drawn controller. */
export function useControllerPhoto(): string | null {
  const [photo, setPhoto] = useState<string | null>(() => loadPhoto());
  useEffect(() => {
    const update = () => setPhoto(loadPhoto());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return photo;
}
