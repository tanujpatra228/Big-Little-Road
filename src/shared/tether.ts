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

export const PLANK = { length: 4, width: 0.55, thickness: 0.12, rope: 0.4 } as const;

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

/** Where a car's tow hitch is: behind its tail. */
export function hitchPoint(car: Vec2, yaw: number, halfLength: number): Vec2 {
  const f = forward(yaw);
  const back = halfLength + 0.3;
  return { x: car.x - f.x * back, z: car.z - f.z * back };
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

/** Which free end of a resting plank is within reach of this hitch, if any. */
export function nearestFreeEnd(plank: PlankPose, holders: readonly [string | null, string | null], hitch: Vec2): 0 | 1 | null {
  const ends = plankEnds(plank);
  let best: 0 | 1 | null = null;
  let bestD = ATTACH_RANGE;
  for (const i of [0, 1] as const) {
    if (holders[i] !== null) continue;
    const d = hypot(ends[i].x - hitch.x, ends[i].z - hitch.z);
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
