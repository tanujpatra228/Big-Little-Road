import { mulberry32 } from './rng';
import { ROCK, SPAWN, type Terrain } from './terrain';
import { Surface } from './surfaces';

export interface Boulder {
  x: number;
  y: number;
  z: number;
  /** Collider radius. */
  radius: number;
  /** Random tumble, so the visual mesh does not look cloned. */
  rx: number;
  ry: number;
  rz: number;
}

/**
 * Boulders in the rock field. Deterministic per terrain seed, so every player and the physics
 * agree on them. They are solid: cars crash into them and get thrown around, they do not slow you.
 * Radii run from about one wheel (a bump) to about a car's height (a wall).
 */
export function generateBoulders(terrain: Terrain, count = 70): Boulder[] {
  const rand = mulberry32(terrain.seed ^ 0x51ed270b);
  const out: Boulder[] = [];
  const reach = ROCK.r - 6;
  for (let attempt = 0; attempt < count * 40 && out.length < count; attempt++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * reach;
    const x = ROCK.x + Math.cos(a) * d;
    const z = ROCK.z + Math.sin(a) * d;
    if (terrain.surfaceAt(x, z) !== Surface.Rock) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 20) continue;

    const radius = 0.45 + Math.pow(rand(), 1.6) * 1.15;
    // Keep a gap wider than the widest car (Hauler, about 1.6) so there is always a way through.
    let clear = true;
    for (const o of out) {
      if (Math.hypot(o.x - x, o.z - z) < o.radius + radius + 2.3) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;

    // Half buried.
    const y = terrain.heightAt(x, z) + radius * 0.45;
    out.push({ x, y, z, radius, rx: rand() * 3, ry: rand() * 3, rz: rand() * 3 });
  }
  return out;
}
