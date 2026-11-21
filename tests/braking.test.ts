import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { DriveInput } from '../src/shared/driving';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

/** Gets up to 85% of top speed, then applies `stop` for 4 s. Returns time to stop and lowest uprightness. */
function stopFromSpeed(role: (typeof CAR_ORDER)[number], stop: DriveInput): { stopTime: number; minUp: number } {
  const spec = CARS[role];
  const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
  const v = new Vehicle(pw, spec, 0, -250, 0);
  let t0 = -1;
  let stopTime = Infinity;
  let minUp = 1;
  for (let i = 0; i < 60 * 16 && stopTime === Infinity; i++) {
    const braking = t0 >= 0;
    v.step(braking ? stop : { throttle: 1, steer: 0, handbrake: false }, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
    const s = v.forwardSpeed();
    if (!braking && s > spec.topSpeed * 0.85) t0 = i;
    if (braking) {
      minUp = Math.min(minUp, v.upright);
      if (s < 0.8) stopTime = (i - t0) * FIXED_DT;
      if ((i - t0) * FIXED_DT > 4) break;
    }
  }
  return { stopTime, minUp };
}

describe.each(CAR_ORDER)('%s braking from near top speed', (role) => {
  it('brakes hard without flipping end over end', () => {
    const r = stopFromSpeed(role, { throttle: -1, steer: 0, handbrake: false });
    expect(r.minUp).toBeGreaterThan(0.8);
    expect(r.stopTime).toBeGreaterThan(0.6); // not a wall
    expect(r.stopTime).toBeLessThan(3);
  });

  it('handbrake stops it without flipping either', () => {
    const r = stopFromSpeed(role, { throttle: 0, steer: 0, handbrake: true });
    expect(r.minUp).toBeGreaterThan(0.8);
  });
});
