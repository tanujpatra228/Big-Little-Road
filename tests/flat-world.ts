import { Surface } from '../src/shared/surfaces';
import type { Terrain } from '../src/shared/terrain';
import { createPhysicsWorld, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { CarSpec } from '../src/shared/cars';

/** A big flat terrain made of one surface. Lets tests compare cars across surfaces fairly. */
export function flatTerrain(surface: Surface, size = 600): Terrain {
  const points = 129;
  return {
    seed: 0,
    size,
    points,
    heights: new Float32Array(points * points),
    surfaces: new Uint8Array(points * points).fill(surface),
    heightAt: () => 0,
    surfaceAt: () => surface,
  };
}

/** Full throttle in a straight line; returns the best forward speed after the launch phase. */
export function topSpeedOn(surface: Surface, spec: CarSpec, seconds = 14): number {
  const pw = createPhysicsWorld(flatTerrain(surface));
  const v = new Vehicle(pw, spec, 0, -200, 0);
  let best = 0;
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    v.step({ throttle: i < 30 ? 0 : 1, steer: 0, handbrake: false }, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
    if (i > 60) best = Math.max(best, v.forwardSpeed());
  }
  return best;
}
