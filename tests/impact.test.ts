import { beforeAll, describe, expect, it } from 'vitest';
import { CARS } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import type { Boulder } from '../src/shared/boulders';
import type { Impact } from '../src/shared/audio-model';
import { createPhysicsWorld, initRapier, FIXED_DT, type PhysicsWorld } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { DriveInput } from '../src/shared/driving';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

/** Runs the car and returns the hardest impact the sound system would have heard. */
function hardest(pw: PhysicsWorld, v: Vehicle, input: (i: number) => DriveInput, seconds: number, skipSeconds = 0): Impact | null {
  let best: Impact | null = null;
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    v.step(input(i), FIXED_DT);
    pw.world.step();
    v.afterPhysics();
    const hit = v.consumeImpact();
    if (i * FIXED_DT >= skipSeconds && hit && (!best || hit.intensity > best.intensity)) best = hit;
  }
  return best;
}

const floor = (i: number): DriveInput => ({ throttle: i < 20 ? 0 : 1, steer: 0, handbrake: false });

describe('impact detection from real physics', () => {
  it('stays quiet through a settle, a full-throttle run and a hard stop', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Patio));
    const v = new Vehicle(pw, CARS.relay, 0, -250, 0);
    // First 1.5 s is the drop onto the ground, which is allowed to make a sound.
    const run = hardest(pw, v, (i) => (i < 60 * 8 ? floor(i) : { throttle: -1, steer: 0, handbrake: false }), 11, 1.5);
    expect(run).toBeNull();
  });

  it('a head-on crash into a boulder is loud and mostly horizontal', () => {
    const wall: Boulder = {
      kind: 'boulder', x: 0, z: 0, radius: 2,
      parts: [{ x: 0, y: 0.5, z: 0, r: 1.4, rx: 0, ry: 0, rz: 0 }, { x: 1, y: 0.3, z: 0.3, r: 0.8, rx: 0, ry: 0, rz: 0 }, { x: -1, y: 0.3, z: -0.3, r: 0.8, rx: 0, ry: 0, rz: 0 }],
    };
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass), [wall]);
    const v = new Vehicle(pw, CARS.hauler, 0, -10, 0);
    const hit = hardest(pw, v, floor, 6, 1.5);
    expect(hit).not.toBeNull();
    expect(hit!.intensity).toBeGreaterThan(0.2);
    expect(hit!.vertical).toBeLessThan(0.7);
  });

  it('dropping the car from height registers as a vertical landing', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const v = new Vehicle(pw, CARS.scout, 0, 0, 0);
    v.body.setTranslation({ x: 0, y: 4, z: 0 }, true);
    const hit = hardest(pw, v, () => ({ throttle: 0, steer: 0, handbrake: false }), 3, 0);
    expect(hit).not.toBeNull();
    expect(hit!.vertical).toBeGreaterThan(0.7);
  });

  it('consumeImpact returns each impact once', () => {
    const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
    const v = new Vehicle(pw, CARS.scout, 0, 0, 0);
    v.body.setTranslation({ x: 0, y: 4, z: 0 }, true);
    hardest(pw, v, () => ({ throttle: 0, steer: 0, handbrake: false }), 3, 99);
    expect(v.consumeImpact()).toBeNull();
  });
});
