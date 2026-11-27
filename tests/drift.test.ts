import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER, type CarRole } from '../src/shared/cars';
import {
  DRIFT, DriftState, EXIT_SPEED, MAX_ASSIST, MIN_DRIFT_SPEED, MIN_DRIFT_TIME, SLIDABLE_GRIP, slipAngle, type DriftInput,
} from '../src/shared/drift';
import { Surface, SURFACE_PROPS } from '../src/shared/surfaces';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

const input = (o: Partial<DriftInput> = {}): DriftInput => ({ role: 'scout', speed: 12, slip: 0, steer: 0, handbrake: false, grounded: true, surfaceGrip: 1, forward: true, ...o });

describe('slip angle', () => {
  it('is zero going where you point, in either direction of travel along the nose', () => {
    expect(slipAngle(0, 10, 0)).toBeCloseTo(0, 5);
    expect(slipAngle(10, 0, Math.PI / 2)).toBeCloseTo(0, 5);
  });
  it('is positive when the car slides toward the driver\'s right and negative toward the left', () => {
    // Facing +z, the driver's right is -x.
    expect(slipAngle(-5, 10, 0)).toBeGreaterThan(0.4);
    expect(slipAngle(5, 10, 0)).toBeLessThan(-0.4);
  });
  it('a sideways car is about a quarter turn out', () => {
    expect(Math.abs(slipAngle(-10, 0.001, 0))).toBeCloseTo(Math.PI / 2, 1);
  });
});

describe('the drift states', () => {
  it('does not start slowly, in the air, on mud or water, or in reverse', () => {
    for (const o of [{ speed: MIN_DRIFT_SPEED - 0.5 }, { grounded: false }, { surfaceGrip: SURFACE_PROPS[Surface.Mud].grip }, { surfaceGrip: SURFACE_PROPS[Surface.Water].grip }, { forward: false }]) {
      const d = new DriftState();
      d.update(0.016, input({ handbrake: true, ...o }));
      expect(d.active, JSON.stringify(o)).toBe(false);
    }
  });

  it('a handbrake at speed starts it, and steering hard past the slip threshold does too', () => {
    const a = new DriftState();
    a.update(0.016, input({ handbrake: true }));
    expect(a.active).toBe(true);
    const b = new DriftState();
    b.update(0.016, input({ steer: 1, slip: DRIFT.scout.enterSlip + 0.05 }));
    expect(b.active).toBe(true);
    const c = new DriftState();
    c.update(0.016, input({ steer: 1, slip: DRIFT.scout.enterSlip - 0.05 }));
    expect(c.active).toBe(false);
    const e = new DriftState();
    e.update(0.016, input({ steer: 0.3, slip: 0.9 }));
    expect(e.active).toBe(false);
  });

  it('a handbrake without a slide is given time to bite, then ends once the slide has gone', () => {
    const d = new DriftState();
    d.update(0.016, input({ handbrake: true }));
    for (let t = 0; t < MIN_DRIFT_TIME - 0.1; t += 0.016) d.update(0.016, input({ slip: 0 }));
    expect(d.active).toBe(true);
    for (let t = 0; t < 0.3; t += 0.016) d.update(0.016, input({ slip: 0 }));
    expect(d.active).toBe(false);
  });

  it('holds while the slide is wide and ends when it falls below the exit slip, or the speed drops', () => {
    const d = new DriftState();
    d.update(0.016, input({ steer: 1, slip: 0.5 }));
    for (let t = 0; t < 2; t += 0.016) d.update(0.016, input({ slip: 0.4 }));
    expect(d.active).toBe(true);
    d.update(0.016, input({ slip: DRIFT.scout.exitSlip - 0.02 }));
    expect(d.active).toBe(false);
    const s = new DriftState();
    s.update(0.016, input({ steer: 1, slip: 0.5 }));
    for (let t = 0; t < 1; t += 0.016) s.update(0.016, input({ slip: 0.4 }));
    s.update(0.016, input({ slip: 0.4, speed: EXIT_SPEED - 0.5 }));
    expect(s.active).toBe(false);
  });

  it('ends after being airborne for a moment, but not on a bump', () => {
    const d = new DriftState();
    d.update(0.016, input({ steer: 1, slip: 0.5 }));
    d.update(0.1, input({ slip: 0.5, grounded: false }));
    expect(d.active).toBe(true);
    d.update(0.3, input({ slip: 0.5, grounded: false }));
    expect(d.active).toBe(false);
  });
});

describe('what a drift asks of the tyres', () => {
  const deep = (role: CarRole, slip: number) => {
    const d = new DriftState();
    d.update(0.016, input({ role, steer: 1, slip: Math.max(slip, DRIFT[role].enterSlip + 0.05) }));
    let o = d.update(0.016, input({ role, slip, steer: 1 }));
    for (let i = 0; i < 40; i++) o = d.update(0.016, input({ role, slip, steer: 1 }));
    return o;
  };

  it('rear grip falls as the slide deepens, but never below the car\'s floor, and is back near the cap', () => {
    for (const role of CAR_ORDER) {
      const t = DRIFT[role];
      const light = deep(role, t.exitSlip * 0.6).rearGrip;
      const mid = deep(role, t.maxSlip * 0.55).rearGrip;
      const atCap = deep(role, t.maxSlip * 1.05).rearGrip;
      expect(mid, role).toBeLessThan(light);
      expect(mid, role).toBeGreaterThanOrEqual(t.rearGripMin - 1e-9);
      expect(atCap, role).toBeGreaterThan(mid); // regrips near the cap so it never spins
      expect(light, role).toBeLessThanOrEqual(1);
    }
  });

  it('the front wheels counter-steer toward the velocity, within a limit, with the driver\'s own steering reduced', () => {
    const right = deep('scout', 0.6);
    expect(right.assist).toBeGreaterThan(0.1);
    expect(right.assist).toBeLessThanOrEqual(MAX_ASSIST);
    expect(deep('scout', -0.6).assist).toBeLessThan(-0.1);
    expect(right.steerScale).toBeLessThan(1);
  });

  it('drag is relieved a little, more in a deeper slide', () => {
    expect(deep('scout', 0.6).dragScale).toBeLessThan(1);
    expect(deep('scout', 0.6).dragScale).toBeLessThanOrEqual(deep('scout', 0.25).dragScale);
  });

  it('the handbrake keeps the old rear grip as a ceiling', () => {
    const d = new DriftState();
    const o = d.update(0.016, input({ handbrake: true }));
    expect(o.rearGrip).toBeLessThanOrEqual(DRIFT.scout.handbrakeGrip);
  });

  it('the Scout slides easiest and furthest, the Hauler least: enter slip, slip cap, grip floor all in order', () => {
    expect(DRIFT.scout.enterSlip).toBeLessThan(DRIFT.relay.enterSlip);
    expect(DRIFT.relay.enterSlip).toBeLessThan(DRIFT.hauler.enterSlip);
    expect(DRIFT.scout.maxSlip).toBeGreaterThan(DRIFT.relay.maxSlip);
    expect(DRIFT.relay.maxSlip).toBeGreaterThan(DRIFT.hauler.maxSlip);
    expect(DRIFT.scout.rearGripMin).toBeLessThan(DRIFT.hauler.rearGripMin);
    expect(SLIDABLE_GRIP).toBeGreaterThan(SURFACE_PROPS[Surface.Mud].grip);
    expect(SLIDABLE_GRIP).toBeLessThan(SURFACE_PROPS[Surface.Sand].grip + 0.05);
  });
});

/** A run: get up to speed, kick the tail out with the handbrake and steer, hold the slide, then let go and recover. */
function slide(role: CarRole, surface: Surface) {
  const pw = createPhysicsWorld(flatTerrain(surface));
  const v = new Vehicle(pw, CARS[role], 0, -200, 0);
  const step = (i: { throttle: number; steer: number; handbrake: boolean }, seconds: number, each?: () => void): void => {
    for (let n = 0; n < seconds / FIXED_DT; n++) {
      v.step(i, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
      each?.();
    }
  };
  step({ throttle: 1, steer: 0, handbrake: false }, 5);
  const entry = Math.hypot(v.body.linvel().x, v.body.linvel().z);
  let maxSlip = 0;
  let minUpright = 1;
  let wasActive = false;
  let speedInSlide = entry;
  const watch = (): void => {
    maxSlip = Math.max(maxSlip, Math.abs(v.slip));
    minUpright = Math.min(minUpright, v.upright);
    if (v.drift.active) wasActive = true;
  };
  step({ throttle: 0.8, steer: 1, handbrake: true }, 0.9, watch);
  step({ throttle: 0.8, steer: 0.5, handbrake: false }, 1.6, () => {
    watch();
    speedInSlide = Math.min(speedInSlide, Math.hypot(v.body.linvel().x, v.body.linvel().z));
  });
  const slipAtRelease = Math.abs(v.slip);
  step({ throttle: 0.5, steer: 0, handbrake: false }, 4, watch);
  return { entry, maxSlip, minUpright, wasActive, speedInSlide, slipAtEnd: Math.abs(v.slip), activeAtEnd: v.drift.active, flipped: v.isFlipped, slipAtRelease, nitro: v.nitro.level };
}

describe.each(CAR_ORDER)('%s drifting, in real physics', (role) => {
  for (const surface of [Surface.Patio, Surface.Grass, Surface.Gravel, Surface.Sand]) {
    it(`on ${Surface[surface]}: starts, never flips, holds the slip under the cap, keeps speed, and recovers`, () => {
      const r = slide(role, surface);
      expect(r.wasActive).toBe(r.entry > MIN_DRIFT_SPEED + 0.5); // too slow to start (a Hauler in sand) is not a failure
      expect(r.flipped).toBe(false);
      expect(r.minUpright).toBeGreaterThan(0.9);
      expect(r.maxSlip).toBeLessThan(DRIFT[role].maxSlip * 1.15);
      // Speed is kept: a Scout in a deep slide gives up the most, the heavier cars almost nothing.
      expect(r.speedInSlide).toBeGreaterThan(r.entry * (role === 'scout' ? 0.35 : 0.8));
      expect(r.activeAtEnd).toBe(false);
      expect(r.slipAtEnd).toBeLessThan(0.15);
    });
  }

  for (const surface of [Surface.Mud, Surface.Water]) {
    it(`on ${Surface[surface]}: never becomes a drift`, () => {
      const r = slide(role, surface);
      expect(r.wasActive).toBe(false);
      expect(r.flipped).toBe(false);
    });
  }

  it('a drift on the patio charges the personal nitro tank (when it is not already full)', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
    const v = new Vehicle(pw, CARS[role], 0, -200, 0);
    v.nitro.level = 0.2;
    const step = (i: { throttle: number; steer: number; handbrake: boolean }, s: number): void => {
      for (let n = 0; n < s / FIXED_DT; n++) {
        v.step(i, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
      }
    };
    step({ throttle: 1, steer: 0, handbrake: false }, 5);
    const before = v.nitro.level;
    step({ throttle: 0.8, steer: 1, handbrake: true }, 0.9);
    step({ throttle: 0.8, steer: 0.5, handbrake: false }, 1.6);
    expect(v.nitro.level).toBeGreaterThan(before);
  });
});

describe('driving normally is unchanged', () => {
  it('a straight run never starts a drift', () => {
    for (const role of CAR_ORDER) {
      const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
      const v = new Vehicle(pw, CARS[role], 0, -200, 0);
      let ever = false;
      for (let n = 0; n < 6 / FIXED_DT; n++) {
        v.step({ throttle: 1, steer: 0, handbrake: false }, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
        if (v.drift.active) ever = true;
      }
      expect(ever, role).toBe(false);
    }
  });

  it('a gentle turn at speed does not either', () => {
    for (const role of CAR_ORDER) {
      const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
      const v = new Vehicle(pw, CARS[role], 0, -200, 0);
      let ever = false;
      for (let n = 0; n < 8 / FIXED_DT; n++) {
        v.step({ throttle: n < 4 / FIXED_DT ? 1 : 0.6, steer: n < 4 / FIXED_DT ? 0 : 0.35, handbrake: false }, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
        if (v.drift.active) ever = true;
      }
      expect(ever, role).toBe(false);
    }
  });
});
