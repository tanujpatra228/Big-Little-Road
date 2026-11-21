import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PropState } from '../../shared/net/props';
import type { Terrain } from '../../shared/terrain';
import { PLANK, carriedPose, plankEnds, trailFarEnd, trailingPose, type PlankPose, type Vec2 } from '../../shared/tether';
import type { PhysicsWorld } from '../physics/world';

/** Where a car's tow hitch is, and how high. */
export interface HitchInfo {
  x: number;
  y: number;
  z: number;
}

/**
 * The plank in the world. Resting, it is a solid board you can drive over. Hooked, it is a ghost
 * placed between the cars (or trailing one car), with a rope to each holder. Nothing here talks to
 * the network: it only draws what the room's holder list and the cars' poses say.
 */
export class PlankProp {
  readonly group = new THREE.Group();
  state: PropState;
  displayPose: PlankPose;
  private mode: 'free' | 'solo' | 'carried' = 'free';
  private far: Vec2 | null = null;
  private collider: RAPIER.Collider | null = null;
  private colliderKey = '';
  private readonly ropes: [THREE.Line, THREE.Line];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pw: PhysicsWorld,
    private readonly terrain: Terrain,
    state: PropState,
  ) {
    this.state = state;
    this.displayPose = { ...state.pose };

    const wood = [0xb98a52, 0xa87b46, 0xc29458].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
    const slat = PLANK.width / 3;
    wood.forEach((mat, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(slat - 0.015, PLANK.thickness, PLANK.length), mat);
      m.position.x = (i - 1) * slat;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    });
    // Two darker cross-battens so it reads as a plank bridge, not a plain slab.
    const batten = new THREE.MeshStandardMaterial({ color: 0x7d5a32, roughness: 0.9 });
    for (const z of [-PLANK.length * 0.32, PLANK.length * 0.32]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(PLANK.width + 0.04, 0.04, 0.12), batten);
      b.position.set(0, PLANK.thickness / 2 + 0.01, z);
      b.castShadow = true;
      this.group.add(b);
    }
    scene.add(this.group);

    const ropeMat = new THREE.LineBasicMaterial({ color: 0x2b2b2b });
    const mk = (): THREE.Line => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), ropeMat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      return line;
    };
    this.ropes = [mk(), mk()];
  }

  setState(s: PropState): void {
    this.state = s;
  }

  private placement(pose: PlankPose, lift: number): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const [a, b] = plankEnds(pose);
    const ya = this.terrain.heightAt(a.x, a.z);
    const yb = this.terrain.heightAt(b.x, b.z);
    const pitch = Math.atan2(yb - ya, PLANK.length);
    return {
      pos: new THREE.Vector3(pose.x, (ya + yb) / 2 + PLANK.thickness / 2 + lift, pose.z),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, pose.yaw, 0, 'YXZ')),
    };
  }

  private setCollider(pose: PlankPose | null): void {
    const key = pose ? `${pose.x.toFixed(3)},${pose.z.toFixed(3)},${pose.yaw.toFixed(4)}` : '';
    if (key === this.colliderKey) return;
    this.colliderKey = key;
    if (this.collider) {
      this.pw.world.removeCollider(this.collider, true);
      this.collider = null;
    }
    if (!pose) return;
    const R = this.pw.rapier;
    const { pos, quat } = this.placement(pose, 0.01);
    this.collider = this.pw.world.createCollider(
      R.ColliderDesc.cuboid(PLANK.width / 2, PLANK.thickness / 2, PLANK.length / 2)
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setFriction(0.9),
    );
  }

  /** Call every frame with a way to find any holder's hitch. */
  update(hitchOf: (id: string) => HitchInfo | null): void {
    const [h0, h1] = this.state.holders;
    const hp0 = h0 ? hitchOf(h0) : null;
    const hp1 = h1 ? hitchOf(h1) : null;
    const prev = this.mode;

    if (h0 && h1) {
      this.mode = 'carried';
      if (hp0 && hp1) this.displayPose = carriedPose(hp0, hp1, this.displayPose.yaw);
    } else if (h0 || h1) {
      this.mode = 'solo';
      const hp = h0 ? hp0 : hp1;
      if (hp) {
        if (!this.far || prev !== 'solo') {
          // Start dragging from whichever end is farther from the car.
          const [e0, e1] = plankEnds(this.displayPose);
          this.far = Math.hypot(e0.x - hp.x, e0.z - hp.z) > Math.hypot(e1.x - hp.x, e1.z - hp.z) ? e0 : e1;
        }
        this.far = trailFarEnd(this.far, hp);
        this.displayPose = trailingPose(hp, this.far, this.displayPose.yaw);
      }
    } else {
      this.mode = 'free';
      this.far = null;
      this.displayPose = { ...this.state.pose };
    }

    const held = this.mode !== 'free';
    this.setCollider(held ? null : this.displayPose);
    const { pos, quat } = this.placement(this.displayPose, held ? 0.2 : 0.01);
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);

    // A rope from each holder's hitch to its end of the plank.
    const ends = plankEnds(this.displayPose);
    const holders = [hp0, hp1] as const;
    for (const i of [0, 1] as const) {
      const hp = holders[i];
      const rope = this.ropes[i];
      rope.visible = !!hp;
      if (!hp) continue;
      const e = ends[i];
      const y = this.terrain.heightAt(e.x, e.z) + 0.3;
      const attr = rope.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, hp.x, hp.y, hp.z);
      attr.setXYZ(1, e.x, y, e.z);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.setCollider(null);
    this.scene.remove(this.group, ...this.ropes);
  }
}
