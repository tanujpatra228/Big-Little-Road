/**
 * Rescue, not reset: a flipped car is helped over by a teammate who drives up to it. Pushing a car
 * back onto its wheels with physics alone works only by luck (a simulation of every car pair,
 * side and end hits at 4 and 8 m/s righted the flipped car in 5 of 36 tries, and mostly just slid it
 * across the grass on its roof), so being rescued is a rule: stay flipped with a teammate close by
 * for a moment and the car rolls itself back over. Alone, the old rule still applies: reset after 10 s.
 *
 * Pure, so it is tested without a browser.
 */

/** A teammate within this distance (metres, centre to centre) counts as helping. */
export const RESCUE_RANGE = 3.6;
/** They must stay that close for this long (seconds). */
export const RESCUE_SECONDS = 1.0;
/** Fastest roll while righting, radians per second. */
export const ROLL_RATE_MAX = 5.5;
/** Rolling gives up after this long even if it did not work (seconds). */
export const ROLL_TIMEOUT = 2.5;
/** The car counts as righted once its up vector points this far upward (1 is straight up). */
export const RIGHTED_AT = 0.85;

export type RescueEvent = 'idle' | 'rescuing' | 'roll';

/** Tracks how long a teammate has been close to a flipped car. */
export class RescueProgress {
  /** 0 to 1. */
  progress = 0;

  /**
   * Call every frame. `flipped` is whether the car has been stuck on its roof long enough to count;
   * `teammateDistance` is how far the nearest teammate is, or null if there is none.
   * Returns 'roll' once, on the frame the car should start rolling over.
   */
  update(dt: number, flipped: boolean, teammateDistance: number | null): RescueEvent {
    const near = flipped && teammateDistance !== null && teammateDistance <= RESCUE_RANGE;
    if (!flipped) {
      this.progress = 0;
      return 'idle';
    }
    if (near) {
      this.progress = Math.min(1, this.progress + dt / RESCUE_SECONDS);
      if (this.progress >= 1) {
        this.progress = 0;
        return 'roll';
      }
      return 'rescuing';
    }
    // The helper drove off: the progress drains twice as fast as it filled.
    this.progress = Math.max(0, this.progress - (2 * dt) / RESCUE_SECONDS);
    return 'idle';
  }

  reset(): void {
    this.progress = 0;
  }
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The angular velocity about the car's own nose axis that brings it upright: proportional to how far
 * over it is, never faster than ROLL_RATE_MAX, and gentle at the end so it settles instead of
 * rocking. `up` and `forward` are the chassis axes in world space. When the car is exactly upside
 * down there is no better way round, so `prefer` (+1 or -1) picks one: a shove from one side rolls it
 * to the other.
 */
export function rollRate(up: V3, forward: V3, prefer: 1 | -1 = 1): number {
  // The signed angle about `forward` that takes the chassis up vector to world up.
  const sin = -up.z * forward.x + up.x * forward.z; // (up x worldUp) . forward, with worldUp = (0, 1, 0)
  const cos = up.y;
  let angle = Math.atan2(sin, cos);
  if (Math.abs(angle) > 2.85) angle = prefer * Math.PI;
  return Math.max(-ROLL_RATE_MAX, Math.min(ROLL_RATE_MAX, angle * 4));
}
