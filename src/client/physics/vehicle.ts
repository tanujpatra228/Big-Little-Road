import RAPIER from '@dimforge/rapier3d-compat';
import { approach, clamp, driveCommand, steerAngle, type DriveInput } from '../../shared/driving';
import type { CarSpec } from '../../shared/cars';
import { resolveSurface, Surface } from '../../shared/surfaces';
import { impactFromDelta, type Impact } from '../../shared/audio-model';
import type { PhysicsWorld } from './world';

const WHEELS = 4;
export const FLIP_RESET_SECONDS = 10;
const FIXED_STEP = 1 / 60;

export interface Pose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export interface WheelState {
  /** Wheel centre in chassis space. */
  x: number; y: number; z: number;
  steer: number;
  spin: number;
  contact: boolean;
}

export class Vehicle {
  readonly spec: CarSpec;
  readonly body: RAPIER.RigidBody;
  private readonly ctrl: RAPIER.DynamicRayCastVehicleController;
  private readonly pw: PhysicsWorld;
  private steerCmd = 0;
  private prev: Pose;
  private cur: Pose;

  /** Surface under the car, for the HUD and for drag. */
  surface: Surface = Surface.Patio;
  flippedFor = 0;
  grounded = 0;
  speed = 0;
  /** True while the driver is braking or on the handbrake. Drives the brake lights. */
  braking = false;
  private velBefore = { x: 0, y: 0, z: 0 };
  private impact: Impact | null = null;

  constructor(pw: PhysicsWorld, spec: CarSpec, x: number, z: number, yaw: number) {
    this.pw = pw;
    this.spec = spec;
    const R = pw.rapier;
    const y = pw.terrain.heightAt(x, z) + spec.wheelRadius + spec.suspensionRest + spec.half.y + 0.3;
    const half = Math.sin(yaw / 2);
    this.body = pw.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: half, z: 0, w: Math.cos(yaw / 2) })
        .setAngularDamping(spec.angularDamping)
        .setLinearDamping(0.02)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    const { half: h } = spec;
    // Chassis with an angled underbody at the nose and tail (approach and departure angles),
    // so it rides up onto things instead of snagging, and slides off when it does land on one.
    const ch = h.z * 0.45;
    const cs = 0.08;
    const hull = R.ColliderDesc.convexHull(
      new Float32Array([
        h.x, h.y, h.z, -h.x, h.y, h.z, h.x, h.y, -h.z, -h.x, h.y, -h.z,
        h.x - cs, -h.y, h.z - ch, -(h.x - cs), -h.y, h.z - ch, h.x - cs, -h.y, -(h.z - ch), -(h.x - cs), -h.y, -(h.z - ch),
      ]),
    );
    const collider = pw.world.createCollider(
      (hull ?? R.ColliderDesc.cuboid(h.x, h.y, h.z)).setFriction(0.3).setRestitution(0.05),
      this.body,
    );
    // Mass and inertia from a box, with the centre of mass dropped for stability.
    const inertia = (m: number, a: number, b: number): number => (m / 3) * (a * a + b * b);
    collider.setMassProperties(
      spec.mass,
      { x: 0, y: -spec.comDrop, z: 0 },
      {
        x: inertia(spec.mass, h.y, h.z),
        y: inertia(spec.mass, h.x, h.z),
        z: inertia(spec.mass, h.x, h.y),
      },
      { x: 0, y: 0, z: 0, w: 1 },
    );

    this.ctrl = pw.world.createVehicleController(this.body);
    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    const corners: Array<[number, number]> = [
      [spec.trackHalf, spec.wheelBaseHalf],
      [-spec.trackHalf, spec.wheelBaseHalf],
      [spec.trackHalf, -spec.wheelBaseHalf],
      [-spec.trackHalf, -spec.wheelBaseHalf],
    ];
    corners.forEach(([cx, cz], i) => {
      this.ctrl.addWheel({ x: cx, y: -h.y * 0.4, z: cz }, down, axle, spec.suspensionRest, spec.wheelRadius);
      this.ctrl.setWheelMaxSuspensionTravel(i, spec.suspensionTravel);
      this.ctrl.setWheelSuspensionStiffness(i, spec.suspensionStiffness);
      this.ctrl.setWheelSuspensionCompression(i, spec.suspensionCompression);
      this.ctrl.setWheelSuspensionRelaxation(i, spec.suspensionRelaxation);
      this.ctrl.setWheelMaxSuspensionForce(i, spec.maxSuspensionForce);
      this.ctrl.setWheelFrictionSlip(i, spec.frictionSlip);
      this.ctrl.setWheelSideFrictionStiffness(i, spec.sideFriction);
    });
    this.cur = this.readPose();
    this.prev = this.cur;
  }

  /** Front wheels are indices 0 and 1. */
  step(input: DriveInput, dt: number): void {
    const { spec } = this;
    const fwdSpeed = this.forwardSpeed();
    this.velBefore = this.body.linvel();
    this.speed = fwdSpeed;

    const t = this.body.translation();
    this.surface = this.pw.terrain.surfaceAt(t.x, t.z);

    // Average the wheel-contact surfaces so straddling a boundary blends.
    let grip = 0;
    let drag = 0;
    let traction = 0;
    let speedFrac = 0;
    for (let i = 0; i < WHEELS; i++) {
      const p = this.ctrl.wheelContactPoint(i);
      const s = p ? this.pw.terrain.surfaceAt(p.x, p.z) : this.surface;
      const props = resolveSurface(s, spec.surfaces);
      grip += props.grip / WHEELS;
      drag += props.drag / WHEELS;
      traction += props.traction / WHEELS;
      speedFrac += spec.surfaceSpeed[s] / WHEELS;
    }

    const target = steerAngle(input.steer, fwdSpeed, spec.maxSteer, spec.steerFalloffSpeed);
    this.steerCmd = approach(this.steerCmd, target, 3.2, dt);
    const top = spec.topSpeed * speedFrac;
    const reverseTop = spec.reverseTopSpeed * speedFrac;
    // Past the surface's speed limit (just drove onto sand): bleed speed off quickly.
    drag += clamp((Math.abs(fwdSpeed) / top - 1) * 3, 0, 3);
    this.braking = (input.throttle < -0.02 && fwdSpeed > 0.6) || input.handbrake;
    const cmd = driveCommand(input, fwdSpeed, spec.enginePower, top, reverseTop, spec.brakeForce, WHEELS, traction);

    for (let i = 0; i < WHEELS; i++) {
      const front = i < 2;
      // Rapier steers toward +x for positive angles; facing +z that is the driver's left.
      this.ctrl.setWheelSteering(i, front ? -this.steerCmd : 0);
      this.ctrl.setWheelEngineForce(i, cmd.engine);
      this.ctrl.setWheelBrake(i, cmd.brake);
      const rearSlide = !front && input.handbrake ? 0.45 : 1;
      this.ctrl.setWheelFrictionSlip(i, spec.frictionSlip * grip * rearSlide);
    }

    this.ctrl.updateVehicle(dt);

    // Soft surfaces: speed-proportional drag the wheel model does not give us.
    const v = this.body.linvel();
    const k = Math.max(0, 1 - drag * dt);
    this.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);

    this.updateGrounded(dt);
  }

  /** Signed speed along the chassis nose (+z), from the body, not the wheels. */
  forwardSpeed(): number {
    const q = this.body.rotation();
    const v = this.body.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return v.x * fx + v.y * fy + v.z * fz;
  }

  /** Call after world.step(). */
  afterPhysics(): void {
    const v = this.body.linvel();
    // Gravity alone adds g*dt of downward speed per step; everything beyond that is a hit.
    const gdt = -this.pw.world.gravity.y * FIXED_STEP;
    const hit = impactFromDelta(v.x - this.velBefore.x, v.y - this.velBefore.y + gdt, v.z - this.velBefore.z);
    if (hit && (!this.impact || hit.intensity > this.impact.intensity)) this.impact = hit;
    this.prev = this.cur;
    this.cur = this.readPose();
  }

  private updateGrounded(dt: number): void {
    let contacts = 0;
    for (let i = 0; i < WHEELS; i++) if (this.ctrl.wheelIsInContact(i)) contacts++;
    this.grounded = contacts;
    const q = this.body.rotation();
    // Up vector y component from the quaternion.
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const stuckUpsideDown = upY < 0.3 && Math.abs(this.speed) < 2.5;
    this.flippedFor = stuckUpsideDown ? this.flippedFor + dt : 0;
  }

  /** The hardest impact since the last call, or null. Read once per frame. */
  consumeImpact(): Impact | null {
    const i = this.impact;
    this.impact = null;
    return i;
  }

  get isFlipped(): boolean {
    return this.flippedFor > 1.2;
  }

  get resetSecondsLeft(): number {
    return Math.max(0, FLIP_RESET_SECONDS - this.flippedFor);
  }

  private readPose(): Pose {
    const t = this.body.translation();
    const q = this.body.rotation();
    return { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  }

  /** Interpolated pose for rendering between fixed physics steps. */
  pose(alpha: number): Pose {
    const a = this.prev;
    const b = this.cur;
    const lerp = (p: number, q: number): number => p + (q - p) * alpha;
    // Normalised lerp is fine for a single 60 Hz step.
    let qx = lerp(a.qx, b.qx), qy = lerp(a.qy, b.qy), qz = lerp(a.qz, b.qz), qw = lerp(a.qw, b.qw);
    const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
    if (dot < 0) { qx = lerp(a.qx, -b.qx); qy = lerp(a.qy, -b.qy); qz = lerp(a.qz, -b.qz); qw = lerp(a.qw, -b.qw); }
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z), qx: qx / n, qy: qy / n, qz: qz / n, qw: qw / n };
  }

  wheelState(i: number): WheelState {
    const hp = this.ctrl.wheelChassisConnectionPointCs(i) ?? { x: 0, y: 0, z: 0 };
    const len = this.ctrl.wheelSuspensionLength(i) ?? this.spec.suspensionRest;
    return {
      x: hp.x,
      y: hp.y - len,
      z: hp.z,
      steer: this.ctrl.wheelSteering(i) ?? 0,
      spin: this.ctrl.wheelRotation(i) ?? 0,
      contact: this.ctrl.wheelIsInContact(i),
    };
  }

  /** Puts the car upright where it stands. Used by the rescue reset. */
  resetUpright(): void {
    const t = this.body.translation();
    const q = this.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const y = this.pw.terrain.heightAt(t.x, t.z) + this.spec.wheelRadius + this.spec.suspensionRest + this.spec.half.y + 0.4;
    this.body.setTranslation({ x: t.x, y, z: t.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.flippedFor = 0;
    this.cur = this.prev = this.readPose();
  }

  /** Safety net: fell out of the world or wedged in the fence. */
  isOutOfBounds(): boolean {
    const t = this.body.translation();
    const lim = this.pw.terrain.size / 2 - 1;
    return t.y < -30 || Math.abs(t.x) > lim || Math.abs(t.z) > lim;
  }

  dispose(): void {
    this.pw.world.removeVehicleController(this.ctrl);
    this.pw.world.removeRigidBody(this.body);
  }

  get upright(): number {
    return clamp(1 - 2 * (this.body.rotation().x ** 2 + this.body.rotation().z ** 2), -1, 1);
  }
}
