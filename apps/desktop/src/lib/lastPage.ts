// Reopens the page that was open when NEXUS last closed (per-viewer
// convenience in localStorage; unavailable storage simply starts on the
// dashboard). Pure parsing is tested.

const KEY = "nexus.lastPage.v1";
export const PAGES = ["dashboard", "controller", "live-viewer", "macro-studio", "profiles", "performance", "settings"] as const;
export type SavedPage = (typeof PAGES)[number];

export function parsePage(saved: string | null | undefined): SavedPage {
  return (PAGES as readonly string[]).includes(saved ?? "") ? (saved as SavedPage) : "dashboard";
}

export function loadPage(): SavedPage {
  try { return parsePage(localStorage.getItem(KEY)); } catch { return "dashboard"; }
}

export function savePage(page: string): void {
  try { localStorage.setItem(KEY, parsePage(page)); } catch { /* storage unavailable */ }
}
