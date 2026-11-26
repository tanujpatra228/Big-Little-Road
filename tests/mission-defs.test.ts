import { describe, expect, it } from 'vitest';
import { MISSIONS, missionById } from '../src/shared/missions';
import { GOALS, goalById } from '../src/shared/goals';
import { ROCK } from '../src/shared/terrain';
import { CRAWL_ENTRY, CRAWL_FAR } from '../src/shared/crawl';

describe('every mission definition', () => {
  it('has unique ids and a few players needed', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MISSIONS) expect(m.minPlayers).toBeGreaterThanOrEqual(1);
  });

  it('only reaches goals that exist, and objective ids are unique within a mission', () => {
    for (const m of MISSIONS) {
      const seen = new Set<string>();
      for (const st of m.stages) {
        expect(st.objectives.length).toBeGreaterThan(0);
        for (const o of st.objectives) {
          expect(seen.has(o.id), `${m.id}/${o.id} repeated`).toBe(false);
          seen.add(o.id);
          if (o.kind === 'reach') expect(goalById(o.goal), `${m.id}/${o.id} goal ${o.goal}`).toBeDefined();
        }
      }
      if (m.celebrate) expect(goalById(m.celebrate), `${m.id} celebrate`).toBeDefined();
    }
  });

  it('every mission can be found by id', () => {
    for (const m of MISSIONS) expect(missionById(m.id)).toBe(m);
  });
});

describe('the Rock Crawl goals', () => {
  it('are mission-only, inside the rock field, on opposite sides', () => {
    const gate = goalById('rock-gate')!;
    const far = goalById('rock-far')!;
    expect(gate.missionOnly).toBe(true);
    expect(far.missionOnly).toBe(true);
    expect(Math.hypot(gate.x - ROCK.x, gate.z - ROCK.z)).toBeLessThan(ROCK.r);
    expect(Math.hypot(far.x - ROCK.x, far.z - ROCK.z)).toBeLessThan(ROCK.r);
    expect(Math.hypot(gate.x - far.x, gate.z - far.z)).toBeGreaterThan(ROCK.r);
    expect([gate.x, gate.z]).toEqual([CRAWL_ENTRY.x, CRAWL_ENTRY.z]);
    expect([far.x, far.z]).toEqual([CRAWL_FAR.x, CRAWL_FAR.z]);
  });

  it('free play never fires them (only the terrace is a free goal)', () => {
    expect(GOALS.filter((g) => !g.missionOnly).map((g) => g.id)).toEqual(['terrace']);
  });

  it('Rock Crawl needs both cars at each stage, so one player cannot finish it alone', () => {
    const m = missionById('rockcrawl')!;
    expect(m.minPlayers).toBe(2);
    for (const st of m.stages) for (const o of st.objectives) if (o.kind === 'reach') expect(o.who).toBe('all');
  });
});
