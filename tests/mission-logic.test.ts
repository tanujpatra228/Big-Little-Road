import { describe, expect, it } from 'vitest';
import { addReset, elapsedMs, objectiveDone, playerLeft, report, starsFor, startMission, toInfo, type MissionDef } from '../src/shared/mission-logic';
import { MISSIONS, missionById } from '../src/shared/missions';
import { goalById } from '../src/shared/goals';

/** A made-up mission with every kind of objective, so the runtime is tested apart from any real one. */
const DEF: MissionDef = {
  id: 'test',
  name: 'Test',
  blurb: '',
  minPlayers: 2,
  parSeconds: 60,
  stages: [
    { id: 'a', title: 'A', objectives: [{ id: 'flag-a', kind: 'flag', text: 'a' }] },
    {
      id: 'b',
      title: 'B',
      objectives: [
        { id: 'all-b', kind: 'reach', goal: 'terrace', who: 'all', text: 'everyone' },
        { id: 'flag-b', kind: 'flag', text: 'b' },
      ],
    },
    { id: 'c', title: 'C', objectives: [{ id: 'scout-c', kind: 'reach', goal: 'terrace', who: 'any', role: 'scout', text: 'a scout' }] },
  ],
};
const PLAYERS = ['p1', 'p2'];
const T0 = 1000;
const start = (): ReturnType<typeof startMission> => startMission(DEF, T0, 'p1');

describe('starting', () => {
  it('begins running at the first stage with nothing done', () => {
    const s = start();
    expect(s).toMatchObject({ id: 'test', status: 'running', stage: 0, resets: 0, finishedAt: null, startedBy: 'p1' });
    expect(s.progress).toEqual({});
  });
});

describe('reporting objectives', () => {
  it('a flag in the current stage moves the mission on', () => {
    const r = report(DEF, start(), 'p1', 'flag-a', 'flag', PLAYERS, T0 + 500);
    expect(r.changed).toBe(true);
    expect(r.events).toEqual(['stage']);
    expect(r.state.stage).toBe(1);
    expect(r.state.progress).toEqual({}); // a new stage starts clean
  });

  it('a stage needs every objective, in any order', () => {
    let s = report(DEF, start(), 'p2', 'flag-a', 'flag', PLAYERS, T0).state;
    let r = report(DEF, s, 'p1', 'flag-b', 'flag', PLAYERS, T0);
    expect(r.state.stage).toBe(1); // still waiting for everyone to reach
    s = r.state;
    r = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0);
    expect(r.state.stage).toBe(1);
    r = report(DEF, r.state, 'p2', 'all-b', 'reach', PLAYERS, T0);
    expect(r.state.stage).toBe(2);
  });

  it('"everyone must reach" needs every player in the room, not just two reports', () => {
    const three = ['p1', 'p2', 'p3'];
    let s = report(DEF, start(), 'p1', 'flag-a', 'flag', three, T0).state;
    s = report(DEF, s, 'p1', 'flag-b', 'flag', three, T0).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', three, T0).state;
    s = report(DEF, s, 'p2', 'all-b', 'reach', three, T0).state;
    expect(s.stage).toBe(1);
    expect(report(DEF, s, 'p3', 'all-b', 'reach', three, T0).state.stage).toBe(2);
  });

  it('a role restricted objective only counts for that car', () => {
    let s = start();
    for (const id of ['flag-a']) s = report(DEF, s, 'p1', id, 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p1', 'flag-b', 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0).state;
    s = report(DEF, s, 'p2', 'all-b', 'reach', PLAYERS, T0).state;
    expect(s.stage).toBe(2);
    expect(report(DEF, s, 'p1', 'scout-c', 'reach', PLAYERS, T0, 'hauler').changed).toBe(false);
    expect(report(DEF, s, 'p1', 'scout-c', 'reach', PLAYERS, T0).changed).toBe(false); // role unknown
    expect(report(DEF, s, 'p1', 'scout-c', 'reach', PLAYERS, T0, 'scout').events).toEqual(['complete']);
  });

  it('finishing records the time and stops the clock', () => {
    let s = start();
    s = report(DEF, s, 'p1', 'flag-a', 'flag', PLAYERS, T0 + 1000).state;
    s = report(DEF, s, 'p1', 'flag-b', 'flag', PLAYERS, T0 + 2000).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0 + 3000).state;
    s = report(DEF, s, 'p2', 'all-b', 'reach', PLAYERS, T0 + 4000).state;
    const r = report(DEF, s, 'p2', 'scout-c', 'reach', PLAYERS, T0 + 9000, 'scout');
    expect(r.state.status).toBe('complete');
    expect(r.state.finishedAt).toBe(T0 + 9000);
    expect(elapsedMs(r.state, T0 + 999999)).toBe(9000); // stopped at the moment it finished
  });

  it('ignores anything that does not belong: wrong stage, wrong kind, unknown id, repeats, after the end', () => {
    const s = start();
    expect(report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0).changed).toBe(false); // a later stage
    expect(report(DEF, s, 'p1', 'flag-a', 'reach', PLAYERS, T0).changed).toBe(false); // wrong kind
    expect(report(DEF, s, 'p1', 'nope', 'flag', PLAYERS, T0).changed).toBe(false);
    const once = report(DEF, s, 'p1', 'flag-a', 'flag', ['p1', 'p2'], T0).state;
    expect(once.stage).toBe(1);
    const done = { ...s, status: 'complete' as const };
    expect(report(DEF, done, 'p1', 'flag-a', 'flag', PLAYERS, T0).changed).toBe(false);
  });

  it('the same player reporting twice does not count twice', () => {
    let s = report(DEF, start(), 'p1', 'flag-a', 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0).state;
    const again = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0);
    expect(again.changed).toBe(false);
    expect(again.state.progress['all-b']).toEqual(['p1']);
  });

  it('does not change the state it was given', () => {
    const s = start();
    const snapshot = JSON.stringify(s);
    report(DEF, s, 'p1', 'flag-a', 'flag', PLAYERS, T0);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('players leaving', () => {
  it('an "everyone" objective is met by those who remain once the missing player leaves', () => {
    let s = report(DEF, start(), 'p1', 'flag-a', 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p1', 'flag-b', 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0).state;
    expect(s.stage).toBe(1);
    const r = playerLeft(DEF, s, 'p2', ['p1'], T0);
    expect(r.state.stage).toBe(2);
    expect(r.events).toEqual(['stage']);
  });

  it('what a leaver had reported no longer counts', () => {
    let s = report(DEF, start(), 'p1', 'flag-a', 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p2', 'all-b', 'reach', PLAYERS, T0).state;
    const r = playerLeft(DEF, s, 'p2', ['p1'], T0);
    expect(r.state.progress['all-b']).toEqual([]);
  });

  it('does nothing once the mission is over', () => {
    const done = { ...start(), status: 'complete' as const };
    expect(playerLeft(DEF, done, 'p1', ['p2'], T0).changed).toBe(false);
  });
});

describe('stars', () => {
  it('one for finishing, one for the par time, one for no resets', () => {
    expect(starsFor(DEF, 59000, 0)).toEqual({ complete: true, time: true, clean: true, count: 3 });
    expect(starsFor(DEF, 60000, 0).count).toBe(3); // exactly par counts
    expect(starsFor(DEF, 61000, 0)).toMatchObject({ time: false, clean: true, count: 2 });
    expect(starsFor(DEF, 30000, 1)).toMatchObject({ time: true, clean: false, count: 2 });
    expect(starsFor(DEF, 999000, 4).count).toBe(1);
  });

  it('resets count only while running', () => {
    const s = addReset(addReset(start()));
    expect(s.resets).toBe(2);
    expect(addReset({ ...s, status: 'complete' }).resets).toBe(2);
  });
});

describe('the wire view', () => {
  it('reports elapsed time, the stage, what is met, and how many have reported', () => {
    let s = report(DEF, start(), 'p1', 'flag-a', 'flag', PLAYERS, T0).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0).state;
    const info = toInfo(DEF, s, T0 + 5000, PLAYERS);
    expect(info).toMatchObject({ id: 'test', status: 'running', stage: 1, elapsedMs: 5000, resets: 0, stars: 0 });
    expect(info.done).toEqual([]);
    expect(info.counts).toEqual({ 'all-b': 1, 'flag-b': 0 });
  });

  it('a finished mission carries its stars and a frozen time', () => {
    let s = start();
    s = report(DEF, s, 'p1', 'flag-a', 'flag', PLAYERS, T0 + 100).state;
    s = report(DEF, s, 'p1', 'flag-b', 'flag', PLAYERS, T0 + 100).state;
    s = report(DEF, s, 'p1', 'all-b', 'reach', PLAYERS, T0 + 100).state;
    s = report(DEF, s, 'p2', 'all-b', 'reach', PLAYERS, T0 + 100).state;
    s = report(DEF, s, 'p1', 'scout-c', 'reach', PLAYERS, T0 + 2000, 'scout').state;
    const info = toInfo(DEF, s, T0 + 500000, PLAYERS);
    expect(info).toMatchObject({ status: 'complete', elapsedMs: 2000, stars: 3, done: [] });
  });

  it('objectiveDone follows the rules for each kind', () => {
    const s = { ...start(), progress: { 'all-b': ['p1'], 'flag-b': ['p2'] } };
    const [all, flag] = DEF.stages[1]!.objectives;
    expect(objectiveDone(all!, s, PLAYERS)).toBe(false);
    expect(objectiveDone(flag!, s, PLAYERS)).toBe(true);
    expect(objectiveDone(all!, { ...s, progress: { 'all-b': ['p1', 'p2'] } }, PLAYERS)).toBe(true);
  });
});

describe('the real missions', () => {
  it('are well formed: unique ids, at least one stage and objective, goals that exist, sensible numbers', () => {
    expect(MISSIONS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const m of MISSIONS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.stages.length).toBeGreaterThan(0);
      expect(m.minPlayers).toBeGreaterThanOrEqual(1);
      expect(m.parSeconds).toBeGreaterThan(10);
      if (m.celebrate) expect(goalById(m.celebrate)).toBeDefined();
      const objs = new Set<string>();
      for (const st of m.stages) {
        expect(st.objectives.length).toBeGreaterThan(0);
        for (const o of st.objectives) {
          expect(objs.has(o.id)).toBe(false); // unique across the whole mission, so reports are unambiguous
          objs.add(o.id);
          expect(o.id).toMatch(/^[a-z0-9-]{1,24}$/);
          if (o.kind === 'reach') expect(goalById(o.goal)).toBeDefined();
        }
      }
    }
  });

  it('can be looked up by id', () => {
    expect(missionById('terrace')?.name).toBe('The Terrace');
    expect(missionById('nope')).toBeUndefined();
  });

  it('the Terrace can be played through, start to finish, by two players', () => {
    const def = missionById('terrace')!;
    let s = startMission(def, 0, 'p1');
    s = report(def, s, 'p1', 'plank-held', 'flag', PLAYERS, 20000).state;
    s = report(def, s, 'p2', 'plank-ramp', 'flag', PLAYERS, 90000).state;
    const r = report(def, s, 'p1', 'reach-terrace', 'reach', PLAYERS, 150000);
    expect(r.state.status).toBe('complete');
    expect(toInfo(def, r.state, 200000, PLAYERS).stars).toBe(3);
  });
});
