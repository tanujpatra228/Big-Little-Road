import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLOTS, DROP_AHEAD, MAX_PLACED, PICKUP_RANGE, SLOTS, dropItem, dropSpot, fromWire, nearestPlaced, newTools, pickUp, placedOf, toWire,
  type Tools,
} from '../src/shared/toolbox';

const at = { x: 3, z: -4, yaw: 0.5 };
function ok<T>(r: T): Exclude<T, { error: string }> {
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error(`unexpected ${(r as { error: string }).error}`);
  return r as Exclude<T, { error: string }>;
}

describe('the toolbox', () => {
  it('starts with six slots filled from the default loadout', () => {
    const t = newTools();
    expect(t.slots).toHaveLength(SLOTS);
    expect(t.slots).toEqual([...DEFAULT_SLOTS]);
    expect(t.placed).toEqual([]);
  });

  it('dropping takes the item out of its slot and puts it in the world', () => {
    const r = ok(dropItem(newTools(), 0, at, 'p1'));
    expect(r.tools.slots[0]).toBeNull();
    expect(r.tools.slots[1]).toBe('beacon');
    expect(r.placed).toMatchObject({ kind: 'beacon', x: 3, z: -4, yaw: 0.5, by: 'p1' });
    expect(r.tools.placed).toHaveLength(1);
  });

  it('does not change the box it was given (immutable)', () => {
    const t = newTools();
    dropItem(t, 0, at, 'p1');
    expect(t.slots[0]).toBe('beacon');
    expect(t.placed).toHaveLength(0);
  });

  it('refuses an empty slot and a slot that does not exist', () => {
    const t = ok(dropItem(newTools(), 0, at, 'p1')).tools;
    expect(dropItem(t, 0, at, 'p1')).toEqual({ error: 'empty' });
    expect(dropItem(t, 6, at, 'p1')).toEqual({ error: 'bad-slot' });
    expect(dropItem(t, -1, at, 'p1')).toEqual({ error: 'bad-slot' });
    expect(dropItem(t, 1.5, at, 'p1')).toEqual({ error: 'bad-slot' });
  });

  it('ids are never reused, even after a pick up', () => {
    let t = newTools();
    const a = ok(dropItem(t, 0, at, 'p1'));
    t = ok(pickUp(a.tools, a.placed.id)).tools;
    const b = ok(dropItem(t, 0, at, 'p1'));
    expect(b.placed.id).not.toBe(a.placed.id);
  });

  it('picking up puts the item in the first empty slot, from any player', () => {
    let t = newTools();
    t = ok(dropItem(t, 2, at, 'p1')).tools; // a stake
    t = ok(dropItem(t, 0, at, 'p1')).tools; // a beacon
    const id = t.placed[1]!.id; // the beacon
    const r = ok(pickUp(t, id));
    expect(r.slot).toBe(0);
    expect(r.kind).toBe('beacon');
    expect(r.tools.slots[0]).toBe('beacon');
    expect(r.tools.placed.map((p) => p.kind)).toEqual(['stake']);
  });

  it('refuses to pick up something that is gone or when the box is full', () => {
    const t = newTools();
    expect(pickUp(t, 'o99')).toEqual({ error: 'unknown' });
    const dropped = ok(dropItem(t, 0, at, 'p1')).tools;
    const full: Tools = { ...dropped, slots: dropped.slots.map(() => 'cone' as const) };
    expect(pickUp(full, dropped.placed[0]!.id)).toEqual({ error: 'no-room' });
  });

  it('holds at most MAX_PLACED things in the world', () => {
    let t: Tools = { ...newTools(), slots: Array(SLOTS).fill('cone') };
    for (let i = 0; i < MAX_PLACED; i++) {
      t = ok(dropItem({ ...t, slots: Array(SLOTS).fill('cone') }, 0, { x: i, z: 0, yaw: 0 }, 'p1')).tools;
    }
    expect(t.placed).toHaveLength(MAX_PLACED);
    expect(dropItem({ ...t, slots: Array(SLOTS).fill('cone') }, 0, at, 'p1')).toEqual({ error: 'full' });
  });

  it('finds the nearest placed item in reach, and nothing beyond it', () => {
    let t = newTools();
    t = ok(dropItem(t, 0, { x: 10, z: 0, yaw: 0 }, 'p1')).tools;
    t = ok(dropItem(t, 2, { x: 12, z: 0, yaw: 0 }, 'p1')).tools;
    expect(nearestPlaced(t, 11.5, 0)?.kind).toBe('stake');
    expect(nearestPlaced(t, 10.2, 0)?.kind).toBe('beacon');
    expect(nearestPlaced(t, 10 + PICKUP_RANGE + 0.5, 0)?.kind).toBe('stake'); // the stake is 12 away, within reach of 14.5
    expect(nearestPlaced(t, 40, 0)).toBeNull();
  });

  it('lists placed items by kind', () => {
    let t = newTools();
    t = ok(dropItem(t, 0, at, 'p1')).tools;
    t = ok(dropItem(t, 1, at, 'p1')).tools;
    t = ok(dropItem(t, 4, at, 'p1')).tools;
    expect(placedOf(t, 'beacon')).toHaveLength(2);
    expect(placedOf(t, 'cone')).toHaveLength(1);
    expect(placedOf(t, 'stake')).toHaveLength(0);
  });

  it('a drop lands in front of the car', () => {
    const s = dropSpot(0, 0, 0);
    expect(s.z).toBeCloseTo(DROP_AHEAD);
    expect(s.x).toBeCloseTo(0);
    const e = dropSpot(0, 0, Math.PI / 2);
    expect(e.x).toBeCloseTo(DROP_AHEAD);
  });
});

describe('the wire form', () => {
  it('round trips to the centimetre and milliradian', () => {
    let t = newTools();
    t = ok(dropItem(t, 0, { x: 12.345, z: -6.789, yaw: 1.2345 }, 'p2')).tools;
    t = ok(dropItem(t, 4, { x: -3, z: 7.5, yaw: -0.5 }, 'p1')).tools;
    const back = fromWire(JSON.parse(JSON.stringify(toWire(t))));
    expect(back.slots).toEqual(t.slots);
    expect(back.next).toBe(t.next);
    expect(back.placed).toHaveLength(2);
    expect(back.placed[0]!.x).toBeCloseTo(12.35, 2);
    expect(back.placed[0]!.z).toBeCloseTo(-6.79, 2);
    expect(back.placed[0]!.yaw).toBeCloseTo(1.235, 3);
    expect(back.placed[0]!.by).toBe('p2');
    expect(back.placed[1]!.kind).toBe('cone');
  });

  it('is small: a full yard fits in a frame', () => {
    let t: Tools = newTools();
    for (let i = 0; i < MAX_PLACED; i++) t = ok(dropItem({ ...t, slots: Array(SLOTS).fill('beacon') }, 0, { x: 150.55 + i, z: -150.55, yaw: 3.1 }, 'p4')).tools;
    expect(JSON.stringify(toWire(t)).length).toBeLessThan(3000);
  });

  it('ignores junk instead of throwing', () => {
    expect(fromWire(null).placed).toEqual([]);
    expect(fromWire({ s: 5, p: 'x', n: 1 } as never).slots).toEqual([...DEFAULT_SLOTS]);
    const t = fromWire({ s: 'b?zs', p: [{ i: 'a', k: 'q', x: 1, z: 1, y: 0, b: '' }, { i: 'b', k: 'c', x: 100, z: 200, y: 0, b: 'p1' }, null as never], n: -3 });
    expect(t.slots).toEqual(['beacon', null, null, 'stake', null, null]);
    expect(t.placed.map((p) => p.id)).toEqual(['b']);
    expect(t.next).toBeGreaterThan(0);
  });
});
