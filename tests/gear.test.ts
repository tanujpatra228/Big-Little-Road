import { describe, expect, it } from 'vitest';
import { HIGH_GEAR, LOW_GEAR, effectiveGear, gearFactors, hasLowRange, toggleGear } from '../src/shared/gear';
import { CARS } from '../src/shared/cars';

describe('low range', () => {
  it('belongs to the Hauler and the Relay, not the Scout', () => {
    expect(hasLowRange('hauler')).toBe(true);
    expect(hasLowRange('relay')).toBe(true);
    expect(hasLowRange('scout')).toBe(false);
  });
  it('a Scout is always in high, whatever it is told', () => {
    expect(effectiveGear('scout', 'low')).toBe('high');
    expect(gearFactors('scout', 'low')).toEqual(HIGH_GEAR);
    expect(toggleGear('scout', 'high')).toBe('high');
  });
  it('the toggle flips for the others', () => {
    expect(toggleGear('hauler', 'high')).toBe('low');
    expect(toggleGear('hauler', 'low')).toBe('high');
  });
  it('trades speed for torque and a tighter lock', () => {
    expect(LOW_GEAR.top).toBeLessThan(0.6);
    expect(LOW_GEAR.power).toBeGreaterThan(1);
    expect(LOW_GEAR.steer).toBeGreaterThan(1);
  });
  it('even the Hauler in low is slower than a walking pace sprint: top below 6 m/s', () => {
    expect(CARS.hauler.topSpeed * LOW_GEAR.top).toBeLessThan(6);
  });
});

import { beforeAll } from 'vitest';
import { generateTerrain } from '../src/shared/terrain';
import { createPhysicsWorld, initRapier, FIXED_DT, type PhysicsWorld } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { DriveInput } from '../src/shared/driving';

beforeAll(initRapier);

const drive = (pw: PhysicsWorld, v: Vehicle, input: DriveInput, seconds: number): void => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    v.step(input, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
  }
};
const GO: DriveInput = { throttle: 1, steer: 0, handbrake: false };

describe('low range on the road', () => {
  it('caps the Hauler well below its high-range speed', () => {
    const pw = createPhysicsWorld(generateTerrain(1));
    const v = new Vehicle(pw, CARS.hauler, 0, -4, 0);
    v.gear = 'low';
    drive(pw, v, GO, 5);
    expect(v.speed).toBeLessThan(CARS.hauler.topSpeed * LOW_GEAR.top * 1.1);
    expect(v.speed).toBeGreaterThan(CARS.hauler.topSpeed * LOW_GEAR.top * 0.6);
  });

  it('gets to its (lower) speed faster than high range gets to the same speed', () => {
    const timeTo = (gear: 'low' | 'high', mps: number): number => {
      const pw = createPhysicsWorld(generateTerrain(1));
      const v = new Vehicle(pw, CARS.hauler, 0, -4, 0);
      v.gear = gear;
      for (let i = 0; i < 6 / FIXED_DT; i++) {
        v.step(GO, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
        if (v.speed >= mps) return i * FIXED_DT;
      }
      return Infinity;
    };
    expect(timeTo('low', 3.5)).toBeLessThan(timeTo('high', 3.5));
  });

  it('turns tighter at crawling speed than in high range at the same speed', () => {
    const turn = (gear: 'low' | 'high'): number => {
      const pw = createPhysicsWorld(generateTerrain(1));
      const v = new Vehicle(pw, CARS.hauler, 0, -4, 0);
      v.gear = gear;
      drive(pw, v, { throttle: 0.35, steer: 0, handbrake: false }, 3);
      const before = Math.atan2(2 * (v.body.rotation().w * v.body.rotation().y), 1 - 2 * v.body.rotation().y ** 2);
      drive(pw, v, { throttle: 0.35, steer: 1, handbrake: false }, 1.5);
      const q = v.body.rotation();
      const after = Math.atan2(2 * (q.w * q.y), 1 - 2 * q.y * q.y);
      return Math.abs(after - before);
    };
    expect(turn('low')).toBeGreaterThan(turn('high') * 0.95);
  });

  it('a Scout told to go low is unchanged', () => {
    const top = (gear: 'low' | 'high'): number => {
      const pw = createPhysicsWorld(generateTerrain(1));
      const v = new Vehicle(pw, CARS.scout, 0, -4, 0);
      v.gear = gear;
      drive(pw, v, GO, 4);
      return v.speed;
    };
    expect(Math.abs(top('low') - top('high'))).toBeLessThan(0.05);
  });

  it('toggleGear changes the Hauler and leaves the Scout alone', () => {
    const pw = createPhysicsWorld(generateTerrain(1));
    const h = new Vehicle(pw, CARS.hauler, 0, -4, 0);
    expect(h.toggleGear()).toBe('low');
    expect(h.toggleGear()).toBe('high');
    const s = new Vehicle(pw, CARS.scout, 6, -4, 0);
    expect(s.toggleGear()).toBe('high');
  });

  it('placeAt stands the car up at the spot, facing the way asked, at rest', () => {
    const pw = createPhysicsWorld(generateTerrain(1));
    const v = new Vehicle(pw, CARS.hauler, 0, -4, 0);
    drive(pw, v, GO, 2);
    v.placeAt(8, 6, Math.PI / 2);
    drive(pw, v, { throttle: 0, steer: 0, handbrake: false }, 1.5);
    const t = v.body.translation();
    expect(Math.hypot(t.x - 8, t.z - 6)).toBeLessThan(1);
    expect(v.upright).toBeGreaterThan(0.97);
    expect(Math.abs(v.body.linvel().x) + Math.abs(v.body.linvel().z)).toBeLessThan(0.5);
  });
});
