import { beforeAll, describe, expect, it } from 'vitest';
import { generateTerrain, ROCK, SPAWN } from '../src/shared/terrain';
import { generateBoulders, type Boulder } from '../src/shared/boulders';
import { Surface } from '../src/shared/surfaces';
import { CARS, CAR_ORDER, type CarRole } from '../src/shared/cars';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import { flatTerrain } from './flat-world';

const t = generateTerrain(20260);
const all = generateBoulders(t);
const big = all.filter((b) => b.kind === 'boulder');
const rubble = all.filter((b) => b.kind === 'rubble');
/** Highest point of the cluster above the ground directly under that part. */
const top = (b: Boulder): number => Math.max(...b.parts.map((p) => p.y + p.r - t.heightAt(p.x, p.z)));

describe('boulder field', () => {
  it('is deterministic', () => {
    const again = generateBoulders(generateTerrain(20260));
    expect(again.length).toBe(all.length);
    expect(again[0]).toEqual(all[0]);
  });

  it('has real boulders and rubble', () => {
    expect(big.length).toBeGreaterThan(12);
    expect(rubble.length).toBeGreaterThan(12);
  });

  it('keeps everything inside the rock field, on rock, away from the spawn', () => {
    for (const b of all) {
      expect(Math.hypot(b.x - ROCK.x, b.z - ROCK.z)).toBeLessThan(ROCK.r);
      expect(t.surfaceAt(b.x, b.z)).toBe(Surface.Rock);
      expect(Math.hypot(b.x - SPAWN.x, b.z - SPAWN.z)).toBeGreaterThan(20);
    }
  });

  it('leaves a gap wider than the Hauler between boulders', () => {
    for (const a of big) for (const b of big) {
      if (a === b) continue;
      expect(Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius).toBeGreaterThan(2.2);
    }
  });
});

describe('boulder shapes', () => {
  it('are irregular: several jointed spheres of different sizes, not one ball', () => {
    for (const b of big) {
      expect(b.parts.length).toBeGreaterThanOrEqual(3);
      const radii = new Set(b.parts.map((p) => p.r.toFixed(4)));
      expect(radii.size).toBe(b.parts.length);
    }
  });

  it('are tall walls or low rubble, never a belly-height dome that high-centres a car', () => {
    for (const b of big) expect(top(b)).toBeGreaterThan(1.1);
    for (const b of rubble) expect(top(b)).toBeLessThan(0.3);
    for (const b of all) expect(top(b) > 0.4 && top(b) < 1.1).toBe(false);
  });
});

describe('boulders and rubble in physics', () => {
  beforeAll(initRapier);

  function drive(role: CarRole, boulder: Boulder | null, seconds = 6): { x: number; z: number; up: number } {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass), boulder ? [boulder] : []);
    const v = new Vehicle(pw, CARS[role], 0, -10, 0);
    for (let i = 0; i < seconds / FIXED_DT; i++) {
      v.step({ throttle: i < 20 ? 0 : 1, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
    }
    const p = v.body.translation();
    return { x: p.x, z: p.z, up: v.upright };
  }

  const wall: Boulder = {
    kind: 'boulder', x: 0, z: 0, radius: 2,
    parts: [
      { x: 0, y: 0.5, z: 0, r: 1.4, rx: 0, ry: 0, rz: 0 },
      { x: 1.0, y: 0.3, z: 0.3, r: 0.8, rx: 1, ry: 0, rz: 0 },
      { x: -0.9, y: 0.3, z: -0.4, r: 0.7, rx: 0, ry: 1, rz: 0 },
    ],
  };

  const heap: Boulder = {
    kind: 'rubble', x: 0, z: 0, radius: 1.2,
    parts: [
      { x: 0, y: -0.05, z: 0, r: 0.28, rx: 0, ry: 0, rz: 0 },
      { x: 0.5, y: -0.04, z: 0.3, r: 0.26, rx: 0, ry: 0, rz: 0 },
      { x: -0.4, y: -0.04, z: -0.2, r: 0.28, rx: 0, ry: 0, rz: 0 },
      { x: 0.1, y: -0.04, z: 0.7, r: 0.25, rx: 0, ry: 0, rz: 0 },
    ],
  };

  it('a boulder stops a car or throws it off its line', () => {
    const clear = drive('hauler', null);
    expect(clear.z).toBeGreaterThan(15);
    expect(Math.abs(clear.x)).toBeLessThan(0.3);
    const hit = drive('hauler', wall);
    expect(hit.z < 3 || Math.abs(hit.x) > 0.5).toBe(true);
  });

  it.each(CAR_ORDER)('%s drives over a rubble heap and keeps going', (role) => {
    const r = drive(role, heap);
    expect(r.z).toBeGreaterThan(8);
    expect(r.up).toBeGreaterThan(0.5);
  });
});
