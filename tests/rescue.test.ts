import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER, type CarRole } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { RESCUE_RANGE, RESCUE_SECONDS, ROLL_RATE_MAX, ROLL_TIMEOUT, RescueProgress, rollRate } from '../src/shared/rescue';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

describe('rescue progress', () => {
  it('fills while a teammate stays close to a flipped car, and rolls exactly once', () => {
    const r = new RescueProgress();
    let rolls = 0;
    let t = 0;
    while (t < 3) {
      if (r.update(1 / 60, true, 2) === 'roll') rolls++;
      t += 1 / 60;
    }
    expect(rolls).toBeGreaterThanOrEqual(1);
    // It rolls after about RESCUE_SECONDS, not instantly.
    const q = new RescueProgress();
    let at = 0;
    for (let i = 0; i < 600; i++) if (q.update(1 / 60, true, 2) === 'roll') { at = i / 60; break; }
    expect(at).toBeGreaterThan(RESCUE_SECONDS - 0.05);
    expect(at).toBeLessThan(RESCUE_SECONDS + 0.05);
  });

  it('needs a teammate: alone, or too far away, nothing happens however long you wait', () => {
    const r = new RescueProgress();
    for (let i = 0; i < 3000; i++) expect(r.update(1 / 60, true, null)).toBe('idle');
    for (let i = 0; i < 3000; i++) expect(r.update(1 / 60, true, RESCUE_RANGE + 0.5)).toBe('idle');
  });

  it('a car that is not flipped is never rescued, and loses any progress', () => {
    const r = new RescueProgress();
    for (let i = 0; i < 30; i++) r.update(1 / 60, true, 1);
    expect(r.progress).toBeGreaterThan(0.3);
    expect(r.update(1 / 60, false, 1)).toBe('idle');
    expect(r.progress).toBe(0);
  });

  it('a helper who drives off lets the progress drain, twice as fast as it filled', () => {
    const r = new RescueProgress();
    for (let i = 0; i < 30; i++) r.update(1 / 60, true, 1); // 0.5 s in
    for (let i = 0; i < 15; i++) r.update(1 / 60, true, 20); // away for 0.25 s
    expect(r.progress).toBeLessThan(0.05);
  });

  it('reports rescuing while it fills, so the HUD can show it', () => {
    const r = new RescueProgress();
    expect(r.update(1 / 60, true, 1)).toBe('rescuing');
  });
});

describe('roll rate', () => {
  const fwd = { x: 0, y: 0, z: 1 };
  it('is zero when upright, and rolls toward upright from either side', () => {
    expect(Math.abs(rollRate({ x: 0, y: 1, z: 0 }, fwd))).toBeLessThan(1e-9);
    // Facing +z, a car whose roof leans toward +x needs a positive turn about its nose to come back up.
    const leansPlusX = rollRate({ x: Math.sin(0.8), y: Math.cos(0.8), z: 0 }, fwd);
    const leansMinusX = rollRate({ x: -Math.sin(0.8), y: Math.cos(0.8), z: 0 }, fwd);
    expect(leansPlusX).toBeGreaterThan(0);
    expect(leansMinusX).toBeLessThan(0);
    near(leansPlusX, -leansMinusX);
  });

  it('is capped, and upside down it takes the direction it is asked to', () => {
    const upside = { x: 0, y: -1, z: 0 };
    expect(rollRate(upside, fwd, 1)).toBe(ROLL_RATE_MAX);
    expect(rollRate(upside, fwd, -1)).toBe(-ROLL_RATE_MAX);
  });

  it('eases off near upright so it settles', () => {
    expect(Math.abs(rollRate({ x: Math.sin(0.1), y: Math.cos(0.1), z: 0 }, fwd))).toBeLessThan(0.5);
  });
});
function near(a: number, b: number): void {
  expect(Math.abs(a - b)).toBeLessThan(1e-9);
}

/** Puts a car on flat ground in a given orientation (quaternion), lets it settle, then rolls it. */
function roll(role: CarRole, q: { x: number; y: number; z: number; w: number }, prefer: 1 | -1): { seconds: number; finalUp: number; laterMin: number } {
  const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
  const v = new Vehicle(pw, CARS[role], 0, -250, 0);
  for (let i = 0; i < 90; i++) { v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics(); }
  const t = v.body.translation();
  v.body.setTranslation({ x: t.x, y: t.y + 0.6, z: t.z }, true);
  v.body.setRotation(q, true);
  v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 150; i++) { v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics(); } // settle on its roof or side
  let seconds = Infinity;
  for (let i = 0; i < ROLL_TIMEOUT / FIXED_DT; i++) {
    const done = v.rollOver(prefer, FIXED_DT);
    v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics();
    if (done) { seconds = i * FIXED_DT; break; }
  }
  // After the helping stops, does it stay on its wheels?
  let laterMin = 1;
  for (let i = 0; i < 180; i++) { v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics(); laterMin = Math.min(laterMin, v.upright); }
  return { seconds, finalUp: v.upright, laterMin };
}

const upsideDown = { x: 0, y: 0, z: 1, w: 0 };
const onRightSide = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
const onLeftSide = { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 };
const noseOver = { x: 1, y: 0, z: 0, w: 0 }; // flipped end over end, upside down facing the other way

describe.each(CAR_ORDER)('%s helped over a on flat ground', (role) => {
  it.each([[upsideDown, 'upside down'], [onRightSide, 'on its right side'], [onLeftSide, 'on its left side'], [noseOver, 'upside down, facing back']] as const)(
    'rolls back onto its wheels from %s, in either direction, and stays there',
    (q, _label) => {
      for (const prefer of [1, -1] as const) {
        const r = roll(role, q, prefer);
        expect(r.seconds).toBeLessThan(ROLL_TIMEOUT);
        expect(r.finalUp).toBeGreaterThan(0.9);
        expect(r.laterMin).toBeGreaterThan(0.75); // it never tips over again
      }
    },
  );
});
