/** True while the NEXUS window is minimised or hidden: timers skip their
 *  refresh so the app does no UI work in the background. */
export function pageHidden(doc: { hidden?: boolean } | undefined = typeof document === "undefined" ? undefined : document): boolean {
  return !!doc?.hidden;
}
