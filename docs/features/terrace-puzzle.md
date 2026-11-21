# The Terrace: the first puzzle

A round brick platform stands on the lawn east of the patio, with a glowing beacon on top. Its wall is taller than anything a car can hop (1.3 m). The only way up is a ramp, and the only ramp is the plank, which two cars have to carry there.

## How to play

1. Drive to the plank (it lies on the lawn just east of the patio, around 17 m east of the spawn). Get near an end and press **F** to hook it. A prompt appears when you are close.
2. A second player hooks the other end. The plank hangs between you. A convoy works: the car in front holds it by its tail, the car behind holds it by its nose, like carrying a stretcher. Side by side works too.
3. Drive to the platform wall and keep the rope slack: it pulls gently if you drift more than about half a metre from the ideal spacing (about 5 m between the hooks).
4. Near the wall a green ghost plank appears, showing where it will lean if you let go now, and the prompt says so. Press **F** (both of you) to set it down: it snaps into a proper ramp with its far end on the platform top.
5. Drive up the plank to the beacon. Everyone gets fireworks, a fanfare, and a message saying who made it.

**T** returns the plank to where it started if it ends up somewhere useless. Working alone, a single car can hook one end and drag the plank behind it, but cannot lean it on the wall by itself without a partner holding the other end, so the puzzle needs two cars.

## What makes it hold together

- **No cheating the wall.** The heightfield edge is only a steep bevel, and a fast car hits a bevel like a ramp and flies up it. So there is also a ring of vertical wall colliders (`PLATFORM_WALL`, built in `physics/world.ts`). A test drives every car at full throttle at the wall from 8 directions and asserts none ever reaches the top.
- **The plank really is a ramp.** Its resting pose follows the terrain slope between its two ends (`plankPlacement`, shared by the renderer and the collider and tested against three.js's own rotation maths). It is 1.9 m wide so a car can drive along it. Tests: every car drives up a perfectly placed plank, and up a plank set down crookedly and snapped.
- **The snap exists because geometry demands it.** The lead car stops at the wall, and the plank hangs behind the lead car, so the cars alone could never get its far end onto the platform top. `snapRamp` leans the plank radially, 0.4 m onto the top, if it is set down near the wall and roughly pointing at it (within 0.7 rad, within about 11 m of the platform centre). The angle around the platform is whatever the players chose.
- **The wall top is a hair under the plank surface where the plank crosses it**, so a car on the plank rolls over the wall.
- **Platform and apron.** The ground round the platform is levelled so the ramp angle is predictable (about 15 to 18 degrees). The terrain resolution doubled to 257 points (0.625 m cells) so the platform edge is crisp.
- **Goal rule** (`shared/goals.ts`): the car's centre must be within 3.4 m of the platform centre and above 1.65 m, so driving past below does not count.

## Multiplayer

- The room relays `goal` (to everyone, with who reached it, at most once per 12 s) and `reset` (only works if nobody holds the plank). Fireworks and fanfare run on every client.
- Alone, the same logic runs locally, so a single player can hook the plank and see the preview, and reaching the beacon celebrates.
- Verified in two real browsers: both cars hook, the carried plank cannot reach the top, the ghost and prompt appear, letting go snaps the plank to the same pose in both browsers, one car drives up the ramp, both players see the celebration with the right name.

## Tuning knobs

`PLATFORM` (position, radius, height) in `shared/terrain.ts`; `PLANK` (length, width) and the snap constants in `shared/tether.ts`; `GOALS` in `shared/goals.ts`; rope stiffness and damping in `shared/tether.ts` (tested stable under 600 ms of delay).

## Known limits

- When one player hooks an end, the plank swings over to hang from their tail at once (a visible jump of up to about two metres). The other player then drives to the free end. Smoothing that swing is polish.
- The week-4 gate (two real people carrying the plank at 150 ms and it feeling good) is still a human test: add `?lag=150` to the link.
- The beacon and wall are generated art, in the toy style. A real hero prop would be nicer later.
- One goal, one plank. More props (a hose river to bridge, a battery to carry) are the next missions.
