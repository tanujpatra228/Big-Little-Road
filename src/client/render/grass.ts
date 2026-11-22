import * as THREE from 'three';
import { mulberry32 } from '../../shared/rng';
import type { Terrain } from '../../shared/terrain';
import { PROPS } from '../../shared/net/props';
import { FLOWER_COLOURS, grassKeep, scatterFlowers, scatterGrass, type Clearing, type Flower, type Plant } from '../../shared/vegetation';

/** No grass where props start, so a board lying on the lawn is not hidden by it. */
const CLEARINGS: Clearing[] = PROPS.map((p) => ({ x: p.start.x, z: p.start.z, r: 3.2 }));

const CELL = 16;

/** One clump: a handful of tapered, bent blades. Dark at the root, light at the tip. */
function tuftGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(1337);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const tip: number[] = [];
  const idx: number[] = [];
  const root = new THREE.Color(0x3d7228);
  const mid = new THREE.Color(0x6aa23a);
  const top = new THREE.Color(0xc2de72);

  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.2;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = 0.26 + rand() * 0.26;
    const w = 0.04 + rand() * 0.022;
    const yaw = rand() * Math.PI;
    const bend = 0.07 + rand() * 0.15;
    const wx = Math.cos(yaw);
    const wz = Math.sin(yaw);
    const fx = -Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Mostly-up normals give soft, ground-like shading instead of harsh per-blade lighting.
    const n = new THREE.Vector3(fx * 0.3, 0.7, fz * 0.3).normalize();
    const rows: Array<[number, number, number, THREE.Color, number]> = [
      [0, w, 0, root, 0],
      [0.55, w * 0.72, bend * 0.25, mid, 0.55],
      [1, 0, bend, top, 1],
    ];
    const base = pos.length / 3;
    for (const [t, hw, off, c, tp] of rows) {
      const y = h * t;
      const lefts = hw > 0 ? [-1, 1] : [0];
      for (const s of lefts) {
        pos.push(bx + wx * hw * s + fx * off, y, bz + wz * hw * s + fz * off);
        nor.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
        tip.push(tp);
      }
    }
    // Rows: [L0,R0],[L1,R1],[tip]
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  g.setIndex(idx);
  return g;
}

export interface Grass {
  group: THREE.Group;
  /** Call every frame. Drives wind and distance-based density. */
  update(time: number, camera: THREE.Camera): void;
  /** 0 to 1: how much of the lawn to draw. 1 is everything the distance rules allow. */
  setDensity(d: number): void;
  /** Show or hide the flowers. */
  setFlowers(on: boolean): void;
  /** Current density setting, 0 to 1. */
  density(): number;
  flowersOn(): boolean;
  /** Tufts and triangles the grass would cost this frame, for the performance panel. */
  stats(): { tufts: number; triangles: number };
}

interface Cell {
  mesh: THREE.InstancedMesh;
  full: number;
  cx: number;
  cz: number;
}

export function buildGrass(terrain: Terrain): Grass {
  const group = new THREE.Group();
  const uTime = { value: 0 };

  // Lambert, not PBR: the blades are matte with soft baked shading, so specular and reflections would cost
  // a lot per pixel (grass is the most overdrawn thing on screen) and add nothing you could see.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTip;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iPos = vec3(0.0);
        #endif
        float ph = iPos.x * 0.31 + iPos.z * 0.23;
        float sway = aTip * aTip;
        transformed.x += (sin(uTime * 1.7 + ph) * 0.065 + sin(uTime * 3.3 + ph * 2.0) * 0.016) * sway;
        transformed.z += cos(uTime * 1.4 + ph * 1.1) * 0.05 * sway;`,
      );
  };

  // Bin tufts into cells so the GPU can frustum-cull and we can thin far cells.
  const plants = scatterGrass(terrain, undefined, CLEARINGS);
  const half = terrain.size / 2;
  const n = Math.ceil(terrain.size / CELL);
  const bins: Plant[][] = Array.from({ length: n * n }, () => []);
  for (const p of plants) {
    const cx = Math.min(n - 1, Math.max(0, Math.floor((p.x + half) / CELL)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor((p.z + half) / CELL)));
    bins[cz * n + cx]!.push(p);
  }

  const geo = tuftGeometry();
  const cells: Cell[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  bins.forEach((list, i) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((p, k) => {
      m.compose(new THREE.Vector3(p.x, p.y - 0.02, p.z), q.setFromEuler(e.set(0, p.yaw, 0)), new THREE.Vector3(p.scale, p.scale * (0.85 + p.tone * 0.35), p.scale));
      mesh.setMatrixAt(k, m);
      // Gentle brightness and warm/cool variation across tufts.
      const b = 0.88 + p.tone * 0.26;
      mesh.setColorAt(k, c.setRGB(b * (0.95 + p.tone * 0.1), b, b * (0.9 + (1 - p.tone) * 0.12)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    group.add(mesh);
    cells.push({ mesh, full: list.length, cx: -half + ((i % n) + 0.5) * CELL, cz: -half + (Math.floor(i / n) + 0.5) * CELL });
  });

  const flowers = buildFlowers(terrain);
  group.add(flowers.group);

  let density = 1;
  let tufts = 0;
  const trisPerTuft = (geo.index?.count ?? 0) / 3;
  return {
    group,
    update(time, camera) {
      uTime.value = time;
      flowers.update(camera);
      const cam = camera.position;
      tufts = 0;
      for (const cell of cells) {
        const d = Math.hypot(cell.cx - cam.x, cell.cz - cam.z);
        const count = Math.floor(cell.full * grassKeep(d, density));
        cell.mesh.count = count;
        cell.mesh.visible = count > 0;
        tufts += count;
      }
    },
    setDensity(d) {
      density = Math.min(1, Math.max(0, d));
    },
    density: () => density,
    flowersOn: () => flowers.group.visible,
    setFlowers(on) {
      flowers.group.visible = on;
    },
    stats: () => ({ tufts, triangles: tufts * trisPerTuft }),
  };
}

const PALETTE = [0xffffff, 0xff7aa8, 0xffd23f, 0xb48cff, 0xff8a4c];

/** Flowers are binned into cells this wide, and cells farther than FLOWER_RADIUS from the camera are not drawn. */
const FLOWER_CELL = 32;
const FLOWER_RADIUS = 70;

interface FlowerCell {
  group: THREE.Group;
  cx: number;
  cz: number;
}

interface Flowers {
  group: THREE.Group;
  update(camera: THREE.Camera): void;
  count(): number;
}

/**
 * Flowers in clusters plus a few singles. They used to be three giant instanced meshes covering the
 * whole yard, so every flower was processed every frame, including all those behind you. Now they sit
 * in cells that the camera can cull, only nearby cells are drawn, and each flower is a few dozen
 * triangles instead of about eighty (the yellow centre was a 96-triangle sphere the size of a pea).
 */
function buildFlowers(terrain: Terrain): Flowers {
  const group = new THREE.Group();
  const flowers = scatterFlowers(terrain, undefined, undefined, CLEARINGS);

  const stemGeo = new THREE.CylinderGeometry(0.014, 0.018, 1, 4, 1, true).translate(0, 0.5, 0);
  const petalGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.035, 7);
  const centreGeo = new THREE.SphereGeometry(0.05, 5, 3).scale(1, 0.7, 1);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4f8a35, roughness: 1 });
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const centreMat = new THREE.MeshStandardMaterial({ color: 0xf2b21a, roughness: 0.6 });

  const half = terrain.size / 2;
  const n = Math.ceil(terrain.size / FLOWER_CELL);
  const bins: Flower[][] = Array.from({ length: n * n }, () => []);
  for (const f of flowers) {
    const cx = Math.min(n - 1, Math.max(0, Math.floor((f.x + half) / FLOWER_CELL)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor((f.z + half) / FLOWER_CELL)));
    bins[cz * n + cx]!.push(f);
  }

  const cells: FlowerCell[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  bins.forEach((list, bi) => {
    if (list.length === 0) return;
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, list.length);
    const petals = new THREE.InstancedMesh(petalGeo, petalMat, list.length);
    const centres = new THREE.InstancedMesh(centreGeo, centreMat, list.length);
    list.forEach((f, i) => {
      q.setFromEuler(e.set(0, f.yaw, 0));
      m.compose(new THREE.Vector3(f.x, f.y - 0.02, f.z), q, new THREE.Vector3(1, f.height, 1));
      stems.setMatrixAt(i, m);
      const tilt = q.setFromEuler(e.set(0.18, f.yaw, 0));
      m.compose(new THREE.Vector3(f.x, f.y + f.height, f.z), tilt, new THREE.Vector3(1, 1, 1));
      petals.setMatrixAt(i, m);
      petals.setColorAt(i, col.setHex(PALETTE[f.colour % FLOWER_COLOURS] ?? 0xffffff));
      m.compose(new THREE.Vector3(f.x, f.y + f.height + 0.02, f.z), tilt, new THREE.Vector3(1, 1, 1));
      centres.setMatrixAt(i, m);
    });
    const cell = new THREE.Group();
    for (const mesh of [stems, petals, centres]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      cell.add(mesh);
    }
    group.add(cell);
    cells.push({ group: cell, cx: -half + ((bi % n) + 0.5) * FLOWER_CELL, cz: -half + (Math.floor(bi / n) + 0.5) * FLOWER_CELL });
  });

  return {
    group,
    update(camera) {
      const cam = camera.position;
      // A cell reaches half its diagonal beyond its centre, so allow for that.
      const reach = FLOWER_RADIUS + FLOWER_CELL * 0.71;
      for (const c of cells) c.group.visible = Math.hypot(c.cx - cam.x, c.cz - cam.z) < reach;
    },
    count: () => flowers.length,
  };
}
