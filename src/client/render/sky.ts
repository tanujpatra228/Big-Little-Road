import * as THREE from 'three';

/**
 * Warm late afternoon: low sun off to the side of the spawn heading (+z), so cars are lit from the
 * side with long soft shadows instead of being backlit when you drive forward.
 */
export const SUN_DIR = new THREE.Vector3(0.86, 0.34, 0.28).normalize();

export const SKY_COLORS = {
  horizon: new THREE.Color(0xf3c8a2),
  mid: new THREE.Color(0xbcd3ee),
  zenith: new THREE.Color(0x5f93d8),
  fog: new THREE.Color(0xe6c9ab),
};

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    p.z = p.w; // always at the far plane
    gl_Position = p;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uHorizon;
  uniform vec3 uMid;
  uniform vec3 uZenith;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
    col = mix(col, uZenith, smoothstep(0.12, 0.9, h));

    float sd = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.55, 0.25) * pow(sd, 5.0) * 0.28;   // wide warm halo
    col += vec3(1.0, 0.78, 0.5) * pow(sd, 48.0) * 0.55;   // tight glow
    col += vec3(1.0, 0.92, 0.72) * smoothstep(0.9993, 0.9998, sd) * 7.0; // sun disc

    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.24) * 0.9 + vec2(uTime * 0.006, uTime * 0.0025);
      float n = fbm(uv * 1.25);
      float cover = smoothstep(0.5, 0.76, n) * smoothstep(0.0, 0.2, d.y);
      float thick = smoothstep(0.55, 0.95, n);
      vec2 flatDir = normalize(d.xz + 1e-4);
      float lit = clamp(0.55 + 0.45 * dot(flatDir, normalize(uSunDir.xz)), 0.0, 1.0);
      vec3 shade = vec3(0.55, 0.58, 0.74);
      vec3 sun = vec3(1.0, 0.85, 0.7);
      col = mix(col, mix(shade, sun, lit * (1.0 - 0.55 * thick)), cover * 0.92);
    }

    col = mix(col, uHorizon, 1.0 - smoothstep(-0.18, 0.0, d.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** A second dome in its own scene, used to bake the lighting environment. */
  envMesh: THREE.Mesh;
}

export function createSky(): Sky {
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uHorizon: { value: SKY_COLORS.horizon },
      uMid: { value: SKY_COLORS.mid },
      uZenith: { value: SKY_COLORS.zenith },
      uTime: { value: 0 },
    },
  });
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  const envMesh = new THREE.Mesh(geo, material);
  envMesh.frustumCulled = false;
  return { mesh, material, envMesh };
}
