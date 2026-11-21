import { beforeAll, describe, expect, it } from 'vitest';
import { generateTerrain, TERRAIN_SIZE } from '../src/shared/terrain';
import { CARS, CAR_ORDER } from '../src/shared/cars';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';

beforeAll(initRapier);

describe.each(CAR_ORDER)('%s at full speed into the fence', (role) => {
  it('stays inside the yard from every side', () => {
    const t = generateTerrain(20260);
    const limit = TERRAIN_SIZE / 2 - 0.5;
    // Start 40 units out, aimed at each wall: +x, -x, +z, -z.
    const dirs: Array<[number, number, number]> = [
      [-40, -10, Math.PI / 2],
      [40, -10, -Math.PI / 2],
      [10, -50, 0],
      [-10, 50, Math.PI],
    ];
    for (const [sx, sz, yaw] of dirs) {
      const pw = createPhysicsWorld(t);
      const v = new Vehicle(pw, CARS[role], sx, sz, yaw);
      let maxExtent = 0;
      for (let i = 0; i < 60 * 14; i++) {
        v.step({ throttle: 1, steer: 0, handbrake: false }, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
        const p = v.body.translation();
        maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.z));
      }
      expect(maxExtent).toBeLessThan(limit);
    }
  });
});
