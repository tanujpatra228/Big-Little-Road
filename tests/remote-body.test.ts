import { beforeAll, describe, expect, it } from 'vitest';
import { CARS } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { RemoteBody, Vehicle } from '../src/client/physics/vehicle';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

describe('other players are solid', () => {
  function drive(remoteAt: { x: number; z: number } | null): { z: number; x: number } {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const mine = new Vehicle(pw, CARS.hauler, 0, -12, 0);
    const other = remoteAt ? new RemoteBody(pw, CARS.relay) : null;
    for (let i = 0; i < 6 / FIXED_DT; i++) {
      // The stand-in is told where the other car is every frame, like a remote pose arriving.
      if (other && remoteAt) other.moveTo({ x: remoteAt.x, y: 0.9, z: remoteAt.z, qx: 0, qy: 0, qz: 0, qw: 1 });
      mine.step({ throttle: i < 20 ? 0 : 1, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      mine.afterPhysics();
    }
    const t = mine.body.translation();
    return { x: t.x, z: t.z };
  }

  it('drives straight through empty space', () => {
    expect(drive(null).z).toBeGreaterThan(15);
  });

  it('a parked remote car blocks the way instead of letting you ghost through', () => {
    const r = drive({ x: 0, z: 0 });
    // Either stopped short of it or knocked off the line, but not through it.
    expect(r.z < 2 || Math.abs(r.x) > 0.6).toBe(true);
  });

  it('can be removed cleanly', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const body = new RemoteBody(pw, CARS.scout);
    body.dispose();
    pw.world.step();
    expect(pw.world.bodies.len()).toBe(0);
  });
});

describe('rope pull on a car', () => {
  it('speeds the car up along the pull direction, scaled by acceleration not mass', () => {
    const run = (role: 'scout' | 'hauler'): number => {
      const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
      const v = new Vehicle(pw, CARS[role], 0, 0, 0);
      for (let i = 0; i < 120; i++) { v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics(); }
      const z0 = v.body.translation().z;
      for (let i = 0; i < 60; i++) { v.pushPlanar(0, 3, FIXED_DT); v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics(); }
      return v.body.translation().z - z0;
    };
    const light = run('scout');
    const heavy = run('hauler');
    expect(light).toBeGreaterThan(0.5);
    expect(Math.abs(light - heavy) / light).toBeLessThan(0.35); // similar pull on a 6 kg and a 14 kg car
  });
});
