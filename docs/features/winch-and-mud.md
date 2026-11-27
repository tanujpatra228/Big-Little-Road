# The winch, the mud trap and Mud Bog Rescue

Roadmap Step 5. The middle of the mud bog is now a trap, the Hauler has a winch, and reeling spends the team battery, so the battery finally matters for more than nitro.

## How it plays

- **The mud trap.** The middle of the bog (8 m around its centre, west of the house) is deep. A car that stays in it **sinks**: the drive weakens as it sinks, and after a few seconds it is **stuck** (Scout 2.2 s, Relay 3 s, Hauler 4.4 s, whose wide tyres hold on twice as long). A stuck car creeps at under 0.5 m/s with almost no drive. A banner says so and a "tow me" ping goes to the team. Driving through quickly does not stick: sinking recovers twice as fast outside the deep part.
- **Getting out, three ways.** (1) Hold the throttle and **dig out** slowly (Hauler 8 s, Relay 12 s, Scout 14 s), so nobody is ever stuck for good. (2) A **winch** frees it five times faster. (3) Being hauled out of the deep part frees it at once. After being freed a car cannot sink again for 6 s, so it can drive off.
- **The winch (Z, Hauler only).** Z hooks the nearest car or **stake** within 25 m and starts reeling. A hooked car is pulled toward the Hauler (7 m/s squared, under 1 g), a stake pulls the Hauler toward itself. Z again lets go. It stops by itself when the two are within 4 m, when the cable is stretched past 37 m, or when the **team battery runs dry**.
- **The winch spends the team battery** like a boost: one winch is one drain (10 s for a full battery), shared with nitro. The Relay's charge (B) tops it up, which gives the Relay a job mid-rescue. Everyone sees one more "boosting".
- **Anchors.** Stakes from the toolbox work as anchors: a stuck Hauler can put a stake in on firm ground and winch itself out. (Roots are not done.)
- **Mud Bog Rescue** (co-op panel, 2 players): get a car stuck on purpose; the Hauler parks on firm ground and hooks it; reel it out; both cars to the shore on the house side. Stars: finish, under 5:00, no resets.

## How it is built

- `shared/mud.ts`, pure: `MudState` (sinking, stuck, dig progress, freed by winch), the constants, `inDeepMud`.
- `shared/winch.ts`, pure: `chooseTarget` (nearest car or stake in reach, a car wins a tie), `pullToward`, `reelDone`, `cableSnapped`.
- Room: a `winch` message (`start` with a target, `stop`). The room checks the sender is a Hauler, the target is another player or a placed **stake** (a beacon is not an anchor), and that the battery is not empty, then books the drain under the battery's own bookkeeping (`winch:<id>`) and tells everyone. It lets go when the Hauler changes car, leaves, the hooked player leaves, or the stake is picked up. Winches live in memory only: they last seconds.
- Client: `game/winch.ts` (Z, cable, the pull, the stop rules, the prompt), `game/mud.ts` (runs `MudState` for your own car and sets `Vehicle.driveScale` and `speedCap`), `render/winch-cable.ts`.
- **Each browser pulls only its own car**, from where the other end is drawn (the same rule as the plank): the hooked player's browser applies the pull toward the Hauler; the Hauler's browser applies the pull toward a stake. Nobody fights over a shared object. The Hauler is not pulled back by the load (no reaction force).
- The mission flags are read from each car's own state (`car-stuck`, `winch-on`, `freed-by-winch`).

## Budget

A winch is two incoming messages (start, stop), 1/20 of a free-plan request each, no storage write (winches are in memory). The battery snapshot that goes with each is outgoing and free. The mud trap, the pull and the cable are worked out in each browser. No timers.

## Tested

- `tests/mud.test.ts` (10): the deep mud is mud on the ground; sink times per car; passing through does not stick; the drive weakens; digging out; the Hauler digs faster; a winch frees faster and is credited; being hauled clear frees at once; the grace after; reset.
- `tests/winch.test.ts` (10): target choice (nearest, car wins a tie, range, not yourself), the pull, done and snap.
- Room (9): hook and drain, stop, Hauler only, bad targets, stakes work and a beacon does not, picking up the stake lets go, empty battery refuses, re-hooking keeps one drain, changing car / leaving lets go. Protocol (2). Mission and goal definitions (the shore is firm ground, away from the deep mud, on the house side).
- Real worker (CI): a Scout is refused, a bad target is refused, a Hauler hooks and the battery shows one drain, stopping shows the cost, the hooked player leaving lets go.
- Browsers: see the run notes in the commit.

## Not done

- No reaction force on the Hauler and no rope physics (it is a straight cable): see the plank for the other model.
- Roots as anchors, car trains (a winch pulling a car that is itself winching), and a visible sink (the car does not lower into the mud; the banner and the weakened drive carry it).
- The deep mud is not drawn differently from the rest of the bog yet.
- The car you are towing is not slowed by the Hauler's own movement, and a long drag over rough ground can flip it.
