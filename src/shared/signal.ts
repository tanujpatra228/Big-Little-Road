/**
 * The signal web, pure so it can be tested without a browser. The cars are remote controlled, so each
 * one needs a radio link back to the base station on the patio. Range is limited, and only a Relay
 * (the truck with the mast) can extend it, in a chain: base to Relay to Relay to car.
 *
 * A car's signal strength is 1 right next to a source and falls to 0 at the edge of its range. Strong
 * signal drives normally. Weak signal delays your steering and throttle. No signal cuts the throttle:
 * the car brakes to a stop, and only reversing works, so you can always back out.
 *
 * Everything is worked out locally from positions that are already shared, so there is no network
 * cost and no new message.
 */
import { SPAWN } from './terrain';
import type { DriveInput } from './driving';

export interface Pt {
  x: number;
  z: number;
}

export interface RelayNode extends Pt {
  id: string;
  /** How far this source reaches. A Relay truck by default; a placed beacon reaches less. */
  range?: number;
}

/** The base station: the patio where everyone starts. */
export const BASE: Readonly<Pt> = { x: SPAWN.x, z: SPAWN.z };
/** How far the base reaches, metres. */
export const BASE_RANGE = 48;
/** How far a placed beacon reaches. A cheap stand-in for a Relay: it cannot move, and it reaches less. */
export const BEACON_RANGE = 30;
/** How far a Relay reaches. Smaller than the base: it is a truck with a mast, not a tower. */
export const RELAY_RANGE = 38;
/** At or above this strength there is no lag at all. */
export const CLEAN_ABOVE = 0.5;
/** Input delay at the very edge of the range, seconds. */
export const MAX_LAG = 0.6;
/** Once cut off, a car needs this much strength back before the throttle returns (stops flickering at the edge). */
export const RECOVER_AT = 0.04;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

/** 1 at the source, 0 at `range` or beyond. */
export function strength(distance: number, range: number): number {
  return clamp01(1 - distance / range);
}

/**
 * Which Relays are connected to the base, straight or through other Relays. A Relay far from every
 * other source is not linked, and gives nobody any signal.
 */
export function linkedRelays(relays: readonly RelayNode[], base: Pt = BASE): RelayNode[] {
  const linked: RelayNode[] = [];
  const pending = [...relays];
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i]!;
      const viaBase = dist(r, base) < BASE_RANGE;
      const viaRelay = linked.some((l) => dist(r, l) < (l.range ?? RELAY_RANGE));
      if (viaBase || viaRelay) {
        linked.push(r);
        pending.splice(i, 1);
        grew = true;
      }
    }
  }
  return linked;
}

/**
 * The signal strength at a point: the best of the base and every linked Relay. Pass `selfId` when the
 * point is itself a Relay, so it cannot be its own source or be linked through something that is only
 * linked through it.
 */
export function signalAt(p: Pt, relays: readonly RelayNode[], selfId: string | null = null, base: Pt = BASE): number {
  const others = selfId === null ? relays : relays.filter((r) => r.id !== selfId);
  let best = strength(dist(p, base), BASE_RANGE);
  for (const r of linkedRelays(others, base)) best = Math.max(best, strength(dist(p, r), r.range ?? RELAY_RANGE));
  return best;
}

/** Seconds of delay on steering and throttle for a given strength: none when strong, growing fast toward the edge. */
export function lagFor(s: number): number {
  if (s >= CLEAN_ABOVE) return 0;
  if (s <= 0) return MAX_LAG;
  const k = 1 - s / CLEAN_ABOVE;
  return MAX_LAG * k * k;
}

export type LinkQuality = 'good' | 'weak' | 'lost';

/** What the HUD calls it. */
export function qualityOf(s: number, cutOff: boolean): LinkQuality {
  if (cutOff) return 'lost';
  return s >= CLEAN_ABOVE ? 'good' : 'weak';
}

/**
 * Tracks whether the car is cut off, with a little hysteresis: it trips at zero strength and does
 * not let go until there is a bit of margin, so a car creeping along the edge does not stutter.
 */
export class SignalLink {
  private cut = false;

  get cutOff(): boolean {
    return this.cut;
  }

  /** Feed the current strength. Returns whether the car is cut off now. */
  update(s: number): boolean {
    if (this.cut) {
      if (s >= RECOVER_AT) this.cut = false;
    } else if (s <= 0) {
      this.cut = true;
    }
    return this.cut;
  }

  reset(): void {
    this.cut = false;
  }
}

/**
 * What the driver can do with no signal: the throttle is cut and the car brakes to a stop, but steering
 * and reversing still work, so there is always a way back in. Nitro is off.
 */
export function failsafeInput(input: DriveInput, forwardSpeed: number): DriveInput {
  const throttle = forwardSpeed > 0.6 ? -1 : Math.min(0, input.throttle);
  return { ...input, throttle, nitro: false };
}

/**
 * Replays inputs a little late, to make a weak signal feel like one. The time it reads from never
 * goes backward, even if the delay shrinks quickly, so a recovering signal speeds the inputs up
 * rather than replaying old ones twice.
 */
export class InputDelay<T> {
  private buf: Array<{ t: number; v: T }> = [];
  private readT = -Infinity;

  /** Record what the player is holding at time `t` (seconds, any steady clock). */
  push(t: number, v: T): void {
    this.buf.push({ t, v });
  }

  /** What the player was holding `lag` seconds before `now`. Undefined until anything was recorded. */
  at(now: number, lag: number): T | undefined {
    if (this.buf.length === 0) return undefined;
    this.readT = Math.max(this.readT, now - lag);
    // Anything older than the next sample is no longer needed.
    while (this.buf.length > 1 && this.buf[1]!.t <= this.readT) this.buf.shift();
    return this.buf[0]!.v;
  }

  reset(): void {
    this.buf = [];
    this.readT = -Infinity;
  }
}
