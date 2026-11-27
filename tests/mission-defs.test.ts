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

import { DEAD_CAR, REVIVE_REACH } from '../src/shared/goals';
import { BASE, BASE_RANGE, BEACON_RANGE, RELAY_RANGE, signalAt } from '../src/shared/signal';
import { TERRAIN_SIZE } from '../src/shared/terrain';

describe('Dead Signal', () => {
  const m = missionById('deadsignal')!;
  const toward = (d: number) => {
    const len = Math.hypot(DEAD_CAR.x - BASE.x, DEAD_CAR.z - BASE.z);
    return { x: BASE.x + ((DEAD_CAR.x - BASE.x) / len) * d, z: BASE.z + ((DEAD_CAR.z - BASE.z) / len) * d };
  };
  const dist = Math.hypot(DEAD_CAR.x - BASE.x, DEAD_CAR.z - BASE.z);

  it('needs two players and turns the radio range on by itself', () => {
    expect(m.minPlayers).toBe(2);
    expect(m.rules).toEqual({ signal: true });
    expect(m.stages.map((s) => s.id)).toEqual(['link', 'reach', 'revive']);
  });

  it('the lost car is inside the yard, on the lawn, and well past the base radio', () => {
    expect(Math.abs(DEAD_CAR.x)).toBeLessThan(TERRAIN_SIZE / 2 - 5);
    expect(Math.abs(DEAD_CAR.z)).toBeLessThan(TERRAIN_SIZE / 2 - 5);
    expect(dist).toBeGreaterThan(BASE_RANGE + 30);
    expect(goalById('dead-car')?.missionOnly).toBe(true);
    expect(REVIVE_REACH).toBeGreaterThan(goalById('dead-car')!.r);
  });

  it('cannot be covered by the base alone, by one Relay alone, or by one beacon', () => {
    const edge = toward(BASE_RANGE - 1);
    expect(signalAt(DEAD_CAR, [])).toBe(0);
    expect(signalAt(DEAD_CAR, [{ id: 'p2', ...edge }])).toBeLessThan(0.25);
    expect(signalAt(DEAD_CAR, [{ id: 'beacon:o1', ...edge, range: BEACON_RANGE }])).toBeLessThan(0.25);
  });

  it('two beacons, or a Relay and a beacon, or two Relays, do cover it', () => {
    const one = toward(BASE_RANGE - 3);
    const two = toward(BASE_RANGE - 3 + BEACON_RANGE - 3);
    expect(signalAt(DEAD_CAR, [{ id: 'beacon:o1', ...one, range: BEACON_RANGE }, { id: 'beacon:o2', ...two, range: BEACON_RANGE }])).toBeGreaterThanOrEqual(0.25);
    const relay = toward(BASE_RANGE - 3);
    const beacon = toward(BASE_RANGE - 3 + RELAY_RANGE - 3);
    expect(signalAt(DEAD_CAR, [{ id: 'p2', ...relay }, { id: 'beacon:o1', ...beacon, range: BEACON_RANGE }])).toBeGreaterThanOrEqual(0.25);
    const relay2 = toward(BASE_RANGE - 3 + RELAY_RANGE - 3);
    expect(signalAt(DEAD_CAR, [{ id: 'p2', ...relay }, { id: 'p3', ...relay2 }])).toBeGreaterThanOrEqual(0.25);
  });
});

import { MUD_SHORE } from '../src/shared/goals';
import { DEEP_MUD } from '../src/shared/mud';
import { Surface } from '../src/shared/surfaces';
import { generateTerrain, SPAWN } from '../src/shared/terrain';

describe('Mud Bog Rescue', () => {
  const m = missionById('mudbog')!;
  const t = generateTerrain(20260);

  it('needs two players and goes stuck, hook, free, shore', () => {
    expect(m.minPlayers).toBe(2);
    expect(m.stages.map((s) => s.id)).toEqual(['sink', 'hook', 'free', 'shore']);
  });

  it('the shore is firm ground outside the deep mud, on the house side, inside the yard', () => {
    expect(t.surfaceAt(MUD_SHORE.x, MUD_SHORE.z)).not.toBe(Surface.Mud);
    expect(t.surfaceAt(MUD_SHORE.x, MUD_SHORE.z)).not.toBe(Surface.Water);
    expect(Math.hypot(MUD_SHORE.x - DEEP_MUD.x, MUD_SHORE.z - DEEP_MUD.z)).toBeGreaterThan(DEEP_MUD.r + 10);
    expect(Math.hypot(MUD_SHORE.x - SPAWN.x, MUD_SHORE.z - SPAWN.z)).toBeLessThan(Math.hypot(DEEP_MUD.x - SPAWN.x, DEEP_MUD.z - SPAWN.z));
    expect(goalById('mud-shore')).toMatchObject({ missionOnly: true, x: MUD_SHORE.x, z: MUD_SHORE.z });
  });

  it('a car stuck in the middle is further from the shore than a winch reaches in one go, so it has to be hauled', () => {
    const d = Math.hypot(MUD_SHORE.x - DEEP_MUD.x, MUD_SHORE.z - DEEP_MUD.z);
    expect(d).toBeGreaterThan(20);
  });

  it('the last stage needs every car on the shore', () => {
    const last = m.stages[3]!.objectives[0]!;
    expect(last.kind === 'reach' && last.who).toBe('all');
  });
});
