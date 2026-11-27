# Dead Signal, beacons and the Relay's charge

Roadmap Step 4. The radio system finally has a job. A lost car sits far out on the lawn, past the base radio. The crew has to run a radio link out to it, drive out, and charge its flat battery from the Relay truck.

## How it plays

- Start **Dead Signal** from the co-op panel (Tab). It needs 2 players and **turns the room's radio range on by itself**; it goes back to what it was when the mission ends.
- **Stage 1, run a radio link:** get coverage to the lost car (it sits about 87 m from the base, north east, on the lawn). Use **beacons** from the toolbox (keys 4 to 9 pick a slot, E drops one in front of your car) and/or park a **Relay truck** as a link. The step completes when the signal at the lost car is above 25%.
- **Stage 2, find the lost car:** drive a car out to it. Without signal your throttle is cut, so the link has to hold.
- **Stage 3, charge it:** the **Relay truck** (key 3) parks within 9 m of it and presses **B**. The lost car wakes up (its red light goes green) and the mission is complete.
- Stars: finish, under 6:00, no resets. Same checklist, clock and results card as the other missions.

## Beacons (the toolbox item gets its job)

- A **placed beacon is a small radio source: 30 m**, against 48 m for the base and 38 m for a Relay. Like a Relay it only works if it is **linked**: within reach of the base or of another linked source. Links chain, so base, beacon, beacon, car.
- It is drawn on the ground with a teal ring (dim if it is not linked to anything, so you can see a broken chain).
- A beacon is cheap and always there (the toolbox starts with 2) but it cannot move and reaches less. A Relay truck reaches farther and can drive, but is also a car somebody has to drive.
- What it takes to reach the lost car (tests): the base alone, one Relay alone, or one beacon alone cannot. **Two beacons, a Relay and a beacon, or two Relays** do.

## The Relay's charge (B)

- **Relay truck only.** One press tops up the **team battery by 30%**, for everyone, and lifts a lockout if it brings the battery back above the restart level. Cooldown **20 s** per Relay. Everyone is told who charged it.
- This is the Relay's reason to exist at 2 players: a Relay that is parked as a link still helps the team, and a Relay that comes along keeps the nitro going.
- The room checks it: only a Relay, and not more often than the cooldown (a refusal tells the sender how many seconds remain). The Relay says where it is in the request: a parked car sends no poses and a room that slept has forgotten them, so the room's own idea of its position would not do (a browser run found this).
- Alone there is no team battery, so the key just says so.

## Teammates' link status

With radio range on, a small list under the signal bars shows each teammate's link: percent when fine, amber when weak, red and blinking when they have no signal. It is worked out from their drawn positions, so it costs nothing on the network.

## How it is built

- `shared/signal.ts`: a source now has an optional `range` (beacons carry `BEACON_RANGE`); linking uses the range of the source already linked. Plain Relays are unchanged.
- `shared/battery.ts`: `SharedBattery.topUp`, `CHARGE_AMOUNT` and `CHARGE_COOLDOWN`.
- Room: a `charge` message; the room keeps each Relay's last charge on its own clock (not saved) and answers everyone with who and where, plus the usual battery snapshot.
- `shared/goals.ts` and `shared/missions.ts`: the `dead-car` goal and the `deadsignal` mission (flags `far-linked` and `car-revived`, a reach, and `rules: {signal: true}`).
- Client: `game/signal.ts` (beacons as sources, rings, `strengthAt`, `team`), `render/dead-car.ts` (the rescue-car model, grey with a blinking red lamp, green once charged), `game/deadsignal.ts`.

## Budget

A beacon drop, a pick up or a charge is one incoming message each (1/20 of a free-plan request), rare and by hand. Beacons add one small storage write per drop or pick up (already counted for the toolbox). The charge itself writes nothing: the battery and the cooldown are in memory. Signal strength, the rings and teammates' links are computed in each browser. No timers.

## Tested

- Pure: beacons as sources (range, chaining, an unlinked beacon is silent, Relay and beacon link each other, two beacons reach the lost car), the battery top-up (adds, caps at full, lifts a lockout, a small charge does not), the mission and goal definitions (the lost car is inside the yard and past the base radio; one Relay or one beacon alone cannot cover it).
- Room: a Relay's charge reaches everyone with its position and tops the battery up, a Scout is refused (only it is told), the cooldown tells how long, a player who turns into a Relay can charge.
- Real worker (CI): a Scout cannot charge, a Relay can, a second press is refused with a wait, Dead Signal turns the radio rule on and ending it puts it back, and a link report moves the stage.
- Browsers (two players, real worker, Scout and Relay): the mission starts with the radio rule on and the lost car showing, with no coverage at it; A drops two beacons (B sees both) and coverage at the lost car goes from 0 to 44%; the link step completes for both; A reaches the lost car with 57% signal (stage 3); B, the Relay, parks beside it and presses B: the car wakes, the mission completes with three stars (1:14), and the radio rule goes back to off. The teammate list shows "NO SIGNAL" for a teammate driven out of range. A run found two bugs on the way: the charge location was read from the room's last pose frame (a parked car sends none), and my new HUD class clashed with the team battery bar's own `team` class and would have hidden it; both are fixed.

## Not done

- A Relay that is out of range still charges (the room does not check signal for it).
- The lost car is a marker for the mission: it is not solid and cannot be driven.
- No minimap, so coverage is read from the rings on the ground and the signal bars.
- Beacons do not carry signal to the plank or props.
