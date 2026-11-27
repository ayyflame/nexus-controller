// Reopens the page that was open when NEXUS last closed (per-viewer
// convenience in localStorage; unavailable storage simply starts on the
// dashboard). Pure parsing is tested.

import { resolvePage, type PageId } from "./navigation.ts";

const KEY = "nexus.lastPage.v1";

/** A saved value as a current page: unknown values open the dashboard, the old Controller page opens Mapping. */
export function parsePage(saved: string | null | undefined): PageId {
  return resolvePage(saved).page;
}

export function loadPage(): PageId {
  try { return parsePage(localStorage.getItem(KEY)); } catch { return "dashboard"; }
}

export function savePage(page: string): void {
  try { localStorage.setItem(KEY, parsePage(page)); } catch { /* storage unavailable */ }
}
