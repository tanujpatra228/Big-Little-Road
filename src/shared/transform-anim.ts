/**
 * Timeline of the car transformation, as pure numbers so it can be tested. The old car takes itself
 * apart and becomes the new one, in this order (seconds):
 *
 *   0.00 to 0.60  small details fold away on hinges (top first, then sides, front, rear)
 *   0.20 to 1.20  the five big boxes unlatch, lift, travel and lock into the new car's shape
 *   0.30 to 0.95  the wheels glide to the new car's track and swap to its tyres
 *   0.80 to 1.40  the new car's details unfold, ending with the roof gear
 *
 * Everything is exactly at its start value before its window and exactly at its end value after it.
 */

/** The five big boxes every car is built around. They morph from one car's shape into the other's. */
export const FRAME_IDS = ['lower', 'cab', 'hood', 'tail', 'under'] as const;
export type FrameId = (typeof FRAME_IDS)[number];
/** Where small details sit. Each region folds away and unfolds as one. */
export const REGION_IDS = ['top', 'front', 'rear', 'side'] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const TRANSFORM_DURATION = 1.4;

interface Window {
  start: number;
  end: number;
}

/** When each big box moves from the old car's shape to the new one's. Staggered so it reads as a sequence. */
export const FRAME_WINDOW: Readonly<Record<FrameId, Window>> = {
  under: { start: 0.2, end: 0.8 },
  lower: { start: 0.25, end: 0.95 },
  tail: { start: 0.3, end: 1.1 },
  hood: { start: 0.35, end: 1.05 },
  cab: { start: 0.4, end: 1.2 },
};

/**
 * How far a big box swings out of its way mid-move (metres in the car's own frame, radians for the
 * tilt). It is a bump: zero at both ends of the window, full in the middle.
 */
export const FRAME_LIFT: Readonly<Record<FrameId, { dx: number; dy: number; dz: number; tiltX: number; tiltZ: number }>> = {
  lower: { dx: 0, dy: 0.1, dz: 0, tiltX: 0, tiltZ: 0 },
  under: { dx: 0, dy: -0.12, dz: 0, tiltX: 0, tiltZ: 0 },
  hood: { dx: 0, dy: 0.1, dz: 0.18, tiltX: -0.35, tiltZ: 0 },
  tail: { dx: 0, dy: 0.08, dz: -0.18, tiltX: 0.3, tiltZ: 0 },
  cab: { dx: 0, dy: 0.3, dz: 0, tiltX: 0, tiltZ: 0.25 },
};

/** When each group of details folds away (old car). */
export const FOLD_WINDOW: Readonly<Record<RegionId, Window>> = {
  top: { start: 0.0, end: 0.45 },
  side: { start: 0.08, end: 0.5 },
  front: { start: 0.12, end: 0.55 },
  rear: { start: 0.16, end: 0.6 },
};

/** When each group of details unfolds (new car). */
export const UNFOLD_WINDOW: Readonly<Record<RegionId, Window>> = {
  side: { start: 0.8, end: 1.18 },
  rear: { start: 0.86, end: 1.24 },
  front: { start: 0.92, end: 1.3 },
  top: { start: 0.98, end: 1.4 },
};

export const WHEEL_WINDOW: Readonly<Window> = { start: 0.3, end: 0.95 };
/** The moment the old tyres are replaced by the new ones: halfway through the glide. */
export const WHEEL_SWAP_AT = (WHEEL_WINDOW.start + WHEEL_WINDOW.end) / 2;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const progress = (w: Window, t: number): number => clamp01((t - w.start) / (w.end - w.start));

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeIn = (u: number): number => u * u * u;

/** Starts with a hint of backing off and ends with a small overshoot, exactly 0 at 0 and 1 at 1. */
function easeInOutBack(u: number): number {
  const c1 = 1.1;
  const c2 = c1 * 1.525;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u < 0.5 ? (Math.pow(2 * u, 2) * ((c2 + 1) * 2 * u - c2)) / 2 : (Math.pow(2 * u - 2, 2) * ((c2 + 1) * (u * 2 - 2) + c2) + 2) / 2;
}

/** Springs past 1 a little and settles, exactly 0 at 0 and 1 at 1. */
function easeOutBack(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const c1 = 1.5;
  const c3 = c1 + 1;
  const x = u - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** How far a big box is from the old shape (0) to the new one (1). Backs off a little first, overshoots a little at the end. */
export function frameProgress(id: FrameId, t: number): number {
  return easeInOutBack(progress(FRAME_WINDOW[id], t));
}

/** 0 at both ends of the window, 1 in the middle: how far the box is swung out of its way. */
export function frameLift(id: FrameId, t: number): number {
  const u = progress(FRAME_WINDOW[id], t);
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
}

/** How much of a detail group is still unfolded on the old car: 1 before its window, 0 after. */
export function foldRemaining(region: RegionId, t: number): number {
  return 1 - easeIn(progress(FOLD_WINDOW[region], t));
}

/** How far a detail group on the new car has unfolded: 0 before its window, 1 after, a small overshoot between. */
export function unfolded(region: RegionId, t: number): number {
  return easeOutBack(progress(UNFOLD_WINDOW[region], t));
}

/** 0 while the wheels are where the old car had them, 1 once they are where the new car wants them. */
export function wheelBlend(t: number): number {
  return easeInOut(progress(WHEEL_WINDOW, t));
}

/** Scale of the suspension arms: they retract early and spring back once the body has settled. */
export function armScale(t: number): number {
  if (t < 0.25) return 1 - easeIn(t / 0.25);
  if (t < 0.95) return 0;
  return easeOutBack(clamp01((t - 0.95) / 0.3));
}

/** A moment when a part locks home, for sparks. */
export interface LockEvent {
  t: number;
  kind: 'frame' | 'region';
  id: FrameId | RegionId;
}

/** Every moment a part clicks into place, in time order. */
export function lockEvents(): LockEvent[] {
  const events: LockEvent[] = [];
  for (const id of FRAME_IDS) events.push({ t: FRAME_WINDOW[id].end, kind: 'frame', id });
  for (const id of REGION_IDS) events.push({ t: UNFOLD_WINDOW[id].end, kind: 'region', id });
  return events.sort((a, b) => a.t - b.t);
}

/** Every moment a part unlatches and starts moving, in time order (for ratchet clicks). */
export function latchTimes(): number[] {
  return [...FRAME_IDS.map((id) => FRAME_WINDOW[id].start), ...REGION_IDS.map((id) => FOLD_WINDOW[id].start)].sort((a, b) => a - b);
}
