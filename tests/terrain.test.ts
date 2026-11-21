import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateTerrain, SPAWN, TERRAIN_SIZE } from '../src/shared/terrain';
import { Surface } from '../src/shared/surfaces';
import { createPhysicsWorld, initRapier } from '../src/client/physics/world';

describe('terrain', () => {
  const t = generateTerrain(1234);

  it('is deterministic for a seed', () => {
    const a = generateTerrain(1234);
    expect(Array.from(a.heights.slice(0, 50))).toEqual(Array.from(t.heights.slice(0, 50)));
    expect(generateTerrain(99).heights[5000]).not.toBe(t.heights[5000]);
  });

  it('spawn is a flat patio', () => {
    expect(t.surfaceAt(SPAWN.x, SPAWN.z)).toBe(Surface.Patio);
    expect(Math.abs(t.heightAt(SPAWN.x, SPAWN.z) - 0.3)).toBeLessThan(0.05);
  });

  it('has every surface type', () => {
    const seen = new Set<number>(t.surfaces);
    for (const s of [Surface.Grass, Surface.Patio, Surface.Sand, Surface.Mud, Surface.Rock, Surface.Water, Surface.Gravel]) {
      expect(seen.has(s)).toBe(true);
    }
  });

  it('fence rises at the edge', () => {
    expect(t.heightAt(TERRAIN_SIZE / 2 - 1, 0)).toBeGreaterThan(15);
  });
});

describe('heightfield collider matches sampled height', () => {
  beforeAll(initRapier);
  it('ray hits agree with heightAt at off-axis points', () => {
    const t = generateTerrain(1234);
    const { world } = createPhysicsWorld(t);
    world.step();
    const probes: Array<[number, number]> = [[46, 34], [-42, 30], [-46, -44], [30, -10], [-20, 55], [12, -33]];
    for (const [x, z] of probes) {
      const ray = new RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 200, true);
      expect(hit).not.toBeNull();
      const y = 60 - (hit?.timeOfImpact ?? 0);
      expect(Math.abs(y - t.heightAt(x, z))).toBeLessThan(0.15);
    }
  });
});
