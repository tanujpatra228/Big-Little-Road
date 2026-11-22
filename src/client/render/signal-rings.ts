import * as THREE from 'three';
import type { Terrain } from '../../shared/terrain';

/** One coverage circle to draw. */
export interface RingSpec {
  key: string;
  x: number;
  z: number;
  range: number;
  /** CSS-style hex colour. */
  color: number;
  /** A Relay that is not connected to anything: drawn faint and red, because it helps nobody. */
  dim: boolean;
}

const SEGMENTS = 96;
const HALF_WIDTH = 0.5;
const LIFT = 0.16;

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  geo: THREE.BufferGeometry;
  x: number;
  z: number;
  range: number;
}

/**
 * The edge of each signal source drawn on the ground as a thin ribbon that follows the terrain, plus
 * a tall mast with a pulsing light at the base station so you can see where the signal comes from.
 * Nothing is drawn while the room's radio range is off.
 */
export class SignalRings {
  private readonly group = new THREE.Group();
  private readonly rings = new Map<string, Ring>();
  private readonly mast: THREE.Group;
  private readonly lamp: THREE.Mesh;
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    base: { x: number; z: number },
  ) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 6, 8).translate(0, 3, 0), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 }));
    pole.castShadow = true;
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshStandardMaterial({ color: 0x113344, emissive: 0x39d0ff, emissiveIntensity: 2 }));
    this.lamp.position.y = 6.1;
    this.mast = new THREE.Group();
    this.mast.add(pole, this.lamp);
    this.mast.position.set(base.x + 2.5, terrain.heightAt(base.x + 2.5, base.z), base.z);
    this.group.add(this.mast);
    this.group.visible = false;
    scene.add(this.group);
  }

  private make(spec: RingSpec): Ring {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const material = new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    this.group.add(mesh);
    return { mesh, material, geo, x: NaN, z: NaN, range: NaN };
  }

  private shape(r: Ring, spec: RingSpec): void {
    const pos = r.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const [k, rad] of [[0, spec.range - HALF_WIDTH], [1, spec.range + HALF_WIDTH]] as const) {
        const x = spec.x + c * rad;
        const z = spec.z + s * rad;
        pos.setXYZ(i * 2 + k, x, this.terrain.heightAt(x, z) + LIFT, z);
      }
    }
    pos.needsUpdate = true;
    r.x = spec.x;
    r.z = spec.z;
    r.range = spec.range;
  }

  /** Call every frame. `on` is false when radio range is off: everything hides. */
  update(specs: readonly RingSpec[], on: boolean, dt: number): void {
    this.group.visible = on;
    if (!on) return;
    this.time += dt;
    (this.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 + Math.sin(this.time * 3) * 1.0;

    const keep = new Set(specs.map((s) => s.key));
    for (const [key, r] of this.rings) {
      if (!keep.has(key)) {
        this.group.remove(r.mesh);
        r.geo.dispose();
        r.material.dispose();
        this.rings.delete(key);
      }
    }
    for (const spec of specs) {
      let r = this.rings.get(spec.key);
      if (!r) {
        r = this.make(spec);
        this.rings.set(spec.key, r);
      }
      if (Math.hypot(r.x - spec.x, r.z - spec.z) > 0.08 || r.range !== spec.range || Number.isNaN(r.x)) this.shape(r, spec);
      r.material.color.setHex(spec.dim ? 0xff4d4d : spec.color);
      r.material.opacity = spec.dim ? 0.3 : 0.6 + Math.sin(this.time * 2) * 0.1;
    }
  }

  dispose(): void {
    for (const r of this.rings.values()) {
      r.geo.dispose();
      r.material.dispose();
    }
    this.rings.clear();
    this.scene.remove(this.group);
  }
}
