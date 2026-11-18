// Which controller picture to show: the interactive 3D model (default) or the
// flat picture (the drawing, or the user's own photo). A per-PC display
// preference kept in webview storage; it never touches the engine.

import { useEffect, useState } from "react";

export type ViewMode = "3d" | "flat";

const KEY = "nexus.controllerView.v1";
const EVENT = "nexus:controller-view";

export function parseViewMode(v: string | null): ViewMode {
  return v === "flat" ? "flat" : "3d";
}

export function loadViewMode(): ViewMode {
  try { return parseViewMode(localStorage.getItem(KEY)); } catch { return "3d"; }
}

export function saveViewMode(mode: ViewMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* display preference only */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useViewMode(): ViewMode {
  const [mode, setMode] = useState<ViewMode>(loadViewMode);
  useEffect(() => {
    const on = () => setMode(loadViewMode());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return mode;
}

export type Finish = "white" | "black";
const FINISH_KEY = "nexus.controllerFinish.v1";

export function parseFinish(v: string | null): Finish {
  return v === "white" ? "white" : "black";
}

/** The 3D controller's colour (Midnight Black unless White was chosen). */
export function useFinish(): [Finish, (f: Finish) => void] {
  const [finish, setFinish] = useState<Finish>(() => {
    try { return parseFinish(localStorage.getItem(FINISH_KEY)); } catch { return "black"; }
  });
  const save = (f: Finish) => {
    setFinish(f);
    try { localStorage.setItem(FINISH_KEY, f); } catch { /* display preference only */ }
  };
  return [finish, save];
}

let webgl: boolean | null = null;
/** Whether this PC's webview can draw WebGL (checked once). */
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement("canvas");
    webgl = Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return webgl;
}
