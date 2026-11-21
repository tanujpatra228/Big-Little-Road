# Multiplayer (Phase 2, first slice)

Status: rooms, join by link, remote cars, car sync, horn. Not yet: shared objects, the tether/plank spike, collisions between players, ping wheel UI, positional engine sounds for other players.

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

## Known limits

- Remote cars have no collider, so players drive through each other (ghosts). Next: kinematic bodies for remote cars.
- Software-rendered headless browsers run at about 1 fps, so they cannot judge real-time feel. The latency simulation covers the 60 fps, 10 Hz case.
- The week-4 gate from the plan (two players carry a plank at 150 ms) needs shared-object ownership and the tether, which are the next slice.
- No spectators, no room list, no password. Anyone with the code can join a room with free slots.
- Mobile layout of the invite panel is untested.
