import { beforeAll, describe, expect, it } from 'vitest';
import { generateTerrain, ROCK, SPAWN } from '../src/shared/terrain';
import { generateBoulders, type Boulder } from '../src/shared/boulders';
import { Surface } from '../src/shared/surfaces';
import { CARS } from '../src/shared/cars';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import { flatTerrain } from './flat-world';

describe('boulders', () => {
  const t = generateTerrain(20260);
  const boulders = generateBoulders(t);

  it('is deterministic', () => {
    expect(generateBoulders(generateTerrain(20260)).slice(0, 5)).toEqual(boulders.slice(0, 5));
  });

  it('fills the rock field with a meaningful number of rocks', () => {
    expect(boulders.length).toBeGreaterThan(30);
  });

  it('keeps them inside the rock field, on rock, away from the spawn', () => {
    for (const b of boulders) {
      expect(Math.hypot(b.x - ROCK.x, b.z - ROCK.z)).toBeLessThan(ROCK.r);
      expect(t.surfaceAt(b.x, b.z)).toBe(Surface.Rock);
      expect(Math.hypot(b.x - SPAWN.x, b.z - SPAWN.z)).toBeGreaterThan(20);
    }
  });

  it('leaves a gap a car can drive through', () => {
    for (const a of boulders) for (const b of boulders) {
      if (a === b) continue;
      expect(Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius).toBeGreaterThan(2.2);
    }
  });
});

describe('a boulder is a solid hazard', () => {
  beforeAll(initRapier);

  function drive(boulder: Boulder | null): { x: number; z: number } {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass), boulder ? [boulder] : []);
    const v = new Vehicle(pw, CARS.hauler, 0, -10, 0);
    for (let i = 0; i < 5 / FIXED_DT; i++) {
      v.step({ throttle: i < 20 ? 0 : 1, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
    }
    const t = v.body.translation();
    return { x: t.x, z: t.z };
  }

  it('a car driving straight at one is stopped or thrown off its line', () => {
    const clear = drive(null);
    expect(clear.z).toBeGreaterThan(15);
    expect(Math.abs(clear.x)).toBeLessThan(0.3);

    const hit = drive({ x: 0, y: 0.7, z: 0, radius: 1.4, rx: 0, ry: 0, rz: 0 });
    const blocked = hit.z < 3;
    const deflected = Math.abs(hit.x) > 0.5;
    expect(blocked || deflected).toBe(true);
  });
});
