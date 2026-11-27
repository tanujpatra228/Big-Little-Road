import { describe, expect, it } from 'vitest';
import { WINCH_ACCEL, WINCH_DONE, WINCH_RANGE, WINCH_SNAP, cableSnapped, chooseTarget, pullToward, reelDone } from '../src/shared/winch';

const me = { x: 0, z: 0 };

describe('choosing what to hook', () => {
  it('picks the nearest thing in reach', () => {
    const t = chooseTarget(me, [{ id: 'p2', x: 20, z: 0 }], [{ id: 'o1', x: 8, z: 0 }]);
    expect(t).toMatchObject({ kind: 'stake', id: 'o1' });
  });
  it('a car wins when it is about as close as a stake', () => {
    const t = chooseTarget(me, [{ id: 'p2', x: 10, z: 0 }], [{ id: 'o1', x: 9.7, z: 0 }]);
    expect(t).toMatchObject({ kind: 'car', id: 'p2' });
  });
  it('a clearly nearer stake still wins over a far car', () => {
    expect(chooseTarget(me, [{ id: 'p2', x: 22, z: 0 }], [{ id: 'o1', x: 5, z: 0 }])).toMatchObject({ kind: 'stake' });
  });
  it('nothing beyond the range, and not yourself', () => {
    expect(chooseTarget(me, [{ id: 'p2', x: WINCH_RANGE + 1, z: 0 }], [])).toBeNull();
    expect(chooseTarget(me, [{ id: 'me', x: 0, z: 0 }], [])).toBeNull();
    expect(chooseTarget(me, [], [])).toBeNull();
  });
});

describe('the pull', () => {
  it('is toward the puller at the winch strength', () => {
    const a = pullToward({ x: 10, z: 0 }, { x: 0, z: 0 });
    expect(a.x).toBeCloseTo(-WINCH_ACCEL);
    expect(a.z).toBeCloseTo(0);
    const b = pullToward({ x: 0, z: 0 }, { x: 3, z: 4 }); // 5 m away, just past done
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(WINCH_ACCEL);
  });
  it('stops when they are close enough', () => {
    expect(pullToward({ x: WINCH_DONE - 0.1, z: 0 }, { x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
    expect(reelDone({ x: WINCH_DONE, z: 0 }, { x: 0, z: 0 })).toBe(true);
    expect(reelDone({ x: WINCH_DONE + 1, z: 0 }, { x: 0, z: 0 })).toBe(false);
  });
  it('the cable lets go if the two get too far apart', () => {
    expect(cableSnapped({ x: WINCH_SNAP - 1, z: 0 }, { x: 0, z: 0 })).toBe(false);
    expect(cableSnapped({ x: WINCH_SNAP + 1, z: 0 }, { x: 0, z: 0 })).toBe(true);
  });
  it('is strong enough to move a stuck car in a few seconds, and gentle enough not to flip one (under 1 g)', () => {
    expect(WINCH_ACCEL).toBeLessThan(9.81);
    expect(0.5 * WINCH_ACCEL * 4 * 4).toBeGreaterThan(20); // 4 s of pull moves it over 20 m if it kept accelerating
  });
});
