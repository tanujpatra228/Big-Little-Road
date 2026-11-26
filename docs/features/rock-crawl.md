# Rock Crawl, split vision and low range

Roadmap Step 2. The first mission that is built around two different players: one sees the way, the other has to be talked through it.

## How it plays

- Start **Rock Crawl** from the co-op panel (Tab). It needs 2 players.
- **Stage 1, meet at the gate:** both cars drive to the Rock Field gate, on the side of the field facing the house.
- **Stage 2, cross the rocks:** both cars get through to the far side.
- **The Scout sees the safe line**: purple arrows on the ground every 4 m, with a teal beam at every fifth mark (a checkpoint). Nobody else sees them.
- **Everyone else is in a dust cloud** while in the field (about 25 m of sight). They cannot see the line and barely see the boulders, so the Scout has to guide them: lead the way, and use the ping wheel (Q) to drop a "go here" beam where the Hauler should aim.
- **Stray from the line** (more than 3.6 m off it, for 1.4 s) and the car is put back at the last checkpoint, facing along the line. The room counts it as a reset, so it costs the "no resets" star. A brief clip of an edge is forgiven.
- **Low range (G)** for the Hauler and Relay: top speed x0.42 (about 5 m/s for the Hauler), engine force x1.6, steering lock x1.25. It is what makes tight gaps between boulders drivable. A badge on the HUD shows the gear. The Scout has no low range and is told so. Changing car puts you back in high.
- Stars: finish, under 5:00, no resets. Same results card and clock as the Terrace.

## Why it cannot be done alone

Starting needs 2 players, and both cars must reach each goal. A player who swaps between cars cannot do it either: the line is only visible while you are in the Scout, and the dust only clears for the Scout. One person would have to drive both cars through at once. With two players the roles are real: one reads, one drives blind.

## How it is built

- `shared/crawl.ts`, pure: `buildCrawlLine` (a path search over a 1 m grid with room for the widest car beside every tall boulder, forced through two bends 8 m either side of the straight way across so that driving straight is off the line, then straightened and cut into marks), `nearestOnLine`, `pointAt`, and `CrawlRun` (checkpoints and the lost rule, fed the time step). Because the line is worked out from the boulders it always exists and always fits, on every seed tested; every browser computes the same line.
- `shared/gear.ts`, pure: which roles have low range, the factors, the toggle. `Vehicle` applies them in `step` (`gear`, `toggleGear`) and has `placeAt` for sending a car to a checkpoint.
- `shared/goals.ts`: `rock-gate` and `rock-far`, marked `missionOnly` so they never fire in free play and the room ignores them if a client sends them by themselves.
- `shared/missions.ts`: the `rockcrawl` definition. Both stages are `reach` goals with `who: 'all'`.
- `client/game/crawl.ts`: builds the marks once (an instanced arrow mesh plus a few beams), shows them only to the Scout, fades the fog density up for everyone else inside the field, runs `CrawlRun` for this player's car and handles being sent back.

## Budget

No new network messages. The line, the marks, the dust and the lost rule are all worked out in each browser. The only traffic is the mission's existing `reach` and `reset` reports (rare, 1/20 of a request each). The path search runs once, when the mission first starts (about 2000 cells).

## Tested

- `tests/crawl.test.ts` (14 checks): deterministic; runs from the house side to the far side inside the field; evenly spaced marks; on 12 seeds it exists and keeps more than the Hauler's half width plus a margin from every tall boulder along its whole length; a car driving it is never sent back and banks checkpoints; wandering off sends it to the right checkpoint with the right heading; clipping an edge is forgiven; no repeat right after; nothing outside the field; cutting a bend does not skip a checkpoint.
- `tests/gear.test.ts`: roles, factors, and on the real physics: low range caps the Hauler's speed, reaches its speed sooner, turns at least as sharply at crawl speed, a Scout told to go low is unchanged, `placeAt` stands the car up and still.
- `tests/mission-defs.test.ts`: every mission only reaches goals that exist; Rock Crawl needs both cars at each stage.
- Real browsers (two players, real worker): both build the same 58 m line; the Scout has marks and clear air (fog 0.004), the Hauler has no marks and dust (fog 0.12); G puts the Hauler in low range with its badge and leaves the Scout in high with no badge; a Hauler placed 5.5 m off the line is sent back to the checkpoint with the toast and the room counts a reset; both cars at the far goal completes the mission with the results card (two stars, as the reset cost the third) and the dust clears.

## Not done

- Nothing makes the Hauler go slower in high range; low range is a tool, not a rule. If playtests show people never use it, the corridor can be narrowed or the dust made thicker.
- The dust does not hide the Hauler's own car or the HUD, only the world.
- Marks are on the ground only; a "this way" arrow for the Hauler comes from pings, not from the game.
- Only one authored field. Other zones can reuse `crawl.ts` with their own boulders.
