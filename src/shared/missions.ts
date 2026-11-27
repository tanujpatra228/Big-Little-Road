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
  {
    id: 'deadsignal',
    name: 'Dead Signal',
    blurb: 'A lost car sits far out on the lawn, past the base radio. Run a radio link out to it, drive out, and charge its flat battery from the Relay truck.',
    minPlayers: 2,
    parSeconds: 360,
    celebrate: 'dead-car',
    rules: { signal: true },
    stages: [
      {
        id: 'link',
        title: 'Run a radio link',
        objectives: [{ id: 'far-linked', kind: 'flag', text: 'Get radio coverage to the lost car, far out to the north east: put beacons down (4-9 pick, E drop) and park a Relay truck as a link' }],
      },
      {
        id: 'reach',
        title: 'Find the lost car',
        objectives: [{ id: 'reach-dead', kind: 'reach', goal: 'dead-car', who: 'any', text: 'Drive a car out to it. You will lose control without signal, so keep the link up' }],
      },
      {
        id: 'revive',
        title: 'Charge it',
        objectives: [{ id: 'car-revived', kind: 'flag', text: 'The Relay truck (key 3) parks next to it and charges it (B)' }],
      },
    ],
  },
  {
    id: 'mudbog',
    name: 'Mud Bog Rescue',
    blurb: 'The middle of the bog is a trap. Get a car stuck in it on purpose, then the Hauler winches it out and hauls it to the shore. The winch spends the team battery.',
    minPlayers: 2,
    parSeconds: 300,
    celebrate: 'mud-shore',
    stages: [
      {
        id: 'sink',
        title: 'Get stuck',
        objectives: [{ id: 'car-stuck', kind: 'flag', text: 'A car drives into the middle of the mud bog (west of the house) and sinks. Stay put until it is stuck' }],
      },
      {
        id: 'hook',
        title: 'Hook the winch',
        objectives: [{ id: 'winch-on', kind: 'flag', text: 'The Hauler (key 2) parks on firm ground within 25 m and hooks the stuck car (Z)' }],
      },
      {
        id: 'free',
        title: 'Reel it out',
        objectives: [{ id: 'freed-by-winch', kind: 'flag', text: 'Keep reeling until the car comes free. The winch drains the team battery, so the Relay (B) may need to top it up' }],
      },
      {
        id: 'shore',
        title: 'Haul it to the shore',
        objectives: [{ id: 'reach-shore', kind: 'reach', goal: 'mud-shore', who: 'all', text: 'Both cars on firm ground at the shore, on the house side of the bog' }],
      },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
