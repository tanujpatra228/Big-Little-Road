# Ping wheel

Strangers do not talk, so players need a way to say "go there", "wait", "tow me" without voice. The ping wheel is that: hold **Q**, flick the mouse to a slice, release. Phase 3 item 5 of the plan, and on the "do not cut" list.

## How it plays

- **Hold Q** (a fifth of a second) and a wheel opens around the mouse with five slices, clockwise from the top: **Go here** (green), **Wait** (yellow), **Tow me** (orange), **Low battery** (red), **Look** (blue). Move the mouse toward one, release Q to send. Release without picking (mouse still in the middle) to cancel.
- **Tap Q** and Go here is sent at once, with no menu.
- **Where it points.** Go, Wait and Look land where the crosshair at the centre of the screen meets the ground (the crosshair shows while the wheel is open). With the orbit camera, that is wherever you look. Looking at the sky sends a point 22 m ahead instead, so a ping always lands somewhere. Tow me and Low battery stick to your car and follow it.
- **What everyone sees.** A glowing beam and a pulsing ring on the ground, an icon above it with the sender's name and the distance, and a soft chirp panned toward it (a different tune for each kind). If the spot is off screen or behind you, the icon slides to the edge of the screen with an arrow pointing the way. It pops in, holds, and fades: Go and Wait last 8 s, Look 6 s, Tow me and Low battery 12 s.
- **One ping per player.** A new one replaces your old one. Four players mean at most four markers.
- **Cooldown.** 1.2 s between your own pings. Your own ping shows for you too (named "You"), so you can see what you sent. Playing alone works the same.
- A player who leaves takes their ping with them.

## How it is built

- `shared/ping.ts`: pure rules (tested in `tests/ping.test.ts`, 31 checks): the five styles, which slice a mouse offset picks (equal 72 degree slices, dead zone of 34 px), the cooldown, the board with expiry and replacement, fade, the ray that finds the ground, the always-lands-somewhere fallback, and the edge-of-screen arrow maths (on screen, off screen, behind the camera, never outside the margin box).
- `ui/ping-wheel.ts`, `ui/ping-icons.ts`: the radial menu and the line icons. `render/ping-markers.ts`: beams, rings and the floating icons. `game/pings.ts`: the controller that ties keys, wheel, aim, network and audio together. `GameAudio.ping`: the chirps.
- Network: nothing new on the server. The `ping` message (kind plus position in whole centimetres) was already validated and relayed to everyone but the sender. The client now converts the position back to metres on arrival (a bug the two-browser test caught: markers first showed up 100 times too far away).
- Gamepad: not wired yet.

## Budget note (house rule)

One message in per ping, from a player limited to one per 1.2 s. An incoming WebSocket message costs 1/20 of a Durable Object request, so a ping costs 0.05 requests, plus the free outgoing fan-out. Even a player who spams the limit all session sends about 50 a minute, 2.5 requests a minute. Typical use is a few per mission. No server memory, no alarms, no storage: pings live only in the browsers.

## Tested

Two real browsers in one room: Ada held Q, flicked to Wait, the wheel lit the right slice and closed on release, and the other browser showed the marker "Ada, 17 m" at the same spot to the centimetre. The cooldown blocks a second ping straight after and allows one after 1.2 s. A tap sent Go here. Tow me followed Ada's car as it drove (label 20 m to 23 m). With the other player looking away, the next ping showed as an edge arrow. No console errors. `scripts/net-smoke.mjs` already checks the relay.

## Not done

- Gamepad control for the wheel.
- A ping tied to a specific object (the plank, a winch point) instead of the ground.
- Pinging a player with the horn emote on the wheel (plan item: "plus horn emote").
- A "seen" acknowledgement so the sender knows someone looked.
