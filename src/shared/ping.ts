/**
 * Ping wheel rules, pure so they are testable without a browser: what each ping looks like, how a
 * mouse flick picks one, where it points, how long it lives, and where its arrow sits at the edge of
 * the screen. Pings are the only way strangers can talk to each other, so they are quick and rare.
 */
import { PING_KINDS, type PingKind } from './net/protocol';

export { PING_KINDS };
export type { PingKind };

export interface PingStyle {
  label: string;
  /** CSS colour for the icon, the beam and the ring. */
  color: string;
  /** True: sticks to the sender's car and follows it. False: marks a spot on the ground. */
  anchored: boolean;
  /** Seconds before it fades away. */
  ttl: number;
}

/** The wheel runs clockwise from the top in this order (the order of PING_KINDS). */
export const PING_STYLES: Readonly<Record<PingKind, PingStyle>> = {
  go: { label: 'Go here', color: '#4ade80', anchored: false, ttl: 8 },
  wait: { label: 'Wait', color: '#ffd23f', anchored: false, ttl: 8 },
  tow: { label: 'Tow me', color: '#ff8a3d', anchored: true, ttl: 12 },
  battery: { label: 'Low battery', color: '#ff5a4d', anchored: true, ttl: 12 },
  look: { label: 'Look', color: '#5ab4ff', anchored: false, ttl: 6 },
};

/** A tap of the key sends this one. */
export const QUICK_PING: PingKind = 'go';
/** Holding the key this long opens the wheel; a shorter press is a tap. */
export const WHEEL_OPEN_MS = 180;
/** The mouse must move this far (pixels) from the wheel's centre to pick a slice. */
export const WHEEL_DEADZONE = 34;
/** Least time between two pings from one player, in ms. */
export const PING_COOLDOWN_MS = 1200;
/** The last second of a ping's life is spent fading. */
export const FADE_SECONDS = 1.0;

const SLICE = (Math.PI * 2) / PING_KINDS.length;

/**
 * Which slice the mouse is over, from its offset from the wheel's centre in screen pixels (y down).
 * Slice 0 is centred straight up, then clockwise. Inside the dead zone nothing is picked.
 */
export function pickKind(dx: number, dy: number, deadzone = WHEEL_DEADZONE): PingKind | null {
  if (Math.hypot(dx, dy) < deadzone) return null;
  const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2); // 0 up, clockwise
  const index = Math.floor(((angle + SLICE / 2) % (Math.PI * 2)) / SLICE);
  return PING_KINDS[index] ?? null;
}

/** Where a slice sits on the wheel: angle in radians clockwise from up. */
export function sliceAngle(kind: PingKind): number {
  return PING_KINDS.indexOf(kind) * SLICE;
}

/** Stops spamming: one ping per player per cooldown. */
export class PingLimiter {
  private last = -Infinity;

  /** True if a ping may go out now (and starts the cooldown). `now` in ms. */
  allow(now: number): boolean {
    if (now - this.last < PING_COOLDOWN_MS) return false;
    this.last = now;
    return true;
  }
}

export interface PingMarker {
  /** Who sent it. */
  sender: string;
  kind: PingKind;
  /** Where it was when sent, world metres. Anchored pings follow the sender's car instead. */
  x: number;
  z: number;
  /** `now` (ms) when it arrived. */
  at: number;
}

/** The pings on screen right now: at most one per sender, a new one replaces the old. */
export class PingBoard {
  private readonly markers = new Map<string, PingMarker>();

  add(sender: string, kind: PingKind, x: number, z: number, now: number): void {
    this.markers.set(sender, { sender, kind, x, z, at: now });
  }

  /** Drops expired pings. */
  prune(now: number): void {
    for (const [id, m] of this.markers) if ((now - m.at) / 1000 >= PING_STYLES[m.kind].ttl) this.markers.delete(id);
  }

  /** Live pings, oldest first. */
  active(now: number): PingMarker[] {
    this.prune(now);
    return [...this.markers.values()].sort((a, b) => a.at - b.at);
  }

  /** A player left: their ping goes with them. */
  remove(sender: string): void {
    this.markers.delete(sender);
  }

  clear(): void {
    this.markers.clear();
  }
}

/** 0 invisible, 1 solid. Pops in over a quarter second, fades over the last second. */
export function pingOpacity(kind: PingKind, ageMs: number): number {
  const age = ageMs / 1000;
  const left = PING_STYLES[kind].ttl - age;
  const fadeIn = Math.min(1, Math.max(0, age / 0.25));
  const fadeOut = Math.min(1, Math.max(0, left / FADE_SECONDS));
  return Math.min(fadeIn, fadeOut);
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where a ray first meets the ground, found by marching along it and then narrowing in. Returns null
 * if it never does within `maxDist` (looking at the sky).
 */
export function rayGroundHit(origin: V3, dir: V3, heightAt: (x: number, z: number) => number, maxDist = 90, step = 0.6): V3 | null {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const at = (s: number): V3 => ({ x: origin.x + d.x * s, y: origin.y + d.y * s, z: origin.z + d.z * s });
  const below = (s: number): boolean => {
    const p = at(s);
    return p.y <= heightAt(p.x, p.z);
  };
  if (below(0)) return null; // already under the ground: nothing sensible to point at
  let prev = 0;
  for (let s = step; s <= maxDist + step; s += step) {
    if (below(s)) {
      let lo = prev;
      let hi = s;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      const p = at(hi);
      return { x: p.x, y: heightAt(p.x, p.z), z: p.z };
    }
    prev = s;
  }
  return null;
}

/**
 * The spot a ping points at: where the crosshair ray meets the ground. Looking at the sky, it is a
 * point `fallbackDist` metres ahead along the ray's ground heading, so a ping always lands somewhere.
 */
export function aimPoint(origin: V3, dir: V3, heightAt: (x: number, z: number) => number, fallbackDist = 22): { x: number; z: number } {
  const hit = rayGroundHit(origin, dir, heightAt);
  if (hit) return { x: hit.x, z: hit.z };
  const flat = Math.hypot(dir.x, dir.z) || 1;
  return { x: origin.x + (dir.x / flat) * fallbackDist, z: origin.z + (dir.z / flat) * fallbackDist };
}

/**
 * Where a ping's icon goes on screen. `ndcX`, `ndcY` are the point's position in normalised screen
 * coordinates (-1 to 1, y up); `behind` is true when it is behind the camera. On screen it stays where
 * it is. Off screen (or behind) it slides to the edge, keeping its direction, with an arrow angle in
 * radians clockwise from up pointing the way.
 */
export function edgeIndicator(ndcX: number, ndcY: number, behind: boolean, margin = 0.86): { x: number; y: number; onScreen: boolean; angle: number } {
  let x = ndcX;
  let y = ndcY;
  if (behind) {
    // Projection mirrors points behind the camera; flip them so the arrow points the right way around.
    x = -x;
    y = -y;
    if (Math.hypot(x, y) < 1e-6) y = -1; // straight behind: point down
  }
  const onScreen = !behind && Math.abs(x) <= margin && Math.abs(y) <= margin;
  const angle = Math.atan2(x, y); // 0 up, clockwise
  if (onScreen) return { x, y, onScreen, angle };
  const k = margin / Math.max(Math.abs(x), Math.abs(y));
  return { x: x * k, y: y * k, onScreen: false, angle };
}

/** "12 m" for the distance label. */
export function distanceLabel(metres: number): string {
  return `${Math.max(0, Math.round(metres))} m`;
}
