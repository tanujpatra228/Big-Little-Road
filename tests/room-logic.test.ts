import { describe, expect, it } from 'vitest';
import { RoomLogic, type Result } from '../src/shared/net/room-logic';
import type { ClientMsg, ServerMsg } from '../src/shared/net/protocol';

const hello = (name: string, key: string, role: 'scout' | 'hauler' | 'relay' = 'scout'): Extract<ClientMsg, { type: 'hello' }> => ({ type: 'hello', name, role, key });
const pose: ClientMsg = { type: 'pose', s: 1, t: 1, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 10000, v: 0, st: 0 };
const to = (r: Result, conn: string): ServerMsg[] =>
  r.out.filter((o) => o.to === 'all' || ('conn' in (o.to as object) && (o.to as { conn: string }).conn === conn) || ('except' in (o.to as object) && (o.to as { except: string }).except !== conn)).map((o) => o.msg);

describe('joining', () => {
  it('first player gets welcomed with themselves in the list', () => {
    const room = new RoomLogic('ABCD');
    const r = room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    const w = to(r, 'c1').find((m) => m.type === 'welcome');
    expect(w).toMatchObject({ type: 'welcome', id: 'p1', code: 'ABCD', max: 4 });
    expect((w as Extract<ServerMsg, { type: 'welcome' }>).players).toHaveLength(1);
  });

  it('tells the others when someone joins, not the joiner', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    const r = room.hello('c2', hello('Bo', 'key-bbbbbbbb', 'hauler'), 0);
    expect(to(r, 'c1').some((m) => m.type === 'join')).toBe(true);
    expect(to(r, 'c2').some((m) => m.type === 'join')).toBe(false);
    const w = to(r, 'c2').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.players.map((p) => p.name).sort()).toEqual(['Ada', 'Bo']);
  });

  it('a fifth player is turned away, and closed', () => {
    const room = new RoomLogic('ABCD');
    for (let i = 1; i <= 4; i++) room.hello(`c${i}`, hello(`P${i}`, `key-${i}${i}${i}${i}${i}${i}${i}${i}`), 0);
    const r = room.hello('c5', hello('Late', 'key-99999999'), 0);
    expect(to(r, 'c5')).toContainEqual({ type: 'full' });
    expect(r.close).toEqual([{ conn: 'c5', reason: 'room full' }]);
    expect(room.players.size).toBe(4);
  });

  it('a reload with the same key takes the old slot and drops the stale socket', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    const r = room.hello('c9', hello('Ada', 'key-aaaaaaaa', 'relay'), 5);
    expect(room.players.size).toBe(2);
    expect(room.players.get('p1')?.conn).toBe('c9');
    expect(room.players.get('p1')?.role).toBe('relay');
    expect(r.close).toEqual([{ conn: 'c1', reason: 'replaced' }]);
    // The replaced socket closing later must not announce a departure.
    expect(room.close('c1').out).toEqual([]);
  });

  it('slots free up and are reused', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('A', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('B', 'key-bbbbbbbb'), 0);
    room.close('c1');
    room.hello('c3', hello('C', 'key-cccccccc'), 0);
    expect(room.players.get('p1')?.name).toBe('C');
  });

  it('a second hello on the same socket is a protocol error', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('A', 'key-aaaaaaaa'), 0);
    expect(room.hello('c1', hello('A', 'key-zzzzzzzz'), 0).close).toHaveLength(1);
  });
});

describe('relaying', () => {
  const setup = (): RoomLogic => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    return room;
  };

  it('poses go to everyone except the sender, tagged with the sender id', () => {
    const room = setup();
    const r = room.message('c1', pose, 100);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]!.to).toEqual({ except: 'c1' });
    expect(r.out[0]!.msg).toMatchObject({ type: 'pose', id: 'p1', x: 0 });
    expect('type' in (r.out[0]!.msg as object) && JSON.stringify(r.out[0]!.msg).includes('"type":"pose"')).toBe(true);
  });

  it('a car change updates the room and tells everyone, including the sender', () => {
    const room = setup();
    const r = room.message('c2', { type: 'car', role: 'relay' }, 100);
    expect(room.players.get('p2')?.role).toBe('relay');
    expect(r.out[0]!.to).toBe('all');
  });

  it('nitro start and stop reach the others only, tagged with the sender', () => {
    const room = setup();
    const r = room.message('c1', { type: 'nitro', on: true }, 100);
    expect(r.out[0]!.to).toEqual({ except: 'c1' });
    expect(r.out[0]!.msg).toEqual({ type: 'nitro', id: 'p1', on: true });
  });

  it('horn and ping reach the others only', () => {
    const room = setup();
    expect(room.message('c1', { type: 'horn', on: true }, 100).out[0]!.to).toEqual({ except: 'c1' });
    expect(room.message('c1', { type: 'ping', kind: 'go', x: 100, z: 100 }, 100).out[0]!.msg).toMatchObject({ type: 'ping', id: 'p1', kind: 'go' });
  });

  it('frames from a socket that never said hello close it', () => {
    expect(setup().message('ghost', pose, 0).close).toEqual([{ conn: 'ghost', reason: 'no hello' }]);
  });

  it('leaving is announced to everyone', () => {
    const room = setup();
    const r = room.close('c1');
    expect(r.out).toEqual([{ to: 'all', msg: { type: 'leave', id: 'p1' } }]);
    expect(room.players.has('p1')).toBe(false);
  });
});

describe('rate limiting', () => {
  it('drops a flood, lets steady 10 Hz traffic through, and closes persistent flooders', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    let relayed = 0;
    for (let i = 0; i < 20; i++) relayed += room.message('c1', pose, 1000 + i * 100).out.length; // 10 Hz for 2 s
    expect(relayed).toBe(20);

    let dropped = 0;
    let closed = false;
    for (let i = 0; i < 2000; i++) {
      const r = room.message('c1', pose, 5000); // 2000 frames in the same millisecond
      if (r.out.length === 0 && r.close.length === 0) dropped++;
      if (r.close.length) closed = true;
    }
    expect(dropped).toBeGreaterThan(200);
    expect(closed).toBe(true);
  });
});

describe('hibernation', () => {
  it('saves and restores players, and drops those whose socket is gone', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    const saved = room.save();
    const woke = RoomLogic.restore('ABCD', saved, ['c2'], 50);
    expect([...woke.players.keys()]).toEqual(['p2']);
    expect(woke.players.get('p2')?.name).toBe('Bo');
    // A reconnect still reclaims by key.
    const r = woke.hello('c7', hello('Ada', 'key-aaaaaaaa'), 60);
    expect(to(r, 'c7').find((m) => m.type === 'welcome')).toMatchObject({ id: 'p1' });
  });
});

describe('the team battery in the room', () => {
  const batteryMsgs = (r: Result, conn: string): Array<Extract<ServerMsg, { type: 'battery' }>> =>
    to(r, conn).filter((m): m is Extract<ServerMsg, { type: 'battery' }> => m.type === 'battery');
  const twoPlayers = (): RoomLogic => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    return room;
  };

  it('a newcomer is told the battery level in their welcome', () => {
    const room = twoPlayers();
    room.message('c1', { type: 'nitro', on: true }, 1000);
    const r = room.hello('c3', hello('Cy', 'key-cccccccc'), 3000);
    const w = to(r, 'c3').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.battery).toBeDefined();
    expect(w.battery!.boosters).toBe(1);
    expect(w.battery!.level).toBe(800); // two seconds of one car: a fifth of ten
  });

  it('boosting tells everyone the battery, and tells the others about the flame as before', () => {
    const room = twoPlayers();
    const r = room.message('c1', { type: 'nitro', on: true }, 1000);
    expect(batteryMsgs(r, 'c1')[0]!.battery).toMatchObject({ boosters: 1, locked: false, level: 1000 });
    expect(batteryMsgs(r, 'c2')).toHaveLength(1);
    expect(to(r, 'c2')).toContainEqual({ type: 'nitro', id: 'p1', on: true });
    expect(to(r, 'c1').some((m) => m.type === 'nitro')).toBe(false); // not echoed to the sender
  });

  it('a second boosting car doubles the drain; stopping one halves it again', () => {
    const room = twoPlayers();
    room.message('c1', { type: 'nitro', on: true }, 0);
    const r2 = room.message('c2', { type: 'nitro', on: true }, 1000);
    expect(batteryMsgs(r2, 'c1')[0]!.battery).toMatchObject({ boosters: 2, level: 900 });
    const r3 = room.message('c2', { type: 'nitro', on: false }, 2000);
    expect(batteryMsgs(r3, 'c1')[0]!.battery).toMatchObject({ boosters: 1, level: 700 });
  });

  it('stopping when you were not boosting changes nothing for the battery, but the flame still goes out', () => {
    const room = twoPlayers();
    const r = room.message('c1', { type: 'nitro', on: false }, 500);
    expect(batteryMsgs(r, 'c1')).toHaveLength(0);
    expect(to(r, 'c2')).toContainEqual({ type: 'nitro', id: 'p1', on: false });
  });

  it('when it runs dry nobody can start: the asker is told, and no flame is shown', () => {
    const room = twoPlayers();
    room.message('c1', { type: 'nitro', on: true }, 0);
    room.message('c2', { type: 'nitro', on: true }, 0); // two cars: dry in 5 s
    const r = room.message('c1', { type: 'nitro', on: true }, 6000);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]!.to).toEqual({ conn: 'c1' });
    expect(batteryMsgs(r, 'c1')[0]!.battery).toMatchObject({ locked: true, boosters: 0 });
    expect(to(r, 'c2').some((m) => m.type === 'nitro')).toBe(false);
  });

  it('a player who leaves while boosting stops draining, and everyone is told', () => {
    const room = twoPlayers();
    room.message('c1', { type: 'nitro', on: true }, 0);
    const r = room.close('c1', 1000);
    expect(r.out.some((o) => o.msg.type === 'leave')).toBe(true);
    expect(batteryMsgs(r, 'c2')[0]!.battery).toMatchObject({ boosters: 0, level: 900 });
  });

  it('a car that leaves while not boosting sends no battery message', () => {
    const room = twoPlayers();
    expect(batteryMsgs(room.close('c1', 100), 'c2')).toHaveLength(0);
  });

  it('works off the clock it is given, never its own: the same events at different times give different levels', () => {
    const a = twoPlayers();
    const b = twoPlayers();
    a.message('c1', { type: 'nitro', on: true }, 0);
    b.message('c1', { type: 'nitro', on: true }, 0);
    const ra = a.message('c1', { type: 'nitro', on: false }, 2000);
    const rb = b.message('c1', { type: 'nitro', on: false }, 6000);
    expect(batteryMsgs(ra, 'c2')[0]!.battery.level).toBe(800);
    expect(batteryMsgs(rb, 'c2')[0]!.battery.level).toBe(400);
  });
});

describe('the room rule for radio range (signal)', () => {
  const rulesMsgs = (r: Result, conn: string): Array<Extract<ServerMsg, { type: 'rules' }>> =>
    to(r, conn).filter((m): m is Extract<ServerMsg, { type: 'rules' }> => m.type === 'rules');
  const two = (): RoomLogic => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    return room;
  };

  it('starts off, and the welcome says so', () => {
    const room = new RoomLogic('ABCD');
    const r = room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    const w = to(r, 'c1').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.rules).toEqual({ signal: false });
  });

  it('anyone can switch it on, and everyone is told, the one who switched it included, with who did it', () => {
    const room = two();
    const r = room.message('c1', { type: 'rules', signal: true }, 100);
    expect(rulesMsgs(r, 'c1')).toEqual([{ type: 'rules', signal: true, by: 'p1' }]);
    expect(rulesMsgs(r, 'c2')).toEqual([{ type: 'rules', signal: true, by: 'p1' }]);
    expect(room.rules.signal).toBe(true);
  });

  it('switching it to what it already is says nothing', () => {
    const room = two();
    expect(room.message('c1', { type: 'rules', signal: false }, 100).out).toHaveLength(0);
    room.message('c1', { type: 'rules', signal: true }, 200);
    expect(room.message('c2', { type: 'rules', signal: true }, 300).out).toHaveLength(0);
  });

  it('a late joiner is told it is on, and the other player can switch it off again', () => {
    const room = two();
    room.message('c1', { type: 'rules', signal: true }, 100);
    const r = room.hello('c3', hello('Cy', 'key-cccccccc'), 500);
    const w = to(r, 'c3').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.rules).toEqual({ signal: true });
    const off = room.message('c2', { type: 'rules', signal: false }, 600);
    expect(rulesMsgs(off, 'c3')[0]).toMatchObject({ signal: false, by: 'p2' });
  });
});

describe('the room rules survive a hibernation', () => {
  it('a room that slept and woke still has radio range on, and a switch-off is not ignored', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    room.message('c1', { type: 'rules', signal: true }, 100);
    // Everyone sits still, the room is evicted, then it wakes from storage.
    const woke = RoomLogic.restore('ABCD', room.save(), ['c1', 'c2'], 20000, room.saveProps(), room.saveRules());
    expect(woke.rules.signal).toBe(true);
    const off = woke.message('c2', { type: 'rules', signal: false }, 20100);
    expect(off.out).toHaveLength(1);
    expect(woke.rules.signal).toBe(false);
    const late = woke.hello('c3', hello('Cy', 'key-cccccccc'), 20200);
    const w = to(late, 'c3').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.rules).toEqual({ signal: false });
  });

  it('restoring with no saved rules starts them off', () => {
    expect(RoomLogic.restore('ABCD', [], [], 0).rules.signal).toBe(false);
  });
});

import { MISSIONS } from '../src/shared/missions';
import type { MissionDef } from '../src/shared/mission-logic';

describe('missions in the room', () => {
  const missionMsgs = (r: Result, conn: string): Array<Extract<ServerMsg, { type: 'mission' }>> =>
    to(r, conn).filter((m): m is Extract<ServerMsg, { type: 'mission' }> => m.type === 'mission');
  const crew = (n = 2): RoomLogic => {
    const room = new RoomLogic('ABCD');
    for (let i = 1; i <= n; i++) room.hello(`c${i}`, hello(`P${i}`, `key-${i}${i}${i}${i}${i}${i}${i}${i}`), 0);
    return room;
  };

  it('a new room has no mission, and says so in the welcome', () => {
    const room = new RoomLogic('ABCD');
    const w = to(room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0), 'c1').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.mission).toBeNull();
  });

  it('starting tells everyone, with who started it and the first stage', () => {
    const room = crew();
    const r = room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 1000);
    const m = missionMsgs(r, 'c2')[0]!;
    expect(m.event).toBe('start');
    expect(m.by).toBe('p1');
    expect(m.mission).toMatchObject({ id: 'terrace', status: 'running', stage: 0, elapsedMs: 0, resets: 0 });
    expect(missionMsgs(r, 'c1')).toHaveLength(1); // the starter hears it too
  });

  it('is refused, to the asker only, when the mission does not exist, one is running, or the crew is too small', () => {
    const room = crew(1);
    let r = room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]!.to).toEqual({ conn: 'c1' });
    expect(missionMsgs(r, 'c1')[0]).toMatchObject({ event: 'refused', reason: 'The Terrace needs 2 players.' });
    expect(room.mission).toBeNull();

    const two = crew();
    expect(missionMsgs(two.message('c1', { type: 'mission', op: 'start', id: 'nope' }, 0), 'c1')[0]!.event).toBe('refused');
    two.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    r = two.message('c2', { type: 'mission', op: 'start', id: 'terrace' }, 100);
    expect(missionMsgs(r, 'c2')[0]).toMatchObject({ event: 'refused', reason: 'A mission is already running.' });
  });

  it('reports move it along: a stage event, then the final one with stars from the room clock', () => {
    const room = crew();
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 1000);
    let r = room.message('c2', { type: 'mission', op: 'flag', obj: 'plank-held' }, 21000);
    expect(missionMsgs(r, 'c1')[0]).toMatchObject({ event: 'stage', mission: { stage: 1, elapsedMs: 20000 } });
    r = room.message('c1', { type: 'mission', op: 'flag', obj: 'plank-ramp' }, 61000);
    expect(missionMsgs(r, 'c2')[0]!.event).toBe('stage');
    r = room.message('c2', { type: 'mission', op: 'reach', obj: 'reach-terrace' }, 101000);
    const done = missionMsgs(r, 'c1')[0]!;
    expect(done.event).toBe('complete');
    expect(done.by).toBe('p2');
    expect(done.mission).toMatchObject({ status: 'complete', elapsedMs: 100000, stars: 3 });
  });

  it('a slow or reset-ridden run earns fewer stars', () => {
    const room = crew();
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    room.message('c1', { type: 'mission', op: 'reset' }, 1000);
    room.message('c1', { type: 'mission', op: 'flag', obj: 'plank-held' }, 5000);
    room.message('c1', { type: 'mission', op: 'flag', obj: 'plank-ramp' }, 6000);
    const r = room.message('c1', { type: 'mission', op: 'reach', obj: 'reach-terrace' }, 999000);
    expect(missionMsgs(r, 'c2')[0]!.mission).toMatchObject({ status: 'complete', resets: 1, stars: 1 });
  });

  it('ignores reports for the wrong stage, the wrong kind, an unknown id, or when no mission runs', () => {
    const room = crew();
    expect(room.message('c1', { type: 'mission', op: 'flag', obj: 'plank-held' }, 0).out).toHaveLength(0); // none running
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    expect(room.message('c1', { type: 'mission', op: 'flag', obj: 'plank-ramp' }, 10).out).toHaveLength(0); // later stage
    expect(room.message('c1', { type: 'mission', op: 'reach', obj: 'plank-held' }, 10).out).toHaveLength(0); // wrong kind
    expect(room.message('c1', { type: 'mission', op: 'flag', obj: 'zzz' }, 10).out).toHaveLength(0);
    expect(room.message('c1', { type: 'mission', op: 'reset' }, 10).out).toHaveLength(1); // a reset is real news
  });

  it('abort ends it for everyone, and a new one can start', () => {
    const room = crew();
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    const r = room.message('c2', { type: 'mission', op: 'abort' }, 50);
    expect(missionMsgs(r, 'c1')[0]).toMatchObject({ mission: null, event: 'abort', by: 'p2' });
    expect(room.mission).toBeNull();
    expect(missionMsgs(room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 60), 'c1')[0]!.event).toBe('start');
    expect(room.message('c1', { type: 'mission', op: 'abort' }, 70).out).toHaveLength(1);
    expect(room.message('c1', { type: 'mission', op: 'abort' }, 80).out).toHaveLength(0); // nothing to abort
  });

  it('starting puts the plank back where it started, unless a car is holding it', () => {
    const room = crew();
    room.message('c1', { type: 'attach', prop: 'plank1', end: 0 }, 0);
    room.message('c1', { type: 'detach', x: 5000, z: 5000, yaw: 100 }, 10); // set down somewhere else
    const r = room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 20);
    const prop = to(r, 'c2').find((m) => m.type === 'prop') as Extract<ServerMsg, { type: 'prop' }>;
    expect(prop.prop).toMatchObject({ id: 'plank1', h0: '', h1: '' });
    expect(prop.prop.x).not.toBe(5000);

    const held = crew();
    held.message('c1', { type: 'attach', prop: 'plank1', end: 0 }, 0);
    expect(to(held.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 20), 'c2').some((m) => m.type === 'prop')).toBe(false);
  });

  it('a late joiner is told where the mission is', () => {
    const room = crew();
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    room.message('c1', { type: 'mission', op: 'flag', obj: 'plank-held' }, 5000);
    const w = to(room.hello('c3', hello('Cy', 'key-cccccccc'), 8000), 'c3').find((m) => m.type === 'welcome') as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.mission).toMatchObject({ id: 'terrace', status: 'running', stage: 1, elapsedMs: 8000 });
  });

  it('survives a hibernation: the stage and the running clock are restored', () => {
    const room = crew();
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 1000);
    room.message('c2', { type: 'mission', op: 'flag', obj: 'plank-held' }, 4000);
    const woke = RoomLogic.restore('ABCD', room.save(), ['c1', 'c2'], 30000, room.saveProps(), room.saveRules(), room.saveMission());
    expect(woke.missionInfo(30000)).toMatchObject({ id: 'terrace', status: 'running', stage: 1, elapsedMs: 29000 });
    const r = woke.message('c1', { type: 'mission', op: 'flag', obj: 'plank-ramp' }, 31000);
    expect(missionMsgs(r, 'c2')[0]!.event).toBe('stage');
  });

  it('a room that wakes with nobody left from the group does not keep their mission', () => {
    const room = crew();
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    const woke = RoomLogic.restore('ABCD', room.save(), [], 99999, room.saveProps(), room.saveRules(), room.saveMission());
    expect(woke.mission).toBeNull();
  });

  it('the last player leaving ends it; others leaving does not', () => {
    const room = crew(3);
    room.message('c1', { type: 'mission', op: 'start', id: 'terrace' }, 0);
    room.close('c3', 100);
    expect(room.mission).not.toBeNull();
    room.close('c2', 200);
    expect(room.mission).not.toBeNull();
    room.close('c1', 300);
    expect(room.mission).toBeNull();
  });

  describe('a mission that needs its own rules, and everyone to reach', () => {
    const TEST: MissionDef = {
      id: 'radio-test',
      name: 'Radio test',
      blurb: '',
      minPlayers: 1,
      rules: { signal: true },
      parSeconds: 100,
      stages: [{ id: 's', title: 'S', objectives: [{ id: 'all-reach', kind: 'reach', goal: 'terrace', who: 'all', text: 'all' }] }],
    };
    const withTest = (fn: () => void): void => {
      (MISSIONS as MissionDef[]).push(TEST);
      try {
        fn();
      } finally {
        (MISSIONS as MissionDef[]).pop();
      }
    };

    it('switches radio range on while it runs and puts it back after, whether it is completed or aborted', () => {
      withTest(() => {
        const room = crew();
        const start = room.message('c1', { type: 'mission', op: 'start', id: 'radio-test' }, 0);
        expect(to(start, 'c2').some((m) => m.type === 'rules' && m.signal)).toBe(true);
        expect(room.rules.signal).toBe(true);
        room.message('c1', { type: 'mission', op: 'reach', obj: 'all-reach' }, 100);
        const done = room.message('c2', { type: 'mission', op: 'reach', obj: 'all-reach' }, 200);
        expect(missionMsgs(done, 'c1')[0]!.event).toBe('complete');
        expect(to(done, 'c1').some((m) => m.type === 'rules' && !m.signal)).toBe(true);
        expect(room.rules.signal).toBe(false);

        room.message('c1', { type: 'mission', op: 'start', id: 'radio-test' }, 300);
        expect(room.rules.signal).toBe(true);
        room.message('c1', { type: 'mission', op: 'abort' }, 400);
        expect(room.rules.signal).toBe(false);
      });
    });

    it('does not touch a rule the room already had on', () => {
      withTest(() => {
        const room = crew();
        room.message('c1', { type: 'rules', signal: true }, 0);
        const r = room.message('c1', { type: 'mission', op: 'start', id: 'radio-test' }, 10);
        expect(to(r, 'c2').some((m) => m.type === 'rules')).toBe(false);
        room.message('c1', { type: 'mission', op: 'abort' }, 20);
        expect(room.rules.signal).toBe(true);
      });
    });

    it('a player leaving can complete an objective that needed everyone', () => {
      withTest(() => {
        const room = crew();
        room.message('c1', { type: 'mission', op: 'start', id: 'radio-test' }, 0);
        room.message('c1', { type: 'mission', op: 'reach', obj: 'all-reach' }, 100);
        const r = room.close('c2', 500);
        expect(r.out.some((o) => o.msg.type === 'mission' && o.msg.event === 'complete')).toBe(true);
        expect(room.mission?.status).toBe('complete');
      });
    });
  });
});

describe('goals', () => {
  it('a free goal is announced to everyone', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb', 'hauler'), 0);
    const r = room.message('c1', { type: 'goal', id: 'terrace' }, 1000);
    expect(to(r, 'c2')).toContainEqual({ type: 'goal', id: 'terrace', by: 'p1' });
  });

  it('a goal that only a mission uses is ignored if a client sends it on its own', () => {
    const room = new RoomLogic('ABCD');
    room.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    room.hello('c2', hello('Bo', 'key-bbbbbbbb', 'hauler'), 0);
    const r = room.message('c1', { type: 'goal', id: 'rock-far' }, 1000);
    expect(r.out).toEqual([]);
  });
});
