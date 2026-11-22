import { describe, expect, it } from 'vitest';
import {
  FADE_SECONDS, PING_COOLDOWN_MS, PING_KINDS, PING_STYLES, PingBoard, PingLimiter, WHEEL_DEADZONE, aimPoint, distanceLabel, edgeIndicator, pickKind,
  pingOpacity, rayGroundHit, sliceAngle,
} from '../src/shared/ping';
import { parseClientMessage } from '../src/shared/net/protocol';

const near = (a: number, b: number, tol = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(tol);
const flat = (): number => 0;

describe('ping styles', () => {
  it('every kind has a label, a colour and a sensible life', () => {
    for (const k of PING_KINDS) {
      const s = PING_STYLES[k];
      expect(s.label.length).toBeGreaterThan(2);
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.ttl).toBeGreaterThanOrEqual(5);
      expect(s.ttl).toBeLessThanOrEqual(15);
    }
  });

  it('colours are all different so a ping can be read at a glance', () => {
    expect(new Set(PING_KINDS.map((k) => PING_STYLES[k].color)).size).toBe(PING_KINDS.length);
  });

  it('tow me and low battery follow the car; the rest mark the ground', () => {
    expect(PING_STYLES.tow.anchored).toBe(true);
    expect(PING_STYLES.battery.anchored).toBe(true);
    for (const k of ['go', 'wait', 'look'] as const) expect(PING_STYLES[k].anchored).toBe(false);
  });
});

describe('picking a slice with the mouse', () => {
  it('nothing is picked inside the dead zone', () => {
    expect(pickKind(0, 0)).toBeNull();
    expect(pickKind(WHEEL_DEADZONE - 1, 0)).toBeNull();
  });

  it.each(PING_KINDS)('flicking toward the centre of the %s slice picks it', (kind) => {
    const a = sliceAngle(kind);
    expect(pickKind(Math.sin(a) * 90, -Math.cos(a) * 90)).toBe(kind);
  });

  it('the first slice is straight up and they run clockwise', () => {
    expect(pickKind(0, -80)).toBe('go');
    expect(pickKind(80, 0)).toBe('wait'); // right
    expect(pickKind(0, 80)).toBe('battery'); // down is between tow and battery; battery is the bigger share of straight down
    expect(pickKind(-80, 0)).toBe('look'); // left
  });

  it('slices are equal: the boundaries sit half way between centres', () => {
    const a = sliceAngle('go') + Math.PI / 5 - 0.01; // just inside go
    const b = sliceAngle('go') + Math.PI / 5 + 0.01; // just inside wait
    expect(pickKind(Math.sin(a) * 100, -Math.cos(a) * 100)).toBe('go');
    expect(pickKind(Math.sin(b) * 100, -Math.cos(b) * 100)).toBe('wait');
  });

  it('every direction picks something once outside the dead zone', () => {
    const seen = new Set<string>();
    for (let a = 0; a < Math.PI * 2; a += 0.05) seen.add(pickKind(Math.sin(a) * 60, -Math.cos(a) * 60)!);
    expect(seen.size).toBe(PING_KINDS.length);
    expect(seen.has('null')).toBe(false);
  });
});

describe('cooldown', () => {
  it('lets the first through, blocks a spam, allows again after the cooldown', () => {
    const l = new PingLimiter();
    expect(l.allow(1000)).toBe(true);
    expect(l.allow(1000 + PING_COOLDOWN_MS - 1)).toBe(false);
    expect(l.allow(1000 + PING_COOLDOWN_MS)).toBe(true);
  });
});

describe('the board', () => {
  it('keeps one ping per sender: a new one replaces the old', () => {
    const b = new PingBoard();
    b.add('p1', 'go', 1, 2, 0);
    b.add('p1', 'wait', 5, 6, 100);
    const a = b.active(200);
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({ kind: 'wait', x: 5, z: 6 });
  });

  it('holds pings from different players side by side, oldest first', () => {
    const b = new PingBoard();
    b.add('p2', 'look', 0, 0, 500);
    b.add('p1', 'go', 0, 0, 100);
    expect(b.active(600).map((m) => m.sender)).toEqual(['p1', 'p2']);
  });

  it('pings expire after their own time to live', () => {
    const b = new PingBoard();
    b.add('p1', 'look', 0, 0, 0); // 6 s
    b.add('p2', 'tow', 0, 0, 0); // 12 s
    expect(b.active(5900).length).toBe(2);
    expect(b.active(6100).map((m) => m.sender)).toEqual(['p2']);
    expect(b.active(12100).length).toBe(0);
  });

  it('a player who leaves takes their ping with them', () => {
    const b = new PingBoard();
    b.add('p1', 'go', 0, 0, 0);
    b.remove('p1');
    expect(b.active(10).length).toBe(0);
  });
});

describe('opacity', () => {
  it('pops in, holds, fades out, and is gone at the end', () => {
    expect(pingOpacity('go', 0)).toBe(0);
    expect(pingOpacity('go', 125)).toBeCloseTo(0.5, 6);
    expect(pingOpacity('go', 400)).toBe(1);
    expect(pingOpacity('go', (PING_STYLES.go.ttl - FADE_SECONDS / 2) * 1000)).toBeCloseTo(0.5, 6);
    expect(pingOpacity('go', PING_STYLES.go.ttl * 1000)).toBe(0);
  });
});

describe('where a ping points', () => {
  it('a ray going down at 45 degrees meets flat ground at the same distance as its height', () => {
    const hit = rayGroundHit({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 1 }, flat);
    expect(hit).not.toBeNull();
    near(hit!.z, 5, 0.02);
    near(hit!.y, 0, 1e-9);
  });

  it('finds the ground on a slope, not under it', () => {
    const slope = (_x: number, z: number): number => z * 0.2; // rises away from the camera
    const hit = rayGroundHit({ x: 0, y: 3, z: 0 }, { x: 0, y: -0.2, z: 1 }, slope)!;
    near(hit.y, slope(hit.x, hit.z), 1e-6);
    expect(hit.z).toBeGreaterThan(0);
  });

  it('looking at the sky finds nothing, and so does a ray that starts under the ground', () => {
    expect(rayGroundHit({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 1 }, flat)).toBeNull();
    expect(rayGroundHit({ x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 1 }, flat)).toBeNull();
  });

  it('a ping always lands somewhere: sky falls back to a point ahead along the heading', () => {
    const p = aimPoint({ x: 10, y: 5, z: 0 }, { x: 0, y: 1, z: 1 }, flat, 22);
    near(p.x, 10);
    near(p.z, 22);
    const q = aimPoint({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 1 }, flat);
    near(q.z, 5, 0.02);
  });

  it('a hill in the way stops the ray in front of it', () => {
    const wall = (_x: number, z: number): number => (z > 10 ? 20 : 0);
    const hit = rayGroundHit({ x: 0, y: 4, z: 0 }, { x: 0, y: -0.05, z: 1 }, wall)!;
    expect(hit.z).toBeGreaterThan(9.9);
    expect(hit.z).toBeLessThan(10.6);
  });
});

describe('the edge arrow', () => {
  it('a point inside the screen stays where it is', () => {
    const e = edgeIndicator(0.3, -0.4, false);
    expect(e.onScreen).toBe(true);
    expect(e).toMatchObject({ x: 0.3, y: -0.4 });
  });

  it('a point off to the right slides to the right edge, keeping its direction', () => {
    const e = edgeIndicator(3, 1.5, false, 0.86);
    expect(e.onScreen).toBe(false);
    near(e.x, 0.86);
    near(e.y, 0.43);
    near(e.angle, Math.atan2(3, 1.5));
  });

  it('a point above the screen goes to the top edge', () => {
    const e = edgeIndicator(0.5, 4, false, 0.86);
    near(e.y, 0.86);
    near(e.x, 0.1075);
  });

  it('a point behind the camera is flipped, so the arrow points the way you should turn', () => {
    // Projection puts a point behind and to the right at a negative x; the arrow must point right.
    const e = edgeIndicator(-0.4, 0.1, true);
    expect(e.onScreen).toBe(false);
    expect(e.x).toBeGreaterThan(0.5); // flipped to the right side
    expect(Math.max(Math.abs(e.x), Math.abs(e.y))).toBeCloseTo(0.86, 9);
  });

  it('straight behind points down, never NaN', () => {
    const e = edgeIndicator(0, 0, true);
    expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.angle)).toBe(true);
    expect(e.y).toBeLessThan(0);
  });

  it('the arrow always ends on or inside the margin box', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      for (const behind of [false, true]) {
        const e = edgeIndicator(Math.sin(a) * 5, Math.cos(a) * 5, behind, 0.86);
        expect(Math.max(Math.abs(e.x), Math.abs(e.y))).toBeLessThanOrEqual(0.86 + 1e-9);
      }
    }
  });
});

describe('labels and the wire', () => {
  it('rounds distances and never shows a negative', () => {
    expect(distanceLabel(12.4)).toBe('12 m');
    expect(distanceLabel(12.6)).toBe('13 m');
    expect(distanceLabel(-3)).toBe('0 m');
  });

  it('the server accepts every kind in range and rejects strangers and wild positions', () => {
    for (const k of PING_KINDS) expect(parseClientMessage(JSON.stringify({ type: 'ping', kind: k, x: 1200, z: -3400 }))).toMatchObject({ type: 'ping', kind: k });
    expect(parseClientMessage(JSON.stringify({ type: 'ping', kind: 'follow', x: 0, z: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'ping', kind: 'go', x: 99999999, z: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'ping', kind: 'go', x: 1.5, z: 0 }))).toBeNull();
  });
});
