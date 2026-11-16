import { useCallback, useEffect, useState } from "react";
import { engineApi, errorMessage, isDesktopShell } from "../lib/engine";
import type { UpdateStatus } from "../lib/updates";

/** Live update status from the Rust updater (`nexus://update` events). */
export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktopShell()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await engineApi.onUpdate((s) => { if (active) setStatus(s); });
        const s = await engineApi.getUpdateStatus();
        if (active) setStatus(s);
      } catch (e) {
        if (active) setError(errorMessage(e));
      }
    })();
    return () => { active = false; unlisten?.(); };
  }, []);

  const run = useCallback(async (op: () => Promise<UpdateStatus>) => {
    setError(null);
    try { setStatus(await op()); } catch (e) { setError(errorMessage(e)); }
  }, []);

  return {
    status,
    error,
    check: () => run(engineApi.checkForUpdates),
    download: () => run(engineApi.downloadUpdate),
    install: () => run(engineApi.installUpdate),
    postpone: () => run(engineApi.postponeUpdate),
    setAutoCheck: (on: boolean) => run(() => engineApi.setAutoUpdateCheck(on)),
    dismissOutcome: () => run(engineApi.dismissUpdateOutcome),
  };
}
