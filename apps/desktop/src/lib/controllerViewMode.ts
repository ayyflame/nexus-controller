// Display preferences for the 3D controller (its colour) and whether this
// PC can draw it at all. Per-PC, kept in webview storage; never touches the engine.

import { useState } from "react";

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
