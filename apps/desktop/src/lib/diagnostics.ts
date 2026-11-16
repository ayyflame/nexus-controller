import { engineApi } from "./engine";
import { hex } from "./format";
import type { AppInfo } from "../types/engine";

/**
 * Builds a shareable hardware-validation report. Excludes serial numbers,
 * MAC addresses (masked by the engine) and the local data-folder path.
 */
export async function buildDiagnosticsReport(appInfo: AppInfo | null): Promise<string> {
  const [status, hid, raw, log] = await Promise.all([
    engineApi.getStatus(),
    engineApi.getHidDiagnostics(),
    engineApi.getRawReports(40),
    engineApi.getEventLog(150),
  ]);
  const report = {
    kind: "nexus-diagnostics",
    version: 1,
    generatedAt: new Date().toISOString(),
    app: appInfo && { version: appInfo.version, os: appInfo.os, arch: appInfo.arch },
    userAgent: navigator.userAgent,
    engine: {
      hidBackend: status.hidBackend,
      hidAvailable: status.hidAvailable,
      enumerationError: status.enumerationError,
      requestedOutput: status.requestedOutput,
      outputBackend: status.outputBackend,
      outputBackendStatus: status.outputBackendStatus,
    },
    connectionStats: status.stats,
    connectedDevices: status.devices.map((d) => ({
      model: d.device.model,
      connection: d.device.connection,
      origin: d.device.origin,
      vendorId: d.device.vendorId,
      productId: d.device.productId,
      productName: d.device.productName,
      reportRateHz: Math.round(d.reportRateHz * 10) / 10,
      totalReports: d.totalReports,
      parseErrors: d.parseErrors,
      sequenceGaps: d.sequenceGaps,
      reportIntervals: d.reportIntervals,
      connectedForSeconds: Math.round((Date.now() - d.connectedAtMs) / 1000),
      lastParseError: d.lastParseError,
      lastInput: d.input,
    })),
    hidScan: hid,
    rawReports: raw.map((r) => ({
      timestampMs: r.timestampMs,
      length: r.bytes.length,
      hex: hex(r.bytes),
      parseError: r.parseError,
    })),
    log: log.map((l) => ({ t: l.timestampMs, level: l.level, category: l.category, message: l.message })),
  };
  return JSON.stringify(report, null, 2);
}
