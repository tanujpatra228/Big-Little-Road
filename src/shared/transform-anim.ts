/**
 * Timeline of the car transformation. Pure numbers, so it can be tested.
 * 0.00 to 0.25 s: the old car squashes down while a flash builds.
 * 0.25 s: swap, hidden by the flash.
 * 0.25 to 0.75 s: the new car springs up from squashed, overshoots, and settles at normal size.
 */
export const TRANSFORM_DURATION = 0.75;
export const SWAP_AT = 0.25;

export interface Scale3 {
  x: number;
  y: number;
  z: number;
}

/** The squashed pose at the moment of the swap: wide and flat. Both cars share it, so nothing jumps. */
export const SQUASHED: Readonly<Scale3> = { x: 1.2, y: 0.42, z: 1.2 };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeIn = (u: number): number => u * u;

/** Overshoot then settle, ending exactly at 1. */
function easeOutBack(u: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  const x = u - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Scale of the car being replaced, for t in 0 to SWAP_AT. */
export function outgoingScale(t: number): Scale3 {
  const k = easeIn(clamp01(t / SWAP_AT));
  return { x: lerp(1, SQUASHED.x, k), y: lerp(1, SQUASHED.y, k), z: lerp(1, SQUASHED.z, k) };
}

/** Scale of the new car, for t from SWAP_AT to TRANSFORM_DURATION. Exactly 1 at the end. */
export function incomingScale(t: number): Scale3 {
  const u = clamp01((t - SWAP_AT) / (TRANSFORM_DURATION - SWAP_AT));
  const k = easeOutBack(u); // 0 to a little over 1, then back to 1
  return { x: lerp(SQUASHED.x, 1, k), y: lerp(SQUASHED.y, 1, k), z: lerp(SQUASHED.z, 1, k) };
}

/** Brightness of the flash, 0 to 1, peaking at the swap. */
export function flashStrength(t: number): number {
  if (t < 0.1 || t > 0.6) return 0;
  return t < SWAP_AT ? (t - 0.1) / (SWAP_AT - 0.1) : 1 - (t - SWAP_AT) / (0.6 - SWAP_AT);
}

/** 0 to 1 progress of the ground shockwave ring, which starts a little after the squash begins. */
export function ringProgress(t: number): number {
  return clamp01((t - 0.15) / 0.55);
}
