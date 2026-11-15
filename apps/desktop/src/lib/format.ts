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
};

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
