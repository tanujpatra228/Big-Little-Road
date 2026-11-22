# Performance

Report from the owner: 30 to 35 fps, suspected cause: the grass. This is what was measured, what changed, what did not, and how to tell what your own machine is bound by.

## How it was measured, and the limits

Headless Chromium with a software renderer (SwiftShader), 1280 by 720, with the game loop stopped and each frame forced to finish before the next, median of several interleaved rounds. That makes the numbers **relative**: they rank costs reliably, but the percentages on a real graphics card will differ, because a CPU renderer pays more for pixels and less for some other things than a GPU does. The F3 panel below exists so that you can get the real answer on your own machine.

## Findings (low tier, before any change)

| Part of the frame | Share |
|---|---|
| Grass and flowers together | about 51% (about 530 of 1030 ms) |
| Terrain (lit ground plus the procedural colour shader) | about 35% when grass is hidden, the other big block |
| Shadows | about 13% |
| Sky, water, cars, everything else | small |
| High tier extras (MSAA, bloom, grading) | about +35% on top, and they scale with pixel count: a 2x retina screen draws four times the pixels |

Triangles per frame: 469k, of which grass was 250k.

You were right that the grass is the biggest single removable cost. It was not the whole story: the ground is about as big, and the flowers were a surprise (see below).

## What changed

Measured on the same scene before and after, low tier: **frame 1030 ms to about 790 ms (24% faster), grass plus flowers 530 ms to about 290 ms (45% cheaper), triangles 469k to 361k.** Look before and after was compared pixel by pixel on five spots.

- **Flowers (about 10% of the frame for something tiny).** They were three giant instanced meshes covering the whole yard, so every flower was processed every frame, including all those behind you, and each centre was a 96-triangle sphere the size of a pea. Now they sit in 32 m cells, only nearby cells are drawn, and the parts are lighter. Cost fell from about 76 ms to about 16 ms.
- **Grass.** Distance thinning used to be three steps (full to 38 m, 55% to 66 m, 25% to 100 m). It is now a smooth curve (full to 26 m, gone by 88 m, falling faster than linearly), which draws about 38% fewer tufts and has no density steps to see. The blades use a Lambert material instead of the full PBR one: they are matte with soft baked shading, so specular and reflections cost a lot per pixel (grass is the most overdrawn thing on screen) and added nothing visible. Close-up grass looks the same in side by side shots.
- **Pixel ratio on the high tier is capped at 1.5** (it was 2). On a 2x screen that is 56% of the pixels for nearly the same sharpness.
- **Terrain shader** now only works out the surface patterns a pixel actually has, instead of all of them (about 21 noise lookups) for every pixel. It is visually identical (under 0.2 out of 255 difference on the ground in five spots). **It showed no measurable gain in the software renderer**, so it is not claimed as a win. A real GPU can skip unused branches, so it may help there.
- **Automatic quality** (below).
- **The F3 panel** (below).

## What did not help, so it was not kept

- Turning off shadow receiving on the grass: no measurable change.
- Drawing the bloom at half size: it changed the look (the glow got wider on screen, because the blur kernels are measured in pixels) and the pass already works below full size, so it saved little. Reverted after a pixel comparison showed the difference.

## Automatic quality (`shared/auto-quality.ts`, `game/auto-quality.ts`)

The game starts at full quality. If the average frame rate over two seconds stays under 45, it steps down one rung; it steps back up only after 10 seconds above 57, and if stepping up goes wrong it stops trying for 90 seconds. A hitch (a load, a pause) does not trigger it, but a machine that is always slow does. Nothing changes on a machine that is fast enough.

| Rung | Effects (AA, bloom) | Grass | Pixels | Flowers |
|---|---|---|---|---|
| 0 | on | 100% | tier default | on |
| 1 | off | 100% | 1x | on |
| 2 | off | 70% | 1x | on |
| 3 | off | 70% | 0.85x | on |
| 4 | off | 45% | 0.75x | on |
| 5 | off | 25% | 0.65x | off |

The order is by what is cheapest to lose. The rules are pure and tested against simulated machines (`tests/auto-quality.test.ts`, 17 checks): a fast machine never moves, a slow one steps down one rung at a time and stops once it holds 45, a machine only held back by the effects drops only the effects, it comes back up when the load goes away, it does not bounce between two rungs, and a hopeless machine reaches the floor without error. A fixed `?quality=low` or `?quality=high` switches it off, and so does touching any control in the F3 panel. It replaces the old one-way high to low switch at 38 fps.

Honest caveat: a 30 Hz display would read as slow and walk down the ladder. Turn Auto off in the panel if that is you.

## The F3 panel (`ui/perf-panel.ts`)

Press F3 (or open the game with `?perf`). It shows fps, frame time, how much of that is our own code ("JS") and how much is handing draws to the card ("submit"), draw calls, triangles, grass tufts, pixel size, tier and the Auto level. Below are switches: Auto quality, a grass slider, flowers, shadows, effects, resolution and tier. **If the frame time is much longer than JS plus submit, your graphics card is the limit, and switching things off one at a time shows which one it is struggling with.** Nothing is saved.

## Not done (next levers, in the order the numbers suggest)

1. **Terrain colour** is the largest remaining block (about 180 ms of the roughly 700 left, in the software renderer). The procedural shader could be baked once into a texture at load, with only the fine detail kept live. It is a bigger change with a real risk to the crisp look, so it waits for your numbers.
2. **Terrain lighting.** A plain lit terrain still costs about 170 ms before any colouring, from full lighting, shadow sampling and fog on every pixel.
3. **Fewer blades per tuft** (7 now) if grass is still the limit on your machine.
4. Shadow cost (about 13%) could drop with a smaller shadow window.

## What I need from you

Open the game, press F3, drive around the lawn and send me: the fps, frame, JS, submit and pixels lines, and which tier and Auto level it settles on. Then try turning grass to 0 and shadows off and tell me the fps each time. That tells me whether to go after the terrain next.
