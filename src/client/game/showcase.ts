import * as THREE from 'three';
import { CARS, cloneSpec, wheelRestY, type CarRole } from '../../shared/cars';
import { generateTerrain } from '../../shared/terrain';
import { CarMesh } from '../render/car-mesh';
import { CarTransformer } from '../render/car-transformer';
import { Vehicle, type WheelState } from '../physics/vehicle';
import type { Stage } from '../render/stage';
import { buildTerrainMesh } from '../render/terrain-mesh';
import { buildGrass } from '../render/grass';

/**
 * Review page (?showcase): all cars parked on the patio, camera slowly orbiting.
 * ?angle=<deg> freezes the orbit for screenshots, ?dist= and ?height= frame it,
 * ?focus=<0-4> centres the camera on one car (0 Scout, 1 Hauler, 2 Relay, 3 dead rescue, 4 revived),
 * and ?solo hides the others so side views are not blocked.
 * ?transform=<role> previews the car-to-car transformation (&from=<role>, default scout). It loops, or
 * add &at=<seconds> to freeze at that moment of the animation, e.g. &at=0.3 for the swap.
 */
export function runShowcase(stage: Stage, params: URLSearchParams): void {
  const terrain = generateTerrain(20260);
  stage.scene.add(buildTerrainMesh(terrain));
  if (params.has('transform')) {
    runTransformPreview(stage, params, terrain.heightAt(0, 0));
    return;
  }
  const grass = buildGrass(terrain);
  stage.scene.add(grass.group);

  const rescueSpec = cloneSpec(CARS.scout);
  rescueSpec.color = 0xf4d35e;
  rescueSpec.label = 'Rescue car';

  const lineup: Array<{ spec: typeof rescueSpec; variant: 'standard' | 'rescue'; lights: boolean; battery: boolean }> = [
    { spec: CARS.scout, variant: 'standard', lights: true, battery: false },
    { spec: CARS.hauler, variant: 'standard', lights: true, battery: false },
    { spec: CARS.relay, variant: 'standard', lights: true, battery: false },
    { spec: rescueSpec, variant: 'rescue', lights: false, battery: false },
    { spec: rescueSpec, variant: 'rescue', lights: true, battery: true },
  ];

  const spacing = 3.4;
  const groundY = terrain.heightAt(0, 0);
  const solo = params.has('solo') && params.has('focus') ? Number(params.get('focus')) : null;
  lineup.forEach((item, i) => {
    if (solo !== null && i !== solo) return;
    const car = new CarMesh(item.spec, item.variant);
    const x = (i - (lineup.length - 1) / 2) * spacing;
    const wheels: WheelState[] = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      wheels.push({
        x: sx * item.spec.trackHalf,
        y: wheelRestY(item.spec),
        z: sz * item.spec.wheelBaseHalf,
        steer: 0,
        spin: 0,
        contact: true,
      });
    }
    car.setWheels(wheels);
    car.setLights(item.lights);
    car.setBattery(item.battery);
    const rideY = groundY + item.spec.wheelRadius - wheels[0]!.y;
    car.setPose({ x, y: rideY, z: 0, qx: 0, qy: Math.sin(0.3), qz: 0, qw: Math.cos(0.3) });
    stage.scene.add(car.group);
  });

  const focus = params.has('focus') ? Number(params.get('focus')) : null;
  const fx = focus === null ? 0 : (focus - (lineup.length - 1) / 2) * spacing;
  const center = new THREE.Vector3(fx, groundY + (focus === null ? 0.5 : 0.55), 0);
  const dist = Number(params.get('dist') ?? 11);
  const height = Number(params.get('height') ?? 3.2);
  const frozen = params.has('angle');
  let angle = ((Number(params.get('angle') ?? 20)) * Math.PI) / 180;
  stage.followSun(center);

  let last = performance.now();
  stage.renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!frozen) angle += dt * 0.12;
    stage.camera.position.set(center.x + Math.sin(angle) * dist, groundY + height, Math.cos(angle) * dist);
    stage.camera.lookAt(center);
    grass.update(now / 1000, stage.camera);
    stage.render(dt);
  });
}

const rest = (role: CarRole): WheelState[] => {
  const spec = CARS[role];
  const out: WheelState[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    out.push({ x: sx * spec.trackHalf, y: wheelRestY(spec), z: sz * spec.wheelBaseHalf, steer: 0, spin: 0, contact: true });
  }
  return out;
};

/** One car on the patio that transforms into another, for reviewing the animation. */
function runTransformPreview(stage: Stage, params: URLSearchParams, groundY: number): void {
  const roles = Object.keys(CARS) as CarRole[];
  const pick = (v: string | null, fallback: CarRole): CarRole => (roles.includes(v as CarRole) ? (v as CarRole) : fallback);
  const from = pick(params.get('from'), 'scout');
  const to = pick(params.get('transform'), 'hauler');
  const freezeAt = params.has('at') ? Number(params.get('at')) : null;

  const xf = new CarTransformer(stage.scene, CARS[from]);
  const y = groundY + Math.max(Vehicle.rideHeight(CARS[from]), Vehicle.rideHeight(CARS[to]));
  const pose = { x: 0, y, z: 0, qx: 0, qy: Math.sin(0.35), qz: 0, qw: Math.cos(0.35) };
  const apply = (role: CarRole): void => {
    xf.setPose(pose);
    xf.setWheels(rest(role));
  };
  apply(from);

  const dist = Number(params.get('dist') ?? 6.5);
  const height = Number(params.get('height') ?? 2.2);
  const angle = (Number(params.get('angle') ?? 25) * Math.PI) / 180;
  const centre = new THREE.Vector3(0, groundY + 0.6, 0);
  stage.followSun(centre);

  let current = from;
  let target = to;
  let idleFor = 0;
  let frozen = false;
  if (freezeAt !== null) {
    xf.transformTo(CARS[target]);
    apply(target);
    for (let t = 0; t < freezeAt; t += 1 / 60) xf.tick(1 / 60);
    frozen = true;
  }

  let last = performance.now();
  stage.renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!frozen) {
      xf.tick(dt);
      if (!xf.animating) {
        idleFor += dt;
        if (idleFor > 1.4) {
          idleFor = 0;
          [current, target] = [target, current];
          xf.transformTo(CARS[target]);
          apply(target);
        }
      }
    }
    xf.setPose(pose);
    stage.camera.position.set(Math.sin(angle) * dist, groundY + height, Math.cos(angle) * dist);
    stage.camera.lookAt(centre);
    stage.render(dt);
  });
}
