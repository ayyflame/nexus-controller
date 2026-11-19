// Settings › Windows: what the start-with-Windows switch shows. Pure, tested.

import type { StartupStatus, WindowBehaviour } from "../types/engine";

export const DEFAULT_BEHAVIOUR: WindowBehaviour = { closeToTray: true, minimizeToTray: false, startHidden: true };

/** The switch position and the line under it. */
export function startupView(s: StartupStatus | null): { checked: boolean; disabled: boolean; note: string; tone: "muted" | "warn" | "error" } {
  if (!s) return { checked: false, disabled: true, note: "Loading…", tone: "muted" };
  if (!s.supported) return { checked: false, disabled: true, note: "Available in the Windows app.", tone: "muted" };
  if (s.error) return { checked: s.enabled, disabled: false, note: s.error, tone: "error" };
  if (s.enabled && s.disabledInWindows) {
    return {
      checked: false, disabled: false, tone: "warn",
      note: "Switched off in Task Manager › Startup apps. Turn it on here to start NEXUS with Windows again.",
    };
  }
  return {
    checked: s.enabled, disabled: false, tone: "muted",
    note: s.enabled ? "NEXUS starts when you sign in to Windows, for your user account only." : "NEXUS starts only when you open it.",
  };
}

/** What closing the window does, in words. */
export function closeText(b: WindowBehaviour): string {
  return b.closeToTray
    ? "Closing the window keeps NEXUS running in the notification area (tray), so games keep the virtual controller. Quit from the tray icon."
    : "Closing the window quits NEXUS. Games lose the virtual controller, and every button is released first.";
}
