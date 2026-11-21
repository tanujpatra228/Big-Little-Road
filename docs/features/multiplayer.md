# Multiplayer (Phase 2, first slice)

Status: rooms, join by link, remote cars, car sync, horn, solid cars (bumper-car collisions), the plank with rope carrying, a simulated-lag switch. The plank is rigid at its limit. Not yet: the real 150 ms playtest of carrying the plank (the week-4 gate), ping wheel UI, positional engine sounds for other players, momentum transfer between cars.

Modelled on the Prop Wash design: one Durable Object per room, a pure rules module, validated JSON frames, 10 Hz poses drawn about 100 ms in the past, a per-tab key to reclaim a slot.

## How it works

| Piece | File | Notes |
|---|---|---|
| Wire format | `src/shared/net/protocol.ts` | Frames defined once. Every client frame is validated: size cap (512 bytes), types, integer ranges, unit-quaternion check. Bad frames close the connection (1008) |
| Pose encoding | `src/shared/net/pose.ts` | Whole centimetres, quaternion parts x 10000, speed 0.1 m/s, steer mrad. A pose frame is about 110 bytes |
| Room rules | `src/shared/net/room-logic.ts` | Pure state machine: no sockets, timers or clock. Joins, slot reuse, reclaim by key, room of 4, rate limiting, relaying |
| Server shell | `src/worker/room.ts` | Durable Object with the WebSocket Hibernation API. Feeds RoomLogic, sends what it returns. Persists only the small player table, never poses |
| Routes | `src/worker/index.ts` | `POST /api/rooms` returns a 4-letter code (no I or O), `GET /api/rooms/<code>/ws` upgrades to the room |
| Smoothing | `src/shared/net/snapshot-buffer.ts` | Learns the sender clock offset from the fastest recent packets, draws 100 ms in the past, blends poses, extrapolates up to 250 ms if the stream dries up |
| Client | `src/client/net/room-client.ts` | WebSocket, per-tab key in sessionStorage, reconnect with backoff, ping/pong for the RTT readout |
| Remote cars | `src/client/net/remote-car.ts` | Generated car model, wheel spin from speed, name tag. No physics here |
| UI | `src/client/ui/coop-panel.ts` | "Start a room", room code, copy invite link, player list with ping |

Flow: click Start a room, share `/?room=ABCD`. Opening the link joins directly. Each browser simulates its own car and sends its pose; the room only relays. There is no server-side physics, so a modified client could cheat. That is acceptable for friends.

## The plank (shared object spike)

One plank lies on the lawn off the patio. Press F near one end to hook it. A second player hooks the other end and the two carry it, in convoy like a stretcher (each car holds it by the end facing its partner) or side by side. See `terrace-puzzle.md` for what to do with it: it is the ramp up to the Terrace platform. Press F again to let go; if both let go, it rests where the last one released it.

- **Nothing is simulated or sent while it is carried.** Both browsers place the plank between the two hitch points they already know (their own car and the partner's smoothed pose). The only coupling is a soft rope pull each client applies to its own car (`shared/tether.ts`): no pull while the cars stay within 0.45 m of the ideal 4.8 m spacing, a spring beyond that, a gentle push apart when squeezed, capped at 10 m/s^2. It is an acceleration, so a 6 kg Scout and a 14 kg Hauler feel alike. A towed car freewheels (no engine braking) so a rope can drag a parked partner.
- **The plank does not stretch.** On top of the soft rope there is a hard limit (`ropeLeash`, run after every physics step on our own car). The hitches can never be more than 1.0 m beyond the 4.8 m rest spacing (5.8 m), nor 1.2 m closer than it. The leash brakes progressively over the last few metres (allowed closing speed = 5 per second times distance left, capped at 80 m/s^2) and only removes a car's OWN motion that makes things worse. It never reverses a car and never tows the partner (the soft rope does that), so two browsers each leashing their own car cannot fight, even through a stale view of the partner. The partner's hitch is extrapolated by their velocity over 100 ms of interpolation plus half the round trip, so the limit holds against where they are now. Cars driving along together are never touched. Ropes turn red as they near the limit. Measured: `tests/tether.test.ts` simulates both players flooring it apart at 0, 100, 200, 300 and 500 ms delay (peak 5.80, 5.80, 5.84, 5.94, 6.44 m), and two real browsers showed 5.87 m (both driving) and 5.82 m (one driving) where the same run without the leash reached 15.5 m. Cost: nothing on the wire.
- **One car alone** drags it behind like a stick on a string (`trailFarEnd`). Same code on every client, so they draw nearly the same.
- **Resting**, it is a real board you can drive over (static collider placed on the terrain slope). **Carried or dragged**, it is a ghost, so it never fights the cars.
- **Room state** (`shared/net/props.ts`, `PropsLogic`): who holds each end, plus the resting pose. Messages `attach`, `detach` and `reset` (return it to the start when nobody holds it); the room broadcasts a `prop` update, and relays `goal` (a car reached a goal: fireworks for everyone, at most once per 12 s); the welcome message includes the props so latecomers see the truth. Stored on join, leave, car change and attach/detach, never per frame. A player who leaves lets go; the plank stays at its last resting pose. The same `PropsLogic` runs in the browser when playing alone.
- **Why a delay-stable rope matters:** each car pulls toward where it SEES the partner, which is a pose 100 ms of interpolation plus the network latency old. A spring in a loop with that delay oscillates and blows up if too stiff. `tests/tether.test.ts` simulates two cars through 0, 150, 250, 400 and 600 ms of delay: the chosen rope (stiffness 9, damping 4) settles at all of them, and the same simulation shows a rope only 3 times stiffer growing without bound at 250 ms, so the test is not vacuous.

## Solid cars

Each remote car gets a kinematic stand-in body with the same chassis shape (`RemoteBody` in `physics/vehicle.ts`). Cars bump instead of passing through each other. Each browser does this for the other, so it behaves like bumper cars. A pushed car does not receive momentum, because there is no shared physics; real pushing and towing by contact would need ownership of the pushed car. The rope covers the cooperative case.

## Feeling a bad connection on a good one

Add `?lag=150` (milliseconds each way) and optionally `&jitter=30` to the page URL. Every message in and out is delayed, in order. The invite panel shows "Simulated lag: 150 ms each way", and the ping readout shows about double. Use it to run the week-4 gate: two people, `?lag=150` on one or both, carry the plank around the yard and try to lay it across the pond.

## Message rate (free-plan budget)

Free Durable Objects allow 100,000 requests and 13,000 GB-s a day for the whole account. Incoming WebSocket messages count 1 request per 20, outgoing are free, ping/pong auto-responses are free and do not wake the room.

- Moving: 10 poses/s per player. Nearly still: 2/s. Parked for 4 s: none. Parked cars re-announce themselves when someone joins, so a late joiner still sees them.
- A 4-player room with everyone driving flat out is 40 incoming frames/s, which is 2 requests/s, 7,200 an hour. The account-wide daily limit is therefore roughly 14 hours of such rooms in total. Fine for friends, the binding limit if it spreads. Mitigation is already planned: poses over WebRTC peer-to-peer (Phase 6) behind the same transport boundary.
- Storage writes happen only on join, leave and car change.
- Nothing runs on a timer, so there are no alarm requests.

## Tests

- `tests/net-protocol.test.ts`: frame validation, quantisation round trips, adaptive rate.
- `tests/room-logic.test.ts`: join, full room, reload reclaims slot and drops the stale socket, relaying, rate limiting, hibernation restore.
- `tests/snapshot-buffer.test.ts`: a simulated network at 0, 150 and 250 ms with jitter, 5% packet loss and arbitrary clock skew. Error stays under 0.1 m on a clean link and under 0.75 m on the bad one, no teleports, no drift over two minutes, extrapolation capped.
- `scripts/net-smoke.mjs` (`npm run e2e:net`): 20 end-to-end checks with real WebSockets against a running Worker (local `wrangler dev` or the deployed site): welcome, join, pose relay, horn, car change, ping, pong, bad frames, oversize frames, full room, leave, reload takeover, room isolation, route guards. It passed against the real Workers runtime locally.
- A two-browser Playwright run confirmed: both browsers see each other, a scripted 10 m/s run is followed by the remote car, car changes sync, a reload takes the same slot back, leaving removes the remote car.
- A second two-browser run with 150 ms simulated lag on one player confirmed: both get the hook prompt, hook opposite ends and both see both holders, the carried plank is placed within 0.1 m in both browsers, a yank 5 m apart is pulled back together by the rope, and the plank rests at the same place for both after letting go.
- `tests/tether.test.ts`, `tests/props.test.ts`, `tests/remote-body.test.ts`: geometry, rope behaviour and its stability under delay, hold rules and room relaying, solid remote cars, towing.

## Known limits

- Collisions are bumper-car style, not shared physics.
- Software-rendered headless browsers run at about 1 fps, so they cannot judge real-time feel. The latency simulation covers the 60 fps, 10 Hz case.
- The week-4 gate (two real players carry the plank at 150 ms and it feels good) is built and instrumented but has not been played by humans yet. That is the next step and the kill switch from the plan.
- Carrying a plank into a bridge across the pond (laying it, cars driving over it as a deck) is Phase 4 content. Today it can rest anywhere and be driven over.
- No spectators, no room list, no password. Anyone with the code can join a room with free slots.
- Mobile layout of the invite panel is untested.
