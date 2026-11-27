import * as THREE from 'three';
import { CARS } from '../../shared/cars';
import type { Terrain } from '../../shared/terrain';
import { buildCar, type CarModel } from './car-builder';

/**
 * The lost car for Dead Signal: a small rescue car sitting on the lawn with a flat battery. It blinks
 * red until the Relay charges it, then its battery glows green and it flashes its lights.
 */
export class DeadCar {
  private readonly model: CarModel;
  private readonly lamp: THREE.Mesh;
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false, fog: false });
  private readonly ring: THREE.Mesh;
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  private alive = false;
  private time = 0;
  readonly group = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    terrain: Terrain,
    private readonly at: { x: number; z: number },
  ) {
    this.model = buildCar(CARS.scout, 'rescue', 0x7a7f89);
    this.model.group.rotation.y = 2.2;
    this.model.group.position.y = terrain.heightAt(at.x, at.z) + 0.5;
    this.group.add(this.model.group);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.lampMat);
    this.lamp.position.y = terrain.heightAt(at.x, at.z) + 3.4;
    this.group.add(this.lamp);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3, 8, 1, true).translate(0, 1.5, 0), this.ringMat);
    beam.position.y = terrain.heightAt(at.x, at.z) + 0.4;
    this.group.add(beam);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 40).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.position.y = terrain.heightAt(at.x, at.z) + 0.15;
    this.group.add(this.ring);
    this.group.position.set(at.x, 0, at.z);
    this.model.group.position.x = 0;
    this.model.group.position.z = 0;
    // The group is placed in world space by x and z, with heights baked in above, so lift the children's xz back.
    this.lamp.position.x = 0;
    this.lamp.position.z = 0;
    this.group.visible = false;
    scene.add(this.group);
    this.setAlive(false);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  show(on: boolean): void {
    this.group.visible = on;
  }

  setAlive(alive: boolean): void {
    this.alive = alive;
    const color = alive ? 0x57d36b : 0xff3b30;
    this.lampMat.color.setHex(color);
    this.ringMat.color.setHex(color);
    this.model.battery?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'emissive' in m) {
        m.color.setHex(alive ? 0x57d36b : 0x3a3d44);
        m.emissive.setHex(alive ? 0x57d36b : 0x000000);
        m.emissiveIntensity = alive ? 1.2 : 0;
      }
    });
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const blink = this.alive ? 0.6 + 0.4 * Math.sin(this.time * 8) : Math.sin(this.time * 2.2) > 0.2 ? 1 : 0.15;
    this.lampMat.opacity = 1;
    this.lamp.scale.setScalar(0.6 + blink * 0.6);
    this.ringMat.opacity = 0.2 + 0.3 * blink;
  }
}
