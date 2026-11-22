# Rescue, not reset

Phase 3 item 4. A flipped car should be a social moment, not a menu. The plan said "a flipped car waits for a nudge, solo reset after 10 s". This is what that turned into after testing it.

## How it plays

- Flip over and stay on your roof for about a second and a banner appears: "Flipped. A teammate who drives up to you will flip you back, or reset in Ns (R)".
- **In a room, the team is pinged automatically** ("Tow me" marker from you, once per flip), so they know to come.
- **A teammate who drives up close (within 3.6 m) and stays for one second flips you back over.** The banner shows "Being rescued... 50%" while they are there; if they drive off, the progress drains twice as fast as it filled. The car then rolls over by itself (it does not teleport) and drives away.
- **Alone, nothing changed:** after 10 s the R key resets you upright where you stand.
- Debug (`?debug`): K flips your own car, to try this.

## Why a rule, not just a nudge (the finding)

The first version of the plan relied on physics: a teammate drives into you and you roll back over. In a simulated world (a flipped car and a teammate's solid stand-in body, which is exactly how other players' cars exist in your browser) every pair of cars, hitting the side or the end, at 4 and 8 m/s, **righted the flipped car in only 5 of 36 tries**. Most of the time it just slid the car up to 9 m across the grass, still on its roof. A rescue that works by luck is worse than a plain reset, so being rescued is now a rule with a physical roll to show for it.

## How it is built

- `shared/rescue.ts`, pure: `RescueProgress` (how long a teammate has stayed close to a flipped car) and `rollRate` (the angular velocity about the car's own nose axis that brings it upright: proportional to how far over it is, capped at 5.5 rad/s, gentle near the end so it settles, and a direction hint for the exactly-upside-down case).
- `Vehicle.rollOver` applies it each physics step, with a small lift so the roof does not drag.
- `game/rescue.ts` ties it together: finds the nearest teammate, runs the progress, rolls, pings the team, and supplies the banner text.
- It is worked out in the flipped player's own browser from positions that are already shared. **Nothing new on the network**: the automatic ping is the existing ping message.

## Tested

- `tests/rescue.test.ts` (20 checks): the progress fills and rolls exactly once after about a second; alone or too far away nothing happens however long you wait; a car that is not flipped loses its progress; the helper leaving drains it; the roll rate is zero upright, capped, eases off and takes the asked direction. **Physics:** every car (Scout, Hauler, Relay) from four flipped poses (upside down, on either side, upside down facing back), rolled in either direction, ends on its wheels within the timeout and **never tips over again** afterwards.
- Two real browsers: the flipped car pinged the other player automatically; with nobody near it stayed on its roof and the banner explained what to do; when the other player drove up the banner showed "Being rescued... 50%" and the car ended on its wheels (0.96 upright) without the reset key.

## Not done

- Only a visible teammate counts. A flipped car cannot be rescued by an NPC or by a rope.
- The rescuer sees the car roll, but gets no message of their own ("you are rescuing Ada").
- The roll direction (away from the helper) is cosmetic and untuned.
- Cars flipped on steep slopes or against walls have not been tested beyond flat ground.
