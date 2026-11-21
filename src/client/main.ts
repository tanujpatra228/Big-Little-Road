import * as THREE from 'three';
import { CARS, CAR_ORDER, cloneSpec, type CarRole, type CarSpec } from '../shared/cars';
import { generateTerrain, SPAWN } from '../shared/terrain';
import { generateBoulders } from '../shared/boulders';
import { createPhysicsWorld, FIXED_DT, initRapier, type PhysicsWorld } from './physics/world';
import { FLIP_RESET_SECONDS, Vehicle } from './physics/vehicle';
import { buildBoulderMesh, buildTerrainMesh } from './render/terrain-mesh';
import { buildGrass } from './render/grass';
import { CarMesh } from './render/car-mesh';
import { ChaseCam } from './render/chase-cam';
import { InputDevices } from './game/input';
import { createStage } from './render/stage';
import { runShowcase } from './game/showcase';
import { Hud } from './ui/hud';
import { TunePanel } from './ui/tune-panel';

const SEED = 20260;
const params = new URLSearchParams(location.search);

async function boot(): Promise<void> {
  await initRapier();
  const stage = createStage(params);
  if (params.has('showcase')) {
    runShowcase(stage, params);
    return;
  }
  const { scene, camera } = stage;
  const terrain = generateTerrain(SEED);
  const boulders = generateBoulders(terrain);
  const pw: PhysicsWorld = createPhysicsWorld(terrain, boulders);
  scene.add(buildTerrainMesh(terrain), buildBoulderMesh(boulders));
  const grass = buildGrass(terrain);
  scene.add(grass.group);

  const chase = new ChaseCam(camera, terrain);
  const input = new InputDevices();

  const specs: Record<CarRole, CarSpec> = {
    scout: cloneSpec(CARS.scout),
    hauler: cloneSpec(CARS.hauler),
    relay: cloneSpec(CARS.relay),
  };
  let role: CarRole = 'scout';
  let vehicle: Vehicle;
  let mesh: CarMesh;
  let gravity = 9.81;

  const spawn = (r: CarRole, x: number, z: number, yaw: number): void => {
    if (vehicle) {
      vehicle.dispose();
      scene.remove(mesh.group);
    }
    role = r;
    vehicle = new Vehicle(pw, specs[r], x, z, yaw);
    mesh = new CarMesh(specs[r]);
    scene.add(mesh.group);
    chase.snap();
    tune?.show(specs[r]);
  };

  const respawnInPlace = (): void => {
    const t = vehicle.body.translation();
    const q = vehicle.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    spawn(role, t.x, t.z, yaw);
  };

  const tune = params.has('tune')
    ? new TunePanel(
        (spec) => {
          specs[role] = spec;
          respawnInPlace();
        },
        () => gravity,
        (g) => {
          gravity = g;
          pw.world.gravity = { x: 0, y: -g, z: 0 };
        },
      )
    : null;

  const hud = new Hud((r) => {
    const t = vehicle.body.translation();
    const q = vehicle.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    spawn(r, t.x, t.z, yaw);
  });

  spawn('scout', SPAWN.x, SPAWN.z, 0);

  addEventListener('resize', () => stage.resize());

  // Test hook for automated runs.
  (window as unknown as { __blr: unknown }).__blr = {
    get vehicle() { return vehicle; },
    get role() { return role; },
    spawn,
  };

  let last = performance.now();
  let acc = 0;
  stage.renderer.setAnimationLoop((now) => {
    const frame = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += frame;

    CAR_ORDER.forEach((r, i) => {
      if (input.wasPressed(`Digit${i + 1}`)) {
        const t = vehicle.body.translation();
        const q = vehicle.body.rotation();
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
        spawn(r, t.x, t.z, yaw);
      }
    });
    if (input.wasPressed('KeyR')) {
      if (vehicle.flippedFor >= FLIP_RESET_SECONDS || params.has('debug') || params.has('tune')) vehicle.resetUpright();
    }

    let steps = 0;
    while (acc >= FIXED_DT && steps < 5) {
      vehicle.step(input.read(FIXED_DT), FIXED_DT);
      pw.world.step();
      vehicle.afterPhysics();
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === 5) acc = 0;
    if (vehicle.isOutOfBounds()) spawn(role, SPAWN.x, SPAWN.z, 0);

    const pose = vehicle.pose(acc / FIXED_DT);
    mesh.update(vehicle, pose, frame);
    chase.update(pose, vehicle.speed, frame);
    stage.followSun(new THREE.Vector3(pose.x, pose.y, pose.z));
    hud.update(vehicle, role, frame, stage.quality());
    grass.update(now / 1000, camera);
    stage.render(frame);
  });
}

void boot();
