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
