import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CarSpec } from '../../shared/cars';
import {
  FRAME_IDS, FRAME_LIFT, REGION_IDS, foldRemaining, frameLift, frameProgress, lerp, unfolded, type FrameId, type RegionId,
} from '../../shared/transform-anim';
import type { CarModel, DetailPiece, FrameSpec } from './car-builder';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** One big box, drawn as a unit rounded box that is moved, tilted and scaled between two cars' shapes. */
interface FrameRig {
  id: FrameId;
  from: FrameSpec;
  to: FrameSpec;
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  fromColor: THREE.Color;
  toColor: THREE.Color;
}

/** A group of details that folds on a hinge, as one piece. */
interface DetailRig {
  region: RegionId;
  pivot: THREE.Group;
  owned: THREE.BufferGeometry[];
}

/** Where each group of details hinges, from the car's size. */
function hinge(region: RegionId, half: { x: number; y: number; z: number }): THREE.Vector3 {
  switch (region) {
    case 'top':
      return new THREE.Vector3(0, half.y * 0.9, 0);
    case 'front':
      return new THREE.Vector3(0, 0, half.z * 0.6);
    case 'rear':
      return new THREE.Vector3(0, 0, -half.z * 0.6);
    case 'side':
      return new THREE.Vector3(0, 0, 0);
  }
}

function paintOf(m: THREE.Material): { color: THREE.Color; roughness: number; clearcoat: number; clearcoatRoughness: number } {
  const s = m as THREE.MeshPhysicalMaterial;
  return { color: s.color.clone(), roughness: s.roughness ?? 0.5, clearcoat: s.clearcoat ?? 0, clearcoatRoughness: s.clearcoatRoughness ?? 0.3 };
}

/**
 * The stand-in for a car's body while it turns into another. It is built from the two cars' own
 * parts: the five big boxes morph from one shape into the other, the old car's small details fold
 * away on hinges and the new car's unfold. It lives only for the length of the animation.
 * Time is driven from outside (`update(t)`), so a preview can scrub it.
 */
export class TransformRig {
  readonly group = new THREE.Group();
  private readonly frames: FrameRig[] = [];
  private readonly outgoing: DetailRig[] = [];
  private readonly incoming: DetailRig[] = [];
  private readonly unit: THREE.BufferGeometry;

  constructor(from: CarModel, fromSpec: CarSpec, to: CarModel, toSpec: CarSpec) {
    this.unit = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
    for (const id of FRAME_IDS) {
      const a = from.parts.frames.get(id);
      const b = to.parts.frames.get(id);
      if (!a || !b) continue;
      const pa = paintOf(a.mat);
      const mat = new THREE.MeshPhysicalMaterial({ color: pa.color, roughness: pa.roughness, clearcoat: pa.clearcoat, clearcoatRoughness: pa.clearcoatRoughness });
      const mesh = new THREE.Mesh(this.unit, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.frames.push({ id, from: a, to: b, mesh, mat, fromColor: pa.color, toColor: paintOf(b.mat).color });
    }
    for (const region of REGION_IDS) {
      this.outgoing.push(this.makeDetails(region, from.parts.details[region], hinge(region, fromSpec.half)));
      this.incoming.push(this.makeDetails(region, to.parts.details[region], hinge(region, toSpec.half)));
    }
    this.update(0);
  }

  /** The pieces of one region merged by material (so a handful of meshes, not hundreds) under a hinge pivot. */
  private makeDetails(region: RegionId, pieces: DetailPiece[], at: THREE.Vector3): DetailRig {
    const pivot = new THREE.Group();
    pivot.position.copy(at);
    const inner = new THREE.Group();
    inner.position.copy(at).negate();
    pivot.add(inner);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const p of pieces) {
      const list = byMat.get(p.mat) ?? [];
      list.push(p.geo);
      byMat.set(p.mat, list);
    }
    const owned: THREE.BufferGeometry[] = [];
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      owned.push(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      inner.add(mesh);
    }
    this.group.add(pivot);
    return { region, pivot, owned };
  }

  /** Folds a group by `k`: 1 fully out, 0 folded into its hinge. Values past 1 spring a little beyond. */
  private fold(d: DetailRig, k: number): void {
    const on = k > 0.005;
    d.pivot.visible = on;
    if (!on) return;
    const open = 1 - k; // how far shut it is
    switch (d.region) {
      case 'top':
        d.pivot.scale.setScalar(Math.max(0.001, k));
        d.pivot.rotation.set(0, 0, open * 0.9);
        break;
      case 'front':
        d.pivot.scale.set(Math.max(0.001, k), Math.max(0.001, lerp(0.2, 1, k)), Math.max(0.001, k));
        d.pivot.rotation.set(open * 0.8, 0, 0);
        break;
      case 'rear':
        d.pivot.scale.set(Math.max(0.001, k), Math.max(0.001, lerp(0.2, 1, k)), Math.max(0.001, k));
        d.pivot.rotation.set(-open * 0.8, 0, 0);
        break;
      case 'side':
        d.pivot.scale.set(Math.max(0.001, k), Math.max(0.001, lerp(0.35, 1, k)), Math.max(0.001, lerp(0.35, 1, k)));
        d.pivot.rotation.set(0, 0, 0);
        break;
    }
  }

  /** Poses everything for `t` seconds into the animation. */
  update(t: number): void {
    for (const f of this.frames) {
      const k = frameProgress(f.id, t);
      const bump = frameLift(f.id, t);
      const l = FRAME_LIFT[f.id];
      f.mesh.position.set(
        lerp(f.from.pos[0], f.to.pos[0], k) + l.dx * bump,
        lerp(f.from.pos[1], f.to.pos[1], k) + l.dy * bump,
        lerp(f.from.pos[2], f.to.pos[2], k) + l.dz * bump,
      );
      f.mesh.rotation.set(lerp(f.from.rot[0], f.to.rot[0], k) + l.tiltX * bump, lerp(f.from.rot[1], f.to.rot[1], k), lerp(f.from.rot[2], f.to.rot[2], k) + l.tiltZ * bump);
      f.mesh.scale.set(
        Math.max(0.005, lerp(f.from.size[0], f.to.size[0], k)),
        Math.max(0.005, lerp(f.from.size[1], f.to.size[1], k)),
        Math.max(0.005, lerp(f.from.size[2], f.to.size[2], k)),
      );
      const c = clamp01(k);
      f.mat.color.copy(f.fromColor).lerp(f.toColor, c);
    }
    for (const d of this.outgoing) this.fold(d, foldRemaining(d.region, t));
    for (const d of this.incoming) this.fold(d, unfolded(d.region, t));
  }

  /** Where a big box sits in the car's own frame right now, for placing sparks. */
  framePosition(id: FrameId, out: THREE.Vector3): THREE.Vector3 {
    const f = this.frames.find((x) => x.id === id);
    return f ? out.copy(f.mesh.position) : out.set(0, 0, 0);
  }

  setPose(pose: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }): void {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  }

  dispose(): void {
    this.unit.dispose();
    for (const f of this.frames) f.mat.dispose();
    for (const d of [...this.outgoing, ...this.incoming]) for (const g of d.owned) g.dispose();
    this.group.removeFromParent();
  }
}
