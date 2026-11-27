# The handbrake drift

Roadmap Step 6, second half. A held slide that keeps its speed, looks good, and (alone) charges the nitro tank. It follows the Drift section of `car-abilities.md`.

## How it plays

- **Start a drift:** above 5 m/s, tap or hold the **handbrake (C)** while steering, or steer hard until the car is sliding past about 10 degrees. Driving normally, or taking a gentle bend, never starts one.
- **While it lasts:** the rear tyres let go smoothly as the slide deepens (never below a floor, and they grip again near the cap, so it does not become a spin), the **front wheels counter-steer toward where the car is going** (you steer the slide with the stick, your own steering counts for about half), and drag is a little lower so the slide does not eat all the speed.
- **End:** let go of the handbrake and steer straight and it straightens out by itself (it ends once the slide falls below about 6 degrees, or the speed drops under 3 m/s, or the car is airborne for more than 0.3 s).
- **Per car.** The Scout slides easily and far (up to about 40 degrees, a deep slide that costs speed), the Relay is in between (about 20 degrees), the Hauler is heavy: a short controlled pivot (about 15 degrees) that keeps over 90% of its speed.
- **Surfaces.** Paving, gravel and grass slide readily; sand slides (loosely); **mud and water never become a drift**. (The surface's own grip decides, not the Hauler's good mud tyres.)
- **Feedback.** The squeal now follows a slide as well as hard braking; tyre smoke and tyre marks (from the effects) come from the slide; the nitro tank fills while you drift (alone only, see below).
- **Reward.** A full-depth drift charges the personal nitro tank at 10% a second for the Scout, 8% Relay, 6% Hauler, so the loop is drift to earn boost. **In a room the nitro bar is the team battery and a drift does not charge it** (that would be a message a second); the Relay's charge is the team's way to refill it.

## How it is built

- `shared/drift.ts`, pure: `slipAngle` (nose to velocity, signed), the per-car `DRIFT` tuning, and `DriftState`, which turns speed, slip, steering, handbrake, grounded, surface grip and direction into rear grip, a front-wheel assist, a drag factor, a spin damper and an intensity. A car with its handbrake on but no slide gets the old "rear tyres at 45% grip" behaviour (lower for the Hauler, so it pivots), so a tap still kicks the tail out.
- `Vehicle.step` applies it: the rear wheels' friction and side stiffness follow the drift's rear grip, the front wheels get the assist, the handbrake brakes at 35% while drifting (it is there to start the slide, not to stop the car), and a spin damper plus a nudge back toward the velocity act beyond the slip cap. The surface used to decide whether a drift can start is the surface's own grip, before the car's affinity.
- Nothing is sent over the network: remote cars show their slide through their normal pose.

## Budget

None: all local physics, no messages.

## Tested

- `tests/drift.test.ts` (36): slip angle signs; a drift does not start slowly, airborne, on mud or water, or in reverse; the handbrake and hard steering start it, a gentle steer does not; the handbrake has time to bite; it ends below the exit slip, when slow, or after being airborne (not on a bump); rear grip falls with the slide and comes back near the cap for every car; the counter-steer is toward the velocity and limited; drag relief; the car ordering (Scout enters easiest, slides furthest, Hauler least); **in real physics every car on paving, grass, gravel and sand**: it starts, never flips (upright stays above 0.9), holds the slip under the cap (within 15%), keeps its speed (the Scout at least 35% of its entry speed, the others at least 80%), and recovers to straight with no drift left; on mud and water it never starts; a drift charges the personal nitro tank; and a straight run or a gentle bend never starts one.
- `tests/audio-model.test.ts`: a slide squeals, more the deeper it is, not on soft ground or when slow.
- Browser: see the run notes in the commit.

## Tuning knobs (`shared/drift.ts`)

`DRIFT` per car (enter and exit slip, slip cap, rear grip floor, handbrake grip, assist gain, drag relief, charge), `MIN_DRIFT_SPEED` 5, `EXIT_SPEED` 3, `DRIFT_BRAKE` 0.35, `YAW_DAMP`, `YAW_PULL`. These are first guesses for you to tune by feel. The ones to try first: the Scout's `maxSlip` (0.7 rad) if its slide feels too wild or too tame, and `assistGain` if the car fights you.

## Not done

- No camera swing and no visible slide on remote cars beyond their normal pose.
- The drift does not charge the team battery in a room.
- The Scout loses a lot of speed in a deep slide (about 60% at the worst moment of a full-lock handbrake slide at top speed). Shallower slides keep more. This may want a lower cap or more drag relief once you have felt it.
- Gamepad handbrake is mapped (button X) but untested.
