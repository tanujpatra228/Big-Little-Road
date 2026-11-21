import * as THREE from 'three';
import type { CarSpec } from '../../shared/cars';
import type { Pose, Vehicle, WheelState } from '../physics/vehicle';
import { buildCar, type CarModel, type CarVariant } from './car-builder';
import { glow } from './glow';

/** A car on screen: the generated model plus lights and per-frame wheel and pose updates. */
export class CarMesh {
  readonly group: THREE.Group;
  private readonly model: CarModel;
  private lightsOn = true;
  private braking = false;
  private t = Math.random() * 10;
  private readonly tmpTo = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly flames: THREE.Mesh[] = [];
  private readonly glows: THREE.Sprite[] = [];

  constructor(spec: CarSpec, variant: CarVariant = 'standard', color?: number) {
    this.model = buildCar(spec, variant, color);
    this.group = this.model.group;
    this.applyLights();
    this.buildFlames(spec);
  }

  /** Twin exhaust flames, hidden until the nitro runs. Additive and unlit so bloom picks them up. */
  private buildFlames(spec: CarSpec): void {
    const outer = new THREE.ConeGeometry(0.13, 1, 10, 1, true);
    outer.translate(0, 0.5, 0);
    outer.rotateX(-Math.PI / 2); // base at the origin, tip pointing backward (-z)
    const inner = new THREE.ConeGeometry(0.07, 0.6, 8, 1, true);
    inner.translate(0, 0.3, 0);
    inner.rotateX(-Math.PI / 2);
    const mat = (color: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const orange = mat(0xff8a2a);
    const white = mat(0xcfe8ff);
    for (const side of [-1, 1]) {
      const f = new THREE.Mesh(outer, orange);
      f.add(new THREE.Mesh(inner, white));
      f.position.set(side * spec.half.x * 0.5, -spec.half.y * 0.2, -spec.half.z - 0.04);
      f.visible = false;
      f.renderOrder = 5;
      this.group.add(f);
      this.flames.push(f);
      // A soft halo at the nozzle so the boost reads from behind, where the cone is seen end-on.
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xff9a3a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
      halo.position.set(f.position.x, f.position.y, f.position.z - 0.12);
      halo.visible = false;
      halo.renderOrder = 6;
      this.group.add(halo);
      this.glows.push(halo);
    }
  }

  /** Flame strength 0 (off) to 1 (full boost). Safe to call every frame. */
  setBoost(amount: number): void {
    const on = amount > 0.02;
    const flicker = 0.85 + 0.15 * Math.sin(this.t * 90) + 0.1 * Math.sin(this.t * 53 + 1);
    for (const f of this.flames) {
      f.visible = on;
      if (on) f.scale.set(0.7 + 0.5 * amount, 0.25 + 1.3 * amount * flicker, 0.7 + 0.5 * amount);
    }
    for (const h of this.glows) {
      h.visible = on;
      if (on) h.scale.setScalar((0.55 + 0.35 * amount) * (0.9 + 0.1 * flicker));
    }
  }

  setLights(on: boolean): void {
    this.lightsOn = on;
    this.applyLights();
  }

  setBraking(b: boolean): void {
    if (b === this.braking) return;
    this.braking = b;
    this.applyLights();
  }

  /** Rescue car only: show the battery slotted in. */
  setBattery(inserted: boolean): void {
    if (this.model.battery) this.model.battery.visible = inserted;
  }

  private applyLights(): void {
    const m = this.model.materials;
    m.headlight.emissiveIntensity = this.lightsOn ? 1.7 : 0;
    m.taillight.emissiveIntensity = this.lightsOn ? (this.braking ? 4 : 0.9) : 0;
    m.beacon.emissiveIntensity = this.lightsOn ? 2.5 : 0;
  }

  setPose(pose: Pose): void {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  }

  setWheels(states: readonly WheelState[]): void {
    this.model.wheels.forEach((w, i) => {
      const s = states[i];
      if (!s) return;
      w.pivot.position.set(s.x, s.y, s.z);
      w.pivot.rotation.y = s.steer;
      w.spin.rotation.x = w.flip ? -s.spin : s.spin;
      const arm = this.model.arms[i];
      if (arm) {
        // Aim a unit cylinder from the body anchor to the wheel hub.
        this.tmpTo.set(s.x, s.y, s.z);
        this.tmpDir.subVectors(this.tmpTo, arm.anchor);
        const len = this.tmpDir.length();
        arm.mesh.position.copy(arm.anchor).addScaledVector(this.tmpDir, 0.5);
        arm.mesh.quaternion.setFromUnitVectors(this.up, this.tmpDir.divideScalar(len || 1));
        arm.mesh.scale.set(1, len, 1);
      }
    });
  }

  update(vehicle: Vehicle, pose: Pose, dt = 0.016): void {
    this.setPose(pose);
    this.setWheels([0, 1, 2, 3].map((i) => vehicle.wheelState(i)));
    this.setBraking(vehicle.braking);
    this.t += dt;
    this.setBoost(vehicle.nitro.active ? vehicle.nitro.blend : 0);
    // Beacon breathes so the Relay reads as a signal source.
    this.model.materials.beacon.emissiveIntensity = this.lightsOn ? 2.2 + Math.sin(this.t * 4) * 1.2 : 0;
  }
}
