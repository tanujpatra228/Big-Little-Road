import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PropState } from '../../shared/net/props';
import type { Terrain } from '../../shared/terrain';
import {
  PLANK, carriedPose, hitchPoint, hitchToward, plankEnds, plankPlacement, trailFarEnd, trailingPose, type PlankPose, type Vec2,
} from '../../shared/tether';
import type { PhysicsWorld } from '../physics/world';

const ROPE_SLACK = new THREE.Color(0x2b2b2b);
const ROPE_TAUT = new THREE.Color(0xe0412f);

/** What the plank needs to know about a car that is holding it. */
export interface CarInfo {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Half the car's length, to find its nose and tail. */
  halfLength: number;
}

/** Where a car's hitch is, and how high. */
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
  private readonly ropeMat: THREE.LineBasicMaterial;
  private readonly ghost: THREE.Mesh;
  private readonly hitches = new Map<string, HitchInfo>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pw: PhysicsWorld,
    private readonly terrain: Terrain,
    state: PropState,
  ) {
    this.state = state;
    this.displayPose = { ...state.pose };

    const wood = [0xb98a52, 0xa87b46, 0xc29458, 0xb08049, 0xbd8f55].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
    const slat = PLANK.width / wood.length;
    wood.forEach((mat, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(slat - 0.015, PLANK.thickness, PLANK.length), mat);
      m.position.x = (i - (wood.length - 1) / 2) * slat;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    });
    // Darker cross-battens so it reads as a plank bridge, not a plain slab.
    const batten = new THREE.MeshStandardMaterial({ color: 0x7d5a32, roughness: 0.9 });
    for (const z of [-PLANK.length * 0.32, PLANK.length * 0.32]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(PLANK.width + 0.04, 0.04, 0.12), batten);
      b.position.set(0, PLANK.thickness / 2 + 0.01, z);
      b.castShadow = true;
      this.group.add(b);
    }
    scene.add(this.group);

    const ropeMat = (this.ropeMat = new THREE.LineBasicMaterial({ color: ROPE_SLACK }));
    const mk = (): THREE.Line => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), ropeMat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      return line;
    };
    this.ropes = [mk(), mk()];

    // A see-through green plank that shows where it will lean if you let go now.
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(PLANK.width, PLANK.thickness + 0.06, PLANK.length),
      new THREE.MeshBasicMaterial({ color: 0x6dff8a, transparent: true, opacity: 0.38, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    scene.add(this.ghost);
  }

  setState(s: PropState): void {
    this.state = s;
  }

  /** The hitch point of a holder, from the last update, or null. */
  hitchOf(id: string): HitchInfo | null {
    return this.hitches.get(id) ?? null;
  }

  /** Whether the lean-on-the-wall preview is showing. */
  get ghostVisible(): boolean {
    return this.ghost.visible;
  }

  /** Show (or hide, with null) the preview of where it would lean if released. */
  setGhost(pose: PlankPose | null): void {
    this.ghost.visible = pose !== null;
    if (!pose) return;
    const { pos, quat } = this.placement(pose, 0.02);
    this.ghost.position.copy(pos);
    this.ghost.quaternion.copy(quat);
  }

  private placement(pose: PlankPose, lift: number): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const p = plankPlacement(pose, (x, z) => this.terrain.heightAt(x, z), lift);
    return { pos: new THREE.Vector3(p.x, p.y, p.z), quat: new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw) };
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

  /** Call every frame with a way to look up any holder's car. */
  update(carOf: (id: string) => CarInfo | null): void {
    const [h0, h1] = this.state.holders;
    const c0 = h0 ? carOf(h0) : null;
    const c1 = h1 ? carOf(h1) : null;
    const prev = this.mode;
    this.hitches.clear();

    if (h0 && h1) {
      this.mode = 'carried';
      if (c0 && c1) {
        // Each car holds the plank by the end that faces its partner.
        const a = hitchToward(c0, c1, c0.halfLength);
        const b = hitchToward(c1, c0, c1.halfLength);
        this.hitches.set(h0, { x: a.x, y: c0.y - 0.1, z: a.z });
        this.hitches.set(h1, { x: b.x, y: c1.y - 0.1, z: b.z });
        this.displayPose = carriedPose(a, b, this.displayPose.yaw);
      }
    } else if (h0 || h1) {
      this.mode = 'solo';
      const holder = h0 ?? h1!;
      const c = h0 ? c0 : c1;
      if (c) {
        // Alone, it hangs from the tail and drags behind.
        const hp = hitchPoint(c, c.yaw, c.halfLength);
        this.hitches.set(holder, { x: hp.x, y: c.y - 0.1, z: hp.z });
        if (!this.far || prev !== 'solo') {
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
    const holders = [h0, h1] as const;
    for (const i of [0, 1] as const) {
      const id = holders[i];
      const hp = id ? this.hitches.get(id) : undefined;
      const rope = this.ropes[i];
      rope.visible = !!hp;
      if (!hp) continue;
      const e = ends[i];
      const attr = rope.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, hp.x, hp.y, hp.z);
      attr.setXYZ(1, e.x, this.terrain.heightAt(e.x, e.z) + 0.3, e.z);
      attr.needsUpdate = true;
    }
  }

  /** 0 slack to 1 at the hard limit: the ropes go from dark to red. */
  setTension(t: number): void {
    this.ropeMat.color.copy(ROPE_SLACK).lerp(ROPE_TAUT, t);
  }

  dispose(): void {
    this.setCollider(null);
    this.scene.remove(this.group, this.ghost, ...this.ropes);
  }
}
