/**
 * Orbit camera maths, pure so it can be tested. The camera circles the car at a distance, steered by
 * dragging. Conventions match the chase camera: yaw 0 puts the camera behind a car facing +z, and
 * a positive pitch lifts the camera above the horizon.
 */

export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
}

/** Lowest and highest the camera may go, radians. Never below the horizon, never past straight down. */
export const PITCH_MIN = 0.04;
export const PITCH_MAX = 1.45;
export const DIST_MIN = 3;
export const DIST_MAX = 18;
export const DIST_DEFAULT = 7.5;
export const PITCH_DEFAULT = 0.38;
/** Radians per pixel of drag. */
export const DRAG_SENSITIVITY = 0.0055;
/** Gamepad right stick, radians per second at full tilt. */
export const STICK_SPEED = 2.6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function clampOrbit(s: OrbitState): OrbitState {
  return { yaw: wrap(s.yaw), pitch: clamp(s.pitch, PITCH_MIN, PITCH_MAX), distance: clamp(s.distance, DIST_MIN, DIST_MAX) };
}

/**
 * Drag like grabbing the scene: pulling right swings the camera to the left around the car, and
 * pulling down lifts it. `dx`, `dy` are pixels.
 */
export function dragOrbit(s: OrbitState, dx: number, dy: number, sensitivity = DRAG_SENSITIVITY): OrbitState {
  return clampOrbit({ ...s, yaw: s.yaw - dx * sensitivity, pitch: s.pitch + dy * sensitivity });
}

/** Wheel zoom: `delta` > 0 zooms out. Each notch is a few percent, so it feels the same at any distance. */
export function zoomOrbit(s: OrbitState, delta: number): OrbitState {
  return clampOrbit({ ...s, distance: s.distance * Math.exp(clamp(delta, -400, 400) * 0.0012) });
}

/** Where the camera sits relative to the point it looks at. */
export function orbitOffset(s: OrbitState): { x: number; y: number; z: number } {
  const c = Math.cos(s.pitch);
  return { x: -Math.sin(s.yaw) * c * s.distance, y: Math.sin(s.pitch) * s.distance, z: -Math.cos(s.yaw) * c * s.distance };
}

/** The orbit that matches a chase view, so switching cameras does not jump. */
export function orbitFromChase(yaw: number, distance: number, height: number): OrbitState {
  return clampOrbit({ yaw, pitch: Math.atan2(height, distance), distance: Math.hypot(distance, height) });
}

/**
 * Keeps the camera out of the ground: if the wanted position is under `minY`, lift it. Returns the
 * adjusted height (the caller decides the terrain height and clearance).
 */
export function aboveGround(y: number, groundY: number, clearance = 0.8): number {
  return Math.max(y, groundY + clearance);
}
