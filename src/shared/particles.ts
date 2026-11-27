import { mulberry32 } from './rng';
import { Surface } from './surfaces';

/**
 * Effects, the pure part: what a wheel throws up on each surface, and a small particle pool that moves
 * the bits. Dust, sand, mud, splashes, tyre smoke, hop dust and the nitro trail all use the same pool,
 * keyed to the surface under the wheel, so they double as feedback (you can see what you are driving on).
 * Nothing here touches the screen or the network: each browser draws its own, from positions it has.
 */

export type FxKind = 'dust' | 'sand' | 'mud' | 'splash' | 'gravel' | 'smoke' | 'boost';

export interface FxSpec {
  /** Linear colour, 0 to 1 per channel. */
  color: readonly [number, number, number];
  /** Size in metres at birth and at death. */
  size0: number;
  size1: number;
  /** Seconds. */
  life: number;
  /** Starting upward speed and sideways scatter, m/s. */
  up: number;
  spread: number;
  /** Pull down (m/s squared, negative rises) and air drag (1/s). */
  gravity: number;
  drag: number;
  /** Opacity at birth, fading to nothing by death. */
  alpha: number;
  /** Drawn bright and glowing (the nitro trail) rather than as soft matter. */
  additive: boolean;
}

export const FX: Readonly<Record<FxKind, FxSpec>> = {
  dust: { color: [0.55, 0.5, 0.36], size0: 0.25, size1: 0.95, life: 0.85, up: 0.9, spread: 0.7, gravity: 0.4, drag: 1.4, alpha: 0.32, additive: false },
  sand: { color: [0.8, 0.64, 0.38], size0: 0.3, size1: 1.2, life: 1.0, up: 1.2, spread: 0.9, gravity: 0.8, drag: 1.2, alpha: 0.42, additive: false },
  mud: { color: [0.16, 0.09, 0.045], size0: 0.2, size1: 0.26, life: 0.75, up: 2.8, spread: 1.4, gravity: 9, drag: 0.2, alpha: 0.95, additive: false },
  splash: { color: [0.75, 0.88, 1], size0: 0.18, size1: 0.45, life: 0.6, up: 2.4, spread: 1.1, gravity: 8, drag: 0.3, alpha: 0.7, additive: false },
  gravel: { color: [0.4, 0.4, 0.38], size0: 0.1, size1: 0.1, life: 0.45, up: 2.0, spread: 1.1, gravity: 9.5, drag: 0.1, alpha: 0.95, additive: false },
  smoke: { color: [0.85, 0.85, 0.85], size0: 0.3, size1: 1.4, life: 1.2, up: 0.7, spread: 0.5, gravity: -0.3, drag: 1.1, alpha: 0.5, additive: false },
  boost: { color: [1, 0.55, 0.14], size0: 0.32, size1: 0.04, life: 0.32, up: 0.2, spread: 0.35, gravity: 0, drag: 3, alpha: 1, additive: true },
};

/** A wheel's emission: which effect, how many a second. */
export interface FxEmit {
  kind: FxKind;
  rate: number;
  /** Multiplies the particle size (dry paving throws up less than sand). */
  scale: number;
}

export interface WheelFxInput {
  surface: Surface;
  /** Ground speed, m/s (absolute). */
  speed: number;
  /** 0 to 1: how far sideways the car is sliding. */
  slip: number;
  braking: boolean;
  throttle: number;
  /** Wheel is touching the ground. */
  grounded: boolean;
}

/** Below this ground speed a wheel throws nothing. */
export const MIN_FX_SPEED = 1.4;
/** Never more than this many particles a second from one wheel. */
export const MAX_RATE = 45;

const surfaceFx = (s: Surface): { kind: FxKind; weight: number; scale: number } => {
  switch (s) {
    case Surface.Sand: return { kind: 'sand', weight: 1.4, scale: 1 };
    case Surface.Mud: return { kind: 'mud', weight: 1, scale: 1 };
    case Surface.Water: return { kind: 'splash', weight: 1.5, scale: 1 };
    case Surface.Gravel: return { kind: 'gravel', weight: 1.1, scale: 1 };
    case Surface.Rock: return { kind: 'dust', weight: 0.4, scale: 0.7 };
    case Surface.Patio: return { kind: 'dust', weight: 0.35, scale: 0.6 };
    default: return { kind: 'dust', weight: 1, scale: 1 };
  }
};

/** Tyre smoke only comes off hard ground: sand, mud and water swallow it. */
const smokes = (s: Surface): boolean => s === Surface.Patio || s === Surface.Grass || s === Surface.Gravel || s === Surface.Rock;

/** What one wheel throws up this moment. Empty when it is slow, in the air, or parked. */
export function wheelFx(i: WheelFxInput): FxEmit[] {
  if (!i.grounded || i.speed < MIN_FX_SPEED) return [];
  const out: FxEmit[] = [];
  const f = surfaceFx(i.surface);
  const push = 0.5 + 0.5 * Math.min(1, Math.max(0, Math.abs(i.throttle)));
  const base = Math.min(MAX_RATE, (i.speed - MIN_FX_SPEED) * 3.2 * f.weight * push + i.slip * 18 * f.weight);
  if (base >= 0.5) out.push({ kind: f.kind, rate: base, scale: f.scale });
  if (smokes(i.surface)) {
    const slide = Math.max(0, i.slip - 0.28) * 90;
    const brake = i.braking && i.speed > 7 ? (i.speed - 7) * 4 : 0;
    const rate = Math.min(MAX_RATE, slide + brake);
    if (rate >= 1) out.push({ kind: 'smoke', rate, scale: 1 });
  }
  return out;
}

/** A burst when the car hops or lands: `kick` is 0 to 1 (a hop is small, a hard landing is large). */
export function burstFx(surface: Surface, kick: number): { kind: FxKind; count: number; scale: number } {
  const f = surfaceFx(surface);
  const k = Math.min(1, Math.max(0, kick));
  return { kind: f.kind, count: Math.round(4 + k * 14), scale: f.scale * (0.8 + 0.6 * k) };
}

/** Keeping the effects cheap: how much of the full amount a quality rung allows, 0 to 1. */
export function fxCapacity(scale: number, full = 600): number {
  return Math.max(0, Math.round(full * Math.min(1, Math.max(0, scale))));
}

const GRAVITY_CLAMP = 30;

/**
 * A pool of particles in flat arrays. Emitting past the capacity drops the new one (a cap on cost, not a
 * crash). `update` ages and moves them and compacts the live ones to the front, so a draw can use the
 * first `count` entries. Deterministic given its seed.
 */
export class ParticlePool {
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly alpha: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  count = 0;
  /** Particles that could not be born because the pool was full, since the last reset. */
  dropped = 0;
  private cap: number;
  private readonly rand: () => number;

  constructor(
    readonly capacity: number,
    seed = 1,
  ) {
    const n = capacity;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.size0 = new Float32Array(n); this.size1 = new Float32Array(n); this.alpha = new Float32Array(n);
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n);
    this.gravity = new Float32Array(n); this.drag = new Float32Array(n);
    this.cap = n;
    this.rand = mulberry32(seed);
  }

  /** Lowers or restores how many may live at once (quality). Existing ones are left to finish. */
  setLimit(limit: number): void {
    this.cap = Math.max(0, Math.min(this.capacity, Math.floor(limit)));
  }

  get limit(): number {
    return this.cap;
  }

  /** Throw `count` particles of `kind` from (x, y, z), carrying a share of the car's velocity. */
  emit(kind: FxKind, x: number, y: number, z: number, vx: number, vz: number, count: number, scale = 1): void {
    const s = FX[kind];
    for (let n = 0; n < count; n++) {
      if (this.count >= this.cap) {
        this.dropped += count - n;
        return;
      }
      const i = this.count++;
      const a = this.rand() * Math.PI * 2;
      const sp = this.rand() * s.spread;
      this.px[i] = x + (this.rand() - 0.5) * 0.3;
      this.py[i] = y + this.rand() * 0.1;
      this.pz[i] = z + (this.rand() - 0.5) * 0.3;
      this.vx[i] = vx * 0.12 + Math.cos(a) * sp;
      this.vz[i] = vz * 0.12 + Math.sin(a) * sp;
      this.vy[i] = s.up * (0.6 + this.rand() * 0.8);
      this.age[i] = 0;
      this.life[i] = s.life * (0.75 + this.rand() * 0.5);
      this.size0[i] = s.size0 * scale;
      this.size1[i] = s.size1 * scale;
      this.alpha[i] = s.alpha;
      this.r[i] = s.color[0]; this.g[i] = s.color[1]; this.b[i] = s.color[2];
      this.gravity[i] = s.gravity;
      this.drag[i] = s.drag;
    }
  }

  /** How far through its life particle `i` is, 0 to 1. */
  t(i: number): number {
    return this.age[i]! / this.life[i]!;
  }

  update(dt: number, groundAt?: (x: number, z: number) => number): void {
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) continue; // dies: not copied forward
      const k = Math.exp(-this.drag[i]! * dt);
      const vy = Math.max(-GRAVITY_CLAMP, this.vy[i]! - this.gravity[i]! * dt);
      const vx = this.vx[i]! * k;
      const vz = this.vz[i]! * k;
      let y = this.py[i]! + vy * dt;
      const x = this.px[i]! + vx * dt;
      const z = this.pz[i]! + vz * dt;
      let vy2 = vy;
      if (groundAt && this.gravity[i]! > 1) {
        const g = groundAt(x, z);
        if (y < g) {
          y = g;
          vy2 = -vy * 0.2; // matter thuds and settles; smoke and dust do not collide
        }
      }
      this.copy(i, w, x, y, z, vx, vy2, vz, age);
      w++;
    }
    this.count = w;
  }

  private copy(from: number, to: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, age: number): void {
    this.px[to] = x; this.py[to] = y; this.pz[to] = z;
    this.vx[to] = vx; this.vy[to] = vy; this.vz[to] = vz;
    this.age[to] = age;
    if (from !== to) {
      this.life[to] = this.life[from]!; this.size0[to] = this.size0[from]!; this.size1[to] = this.size1[from]!;
      this.alpha[to] = this.alpha[from]!; this.r[to] = this.r[from]!; this.g[to] = this.g[from]!; this.b[to] = this.b[from]!;
      this.gravity[to] = this.gravity[from]!; this.drag[to] = this.drag[from]!;
    }
  }

  clear(): void {
    this.count = 0;
    this.dropped = 0;
  }
}

// ---- tyre marks

/** Surfaces that keep a tyre mark. Water and rock do not. */
export function markable(s: Surface): boolean {
  return s === Surface.Patio || s === Surface.Sand || s === Surface.Gravel || s === Surface.Mud || s === Surface.Grass;
}

/** How dark a mark is on each surface, 0 to 1 (grass only scuffs). */
export function markStrength(s: Surface): number {
  switch (s) {
    case Surface.Patio: return 0.5;
    case Surface.Mud: return 0.55;
    case Surface.Sand: return 0.3;
    case Surface.Gravel: return 0.3;
    case Surface.Grass: return 0.2;
    default: return 0;
  }
}

export const MARK_LIFE = 22;
export const MARK_STEP = 0.4;
export const MARK_WIDTH = 0.22;
/** A wheel leaves a mark above this slip, or when braking hard. */
export const MARK_SLIP = 0.3;

export interface Mark {
  x: number;
  z: number;
  yaw: number;
  length: number;
  strength: number;
  age: number;
}

/** A ring of tyre-mark segments. The oldest is overwritten when it is full. */
export class SkidMarks {
  readonly marks: Mark[] = [];
  private next = 0;

  constructor(private cap: number) {}

  get capacity(): number {
    return this.cap;
  }

  setCapacity(cap: number): void {
    this.cap = Math.max(0, Math.floor(cap));
    if (this.marks.length > this.cap) {
      this.marks.length = 0;
      this.next = 0;
    }
  }

  add(m: Mark): void {
    if (this.cap === 0) return;
    if (this.marks.length < this.cap) this.marks.push(m);
    else {
      this.marks[this.next % this.cap] = m;
      this.next++;
    }
  }

  /** Ages every mark and drops the ones that have faded. */
  update(dt: number): void {
    let w = 0;
    for (const m of this.marks) {
      m.age += dt;
      if (m.age < MARK_LIFE) this.marks[w++] = m;
    }
    this.marks.length = w;
    this.next = 0;
  }

  get count(): number {
    return this.marks.length;
  }

  clear(): void {
    this.marks.length = 0;
    this.next = 0;
  }
}

/** One wheel's trail: remembers where it last left a mark and adds a segment every MARK_STEP metres of slide. */
export class SkidTrail {
  private lx = 0;
  private lz = 0;
  private active = false;

  /** Feed the wheel's ground position each frame. Returns a new mark when one is due. */
  step(x: number, z: number, slipping: boolean, surface: Surface): Mark | null {
    const strength = markStrength(surface);
    if (!slipping || !markable(surface) || strength <= 0) {
      this.active = false;
      return null;
    }
    if (!this.active) {
      this.active = true;
      this.lx = x;
      this.lz = z;
      return null;
    }
    const dx = x - this.lx;
    const dz = z - this.lz;
    const len = Math.hypot(dx, dz);
    if (len < MARK_STEP) return null;
    const m: Mark = { x: (x + this.lx) / 2, z: (z + this.lz) / 2, yaw: Math.atan2(dx, dz), length: len, strength, age: 0 };
    this.lx = x;
    this.lz = z;
    return m;
  }

  reset(): void {
    this.active = false;
  }
}
