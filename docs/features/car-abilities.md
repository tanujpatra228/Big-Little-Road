# Car abilities: drift, jump, nitro

Status: planned, not started. Applies to all cars (Scout, Hauler, Relay, and the rescue car once revived). No characters: the cars are the characters (the Scout's driver figure was removed).

## What exists today

- Handbrake (Space): applies brakes and cuts rear friction to 45%. This is a crude slide, not a drift.
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
| Drift / handbrake | Space (unchanged) | X |
| Nitro | Shift (hold) | RB or LB |
| Jump | E | A |
| Horn | H (unchanged) | D-pad up |

Open question: if you would rather have Space as jump (the most common convention), handbrake moves to Shift or C. Bindings will live in one table, so this is a one-line change.

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

## Open questions for the owner

1. Controls: keep Space as handbrake and put jump on E, or Space as jump?
2. Nitro source: personal tank in Free Roam and Race, shared battery in missions. OK?
3. Jump: tap only, or tap plus hold-to-charge?
4. Should drifting give score or only charge nitro?
