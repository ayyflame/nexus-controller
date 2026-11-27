import { test } from "node:test";
import assert from "node:assert/strict";
import { findingsHeadline, performanceFindings, rateText, stageDist, usDist } from "./performanceView.ts";
import type { DeviceSnapshot, EngineStatus } from "../types/engine";

const NOW = 1_000_000;
const zero = { p50Ns: 0, p99Ns: 0, maxNs: 0, samples: 0 };
const device = (p: Partial<DeviceSnapshot> = {}): DeviceSnapshot => ({
  device: { id: "d", model: "dualSense", connection: "usb", origin: "physical", vendorId: 0x054c, productId: 0x0ce6, productName: null, serialNumber: null },
  connectedAtMs: 0, input: null, processed: null, playingMacros: [], activeLayer: null,
  pipelineLatency: { p50Us: 46, p99Us: 90, maxUs: 120, samples: 256 },
  stageLatency: { input: zero, mapping: zero, macros: zero, output: zero, slowOutput: { over4ms: 0, over50ms: 0, longestNs: 0, calls: 10 } },
  sequenceGaps: 0, reportIntervals: { intervals: 10, minUs: 3900, meanUs: 4000, maxUs: 4100, over8ms: 0, over50ms: 0 }, outputReportsSent: 0,
  lastReportMs: NOW - 4, reportRateHz: 250, totalReports: 10, parseErrors: 0, lastParseError: null,
  output: { requested: "xbox360", active: "xbox360", backend: "v", backendStatus: { state: "ready", version: null }, lastError: null, playerIndex: 0, retrying: false },
  ...p,
} as DeviceSnapshot);
const status = (p: Partial<EngineStatus> = {}) => ({ outputBackendStatus: { state: "ready", version: null }, ...p }) as EngineStatus;
const ids = (d: DeviceSnapshot, s = status()) => performanceFindings(d, s, NOW).map((f) => f.id);

test("distributions: five cells, or the reason there are none (never zeros)", () => {
  assert.deepEqual(stageDist({ p50Ns: 60, p99Ns: 78, maxNs: 80, samples: 256, meanNs: 62, p95Ns: 70 }, "idle").cells, ["62 ns", "60 ns", "70 ns", "78 ns", "80 ns"]);
  assert.deepEqual(stageDist({ p50Ns: 60, p99Ns: 78, maxNs: 80, samples: 256 }, "idle").cells, ["n/a", "60 ns", "n/a", "78 ns", "80 ns"], "older engine: no average or 95th");
  assert.equal(stageDist(zero, "No frames sent yet").missing, "No frames sent yet");
  assert.equal(stageDist(undefined, "idle").missing, "Not reported by this engine build");
  assert.deepEqual(usDist({ p50Us: 4000, p99Us: 4100, maxUs: 9000, samples: 256, meanUs: 4010, p95Us: 4050 }, "idle").cells, ["4.01 ms", "4.00 ms", "4.05 ms", "4.10 ms", "9.00 ms"]);
  assert.deepEqual(usDist({ p50Us: 46, p99Us: 90, maxUs: 120, samples: 3 }, "idle").cells, ["n/a", "46 µs", "n/a", "90 µs", "120 µs"]);
  assert.equal(usDist({ p50Us: 0, p99Us: 0, maxUs: 0, samples: 0 }, "No reports yet").missing, "No reports yet");
});

test("a healthy controller has no findings", () => {
  assert.deepEqual(ids(device()), []);
  assert.deepEqual(findingsHeadline([]), { tone: "ok", value: "Nothing to fix", sub: "No problem in the measured values" });
});

test("stale or missing input comes first", () => {
  assert.deepEqual(ids(device({ lastReportMs: NOW - 4000 })), ["stale"]);
  assert.match(performanceFindings(device({ lastReportMs: NOW - 4000 }), status(), NOW)[0]!.title, /4\.0 s/);
  assert.deepEqual(ids(device({ lastReportMs: null })), ["no-input"]);
});

test("slow driver calls: over 50 ms is an error with Output Check as the action; over 4 ms a warning", () => {
  const d = device();
  d.stageLatency.slowOutput = { over4ms: 3, over50ms: 1, longestNs: 160_000_000, calls: 10 };
  const [f] = performanceFindings(d, status(), NOW);
  assert.equal(f!.id, "slow-50");
  assert.equal(f!.tone, "error");
  assert.match(f!.detail, /160\.0 ms/);
  assert.deepEqual(f!.action, { label: "Open Output Check", page: "live-viewer", tab: "output" });
  d.stageLatency.slowOutput = { over4ms: 3, over50ms: 0, longestNs: 7_200_000, calls: 10 };
  assert.deepEqual(ids(d), ["slow-4"]);
  // With the virtual controller off there are no driver calls to judge.
  const off = device({ output: { ...d.output, requested: "disabled", active: null } });
  off.stageLatency.slowOutput = { over4ms: 3, over50ms: 1, longestNs: 1, calls: 10 };
  assert.deepEqual(ids(off), []);
});

test("output problems point to the Virtual Controller page", () => {
  const err = device({ output: { ...device().output, lastError: "Bus refused the target" } });
  const f = performanceFindings(err, status(), NOW)[0]!;
  assert.equal(f.id, "output-error");
  assert.equal(f.detail, "Bus refused the target");
  assert.equal(f.action?.page, "virtual-controller");
  const noDriver = device({ output: { ...device().output, active: null } });
  const g = performanceFindings(noDriver, status({ outputBackendStatus: { state: "unavailable", reason: "ViGEmBus not found." } }), NOW)[0]!;
  assert.equal(g.id, "output-driver");
  assert.match(g.detail, /^ViGEmBus not found\./);
  assert.deepEqual(ids(device({ output: { ...device().output, playerIndex: 2 } })), ["slot"]);
});

test("controller-side problems: pauses, unreadable and dropped reports, backlog", () => {
  const d = device({ parseErrors: 2, lastParseError: "Report too short", sequenceGaps: 5 });
  d.reportIntervals.over50ms = 1;
  d.flow = { reportGaps: { p50Us: 0, p99Us: 0, maxUs: 0, samples: 0 }, outputGaps: { p50Us: 0, p99Us: 0, maxUs: 0, samples: 0 }, queuedReports: 9, longestBacklog: 3, unchangedOutputs: 0, outputs: 0 };
  const list = performanceFindings(d, status(), NOW);
  assert.deepEqual(list.map((f) => f.id), ["gaps-50", "parse", "backlog", "dropped"]);
  assert.match(list.find((f) => f.id === "parse")!.detail, /Report too short/);
  assert.match(list.find((f) => f.id === "dropped")!.title, /estimate/);
  assert.deepEqual(findingsHeadline(list), { tone: "warn", value: "4 to check", sub: list[0]!.title });
  // A single queued report is normal.
  d.flow.longestBacklog = 1;
  assert.ok(!performanceFindings(d, status(), NOW).some((f) => f.id === "backlog"));
});

test("report rate says when there is none", () => {
  assert.equal(rateText(device()), "250 reports/s");
  assert.equal(rateText(device({ lastReportMs: null })), "No reports yet");
});
