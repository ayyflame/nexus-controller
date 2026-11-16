import { engineApi } from "./engine";
import { diagnosticsReport } from "./diagnosticsReport";
import type { AppInfo } from "../types/engine";

/** Collects the engine's current state and builds the shareable report. */
export async function buildDiagnosticsReport(appInfo: AppInfo | null): Promise<string> {
  const [status, hid, raw, log] = await Promise.all([
    engineApi.getStatus(),
    engineApi.getHidDiagnostics(),
    engineApi.getRawReports(40),
    engineApi.getEventLog(150),
  ]);
  return diagnosticsReport(appInfo, status, hid, raw, log, navigator.userAgent, new Date());
}
