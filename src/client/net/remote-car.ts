import * as THREE from 'three';
import { CARS, wheelRestY, type CarRole } from '../../shared/cars';
import { dequantizePose } from '../../shared/net/pose';
import type { PlayerInfo, PoseFrame } from '../../shared/net/protocol';
import { SnapshotBuffer } from '../../shared/net/snapshot-buffer';
import type { WheelState } from '../physics/vehicle';
import { CarTransformer } from '../render/car-transformer';
import { RemoteBody } from '../physics/vehicle';
import type { PhysicsWorld } from '../physics/world';

/** Another player's car: drawn from smoothed network poses, no physics here. */
export class RemoteCar {
  readonly buffer = new SnapshotBuffer();
  name: string;
  role: CarRole;
  private xform: CarTransformer;
  /** Fires when this car transforms, so the game can play the sound near it. */
  onTransform: (() => void) | null = null;
  /** Last drawn position, for placing sounds. */
  readonly position = new THREE.Vector3();
  /** Heading, radians, 0 along +z. */
  yaw = 0;
  private body: RemoteBody;
  private readonly label: THREE.Sprite;
  private spin = 0;
  private shown = false;

  constructor(private readonly scene: THREE.Scene, private readonly pw: PhysicsWorld, info: PlayerInfo) {
    this.name = info.name;
    this.role = info.role;
    this.xform = new CarTransformer(scene, CARS[info.role]);
    this.xform.onSwap = () => this.onTransform?.();
    this.body = new RemoteBody(pw, CARS[info.role]);
    this.xform.setVisible(false); // until the first pose arrives
    this.label = makeLabel(info.name);
    scene.add(this.label);
  }

  get visible(): boolean {
    return this.shown;
  }

  setRole(role: CarRole): void {
    if (role === this.role) return;
    const wasShown = this.shown;
    this.role = role;
    this.body.dispose();
    this.body = new RemoteBody(this.pw, CARS[role]);
    if (wasShown) this.xform.transformTo(CARS[role], { x: 0, z: 0 });
    else this.xform.reset(CARS[role]);
    this.xform.setVisible(wasShown);
  }

  push(frame: PoseFrame, at: number): void {
    this.buffer.push(frame.t, dequantizePose(frame), at);
  }

  update(now: number, dt: number): void {
    const s = this.buffer.sample(now);
    if (!s) return;
    const spec = CARS[this.role];
    this.shown = true;
    this.xform.setVisible(true);
    this.xform.setPose({ x: s.x, y: s.y, z: s.z, qx: s.qx, qy: s.qy, qz: s.qz, qw: s.qw });
    this.position.set(s.x, s.y, s.z);
    this.yaw = Math.atan2(2 * (s.qw * s.qy + s.qx * s.qz), 1 - 2 * (s.qy * s.qy + s.qz * s.qz));
    this.body.moveTo(s);
    this.spin += (s.v / spec.wheelRadius) * dt;

    const y = wheelRestY(spec);
    const wheels: WheelState[] = [];
    for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]] as const) {
      wheels.push({ x: sx * spec.trackHalf, y, z: sz * spec.wheelBaseHalf, steer: front ? s.steer : 0, spin: this.spin, contact: true });
    }
    this.xform.setWheels(wheels);
    this.xform.tick(dt);
    this.label.position.set(s.x, s.y + 1.5, s.z);
  }

  dispose(): void {
    this.body.dispose();
    this.xform.dispose();
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
