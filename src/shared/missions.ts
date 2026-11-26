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
  {
    id: 'rockcrawl',
    name: 'Rock Crawl',
    blurb: 'A field of boulders and a dust cloud. Only the Scout can see the safe line; the Hauler has to be talked through it in low range.',
    minPlayers: 2,
    parSeconds: 300,
    celebrate: 'rock-far',
    stages: [
      {
        id: 'gate',
        title: 'Meet at the gate',
        objectives: [{ id: 'reach-gate', kind: 'reach', goal: 'rock-gate', who: 'all', text: 'Both cars at the Rock Field gate (west of the house). Scout in the lead, Hauler behind.' }],
      },
      {
        id: 'crawl',
        title: 'Cross the rocks',
        objectives: [{ id: 'reach-far', kind: 'reach', goal: 'rock-far', who: 'all', text: 'Both cars through to the far side. Stray off the glowing line and you go back to the last checkpoint. Hauler: G is low range.' }],
      },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
