import * as THREE from 'three';
import type { Placed } from '../../shared/toolbox';
import { ITEMS, type ItemKind } from '../../shared/toolbox';
import type { Terrain } from '../../shared/terrain';

/** A small procedural model for each kind of placed item. Geometry and materials are shared. */
function makeShared() {
  const wood = new THREE.MeshStandardMaterial({ color: 0xa87b45, roughness: 0.9 });
  const orange = new THREE.MeshStandardMaterial({ color: ITEMS.cone.color, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 });
  const bulb = new THREE.MeshBasicMaterial({ color: ITEMS.beacon.color, toneMapped: false, fog: false });
  const halo = new THREE.MeshBasicMaterial({ color: ITEMS.beacon.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  return {
    wood, orange, white, metal, bulb, halo,
    stake: new THREE.CylinderGeometry(0.07, 0.04, 1.0, 8).translate(0, 0.5, 0),
    stakeCap: new THREE.TorusGeometry(0.1, 0.03, 6, 12).rotateX(Math.PI / 2).translate(0, 0.9, 0),
    coneBody: new THREE.ConeGeometry(0.24, 0.55, 12).translate(0, 0.275, 0),
    coneBase: new THREE.BoxGeometry(0.5, 0.04, 0.5).translate(0, 0.02, 0),
    coneStripe: new THREE.CylinderGeometry(0.135, 0.17, 0.09, 12, 1, true).translate(0, 0.26, 0),
    pole: new THREE.CylinderGeometry(0.04, 0.07, 2.0, 8).translate(0, 1.0, 0),
    bulbGeo: new THREE.SphereGeometry(0.15, 12, 8).translate(0, 2.1, 0),
    haloGeo: new THREE.RingGeometry(0.5, 0.65, 32).rotateX(-Math.PI / 2).translate(0, 0.06, 0),
    foot: new THREE.CylinderGeometry(0.25, 0.3, 0.08, 10).translate(0, 0.04, 0),
  };
}

type Shared = ReturnType<typeof makeShared>;

function build(kind: ItemKind, s: Shared): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  if (kind === 'stake') {
    add(s.stake, s.wood);
    add(s.stakeCap, s.metal);
  } else if (kind === 'cone') {
    add(s.coneBase, s.orange);
    add(s.coneBody, s.orange);
    add(s.coneStripe, s.white);
  } else {
    add(s.foot, s.metal);
    add(s.pole, s.metal);
    const b = new THREE.Mesh(s.bulbGeo, s.bulb);
    b.name = 'bulb';
    g.add(b);
    const h = new THREE.Mesh(s.haloGeo, s.halo);
    h.name = 'halo';
    g.add(h);
  }
  return g;
}

/**
 * Draws everything placed in the yard. Call `sync` whenever the list changes (it only adds and removes
 * what differs) and `update` each frame for the beacon's pulse.
 */
export class PlacedObjects {
  private readonly group = new THREE.Group();
  private readonly shown = new Map<string, { obj: THREE.Group; kind: ItemKind }>();
  private readonly shared = makeShared();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    scene.add(this.group);
  }

  get count(): number {
    return this.shown.size;
  }

  sync(placed: readonly Placed[]): void {
    const keep = new Set(placed.map((p) => p.id));
    for (const [id, s] of this.shown) {
      if (!keep.has(id)) {
        this.group.remove(s.obj);
        this.shown.delete(id);
      }
    }
    for (const p of placed) {
      const have = this.shown.get(p.id);
      if (have && have.kind === p.kind) {
        have.obj.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
        continue;
      }
      if (have) this.group.remove(have.obj);
      const obj = build(p.kind, this.shared);
      obj.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
      obj.rotation.y = p.yaw;
      this.group.add(obj);
      this.shown.set(p.id, { obj, kind: p.kind });
    }
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 3);
    this.shared.halo.opacity = 0.3 + 0.3 * pulse;
  }
}
