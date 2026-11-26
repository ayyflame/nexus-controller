// The app's destinations and how the sidebar groups them. Pure, so the
// structure and the redirects from older links are unit-tested.
//
// Principles: a workflow people open on its own gets its own destination
// (Mapping, Sticks, Macros...); closely related tools share one page with
// tabs only where they are used together (Live Viewer's tests). Every
// setting has exactly one home.

export type PageId =
  | "dashboard"
  | "virtual-controller"
  | "profiles"
  | "mapping"
  | "macro-studio"
  | "sticks"
  | "triggers"
  | "motion"
  | "touchpad"
  | "lighting"
  | "live-viewer"
  | "performance"
  | "settings";

export type NavIcon =
  | "dashboard" | "output" | "profiles" | "mapping" | "macro" | "stick" | "trigger" | "gyro" | "touchpad" | "light"
  | "live" | "performance" | "settings";

export interface NavItem { id: PageId; label: string; icon: NavIcon }
export interface NavGroup { label: string | null; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ id: "dashboard", label: "Dashboard", icon: "dashboard" }] },
  {
    label: "Setup",
    items: [
      { id: "virtual-controller", label: "Virtual Controller", icon: "output" },
      { id: "profiles", label: "Profiles", icon: "profiles" },
    ],
  },
  {
    label: "Your controller",
    items: [
      { id: "mapping", label: "Mapping", icon: "mapping" },
      { id: "macro-studio", label: "Macro Studio", icon: "macro" },
      { id: "sticks", label: "Sticks", icon: "stick" },
      { id: "triggers", label: "Triggers", icon: "trigger" },
      { id: "motion", label: "Motion", icon: "gyro" },
      { id: "touchpad", label: "Touchpad", icon: "touchpad" },
      { id: "lighting", label: "Lighting & Haptics", icon: "light" },
    ],
  },
  {
    label: "Test",
    items: [
      { id: "live-viewer", label: "Live Viewer", icon: "live" },
      { id: "performance", label: "Performance", icon: "performance" },
    ],
  },
];

/** Settings sits in the sidebar footer, not in a group. */
export const PAGE_IDS: PageId[] = [...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)), "settings"];

/** The old Controller page's tabs, each now its own page ("live" is Live Viewer's Live tab). */
const CONTROLLER_TABS: Record<string, { page: PageId; tab?: string }> = {
  live: { page: "live-viewer", tab: "live" },
  sticks: { page: "sticks" },
  triggers: { page: "triggers" },
  gyro: { page: "motion" },
  touchpad: { page: "touchpad" },
  buttons: { page: "mapping" },
  output: { page: "virtual-controller" },
  lighting: { page: "lighting" },
};

/**
 * Where a navigation request lands. Accepts current page ids and the old
 * `controller` page with its tab (saved last-page values, links in older
 * code paths), and falls back to the dashboard for anything unknown.
 */
export function resolvePage(page: string | null | undefined, tab?: string): { page: PageId; tab?: string } {
  if (page === "controller") return CONTROLLER_TABS[tab ?? ""] ?? { page: "mapping" };
  if ((PAGE_IDS as string[]).includes(page ?? "")) return tab ? { page: page as PageId, tab } : { page: page as PageId };
  return { page: "dashboard" };
}

export interface PaletteItem { label: string; hint: string; page: PageId; tab?: string; keywords: string }

/** Ctrl+K search entries: pages and the settings people look for by name. */
export const SEARCH_ITEMS: PaletteItem[] = [
  { label: "Dashboard", hint: "Status and get-ready checklist", page: "dashboard", keywords: "home status overview ready checklist" },
  { label: "Button remapping", hint: "Mapping", page: "mapping", keywords: "remap mapping swap disable buttons assign" },
  { label: "Shift layers", hint: "Mapping", page: "mapping", keywords: "layer shift modifier toggle hold" },
  { label: "Button combos", hint: "Mapping", page: "mapping", keywords: "combo chord two buttons together" },
  { label: "Start a macro from a button", hint: "Mapping", page: "mapping", keywords: "macro trigger assign button" },
  { label: "Macros", hint: "Create and record macros", page: "macro-studio", keywords: "macro record sequence rapid fire studio" },
  { label: "Stick deadzone & curve", hint: "Sticks", page: "sticks", keywords: "deadzone anti curve sensitivity drift response square circle" },
  { label: "Stick calibration", hint: "Sticks", page: "sticks", keywords: "calibrate centre center range" },
  { label: "Trigger settings", hint: "Triggers", page: "triggers", keywords: "l2 r2 deadzone activation click point calibrate sensitivity" },
  { label: "Gyro / motion aiming", hint: "Motion", page: "motion", keywords: "gyroscope motion aim tilt smoothing calibrate" },
  { label: "Touchpad zones & swipes", hint: "Touchpad", page: "touchpad", keywords: "touch swipe gesture zone click" },
  { label: "Lightbar & vibration", hint: "Lighting & Haptics", page: "lighting", keywords: "light colour color rgb led rumble vibration haptics player" },
  { label: "Virtual controller", hint: "Xbox 360 output and drivers", page: "virtual-controller", keywords: "xbox 360 dualshock ds4 output driver vigem vigembus hidhide double input" },
  { label: "Profiles", hint: "Switch, create, games", page: "profiles", keywords: "profile game automatic switch template" },
  { label: "Backup & restore", hint: "Profiles", page: "profiles", keywords: "backup restore export import transfer file" },
  { label: "Live input", hint: "Live Viewer", page: "live-viewer", tab: "live", keywords: "visualization test buttons picture 3d model" },
  { label: "Controller test", hint: "Live Viewer", page: "live-viewer", tab: "test", keywords: "test every button check" },
  { label: "Drift test", hint: "Live Viewer", page: "live-viewer", tab: "drift", keywords: "drift stick wander" },
  { label: "Calibration wizard", hint: "Live Viewer", page: "live-viewer", tab: "calibration", keywords: "calibrate wizard stick trigger" },
  { label: "Output check", hint: "Live Viewer", page: "live-viewer", tab: "output", keywords: "what games receive xinput check" },
  { label: "Performance", hint: "Report rate and timing", page: "performance", keywords: "latency rate dropped diagnostics polling" },
  { label: "Settings", hint: "App, devices, diagnostics", page: "settings", keywords: "version update diagnostics hid scan" },
  { label: "Check for updates", hint: "Settings", page: "settings", keywords: "update version release" },
];

export interface Route { page: PageId; tab?: string }

/** The address for a route (`#/macro-studio/edit%3Aabc`), so the window's history can go back and forward. */
export function routeToHash(r: Route): string {
  return r.tab ? `#/${r.page}/${encodeURIComponent(r.tab)}` : `#/${r.page}`;
}

/** The route an address stands for, or null when it isn't one (empty, or not ours). Unknown pages resolve like any link. */
export function hashToRoute(hash: string | null | undefined): Route | null {
  const m = /^#\/([a-z0-9-]+)(?:\/(.*))?$/.exec(hash ?? "");
  if (!m) return null;
  let tab: string | undefined;
  try { tab = m[2] ? decodeURIComponent(m[2]) : undefined; } catch { return null; }
  return resolvePage(m[1], tab || undefined);
}
