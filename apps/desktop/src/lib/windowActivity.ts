// While another program (such as a game) is in front of NEXUS, the page is
// marked inactive: looping CSS animations pause, so the window stops
// repainting 60 times a second for decoration. The Rust bridge slows the
// status stream at the same time (src-tauri/src/bridge.rs).

export const INACTIVE_CLASS = "app-inactive";

interface DocLike {
  hidden?: boolean;
  hasFocus?: () => boolean;
  documentElement: { classList: { toggle(name: string, force?: boolean): boolean } };
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
interface WinLike {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/** True while the window is hidden or another program has the focus. */
export function windowInactive(doc: Pick<DocLike, "hidden" | "hasFocus">): boolean {
  return !!doc.hidden || (typeof doc.hasFocus === "function" && !doc.hasFocus());
}

/** Keeps INACTIVE_CLASS on the root element in step with the window's focus. Returns a stop function. */
export function watchWindowActivity(win: WinLike, doc: DocLike): () => void {
  const update = () => { doc.documentElement.classList.toggle(INACTIVE_CLASS, windowInactive(doc)); };
  // "blur" fires before the document reports the focus as gone; read it again on the next turn.
  const later = () => { update(); setTimeout(update, 0); };
  win.addEventListener("focus", later);
  win.addEventListener("blur", later);
  doc.addEventListener("visibilitychange", later);
  update();
  return () => {
    win.removeEventListener("focus", later);
    win.removeEventListener("blur", later);
    doc.removeEventListener("visibilitychange", later);
  };
}
