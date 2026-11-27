import * as THREE from 'three';
import type { BatteryView } from '../../shared/battery';
import { CARS, type CarRole } from '../../shared/cars';
import { WINCH_RANGE, cableSnapped, chooseTarget, pullToward, reelDone, type Hookable } from '../../shared/winch';
import type { Placed } from '../../shared/toolbox';
import type { RemoteCar } from '../net/remote-car';
import type { RoomClient } from '../net/room-client';
import type { Vehicle } from '../physics/vehicle';
import type { GameAudio } from '../audio/game-audio';
import { WinchCable } from '../render/winch-cable';

export interface WinchDeps {
  scene: THREE.Scene;
  net: () => RoomClient;
  selfId: () => string;
  role: () => CarRole;
  vehicle: () => Vehicle;
  remotes: () => Map<string, RemoteCar>;
  stakes: () => readonly Placed[];
  battery: () => BatteryView;
  audio: GameAudio;
  toast: (title: string, sub?: string, ms?: number) => void;
  nameOf: (id: string) => string;
}

interface Active {
  by: string;
  target: string;
  cable: WinchCable;
}

/**
 * The Hauler's winch on this player's screen. Z hooks the nearest car or stake in reach and starts
 * reeling (it spends the team battery); Z again lets go. A hooked car is pulled toward the Hauler by
 * its own driver's browser, and a stake pulls the Hauler toward it. Reeling stops by itself when the
 * two are close, when the cable is stretched too far, or when the battery runs dry.
 */
export class WinchController {
  private readonly active = new Map<string, Active>();
  /** Words for the bottom of the screen, or null. */
  prompt: string | null = null;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(private readonly d: WinchDeps) {}

  private online(): boolean {
    return this.d.net().status === 'on';
  }

  /** Whether `id` is a stake we know of. */
  private stake(id: string): Placed | undefined {
    return this.d.stakes().find((s) => s.id === id && s.kind === 'stake');
  }

  /** Where a player, or a stake, is right now (drawn position for others). */
  private where(id: string): { x: number; y: number; z: number } | null {
    if (id === this.d.selfId()) {
      const t = this.d.vehicle().body.translation();
      return { x: t.x, y: t.y, z: t.z };
    }
    const r = this.d.remotes().get(id);
    if (r && r.visible) return { x: r.position.x, y: r.position.y, z: r.position.z };
    const s = this.stake(id);
    return s ? { x: s.x, y: 0.5, z: s.z } : null;
  }

  /** Is this player's winch running, and on what. */
  hookedBy(id: string): string | null {
    return this.active.get(id)?.target ?? null;
  }

  /** True when our own winch is hooked to a car. For the mission. */
  get ownHookedCar(): boolean {
    const t = this.hookedBy(this.d.selfId());
    return !!t && t.startsWith('p');
  }

  /** True when our own winch is running at all (a car or a stake). */
  get ownRunning(): boolean {
    return this.active.has(this.d.selfId());
  }

  /** Is a winch pulling our car right now. */
  get pullingMe(): boolean {
    const me = this.d.selfId();
    for (const a of this.active.values()) {
      if (a.target === me) return true;
      if (a.by === me && a.target.startsWith('o')) return true;
    }
    return false;
  }

  /** The room told us a winch started or stopped. */
  onMessage(by: string, on: boolean, target: string | undefined, reason: string | undefined): void {
    if (!on && reason) {
      if (by === this.d.selfId()) this.d.toast('Cannot winch', reason, 2600);
      return;
    }
    const had = this.active.get(by);
    if (had) {
      had.cable.dispose();
      this.active.delete(by);
    }
    if (on && target) {
      this.active.set(by, { by, target, cable: new WinchCable(this.d.scene) });
      this.d.audio.hook();
      if (by !== this.d.selfId() && target === this.d.selfId()) this.d.toast(`${this.d.nameOf(by)} hooked a winch to you`, 'It is pulling you toward them', 2600);
    } else if (!on && had) this.d.audio.hook();
  }

  /** Left the room or the page reset: drop every cable. */
  clear(): void {
    for (const a of this.active.values()) a.cable.dispose();
    this.active.clear();
  }

  /** The Z key. */
  toggle(): void {
    const me = this.d.selfId();
    if (this.d.role() !== 'hauler') {
      this.d.toast('Only the Hauler has a winch', 'Press 2 for the Hauler.', 2400);
      return;
    }
    if (this.active.has(me)) {
      this.stop();
      return;
    }
    const t = this.target();
    if (!t) {
      this.d.toast('Nothing in reach', `Drive within ${WINCH_RANGE} m of a teammate or a stake.`, 2400);
      return;
    }
    if (this.online()) this.d.net().sendWinch({ op: 'start', target: t.id });
    else {
      // Alone, only a stake can be hooked, and there is no team battery to spend.
      if (t.kind !== 'stake') return;
      this.onMessage(me, true, t.id, undefined);
    }
  }

  private stop(): void {
    const me = this.d.selfId();
    if (this.online()) this.d.net().sendWinch({ op: 'stop' });
    else this.onMessage(me, false, undefined, undefined);
  }

  private target(): ReturnType<typeof chooseTarget> {
    const me = this.where(this.d.selfId());
    if (!me) return null;
    const cars: Hookable[] = [];
    for (const [id, r] of this.d.remotes()) if (r.visible) cars.push({ id, x: r.position.x, z: r.position.z });
    const stakes: Hookable[] = this.d.stakes().filter((s) => s.kind === 'stake').map((s) => ({ id: s.id, x: s.x, z: s.z }));
    return chooseTarget(me, cars, stakes);
  }

  /** The acceleration to apply to our own car this step (m/s^2). Zero unless a winch is pulling it. */
  pull(now: number): { x: number; z: number } {
    const me = this.d.selfId();
    const b = this.d.battery();
    const bat = this.online() && b.known ? b.at(now) : null;
    const dry = !!bat && (bat.locked || bat.level <= 0);
    if (dry) return { x: 0, z: 0 };
    const mine = this.where(me);
    if (!mine) return { x: 0, z: 0 };
    for (const a of this.active.values()) {
      const hauler = this.where(a.by);
      const tgt = this.where(a.target);
      if (!hauler || !tgt) continue;
      if (a.target === me) return pullToward(mine, hauler); // a car is pulled toward its Hauler
      if (a.by === me && a.target.startsWith('o')) return pullToward(mine, tgt); // the Hauler pulls itself to a stake
    }
    return { x: 0, z: 0 };
  }

  /** Once per frame: cables, the Hauler's own stop conditions, and the prompt. */
  update(now: number): void {
    const me = this.d.selfId();
    const b = this.d.battery();
    const bat = this.online() && b.known ? b.at(now) : null;
    const dry = !!bat && (bat.locked || bat.level <= 0);
    for (const a of [...this.active.values()]) {
      const hauler = this.where(a.by);
      const tgt = this.where(a.target);
      if (!hauler || !tgt) {
        // The other end is gone from our view. Only the Hauler lets go, so the room hears it once.
        if (a.by === me) this.stop();
        else this.drop(a);
        continue;
      }
      const role = CARS.hauler.half.z;
      const rc = this.d.remotes().get(a.by);
      const yaw = a.by === me ? this.yawOf(this.d.vehicle()) : rc ? rc.yaw : 0;
      this.tmpA.set(hauler.x + Math.sin(yaw) * role, hauler.y + 0.35, hauler.z + Math.cos(yaw) * role);
      this.tmpB.set(tgt.x, tgt.y + (a.target.startsWith('o') ? 0.7 : 0.3), tgt.z);
      a.cable.set(this.tmpA, this.tmpB, !dry);
      if (a.by === me) {
        if (reelDone(hauler, tgt)) {
          this.d.toast('Winch done', 'Close enough: it lets go.', 1800);
          this.stop();
        } else if (cableSnapped(hauler, tgt)) {
          this.d.toast('The cable let go', 'Too far apart.', 2000);
          this.stop();
        } else if (dry) {
          this.d.toast('Battery empty', 'The winch stops. A Relay can top it up (B).', 2600);
          this.stop();
        }
      }
    }
    this.prompt = this.makePrompt(now);
  }

  private drop(a: Active): void {
    a.cable.dispose();
    this.active.delete(a.by);
  }

  private yawOf(v: Vehicle): number {
    const q = v.body.rotation();
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  }

  private makePrompt(_now: number): string | null {
    if (this.d.role() !== 'hauler') return null;
    if (this.active.has(this.d.selfId())) return 'Z: let go of the winch';
    const t = this.target();
    if (!t) return null;
    const label = t.kind === 'stake' ? 'the stake' : this.d.nameOf(t.id);
    return `Z: winch ${label} (${Math.round(t.distance)} m)`;
  }
}
