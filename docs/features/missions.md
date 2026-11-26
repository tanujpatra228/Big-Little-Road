# Mission runtime

Roadmap Step 1. A mission is data, not code: stages made of objectives, a par time, and optional room rules. The room runs it, everyone sees the same checklist, and the Terrace is mission 1.

## How it plays

- The co-op panel (Tab) lists missions. **Start** needs the mission's minimum players (the Terrace needs 2), so alone the button reads "needs 2 players" and is disabled.
- Starting resets the props, shows a checklist (current, todo, done) and a clock for everyone, and toasts who started it.
- Objectives complete when the cars do the thing. The Terrace: hook the plank (both ends held), carry it to the wall and set it down as a ramp, then reach the terrace.
- Finish and you get a results card: time, resets, stars. Stars: finish, finish under par (240 s), and finish with no resets.
- "End the mission" aborts it for everyone. When the last player leaves, the mission is cleared.
- A mission may switch room rules while it runs (for example the signal web) and they are restored afterwards.

## How it is built

- `shared/mission-logic.ts`, pure and immutable: `startMission`, `report`, `playerLeft`, `addReset`, `starsFor`, `toInfo`. Time is `elapsedMs` on the wire, so no clock agreement between browsers is needed.
- `shared/missions.ts`: the definitions (`MISSIONS`, `missionById`). Objective kinds today: `reach` (a goal zone, who: any/all) and `flag` (a named condition the client evaluates).
- The room (`room-logic.ts`) holds the authoritative state and **persists it** with players, props and rules, because a room is evicted after about 10 s idle and a mission in progress must survive that.
- Clients report objectives they see (`reach`, `flag`). Reports are idempotent and per stage, and are resent every 3 s until the room agrees, so a dropped message cannot stall a run.
- `client/game/missions.ts` evaluates flags (plank held, plank set as a ramp via `isRampPose`) and the goal zone; `client/ui/mission-panel.ts` draws it.

## Budget

Mission ops are rare messages. Each incoming message is 1/20 of a free-plan request, plus one small storage write when the state changes. No timers or alarms: the room only works when a message arrives.

## Tested

- `tests/mission-logic.test.ts` (20 checks): stage order, idempotent reports, `all` versus `any`, players leaving, stars and par, reset counting.
- Room, protocol and `isRampPose` tests, plus `scripts/net-smoke.mjs` against a real worker including persistence across hibernation.
- Two real browsers play the Terrace: start from one panel, both hook the plank, set it as a ramp, climb, results card, clock frozen, button back.

## Not done

- Only `reach` and `flag` objectives. Timed holds, collect-N and carry-to-zone come with the missions that need them (Steps 2 to 4).
- No leaderboard or saved best times; the results card is per run.
