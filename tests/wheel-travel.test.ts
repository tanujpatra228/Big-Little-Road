import { beforeAll, describe, expect, it } from 'vitest';
import { generateTerrain, ROCK } from '../src/shared/terrain';
import { generateBoulders } from '../src/shared/boulders';
import { CARS, CAR_ORDER, maxWheelRise, wheelRestY } from '../src/shared/cars';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';

beforeAll(initRapier);

describe.each(CAR_ORDER)('%s wheel travel', (role) => {
  const spec = CARS[role];

  it('never rises past the bump stop that fender flares are built around', () => {
    const t = generateTerrain(20260);
    const boulders = generateBoulders(t);
    const limit = maxWheelRise(spec);
    let worst = -Infinity;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const sx = ROCK.x + Math.cos(a) * 19;
      const sz = ROCK.z + Math.sin(a) * 19;
      const pw = createPhysicsWorld(t, boulders);
      const v = new Vehicle(pw, spec, sx, sz, Math.atan2(ROCK.x - sx, ROCK.z - sz));
      for (let i = 0; i < 60 * 14; i++) {
        const p = v.body.translation();
        const q = v.body.rotation();
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
        let err = Math.atan2(ROCK.x - p.x, ROCK.z - p.z) - yaw;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        v.step({ throttle: 1, steer: -Math.max(-1, Math.min(1, err * 1.5 + Math.sin(i / 30) * 0.5)), handbrake: false }, FIXED_DT);
        pw.world.step();
        v.afterPhysics();
        for (let w = 0; w < 4; w++) worst = Math.max(worst, v.wheelState(w).y - wheelRestY(spec));
      }
    }
    expect(worst).toBeLessThanOrEqual(limit + 0.01);
  });

  it('bump stop leaves the wheel below its mount point', () => {
    // Wheel centre above the hardpoint would put it inside the body.
    const hardpointY = -spec.half.y * 0.4;
    expect(wheelRestY(spec) + maxWheelRise(spec)).toBeLessThan(hardpointY + 0.02);
  });
});
