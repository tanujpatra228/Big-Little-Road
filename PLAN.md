# Implementation Plan: Co-op RC Car Browser Game

Source: "Co-op RC Car Browser Game: Design Proposal" (Claude Docs). Name: Big Little Road (decided; the doc's top pick, Underfoot, is dropped). Check the domain and store conflicts before any public asset ships.

## 0. Read this first

- The repo is empty. Nothing is built.
- The doc reuses modules from `propwash-fpv` (room-protocol, room-logic, race-room, snapshot-buffer, room-key, shared-clock, terrain/grass code). That repo is not attached to this session. Attach it, or the reuse estimates are fiction and the 12-week budget grows by 2 to 3 weeks.
- The MVP in the doc is too big for 12 weeks and one developer: 3 cars, 7 zones, 4 missions plus an expedition, 7 co-op systems, 2 race formats, WebRTC, cosmetics. Plan below keeps it, but ranks every item so cuts are pre-decided (section 6). If you resist cutting, you ship in month 6, not month 3.
- The doc's own riskiest question (is shared-object physics fun over a network?) gets answered in week 4 with a hard gate. Do not build content before that gate.

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
Build in this order, each as pure logic in `shared/` first, then wired in:
1. Shared battery: clients send boost start/stop; room computes drain from its own clock.
2. Signal web: range from base and Relay beacons, lag, then failsafe stop. Computed locally from teammate poses.
3. Winch with anchors (roots, stakes, teammates), car trains.
4. Rescue not reset: flipped car waits for a nudge, solo reset after 10 s.
5. Ping wheel: go here, wait, tow me, low battery, look; plus horn emote. Status: built and live (`docs/features/ping-wheel.md`); gamepad and the horn emote remain.
6. Split vision: Scout UV marks visible only to the Scout.
7. Low range gear for Hauler and Relay; crew toolbox (6 slots).
- Gate: a throwaway test mission using three of these needs all 3 players, and a solo brute force attempt fails.

### Phase 4: Backyard content (weeks 6 to 8)
- Seven zones around the patio spawn: sandpit, flowerbed, mud bog, hose river, woodpile, deck underside, lawn.
- Free Roam as lobby: garage-door ready-up, secrets, stunt spots, collectibles, lawnmower and sprinkler on room clock.
- Missions: Mud Bog Rescue, Plank Bridge, Rock Crawl, Dead Signal, then the Summit Run expedition. The randomized RC Car Rescue Mission (`docs/features/rc-car-rescue-mission.md`) generalizes Mud Bog Rescue: build it as a scenario generator on top of these systems, three scenarios first, not before Phase 3 is done. Mission runtime is data-driven (JSON definitions driving `mission-logic.ts`).
- Stars: complete, time, no resets. Late joiners enter at next checkpoint.
- Every puzzle must pass the doc's tests: two-verb, solo, no waiting chores over 10 s, lag at 250 ms with 2 s windows, role swap.
- Gate: a fresh group of 3 finishes the first mission in under 15 minutes with no verbal coaching from you.

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

1. Attach `propwash-fpv` to this session (or confirm it is not available).
2. Check the Big Little Road domain and trademark conflicts.
3. Phase 0 scaffold is in the repo; deploy it with `npm run deploy` once Wrangler is logged in.
4. Start Phase 1 and book the first outside playtest for end of week 1.
