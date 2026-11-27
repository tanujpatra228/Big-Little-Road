/**
 * The team battery: one power meter for everyone in a room. Boosting (nitro) spends it, and so will
 * the winch later, so every boost is something the others do not get. It refills slowly.
 *
 * The room keeps the books from its own clock, and nothing ticks: the level is only worked out when
 * somebody starts or stops boosting. Everyone gets a snapshot ("level, how many are draining it,
 * when it starts refilling") and extrapolates it locally, so no meter is ever streamed. Pure, so it
 * is tested without sockets.
 */

/** Seconds of boost in a full battery for ONE car. Two cars boosting together empty it in half that. */
export const CAPACITY_SECONDS = 10;
/** Fraction of the battery one boosting car uses per second. */
export const DRAIN_PER_BOOSTER = 1 / CAPACITY_SECONDS;
/** Fraction regained per second once nobody is boosting. */
export const REGEN_PER_SECOND = 1 / 30;
/** Seconds after the last boost stops before it starts refilling. */
export const REGEN_DELAY = 1.5;
/** After running dry, boosting stays off until the battery is back to this. */
export const RESTART_LEVEL = 0.15;

/** What one Relay charge adds to the team battery (a fraction of full). */
export const CHARGE_AMOUNT = 0.3;
/** Seconds before the same Relay can charge again. */
export const CHARGE_COOLDOWN = 20;

/** The state of the battery at one instant. */
export interface BatterySnapshot {
  /** 0 empty to 1 full. */
  level: number;
  /** Cars boosting right now (0 while locked out). */
  boosters: number;
  /** Seconds until it starts refilling. Only counts while nobody is boosting. */
  regenIn: number;
  /** Ran dry and has not recovered enough yet: nobody can boost. */
  locked: boolean;
}

export const FULL: Readonly<BatterySnapshot> = { level: 1, boosters: 0, regenIn: 0, locked: false };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Moves a snapshot forward by `dt` seconds, exactly, across any change inside it: the battery running
 * dry part way through, the refill delay ending, the lockout lifting.
 */
export function advance(s: BatterySnapshot, dt: number): BatterySnapshot {
  if (!(dt > 0)) return { ...s };
  let { level, boosters, regenIn, locked } = s;
  let left = dt;

  if (boosters > 0 && !locked) {
    const rate = boosters * DRAIN_PER_BOOSTER;
    const toEmpty = level / rate;
    if (left < toEmpty) return { level: clamp01(level - rate * left), boosters, regenIn, locked };
    // It runs dry inside this step: everyone is cut off at that moment.
    left -= toEmpty;
    level = 0;
    boosters = 0;
    locked = true;
    regenIn = REGEN_DELAY;
  }

  // Nobody is boosting: wait out the delay, then refill.
  const wait = Math.min(left, regenIn);
  regenIn -= wait;
  left -= wait;
  if (regenIn <= 0 && left > 0) level = clamp01(level + REGEN_PER_SECOND * left);
  if (locked && level >= RESTART_LEVEL) locked = false;
  return { level, boosters: 0, regenIn: Math.max(0, regenIn), locked };
}

/**
 * The room's side: who is boosting and when. Give it the time with every call.
 * It never sets a timer; whoever calls it wakes it up.
 */
export class SharedBattery {
  private snap: BatterySnapshot = { ...FULL };
  private at = 0;
  private readonly wanting = new Set<string>();

  /** Brings the books up to `now`. If the battery ran dry, everyone is cut off. */
  private update(now: number): void {
    const dt = Math.max(0, (now - this.at) / 1000);
    this.at = now;
    if (dt === 0) return;
    this.snap = advance(this.snap, dt);
    if (this.snap.boosters === 0) this.wanting.clear(); // ran dry (or nobody was): the list is empty now
  }

  /** A car starts boosting. Returns false (and changes nothing) if the battery is locked out. */
  start(id: string, now: number): boolean {
    this.update(now);
    if (this.snap.locked || this.snap.level <= 0) return false;
    this.wanting.add(id);
    this.snap = { ...this.snap, boosters: this.wanting.size };
    return true;
  }

  /** A car stops boosting (or leaves). */
  stop(id: string, now: number): void {
    this.update(now);
    if (!this.wanting.delete(id)) return;
    this.snap = { ...this.snap, boosters: this.wanting.size, regenIn: this.wanting.size === 0 ? REGEN_DELAY : this.snap.regenIn };
  }

  /**
   * A Relay's charge: adds `amount` at once. A battery that ran dry is unlocked if this brings it back
   * above the restart level. Returns the battery after it.
   */
  topUp(amount: number, now: number): BatterySnapshot {
    this.update(now);
    const level = clamp01(this.snap.level + amount);
    const locked = this.snap.locked && level < RESTART_LEVEL;
    this.snap = { ...this.snap, level, locked };
    return { ...this.snap };
  }

  /** The battery as it is at `now`. */
  snapshot(now: number): BatterySnapshot {
    this.update(now);
    return { ...this.snap };
  }

  isBoosting(id: string): boolean {
    return this.wanting.has(id);
  }
}

/** Wire form: whole numbers, so frames stay tiny. Level is in thousandths, the delay in milliseconds. */
export interface BatteryInfo {
  level: number;
  boosters: number;
  regenIn: number;
  locked: boolean;
}

export function toBatteryInfo(s: BatterySnapshot): BatteryInfo {
  return { level: Math.round(s.level * 1000), boosters: s.boosters, regenIn: Math.round(s.regenIn * 1000), locked: s.locked };
}

export function fromBatteryInfo(i: BatteryInfo): BatterySnapshot {
  return { level: clamp01(i.level / 1000), boosters: Math.max(0, Math.floor(i.boosters)), regenIn: Math.max(0, i.regenIn / 1000), locked: !!i.locked };
}

/**
 * A player's view of the battery: the last snapshot from the room, extrapolated by the time since it
 * arrived. When this player starts or stops boosting themselves, the view changes at once instead of
 * waiting a round trip for the room to confirm, and the room's next snapshot replaces the guess.
 */
export class BatteryView {
  private snap: BatterySnapshot | null = null;
  private since = 0;

  /** True once the room has told us anything. */
  get known(): boolean {
    return this.snap !== null;
  }

  /** The room sent a snapshot; `now` is the local clock in ms when it arrived. */
  receive(info: BatteryInfo, now: number): void {
    this.snap = fromBatteryInfo(info);
    this.since = now;
  }

  /** Forget everything (left the room). */
  reset(): void {
    this.snap = null;
  }

  /** The battery right now. */
  at(now: number): BatterySnapshot {
    if (!this.snap) return { ...FULL };
    return advance(this.snap, Math.max(0, (now - this.since) / 1000));
  }

  /** We started (+1) or stopped (-1) boosting: apply it to our own view straight away. */
  selfBoost(on: boolean, now: number): void {
    if (!this.snap) return;
    const cur = this.at(now);
    this.since = now;
    const boosters = Math.max(0, cur.boosters + (on ? 1 : -1));
    this.snap = { ...cur, boosters, regenIn: boosters === 0 ? REGEN_DELAY : cur.regenIn };
  }
}
