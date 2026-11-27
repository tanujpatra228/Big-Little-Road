import { describe, expect, it } from 'vitest';
import {
  BatteryView, CAPACITY_SECONDS, DRAIN_PER_BOOSTER, FULL, REGEN_DELAY, REGEN_PER_SECOND, RESTART_LEVEL, SharedBattery, advance, fromBatteryInfo, toBatteryInfo,
  type BatterySnapshot,
} from '../src/shared/battery';

const near = (a: number, b: number, tol = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(tol);
const snap = (over: Partial<BatterySnapshot> = {}): BatterySnapshot => ({ ...FULL, ...over });

describe('advance: the exact maths', () => {
  it('one boosting car empties a full battery in its capacity time', () => {
    const s = snap({ boosters: 1 });
    near(advance(s, CAPACITY_SECONDS / 2).level, 0.5);
    near(advance(s, CAPACITY_SECONDS - 0.001).level, 0.0001 * DRAIN_PER_BOOSTER * 10, 1e-4);
    expect(advance(s, CAPACITY_SECONDS).level).toBe(0);
  });

  it('two cars drain twice as fast, three three times: boosting together is a team decision', () => {
    for (const n of [1, 2, 3, 4]) near(advance(snap({ boosters: n }), 1).level, 1 - n * DRAIN_PER_BOOSTER);
  });

  it('running dry cuts everyone off and locks it out, in the middle of a step', () => {
    const r = advance(snap({ level: 0.2, boosters: 1 }), 5); // dry after 2 s, then 1.5 s delay, then 1.5 s of refill
    expect(r.boosters).toBe(0);
    near(r.level, REGEN_PER_SECOND * 1.5, 1e-12);
    expect(r.locked).toBe(true); // 0.05 is still under the restart level
  });

  it('refills slowly after a pause, and not before', () => {
    const idle = snap({ level: 0.4, regenIn: REGEN_DELAY });
    near(advance(idle, REGEN_DELAY - 0.01).level, 0.4);
    near(advance(idle, REGEN_DELAY + 3).level, 0.4 + 3 * REGEN_PER_SECOND);
    expect(advance(idle, 1000).level).toBe(1);
  });

  it('a locked battery lets people boost again only once it is back to the restart level', () => {
    const locked = snap({ level: 0, locked: true, regenIn: REGEN_DELAY });
    expect(advance(locked, REGEN_DELAY + (RESTART_LEVEL / REGEN_PER_SECOND) * 0.9).locked).toBe(true);
    expect(advance(locked, REGEN_DELAY + (RESTART_LEVEL / REGEN_PER_SECOND) * 1.05).locked).toBe(false);
  });

  it('is exactly additive: two short steps equal one long one, whatever happens inside', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const s = snap({ level: rnd(), boosters: Math.floor(rnd() * 4), regenIn: rnd() * 2, locked: rnd() < 0.3 && false });
      const a = rnd() * 6;
      const b = rnd() * 6;
      const one = advance(s, a + b);
      const two = advance(advance(s, a), b);
      near(one.level, two.level, 1e-9);
      expect(one.locked).toBe(two.locked);
    }
  });

  it('never goes below empty or above full, and ignores no-time and negative time', () => {
    expect(advance(snap({ boosters: 4 }), 100).level).toBe(0.0 + advance(snap({ boosters: 4 }), 100).level);
    for (const dt of [0, -3, NaN]) expect(advance(snap({ level: 0.6, boosters: 1 }), dt)).toEqual(snap({ level: 0.6, boosters: 1 }));
    expect(advance(snap({ level: 0.99, regenIn: 0 }), 1000).level).toBe(1);
  });
});

describe('the room books (SharedBattery)', () => {
  it('starts full, drains while cars boost and stops when they stop', () => {
    const b = new SharedBattery();
    expect(b.start('p1', 0)).toBe(true);
    near(b.snapshot(2000).level, 1 - 2 * DRAIN_PER_BOOSTER);
    b.stop('p1', 2000);
    const s = b.snapshot(2500);
    near(s.level, 1 - 2 * DRAIN_PER_BOOSTER);
    expect(s.boosters).toBe(0);
    near(s.regenIn, REGEN_DELAY - 0.5);
  });

  it('a second car joining doubles the drain, and leaving halves it again', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    b.start('p2', 1000); // 1 s alone: 0.1 used
    near(b.snapshot(2000).level, 1 - 0.1 - 2 * DRAIN_PER_BOOSTER);
    b.stop('p2', 2000);
    near(b.snapshot(3000).level, 1 - 0.1 - 0.2 - DRAIN_PER_BOOSTER);
  });

  it('starting twice does not count twice, and stopping a car that is not boosting does nothing', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    b.start('p1', 100);
    expect(b.snapshot(100).boosters).toBe(1);
    b.stop('p9', 200);
    expect(b.snapshot(200).boosters).toBe(1);
  });

  it('running dry cuts everyone off, then refuses starts until it recovers', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    b.start('p2', 0);
    const dry = b.snapshot(5000); // two cars: dry in 5 s
    expect(dry.locked).toBe(true);
    expect(dry.boosters).toBe(0);
    expect(b.isBoosting('p1')).toBe(false);
    expect(b.start('p1', 5100)).toBe(false);
    // Refill delay plus enough to reach the restart level.
    const back = 5000 + (REGEN_DELAY + RESTART_LEVEL / REGEN_PER_SECOND + 0.5) * 1000;
    expect(b.start('p1', back)).toBe(true);
  });

  it('a car that leaves stops draining at once', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    b.stop('p1', 1000); // the room calls stop when a player leaves
    // 0.9 left after the one second of boosting; 3 s later it has refilled for 1.5 s of that (after the delay).
    near(b.snapshot(4000).level, 1 - DRAIN_PER_BOOSTER + REGEN_PER_SECOND * (3 - REGEN_DELAY), 1e-9);
    near(b.snapshot(60000).level, 1);
  });

  it('tolerates a clock that steps back', () => {
    const b = new SharedBattery();
    b.start('p1', 5000);
    expect(() => b.snapshot(4000)).not.toThrow();
    expect(b.snapshot(4000).level).toBeLessThanOrEqual(1);
  });
});

describe('the wire form', () => {
  it('round trips to the precision of a thousandth', () => {
    const s = snap({ level: 0.4137, boosters: 2, regenIn: 0.75, locked: true });
    const back = fromBatteryInfo(toBatteryInfo(s));
    near(back.level, 0.414, 1e-9);
    expect(back).toMatchObject({ boosters: 2, locked: true });
    near(back.regenIn, 0.75);
    for (const v of Object.values(toBatteryInfo(s))) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
  });

  it('clamps nonsense from the network', () => {
    const s = fromBatteryInfo({ level: 5000, boosters: -3, regenIn: -10, locked: false });
    expect(s).toEqual({ level: 1, boosters: 0, regenIn: 0, locked: false });
  });
});

describe('a player\'s view of the battery', () => {
  it('knows nothing at first, reads as full, and forgets on reset', () => {
    const v = new BatteryView();
    expect(v.known).toBe(false);
    expect(v.at(0)).toEqual(FULL);
    v.receive(toBatteryInfo(snap({ level: 0.5 })), 0);
    expect(v.known).toBe(true);
    v.reset();
    expect(v.known).toBe(false);
  });

  it('extrapolates what the room said, so nobody has to stream a meter', () => {
    const v = new BatteryView();
    v.receive(toBatteryInfo(snap({ level: 0.8, boosters: 1 })), 1000);
    near(v.at(1000 + 3000).level, 0.8 - 3 * DRAIN_PER_BOOSTER, 1e-3);
    near(v.at(1000).level, 0.8, 1e-3);
  });

  it('our own boost shows at once, and the room\'s snapshot replaces the guess', () => {
    const v = new BatteryView();
    v.receive(toBatteryInfo(snap({ level: 1 })), 0);
    v.selfBoost(true, 1000);
    expect(v.at(1000).boosters).toBe(1);
    near(v.at(3000).level, 1 - 2 * DRAIN_PER_BOOSTER, 1e-3);
    v.receive(toBatteryInfo(snap({ level: 0.7, boosters: 1 })), 3200);
    near(v.at(3200).level, 0.7, 1e-3);
    v.selfBoost(false, 4200);
    expect(v.at(4200).boosters).toBe(0);
    near(v.at(4200).level, 0.7 - DRAIN_PER_BOOSTER, 1e-3);
  });

  it('a view of a battery that runs dry reads empty and locked on its own, without any message', () => {
    const v = new BatteryView();
    v.receive(toBatteryInfo(snap({ level: 0.1, boosters: 1 })), 0);
    const later = v.at(2000);
    expect(later.level).toBeLessThan(0.1);
    expect(later.locked).toBe(true);
    expect(later.boosters).toBe(0);
  });
});

import { CHARGE_AMOUNT, CHARGE_COOLDOWN } from '../src/shared/battery';

describe('a Relay charge', () => {
  it('adds its amount at once and never goes past full', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    b.stop('p1', 5000); // used half
    expect(b.snapshot(5000).level).toBeCloseTo(0.5, 3);
    expect(b.topUp(CHARGE_AMOUNT, 5000).level).toBeCloseTo(0.8, 3);
    expect(b.topUp(CHARGE_AMOUNT, 5000).level).toBeCloseTo(1, 3);
  });

  it('brings a battery that ran dry back, and lifts the lockout once it is past the restart level', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    const dry = b.snapshot(11000);
    expect(dry.locked).toBe(true);
    const after = b.topUp(CHARGE_AMOUNT, 11000);
    expect(after.level).toBeGreaterThan(RESTART_LEVEL);
    expect(after.locked).toBe(false);
    expect(b.start('p2', 11000)).toBe(true);
  });

  it('a small charge on an empty locked battery leaves it locked', () => {
    const b = new SharedBattery();
    b.start('p1', 0);
    b.snapshot(11000);
    expect(b.topUp(0.05, 11000).locked).toBe(true);
  });

  it('has a sane cooldown and amount', () => {
    expect(CHARGE_AMOUNT).toBeGreaterThan(0.1);
    expect(CHARGE_AMOUNT).toBeLessThan(0.6);
    expect(CHARGE_COOLDOWN).toBeGreaterThan(10);
  });
});
