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

/** USB vendor and product ID as Windows shows them, e.g. "054C:0CE6". */
export function usbIdText(vendorId: number, productId: number): string {
  const h = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  return `${h(vendorId)}:${h(productId)}`;
}

/** A duration in seconds as "45 s", "3 min 05 s" or "2 h 04 min". */
export function durationText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
