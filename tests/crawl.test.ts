import { describe, expect, it } from 'vitest';
import { generateTerrain, ROCK } from '../src/shared/terrain';
import { generateBoulders } from '../src/shared/boulders';
import {
  CHECKPOINT_EVERY, CORRIDOR, CRAWL_ENTRY, CRAWL_FAR, CrawlRun, LOST_AFTER, MARK_SPACING, buildCrawlLine, inField, nearestOnLine, pointAt,
} from '../src/shared/crawl';
import { CARS } from '../src/shared/cars';

const SEEDS = [20260, 1, 2, 3, 7, 11, 42, 99, 123, 777, 2024, 31337];
const lineFor = (seed: number) => {
  const t = generateTerrain(seed);
  const boulders = generateBoulders(t);
  return { boulders, line: buildCrawlLine(boulders) };
};

describe('the crawl line', () => {
  it('is deterministic', () => {
    const a = lineFor(20260).line;
    const b = lineFor(20260).line;
    expect(b.points).toEqual(a.points);
  });

  it('runs from the side facing the house to the far side, inside the field', () => {
    const { line } = lineFor(20260);
    const first = line.points[0]!;
    const last = line.points[line.points.length - 1]!;
    expect(Math.hypot(first.x - CRAWL_ENTRY.x, first.z - CRAWL_ENTRY.z)).toBeLessThan(7);
    expect(Math.hypot(last.x - CRAWL_FAR.x, last.z - CRAWL_FAR.z)).toBeLessThan(7);
    for (const p of line.points) expect(Math.hypot(p.x - ROCK.x, p.z - ROCK.z)).toBeLessThan(ROCK.r);
    expect(line.length).toBeGreaterThan(ROCK.r * 2 - 14);
  });

  it('marks are spaced evenly (except the last)', () => {
    const { line } = lineFor(20260);
    for (let i = 1; i < line.points.length - 1; i++) expect(line.cum[i]! - line.cum[i - 1]!).toBeCloseTo(MARK_SPACING, 0);
  });

  it('on every tested seed it exists and gives the widest car room beside every tall boulder', () => {
    const hauler = CARS.hauler.half.x;
    for (const seed of SEEDS) {
      const { boulders, line } = lineFor(seed);
      expect(line.clearance, `seed ${seed}`).toBeGreaterThan(0.5);
      expect(line.clearance, `seed ${seed}`).toBeGreaterThanOrEqual(hauler + 0.15);
      // Walk the whole line in small steps: never closer than the clearance it claims.
      for (let s = 0; s <= line.length; s += 0.5) {
        const p = pointAt(line, s);
        for (const b of boulders) {
          if (b.kind !== 'boulder') continue;
          expect(Math.hypot(p.x - b.x, p.z - b.z) - b.radius, `seed ${seed} s ${s}`).toBeGreaterThan(CARS.hauler.half.x + 0.15);
        }
      }
    }
  });

  it('the default seed has full clearance for the Hauler', () => {
    expect(lineFor(20260).line.clearance).toBeGreaterThanOrEqual(0.99);
  });
});

describe('nearestOnLine and pointAt', () => {
  const { line } = lineFor(20260);
  it('a point on the line is zero away, and its distance along matches', () => {
    const p = pointAt(line, 30);
    const n = nearestOnLine(line, p.x, p.z);
    expect(n.off).toBeLessThan(0.01);
    expect(n.s).toBeCloseTo(30, 0);
  });
  it('a point to the side is that far away', () => {
    const p = pointAt(line, 30);
    const n = nearestOnLine(line, p.x + 40, p.z + 40);
    expect(n.off).toBeGreaterThan(20);
  });
  it('heading points along the line', () => {
    const a = pointAt(line, 20);
    const b = pointAt(line, 21);
    expect(Math.atan2(b.x - a.x, b.z - a.z)).toBeCloseTo(a.yaw, 1);
  });
});

describe('a car on the line', () => {
  const { line } = lineFor(20260);
  const step = CHECKPOINT_EVERY * MARK_SPACING;

  it('driving along it is never sent back and banks checkpoints', () => {
    const run = new CrawlRun(line);
    for (let s = 0; s <= line.length; s += 0.5) {
      const p = pointAt(line, s);
      expect(run.update(p.x, p.z, 0.05).kind).toBe('ok');
    }
    expect(run.checkpointS).toBeGreaterThanOrEqual(step);
  });

  it('is sent back to the last checkpoint after wandering off for long enough, facing along the line', () => {
    const run = new CrawlRun(line);
    for (let s = 0; s <= step * 2 + 3; s += 0.5) {
      const p = pointAt(line, s);
      run.update(p.x, p.z, 0.05);
    }
    expect(run.checkpointS).toBeCloseTo(step * 2, 5);
    const at = pointAt(line, step * 2 + 3);
    let verdict = run.update(at.x + CORRIDOR + 2, at.z, 0.05);
    expect(verdict.kind).toBe('ok'); // not yet: the first moments are forgiven
    verdict = run.update(at.x + CORRIDOR + 2, at.z, LOST_AFTER);
    expect(verdict.kind).toBe('lost');
    if (verdict.kind === 'lost') {
      const cp = pointAt(line, step * 2);
      expect(verdict.to.x).toBeCloseTo(cp.x, 5);
      expect(verdict.to.z).toBeCloseTo(cp.z, 5);
      expect(verdict.to.yaw).toBeCloseTo(cp.yaw, 5);
    }
  });

  it('a brief clip of the edge is forgiven', () => {
    const run = new CrawlRun(line);
    const p = pointAt(line, 25);
    run.update(p.x, p.z, 0.05);
    expect(run.update(p.x + CORRIDOR + 1, p.z, LOST_AFTER * 0.5).kind).toBe('ok');
    expect(run.update(p.x, p.z, 0.05).kind).toBe('ok');
    expect(run.update(p.x + CORRIDOR + 1, p.z, LOST_AFTER * 0.5).kind).toBe('ok'); // the clock restarted
  });

  it('does not send you back again straight away', () => {
    const run = new CrawlRun(line);
    const p = pointAt(line, 25);
    const far = { x: p.x + 20, z: p.z };
    run.update(far.x, far.z, LOST_AFTER);
    expect(run.update(far.x, far.z, 0.2).kind).toBe('ok');
  });

  it('only applies inside the rock field', () => {
    const run = new CrawlRun(line);
    expect(inField(0, 0)).toBe(false);
    for (let i = 0; i < 100; i++) expect(run.update(0, 0, 0.1).kind).toBe('ok');
  });

  it('a car cutting across a bend does not skip ahead a checkpoint', () => {
    const run = new CrawlRun(line);
    const p = pointAt(line, step - 0.4); // just short of the first checkpoint
    run.update(p.x, p.z, 0.05);
    expect(run.checkpointS).toBe(0);
  });
});
