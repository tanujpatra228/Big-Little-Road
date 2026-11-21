/**
 * Jump rules, pure so they are testable without physics. A hop is a quick toy-car pop: tap once,
 * it fires if at least three wheels are on the ground (or were a moment ago), and cannot be
 * repeated until the car has landed and the cooldown has run out. No air jumps.
 */

/** Wheels that must touch the ground to hop. */
export const JUMP_MIN_WHEELS = 3;
/** Still counts as grounded this long after driving off an edge. */
export const COYOTE_SECONDS = 0.15;
/** A press this long before landing is remembered and fires on touchdown. */
export const BUFFER_SECONDS = 0.12;
/** No car may rise further than this above its takeoff, so tall boulders stay walls. */
export const MAX_JUMP_APEX = 1.0;

export class JumpState {
  private coyote = 0;
  private buffer = 0;
  private cooldown = 0;

  /** The jump key was pressed. */
  request(): void {
    this.buffer = BUFFER_SECONDS;
  }

  /** Seconds of cooldown left (it only runs while on the ground), for a HUD hint. */
  get cooldownLeft(): number {
    return this.cooldown;
  }

  /** Forget everything, e.g. after a respawn. */
  reset(): void {
    this.coyote = 0;
    this.buffer = 0;
    this.cooldown = 0;
  }

  /** Call once per physics step. Returns true on the step the hop should fire. */
  update(grounded: number, cooldownAfter: number, dt: number): boolean {
    const onGround = grounded >= JUMP_MIN_WHEELS;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = onGround ? COYOTE_SECONDS : Math.max(0, this.coyote - dt);
    if (onGround) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.buffer > 0 && this.coyote > 0 && this.cooldown <= 0) {
      this.buffer = 0;
      this.coyote = 0;
      this.cooldown = cooldownAfter;
      return true;
    }
    return false;
  }
}

/** Launch speed for a hop that rises `apex` metres on flat ground. */
export function jumpSpeed(apex: number, gravity: number): number {
  return Math.sqrt(2 * gravity * Math.min(apex, MAX_JUMP_APEX));
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Velocity change for a hop. The vertical part is always `speed`, whatever the tilt, so the apex
 * does not depend on the slope. The chassis up vector tilts it a little so on a slope the car pops
 * forward instead of straight up. Falling (inside the coyote window) is cancelled.
 */
export function jumpImpulse(up: V3, velocity: V3, speed: number): V3 {
  // Blend toward world up so a steep or tilted car never launches sideways.
  let bx = 0.3 * up.x;
  let by = 0.3 * up.y + 0.7;
  let bz = 0.3 * up.z;
  const len = Math.hypot(bx, by, bz) || 1;
  bx /= len;
  by /= len;
  bz /= len;
  const k = speed / Math.max(0.5, by);
  return { x: bx * k, y: Math.max(speed, velocity.y) - velocity.y, z: bz * k };
}

/**
 * A light push toward level while in the air, so hops land on wheels. Returns the change in
 * angular velocity per second (roll and pitch only, yaw is left alone). It gives up once the car
 * is past 90 degrees, so real flips still happen and the rescue rules still matter.
 */
export function airLevel(up: V3, angvel: V3, gain = 16, damp = 6): V3 {
  if (up.y <= 0.05) return { x: 0, y: 0, z: 0 };
  // axis = up x worldUp: the rotation that brings the car upright, length = sin(tilt).
  return { x: gain * -up.z - damp * angvel.x, y: 0, z: gain * up.x - damp * angvel.z };
}
