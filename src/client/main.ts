import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

async function boot(): Promise<void> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.1, 50));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.25, 0.8), body);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b6d6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4f7d3a }),
  );
  scene.add(ground);
  const car = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.5, 1.6),
    new THREE.MeshStandardMaterial({ color: 0xe34b2a }),
  );
  scene.add(car);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0.5, 0);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop(() => {
    world.step();
    const t = body.translation();
    const r = body.rotation();
    car.position.set(t.x, t.y, t.z);
    car.quaternion.set(r.x, r.y, r.z, r.w);
    renderer.render(scene, camera);
  });
}

void boot();
