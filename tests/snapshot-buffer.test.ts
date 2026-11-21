import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/shared/rng';
import { dequantizePose, quantizePose, type PoseState } from '../src/shared/net/pose';
import { MAX_EXTRAPOLATE_MS, RENDER_DELAY_MS, SnapshotBuffer } from '../src/shared/net/snapshot-buffer';

const R = 20; // metres
const W = 0.5; // rad/s, so 10 m/s around the circle

/** Where the car truly is at sender time t (ms). It drives a circle at 10 m/s. */
function truth(tMs: number): PoseState {
  const a = (tMs / 1000) * W;
  const yaw = a + Math.PI / 2;
  return { x: R * Math.cos(a), y: 0.5, z: R * Math.sin(a), qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2), v: 10, steer: 0.2 };
}

interface Net {
  latency: number;
  jitter: number;
  loss: number;
}

interface Run {
  maxError: number;
  maxJump: number;
  samples: number;
}

/** Sends poses at 10 Hz through a bad network and samples the buffer at 60 fps. */
function simulate(net: Net, seconds: number, opts: { stopAt?: number; skew?: number } = {}): Run {
  const rand = mulberry32(42);
  const skew = opts.skew ?? 7300; // the two clocks disagree; the buffer must cope
  const packets: Array<{ arrive: number; t: number; state: PoseState }> = [];
  for (let t = 0; t < seconds * 1000; t += 100) {
    if (opts.stopAt !== undefined && t > opts.stopAt) break;
    if (rand() < net.loss) continue;
    const state = dequantizePose(quantizePose(truth(t), t / 100, t)); // through the real wire format
    packets.push({ arrive: t + net.latency + rand() * net.jitter, t, state });
  }
  packets.sort((a, b) => a.arrive - b.arrive);

  const buf = new SnapshotBuffer();
  let next = 0;
  let maxError = 0;
  let maxJump = 0;
  let samples = 0;
  let prev: PoseState | null = null;
  for (let frame = 0; frame < seconds * 1000; frame += 1000 / 60) {
    while (next < packets.length && packets[next]!.arrive <= frame) {
      const p = packets[next++]!;
      buf.push(p.t, p.state, p.arrive + skew);
    }
    const s = buf.sample(frame + skew);
    if (!s || frame < 2500) {
      prev = s;
      continue;
    }
    // Ideal: the car as it was RENDER_DELAY plus the fastest path ago.
    const ideal = truth(frame - net.latency - RENDER_DELAY_MS);
    maxError = Math.max(maxError, Math.hypot(s.x - ideal.x, s.z - ideal.z));
    if (prev) maxJump = Math.max(maxJump, Math.hypot(s.x - prev.x, s.z - prev.z));
    prev = s;
    samples++;
  }
  return { maxError, maxJump, samples };
}

describe('smoothing a remote car over a bad network', () => {
  it.each([0, 150, 250])('stays close to the true path at %i ms latency (clean link)', (latency) => {
    const r = simulate({ latency, jitter: 0, loss: 0 }, 20);
    expect(r.samples).toBeGreaterThan(900);
    expect(r.maxError).toBeLessThan(0.1);
  });

  it.each([0, 150, 250])('survives jitter and 5%% packet loss at %i ms latency', (latency) => {
    const r = simulate({ latency, jitter: 40, loss: 0.05 }, 30);
    expect(r.maxError).toBeLessThan(0.75);
    // 10 m/s at 60 fps is 0.17 m per frame. Never teleport.
    expect(r.maxJump).toBeLessThan(0.6);
  });

  it('does not drift over a long session', () => {
    const r = simulate({ latency: 150, jitter: 40, loss: 0.05 }, 120);
    expect(r.maxError).toBeLessThan(0.75);
  });

  it('works whatever the clock skew between the two machines', () => {
    for (const skew of [-5000, 0, 123456]) {
      expect(simulate({ latency: 100, jitter: 0, loss: 0 }, 12, { skew }).maxError).toBeLessThan(0.1);
    }
  });
});

describe('edge cases', () => {
  const state = (x: number): PoseState => ({ x, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, v: 0, steer: 0 });

  it('returns null until it has a pose, and the only pose it has until it has two', () => {
    const b = new SnapshotBuffer();
    expect(b.sample(0)).toBeNull();
    b.push(0, state(5), 1000);
    expect(b.sample(1100)?.x).toBe(5);
  });

  it('ignores late and duplicate poses', () => {
    const b = new SnapshotBuffer();
    b.push(100, state(1), 0);
    b.push(200, state(2), 0);
    b.push(150, state(99), 0); // out of order
    b.push(200, state(98), 0); // duplicate time
    expect(b.size).toBe(2);
  });

  it('a car that stops stays stopped', () => {
    const r = simulate({ latency: 100, jitter: 0, loss: 0 }, 12, { stopAt: 6000 });
    // After the last pose the buffer extrapolates briefly then holds: it must not run away.
    expect(r.maxJump).toBeLessThan(0.3);
  });

  it('extrapolation is capped when packets stop arriving', () => {
    const b = new SnapshotBuffer();
    // 10 m/s along x, 100 ms apart.
    for (let i = 0; i < 6; i++) b.push(i * 100, { ...state(i * 1), v: 10 }, 5000 + i * 100);
    const last = 5; // x = 5 m at t = 500
    const farFuture = b.sample(5000 + 500 + RENDER_DELAY_MS + 10_000)!; // ten seconds of silence
    const maxRun = (MAX_EXTRAPOLATE_MS / 100) * 1; // 1 m per 100 ms
    expect(farFuture.x).toBeLessThanOrEqual(last + maxRun + 0.01);
    expect(farFuture.x).toBeGreaterThan(last);
  });
});
