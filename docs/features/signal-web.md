# Signal web (radio range)

Phase 3, item 2 of the plan. The cars are remote controlled, so each needs a radio link back to the base station. Range is limited, and only a **Relay** (the trophy truck, the one with the mast) can extend it, in a chain. It is the first rule that makes the cars need each other.

## How it plays

- It is a **room switch**, off by default: tick "Radio range (needs a Relay)" in the invite panel. Anyone in the room can switch it on or off, everyone is told (a toast says who), and a late joiner is told the current state. Playing alone, the same tick works locally.
- **Base station:** the patio where everyone starts, with a mast and a pulsing light. It reaches **48 m**.
- **Relay trucks:** a Relay reaches **38 m**, and only if it is itself connected: within 48 m of the base, or within 38 m of a connected Relay. A Relay driven out of everyone's range is cut off itself and helps nobody (its ring turns faint red). Links chain: base, Relay, Relay, car.
- **Signal strength** is 1 beside a source and falls to 0 at its edge. Your car uses the best source, not a sum.
- **Strong (above 50%):** drives normally. **Weak (below 50%):** your steering, throttle and nitro key are delayed, up to 0.6 s at the very edge, growing fast toward the edge (about 40 ms at 37% strength, 180 ms near 18%). **No signal:** the throttle is cut and the car brakes to a stop.
- **You can always get back.** With no signal, steering still works and **reversing still works**, so you back out until the link returns (it comes back with a small margin, so a car at the edge does not stutter on and off). Nitro is off and jumping is blocked while cut off.
- **On screen:** four signal bars (green good, amber weak with the delay in ms, red and blinking when cut off, with the words "NO SIGNAL: throttle cut. Reverse out, or bring a Relay closer"), a cyan ring on the ground at the edge of the base's range and a green one around each connected Relay, and a falling two-tone beep when you lose the link and a rising one when it returns.

## Does the yard need the team? (tested, `tests/signal.test.ts`)

- The patio and the **Terrace are inside the base range** (the Terrace is 29 m out, about 39% strength, with only a few hundredths of a second of lag), so the existing puzzle needs no Relay.
- **Every other zone is out of the base range** (sand 58 m, mud 53 m, rock field 62 m, pond 58 m, woodpile 58 m), and **one well placed Relay is enough** to reach any of them with over 40% strength.
- **The far corners of the yard (about 97 m out) cannot be reached with one Relay, but can with two.** One explorer and two Relays is a whole team of three.
- **A lone player cannot leave the base's 48 m.** Switching car changes your one car in place, so you cannot leave a Relay behind as a beacon. That is the "solo brute force fails" test from the Phase 3 gate.

## How it is built

- `shared/signal.ts`, pure and tested (29 checks): strength, which Relays are linked (a chain search that does not depend on list order), a Relay is never its own source or linked through something only it links, the lag curve (smooth, only grows as the signal falls), the cut-off with hysteresis, the failsafe input (brakes while moving, allows reversing, steering and the handbrake), and `InputDelay`, which replays inputs late and **never reads backward in time**, so a recovering signal catches up instead of replaying old inputs.
- `game/signal.ts` applies it to your inputs every physics step; `render/signal-rings.ts` draws the rings (ribbons that follow the terrain) and the mast.
- **Everything is worked out locally from positions already shared**, so it needs no new messages from the signal itself.

## The room rule, and a bug the real server caught

The switch is one boolean the room keeps (`{type:'rules', signal}`), broadcast to everyone when it changes. **It first lived only in memory, and a real two-browser run found the problem:** when everyone sits still for about 10 s the room hibernates and forgets. It woke with radio range off while both browsers still believed it was on, so a later switch-off looked like "no change" and nobody was told. The rule is now **stored with the room** (it is restored after hibernation). A regression check in `scripts/net-smoke.mjs` waits 14 s for the room to really sleep, then switches the rule off and checks everyone is told. I confirmed that check **fails with the old behaviour and passes with the fix**.

## Budget note (house rule)

One small message from a player each time the switch is flipped (a human action, so rare): 1/20 of a Durable Object request plus one small storage write, and outgoing messages are free. Nothing else: the signal is computed in each browser, so no server cost while driving. No timers, no alarms.

## Tested

- Pure rules, room logic (rule starts off, anyone switches it, everyone told with who did it, no-op changes say nothing, late joiner told, survives a hibernation), protocol parsing, and `scripts/net-smoke.mjs` against the real Worker (including the 14 s sleep).
- Two real browsers: off by default; one player ticks the box and the other gets it on, a toast and a ticked box; near the base the HUD says "SIGNAL"; 58 m out with no Relay, "NO SIGNAL" and **holding forward for 4 s moved the car 0.1 m**; reversing brought the link back at 43 m; a connected Relay 24 m away gave 37% strength, "controls lag 41 ms", and the car drove again; **a Relay driven out of range left the explorer cut off and was cut off itself**; the other player switched it off and the HUD disappeared. No console errors.

## Tuning knobs (`shared/signal.ts`)

`BASE_RANGE` 48, `RELAY_RANGE` 38, `CLEAN_ABOVE` 0.5, `MAX_LAG` 0.6 s, `RECOVER_AT` 0.04. These are first guesses to tune by feel: if lag is never noticeable, raise `MAX_LAG` or `CLEAN_ABOVE`; if the Relay is a chore, raise its range.

## Not done

- It is not on in any mission yet: no mission turns the rule on by itself (the room switch is for now).
- Lag applies to steering, throttle, handbrake and nitro. Jumping is not delayed (it is only blocked when cut off).
- No other player's link status is shown (you cannot see that a teammate is cut off, except by the Relay ring turning red).
- The signal does not carry to the plank or other props, and there is no minimap showing coverage.
- Sound is two short beeps; no static or crackle as the signal fades.
