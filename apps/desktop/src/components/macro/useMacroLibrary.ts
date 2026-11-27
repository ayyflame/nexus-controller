import { useCallback, useEffect, useState } from "react";
import { engineApi, errorMessage } from "../../lib/engine";
import { macroSavesSettled, takeMacroSaveFailure } from "../../lib/macroSaves";
import { EMPTY_MACRO_META } from "../../lib/macroStudio";
import type { Macro, MacroMeta, Profile } from "../../types/engine";

/**
 * The saved macros, which are pinned and where each is on, and the profiles:
 * what both Macro Studio pages show. Reloads when the active profile changes,
 * because which macros are on depends on it. Waits for macro saves still
 * under way (a change made just before leaving the editor), and shows a save
 * that failed after its editor closed.
 */
export function useMacroLibrary(ready: boolean, profileId: number | null) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [meta, setMeta] = useState<MacroMeta>(EMPTY_MACRO_META);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ready) return undefined;
    try {
      await macroSavesSettled();
      const failed = takeMacroSaveFailure();
      if (failed) setError(failed);
      const [list, m, ps] = await Promise.all([engineApi.listMacros(), engineApi.getMacroMeta(), engineApi.listProfiles()]);
      setMacros(list); setMeta(m); setProfiles(ps); setLoaded(true);
      return list;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    }
  }, [ready]);
  useEffect(() => { void reload(); }, [reload, profileId]);

  const upsert = useCallback((m: Macro) => setMacros((list) =>
    list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]), []);

  /** Runs an action, showing its error (if any) instead of throwing. */
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); }
  }, []);

  return { macros, meta, setMeta, profiles, loaded, error, setError, reload, upsert, run };
}
