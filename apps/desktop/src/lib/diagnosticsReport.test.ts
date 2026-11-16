import { test } from "node:test";
import assert from "node:assert/strict";
import { DIAGNOSTICS_VERSION, PROCESSING_TIME_DEFINITION, diagnosticsReport } from "./diagnosticsReport.ts";
import type { AppInfo, DeviceSnapshot, EngineStatus } from "../types/engine";

const appInfo: AppInfo = {
  version: "0.1.0",
  build: "abc1234",
  os: "windows",
  arch: "x86_64",
  dataDir: "C:\\Users\\SomeUser\\AppData\\Roaming\\NEXUS",
  storageWarning: null,
  exePath: "C:\\Users\\SomeUser\\AppData\\Local\\NEXUS\\nexus-desktop.exe",
};

function device(samples: number): DeviceSnapshot {
  return {
    device: { model: "dualSense", connection: "usb", origin: "physical", vendorId: 0x054c, productId: 0x0ce6, productName: "DualSense Wireless Controller" },
    connectedAtMs: 1_000_000,
    input: null,
    processed: null,
    playingMacros: ["secret-macro-id"],
    pipelineLatency: { p50Us: 12, p99Us: 40, maxUs: 95, samples },
    sequenceGaps: 0,
    reportIntervals: { intervals: 500, minUs: 3900, meanUs: 4000, maxUs: 4300, over8ms: 0, over50ms: 0 },
    outputReportsSent: 0,
    lastReportMs: null,
    reportRateHz: 249.96,
    totalReports: 501,
    parseErrors: 0,
    lastParseError: null,
    output: { requested: "xbox360", active: "xbox360", lastError: null },
  } as unknown as DeviceSnapshot;
}

function status(devices: DeviceSnapshot[]): EngineStatus {
  return {
    revision: 1,
    hidBackend: "windows",
    hidAvailable: true,
    hotplugActive: true,
    enumerationError: null,
    requestedOutput: "xbox360",
    outputBackend: "vigem",
    outputBackendStatus: { kind: "ready", version: null },
    devices,
    macros: { armed: 1, playing: 1, recording: false, secret: "Macro Name" },
    drivers: { vigembus: "installed", hidhide: "unknown" },
    stats: { connects: 1, disconnects: 0, connectionErrors: 0 },
    gyroCalibrating: false,
  } as unknown as EngineStatus;
}

const build = (devices: DeviceSnapshot[], info: AppInfo | null = appInfo) =>
  diagnosticsReport(info, status(devices), [], [], [], "TestAgent/1.0", new Date(1_060_000));

test("report includes processing time with its definition and the build", () => {
  const r = JSON.parse(build([device(256)]));
  assert.equal(r.version, DIAGNOSTICS_VERSION);
  assert.deepEqual(r.app, { version: "0.1.0", build: "abc1234", os: "windows", arch: "x86_64" });
  assert.equal(r.processingTimeDefinition, PROCESSING_TIME_DEFINITION);
  assert.deepEqual(r.connectedDevices[0].processingTime, { p50Us: 12, p99Us: 40, maxUs: 95, samples: 256 });
  assert.equal(r.connectedDevices[0].reportIntervals.maxUs, 4300);
  assert.equal(r.connectedDevices[0].connectedForSeconds, 60);
});

test("the definition states the window and what is not measured", () => {
  assert.match(PROCESSING_TIME_DEFINITION, /Rolling window/);
  assert.match(PROCESSING_TIME_DEFINITION, /256 controller reports/);
  assert.match(PROCESSING_TIME_DEFINITION, /Not included/);
});

test("processing time is null until something was measured", () => {
  const r = JSON.parse(build([device(0)]));
  assert.equal(r.connectedDevices[0].processingTime, null);
});

test("report works without app info and without a CI build id", () => {
  assert.equal(JSON.parse(build([], null)).app, null);
  assert.equal(JSON.parse(build([], { ...appInfo, build: null })).app.build, null);
});

test("report contains no personal paths and no macro or profile contents", () => {
  const text = build([device(256)]);
  for (const forbidden of ["SomeUser", "AppData", "dataDir", "exePath", "nexus-desktop.exe", "secret-macro-id", "Macro Name", "playingMacros", "\"macros\""]) {
    assert.equal(text.includes(forbidden), false, `must not contain ${forbidden}`);
  }
});
