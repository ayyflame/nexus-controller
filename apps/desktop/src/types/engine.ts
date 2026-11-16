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
  /** Physical input exactly as read from the controller. */
  input: ControllerState | null;
  /** What games would receive: input after processing and macros. */
  processed: ControllerState | null;
  /** IDs of macros playing on this controller right now. */
  playingMacros: string[];
  /** Time NEXUS spends per report (processing, macros, output). */
  pipelineLatency: LatencySummary;
  /** Reports missing per the controller's sequence counter (estimate). */
  sequenceGaps: number;
  /** Time between input reports since connect (USB stability). */
  reportIntervals: { intervals: number; minUs: number; meanUs: number; maxUs: number; over8ms: number; over50ms: number };
  outputReportsSent: number;
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
  hotplugActive: boolean;
  enumerationError: string | null;
  requestedOutput: VirtualOutputKind;
  outputBackend: string;
  outputBackendStatus: BackendStatus;
  devices: DeviceSnapshot[];
  macros: MacroRuntimeStatus;
  drivers: DriverStatus;
  stats: EngineStats;
  gyroCalibrating: boolean;
}

export interface EngineStats { connects: number; disconnects: number; connectionErrors: number }
export interface GyroCalibration { bias: [number, number, number]; samples: number; steady: boolean }

export interface LatencySummary { p50Us: number; p99Us: number; maxUs: number; samples: number }

export type DriverPresence = "installed" | "notInstalled" | "unknown";
export interface DriverStatus { vigembus: DriverPresence; hidhide: DriverPresence }

export interface MacroRuntimeStatus {
  armed: number;
  gamesCanReceive: boolean;
  blockedReason: string | null;
  recording: RecordingStatus | null;
}

export interface RecordingStatus {
  elapsedMs: number;
  presses: number;
  held: MacroButton[];
  limitReached: boolean;
  interrupted: boolean;
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
  processing: ProcessingConfig;
  games: string[];
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

export interface CommandError { message: string; issues?: ValidationIssue[] }

// ---- Macros (crates/macro-engine) ----

export type MacroButton =
  | "south" | "east" | "west" | "north"
  | "leftShoulder" | "rightShoulder" | "leftTrigger" | "rightTrigger"
  | "leftStick" | "rightStick" | "start" | "select" | "home" | "touchpad" | "mute"
  | "dpadUp" | "dpadDown" | "dpadLeft" | "dpadRight";

export type PlaybackMode = "once" | "repeatWhileHeld" | "toggle";

export interface MacroStep {
  id: string;
  buttons: MacroButton[];
  holdMs: number;
  delayAfterMs: number;
}

export interface Macro {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: MacroStep[];
  trigger: MacroButton | null;
  mode: PlaybackMode;
  repeatDelayMs: number;
  blockTrigger: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ValidationIssue { field: string; message: string }

export interface RecordingResult {
  steps: MacroStep[];
  durationMs: number;
  presses: number;
  limitReached: boolean;
}

/** What Windows reported for one HID collection (serial/MAC masked). */
export interface HidDiagnostic {
  path: string;
  vendorId: number;
  productId: number;
  releaseNumber: number;
  usagePage: number;
  usage: number;
  inputReportLen: number;
  outputReportLen: number;
  featureReportLen: number;
  manufacturer: string | null;
  product: string | null;
  serialMasked: string | null;
  instanceId: string | null;
  ancestorInstanceIds: string[];
  identifiedModel: ControllerModel | null;
  connection: ConnectionType | null;
  origin: DeviceOrigin | null;
}

// ---- Processing (crates/input-processing/src/config.rs) ----

export type DeadzoneShape = "radial" | "axial";
export interface CurvePoint { x: number; y: number }
export type ResponseCurve =
  | { type: "linear" }
  | { type: "power"; exponent: number }
  | { type: "custom"; points: CurvePoint[] };

export interface StickConfig {
  deadzone: number;
  outerDeadzone: number;
  antiDeadzone: number;
  sensitivity: number;
  curve: ResponseCurve;
  shape: DeadzoneShape;
  circular: boolean;
  invertX: boolean;
  invertY: boolean;
  sensitivityX: number;
  sensitivityY: number;
  squareOutput: boolean;
  calibration: StickCalibration;
}

export interface StickCalibration { centerX: number; centerY: number; minX: number; maxX: number; minY: number; maxY: number }

export interface TriggerConfig {
  deadzone: number; maxInput: number; outputMin: number; outputMax: number;
  activation: number; curve: number; rawMin: number; rawMax: number;
}

export interface RemapRule { from: MacroButton; to: MacroButton | null; also?: MacroButton[] }

export type LayerMode = "hold" | "toggle";
export interface MappingLayer { name: string; activator: MacroButton; mode: LayerMode; remap: RemapRule[] }

export type GyroActivation = "always" | "whileHeld" | "toggle";
export interface GyroConfig {
  enabled: boolean; activation: GyroActivation; button: MacroButton | null; suppressButton: boolean;
  fullScaleDps: number; sensitivityX: number; sensitivityY: number; invertX: boolean; invertY: boolean;
  smoothing: number; thresholdDps: number; horizontalAxis: "yaw" | "roll"; bias: [number, number, number];
}

export type TouchLayout = "whole" | "leftRight" | "quadrants";
export interface TouchpadConfig {
  layout: TouchLayout; zones: [MacroButton | null, MacroButton | null, MacroButton | null, MacroButton | null];
  swipesEnabled: boolean; swipeDistance: number; swipeMaxMs: number;
  swipeUp: MacroButton | null; swipeDown: MacroButton | null; swipeLeft: MacroButton | null; swipeRight: MacroButton | null;
  swipePressMs: number;
}

export interface FeedbackConfig {
  lightbarEnabled: boolean; color: [number, number, number]; brightness: number;
  connectionColors: boolean; usbColor: [number, number, number]; bluetoothColor: [number, number, number];
  playerLedsEnabled: boolean; playerLeds: number; playerLedBrightness: number; rumbleIntensity: number;
}

export interface ConfigConflict { message: string }

export interface ProfileTemplate { id: string; name: string; description: string }
export interface ExportResult { path: string | null; json: string }
export type ImportMode = "add" | "replace";
export interface ImportPreview { profiles: string[]; macros: string[]; renamed: string[]; exportedAtMs: number; appVersion: string }
export interface ImportReport { profilesAdded: number; macrosAdded: number; renamed: string[]; disabledForConflicts: string[] }

export interface ProcessingConfig {
  leftStick: StickConfig;
  rightStick: StickConfig;
  leftTrigger: TriggerConfig;
  rightTrigger: TriggerConfig;
  remap: RemapRule[];
  layers: MappingLayer[];
  gyro: GyroConfig;
  touchpad: TouchpadConfig;
  feedback: FeedbackConfig;
}
