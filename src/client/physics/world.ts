import RAPIER from '@dimforge/rapier3d-compat';
import { PLATFORM_WALL, type Terrain } from '../../shared/terrain';
import type { Boulder } from '../../shared/boulders';

export const FIXED_DT = 1 / 60;

export interface PhysicsWorld {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  terrain: Terrain;
}

let initPromise: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

/**
 * Rapier heightfields take a column-major matrix (rows along z, columns along x),
 * centred on the origin. Our terrain is row-major, so transpose.
 */
export function heightfieldMatrix(terrain: Terrain): Float32Array {
  const n = terrain.points;
  const out = new Float32Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      out[col * n + row] = terrain.heights[row * n + col] ?? 0;
    }
  }
  return out;
}

export function createPhysicsWorld(terrain: Terrain, boulders: readonly Boulder[] = []): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const n = terrain.points;
  const desc = RAPIER.ColliderDesc.heightfield(
    n - 1,
    n - 1,
    heightfieldMatrix(terrain),
    { x: terrain.size, y: 1, z: terrain.size },
  ).setFriction(1);
  world.createCollider(desc);
  // A vertical wall ring round each platform. The heightfield edge is a bevel, which would launch a
  // fast car up and over like a ramp; this makes it a wall.
  for (const pf of terrain.platforms ?? []) {
    const segments = 56;
    const radius = PLATFORM_WALL.face + PLATFORM_WALL.thickness / 2;
    const arc = (2 * Math.PI * radius) / segments;
    const hh = (PLATFORM_WALL.top - PLATFORM_WALL.bottom) / 2;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const q = Math.sin((Math.PI / 2 - a) / 2); // rotate about Y so the long side is tangent to the circle
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(arc / 2 + 0.06, hh, PLATFORM_WALL.thickness / 2)
          .setTranslation(pf.x + Math.cos(a) * radius, (PLATFORM_WALL.top + PLATFORM_WALL.bottom) / 2, pf.z + Math.sin(a) * radius)
          .setRotation({ x: 0, y: q, z: 0, w: Math.cos((Math.PI / 2 - a) / 2) })
          .setFriction(0.6),
      );
    }
  }

  // Slick on purpose: a car that lands belly-first on a rock should slide off, not stick.
  for (const b of boulders) {
    for (const p of b.parts) {
      world.createCollider(
        RAPIER.ColliderDesc.ball(p.r).setTranslation(p.x, p.y, p.z).setFriction(0.2).setRestitution(0.3),
      );
    }
  }
  return { rapier: RAPIER, world, terrain };
}
