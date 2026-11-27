/**
 * Nitro rules, pure so they are testable without physics. A personal tank: hold to boost, it
 * drains while boosting and refills slowly while not. Boost never makes a surface faster than
 * every other surface by more than the same factor (see `boostFactor`), so mud and sand still cost.
 */

/** Seconds of boost in a full tank. */
export const TANK_SECONDS = 4;
/** Tank fraction regained per second while not boosting, after a short pause. */
export const REGEN_PER_SECOND = 1 / 16;
/** Pause after releasing before the tank starts to refill. */
export const REGEN_DELAY = 1.0;
/** After running dry, boost stays off until the tank has this much again. */
export const RESTART_LEVEL = 0.2;
/** How fast the boost fades in, per second. */
export const BLEND_IN_RATE = 4;
/** How fast the speed limit settles back after the boost ends, so it never snaps. */
export const BLEND_OUT_RATE = 1.5;
/** No car may be boosted past this multiple of its own top speed on the same surface. */
export const MAX_NITRO_TOP = 1.4;

export class NitroTank {
  /** 0 empty, 1 full. */
  level = 1;
  /** Smoothed boost strength 0..1, for physics and effects. */
  blend = 0;
  private idle = 0;
  private lockedOut = false;
  private _active = false;

  /** True while the boost is actually running this step. */
  get active(): boolean {
    return this._active;
  }

  /** A little charge from something the driver did well (a drift). Only the personal tank: the team battery is the room's. */
  charge(amount: number): void {
    this.level = Math.min(1, this.level + Math.max(0, amount));
  }

  /** Full tank, no boost. */
  reset(): void {
    this.level = 1;
    this.blend = 0;
    this.idle = 0;
    this.lockedOut = false;
    this._active = false;
  }

  /**
   * Call once per physics step. `wanted` is the player holding the key with the throttle down,
   * i.e. boost would do something. Returns the smoothed boost strength 0..1.
   *
   * With a `shared` battery (in a room) the tank is only a window onto it: the level is whatever the
   * team has, nothing drains or refills here, and boosting is allowed whenever the team battery is
   * neither empty nor locked out. The room does the spending.
   */
  update(wanted: boolean, dt: number, shared: { level: number; locked: boolean } | null = null): number {
    if (shared) {
      this.level = shared.level;
      this._active = wanted && !shared.locked && shared.level > 0;
      this.idle = 0;
      this.lockedOut = shared.locked;
      return this.fade(dt);
    }
    if (this.lockedOut && this.level >= RESTART_LEVEL) this.lockedOut = false;
    this._active = wanted && !this.lockedOut && this.level > 0;
    if (this._active) {
      this.level = Math.max(0, this.level - dt / TANK_SECONDS);
      this.idle = 0;
      if (this.level <= 0) {
        this.lockedOut = true;
        this._active = false;
      }
    } else {
      this.idle += dt;
      if (this.idle >= REGEN_DELAY) this.level = Math.min(1, this.level + REGEN_PER_SECOND * dt);
    }
    return this.fade(dt);
  }

  /** Moves the smoothed boost strength toward on or off. */
  private fade(dt: number): number {
    const target = this._active ? 1 : 0;
    const step = (target > this.blend ? BLEND_IN_RATE : BLEND_OUT_RATE) * dt;
    this.blend = Math.abs(target - this.blend) <= step ? target : this.blend + Math.sign(target - this.blend) * step;
    return this.blend;
  }
}

/**
 * Engine-force and top-speed multipliers. The extra force only applies while the boost is running
 * (so tapping the key is not a free trick); the raised speed limit fades out slowly afterwards.
 */
export function boostFactor(blend: number, active: boolean, force: number, top: number): { force: number; top: number } {
  return { force: 1 + (force - 1) * (active ? blend : 0), top: 1 + (Math.min(top, MAX_NITRO_TOP) - 1) * blend };
}
