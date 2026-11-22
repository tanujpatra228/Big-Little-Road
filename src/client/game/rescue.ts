import { ROLL_TIMEOUT, RescueProgress } from '../../shared/rescue';
import type { RemoteCar } from '../net/remote-car';
import type { Vehicle } from '../physics/vehicle';

export interface RescueDeps {
  vehicle: () => Vehicle;
  remotes: () => Map<string, RemoteCar>;
  /** Called once each time we become flipped, e.g. to ping the team for help. */
  onFlipped: () => void;
}

/**
 * Rescue, not reset. While you are stuck on your roof, a teammate who drives up close for a moment
 * flips you back over (the rules are in shared/rescue.ts). Alone, the old reset after 10 s still
 * applies. The first time you flip, the team is pinged automatically so they know to come.
 */
export class RescueController {
  private readonly progress = new RescueProgress();
  private rolling = false;
  private rollTime = 0;
  private prefer: 1 | -1 = 1;
  private pinged = false;
  /** Banner text while a rescue is under way, or null. */
  text: string | null = null;

  constructor(private readonly d: RescueDeps) {}

  /** Distance to the nearest teammate we can see, or null. Also says which side of us they are on. */
  private nearest(): { dist: number; side: 1 | -1 } | null {
    const v = this.d.vehicle();
    const t = v.body.translation();
    const q = v.body.rotation();
    // The car's own sideways axis in world space.
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const lz = 2 * (q.x * q.z - q.w * q.y);
    let best: { dist: number; side: 1 | -1 } | null = null;
    for (const rc of this.d.remotes().values()) {
      if (!rc.visible) continue;
      const dx = rc.position.x - t.x;
      const dz = rc.position.z - t.z;
      const dist = Math.hypot(dx, rc.position.y - t.y, dz);
      if (!best || dist < best.dist) best = { dist, side: dx * lx + dz * lz >= 0 ? 1 : -1 };
    }
    return best;
  }

  /** Call every frame. */
  update(dt: number): void {
    const v = this.d.vehicle();
    if (this.rolling) {
      this.text = null;
      return;
    }
    const near = this.nearest();
    const flipped = v.isFlipped;
    if (flipped && !this.pinged) {
      this.pinged = true;
      this.d.onFlipped();
    }
    if (!flipped && v.upright > 0.5) this.pinged = false;
    const event = this.progress.update(dt, flipped, near ? near.dist : null);
    this.text = flipped && this.progress.progress > 0 ? `Being rescued... ${Math.round(this.progress.progress * 100)}%` : null;
    if (event === 'roll') {
      this.rolling = true;
      this.rollTime = 0;
      this.prefer = near && near.side > 0 ? -1 : 1; // shoved from one side, it rolls to the other
    }
  }

  /** Call every physics step, before the vehicle steps. */
  step(dt: number): void {
    if (!this.rolling) return;
    this.rollTime += dt;
    const done = this.d.vehicle().rollOver(this.prefer, dt);
    if (done || this.rollTime > ROLL_TIMEOUT) {
      this.rolling = false;
      this.progress.reset();
    }
  }

  get active(): boolean {
    return this.rolling;
  }

  reset(): void {
    this.rolling = false;
    this.progress.reset();
    this.text = null;
    this.pinged = false;
  }
}
