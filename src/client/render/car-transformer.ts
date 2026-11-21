import * as THREE from 'three';
import type { CarSpec } from '../../shared/cars';
import { SWAP_AT, TRANSFORM_DURATION, flashStrength, incomingScale, outgoingScale, ringProgress } from '../../shared/transform-anim';
import type { Pose, Vehicle, WheelState } from '../physics/vehicle';
import { CarMesh } from './car-mesh';
import { glow } from './glow';

const SPARKS = 34;

/** The one-off effects of a single transformation: flash, ground ring, and a spark burst. */
class Burst {
  private readonly flash: THREE.Sprite;
  private readonly ring: THREE.Mesh;
  private readonly points: THREE.Points;
  private readonly vel = new Float32Array(SPARKS * 3);
  private sparksLive = false;

  constructor(private readonly scene: THREE.Scene) {
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow(), color: 0xfff0c4, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, fog: false }),
    );
    this.flash.renderOrder = 20;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 56).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe2a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.ring.renderOrder = 19;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffd98a, size: 0.3, map: glow(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.flash, this.ring, this.points);
  }

  /** `at` is the car's position; sparks inherit half its velocity so they travel with a moving car. */
  emitSparks(at: THREE.Vector3, carVel: { x: number; z: number }): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 4;
      const up = 0.4 + Math.random() * 0.9;
      pos.setXYZ(i, at.x, at.y, at.z);
      this.vel[i * 3] = Math.cos(a) * speed + carVel.x * 0.5;
      this.vel[i * 3 + 1] = up * speed;
      this.vel[i * 3 + 2] = Math.sin(a) * speed + carVel.z * 0.5;
    }
    pos.needsUpdate = true;
    this.sparksLive = true;
    this.points.visible = true;
  }

  update(t: number, carPos: THREE.Vector3, dt: number): void {
    const f = flashStrength(t);
    this.flash.visible = f > 0;
    this.flash.position.set(carPos.x, carPos.y + 0.2, carPos.z);
    this.flash.scale.setScalar(0.6 + f * 3.2);
    (this.flash.material as THREE.SpriteMaterial).opacity = Math.min(1, f * 1.1);

    const r = ringProgress(t);
    this.ring.visible = r > 0 && r < 1;
    this.ring.position.set(carPos.x, carPos.y - 0.45, carPos.z);
    this.ring.scale.setScalar(0.5 + r * 3.2);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - r) * 0.85;

    if (this.sparksLive) {
      const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < SPARKS; i++) {
        this.vel[i * 3 + 1]! -= 9 * dt;
        pos.setXYZ(i, pos.getX(i) + this.vel[i * 3]! * dt, pos.getY(i) + this.vel[i * 3 + 1]! * dt, pos.getZ(i) + this.vel[i * 3 + 2]! * dt);
      }
      pos.needsUpdate = true;
      (this.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - (t - SWAP_AT) / 0.5);
    }
  }

  dispose(): void {
    this.scene.remove(this.flash, this.ring, this.points);
    (this.flash.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Holds a car's model and changes it into another with a short transformation: the old car squashes
 * under a building flash, then the new one springs up with a spark burst and a ground ring.
 * The physics does not wait; the car keeps moving the whole time.
 */
export class CarTransformer {
  private current: CarMesh;
  private outgoing: CarMesh | null = null;
  private burst: Burst | null = null;
  private t = -1; // seconds into the animation, or -1 when idle
  private swapped = false;
  private carVel = { x: 0, z: 0 };
  private visible = true;
  /** Fires at the moment of the swap, e.g. for sound. */
  onSwap: (() => void) | null = null;

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

  setVisible(v: boolean): void {
    this.visible = v;
    this.current.group.visible = v && (this.t < 0 || this.swapped);
    if (this.outgoing) this.outgoing.group.visible = v && !this.swapped;
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
    this.current.group.visible = false; // appears at the swap
    this.current.group.scale.setScalar(0.001);
    this.scene.add(this.current.group);
    this.burst = new Burst(this.scene);
    this.carVel = carVel;
    this.t = 0;
    this.swapped = false;
  }

  /** Jump to the end of any running animation. */
  private finish(): void {
    if (this.t < 0) return;
    if (this.outgoing) {
      this.scene.remove(this.outgoing.group);
      this.outgoing = null;
    }
    this.current.group.scale.setScalar(1);
    this.current.group.visible = this.visible;
    this.burst?.dispose();
    this.burst = null;
    this.t = -1;
  }

  setPose(pose: Pose): void {
    this.current.setPose(pose);
    this.outgoing?.setPose(pose);
  }

  setWheels(states: readonly WheelState[]): void {
    this.current.setWheels(states);
  }

  /** Local car: pose, wheels, lights from the vehicle. The outgoing model only follows the pose. */
  update(vehicle: Vehicle, pose: Pose, dt: number): void {
    this.current.update(vehicle, pose, dt);
    this.outgoing?.setPose(pose);
    this.tick(dt);
  }

  /** Advance the animation. Call every frame. */
  tick(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const pos = this.current.group.position;

    if (!this.swapped && this.t >= SWAP_AT) {
      this.swapped = true;
      if (this.outgoing) this.outgoing.group.visible = false;
      this.current.group.visible = this.visible;
      this.burst?.emitSparks(pos, this.carVel);
      this.onSwap?.();
    }

    if (!this.swapped) {
      const s = outgoingScale(this.t);
      this.outgoing?.group.scale.set(s.x, s.y, s.z);
    } else {
      const s = incomingScale(this.t);
      this.current.group.scale.set(s.x, s.y, s.z);
    }
    this.burst?.update(this.t, pos, dt);

    if (this.t >= TRANSFORM_DURATION) this.finish();
  }

  dispose(): void {
    this.finish();
    this.scene.remove(this.current.group);
  }
}
