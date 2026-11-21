import type * as THREE from 'three';
import { CARS, type CarRole } from '../../shared/cars';
import { PROPS, PropsLogic, fromInfo, type PropInfo } from '../../shared/net/props';
import type { Terrain } from '../../shared/terrain';
import { nearestFreeEnd, ropeAccel, ropeLeash, ropeTension, snapRamp } from '../../shared/tether';
import type { GameAudio } from '../audio/game-audio';
import type { RemoteCar } from '../net/remote-car';
import type { RoomClient } from '../net/room-client';
import type { PhysicsWorld } from '../physics/world';
import type { Vehicle } from '../physics/vehicle';
import { PlankProp, type CarInfo } from './plank';

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
  /** Where the hard limit measures from, refreshed every frame while both cars hold the plank. */
  private leash: { offX: number; offZ: number; px: number; pz: number; pvx: number; pvz: number } | null = null;

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

  private carOf(id: string): CarInfo | null {
    if (id === this.selfId()) {
      const v = this.d.vehicle();
      const t = v.body.translation();
      const q = v.body.rotation();
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
      return { x: t.x, y: t.y, z: t.z, yaw, halfLength: CARS[this.d.role()].half.z };
    }
    const r = this.d.remotes().get(id);
    if (!r || !r.visible) return null;
    return { x: r.position.x, y: r.position.y, z: r.position.z, yaw: r.yaw, halfLength: CARS[r.role].half.z };
  }

  /** The F key: hook the nearest free end, or let go (leaning the plank on the wall if it is near). */
  toggle(): void {
    const me = this.selfId();
    const st = this.plank.state;
    const mine = st.holders.indexOf(me);
    const net = this.d.net();

    if (mine >= 0) {
      const shown = this.plank.displayPose;
      const p = snapRamp(shown) ?? shown;
      if (this.online()) net.sendDetach(p.x, p.z, p.yaw);
      else {
        this.local.detach(me, p);
        this.plank.setState(this.local.props.get(PLANK_ID)!);
        this.d.audio.hook();
      }
      return;
    }
    const car = this.carOf(me);
    if (!car) return;
    const end = nearestFreeEnd(this.plank.displayPose, st.holders, car, car.halfLength);
    if (end === null) return;
    if (this.online()) net.sendAttach(PLANK_ID, end);
    else {
      this.local.attach(me, PLANK_ID, end);
      this.plank.setState(this.local.props.get(PLANK_ID)!);
      this.d.audio.hook();
    }
  }

  /** The T key: send the plank back to where it started, if nobody is holding it. */
  requestReset(): void {
    if (this.online()) this.d.net().sendReset(PLANK_ID);
    else if (this.local.reset(PLANK_ID)) this.plank.setState(this.local.props.get(PLANK_ID)!);
  }

  /**
   * The plank does not stretch. Call after every physics step: the velocity change for our own car
   * that keeps the two hitches within the plank's reach. Zero unless both cars hold it.
   */
  constrain(dt: number): { x: number; z: number } {
    const l = this.leash;
    if (!l) return { x: 0, z: 0 };
    const body = this.d.vehicle().body;
    const t = body.translation();
    const v = body.linvel();
    return ropeLeash({ x: t.x + l.offX, z: t.z + l.offZ }, { x: l.px, z: l.pz }, { x: v.x, z: v.z }, { x: l.pvx, z: l.pvz }, dt);
  }

  /** Call once per frame before the physics steps. Returns the pull on our car, in m/s^2. */
  update(): { x: number; z: number } {
    this.plank.update((id) => this.carOf(id));
    const me = this.selfId();
    const [h0, h1] = this.plank.state.holders;
    const holding = h0 === me || h1 === me;

    let pull = { x: 0, z: 0 };
    this.leash = null;
    let tension = 0;
    if (h0 && h1 && holding) {
      const partnerId = h0 === me ? h1 : h0;
      const a = this.plank.hitchOf(me);
      const b = this.plank.hitchOf(partnerId);
      if (a && b) {
        const body = this.d.vehicle().body;
        const v = body.linvel();
        pull = ropeAccel({ x: a.x, z: a.z }, { x: b.x, z: b.z }, { x: v.x, z: v.z });

        // The partner is drawn a little in the past and the link adds delay. Look ahead by that much
        // along their velocity, so the hard limit holds against where they are, not where they were.
        const r = this.online() ? this.d.remotes().get(partnerId) : undefined;
        const vp = r ? r.velocity : { x: 0, z: 0 };
        const lead = r ? 0.1 + this.d.net().rttMs / 2000 : 0;
        const t = body.translation();
        this.leash = { offX: a.x - t.x, offZ: a.z - t.z, px: b.x + vp.x * lead, pz: b.z + vp.z * lead, pvx: vp.x, pvz: vp.z };
        tension = ropeTension(Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    this.plank.setTension(tension);

    // Near the platform wall, show where the plank would lean if let go now.
    const snap = holding ? snapRamp(this.plank.displayPose) : null;
    this.plank.setGhost(snap);

    if (holding) {
      this.prompt = snap
        ? 'F: let go to lean the plank on the wall as a ramp'
        : h0 && h1
          ? 'F: let go. Drive in convoy and keep the rope slack.'
          : 'F: let go. A second car can hook the other end.';
    } else {
      const car = this.carOf(me);
      this.prompt = car && nearestFreeEnd(this.plank.displayPose, this.plank.state.holders, car, car.halfLength) !== null ? 'F: hook the plank' : null;
    }
    return pull;
  }
}
