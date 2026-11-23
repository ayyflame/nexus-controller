import type {
  BackendStatus, ConnectionType, ControllerModel, DeviceEvent, ReportFormat, VirtualOutputKind,
} from "../types/engine";

export const connectionLabel: Record<ConnectionType, string> = {
  usb: "USB",
  bluetooth: "Bluetooth",
  unknown: "Undetermined",
};

export const modelLabel: Record<ControllerModel, string> = {
  dualSense: "DualSense",
  dualSenseEdge: "DualSense Edge",
  dualShock4: "DualShock 4",
};

/** Sony product IDs of the DualShock 4 hardware revisions NEXUS supports. */
const DS4_REVISIONS: Record<number, string> = { 0x05c4: "CUH-ZCT1", 0x09cc: "CUH-ZCT2" };

/** Model with its hardware revision where it is known, e.g. "DualShock 4 (CUH-ZCT2)". */
export function modelWithRevision(model: ControllerModel, productId: number): string {
  const rev = model === "dualShock4" ? DS4_REVISIONS[productId] : undefined;
  return rev ? `${modelLabel[model]} (${rev})` : modelLabel[model];
}

/** What to call the controller in messages: its model when one is connected. */
export function controllerName(device: { device: { model: ControllerModel } } | null | undefined): string {
  return device ? modelLabel[device.device.model] : "controller";
}

/** Supported controllers, for messages shown before one is connected. */
export const SUPPORTED_CONTROLLERS = "DualSense or DualShock 4";

export const outputLabel: Record<VirtualOutputKind, string> = {
  disabled: "Disabled",
  xbox360: "Xbox 360",
  dualShock4: "DualShock 4",
};

export const formatLabel: Record<ReportFormat, string> = {
  unknown: "Unknown",
  dualSenseUsb: "USB report 0x01",
  dualSenseBluetooth: "Bluetooth report 0x31",
  dualSenseBluetoothBasic: "Bluetooth basic report 0x01",
  dualShock4Usb: "DualShock 4 USB report 0x01",
};

export function backendReady(s: BackendStatus): boolean {
  return s.state === "ready";
}

export function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

export function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false });
}

export function describeDeviceEvent(e: DeviceEvent): string {
  switch (e.type) {
    case "connected":
      return `${modelLabel[e.device.model]} connected (${connectionLabel[e.device.connection]})`;
    case "disconnected":
      return e.reason.kind === "error"
        ? `Controller lost: ${e.reason.detail}`
        : e.reason.kind === "shutdown"
          ? "Controller released"
          : "Controller disconnected";
    case "openFailed":
      return `Could not open controller: ${e.error}`;
    case "virtualDeviceIgnored":
      return `Ignored virtual ${modelLabel[e.model]}`;
    case "duplicateIgnored":
      return "Ignored duplicate controller interface";
    case "enumerationFailed":
      return `Device enumeration failed`;
  }
}
