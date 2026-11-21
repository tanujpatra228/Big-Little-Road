import * as THREE from 'three';
import type { Terrain } from '../../shared/terrain';
import type { Pose } from '../physics/vehicle';

/** Follows behind the car's heading on the ground plane, smoothed, never under the terrain. */
export class ChaseCam {
  private yaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private ready = false;
  distance = 7.5;
  height = 3.2;

  constructor(readonly camera: THREE.PerspectiveCamera, private terrain: Terrain) {}

  /** Current heading of the camera, radians (0 along +z). */
  get heading(): number {
    return this.yaw;
  }

  snap(): void {
    this.ready = false;
  }

  /** Nitro kick: the view widens and the camera drops back a little. `boost` is 0..1. */
  update(pose: Pose, speed: number, dt: number, boost = 0): void {
    // Chassis forward projected on the ground plane.
    const fx = 2 * (pose.qx * pose.qz + pose.qw * pose.qy);
    const fz = 1 - 2 * (pose.qx * pose.qx + pose.qy * pose.qy);
    const targetYaw = Math.atan2(fx, fz);

    if (!this.ready) {
      this.yaw = targetYaw;
      this.ready = true;
    }
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-3.2 * dt));

    const back = this.distance + Math.min(2.5, Math.abs(speed) * 0.12) + boost * 0.9;
    const target = new THREE.Vector3(
      pose.x - Math.sin(this.yaw) * back,
      pose.y + this.height,
      pose.z - Math.cos(this.yaw) * back,
    );
    const minY = this.terrain.heightAt(target.x, target.z) + 1.0;
    if (target.y < minY) target.y = minY;

    if (this.pos.lengthSq() === 0) this.pos.copy(target);
    this.pos.lerp(target, 1 - Math.exp(-7 * dt));
    this.look.set(pose.x + Math.sin(this.yaw) * 2.5, pose.y + 0.7, pose.z + Math.cos(this.yaw) * 2.5);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    const fov = 62 + Math.min(14, Math.abs(speed) * 0.55) + boost * 9;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
