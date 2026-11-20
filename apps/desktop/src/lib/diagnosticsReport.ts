// The contents of the shareable diagnostics report. Pure (no engine calls),
// so the exported fields can be tested.

import { hex } from "./format.ts";
import type { AppInfo, EngineStatus, HidDiagnostic, LogEntry, RawReport } from "../types/engine";

/** Bumped when fields are added. Version 1 had no `build` and no `processingTime`. */
export const DIAGNOSTICS_VERSION = 2;

/**
 * What `processingTime` measures in this build. Stated in every report,
 * because older builds measured a narrower span and had no such field in
 * their reports: numbers from different builds are comparable only when
 * this text matches.
 */
export const PROCESSING_TIME_DEFINITION =
  "Time from a controller report reaching NEXUS until the virtual controller has the processed result " +
  "(processing, macros and the virtual controller update). Rolling window: the most recent 256 controller " +
  "reports at most (about one second at 250 Hz), refreshed every 64 reports. Not included: USB and Windows " +
  "scheduling delay before NEXUS receives the report, report decoding, and the game reading the virtual " +
  "controller. Sustained behaviour is shown by reportIntervals (counted since the controller connected).";

/**
 * Builds a shareable hardware-validation report. Excludes serial numbers,
 * MAC addresses (masked by the engine), the local data-folder and program
 * paths, and all macro and profile contents.
 */
export function diagnosticsReport(
  appInfo: AppInfo | null,
  status: EngineStatus,
  hid: HidDiagnostic[],
  raw: RawReport[],
  log: LogEntry[],
  userAgent: string,
  now: Date,
): string {
  const report = {
    kind: "nexus-diagnostics",
    version: DIAGNOSTICS_VERSION,
    generatedAt: now.toISOString(),
    app: appInfo && { version: appInfo.version, build: appInfo.build, os: appInfo.os, arch: appInfo.arch },
    userAgent,
    engine: {
      hidBackend: status.hidBackend,
      hidAvailable: status.hidAvailable,
      enumerationError: status.enumerationError,
      requestedOutput: status.requestedOutput,
      outputBackend: status.outputBackend,
      outputBackendStatus: status.outputBackendStatus,
    },
    connectionStats: status.stats,
    processingTimeDefinition: PROCESSING_TIME_DEFINITION,
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
      staleReportsSkipped: d.staleReportsSkipped ?? 0,
      reportIntervals: d.reportIntervals,
      // Null until the first 64 reports have been measured.
      processingTime: d.pipelineLatency.samples > 0
        ? {
            p50Us: d.pipelineLatency.p50Us,
            p99Us: d.pipelineLatency.p99Us,
            maxUs: d.pipelineLatency.maxUs,
            samples: d.pipelineLatency.samples,
          }
        : null,
      connectedForSeconds: Math.round((now.getTime() - d.connectedAtMs) / 1000),
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
