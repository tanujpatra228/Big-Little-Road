# Audio

All sound is synthesized live with Web Audio. No audio files, nothing to download, so the first load stays small and there is no licensing to manage. Same zero-budget rule as the art.

## What you hear

| Sound | How it is made | Driven by |
|---|---|---|
| Engine | Sawtooth, octave-up square and sub triangle through a waveshaper and low-pass, with a slow pitch wobble for a lumpy idle | Road speed through a virtual 3-speed gearbox, throttle. Revs up faster than it falls, dips at gear shifts |
| Car voices | Per-car profile: Scout is a high buzzy two-stroke, Hauler a low diesel rumble, Relay a mid V8 growl | `ENGINE_PROFILES` in `shared/audio-model.ts` |
| Tyres | Band-passed noise plus a granular crackle layer | Surface, speed, wheels on the ground. Patio hums, grass swishes, sand hisses, mud squelches, rock clatters, gravel crunches, water splashes loudest |
| Wind | Low-passed noise | Speed |
| Brake squeal | Narrow-band noise | Hard braking above 5 m/s on hard ground. Silent on mud, sand and water |
| Impacts | Falling sine thump, noise burst, and a metallic clank on hard surfaces | Velocity change in one physics step. Crashes are horizontal, landings vertical. Rock rings bright, sand and mud land dull |
| Horn | Two square tones, per-car pitch | Hold H |
| Ambience | Breeze bed, crickets, random bird chirps panned around the yard | Always on, very quiet |

## Volume controls

A speaker button (top left) opens sliders for Master, Engines, Effects (tyres, wind, impacts, horns, clicks) and Ambience (birds, crickets, breeze), plus a Mute button. M also mutes. Settings are remembered in the browser.

- Every sound is routed through one of three buses (engine, effects, ambience) into the master, so the groups are truly independent.
- Sliders follow a squared curve (`volumeToGain` in `shared/audio-model.ts`), which feels natural. Defaults reproduce the loudness the game had before sliders existed (master 87%, the rest 100%).
- Saved values are read leniently, so corrupt storage falls back to defaults.
- Verified in a real browser: engines off cut the measured level by about 93%, all three groups off gave silence, master 30% gave about 11% of the level, mute gave exactly zero, and values survived a reload.

## Controls

- Sound starts on the first key, click or touch (browsers require a gesture). A hint shows until then.
- M mutes and unmutes. The choice is remembered in the browser.
- H is the horn.

## Where the rules live

`src/shared/audio-model.ts` holds every rule as pure functions (rpm, pitch, tyre gains per surface, wind, squeal, impact detection and voicing), tested in `tests/audio-model.test.ts`. `src/client/audio/game-audio.ts` only turns those numbers into a Web Audio graph. Impact detection from real physics is tested in `tests/impact.test.ts`: normal driving and a hard stop never trigger a false impact, a boulder crash does, a drop reads as a landing.

## Verified how

A headless browser run confirmed: audio stays locked before a gesture and runs after, output level roughly doubles from idle to driving, the horn adds level, mute drops it to exactly zero, no console errors. That proves it works. It does not prove it sounds good, which needs the owner's ears.

## Budgets

- No network cost. CPU is a small fixed node graph (about 15 nodes) updated once per frame, plus short-lived nodes for one-shots.
- The audio context suspends when the tab is hidden.

## Not done yet

- Music. Recommendation: none until the game loop exists, then a gentle generative or looped acoustic bed for the backyard.
- Other players' cars. When multiplayer exists each remote car needs a positional (panned, distance-attenuated) engine voice. The engine voice is built per car so this is a small step.
- Suspension creak, boulder scrape, grass rustle against the chassis, water entry splash.
- Rain and night variants (the art direction lists them as later).
- Mobile: audio unlock on touch is wired, untested on real phones.
