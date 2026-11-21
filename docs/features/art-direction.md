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
| Terrain | Splat blend of 4 to 6 procedural textures (grass, sand, mud, rock, gravel) in a shader, vertex-baked ambient occlusion, detail noise | Replaces flat vertex colours. Textures generated on a canvas at load, no downloads |
| Grass and plants | Instanced blades and flowers with wind in the vertex shader, density by distance | Biggest "wow per line of code" item |
| Rocks | Same jointed-sphere data as physics, rendered with displaced, noise-shaded meshes so the mesh matches the collider | Physics and visuals must stay in sync |
| Props (deck, fence, flowerpots, hose, toys, woodpile) | Composed from bevelled boxes and cylinders | Each prop is a small generator function |
| Sky | Gradient dome plus sun disc and a few procedural clouds | No HDR download needed |
| Water | Shader with depth fade, foam edge, scrolling normals | Cheap and reads as water |
| Effects | Dust, mud spray, water splash, tyre marks, boost trail as instanced particles keyed to the surface under each wheel | Doubles as gameplay feedback |
| Post | Tone mapping and colour grade always on; bloom, soft SSAO, vignette behind a quality setting | Auto-lower on slow GPUs |

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
