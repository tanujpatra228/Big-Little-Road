import { beforeAll, describe, expect, it } from 'vitest';
import { CAR_ORDER, CARS, type CarRole } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { createPhysicsWorld, initRapier, FIXED_DT, type PhysicsWorld } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

const step = (pw: PhysicsWorld, v: Vehicle, throttle = 1, n = 1): void => {
  for (let i = 0; i < n; i++) {
    v.step({ throttle, steer: 0, handbrake: false }, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
  }
};

/** Gets a car to speed on flat ground. */
function atSpeed(role: CarRole, seconds = 3): { pw: PhysicsWorld; v: Vehicle } {
  const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
  const v = new Vehicle(pw, CARS[role], 0, -250, 0);
  step(pw, v, 1, seconds * 60);
  return { pw, v };
}

describe('switching car keeps momentum', () => {
  it.each(CAR_ORDER.flatMap((a) => CAR_ORDER.filter((b) => b !== a).map((b) => [a, b] as const)))('%s to %s: same velocity, heading and position', (from, to) => {
    const { pw, v } = atSpeed(from);
    const before = { v: v.body.linvel(), t: v.body.translation(), q: v.body.rotation() };
    const next = Vehicle.transformFrom(pw, v, CARS[to]);
    const lv = next.body.linvel();
    const t = next.body.translation();
    expect(Math.hypot(lv.x - before.v.x, lv.y - before.v.y, lv.z - before.v.z)).toBeLessThan(1e-6);
    expect(Math.hypot(t.x - before.t.x, t.z - before.t.z)).toBeLessThan(1e-6);
    const q = next.body.rotation();
    expect(Math.abs(q.x * before.q.x + q.y * before.q.y + q.z * before.q.z + q.w * before.q.w)).toBeGreaterThan(0.99999);
    expect(pw.world.bodies.len()).toBe(1); // the old body is gone
  });

  it('the first step after the swap is not mistaken for a crash', () => {
    const { pw, v } = atSpeed('scout');
    const next = Vehicle.transformFrom(pw, v, CARS.relay);
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      step(pw, next, 1, 1);
      worst = Math.max(worst, next.consumeImpact()?.intensity ?? 0);
    }
    expect(worst).toBe(0);
  });

  it('keeps going forward at nearly the same speed over the next moments (lighter to heavier)', () => {
    const { pw, v } = atSpeed('scout', 1.6); // under the Hauler's top speed
    const v0 = v.forwardSpeed();
    const next = Vehicle.transformFrom(pw, v, CARS.hauler);
    step(pw, next, 1, 30);
    expect(next.forwardSpeed()).toBeGreaterThan(v0 * 0.8);
    expect(next.body.translation().z).toBeGreaterThan(-250 + 4);
  });

  it('a faster car turning into a slower one eases down to the new top speed instead of stopping dead', () => {
    const { pw, v } = atSpeed('scout', 4);
    const fast = v.forwardSpeed();
    expect(fast).toBeGreaterThan(CARS.hauler.topSpeed * 1.2);
    const next = Vehicle.transformFrom(pw, v, CARS.hauler);
    step(pw, next, 1, 10);
    expect(next.forwardSpeed()).toBeGreaterThan(fast * 0.8); // still carrying most of it after a sixth of a second
    step(pw, next, 1, 60 * 5);
    expect(next.forwardSpeed()).toBeLessThan(CARS.hauler.topSpeed * 1.15); // settled near the new top speed
    expect(next.forwardSpeed()).toBeGreaterThan(CARS.hauler.topSpeed * 0.7);
    expect(next.upright).toBeGreaterThan(0.9); // and never flipped
  });

  it('keeps the steering angle and the spin of a car that is mid-turn', () => {
    const { pw, v } = atSpeed('relay', 2);
    for (let i = 0; i < 40; i++) {
      v.step({ throttle: 0.6, steer: 1, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
    }
    const steer = v.steerCommand;
    const yawRate = v.body.angvel().y;
    expect(Math.abs(steer)).toBeGreaterThan(0.1);
    const next = Vehicle.transformFrom(pw, v, CARS.scout);
    expect(next.steerCommand).toBeCloseTo(steer, 9);
    expect(next.body.angvel().y).toBeCloseTo(yawRate, 9);
  });

  it('in the air it keeps its tilt and its rotation, and lands on its wheels like any other car', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const v = new Vehicle(pw, CARS.scout, 0, 0, 0);
    v.body.setTranslation({ x: 0, y: 4, z: 0 }, true);
    v.body.setRotation({ x: 0.1, y: 0, z: 0.05, w: 0.99 }, true);
    v.body.setAngvel({ x: 0.5, y: 0, z: 0 }, true);
    v.body.setLinvel({ x: 0, y: 3, z: 6 }, true);
    step(pw, v, 0, 10);
    const rot = v.body.angvel();
    const y0 = v.body.translation().y;
    const next = Vehicle.transformFrom(pw, v, CARS.hauler);
    expect(next.body.angvel().x).toBeCloseTo(rot.x, 9);
    expect(next.body.translation().y).toBeGreaterThan(y0 - 0.5); // not dropped into the floor or launched
    step(pw, next, 0, 60 * 4);
    expect(next.grounded).toBeGreaterThanOrEqual(3);
    expect(next.upright).toBeGreaterThan(0.9);
  });

  it('adjusts the ride height so the new wheels do not start in the ground', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
    const v = new Vehicle(pw, CARS.scout, 0, 0, 0);
    step(pw, v, 0, 120);
    const next = Vehicle.transformFrom(pw, v, CARS.relay);
    step(pw, next, 0, 90);
    expect(next.body.translation().y).toBeGreaterThan(0.5); // sits properly on its wheels
    expect(next.grounded).toBe(4);
  });

  it('can be switched back and forth repeatedly without leaking bodies or breaking', () => {
    const { pw, v: first } = atSpeed('scout', 2);
    let v = first;
    for (let i = 0; i < 12; i++) {
      v = Vehicle.transformFrom(pw, v, CARS[CAR_ORDER[(i + 1) % 3]!]);
      step(pw, v, 1, 8);
    }
    expect(pw.world.bodies.len()).toBe(1);
    expect(Number.isFinite(v.body.translation().z)).toBe(true);
    expect(v.forwardSpeed()).toBeGreaterThan(3);
  });
});
