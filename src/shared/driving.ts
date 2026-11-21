export interface DriveInput {
  /** -1 (reverse/brake) to 1 (forward). */
  throttle: number;
  /** -1 (left) to 1 (right). */
  steer: number;
  handbrake: boolean;
}

export const NO_INPUT: Readonly<DriveInput> = { throttle: 0, steer: 0, handbrake: false };

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function deadzone(v: number, dz = 0.12): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

/** Steering authority falls off with speed so fast cars stay controllable. */
export function steerAngle(steer: number, speed: number, maxSteer: number, falloffSpeed: number): number {
  const s = Math.abs(speed) / falloffSpeed;
  const factor = 1 / (1 + s * s);
  return clamp(steer, -1, 1) * maxSteer * Math.max(0.18, factor);
}

/** Moves `current` toward `target` by at most `rate * dt`. Smooths keyboard steering. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const d = target - current;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

/** Full force until close to top speed, then a quick fade to zero. */
export function taper(ratio: number): number {
  const r = clamp(ratio, 0, 1);
  return 1 - r * r * r;
}

export interface WheelCommand {
  engine: number; // force per wheel; sign follows chassis forward
  brake: number; // per wheel
}

/**
 * Turns driver input into engine/brake force. `forwardSpeed` is signed along the car's nose.
 * Engine force holds up until near top speed, then fades to zero.
 */
export function driveCommand(
  input: DriveInput,
  forwardSpeed: number,
  power: number,
  topSpeed: number,
  reverseTopSpeed: number,
  brakeForce: number,
  wheels: number,
  traction: number,
): WheelCommand {
  const t = clamp(input.throttle, -1, 1);
  const movingForward = forwardSpeed > 0.6;
  const movingBack = forwardSpeed < -0.6;
  let engine = 0;
  let brake = 0;

  if (t > 0.02) {
    if (movingBack) brake = brakeForce * t;
    else engine = power * t * taper(forwardSpeed / topSpeed);
  } else if (t < -0.02) {
    if (movingForward) brake = brakeForce * -t;
    else engine = -power * 0.7 * -t * taper(-forwardSpeed / reverseTopSpeed);
  } else {
    brake = brakeForce * 0.4; // light engine braking
  }
  if (input.handbrake) brake = Math.max(brake, brakeForce); // slide comes from rear grip loss, not extra braking

  return { engine: (engine * traction) / wheels, brake: brake / wheels };
}
