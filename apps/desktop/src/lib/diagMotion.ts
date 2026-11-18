// Gyroscope and accelerometer readouts from the DualSense's own reports.
//
// NEXUS does not apply the controller's factory IMU calibration, so the
// converted units are estimates: the gyro uses the same scale as gyro aiming
// (16.384 counts per °/s, the ±2000 °/s range) and the accelerometer 8192
// counts per g (±4 g range). The raw counts are exact.

import type { ControllerState } from "../types/engine";

export const GYRO_COUNTS_PER_DPS = 16.384;
export const ACCEL_COUNTS_PER_G = 8192;

export type Vec3 = [number, number, number];

export const gyroDps = (raw: Vec3): Vec3 => raw.map((v) => v / GYRO_COUNTS_PER_DPS) as Vec3;
export const accelG = (raw: Vec3): Vec3 => raw.map((v) => v / ACCEL_COUNTS_PER_G) as Vec3;

export interface Tilt {
  /** Forward/back tilt and left/right tilt in degrees, from gravity only. */
  pitchDeg: number;
  rollDeg: number;
  magnitudeG: number;
  /** Close to 1 g: the controller is still enough for tilt to mean something. */
  steady: boolean;
}

/**
 * Tilt from the gravity vector. Assumes the axis that reads about +1 g with
 * the controller lying flat is Y (as in the DualSense report); yaw (turning
 * on the table) cannot be measured from gravity and is not shown.
 */
export function tiltFrom(g: Vec3): Tilt | null {
  const [x, y, z] = g;
  const magnitudeG = Math.hypot(x, y, z);
  if (!Number.isFinite(magnitudeG) || magnitudeG < 0.2) return null;
  const deg = (r: number) => (r * 180) / Math.PI;
  return {
    pitchDeg: deg(Math.atan2(z, Math.hypot(x, y))),
    rollDeg: deg(Math.atan2(x, Math.hypot(y, z))),
    magnitudeG,
    steady: Math.abs(magnitudeG - 1) < 0.15,
  };
}

export type MotionAvailability = { available: true } | { available: false; reason: string };

export function motionAvailability(s: ControllerState | null): MotionAvailability {
  if (!s) return { available: false, reason: "No controller input yet." };
  if (s.motion) return { available: true };
  if (s.format === "dualSenseBluetoothBasic") {
    return { available: false, reason: "This report format carries no motion data." };
  }
  return { available: false, reason: "The controller's reports don't include motion data." };
}
