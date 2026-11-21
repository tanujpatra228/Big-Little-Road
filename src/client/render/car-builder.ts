import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wheelRestY, type CarSpec } from '../../shared/cars';

export type CarVariant = 'standard' | 'rescue';

/** Collects shapes and merges everything that shares a material into one mesh. */
class Parts {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void {
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(this.m);
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv1');
    const list = this.groups.get(mat) ?? [];
    list.push(g);
    this.groups.set(mat, list);
  }

  box(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void {
    const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    this.add(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.002, radius)), mat, x, y, z, rx, ry, rz);
  }

  cyl(rTop: number, rBot: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10): void {
    this.add(new THREE.CylinderGeometry(rTop, rBot, len, seg), mat, x, y, z, rx, ry, rz);
  }

  sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): void {
    const g = new THREE.SphereGeometry(r, 14, 10);
    g.scale(sx, sy, sz);
    this.add(g, mat, x, y, z);
  }

  /** Thin rod between two points. */
  tube(a: [number, number, number], b: [number, number, number], r: number, mat: THREE.Material): void {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const e = new THREE.Euler().setFromQuaternion(quat);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    this.add(g, mat, mid.x, mid.y, mid.z, e.x, e.y, e.z);
  }

  build(castShadow = true): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  dark: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  headlight: THREE.MeshStandardMaterial;
  taillight: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
}

const ACCENTS: Record<string, number> = { scout: 0xfff4e0, hauler: 0xf5c542, relay: 0xffffff };

function makeMaterials(spec: CarSpec, color: number): CarMaterials {
  const plastic = (c: number): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.22 });
  const glow = (c: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: c, emissiveIntensity: 0, roughness: 0.4 });
  return {
    paint: plastic(color),
    accent: plastic(ACCENTS[spec.role] ?? 0xffffff),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2e35, roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1c2733, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc2c6cf, metalness: 0.85, roughness: 0.32 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.92 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.5 }),
    headlight: glow(0xfff1c9),
    taillight: glow(0xff3b30),
    beacon: glow(0xff4d4d),
  };
}

type TyreKind = 'paddle' | 'chunky' | 'trophy';
const TYRES: Record<string, TyreKind> = { scout: 'paddle', hauler: 'chunky', relay: 'trophy' };

/** One wheel, axis along X, outer face toward +X. Rubber and rim are merged into two meshes. */
function buildWheel(spec: CarSpec, mats: CarMaterials, rimMat: THREE.Material): THREE.Group {
  const kind = TYRES[spec.role] ?? 'trophy';
  const R = spec.wheelRadius;
  const w = R * (kind === 'chunky' ? 0.82 : 0.78);
  const lugH = R * (kind === 'chunky' ? 0.16 : kind === 'paddle' ? 0.12 : 0.1);
  const Rt = R - lugH * 0.8;
  const ri = Rt * 0.6;
  const p = new Parts();

  const profile = [
    new THREE.Vector2(ri, -w / 2),
    new THREE.Vector2(Rt * 0.9, -w / 2),
    new THREE.Vector2(Rt * 0.99, -w * 0.38),
    new THREE.Vector2(Rt, -w * 0.15),
    new THREE.Vector2(Rt, w * 0.15),
    new THREE.Vector2(Rt * 0.99, w * 0.38),
    new THREE.Vector2(Rt * 0.9, w / 2),
    new THREE.Vector2(ri, w / 2),
  ];
  const lathe = new THREE.LatheGeometry(profile, 22);
  p.add(lathe, mats.rubber, 0, 0, 0, 0, 0, Math.PI / 2);

  const lugs = kind === 'chunky' ? 12 : kind === 'paddle' ? 16 : 14;
  const lugT = ((2 * Math.PI * Rt) / lugs) * (kind === 'chunky' ? 0.58 : 0.46);
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    const rad = Rt + lugH * 0.3;
    p.box(w * 0.88, lugH * 1.4, lugT, 0.012, mats.rubber, 0, Math.cos(a) * rad, Math.sin(a) * rad, a);
  }

  const rim = new Parts();
  rim.cyl(ri * 1.05, ri * 1.05, w * 0.92, rimMat, 0, 0, 0, 0, 0, Math.PI / 2, 18);
  rim.cyl(ri * 0.5, ri * 0.55, 0.05, mats.metal, w * 0.46, 0, 0, 0, 0, Math.PI / 2, 12);
  const bolts = kind === 'chunky' ? 10 : 5;
  const boltR = kind === 'chunky' ? ri * 0.92 : ri * 0.72;
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2;
    rim.cyl(0.018, 0.018, 0.04, mats.metal, w * 0.47, Math.cos(a) * boltR, Math.sin(a) * boltR, 0, 0, Math.PI / 2, 6);
  }

  const g = new THREE.Group();
  g.add(p.build(), rim.build());
  return g;
}

export interface CarModel {
  group: THREE.Group;
  /** Wheel pivots in vehicle wheel order. `flip` is true for wheels on the -x side. */
  wheels: Array<{ pivot: THREE.Group; spin: THREE.Group; flip: boolean }>;
  /** Swing arms from the body to each wheel, re-aimed every frame so the suspension reads. */
  arms: Array<{ mesh: THREE.Mesh; anchor: THREE.Vector3 }>;
  materials: CarMaterials;
  battery: THREE.Object3D | null;
}

/** Decals are tiny canvas textures: a rounded number badge. */
function badge(text: string, bg: string, fg: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 78px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 }));
  m.receiveShadow = true;
  return m;
}

export function buildCar(spec: CarSpec, variant: CarVariant = 'standard', colorOverride?: number): CarModel {
  const color = colorOverride ?? spec.color;
  const mats = makeMaterials(spec, color);
  const { x: hx, y: hy, z: hz } = spec.half;
  const body = new Parts();
  const wheelY = wheelRestY(spec);
  const rescue = variant === 'rescue';

  if (spec.role === 'scout' || rescue) {
    // Desert buggy: low tub, open cage, empty seat (cars are the characters), rear engine, light bar.
    body.box(hx * 1.96, hy * 1.2, hz * 1.84, rescue ? 0.12 : 0.07, mats.paint, 0, -hy * 0.1, 0);
    body.box(hx * 1.6, hy * 0.8, hz * 0.55, 0.07, mats.paint, 0, -hy * 0.02, hz * 0.86, -0.2);
    body.box(hx * 1.6, hy * 0.5, hz * 1.6, 0.05, mats.dark, 0, -hy * 0.85, 0);
    body.box(hx * 0.5, 0.012, hz * 1.2, 0.005, mats.accent, hx * 0.2, hy * 0.5 + 0.004, 0.05);
    body.box(hx * 0.5, 0.012, hz * 1.2, 0.005, mats.accent, -hx * 0.2, hy * 0.5 + 0.004, 0.05);
    if (!rescue) {
      body.box(hx * 1.4, hy * 1.0, hz * 0.5, 0.05, mats.dark, 0, hy * 0.55, -hz * 0.62);
      body.cyl(0.035, 0.045, 0.42, mats.metal, hx * 0.5, hy * 0.5, -hz * 1.0, Math.PI / 2 - 0.2, 0, 0, 8);
      body.cyl(0.035, 0.045, 0.42, mats.metal, -hx * 0.5, hy * 0.5, -hz * 1.0, Math.PI / 2 - 0.2, 0, 0, 8);
      body.box(0.3, 0.2, 0.3, 0.05, mats.dark, 0, hy * 0.75, -hz * 0.05);
      body.box(0.3, 0.3, 0.07, 0.04, mats.dark, 0, hy * 1.0 + 0.1, -hz * 0.2);
      const cage = (ax: number): void => {
        body.tube([ax, hy * 0.4, -hz * 0.08], [ax, hy + 0.66, -hz * 0.08], 0.024, mats.metal);
        body.tube([ax * 0.86, hy * 0.5, hz * 0.36], [ax * 0.7, hy + 0.4, hz * 0.2], 0.024, mats.metal);
        body.tube([ax * 0.7, hy + 0.4, hz * 0.2], [ax, hy + 0.66, -hz * 0.08], 0.024, mats.metal);
        body.tube([ax, hy + 0.62, -hz * 0.1], [ax * 0.85, hy * 0.7, -hz * 0.8], 0.022, mats.metal);
      };
      cage(hx * 0.82);
      cage(-hx * 0.82);
      body.tube([hx * 0.82, hy + 0.66, -hz * 0.08], [-hx * 0.82, hy + 0.66, -hz * 0.08], 0.024, mats.metal);
      body.tube([hx * 0.7, hy + 0.4, hz * 0.2], [-hx * 0.7, hy + 0.4, hz * 0.2], 0.022, mats.metal);
      body.box(hx * 1.2, 0.05, 0.05, 0.02, mats.headlight, 0, hy + 0.45, hz * 0.22);
    } else {
      // Rescue car: bubble cabin, open battery bay on the rear deck.
      body.box(hx * 1.96, hy * 0.7, hz * 1.5, 0.16, mats.paint, 0, hy * 0.45, 0);
      body.sphere(hx * 0.85, mats.glass, 0, hy * 1.15, hz * 0.08, 1, 0.95, 1.2);
      body.sphere(hx * 0.6, mats.paint, 0, hy * 2.05, hz * 0.08, 1, 0.3, 1.0);
      body.box(hx * 0.9, 0.05, hz * 0.5, 0.02, mats.dark, 0, hy * 0.52, -hz * 0.62);
      body.box(hx * 0.2, 0.18, 0.05, 0.02, mats.dark, hx * 0.52, hy * 0.7, -hz * 0.95, 0, 0, 0.2);
    }
    body.box(hx * 0.5, 0.06, 0.04, 0.02, mats.headlight, hx * 0.5, hy * 0.2, hz * 1.08);
    body.box(hx * 0.5, 0.06, 0.04, 0.02, mats.headlight, -hx * 0.5, hy * 0.2, hz * 1.08);
    body.box(hx * 0.4, 0.05, 0.04, 0.02, mats.taillight, hx * 0.55, hy * 0.2, -hz * 0.93);
    body.box(hx * 0.4, 0.05, 0.04, 0.02, mats.taillight, -hx * 0.55, hy * 0.2, -hz * 0.93);
  } else if (spec.role === 'hauler') {
    // Rock crawler: tall boxy cab, winch bumper, roof rack, snorkel.
    body.box(hx * 1.96, hy * 1.5, hz * 1.9, 0.08, mats.paint, 0, -hy * 0.05, 0);
    body.box(hx * 1.8, hy * 1.7, hz * 1.0, 0.09, mats.paint, 0, hy * 1.25, -hz * 0.2);
    body.box(hx * 1.72, hy * 0.7, hz * 0.55, 0.07, mats.paint, 0, hy * 0.55, hz * 0.62);
    body.box(hx * 1.6, hy * 0.5, hz * 1.7, 0.05, mats.dark, 0, -hy * 0.9, 0);
    body.box(hx * 1.4, hy * 0.85, 0.02, 0.01, mats.glass, 0, hy * 1.4, hz * 0.3 + 0.006);
    body.box(hx * 1.4, hy * 0.7, 0.02, 0.01, mats.glass, 0, hy * 1.4, -hz * 0.7 - 0.006);
    for (const s of [1, -1]) {
      body.box(0.02, hy * 0.85, hz * 0.62, 0.01, mats.glass, s * (hx * 0.9 + 0.006), hy * 1.4, -hz * 0.2);
      body.box(0.012, 0.06, hz * 1.6, 0.005, mats.accent, s * (hx * 0.98 + 0.002), -hy * 0.45, 0);
    }
    body.box(hx * 2.02, hy * 0.5, 0.14, 0.04, mats.dark, 0, -hy * 0.15, hz + 0.08);
    body.cyl(0.07, 0.07, hx * 1.2, mats.metal, 0, -hy * 0.05, hz + 0.17, 0, 0, Math.PI / 2, 12);
    body.box(0.06, 0.1, 0.03, 0.01, mats.accent, hx * 0.5, -hy * 0.15, hz + 0.19);
    body.box(hx * 1.9, hy * 0.4, 0.1, 0.04, mats.dark, 0, -hy * 0.2, -hz - 0.06);
    const roofY = hy * 2.1 + 0.05;
    body.tube([hx * 0.7, roofY, -hz * 0.6], [hx * 0.7, roofY, hz * 0.2], 0.018, mats.metal);
    body.tube([-hx * 0.7, roofY, -hz * 0.6], [-hx * 0.7, roofY, hz * 0.2], 0.018, mats.metal);
    body.tube([hx * 0.7, roofY, -hz * 0.6], [-hx * 0.7, roofY, -hz * 0.6], 0.018, mats.metal);
    body.tube([hx * 0.7, roofY, hz * 0.2], [-hx * 0.7, roofY, hz * 0.2], 0.018, mats.metal);
    body.box(0.15, 0.2, 0.1, 0.03, mats.taillight, hx * 0.3, roofY + 0.1, -hz * 0.3);
    body.box(0.3, 0.14, 0.2, 0.03, mats.accent, -hx * 0.2, roofY + 0.08, -hz * 0.25);
    body.box(hx * 1.2, 0.05, 0.05, 0.02, mats.headlight, 0, roofY + 0.04, hz * 0.28);
    body.tube([hx * 0.9, hy * 0.9, hz * 0.3], [hx * 0.9, hy * 2.5, hz * 0.26], 0.025, mats.dark);
    body.cyl(0.04, 0.025, 0.06, mats.dark, hx * 0.9, hy * 2.55, hz * 0.26, 0.15, 0, 0, 8);
    body.box(0.14, 0.14, 0.05, 0.03, mats.headlight, hx * 0.62, hy * 0.5, hz * 0.9 + 0.06);
    body.box(0.14, 0.14, 0.05, 0.03, mats.headlight, -hx * 0.62, hy * 0.5, hz * 0.9 + 0.06);
    body.box(0.12, 0.1, 0.04, 0.02, mats.taillight, hx * 0.8, hy * 0.2, -hz * 0.96);
    body.box(0.12, 0.1, 0.04, 0.02, mats.taillight, -hx * 0.8, hy * 0.2, -hz * 0.96);
  } else {
    // Trophy truck: long hood, cab, spare tyre, signal mast with beacon.
    body.box(hx * 1.96, hy * 1.3, hz * 1.9, 0.08, mats.paint, 0, -hy * 0.1, 0);
    body.box(hx * 1.6, hy * 0.7, hz * 0.7, 0.09, mats.paint, 0, hy * 0.4, hz * 0.55);
    body.box(hx * 1.72, hy * 1.5, hz * 0.7, 0.1, mats.paint, 0, hy * 1.05, -hz * 0.15);
    body.box(hx * 1.6, hy * 0.5, hz * 1.7, 0.05, mats.dark, 0, -hy * 0.9, 0);
    body.box(hx * 0.36, 0.06, hz * 0.2, 0.02, mats.dark, 0, hy * 0.82, hz * 0.55);
    body.box(hx * 1.3, hy * 0.8, 0.02, 0.01, mats.glass, 0, hy * 1.2, hz * 0.2 + 0.006, -0.25);
    body.box(hx * 1.3, hy * 0.7, 0.02, 0.01, mats.glass, 0, hy * 1.2, -hz * 0.5 - 0.006);
    for (const s of [1, -1]) {
      body.box(0.02, hy * 0.8, hz * 0.45, 0.01, mats.glass, s * (hx * 0.86 + 0.006), hy * 1.2, -hz * 0.15);
      body.box(0.012, 0.07, hz * 1.7, 0.005, mats.accent, s * (hx * 0.98 + 0.002), -hy * 0.35, 0);
      body.cyl(0.03, 0.03, hz * 0.8, mats.metal, s * (hx + 0.02), -hy * 0.7, -hz * 0.1, Math.PI / 2, 0, 0, 8);
    }
    body.box(hx * 0.3, 0.012, hz * 1.1, 0.005, mats.accent, 0, hy * 0.78 + 0.004, hz * 0.4);
    body.box(hx * 1.5, hy * 0.5, hz * 0.55, 0.05, mats.dark, 0, hy * 0.35, -hz * 0.72);
    const rimW = new THREE.Mesh(new THREE.TorusGeometry(spec.wheelRadius * 0.62, spec.wheelRadius * 0.26, 8, 16), mats.rubber);
    body.add(rimW.geometry, mats.rubber, 0, hy * 1.05, -hz * 0.74, Math.PI / 2 - 0.15, 0, 0);
    body.cyl(0.1, 0.1, 0.06, mats.metal, 0, hy * 1.12, -hz * 0.74, -0.15, 0, 0, 10);
    body.tube([hx * 0.7, hy * 0.9, -hz * 0.55], [hx * 0.7, hy + 1.25, -hz * 0.55], 0.018, mats.dark);
    body.sphere(0.075, mats.beacon, hx * 0.7, hy + 1.3, -hz * 0.55);
    body.box(hx * 1.5, 0.05, 0.05, 0.02, mats.headlight, 0, hy * 1.85 + 0.02, hz * 0.12);
    body.box(0.2, 0.1, 0.05, 0.03, mats.headlight, hx * 0.6, hy * 0.35, hz * 0.9 + 0.06);
    body.box(0.2, 0.1, 0.05, 0.03, mats.headlight, -hx * 0.6, hy * 0.35, hz * 0.9 + 0.06);
    body.box(0.14, 0.1, 0.04, 0.02, mats.taillight, hx * 0.75, hy * 0.2, -hz * 0.96);
    body.box(hx * 0.3, 0.1, 0.04, 0.02, mats.taillight, -hx * 0.75, hy * 0.2, -hz * 0.96);
  }

  const group = new THREE.Group();
  group.add(body.build());

  // Number badges on both doors.
  const tag = rescue ? '?' : ({ scout: '1', hauler: '2', relay: '3' } as Record<string, string>)[spec.role] ?? '';
  const badgeBg = rescue ? '#ffffff' : spec.role === 'hauler' ? '#f5c542' : '#ffffff';
  for (const s of [1, -1]) {
    const b = badge(tag, badgeBg, '#2c2e35');
    b.position.set(s * (hx * 0.99 + 0.008), hy * (spec.role === 'hauler' ? 0.1 : 0.15), hz * 0.15);
    b.rotation.y = s * Math.PI / 2;
    b.scale.setScalar(spec.role === 'hauler' ? 1.15 : 0.95);
    group.add(b);
  }

  let battery: THREE.Object3D | null = null;
  if (rescue) {
    const bp = new Parts();
    const cell = new THREE.MeshStandardMaterial({ color: 0x57d36b, roughness: 0.4, emissive: 0x57d36b, emissiveIntensity: 0.25 });
    bp.box(hx * 0.8, 0.07, hz * 0.4, 0.02, cell, 0, 0, 0);
    bp.box(0.07, 0.04, 0.05, 0.01, mats.metal, hx * 0.2, 0.05, hz * 0.12);
    battery = bp.build();
    battery.position.set(0, hy * 0.58, -hz * 0.62);
    battery.visible = false;
    group.add(battery);
  }

  const rimMat = spec.role === 'hauler' ? mats.dark : spec.role === 'relay' ? mats.metal : mats.accent;
  const proto = buildWheel(spec, mats, rimMat);
  const wheels: CarModel['wheels'] = [];
  const corners: Array<[number, number]> = [
    [spec.trackHalf, spec.wheelBaseHalf],
    [-spec.trackHalf, spec.wheelBaseHalf],
    [spec.trackHalf, -spec.wheelBaseHalf],
    [-spec.trackHalf, -spec.wheelBaseHalf],
  ];
  for (const [cx, cz] of corners) {
    const pivot = new THREE.Group();
    const flipGroup = new THREE.Group();
    const spin = new THREE.Group();
    const flip = cx < 0;
    flipGroup.rotation.y = flip ? Math.PI : 0;
    const wheel = proto.clone(true);
    spin.add(wheel);
    flipGroup.add(spin);
    pivot.add(flipGroup);
    pivot.position.set(cx, wheelY, cz);
    group.add(pivot);
    wheels.push({ pivot, spin, flip });
  }

  const armMat = mats.dark;
  const arms: CarModel['arms'] = corners.map(([cx, cz]) => {
    const g = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
    const mesh = new THREE.Mesh(g, armMat);
    mesh.castShadow = true;
    group.add(mesh);
    return { mesh, anchor: new THREE.Vector3(Math.sign(cx) * hx * 0.55, -hy * 0.75, cz * 0.92) };
  });

  return { group, wheels, arms, materials: mats, battery };
}
