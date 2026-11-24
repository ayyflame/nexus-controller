// Optional HidHide guidance (Virtual Controller page). NEXUS never
// installs HidHide or changes its settings; it only explains the setup.

export const HIDHIDE_RELEASES = "https://github.com/nefarius/HidHide/releases";

export type DriverPresence = "installed" | "notInstalled" | "unknown";

export type DoubleInputAdvice =
  /** Virtual output is off: double input can't happen. */
  | "notNeeded"
  /** Output on, HidHide not installed: games may see two controllers. */
  | "suggestHidHide"
  /** HidHide installed and output working: remind how to keep NEXUS allowed. */
  | "hidHideInstalled"
  /** HidHide installed but NEXUS sees no controller: NEXUS may be hidden too. */
  | "checkApplicationsList";

export function doubleInputAdvice(opts: {
  hidhide: DriverPresence | undefined;
  outputActive: boolean;
  controllerConnected: boolean;
}): DoubleInputAdvice {
  if (opts.hidhide === "installed" && !opts.controllerConnected) return "checkApplicationsList";
  if (!opts.outputActive) return opts.hidhide === "installed" ? "hidHideInstalled" : "notNeeded";
  return opts.hidhide === "installed" ? "hidHideInstalled" : "suggestHidHide";
}
