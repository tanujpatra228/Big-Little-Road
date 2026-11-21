import { describe, expect, it } from 'vitest';
import {
  DEADBAND, PLANK, RAMP_SNAP_ANGLE, REST_SPACING, ROPE_MAX_ACCEL, carriedPose, forward, hitchPoint, hitchToward, nearestFreeEnd,
  plankEnds, ropeAccel, snapRamp, trailFarEnd, trailingPose, type PlankPose, type Vec2,
} from '../src/shared/tether';

const near = (a: number, b: number, tol = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('plank geometry', () => {
  it('ends are plank-length apart, along the heading', () => {
    const [a, b] = plankEnds({ x: 3, z: -2, yaw: Math.PI / 2 }); // pointing along +x
    near(Math.hypot(b.x - a.x, b.z - a.z), PLANK.length);
    expect(b.x).toBeGreaterThan(a.x);
    near(a.z, -2);
    near(b.z, -2);
  });

  it('a car heading +z has its hitch behind it (smaller z)', () => {
    const h = hitchPoint({ x: 0, z: 0 }, 0, 0.9);
    expect(h.z).toBeLessThan(-1);
    near(h.x, 0);
  });

  it('carried pose sits at the midpoint, along the line between the cars', () => {
    const p = carriedPose({ x: 0, z: 0 }, { x: 0, z: 4.8 });
    near(p.x, 0);
    near(p.z, 2.4);
    near(p.yaw, 0);
    const q = carriedPose({ x: 0, z: 0 }, { x: 4.8, z: 0 });
    near(q.yaw, Math.PI / 2);
  });

  it('survives both hitches on the same spot', () => {
    expect(carriedPose({ x: 1, z: 1 }, { x: 1, z: 1 }, 0.7).yaw).toBe(0.7);
  });
});

describe('hooking', () => {
  const plank: PlankPose = { x: 10, z: 10, yaw: 0 };
  const [end0, end1] = plankEnds(plank);
  const half = 0.9;

  it('picks the nearer free end, coming at it from any side', () => {
    expect(nearestFreeEnd(plank, [null, null], { x: end0.x + 0.5, z: end0.z - 1 }, half)).toBe(0);
    expect(nearestFreeEnd(plank, [null, null], { x: end1.x - 1, z: end1.z + 1 }, half)).toBe(1);
    expect(nearestFreeEnd(plank, [null, null], { x: end0.x + 2, z: end0.z }, half)).toBe(0); // from the side of the plank
  });

  it('ignores an end someone already holds, and anything out of reach', () => {
    expect(nearestFreeEnd(plank, ['p1', null], { x: end0.x, z: end0.z }, half)).toBeNull();
    expect(nearestFreeEnd(plank, [null, null], { x: 40, z: 40 }, half)).toBeNull();
    expect(nearestFreeEnd(plank, [null, null], { x: end0.x, z: end0.z - half - 2.5 }, half)).toBeNull();
  });

  it('a car in front hooks with its tail, a car behind hooks with its nose: a convoy holds the plank like a stretcher', () => {
    // Lead car at z=10 facing +z, follower at z=-2 facing +z, plank between them.
    const lead = hitchToward({ x: 0, z: 10 }, { x: 0, z: -2 }, half);
    const follower = hitchToward({ x: 0, z: -2 }, { x: 0, z: 10 }, half);
    expect(lead.z).toBeLessThan(10); // toward the follower: its tail
    expect(follower.z).toBeGreaterThan(-2); // toward the lead: its nose
    expect(Math.hypot(lead.x - follower.x, lead.z - follower.z)).toBeCloseTo(12 - 2 * (half + 0.3), 9);
  });

  it('side by side works too, and coincident cars do not blow up', () => {
    const left = hitchToward({ x: -2.4, z: 0 }, { x: 2.4, z: 0 }, half);
    expect(left.x).toBeGreaterThan(-2.4);
    expect(hitchToward({ x: 1, z: 1 }, { x: 1, z: 1 }, half)).toEqual({ x: 1, z: 1 });
  });
});

describe('leaning the plank on the platform wall', () => {
  const R = 8;
  const platform = { x: 0, z: 0, r: R };
  const centreR = R - 0.4 + PLANK.length / 2;

  it('snaps a plank set down near the wall, pointing roughly at it, into a radial ramp with its far end on top', () => {
    const rough: PlankPose = { x: -9.5, z: 1.2, yaw: Math.atan2(1, -0.12) + 0.3 }; // west of the platform, a bit crooked
    const snapped = snapRamp(rough, platform)!;
    expect(snapped).not.toBeNull();
    expect(Math.hypot(snapped.x, snapped.z)).toBeCloseTo(centreR, 9);
    const [, far] = plankEnds(snapped);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(R - 0.4, 9); // 0.4 m onto the top
    // And it points at the centre.
    const f = forward(snapped.yaw);
    expect(f.x * snapped.x + f.z * snapped.z).toBeLessThan(0);
  });

  it('keeps the angle the player chose around the platform', () => {
    for (const a of [0, 1, 2.5, -2]) {
      const p: PlankPose = { x: Math.cos(a) * 10.5, z: Math.sin(a) * 10.5, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) };
      const s = snapRamp(p, platform)!;
      expect(Math.atan2(s.z, s.x)).toBeCloseTo(a, 6);
    }
  });

  it('does not snap a plank that is far away, across the wall, or pointing sideways', () => {
    expect(snapRamp({ x: -30, z: 0, yaw: Math.PI / 2 }, platform)).toBeNull(); // too far
    expect(snapRamp({ x: -3, z: 0, yaw: Math.PI / 2 }, platform)).toBeNull(); // already on the platform
    expect(snapRamp({ x: -10, z: 0, yaw: 0 }, platform)).toBeNull(); // tangent to the wall, not pointing at it
    const justOver = snapRamp({ x: -10, z: 0, yaw: Math.PI / 2 + RAMP_SNAP_ANGLE + 0.05 }, platform);
    expect(justOver).toBeNull();
  });

  it('works whichever way the plank points along the line (either end first)', () => {
    expect(snapRamp({ x: -10, z: 0, yaw: Math.PI / 2 }, platform)).not.toBeNull();
    expect(snapRamp({ x: -10, z: 0, yaw: -Math.PI / 2 }, platform)).not.toBeNull();
  });
});

describe('rope pull', () => {
  const still: Vec2 = { x: 0, z: 0 };

  it('does nothing inside the deadband', () => {
    expect(ropeAccel({ x: 0, z: 0 }, { x: 0, z: REST_SPACING + DEADBAND * 0.9 }, still)).toEqual({ x: 0, z: 0 });
    expect(ropeAccel({ x: 0, z: 0 }, { x: 0, z: REST_SPACING - DEADBAND * 0.9 }, still)).toEqual({ x: 0, z: 0 });
  });

  it('pulls toward the partner when stretched, and pushes away when squeezed', () => {
    expect(ropeAccel({ x: 0, z: 0 }, { x: 0, z: REST_SPACING + 2 }, still).z).toBeGreaterThan(0);
    expect(ropeAccel({ x: 0, z: 0 }, { x: 0, z: 1.5 }, still).z).toBeLessThan(0);
  });

  it('is capped so a far-away partner cannot yank a car', () => {
    const a = ropeAccel({ x: 0, z: 0 }, { x: 0, z: 100 }, still);
    expect(Math.hypot(a.x, a.z)).toBeLessThanOrEqual(ROPE_MAX_ACCEL + 1e-9);
  });

  it('damps motion along the rope, using only the car\'s own speed', () => {
    const slow = ropeAccel({ x: 0, z: 0 }, { x: 0, z: REST_SPACING + 2 }, { x: 0, z: 0 });
    const closing = ropeAccel({ x: 0, z: 0 }, { x: 0, z: REST_SPACING + 2 }, { x: 0, z: 5 });
    expect(closing.z).toBeLessThan(slow.z);
  });
});

describe('one car dragging the plank alone', () => {
  it('the far end stays put until the string goes taut, then keeps its distance', () => {
    const hitch = { x: 0, z: 0 };
    const far = { x: 0, z: -(PLANK.rope + PLANK.length) + 1 }; // slack
    expect(trailFarEnd(far, hitch)).toEqual(far);
    const taut = trailFarEnd(far, { x: 0, z: 10 });
    near(Math.hypot(taut.x - 0, taut.z - 10), PLANK.rope + PLANK.length, 1e-6);
  });

  it('swings in behind a car that turns (drags in circles)', () => {
    let far: Vec2 = { x: 0, z: -4.4 };
    let hitch: Vec2 = { x: 0, z: 0 };
    for (let i = 0; i < 120; i++) {
      hitch = { x: 8 * Math.sin(i * 0.05), z: 8 * (1 - Math.cos(i * 0.05)) }; // driving a circle
      far = trailFarEnd(far, hitch);
    }
    near(Math.hypot(far.x - hitch.x, far.z - hitch.z), PLANK.rope + PLANK.length, 1e-6);
    const pose = trailingPose(hitch, far);
    const f = forward(pose.yaw);
    // The plank points from the hitch toward the far end.
    near(Math.hypot(pose.x - (hitch.x + f.x * (PLANK.rope + PLANK.length / 2)), pose.z - (hitch.z + f.z * (PLANK.rope + PLANK.length / 2))), 0, 1e-6);
  });
});

/**
 * Two cars joined by the rope, each pulled toward where it SEES its partner, which is the partner's
 * pose from `delay` seconds ago (network latency plus the 100 ms interpolation delay). That delay
 * inside a feedback loop is exactly what can make a spring oscillate and blow up.
 */
function simulate(delay: number, kick: number): { peakEarly: number; peakLate: number; finalExcess: number; maxSep: number } {
  const dt = 1 / 60;
  const steps = 60 * 30;
  const lag = Math.round(delay / dt);
  const drag = 0.6; // 1/s, a little rolling resistance
  const a = { x: 0, v: 0 };
  const b = { x: REST_SPACING, v: 0 };
  const histA: number[] = [];
  const histB: number[] = [];
  let peakEarly = 0;
  let peakLate = 0;
  let maxSep = 0;
  for (let i = 0; i < steps; i++) {
    histA.push(a.x);
    histB.push(b.x);
    const seenB = histB[Math.max(0, histB.length - 1 - lag)]!;
    const seenA = histA[Math.max(0, histA.length - 1 - lag)]!;
    // Driver B gets shoved at t = 1 s, as if player B punched the throttle.
    const push = i >= 60 && i < 120 ? kick : 0;
    const accA = ropeAccel({ x: a.x, z: 0 }, { x: seenB, z: 0 }, { x: a.v, z: 0 }).x - drag * a.v;
    // B's partner is on its other side; ropeAccel works out the pull direction from the geometry.
    const accB = ropeAccel({ x: b.x, z: 0 }, { x: seenA, z: 0 }, { x: b.v, z: 0 }).x - drag * b.v + push;
    a.v += accA * dt;
    b.v += accB * dt;
    a.x += a.v * dt;
    b.x += b.v * dt;
    const excess = Math.abs(b.x - a.x - REST_SPACING);
    maxSep = Math.max(maxSep, b.x - a.x);
    if (i < steps / 2) peakEarly = Math.max(peakEarly, excess);
    else peakLate = Math.max(peakLate, excess);
  }
  return { peakEarly, peakLate, finalExcess: Math.abs(b.x - a.x - REST_SPACING), maxSep };
}

describe('rope stays stable with a delayed view of the partner (the week-4 risk)', () => {
  it.each([0, 0.15, 0.25, 0.4, 0.6])('settles and never diverges at %f s of delay', (delay) => {
    const r = simulate(delay, 6);
    expect(r.maxSep).toBeLessThan(REST_SPACING + 8); // a hard shove stretches it, never runs away
    expect(r.peakLate).toBeLessThanOrEqual(r.peakEarly); // oscillation does not grow
    expect(r.finalExcess).toBeLessThan(DEADBAND + 0.8); // and it ends up near the ideal spacing
  });

  it('even a hard sustained shove never lets the cars drift apart without bound', () => {
    expect(simulate(0.5, 12).maxSep).toBeLessThan(REST_SPACING + 14);
  });
});
