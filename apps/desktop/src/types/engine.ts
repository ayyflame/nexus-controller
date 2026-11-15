// TypeScript mirror of the Rust types serialised over Tauri IPC.
// Source of truth: crates/controller-core, crates/engine, crates/virtual-controller,
// crates/telemetry, crates/profile-manager, apps/desktop/src-tauri/src/commands.rs.
// The JSON shape of DeviceEvent is pinned by a Rust test
// (controller-core: device_event_json_shape_matches_frontend_contract).

export type ConnectionType = "usb" | "bluetooth" | "unknown";
export type ControllerModel = "dualSense" | "dualSenseEdge";
export type DeviceOrigin = "physical" | "virtual" | "unknown";
export type VirtualOutputKind = "disabled" | "xbox360" | "dualShock4";

export interface ConnectedDevice {
  id: string;
  model: ControllerModel;
  connection: ConnectionType;
  origin: DeviceOrigin;
  vendorId: number;
  productId: number;
  productName: string | null;
  serialNumber: string | null;
}

export interface StickState { x: number; y: number; rawX: number; rawY: number }
export interface TriggerState { value: number; raw: number; digital: boolean }
export type DpadDirection =
  | "neutral" | "up" | "upRight" | "right" | "downRight"
  | "down" | "downLeft" | "left" | "upLeft";

export interface Buttons {
  south: boolean; east: boolean; west: boolean; north: boolean;
  leftShoulder: boolean; rightShoulder: boolean;
  leftStick: boolean; rightStick: boolean;
  start: boolean; select: boolean; home: boolean; touchpad: boolean; mute: boolean;
}

export interface TouchPoint { active: boolean; id: number; x: number; y: number }
export interface TouchpadState { points: [TouchPoint, TouchPoint]; width: number; height: number }
export interface MotionState { gyroRaw: [number, number, number]; accelRaw: [number, number, number]; sensorTimestamp: number }
export type BatteryStatus = "discharging" | "charging" | "full" | "error" | "unknown";
export interface BatteryState { percent: number; status: BatteryStatus }
export type ReportFormat = "unknown" | "dualSenseUsb" | "dualSenseBluetooth" | "dualSenseBluetoothBasic";

export interface ControllerState {
  leftStick: StickState;
  rightStick: StickState;
  leftTrigger: TriggerState;
  rightTrigger: TriggerState;
  dpad: DpadDirection;
  buttons: Buttons;
  touchpad: TouchpadState | null;
  motion: MotionState | null;
  battery: BatteryState | null;
  sequence: number | null;
  format: ReportFormat;
}

export type BackendStatus =
  | { state: "ready"; version: string | null }
  | { state: "unavailable"; reason: string };

export interface OutputStatus {
  requested: VirtualOutputKind;
  active: VirtualOutputKind | null;
  backend: string;
  backendStatus: BackendStatus;
  lastError: string | null;
}

export interface DeviceSnapshot {
  device: ConnectedDevice;
  connectedAtMs: number;
  input: ControllerState | null;
  lastReportMs: number | null;
  reportRateHz: number;
  totalReports: number;
  parseErrors: number;
  lastParseError: string | null;
  output: OutputStatus;
}

export interface EngineStatus {
  revision: number;
  hidBackend: string;
  hidAvailable: boolean;
  enumerationError: string | null;
  requestedOutput: VirtualOutputKind;
  outputBackend: string;
  outputBackendStatus: BackendStatus;
  devices: DeviceSnapshot[];
}

export type DisconnectReason =
  | { kind: "removed" }
  | { kind: "shutdown" }
  | { kind: "error"; detail: string };

export type DeviceEvent =
  | { type: "connected"; device: ConnectedDevice }
  | { type: "disconnected"; deviceId: string; reason: DisconnectReason }
  | { type: "openFailed"; deviceId: string; error: string; retryInMs: number }
  | { type: "virtualDeviceIgnored"; deviceId: string; model: ControllerModel }
  | { type: "duplicateIgnored"; deviceId: string; existing: string }
  | { type: "enumerationFailed"; error: string };

export type LogLevel = "info" | "warn" | "error";
export interface LogEntry { timestampMs: number; level: LogLevel; category: string; message: string }

export type EngineEvent =
  | { kind: "device"; data: DeviceEvent }
  | { kind: "log"; data: LogEntry };

export interface RawReport { timestampMs: number; deviceId: string; bytes: number[]; parseError: string | null }

export interface Profile {
  id: number;
  name: string;
  virtualOutput: VirtualOutputKind;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  dataDir: string | null;
  storageWarning: string | null;
}

export interface CommandError { message: string }
