# Art direction

Decision (made with the project owner): zero contracted art budget, all art generated in code. No hired modelers, no purchased packs. Free CC0 assets are allowed if they help, but the plan does not depend on them.

This sets a ceiling on detail. The answer is a style that is cheap to do well, not a realistic one done badly.

## Look: toy diorama

You are tiny RC cars in a giant backyard. The world should look like a lovingly lit miniature, not a simulation.

- Chunky, bevelled, slightly oversized shapes. Nothing sharp, nothing photoreal.
- Saturated plastic toy cars against a calmer, slightly desaturated natural world, so cars always pop.
- Warm low sun, long soft shadows, hazy distance. Lighting does most of the work.
- Subtle tilt-shift feel at distance (fog and slight blur) to sell "miniature".
- Readable at a glance: each surface and each car identifiable by silhouette and colour alone.

References to collect before any visual work (owner to pick or approve 5): Mario Kart and Animal Crossing for colour and softness, Lego Builder's Journey for lighting on simple shapes, Tiny Glade for diorama warmth, Micro Machines and Toy Story for the scale fantasy.

## What "in code" means per asset class

| Asset | Technique | Notes |
|---|---|---|
| Cars | Rounded-box bodies, cylinder tyres with tread bump, canopy, lights, decals as canvas textures, per-role silhouette (buggy cage, crawler winch and bumper, truck with mast) | Build once as a generator `buildCar(spec)`; shares geometry across instances. Spec already carries sizes and colours |
| Terrain | Procedural per-surface patterns in the fragment shader, one-hot surface weights jittered and sharpened for crisp borders, vertex-baked ambient occlusion | Replaces flat vertex colours. No texture downloads |
| Grass and plants | Instanced blades and flowers with wind in the vertex shader, density by distance | Biggest "wow per line of code" item |
| Rocks | Same jointed-sphere data as physics, rendered with displaced, noise-shaded meshes so the mesh matches the collider | Physics and visuals must stay in sync |
| Props (deck, fence, flowerpots, hose, toys, woodpile) | Composed from bevelled boxes and cylinders | Each prop is a small generator function |
| Sky | Gradient dome plus sun disc and a few procedural clouds | No HDR download needed |
| Water | Shader with depth fade, foam edge, scrolling normals | Cheap and reads as water |
| Effects | Dust, mud spray, water splash, tyre marks, boost trail as instanced particles keyed to the surface under each wheel | Doubles as gameplay feedback |
| Post | Tone mapping and colour grade always on; bloom, soft SSAO, vignette behind a quality setting | Auto-lower on slow GPUs |

## Status

- G1 Light and sky: done. Warm late-afternoon sun to the side of the spawn heading, procedural sky dome with clouds and sun disc, baked sky environment for reflections, haze fog, Khronos Neutral tone mapping (keeps pastels, unlike ACES), warm grade and vignette, soft bloom, MSAA, texel-snapped shadows. Terrain palette softened to match, smooth shading, hedge colour at the fence.
- G2 Cars v2: done. Generated models for Scout (cage, empty seat, engine, light bar; no driver figure, the cars are the characters), Hauler (cab, winch bumper, roof rack, snorkel), Relay (flares, spare tyre, signal mast with pulsing beacon) and the rescue car (dead and revived variants, battery slot), with clear-coat plastic, lathe tyres with lugs, swing arms, number badges, headlights, tail lights that brighten when braking. Merged to about 12 draw calls per car.
- G3 Terrain: mostly done. Real curved-blade grass (about 44k tufts in chunked instanced cells, wind sway, distance-based thinning), daisies and other flowers in clusters, a procedural terrain shader (mowing stripes, paver tiles on the patio, ripples in sand, cracked rock, speckled gravel, crisp organic borders with noise-wiggled edges), baked ambient occlusion in dips, pebbles on sand and gravel, and a lower leafy hedge fence. Still to do for G3: noise-shaded rock meshes that match the collider shapes, and grass that parts for passing cars.
- Fenders: removed from the Hauler and Relay for now. They read as floating slabs ('ears') even after the clipping was fixed. To revisit later with a proper wheel-arch design. The suspension bump stops stay capped (`maxWheelRise` in `cars.ts`), so a future fender can be placed from the same limit, and a test still fails if a wheel rises past it.
- Mud: the bog floor sits above the waterline (`MUD_FLOOR` in `shared/terrain.ts`, tested) and is painted as wet dark clay with lighter dry crusts and churned ruts, matte so it never reflects the sky like water. It used to sit below the water plane and showed as a blue pond.
- Next: G4 effects (dust, mud and splash particles from wheels, tyre marks, water shader), then G5.

### Review URLs

- `/?showcase` all five cars on the patio, orbiting. Add `&angle=<deg>` to freeze, `&focus=0..4` to centre one car, `&dist=` and `&height=` to frame.
- `?quality=low|high` pins the quality tier. Without it the game starts high and drops to low if it averages under 38 fps for 3 seconds. Low skips post-processing, bloom, MSAA and uses smaller shadows.

## Milestones

Each is shippable and screenshot-reviewed.

1. G1 Light and sky: sun, shadows, fog, sky dome, tone mapping, colour grade. Biggest visual gain for the least code.
2. G2 Cars v2: all three cars as proper generators with wheel wells, lights, decals and a shared plastic material. Then the rescue car (dead, then revived with lights on).
3. G3 Terrain: splat shader, baked AO, instanced grass and flowers, rock meshes matching colliders.
4. G4 Effects: surface-driven dust, mud and splash particles, tyre marks, water shader.
5. G5 Props and polish: patio, deck, fence, toys; post-processing and the quality setting.

Start with G1 and G2. Together they change the first impression the most.

## Budgets (do not break)

- First load under 10 s on a mid laptop on broadband. No texture or model downloads in the first release, so art payload is effectively zero bytes beyond code.
- 60 fps on integrated graphics at the default quality; a lower tier must exist and be selected automatically when frame time is high.
- Draw calls: instance everything repeated (grass, rocks, pebbles). Target under 200 draw calls in any view.
- Shadow map and post effects are quality-gated.

## How we verify without an artist

- Headless screenshots at fixed camera spots (spawn, sandpit, mud bog, rock field, pond, hill, dusk) saved per change. The owner reviews the live build, which is the real judge.
- Software rendering in CI is too slow to judge frame rate, so performance is checked on real hardware by the owner. Add an on-screen frame time readout (already shown as fps) and a `?quality=low|high` override.

## Risks and honest limits

- Procedural art has a detail ceiling. Hero shots (close car, a rescue-car revival) will look stylized and simple, not rich. The toy style is the mitigation.
- Visual taste cannot be unit tested. Expect several rounds of owner feedback per milestone.
- If the owner later gets budget, the first thing to buy is a modeled hero car. Generators are written so a GLB can replace one without touching gameplay: each asset class goes through one loader function.

## Open items for the owner

- Pick or approve the 5 reference images.
- Confirm the toy diorama direction, or say what to change before G1 starts.
- Time of day for the default look (recommended: warm late afternoon). Night and rain are variants for later.
