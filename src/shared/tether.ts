import { PLATFORM } from './terrain';

/**
 * The plank and the rope that two cars use to carry it. Pure geometry and physics-free rules.
 *
 * Why this is network-friendly: while two cars carry the plank, its pose is not simulated or sent.
 * Every browser places it between the two hitch points it already knows (its own car, and the
 * partner's smoothed pose). The only "physics" is a soft pull each client applies to its OWN car,
 * so there is nothing shared to fight over and nothing to keep in sync.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** Centre of the plank on the ground, and the heading of its long axis (0 points along +z). */
export interface PlankPose {
  x: number;
  z: number;
  yaw: number;
}

/** A board wide enough for a car to drive along: the Hauler is about 1.6 wide. */
export const PLANK = { length: 4, width: 1.9, thickness: 0.12, rope: 0.4 } as const;

/** Ideal distance between the two hitch points: plank plus a short rope at each end. */
export const REST_SPACING = PLANK.length + 2 * PLANK.rope;
/** No pull while the cars stay within this of the ideal spacing, so normal driving is free. */
export const DEADBAND = 0.45;
/** How close a hitch must be to a plank end to hook it. */
export const ATTACH_RANGE = 2.6;

/** Pull strength per metre of stretch beyond the deadband, in m/s^2. Tuned by the delay test. */
export const ROPE_STIFFNESS = 9;
/** Damping on the car's own speed along the rope, 1/s. Passive, so it can never add energy. */
export const ROPE_DAMPING = 4;
export const ROPE_MAX_ACCEL = 10;

const hypot = Math.hypot;

export function forward(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Where a lone car's tow hitch is: behind its tail. */
export function hitchPoint(car: Vec2, yaw: number, halfLength: number): Vec2 {
  const f = forward(yaw);
  const back = halfLength + 0.3;
  return { x: car.x - f.x * back, z: car.z - f.z * back };
}

/**
 * Where a car's hitch is while two cars carry the plank: the end of the car that faces its partner,
 * so two cars in convoy hold it between them like a stretcher, and side by side works too.
 */
export function hitchToward(car: Vec2, partner: Vec2, halfLength: number): Vec2 {
  const dx = partner.x - car.x;
  const dz = partner.z - car.z;
  const d = hypot(dx, dz);
  if (d < 1e-6) return { x: car.x, z: car.z };
  const reach = halfLength + 0.3;
  return { x: car.x + (dx / d) * reach, z: car.z + (dz / d) * reach };
}

/** The two ends of a resting plank. End 0 is behind its centre, end 1 ahead. */
export function plankEnds(p: PlankPose): [Vec2, Vec2] {
  const f = forward(p.yaw);
  const h = PLANK.length / 2;
  return [
    { x: p.x - f.x * h, z: p.z - f.z * h },
    { x: p.x + f.x * h, z: p.z + f.z * h },
  ];
}

/**
 * The plank pose while two cars carry it: centred between the hitches, along the line joining them.
 * `fallbackYaw` is used if the hitches coincide.
 */
export function carriedPose(h0: Vec2, h1: Vec2, fallbackYaw = 0): PlankPose {
  const dx = h1.x - h0.x;
  const dz = h1.z - h0.z;
  return { x: (h0.x + h1.x) / 2, z: (h0.z + h1.z) / 2, yaw: hypot(dx, dz) < 1e-6 ? fallbackYaw : Math.atan2(dx, dz) };
}

/**
 * Which free end of a resting plank a car can hook: the nearest one within reach of any part of
 * the car (its centre plus its half length plus a metre or so), so you can come at it from any side.
 */
export function nearestFreeEnd(plank: PlankPose, holders: readonly [string | null, string | null], car: Vec2, halfLength: number): 0 | 1 | null {
  const ends = plankEnds(plank);
  let best: 0 | 1 | null = null;
  let bestD = halfLength + ATTACH_RANGE - 0.9;
  for (const i of [0, 1] as const) {
    if (holders[i] !== null) continue;
    const d = hypot(ends[i].x - car.x, ends[i].z - car.z);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Pull on a car from the rope, as an acceleration so heavy and light cars feel alike.
 * Zero inside the deadband. Stretched: pulls toward the partner. Squeezed together: pushes apart.
 * `velocity` is this car's own velocity; damping uses only that, so the loop stays stable even
 * when the partner's position is a few hundred milliseconds old.
 */
export function ropeAccel(self: Vec2, partner: Vec2, velocity: Vec2): Vec2 {
  const dx = partner.x - self.x;
  const dz = partner.z - self.z;
  const d = hypot(dx, dz);
  if (d < 1e-6) return { x: 0, z: 0 };
  const ux = dx / d;
  const uz = dz / d;
  const excess = d - REST_SPACING;
  const over = Math.abs(excess) - DEADBAND;
  if (over <= 0) return { x: 0, z: 0 };
  const along = velocity.x * ux + velocity.z * uz;
  let a = Math.sign(excess) * over * ROPE_STIFFNESS - ROPE_DAMPING * along;
  a = Math.max(-ROPE_MAX_ACCEL, Math.min(ROPE_MAX_ACCEL, a));
  return { x: ux * a, z: uz * a };
}

/** The plank cannot stretch: hitch-to-hitch distance may exceed REST_SPACING by at most this. */
export const HARD_STRETCH = 1.0;
/** Nor can it be squeezed: the hitches may come this much closer than REST_SPACING at most. */
export const HARD_SQUEEZE = 1.2;
/** How early the leash starts braking: allowed closing speed = gain * distance left (1/s). */
export const LEASH_GAIN = 5;
/** Strongest push the leash may give, m/s^2. About 8 g, like hitting the end of a chain. */
export const LEASH_MAX_ACCEL = 80;

/**
 * The hard limit of a plank that does not stretch. Returns the velocity change for our own car this
 * physics step so the hitches never get further than REST_SPACING + HARD_STRETCH apart, or closer
 * than REST_SPACING - HARD_SQUEEZE. It only ever removes our own relative motion that would make
 * things worse, never reverses us and never tows the partner (the soft rope does that), so two browsers applying
 * it to their own cars cannot fight each other, even when each sees the other a few hundred
 * milliseconds late.
 * `partner` and `vPartner` should already be extrapolated to where the partner is now.
 */
export function ropeLeash(self: Vec2, partner: Vec2, vSelf: Vec2, vPartner: Vec2, dt: number): Vec2 {
  const dx = self.x - partner.x;
  const dz = self.z - partner.z;
  const d = hypot(dx, dz);
  if (d < 1e-6) return { x: 0, z: 0 };
  const nx = dx / d;
  const nz = dz / d;
  const rate = (vSelf.x - vPartner.x) * nx + (vSelf.z - vPartner.z) * nz; // positive: pulling apart
  const maxRate = Math.max(0, LEASH_GAIN * (REST_SPACING + HARD_STRETCH - d));
  const minRate = -Math.max(0, LEASH_GAIN * (d - (REST_SPACING - HARD_SQUEEZE)));
  const own = vSelf.x * nx + vSelf.z * nz; // our own speed away from the partner
  let dv = 0;
  // Only our own motion that makes it worse is removed, never more, so a stale view of the partner
  // can at worst stop us, not throw us back at it.
  if (rate > maxRate) dv = -Math.min(Math.max(own, 0), rate - maxRate);
  else if (rate < minRate) dv = Math.min(Math.max(-own, 0), minRate - rate);
  if (dv === 0) return { x: 0, z: 0 };
  const cap = LEASH_MAX_ACCEL * dt;
  dv = Math.max(-cap, Math.min(cap, dv));
  return { x: nx * dv, z: nz * dv };
}

/** 0 when the rope is slack, up to 1 when the leash is fully taut or fully squeezed. For visuals. */
export function ropeTension(d: number): number {
  const stretch = (d - REST_SPACING - DEADBAND) / (HARD_STRETCH - DEADBAND);
  const squeeze = (REST_SPACING - DEADBAND - d) / (HARD_SQUEEZE - DEADBAND);
  return Math.max(0, Math.min(1, Math.max(stretch, squeeze)));
}

/**
 * One car alone drags the plank behind it like a stick on a string: the far end only moves when
 * the string goes taut. Deterministic from the hitch path, so every browser draws about the same.
 */
export function trailFarEnd(farEnd: Vec2, hitch: Vec2): Vec2 {
  const reach = PLANK.rope + PLANK.length;
  const dx = farEnd.x - hitch.x;
  const dz = farEnd.z - hitch.z;
  const d = hypot(dx, dz);
  if (d < 1e-6) return { x: hitch.x, z: hitch.z - reach };
  if (d <= reach) return farEnd;
  return { x: hitch.x + (dx / d) * reach, z: hitch.z + (dz / d) * reach };
}

/** Plank pose for a plank held at one end and trailing: from the hitch toward the far end. */
export function trailingPose(hitch: Vec2, farEnd: Vec2, fallbackYaw = 0): PlankPose {
  const dx = farEnd.x - hitch.x;
  const dz = farEnd.z - hitch.z;
  const d = hypot(dx, dz);
  const yaw = d < 1e-6 ? fallbackYaw : Math.atan2(dx, dz);
  const f = forward(yaw);
  const mid = PLANK.rope + PLANK.length / 2;
  return { x: hitch.x + f.x * mid, z: hitch.z + f.z * mid, yaw };
}

/**
 * Where a plank lies on the ground: centre, and a rotation that follows the slope between its two
 * ends (so it can lean from lawn up to a platform). Used by the renderer and by the collider, and
 * tested, so what you see is what you drive on.
 */
export function plankPlacement(
  pose: PlankPose,
  heightAt: (x: number, z: number) => number,
  lift = 0,
): { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; pitch: number } {
  const [a, b] = plankEnds(pose);
  const ya = heightAt(a.x, a.z);
  const yb = heightAt(b.x, b.z);
  const pitch = Math.atan2(yb - ya, PLANK.length);
  // Yaw about up, then pitch about the plank's own side axis (raising the forward end).
  const sy = Math.sin(pose.yaw / 2);
  const cy = Math.cos(pose.yaw / 2);
  const sx = Math.sin(-pitch / 2);
  const cx = Math.cos(-pitch / 2);
  return {
    x: pose.x,
    y: (ya + yb) / 2 + PLANK.thickness / 2 + lift,
    z: pose.z,
    qx: cy * sx,
    qy: sy * cx,
    qz: -sy * sx,
    qw: cy * cx,
    pitch,
  };
}

/** Where a plank should lean when it is set down near the platform wall: the ramp. */
export const RAMP_SNAP_ANGLE = 0.7; // radians: how far off straight at the wall still snaps
export const RAMP_SNAP_REACH = PLANK.length + 3.5; // how far from the wall (plank centre) it still snaps

/**
 * If a plank is set down near the platform wall and roughly pointing at it, returns the pose that
 * leans it up onto the platform: radial, with its far end 0.4 m onto the top. Otherwise null.
 * The cars cannot do this themselves: the lead car stops at the wall, and the plank hangs behind it.
 */
export function snapRamp(pose: PlankPose, platform: { x: number; z: number; r: number } = PLATFORM): PlankPose | null {
  const dx = pose.x - platform.x;
  const dz = pose.z - platform.z;
  const d = hypot(dx, dz);
  if (d < platform.r + 0.5 || d > platform.r + RAMP_SNAP_REACH) return null;
  const toCentre = { x: -dx / d, z: -dz / d };
  const f = forward(pose.yaw);
  if (Math.abs(f.x * toCentre.x + f.z * toCentre.z) < Math.cos(RAMP_SNAP_ANGLE)) return null;
  const centreR = platform.r - 0.4 + PLANK.length / 2;
  return { x: platform.x - toCentre.x * centreR, z: platform.z - toCentre.z * centreR, yaw: Math.atan2(toCentre.x, toCentre.z) };
}
