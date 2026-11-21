import * as THREE from 'three';
import { GOALS } from '../../shared/goals';
import { PLATFORM, PLATFORM_WALL } from '../../shared/terrain';

/** A toy-brick pattern. Drawn once on a canvas, no download. */
function brickTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8d7d68'; // mortar
  g.fillRect(0, 0, w, h);
  const rows = 8;
  const rh = h / rows;
  const bw = 52;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let x = -bw; x < w + bw; x += bw) {
      const tone = 0.86 + rnd() * 0.22;
      g.fillStyle = `rgb(${Math.round(196 * tone)},${Math.round(166 * tone)},${Math.round(134 * tone)})`;
      g.fillRect(x + off + 2, r * rh + 2, bw - 4, rh - 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export interface Terrace {
  group: THREE.Group;
  /** `celebrate` is 0 to 1: how strongly the beacon should look like a win. */
  update(time: number, celebrate: number): void;
}

/**
 * The stone retaining wall round the platform, and the beacon on top. The wall is purely visual here;
 * its collider is built by the physics world from the same numbers (PLATFORM_WALL).
 */
export function buildTerrace(): Terrace {
  const group = new THREE.Group();
  const topY = PLATFORM_WALL.top;
  const bottomY = -0.4;
  const h = topY - bottomY;
  const R = PLATFORM_WALL.face + 0.02;

  const tex = brickTexture();
  tex.repeat.set(Math.round((2 * Math.PI * R) / 1.9), Math.max(1, h / 1.0));
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, h, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }),
  );
  wall.position.set(PLATFORM.x, (topY + bottomY) / 2, PLATFORM.z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // A flat stone coping along the top edge so the wall ends neatly.
  const coping = new THREE.Mesh(
    new THREE.RingGeometry(R - 0.05, R + PLATFORM_WALL.thickness + 0.12, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9ccb4, roughness: 0.9 }),
  );
  coping.position.set(PLATFORM.x, topY + 0.015, PLATFORM.z);
  coping.receiveShadow = true;
  group.add(coping);

  // The beacon: a pole, a glowing orb and a slowly turning ring.
  const goal = GOALS[0]!;
  const top = 0.15 + PLATFORM.height;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.7, roughness: 0.35 }),
  );
  pole.position.set(goal.x, top + 1.55, goal.z);
  pole.castShadow = true;
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffc233, emissiveIntensity: 1.6, roughness: 0.4 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 14), orbMat);
  orb.position.set(goal.x, top + 3.3, goal.z);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffc233, emissiveIntensity: 1.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.04, 8, 40), ringMat);
  ring.position.set(goal.x, top + 3.3, goal.z);
  // A painted target on the paving, so it reads as "drive here".
  const target = new THREE.Mesh(
    new THREE.RingGeometry(goal.r - 0.2, goal.r, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.55 }),
  );
  target.position.set(goal.x, top + 0.02, goal.z);
  group.add(pole, orb, ring, target);

  const idle = new THREE.Color(0xffc233);
  const win = new THREE.Color(0x6dff8a);
  return {
    group,
    update(time, celebrate) {
      const c = idle.clone().lerp(win, celebrate);
      orbMat.emissive.copy(c);
      ringMat.emissive.copy(c);
      orbMat.emissiveIntensity = 1.4 + Math.sin(time * 3) * 0.5 + celebrate * 1.5;
      ringMat.emissiveIntensity = 1.1 + celebrate;
      orb.position.y = top + 3.3 + Math.sin(time * 2) * 0.08;
      ring.rotation.set(Math.PI / 2 + Math.sin(time * 1.3) * 0.25, time * 1.2, 0);
      ring.position.y = orb.position.y;
      (target.material as THREE.MeshBasicMaterial).color.copy(c);
    },
  };
}
