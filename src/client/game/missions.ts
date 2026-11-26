import type { MissionInfo, MissionDef } from '../../shared/mission-logic';
import { starsFor } from '../../shared/mission-logic';
import { goalById, reached } from '../../shared/goals';
import { missionById } from '../../shared/missions';
import type { MissionNotice } from '../../shared/net/protocol';
import type { GameAudio } from '../audio/game-audio';
import type { RoomClient } from '../net/room-client';
import type { Vehicle } from '../physics/vehicle';

export interface MissionDeps {
  net: () => RoomClient;
  selfId: () => string;
  vehicle: () => Vehicle;
  /** For each `flag` objective id, a function that says whether the game sees it met right now. */
  flags: Record<string, () => boolean>;
  /** Fireworks and fanfare at a goal. */
  celebrate: (goalId: string, who: string) => void;
  toast: (title: string, sub?: string, ms?: number) => void;
  nameOf: (id: string) => string;
  audio: GameAudio;
}

/** What the HUD draws. */
export interface MissionView {
  def: MissionDef;
  status: 'running' | 'complete';
  elapsedMs: number;
  resets: number;
  stages: Array<{
    title: string;
    state: 'done' | 'current' | 'todo';
    objectives: Array<{ text: string; done: boolean; have: number }>;
  }>;
  /** Present once complete. */
  result: { stars: number; time: boolean; clean: boolean; parSeconds: number } | null;
}

/** How often an unconfirmed report is sent again, in ms (a report can be lost if the link drops). */
const RESEND_MS = 3000;

/**
 * The mission in play, from one player's seat. The room keeps the books; this watches the game for
 * the objectives of the current stage and reports them when they are met, and keeps the HUD and the
 * toasts in step with what the room says.
 */
export class MissionController {
  info: MissionInfo | null = null;
  private rxAt = 0;
  private readonly sentAt = new Map<string, number>();
  private stageKey = '';
  /** When the "completed" card was shown, so it can go away by itself. */
  completedAt = 0;

  constructor(private readonly d: MissionDeps) {}

  get running(): boolean {
    return this.info?.status === 'running';
  }

  get def(): MissionDef | undefined {
    return this.info ? missionById(this.info.id) : undefined;
  }

  /** Called when the room hands us the mission as we join. */
  onWelcome(info: MissionInfo | null | undefined, now: number): void {
    this.info = info ?? null;
    this.rxAt = now;
    this.sentAt.clear();
    this.stageKey = this.keyOf(this.info);
  }

  private keyOf(info: MissionInfo | null): string {
    return info ? `${info.id}:${info.stage}:${info.status}` : '';
  }

  /** Called for every mission message from the room. */
  onMessage(info: MissionInfo | null, event: MissionNotice | undefined, by: string | undefined, reason: string | undefined, now: number): void {
    const who = by ? (by === this.d.selfId() ? 'You' : this.d.nameOf(by)) : 'Someone';
    if (event === 'refused') {
      this.d.toast('Cannot start that', reason ?? '', 4200);
      return; // the room only told us; our own view is unchanged
    }
    this.info = info;
    this.rxAt = now;
    const key = this.keyOf(info);
    if (key !== this.stageKey) this.sentAt.clear();
    this.stageKey = key;
    const def = info ? missionById(info.id) : undefined;
    if (event === 'start' && def) this.d.toast(`Mission: ${def.name}`, `${who} started it. ${def.stages[0]?.title ?? ''}`, 4500);
    else if (event === 'stage' && def && info) {
      this.d.audio.ping('go', 0.8, 0);
      const next = def.stages[info.stage];
      this.d.toast('Stage complete', next ? `Next: ${next.title}` : '', 3500);
    } else if (event === 'complete' && def && info) {
      this.completedAt = now;
      if (def.celebrate) this.d.celebrate(def.celebrate, `${who} finished it`);
    } else if (event === 'abort') this.d.toast('Mission ended', `${who} ended it.`, 3500);
  }

  start(id: string): void {
    this.d.net().sendMission('start', id);
  }

  abort(): void {
    this.d.net().sendMission('abort');
  }

  /** A car was reset (the R key): it costs the "no resets" star. */
  reportReset(): void {
    if (this.running) this.d.net().sendMission('reset');
  }

  /** Call every frame: report whatever objectives of the current stage the game sees met. */
  update(now: number): void {
    const info = this.info;
    const def = this.def;
    if (!info || !def || info.status !== 'running') return;
    const stage = def.stages[info.stage];
    if (!stage) return;
    for (const obj of stage.objectives) {
      if (info.done.includes(obj.id)) continue;
      const last = this.sentAt.get(obj.id);
      if (last !== undefined && now - last < RESEND_MS) continue;
      let met = false;
      if (obj.kind === 'flag') met = this.d.flags[obj.id]?.() ?? false;
      else {
        const goal = goalById(obj.goal);
        const t = this.d.vehicle().body.translation();
        met = !!goal && reached(goal, t.x, t.y, t.z);
      }
      if (!met) continue;
      this.sentAt.set(obj.id, now);
      this.d.net().sendMission(obj.kind, obj.id);
    }
  }

  /** The seconds shown on the clock: what the room last said plus the time since. */
  elapsedMs(now: number): number {
    if (!this.info) return 0;
    return this.info.elapsedMs + (this.info.status === 'running' ? Math.max(0, now - this.rxAt) : 0);
  }

  view(now: number): MissionView | null {
    const info = this.info;
    const def = this.def;
    if (!info || !def) return null;
    const elapsed = this.elapsedMs(now);
    const stages: MissionView['stages'] = def.stages.map((st, i) => {
      const state: 'done' | 'current' | 'todo' = info.status === 'complete' || i < info.stage ? 'done' : i === info.stage ? 'current' : 'todo';
      return {
        title: st.title,
        state,
        objectives: st.objectives.map((o) => ({
          text: o.text,
          done: state === 'done' || (state === 'current' && info.done.includes(o.id)),
          have: state === 'current' ? info.counts[o.id] ?? 0 : 0,
        })),
      };
    });
    let result: MissionView['result'] = null;
    if (info.status === 'complete') {
      const s = starsFor(def, info.elapsedMs, info.resets);
      result = { stars: s.count, time: s.time, clean: s.clean, parSeconds: def.parSeconds };
    }
    return { def, status: info.status, elapsedMs: elapsed, resets: info.resets, stages, result };
  }
}
