import { test } from "node:test";
import assert from "node:assert/strict";
import { controllerName, formatLabel, modelLabel, modelWithRevision } from "./format.ts";
import { describeDeviceEvent } from "./format.ts";
import type { ConnectedDevice } from "../types/engine";

const ds4: ConnectedDevice = {
  id: "p", model: "dualShock4", connection: "usb", origin: "physical", vendorId: 0x054c, productId: 0x09cc,
  productName: "Wireless Controller", serialNumber: null, outputReportLen: 32,
} as ConnectedDevice;

test("DualSense and DualShock 4 are told apart", () => {
  assert.equal(modelLabel.dualSense, "DualSense");
  assert.equal(modelLabel.dualShock4, "DualShock 4");
  assert.notEqual(modelLabel.dualShock4, modelLabel.dualSense);
  assert.equal(formatLabel.dualShock4Usb, "DualShock 4 USB report 0x01");
});

test("the DualShock 4 revision is named from its product ID", () => {
  assert.equal(modelWithRevision("dualShock4", 0x05c4), "DualShock 4 (CUH-ZCT1)");
  assert.equal(modelWithRevision("dualShock4", 0x09cc), "DualShock 4 (CUH-ZCT2)");
  assert.equal(modelWithRevision("dualShock4", 0x1234), "DualShock 4");
  assert.equal(modelWithRevision("dualSense", 0x0ce6), "DualSense", "no revision table for the DualSense");
});

test("messages name the connected controller", () => {
  assert.equal(controllerName({ device: ds4 }), "DualShock 4");
  assert.equal(controllerName(null), "controller");
  assert.equal(describeDeviceEvent({ type: "connected", device: ds4 }), "DualShock 4 connected (USB)");
  assert.equal(describeDeviceEvent({ type: "virtualDeviceIgnored", deviceId: "v", model: "dualShock4" }), "Ignored virtual DualShock 4");
});
