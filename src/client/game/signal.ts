import type * as THREE from 'three';
import type { CarRole } from '../../shared/cars';
import type { DriveInput } from '../../shared/driving';
import {
  BASE, BASE_RANGE, InputDelay, RELAY_RANGE, SignalLink, failsafeInput, lagFor, linkedRelays, qualityOf, signalAt, type LinkQuality, type RelayNode,
} from '../../shared/signal';
import type { Terrain } from '../../shared/terrain';
import type { GameAudio } from '../audio/game-audio';
import type { RemoteCar } from '../net/remote-car';
import type { Vehicle } from '../physics/vehicle';
import { SignalRings, type RingSpec } from '../render/signal-rings';

export interface SignalDeps {
  scene: THREE.Scene;
  terrain: Terrain;
  remotes: () => Map<string, RemoteCar>;
  role: () => CarRole;
  selfId: () => string;
  vehicle: () => Vehicle;
  audio: GameAudio;
}

/**
 * The signal web in play. When the room's radio range is on, your car's signal comes from the base
 * station and from any Relay truck connected to it. Weak signal delays your steering and throttle;
 * no signal cuts the throttle (braking, with steering and reversing still working so you can back
 * out). Worked out here from positions that are already shared: no messages, no server.
 */
export class SignalController {
  private on = false;
  private readonly link = new SignalLink();
  private readonly delay = new InputDelay<DriveInput>();
  private readonly rings: SignalRings;
  private simTime = 0;
  /** 0 to 1 at your car right now. */
  strength = 1;
  /** Seconds your inputs are delayed. */
  lag = 0;

  constructor(private readonly d: SignalDeps) {
    this.rings = new SignalRings(d.scene, d.terrain, BASE);
  }

  get enabled(): boolean {
    return this.on;
  }

  get cutOff(): boolean {
    return this.link.cutOff;
  }

  get quality(): LinkQuality {
    return qualityOf(this.strength, this.link.cutOff);
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.reset();
  }

  /** Forget the input history and the cut-off state, e.g. after a teleport or when switched off. */
  reset(): void {
    this.link.reset();
    this.delay.reset();
    this.strength = 1;
    this.lag = 0;
  }

  /** Relay trucks we can see: other players' (drawn positions) and ours, if we are one. */
  private relays(): RelayNode[] {
    const out: RelayNode[] = [];
    for (const [id, rc] of this.d.remotes()) if (rc.role === 'relay' && rc.visible) out.push({ id, x: rc.position.x, z: rc.position.z });
    if (this.d.role() === 'relay') {
      const t = this.d.vehicle().body.translation();
      out.push({ id: this.d.selfId(), x: t.x, z: t.z });
    }
    return out;
  }

  /** Call once per frame. */
  update(dt: number): void {
    if (!this.on) {
      this.rings.update([], false, dt);
      return;
    }
    const me = this.d.vehicle().body.translation();
    const relays = this.relays();
    const selfId = this.d.role() === 'relay' ? this.d.selfId() : null;
    this.strength = signalAt({ x: me.x, z: me.z }, relays, selfId);
    const wasCut = this.link.cutOff;
    const cut = this.link.update(this.strength);
    this.lag = lagFor(this.strength);
    if (cut && !wasCut) this.d.audio.signal('lost');
    else if (!cut && wasCut) this.d.audio.signal('back');

    const linked = new Set(linkedRelays(relays).map((r) => r.id));
    const specs: RingSpec[] = [{ key: 'base', x: BASE.x, z: BASE.z, range: BASE_RANGE, color: 0x39d0ff, dim: false }];
    for (const r of relays) specs.push({ key: `relay-${r.id}`, x: r.x, z: r.z, range: RELAY_RANGE, color: 0x6dff9e, dim: !linked.has(r.id) });
    this.rings.update(specs, true, dt);
  }

  /** Call every physics step with what the player is holding. Returns what the car actually gets. */
  filter(input: DriveInput, dt: number, forwardSpeed: number): DriveInput {
    if (!this.on) return input;
    this.simTime += dt;
    this.delay.push(this.simTime, input);
    const late = this.delay.at(this.simTime, this.lag) ?? input;
    return this.link.cutOff ? failsafeInput(late, forwardSpeed) : late;
  }
}
