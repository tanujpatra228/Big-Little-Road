import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { BUFFER_SECONDS, JUMP_MIN_WHEELS, JumpState, MAX_JUMP_APEX, airLevel, jumpImpulse, jumpSpeed } from '../src/shared/jump';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import type { DriveInput } from '../src/shared/driving';
import { flatTerrain } from './flat-world';

beforeAll(initRapier);

const G = 9.81;
const dt = 1 / 60;

describe('jump rules', () => {
  it('fires on a press when grounded, once', () => {
    const j = new JumpState();
    j.update(4, 0.8, dt);
    j.request();
    expect(j.update(4, 0.8, dt)).toBe(true);
    expect(j.update(4, 0.8, dt)).toBe(false);
  });

  it('needs at least three wheels down', () => {
    const j = new JumpState();
    for (let i = 0; i < 30; i++) j.update(JUMP_MIN_WHEELS - 1, 0.8, dt);
    j.request();
    expect(j.update(JUMP_MIN_WHEELS - 1, 0.8, dt)).toBe(false);
    expect(j.update(JUMP_MIN_WHEELS, 0.8, dt)).toBe(true);
  });

  it('has no air jumps, even when mashing', () => {
    const j = new JumpState();
    j.update(4, 0.5, dt);
    j.request();
    expect(j.update(4, 0.5, dt)).toBe(true);
    let fired = 0;
    for (let i = 0; i < 120; i++) {
      j.request();
      if (j.update(0, 0.5, dt)) fired++;
    }
    expect(fired).toBe(0);
  });

  it('cooldown only runs on the ground, after landing', () => {
    const j = new JumpState();
    j.update(4, 0.8, dt);
    j.request();
    j.update(4, 0.8, dt); // fired
    for (let i = 0; i < 300; i++) j.update(0, 0.8, dt); // long flight
    j.request();
    expect(j.update(4, 0.8, dt)).toBe(false); // landed, cooldown starts now
    let t = 0;
    while (!(j.request(), j.update(4, 0.8, dt)) && t < 200) t++;
    expect(t * dt).toBeGreaterThan(0.7);
    expect(t * dt).toBeLessThan(0.9);
  });

  it('remembers a press just before landing, but not an old one', () => {
    const j = new JumpState();
    j.update(0, 0.5, dt);
    j.request();
    for (let i = 0; i < Math.floor(BUFFER_SECONDS / dt) - 2; i++) j.update(0, 0.5, dt);
    expect(j.update(4, 0.5, dt)).toBe(true);
    const k = new JumpState();
    k.update(0, 0.5, dt);
    k.request();
    for (let i = 0; i < Math.ceil(BUFFER_SECONDS / dt) + 3; i++) k.update(0, 0.5, dt);
    expect(k.update(4, 0.5, dt)).toBe(false);
  });

  it('still hops just after driving off an edge (coyote time)', () => {
    const j = new JumpState();
    j.update(4, 0.5, dt);
    for (let i = 0; i < 5; i++) j.update(0, 0.5, dt);
    j.request();
    expect(j.update(0, 0.5, dt)).toBe(true);
  });

  it('launch speed matches the apex, capped at the global limit', () => {
    expect(jumpSpeed(0.5, G)).toBeCloseTo(Math.sqrt(2 * G * 0.5));
    expect(jumpSpeed(5, G)).toBeCloseTo(Math.sqrt(2 * G * MAX_JUMP_APEX));
  });

  it('the vertical launch is the same on a slope, and pops forward a bit', () => {
    const flat = jumpImpulse({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, 4);
    const tilt = Math.sin(0.5);
    const slope = jumpImpulse({ x: 0, y: Math.cos(0.5), z: tilt }, { x: 0, y: 0, z: 0 }, 4);
    expect(flat.y).toBeCloseTo(4);
    expect(slope.y).toBeCloseTo(4);
    expect(Math.abs(slope.z)).toBeGreaterThan(0.1);
    expect(Math.abs(slope.z)).toBeLessThan(1.5);
  });

  it('cancels a fall so a coyote hop still reaches full height', () => {
    const dv = jumpImpulse({ x: 0, y: 1, z: 0 }, { x: 0, y: -2, z: 0 }, 4);
    expect(-2 + dv.y).toBeCloseTo(4);
  });

  it('air levelling pushes toward upright, and gives up past 90 degrees', () => {
    const a = airLevel({ x: 0, y: Math.cos(0.5), z: Math.sin(0.5) }, { x: 0, y: 0, z: 0 });
    expect(a.x).toBeLessThan(0);
    expect(airLevel({ x: 0, y: -0.5, z: 0.8 }, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

const IDLE: DriveInput = { throttle: 0, steer: 0, handbrake: false };

interface Flight {
  apex: number;
  airSeconds: number;
  hops: number;
  minUp: number;
  endUp: number;
}

/** Settles, optionally gets up to speed, hops (and mashes the key in the air), then lands. */
function fly(role: (typeof CAR_ORDER)[number], run: { throttle: number; seconds: number }, surface = Surface.Grass): Flight {
  const spec = CARS[role];
  const pw = createPhysicsWorld(flatTerrain(surface));
  const v = new Vehicle(pw, spec, 0, -250, 0);
  const step = (input: DriveInput): void => {
    v.step(input, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
  };
  for (let i = 0; i < 90; i++) step(IDLE);
  for (let i = 0; i < run.seconds * 60; i++) step({ throttle: run.throttle, steer: 0, handbrake: false });
  const y0 = v.body.translation().y;
  v.requestJump();
  let apex = 0;
  let hops = 0;
  let minUp = 1;
  let air = 0;
  let wasAir = false;
  for (let i = 0; i < 60 * 4; i++) {
    if (i > 0 && i % 6 === 0) v.requestJump(); // mashing the key in the air
    step({ throttle: run.throttle, steer: 0, handbrake: false });
    if (v.consumeHop()) hops++;
    apex = Math.max(apex, v.body.translation().y - y0);
    minUp = Math.min(minUp, v.upright);
    if (v.grounded === 0) {
      air += dt;
      wasAir = true;
    }
    if (wasAir && v.grounded >= 3 && i > 30) break;
  }
  for (let i = 0; i < 90; i++) step({ throttle: run.throttle, steer: 0, handbrake: false });
  return { apex, airSeconds: air, hops, minUp, endUp: v.upright };
}

describe.each(CAR_ORDER)('%s hop', (role) => {
  it('rises within its tuned height and never above the global cap, standing still', () => {
    const f = fly(role, { throttle: 0, seconds: 0 });
    expect(f.apex).toBeGreaterThan(CARS[role].jumpApex * 0.55);
    expect(f.apex).toBeLessThanOrEqual(MAX_JUMP_APEX);
    expect(f.airSeconds).toBeGreaterThan(0.15);
  });

  it('never rises above the cap at full speed either', () => {
    const f = fly(role, { throttle: 1, seconds: 6 });
    expect(f.apex).toBeLessThanOrEqual(MAX_JUMP_APEX);
  });

  it('hops once and lands on its wheels (flat ground, standing and at speed)', () => {
    for (const run of [{ throttle: 0, seconds: 0 }, { throttle: 1, seconds: 6 }]) {
      const f = fly(role, run);
      expect(f.hops).toBe(1);
      expect(f.minUp).toBeGreaterThan(0.7);
      expect(f.endUp).toBeGreaterThan(0.95);
    }
  });
});

describe('cars stay different', () => {
  it('Scout hops higher than Hauler, and nobody beats the cap', () => {
    const s = fly('scout', { throttle: 0, seconds: 0 }).apex;
    const h = fly('hauler', { throttle: 0, seconds: 0 }).apex;
    expect(s).toBeGreaterThan(h + 0.15);
    for (const r of CAR_ORDER) expect(CARS[r].jumpApex).toBeLessThanOrEqual(MAX_JUMP_APEX);
  });
});

/**
 * Drives at a step of `height` metres (a wide, deep block) at `approach` m/s, hopping when the
 * nose is `lead` metres short of it. Returns how far past the step the car got and whether it is on top.
 */
function attack(role: (typeof CAR_ORDER)[number], height: number, hop: boolean, lead = 2.2, approach = 7): { onTop: boolean; progress: number } {
  const spec = CARS[role];
  const pw = createPhysicsWorld(flatTerrain(Surface.Grass));
  const R = pw.rapier;
  const startZ = -250;
  const stepZ = startZ + 22;
  pw.world.createCollider(R.ColliderDesc.cuboid(6, height / 2, 40).setTranslation(0, height / 2, stepZ + 40), undefined);
  const v = new Vehicle(pw, spec, 0, startZ, 0);
  let hopped = false;
  let best = -1e9;
  for (let i = 0; i < 60 * 14; i++) {
    const speed = v.forwardSpeed();
    const throttle = speed < approach ? 1 : 0.35; // hold roughly walking-pace-plus-a-bit
    v.step({ throttle, steer: 0, handbrake: false }, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
    const t = v.body.translation();
    const noseGap = stepZ - (t.z + spec.half.z);
    if (hop && !hopped && v.grounded >= 3 && noseGap < lead) {
      v.requestJump();
      hopped = true;
    }
    best = Math.max(best, t.z - stepZ);
  }
  const t = v.body.translation();
  // On top: the chassis is up at ledge height plus its ride height, well past the face.
  return { onTop: t.y > height + Vehicle.rideHeight(spec) - 0.15 && t.z > stepZ + 1, progress: best };
}

describe('hops against obstacles (design rules)', () => {
  const leads = [0.3, 0.8, 1.5, 2.2, 3, 4, 5];
  const anyHop = (role: (typeof CAR_ORDER)[number], h: number, approach: number): boolean => leads.some((l) => attack(role, h, true, l, approach).progress > 30);

  it.each(CAR_ORDER)('%s cannot hop over a 1.1 m tall boulder at any speed or timing', (role) => {
    expect(attack(role, 1.1, false).progress).toBeLessThan(30);
    for (const approach of [4, 7, 12]) expect(anyHop(role, 1.1, approach)).toBe(false);
  });

  it('a hop gets Relay over what it cannot drive over, but not past a boulder', () => {
    expect(attack('relay', 0.8, false).progress).toBeLessThan(30);
    expect(anyHop('relay', 0.8, 7)).toBe(true);
  });

  it('a hop gets Scout over a 0.8 m ledge it cannot drive over', () => {
    expect(attack('scout', 0.8, false).progress).toBeLessThan(30);
    expect(anyHop('scout', 0.8, 7)).toBe(true);
  });

  it('rubble is nothing: every car can hop a 0.3 m lip', () => {
    for (const role of CAR_ORDER) expect(anyHop(role, 0.3, 7)).toBe(true);
  });
});
