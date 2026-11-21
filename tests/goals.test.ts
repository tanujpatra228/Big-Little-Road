import { describe, expect, it } from 'vitest';
import { GOALS, goalById, reached } from '../src/shared/goals';
import { PLATFORM } from '../src/shared/terrain';

describe('the terrace goal', () => {
  const g = goalById('terrace')!;

  it('sits at the middle of the platform', () => {
    expect(g.x).toBe(PLATFORM.x);
    expect(g.z).toBe(PLATFORM.z);
    expect(GOALS.map((x) => x.id)).toContain('terrace');
  });

  it('counts a car on the platform near the middle', () => {
    expect(reached(g, PLATFORM.x + 1, 0.15 + PLATFORM.height + 0.6, PLATFORM.z - 1)).toBe(true);
  });

  it('does not count a car on the ground below, even right next to it', () => {
    expect(reached(g, PLATFORM.x, 0.9, PLATFORM.z)).toBe(false); // standing where the platform is, but on the ground (cannot happen, but the rule is height)
    expect(reached(g, PLATFORM.x + PLATFORM.r + 2, 0.9, PLATFORM.z)).toBe(false);
  });

  it('does not count a car on the platform but far from the middle', () => {
    expect(reached(g, PLATFORM.x + 7, 2, PLATFORM.z)).toBe(false);
  });
});
