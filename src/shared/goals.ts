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
}

/** The terrace: reach the top of the platform, which only the plank-ramp gets you onto. */
export const GOALS: readonly Goal[] = [
  { id: 'terrace', name: 'The Terrace', x: PLATFORM.x, z: PLATFORM.z, r: 3.4, minY: 0.15 + PLATFORM.height + 0.2 },
];

export function reached(goal: Goal, x: number, y: number, z: number): boolean {
  return Math.hypot(x - goal.x, z - goal.z) <= goal.r && y >= goal.minY;
}

export function goalById(id: string): Goal | undefined {
  return GOALS.find((g) => g.id === id);
}

/** How long before the same goal can fire again, so one run is not celebrated twice. */
export const GOAL_COOLDOWN_MS = 12000;
