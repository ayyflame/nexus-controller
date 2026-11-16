import { test } from "node:test";
import assert from "node:assert/strict";
import { doubleInputAdvice } from "./hidhide.ts";

test("double-input advice", () => {
  assert.equal(doubleInputAdvice({ hidhide: "notInstalled", outputActive: false, controllerConnected: true }), "notNeeded");
  assert.equal(doubleInputAdvice({ hidhide: "notInstalled", outputActive: true, controllerConnected: true }), "suggestHidHide");
  assert.equal(doubleInputAdvice({ hidhide: "installed", outputActive: true, controllerConnected: true }), "hidHideInstalled");
  // HidHide may be hiding the DualSense from NEXUS itself.
  assert.equal(doubleInputAdvice({ hidhide: "installed", outputActive: false, controllerConnected: false }), "checkApplicationsList");
  assert.equal(doubleInputAdvice({ hidhide: "unknown", outputActive: false, controllerConnected: false }), "notNeeded");
});
