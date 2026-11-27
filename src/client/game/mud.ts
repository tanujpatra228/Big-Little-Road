import { MudState, inDeepMud, type MudEvent } from '../../shared/mud';
import type { CarRole } from '../../shared/cars';
import type { Vehicle } from '../physics/vehicle';

export interface MudDeps {
  vehicle: () => Vehicle;
  role: () => CarRole;
  /** The throttle held right now, 0 to 1 (the input before the signal filter). */
  throttle: () => number;
  /** A winch is pulling our car. */
  winched: () => boolean;
  /** Shown to the player: a toast. */
  toast: (title: string, sub?: string, ms?: number) => void;
  /** Called once when the car gets stuck (asks the team for a tow). */
  onStuck: () => void;
}

/**
 * The mud trap on this player's screen. It sinks the car in the middle of the bog, weakens its drive
 * as it sinks, holds it nearly still when stuck, and tells the player what to do about it.
 */
export class MudController {
  readonly state = new MudState();
  /** The words for the middle of the screen while sinking or stuck, or null. */
  banner: string | null = null;
  /** True once the car has been freed by a winch, until it is reset. For the mission. */
  freedByWinchLatch = false;

  constructor(private readonly d: MudDeps) {}

  get stuck(): boolean {
    return this.state.stuck;
  }

  reset(): void {
    this.state.reset();
    this.freedByWinchLatch = false;
    this.banner = null;
    const v = this.d.vehicle();
    v.driveScale = 1;
    v.speedCap = null;
  }

  update(dt: number): void {
    const v = this.d.vehicle();
    const t = v.body.translation();
    const ev: MudEvent = this.state.update(dt, { inMud: inDeepMud(t.x, t.z), throttle: Math.abs(this.d.throttle()), winched: this.d.winched(), role: this.d.role() });
    v.driveScale = this.state.drive;
    v.speedCap = this.state.stuck ? 0.5 : null;
    if (ev === 'stuck') {
      this.d.toast('Stuck in the mud', 'Hold the throttle to dig out, or call a Hauler with a winch.', 4200);
      this.d.onStuck();
    } else if (ev === 'freed') {
      this.freedByWinchLatch = this.state.freedByWinch;
      this.d.toast('Free!', this.state.freedByWinch ? 'The winch pulled you out.' : 'You dug yourself out.', 2600);
    }
    if (this.state.stuck) this.banner = `STUCK IN THE MUD  ·  digging ${Math.round(this.state.dig * 100)}%  ·  hold the throttle, or get winched`;
    else if (this.state.sink > 0.25) this.banner = 'Sinking! Get out of the mud';
    else this.banner = null;
  }
}
