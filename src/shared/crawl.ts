import type { Boulder } from './boulders';
import { ROCK, SPAWN } from './terrain';

export interface Pt {
  x: number;
  z: number;
}

/**
 * Rock Crawl, the pure part: the safe line through the rock field, and the rule that keeps a car on it.
 *
 * The line is worked out from the boulders themselves (a path search with room for the widest car), so
 * it always exists and always fits, whatever the seed. Everyone's browser works out the same line.
 */

/** Half width of the corridor around the line. Leaving it for long enough sends you back to a checkpoint. */
export const CORRIDOR = 3.6;
/** Metres between two marks on the line. */
export const MARK_SPACING = 4;
/** A checkpoint every this many marks. */
export const CHECKPOINT_EVERY = 5;
/** Seconds outside the corridor before it counts as lost, so a clipped corner is forgiven. */
export const LOST_AFTER = 1.4;
/** Seconds after being sent back before the rule applies again. */
export const LOST_COOLDOWN = 2.5;
/** Room a car needs beside a boulder. The Hauler is about 1.6 wide. */
export const CLEARANCE = 1.0;

const angleToSpawn = Math.atan2(SPAWN.z - ROCK.z, SPAWN.x - ROCK.x);
const edge = (sign: 1 | -1, inset: number): Pt => ({
  x: ROCK.x + Math.cos(angleToSpawn) * (ROCK.r - inset) * sign,
  z: ROCK.z + Math.sin(angleToSpawn) * (ROCK.r - inset) * sign,
});

/** Where the line starts: the side of the field facing the house. */
export const CRAWL_ENTRY: Readonly<Pt> = edge(1, 3);
/** Where it ends: the far side. */
export const CRAWL_FAR: Readonly<Pt> = edge(-1, 3);

export interface CrawlLine {
  /** Marks along the line, about MARK_SPACING apart, from the entry to the far side. */
  points: Pt[];
  /** Distance along the line at each mark. */
  cum: number[];
  length: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Finds the line. `clearance` is the room needed beside a tall boulder; it is relaxed step by step if
 * a seed is crowded, and the result says how much room it actually has.
 */
export function buildCrawlLine(boulders: readonly Boulder[]): CrawlLine & { clearance: number } {
  const tall = boulders.filter((b) => b.kind === 'boulder');
  for (const clearance of [CLEARANCE, 0.85, 0.7, 0.55]) {
    const pts = search(tall, clearance);
    if (pts) return { ...resample(pts), clearance };
  }
  // Nothing fits at all (not seen on any tested seed): a straight line, still usable as guidance.
  return { ...resample([CRAWL_ENTRY, CRAWL_FAR]), clearance: 0 };
}

const CELL = 1;
const N = Math.ceil((ROCK.r * 2) / CELL) + 1;

function search(tall: readonly Boulder[], clearance: number): Pt[] | null {
  const x0 = ROCK.x - ROCK.r;
  const z0 = ROCK.z - ROCK.r;
  const at = (i: number, j: number): Pt => ({ x: x0 + i * CELL, z: z0 + j * CELL });
  const blocked = new Uint8Array(N * N);
  /** How close a cell is to trouble, 0 (open) to 1: the search prefers the middle of a gap. */
  const risk = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const p = at(i, j);
      const k = j * N + i;
      if (dist(p, ROCK) > ROCK.r - 1.5) {
        blocked[k] = 1;
        continue;
      }
      let nearest = Infinity;
      for (const b of tall) nearest = Math.min(nearest, dist(p, b) - b.radius);
      if (nearest < clearance) blocked[k] = 1;
      else risk[k] = Math.max(0, 1 - (nearest - clearance) / 2);
    }
  }
  const cellOf = (p: Pt): number => {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (blocked[k]) continue;
        const d = dist(at(i, j), p);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    return bestD <= 6 ? best : -1;
  };
  const start = cellOf(CRAWL_ENTRY);
  const goal = cellOf(CRAWL_FAR);
  if (start < 0 || goal < 0) return null;

  const g = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const open = new Set<number>([start]);
  g[start] = 0;
  const gp = at(goal % N, Math.floor(goal / N));
  const f = (k: number): number => g[k]! + dist(at(k % N, Math.floor(k / N)), gp);
  while (open.size) {
    let cur = -1;
    let curF = Infinity;
    for (const k of open) {
      const v = f(k);
      if (v < curF) {
        curF = v;
        cur = k;
      }
    }
    if (cur === goal) break;
    open.delete(cur);
    closed[cur] = 1;
    const ci = cur % N;
    const cj = Math.floor(cur / N);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (blocked[nk] || closed[nk]) continue;
        // No cutting a corner between two blocked cells.
        if (di && dj && (blocked[cj * N + ni] || blocked[nj * N + ci])) continue;
        const step = (di && dj ? Math.SQRT2 : 1) * CELL * (1 + risk[nk]! * 1.5);
        const ng = g[cur]! + step;
        if (ng < g[nk]!) {
          g[nk] = ng;
          from[nk] = cur;
          open.add(nk);
        }
      }
    }
  }
  if (from[goal]! < 0 && goal !== start) return null;
  const cells: Pt[] = [];
  for (let k = goal; k >= 0; k = from[k]!) cells.push(at(k % N, Math.floor(k / N)));
  cells.reverse();
  return pull(cells, tall, clearance);
}

/** Straightens the path where it can be, without ever cutting inside the clearance. */
function pull(path: Pt[], tall: readonly Boulder[], clearance: number): Pt[] {
  const free = (a: Pt, b: Pt): boolean => {
    const n = Math.ceil(dist(a, b) / 0.4);
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (dist(p, ROCK) > ROCK.r - 1.5) return false;
      for (const bo of tall) if (dist(p, bo) - bo.radius < clearance) return false;
    }
    return true;
  };
  const out: Pt[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !free(path[i]!, path[j]!)) j--;
    out.push(path[j]!);
    i = j;
  }
  return out;
}

/** Marks every MARK_SPACING metres along a polyline. */
function resample(poly: Pt[]): CrawlLine {
  const points: Pt[] = [poly[0]!];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const len = dist(a, b);
    let at = MARK_SPACING - carry;
    while (at <= len) {
      const t = at / len;
      points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      at += MARK_SPACING;
    }
    carry = len - (at - MARK_SPACING);
  }
  const last = poly[poly.length - 1]!;
  if (dist(points[points.length - 1]!, last) > 0.5) points.push(last);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + dist(points[i - 1]!, points[i]!));
  return { points, cum, length: cum[cum.length - 1]! };
}

/** The closest point of the line to (x, z): how far off it is, and how far along. */
export function nearestOnLine(line: CrawlLine, x: number, z: number): { off: number; s: number } {
  let best = { off: Infinity, s: 0 };
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1]!;
    const b = line.points[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const off = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (off < best.off) best = { off, s: line.cum[i - 1]! + Math.sqrt(len2) * t };
  }
  return best;
}

/** The point and heading (yaw, facing +z at 0) at a distance along the line. */
export function pointAt(line: CrawlLine, s: number): { x: number; z: number; yaw: number } {
  const clamped = Math.max(0, Math.min(line.length, s));
  for (let i = 1; i < line.points.length; i++) {
    if (clamped <= line.cum[i]! || i === line.points.length - 1) {
      const a = line.points[i - 1]!;
      const b = line.points[i]!;
      const span = line.cum[i]! - line.cum[i - 1]!;
      const t = span === 0 ? 0 : (clamped - line.cum[i - 1]!) / span;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
    }
  }
  const p = line.points[0]!;
  return { x: p.x, z: p.z, yaw: 0 };
}

export function inField(x: number, z: number): boolean {
  return Math.hypot(x - ROCK.x, z - ROCK.z) < ROCK.r;
}

export type CrawlResult = { kind: 'ok' } | { kind: 'lost'; to: { x: number; z: number; yaw: number } };

/**
 * One car's run along the line. Staying within CORRIDOR of it banks checkpoints; being outside the
 * corridor, inside the field, for LOST_AFTER seconds sends the car back to the last checkpoint.
 */
export class CrawlRun {
  /** Distance along the line of the last checkpoint reached. */
  checkpointS = 0;
  private offFor = 0;
  private cooldown = 0;

  constructor(private readonly line: CrawlLine) {}

  update(x: number, z: number, dt: number): CrawlResult {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!inField(x, z)) {
      this.offFor = 0;
      return { kind: 'ok' };
    }
    const n = nearestOnLine(this.line, x, z);
    if (n.off <= CORRIDOR) {
      this.offFor = 0;
      const step = CHECKPOINT_EVERY * MARK_SPACING;
      const reached = Math.floor(n.s / step) * step;
      // A checkpoint is banked only a little way past it, so cutting across a bend does not skip ahead.
      if (reached > this.checkpointS && n.s >= reached + 1) this.checkpointS = reached;
      return { kind: 'ok' };
    }
    if (this.cooldown > 0) return { kind: 'ok' };
    this.offFor += dt;
    if (this.offFor < LOST_AFTER) return { kind: 'ok' };
    this.offFor = 0;
    this.cooldown = LOST_COOLDOWN;
    return { kind: 'lost', to: pointAt(this.line, this.checkpointS) };
  }

  /** Seconds the car has been outside the corridor (for a warning on screen). */
  get offSeconds(): number {
    return this.offFor;
  }
}
