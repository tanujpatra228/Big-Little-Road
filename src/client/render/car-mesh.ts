import * as THREE from 'three';
import type { CarSpec } from '../../shared/cars';
import type { Pose, Vehicle } from '../physics/vehicle';

/** Low-poly toy car. +z is the nose. */
export class CarMesh {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly spins: THREE.Mesh[] = [];

  constructor(spec: CarSpec) {
    const body = new THREE.MeshStandardMaterial({ color: spec.color, flatShading: true, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x25272b, flatShading: true });
    const h = spec.half;

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(h.x * 2, h.y * 1.2, h.z * 2), body);
    chassis.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(h.x * 1.5, h.y * 1.1, h.z * 0.9), dark);
    cabin.position.set(0, h.y * 1.1, -h.z * 0.1);
    cabin.castShadow = true;
    // Nose marker so facing is obvious.
    const nose = new THREE.Mesh(new THREE.BoxGeometry(h.x * 1.2, h.y * 0.5, h.z * 0.35), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }));
    nose.position.set(0, h.y * 0.2, h.z * 0.95);
    this.group.add(chassis, cabin, nose);

    if (spec.role === 'relay') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), dark);
      mast.position.set(h.x * 0.6, h.y + 0.7, -h.z * 0.55);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0x551111 }));
      ball.position.set(h.x * 0.6, h.y + 1.42, -h.z * 0.55);
      this.group.add(mast, ball);
    } else if (spec.role === 'hauler') {
      const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h.x * 1.6, 8).rotateZ(Math.PI / 2), dark);
      winch.position.set(0, -h.y * 0.1, h.z + 0.08);
      this.group.add(winch);
    } else {
      const roll = new THREE.Mesh(new THREE.TorusGeometry(h.x * 0.7, 0.03, 4, 8, Math.PI), dark);
      roll.position.set(0, h.y * 0.7, -h.z * 0.3);
      roll.rotation.y = Math.PI / 2;
      this.group.add(roll);
    }

    const tyreGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.26, 10).rotateZ(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, flatShading: true });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const steerGroup = new THREE.Group();
      const spin = new THREE.Mesh(tyreGeo, tyreMat);
      spin.castShadow = true;
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.3, spec.wheelRadius * 0.7, 0.07), hubMat);
      spin.add(hub);
      steerGroup.add(spin);
      this.group.add(steerGroup);
      this.wheels.push(steerGroup);
      this.spins.push(spin);
    }
  }

  update(vehicle: Vehicle, pose: Pose): void {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheelState(i);
      const g = this.wheels[i];
      const s = this.spins[i];
      if (!g || !s) continue;
      g.position.set(w.x, w.y, w.z);
      g.rotation.y = w.steer;
      s.rotation.x = w.spin;
    }
  }
}
