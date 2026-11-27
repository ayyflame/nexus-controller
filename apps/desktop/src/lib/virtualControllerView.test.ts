import { test } from "node:test";
import assert from "node:assert/strict";
import { hidHideLine, nextOption, outputOptions, technicalFacts, vigemLine } from "./virtualControllerView.ts";
import type { DeviceSnapshot, EngineStatus } from "../types/engine";

const on = { requested: "xbox360" as const, active: "xbox360" as const, consent: true, ready: true };
const byKind = (o: ReturnType<typeof outputOptions>) => Object.fromEntries(o.map((x) => [x.kind, x]));

test("the running Xbox 360 output is active; Off is available; DualShock 4 is never offered", () => {
  const o = byKind(outputOptions(on));
  assert.equal(o.xbox360!.state, "active");
  assert.equal(o.xbox360!.checked, true);
  assert.equal(o.disabled!.state, "available");
  assert.equal(o.dualShock4!.state, "unavailable");
  assert.equal(o.dualShock4!.available, false);
  assert.match(o.dualShock4!.reason!, /only an Xbox 360/);
});

test("chosen but not running is 'selected', not 'active'", () => {
  const o = byKind(outputOptions({ ...on, active: null }));
  assert.equal(o.xbox360!.state, "selected");
});

test("with the experimental switch off, Xbox 360 can't be chosen and says why", () => {
  const o = byKind(outputOptions({ ...on, active: null, consent: false }));
  assert.equal(o.xbox360!.available, false);
  assert.equal(o.xbox360!.state, "selected");
  assert.match(o.xbox360!.reason!, /Turn on the experimental/);
  assert.equal(o.disabled!.available, true);
  // Unknown consent (still loading) is not treated as on.
  assert.equal(byKind(outputOptions({ ...on, active: null, consent: null })).xbox360!.available, false);
});

test("without the engine nothing can be chosen", () => {
  const o = outputOptions({ requested: "disabled", active: null, consent: true, ready: false });
  assert.ok(o.every((x) => !x.available));
  assert.equal(byKind(o).disabled!.state, "selected");
});

test("Off is 'selected' when chosen, and never 'active'", () => {
  const o = byKind(outputOptions({ requested: "disabled", active: null, consent: true, ready: true }));
  assert.equal(o.disabled!.state, "selected");
  assert.equal(o.xbox360!.state, "available");
});

test("arrow keys skip unavailable options and wrap", () => {
  const o = outputOptions({ requested: "disabled", active: null, consent: true, ready: true });
  assert.equal(nextOption(o, "disabled", 1), "xbox360");
  assert.equal(nextOption(o, "xbox360", 1), "disabled");
  assert.equal(nextOption(o, "disabled", -1), "xbox360");
  const off = outputOptions({ requested: "xbox360", active: null, consent: false, ready: true });
  // Xbox 360 is checked but unavailable: focus can leave it for Off, but never moves back onto it.
  assert.equal(nextOption(off, "xbox360", 1), "disabled");
  assert.equal(nextOption(off, "disabled", 1), "disabled");
});

const status = (p: Partial<EngineStatus> = {}): EngineStatus => ({
  revision: 1, hidBackend: "w", hidAvailable: true, hotplugActive: true, enumerationError: null, requestedOutput: "xbox360",
  outputBackend: "vigembus (experimental)", outputBackendStatus: { state: "ready", version: "1.22" }, devices: [],
  macros: { armed: 0, recording: null } as unknown as EngineStatus["macros"], drivers: { vigembus: "installed", hidhide: "notInstalled" },
  stats: { connects: 0, disconnects: 0, connectionErrors: 0 }, gyroCalibrating: false, ...p,
});

test("ViGEmBus line follows the backend, not only the install check", () => {
  assert.deepEqual(vigemLine(status()).value, "Ready");
  assert.match(vigemLine(status()).detail, /1\.22/);
  const notAnswering = vigemLine(status({ outputBackendStatus: { state: "unavailable", reason: "Bus not found" } }));
  assert.equal(notAnswering.value, "Not answering");
  assert.equal(notAnswering.detail, "Bus not found");
  assert.equal(vigemLine(status({ outputBackendStatus: { state: "unavailable", reason: "x" }, drivers: { vigembus: "notInstalled", hidhide: "unknown" } })).tone, "error");
  assert.equal(vigemLine(null).value, "Unknown");
});

test("HidHide never claims the controller is hidden", () => {
  for (const hidhide of ["installed", "notInstalled", "unknown", undefined] as const) {
    for (const outputActive of [true, false]) {
      const l = hidHideLine({ hidhide, outputActive });
      assert.doesNotMatch(l.value, /hidden/i);
      // "hidden" may appear only as the question NEXUS can't answer.
      assert.ok(!/hidden/i.test(l.detail) || /can't see whether/.test(l.detail), l.detail);
    }
  }
  assert.match(hidHideLine({ hidhide: "installed", outputActive: true }).detail, /can't see whether/);
  assert.equal(hidHideLine({ hidhide: "notInstalled", outputActive: true }).tone, "warn");
  assert.equal(hidHideLine({ hidhide: "notInstalled", outputActive: false }).tone, "idle");
});

const device = (p: Partial<DeviceSnapshot> = {}): DeviceSnapshot => ({
  device: { id: "d", model: "dualSense", connection: "usb", origin: "physical", vendorId: 0x054c, productId: 0x0ce6, productName: null, serialNumber: null },
  connectedAtMs: 0, input: null, processed: null, playingMacros: [], activeLayer: null,
  pipelineLatency: { p50Us: 0, p99Us: 0, maxUs: 0, samples: 0 },
  stageLatency: { input: { p50Ns: 0, p99Ns: 0, maxNs: 0, samples: 0 }, mapping: { p50Ns: 0, p99Ns: 0, maxNs: 0, samples: 0 }, macros: { p50Ns: 0, p99Ns: 0, maxNs: 0, samples: 0 }, output: { p50Ns: 0, p99Ns: 0, maxNs: 0, samples: 0 } },
  sequenceGaps: 0, reportIntervals: { intervals: 0, minUs: 0, meanUs: 0, maxUs: 0, over8ms: 0, over50ms: 0 }, outputReportsSent: 0,
  lastReportMs: null, reportRateHz: 0, totalReports: 0, parseErrors: 0, lastParseError: null,
  output: { requested: "xbox360", active: null, backend: "v", backendStatus: { state: "ready", version: null }, lastError: null, playerIndex: null, retrying: false },
  ...p,
} as DeviceSnapshot);

test("technical facts say 'unavailable' in words instead of showing 0", () => {
  const facts = technicalFacts(device(), status());
  const v = (label: string) => facts.find((f) => f.label.startsWith(label))!.value;
  assert.equal(v("Frames sent"), "Not reported by this engine build");
  // The engine times the (no-op) output step even while the virtual controller is off: not shown as driver time.
  assert.equal(v("Driver call time"), "No virtual controller");
  assert.equal(v("Slow driver calls"), "Not reported by this engine build");
  assert.equal(v("Dropped input reports"), "No input yet");
  assert.equal(v("Player slot"), "No virtual controller");
  assert.equal(v("Driver version"), "1.22");
});

test("technical facts are grouped: measured, reported and estimated", () => {
  const facts = technicalFacts(device(), status());
  assert.equal(facts.find((f) => f.label === "Dropped input reports")!.source, "estimate");
  assert.equal(facts.find((f) => f.label === "Player slot (XInput)")!.source, "reported");
  assert.equal(facts.find((f) => f.label.startsWith("Driver call time"))!.source, "measured");
  assert.equal(technicalFacts(null, status()).find((f) => f.label.startsWith("Frames"))!.value, "No controller connected");
  assert.equal(technicalFacts(null, status({ outputBackend: "none" }))[0]!.value, "None on this system");
});

test("an active output reports its slot and real counts", () => {
  const d = device({
    output: { requested: "xbox360", active: "xbox360", backend: "v", backendStatus: { state: "ready", version: null }, lastError: null, playerIndex: 1, retrying: false },
    flow: { reportGaps: { p50Us: 0, p99Us: 0, maxUs: 0, samples: 0 }, outputGaps: { p50Us: 0, p99Us: 0, maxUs: 0, samples: 0 }, queuedReports: 0, longestBacklog: 0, unchangedOutputs: 0, outputs: 12345 },
  });
  d.stageLatency.output = { p50Ns: 40_000, p99Ns: 1_200_000, maxNs: 2_000_000, samples: 100 };
  d.stageLatency.slowOutput = { over4ms: 2, over50ms: 0, longestNs: 5_000_000, calls: 100 };
  const facts = technicalFacts(d, status());
  const v = (label: string) => facts.find((f) => f.label.startsWith(label))!.value;
  assert.equal(v("Player slot"), "Player 2");
  assert.equal(v("Frames sent"), "12,345");
  assert.equal(v("Driver call time"), "40 µs / 1.2 ms");
  assert.equal(v("Slow driver calls"), "2 / 0");
});
