import { test } from "node:test";
import assert from "node:assert/strict";
import { readinessSteps, readyToPlay, VIGEMBUS_RELEASES, type ReadinessInput } from "./readiness.ts";
import type { DeviceSnapshot, EngineStatus } from "../types/engine";

function status(p: Partial<EngineStatus> = {}): EngineStatus {
  return {
    requestedOutput: "xbox360", outputBackendStatus: { state: "ready", version: null }, enumerationError: null,
    drivers: { vigembus: "installed", hidhide: "notInstalled" }, devices: [], ...p,
  } as unknown as EngineStatus;
}
function device(p: Record<string, unknown> = {}): DeviceSnapshot {
  return {
    device: { connection: "usb" },
    output: { requested: "xbox360", active: "xbox360", playerIndex: 0, retrying: false, lastError: null },
    ...p,
  } as unknown as DeviceSnapshot;
}
const all = (p: Partial<ReadinessInput> = {}): ReadinessInput => ({ status: status(), device: device(), phase: "live", consent: true, ...p });
const step = (i: ReadinessInput, id: string) => readinessSteps(i).find((s) => s.id === id)!;

test("everything in place is ready to play; the optional step never blocks", () => {
  const steps = readinessSteps(all());
  assert.deepEqual(steps.map((s) => s.state), ["done", "done", "done", "done", "optional"]);
  assert.equal(readyToPlay(steps), true);
});

test("no controller: plug in by USB, with what to try if it doesn't appear", () => {
  const s = step(all({ device: null }), "controller");
  assert.equal(s.state, "todo");
  assert.match(s.detail, /data cable/);
  assert.match(s.detail, /Steam, DS4Windows/);
  assert.equal(readyToPlay(readinessSteps(all({ device: null }))), false);
  assert.equal(step(all({ device: null }), "games").state, "waiting", "later steps wait for earlier ones");
});

test("a controller that stopped sending input says how to recover", () => {
  const s = step(all({ phase: "stale" }), "controller");
  assert.equal(s.state, "problem");
  assert.match(s.detail, /another USB port/);
  assert.match(s.detail, /nothing stays pressed/);
  assert.equal(step(all({ phase: "awaiting" }), "controller").state, "waiting");
  assert.equal(step(all({ device: device({ device: { connection: "bluetooth" } }) }), "controller").state, "problem");
});

test("ViGEmBus missing points to the official page; installed but unusable says restart", () => {
  const missing = step(all({ status: status({ outputBackendStatus: { state: "unavailable", reason: "not installed" }, drivers: { vigembus: "notInstalled", hidhide: "unknown" } }) }), "driver");
  assert.equal(missing.state, "todo");
  assert.deepEqual(missing.action, { label: "Get ViGEmBus", url: VIGEMBUS_RELEASES });
  assert.match(missing.detail, /never installs drivers/);
  const broken = step(all({ status: status({ outputBackendStatus: { state: "unavailable", reason: "Windows error 5." } }) }), "driver");
  assert.equal(broken.state, "problem");
  assert.match(broken.detail, /Windows error 5\. Restart Windows/);
});

test("virtual output off is a to-do with a shortcut to turn it on", () => {
  const s = step(all({ consent: false }), "output");
  assert.equal(s.state, "todo");
  assert.deepEqual(s.action, { label: "Open Virtual Output", page: "controller", tab: "output" });
  assert.equal(step(all({ status: status({ requestedOutput: "disabled" }) }), "output").state, "todo");
  assert.equal(step(all({ consent: null }), "output").state, "waiting");
});

test("games: wrong player slot, recreating after a driver error, or a last error, each with advice", () => {
  const slot = step(all({ device: device({ output: { active: "xbox360", playerIndex: 1, retrying: false, lastError: null } }) }), "games");
  assert.equal(slot.state, "problem");
  assert.match(slot.detail, /player 2/);
  assert.match(slot.detail, /Unplug the other controller/);
  const retry = step(all({ device: device({ output: { active: null, playerIndex: null, retrying: true, lastError: "x" } }) }), "games");
  assert.match(retry.detail, /creating it again by itself/);
  const err = step(all({ device: device({ output: { active: null, playerIndex: null, retrying: false, lastError: "Out of slots" } }) }), "games");
  assert.match(err.detail, /Out of slots/);
  assert.equal(step(all(), "games").action && "page" in step(all(), "games").action! ? "ok" : "no", "ok", "done links to Output Check");
});

test("double input: HidHide installed reminds about the allow list, otherwise optional advice", () => {
  assert.equal(step(all({ status: status({ drivers: { vigembus: "installed", hidhide: "installed" } }) }), "doubleInput").state, "done");
  assert.equal(step(all(), "doubleInput").state, "optional");
});
