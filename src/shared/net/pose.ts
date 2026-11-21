import type { PoseFrame } from './protocol';

export interface PoseState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** m/s along the nose */
  v: number;
  /** radians */
  steer: number;
}

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));

/** World state to wire frame: whole centimetres and 1/10000 quaternion parts. */
export function quantizePose(p: PoseState, seq: number, t: number): PoseFrame {
  const n = Math.hypot(p.qx, p.qy, p.qz, p.qw) || 1;
  return {
    s: seq,
    t: Math.max(0, Math.round(t)),
    x: clampInt(p.x * 100, -10000, 10000),
    y: clampInt(p.y * 100, -5000, 5000),
    z: clampInt(p.z * 100, -10000, 10000),
    qx: clampInt((p.qx / n) * 10000, -10000, 10000),
    qy: clampInt((p.qy / n) * 10000, -10000, 10000),
    qz: clampInt((p.qz / n) * 10000, -10000, 10000),
    qw: clampInt((p.qw / n) * 10000, -10000, 10000),
    v: clampInt(p.v * 10, -1000, 1000),
    st: clampInt(p.steer * 1000, -1500, 1500),
  };
}

export function dequantizePose(f: PoseFrame): PoseState {
  return { x: f.x / 100, y: f.y / 100, z: f.z / 100, qx: f.qx / 10000, qy: f.qy / 10000, qz: f.qz / 10000, qw: f.qw / 10000, v: f.v / 10, steer: f.st / 1000 };
}

/**
 * How often to send a pose. 10 Hz while moving, 2 Hz while nearly still, and nothing once parked
 * for a few seconds. Parked cars are re-announced when someone joins. This keeps the free-plan
 * message budget small.
 */
export const MOVING_INTERVAL_MS = 100;
export const STILL_INTERVAL_MS = 500;
export const PARK_AFTER_MS = 4000;

export function nextPoseDelay(speed: number, stillForMs: number): number | null {
  if (Math.abs(speed) > 0.4) return MOVING_INTERVAL_MS;
  if (stillForMs >= PARK_AFTER_MS) return null;
  return STILL_INTERVAL_MS;
}
