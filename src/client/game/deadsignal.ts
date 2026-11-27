import { DEAD_CAR, REVIVE_REACH } from '../../shared/goals';
import { DeadCar } from '../render/dead-car';
import type * as THREE from 'three';
import type { Terrain } from '../../shared/terrain';

/**
 * Dead Signal on this player's screen: the lost car appears while the mission runs (it is the only
 * place that mission uses), and it comes back to life when the Relay charges it from close by.
 * The charge itself is the room's: it tells everyone where the Relay was when it did.
 */
export class DeadSignalController {
  private readonly car: DeadCar;
  private revived = false;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    this.car = new DeadCar(scene, terrain, DEAD_CAR);
  }

  /** For tests and the HUD: is the lost car on show. */
  get carVisible(): boolean {
    return this.car.visible;
  }

  /** Whether the Relay has charged it this run. The mission's last flag. */
  get isRevived(): boolean {
    return this.revived;
  }

  /** Call every frame with whether Dead Signal is the mission in play (running or just finished). */
  update(active: boolean, finished: boolean, dt: number): void {
    this.car.show(active);
    if (!active) this.revived = false;
    this.car.setAlive(this.revived || finished);
    this.car.update(dt);
  }

  /** The room told us a Relay charged the battery at (x, z). */
  onCharge(x: number, z: number, active: boolean): boolean {
    if (!active) return false;
    const near = Math.hypot(x - DEAD_CAR.x, z - DEAD_CAR.z) <= REVIVE_REACH;
    if (near) this.revived = true;
    return near;
  }
}
