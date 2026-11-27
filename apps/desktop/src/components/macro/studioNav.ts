// Navigation between the Macro Library and the Macro Editor pages, through
// the app's history-backed navigation (so Back and Forward work), plus the
// little state that survives the trip: a one-time message for the library,
// the unsaved new macro handed to the editor, and the library's search and
// scroll position.

import { editorTab } from "../../lib/macroStudio";
import type { Macro } from "../../types/engine";

interface NavOptions { replace?: boolean; quiet?: boolean }

function navigate(tab: string | undefined, opts: NavOptions = {}) {
  window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page: "macro-studio", tab, ...opts } }));
}

let flash: string | null = null;

/** Back to the library, optionally with a message shown once there. */
export function openLibrary(message?: string, opts: NavOptions = {}) {
  flash = message ?? null;
  navigate(undefined, opts);
}

/** The message left for the page being opened (read once). */
export function takeFlash(): string | null {
  const m = flash;
  flash = null;
  return m;
}

/** A saved macro's editor, optionally with a message shown once there. */
export function openEditor(id: string, opts: NavOptions = {}, message?: string) {
  if (message) flash = message;
  navigate(editorTab(id), opts);
}

let draft: Macro | null = null;

/** The editor for a new macro that can't be saved yet (no actions). It gets its own address once saved. */
export function openDraft(m: Macro) {
  draft = m;
  draftId = null;
  navigate("draft");
}

/** The new macro handed over by the library (null after a reload or once it has been saved). */
export function peekDraft(): Macro | null {
  return draft;
}

let draftId: string | null = null;

/** The new macro was saved (as `id`): it is no longer a draft. */
export function clearDraft(id?: string) {
  draft = null;
  if (id) draftId = id;
}

/** The id the last draft was saved as, so its old address opens the saved macro. */
export function draftSavedAs(): string | null {
  return draftId;
}

/** Search text and list scroll position, kept while NEXUS runs so returning to the library finds it as it was. */
export const libraryView = { query: "", scrollTop: 0 };
