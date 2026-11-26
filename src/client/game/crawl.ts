import * as THREE from 'three';
import type { Boulder } from '../../shared/boulders';
import type { CarRole } from '../../shared/cars';
import { CHECKPOINT_EVERY, CrawlRun, buildCrawlLine, inField, type CrawlLine } from '../../shared/crawl';
import { ROCK, type Terrain } from '../../shared/terrain';
import type { Vehicle } from '../physics/vehicle';

export interface CrawlDeps {
  scene: THREE.Scene;
  terrain: Terrain;
  boulders: readonly Boulder[];
  role: () => CarRole;
  vehicle: () => Vehicle;
  /** Whether Rock Crawl is running, and which stage it is on (0 = meet at the gate, 1 = cross). */
  mission: () => { active: boolean; stage: number };
  toast: (title: string, sub?: string, ms?: number) => void;
  /** A car was sent back: it costs the "no resets" star. */
  onLost: () => void;
}

/** How thick the dust is for a car that cannot see the line (FogExp2 density). About 25 m of sight. */
const DUST_DENSITY = 0.12;

/**
 * Rock Crawl on this player's screen.
 *  - The Scout sees the safe line, glowing on the ground ("UV"). Nobody else does.
 *  - Everyone else is in a dust cloud while in the rock field: they see a few car lengths, so the
 *    Scout has to talk them through (pings), and their low range gear is what makes it doable.
 *  - Any car that leaves the line for a moment is put back at its last checkpoint.
 * Nothing here is sent over the network except the existing mission reset report.
 */
export class CrawlController {
  private line: CrawlLine | null = null;
  private run: CrawlRun | null = null;
  private marks: THREE.Group | null = null;
  private arrowMat: THREE.MeshBasicMaterial | null = null;
  private baseDensity: number | null = null;
  private dust = 0;
  private clock = 0;
  /** Words for the bottom of the screen while the car is off the line. */
  warn: string | null = null;

  constructor(private readonly d: CrawlDeps) {}

  /** The line, once worked out (it is built the first time a Rock Crawl starts). */
  get crawlLine(): CrawlLine | null {
    return this.line;
  }

  update(dt: number): void {
    this.clock += dt;
    const m = this.d.mission();
    const fog = this.d.scene.fog instanceof THREE.FogExp2 ? this.d.scene.fog : null;
    if (fog && this.baseDensity === null) this.baseDensity = fog.density;

    if (!m.active) {
      this.run = null;
      this.warn = null;
      if (this.marks) this.marks.visible = false;
      this.fade(fog, 0, dt);
      return;
    }
    if (!this.line) this.build();
    const scout = this.d.role() === 'scout';
    const t = this.d.vehicle().body.translation();
    if (this.marks) {
      this.marks.visible = scout;
      if (this.arrowMat) this.arrowMat.opacity = 0.55 + 0.3 * Math.sin(this.clock * 3.2);
    }
    // Dust for everyone who is not the Scout, while they are in (or just outside) the field.
    const near = Math.hypot(t.x - ROCK.x, t.z - ROCK.z) < ROCK.r + 6;
    this.fade(fog, !scout && near ? 1 : 0, dt);

    // The line only counts from the second stage: the first is just getting to the gate.
    if (m.stage < 1 || !this.line) {
      this.run = null;
      this.warn = null;
      return;
    }
    this.run ??= new CrawlRun(this.line);
    const res = this.run.update(t.x, t.z, dt);
    if (res.kind === 'lost') {
      this.d.vehicle().placeAt(res.to.x, res.to.z, res.to.yaw);
      this.d.toast('Off the line', 'Back to the last checkpoint. Follow the Scout.', 3000);
      this.d.onLost();
      this.warn = null;
      return;
    }
    this.warn = inField(t.x, t.z) && this.run.offSeconds > 0.25 ? 'Off the line! Get back on it' : null;
  }

  private fade(fog: THREE.FogExp2 | null, target: number, dt: number): void {
    if (!fog || this.baseDensity === null) return;
    const rate = target > this.dust ? 0.8 : 0.5;
    this.dust = target > this.dust ? Math.min(target, this.dust + rate * dt) : Math.max(target, this.dust - rate * dt);
    fog.density = this.baseDensity + (DUST_DENSITY - this.baseDensity) * this.dust;
  }

  private build(): void {
    this.line = buildCrawlLine(this.d.boulders);
    const line = this.line;
    const group = new THREE.Group();
    group.visible = false;

    // A flat arrow on the ground at every mark, pointing along the line.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9);
    shape.lineTo(0.55, -0.5);
    shape.lineTo(0, -0.1);
    shape.lineTo(-0.55, -0.5);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xa57bff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const arrows = new THREE.InstancedMesh(geo, this.arrowMat, line.points.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    line.points.forEach((p, i) => {
      const next = line.points[Math.min(i + 1, line.points.length - 1)]!;
      const prev = line.points[Math.max(i - 1, 0)]!;
      const yaw = Math.atan2(next.x - prev.x, next.z - prev.z);
      q.setFromAxisAngle(up, yaw);
      m.compose(new THREE.Vector3(p.x, this.d.terrain.heightAt(p.x, p.z) + 0.12, p.z), q, new THREE.Vector3(1, 1, 1));
      arrows.setMatrixAt(i, m);
    });
    arrows.frustumCulled = false;
    group.add(arrows);

    // A tall beam at every checkpoint, so the Scout can point at the next one.
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.1, 5, 8, 1, true).translate(0, 2.5, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x7ef0d8, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    for (let i = CHECKPOINT_EVERY; i < line.points.length; i += CHECKPOINT_EVERY) {
      const p = line.points[i]!;
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(p.x, this.d.terrain.heightAt(p.x, p.z), p.z);
      group.add(beam);
    }
    this.marks = group;
    this.d.scene.add(group);
  }
}
