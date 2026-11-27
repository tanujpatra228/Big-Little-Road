import { ZONES } from './terrain';
import type { CarRole } from './cars';

/**
 * The mud trap. The middle of the bog is deep: a car that lingers there sinks, and a sunk car is
 * stuck. Stuck is a state, not emergent physics: the wheels spin, the car creeps, and it stays put
 * until it digs itself out slowly, a winch pulls it free, or it is hauled out of the deep part.
 * Pure and deterministic so it can be tested without a browser; each browser runs it for its own car.
 */

/** The deep part of the bog: the middle of the mud zone. */
export const DEEP_MUD = { x: ZONES.mud.x, z: ZONES.mud.z, r: 8 } as const;

/** Seconds in deep mud before a car is stuck. The Hauler's wide tyres hold on twice as long. */
export const SINK_SECONDS: Readonly<Record<CarRole, number>> = { scout: 2.2, hauler: 4.4, relay: 3 };
/** Seconds of holding the throttle to dig out alone, so a stuck car is never stuck for good. */
export const DIG_SECONDS: Readonly<Record<CarRole, number>> = { scout: 14, hauler: 8, relay: 12 };
/** A winch's pull digs this many times faster than the throttle. */
export const WINCH_DIG_RATE = 5;
/** How strong the drive is while stuck (a fraction of normal). */
export const STUCK_DRIVE = 0.12;
/** Seconds after freeing during which a car does not sink again, so it can drive off. */
export const FREED_GRACE = 6;

export function inDeepMud(x: number, z: number): boolean {
  return Math.hypot(x - DEEP_MUD.x, z - DEEP_MUD.z) < DEEP_MUD.r;
}

export interface MudInput {
  /** The car is over the deep mud. */
  inMud: boolean;
  /** 0 to 1: how hard the throttle is held (reversing counts too). */
  throttle: number;
  /** A winch is pulling this car right now. */
  winched: boolean;
  role: CarRole;
}

export type MudEvent = 'stuck' | 'freed' | null;

export class MudState {
  /** 0 clear to 1 stuck: how far the car has sunk. */
  sink = 0;
  stuck = false;
  /** 0 to 1: progress toward digging out. */
  dig = 0;
  /** True when the last free came from a winch, for the mission to see. */
  freedByWinch = false;
  private grace = 0;
  private wasWinched = false;

  /** The drive strength this car gets: normal, easing off as it sinks, nearly nothing when stuck. */
  get drive(): number {
    return this.stuck ? STUCK_DRIVE : 1 - 0.35 * this.sink;
  }

  /** Advance by `dt` seconds. Returns an event on the step the car gets stuck or is freed. */
  update(dt: number, i: MudInput): MudEvent {
    this.grace = Math.max(0, this.grace - dt);
    if (this.stuck) {
      if (i.winched) this.wasWinched = true;
      if (!i.inMud) return this.free(this.wasWinched); // hauled clear of the deep part
      const push = Math.min(1, Math.abs(i.throttle)) > 0.3 ? 1 : 0;
      this.dig += ((push + (i.winched ? WINCH_DIG_RATE : 0)) * dt) / DIG_SECONDS[i.role];
      if (this.dig >= 1) return this.free(this.wasWinched);
      return null;
    }
    if (i.inMud && this.grace === 0) {
      this.sink = Math.min(1, this.sink + dt / SINK_SECONDS[i.role]);
      if (this.sink >= 1) {
        this.stuck = true;
        this.dig = 0;
        this.wasWinched = false;
        this.freedByWinch = false;
        return 'stuck';
      }
    } else {
      this.sink = Math.max(0, this.sink - (dt / SINK_SECONDS[i.role]) * 2);
    }
    return null;
  }

  private free(byWinch: boolean): MudEvent {
    this.stuck = false;
    this.dig = 0;
    this.sink = 0.3;
    this.grace = FREED_GRACE;
    this.freedByWinch = byWinch;
    this.wasWinched = false;
    return 'freed';
  }

  reset(): void {
    this.sink = 0;
    this.stuck = false;
    this.dig = 0;
    this.grace = 0;
    this.freedByWinch = false;
    this.wasWinched = false;
  }
}
