/**
 * The Hauler's winch, the pure part. The Hauler hooks the nearest thing in reach (a teammate's car or
 * a stake it, or someone, put in the ground) and reels. A car that is hooked is pulled toward the
 * Hauler; a stake pulls the Hauler toward itself. Reeling spends the team battery, like nitro.
 */

export interface Pt {
  x: number;
  z: number;
}

/** How far the cable reaches when hooking, metres. */
export const WINCH_RANGE = 25;
/** The pull on the hooked car, m/s^2. About 0.7 g: strong enough to drag a stuck car, gentle enough not to flip one. */
export const WINCH_ACCEL = 7;
/** Reeling stops by itself once the two are this close, metres. */
export const WINCH_DONE = 4;

export type WinchKind = 'car' | 'stake';

export interface Hookable extends Pt {
  id: string;
}

export interface WinchTarget {
  kind: WinchKind;
  id: string;
  distance: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * What the winch would hook: the nearest of the other cars and the stakes within range. A car wins a
 * tie, since a teammate who is stuck is the usual reason to winch. Null when nothing is in reach.
 */
export function chooseTarget(me: Pt, cars: readonly Hookable[], stakes: readonly Hookable[], range: number = WINCH_RANGE): WinchTarget | null {
  let best: WinchTarget | null = null;
  const consider = (kind: WinchKind, list: readonly Hookable[]): void => {
    for (const h of list) {
      const d = dist(me, h);
      if (d > range || d < 0.01) continue;
      if (!best || d < best.distance - 0.5 || (kind === 'car' && best.kind === 'stake' && d <= best.distance + 0.5)) best = { kind, id: h.id, distance: d };
    }
  };
  consider('stake', stakes);
  consider('car', cars);
  return best;
}

/** The pull, as an acceleration on the car being pulled, toward `to`. Zero once they are close. */
export function pullToward(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d <= WINCH_DONE || d < 1e-6) return { x: 0, z: 0 };
  return { x: (dx / d) * WINCH_ACCEL, z: (dz / d) * WINCH_ACCEL };
}

/** Reeling is finished: the two are as close as the winch brings them. */
export function reelDone(a: Pt, b: Pt): boolean {
  return dist(a, b) <= WINCH_DONE;
}

/** The cable has more reach than this: it lets go (the car drove away or was knocked far). */
export const WINCH_SNAP = WINCH_RANGE + 12;

export function cableSnapped(a: Pt, b: Pt): boolean {
  return dist(a, b) > WINCH_SNAP;
}
