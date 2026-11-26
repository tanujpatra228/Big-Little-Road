import type { MissionDef } from './mission-logic';

/**
 * Every mission, as data. The runtime (mission-logic.ts) knows nothing about any one of them, so
 * adding a mission means adding an entry here and teaching the game when its objectives are met.
 */
export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'terrace',
    name: 'The Terrace',
    blurb: 'A walled platform, and the only way up is a plank. Two cars carry it over and lean it on the wall.',
    minPlayers: 2,
    parSeconds: 240,
    celebrate: 'terrace',
    stages: [
      {
        id: 'hook',
        title: 'Hook the plank',
        objectives: [{ id: 'plank-held', kind: 'flag', text: 'Hook both ends of the plank, one car on each end (F)' }],
      },
      {
        id: 'ramp',
        title: 'Make a ramp',
        objectives: [{ id: 'plank-ramp', kind: 'flag', text: 'Carry it to the Terrace wall and set it down as a ramp (F, both)' }],
      },
      {
        id: 'climb',
        title: 'Climb up',
        objectives: [{ id: 'reach-terrace', kind: 'reach', goal: 'terrace', who: 'any', text: 'Drive a car up the ramp onto the Terrace' }],
      },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
