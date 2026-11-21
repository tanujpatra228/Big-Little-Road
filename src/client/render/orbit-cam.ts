import * as THREE from 'three';
import {
  DIST_DEFAULT, PITCH_DEFAULT, STICK_SPEED, aboveGround, clampOrbit, dragOrbit, orbitFromChase, orbitOffset, zoomOrbit, type OrbitState,
} from '../../shared/orbit';
import type { Terrain } from '../../shared/terrain';
import type { Pose } from '../physics/vehicle';

/**
 * A camera that circles the car. Drag to look around, wheel to zoom, right stick on a gamepad.
 * It does not turn with the car, so you can watch the plank, a teammate or the road ahead while
 * driving. Math lives in shared/orbit.ts.
 */
/** The orbit looks at a point this far above the car's centre. */
const TARGET_LIFT = 0.7;

export class OrbitCam {
  state: OrbitState = { yaw: 0, pitch: PITCH_DEFAULT, distance: DIST_DEFAULT };
  private enabled = false;
  private dragId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private readonly target = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: Terrain,
    private readonly dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled || (e.pointerType === 'mouse' && e.button > 2)) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = 'grabbing';
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.enabled || e.pointerId !== this.dragId) return;
      this.state = dragOrbit(this.state, e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.dragId) return;
      this.dragId = null;
      if (this.enabled) dom.style.cursor = 'grab';
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.state = zoomOrbit(this.state, e.deltaY);
      },
      { passive: false },
    );
    dom.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
  }

  get active(): boolean {
    return this.enabled;
  }

  /** Switch on, starting from where the chase camera was so the view does not jump. */
  enter(chaseYaw: number, chaseDistance: number, chaseHeight: number): void {
    // The chase camera sits `chaseHeight` above the car; the orbit measures from the lifted look-at point.
    this.state = orbitFromChase(chaseYaw, chaseDistance, chaseHeight - TARGET_LIFT);
    this.enabled = true;
    this.dom.style.cursor = 'grab';
  }

  leave(): void {
    this.enabled = false;
    this.dragId = null;
    this.dom.style.cursor = '';
  }

  /** Call once per frame while active. `stick` is the gamepad right stick, each axis -1..1. */
  update(pose: Pose, dt: number, boost: number, stick: { x: number; y: number }): void {
    if (stick.x !== 0 || stick.y !== 0) {
      this.state = clampOrbit({ ...this.state, yaw: this.state.yaw - stick.x * STICK_SPEED * dt, pitch: this.state.pitch + stick.y * STICK_SPEED * dt });
    }
    this.target.set(pose.x, pose.y + TARGET_LIFT, pose.z);
    const o = orbitOffset(this.state);
    this.pos.set(this.target.x + o.x, this.target.y + o.y, this.target.z + o.z);
    this.pos.y = aboveGround(this.pos.y, this.terrain.heightAt(this.pos.x, this.pos.z));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
    const fov = 62 + boost * 6;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
