import { test } from "node:test";
import assert from "node:assert/strict";
import { outputSummary } from "./outputStatus.ts";
import type { OutputStatus } from "../types/engine";

const status = (o: Partial<OutputStatus>): OutputStatus => ({
  requested: "xbox360", active: null, backend: "vigembus", backendStatus: { state: "ready", version: null },
  lastError: null, playerIndex: null, retrying: false, ...o,
});
const base = { requested: "xbox360" as const, consent: true, driverReady: true };

test("a connected virtual controller shows its player slot", () => {
  const p1 = outputSummary({ ...base, output: status({ active: "xbox360", playerIndex: 0 }) });
  assert.deepEqual([p1.tone, p1.text, p1.detail], ["ok", "Xbox 360 connected", "Games see it as player 1."]);
  const unknown = outputSummary({ ...base, output: status({ active: "xbox360" }) });
  assert.deepEqual([unknown.tone, unknown.text, unknown.detail], ["ok", "Xbox 360 connected", null]);
});

test("a later player slot is a warning with what to do", () => {
  const p2 = outputSummary({ ...base, output: status({ active: "xbox360", playerIndex: 1 }) });
  assert.equal(p2.tone, "warn");
  assert.equal(p2.text, "Xbox 360 connected as player 2");
  assert.match(p2.detail!, /holds player 1\./);
  assert.match(outputSummary({ ...base, output: status({ active: "xbox360", playerIndex: 3 }) }).detail!, /player 1–3/);
});

test("a failed controller that is being retried says so", () => {
  const r = outputSummary({ ...base, output: status({ retrying: true, lastError: "stopped" }) });
  assert.deepEqual([r.tone, r.text], ["warn", "Reconnecting…"]);
});

test("the reason for no virtual controller is named", () => {
  assert.equal(outputSummary({ ...base, consent: false, output: status({}) }).text, "Off");
  assert.equal(outputSummary({ ...base, requested: "disabled", output: status({ requested: "disabled" }) }).text, "Turned off");
  assert.equal(outputSummary({ ...base, output: null }).text, "Waiting for your DualSense (USB)");
  assert.equal(outputSummary({ ...base, driverReady: false, output: status({}) }).text, "Waiting for ViGEmBus");
  assert.equal(outputSummary({ ...base, output: status({}) }).text, "Not connected");
  // Off wins over a stale retry flag.
  assert.equal(outputSummary({ ...base, consent: false, output: status({ retrying: true }) }).text, "Off");
});
