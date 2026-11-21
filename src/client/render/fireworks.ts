import * as THREE from 'three';
import { glow } from './glow';

const PER_BURST = 46;
const LIFE = 1.6;
const PALETTE = [0xff6b6b, 0xffd23f, 0x6bd6ff, 0x7dff9a, 0xc08bff, 0xffffff];

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  age: number;
  delay: number;
  origin: THREE.Vector3;
  launched: boolean;
}

/** A few fireworks over a spot. Cheap: a handful of additive point clouds that fade and are removed. */
export class Fireworks {
  private bursts: Burst[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  get active(): boolean {
    return this.bursts.length > 0;
  }

  /** Five staggered bursts above `centre`. */
  launch(centre: THREE.Vector3): void {
    for (let i = 0; i < 5; i++) {
      const colour = new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]!);
      const pos = new Float32Array(PER_BURST * 3);
      const col = new Float32Array(PER_BURST * 3);
      for (let k = 0; k < PER_BURST; k++) {
        const tint = 0.75 + Math.random() * 0.25;
        col.set([colour.r * tint, colour.g * tint, colour.b * tint], k * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size: 0.42, map: glow(), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
      );
      points.frustumCulled = false;
      points.visible = false;
      this.scene.add(points);
      this.bursts.push({
        points,
        vel: new Float32Array(PER_BURST * 3),
        age: 0,
        delay: i * 0.28 + Math.random() * 0.15,
        origin: new THREE.Vector3(centre.x + (Math.random() - 0.5) * 6, centre.y + 3 + Math.random() * 3, centre.z + (Math.random() - 0.5) * 6),
        launched: false,
      });
    }
  }

  update(dt: number): void {
    for (const b of this.bursts) {
      b.age += dt;
      if (b.age < b.delay) continue;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (!b.launched) {
        b.launched = true;
        b.points.visible = true;
        for (let k = 0; k < PER_BURST; k++) {
          // Random direction on a sphere, so it blooms into a ball.
          const u = Math.random() * 2 - 1;
          const a = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const speed = 3.5 + Math.random() * 4;
          b.vel.set([s * Math.cos(a) * speed, u * speed, s * Math.sin(a) * speed], k * 3);
          pos.setXYZ(k, b.origin.x, b.origin.y, b.origin.z);
        }
      }
      const t = b.age - b.delay;
      for (let k = 0; k < PER_BURST; k++) {
        b.vel[k * 3 + 1]! -= 4.5 * dt;
        const drag = Math.exp(-1.4 * dt);
        b.vel[k * 3]! *= drag;
        b.vel[k * 3 + 1]! *= drag;
        b.vel[k * 3 + 2]! *= drag;
        pos.setXYZ(k, pos.getX(k) + b.vel[k * 3]! * dt, pos.getY(k) + b.vel[k * 3 + 1]! * dt, pos.getZ(k) + b.vel[k * 3 + 2]! * dt);
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t / LIFE);
    }
    this.bursts = this.bursts.filter((b) => {
      if (b.age - b.delay < LIFE) return true;
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
      return false;
    });
  }
}
