import * as THREE from 'three';
import { CARS, wheelRestY, type CarRole } from '../../shared/cars';
import { dequantizePose } from '../../shared/net/pose';
import type { PlayerInfo, PoseFrame } from '../../shared/net/protocol';
import { SnapshotBuffer } from '../../shared/net/snapshot-buffer';
import type { WheelState } from '../physics/vehicle';
import { CarMesh } from '../render/car-mesh';

/** Another player's car: drawn from smoothed network poses, no physics here. */
export class RemoteCar {
  readonly buffer = new SnapshotBuffer();
  name: string;
  role: CarRole;
  mesh: CarMesh;
  /** Last drawn position, for placing sounds. */
  readonly position = new THREE.Vector3();
  private readonly label: THREE.Sprite;
  private spin = 0;

  constructor(private readonly scene: THREE.Scene, info: PlayerInfo) {
    this.name = info.name;
    this.role = info.role;
    this.mesh = new CarMesh(CARS[info.role]);
    this.mesh.group.visible = false; // until the first pose arrives
    scene.add(this.mesh.group);
    this.label = makeLabel(info.name);
    scene.add(this.label);
  }

  setRole(role: CarRole): void {
    if (role === this.role) return;
    const was = this.mesh.group.visible;
    this.scene.remove(this.mesh.group);
    this.role = role;
    this.mesh = new CarMesh(CARS[role]);
    this.mesh.group.visible = was;
    this.scene.add(this.mesh.group);
  }

  push(frame: PoseFrame, at: number): void {
    this.buffer.push(frame.t, dequantizePose(frame), at);
  }

  update(now: number, dt: number): void {
    const s = this.buffer.sample(now);
    if (!s) return;
    const spec = CARS[this.role];
    this.mesh.group.visible = true;
    this.mesh.setPose({ x: s.x, y: s.y, z: s.z, qx: s.qx, qy: s.qy, qz: s.qz, qw: s.qw });
    this.position.set(s.x, s.y, s.z);
    this.spin += (s.v / spec.wheelRadius) * dt;

    const y = wheelRestY(spec);
    const wheels: WheelState[] = [];
    for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]] as const) {
      wheels.push({ x: sx * spec.trackHalf, y, z: sz * spec.wheelBaseHalf, steer: front ? s.steer : 0, spin: this.spin, contact: true });
    }
    this.mesh.setWheels(wheels);
    this.label.position.set(s.x, s.y + 1.5, s.z);
  }

  dispose(): void {
    this.scene.remove(this.mesh.group);
    this.scene.remove(this.label);
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
    this.label.material.dispose();
  }
}

/** A name tag that always faces the camera. */
function makeLabel(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,24,30,0.72)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 24);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 16), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.renderOrder = 10;
  return sprite;
}
