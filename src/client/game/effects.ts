import * as THREE from 'three';
import { CARS, type CarRole } from '../../shared/cars';
import {
  FX, MARK_SLIP, ParticlePool, SkidMarks, SkidTrail, burstFx, fxCapacity, wheelFx,
} from '../../shared/particles';
import type { Surface } from '../../shared/surfaces';
import type { Terrain } from '../../shared/terrain';
import type { RemoteCar } from '../net/remote-car';
import type { Vehicle } from '../physics/vehicle';
import { ParticleLayer, SkidMarkMesh } from '../render/particles';

export interface EffectsDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  terrain: Terrain;
  vehicle: () => Vehicle;
  role: () => CarRole;
  remotes: () => Map<string, RemoteCar>;
  /** Height of the drawing surface in pixels, for sizing the points. */
  viewHeight: () => number;
}

const SOFT_CAPACITY = 600;
const GLOW_CAPACITY = 160;
const MARK_CAPACITY = 500;

/** Everything a wheel throws up, drawn for your own car and everyone else's. Local only: nothing is sent. */
export class EffectsController {
  private readonly soft = new ParticlePool(SOFT_CAPACITY, 11);
  private readonly glow = new ParticlePool(GLOW_CAPACITY, 29);
  private readonly softLayer: ParticleLayer;
  private readonly glowLayer: ParticleLayer;
  private readonly marks = new SkidMarks(MARK_CAPACITY);
  private readonly markMesh: SkidMarkMesh;
  private readonly trails = new Map<string, [SkidTrail, SkidTrail]>();
  private readonly owed = new Map<string, number>();
  private on = true;
  private scaleNow = 1;

  constructor(private readonly d: EffectsDeps) {
    this.softLayer = new ParticleLayer(d.scene, SOFT_CAPACITY, false);
    this.glowLayer = new ParticleLayer(d.scene, GLOW_CAPACITY, true);
    this.markMesh = new SkidMarkMesh(d.scene, d.terrain, MARK_CAPACITY);
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.clear();
  }

  /** How much of the full effect a quality rung allows (0 to 1). Marks are dropped on the lowest rungs. */
  setScale(scale: number): void {
    this.scaleNow = scale;
    this.soft.setLimit(fxCapacity(scale, SOFT_CAPACITY));
    this.glow.setLimit(fxCapacity(scale, GLOW_CAPACITY));
    this.marks.setCapacity(scale >= 0.5 ? MARK_CAPACITY : 0);
  }

  /** A short readout for the F3 panel. */
  stats(): string {
    return `${this.soft.count + this.glow.count} particles, ${this.marks.count} tyre marks`;
  }

  clear(): void {
    this.soft.clear();
    this.glow.clear();
    this.marks.clear();
    this.trails.clear();
    this.softLayer.update(this.soft, 1);
    this.glowLayer.update(this.glow, 1);
    this.markMesh.update(this.marks);
  }

  /** A burst where a car hopped or landed. `kick` is 0 to 1. */
  burst(x: number, z: number, surface: Surface, kick: number, vx = 0, vz = 0): void {
    if (!this.on) return;
    const b = burstFx(surface, kick);
    this.emit(b.kind, x, z, vx, vz, b.count, b.scale);
  }

  private emit(kind: keyof typeof FX, x: number, z: number, vx: number, vz: number, count: number, scale: number): void {
    const pool = FX[kind].additive ? this.glow : this.soft;
    pool.emit(kind, x, this.d.terrain.heightAt(x, z) + 0.12, z, vx, vz, count, scale);
  }

  private due(key: string, perSecond: number, dt: number): number {
    const v = (this.owed.get(key) ?? 0) + perSecond * dt;
    const n = Math.floor(v);
    this.owed.set(key, v - n);
    return n;
  }

  /** One car's rear wheels: the dust, the smoke and the tyre marks, and the nitro trail from the exhaust. */
  private car(key: string, role: CarRole, x: number, z: number, yaw: number, vx: number, vz: number, y: number, grounded: boolean, braking: boolean, throttle: number, boosting: boolean, dt: number): void {
    const spec = CARS[role];
    const speed = Math.hypot(vx, vz);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = fz; // right of the nose
    const rz = -fx;
    const lateral = Math.abs(vx * rx + vz * rz);
    const slip = speed > 3 ? Math.min(1, lateral / speed) : 0;
    const trail = this.trails.get(key) ?? ([new SkidTrail(), new SkidTrail()] as [SkidTrail, SkidTrail]);
    this.trails.set(key, trail);
    const slipping = slip > MARK_SLIP || (braking && speed > 8);
    [-1, 1].forEach((side, w) => {
      const wx = x + rx * side * spec.trackHalf - fx * spec.wheelBaseHalf;
      const wz = z + rz * side * spec.trackHalf - fz * spec.wheelBaseHalf;
      const surface = this.d.terrain.surfaceAt(wx, wz);
      for (const e of wheelFx({ surface, speed, slip, braking, throttle, grounded })) {
        const n = this.due(`${key}:${w}:${e.kind}`, e.rate, dt);
        if (n > 0) this.emit(e.kind, wx, wz, vx, vz, n, e.scale);
      }
      const mark = trail[w]!.step(wx, wz, grounded && slipping, surface);
      if (mark) this.marks.add(mark);
    });
    if (boosting) {
      const n = this.due(`${key}:boost`, 110, dt);
      if (n > 0) this.glow.emit('boost', x - fx * (spec.half.z + 0.1), y + 0.1, z - fz * (spec.half.z + 0.1), -fx * 6, -fz * 6, n);
    }
  }

  update(dt: number): void {
    if (!this.on) return;
    const v = this.d.vehicle();
    const t = v.body.translation();
    const q = v.body.rotation();
    const lin = v.body.linvel();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    this.car('self', this.d.role(), t.x, t.z, yaw, lin.x, lin.z, t.y, v.grounded >= 2, v.braking, Math.abs(v.throttleNow), v.nitro.active, dt);
    for (const [id, rc] of this.d.remotes()) {
      if (!rc.visible) continue;
      this.car(id, rc.role, rc.position.x, rc.position.z, rc.yaw, rc.velocity.x, rc.velocity.z, rc.position.y, true, false, 1, rc.nitroActive, dt);
    }
    this.marks.update(dt);
    const ground = (x: number, z: number): number => this.d.terrain.heightAt(x, z) + 0.05;
    this.soft.update(dt, ground);
    this.glow.update(dt);
    const fov = (this.d.camera.fov * Math.PI) / 180;
    const scale = this.d.viewHeight() / (2 * Math.tan(fov / 2));
    this.softLayer.update(this.soft, scale);
    this.glowLayer.update(this.glow, scale);
    this.markMesh.update(this.marks);
  }

  get particleCount(): number {
    return this.soft.count + this.glow.count;
  }
}
