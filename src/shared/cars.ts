import { Surface, type SurfaceAffinity, type SurfaceSpeed } from './surfaces';

export type CarRole = 'scout' | 'hauler' | 'relay';

export interface CarSpec {
  role: CarRole;
  label: string;
  color: number;
  /** Chassis half extents, world units. */
  half: { x: number; y: number; z: number };
  mass: number;
  /** How far below the chassis centre the centre of mass sits. Lower = harder to flip. */
  comDrop: number;
  wheelRadius: number;
  wheelBaseHalf: number; // z offset of axles
  trackHalf: number; // x offset of wheels
  suspensionRest: number;
  suspensionTravel: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  maxSuspensionForce: number;
  frictionSlip: number;
  sideFriction: number;
  /** Total engine force over all wheels at standstill. */
  enginePower: number;
  topSpeed: number;
  reverseTopSpeed: number;
  /** Total brake force. Tyre grip is high, so too much pitches the car over: keep stops above 1 s. */
  brakeForce: number;
  maxSteer: number; // radians
  /** Speed at which steering authority has halved. */
  steerFalloffSpeed: number;
  angularDamping: number;
  surfaces: SurfaceAffinity;
  /** Top-speed fraction per surface. This is the main "how much does this terrain slow me" knob. */
  surfaceSpeed: SurfaceSpeed;
  /** Hop height on flat ground, metres. Never above MAX_JUMP_APEX (tested). */
  jumpApex: number;
  /** Seconds after landing before the next hop. */
  jumpCooldown: number;
  /** Engine force multiplier at full boost. */
  nitroForce: number;
  /** Top-speed multiplier at full boost. Never above MAX_NITRO_TOP (tested). */
  nitroTop: number;
}

export const CARS: Record<CarRole, CarSpec> = {
  scout: {
    role: 'scout',
    label: 'Scout (desert buggy)',
    color: 0xf2a33a,
    half: { x: 0.45, y: 0.22, z: 0.85 },
    mass: 6,
    comDrop: 0.25,
    wheelRadius: 0.32,
    wheelBaseHalf: 0.62,
    trackHalf: 0.55,
    suspensionRest: 0.32,
    suspensionTravel: 0.33,
    suspensionStiffness: 14,
    suspensionCompression: 2.6,
    suspensionRelaxation: 3.4,
    maxSuspensionForce: 900,
    frictionSlip: 2.6,
    sideFriction: 1.0,
    enginePower: 62,
    topSpeed: 24,
    reverseTopSpeed: 8,
    brakeForce: 1.8,
    maxSteer: 0.52,
    steerFalloffSpeed: 14,
    angularDamping: 1.2,
    surfaces: {
      [Surface.Sand]: { grip: 1.0, drag: 0.1 }, // light: skims the top
      [Surface.Mud]: { grip: 0.8, drag: 1.4 }, // sinks
      [Surface.Water]: { drag: 1.3 },
      [Surface.Rock]: { grip: 0.85 },
      [Surface.Gravel]: { grip: 1.0, drag: 0.4 }, // skims the stones
    },
    surfaceSpeed: {
      [Surface.Grass]: 1,
      [Surface.Patio]: 1,
      [Surface.Sand]: 0.8,
      [Surface.Mud]: 1,
      [Surface.Rock]: 1,
      [Surface.Gravel]: 0.9,
      [Surface.Water]: 1,
    },
    jumpApex: 0.55,
    jumpCooldown: 0.8,
    nitroForce: 1.6,
    nitroTop: 1.35,
  },
  hauler: {
    role: 'hauler',
    label: 'Hauler (rock crawler)',
    color: 0x4d8fd1,
    half: { x: 0.55, y: 0.28, z: 0.95 },
    mass: 14,
    comDrop: 0.3,
    wheelRadius: 0.4,
    wheelBaseHalf: 0.66,
    trackHalf: 0.68,
    suspensionRest: 0.36,
    suspensionTravel: 0.35,
    suspensionStiffness: 18,
    suspensionCompression: 3.2,
    suspensionRelaxation: 4.0,
    maxSuspensionForce: 2600,
    frictionSlip: 3.4,
    sideFriction: 1.2,
    enginePower: 190,
    topSpeed: 12,
    reverseTopSpeed: 6,
    brakeForce: 3.3,
    maxSteer: 0.45,
    steerFalloffSpeed: 9,
    angularDamping: 2.0,
    surfaces: {
      [Surface.Sand]: { grip: 0.9, drag: 1.0 }, // heavy: digs in
      [Surface.Mud]: { grip: 1.35, drag: 0.55, traction: 1.35 },
      [Surface.Rock]: { grip: 1.3 },
      [Surface.Water]: { drag: 0.8, traction: 1.3 },
    },
    surfaceSpeed: {
      [Surface.Grass]: 1,
      [Surface.Patio]: 1,
      [Surface.Sand]: 0.4,
      [Surface.Mud]: 1,
      [Surface.Rock]: 1,
      [Surface.Gravel]: 0.6,
      [Surface.Water]: 1,
    },
    jumpApex: 0.35,
    jumpCooldown: 1.2,
    nitroForce: 1.9,
    nitroTop: 1.12,
  },
  relay: {
    role: 'relay',
    label: 'Relay (trophy truck)',
    color: 0x5fbf6a,
    half: { x: 0.52, y: 0.26, z: 0.95 },
    mass: 10,
    comDrop: 0.18, // tall mast, so a higher centre of mass
    wheelRadius: 0.36,
    wheelBaseHalf: 0.68,
    trackHalf: 0.62,
    suspensionRest: 0.42,
    suspensionTravel: 0.32,
    suspensionStiffness: 12,
    suspensionCompression: 2.4,
    suspensionRelaxation: 3.2,
    maxSuspensionForce: 1600,
    frictionSlip: 2.8,
    sideFriction: 0.95,
    enginePower: 120,
    topSpeed: 20,
    reverseTopSpeed: 7,
    brakeForce: 2.4,
    maxSteer: 0.48,
    steerFalloffSpeed: 12,
    angularDamping: 1.6,
    surfaces: {
      [Surface.Rock]: { grip: 0.8 },
      [Surface.Sand]: { grip: 1.0 },
    },
    surfaceSpeed: {
      [Surface.Grass]: 1,
      [Surface.Patio]: 1,
      [Surface.Sand]: 0.5,
      [Surface.Mud]: 1,
      [Surface.Rock]: 1,
      [Surface.Gravel]: 0.65,
      [Surface.Water]: 1,
    },
    jumpApex: 0.5,
    jumpCooldown: 1.2,
    nitroForce: 1.65,
    nitroTop: 1.25,
  },
};

/** Fraction of rest length the suspension is compressed to under the car's own weight, for visuals. */
export const REST_SAG = 0.85;

/** Wheel centre height in chassis space at rest. Visuals and the showcase both use this. */
export function wheelRestY(spec: CarSpec): number {
  return -spec.half.y * 0.4 - spec.suspensionRest * REST_SAG;
}

/**
 * Highest the wheel centre can rise above its rest position: the bump stop. Fender flares and
 * wheel arches are placed above this, so a compressed wheel can never clip through bodywork.
 */
export function maxWheelRise(spec: CarSpec): number {
  return spec.suspensionTravel - (1 - REST_SAG) * spec.suspensionRest;
}

export const CAR_ORDER: CarRole[] = ['scout', 'hauler', 'relay'];

export function cloneSpec(spec: CarSpec): CarSpec {
  return JSON.parse(JSON.stringify(spec)) as CarSpec;
}
