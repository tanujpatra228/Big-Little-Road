# Feature docs

House rule: every feature that touches Cloudflare gets a doc here with a budget note
(requests per session, GB-s, and which free-plan limit binds) before code is merged.

## Index

- [RC Car Rescue Mission](rc-car-rescue-mission.md): randomized two-player rescue and revival missions (design captured, not scheduled).
- [Art direction](art-direction.md): toy-diorama style, all art generated in code, milestones G1 to G5 and budgets.
- [Audio](audio.md): all sound synthesized live with Web Audio, engine voices per car, surface-driven tyre noise, impacts, horn, ambience.
- [Multiplayer](multiplayer.md): rooms on Durable Objects, join by link, smoothed remote cars, message budget, tests.
- [Car abilities](car-abilities.md): plan for drift, jump and nitro on all cars, with per-car tuning, guard rails, controls and order of work.
- [Signal web](signal-web.md): radio range from the base and Relay trucks, lag, failsafe, the room switch, and the hibernation bug it found.
- [Shared battery](shared-battery.md): one team power meter in a room that boosting drains, run-dry lockout, how it is kept without timers.
- [Performance](performance.md): what costs frames (grass, terrain, effects), what changed, automatic quality, the F3 panel, next levers.
- [Ping wheel](ping-wheel.md): hold Q, flick to Go here, Wait, Tow me, Low battery or Look; markers, edge arrows, cooldown, budget.
- [Cameras](camera.md): the chase camera and the orbit camera (V, drag to look, wheel to zoom).
- [Switching cars](car-transform.md): momentum carried across a switch, the transformation animation and sound, how to preview it.
- [The Terrace puzzle](terrace-puzzle.md): the first two-player puzzle, a walled platform reachable only by carrying the plank over as a ramp.
