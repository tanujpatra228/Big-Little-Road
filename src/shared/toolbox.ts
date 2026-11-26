/**
 * The crew toolbox and the things placed from it. Pure and immutable, like mission-logic.
 *
 * One box of six slots is shared by the whole room. A player drops the item in a slot where their car
 * is, and any player can pick a placed item back up into the first empty slot. Beacons are for the radio
 * web, stakes are anchors for the winch, cones just mark the way; for now all three are markers in the
 * world, and the later steps give two of them a job.
 */

export const ITEM_KINDS = ['beacon', 'stake', 'cone'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ItemSpec {
  label: string;
  /** One letter for the wire and the slot. */
  letter: string;
  color: number;
}

export const ITEMS: Readonly<Record<ItemKind, ItemSpec>> = {
  beacon: { label: 'Beacon', letter: 'b', color: 0x4fe3c1 },
  stake: { label: 'Stake', letter: 's', color: 0xc9964f },
  cone: { label: 'Cone', letter: 'c', color: 0xff7a1a },
};

export const SLOTS = 6;
/** Most things that can stand in the world at once. Keeps the room's saved state and every frame small. */
export const MAX_PLACED = 24;
/** How close a car must be to a placed item to pick it up (metres). The room allows a little more for lag. */
export const PICKUP_RANGE = 4;
/** How far from a car something can be dropped, as the room checks it (metres). */
export const DROP_REACH = 8;
/** Where a drop lands in front of the car (metres). */
export const DROP_AHEAD = 2.6;

export const DEFAULT_SLOTS: ReadonlyArray<ItemKind | null> = ['beacon', 'beacon', 'stake', 'stake', 'cone', 'cone'];

export interface Placed {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
  yaw: number;
  /** Who dropped it. */
  by: string;
}

export interface Tools {
  slots: Array<ItemKind | null>;
  placed: Placed[];
  /** Counter for the next id, so ids are never reused. */
  next: number;
}

export function newTools(slots: ReadonlyArray<ItemKind | null> = DEFAULT_SLOTS): Tools {
  const s = Array.from({ length: SLOTS }, (_, i) => slots[i] ?? null);
  return { slots: s, placed: [], next: 1 };
}

export type ToolError = 'bad-slot' | 'empty' | 'full' | 'unknown' | 'no-room';

export function dropItem(t: Tools, slot: number, at: { x: number; z: number; yaw: number }, by: string): { tools: Tools; placed: Placed } | { error: ToolError } {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return { error: 'bad-slot' };
  const kind = t.slots[slot];
  if (!kind) return { error: 'empty' };
  if (t.placed.length >= MAX_PLACED) return { error: 'full' };
  const placed: Placed = { id: `o${t.next}`, kind, x: at.x, z: at.z, yaw: at.yaw, by };
  const slots = [...t.slots];
  slots[slot] = null;
  return { tools: { slots, placed: [...t.placed, placed], next: t.next + 1 }, placed };
}

export function pickUp(t: Tools, id: string): { tools: Tools; kind: ItemKind; slot: number } | { error: ToolError } {
  const item = t.placed.find((p) => p.id === id);
  if (!item) return { error: 'unknown' };
  const slot = t.slots.findIndex((s) => s === null);
  if (slot < 0) return { error: 'no-room' };
  const slots = [...t.slots];
  slots[slot] = item.kind;
  return { tools: { slots, placed: t.placed.filter((p) => p.id !== id), next: t.next }, kind: item.kind, slot };
}

/** The placed item nearest to (x, z) within `reach`, or null. */
export function nearestPlaced(t: Tools, x: number, z: number, reach: number = PICKUP_RANGE): Placed | null {
  let best: Placed | null = null;
  let bestD = reach;
  for (const p of t.placed) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Placed items of one kind (for the later systems: beacons feed the radio, stakes anchor the winch). */
export function placedOf(t: Tools, kind: ItemKind): Placed[] {
  return t.placed.filter((p) => p.kind === kind);
}

/** Where a drop lands for a car at (x, z) facing `yaw` (facing +z at 0). */
export function dropSpot(x: number, z: number, yaw: number): { x: number; z: number; yaw: number } {
  return { x: x + Math.sin(yaw) * DROP_AHEAD, z: z + Math.cos(yaw) * DROP_AHEAD, yaw };
}

// The wire form: slots as one short string, positions in centimetres, angles in milliradians.

export interface PlacedWire {
  i: string;
  k: string;
  x: number;
  z: number;
  y: number;
  b: string;
}

export interface ToolsInfo {
  /** One letter per slot, '-' for empty. */
  s: string;
  p: PlacedWire[];
  n: number;
}

const byLetter = new Map<string, ItemKind>(ITEM_KINDS.map((k) => [ITEMS[k].letter, k]));

export function toWire(t: Tools): ToolsInfo {
  return {
    s: t.slots.map((k) => (k ? ITEMS[k].letter : '-')).join(''),
    p: t.placed.map((p) => ({ i: p.id, k: ITEMS[p.kind].letter, x: Math.round(p.x * 100), z: Math.round(p.z * 100), y: Math.round(p.yaw * 1000), b: p.by })),
    n: t.next,
  };
}

/** Reads a wire form, ignoring anything it does not understand (a bad frame never throws). */
export function fromWire(info: ToolsInfo | null | undefined): Tools {
  if (!info || typeof info.s !== 'string' || !Array.isArray(info.p)) return newTools();
  const slots = Array.from({ length: SLOTS }, (_, i) => byLetter.get(info.s[i] ?? '') ?? null);
  const placed: Placed[] = [];
  for (const w of info.p.slice(0, MAX_PLACED)) {
    const kind = byLetter.get(w?.k);
    if (!kind || typeof w.i !== 'string' || !Number.isFinite(w.x) || !Number.isFinite(w.z)) continue;
    placed.push({ id: w.i, kind, x: w.x / 100, z: w.z / 100, yaw: (Number.isFinite(w.y) ? w.y : 0) / 1000, by: typeof w.b === 'string' ? w.b : '' });
  }
  return { slots, placed, next: Number.isInteger(info.n) && info.n > 0 ? info.n : placed.length + 1 };
}

export const REFUSALS: Readonly<Record<ToolError, string>> = {
  'bad-slot': 'There is no such slot.',
  empty: 'That slot is empty.',
  full: `That is as many things as the yard holds (${MAX_PLACED}). Pick one up first.`,
  unknown: 'That is already gone.',
  'no-room': 'The toolbox is full. Drop something first.',
};
