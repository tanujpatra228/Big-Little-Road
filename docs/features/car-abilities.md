# Car abilities: drift, jump, nitro

Status: decisions made (defaults accepted). Jump and nitro are built and live. Drift is next. Applies to all cars (Scout, Hauler, Relay, and the rescue car once revived). No characters: the cars are the characters (the Scout's driver figure was removed).

## What exists today

- Handbrake (C, moved off Space when jump arrived): applies brakes and cuts rear friction to 45%. This is a crude slide, not a drift.
- Per-surface grip, drag and top-speed caps; per-car affinity (`shared/surfaces.ts`, `shared/cars.ts`).
- Suspension bump stops (`maxWheelRise`), brakes tuned so cars do not flip, impact detection, brake lights, tyre squeal on braking.
- Tuning panel (`?tune`) and a flat-world speed harness for measuring behaviour in tests.

## Design rules (so these do not break the game)

1. Terrain must stay a puzzle. Tall boulders are 1.1 m or higher, rubble is under 0.3 m, hedges are walls. Jump apex is capped at 1.0 m for every car so tall boulders stay walls and rubble becomes hoppable. A test enforces the cap, including with nitro.
2. Nitro never beats the surface rule. Without nitro, no surface is faster than grass (tested today). With nitro every surface is scaled by the same factor, so mud and sand still cost speed.
3. Nothing may make cars flip more. Drift, jump landing and nitro turns are tested for roll-overs the same way braking is.
4. Cars stay different. Each ability has per-car tuning in `CarSpec`, not one shared feel.
5. Co-op first. Where an ability could be solo-powered, tie it to the team: nitro to the shared battery in missions (see below).
6. Lag tolerant. Abilities are local physics; the network only carries flags for visuals and sound.

## Drift

Goal: hold a controlled slide that keeps speed, looks great, and rewards skill.

- States: Grip, Drifting, Exit. Enter when speed is above 5 m/s and either the handbrake is tapped or steering is held hard past a slip threshold. Stay while slip angle is above about 10 degrees. Exit when slip angle falls below about 6 degrees or speed under 3.
- While drifting: rear grip drops smoothly with slip angle (not the current on/off 45%), a counter-steer assist turns the front wheels toward the velocity direction so the player steers the slide with the stick, drag is reduced a little so a drift does not bleed all speed, and slip angle is capped (so it never becomes a spin).
- Per car: Scout slides easily and far, Relay is medium with a roll-over guard, Hauler is heavy: shorter slides and tighter angle cap, closer to a controlled pivot.
- Surfaces: patio and gravel slide readily, grass medium, sand loose, mud and water almost none. Driven by the existing `SURFACE_PROPS.grip`.
- Reward: drifting charges the nitro meter (below). That is the skill loop: drift to earn boost.
- Feedback: squeal (extend the existing brake squeal to slip), tyre smoke and skid marks (art milestone G4), small camera swing, visible counter-steer on the wheels. Remote players see and hear it through a pose flag.
- Implementation: a pure `shared/drift.ts` that turns (speed, slip angle, input, car, surface) into per-wheel friction multipliers and a yaw-assist torque, applied in `Vehicle.step`. Tests: enters and exits cleanly, speed retention, slip cap, no roll-over on any car or surface.

## Jump

Goal: a quick hop that feels like a toy, usable for puzzles.

- Press to hop when at least 3 wheels are grounded (plus a 0.15 s coyote window). Hold briefly for a bigger hop (charge up to 0.5 s). Cooldown after landing.
- Upward impulse follows the chassis up vector blended with world up, so on a slope it pops forward instead of straight up.
- Light air assist: a small auto-level torque so landings land on wheels. It never rights a car that is already past 90 degrees, so flips still happen and the rescue mechanic still matters.
- Per car (apex, cooldown): Scout about 0.9 m, 0.8 s. Hauler about 0.5 m, 1.2 s, but with charge it can pop onto ledges. Relay about 1.0 m, 1.2 s. All capped at 1.0 m.
- Co-op: hop low obstacles and gaps, over rubble; with a teammate, clearing a ditch edge to attach a rope. It cannot clear a tall boulder.
- Network: none beyond the pose; dust puff and a spring sound locally. Landing already makes an impact sound.
- Tests: apex per car in range, cooldown enforced, no air jumps, Scout clears a 0.5 m ledge, no car clears a 1.2 m boulder (with or without nitro), landing never flips on flat ground.

## Nitro

Goal: a short, exciting burst with a cost.

- Hold to boost: engine force up about 60 to 80%, top speed up about 35%, steering authority falloff unchanged (so it stays controllable). Effects: FOV kick, rear flame and glow, whoosh and engine pitch up.
- Per car: Scout biggest speed gain, Hauler a torque boost (more force, little top speed, better climbing), Relay balanced.
- Source of power (decision needed, recommendation below):
  - A: personal tank, about 4 s when full, refilled by drifting and slow passive regen.
  - B: drains the shared team battery (the doc's Power pillar), so boosting is a team decision.
  - Recommendation: A in Free Roam and Race, B in Challenge missions, behind one `PowerSource` interface. Driving stays fun solo and in a mixed room, while missions keep the shared-battery negotiation.
- Network: the pose frame gains a small flag field (nitro, drift, braking) so remote cars show flames and smoke and play the right sound. For B the client sends boost start and stop, and the room computes drain from its own clock, as the design says, so nobody streams a meter.
- Tests: speed gain per car and surface, caps hold (nitro scaled, never above 1.4 times the no-nitro surface speed), no flips in boosted turns, meter drain and refill rates, tank empty stops the boost.

## Controls (recommended, remappable)

| Action | Keyboard | Gamepad |
|---|---|---|
| Drift / handbrake | C | X |
| Nitro | Shift (hold) | RB or LB |
| Jump | Space (tap) | A |
| Horn | H (unchanged) | D-pad up |

Decided: Space jumps, C is the handbrake and later the drift key, Shift is nitro. Bindings live in `client/game/input.ts`.

## Order of work

1. Ability framework: per-car ability tuning in `CarSpec`, input bindings, HUD meter, a pure state machine per ability, tests. One slice.
2. Jump (simplest, high fun, useful for puzzles). One slice.
3. Nitro with the personal tank, effects, audio, pose flags. One slice.
4. Drift, with at least one tuning pass from real playtests. Two slices.
5. Shared-battery nitro and mission hooks with Phase 3.
6. Balance pass with outside testers, using the `?tune` panel extended with ability numbers.

## Risks

- Balance versus puzzles: abilities can trivialise missions. The apex cap, the surface rule and "solo test" in the puzzle rules are the guard rails.
- The yard is 160 wide. Boosted, a car crosses it in under 6 seconds. We may need a bigger map or lower boosted top speeds. Decide after the first nitro playtest.
- Pose rate: boosted cars move faster, so the smoothing error and extrapolation matter more. Likely raise the send rate above 20 m/s. Re-check the message budget when we do.
- Drift feel is the hardest to get right and needs real hands. Plan on iteration.
- Audio and effects depend on art milestone G4 (particles) and the audio doc's open items.

## Decisions (taken with the defaults)

1. Space jumps; the handbrake moved to C.
2. Nitro: personal tank for now; shared battery in missions comes with Phase 3.
3. Jump: tap only. Hold-to-charge can come later for the Hauler if puzzles need it.
4. Drift: no score for now, only the nitro charge later.

## Jump: as built

- Pure rules in `shared/jump.ts` (`JumpState`, `jumpSpeed`, `jumpImpulse`, `airLevel`), applied in `Vehicle.step`. Press Space: fires when at least 3 wheels touch the ground (0.15 s coyote time after an edge, 0.12 s press buffer before landing), no air hops, and a cooldown that only runs on the ground after landing.
- Apex per car (`jumpApex`, `jumpCooldown` in `CarSpec`): Scout 0.55 m / 0.8 s, Hauler 0.35 m / 1.2 s, Relay 0.5 m / 1.2 s. Measured in physics tests: standing and at full speed the hop rises to the tuned height, and the car lands upright on flat ground.
- The vertical launch speed is the same on any slope; the chassis up vector only tilts it a little so it pops forward on a slope. In the air a light levelling torque helps the car land on its wheels. It gives up past 90 degrees, so real flips still happen.
- **Lesson that changed the numbers:** the first tuning (0.9 / 0.5 / 0.95 m) let the Scout hop over a 1.2 m wall. What matters is not the apex but apex plus the belly clearance (about 0.35 m). The rule is now measured directly: `tests/jump.test.ts` drives every car at a 1.1 m block at approach speeds 4, 7 and 12 m/s with seven hop timings, and none gets over. `tests/platform.test.ts` does the same against the Terrace wall from four sides. What a hop does add: Relay goes from 0.5 m driveable to about 1.0 m, Scout from 0.7 to 0.9, and rubble (under 0.3 m) is trivial.
- Network: nothing new. A hop is local physics; other players see it in the pose stream (10 Hz, so a 0.6 s hop is sampled about six times and smoothed). Sound is a local spring chirp.
- Not done: a dust puff on takeoff and landing (waits for art milestone G4 particles), a cooldown hint in the HUD.

## Nitro: as built

- Hold Shift (gamepad RB or LB) while on the throttle. Pure rules in `shared/nitro.ts` (`NitroTank`, `boostFactor`), applied in `Vehicle.step`. A personal tank: 4 s of boost when full, drains only while boosting with throttle down, refills at 1/16 per second after a 1 s pause, and once empty stays off until a fifth is back. The tank survives a car switch.
- The boost fades in over a quarter of a second. The extra engine force applies only while it runs (so tapping is not a free trick); the raised speed limit fades out over about 0.7 s afterwards, so it never snaps back.
- Per car (`nitroForce`, `nitroTop` in `CarSpec`), measured on flat grass: Scout 20.7 to 28.5 m/s (the big speed gain), Relay 18.0 to 23.1, Hauler 11.4 to 13.0 on grass but 9.5 to 11.8 in mud (the torque boost, built for climbing and soft ground).
- **The surface rule, stated precisely:** boosted speed never exceeds the surface's own speed limit times the car's boost (itself capped at 1.4 globally), and no surface ever beats grass-with-nitro. My first test wording ("never above 1.4 times the unboosted speed") was wrong: in mud a car is limited by drag, not by its top-speed cap, so extra engine force lifts it by more than 1.4 times of a very small number (Scout 4.1 to 6.3 m/s).
- Tests (`tests/nitro.test.ts`): tank drain, lockout, refill, fade; per car on five surfaces; acceleration from standstill; no spend without throttle; an empty tank returns the car to normal speed; a hard boosted turn at speed in both directions does not flip.
- Feedback: twin exhaust flames with halos, FOV widens by up to 9 degrees and the camera drops back, engine pitch and level rise, a rush-of-air sound when it starts, and a meter above the speed readout (yellow while running, red under 20%).
- Network: one tiny `nitro` message on start and on stop (`{type:'nitro', on}`), relayed like the horn, so other players see the flame and hear a quieter, panned whoosh. Cost: two messages per boost, each 1/20 of a Durable Object request. Poses are unchanged.
- Known risk, as predicted: a boosted Scout crosses the 160 m yard in about 6 s. Revisit after a playtest (bigger map or lower boosted top speed).
- Not done: shared-battery nitro for missions (Phase 3), the drift charge (arrives with drift), a boosted-landing or boost-while-towing check.

## Open questions for the owner (answered above)

1. Controls: keep Space as handbrake and put jump on E, or Space as jump?
2. Nitro source: personal tank in Free Roam and Race, shared battery in missions. OK?
3. Jump: tap only, or tap plus hold-to-charge?
4. Should drifting give score or only charge nitro?
