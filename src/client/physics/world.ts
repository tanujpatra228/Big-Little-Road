import RAPIER from '@dimforge/rapier3d-compat';
import type { Terrain } from '../../shared/terrain';

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

export function createPhysicsWorld(terrain: Terrain): PhysicsWorld {
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
  return { rapier: RAPIER, world, terrain };
}
