import { createNoise } from './noise';
import { mulberry32 } from './rng';
import { Surface } from './surfaces';
import { WATER_LEVEL, type Terrain } from './terrain';

export interface Plant {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  /** 0..1, random per plant. Drives colour variation. */
  tone: number;
}

export interface Flower {
  x: number;
  y: number;
  z: number;
  height: number;
  yaw: number;
  /** Index into the renderer's flower palette. */
  colour: number;
}

export const FLOWER_COLOURS = 5;

const MAX_SLOPE = 0.85; // tan of the steepest slope grass grows on

/** A circle kept free of plants, e.g. around a prop you need to see. */
export interface Clearing {
  x: number;
  z: number;
  r: number;
}

const inClearing = (cs: readonly Clearing[], x: number, z: number): boolean => cs.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);

/** True if grass can grow at this spot: on grass, above water, not too steep. */
function grassy(terrain: Terrain, x: number, z: number): boolean {
  if (terrain.surfaceAt(x, z) !== Surface.Grass) return false;
  if (terrain.heightAt(x, z) < WATER_LEVEL + 0.2) return false;
  const dx = (terrain.heightAt(x + 0.7, z) - terrain.heightAt(x - 0.7, z)) / 1.4;
  const dz = (terrain.heightAt(x, z + 0.7) - terrain.heightAt(x, z - 0.7)) / 1.4;
  return Math.hypot(dx, dz) < MAX_SLOPE;
}

/** Grass thins out toward the edge of its patch so borders with sand, mud and rock stay clean. */
function edgeKeep(terrain: Terrain, x: number, z: number, rand: () => number): boolean {
  let outside = 0;
  for (const [ox, oz] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]] as const) {
    if (terrain.surfaceAt(x + ox, z + oz) !== Surface.Grass) outside++;
  }
  return outside === 0 || rand() < 0.12 / outside;
}

/** Tufts of grass. Clumpy: dense lush patches and thinner ones. Deterministic per seed. */
export function scatterGrass(terrain: Terrain, density = 4.5, clearings: readonly Clearing[] = []): Plant[] {
  const rand = mulberry32(terrain.seed ^ 0x9a55);
  const noise = createNoise(terrain.seed ^ 0x77);
  const half = terrain.size / 2 - 8;
  const attempts = Math.floor(density * (half * 2) * (half * 2));
  const out: Plant[] = [];
  for (let i = 0; i < attempts; i++) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const lush = 0.5 + 0.5 * noise(x * 0.09, z * 0.09, 2);
    if (rand() > 0.35 + 0.65 * lush) continue;
    if (inClearing(clearings, x, z)) continue;
    if (!grassy(terrain, x, z)) continue;
    if (!edgeKeep(terrain, x, z, rand)) continue;
    out.push({
      x,
      y: terrain.heightAt(x, z),
      z,
      scale: 0.8 + rand() * 0.5 + lush * 0.2,
      yaw: rand() * Math.PI * 2,
      tone: rand(),
    });
  }
  return out;
}

/** Flowers in clusters plus a few singles. */
export function scatterFlowers(terrain: Terrain, clusters = 80, singles = 160, clearings: readonly Clearing[] = []): Flower[] {
  const rand = mulberry32(terrain.seed ^ 0xf10e);
  const half = terrain.size / 2 - 10;
  const out: Flower[] = [];
  const add = (x: number, z: number, colour: number): void => {
    if (inClearing(clearings, x, z) || !grassy(terrain, x, z)) return;
    out.push({ x, y: terrain.heightAt(x, z), z, height: 0.38 + rand() * 0.3, yaw: rand() * Math.PI * 2, colour });
  };
  for (let c = 0; c < clusters; c++) {
    const cx = (rand() * 2 - 1) * half;
    const cz = (rand() * 2 - 1) * half;
    if (!grassy(terrain, cx, cz)) continue;
    const colour = Math.floor(rand() * FLOWER_COLOURS);
    const n = 6 + Math.floor(rand() * 11);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 2.3;
      add(cx + Math.cos(a) * r, cz + Math.sin(a) * r, rand() < 0.85 ? colour : Math.floor(rand() * FLOWER_COLOURS));
    }
  }
  for (let i = 0; i < singles; i++) {
    add((rand() * 2 - 1) * half, (rand() * 2 - 1) * half, Math.floor(rand() * FLOWER_COLOURS));
  }
  return out;
}

/** Grass is full density this close to the camera, in metres. */
export const GRASS_FULL_RADIUS = 26;
/** And gone beyond this. In between it thins smoothly, so there are no density steps to see. */
export const GRASS_FAR_RADIUS = 88;

/**
 * What fraction of a grass cell's tufts to draw, from its distance to the camera. Smooth rather than
 * stepped, and it falls faster than linearly: the far lawn is mostly fog and terrain colour anyway, so
 * its tufts are the cheapest thing in the frame to take away. `density` (0 to 1) is the player's
 * setting and scales everything.
 */
export function grassKeep(distance: number, density = 1): number {
  if (density <= 0) return 0;
  const t = Math.min(1, Math.max(0, (distance - GRASS_FULL_RADIUS) / (GRASS_FAR_RADIUS - GRASS_FULL_RADIUS)));
  return Math.min(1, density) * Math.pow(1 - t, 1.6);
}
