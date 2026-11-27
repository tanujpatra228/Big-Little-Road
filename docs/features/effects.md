# Effects: dust, spray, smoke, tyre marks and the nitro trail

Roadmap Step 6, first half (art milestone G4). What a wheel throws up depends on what it is driving on, so the effects double as feedback: you can see the surface.

## What you see

| Under the wheel | Thrown up |
|---|---|
| Grass | pale green-brown dust |
| Patio | a little grey dust |
| Sand | big tan puffs |
| Mud | dark chunks that arc up and thud back down |
| Water | white spray |
| Gravel | grey flicks |
| Rock | a little grey dust |

- **Tyre smoke** when a car slides sideways (above about 30% of its speed) or brakes hard above 7 m/s, on paving, grass, gravel and rock. Sand, mud and water swallow it.
- **Tyre marks** where a wheel slides or brakes hard: dark on the patio and in the mud, lighter on sand and gravel, a faint scuff on grass, none on water or rock. They fade over 22 s. They darken the ground rather than painting it black.
- **Hop and landing dust**: a small burst on take-off and a bigger ring on a hard landing, in the colour of the ground.
- **Nitro trail**: bright orange sparks from the exhaust while boosting (yours and other players').
- Other players' cars throw dust too (worked out from where they are drawn and how fast), so a convoy raises a cloud. Nothing is sent over the network for any of this.
- The F3 panel has a **"Dust, spray, tyre marks"** switch and a live count, so you can see what they cost on your machine.

## How it is built

- `shared/particles.ts`, pure: `wheelFx` (which effect, how many a second, from surface, speed, slip, braking, throttle), `burstFx`, `ParticlePool` (flat arrays, seeded, drops new ones when full instead of growing), `SkidTrail` and `SkidMarks` (a ring of segments), the colours and sizes per kind.
- `render/particles.ts`: `ParticleLayer` draws a pool as soft round points in one draw call with per-particle size and fade (a small shader that still goes through the tone mapping and colour space chunks, so it matches in both quality tiers); `SkidMarkMesh` draws the marks as flat instanced quads multiplied into the ground.
- `game/effects.ts` runs it each frame for your car and every other car, from the rear wheels.
- Vehicle: `throttleNow` (for the dust). Remote cars: `nitroActive`.

## Cost (the house rule: re-measure after)

- At most **3 extra draw calls** (soft particles, glowing particles, tyre marks), and each is hidden when empty. Measured in a browser: 129 calls with effects on and 134 off, which is noise from the shadow pass.
- Up to **600 soft + 160 glowing particles** and **500 tyre marks**. A full pool of 1000 updates in well under a millisecond (a test checks it); in a browser one `update` took 0.02 to 0.03 ms.
- The **quality ladder scales them**: 100% on the top two rungs, then 85%, 70%, 50%, and 30% on the lowest with no tyre marks under 50%. So a slow machine drops effects with the grass and the pixels, in that order of cost.
- No network, no timers.

## Tested

- `tests/particles.test.ts` (21): each surface throws its own kind; nothing when slow, parked or airborne; rate grows with speed and never passes the cap; paving throws less than grass and sand more; smoke on a slide or hard braking on hard ground only; bursts grow with how hard; the pool births, ages, compacts, drops past its limit and counts the drops, is deterministic, settles matter on the ground and lets smoke rise, inherits a little of the car's speed, updates fast; marks: which surfaces, a segment every 0.4 m along the path, stops and restarts cleanly, the ring overwrites the oldest and everything fades; the ladder's effect scale only goes down.
- Browser (solo, real worker): at speed each surface raised particles (patio 10, grass 30, mud 30, water 41 at the peak); a sideways slide on the patio raised 64 particles and left 14 tyre marks, and the screenshot shows the smoke and the dark marks on the paving; the switch empties everything.

## Not done

- The nitro trail is sparks, not a ribbon, and the existing flame meshes are unchanged.
- No wheel splash rings on the water surface itself, and no ripples; the pond's water is still the plain water plane.
- Front wheels do not throw anything; only the rear two do.
- The particles are soft discs, not leaves or chunks (the mud "chunks" are dark discs).
- Remote cars do not show slide smoke or marks: their slip is not sent, and adding it would cost a bit in every pose.
