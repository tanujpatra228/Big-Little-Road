import * as THREE from 'three';
import { CARS, cloneSpec } from '../../shared/cars';
import { generateTerrain } from '../../shared/terrain';
import { CarMesh } from '../render/car-mesh';
import type { Stage } from '../render/stage';
import { buildTerrainMesh } from '../render/terrain-mesh';
import type { WheelState } from '../physics/vehicle';

/**
 * Review page (?showcase): all cars parked on the patio, camera slowly orbiting.
 * ?angle=<deg> freezes the orbit for screenshots, ?dist= and ?height= frame it,
 * ?focus=<0-4> centres the camera on one car (0 Scout, 1 Hauler, 2 Relay, 3 dead rescue, 4 revived).
 */
export function runShowcase(stage: Stage, params: URLSearchParams): void {
  const terrain = generateTerrain(20260);
  stage.scene.add(buildTerrainMesh(terrain));

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
  lineup.forEach((item, i) => {
    const car = new CarMesh(item.spec, item.variant);
    const x = (i - (lineup.length - 1) / 2) * spacing;
    const wheels: WheelState[] = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      wheels.push({
        x: sx * item.spec.trackHalf,
        y: -item.spec.half.y * 0.4 - item.spec.suspensionRest * 0.85,
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
    stage.render(dt);
  });
}
