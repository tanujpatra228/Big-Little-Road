import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAR_ORDER, CARS, type CarRole } from '../src/shared/cars';
import { generateTerrain, PLATFORM, PLATFORM_WALL } from '../src/shared/terrain';
import { Surface } from '../src/shared/surfaces';
import { PLANK, plankEnds, plankPlacement, snapRamp, type PlankPose } from '../src/shared/tether';
import { createPhysicsWorld, initRapier, FIXED_DT, type PhysicsWorld } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';

const t = generateTerrain(20260);
const dist = (x: number, z: number): number => Math.hypot(x - PLATFORM.x, z - PLATFORM.z);
const at = (angle: number, r: number): { x: number; z: number } => ({ x: PLATFORM.x + Math.cos(angle) * r, z: PLATFORM.z + Math.sin(angle) * r });

describe('the terrace', () => {
  it('has a flat paved top above the wall height cars can hop', () => {
    for (let a = 0; a < 6.3; a += 0.5) {
      for (const r of [0, 3, 6, 7.0]) {
        const p = at(a, r);
        expect(Math.abs(t.heightAt(p.x, p.z) - (0.15 + PLATFORM.height))).toBeLessThan(0.06);
        expect(t.surfaceAt(p.x, p.z)).toBe(Surface.Patio);
      }
    }
    expect(PLATFORM.height).toBeGreaterThan(1.1); // taller than any tall boulder, which is the most a car is meant to clear
  });

  it('is surrounded by level ground, so a ramp has a known angle', () => {
    for (let a = 0; a < 6.3; a += 0.4) {
      for (const r of [9.5, 10.5, 11.5]) {
        const p = at(a, r);
        expect(Math.abs(t.heightAt(p.x, p.z) - 0.15)).toBeLessThan(0.16);
      }
    }
  });

  it('stays clear of the patio, the pond and the other zones', () => {
    expect(Math.hypot(PLATFORM.x, PLATFORM.z)).toBeGreaterThan(11 + 17);
    expect(Math.hypot(PLATFORM.x - 42, PLATFORM.z + 42)).toBeGreaterThan(15 + 17);
  });
});

describe('the wall', () => {
  it('stands outside the sloped edge and is taller than the 1.1 m a car is meant to clear', () => {
    expect(PLATFORM_WALL.face).toBeGreaterThan(PLATFORM.r + 0.2);
    expect(PLATFORM_WALL.top - 0.15).toBeGreaterThan(1.0);
  });

  it('is a hair lower than the plank surface where the plank crosses it, so cars roll over it', () => {
    const rise = PLATFORM.height / (PLANK.length / 1); // ramp slope over the plank length, about 0.325
    const planktop = 0.15 + PLATFORM.height + PLANK.thickness - (PLATFORM_WALL.face - (PLATFORM.r - 0.4)) * rise;
    expect(planktop).toBeGreaterThan(PLATFORM_WALL.top);
  });
});

describe('the plank as a ramp', () => {
  it('placement follows the slope between its ends, and matches three.js rotation maths', () => {
    const pose: PlankPose = { x: PLATFORM.x - 9.6, z: PLATFORM.z, yaw: Math.PI / 2 }; // lawn to the west, pointing east at the platform
    const p = plankPlacement(pose, (x, z) => t.heightAt(x, z));
    expect(p.pitch).toBeGreaterThan(0.25); // leaning up toward the platform, about 18 degrees
    expect(p.pitch).toBeLessThan(0.4);
    const ref = new THREE.Quaternion().setFromEuler(new THREE.Euler(-p.pitch, pose.yaw, 0, 'YXZ'));
    expect(Math.abs(p.qx * ref.x + p.qy * ref.y + p.qz * ref.z + p.qw * ref.w)).toBeGreaterThan(0.999999);
  });

  it('is wide enough for the widest car to drive along', () => {
    expect(PLANK.width).toBeGreaterThan(CARS.hauler.trackHalf * 2 + 0.3);
  });
});

describe('physics: no way up without the plank, an easy way with it', () => {
  beforeAll(initRapier);

  const world = (withPlank: PlankPose | null): PhysicsWorld => {
    const pw = createPhysicsWorld(t);
    if (withPlank) {
      const p = plankPlacement(withPlank, (x, z) => t.heightAt(x, z), 0.01);
      pw.world.createCollider(
        pw.rapier.ColliderDesc.cuboid(PLANK.width / 2, PLANK.thickness / 2, PLANK.length / 2)
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw })
          .setFriction(0.9),
      );
    }
    return pw;
  };

  /** Drive from `from` toward the platform centre at full throttle. Returns whether it ended up on top, and whether it was ever on top. */
  const run = (role: CarRole, pw: PhysicsWorld, angle: number, startR: number, seconds: number, hopLead?: number): { onTop: boolean; everOnTop: boolean } => {
    const from = at(angle, startR);
    const yaw = Math.atan2(PLATFORM.x - from.x, PLATFORM.z - from.z);
    const v = new Vehicle(pw, CARS[role], from.x, from.z, yaw);
    let ever = false;
    let hopped = false;
    for (let i = 0; i < seconds / FIXED_DT; i++) {
      const here = v.body.translation();
      if (hopLead !== undefined && !hopped && v.grounded >= 3 && dist(here.x, here.z) < PLATFORM_WALL.face + CARS[role].half.z + hopLead) {
        v.requestJump();
        hopped = true;
      }
      v.step({ throttle: i < 30 ? 0 : 1, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
      const p = v.body.translation();
      if (dist(p.x, p.z) < PLATFORM.r - 1 && p.y > PLATFORM.height) ever = true;
    }
    const p = v.body.translation();
    return { onTop: dist(p.x, p.z) < PLATFORM.r - 0.5 && p.y > PLATFORM.height, everOnTop: ever };
  };

  it.each(CAR_ORDER)('%s cannot get up by driving at the wall, from any side', (role) => {
    for (const angle of [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6]) {
      const r = run(role, world(null), angle, 15, 9);
      expect(r.everOnTop).toBe(false);
    }
  });

  it.each(CAR_ORDER)('%s cannot hop its way up the wall either, at any timing', (role) => {
    for (const angle of [0, 1.6, 3.2, 4.8]) {
      for (const lead of [0.5, 1.5, 2.5, 4]) {
        expect(run(role, world(null), angle, 15, 9, lead).everOnTop).toBe(false);
      }
    }
  });

  it.each(CAR_ORDER)('%s drives up the plank onto the platform', (role) => {
    // Lawn to the west of the platform. The plank lies along the radius, its far end 0.4 m onto the top.
    const angle = Math.PI; // west of the platform
    const centre = at(angle, PLATFORM.r + PLANK.length / 2 - 0.4);
    const pose: PlankPose = { x: centre.x, z: centre.z, yaw: Math.atan2(PLATFORM.x - centre.x, PLATFORM.z - centre.z) };
    const [, far] = plankEnds(pose);
    expect(dist(far.x, far.z)).toBeLessThan(PLATFORM.r - 0.2); // rests on the platform
    // It reaches the top. (At full throttle it then flies across and off the far side; a driver would brake.)
    const r = run(role, world(pose), angle, 15, 14);
    expect(r.everOnTop).toBe(true);
  });

  it.each(CAR_ORDER)('%s drives up a plank that was set down crookedly and snapped into place', (role) => {
    // What players actually do: let go roughly near the wall, a bit off straight and a bit short.
    const angle = 2.2;
    const rough: PlankPose = { x: PLATFORM.x + Math.cos(angle) * 11.2, z: PLATFORM.z + Math.sin(angle) * 11.2, yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)) + 0.45 };
    const snapped = snapRamp(rough);
    expect(snapped).not.toBeNull();
    const r = run(role, world(snapped), angle, 15, 14);
    expect(r.everOnTop).toBe(true);
  });
});
