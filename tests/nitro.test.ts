import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER, type CarRole } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { BLEND_IN_RATE, MAX_NITRO_TOP, NitroTank, REGEN_DELAY, REGEN_PER_SECOND, RESTART_LEVEL, TANK_SECONDS, boostFactor } from '../src/shared/nitro';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { DriveInput } from '../src/shared/driving';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);
const dt = 1 / 60;

describe('nitro tank', () => {
  it('starts full and drains over its tank time while boosting', () => {
    const t = new NitroTank();
    expect(t.level).toBe(1);
    for (let i = 0; i < 60 * (TANK_SECONDS - 0.5); i++) t.update(true, dt);
    expect(t.level).toBeCloseTo(0.125, 1);
    expect(t.active).toBe(true);
  });

  it('stops dead when empty and stays off until a fifth is back', () => {
    const t = new NitroTank();
    for (let i = 0; i < 60 * (TANK_SECONDS + 1); i++) t.update(true, dt);
    expect(t.level).toBe(0);
    expect(t.active).toBe(false);
    // Holding the key does nothing while locked out, and it refills slowly.
    let steps = 0;
    while (!t.active && steps < 60 * 60) {
      t.update(true, dt);
      steps++;
    }
    // The refill pause has already passed while it sat empty, so only the fifth is left to regain.
    const waited = steps * dt;
    expect(waited).toBeGreaterThan((RESTART_LEVEL / REGEN_PER_SECOND) * 0.9);
    expect(waited).toBeLessThan(REGEN_DELAY + (RESTART_LEVEL / REGEN_PER_SECOND) * 1.2);
  });

  it('refills slowly, after a pause, and not past full', () => {
    const t = new NitroTank();
    for (let i = 0; i < 60 * 2; i++) t.update(true, dt); // 2 s used, level 0.5
    const used = t.level;
    for (let i = 0; i < 60 * REGEN_DELAY * 0.9; i++) t.update(false, dt);
    expect(t.level).toBe(used); // still in the pause
    for (let i = 0; i < 60 * 8; i++) t.update(false, dt);
    expect(t.level).toBeGreaterThan(used + 0.3);
    for (let i = 0; i < 60 * 60; i++) t.update(false, dt);
    expect(t.level).toBe(1);
  });

  it('boost fades in over a fraction of a second and out more slowly', () => {
    const t = new NitroTank();
    t.update(true, dt);
    expect(t.blend).toBeCloseTo(BLEND_IN_RATE * dt);
    for (let i = 0; i < 60; i++) t.update(true, dt);
    expect(t.blend).toBe(1);
    t.update(false, dt);
    expect(t.blend).toBeGreaterThan(0.9);
  });

  it('tapping is not a free trick: extra force only while running, top speed fades', () => {
    const f = boostFactor(0.8, false, 1.6, 1.3);
    expect(f.force).toBe(1);
    expect(f.top).toBeGreaterThan(1.2);
    const g = boostFactor(1, true, 1.6, 1.3);
    expect(g.force).toBeCloseTo(1.6);
    expect(g.top).toBeCloseTo(1.3);
  });

  it('the global top-speed cap holds whatever a car asks for', () => {
    expect(boostFactor(1, true, 2, 3).top).toBe(MAX_NITRO_TOP);
    for (const r of CAR_ORDER) expect(CARS[r].nitroTop).toBeLessThanOrEqual(MAX_NITRO_TOP);
  });
});

const GO = (nitro: boolean): DriveInput => ({ throttle: 1, steer: 0, handbrake: false, nitro });

/** Straight-line best speed: `warm` seconds unboosted, then `burst` seconds with the key held (or not). */
function topWithBurst(role: CarRole, surface: Surface, boost: boolean, warm = 12, burst = 3.5): number {
  const pw = createPhysicsWorld(flatTerrain(surface));
  const v = new Vehicle(pw, CARS[role], 0, -250, 0);
  let best = 0;
  for (let i = 0; i < (warm + burst) * 60; i++) {
    v.step(i < 30 ? { throttle: 0, steer: 0, handbrake: false } : GO(boost && i >= warm * 60), FIXED_DT);
    pw.world.step();
    v.afterPhysics();
    if (i > warm * 60) best = Math.max(best, v.forwardSpeed());
  }
  return best;
}

describe.each(CAR_ORDER)('%s nitro on real physics', (role) => {
  it('is faster, but never past the boosted speed limit of the surface, on every surface', () => {
    for (const s of [Surface.Grass, Surface.Patio, Surface.Sand, Surface.Mud, Surface.Gravel]) {
      const plain = topWithBurst(role, s, false);
      const boosted = topWithBurst(role, s, true);
      expect(boosted).toBeGreaterThan(plain * 1.03);
      // Never above the surface's own speed limit scaled by the car's boost (itself capped globally).
      const surfaceTop = CARS[role].topSpeed * CARS[role].surfaceSpeed[s];
      expect(boosted).toBeLessThan(surfaceTop * Math.min(CARS[role].nitroTop, MAX_NITRO_TOP) + 0.3);
    }
  });

  it('never makes a surface faster than grass-with-nitro', () => {
    const grass = topWithBurst(role, Surface.Grass, true);
    for (const s of [Surface.Sand, Surface.Mud, Surface.Gravel, Surface.Water]) {
      expect(topWithBurst(role, s, true)).toBeLessThanOrEqual(grass + 0.2);
    }
  });

  it('accelerates harder from a standstill', () => {
    const at = (boost: boolean): number => {
      const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
      const v = new Vehicle(pw, CARS[role], 0, -250, 0);
      for (let i = 0; i < 60 * 3; i++) {
        v.step(i < 30 ? { throttle: 0, steer: 0, handbrake: false } : GO(boost), FIXED_DT);
        pw.world.step();
        v.afterPhysics();
      }
      return v.forwardSpeed();
    };
    expect(at(true)).toBeGreaterThan(at(false) * 1.08);
  });

  it('holding the key with no throttle spends nothing', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const v = new Vehicle(pw, CARS[role], 0, -250, 0);
    for (let i = 0; i < 120; i++) {
      v.step({ throttle: 0, steer: 0, handbrake: false, nitro: true }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
    }
    expect(v.nitro.level).toBe(1);
  });

  it('an empty tank ends the boost and the speed settles back to normal', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const v = new Vehicle(pw, CARS[role], 0, -250, 0);
    let late = 0;
    for (let i = 0; i < 60 * 24; i++) {
      v.step(i < 30 ? { throttle: 0, steer: 0, handbrake: false } : GO(true), FIXED_DT);
      pw.world.step();
      v.afterPhysics();
      if (i > 60 * 22) late = Math.max(late, v.forwardSpeed());
    }
    expect(v.nitro.level).toBeLessThan(0.99);
    expect(late).toBeLessThan(CARS[role].topSpeed * 1.05);
  });

  it('does not flip in a hard boosted turn at speed', () => {
    for (const steer of [1, -1]) {
      const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
      const v = new Vehicle(pw, CARS[role], 0, -250, 0);
      let minUp = 1;
      for (let i = 0; i < 60 * 14; i++) {
        const turning = i > 60 * 9 && i < 60 * 12.5;
        v.step({ throttle: 1, steer: turning ? steer : 0, handbrake: false, nitro: i > 60 * 8.5 }, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
        if (i > 60 * 9) minUp = Math.min(minUp, v.upright);
      }
      expect(minUp).toBeGreaterThan(0.6);
    }
  });
});
