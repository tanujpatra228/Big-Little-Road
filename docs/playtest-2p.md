# Two-player playtest kit

A 30 minute session for you and one other person, covering everything built so far. It runs the **week-4 gate** from the plan (two real players carry the plank at 150 ms ping and it feels good) and collects the feel numbers that decide what to build and tune next. The original single-player protocol for the cars is `phase-1-playtest.md`; the outside-tester gate (5 strangers) still needs people who have not seen the game.

## Setup (3 minutes)

1. One of you opens the game and presses **Start a room**. Copy the invite link and send it.
2. The second player opens the link. **To simulate a 150 ms connection**, the second player adds `&lag=150` to the end of the link (the invite panel then shows "Simulated lag: 150 ms each way", which is about a 300 ms round trip, harsher than a normal 150 ms ping).
3. Both press **F3** once and keep the performance panel open for the first minute. Write down the fps, frame, JS, submit and pixels lines and which tier and Auto level it settles on. This tells me what to optimise.
4. Keys: W A S D drive, Space jump, Shift nitro, C handbrake, V orbit camera, 1 2 3 switch car, F hook the plank, T return the plank, Q ping wheel, M mute. With `&debug` in the link: K flips your own car, R resets it at once.

## The session

Spend about 4 minutes on each. Take the notes as you go: for each one, write **worked**, **awkward** or **broken** and one sentence.

| # | Do this | Watch for |
|---|---|---|
| 1 | **Warm up.** Each of you drives all three cars, jumps (Space), boosts (Shift), tries the orbit camera (V). | Does anything feel floaty or stuck? Which car do you like? |
| 2 | **The plank gate.** Both hook the plank (F near an end), drive in convoy to the Terrace wall (the raised platform at the east), set it down (F, both) so it leans on the wall, and one drives up. | Can you steer as a pair? Does the rope limit feel fair, and does the red rope warn you in time? Does the 150 ms lag make carrying unusable? **This is the gate: does it feel good?** |
| 3 | **Ping wheel.** Hold Q, flick to each slice, release. Tap Q for a quick Go here. | Does the other person notice the marker? Does the wheel get in the way? |
| 4 | **Shared battery.** Both boost at the same time until it runs dry. Watch the TEAM BATTERY bar. | Did it feel like a team decision, or just annoying? Is 10 seconds too short or too long? |
| 5 | **Radio range.** Tick "Radio range (needs a Relay)". One of you switches to the Relay (key 3) and stays near the base. The other drives out past the ring (about 48 m). | What happens at the edge? Is the lag noticeable? Is the Relay player bored or busy? Could the Relay drive and still help? |
| 6 | **Rescue.** With `&debug`, one presses K to flip. The other drives up close and waits a second. | Did the pinged marker show? Did the flipped car roll back over? |
| 7 | **Look and sound.** Switch cars a few times, drive through the mud and past the pond. | Is the transformation fun or too long? Does the mud read as mud? Any sound too loud or annoying? |

## What to send me

- The pass or fail on **step 2** with a sentence on why. If it fails, tell me which part: the rope, the lag, the steering, or the ramp.
- Your worked, awkward or broken notes for each step.
- The F3 numbers from setup, and the fps with Grass set to 0 and then Shadows switched off (the panel has switches).
- Anything that confused you without being asked.

## How I will use it

- A pass on step 2 keeps the plank and the Terrace and lets me polish them. A fail cuts tether carry and moves the weight to signal and split vision, as the plan says.
- Steps 4 and 5 tune the numbers in `shared/battery.ts` and `shared/signal.ts`.
- The F3 numbers decide whether the next performance work is the terrain colour, the terrain lighting or the grass.
