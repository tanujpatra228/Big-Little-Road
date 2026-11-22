import { describe, expect, it } from 'vitest';
import { generateTerrain, WATER_LEVEL } from '../src/shared/terrain';
import { Surface } from '../src/shared/surfaces';
import { FLOWER_COLOURS, scatterFlowers, scatterGrass, GRASS_FAR_RADIUS, GRASS_FULL_RADIUS, grassKeep } from '../src/shared/vegetation';

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

describe('grass thinning by distance', () => {
  it('is full close up and gone far away, never more than the player asked for', () => {
    expect(grassKeep(0)).toBe(1);
    expect(grassKeep(GRASS_FULL_RADIUS)).toBe(1);
    expect(grassKeep(GRASS_FAR_RADIUS)).toBe(0);
    expect(grassKeep(500)).toBe(0);
    expect(grassKeep(10, 0.4)).toBeCloseTo(0.4, 12);
  });

  it('falls smoothly and only ever downward, so there are no density steps to see', () => {
    let prev = 1;
    let biggestStep = 0;
    for (let d = 0; d <= 100; d += 0.5) {
      const k = grassKeep(d);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      biggestStep = Math.max(biggestStep, prev - k);
      prev = k;
    }
    expect(biggestStep).toBeLessThan(0.06); // per half metre
  });

  it('drops faster than a straight line: the far lawn is the cheapest thing to lose', () => {
    const mid = (GRASS_FULL_RADIUS + GRASS_FAR_RADIUS) / 2;
    expect(grassKeep(mid)).toBeLessThan(0.5);
  });

  it('the density setting scales it, and zero turns grass off', () => {
    for (const d of [0, 20, 40, 60, 80]) expect(grassKeep(d, 0.5)).toBeCloseTo(grassKeep(d) * 0.5, 12);
    expect(grassKeep(5, 0)).toBe(0);
    expect(grassKeep(5, 3)).toBe(1); // clamped
  });

  it('draws about 38% fewer tufts than the old stepped bands across the visible lawn', () => {
    const oldKeep = (d: number): number => (d < 38 ? 1 : d < 66 ? 0.55 : d < 100 ? 0.25 : 0);
    // Area-weighted: far rings hold more lawn, so this is what the camera actually pays for.
    let oldCost = 0;
    let newCost = 0;
    for (let d = 1; d < 100; d += 1) {
      oldCost += oldKeep(d) * d;
      newCost += grassKeep(d) * d;
    }
    expect(newCost).toBeLessThan(oldCost * 0.66); // about 38% fewer tufts
  });
});
