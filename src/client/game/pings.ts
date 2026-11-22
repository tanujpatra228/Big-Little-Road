import * as THREE from 'three';
import type { PingKind } from '../../shared/net/protocol';
import {
  PING_STYLES, PingBoard, PingLimiter, QUICK_PING, WHEEL_OPEN_MS, aimPoint,
} from '../../shared/ping';
import type { Terrain } from '../../shared/terrain';
import type { GameAudio } from '../audio/game-audio';
import type { RemoteCar } from '../net/remote-car';
import type { RoomClient } from '../net/room-client';
import type { Vehicle } from '../physics/vehicle';
import { PingMarkers, type MarkerView } from '../render/ping-markers';
import { PingWheel } from '../ui/ping-wheel';

export interface PingDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  terrain: Terrain;
  net: () => RoomClient;
  selfId: () => string;
  vehicle: () => Vehicle;
  remotes: () => Map<string, RemoteCar>;
  nameOf: (id: string) => string;
  audio: GameAudio;
  /** Key state: true while held, and true once per press (even if it was released again before the frame). */
  isDown: (code: string) => boolean;
  wasPressed: (code: string) => boolean;
}

const KEY = 'KeyQ';

/**
 * The ping wheel in play. Hold Q to open the wheel and flick the mouse to a slice; release to send.
 * A quick tap sends Go here at once. Go, Wait and Look land where the crosshair at the centre of the
 * screen meets the ground; Tow me and Low battery stick to your car. Your own ping shows for you too,
 * and everyone else sees it with a soft blip.
 */
export class PingController {
  readonly board = new PingBoard();
  private readonly wheel = new PingWheel();
  private readonly markers: PingMarkers;
  private readonly limiter = new PingLimiter();
  private heldSince: number | null = null;
  private readonly dir = new THREE.Vector3();

  constructor(private readonly d: PingDeps) {
    this.markers = new PingMarkers(d.scene, d.camera);
  }

  /** Where the crosshair at the centre of the screen meets the ground. */
  private aim(): { x: number; z: number } {
    const cam = this.d.camera;
    cam.getWorldDirection(this.dir);
    return aimPoint(cam.position, this.dir, (x, z) => this.d.terrain.heightAt(x, z));
  }

  /** Sends a ping now, from us. Returns false if it was too soon after the last one. */
  send(kind: PingKind, now: number): boolean {
    if (!this.limiter.allow(now)) return false;
    const style = PING_STYLES[kind];
    const car = this.d.vehicle().body.translation();
    const at = style.anchored ? { x: car.x, z: car.z } : this.aim();
    this.board.add(this.d.selfId(), kind, at.x, at.z, now);
    this.d.net().sendPing(kind, at.x, at.z);
    this.d.audio.ping(kind, 0.7, 0);
    return true;
  }

  /** Someone else's ping arrived. */
  onRemote(id: string, kind: PingKind, x: number, z: number, now: number): void {
    this.board.add(id, kind, x, z, now);
    const rc = this.d.remotes().get(id);
    const at = rc?.position ?? new THREE.Vector3(x, 0, z);
    const to = at.clone().sub(this.d.camera.position);
    const dist = to.length();
    const fwd = new THREE.Vector3();
    this.d.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, this.d.camera.up).normalize();
    this.d.audio.ping(kind, 1 / (1 + dist / 40), dist > 0.01 ? to.normalize().dot(right) : 0);
  }

  /** A player left: their ping goes with them. */
  onLeave(id: string): void {
    this.board.remove(id);
  }

  /** Call every frame. `now` is performance.now(), `dt` seconds. */
  update(now: number, dt: number): void {
    const pressed = this.d.wasPressed(KEY);
    const down = this.d.isDown(KEY);
    if (pressed && this.heldSince === null) this.heldSince = now;

    if (this.heldSince !== null) {
      if (down) {
        if (!this.wheel.isOpen && now - this.heldSince >= WHEEL_OPEN_MS) this.wheel.open();
        if (this.wheel.isOpen) this.wheel.pick();
      } else {
        // Released. A wheel that was opened sends the picked slice (or cancels in the dead zone);
        // a short press is a tap.
        if (this.wheel.isOpen) {
          const picked = this.wheel.pick();
          this.wheel.close();
          if (picked) this.send(picked, now);
        } else {
          this.send(QUICK_PING, now);
        }
        this.heldSince = null;
      }
    }

    const car = this.d.vehicle().body.translation();
    const views: MarkerView[] = [];
    for (const m of this.board.active(now)) {
      const style = PING_STYLES[m.kind];
      let x = m.x;
      let z = m.z;
      let y: number;
      if (style.anchored) {
        // Follows the sender's car.
        if (m.sender === this.d.selfId()) {
          x = car.x;
          z = car.z;
          y = car.y - 0.4;
        } else {
          const rc = this.d.remotes().get(m.sender);
          if (rc?.visible) {
            x = rc.position.x;
            z = rc.position.z;
            y = rc.position.y - 0.4;
          } else y = this.d.terrain.heightAt(x, z);
        }
      } else y = this.d.terrain.heightAt(x, z);
      views.push({ key: m.sender, kind: m.kind, name: m.sender === this.d.selfId() ? 'You' : this.d.nameOf(m.sender), x, y, z, ageMs: now - m.at, distance: Math.hypot(x - car.x, z - car.z) });
    }
    this.markers.update(views, dt);
  }
}
