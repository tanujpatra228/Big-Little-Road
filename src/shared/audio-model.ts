import type { CarRole } from './cars';
import { Surface } from './surfaces';

/**
 * The rules for what the game sounds like. Pure numbers in, numbers out, so they are testable.
 * The Web Audio graph in the client only turns these into sound.
 */

export interface EngineProfile {
  /** Fundamental at idle and at redline, in Hz. */
  minHz: number;
  maxHz: number;
  /** Overall engine loudness. */
  gain: number;
  /** Waveshaper drive: more is growlier. */
  drive: number;
  /** Low-pass cutoff at idle and wide open, in Hz. */
  cutLow: number;
  cutHigh: number;
  /** Level of the octave-up square and the sub triangle layers. */
  upper: number;
  sub: number;
  /** Idle lumpiness: pitch wobble as a fraction of the fundamental. */
  wobble: number;
  /** Two-note horn, in Hz. */
  horn: [number, number];
}

export const ENGINE_PROFILES: Record<CarRole, EngineProfile> = {
  // Light buggy: high, buzzy two-stroke.
  scout: { minHz: 78, maxHz: 360, gain: 0.2, drive: 2.2, cutLow: 1500, cutHigh: 5200, upper: 0.42, sub: 0.2, wobble: 0.006, horn: [740, 932] },
  // Heavy crawler: low diesel rumble.
  hauler: { minHz: 38, maxHz: 150, gain: 0.3, drive: 3.4, cutLow: 420, cutHigh: 1700, upper: 0.18, sub: 0.7, wobble: 0.022, horn: [196, 247] },
  // Trophy truck: mid V8 growl.
  relay: { minHz: 52, maxHz: 250, gain: 0.25, drive: 3.0, cutLow: 800, cutHigh: 3300, upper: 0.3, sub: 0.5, wobble: 0.012, horn: [392, 494] },
};

export const IDLE_RPM = 0.16;
const GEARS = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Engine speed (0..1) the engine wants, from road speed through a virtual 3-speed gearbox. */
export function targetRpm(speed: number, topSpeed: number, throttle: number): number {
  const frac = clamp(Math.abs(speed) / topSpeed, 0, 1);
  const gear = Math.min(GEARS - 1, Math.floor(frac * GEARS));
  const within = clamp(frac * GEARS - gear, 0, 1);
  // Each gear after the first starts partway up the range, which gives the shift dip.
  const low = gear === 0 ? 0 : 0.35;
  const geared = IDLE_RPM + (1 - IDLE_RPM) * (low + (1 - low) * within);
  // Standing on the throttle at low speed (wheelspin, stuck) revs the engine anyway.
  // It fades out as road speed builds, so a normal launch climbs smoothly instead of dipping.
  const revving = IDLE_RPM + Math.max(0, throttle) * 0.55 * clamp(1 - frac * 6, 0, 1);
  return clamp(Math.max(frac < 0.015 ? IDLE_RPM : geared, revving), IDLE_RPM, 1);
}

/** Engine speed rises faster than it falls, like a real flywheel. */
export function stepRpm(rpm: number, target: number, dt: number): number {
  const rate = target > rpm ? 5 : 3;
  const d = target - rpm;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : rpm + Math.sign(d) * step;
}

export function engineHz(profile: EngineProfile, rpm: number): number {
  return profile.minHz * Math.pow(profile.maxHz / profile.minHz, clamp(rpm, 0, 1));
}

export interface TyreSound {
  /** Filtered-noise level and band. */
  gain: number;
  hz: number;
  q: number;
  /** Granular crunch level and how fast the grains play (playback rate). */
  crackle: number;
  crackleRate: number;
}

interface SurfaceAudio {
  gain: number;
  hz: number;
  q: number;
  crackle: number;
}

const SURFACE_AUDIO: Record<Surface, SurfaceAudio> = {
  [Surface.Patio]: { gain: 0.05, hz: 600, q: 0.5, crackle: 0 }, // smooth hum
  [Surface.Grass]: { gain: 0.1, hz: 1100, q: 0.6, crackle: 0 }, // soft swish
  [Surface.Sand]: { gain: 0.13, hz: 2600, q: 0.5, crackle: 0.02 }, // hiss
  [Surface.Mud]: { gain: 0.17, hz: 380, q: 0.8, crackle: 0 }, // squelch
  [Surface.Rock]: { gain: 0.09, hz: 800, q: 0.7, crackle: 0.12 }, // clatter
  [Surface.Gravel]: { gain: 0.12, hz: 1700, q: 0.6, crackle: 0.24 }, // crunch
  [Surface.Water]: { gain: 0.26, hz: 1500, q: 0.4, crackle: 0 }, // splash
};

/** Noise from the tyres, from the surface, road speed, and how many wheels touch the ground. */
export function tyreSound(surface: Surface, speed: number, groundedWheels: number): TyreSound {
  const s = SURFACE_AUDIO[surface];
  const v = clamp(Math.abs(speed) / 10, 0, 1.4);
  const touching = clamp(groundedWheels / 4, 0, 1);
  const level = Math.pow(v, 0.9) * touching;
  return {
    gain: s.gain * level,
    hz: s.hz * (0.8 + 0.4 * clamp(v, 0, 1)),
    q: s.q,
    crackle: s.crackle * level,
    crackleRate: 0.5 + clamp(Math.abs(speed) / 12, 0, 2),
  };
}

export function windGain(speed: number): number {
  return Math.pow(clamp(Math.abs(speed) / 24, 0, 1), 1.6) * 0.18;
}

/**
 * Tyre squeal under hard braking or in a slide (`slide` is 0 to 1, how deep), loud on hard ground, silent
 * on soft. A slide is a little louder than braking, and rises with how far sideways the car is.
 */
export function squealGain(braking: boolean, speed: number, surface: Surface, slide = 0): number {
  if ((!braking && slide <= 0.05) || Math.abs(speed) < 5) return 0;
  const bite = SURFACE_HARDNESS[surface] > 0.5 ? 0.06 : surface === Surface.Grass ? 0.015 : 0;
  const braked = braking ? 1 : 0;
  return bite * clamp(Math.abs(speed) / 14, 0, 1) * Math.max(braked, 0.5 + 0.7 * clamp(slide, 0, 1));
}

/** 0 is soft (water, mud, sand), 1 is hard (rock). Shapes impact sounds. */
export const SURFACE_HARDNESS: Record<Surface, number> = {
  [Surface.Water]: 0.05,
  [Surface.Mud]: 0.1,
  [Surface.Sand]: 0.15,
  [Surface.Grass]: 0.3,
  [Surface.Gravel]: 0.6,
  [Surface.Patio]: 0.85,
  [Surface.Rock]: 0.95,
};

export interface Impact {
  /** 0..1, how hard. */
  intensity: number;
  /** 0 is a side or head-on crash, 1 is a landing. */
  vertical: number;
}

const IMPACT_THRESHOLD = 1.3; // m/s of velocity change in one 60 Hz step

/**
 * Turns the velocity change over one physics step into an impact. Engines and brakes change speed
 * by well under 0.3 m/s per step, so anything past the threshold is a collision or a landing.
 */
export function impactFromDelta(dx: number, dy: number, dz: number): Impact | null {
  const mag = Math.hypot(dx, dy, dz);
  if (mag < IMPACT_THRESHOLD) return null;
  return { intensity: clamp((mag - IMPACT_THRESHOLD) / 7, 0.05, 1), vertical: clamp(Math.abs(dy) / mag, 0, 1) };
}

export interface ImpactVoice {
  gain: number;
  /** Low thump, falling from thumpHz to thumpHz / 2.7. */
  thumpHz: number;
  /** Noise burst band and decay. */
  noiseHz: number;
  decay: number;
  /** Bright metallic knock for hard surfaces. */
  clank: number;
}

export function impactVoice(impact: Impact, surface: Surface): ImpactVoice {
  const hard = SURFACE_HARDNESS[surface];
  return {
    gain: 0.12 + impact.intensity * 0.55,
    thumpHz: 90 - impact.intensity * 28 + impact.vertical * 10,
    noiseHz: 300 + hard * 2600 * (1 - impact.vertical * 0.3),
    decay: 0.07 + impact.intensity * 0.22 * (1.2 - hard * 0.5),
    clank: hard * (1 - impact.vertical * 0.5) * impact.intensity,
  };
}

/** Slider positions, 0 to 1. Master plus three groups of sounds. */
export interface Volumes {
  master: number;
  /** Car engines. */
  engine: number;
  /** Tyres, wind, impacts, horns, clicks. */
  effects: number;
  /** Birds, crickets, breeze. */
  ambience: number;
}

/** Defaults reproduce the loudness before there were sliders: master gain 0.75, everything else 1. */
export const DEFAULT_VOLUMES: Volumes = { master: 0.87, engine: 1, effects: 1, ambience: 1 };

/** Sliders feel natural when the gain follows a curve: squaring puts the middle of the slider near -12 dB. */
export function volumeToGain(v: number): number {
  const c = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return c * c;
}

/** Reads saved volumes leniently: bad JSON, missing or out-of-range values fall back to defaults. */
export function parseVolumes(raw: string | null | undefined): Volumes {
  const out = { ...DEFAULT_VOLUMES };
  if (!raw) return out;
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof Volumes, unknown>>;
    for (const k of Object.keys(out) as Array<keyof Volumes>) {
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 0, 1);
    }
  } catch {
    /* corrupt storage: defaults */
  }
  return out;
}
