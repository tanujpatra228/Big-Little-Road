import { describe, expect, it } from 'vitest';
import {
  FOLD_WINDOW, FRAME_IDS, FRAME_LIFT, FRAME_WINDOW, REGION_IDS, TRANSFORM_DURATION, UNFOLD_WINDOW, WHEEL_SWAP_AT, WHEEL_WINDOW,
  armScale, foldRemaining, frameLift, frameProgress, latchTimes, lockEvents, unfolded, wheelBlend,
} from '../src/shared/transform-anim';

const steps = (n = 280): number[] => Array.from({ length: n + 1 }, (_, i) => (i / n) * TRANSFORM_DURATION);

describe('the big boxes', () => {
  it.each(FRAME_IDS)('%s sits at the old shape before its window and exactly at the new one after', (id) => {
    expect(frameProgress(id, 0)).toBe(0);
    expect(frameProgress(id, FRAME_WINDOW[id].start)).toBe(0);
    expect(frameProgress(id, FRAME_WINDOW[id].end)).toBeCloseTo(1, 12);
    expect(frameProgress(id, TRANSFORM_DURATION)).toBeCloseTo(1, 12);
  });

  it.each(FRAME_IDS)('%s backs off and overshoots only a little, and always arrives', (id) => {
    let lo = 0;
    let hi = 1;
    for (const t of steps()) {
      const k = frameProgress(id, t);
      lo = Math.min(lo, k);
      hi = Math.max(hi, k);
    }
    expect(lo).toBeGreaterThan(-0.12); // a hint of anticipation
    expect(lo).toBeLessThan(0); // but it is there
    expect(hi).toBeGreaterThan(1.01); // a visible settle
    expect(hi).toBeLessThan(1.12);
  });

  it.each(FRAME_IDS)('%s swings out and back: no lift at either end, most in the middle', (id) => {
    const w = FRAME_WINDOW[id];
    expect(frameLift(id, w.start)).toBeCloseTo(0, 12);
    expect(frameLift(id, w.end)).toBeCloseTo(0, 12);
    expect(frameLift(id, (w.start + w.end) / 2)).toBeCloseTo(1, 12);
    expect(frameLift(id, 0)).toBe(0);
    expect(frameLift(id, TRANSFORM_DURATION)).toBe(0);
  });

  it('they move in a staggered order, not all at once', () => {
    const starts = FRAME_IDS.map((id) => FRAME_WINDOW[id].start);
    expect(new Set(starts).size).toBe(FRAME_IDS.length);
    for (const id of FRAME_IDS) {
      expect(FRAME_WINDOW[id].end).toBeLessThanOrEqual(TRANSFORM_DURATION);
      expect(FRAME_WINDOW[id].end - FRAME_WINDOW[id].start).toBeGreaterThan(0.4); // readable, not a blink
    }
  });

  it('swing-out amounts are modest, so parts never fly off', () => {
    for (const id of FRAME_IDS) {
      const l = FRAME_LIFT[id];
      expect(Math.hypot(l.dx, l.dy, l.dz)).toBeLessThan(0.45);
      expect(Math.abs(l.tiltX)).toBeLessThan(0.6);
      expect(Math.abs(l.tiltZ)).toBeLessThan(0.6);
    }
  });
});

describe('details fold away and unfold', () => {
  it.each(REGION_IDS)('%s is fully there at the start, fully gone by the end of its fold, never negative', (id) => {
    expect(foldRemaining(id, 0)).toBe(1);
    expect(foldRemaining(id, FOLD_WINDOW[id].end)).toBe(0);
    expect(foldRemaining(id, TRANSFORM_DURATION)).toBe(0);
    let prev = 1;
    for (const t of steps()) {
      const k = foldRemaining(id, t);
      expect(k).toBeLessThanOrEqual(prev + 1e-12); // only ever folds shut
      expect(k).toBeGreaterThanOrEqual(0);
      prev = k;
    }
  });

  it.each(REGION_IDS)('%s on the new car starts shut and ends exactly open, with a small spring', (id) => {
    expect(unfolded(id, 0)).toBe(0);
    expect(unfolded(id, UNFOLD_WINDOW[id].start)).toBe(0);
    expect(unfolded(id, UNFOLD_WINDOW[id].end)).toBeCloseTo(1, 12);
    expect(unfolded(id, TRANSFORM_DURATION)).toBeCloseTo(1, 12);
    let hi = 0;
    for (const t of steps()) {
      hi = Math.max(hi, unfolded(id, t));
      expect(unfolded(id, t)).toBeGreaterThanOrEqual(-1e-12);
    }
    expect(hi).toBeGreaterThan(1.01);
    expect(hi).toBeLessThan(1.15);
  });

  it('the old details are all gone before the new ones start, so the bare boxes show between', () => {
    const lastFold = Math.max(...REGION_IDS.map((r) => FOLD_WINDOW[r].end));
    const firstUnfold = Math.min(...REGION_IDS.map((r) => UNFOLD_WINDOW[r].start));
    expect(lastFold).toBeLessThan(firstUnfold);
  });

  it('every window fits inside the animation', () => {
    for (const r of REGION_IDS) {
      expect(FOLD_WINDOW[r].start).toBeGreaterThanOrEqual(0);
      expect(UNFOLD_WINDOW[r].end).toBeLessThanOrEqual(TRANSFORM_DURATION);
    }
  });
});

describe('wheels and arms', () => {
  it('wheels glide from old to new, monotonically, exactly', () => {
    expect(wheelBlend(0)).toBe(0);
    expect(wheelBlend(TRANSFORM_DURATION)).toBe(1);
    let prev = 0;
    for (const t of steps()) {
      const k = wheelBlend(t);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = k;
    }
  });

  it('the tyres swap at the middle of the glide, when they are half way', () => {
    expect(WHEEL_SWAP_AT).toBeGreaterThan(WHEEL_WINDOW.start);
    expect(WHEEL_SWAP_AT).toBeLessThan(WHEEL_WINDOW.end);
    expect(wheelBlend(WHEEL_SWAP_AT)).toBeCloseTo(0.5, 9);
  });

  it('suspension arms retract, stay away while the body moves, and spring back at the end to exactly 1', () => {
    expect(armScale(0)).toBe(1);
    expect(armScale(0.25)).toBe(0);
    expect(armScale(0.6)).toBe(0);
    expect(armScale(TRANSFORM_DURATION)).toBeCloseTo(1, 12);
    for (const t of steps()) expect(armScale(t)).toBeGreaterThanOrEqual(-1e-12);
  });
});

describe('lock and latch moments (sparks, clicks)', () => {
  it('one lock per big box and per detail group, in time order, inside the animation', () => {
    const ev = lockEvents();
    expect(ev.length).toBe(FRAME_IDS.length + REGION_IDS.length);
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.t).toBeGreaterThanOrEqual(ev[i - 1]!.t);
    for (const e of ev) expect(e.t).toBeLessThanOrEqual(TRANSFORM_DURATION);
  });

  it('the last thing to lock is the roof gear, right at the end', () => {
    const last = lockEvents().at(-1)!;
    expect(last.id).toBe('top');
    expect(last.t).toBeCloseTo(TRANSFORM_DURATION, 9);
  });

  it('latches start early and run through the first part, in order', () => {
    const l = latchTimes();
    expect(l.length).toBe(FRAME_IDS.length + REGION_IDS.length);
    expect(l[0]).toBe(0);
    for (let i = 1; i < l.length; i++) expect(l[i]!).toBeGreaterThanOrEqual(l[i - 1]!);
    expect(l.at(-1)!).toBeLessThan(0.5);
  });
});
