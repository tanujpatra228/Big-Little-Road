# Phase 1 gate: car feel playtest

Gate from PLAN.md: 5 outside testers drive each car for 3 minutes and call it fun, not floaty or stuck.
Nothing in Phase 2 starts until this passes.

## Run it

- Deploy (`npm run deploy`) or share a local `npm run dev -- --host` URL.
- Testers open the URL. No instructions beyond the on-screen controls.
- Add `?tune` to the URL to get the live tuning panel (edits respawn the car in place; gravity is editable too).
- Add `?debug` to allow instant reset with R.

## Script (about 10 minutes per tester)

1. 3 minutes per car, in order Scout, Hauler, Relay. Do not coach. Watch, do not talk.
2. Ask them to: reach the sandpit (east), the mud bog (west), the rocks (south west), climb the big hill (north).
3. Note: where they got stuck, flipped, or laughed.

## Questions after each car (1 to 5)

- Fun to drive?
- Steering felt: too twitchy / right / too lazy?
- Did the car feel floaty or heavy?
- Could you tell the surfaces apart by feel?

## Pass criteria

- Median "fun" score 4 or higher for every car, no tester scoring a car 1 or 2.
- At least 4 of 5 testers can tell sand from mud from rock by feel without being told.
- No tester gets permanently stuck. Flips are fine (flips become a rescue mechanic in Phase 3).
- If a car fails, tune with `?tune`, copy the JSON shown in the panel into `src/shared/cars.ts`, retest with fresh people.

## Surface speeds (after playtest 1)

Top speed as a share of each car's grass speed, from the flat-world tests. No surface makes any car faster than grass.

| Car | Sand | Gravel | Mud | Rock | Water |
|---|---|---|---|---|---|
| Scout | 87% | 89% | 20% | 100% | 12% |
| Hauler | 39% | 58% | 83% | 100% | 54% |
| Relay | 45% | 59% | 36% | 100% | 21% |

Rock is deliberately 100%: big rock is a hazard, not a slow zone. Slowing cars down there would do the driving for the player. The rock field has two kinds of rock and nothing in between, because a belly-height dome is what high-centres a car: 20 tall boulders (irregular clusters of 3 to 5 jointed spheres, at least 1.1 high) that crash and throw cars around, with gaps wider than the Hauler (about 1.6) so there is always a way through, and 30 low rubble heaps (under 0.3) you drive over. The car underbody is angled at nose and tail and rock surfaces are slick, so a car that lands on something slides off. Loose stones around the field are Gravel, which slows like sand. A scripted driver with simple boulder avoidance crosses the field from 6 to 7 of 8 directions per car, a blind one only 3 to 5, which is the intended difference.

Braking fix: brakes used to be about 5 times too strong for the tyre grip, so every car flipped end over end when braking hard from top speed. Brakes are retuned so cars stop in roughly 1 s without pitching over, and tests enforce it.

## Known issues going in

- Fence is a placeholder wall; cars bounce off it.
- Shoreline colour around the pond is a cosmetic artifact.
- Headless software rendering runs at about 10 fps, so judge feel only on real GPUs.
- Gravity is 9.81; toy scale may want higher. Try 14 to 18 in the tuning panel first.
- Bundle is 4.8 MB because of the embedded WASM (see PLAN.md Phase 6).
