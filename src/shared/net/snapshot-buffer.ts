import type { PoseState } from './pose';

/** How far in the past remote cars are drawn, so there is almost always a newer pose to blend toward. */
export const RENDER_DELAY_MS = 100;
/** If poses stop arriving, keep gliding along the last velocity for at most this long. */
export const MAX_EXTRAPOLATE_MS = 250;

interface Snap {
  t: number;
  s: PoseState;
}

/**
 * Smooths a remote car. Poses arrive about 10 times a second with jitter, so we:
 *  1. learn the clock offset between sender and us from the fastest recent packets,
 *  2. draw the car RENDER_DELAY_MS in the past on the sender's timeline,
 *  3. blend between the two poses around that moment (extrapolating briefly if the buffer runs dry).
 */
export class SnapshotBuffer {
  private snaps: Snap[] = [];
  private offsets: number[] = [];

  /** `senderT` is the t field of the frame, `localNow` is our clock when it arrived (both ms). */
  push(senderT: number, state: PoseState, localNow: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && senderT <= last.t) return; // late or duplicate
    this.snaps.push({ t: senderT, s: state });
    if (this.snaps.length > 24) this.snaps.shift();
    this.offsets.push(localNow - senderT);
    if (this.offsets.length > 40) this.offsets.shift();
  }

  /** Lowest recent (arrival - sent) = the clock offset plus the fastest path. */
  private offset(): number {
    return Math.min(...this.offsets);
  }

  get size(): number {
    return this.snaps.length;
  }

  sample(localNow: number): PoseState | null {
    const first = this.snaps[0];
    const last = this.snaps[this.snaps.length - 1];
    if (!first || !last) return null;
    const t = localNow - this.offset() - RENDER_DELAY_MS;

    if (t <= first.t) return first.s;
    if (t >= last.t) return extrapolate(this.snaps, t);

    // Find the pair around t.
    let i = this.snaps.length - 2;
    while (i > 0 && this.snaps[i]!.t > t) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1]!;
    const k = (t - a.t) / (b.t - a.t || 1);
    return blend(a.s, b.s, k);
  }
}

function blend(a: PoseState, b: PoseState, k: number): PoseState {
  // Normalised lerp for rotation: fine for the small angle between two poses 100 ms apart.
  let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
  if (a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const qx = a.qx + (bx - a.qx) * k;
  const qy = a.qy + (by - a.qy) * k;
  const qz = a.qz + (bz - a.qz) * k;
  const qw = a.qw + (bw - a.qw) * k;
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    qx: qx / n, qy: qy / n, qz: qz / n, qw: qw / n,
    v: a.v + (b.v - a.v) * k,
    steer: a.steer + (b.steer - a.steer) * k,
  };
}

function extrapolate(snaps: Snap[], t: number): PoseState {
  const last = snaps[snaps.length - 1]!;
  const prev = snaps[snaps.length - 2];
  if (!prev) return last.s;
  const dt = Math.min(Math.max(0, t - last.t), MAX_EXTRAPOLATE_MS);
  const span = last.t - prev.t || 1;
  const k = dt / span;
  return {
    ...last.s,
    x: last.s.x + (last.s.x - prev.s.x) * k,
    y: last.s.y + (last.s.y - prev.s.y) * k,
    z: last.s.z + (last.s.z - prev.s.z) * k,
  };
}
