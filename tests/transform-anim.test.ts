import { describe, expect, it } from 'vitest';
import { SQUASHED, SWAP_AT, TRANSFORM_DURATION, flashStrength, incomingScale, outgoingScale, ringProgress } from '../src/shared/transform-anim';

describe('transformation timeline', () => {
  it('starts at normal size and ends exactly at normal size', () => {
    expect(outgoingScale(0)).toEqual({ x: 1, y: 1, z: 1 });
    const end = incomingScale(TRANSFORM_DURATION);
    expect(end.x).toBeCloseTo(1, 9);
    expect(end.y).toBeCloseTo(1, 9);
    expect(end.z).toBeCloseTo(1, 9);
  });

  it('the old car squashes steadily: wider and flatter, never inverted', () => {
    let prev = outgoingScale(0);
    for (let t = 0.01; t <= SWAP_AT; t += 0.01) {
      const s = outgoingScale(t);
      expect(s.y).toBeLessThan(prev.y + 1e-12);
      expect(s.x).toBeGreaterThan(prev.x - 1e-12);
      expect(s.y).toBeGreaterThan(0.3);
      prev = s;
    }
  });

  it('nothing jumps at the swap: both cars are the same squashed shape there', () => {
    const out = outgoingScale(SWAP_AT);
    const inn = incomingScale(SWAP_AT);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(out[k]).toBeCloseTo(SQUASHED[k], 9);
      expect(inn[k]).toBeCloseTo(SQUASHED[k], 9);
    }
  });

  it('the new car springs up past normal size and settles, with sane limits', () => {
    let peakY = 0;
    for (let t = SWAP_AT; t <= TRANSFORM_DURATION; t += 0.005) {
      const s = incomingScale(t);
      peakY = Math.max(peakY, s.y);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(s[k]).toBeGreaterThan(0.3);
        expect(s[k]).toBeLessThan(1.4);
      }
    }
    expect(peakY).toBeGreaterThan(1.02); // a visible overshoot
    expect(peakY).toBeLessThan(1.2);
  });

  it('the flash peaks at the swap and is gone at both ends', () => {
    expect(flashStrength(0)).toBe(0);
    expect(flashStrength(TRANSFORM_DURATION)).toBe(0);
    expect(flashStrength(SWAP_AT)).toBeCloseTo(1, 9);
    expect(flashStrength(0.2)).toBeGreaterThan(0);
    expect(flashStrength(0.4)).toBeGreaterThan(0);
  });

  it('the ring grows from nothing to full', () => {
    expect(ringProgress(0)).toBe(0);
    expect(ringProgress(TRANSFORM_DURATION)).toBe(1);
    expect(ringProgress(0.4)).toBeGreaterThan(ringProgress(0.3));
  });
});
