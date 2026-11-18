// Test-only helper: builds ControllerState values for unit tests.
import type { ControllerState } from "../types/engine";

export function stateOf(patch: Omit<Partial<ControllerState>, "buttons"> & { buttons?: Partial<ControllerState["buttons"]> } = {}): ControllerState {
  const stick = { x: 0, y: 0, rawX: 128, rawY: 128 };
  const trig = { value: 0, raw: 0, digital: false };
  const base: ControllerState = {
    leftStick: { ...stick }, rightStick: { ...stick }, leftTrigger: { ...trig }, rightTrigger: { ...trig },
    dpad: "neutral",
    buttons: { south: false, east: false, west: false, north: false, leftShoulder: false, rightShoulder: false,
      leftStick: false, rightStick: false, start: false, select: false, home: false, touchpad: false, mute: false },
    touchpad: { points: [{ active: false, id: 0, x: 0, y: 0 }, { active: false, id: 1, x: 0, y: 0 }], width: 1920, height: 1080 },
    motion: { gyroRaw: [0, 0, 0], accelRaw: [0, 8192, 0], sensorTimestamp: 0 },
    battery: { percent: 55, status: "discharging" },
    sequence: 0, format: "dualSenseUsb",
  };
  return { ...base, ...patch, buttons: { ...base.buttons, ...(patch.buttons ?? {}) } };
}

export const trigger = (raw: number) => ({ value: raw / 255, raw, digital: raw >= 128 });
export const stick = (x: number, y: number) => ({ x, y, rawX: Math.round(x * 127 + 128), rawY: Math.round(-y * 127 + 128) });
