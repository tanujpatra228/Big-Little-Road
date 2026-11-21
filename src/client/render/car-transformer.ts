import * as THREE from 'three';
import { wheelRestY, type CarSpec } from '../../shared/cars';
import {
  TRANSFORM_DURATION, WHEEL_SWAP_AT, armScale, lerp, lockEvents, wheelBlend, type FrameId, type LockEvent, type RegionId,
} from '../../shared/transform-anim';
import type { Pose, Vehicle, WheelState } from '../physics/vehicle';
import { CarMesh } from './car-mesh';
import { glow } from './glow';
import { TransformRig } from './transform-rig';

const SPARK_SLOTS = 72;
const SPARK_LIFE = 0.45;

/**
 * Small metal sparks where a part clicks home. A fixed pool, so a transformation never allocates.
 * Each spark fades by dimming its colour (the points are additive) and parks itself when it dies.
 */
class Sparks {
  private readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly vel = new Float32Array(SPARK_SLOTS * 3);
  private readonly age = new Float32Array(SPARK_SLOTS).fill(SPARK_LIFE);
  private next = 0;

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(SPARK_SLOTS * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(SPARK_SLOTS * 3), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.16, map: glow(), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < SPARK_SLOTS; i++) this.pos.setXYZ(i, 0, -999, 0);
    scene.add(this.points);
  }

  /** `carVel` is shared (half of it), so sparks travel with a moving car. */
  emit(at: THREE.Vector3, carVel: { x: number; z: number }, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % SPARK_SLOTS;
      const a = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.6;
      this.pos.setXYZ(i, at.x, at.y, at.z);
      this.vel[i * 3] = Math.cos(a) * speed + carVel.x * 0.5;
      this.vel[i * 3 + 1] = 0.6 + Math.random() * 1.8;
      this.vel[i * 3 + 2] = Math.sin(a) * speed + carVel.z * 0.5;
      this.age[i] = 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < SPARK_SLOTS; i++) {
      const age = this.age[i]!;
      if (age >= SPARK_LIFE) continue;
      const next = age + dt;
      this.age[i] = next;
      if (next >= SPARK_LIFE) {
        this.pos.setXYZ(i, 0, -999, 0);
        this.col.setXYZ(i, 0, 0, 0);
        continue;
      }
      this.vel[i * 3 + 1]! -= 9 * dt;
      this.pos.setXYZ(i, this.pos.getX(i) + this.vel[i * 3]! * dt, this.pos.getY(i) + this.vel[i * 3 + 1]! * dt, this.pos.getZ(i) + this.vel[i * 3 + 2]! * dt);
      const f = 1 - next / SPARK_LIFE;
      this.col.setXYZ(i, 1 * f, 0.82 * f, 0.5 * f);
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Holds a car's model and changes it into another by taking it apart: the small details fold away
 * on hinges, the five big boxes lift, travel and lock into the new shape, the wheels glide to the
 * new track and swap tyres, and the new details unfold. Sparks fly where parts click home.
 * The physics does not wait; the car keeps moving the whole time.
 */
export class CarTransformer {
  private current: CarMesh;
  private outgoing: CarMesh | null = null;
  private rig: TransformRig | null = null;
  private sparks: Sparks | null = null;
  private events: LockEvent[] = [];
  private nextEvent = 0;
  private t = -1; // seconds into the animation, or -1 when idle
  private carVel = { x: 0, z: 0 };
  private visible = true;
  private lastStates: readonly WheelState[] = [];
  private readonly scratch = new THREE.Vector3();
  /** Fires when a transformation begins, e.g. for sound. */
  onStart: (() => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    spec: CarSpec,
  ) {
    this.current = new CarMesh(spec);
    scene.add(this.current.group);
  }

  /** The model currently shown (or about to be). */
  get mesh(): CarMesh {
    return this.current;
  }

  get animating(): boolean {
    return this.t >= 0;
  }

  /** Seconds into the running transformation, or -1. */
  get time(): number {
    return this.t;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (this.t < 0) {
      this.current.group.visible = this.visible;
      return;
    }
    const swapped = this.t >= WHEEL_SWAP_AT;
    this.current.group.visible = this.visible && swapped;
    if (this.outgoing) this.outgoing.group.visible = this.visible && !swapped;
    if (this.rig) this.rig.group.visible = this.visible;
  }

  /** Replace the model at once, no animation. */
  reset(spec: CarSpec): void {
    this.finish();
    this.scene.remove(this.current.group);
    this.current = new CarMesh(spec);
    this.current.group.visible = this.visible;
    this.scene.add(this.current.group);
  }

  /** Start the transformation into `spec`. If one is already running it is completed first. */
  transformTo(spec: CarSpec, carVel: { x: number; z: number } = { x: 0, z: 0 }): void {
    this.finish();
    this.outgoing = this.current;
    this.current = new CarMesh(spec);
    this.scene.add(this.current.group);
    // Both cars' bodies are hidden: the rig stands in for them. Their wheels and arms still show.
    this.outgoing.setBodyVisible(false);
    this.current.setBodyVisible(false);
    this.rig = new TransformRig(this.outgoing.parts, this.outgoing.spec, this.current.parts, this.current.spec);
    this.scene.add(this.rig.group);
    this.sparks = new Sparks(this.scene);
    this.events = lockEvents();
    this.nextEvent = 0;
    this.carVel = carVel;
    this.t = 0;
    this.pose(this.current.group.position, this.current.group.quaternion);
    this.applyFrame();
    this.onStart?.();
  }

  /** Jump to the end of any running animation. */
  private finish(): void {
    if (this.t < 0) return;
    if (this.outgoing) {
      this.scene.remove(this.outgoing.group);
      this.outgoing = null;
    }
    this.rig?.dispose();
    this.rig = null;
    this.sparks?.dispose();
    this.sparks = null;
    this.current.setBodyVisible(true);
    this.current.setWheelScale(1);
    this.current.setTrimScale(1);
    this.t = -1;
    this.current.group.visible = this.visible;
    if (this.lastStates.length) this.current.setWheels(this.lastStates);
  }

  /** Copies a pose onto the rig and the outgoing car, so they follow the car. */
  private pose(p: THREE.Vector3, q: THREE.Quaternion): void {
    this.rig?.setPose({ x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    if (this.outgoing) {
      this.outgoing.group.position.copy(p);
      this.outgoing.group.quaternion.copy(q);
    }
  }

  setPose(pose: Pose): void {
    this.current.setPose(pose);
    this.pose(this.current.group.position, this.current.group.quaternion);
  }

  setWheels(states: readonly WheelState[]): void {
    this.lastStates = states;
    if (this.t < 0) this.current.setWheels(states);
    else this.applyWheels();
  }

  /**
   * Wheels while transforming: they start where the old car had them and glide to where the physics
   * (already the new car's) has them, growing or shrinking to the new radius. The old tyres show
   * until the middle of the glide, then the new ones take over at the same size.
   */
  private applyWheels(): void {
    const out = this.outgoing;
    const states = this.lastStates;
    if (!out || !states.length) return;
    const from = out.spec;
    const to = this.current.spec;
    const k = wheelBlend(this.t);
    const blended: WheelState[] = states.map((s) => {
      const sx = Math.sign(s.x) || 1;
      const sz = Math.sign(s.z) || 1;
      return {
        ...s,
        x: lerp(sx * from.trackHalf, s.x, k),
        z: lerp(sz * from.wheelBaseHalf, s.z, k),
        y: s.y + (1 - k) * (wheelRestY(from) - wheelRestY(to)),
      };
    });
    const radius = lerp(from.wheelRadius, to.wheelRadius, k);
    out.setWheelScale(radius / from.wheelRadius);
    this.current.setWheelScale(radius / to.wheelRadius);
    const swapped = this.t >= WHEEL_SWAP_AT;
    (swapped ? this.current : out).setWheels(blended);
    const trim = armScale(this.t);
    out.setTrimScale(swapped ? 0 : trim);
    this.current.setTrimScale(swapped ? trim : 0);
  }

  /** Everything that depends on the clock: rig, wheels, which model shows. */
  private applyFrame(): void {
    this.rig?.update(this.t);
    this.applyWheels();
    this.applyVisibility();
  }

  /** Local car: pose, wheels, lights from the vehicle. */
  update(vehicle: Vehicle, pose: Pose, dt: number): void {
    this.current.update(vehicle, pose, dt);
    if (this.t >= 0) this.lastStates = [0, 1, 2, 3].map((i) => vehicle.wheelState(i));
    this.pose(this.current.group.position, this.current.group.quaternion);
    this.tick(dt);
  }

  /** Advance the animation. Call every frame. */
  tick(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    this.applyFrame();

    while (this.nextEvent < this.events.length && this.t >= this.events[this.nextEvent]!.t) {
      this.lock(this.events[this.nextEvent]!);
      this.nextEvent++;
    }
    this.sparks?.update(dt);

    if (this.t >= TRANSFORM_DURATION) this.finish();
  }

  /** Sparks where a big box or a group of details clicks into place. */
  private lock(e: LockEvent): void {
    if (!this.rig || !this.sparks) return;
    const local =
      e.kind === 'frame' ? this.rig.framePosition(e.id as FrameId, this.scratch) : this.scratch.set(0, e.id === ('top' as RegionId) ? this.current.spec.half.y * 0.9 : 0, e.id === 'front' ? this.current.spec.half.z * 0.6 : e.id === 'rear' ? -this.current.spec.half.z * 0.6 : 0);
    const world = this.rig.group.localToWorld(local.clone());
    this.sparks.emit(world, this.carVel, e.kind === 'frame' ? 7 : 4);
  }

  dispose(): void {
    this.finish();
    this.scene.remove(this.current.group);
  }
}
