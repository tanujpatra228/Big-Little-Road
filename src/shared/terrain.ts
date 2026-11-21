import { createNoise } from './noise';
import { Surface } from './surfaces';

export const TERRAIN_SIZE = 160; // world units, centred on the origin
export const TERRAIN_POINTS = 257; // heightfield vertices per side (0.625 m cells: crisp enough for a platform wall)
export const WATER_LEVEL = -1.2;
/** Mean height of the mud bog floor. Kept clear of the water plane. */
export const MUD_FLOOR = -0.45;
export const SPAWN: Readonly<{ x: number; z: number }> = { x: 0, z: -2 };

export interface Terrain {
  seed: number;
  size: number;
  points: number;
  /** Row-major: index = row * points + col, row along z, col along x. */
  heights: Float32Array;
  surfaces: Uint8Array;
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
  /** Raised platforms that get a truly vertical wall collider. A sloped edge would launch a fast car like a ramp. */
  platforms?: ReadonlyArray<{ x: number; z: number; r: number; height: number }>;
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

interface Zone {
  x: number;
  z: number;
  r: number;
}
const PATIO: Zone = { x: 0, z: 0, r: 11 };
const SAND: Zone = { x: 46, z: 34, r: 28 };
const MUD: Zone = { x: -42, z: 30, r: 20 };
export const ROCK: Readonly<Zone> = { x: -46, z: -44, r: 22 };
const POND: Zone = { x: 42, z: -42, r: 15 };
const WOODPILE: Zone = { x: 0, z: 56, r: 27 };

/**
 * The terrace: a raised flat platform on a flat apron of lawn. Its wall is taller than anything a car
 * can hop (1.3 m, against tall boulders at 1.1 m), so the only way up is a ramp: the plank, carried
 * there by two cars. The apron keeps the ground level so the ramp angle is predictable.
 */
export const PLATFORM: Readonly<{ x: number; z: number; r: number; height: number }> = { x: 28, z: -10, r: 8, height: 1.3 };
const APRON_R = 17;

/**
 * The wall around the platform. Its face is just outside the sloped edge of the heightfield, so
 * cars meet a vertical face, never the bevel. Its top is a hair under the plank's surface where the
 * plank crosses it, so a car on the plank rolls over it.
 */
export const PLATFORM_WALL = { face: PLATFORM.r + 0.3, thickness: 0.3, top: 1.28, bottom: -0.6 } as const;

const mask = (zone: Zone, x: number, z: number, feather: number): number => {
  const d = Math.hypot(x - zone.x, z - zone.z);
  return 1 - smooth(zone.r - feather, zone.r, d);
};

export function generateTerrain(seed: number): Terrain {
  const noise = createNoise(seed);
  const half = TERRAIN_SIZE / 2;
  const n = TERRAIN_POINTS;
  const cell = TERRAIN_SIZE / (n - 1);
  const heights = new Float32Array(n * n);
  const surfaces = new Uint8Array(n * n);

  const rawHeight = (x: number, z: number): number => {
    // Gentle lawn hills everywhere.
    let h = noise(x * 0.035, z * 0.035, 3) * 2.2;

    const sand = mask(SAND, x, z, 12);
    h += sand * (1.8 + Math.sin(x * 0.22 + z * 0.1) * 1.4 + noise(x * 0.09, z * 0.09, 2) * 1.2);

    const mud = mask(MUD, x, z, 9);
    // A shallow bog floor, always above the waterline (WATER_LEVEL) so it reads as mud, never as a pond.
    h = h * (1 - mud) + mud * (MUD_FLOOR + noise(x * 0.2, z * 0.2, 2) * 0.3);

    const rock = mask(ROCK, x, z, 8);
    h += rock * (1.2 + (noise(x * 0.14, z * 0.14, 3) + 1) * 1.6);

    const pond = mask(POND, x, z, 8);
    h = h * (1 - pond) + pond * (-3.2 + noise(x * 0.1, z * 0.1, 2) * 0.5);

    const wood = mask(WOODPILE, x, z, 23);
    h += wood * (9 + noise(x * 0.12, z * 0.12, 3) * 1.2);

    // Flat patio at the spawn.
    const patio = mask(PATIO, x, z, 6);
    h = h * (1 - patio) + 0.3 * patio;

    // The terrace: level apron, then a flat-topped platform with a near-vertical wall.
    const dP = Math.hypot(x - PLATFORM.x, z - PLATFORM.z);
    const apron = 1 - smooth(APRON_R - 7, APRON_R, dP);
    h = h * (1 - apron) + 0.15 * apron;
    const top = 1 - smooth(PLATFORM.r - 0.3, PLATFORM.r + 0.3, dP);
    h = h * (1 - top) + (0.15 + PLATFORM.height) * top;

    // Fence: the edge rises steeply so nobody leaves the yard.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smooth(half - 5.5, half - 2.5, edge) * 12;
    return h;
  };

  const classify = (x: number, z: number, h: number): Surface => {
    if (mask(PATIO, x, z, 6) > 0.5) return Surface.Patio;
    if (Math.hypot(x - PLATFORM.x, z - PLATFORM.z) < PLATFORM.r + 0.2) return Surface.Patio; // paved terrace
    if (mask(POND, x, z, 8) > 0.35 && h < WATER_LEVEL + 0.4) return Surface.Water;
    if (mask(MUD, x, z, 9) > 0.45) return Surface.Mud;
    const rock = mask(ROCK, x, z, 8);
    if (rock > 0.7) return Surface.Rock; // boulder field core
    if (rock > 0.25) return Surface.Gravel; // loose stones around it
    if (mask(SAND, x, z, 12) > 0.45) return Surface.Sand;
    if (mask(WOODPILE, x, z, 23) > 0.7) return Surface.Rock;
    return Surface.Grass;
  };

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x = -half + col * cell;
      const z = -half + row * cell;
      const h = rawHeight(x, z);
      heights[row * n + col] = h;
      surfaces[row * n + col] = classify(x, z, h);
    }
  }

  const clampIdx = (v: number): number => Math.min(n - 1, Math.max(0, v));

  const heightAt = (x: number, z: number): number => {
    const fx = (x + half) / cell;
    const fz = (z + half) / cell;
    const c0 = clampIdx(Math.floor(fx));
    const r0 = clampIdx(Math.floor(fz));
    const c1 = clampIdx(c0 + 1);
    const r1 = clampIdx(r0 + 1);
    const tx = Math.min(1, Math.max(0, fx - c0));
    const tz = Math.min(1, Math.max(0, fz - r0));
    const h = (r: number, c: number): number => heights[r * n + c] ?? 0;
    const a = h(r0, c0);
    const b = h(r0, c1);
    const c = h(r1, c0);
    const d = h(r1, c1);
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };

  const surfaceAt = (x: number, z: number): Surface => {
    const col = clampIdx(Math.round((x + half) / cell));
    const row = clampIdx(Math.round((z + half) / cell));
    return (surfaces[row * n + col] ?? Surface.Grass) as Surface;
  };

  return { seed, size: TERRAIN_SIZE, points: n, heights, surfaces, heightAt, surfaceAt, platforms: [PLATFORM] };
}
