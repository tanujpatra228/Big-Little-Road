import { describe, expect, it } from 'vitest';
import {
  BASE, BASE_RANGE, CLEAN_ABOVE, InputDelay, MAX_LAG, RECOVER_AT, RELAY_RANGE, SignalLink, failsafeInput, lagFor, linkedRelays, qualityOf, signalAt, strength,
  type Pt, type RelayNode,
} from '../src/shared/signal';
import { PLATFORM, TERRAIN_SIZE, ZONES } from '../src/shared/terrain';
import type { DriveInput } from '../src/shared/driving';

const near = (a: number, b: number, tol = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(tol);
const at = (dx: number, dz = 0): Pt => ({ x: BASE.x + dx, z: BASE.z + dz });
const relay = (id: string, dx: number, dz = 0): RelayNode => ({ id, ...at(dx, dz) });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('strength', () => {
  it('is 1 at the source and falls to 0 at the edge of its range, never outside 0 to 1', () => {
    expect(strength(0, 40)).toBe(1);
    expect(strength(20, 40)).toBe(0.5);
    expect(strength(40, 40)).toBe(0);
    expect(strength(400, 40)).toBe(0);
  });

  it('the base reaches further than a Relay', () => {
    expect(BASE_RANGE).toBeGreaterThan(RELAY_RANGE);
  });
});

describe('linking Relays into a web', () => {
  it('a Relay within the base range is linked; one outside every source is not', () => {
    expect(linkedRelays([relay('a', 40)]).map((r) => r.id)).toEqual(['a']);
    expect(linkedRelays([relay('a', 80)])).toEqual([]);
  });

  it('links chain: a Relay reaches another, which reaches the next', () => {
    const chain = [relay('far', 112), relay('mid', 76), relay('near', 40)];
    expect(linkedRelays(chain).map((r) => r.id).sort()).toEqual(['far', 'mid', 'near']);
  });

  it('a break in the chain leaves the far end unlinked', () => {
    const chain = [relay('far', 140), relay('mid', 76), relay('near', 40)]; // 140 to 76 is 64: too far
    expect(linkedRelays(chain).map((r) => r.id).sort()).toEqual(['mid', 'near']);
  });

  it('does not depend on the order the Relays are listed in', () => {
    const a = linkedRelays([relay('far', 110), relay('near', 40), relay('mid', 75)]).map((r) => r.id).sort();
    const b = linkedRelays([relay('near', 40), relay('mid', 75), relay('far', 110)]).map((r) => r.id).sort();
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it('two Relays out of range of everything do not link each other into the web', () => {
    expect(linkedRelays([relay('a', 90), relay('b', 100)])).toEqual([]);
  });
});

describe('signal at a point', () => {
  it('is full at the base and fades with distance', () => {
    expect(signalAt(at(0), [])).toBe(1);
    near(signalAt(at(BASE_RANGE / 2), []), 0.5);
    expect(signalAt(at(BASE_RANGE), [])).toBe(0);
  });

  it('a linked Relay extends it; an unlinked one does nothing', () => {
    const far = at(70);
    expect(signalAt(far, [])).toBe(0);
    expect(signalAt(far, [relay('r', 45)])).toBeGreaterThan(0.3); // linked, 25 m away
    expect(signalAt(far, [relay('r', 70)])).toBe(0); // sitting right on the car but not connected to anything
  });

  it('takes the best source, not the sum', () => {
    const p = at(20);
    const alone = signalAt(p, []);
    const withRelay = signalAt(p, [relay('r', 30)]);
    expect(withRelay).toBeGreaterThanOrEqual(alone);
    expect(withRelay).toBeLessThanOrEqual(1);
  });

  it('a Relay is not its own source, and is not linked through something only it links', () => {
    const me = relay('me', 100);
    const helper = relay('helper', 130); // only reachable through me
    // Out of the base's range: as far as I can tell I have no signal, helper or not.
    expect(signalAt(me, [me, helper], 'me')).toBe(0);
    // But from the helper's side, I (if I am connected) would carry it.
    const nearMe = relay('near', 40);
    expect(signalAt(helper, [me, nearMe])).toBe(0); // 130 from helper to ... near is 90 away, me is 30 away and me is linked through near? 100-40=60 > 38: not linked
  });

  it('a Relay that is itself in range of the base gets signal like any car', () => {
    const me = relay('me', 30);
    near(signalAt(me, [me], 'me'), strength(30, BASE_RANGE));
  });
});

describe('the yard: does it need the team?', () => {
  const R = TERRAIN_SIZE / 2;
  /** The best a team can do with n Relays: the first as far out as the base can still reach, each next as far as the last can. */
  const best = (target: Pt, n: number): number => {
    const d = dist(BASE, target);
    const relays: RelayNode[] = [];
    for (let i = 0; i < n; i++) {
      const out = Math.min(d, BASE_RANGE - 1 + i * (RELAY_RANGE - 1));
      relays.push({ id: `r${i}`, x: BASE.x + ((target.x - BASE.x) * out) / d, z: BASE.z + ((target.z - BASE.z) * out) / d });
    }
    return signalAt(target, relays);
  };

  it('the patio and the Terrace are inside the base range: they work without any Relay', () => {
    expect(signalAt(ZONES.patio, [])).toBeGreaterThan(0.9);
    // The Terrace is 29 m out: a fair signal, only 39% strong, but the lag there is a few hundredths of a second.
    expect(signalAt(PLATFORM, [])).toBeGreaterThan(0.3);
    expect(lagFor(signalAt(PLATFORM, []))).toBeLessThan(0.1);
  });

  it('every other zone is out of the base range, so reaching it needs a Relay', () => {
    for (const z of [ZONES.sand, ZONES.mud, ZONES.rock, ZONES.pond, ZONES.woodpile]) {
      expect(signalAt(z, [])).toBe(0);
      expect(best(z, 1)).toBeGreaterThan(0.4); // and one well placed Relay is enough to get there, with signal to spare
    }
  });

  it('the far corners of the yard cannot be reached with one Relay, but can with two: it takes the whole team', () => {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = { x: sx * (R - 12), z: sz * (R - 12) };
        expect(best(corner, 1)).toBe(0);
        expect(best(corner, 2)).toBeGreaterThan(0);
      }
    }
  });

  it('a lone player cannot leave the base range', () => {
    expect(signalAt(at(BASE_RANGE + 1), [])).toBe(0);
  });
});

describe('lag and failsafe', () => {
  it('no lag at or above the clean level, full lag at zero', () => {
    expect(lagFor(1)).toBe(0);
    expect(lagFor(CLEAN_ABOVE)).toBe(0);
    expect(lagFor(0)).toBe(MAX_LAG);
  });

  it('lag only ever grows as the signal falls, and is smooth', () => {
    let prev = 0;
    let biggestStep = 0;
    for (let s = 1; s >= 0; s -= 0.005) {
      const l = lagFor(s);
      expect(l).toBeGreaterThanOrEqual(prev - 1e-12);
      biggestStep = Math.max(biggestStep, l - prev);
      prev = l;
    }
    expect(biggestStep).toBeLessThan(0.02);
  });

  it('the failsafe trips at zero and holds until there is a margin, so it cannot flicker at the edge', () => {
    const link = new SignalLink();
    expect(link.update(0.3)).toBe(false);
    expect(link.update(0)).toBe(true);
    expect(link.update(RECOVER_AT / 2)).toBe(true); // creeping back: still cut off
    expect(link.update(RECOVER_AT)).toBe(false);
    expect(link.update(0.01)).toBe(false); // fine until it actually hits zero again
    expect(link.update(0)).toBe(true);
    link.reset();
    expect(link.cutOff).toBe(false);
  });

  it('names the state for the HUD', () => {
    expect(qualityOf(0.9, false)).toBe('good');
    expect(qualityOf(0.3, false)).toBe('weak');
    expect(qualityOf(0.3, true)).toBe('lost');
  });
});

describe('the failsafe cuts the throttle but never traps you', () => {
  const held = (over: Partial<DriveInput>): DriveInput => ({ throttle: 0, steer: 0, handbrake: false, nitro: false, ...over });

  it('full throttle forward becomes braking while moving, and nothing once stopped', () => {
    expect(failsafeInput(held({ throttle: 1 }), 10).throttle).toBe(-1);
    expect(failsafeInput(held({ throttle: 1 }), 0).throttle).toBe(0);
    expect(failsafeInput(held({ throttle: 0 }), 5).throttle).toBe(-1);
  });

  it('reversing still works, so there is always a way back', () => {
    expect(failsafeInput(held({ throttle: -1 }), 0).throttle).toBe(-1);
    expect(failsafeInput(held({ throttle: -0.5 }), -3).throttle).toBe(-0.5);
  });

  it('steering and the handbrake still work, and nitro is cut', () => {
    const r = failsafeInput(held({ steer: 0.7, handbrake: true, nitro: true, throttle: 1 }), 0);
    expect(r.steer).toBe(0.7);
    expect(r.handbrake).toBe(true);
    expect(r.nitro).toBe(false);
  });
});

describe('input delay', () => {
  it('with no lag it returns what the player is holding now', () => {
    const d = new InputDelay<number>();
    for (let i = 0; i < 10; i++) {
      d.push(i / 60, i);
      expect(d.at(i / 60, 0)).toBe(i);
    }
  });

  it('with lag it returns what was held that long ago', () => {
    const d = new InputDelay<number>();
    let out = -1;
    for (let i = 0; i < 120; i++) {
      d.push(i / 60, i);
      out = d.at(i / 60, 0.5)!;
    }
    expect(out).toBe(119 - 30); // 0.5 s is 30 steps
  });

  it('a sudden press shows up exactly one lag later', () => {
    const d = new InputDelay<number>();
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      d.push(i / 60, i === 30 ? 1 : i > 30 ? 1 : 0);
      seen.push(d.at(i / 60, 0.25)!);
    }
    const first = seen.findIndex((v) => v === 1);
    expect(first).toBe(30 + 15);
  });

  it('never replays the past when the lag shrinks: a recovering signal catches up forward only', () => {
    const d = new InputDelay<number>();
    let lag = 0.6;
    let prevOut = -1;
    for (let i = 0; i < 300; i++) {
      d.push(i / 60, i);
      if (i > 100) lag = Math.max(0, lag - 0.05); // the signal comes back quickly
      const out = d.at(i / 60, lag)!;
      expect(out).toBeGreaterThanOrEqual(prevOut);
      prevOut = out;
    }
    expect(prevOut).toBe(299);
  });

  it('keeps only a short history, however long it runs', () => {
    const d = new InputDelay<number>();
    for (let i = 0; i < 60 * 60 * 5; i++) {
      d.push(i / 60, i);
      d.at(i / 60, 0.6);
    }
    // 5 minutes of input: if it kept everything this would be 18000 entries and slow; check it still answers fast and right.
    expect(d.at(60 * 60 * 5 / 60, 0.6)).toBeGreaterThan(60 * 60 * 5 - 60);
  });

  it('says nothing until something has been recorded', () => {
    expect(new InputDelay<number>().at(1, 0.2)).toBeUndefined();
  });
});

import { BEACON_RANGE } from '../src/shared/signal';

describe('placed beacons as radio sources', () => {
  const beacon = (id: string, x: number, z: number) => ({ id: `beacon:${id}`, x, z, range: BEACON_RANGE });

  it('a beacon within the base range extends it, with its own (smaller) reach', () => {
    const b = beacon('o1', BASE.x + 40, BASE.z);
    expect(signalAt({ x: BASE.x + 60, z: BASE.z }, [])).toBe(0);
    expect(signalAt({ x: BASE.x + 60, z: BASE.z }, [b])).toBeGreaterThan(0.2);
    expect(signalAt({ x: BASE.x + 40 + BEACON_RANGE + 1, z: BASE.z }, [b])).toBe(0);
  });

  it('a beacon that nothing links is silent', () => {
    const lonely = beacon('o1', BASE.x + 90, BASE.z);
    expect(signalAt({ x: BASE.x + 90, z: BASE.z }, [lonely])).toBe(0);
    expect(linkedRelays([lonely])).toEqual([]);
  });

  it('beacons chain, each linked by the one before it, using the reach of the one that is already linked', () => {
    const b1 = beacon('o1', BASE.x + 45, BASE.z);
    const b2 = beacon('o2', BASE.x + 45 + BEACON_RANGE - 1, BASE.z);
    const b3 = beacon('o3', BASE.x + 45 + 2 * (BEACON_RANGE - 1), BASE.z);
    expect(linkedRelays([b3, b2, b1]).map((n) => n.id).sort()).toEqual(['beacon:o1', 'beacon:o2', 'beacon:o3']);
    expect(linkedRelays([b3, b2]).map((n) => n.id)).toEqual([]); // b2 is 74 m out: not linked without b1
    expect(signalAt({ x: BASE.x + 45 + 2 * (BEACON_RANGE - 1) + 5, z: BASE.z }, [b1, b2, b3])).toBeGreaterThan(0.5);
  });

  it('a Relay truck can link through a beacon, and a beacon through a Relay', () => {
    const b = beacon('o1', BASE.x + 45, BASE.z);
    const relay = { id: 'p2', x: BASE.x + 45 + BEACON_RANGE - 2, z: BASE.z }; // within the beacon's reach, out of the base's
    expect(linkedRelays([b, relay]).map((n) => n.id).sort()).toEqual(['beacon:o1', 'p2']);
    const far = beacon('o2', BASE.x + 45 + BEACON_RANGE - 2 + 35, BASE.z); // within the Relay's reach (38)
    expect(linkedRelays([b, relay, far]).map((n) => n.id)).toContain('beacon:o2');
  });

  it('two beacons from the toolbox reach the far corner where the lost car waits', () => {
    // 45 m out, then 70 m out, along the way to a point about 87 m from the base.
    const dir = { x: 0.78, z: -0.62 };
    const at = (d: number) => ({ x: BASE.x + dir.x * d, z: BASE.z + dir.z * d });
    const target = at(87);
    const b1 = { id: 'beacon:o1', ...at(45), range: BEACON_RANGE };
    const b2 = { id: 'beacon:o2', ...at(70), range: BEACON_RANGE };
    expect(signalAt(target, [])).toBe(0);
    expect(signalAt(target, [b1])).toBe(0);
    expect(signalAt(target, [b1, b2])).toBeGreaterThan(0.25);
    expect(signalAt(target, [b2])).toBe(0); // b2 alone is not linked
  });

  it('is unaffected for plain Relays (no range given)', () => {
    const relay = { id: 'p2', x: BASE.x + 40, z: BASE.z };
    expect(signalAt({ x: BASE.x + 70, z: BASE.z }, [relay])).toBeCloseTo(1 - 30 / 38, 5);
  });
});
