import type { CarRole } from './cars';

/**
 * The handbrake drift, pure so it can be tested against simulated cars. A drift is a held slide that
 * keeps speed, looks good and rewards skill: while it lasts the rear tyres let go smoothly with the
 * slip angle (never beyond a cap, so it never becomes a spin), the front wheels counter-steer toward
 * where the car is going, a little less drag bleeds the speed, and (alone) it charges the nitro tank.
 *
 * Slip angle is the angle from the car's nose to its velocity: 0 when it goes where it points, positive
 * when it slides toward the driver's right, negative toward the left.
 */

export interface DriftTuning {
  /** Slip angle (radians) the car must reach to start a drift by steering hard. */
  enterSlip: number;
  /** Below this slip the drift ends. */
  exitSlip: number;
  /** The slide is held to about this angle. */
  maxSlip: number;
  /** Rear grip at the deepest part of a slide, as a fraction of normal. */
  rearGripMin: number;
  /** Rear grip while the handbrake is held: how hard it kicks the tail out. The heavy Hauler needs more. */
  handbrakeGrip: number;
  /** How hard the front wheels turn toward the velocity per radian of slip. */
  assistGain: number;
  /** Drag removed while drifting, as a fraction. */
  dragRelief: number;
  /** Fraction of the nitro tank charged per second of a full drift. */
  charge: number;
}

/** The Scout slides easily and far, the Relay is in between, the Hauler is heavy: short slides, a tight cap. */
export const DRIFT: Readonly<Record<CarRole, DriftTuning>> = {
  scout: { enterSlip: 0.17, exitSlip: 0.1, maxSlip: 0.7, rearGripMin: 0.34, handbrakeGrip: 0.45, assistGain: 0.9, dragRelief: 0.5, charge: 0.1 },
  relay: { enterSlip: 0.2, exitSlip: 0.12, maxSlip: 0.6, rearGripMin: 0.42, handbrakeGrip: 0.38, assistGain: 1.0, dragRelief: 0.4, charge: 0.08 },
  hauler: { enterSlip: 0.24, exitSlip: 0.14, maxSlip: 0.45, rearGripMin: 0.55, handbrakeGrip: 0.25, assistGain: 1.1, dragRelief: 0.3, charge: 0.06 },
};

/** A drift needs at least this ground speed to start (m/s), and ends below EXIT_SPEED. */
export const MIN_DRIFT_SPEED = 5;
export const EXIT_SPEED = 3;
/** While drifting, the handbrake brakes this fraction as hard: it is there to kick the tail out, not to stop the car. */
export const DRIFT_BRAKE = 0.35;
/** Steering the front wheels may be given by the assist at most (radians). */
export const MAX_ASSIST = 0.35;
/** A drift is given this long to develop before low slip can end it, so a handbrake tap has time to bite. */
export const MIN_DRIFT_TIME = 0.5;
/** Spin damping at the cap (1/s) and the extra turn back toward the velocity beyond it (rad/s squared). */
export const YAW_DAMP = 5;
export const YAW_PULL = 12;
/** Beyond this slip (radians) the car is going backwards relative to its nose: it is not a drift. */
export const MAX_DRIFT_SLIP = 2.2;
/** Tyres with less grip than this (mud, water) will not hold a drift at all. */
export const SLIDABLE_GRIP = 0.68;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Signed angle from the nose (yaw, facing +z at 0) to the ground velocity. Positive: velocity toward the driver's right. */
export function slipAngle(vx: number, vz: number, yaw: number): number {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const along = vx * fx + vz * fz;
  const across = vx * -fz + vz * fx; // toward the driver's right
  return Math.atan2(across, Math.abs(along) < 1e-6 ? 1e-6 : along);
}

export interface DriftInput {
  role: CarRole;
  /** Ground speed, m/s. */
  speed: number;
  /** Signed slip angle from `slipAngle`. */
  slip: number;
  /** Driver steering, -1 to 1 (positive right). */
  steer: number;
  handbrake: boolean;
  /** Wheels on the ground (at least three). */
  grounded: boolean;
  /** Tyre grip of the ground, as in SURFACE_PROPS (1 is paving). */
  surfaceGrip: number;
  /** Driving forward (a slide while reversing is not a drift). */
  forward: boolean;
}

export interface DriftOutput {
  /** Multiplies the rear tyres' grip this step. */
  rearGrip: number;
  /** Steering added to the front wheels (radians, positive right). */
  assist: number;
  /** Multiplies how much of the driver's own steering is used (the assist takes over some). */
  steerScale: number;
  /** Multiplies the surface drag. */
  dragScale: number;
  /** 0 not drifting, up to 1 deep in a slide. For smoke, sound and charging. */
  intensity: number;
  /** Damping of the car's spin (1/s): stops a slide becoming a spin. */
  yawDamp: number;
  /** Extra turn (rad/s squared, positive counter-clockwise from above) that brings the nose back toward the velocity past the cap. */
  yawAccel: number;
}

export const NO_DRIFT: Readonly<DriftOutput> = { rearGrip: 1, assist: 0, steerScale: 1, dragScale: 1, intensity: 0, yawDamp: 0, yawAccel: 0 };

export class DriftState {
  active = false;
  private since = 0;
  private airborne = 0;

  /** Advance one physics step. */
  update(dt: number, i: DriftInput): DriftOutput {
    const t = DRIFT[i.role];
    const aSlip = Math.abs(i.slip);
    if (!i.grounded) this.airborne += dt;
    else this.airborne = 0;
    const slidable = i.surfaceGrip >= SLIDABLE_GRIP;

    if (!this.active) {
      const hard = Math.abs(i.steer) > 0.6 && aSlip > t.enterSlip;
      if (i.grounded && i.forward && aSlip < MAX_DRIFT_SLIP && slidable && i.speed > MIN_DRIFT_SPEED && (i.handbrake || hard)) {
        this.active = true;
        this.since = 0;
      } else {
        return i.handbrake ? { ...NO_DRIFT, rearGrip: t.handbrakeGrip } : NO_DRIFT;
      }
    }
    this.since += dt;
    const lost = !i.forward || aSlip > MAX_DRIFT_SLIP || !slidable || i.speed < EXIT_SPEED || this.airborne > 0.3;
    const settled = this.since > MIN_DRIFT_TIME && aSlip < t.exitSlip && !i.handbrake;
    if (lost || settled) {
      this.active = false;
      return i.handbrake ? { ...NO_DRIFT, rearGrip: t.handbrakeGrip } : NO_DRIFT;
    }

    // Rear grip falls smoothly as the slide deepens, then comes back near the cap so it never spins.
    const depth = aSlip / t.maxSlip;
    const letGo = smooth(0.0, 0.35, depth);
    const regrip = smooth(0.8, 1.05, depth);
    let rearGrip = 1 - (1 - t.rearGripMin) * letGo * (1 - regrip);
    // The handbrake kicks the tail out, but is let off as the slide nears its cap, so holding it never spins the car.
    if (i.handbrake) rearGrip = Math.min(rearGrip, t.handbrakeGrip + (1 - t.handbrakeGrip) * smooth(0.5, 0.9, depth));
    const strength = clamp(aSlip / (t.enterSlip * 1.5), 0, 1);
    const assist = clamp(i.slip * t.assistGain * (0.5 + 0.5 * strength), -MAX_ASSIST, MAX_ASSIST);
    return {
      rearGrip,
      assist,
      steerScale: 0.55,
      dragScale: 1 - t.dragRelief * strength,
      intensity: strength,
      yawDamp: YAW_DAMP * smooth(0.5, 1.0, depth),
      yawAccel: -Math.sign(i.slip) * YAW_PULL * smooth(0.8, 1.2, depth),
    };
  }

  reset(): void {
    this.active = false;
    this.since = 0;
    this.airborne = 0;
  }
}
