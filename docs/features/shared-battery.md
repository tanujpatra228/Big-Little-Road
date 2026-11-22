# Shared battery

Phase 3, item 1 of the plan, and on the "do not cut" list. One power meter for the whole team instead of one per car, so every boost is something the others do not get.

## How it plays

- **Alone** (not in a room), nitro uses a personal tank as before: 4 s of boost, refilled slowly.
- **In a room**, the nitro bar becomes the **team battery**. It is tinted blue-green and labelled "TEAM BATTERY", with how many cars are draining it right now ("TEAM BATTERY, 2 boosting"). Everyone in the room sees the same level.
- **One full battery is 10 s of boost for one car.** Two cars boosting together empty it in 5 s, three in 3.3 s, four in 2.5 s. Nobody is forced to share; every second you boost is a second less for the others.
- **It refills slowly**: 1.5 s after the last boost stops it starts, and it takes 30 s to go from empty to full.
- **Running dry cuts everyone off at once**, even if they are still holding the key, and nobody can boost until the battery is back to 15% (about 6 s after the last boost). This is the moment that makes it a team decision.
- Late joiners are told the current level in their welcome message. A player who leaves while boosting stops draining immediately.

## How it is built

- `shared/battery.ts`, pure and tested (`tests/battery.test.ts`, 19 checks): `advance(snapshot, seconds)` moves the battery forward exactly, across any change inside the step (running dry part way through, the refill delay ending, the lockout lifting); it is additive, so two short steps equal one long one (checked on 300 random cases). `SharedBattery` is the room's side (who is boosting, from which time). `BatteryView` is a player's side.
- **The room keeps the books from its own clock, and nothing ticks.** There is no timer and no alarm: the level is only worked out when somebody starts or stops boosting. The room then sends everyone a snapshot: level (thousandths), how many cars are draining it, how long until it starts refilling, and whether it is locked out. Each browser **extrapolates** that locally, so no meter is ever streamed. When the battery runs dry nobody needs a message either: every browser computes the same moment and stops its own boost.
- **No new message from the player.** The nitro flag the client already sent for the flame (`{type:'nitro', on}`) is what the room banks. If the battery is empty or locked, the room does not show the flame to others and sends the asker the current snapshot.
- Your own boost shows on your bar at once (`BatteryView.selfBoost`) instead of waiting a round trip, and the room's next snapshot replaces the guess.
- The nitro tank (`shared/nitro.ts`) can take a shared source: then it is only a window onto the team battery (the level is whatever the team has; nothing drains or refills locally) and the boost, fade and flames work exactly as before. The source is kept across a car switch.
- Not saved across a hibernation: a room that slept long enough has refilled anyway.

## Budget note (house rule)

No new messages from players: it reuses the nitro flag that was already sent (2 per boost). Each change sends one small outgoing `battery` message to everyone in the room, and outgoing messages are free on the plan. Incoming cost is unchanged at 1/20 of a Durable Object request per boost start or stop. No server timers, no alarms, no storage writes.

## Tested

- Pure rules, room logic (drain, doubling, halving, dry lockout, refusal while locked, leaving while boosting, welcome snapshot, relies on the clock it is given), the shared nitro tank, and `scripts/net-smoke.mjs` against the real Worker runtime (full battery in the welcome, boosting announced to everyone, second booster counted, level from the room clock, late joiner told the level, count drops on stop, refill delay starts, a booster who disconnects is dropped): all pass.
- Two real browsers in one room: alone there is no team label; in a room both see the same bar and label; the watcher's bar drains while the other car boosts; **two cars boosting drained the shared battery at 0.200 per second (double the 0.100 of one car)**; when it ran dry both cars were cut off while still holding their keys, the lockout lifted after the refill, and boosting worked again. No console errors.

## Tuning knobs (all in `shared/battery.ts`)

`CAPACITY_SECONDS` (10), `REGEN_PER_SECOND` (1/30), `REGEN_DELAY` (1.5 s), `RESTART_LEVEL` (0.15). These are guesses to be tuned by feel: if boosting is never a decision, shrink the capacity or slow the refill; if it is always empty, do the opposite.

## Not done

- The winch and other abilities do not spend from it yet (the point of making it shared).
- Drift charging it (planned in the abilities doc).
- A per-player breakdown ("Ada used most of it") or a ping when it is low; the ping wheel's Low battery message is the manual way for now.
- Making the capacity depend on how many players are in the room.
