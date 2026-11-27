/**
 * Automatic quality, pure so it can be tested against simulated machines. The game starts at full
 * quality and steps down a ladder whenever the frame rate stays too low, one rung at a time, and
 * steps back up when there is plenty of headroom. The ladder is ordered by what costs the least
 * to look at: the post effects first, then thinner far grass, then fewer pixels.
 */

export interface Rung {
  /** 'high' has the post effects (anti-aliasing, bloom) and bigger shadows; 'low' has neither. */
  tier: 'high' | 'low';
  /** 0 to 1, how much of the lawn to draw. */
  density: number;
  /** Multiplies the tier's own pixel ratio (1 = untouched). */
  pixelScale: number;
  flowers: boolean;
  /** 0 to 1, how much of the dust, spray and tyre marks to draw. */
  fx: number;
}

/** Level 0 is everything on. Each step costs less than the one before. */
export const LADDER: readonly Rung[] = [
  { tier: 'high', density: 1, pixelScale: 1, flowers: true, fx: 1 },
  { tier: 'low', density: 1, pixelScale: 1, flowers: true, fx: 1 },
  { tier: 'low', density: 0.7, pixelScale: 1, flowers: true, fx: 0.85 },
  { tier: 'low', density: 0.7, pixelScale: 0.85, flowers: true, fx: 0.7 },
  { tier: 'low', density: 0.45, pixelScale: 0.75, flowers: true, fx: 0.5 },
  { tier: 'low', density: 0.25, pixelScale: 0.65, flowers: false, fx: 0.3 },
];

export const MAX_LEVEL = LADDER.length - 1;
/** Below this average frame rate the quality steps down. */
export const DOWN_FPS = 45;
/** Above this it may step back up, but only after holding it for UP_HOLD_SECONDS. */
export const UP_FPS = 57;
export const UP_HOLD_SECONDS = 10;
/** Frames are averaged over this long before any decision. */
export const WINDOW_SECONDS = 2;
/** Nothing happens for this long after start, and after each change (shaders compile, buffers resize). */
export const WARMUP_SECONDS = 3;
export const SETTLE_SECONDS = 2;
/**
 * A frame is counted as at most this long. One long frame (a load, a garbage-collection pause) then
 * barely moves a two second average, but a machine that is always this slow still reads as slow
 * and steps down. Do not throw such frames away: the slowest machines are the ones that need help.
 */
export const MAX_FRAME_SECONDS = 0.25;
/** If stepping up is followed by a drop within this long, stepping up is banned for LOCKOUT_SECONDS. */
export const REGRET_SECONDS = 14;
export const LOCKOUT_SECONDS = 90;

export class AutoQuality {
  level: number;
  private frames = 0;
  private time = 0;
  private clock = 0;
  private quietUntil = WARMUP_SECONDS;
  private goodFor = 0;
  private lastUpAt = -Infinity;
  private noUpUntil = -Infinity;

  constructor(
    /** Never go above this rung. Lets a saved setting or ?quality= cap the ladder. */
    private readonly startLevel = 0,
    private readonly maxLevel = MAX_LEVEL,
  ) {
    this.level = startLevel;
  }

  /** Feed one frame's duration in seconds. Returns the new level when it changes, otherwise null. */
  frame(dt: number): number | null {
    if (!(dt > 0)) return null;
    dt = Math.min(dt, MAX_FRAME_SECONDS);
    this.clock += dt;
    if (this.clock < this.quietUntil) return null;
    this.frames++;
    this.time += dt;
    if (this.time < WINDOW_SECONDS) return null;

    const fps = this.frames / this.time;
    const window = this.time;
    this.frames = 0;
    this.time = 0;

    if (fps < DOWN_FPS) {
      this.goodFor = 0;
      if (this.level >= this.maxLevel) return null;
      // Stepping up did not hold: remember that, and stop trying for a while.
      if (this.clock - this.lastUpAt < REGRET_SECONDS) this.noUpUntil = this.clock + LOCKOUT_SECONDS;
      return this.set(this.level + 1);
    }
    if (fps >= UP_FPS) {
      this.goodFor += window;
      if (this.goodFor >= UP_HOLD_SECONDS && this.level > this.startLevel && this.clock >= this.noUpUntil) {
        this.lastUpAt = this.clock;
        return this.set(this.level - 1);
      }
    } else {
      this.goodFor = 0;
    }
    return null;
  }

  private set(level: number): number {
    this.level = level;
    this.goodFor = 0;
    this.quietUntil = this.clock + SETTLE_SECONDS;
    return level;
  }

  /** Jump to a level on purpose (for example when the player picks one). */
  force(level: number): void {
    this.level = Math.min(this.maxLevel, Math.max(this.startLevel, level));
    this.goodFor = 0;
    this.frames = 0;
    this.time = 0;
    this.quietUntil = this.clock + SETTLE_SECONDS;
  }
}

/** The pixel ratio a rung asks for, given what the tier alone would use. Never below 0.6. */
export function rungPixelRatio(rung: Rung, tierRatio: number): number {
  return Math.max(0.6, tierRatio * rung.pixelScale);
}
