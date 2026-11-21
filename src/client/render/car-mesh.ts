import * as THREE from 'three';
import type { CarSpec } from '../../shared/cars';
import type { Pose, Vehicle, WheelState } from '../physics/vehicle';
import { buildCar, type CarModel, type CarVariant } from './car-builder';

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

  constructor(spec: CarSpec, variant: CarVariant = 'standard', color?: number) {
    this.model = buildCar(spec, variant, color);
    this.group = this.model.group;
    this.applyLights();
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
    // Beacon breathes so the Relay reads as a signal source.
    this.model.materials.beacon.emissiveIntensity = this.lightsOn ? 2.2 + Math.sin(this.t * 4) * 1.2 : 0;
  }
}
