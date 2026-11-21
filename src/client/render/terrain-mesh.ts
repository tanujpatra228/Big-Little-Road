import * as THREE from 'three';
import { Surface } from '../../shared/surfaces';
import { mulberry32 } from '../../shared/rng';
import { WATER_LEVEL, type Terrain } from '../../shared/terrain';
import type { Boulder } from '../../shared/boulders';

/**
 * Terrain colour is procedural, so surfaces get real detail and crisp, organic borders even though
 * the mesh is coarse. Each vertex carries one-hot surface weights; the fragment shader jitters them
 * with noise, sharpens them, then paints each surface from its own pattern.
 * Vertex colour is only baked ambient occlusion: dips darken, rises brighten a touch.
 */
const HEDGE = 7; // weight slot for the hedge at the fence

const terrainHelpers = /* glsl */ `
  float t_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float t_noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(t_hash(i), t_hash(i + vec2(1.0, 0.0)), f.x), mix(t_hash(i + vec2(0.0, 1.0)), t_hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float t_fbm(vec2 p) { return t_noise(p) * 0.55 + t_noise(p * 2.1) * 0.3 + t_noise(p * 4.3) * 0.15; }

`;

const terrainFragmentColor = /* glsl */ `
  vec2 p = vWP.xz;
  float nLow = t_fbm(p * 0.09);
  float nMid = t_fbm(p * 0.45);
  float nHi = t_noise(p * 5.0);

  // Wiggle the borders, then sharpen.
  float wig = (t_noise(p * 1.3) - 0.5) * 0.5 + (t_noise(p * 4.0) - 0.5) * 0.18;
  vec4 wa = smoothstep(0.4, 0.6, vW0 + wig);
  vec4 wb = smoothstep(0.4, 0.6, vW1 + wig);
  float tot = dot(wa, vec4(1.0)) + dot(wb, vec4(1.0));
  if (tot < 0.05) { wa = vW0; wb = vW1; tot = dot(wa, vec4(1.0)) + dot(wb, vec4(1.0)); } // never go black
  wa /= max(tot, 1e-4); wb /= max(tot, 1e-4);

  // Grass: mottled, with soft mowing stripes.
  vec3 grass = mix(uGrassA, uGrassB, nLow * 0.8 + nMid * 0.35);
  grass *= 1.0 + 0.06 * sin(p.x * 0.55 + nLow * 2.0) + (nHi - 0.5) * 0.06;

  // Patio: pavers with grout.
  vec2 cellId = floor(p / 1.5);
  vec2 g = fract(p / 1.5);
  float grout = 1.0 - smoothstep(0.0, 0.035, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
  vec3 patio = uPatio * (0.94 + t_hash(cellId) * 0.1 + (nHi - 0.5) * 0.06);
  patio = mix(patio, patio * 0.62, grout);

  // Sand: ripples and speckle.
  float ripple = sin((p.x * 0.8 + p.y * 0.45) * 3.0 + nLow * 9.0) * 0.5 + 0.5;
  vec3 sand = uSand * (0.93 + ripple * 0.09 + (nHi - 0.5) * 0.08);

  // Mud: dark blotches.
  vec3 mud = mix(uMud * 0.8, uMud * 1.15, nMid) * (0.95 + (nHi - 0.5) * 0.08);

  // Rock: patchy with cracks.
  float crack = smoothstep(0.0, 0.035, abs(t_fbm(p * 0.7) - 0.5));
  vec3 rock = mix(uRock * 0.78, uRock * 1.08, nMid) * (0.82 + 0.18 * crack);

  // Gravel: lots of small stones.
  float stones = t_noise(p * 11.0) * 0.6 + t_noise(p * 27.0) * 0.4;
  vec3 gravel = uGravel * (0.78 + stones * 0.42) * (0.94 + nMid * 0.1);

  vec3 bed = mix(uMud, uSand, 0.35) * (0.8 + nMid * 0.2);
  vec2 wall = vec2(vWP.x + vWP.z, vWP.y * 1.3);
  float leaf = t_noise(wall * 2.2) * 0.6 + t_noise(wall * 7.0) * 0.4;
  float height = clamp(vWP.y / 9.0, 0.0, 1.0);
  vec3 hedge = mix(uGrassA * 0.55, uGrassB * 0.9, leaf) * (1.0 - 0.25 * height);

  vec3 col = grass * wa.x + patio * wa.y + sand * wa.z + mud * wa.w
           + rock * wb.x + bed * wb.y + gravel * wb.z + hedge * wb.w;
  diffuseColor.rgb = col * vColor.rgb;
`;

function makeTerrainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const colour = (hex: number): THREE.Color => new THREE.Color(hex);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGrassA: { value: colour(0x5d9235) },
      uGrassB: { value: colour(0x86b648) },
      uPatio: { value: colour(0xcfc6b2) },
      uSand: { value: colour(0xe9cf8e) },
      uMud: { value: colour(0x6b4a2f) },
      uRock: { value: colour(0xa3a39f) },
      uGravel: { value: colour(0xb8ae98) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW0;\nattribute vec4 aW1;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW0 = aW0; vW1 = aW1; vWP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uGrassA; uniform vec3 uGrassB; uniform vec3 uPatio; uniform vec3 uSand; uniform vec3 uMud; uniform vec3 uRock; uniform vec3 uGravel;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying vec3 vWP;\n' + terrainHelpers,
      )
      .replace('#include <color_fragment>', terrainFragmentColor);
  };
  return material;
}

export function buildTerrainMesh(terrain: Terrain): THREE.Group {
  const n = terrain.points;
  const half = terrain.size / 2;
  const cell = terrain.size / (n - 1);
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const w0 = new Float32Array(n * n * 4);
  const w1 = new Float32Array(n * n * 4);
  const rand = mulberry32(terrain.seed ^ 0x9e3779b9);

  const h = (row: number, col: number): number =>
    terrain.heights[Math.min(n - 1, Math.max(0, row)) * n + Math.min(n - 1, Math.max(0, col))] ?? 0;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const x = -half + col * cell;
      const z = -half + row * cell;
      positions[i * 3] = x;
      positions[i * 3 + 1] = terrain.heights[i] ?? 0;
      positions[i * 3 + 2] = z;

      // One-hot surface weights; the hedge replaces whatever is at the fence.
      const slot = Math.max(Math.abs(x), Math.abs(z)) > half - 7 ? HEDGE : (terrain.surfaces[i] ?? 0);
      (slot < 4 ? w0 : w1)[i * 4 + (slot % 4)] = 1;

      // Baked occlusion: dips are darker, bumps a little brighter.
      const avg = (h(row - 1, col) + h(row + 1, col) + h(row, col - 1) + h(row, col + 1)) / 4;
      const curve = (terrain.heights[i] ?? 0) - avg;
      const ao = Math.min(1.06, Math.max(0.78, 1 + curve * 0.45)) * (0.97 + rand() * 0.03);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
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
  geo.setAttribute('aW0', new THREE.BufferAttribute(w0, 4));
  geo.setAttribute('aW1', new THREE.BufferAttribute(w1, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, makeTerrainMaterial());
  mesh.receiveShadow = true;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(terrain.size, terrain.size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4aa7c9, transparent: true, opacity: 0.7, roughness: 0.15, metalness: 0.05 }),
  );
  water.position.y = WATER_LEVEL;

  const group = new THREE.Group();
  group.add(mesh, water, buildScatter(terrain));
  return group;
}

/** Pebbles on sand and gravel. Grass, flowers and boulders are built elsewhere. */
function buildScatter(terrain: Terrain): THREE.Group {
  const rand = mulberry32(terrain.seed + 7);
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const pebbles: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const half = terrain.size / 2 - 10;

  for (let i = 0; i < 40000 && pebbles.length < 900; i++) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const s = terrain.surfaceAt(x, z);
    if (s !== Surface.Gravel && s !== Surface.Sand) continue;
    if (s === Surface.Sand && rand() < 0.6) continue; // gravel is pebblier than sand
    const k = 0.1 + rand() * 0.2;
    m.compose(
      new THREE.Vector3(x, terrain.heightAt(x, z) + k * 0.2, z),
      q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3)),
      new THREE.Vector3(k, k * 0.7, k),
    );
    pebbles.push(m.clone());
  }

  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a968c, flatShading: true, roughness: 1 }), pebbles.length);
  pebbles.forEach((t, i) => mesh.setMatrixAt(i, t));
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Visual boulders. One mesh per jointed sphere, from the same list the physics uses. */
export function buildBoulderMesh(boulders: readonly Boulder[]): THREE.InstancedMesh {
  const parts = boulders.flatMap((b) => b.parts.map((p) => ({ p, kind: b.kind })));
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }),
    parts.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  parts.forEach(({ p, kind }, i) => {
    // A touch under the collider radius so the mesh never floats above what you hit.
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromEuler(e.set(p.rx, p.ry, p.rz)), new THREE.Vector3(p.r * 0.97, p.r * 0.9, p.r * 0.97));
    mesh.setMatrixAt(i, m);
    const tone = 0.34 + ((p.rx * 7.3 + p.rz * 3.1) % 1) * 0.12;
    mesh.setColorAt(i, c.setRGB(tone * 0.97, tone, tone * (kind === 'rubble' ? 1.0 : 1.07)));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
