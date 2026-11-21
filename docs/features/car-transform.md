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

## The animation (0.75 s, `shared/transform-anim.ts` and `render/car-transformer.ts`)

1. 0 to 0.25 s: the old car squashes wide and flat while a warm flash builds.
2. 0.25 s: swap, hidden by the flash. A burst of round sparks flies out (carrying half the car's velocity, so they travel with a moving car) and a ring sweeps across the ground.
3. 0.25 to 0.75 s: the new car springs up from the squash, overshoots slightly, and settles at normal size.

Both models share the squashed shape at the swap, so nothing pops. The timeline is pure numbers and tested: starts and ends at normal size, no inverted scale, bounded overshoot, flash peaks at the swap.

Sound: a rising servo whirr, a whoosh swept up into the flash, and two metallic clanks as parts lock in (`GameAudio.transform`, in the effects group so the volume slider controls it).

Other players see it too: when someone changes car, their car transforms on your screen, and you hear it placed by direction and distance.

If you switch again mid-animation, the running one finishes at once and the next starts, so mashing the keys is safe.

## Review it

`/?showcase&transform=hauler` loops a Scout turning into a Hauler. Add `&from=relay` to start from another car, and `&at=0.3` to freeze at a moment (0.25 is the swap). `&dist=`, `&height=` and `&angle=` frame the camera.

## Not done

- No cooldown. Add one if switching mid-race should not be free.
- Future abilities (drift, jump, nitro) should carry their meters across a switch, which the same `transformFrom` is the place for.
- Mobile touch buttons for switching are not designed yet.
