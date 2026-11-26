# The crew toolbox and placed objects

Roadmap Step 3. One shared box of six slots, and things the crew can put down in the yard and pick up again. It is the plumbing for the radio beacons (Step 4) and the winch stakes (Step 5); for now all three items are markers.

## How it plays

- The whole room shares **one toolbox of six slots**. A new room starts with 2 beacons, 2 stakes and 2 cones.
- Keys **4 to 9** select a slot (or click it). **E** puts the selected item down 2.6 m in front of your car. **X** picks up the nearest placed item within 4 m, into the first empty slot, whoever put it there.
- A prompt "X: pick up the beacon" appears when something is within reach. The others get a short toast ("Ada put down a beacon").
- At most **24** things stand in the yard at once.
- **Starting a mission** gives a full box and an empty yard, so every attempt begins the same. An **empty room** does too, for the next group.
- Alone, the same rules run locally.
- Items: **beacon** (teal pole with a pulsing light, for the radio web), **stake** (wooden post, an anchor for the winch), **cone** (orange cone, just a marker). They are not solid yet: cars drive through them. Making stakes solid belongs with the winch.

## How it is built

- `shared/toolbox.ts`, pure and immutable: `newTools`, `dropItem`, `pickUp`, `nearestPlaced`, `placedOf` (so the later systems can ask "where are the beacons"), `dropSpot`, and a compact wire form (`toWire`/`fromWire`: six letters for the slots, positions in centimetres).
- The room (`room-logic.ts`) holds the authority. It also remembers where each car last said it was (not saved) and refuses a drop more than 8 m from the car, a pick up from more than 7 m, and anything outside the yard. Refusals go to the sender only.
- Persisted with players, props, rules and mission, so a room that slept keeps its box and its yard.
- Protocol: client `{type:'tool', op:'drop'|'pickup'}`, server `{type:'tools', tools, event?, by?, kind?, reason?}` (always the whole state: small and rare), and `tools` in the welcome.
- Client: `game/tools.ts` (keys, prompt, local mode), `render/placed-objects.ts` (small procedural models, shared geometry), `ui/toolbox-bar.ts` (the six slots).

## Budget

A drop or a pick up is one incoming message (1/20 of a free-plan request) plus one small storage write. The reply goes to everyone and is free. A full yard is under 3 KB on the wire. No timers.

## Tested

- `tests/toolbox.test.ts` (14): drop and pick up rules, immutability, ids never reused, the 24 limit, nearest in reach, wire round trip and junk input.
- Room (10) and protocol checks: welcome carries the state, drops reach everyone, pick up by another player, refusals go to the sender only, distance checks once the room knows the car, outside the yard, a mission start refills, hibernation keeps it, an empty room resets.
- Real worker (`scripts/net-smoke.mjs`, runs in CI): a late joiner after the room has slept finds the same box and yard, and a pick up still works.
- Browsers (solo, then two players on a real worker): alone, key 5 then E puts the second slot's beacon down and X takes it back; in a room, A drops a beacon and a cone, B sees both drawn and a toast, B drives next to the beacon and sees "X: pick up the beacon", picks it up, A sees it vanish and the box refill; far from everything X says there is nothing to pick up. Each player keeps their own selected slot.

## Not done

- Placed items are not solid and nothing reacts to them yet. Beacons will feed the signal web (Step 4); stakes will be anchors (Step 5).
- No gamepad binding for the toolbox.
- The first empty slot receives a picked-up item; there is no way to choose the slot.
