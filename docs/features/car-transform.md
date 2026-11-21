# Switching cars: momentum and transformation

Press 1, 2 or 3 (or click a car button) to change car. You keep going: the new car appears where you were, moving the way you were moving, and the old one transforms into it.

## What carries over

`Vehicle.transformFrom` (`src/client/physics/vehicle.ts`) builds the new car from the old one's state:

- Position, and orientation (including a tilted car, or one rotating in the air).
- Linear velocity and spin.
- Steering angle, so wheels stay turned mid-corner.
- Only the ride height is adjusted (heavier and lighter cars sit at different heights), so the new wheels never start in the ground.
- The swap is not mistaken for a crash by the impact sounds.

Velocity is kept, not mass-times-velocity. Keeping true momentum would turn a 12 m/s crawler into a 28 m/s Scout, faster than the Scout can go, and a Scout into a crawler would nearly stop. Keeping velocity matches what a driver expects.

If the new car's top speed is lower (Scout to Hauler), the surplus speed bleeds off gently: for 1.5 seconds after a switch the over-speed drag is a quarter strength, then it returns to normal. Tests show a car carrying most of its speed a sixth of a second after the switch and settling near the new top speed within a few seconds, never flipping.

## The animation (1.4 s, `shared/transform-anim.ts`, `render/transform-rig.ts`, `render/car-transformer.ts`)

The car takes itself apart and becomes the new one. No flash and no squash: you watch the actual parts move.

1. **0 to 0.6 s, details fold away.** The roll cage, rack, mast, lights and glass of the old car fold onto hinges, top first, then sides, front, rear.
2. **0.2 to 1.2 s, the five big boxes travel.** Every car is built around the same five boxes: lower body, cab, hood, tail and underbody. Each one backs off a hair, swings out of its way (the cab lifts and tilts, the hood tips forward, the tail back), slides and resizes into the new car's shape and paint colour, then locks with a small overshoot. They start staggered, so it reads as a sequence.
3. **0.3 to 0.95 s, wheels.** They glide to the new car's track and wheelbase, grow or shrink to its radius, and swap to its tyres halfway. The suspension arms and door numbers retract early and spring back last.
4. **0.8 to 1.4 s, the new car's details unfold** (sides, rear, front, then the roof gear last, which is the final click).
5. **Sparks** fly only where a part locks home (a handful for each big box, fewer for detail groups), carrying half the car's speed.

Between 0.6 s and 0.8 s the old details are gone and the new ones have not started, so you see only the bare boxes rearranging.

How it is built: `car-builder.ts` tags the five big boxes (`Parts.frame`) and sorts every other shape into top, front, rear or side. Idle cars are drawn exactly as before (merged meshes, no extra cost; a test locks vertex counts and bounds). Only during a transformation a `TransformRig` stands in for the two bodies, built from the two cars' own parts and thrown away afterwards (about 40 small meshes for 1.4 s). Adding a fourth car needs nothing here beyond giving it the five boxes.

The timeline is pure numbers and tested (`tests/transform-anim.test.ts`): every motion is exactly at its start before its window and exactly at its end after it, overshoots are small and bounded, nothing goes negative, locks come in time order and the roof gear locks last, right at the end.

Sound (`GameAudio.transform`, effects group): a servo that spins up, hums and winds down over the whole 1.4 s, grinding metal noise that swells while the boxes travel, a ratchet click as each part unlatches, and a clank as each part locks, heavier for the big boxes with a ringing final clank. The clicks and clanks use the same moments as the visuals.

Other players see it too, from the same call: when someone changes car, their car transforms on your screen, and you hear it placed by direction and distance. Nothing new goes over the network.

Honest limits: this is about a dozen big pieces plus folding details, not the hundreds of plates in the film. The physics body (and its hitbox) switches instantly while the visual takes 1.4 s, so for a moment the hitbox is the new car's. If you switch again mid-way, the running one jumps to its end and the next starts, which shows more now that it is longer.

## Review it

`/?showcase&transform=hauler` loops a Scout turning into a Hauler. Add `&from=relay` to start from another car, and `&at=0.7` to freeze at a moment from 0 to 1.4 s (try 0.15, 0.5, 0.9 and 1.25 to see the stages). `&dist=`, `&height=` and `&angle=` frame the camera, for example `&dist=3.9&height=1.9&angle=40` for a close view.

## Not done

- No cooldown. Add one if switching mid-race should not be free.
- Future abilities (drift, jump, nitro) should carry their meters across a switch, which the same `transformFrom` is the place for.
- Mobile touch buttons for switching are not designed yet.
