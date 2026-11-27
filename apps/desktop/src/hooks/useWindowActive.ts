import { useEffect, useState } from "react";
import { windowInactive } from "../lib/windowActivity";

/** False while another program (such as a game) has the focus or the window is hidden. */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(() => typeof document === "undefined" || !windowInactive(document));
  useEffect(() => {
    const update = () => { setActive(!windowInactive(document)); setTimeout(() => setActive(!windowInactive(document)), 0); };
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return active;
}
