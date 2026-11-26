import { CRAWL_ENTRY, CRAWL_FAR } from './crawl';
import { PLATFORM } from './terrain';

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

/** The terrace: reach the top of the platform, which only the plank-ramp gets you onto. */
export const GOALS: readonly Goal[] = [
  { id: 'terrace', name: 'The Terrace', x: PLATFORM.x, z: PLATFORM.z, r: 3.4, minY: 0.15 + PLATFORM.height + 0.2 },
  { id: 'rock-gate', name: 'The Rock Field gate', x: CRAWL_ENTRY.x, z: CRAWL_ENTRY.z, r: 5, minY: -100, missionOnly: true },
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
