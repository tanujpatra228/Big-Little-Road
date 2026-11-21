# Cameras

Two cameras, switched with **V**. No Cloudflare cost: both are client-only.

## Chase camera (default)

Follows behind the car's heading on the ground, smoothed, never under the terrain. The view widens with speed, and a little more with nitro (up to 9 degrees) while it drops back about 0.9 m. `render/chase-cam.ts`.

## Orbit camera (V)

A camera that circles the car instead of trailing it. It does not turn with the car, so you can watch the plank, a teammate or the road ahead while driving. `render/orbit-cam.ts`, maths in `shared/orbit.ts`.

- **Drag** (any mouse button, or a finger) to look around. Dragging works like grabbing the scene: pull right and the camera swings to the left around the car, pull down and it rises.
- **Wheel** to zoom, 3 to 18 m, proportional so a notch feels the same at any distance.
- **Gamepad:** right stick looks around.
- Pitch is limited between just above the horizon and nearly straight down, so the view never flips. The camera is lifted if it would end up under the terrain.
- Switching starts from the chase view's position, so there is no jump, and switching back snaps behind the car. A short toast names the camera and its controls. Driving keys stay car-relative (W is still forward for the car, not for the camera).
- Nitro widens the view a little (6 degrees) in this mode too.

## Tests

`tests/orbit.test.ts`: offset conventions match the chase camera, drag and zoom directions, clamps, yaw wrap, the chase-to-orbit hand-off, ground clearance. A real-browser run checked V, drag in both axes, wheel, that the offset holds while the car drives, and that V returns to the chase view.

## Not done

Remembering the chosen camera between visits, a first-person or bumper view, and pinch-to-zoom on touch.
