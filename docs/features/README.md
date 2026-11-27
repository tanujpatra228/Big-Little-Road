# Feature docs

House rule: every feature that touches Cloudflare gets a doc here with a budget note
(requests per session, GB-s, and which free-plan limit binds) before code is merged.

## Index

- [RC Car Rescue Mission](rc-car-rescue-mission.md): randomized two-player rescue and revival missions (design captured, not scheduled).
- [Art direction](art-direction.md): toy-diorama style, all art generated in code, milestones G1 to G5 and budgets.
- [Audio](audio.md): all sound synthesized live with Web Audio, engine voices per car, surface-driven tyre noise, impacts, horn, ambience.
- [Multiplayer](multiplayer.md): rooms on Durable Objects, join by link, smoothed remote cars, message budget, tests.
- [Car abilities](car-abilities.md): plan for drift, jump and nitro on all cars, with per-car tuning, guard rails, controls and order of work.
- [Rescue, not reset](rescue.md): a flipped car pings the team, and a teammate who drives up rolls it back over; why plain pushing was not enough.
- [Mission runtime](missions.md): data-driven missions run by the room, persisted, with a shared checklist, clock and stars; the Terrace is mission 1.
- [Rock Crawl, split vision and low range](rock-crawl.md): the Scout sees the safe line through the rocks, the Hauler is in the dust and in low range; wandering off sends you back to a checkpoint.
- [The crew toolbox](toolbox.md): a shared six-slot box and things to put down in the yard and pick up again; beacons and stakes get their jobs in the next steps.
- [Dead Signal, beacons and the Relay's charge](dead-signal.md): a lost car out past the radio; beacons carry the signal, the Relay tops up the team battery and wakes the car.
- [The winch, the mud trap and Mud Bog Rescue](winch-and-mud.md): the middle of the bog sinks cars, the Hauler's winch pulls them out and spends the team battery.
- [Effects](effects.md): dust, sand, mud, splash and gravel per surface, tyre smoke, tyre marks, hop dust and the nitro trail; scaled by the quality ladder.
- [The handbrake drift](drift.md): a held slide with counter-steer assist, a slip cap, per-car tuning and a nitro charge; the squeal follows slides too.
- [Signal web](signal-web.md): radio range from the base and Relay trucks, lag, failsafe, the room switch, and the hibernation bug it found.
- [Shared battery](shared-battery.md): one team power meter in a room that boosting drains, run-dry lockout, how it is kept without timers.
- [Performance](performance.md): what costs frames (grass, terrain, effects), what changed, automatic quality, the F3 panel, next levers.
- [Ping wheel](ping-wheel.md): hold Q, flick to Go here, Wait, Tow me, Low battery or Look; markers, edge arrows, cooldown, budget.
- [Cameras](camera.md): the chase camera and the orbit camera (V, drag to look, wheel to zoom).
- [Switching cars](car-transform.md): momentum carried across a switch, the transformation animation and sound, how to preview it.
- [The Terrace puzzle](terrace-puzzle.md): the first two-player puzzle, a walled platform reachable only by carrying the plank over as a ramp.
