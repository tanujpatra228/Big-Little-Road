import type { CarRole } from '../cars';
import { MAX_PLAYERS, type ClientMsg, type MissionNotice, type PlayerInfo, type RoomRules, type ServerMsg } from './protocol';
import { PropsLogic, toInfo, type PropState } from './props';
import { GOAL_COOLDOWN_MS, goalById } from '../goals';
import { CHARGE_AMOUNT, CHARGE_COOLDOWN, SharedBattery, toBatteryInfo } from '../battery';
import { addReset, playerLeft, report, startMission, toInfo as missionToInfo, type MissionDef, type MissionEvent, type MissionInfo, type MissionState } from '../mission-logic';
import { missionById } from '../missions';
import { DROP_REACH, PICKUP_RANGE, REFUSALS, dropItem, newTools, pickUp, toWire, type Tools } from '../toolbox';

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
  /** Where this player's car last said it was (metres). Not saved: it is known again with the next pose. */
  pos?: { x: number; z: number };
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
  /** The team battery. Not saved across a hibernation: a room that slept long enough has refilled anyway. */
  readonly battery = new SharedBattery();
  private lastNow = 0;
  /** Rules the whole room shares. Saved with the room: a room that slept must still remember what everyone agreed. */
  rules: RoomRules = { signal: false };
  /** The mission being played, if any. Saved with the room so a hibernation does not lose it. */
  mission: MissionState | null = null;
  /** The shared toolbox and what has been put down from it. Saved with the room. */
  tools: Tools = newTools();
  /** When each Relay last charged the battery (room clock, ms). Not saved: a slept room has cooled down. */
  private readonly chargedAt = new Map<string, number>();
  /** When each goal last fired, to avoid celebrating one run many times. Not persisted. */
  private readonly goalAt = new Map<string, number>();

  constructor(readonly code: string) {}

  static restore(code: string, saved: SavedPlayer[], liveConns: Iterable<string>, now: number, props: PropState[] = [], rules: RoomRules = { signal: false }, mission: MissionState | null = null, tools: Tools | null = null): RoomLogic {
    const room = new RoomLogic(code);
    room.mission = mission && missionById(mission.id) ? mission : null;
    room.props = PropsLogic.restore(props);
    room.rules = { signal: !!rules.signal };
    room.tools = tools && Array.isArray(tools.slots) && Array.isArray(tools.placed) ? { slots: [...tools.slots], placed: tools.placed.map((p) => ({ ...p })), next: tools.next } : newTools();
    const live = new Set(liveConns);
    for (const p of saved) {
      if (!live.has(p.conn)) continue; // their socket died while we slept
      room.players.set(p.id, { ...p, tokens: BUCKET, lastRefill: now, violations: 0 });
    }
    // Nobody is left from the group that started it: do not hand the next group a half-finished mission,
    // and put back any rules it had changed.
    if (room.players.size === 0 && room.mission) {
      if (room.mission.rulesBefore) room.rules = { ...room.mission.rulesBefore };
      room.mission = null;
    }
    if (room.players.size === 0) room.tools = newTools(); // the next group starts with a full box and an empty yard
    return room;
  }

  save(): SavedPlayer[] {
    return [...this.players.values()].map(({ id, name, role, key, conn }) => ({ id, name, role, key, conn }));
  }

  saveMission(): MissionState | null {
    return this.mission ? { ...this.mission, progress: { ...this.mission.progress } } : null;
  }

  saveTools(): Tools {
    return { slots: [...this.tools.slots], placed: this.tools.placed.map((p) => ({ ...p })), next: this.tools.next };
  }

  saveRules(): RoomRules {
    return { ...this.rules };
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
        out: this.welcomeAndJoin(existing, conn, now),
        close: stale !== conn ? [{ conn: stale, reason: 'replaced' }] : [],
      };
    }

    const id = this.freeId();
    if (!id) return { out: [{ to: { conn }, msg: { type: 'full' } }], close: [{ conn, reason: 'room full' }] };
    const p: Player = { id, name: msg.name, role: msg.role, key: msg.key, conn, tokens: BUCKET, lastRefill: now, violations: 0 };
    this.players.set(id, p);
    return { out: this.welcomeAndJoin(p, conn, now), close: [] };
  }

  private welcomeAndJoin(p: Player, conn: string, now: number): Out[] {
    return [
      { to: { conn }, msg: { type: 'welcome', id: p.id, code: this.code, max: MAX_PLAYERS, players: [...this.players.values()].map((q) => this.info(q)), props: [...this.props.props.values()].map(toInfo), battery: toBatteryInfo(this.battery.snapshot(now)), rules: { ...this.rules }, mission: this.missionInfo(now), tools: toWire(this.tools) } },
      { to: { except: conn }, msg: { type: 'join', player: this.info(p) } },
    ];
  }

  /** Every non-hello frame. Unknown connections get closed. Flooders get dropped, then closed. */
  message(conn: string, msg: ClientMsg, now: number): Result {
    const p = this.byConn(conn);
    if (!p) return { out: [], close: [{ conn, reason: 'no hello' }] };
    this.lastNow = now;

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
        p.pos = { x: frame.x / 100, z: frame.z / 100 };
        return { out: [{ to: { except: conn }, msg: { type: 'pose', id: p.id, ...frame } }], close: [] };
      }
      case 'car':
        p.role = msg.role;
        return { out: [{ to: 'all', msg: { type: 'car', id: p.id, role: msg.role } }], close: [] };
      case 'horn':
        return { out: [{ to: { except: conn }, msg: { type: 'horn', id: p.id, on: msg.on } }], close: [] };
      case 'nitro': {
        // The flame goes to everyone else as before. The battery is the room's: boosting spends it.
        const flame: Out = { to: { except: conn }, msg: { type: 'nitro', id: p.id, on: msg.on } };
        if (msg.on) {
          if (!this.battery.start(p.id, now)) {
            // Empty or locked out: do not show a flame, and tell this player so their own view agrees.
            return { out: [{ to: { conn }, msg: { type: 'battery', battery: toBatteryInfo(this.battery.snapshot(now)) } }], close: [] };
          }
          return { out: [flame, this.batteryOut(now)], close: [] };
        }
        const was = this.battery.isBoosting(p.id);
        this.battery.stop(p.id, now);
        return { out: was ? [flame, this.batteryOut(now)] : [flame], close: [] };
      }
      case 'rules': {
        if (this.rules.signal === msg.signal) return none();
        this.rules = { ...this.rules, signal: msg.signal };
        return { out: [{ to: 'all', msg: { type: 'rules', signal: msg.signal, by: p.id } }], close: [] };
      }
      case 'mission':
        return this.missionMessage(conn, p, msg, now);
      case 'tool':
        return this.toolMessage(conn, p, msg);
      case 'charge':
        return this.charge(conn, p, now);
      case 'ping':
        return { out: [{ to: { except: conn }, msg: { type: 'ping', id: p.id, kind: msg.kind, x: msg.x, z: msg.z } }], close: [] };
      case 'attach': {
        const changed = this.props.attach(p.id, msg.prop, msg.end);
        return changed ? { out: [{ to: 'all', msg: { type: 'prop', prop: toInfo(changed) } }], close: [] } : none();
      }
      case 'reset': {
        const changed = this.props.reset(msg.prop);
        return changed ? { out: [{ to: 'all', msg: { type: 'prop', prop: toInfo(changed) } }], close: [] } : none();
      }
      case 'goal': {
        if (!goalById(msg.id) || goalById(msg.id)?.missionOnly) return none(); // mission goals are reported through the mission
        const last = this.goalAt.get(msg.id);
        if (last !== undefined && now - last < GOAL_COOLDOWN_MS) return none();
        this.goalAt.set(msg.id, now);
        return { out: [{ to: 'all', msg: { type: 'goal', id: msg.id, by: p.id } }], close: [] };
      }
      case 'detach': {
        const changed = this.props.detach(p.id, { x: msg.x / 100, z: msg.z / 100, yaw: msg.yaw / 1000 });
        return changed ? { out: [{ to: 'all', msg: { type: 'prop', prop: toInfo(changed) } }], close: [] } : none();
      }
    }
  }

  /** A Relay truck tops up the team battery. Relay only, and not more often than the cooldown. */
  private charge(conn: string, p: Player, now: number): Result {
    const no = (reason: string, wait?: number): Result => ({ out: [{ to: { conn }, msg: { type: 'charge', by: p.id, ok: false, x: 0, z: 0, wait, reason } }], close: [] });
    if (p.role !== 'relay') return no('Only the Relay truck can charge the battery. Press 3 for the Relay.');
    const last = this.chargedAt.get(p.id);
    if (last !== undefined && now - last < CHARGE_COOLDOWN * 1000) return no('The charger is still warming up.', Math.ceil((CHARGE_COOLDOWN * 1000 - (now - last)) / 1000));
    this.chargedAt.set(p.id, now);
    this.battery.topUp(CHARGE_AMOUNT, now);
    const x = Math.round((p.pos?.x ?? 0) * 100);
    const z = Math.round((p.pos?.z ?? 0) * 100);
    return { out: [{ to: 'all', msg: { type: 'charge', by: p.id, ok: true, x, z } }, this.batteryOut(now)], close: [] };
  }

  private toolsOut(event?: 'drop' | 'pickup' | 'reset' | 'refused', by?: string, kind?: string): Out {
    return { to: 'all', msg: { type: 'tools', tools: toWire(this.tools), event, by, kind } };
  }

  private toolMessage(conn: string, p: Player, msg: Extract<ClientMsg, { type: 'tool' }>): Result {
    const refuse = (reason: string): Result => ({ out: [{ to: { conn }, msg: { type: 'tools', tools: toWire(this.tools), event: 'refused', reason } }], close: [] });
    if (msg.op === 'drop') {
      const x = msg.x / 100;
      const z = msg.z / 100;
      if (Math.abs(x) > 90 || Math.abs(z) > 90) return refuse('That is outside the yard.');
      // A drop must be near the car that makes it (checked when the room knows where the car is).
      if (p.pos && Math.hypot(p.pos.x - x, p.pos.z - z) > DROP_REACH) return refuse('That is too far from your car.');
      const r = dropItem(this.tools, msg.slot, { x, z, yaw: msg.yaw / 1000 }, p.id);
      if ('error' in r) return refuse(REFUSALS[r.error]);
      this.tools = r.tools;
      return { out: [this.toolsOut('drop', p.id, r.placed.kind)], close: [] };
    }
    const item = this.tools.placed.find((o) => o.id === msg.id);
    if (!item) return refuse(REFUSALS.unknown);
    if (p.pos && Math.hypot(p.pos.x - item.x, p.pos.z - item.z) > PICKUP_RANGE + 3) return refuse('You are too far from it.');
    const r = pickUp(this.tools, msg.id);
    if ('error' in r) return refuse(REFUSALS[r.error]);
    this.tools = r.tools;
    return { out: [this.toolsOut('pickup', p.id, r.kind)], close: [] };
  }

  private playerIds(): string[] {
    return [...this.players.keys()];
  }

  private missionDef(): MissionDef | undefined {
    return this.mission ? missionById(this.mission.id) : undefined;
  }

  /** The mission as everyone is told about it, or null when there is none. */
  missionInfo(now: number): MissionInfo | null {
    const def = this.missionDef();
    return this.mission && def ? missionToInfo(def, this.mission, now, this.playerIds()) : null;
  }

  private missionOut(now: number, event?: MissionNotice, by?: string): Out {
    return { to: 'all', msg: { type: 'mission', mission: this.missionInfo(now), event, by } };
  }

  /** Puts the room rules back the way they were before the mission changed them. */
  private restoreRules(): Out[] {
    const before = this.mission?.rulesBefore;
    if (!before) return [];
    this.rules = { ...before };
    return [{ to: 'all', msg: { type: 'rules', signal: this.rules.signal, by: this.mission!.startedBy } }];
  }

  /** The events a change produced, as messages: a stage moved on, or the mission was completed (rules go back). */
  private missionEvents(events: MissionEvent[], now: number, by: string): Out[] {
    const out: Out[] = [];
    if (events.includes('complete')) {
      out.push(this.missionOut(now, 'complete', by));
      out.push(...this.restoreRules());
    } else if (events.includes('stage')) out.push(this.missionOut(now, 'stage', by));
    else out.push(this.missionOut(now));
    return out;
  }

  private missionMessage(conn: string, p: Player, msg: Extract<ClientMsg, { type: 'mission' }>, now: number): Result {
    const refuse = (reason: string): Result => ({ out: [{ to: { conn }, msg: { type: 'mission', mission: this.missionInfo(now), event: 'refused', reason } }], close: [] });
    switch (msg.op) {
      case 'start': {
        const def = missionById(msg.id);
        if (!def) return refuse('There is no such mission.');
        if (this.mission?.status === 'running') return refuse('A mission is already running.');
        if (this.players.size < def.minPlayers) return refuse(`${def.name} needs ${def.minPlayers} players.`);
        const out: Out[] = [];
        // The mission may need its own rules (restored when it ends).
        const changes = def.rules && Object.entries(def.rules).some(([k, v]) => this.rules[k as keyof RoomRules] !== v);
        const before = changes ? { ...this.rules } : null;
        if (def.rules) this.rules = { ...this.rules, ...def.rules };
        this.mission = startMission(def, now, p.id, before);
        // Props that nobody holds go back to where they start, so every attempt begins the same way.
        for (const prop of this.props.props.values()) {
          if (prop.holders[0] || prop.holders[1]) continue;
          const changed = this.props.reset(prop.id);
          if (changed) out.push({ to: 'all', msg: { type: 'prop', prop: toInfo(changed) } });
        }
        if (changes) out.push({ to: 'all', msg: { type: 'rules', signal: this.rules.signal, by: p.id } });
        // A full box and an empty yard, so every attempt begins the same way.
        this.tools = newTools();
        out.push(this.toolsOut('reset', p.id));
        out.push(this.missionOut(now, 'start', p.id));
        return { out, close: [] };
      }
      case 'abort': {
        if (!this.mission) return none();
        const out = this.restoreRules();
        this.mission = null;
        out.push({ to: 'all', msg: { type: 'mission', mission: null, event: 'abort', by: p.id } });
        return { out, close: [] };
      }
      case 'reset': {
        if (!this.mission || this.mission.status !== 'running') return none();
        this.mission = addReset(this.mission);
        return { out: [this.missionOut(now)], close: [] };
      }
      case 'reach':
      case 'flag': {
        const def = this.missionDef();
        if (!this.mission || !def) return none();
        const r = report(def, this.mission, p.id, msg.obj, msg.op, this.playerIds(), now, p.role);
        if (!r.changed) return none();
        this.mission = r.state;
        return { out: this.missionEvents(r.events, now, p.id), close: [] };
      }
    }
  }

  private batteryOut(now: number): Out {
    return { to: 'all', msg: { type: 'battery', battery: toBatteryInfo(this.battery.snapshot(now)) } };
  }

  /** `now` defaults to the last time we heard from anyone, which is all a test without a clock needs. */
  close(conn: string, now: number = this.lastNow): Result {
    const p = this.byConn(conn);
    if (!p) return none(); // an already-replaced socket closing: nothing to announce
    this.players.delete(p.id);
    this.chargedAt.delete(p.id);
    const out: Out[] = [{ to: 'all', msg: { type: 'leave', id: p.id } }];
    if (this.players.size === 0) this.tools = newTools();
    // The mission goes on without them; an objective that needed everyone may now be met.
    const def = this.missionDef();
    if (this.mission && def) {
      if (this.players.size === 0) {
        // Nobody left: the next group should not walk into a half-finished mission.
        out.push(...this.restoreRules());
        this.mission = null;
      } else {
        const r = playerLeft(def, this.mission, p.id, this.playerIds(), this.lastNow);
        this.mission = r.state;
        if (r.changed) out.push(...this.missionEvents(r.events, this.lastNow, p.id));
      }
    }
    // A car that leaves stops draining the team battery.
    if (this.battery.isBoosting(p.id)) {
      this.battery.stop(p.id, now);
      out.push(this.batteryOut(now));
    }
    const freed = this.props.release(p.id); // a car that leaves lets go of the plank
    if (freed) out.push({ to: 'all', msg: { type: 'prop', prop: toInfo(freed) } });
    return { out, close: [] };
  }
}
