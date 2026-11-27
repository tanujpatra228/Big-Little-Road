import { beforeAll, describe, expect, it } from 'vitest';
import { generateTerrain } from '../src/shared/terrain';
import { CARS } from '../src/shared/cars';
import { createPhysicsWorld, initRapier, FIXED_DT } from '../src/client/physics/world';
import { Vehicle } from '../src/client/physics/vehicle';
import { DEEP_MUD, MudState, STUCK_DRIVE, inDeepMud } from '../src/shared/mud';
import { WINCH_ACCEL, pullToward, reelDone } from '../src/shared/winch';
import { CAPACITY_SECONDS } from '../src/shared/battery';

beforeAll(initRapier);

/** A stuck car in the middle of the bog, pulled for `seconds` toward a direction `angle` away from its nose. */
function drag(role: 'scout' | 'hauler' | 'relay', angle: number, loose: boolean, seconds = 3): number {
  const pw = createPhysicsWorld(generateTerrain(20260));
  const v = new Vehicle(pw, CARS[role], DEEP_MUD.x, DEEP_MUD.z, 0); // nose toward +z
  v.driveScale = STUCK_DRIVE;
  v.speedCap = 0.5;
  for (let i = 0; i < 1 / FIXED_DT; i++) { v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT); pw.world.step(); v.afterPhysics(); } // settle
  const t0 = v.body.translation();
  const ax = Math.sin(angle) * WINCH_ACCEL;
  const az = Math.cos(angle) * WINCH_ACCEL;
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    v.pushPlanar(ax, az, FIXED_DT, loose);
    v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT);
    pw.world.step();
    v.afterPhysics();
  }
  const t1 = v.body.translation();
  return Math.hypot(t1.x - t0.x, t1.z - t0.z);
}

describe('a winch dragging a stuck car out of the bog', () => {
  for (const role of ['scout', 'hauler', 'relay'] as const) {
    for (const [name, angle] of [['straight ahead', 0], ['at 45 degrees', Math.PI / 4], ['sideways', Math.PI / 2], ['backwards', Math.PI]] as const) {
      it(`${role}, stuck and pulled ${name}: moves at least 3 m in 3 s`, () => {
        expect(drag(role, angle, true)).toBeGreaterThan(3);
      });
    }
  }

  it('without letting the tyres slide, a sideways pull barely moves a stuck car (why the winch loosens the grip)', () => {
    expect(drag('scout', Math.PI / 2, false)).toBeLessThan(drag('scout', Math.PI / 2, true));
  });

  it('a stuck car is not thrown around: the pull never gets it over 6 m/s', () => {
    const pw = createPhysicsWorld(generateTerrain(20260));
    const v = new Vehicle(pw, CARS.scout, DEEP_MUD.x, DEEP_MUD.z, 0);
    v.driveScale = STUCK_DRIVE;
    v.speedCap = 0.5;
    let peak = 0;
    for (let i = 0; i < 6 / FIXED_DT; i++) {
      v.pushPlanar(Math.sin(0.7) * WINCH_ACCEL, Math.cos(0.7) * WINCH_ACCEL, FIXED_DT, true);
      v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
      const l = v.body.linvel();
      peak = Math.max(peak, Math.hypot(l.x, l.z));
    }
    expect(peak).toBeLessThan(6);
    expect(v.isFlipped).toBe(false);
  });
});

describe('the whole rescue, in physics, against the battery', () => {
  /** A stuck car in the middle of the bog, a Hauler on the shore 21 m away, winching until it is within reach. Returns the seconds it took. */
  function rescue(role: 'scout' | 'hauler' | 'relay'): { seconds: number; freed: boolean; flipped: boolean; end: number } {
    const pw = createPhysicsWorld(generateTerrain(20260));
    const v = new Vehicle(pw, CARS[role], DEEP_MUD.x, DEEP_MUD.z, 0);
    const mud = new MudState();
    const hauler = { x: DEEP_MUD.x + 0.795 * 21, z: DEEP_MUD.z - 0.606 * 21 };
    // Sink first, with nobody pulling.
    for (let t = 0; t < 8 && !mud.stuck; t += FIXED_DT) {
      mud.update(FIXED_DT, { inMud: true, throttle: 0, winched: false, role });
      v.driveScale = mud.drive;
      v.speedCap = mud.stuck ? 0.5 : null;
      v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
    }
    expect(mud.stuck).toBe(true);
    let seconds = 0;
    for (; seconds < 40; seconds += FIXED_DT) {
      const p = v.body.translation();
      if (reelDone(p, hauler)) break;
      const a = pullToward(p, hauler);
      mud.update(FIXED_DT, { inMud: inDeepMud(p.x, p.z), throttle: 0, winched: true, role });
      v.driveScale = mud.drive;
      v.speedCap = mud.stuck ? 0.5 : null;
      v.pushPlanar(a.x, a.z, FIXED_DT, true);
      v.step({ throttle: 0, steer: 0, handbrake: false }, FIXED_DT);
      pw.world.step();
      v.afterPhysics();
    }
    const p = v.body.translation();
    return { seconds, freed: !mud.stuck, flipped: v.isFlipped, end: Math.hypot(p.x - hauler.x, p.z - hauler.z) };
  }

  for (const role of ['scout', 'hauler', 'relay'] as const) {
    it(`${role}: freed, dragged to the Hauler, upright, and within one full battery (${CAPACITY_SECONDS} s of reeling)`, () => {
      const r = rescue(role);
      expect(r.freed).toBe(true);
      expect(r.flipped).toBe(false);
      expect(r.end).toBeLessThan(4.5);
      expect(r.seconds).toBeLessThan(CAPACITY_SECONDS);
    });
  }
});
