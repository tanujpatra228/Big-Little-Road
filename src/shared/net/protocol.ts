import { CAR_ORDER, type CarRole } from '../cars';
import { MAX_FRAME_BYTES } from '../constants';
import type { PropInfo } from './props';

/**
 * Wire protocol: small JSON frames, defined once, validated on arrival.
 * Positions are whole centimetres, rotations are quaternion parts times 10000, so frames stay tiny.
 */

export const MAX_PLAYERS = 4;
export const PING_KINDS = ['go', 'wait', 'tow', 'battery', 'look'] as const;
export type PingKind = (typeof PING_KINDS)[number];

/** Yard is 160 wide; allow a little outside before a frame counts as bogus. */
const POS_LIMIT_CM = 10000;
const Y_LIMIT_CM = 5000;

export interface PoseFrame {
  /** Sequence number, rises by one per pose. */
  s: number;
  /** Sender clock in ms since it connected. The receiver uses it to smooth out network jitter. */
  t: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Forward speed in 0.1 m/s. Drives wheel spin and extrapolation. */
  v: number;
  /** Front wheel steer in mrad. */
  st: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  role: CarRole;
}

export type ClientMsg =
  | { type: 'hello'; name: string; role: CarRole; key: string }
  | ({ type: 'pose' } & PoseFrame)
  | { type: 'car'; role: CarRole }
  | { type: 'horn'; on: boolean }
  | { type: 'ping'; kind: PingKind; x: number; z: number }
  /** Hook one end of a prop. */
  | { type: 'attach'; prop: string; end: 0 | 1 }
  /** Let go. x, z (cm) and yaw (mrad) say where the player saw the prop, used if nobody else holds it. */
  | { type: 'detach'; x: number; z: number; yaw: number }
  /** Return a prop to where it started (only works if nobody holds it). */
  | { type: 'reset'; prop: string }
  /** This player's car reached a goal. */
  | { type: 'goal'; id: string };

export type ServerMsg =
  | { type: 'welcome'; id: string; code: string; max: number; players: PlayerInfo[]; props: PropInfo[] }
  | { type: 'join'; player: PlayerInfo }
  | { type: 'leave'; id: string }
  | ({ type: 'pose'; id: string } & PoseFrame)
  | { type: 'car'; id: string; role: CarRole }
  | { type: 'horn'; id: string; on: boolean }
  | { type: 'ping'; id: string; kind: PingKind; x: number; z: number }
  | { type: 'prop'; prop: PropInfo }
  | { type: 'goal'; id: string; by: string }
  | { type: 'full' }
  | { type: 'error'; reason: string };

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export function isRole(v: unknown): v is CarRole {
  return typeof v === 'string' && (CAR_ORDER as string[]).includes(v);
}

export const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Names: 1 to 16 printable characters. Returns the cleaned name or null. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  return s.length >= 1 && s.length <= 16 ? s : null;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export const ROOM_CODE = /^[A-HJ-NP-Z]{4}$/; // no I or O: they read as 1 and 0

export function parsePose(o: Record<string, unknown>): PoseFrame | null {
  const { s, t, x, y, z, qx, qy, qz, qw, v, st } = o;
  if (!isInt(s, 0, 2 ** 31) || !isInt(t, 0, 2 ** 31)) return null;
  if (!isInt(x, -POS_LIMIT_CM, POS_LIMIT_CM) || !isInt(z, -POS_LIMIT_CM, POS_LIMIT_CM) || !isInt(y, -Y_LIMIT_CM, Y_LIMIT_CM)) return null;
  if (!isInt(qx, -10000, 10000) || !isInt(qy, -10000, 10000) || !isInt(qz, -10000, 10000) || !isInt(qw, -10000, 10000)) return null;
  if (!isInt(v, -1000, 1000) || !isInt(st, -1500, 1500)) return null;
  const n2 = qx * qx + qy * qy + qz * qz + qw * qw; // should be about 1e8
  if (n2 < 0.9e8 || n2 > 1.1e8) return null;
  return { s, t, x, y, z, qx, qy, qz, qw, v, st };
}

/** Validates one client frame. Returns null for anything malformed, oversized or out of range. */
export function parseClientMessage(text: unknown): ClientMsg | null {
  if (typeof text !== 'string' || text.length > MAX_FRAME_BYTES || byteLength(text) > MAX_FRAME_BYTES) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const m = o as Record<string, unknown>;
  switch (m.type) {
    case 'hello': {
      const name = cleanName(m.name);
      if (!name || !isRole(m.role) || typeof m.key !== 'string' || !KEY_PATTERN.test(m.key)) return null;
      return { type: 'hello', name, role: m.role, key: m.key };
    }
    case 'pose': {
      const p = parsePose(m);
      return p ? { type: 'pose', ...p } : null;
    }
    case 'car':
      return isRole(m.role) ? { type: 'car', role: m.role } : null;
    case 'horn':
      return typeof m.on === 'boolean' ? { type: 'horn', on: m.on } : null;
    case 'ping':
      if (!(PING_KINDS as readonly unknown[]).includes(m.kind)) return null;
      if (!isInt(m.x, -POS_LIMIT_CM, POS_LIMIT_CM) || !isInt(m.z, -POS_LIMIT_CM, POS_LIMIT_CM)) return null;
      return { type: 'ping', kind: m.kind as PingKind, x: m.x, z: m.z };
    case 'attach':
      if (typeof m.prop !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.prop) || (m.end !== 0 && m.end !== 1)) return null;
      return { type: 'attach', prop: m.prop, end: m.end };
    case 'detach':
      if (!isInt(m.x, -POS_LIMIT_CM, POS_LIMIT_CM) || !isInt(m.z, -POS_LIMIT_CM, POS_LIMIT_CM) || !isInt(m.yaw, -7000, 7000)) return null;
      return { type: 'detach', x: m.x, z: m.z, yaw: m.yaw };
    case 'reset':
      if (typeof m.prop !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.prop)) return null;
      return { type: 'reset', prop: m.prop };
    case 'goal':
      if (typeof m.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.id)) return null;
      return { type: 'goal', id: m.id };
    default:
      return null;
  }
}

export const encode = (msg: ServerMsg | ClientMsg): string => JSON.stringify(msg);

/** Client side: parse what the server sent. Lenient on extra fields, strict on type. */
export function parseServerMessage(text: unknown): ServerMsg | null {
  if (typeof text !== 'string' || text.length > 4096) return null;
  try {
    const o = JSON.parse(text) as { type?: string };
    return o && typeof o.type === 'string' ? (o as ServerMsg) : null;
  } catch {
    return null;
  }
}
