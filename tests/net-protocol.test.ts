import { describe, expect, it } from 'vitest';
import { encode, parseClientMessage, cleanName, ROOM_CODE, type PoseFrame } from '../src/shared/net/protocol';
import { dequantizePose, nextPoseDelay, quantizePose, PARK_AFTER_MS } from '../src/shared/net/pose';
import { MAX_FRAME_BYTES } from '../src/shared/constants';

const pose = (over: Partial<PoseFrame> = {}): string =>
  JSON.stringify({ type: 'pose', s: 1, t: 1000, x: 120, y: 90, z: -340, qx: 0, qy: 5000, qz: 0, qw: 8660, v: 55, st: -120, ...over });

describe('frame validation', () => {
  it('accepts a good pose and a good hello', () => {
    expect(parseClientMessage(pose())).toMatchObject({ type: 'pose', x: 120 });
    expect(parseClientMessage(JSON.stringify({ type: 'rules', signal: true }))).toEqual({ type: 'rules', signal: true });
    expect(parseClientMessage(JSON.stringify({ type: 'rules', signal: 'yes' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'rules' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'nitro', on: true }))).toEqual({ type: 'nitro', on: true });
    expect(parseClientMessage(JSON.stringify({ type: 'nitro', on: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'nitro' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'hello', name: 'Ada', role: 'scout', key: 'abcdefgh12345678' }))).toMatchObject({ type: 'hello', name: 'Ada' });
  });

  it('rejects junk, wrong types and non-objects', () => {
    for (const bad of ['', 'nope', '[]', 'null', '{"type":"pose"}', '{"type":"mystery"}', 42, null, undefined]) {
      expect(parseClientMessage(bad as unknown)).toBeNull();
    }
  });

  it('rejects out-of-range and non-integer numbers', () => {
    expect(parseClientMessage(pose({ x: 99999 }))).toBeNull();
    expect(parseClientMessage(pose({ y: 6000 }))).toBeNull();
    expect(parseClientMessage(pose({ x: 1.5 }))).toBeNull();
    expect(parseClientMessage(pose({ v: 5000 }))).toBeNull();
    expect(parseClientMessage(pose({ x: Number.NaN as unknown as number }))).toBeNull();
  });

  it('rejects a rotation that is not a unit quaternion', () => {
    expect(parseClientMessage(pose({ qx: 9000, qy: 9000, qz: 9000, qw: 9000 }))).toBeNull();
    expect(parseClientMessage(pose({ qx: 0, qy: 0, qz: 0, qw: 0 }))).toBeNull();
  });

  it('enforces the frame size cap', () => {
    const big = JSON.stringify({ type: 'hello', name: 'x', role: 'scout', key: 'abcdefgh12345678', pad: 'a'.repeat(MAX_FRAME_BYTES) });
    expect(parseClientMessage(big)).toBeNull();
    expect(encode({ type: 'pose', ...(JSON.parse(pose()) as PoseFrame) }).length).toBeLessThan(MAX_FRAME_BYTES);
  });

  it('validates names, keys, roles, pings', () => {
    expect(cleanName('  Ada <b>  ')).toBe('Ada b');
    expect(cleanName('')).toBeNull();
    expect(cleanName('x'.repeat(17))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'hello', name: 'A', role: 'tank', key: 'abcdefgh12345678' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'hello', name: 'A', role: 'scout', key: 'short' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'ping', kind: 'go', x: 100, z: 200 }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'ping', kind: 'nuke', x: 100, z: 200 }))).toBeNull();
  });

  it('room codes avoid I and O', () => {
    expect(ROOM_CODE.test('ABCD')).toBe(true);
    expect(ROOM_CODE.test('ABIO')).toBe(false);
    expect(ROOM_CODE.test('abcd')).toBe(false);
    expect(ROOM_CODE.test('ABC')).toBe(false);
  });
});

describe('pose quantisation', () => {
  it('round trips within a centimetre and a hair of rotation', () => {
    const p = { x: 12.345, y: 1.07, z: -33.3, qx: 0.1, qy: 0.7, qz: -0.1, qw: 0.7, v: 12.34, steer: 0.31 };
    const back = dequantizePose(quantizePose(p, 1, 500));
    expect(Math.abs(back.x - p.x)).toBeLessThan(0.006);
    expect(Math.abs(back.z - p.z)).toBeLessThan(0.006);
    expect(Math.abs(back.v - p.v)).toBeLessThan(0.06);
    expect(Math.abs(back.steer - p.steer)).toBeLessThan(0.001);
    const n = Math.hypot(back.qx, back.qy, back.qz, back.qw);
    expect(Math.abs(n - 1)).toBeLessThan(0.001);
  });

  it('quantised frames always pass validation', () => {
    const frame = quantizePose({ x: 10, y: 1, z: -5, qx: 0.2, qy: 0.5, qz: 0.1, qw: 0.8, v: 8, steer: 0.2 }, 3, 9000);
    expect(parseClientMessage(JSON.stringify({ type: 'pose', ...frame }))).not.toBeNull();
  });

  it('clamps wild values instead of producing invalid frames', () => {
    const frame = quantizePose({ x: 5000, y: 900, z: -9000, qx: 0, qy: 0, qz: 0, qw: 1, v: 900, steer: 9 }, 1, 1);
    expect(parseClientMessage(JSON.stringify({ type: 'pose', ...frame }))).not.toBeNull();
  });
});

describe('adaptive send rate', () => {
  it('10 Hz moving, 2 Hz when nearly still, silent once parked', () => {
    expect(nextPoseDelay(8, 0)).toBe(100);
    expect(nextPoseDelay(0.1, 1000)).toBe(500);
    expect(nextPoseDelay(0.1, PARK_AFTER_MS + 1)).toBeNull();
    expect(nextPoseDelay(-5, PARK_AFTER_MS + 1)).toBe(100); // reversing counts as moving
  });
});
