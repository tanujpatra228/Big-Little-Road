import { describe, expect, it } from 'vitest';
import { generateTerrain, WATER_LEVEL } from '../src/shared/terrain';
import { Surface } from '../src/shared/surfaces';
import { FLOWER_COLOURS, scatterFlowers, scatterGrass } from '../src/shared/vegetation';

const t = generateTerrain(20260);
const grass = scatterGrass(t);
const flowers = scatterFlowers(t);

describe('grass placement', () => {
  it('is deterministic', () => {
    const again = scatterGrass(generateTerrain(20260));
    expect(again.length).toBe(grass.length);
    expect(again[10]).toEqual(grass[10]);
  });

  it('is lush: tens of thousands of tufts', () => {
    expect(grass.length).toBeGreaterThan(20000);
    expect(grass.length).toBeLessThan(80000); // draw budget
  });

  it('only grows on grass, above the waterline', () => {
    for (const p of grass) {
      expect(t.surfaceAt(p.x, p.z)).toBe(Surface.Grass);
      expect(p.y).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('leaves the patio, sand, mud, rock, gravel and water bare', () => {
    const bare = new Set([Surface.Patio, Surface.Sand, Surface.Mud, Surface.Rock, Surface.Gravel, Surface.Water]);
    for (const p of grass) expect(bare.has(t.surfaceAt(p.x, p.z))).toBe(false);
  });

  it('sits on the ground', () => {
    for (const p of grass.slice(0, 500)) expect(Math.abs(p.y - t.heightAt(p.x, p.z))).toBeLessThan(1e-6);
  });
});

describe('clearings', () => {
  it('keeps grass and flowers out of a cleared circle', () => {
    const c = { x: 17, z: -6, r: 3.2 };
    const g = scatterGrass(t, 4.5, [c]);
    const f = scatterFlowers(t, 80, 160, [c]);
    expect(g.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < c.r)).toBe(false);
    expect(f.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < c.r)).toBe(false);
    expect(grass.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < c.r)).toBe(true); // and there was grass there before
  });
});

describe('flowers', () => {
  it('exist, on grass, with valid colours', () => {
    expect(flowers.length).toBeGreaterThan(300);
    for (const f of flowers) {
      expect(t.surfaceAt(f.x, f.z)).toBe(Surface.Grass);
      expect(f.colour).toBeGreaterThanOrEqual(0);
      expect(f.colour).toBeLessThan(FLOWER_COLOURS);
    }
  });
});
