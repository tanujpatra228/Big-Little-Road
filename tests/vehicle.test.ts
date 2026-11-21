import { beforeAll, describe, expect, it } from 'vitest';
import { generateTerrain } from '../src/shared/terrain';
import { CARS, CAR_ORDER } from '../src/shared/cars';
import { createPhysicsWorld, initRapier, FIXED_DT, type PhysicsWorld } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { DriveInput } from '../src/shared/driving';

beforeAll(initRapier);

function run(pw: PhysicsWorld, v: Vehicle, input: DriveInput, seconds: number): void {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    v.step(input, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
  }
}

/** Forward direction of the chassis in world space. */
function heading(v: Vehicle): { x: number; z: number } {
  const q = v.body.rotation();
  return { x: 2 * (q.x * q.z + q.w * q.y), z: 1 - 2 * (q.x * q.x + q.y * q.y) };
}

describe.each(CAR_ORDER)('%s on the patio', (role) => {
  const spec = CARS[role];

  it('settles on its wheels', () => {
    const pw = createPhysicsWorld(generateTerrain(1));
    const v = new Vehicle(pw, spec, 0, 0, 0);
    run(pw, v, { throttle: 0, steer: 0, handbrake: false }, 2);
    expect(v.grounded).toBe(4);
    expect(v.upright).toBeGreaterThan(0.98);
    expect(Math.abs(v.body.linvel().y)).toBeLessThan(0.3);
  });

  it('accelerates forward along its nose and approaches top speed', () => {
    const pw = createPhysicsWorld(generateTerrain(1));
    const v = new Vehicle(pw, spec, 0, -4, 0); // yaw 0: nose points +z
    run(pw, v, { throttle: 1, steer: 0, handbrake: false }, 4);
    expect(v.speed).toBeGreaterThan(spec.topSpeed * 0.35);
    expect(v.speed).toBeLessThanOrEqual(spec.topSpeed * 1.05);
    expect(v.body.translation().z).toBeGreaterThan(-4);
    expect(v.isFlipped).toBe(false);
  });

  it('steers right when asked to steer right', () => {
    const pw = createPhysicsWorld(generateTerrain(1));
    const v = new Vehicle(pw, spec, 0, -6, 0);
    run(pw, v, { throttle: 1, steer: 0, handbrake: false }, 1.5);
    run(pw, v, { throttle: 0.6, steer: 1, handbrake: false }, 1.2);
    // Facing +z, the driver's right is -x.
    expect(heading(v).x).toBeLessThan(-0.1);
  });
});
