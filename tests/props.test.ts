import { describe, expect, it } from 'vitest';
import { PropsLogic, PROPS, fromInfo, toInfo } from '../src/shared/net/props';
import { RoomLogic, type Result } from '../src/shared/net/room-logic';
import { parseClientMessage, type ClientMsg, type ServerMsg } from '../src/shared/net/protocol';

const rest = { x: 5, z: -3, yaw: 1.2 };
const hello = (name: string, key: string): Extract<ClientMsg, { type: 'hello' }> => ({ type: 'hello', name, role: 'hauler', key });
const msgs = (r: Result, type: string): ServerMsg[] => r.out.map((o) => o.msg).filter((m) => m.type === type);

describe('who holds the plank', () => {
  it('starts free at its start pose', () => {
    const p = new PropsLogic().props.get('plank1')!;
    expect(p.holders).toEqual([null, null]);
    expect(p.pose).toEqual(PROPS[0]!.start);
  });

  it('two players can hold opposite ends; the same end cannot be taken twice', () => {
    const l = new PropsLogic();
    expect(l.attach('p1', 'plank1', 0)).not.toBeNull();
    expect(l.attach('p2', 'plank1', 0)).toBeNull();
    expect(l.attach('p2', 'plank1', 1)).not.toBeNull();
    expect(l.props.get('plank1')!.holders).toEqual(['p1', 'p2']);
  });

  it('a player can only hold one end, and unknown props are refused', () => {
    const l = new PropsLogic();
    l.attach('p1', 'plank1', 0);
    expect(l.attach('p1', 'plank1', 1)).toBeNull();
    expect(l.attach('p3', 'nope', 0)).toBeNull();
  });

  it('the last player to let go sets where it rests; an earlier release does not move it', () => {
    const l = new PropsLogic();
    l.attach('p1', 'plank1', 0);
    l.attach('p2', 'plank1', 1);
    l.detach('p1', { x: 99, z: 99, yaw: 0 }); // p2 still holds: ignored
    expect(l.props.get('plank1')!.pose).toEqual(PROPS[0]!.start);
    l.detach('p2', rest);
    expect(l.props.get('plank1')!.pose).toEqual(rest);
    expect(l.props.get('plank1')!.holders).toEqual([null, null]);
  });

  it('letting go without holding anything does nothing', () => {
    expect(new PropsLogic().detach('p9', rest)).toBeNull();
  });

  it('a leaving player frees their end but the plank stays where it last rested', () => {
    const l = new PropsLogic();
    l.attach('p1', 'plank1', 1);
    l.release('p1');
    expect(l.props.get('plank1')!.holders).toEqual([null, null]);
    expect(l.props.get('plank1')!.pose).toEqual(PROPS[0]!.start);
  });

  it('wire form round trips to a centimetre', () => {
    const l = new PropsLogic();
    l.attach('p2', 'plank1', 1);
    l.detach('p2', { x: 12.345, z: -7.891, yaw: 2.4567 });
    const back = fromInfo(toInfo(l.props.get('plank1')!));
    expect(Math.abs(back.pose.x - 12.345)).toBeLessThan(0.006);
    expect(Math.abs(back.pose.yaw - 2.4567)).toBeLessThan(0.0006);
  });

  it('save and restore keep who holds what', () => {
    const l = new PropsLogic();
    l.attach('p1', 'plank1', 0);
    const again = PropsLogic.restore(l.save());
    expect(again.props.get('plank1')!.holders).toEqual(['p1', null]);
  });
});

describe('in a room', () => {
  const room = (): RoomLogic => {
    const r = new RoomLogic('ABCD');
    r.hello('c1', hello('Ada', 'key-aaaaaaaa'), 0);
    r.hello('c2', hello('Bo', 'key-bbbbbbbb'), 0);
    return r;
  };

  it('a newcomer is told where the plank is', () => {
    const r = room();
    r.message('c1', { type: 'attach', prop: 'plank1', end: 0 }, 1);
    const w = msgs(r.hello('c3', hello('Cy', 'key-cccccccc'), 2), 'welcome')[0] as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.props[0]).toMatchObject({ id: 'plank1', h0: 'p1', h1: '' });
  });

  it('attach and detach are broadcast to everyone, including the sender', () => {
    const r = room();
    const a = r.message('c1', { type: 'attach', prop: 'plank1', end: 1 }, 1);
    expect(a.out).toHaveLength(1);
    expect(a.out[0]!.to).toBe('all');
    expect(a.out[0]!.msg).toMatchObject({ type: 'prop', prop: { id: 'plank1', h1: 'p1' } });
    const d = r.message('c1', { type: 'detach', x: 800, z: -200, yaw: 500 }, 2);
    expect(d.out[0]!.msg).toMatchObject({ type: 'prop', prop: { h0: '', h1: '', x: 800, z: -200, yaw: 500 } });
  });

  it('a refused attach says nothing (no change)', () => {
    const r = room();
    r.message('c1', { type: 'attach', prop: 'plank1', end: 0 }, 1);
    expect(r.message('c2', { type: 'attach', prop: 'plank1', end: 0 }, 2).out).toEqual([]);
  });

  it('a player who leaves lets go of the plank, and everyone hears about it', () => {
    const r = room();
    r.message('c1', { type: 'attach', prop: 'plank1', end: 0 }, 1);
    const left = r.close('c1');
    expect(left.out.map((o) => o.msg.type)).toEqual(['leave', 'prop']);
    expect(left.out[1]!.msg).toMatchObject({ prop: { h0: '' } });
  });

  it('a reload keeps holding the plank (same key, same player id)', () => {
    const r = room();
    r.message('c1', { type: 'attach', prop: 'plank1', end: 0 }, 1);
    r.hello('c9', hello('Ada', 'key-aaaaaaaa'), 2);
    expect(r.props.props.get('plank1')!.holders[0]).toBe('p1');
  });

  it('survives hibernation with the plank still held', () => {
    const r = room();
    r.message('c2', { type: 'attach', prop: 'plank1', end: 1 }, 1);
    const woke = RoomLogic.restore('ABCD', r.save(), ['c1', 'c2'], 5, r.saveProps());
    expect(woke.props.props.get('plank1')!.holders[1]).toBe('p2');
  });
});

describe('prop frames are validated', () => {
  it('accepts good attach and detach, rejects bad ones', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'attach', prop: 'plank1', end: 0 }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'attach', prop: 'plank1', end: 2 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'attach', prop: 'BAD ID!', end: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'detach', x: 100, z: -100, yaw: 300 }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'detach', x: 99999, z: 0, yaw: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'detach', x: 1.5, z: 0, yaw: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'detach', x: 0, z: 0, yaw: 9000 }))).toBeNull();
  });
});
