import type * as THREE from 'three';
import type { CarRole } from '../../shared/cars';
import type { DriveInput } from '../../shared/driving';
import {
  BASE, BASE_RANGE, BEACON_RANGE, InputDelay, RELAY_RANGE, SignalLink, failsafeInput, lagFor, linkedRelays, qualityOf, signalAt, type LinkQuality, type RelayNode,
} from '../../shared/signal';
import type { Terrain } from '../../shared/terrain';
import type { GameAudio } from '../audio/game-audio';
import type { RemoteCar } from '../net/remote-car';
import type { Vehicle } from '../physics/vehicle';
import { SignalRings, type RingSpec } from '../render/signal-rings';
import type { Placed } from '../../shared/toolbox';

export interface SignalDeps {
  scene: THREE.Scene;
  terrain: Terrain;
  remotes: () => Map<string, RemoteCar>;
  role: () => CarRole;
  selfId: () => string;
  vehicle: () => Vehicle;
  audio: GameAudio;
  /** Beacons standing in the yard: each is a small radio source once it is linked. */
  beacons: () => readonly Placed[];
  nameOf: (id: string) => string;
}

/** How a teammate's radio link looks from here. */
export interface TeamLink {
  id: string;
  name: string;
  strength: number;
  lost: boolean;
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

  /** Everything that carries the signal: Relay trucks (others' drawn positions, and ours) and standing beacons. */
  private relays(): RelayNode[] {
    const out: RelayNode[] = [];
    for (const b of this.d.beacons()) if (b.kind === 'beacon') out.push({ id: `beacon:${b.id}`, x: b.x, z: b.z, range: BEACON_RANGE });
    for (const [id, rc] of this.d.remotes()) if (rc.role === 'relay' && rc.visible) out.push({ id, x: rc.position.x, z: rc.position.z });
    if (this.d.role() === 'relay') {
      const t = this.d.vehicle().body.translation();
      out.push({ id: this.d.selfId(), x: t.x, z: t.z });
    }
    return out;
  }

  /** The signal at any point of the yard, as the current Relays and beacons would give it (0 when the rule is off is NOT applied: the caller decides). */
  strengthAt(x: number, z: number): number {
    return signalAt({ x, z }, this.relays(), null);
  }

  /** Each teammate's link, worked out from their drawn position. Empty when the radio rule is off. */
  team(): TeamLink[] {
    if (!this.on) return [];
    const relays = this.relays();
    const out: TeamLink[] = [];
    for (const [id, rc] of this.d.remotes()) {
      if (!rc.visible) continue;
      const s = signalAt({ x: rc.position.x, z: rc.position.z }, relays, rc.role === 'relay' ? id : null);
      out.push({ id, name: this.d.nameOf(id), strength: s, lost: s <= 0 });
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
    for (const r of relays) {
      const isBeacon = r.id.startsWith('beacon:');
      specs.push({ key: `relay-${r.id}`, x: r.x, z: r.z, range: r.range ?? RELAY_RANGE, color: isBeacon ? 0x4fe3c1 : 0x6dff9e, dim: !linked.has(r.id) });
    }
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
