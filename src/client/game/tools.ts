import type { RoomClient } from '../net/room-client';
import type { Vehicle } from '../physics/vehicle';
import type { ToolNotice } from '../../shared/net/protocol';
import { ITEMS, PICKUP_RANGE, dropItem, dropSpot, fromWire, nearestPlaced, newTools, pickUp, toWire, REFUSALS, type ItemKind, type Placed, type Tools, type ToolsInfo } from '../../shared/toolbox';
import type { GameAudio } from '../audio/game-audio';

export interface ToolsDeps {
  net: () => RoomClient;
  selfId: () => string;
  vehicle: () => Vehicle;
  toast: (title: string, sub?: string, ms?: number) => void;
  nameOf: (id: string) => string;
  audio: GameAudio;
  /** Called whenever the placed items or slots change, so the scene can redraw. */
  onChange: () => void;
}

/**
 * The crew toolbox on this player's side. In a room the room is the authority: a key press asks, and
 * the room's answer (to everyone) is what changes anything. Alone, the same pure rules run locally.
 */
export class ToolsController {
  tools: Tools = newTools();
  selected = 0;

  constructor(private readonly d: ToolsDeps) {}

  private get online(): boolean {
    return this.d.net().status === 'on';
  }

  /** The room handed us its state (welcome) or changed it. */
  receive(info: ToolsInfo | undefined, event?: ToolNotice, by?: string, kind?: string, reason?: string): void {
    if (event === 'refused') {
      this.d.toast('Cannot do that', reason ?? '', 2600);
      return;
    }
    this.tools = fromWire(info);
    this.d.onChange();
    const who = by === this.d.selfId() ? 'You' : by ? this.d.nameOf(by) : 'Someone';
    const label = ITEMS[kind as ItemKind]?.label ?? 'something';
    if (event === 'drop') this.d.audio.ping('wait', by === this.d.selfId() ? 0.6 : 0.35, 0);
    else if (event === 'pickup') this.d.audio.ping('look', by === this.d.selfId() ? 0.6 : 0.35, 0);
    else if (event === 'reset') this.d.toast('Toolbox refilled', 'A fresh box and an empty yard.', 2200);
    if ((event === 'drop' || event === 'pickup') && by !== this.d.selfId()) this.d.toast(`${who} ${event === 'drop' ? 'put down' : 'picked up'} a ${label.toLowerCase()}`, '', 1800);
  }

  /** Left the room: back to a private box. */
  reset(): void {
    this.tools = newTools();
    this.selected = 0;
    this.d.onChange();
  }

  select(slot: number): void {
    if (slot >= 0 && slot < this.tools.slots.length) this.selected = slot;
  }

  private car(): { x: number; z: number; yaw: number } {
    const v = this.d.vehicle();
    const t = v.body.translation();
    const q = v.body.rotation();
    return { x: t.x, z: t.z, yaw: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) };
  }

  /** E: put the selected item down in front of the car. */
  drop(): void {
    const c = this.car();
    const at = dropSpot(c.x, c.z, c.yaw);
    if (this.online) {
      this.d.net().sendTool({ op: 'drop', slot: this.selected, x: at.x, z: at.z, yaw: at.yaw });
      return;
    }
    const r = dropItem(this.tools, this.selected, at, this.d.selfId());
    if ('error' in r) {
      this.d.toast('Cannot do that', REFUSALS[r.error], 2200);
      return;
    }
    this.receive(toWire(r.tools), 'drop', this.d.selfId(), r.placed.kind);
  }

  /** X: pick up the nearest placed item within reach. */
  pickUp(): void {
    const c = this.car();
    const item = nearestPlaced(this.tools, c.x, c.z, PICKUP_RANGE);
    if (!item) {
      this.d.toast('Nothing to pick up', 'Drive up close to something you placed.', 2000);
      return;
    }
    if (this.online) {
      this.d.net().sendTool({ op: 'pickup', id: item.id });
      return;
    }
    const r = pickUp(this.tools, item.id);
    if ('error' in r) {
      this.d.toast('Cannot do that', REFUSALS[r.error], 2200);
      return;
    }
    this.receive(toWire(r.tools), 'pickup', this.d.selfId(), r.kind);
  }

  /** Words for the prompt when a placed item is close enough to pick up, otherwise null. */
  prompt(): string | null {
    const c = this.car();
    const item = nearestPlaced(this.tools, c.x, c.z, PICKUP_RANGE);
    return item ? `X: pick up the ${ITEMS[item.kind].label.toLowerCase()}` : null;
  }

  get placed(): readonly Placed[] {
    return this.tools.placed;
  }
}
