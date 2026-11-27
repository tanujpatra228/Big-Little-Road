# Implementation Plan: Co-op RC Car Browser Game

Source: "Co-op RC Car Browser Game: Design Proposal" (Claude Docs). Name: Big Little Road (decided; the doc's top pick, Underfoot, is dropped). Check the domain and store conflicts before any public asset ships.

## 0. Where we are (read this first)

- **Built and live:** scaffold and deploy; the three cars with surfaces, boulders and the Terrace; jump and nitro; transformation between cars; chase and orbit cameras; rooms, remote cars, the rigid plank and the Terrace puzzle; ping wheel; shared team battery; signal web behind a room switch; procedural audio; toy-diorama art through G3; automatic quality and the F3 panel. Each has a doc in `docs/features/`.
- **Player baseline: two players.** The owner usually tests with one other person. Design for 2 and scale up to 3 or 4 (the same rule the RC Car Rescue doc already states). Anything that needs a third person is a bonus, not the core.
- **Two human gates are still open** (phase 1 with outside testers, week 4 with two real players on the plank at 150 ms). Section 0b is ordered so that nothing expensive depends on a gate that might still fail.
- `propwash-fpv` (the doc's source of reusable modules) was never attached, so the doc's reuse estimates are void: treat everything as built from scratch. Dropped as an action item.
- The MVP in the doc is too big for 12 weeks and one developer. Section 6 pre-decides the cuts.

## 0b. Roadmap in dependency order

This is the order to build in. Each step lists what it depends on (so it can start) and what it unlocks (so it matters). If two steps look independent, the earlier one is cheaper or reduces risk for what follows. The phases in section 2 remain as the original structure; this section supersedes their order where they differ.

**Why this order, in five implications**
1. Every mission implies a **mission runtime** (objectives, rules, stars, restart). Today the Terrace is hard-coded, so nothing after it can be built cleanly until the runtime exists. That makes it step 1.
2. Beacons and winch stakes are both **placeable objects**, and the toolbox is where players carry them. Build placeables once (step 3), then both exist.
3. The winch implies a real **stuck state** in mud (today mud only slows a car) and a **battery spend**. Both come with step 5, after the runtime and the placeables.
4. Drift implies **particles** (smoke, tyre marks). Particles also serve hop dust, mud spray and splashes, so they come first, then drift.
5. Big content (NPC cars, more missions, Free Roam) implies **performance headroom** and **owned-object sync**, so those come immediately before it.

| Step | What | Depends on | Unlocks | Players |
|---|---|---|---|---|
| 0 | Evidence and safety net: two-player playtest kit and the plank gate (human), real-server smoke in CI, rescue-not-reset check, F3 numbers (human) | nothing | decides whether the plank stays, what to optimise, and guards every later server rule | 2 |
| 1 | **Mission runtime:** pure state machine, data-driven definitions, room-held state that survives hibernation, objective HUD, rules set by the mission (radio on or off), checkpoints, stars (complete, time, no resets), restart; the Terrace migrated in as mission 1 | room rules, goals, props (all built) | every mission, the Phase 3 gate, stars, Free Roam progress | 2 |
| 2 | **Rock Crawl:** split vision (only the Scout sees the safe line), an authored crawl line through the rock field, the ping wheel as the voice, and the Hauler's low-range gear | step 1, ping wheel (built) | first real mission that needs both players and fails solo (the Phase 3 gate) | 2 |
| 3 | **Placeable objects and the toolbox:** generic owned props that can be dropped and picked up, synced by the room, surviving hibernation; a shared 6-slot toolbox | step 1, the prop system the plank uses | beacons, stakes, later chargers | 2 |
| 4 | **Dead Signal:** droppable beacons, the Relay topping up battery, the mission turning radio range on, teammates' link status, coverage display | steps 1 and 3, signal web, shared battery (built) | the radio system finally has a job; fixes the parked-Relay problem at 2 players | 2 (Relay plus any) |
| 5 | **Winch and the mud trap:** a real stuck state in deep mud, winch with anchors (roots, stakes, teammate), car trains, spends the shared battery; **Mud Bog Rescue** | steps 1 and 3, the plank's leash code, shared battery | the battery matters; the rescue fantasy | 2 (a player's car is stuck) |
| 6 | **Particles (G4), then drift:** instanced particles keyed to surface (dust, mud spray, splash, tyre marks, hop dust, nitro trail), then the handbrake drift with counter-steer assist that charges nitro | ability framework (built) | feel and feedback for every car; re-measure performance after | any |
| 7 | **Performance headroom:** from the F3 numbers: terrain colour bake, cheaper terrain lighting, fewer blades, smaller shadow window | the owner's F3 numbers, step 6 (particles add cost) | room in the budget for step 8 | any |
| 8 | **Big content:** owned-object sync for NPC cars; the **RC Car Rescue** generator; more missions (Plank Bridge, Egg Delivery, Lawnmower Escape with room-clock hazards, Night Run, the Summit Run expedition); Free Roam (garage-door ready-up, secrets, stunt spots, collectibles); local save and cosmetics | steps 1 to 7 | the Phase 4 gate, adapted to 2 players | 2 to 4 |
| 9 | **Race** (cuttable): Signal Relay and Classic on two tracks | mission runtime, signal, tracks | nothing else depends on it | 2 to 8 |
| 10 | **Hardening and launch:** budget guard ("Co-op is busy"), load and 4-player budget tests, WebRTC for poses, mobile decision, remaining audio and music, domain and trademark check, 5-group playtests, top 10 fixes | everything above | launch | all |

**Parked until their trigger (do not build earlier)**
- Plank polish (the swing-over smoothing): only after the week-4 gate passes. If it fails, the plank is cut and this work would be wasted.
- Hold-to-charge jump: only when a puzzle needs it (for example Egg Delivery ledges).
- Boosted yard crossing (about 6 s): decide after a playtest whether to lower boosted speed or grow the map.
- Real recorded sounds: blocked by network access; audio stays procedural.
- Fenders: revisit with G5.
- Mobile touch controls: designed in step 10, after the core loop is proven.

**Rules for every step:** pure logic first with tests, then wired in; a real two-browser run; a feature doc with its Cloudflare budget note; deploy; the next step does not start until the previous one is verified.

## 1. Stack and repo layout

Three.js, TypeScript, Vite, Rapier (`@dimforge/rapier3d-compat`), plain DOM menus, Vitest, Playwright, Wrangler. Cloudflare Workers static assets plus one SQLite-backed Durable Object per room.

```
src/
  client/
    main.ts              boot, scene switching
    render/              Three.js scene, chase cam, low-poly assets, UI overlays
    physics/             Rapier world, raycast vehicle, terrain collider, tether
    game/                car roles, abilities, signal, battery, winch, mission runtime
    net/                 transport interface, relay transport, p2p transport, snapshot buffer
    ui/                  join screen, ping wheel, HUD, garage-door ready-up
  shared/                runs in browser and Worker
    protocol.ts          message types, validation, 512-byte frame cap
    mission-logic.ts     pure state machine (no sockets, no Rapier)
    signal.ts battery.ts pure rules, unit tested
    constants.ts         tuning numbers
  worker/
    index.ts             routes /api/* only
    room.ts              Durable Object, Hibernation API, SQLite state
docs/features/           one doc per feature, each with a Cloudflare budget note (house rule)
tests/                   vitest unit, playwright two-client smoke
```

Rules: `shared/` has zero DOM and zero Rapier imports. Poses go through one `PoseTransport` interface so relay to WebRTC is a one-module swap.

## 2. Phases and gates

No phase starts until the previous gate passes.

### Phase 0: Scaffold (days 1 to 3)
- Vite + TS + Three + Rapier + Vitest + Wrangler; lint, typecheck, CI.
- Deploy an empty scene to Workers static assets.
- Gate: a public URL renders a spinning cube in under 10 s cold.

### Phase 1: Car feel (week 1)
Status: code complete, gate pending human playtest. Protocol in `docs/phase-1-playtest.md`.
- Heightfield terrain from a seed and small heightmap; terrain surface types (grass, sand, mud, rock, water) as a lookup on the heightfield.
- Rapier raycast vehicle with soft suspension; per-surface grip and drag; Scout, Hauler, Relay as parameter sets, not separate code.
- Chase camera, keyboard and gamepad input, flip detection.
- Gate: 5 outside testers drive each car for 3 minutes and describe it as fun, not floaty or stuck. If not, spend more time here. Everything else depends on it.

### Phase 2: Netcode spike (weeks 2 to 3)
Status: first slice done (rooms, join by link, smoothed remote cars, car and horn sync). Second slice done: solid remote cars, the plank with rope carrying that is stable under delay, a `?lag=` switch. The first real puzzle exists on top of it: the Terrace (`docs/features/terrace-puzzle.md`), a walled platform reachable only by carrying the plank over as a ramp, with a goal, fireworks and a return-plank key. Remaining: run the week-4 gate with two real players at 150 ms. See `docs/features/multiplayer.md`.
- Worker + Durable Object room: join by 4-letter code and link, guest identity, slot reclaim after reload.
- `protocol.ts` with validation and per-connection rate limits.
- Relay `PoseTransport`: 10 Hz moving, 2 Hz nearly still, 0 parked. Remote cars drawn at now minus 100 ms, extrapolate up to 250 ms.
- Shared-object ownership: room assigns owner on touch; owner simulates and sends pose only while it moves.
- Tether carry: plank placed between the two cars' latest poses, not simulated; room confirms drops.
- Latency harness: injectable delay, jitter and loss in the transport so every test runs at 150 and 250 ms.
- Gate (week 4 kill switch from the doc): two real players carry a plank over a river at 150 ms ping and it feels good. If not, drop tether carry from the MVP and weight the puzzles toward signal and split vision.

### Phase 3: Co-op systems (weeks 4 to 5)
Status: items 1, 2 and 5 built; 3, 4, 6 and 7 not yet. The build order for what remains is section 0b, not this list's order.
Build in this order, each as pure logic in `shared/` first, then wired in:
1. Shared battery: clients send boost start/stop; room computes drain from its own clock. Status: built and live for nitro (`docs/features/shared-battery.md`); the winch and drift do not use it yet (steps 5 and 6).
2. Signal web: range from base and Relay beacons, lag, then failsafe stop. Computed locally from teammate poses. Status: built, behind a room switch (`docs/features/signal-web.md`); beacons and a mission that turns it on are step 4.
3. Winch with anchors (roots, stakes, teammates), car trains. Step 5.
4. Rescue not reset: flipped car waits for a nudge, solo reset after 10 s. Status: built (`docs/features/rescue.md`). Pushing alone righted a car in only 5 of 36 simulated tries, so a teammate who stays close for a second now rolls it over, and the team is pinged automatically.
5. Ping wheel: go here, wait, tow me, low battery, look; plus horn emote. Status: built and live (`docs/features/ping-wheel.md`); gamepad and the horn emote remain.
6. Split vision: Scout UV marks visible only to the Scout. Step 2 (Rock Crawl).
7. Low range gear for Hauler and Relay, crew toolbox (6 slots). Gear in step 2, toolbox in step 3.
- Gate: a throwaway test mission using three of these needs all 3 players, and a solo brute force attempt fails. Rock Crawl (step 2) meets this with two players.

### Phase 4: Backyard content (weeks 6 to 8)
- Seven zones around the patio spawn: sandpit, flowerbed, mud bog, hose river, woodpile, deck underside, lawn.
- Free Roam as lobby: garage-door ready-up, secrets, stunt spots, collectibles, lawnmower and sprinkler on room clock.
- Missions: Mud Bog Rescue, Plank Bridge, Rock Crawl, Dead Signal, then the Summit Run expedition. The randomized RC Car Rescue Mission (`docs/features/rc-car-rescue-mission.md`) generalizes Mud Bog Rescue: build it as a scenario generator on top of these systems, three scenarios first, not before Phase 3 is done. Mission runtime is data-driven (JSON definitions driving `mission-logic.ts`).
- Stars: complete, time, no resets. Late joiners enter at next checkpoint.
- Every puzzle must pass the doc's tests: two-verb, solo, no waiting chores over 10 s, lag at 250 ms with 2 s windows, role swap.
- Gate: a fresh group (2 players is the baseline, 3 where the mission needs it) finishes the first mission in under 15 minutes with no verbal coaching from you.

### Phase 5: Race (week 9, cuttable)
- Signal Relay (teams of 2) and Classic (2 to 8) on two tracks (sandpit dunes, mud-and-river cross).
- Reuses the Phase 3 signal system and Phase 2 netcode; mostly track authoring and a lap/checkpoint state machine.

### Phase 6: Hardening and launch (weeks 10 to 12)
- WebRTC unordered/unreliable data channels for poses behind `PoseTransport`; Cloudflare STUN; automatic fallback to room relay.
- Budget guard: on DO limit, show "Co-op is busy", keep solo modes working; cap rooms at 4 until P2P is proven.
- Local save, cosmetics from collectibles, ability side-grades only if time remains.
- Load budget: first load under 10 s, terrain built from seed in-browser, no large meshes.
- Playtest rounds with 5 groups; fix top 10 issues; launch.

## 2b. Graphics track (added after the first playtest)

Feedback: driving feels good, graphics need to be good. The original plan had one line on art ("low-poly toy art") and no work item. That was a gap. Graphics are a track that runs beside the phases, with its own budget:

- Decision made: zero art budget, everything generated in code. Full direction, techniques, milestones and budgets are in `docs/features/art-direction.md`.
- Art direction first (1 to 2 days): pick one reference look for "toy-scale backyard" (warm light, shallow depth of field feel, big soft shadows, saturated toy plastics against realistic grass and dirt). Write it down with 5 reference images. Do not model anything before this exists.
- Look-dev spike at the start of Phase 4: one finished corner of the yard (patio, deck edge, flowerbed) at final quality. If that looks right, scale it. If not, change the direction before building seven zones.
- Pipeline: procedural generators in code, one function per asset class, so a modeled GLB can replace any of them later without touching gameplay. No model or texture downloads in the first release.
- Rendering upgrades in priority order: sky and lighting (HDR environment, tuned sun and fog), terrain splat textures instead of vertex colors, proper grass, car models with real detail (wheel wells, antennas, decals), contact shadows and dust or mud particles driven by surface type, post-processing (tone mapping, light bloom, subtle SSAO) behind a quality setting.
- Budgets: first load under 10 s on a mid laptop on broadband, 60 fps on integrated graphics at the default setting, art payload under 12 MB total before lazy zones. Good graphics that miss these lose the no-install join flow, which is the growth engine.
- Honest limit: procedural art has a detail ceiling, so the style is a stylized toy diorama and lighting carries the quality.

## 3. Testing

- `mission-logic`, `signal`, `battery`, `protocol`: pure unit tests, no sockets. This is where most bugs get caught cheaply.
- Latency harness runs the same scenarios at 0, 150 and 250 ms.
- Playwright: two browser contexts join one room by code, drive, complete a trivial mission. Runs in CI.
- Budget test: simulate a 4-player 20-minute session and assert request count stays under 1,200 (adaptive relay) or under 50 (P2P).
- Manual: a weekly 3-person playtest from week 4 onward. Calendar it now.

## 4. Cloudflare free-plan guardrails

- Worker runs only on `/api/*`; game files are static assets.
- No physics tick or alarms on the server; room is event-driven so it can hibernate.
- Each feature doc states its request and GB-s cost before code is merged.
- Free Durable Objects allow 100,000 requests and 13,000 GB-s per day; incoming WebSocket messages count 20 to 1. Fixed 10 Hz relay only supports about 40 missions a day, so adaptive rate is mandatory from the first playtest.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Off-road feel is hard to tune | Phase 1 gate, nothing else starts until it passes |
| Tethered carry is bad over network | Week 4 kill switch, puzzle mix shifts to signal and split vision |
| Strangers do not talk | Ping wheel in Phase 3, not later |
| Daily DO limit hit during a launch spike | Budget guard, P2P poses, cap rooms at 4 |
| Reuse from propwash-fpv unavailable | Attach the repo now; otherwise add 2 to 3 weeks |
| Scope creep | Section 6 cut order |

## 6. Pre-decided cuts (in this order)

1. Race mode (whole Phase 5).
2. Cosmetics and ability side-grades.
3. Two of the seven zones and the matching missions.
4. WebRTC; stay on adaptive relay with rooms capped at 4 and a smaller launch.
5. Tether carry (if the week 4 gate fails).

Do not cut: ping wheel, shared battery, signal web, join-in-10-seconds flow. They are the product.

## 7. Next actions

Follow section 0b. Right now:

1. **Step 0:** done on my side: the two-player playtest kit (`docs/playtest-2p.md`), the real-server checks running in CI before every deploy, and rescue-not-reset built and verified. Waiting on you: run the kit (the plank gate needs two humans) and send the F3 numbers.
2. **Step 1:** built (`docs/features/missions.md`): the mission runtime with the Terrace as mission 1.
3. **Step 2:** built and verified in two browsers (`docs/features/rock-crawl.md`): Rock Crawl with split vision and low range.
4. **Step 3:** built and verified in two browsers (`docs/features/toolbox.md`): placeable objects and the toolbox.
5. **Step 4:** built and verified in two browsers (`docs/features/dead-signal.md`): Dead Signal, beacons as radio sources, the Relay's charge.
6. **Step 5:** built and verified in two browsers (`docs/features/winch-and-mud.md`): the winch, the mud trap, Mud Bog Rescue.
7. **Step 6a:** built and verified in a browser (`docs/features/effects.md`): particles (G4). **Step 6b:** the handbrake drift is next.
3. Check the Big Little Road domain and trademark conflicts before any public asset ships (human, step 10 at the latest).
