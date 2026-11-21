import type { CarRole } from '../cars';
import { MAX_PLAYERS, type ClientMsg, type PlayerInfo, type ServerMsg } from './protocol';
import { PropsLogic, toInfo, type PropState } from './props';

/**
 * All room rules in one pure state machine: no sockets, no timers, no clock of its own.
 * The Durable Object feeds it messages and the time, and sends what it returns.
 */

export type Target = { conn: string } | { except: string } | 'all';
export interface Out {
  to: Target;
  msg: ServerMsg;
}
export interface Result {
  out: Out[];
  close: Array<{ conn: string; reason: string }>;
}

export interface Player {
  id: string;
  name: string;
  role: CarRole;
  key: string;
  conn: string;
  tokens: number;
  lastRefill: number;
  violations: number;
}

/** What survives a hibernation: rebuilt from storage when the room wakes. */
export interface SavedPlayer {
  id: string;
  name: string;
  role: CarRole;
  key: string;
  conn: string;
}

const BUCKET = 40; // burst of frames
const REFILL_PER_S = 30;
const MAX_VIOLATIONS = 300;
const none = (): Result => ({ out: [], close: [] });

export class RoomLogic {
  readonly players = new Map<string, Player>();
  props = new PropsLogic();

  constructor(readonly code: string) {}

  static restore(code: string, saved: SavedPlayer[], liveConns: Iterable<string>, now: number, props: PropState[] = []): RoomLogic {
    const room = new RoomLogic(code);
    room.props = PropsLogic.restore(props);
    const live = new Set(liveConns);
    for (const p of saved) {
      if (!live.has(p.conn)) continue; // their socket died while we slept
      room.players.set(p.id, { ...p, tokens: BUCKET, lastRefill: now, violations: 0 });
    }
    return room;
  }

  save(): SavedPlayer[] {
    return [...this.players.values()].map(({ id, name, role, key, conn }) => ({ id, name, role, key, conn }));
  }

  saveProps(): PropState[] {
    return this.props.save();
  }

  info(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, role: p.role };
  }

  private byConn(conn: string): Player | undefined {
    for (const p of this.players.values()) if (p.conn === conn) return p;
    return undefined;
  }

  private freeId(): string | null {
    for (let i = 1; i <= MAX_PLAYERS; i++) if (!this.players.has(`p${i}`)) return `p${i}`;
    return null;
  }

  hello(conn: string, msg: Extract<ClientMsg, { type: 'hello' }>, now: number): Result {
    if (this.byConn(conn)) return { out: [], close: [{ conn, reason: 'duplicate hello' }] };

    // Same key: a reload or a reconnect. Take the old slot back and drop the stale socket.
    let existing: Player | undefined;
    for (const p of this.players.values()) if (p.key === msg.key) existing = p;
    if (existing) {
      const stale = existing.conn;
      existing.conn = conn;
      existing.name = msg.name;
      existing.role = msg.role;
      existing.tokens = BUCKET;
      existing.lastRefill = now;
      return {
        out: this.welcomeAndJoin(existing, conn),
        close: stale !== conn ? [{ conn: stale, reason: 'replaced' }] : [],
      };
    }

    const id = this.freeId();
    if (!id) return { out: [{ to: { conn }, msg: { type: 'full' } }], close: [{ conn, reason: 'room full' }] };
    const p: Player = { id, name: msg.name, role: msg.role, key: msg.key, conn, tokens: BUCKET, lastRefill: now, violations: 0 };
    this.players.set(id, p);
    return { out: this.welcomeAndJoin(p, conn), close: [] };
  }

  private welcomeAndJoin(p: Player, conn: string): Out[] {
    return [
      { to: { conn }, msg: { type: 'welcome', id: p.id, code: this.code, max: MAX_PLAYERS, players: [...this.players.values()].map((q) => this.info(q)), props: [...this.props.props.values()].map(toInfo) } },
      { to: { except: conn }, msg: { type: 'join', player: this.info(p) } },
    ];
  }

  /** Every non-hello frame. Unknown connections get closed. Flooders get dropped, then closed. */
  message(conn: string, msg: ClientMsg, now: number): Result {
    const p = this.byConn(conn);
    if (!p) return { out: [], close: [{ conn, reason: 'no hello' }] };

    p.tokens = Math.min(BUCKET, p.tokens + ((now - p.lastRefill) / 1000) * REFILL_PER_S);
    p.lastRefill = now;
    if (p.tokens < 1) {
      p.violations++;
      return p.violations > MAX_VIOLATIONS ? { out: [], close: [{ conn, reason: 'rate limit' }] } : none();
    }
    p.tokens -= 1;

    switch (msg.type) {
      case 'hello':
        return { out: [], close: [{ conn, reason: 'duplicate hello' }] };
      case 'pose': {
        const { type: _t, ...frame } = msg;
        return { out: [{ to: { except: conn }, msg: { type: 'pose', id: p.id, ...frame } }], close: [] };
      }
      case 'car':
        p.role = msg.role;
        return { out: [{ to: 'all', msg: { type: 'car', id: p.id, role: msg.role } }], close: [] };
      case 'horn':
        return { out: [{ to: { except: conn }, msg: { type: 'horn', id: p.id, on: msg.on } }], close: [] };
      case 'ping':
        return { out: [{ to: { except: conn }, msg: { type: 'ping', id: p.id, kind: msg.kind, x: msg.x, z: msg.z } }], close: [] };
      case 'attach': {
        const changed = this.props.attach(p.id, msg.prop, msg.end);
        return changed ? { out: [{ to: 'all', msg: { type: 'prop', prop: toInfo(changed) } }], close: [] } : none();
      }
      case 'detach': {
        const changed = this.props.detach(p.id, { x: msg.x / 100, z: msg.z / 100, yaw: msg.yaw / 1000 });
        return changed ? { out: [{ to: 'all', msg: { type: 'prop', prop: toInfo(changed) } }], close: [] } : none();
      }
    }
  }

  close(conn: string): Result {
    const p = this.byConn(conn);
    if (!p) return none(); // an already-replaced socket closing: nothing to announce
    this.players.delete(p.id);
    const out: Out[] = [{ to: 'all', msg: { type: 'leave', id: p.id } }];
    const freed = this.props.release(p.id); // a car that leaves lets go of the plank
    if (freed) out.push({ to: 'all', msg: { type: 'prop', prop: toInfo(freed) } });
    return { out, close: [] };
  }
}
