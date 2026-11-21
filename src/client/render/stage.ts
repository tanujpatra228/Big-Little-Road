import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSky, SKY_COLORS, SUN_DIR } from './sky';

export type Quality = 'low' | 'high';

const SHADOW_HALF = 38;

/** Warm grade, gentle contrast and a soft vignette. Runs in linear space before tone mapping. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1.1 },
    uTint: { value: new THREE.Vector3(1.04, 1.0, 0.94) },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform vec3 uTint;
    uniform float uContrast;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat) * uTint;
      col = max((col - 0.18) * uContrast + 0.18, 0.0);
      vec2 q = vUv - 0.5;
      col *= clamp(1.0 - dot(q, q) * uVignette * 2.4, 0.0, 1.0);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  quality(): Quality;
  setQuality(q: Quality): void;
  resize(): void;
  /** Keep the shadow window centred on `target`, snapped to shadow texels so shadows do not shimmer. */
  followSun(target: THREE.Vector3): void;
  render(dt: number): void;
}

export function createStage(params: URLSearchParams): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps pastel colours honest, unlike ACES
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(SKY_COLORS.horizon);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY_COLORS.fog, 0.0042);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);

  // Sky dome follows the camera; its lighting is baked into an environment map for reflections.
  const sky = createSky();
  scene.add(sky.mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky.envMesh);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8d7550, 0.5));

  const sun = new THREE.DirectionalLight(0xffd6a0, 3.0);
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.camera.right = sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // Quality tiers. An explicit ?quality= pins it; otherwise we start high and drop if frames are slow.
  const forced = params.get('quality');
  let quality: Quality = forced === 'low' ? 'low' : 'high';
  const pinned = forced === 'low' || forced === 'high';

  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;

  const buildComposer = (): EffectComposer => {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(renderer, target);
    c.setPixelRatio(pr);
    c.setSize(size.x, size.y);
    c.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.55, 0.92);
    c.addPass(bloom);
    c.addPass(new ShaderPass(GradeShader));
    c.addPass(new OutputPass());
    return c;
  };

  const applyQuality = (): void => {
    const high = quality === 'high';
    renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 2) : 1);
    renderer.setSize(innerWidth, innerHeight);
    sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    composer?.dispose();
    composer = high ? buildComposer() : null;
  };
  applyQuality();

  let clock = 0;
  let sampleTime = 0;
  let sampleFrames = 0;

  const stage: Stage = {
    renderer,
    scene,
    camera,
    sun,
    quality: () => quality,
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      applyQuality();
    },
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      composer?.setSize(innerWidth, innerHeight);
    },
    followSun(target) {
      const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x;
      const lz = SUN_DIR;
      const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), lz).normalize();
      const ly = new THREE.Vector3().crossVectors(lz, lx);
      const sx = Math.round(target.dot(lx) / texel) * texel;
      const sy = Math.round(target.dot(ly) / texel) * texel;
      const snapped = lx.multiplyScalar(sx).addScaledVector(ly, sy).addScaledVector(lz, target.dot(lz));
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(SUN_DIR, 110);
    },
    render(dt) {
      clock += dt;
      sky.material.uniforms.uTime!.value = clock;
      sky.mesh.position.copy(camera.position);

      if (!pinned && quality === 'high' && clock > 1.5) {
        sampleTime += dt;
        sampleFrames++;
        if (sampleTime >= 3) {
          if (sampleFrames / sampleTime < 38) stage.setQuality('low');
          sampleTime = 0;
          sampleFrames = 0;
        }
      }
      if (composer) composer.render(dt);
      else renderer.render(scene, camera);
    },
  };
  void bloom;
  return stage;
}
