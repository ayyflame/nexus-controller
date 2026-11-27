import { useEffect, useState } from "react";
import { pageHidden } from "../lib/visibility";

/**
 * The current time, refreshed every `intervalMs` while `enabled`. The timer
 * skips its refresh while the window is hidden, and stops when disabled, so
 * a page re-renders for the clock only when it shows something time-based.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => { if (!pageHidden()) setNow(Date.now()); }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
