import { AutoQuality, LADDER, rungPixelRatio } from '../../shared/auto-quality';
import type { Grass } from '../render/grass';
import type { Stage } from '../render/stage';

/**
 * Keeps the frame rate up on any machine. It watches how long frames take and, when they stay too
 * slow, steps down the ladder in shared/auto-quality.ts (post effects, then thinner grass, then fewer
 * pixels), stepping back up when there is plenty of headroom. A fixed ?quality= or touching any
 * control in the F3 panel turns it off. Nothing changes on a machine that is fast enough.
 */
export class AutoQualityController {
  private readonly q = new AutoQuality(0);
  private on: boolean;

  constructor(
    private readonly stage: Stage,
    private readonly grass: Grass,
  ) {
    this.on = !stage.pinned();
    if (this.on) this.apply(0);
  }

  get enabled(): boolean {
    return this.on;
  }

  get level(): number {
    return this.q.level;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (on) {
      this.q.force(this.q.level);
      this.apply(this.q.level);
    }
  }

  /** Call every frame with the time since the last one, in seconds. */
  frame(dt: number): void {
    if (!this.on || document.hidden) return;
    const next = this.q.frame(dt);
    if (next !== null) this.apply(next);
  }

  /** Puts a rung into effect: one buffer rebuild at most. */
  private apply(level: number): void {
    const r = LADDER[level]!;
    const base = this.stage.tierPixelRatio(r.tier);
    const ratio = r.pixelScale === 1 ? null : rungPixelRatio(r, base);
    if (this.stage.quality() !== r.tier || (ratio ?? base) !== this.stage.pixelRatio()) this.stage.configure(r.tier, ratio);
    this.grass.setDensity(r.density);
    this.grass.setFlowers(r.flowers);
  }
}
