# RC Car Rescue Mission: Two-Player Co-op Mode

Status: design captured, not scheduled. Implementation notes (added by engineering) are at the bottom, after the original design.

## Original design

### 1. Game Mode Overview

**RC Car Rescue Mission** is a cooperative two-player challenge in which both players must work together to locate, recover, and revive a stranded RC car.

During their adventure, players will randomly encounter a disabled RC car in different locations and challenging situations. The RC car could be stuck deep in the mud, trapped between rocks, fallen off a hill, stranded in a ditch, stuck underwater, or left in an otherwise difficult-to-reach location.

The objective is not simply to reach the RC car but to figure out how to rescue it using teamwork, creativity, and the tools available in the environment.

### 2. Dynamic Rescue Scenarios

Every time players start or encounter this mission during their co-op adventure, the disabled RC car can spawn in a different location with a different rescue challenge.

Possible scenarios include:

- **Stuck in Mud:** The RC car is deeply stuck in thick mud. Players must push it together or attach a rope and pull it out.
- **Fallen from a Hill:** The RC car has fallen down a steep hill. Players must find a safe route, attach a rope, and carefully pull it back up.
- **Trapped Between Rocks:** The RC car is wedged between rocks. Players must find a way to move obstacles or pull it out.
- **Stuck in a Deep Ditch:** One player can climb down and attach a rope while the other pulls the car from above.
- **Stranded Across Water:** Players must figure out how to retrieve the RC car without losing it in the water.
- **Blocked by Obstacles:** The RC car is trapped beneath branches, debris, or other environmental objects that players must clear.

### 3. Cooperative Gameplay Mechanics

Both players must actively participate in the rescue. The mission should encourage communication and coordination rather than allowing one player to complete everything alone.

Possible cooperative mechanics:

- **Push Together:** Both players physically push the disabled RC car to free it from mud or other obstacles.
- **Rope Attachment:** One player attaches a rope to the stranded RC car while the other finds a suitable position to pull it.
- **Pull and Guide:** One player operates the pulling mechanism while the other guides the RC car, preventing it from hitting obstacles or falling again.
- **Find a Safe Route:** Players explore the surroundings together to discover the safest recovery path.
- **Move Obstacles:** Both players work together to remove objects blocking the RC car.
- **Balance and Stabilize:** One player stabilizes the RC car while the other pulls it through a difficult section.

Players should have different responsibilities depending on the situation, making both characters equally important.

### 4. RC Car Revival: Final Objective

Rescuing the RC car is only the first part of the mission.

Once players successfully recover it and bring it to a safe location, they must revive it.

The RC car's battery should be detached or missing, requiring players to locate and install a replacement battery.

The revival sequence could involve:

1. Recovering the disabled RC car.
2. Bringing it to a safe, flat surface.
3. Finding or collecting its missing battery.
4. Both players working together to install the battery.
5. Activating the RC car and watching it come back to life.

Once revived, the RC car powers on, its lights illuminate, and its wheels start moving again.

### 5. Reward and Completion

After successfully reviving the RC car:

- The mission is marked as completed.
- Players receive rewards such as points, collectibles, or achievements.
- The rescued RC car can become a friendly companion or follow players during their adventure.
- Alternatively, players can temporarily control the revived RC car to explore small areas, discover hidden collectibles, or access locations that are difficult for the main characters to reach.

### 6. Replayability

To keep this mode interesting throughout the adventure:

- Randomize the RC car's rescue location.
- Introduce different rescue situations every time.
- Vary the difficulty depending on the environment.
- Randomize the tools and resources available.
- Introduce situations requiring different combinations of cooperative mechanics.
- Include rare rescue scenarios with additional rewards.

### Core Gameplay Philosophy

**Two players. One stranded RC car. One shared mission.**

The main focus of this mode is cooperative problem-solving. Players should feel that they genuinely need each other to complete the rescue.

The experience should be fun, physics-driven, and occasionally chaotic, with memorable moments emerging naturally from players pushing, pulling, climbing, balancing, and experimenting together.

The ultimate satisfaction comes from finding a seemingly impossible-to-reach RC car, working together to recover it, and finally bringing it back to life.

---

## Implementation notes (engineering, not part of the original design)

### Open conflict to resolve first: who are "the players"?

The design talks about players who push, climb down into ditches and attach ropes, and calls them "characters". In this game the players are RC cars. They cannot climb or grab. Proposed mapping, which keeps the design intent:

| Design says | In the RC-car game |
|---|---|
| Players push the car together | Two cars nose against the stranded car and drive; a freed-from-mud check needs combined push force over a threshold |
| One player climbs down and attaches the rope | One car drives down a ramp or slope into the ditch and its winch hooks the stranded car |
| Attach a rope and pull | Hauler winch to an anchor point on the stranded car (Phase 3 winch) |
| Pull and guide | Hauler pulls; the other car or the Scout calls out and ping-wheel marks the route |
| Balance and stabilize | Second car holds the stranded car's side with its own winch or bumper while the first pulls |
| Move obstacles | Push or tow branches and debris (towable props) |
| Find or collect the battery | A battery pickup prop, carried by tether or winch like the Plank Bridge plank |
| Both players install the battery | Both cars must be inside a ring around the stranded car for 3 s while a progress bar fills |

If you actually want on-foot characters, that is a different game and a large scope change. Decide before building.

### How it fits the existing plan

- It reuses systems already planned: winch with anchors and tether carry (Phase 3), shared battery (Phase 3), rescue-not-reset (Phase 3), ping wheel (Phase 3), and mission runtime (Phase 4).
- It overlaps the existing "Mud Bog Rescue" and "Dead Signal" missions. Treat Rescue Mission as the generalized, randomized version and fold Mud Bog Rescue into it as its first scenario, instead of building both.
- It is a better fit for Challenge Mode (2 to 4 players) than a strict two-player mode. Design for 2, allow 3 or 4 with scaled difficulty, since room size is already 2 to 4.

### Phasing

Not before Phase 3 is done. Randomization multiplies content and test cost, so ship it in layers:

1. First: 3 scenarios that need the least new tech: Stuck in Mud (push or winch), Fallen from a Hill (winch up a slope), Stuck in a Deep Ditch (ramp down, winch up). All use winch and push only.
2. Then: Revival sequence (battery pickup plus install ring) and the reward (companion car).
3. Later: Trapped Between Rocks, Blocked by Obstacles (needs towable props), Stranded Across Water (needs buoyancy and a failure state), rare scenarios.

### Data model (so randomization stays cheap)

Scenarios are data, resolved by the pure `mission-logic.ts` state machine:

- `scenario`: id, spawn region (zone plus terrain constraint), stranded-car pose and stuck state, required actions, available props, difficulty.
- Required actions are a list such as `push(force >= N from 2 cars)`, `winch(anchor, pull direction)`, `clear(prop id)`.
- A seeded generator picks scenario, location and prop set from a room seed, so every player in the room sees the same rescue and it replays identically for debugging.
- Randomizing location must be constrained: a valid spawn needs a reachable approach, a reachable pull position and a flat recovery spot. Validate with a small reachability check at generation time or pre-bake a list of vetted spawn points per scenario. Fully free random placement will produce unwinnable rescues.

### Stranded car as a shared object

- It is a shared physics object: one browser owns it and simulates it (owner assigned on touch), and sends its pose only while it moves.
- "Stuck" is a state, not emergent physics. While stuck it is pinned; freeing it flips it to dynamic when the push or winch condition passes, confirmed by the room. This avoids jittery shared-object fights, which the main design already flags as a risk.
- Timing windows must tolerate 250 ms ping, so progress bars (install ring, push threshold) use hold durations of 2 s or more, never tight timing.
- Battery install: both cars inside the ring is evaluated locally from teammate poses, and the room confirms completion.

### Reward and companion

- Revived car as a controllable third car is cheap to build (it is another car spec with its own vehicle) and fun, so prefer it over an AI follower.
- A follower companion needs bot driving, which the plan defers. Do not promise it for the first release.
- Rewards feed the existing cosmetics and stars systems; no new currency.

### Cloudflare free-plan budget (house rule)

- Mission state lives in the room Durable Object: scenario seed, stuck/freed, rope attached, battery installed, revived. That is a handful of events per rescue, so well under 50 requests.
- The stranded car's pose adds pose messages only while it moves (typically seconds per rescue).
- No new server tick, no alarms. Expected cost: negligible next to pose relay.

### Risks

- Unwinnable random spawns (mitigated by vetted spawn points or a reachability check).
- Push mechanic over a network: two cars pushing one object is the hardest shared-physics case. The week 4 netcode gate decides whether push survives; winch-only scenarios are the fallback.
- Content cost: six scenarios times several locations times prop sets is a lot of art and tuning. Ship three well, not six badly.
- Water scenario needs buoyancy rules the game does not have yet.

### Open questions

- Are players RC cars or characters (see top)?
- Is this its own mode in the menu, or an event that appears during Free Roam ("randomly encounter")? Recommendation: an event in Free Roam that also unlocks as a repeatable mission.
- Does the stranded car belong to a fourth role (a Lifter or a friendly NPC car), or reuse Scout, Hauler or Relay bodies?
