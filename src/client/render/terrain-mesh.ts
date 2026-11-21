import * as THREE from 'three';
import { Surface } from '../../shared/surfaces';
import { mulberry32 } from '../../shared/rng';
import { WATER_LEVEL, type Terrain } from '../../shared/terrain';
import type { Boulder } from '../../shared/boulders';

const COLORS: Record<Surface, number> = {
  [Surface.Grass]: 0x5a8f3c,
  [Surface.Patio]: 0xb9b2a4,
  [Surface.Sand]: 0xe0c27a,
  [Surface.Mud]: 0x5b4126,
  [Surface.Rock]: 0x8b8e93,
  [Surface.Water]: 0x2f6f8f,
  [Surface.Gravel]: 0xa59d8c,
};

export function buildTerrainMesh(terrain: Terrain): THREE.Group {
  const n = terrain.points;
  const half = terrain.size / 2;
  const cell = terrain.size / (n - 1);
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const rand = mulberry32(terrain.seed ^ 0x9e3779b9);
  const c = new THREE.Color();

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      positions[i * 3] = -half + col * cell;
      positions[i * 3 + 1] = terrain.heights[i] ?? 0;
      positions[i * 3 + 2] = -half + row * cell;
      c.setHex(COLORS[(terrain.surfaces[i] ?? 0) as Surface]);
      const shade = 0.88 + rand() * 0.2;
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(terrain.size, terrain.size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3f8fb5, transparent: true, opacity: 0.72, roughness: 0.2 }),
  );
  water.position.y = WATER_LEVEL;

  const group = new THREE.Group();
  group.add(mesh, water, buildScatter(terrain));
  return group;
}

/** Grass tufts and rocks. They give the eye something to read speed from. */
function buildScatter(terrain: Terrain): THREE.Group {
  const rand = mulberry32(terrain.seed + 7);
  const group = new THREE.Group();
  const tuftGeo = new THREE.ConeGeometry(0.16, 0.55, 4).translate(0, 0.27, 0);
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
  const tufts: THREE.Matrix4[] = [];
  const rocks: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const half = terrain.size / 2 - 10;

  for (let i = 0; i < 9000 && (tufts.length < 3200 || rocks.length < 450); i++) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const s = terrain.surfaceAt(x, z);
    const y = terrain.heightAt(x, z);
    if (s === Surface.Grass && tufts.length < 3200) {
      const k = 0.6 + rand() * 1.1;
      m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, rand() * 6.28, 0)), new THREE.Vector3(k, k, k));
      tufts.push(m.clone());
    } else if ((s === Surface.Gravel || s === Surface.Sand) && rocks.length < 450) {
      // Pebbles only. Real boulders come from boulders.ts and have colliders.
      const k = 0.12 + rand() * 0.22;
      m.compose(new THREE.Vector3(x, y + k * 0.3, z), q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3)), new THREE.Vector3(k, k * 0.8, k));
      rocks.push(m.clone());
    }
  }

  const tuftMesh = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0x77b24a, flatShading: true }), tufts.length);
  tufts.forEach((t, i) => tuftMesh.setMatrixAt(i, t));
  const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x7d8086, flatShading: true }), rocks.length);
  rocks.forEach((t, i) => rockMesh.setMatrixAt(i, t));
  group.add(tuftMesh, rockMesh);
  return group;
}

/** Visual boulders. Same list the physics uses, so what you see is what you hit. */
export function buildBoulderMesh(boulders: readonly Boulder[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x80848b, flatShading: true, roughness: 1 }),
    boulders.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  boulders.forEach((b, i) => {
    // Slightly under the collider radius so the mesh never floats above what you hit.
    m.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromEuler(e.set(b.rx, b.ry, b.rz)), new THREE.Vector3(b.radius, b.radius * 0.92, b.radius));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
