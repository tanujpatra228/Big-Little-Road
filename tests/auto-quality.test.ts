import { describe, expect, it } from 'vitest';
import {
  AutoQuality, DOWN_FPS, LADDER, LOCKOUT_SECONDS, MAX_LEVEL, SETTLE_SECONDS, UP_FPS, UP_HOLD_SECONDS, WARMUP_SECONDS, rungPixelRatio, type Rung,
} from '../src/shared/auto-quality';

/** A pretend computer: how long a frame takes at each rung. */
type Machine = (r: Rung, tierRatio: number) => number;

/** Cost model in seconds per frame: a fixed part, plus grass, plus pixels, plus the post effects. */
const machine = (fixed: number, grass: number, pixels: number, post: number): Machine => (r, tierRatio) =>
  fixed + (r.flowers ? 0.0005 : 0) + grass * r.density + pixels * Math.pow(rungPixelRatio(r, tierRatio), 2) + (r.tier === 'high' ? post : 0);

/** Runs a machine for `seconds` and returns the level it settled at and every change on the way. */
function run(m: Machine, seconds: number, start = 0, tierRatio = 1.5): { level: number; changes: Array<[number, number]>; fps: number } {
  const q = new AutoQuality(start);
  const changes: Array<[number, number]> = [];
  let t = 0;
  while (t < seconds) {
    const dt = Math.max(1 / 60, m(LADDER[q.level]!, LADDER[q.level]!.tier === 'high' ? tierRatio : 1)); // vsync caps at 60
    t += dt;
    const next = q.frame(dt);
    if (next !== null) changes.push([+t.toFixed(1), next]);
  }
  const r = LADDER[q.level]!;
  const dt = Math.max(1 / 60, m(r, r.tier === 'high' ? tierRatio : 1));
  return { level: q.level, changes, fps: 1 / dt };
}

describe('the ladder', () => {
  it('only ever gets cheaper going down, in the order: effects, grass, pixels', () => {
    for (let i = 1; i < LADDER.length; i++) {
      const a = LADDER[i - 1]!;
      const b = LADDER[i]!;
      expect(b.density).toBeLessThanOrEqual(a.density);
      expect(b.pixelScale).toBeLessThanOrEqual(a.pixelScale);
      if (a.tier === 'low') expect(b.tier).toBe('low');
    }
    expect(LADDER[0]!).toMatchObject({ tier: 'high', density: 1, pixelScale: 1, flowers: true });
    expect(LADDER[1]!.tier).toBe('low');
    expect(LADDER[1]!.density).toBe(1); // the first step costs only the post effects
  });

  it('never asks for fewer than 0.6 pixels per CSS pixel', () => {
    for (const r of LADDER) expect(rungPixelRatio(r, 1)).toBeGreaterThanOrEqual(0.6);
    expect(rungPixelRatio({ tier: 'low', density: 1, pixelScale: 0.1, flowers: true }, 1)).toBe(0.6);
  });
});

describe('with a fast machine', () => {
  it('stays at full quality and changes nothing', () => {
    const r = run(machine(0.006, 0.003, 0.002, 0.002), 120);
    expect(r.level).toBe(0);
    expect(r.changes).toEqual([]);
  });
});

describe('with a slow machine', () => {
  it('steps down until it holds the target, one rung at a time, and stops there', () => {
    // About 26 fps at full quality and 43 with the effects gone: needs several rungs.
    const m = machine(0.009, 0.01, 0.007, 0.004);
    const r = run(m, 120);
    expect(r.level).toBeGreaterThan(0);
    expect(r.fps).toBeGreaterThanOrEqual(DOWN_FPS);
    // One rung per step, never skipping.
    r.changes.forEach(([, level], i) => expect(level).toBe(i + 1));
    // And it did not keep going past what it needed.
    expect(r.level).toBeLessThan(MAX_LEVEL);
  });

  it('takes the cheapest step that works: a machine only held back by the effects drops just the effects', () => {
    const r = run(machine(0.008, 0.004, 0.003, 0.014), 60);
    expect(r.level).toBe(1);
  });

  it('a hopeless machine goes to the floor and stays there, without error', () => {
    const r = run(machine(0.05, 0.05, 0.05, 0.05), 300);
    expect(r.level).toBe(MAX_LEVEL);
  });

  it('waits before the first decision, and between changes', () => {
    const r = run(machine(0.03, 0.01, 0.01, 0.01), 60);
    expect(r.changes[0]![0]).toBeGreaterThan(WARMUP_SECONDS);
    for (let i = 1; i < r.changes.length; i++) expect(r.changes[i]![0] - r.changes[i - 1]![0]).toBeGreaterThanOrEqual(SETTLE_SECONDS);
  });
});

describe('stepping back up', () => {
  it('comes back up when the load goes away (the player stops a heavy scene), but only after a calm stretch', () => {
    const heavy = machine(0.009, 0.01, 0.007, 0.004);
    const light = machine(0.004, 0.002, 0.002, 0.001);
    const q = new AutoQuality(0);
    let t = 0;
    let m = heavy;
    const stamps: number[] = [];
    while (t < 200) {
      if (t > 60) m = light;
      const r = LADDER[q.level]!;
      const dt = Math.max(1 / 60, m(r, r.tier === 'high' ? 1.5 : 1));
      t += dt;
      if (q.frame(dt) !== null && t > 60) stamps.push(t);
    }
    expect(q.level).toBe(0);
    expect(stamps[0]! - 60).toBeGreaterThanOrEqual(UP_HOLD_SECONDS);
  });

  it('does not bounce: a machine that is fine at one rung and too slow one rung up stays put', () => {
    // 52 fps at level 1 but 38 fps at level 0 (the effects cost too much). Not above UP_FPS, so it must stay.
    const m: Machine = (r) => (r.tier === 'high' ? 1 / 38 : 1 / 52);
    const r = run(m, 400);
    expect(r.level).toBe(1);
    expect(r.changes.length).toBe(1);
  });

  it('if stepping up goes wrong, it stops trying for a good while', () => {
    // Looks fast enough to step up (60 fps at level 1) but is slow at level 0 (35 fps).
    const m: Machine = (r) => (r.tier === 'high' ? 1 / 35 : 1 / 61);
    const q = new AutoQuality(0);
    let t = 0;
    const ups: number[] = [];
    let last = 0;
    while (t < 400) {
      const dt = LADDER[q.level]!.tier === 'high' ? 1 / 35 : m(LADDER[q.level]!, 1);
      t += dt;
      const n = q.frame(dt);
      if (n !== null && n < last) ups.push(t);
      if (n !== null) last = n;
    }
    expect(ups.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < ups.length; i++) expect(ups[i]! - ups[i - 1]!).toBeGreaterThanOrEqual(LOCKOUT_SECONDS - 15);
  });

  it('never rises above the level it was started at', () => {
    const q = new AutoQuality(2);
    let t = 0;
    while (t < 100) {
      t += 1 / 60;
      q.frame(1 / 60);
    }
    expect(q.level).toBe(2);
  });
});

describe('ignores what is not a measurement', () => {
  it('occasional long hitches (a load, a pause) in a healthy run never trigger a step down', () => {
    const q = new AutoQuality(0);
    let t = 0;
    let n = 0;
    while (t < 120) {
      const dt = ++n % 240 === 0 ? 2.5 : 1 / 60; // a 2.5 s hitch every four seconds or so
      t += dt;
      q.frame(dt);
    }
    expect(q.level).toBe(0);
  });

  it('but frames that are always that slow are a slow machine, and it steps down', () => {
    const q = new AutoQuality(0);
    for (let i = 0; i < 400; i++) q.frame(0.4);
    expect(q.level).toBe(MAX_LEVEL);
  });

  it('zero, negative and NaN frame times are ignored', () => {
    const q = new AutoQuality(0);
    for (const dt of [0, -1, NaN]) expect(q.frame(dt)).toBeNull();
  });

  it('a single slow frame in a healthy run does not matter', () => {
    const q = new AutoQuality(0);
    let t = 0;
    while (t < 60) {
      const dt = Math.round(t * 60) % 300 === 0 ? 0.2 : 1 / 60;
      t += dt;
      q.frame(dt);
    }
    expect(q.level).toBe(0);
  });

  it('force() moves to a level, clamped, and settles before judging again', () => {
    const q = new AutoQuality(0);
    q.force(99);
    expect(q.level).toBe(MAX_LEVEL);
    q.force(-4);
    expect(q.level).toBe(0);
  });
});

describe('the numbers are sensible', () => {
  it('there is a gap between stepping down and stepping up, so it cannot flutter', () => {
    expect(UP_FPS - DOWN_FPS).toBeGreaterThanOrEqual(10);
  });
});
