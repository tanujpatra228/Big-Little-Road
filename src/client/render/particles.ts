import * as THREE from 'three';
import type { ParticlePool, SkidMarks } from '../../shared/particles';
import { MARK_LIFE, MARK_WIDTH } from '../../shared/particles';
import type { Terrain } from '../../shared/terrain';

const VERT = /* glsl */ `
  attribute float size;
  attribute vec4 color;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, size * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Draws one pool as soft round points: one draw call, sizes and fades per particle. Two of these (one
 * normal, one additive) cover every effect.
 */
export class ParticleLayer {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly siz: Float32Array;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, private readonly capacity: number, additive: boolean) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.siz = new Float32Array(capacity);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  get drawn(): number {
    return this.geo.drawRange.count;
  }

  /** Copies the pool into the buffers. `scale` is pixels per metre at one metre away. */
  update(pool: ParticlePool, scale: number): void {
    const n = Math.min(pool.count, this.capacity);
    for (let i = 0; i < n; i++) {
      const t = pool.t(i);
      this.pos[i * 3] = pool.px[i]!;
      this.pos[i * 3 + 1] = pool.py[i]!;
      this.pos[i * 3 + 2] = pool.pz[i]!;
      this.siz[i] = pool.size0[i]! + (pool.size1[i]! - pool.size0[i]!) * t;
      const fadeIn = Math.min(1, t / 0.08);
      this.col[i * 4] = pool.r[i]!;
      this.col[i * 4 + 1] = pool.g[i]!;
      this.col[i * 4 + 2] = pool.b[i]!;
      this.col[i * 4 + 3] = pool.alpha[i]! * fadeIn * Math.pow(1 - t, 1.3);
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'size']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.mat.uniforms.uScale!.value = scale;
    this.points.visible = n > 0;
  }

  setVisible(v: boolean): void {
    this.points.visible = v;
  }
}

/**
 * Tyre marks: flat dark quads on the ground, one per segment, multiplied into what is under them so
 * they darken the ground instead of painting it black. They fade out over their last few seconds.
 */
export class SkidMarkMesh {
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly capacity: number,
  ) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }

  get drawn(): number {
    return this.mesh.count;
  }

  update(marks: SkidMarks): void {
    const n = Math.min(marks.count, this.capacity);
    for (let i = 0; i < n; i++) {
      const k = marks.marks[i]!;
      const life = k.age / MARK_LIFE;
      const fade = life < 0.7 ? 1 : 1 - (life - 0.7) / 0.3;
      this.q.setFromAxisAngle(this.up, k.yaw);
      this.pos.set(k.x, this.terrain.heightAt(k.x, k.z) + 0.05, k.z);
      this.scl.set(MARK_WIDTH, 1, k.length + 0.05);
      this.m.compose(this.pos, this.q, this.scl);
      this.mesh.setMatrixAt(i, this.m);
      const shade = 1 - k.strength * fade;
      this.mesh.setColorAt(i, this.c.setRGB(shade, shade, shade));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = n > 0;
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }
}
