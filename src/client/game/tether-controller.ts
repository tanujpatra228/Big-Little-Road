import type * as THREE from 'three';
import { CARS, type CarRole } from '../../shared/cars';
import { PROPS, PropsLogic, fromInfo, type PropInfo } from '../../shared/net/props';
import type { Terrain } from '../../shared/terrain';
import { hitchPoint, nearestFreeEnd, ropeAccel } from '../../shared/tether';
import type { GameAudio } from '../audio/game-audio';
import type { RemoteCar } from '../net/remote-car';
import type { RoomClient } from '../net/room-client';
import type { PhysicsWorld } from '../physics/world';
import type { Vehicle } from '../physics/vehicle';
import { PlankProp, type HitchInfo } from './plank';

const PLANK_ID = PROPS[0]!.id;

export interface TetherDeps {
  scene: THREE.Scene;
  pw: PhysicsWorld;
  terrain: Terrain;
  net: () => RoomClient;
  vehicle: () => Vehicle;
  role: () => CarRole;
  remotes: () => Map<string, RemoteCar>;
  audio: GameAudio;
}

/**
 * Glue between input, the room and the plank. Hooking and letting go go through the room when we
 * are in one, and are applied directly when playing alone. The rope pull on our own car is computed
 * here every frame from our hitch and the partner's smoothed hitch.
 */
export class TetherController {
  readonly plank: PlankProp;
  /** Text for the on-screen prompt, or null. */
  prompt: string | null = null;
  private local = new PropsLogic();

  constructor(private readonly d: TetherDeps) {
    this.plank = new PlankProp(d.scene, d.pw, d.terrain, this.local.props.get(PLANK_ID)!);
  }

  private online(): boolean {
    return this.d.net().status === 'on';
  }

  private selfId(): string {
    return this.online() ? this.d.net().selfId : 'me';
  }

  onWelcome(props: PropInfo[]): void {
    const p = props.find((x) => x.id === PLANK_ID);
    if (p) this.plank.setState(fromInfo(p));
  }

  onProp(info: PropInfo): void {
    if (info.id !== PLANK_ID) return;
    const before = this.plank.state.holders.join();
    this.plank.setState(fromInfo(info));
    if (before !== this.plank.state.holders.join()) this.d.audio.hook();
  }

  /** Back to playing alone: a fresh local plank. */
  onOffline(): void {
    this.local = new PropsLogic();
    this.plank.setState(this.local.props.get(PLANK_ID)!);
  }

  private hitchOf(id: string): HitchInfo | null {
    if (id === this.selfId()) {
      const v = this.d.vehicle();
      const t = v.body.translation();
      const q = v.body.rotation();
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
      const h = hitchPoint({ x: t.x, z: t.z }, yaw, CARS[this.d.role()].half.z);
      return { x: h.x, y: t.y - 0.1, z: h.z };
    }
    const r = this.d.remotes().get(id);
    if (!r || !r.mesh.group.visible) return null;
    const h = hitchPoint({ x: r.position.x, z: r.position.z }, r.yaw, CARS[r.role].half.z);
    return { x: h.x, y: r.position.y - 0.1, z: h.z };
  }

  /** The F key: hook the nearest free end, or let go. */
  toggle(): void {
    const me = this.selfId();
    const st = this.plank.state;
    const mine = st.holders.indexOf(me);
    const net = this.d.net();

    if (mine >= 0) {
      const p = this.plank.displayPose;
      if (this.online()) net.sendDetach(p.x, p.z, p.yaw);
      else {
        this.local.detach(me, p);
        this.plank.setState(this.local.props.get(PLANK_ID)!);
        this.d.audio.hook();
      }
      return;
    }
    const hitch = this.hitchOf(me);
    if (!hitch) return;
    const end = nearestFreeEnd(this.plank.displayPose, st.holders, hitch);
    if (end === null) return;
    if (this.online()) net.sendAttach(PLANK_ID, end);
    else {
      this.local.attach(me, PLANK_ID, end);
      this.plank.setState(this.local.props.get(PLANK_ID)!);
      this.d.audio.hook();
    }
  }

  /** Call once per frame before the physics steps. Returns the pull on our car, in m/s^2. */
  update(): { x: number; z: number } {
    this.plank.update((id) => this.hitchOf(id));
    const me = this.selfId();
    const [h0, h1] = this.plank.state.holders;
    const holding = h0 === me || h1 === me;

    let pull = { x: 0, z: 0 };
    if (h0 && h1 && holding) {
      const a = this.hitchOf(me);
      const b = this.hitchOf(h0 === me ? h1 : h0);
      if (a && b) {
        const v = this.d.vehicle().body.linvel();
        pull = ropeAccel({ x: a.x, z: a.z }, { x: b.x, z: b.z }, { x: v.x, z: v.z });
      }
    }

    if (holding) this.prompt = h0 && h1 ? 'F: let go. Keep the rope slack and drive together.' : 'F: let go. A second car can hook the other end.';
    else {
      const hitch = this.hitchOf(me);
      this.prompt = hitch && nearestFreeEnd(this.plank.displayPose, this.plank.state.holders, hitch) !== null ? 'F: hook the plank' : null;
    }
    return pull;
  }
}
