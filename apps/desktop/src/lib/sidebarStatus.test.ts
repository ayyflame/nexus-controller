import { test } from "node:test";
import assert from "node:assert/strict";
import { outputLine } from "./sidebarStatus.ts";
import type { DeviceSnapshot, EngineStatus } from "../types/engine";

const status = (p: Partial<EngineStatus> = {}) =>
  ({ requestedOutput: "xbox360", outputBackendStatus: { state: "ready", version: null }, ...p }) as unknown as EngineStatus;
const device = (output: Record<string, unknown>) => ({ output }) as unknown as DeviceSnapshot;

test("the sidebar says whether games get NEXUS's output, and why not", () => {
  assert.equal(outputLine(null, null).tone, "idle");
  assert.equal(outputLine(status({ requestedOutput: "disabled" }), null).label, "Xbox output: off");
  assert.equal(outputLine(status({ outputBackendStatus: { state: "unavailable", reason: "x" } }), null).tone, "error");
  assert.equal(outputLine(status(), null).label, "Xbox output: waiting");
  assert.deepEqual(
    [outputLine(status(), device({ active: "xbox360", playerIndex: 0 })).label, outputLine(status(), device({ active: "xbox360", playerIndex: 0 })).tone],
    ["Xbox output: on", "ok"],
  );
  assert.equal(outputLine(status(), device({ active: "xbox360", playerIndex: 1 })).label, "Xbox output: player 2");
  assert.equal(outputLine(status(), device({ active: null, retrying: true })).label, "Xbox output: reconnecting");
  const failed = outputLine(status(), device({ active: null, retrying: false, lastError: "No free slot" }));
  assert.equal(failed.tone, "error");
  assert.equal(failed.tip, "No free slot");
});
