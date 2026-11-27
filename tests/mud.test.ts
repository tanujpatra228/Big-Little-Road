import { describe, expect, it } from 'vitest';
import { DEEP_MUD, DIG_SECONDS, FREED_GRACE, MudState, SINK_SECONDS, STUCK_DRIVE, WINCH_DIG_RATE, inDeepMud } from '../src/shared/mud';
import { Surface } from '../src/shared/surfaces';
import { generateTerrain } from '../src/shared/terrain';

const run = (m: MudState, seconds: number, i: Partial<Parameters<MudState['update']>[1]> = {}, step = 0.1): Array<'stuck' | 'freed'> => {
  const events: Array<'stuck' | 'freed'> = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    const e = m.update(step, { inMud: true, throttle: 1, winched: false, role: 'scout', ...i });
    if (e) events.push(e);
  }
  return events;
};

describe('the deep mud', () => {
  it('is the middle of the bog, and is mud on the ground', () => {
    const t = generateTerrain(20260);
    expect(inDeepMud(DEEP_MUD.x, DEEP_MUD.z)).toBe(true);
    expect(inDeepMud(DEEP_MUD.x + DEEP_MUD.r + 1, DEEP_MUD.z)).toBe(false);
    expect(t.surfaceAt(DEEP_MUD.x, DEEP_MUD.z)).toBe(Surface.Mud);
    expect(t.surfaceAt(DEEP_MUD.x + DEEP_MUD.r - 0.5, DEEP_MUD.z)).toBe(Surface.Mud);
  });
});

describe('sinking and getting stuck', () => {
  it('a Scout lingering in deep mud is stuck after its sink time, and not a moment before', () => {
    const m = new MudState();
    expect(run(m, SINK_SECONDS.scout - 0.3)).toEqual([]);
    expect(m.stuck).toBe(false);
    expect(m.sink).toBeGreaterThan(0.8);
    expect(run(m, 0.6)).toEqual(['stuck']);
    expect(m.stuck).toBe(true);
  });

  it('the Hauler holds on twice as long', () => {
    const m = new MudState();
    expect(run(m, SINK_SECONDS.scout + 0.5, { role: 'hauler' })).toEqual([]);
    expect(run(m, SINK_SECONDS.hauler, { role: 'hauler' })).toEqual(['stuck']);
  });

  it('driving through quickly does not stick: sinking recovers twice as fast outside', () => {
    const m = new MudState();
    run(m, 1.5); // sank most of the way
    const sunk = m.sink;
    expect(sunk).toBeGreaterThan(0.5);
    run(m, 0.5, { inMud: false });
    expect(m.sink).toBeLessThan(sunk - 0.3);
    expect(m.stuck).toBe(false);
  });

  it('the drive weakens as you sink and is nearly gone when stuck', () => {
    const m = new MudState();
    expect(m.drive).toBe(1);
    run(m, 1.2);
    expect(m.drive).toBeLessThan(1);
    expect(m.drive).toBeGreaterThan(STUCK_DRIVE);
    run(m, 2);
    expect(m.stuck).toBe(true);
    expect(m.drive).toBe(STUCK_DRIVE);
  });
});

describe('getting out', () => {
  const stuck = (role: 'scout' | 'hauler' | 'relay' = 'scout'): MudState => {
    const m = new MudState();
    run(m, SINK_SECONDS[role] + 0.5, { role });
    expect(m.stuck).toBe(true);
    return m;
  };

  it('holding the throttle digs a car out in the end, so nobody is stuck for good', () => {
    const m = stuck();
    expect(run(m, DIG_SECONDS.scout - 1)).toEqual([]);
    expect(run(m, 2)).toEqual(['freed']);
    expect(m.stuck).toBe(false);
    expect(m.freedByWinch).toBe(false);
  });

  it('without the throttle nothing happens', () => {
    const m = stuck();
    expect(run(m, DIG_SECONDS.scout * 2, { throttle: 0 })).toEqual([]);
    expect(m.stuck).toBe(true);
  });

  it('the Hauler digs out faster than a Scout', () => {
    expect(DIG_SECONDS.hauler).toBeLessThan(DIG_SECONDS.scout);
  });

  it('a winch frees it many times faster, and says so', () => {
    const m = stuck();
    const t = DIG_SECONDS.scout / WINCH_DIG_RATE;
    expect(run(m, t - 0.5, { winched: true, throttle: 0 })).toEqual([]);
    expect(run(m, 1, { winched: true, throttle: 0 })).toEqual(['freed']);
    expect(m.freedByWinch).toBe(true);
  });

  it('being hauled out of the deep part frees it at once', () => {
    const m = stuck();
    run(m, 0.5, { winched: true, throttle: 0 });
    expect(run(m, 0.1, { inMud: false, winched: true, throttle: 0 })).toEqual(['freed']);
    expect(m.freedByWinch).toBe(true);
  });

  it('after being freed it can drive off: no sinking again during the grace', () => {
    const m = stuck();
    run(m, DIG_SECONDS.scout + 1);
    expect(m.stuck).toBe(false);
    expect(run(m, FREED_GRACE - 0.5)).toEqual([]);
    expect(m.stuck).toBe(false);
    // then it can sink again if it stays
    expect(run(m, 4)).toEqual(['stuck']);
  });

  it('reset clears everything', () => {
    const m = stuck();
    m.reset();
    expect(m.stuck).toBe(false);
    expect(m.sink).toBe(0);
    expect(m.drive).toBe(1);
  });
});
