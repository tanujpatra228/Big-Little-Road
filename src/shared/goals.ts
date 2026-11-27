import { CRAWL_ENTRY, CRAWL_FAR } from './crawl';
import { PLATFORM, SPAWN, ZONES } from './terrain';

/** A place a team is trying to reach. */
export interface Goal {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Horizontal reach in metres. */
  r: number;
  /** The car's centre must be higher than this, so driving past below does not count. */
  minY: number;
  /** Only a mission uses it: walking into it in free play does nothing. */
  missionOnly?: boolean;
}

/** Where the lost car waits for Dead Signal: far out on the lawn, about 87 m from the base, well past its 48 m reach. */
export const DEAD_CAR: Readonly<{ x: number; z: number }> = { x: 65, z: -60 };
/** Firm ground on the house side of the bog, 28 m from its middle: where a rescued car is hauled to. */
export const MUD_SHORE: Readonly<{ x: number; z: number }> = (() => {
  const dx = SPAWN.x - ZONES.mud.x;
  const dz = SPAWN.z - ZONES.mud.z;
  const len = Math.hypot(dx, dz);
  return { x: ZONES.mud.x + (dx / len) * 28, z: ZONES.mud.z + (dz / len) * 28 };
})();
/** How close the Relay must be to the lost car to charge it. */
export const REVIVE_REACH = 9;

/** The terrace: reach the top of the platform, which only the plank-ramp gets you onto. */
export const GOALS: readonly Goal[] = [
  { id: 'terrace', name: 'The Terrace', x: PLATFORM.x, z: PLATFORM.z, r: 3.4, minY: 0.15 + PLATFORM.height + 0.2 },
  { id: 'rock-gate', name: 'The Rock Field gate', x: CRAWL_ENTRY.x, z: CRAWL_ENTRY.z, r: 5, minY: -100, missionOnly: true },
  { id: 'mud-shore', name: 'The shore', x: MUD_SHORE.x, z: MUD_SHORE.z, r: 6, minY: -100, missionOnly: true },
  { id: 'dead-car', name: 'The lost car', x: DEAD_CAR.x, z: DEAD_CAR.z, r: 6, minY: -100, missionOnly: true },
  { id: 'rock-far', name: 'The far side', x: CRAWL_FAR.x, z: CRAWL_FAR.z, r: 6, minY: -100, missionOnly: true },
];

export function reached(goal: Goal, x: number, y: number, z: number): boolean {
  return Math.hypot(x - goal.x, z - goal.z) <= goal.r && y >= goal.minY;
}

export function goalById(id: string): Goal | undefined {
  return GOALS.find((g) => g.id === id);
}

/** How long before the same goal can fire again, so one run is not celebrated twice. */
export const GOAL_COOLDOWN_MS = 12000;
