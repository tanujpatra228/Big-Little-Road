/**
 * The mission runtime, pure so it is tested without sockets or a browser. A mission is data: a list of
 * stages, each with objectives. A stage is done when all its objectives are, and the mission is done
 * when its last stage is. The same code runs in the room (so every player sees one truth) and in the
 * browser when playing alone.
 *
 * Objectives are one of two kinds, and the game decides when they are met:
 *  - `reach`: a car got to an area (any car, every car, or a car of a given role).
 *  - `flag`: something the game noticed (for example "both ends of the plank are hooked").
 * Players report what they see; the runtime keeps the books, from whatever clock it is given.
 */
import type { CarRole } from './cars';
import type { RoomRules } from './net/protocol';

export type Objective =
  | { id: string; kind: 'reach'; text: string; /** An id from goals.ts: where to go. */ goal: string; who: 'any' | 'all'; role?: CarRole }
  | { id: string; kind: 'flag'; text: string };

export interface Stage {
  id: string;
  title: string;
  objectives: Objective[];
}

export interface MissionDef {
  id: string;
  name: string;
  blurb: string;
  /** In a room, the mission cannot start with fewer players than this. */
  minPlayers: number;
  /** Rules the mission needs while it runs (restored afterwards), for example radio range. */
  rules?: Partial<RoomRules>;
  /** Finish within this many seconds for the time star. */
  parSeconds: number;
  /** A goal id from goals.ts whose fireworks play when the mission is done. */
  celebrate?: string;
  stages: Stage[];
}

export type MissionStatus = 'running' | 'complete';

export interface MissionState {
  id: string;
  status: MissionStatus;
  /** Index of the stage being worked on. Equals the stage count once complete. */
  stage: number;
  /** For each objective in the current stage: who has met it (a flag lists whoever reported it). */
  progress: Record<string, string[]>;
  /** Clock time (ms) it started and finished. */
  startedAt: number;
  finishedAt: number | null;
  /** Times a player had to reset a car (the "no resets" star). */
  resets: number;
  startedBy: string;
  /** The room rules before the mission changed them, to put back afterwards. */
  rulesBefore: RoomRules | null;
}

/** What goes over the wire. Time is sent as elapsed milliseconds, so no clocks have to agree. */
export interface MissionInfo {
  id: string;
  status: MissionStatus;
  stage: number;
  /** Objective ids already met in the current stage. */
  done: string[];
  /** How many players have reported each objective of the current stage (for "1 of 2"). */
  counts: Record<string, number>;
  elapsedMs: number;
  resets: number;
  /** 0 while running; 1 to 3 once complete. */
  stars: number;
}

export type MissionEvent = 'stage' | 'complete';

export interface Stars {
  /** Always true once finished. */
  complete: boolean;
  /** Finished within the par time. */
  time: boolean;
  /** Finished without a single reset. */
  clean: boolean;
  count: number;
}

export function starsFor(def: MissionDef, elapsedMs: number, resets: number): Stars {
  const time = elapsedMs <= def.parSeconds * 1000;
  const clean = resets === 0;
  return { complete: true, time, clean, count: 1 + (time ? 1 : 0) + (clean ? 1 : 0) };
}

export function startMission(def: MissionDef, now: number, by: string, rulesBefore: RoomRules | null = null): MissionState {
  return { id: def.id, status: 'running', stage: 0, progress: {}, startedAt: now, finishedAt: null, resets: 0, startedBy: by, rulesBefore };
}

export function elapsedMs(state: MissionState, now: number): number {
  return Math.max(0, (state.finishedAt ?? now) - state.startedAt);
}

/** True when an objective is met, given who is in the room. */
export function objectiveDone(obj: Objective, state: MissionState, players: readonly string[]): boolean {
  const who = state.progress[obj.id] ?? [];
  if (obj.kind === 'flag') return who.length > 0;
  if (obj.who === 'any') return who.length > 0;
  return players.length > 0 && players.every((p) => who.includes(p));
}

interface Outcome {
  state: MissionState;
  /** False when nothing changed (a stale, duplicate or invalid report). */
  changed: boolean;
  events: MissionEvent[];
}

const unchanged = (state: MissionState): Outcome => ({ state, changed: false, events: [] });

/** Moves to the next stage, or finishes, whenever the current stage's objectives are all met. */
function settle(def: MissionDef, state: MissionState, players: readonly string[], now: number): Outcome {
  let s = state;
  const events: MissionEvent[] = [];
  while (s.status === 'running') {
    const stage = def.stages[s.stage];
    if (!stage || !stage.objectives.every((o) => objectiveDone(o, s, players))) break;
    if (s.stage + 1 >= def.stages.length) {
      s = { ...s, status: 'complete', stage: def.stages.length, progress: {}, finishedAt: now };
      events.push('complete');
    } else {
      s = { ...s, stage: s.stage + 1, progress: {} };
      events.push('stage');
    }
  }
  return { state: s, changed: events.length > 0, events };
}

/**
 * A player says they met an objective. Ignored unless the mission is running, the objective is in the
 * current stage, it is of the kind reported, and (for a role-restricted reach) the player is that role.
 */
export function report(
  def: MissionDef,
  state: MissionState,
  player: string,
  objId: string,
  kind: 'reach' | 'flag',
  players: readonly string[],
  now: number,
  role?: CarRole,
): Outcome {
  if (state.status !== 'running') return unchanged(state);
  const obj = def.stages[state.stage]?.objectives.find((o) => o.id === objId);
  if (!obj || obj.kind !== kind) return unchanged(state);
  if (obj.kind === 'reach' && obj.role && role !== obj.role) return unchanged(state);
  const who = state.progress[objId] ?? [];
  if (who.includes(player)) return unchanged(state);
  const next: MissionState = { ...state, progress: { ...state.progress, [objId]: [...who, player] } };
  const settled = settle(def, next, players, now);
  return { state: settled.state, changed: true, events: settled.events };
}

/** A player left: an objective that needed everyone may now be met by those who remain. */
export function playerLeft(def: MissionDef, state: MissionState, player: string, playersAfter: readonly string[], now: number): Outcome {
  if (state.status !== 'running') return unchanged(state);
  const progress: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(state.progress)) progress[k] = v.filter((p) => p !== player);
  const cleaned: MissionState = { ...state, progress };
  const settled = settle(def, cleaned, playersAfter, now);
  return { state: settled.state, changed: true, events: settled.events };
}

/** Someone had to reset a car. Counts against the "no resets" star while the mission runs. */
export function addReset(state: MissionState): MissionState {
  return state.status === 'running' ? { ...state, resets: state.resets + 1 } : state;
}

export function toInfo(def: MissionDef, state: MissionState, now: number, players: readonly string[] = []): MissionInfo {
  const elapsed = elapsedMs(state, now);
  const stage = def.stages[state.stage];
  const live = state.status === 'running' && stage;
  const done = live ? stage.objectives.filter((o) => objectiveDone(o, state, players)).map((o) => o.id) : [];
  const counts: Record<string, number> = {};
  if (live) for (const o of stage.objectives) counts[o.id] = (state.progress[o.id] ?? []).length;
  return { id: state.id, status: state.status, stage: state.stage, done, counts, elapsedMs: elapsed, resets: state.resets, stars: state.status === 'complete' ? starsFor(def, elapsed, state.resets).count : 0 };
}
