import type { CarRole } from './cars';

/**
 * Low range: the Hauler and Relay can drop into a crawling gear. It trades top speed for torque and a
 * tighter turning circle, which is what picking a way between boulders needs. The Scout has none.
 */
export type Gear = 'high' | 'low';

export interface GearFactors {
  /** Multiplies engine force. */
  power: number;
  /** Multiplies top speed (and reverse top speed). */
  top: number;
  /** Multiplies the steering lock. */
  steer: number;
}

export const HIGH_GEAR: Readonly<GearFactors> = { power: 1, top: 1, steer: 1 };
export const LOW_GEAR: Readonly<GearFactors> = { power: 1.6, top: 0.42, steer: 1.25 };

export function hasLowRange(role: CarRole): boolean {
  return role === 'hauler' || role === 'relay';
}

/** The gear a car actually runs in: a role without low range is always in high. */
export function effectiveGear(role: CarRole, gear: Gear): Gear {
  return hasLowRange(role) ? gear : 'high';
}

export function gearFactors(role: CarRole, gear: Gear): Readonly<GearFactors> {
  return effectiveGear(role, gear) === 'low' ? LOW_GEAR : HIGH_GEAR;
}

export function toggleGear(role: CarRole, gear: Gear): Gear {
  if (!hasLowRange(role)) return 'high';
  return gear === 'low' ? 'high' : 'low';
}
