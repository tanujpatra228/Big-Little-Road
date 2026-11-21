import type { PlankPose } from '../tether';

/** World props that players can interact with. The plank is the first. */
export interface PropDef {
  id: string;
  start: PlankPose;
}

/** Where props start. On the lawn just off the patio, easy to find. */
export const PROPS: readonly PropDef[] = [{ id: 'plank1', start: { x: 17, z: -6, yaw: 0.55 } }];

export interface PropState {
  id: string;
  /** Player ids holding end 0 and end 1. */
  holders: [string | null, string | null];
  /** Where it rests when nobody holds it. */
  pose: PlankPose;
}

/** Wire form: ids or empty string, centimetres, milliradians. */
export interface PropInfo {
  id: string;
  h0: string;
  h1: string;
  x: number;
  z: number;
  yaw: number;
}

export function toInfo(p: PropState): PropInfo {
  return { id: p.id, h0: p.holders[0] ?? '', h1: p.holders[1] ?? '', x: Math.round(p.pose.x * 100), z: Math.round(p.pose.z * 100), yaw: Math.round(p.pose.yaw * 1000) };
}

export function fromInfo(i: PropInfo): PropState {
  return { id: i.id, holders: [i.h0 || null, i.h1 || null], pose: { x: i.x / 100, z: i.z / 100, yaw: i.yaw / 1000 } };
}

/** Pure rules for who holds what. Used by the room, and by the browser when playing alone. */
export class PropsLogic {
  readonly props = new Map<string, PropState>();

  constructor(defs: readonly PropDef[] = PROPS) {
    for (const d of defs) this.props.set(d.id, { id: d.id, holders: [null, null], pose: { ...d.start } });
  }

  static restore(saved: PropState[], defs: readonly PropDef[] = PROPS): PropsLogic {
    const logic = new PropsLogic(defs);
    for (const s of saved) if (logic.props.has(s.id)) logic.props.set(s.id, { id: s.id, holders: [...s.holders], pose: { ...s.pose } });
    return logic;
  }

  save(): PropState[] {
    return [...this.props.values()].map((p) => ({ id: p.id, holders: [...p.holders], pose: { ...p.pose } }));
  }

  /** What this player is holding, if anything. */
  holding(playerId: string): { prop: PropState; end: 0 | 1 } | null {
    for (const p of this.props.values()) {
      if (p.holders[0] === playerId) return { prop: p, end: 0 };
      if (p.holders[1] === playerId) return { prop: p, end: 1 };
    }
    return null;
  }

  /** Hook one end. Fails if the prop is unknown, the end is taken, or the player already holds something. */
  attach(playerId: string, propId: string, end: 0 | 1): PropState | null {
    const p = this.props.get(propId);
    if (!p || p.holders[end] !== null || this.holding(playerId)) return null;
    p.holders[end] = playerId;
    return p;
  }

  /**
   * Let go. If that leaves nobody holding it, it rests at `pose` (where the player saw it).
   * If the other end is still held it stays held and the resting pose is unchanged.
   */
  detach(playerId: string, pose: PlankPose): PropState | null {
    const h = this.holding(playerId);
    if (!h) return null;
    h.prop.holders[h.end] = null;
    if (h.prop.holders[0] === null && h.prop.holders[1] === null) h.prop.pose = { ...pose };
    return h.prop;
  }

  /** A player left. Frees their end; the plank stays where it last rested. */
  release(playerId: string): PropState | null {
    const h = this.holding(playerId);
    if (!h) return null;
    h.prop.holders[h.end] = null;
    return h.prop;
  }
}
