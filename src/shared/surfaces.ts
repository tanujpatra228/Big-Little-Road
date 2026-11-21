export enum Surface {
  Grass = 0,
  Patio = 1,
  Sand = 2,
  Mud = 3,
  Rock = 4,
  Water = 5,
}

export const SURFACE_NAMES: Record<Surface, string> = {
  [Surface.Grass]: 'Grass',
  [Surface.Patio]: 'Patio',
  [Surface.Sand]: 'Sand',
  [Surface.Mud]: 'Mud',
  [Surface.Rock]: 'Rock',
  [Surface.Water]: 'Water',
};

export interface SurfaceProps {
  /** Multiplies tyre friction. */
  grip: number;
  /** Extra speed-proportional drag, 1/s. Higher means more sluggish. */
  drag: number;
  /** Multiplies engine force. */
  traction: number;
}

export const SURFACE_PROPS: Record<Surface, SurfaceProps> = {
  [Surface.Grass]: { grip: 0.85, drag: 0.15, traction: 0.95 },
  [Surface.Patio]: { grip: 1.1, drag: 0.02, traction: 1.0 },
  [Surface.Sand]: { grip: 0.7, drag: 0.55, traction: 0.8 },
  [Surface.Mud]: { grip: 0.6, drag: 1.1, traction: 0.65 },
  [Surface.Rock]: { grip: 1.0, drag: 0.1, traction: 0.9 },
  [Surface.Water]: { grip: 0.45, drag: 1.5, traction: 0.5 },
};

/** Per-car multipliers on top of the surface table. 1 means no change. */
export type SurfaceAffinity = Partial<Record<Surface, Partial<SurfaceProps>>>;

export function resolveSurface(surface: Surface, affinity: SurfaceAffinity): SurfaceProps {
  const base = SURFACE_PROPS[surface];
  const mod = affinity[surface] ?? {};
  return {
    grip: base.grip * (mod.grip ?? 1),
    drag: base.drag * (mod.drag ?? 1),
    // No surface may ever give more drive than a clean paved one.
    traction: Math.min(1, base.traction * (mod.traction ?? 1)),
  };
}

/**
 * Fraction of a car's top speed it can reach on each surface. Grass and patio are 1.
 * Rule: no off-road surface may let a car go faster than it goes on grass.
 */
export type SurfaceSpeed = Record<Surface, number>;
