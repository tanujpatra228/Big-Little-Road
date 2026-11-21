import { mulberry32 } from './rng';
import { ROCK, SPAWN, type Terrain } from './terrain';
import { Surface } from './surfaces';

/** One sphere of a boulder, in world space. */
export interface BoulderPart {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Random tumble for the visual mesh. */
  rx: number;
  ry: number;
  rz: number;
}

export type BoulderKind = 'boulder' | 'rubble';

export interface Boulder {
  kind: BoulderKind;
  /** Footprint centre. */
  x: number;
  z: number;
  /** Radius of the circle that contains every part. Used for spacing. */
  radius: number;
  /** Jointed spheres that make one lumpy, irregular rock. */
  parts: BoulderPart[];
}

/**
 * Two kinds of rock, and nothing in between:
 *  - boulders: tall lumpy walls (top at least 1.1 above ground). Steer around them or get thrown.
 *  - rubble: low heaps (top at most 0.3). Drive over them, they jostle you.
 * A mid-height dome (roughly belly height) is what high-centres a car, so those never spawn.
 *
 * Deterministic per terrain seed, so physics and every player agree.
 */
export function generateBoulders(terrain: Terrain, boulderCount = 24, rubbleCount = 30): Boulder[] {
  const rand = mulberry32(terrain.seed ^ 0x51ed270b);
  const out: Boulder[] = [];
  const reach = ROCK.r - 6;

  const spot = (): { x: number; z: number } | null => {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * reach;
    const x = ROCK.x + Math.cos(a) * d;
    const z = ROCK.z + Math.sin(a) * d;
    if (terrain.surfaceAt(x, z) !== Surface.Rock) return null;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 20) return null;
    return { x, z };
  };

  const fits = (x: number, z: number, radius: number, kind: BoulderKind): boolean => {
    for (const o of out) {
      // Boulders keep a gap wider than the widest car (Hauler, about 1.6). Rubble can sit close.
      const gap = kind === 'boulder' && o.kind === 'boulder' ? 2.3 : 0.5;
      if (Math.hypot(o.x - x, o.z - z) < o.radius + radius + gap) return false;
    }
    return true;
  };

  const tumble = (): { rx: number; ry: number; rz: number } => ({ rx: rand() * 3, ry: rand() * 3, rz: rand() * 3 });

  const makeBoulder = (x: number, z: number): Boulder => {
    const R = 0.85 + rand() * 0.65;
    const parts: BoulderPart[] = [{ x, y: terrain.heightAt(x, z) + R * 0.35, z, r: R, ...tumble() }];
    let radius = R;
    const lumps = 2 + Math.floor(rand() * 3); // 2 to 4 satellites
    const start = rand() * Math.PI * 2;
    for (let i = 0; i < lumps; i++) {
      const ang = start + (i / lumps) * Math.PI * 2 + (rand() - 0.5) * 1.1;
      const dist = R * (0.65 + rand() * 0.55);
      const r = R * (0.4 + rand() * 0.4);
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      parts.push({ x: px, y: terrain.heightAt(px, pz) + r * (0.15 + rand() * 0.45), z: pz, r, ...tumble() });
      radius = Math.max(radius, dist + r);
    }
    return { kind: 'boulder', x, z, radius, parts };
  };

  const makeRubble = (x: number, z: number): Boulder => {
    const parts: BoulderPart[] = [];
    let radius = 0.3;
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = rand() * 0.8;
      const r = 0.14 + rand() * 0.14;
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      // Top sits 0.8 r above the ground, so the whole heap stays under 0.3.
      parts.push({ x: px, y: terrain.heightAt(px, pz) - r * 0.2, z: pz, r, ...tumble() });
      radius = Math.max(radius, dist + r);
    }
    return { kind: 'rubble', x, z, radius, parts };
  };

  for (const [kind, target] of [['boulder', boulderCount], ['rubble', rubbleCount]] as const) {
    let placed = 0;
    for (let attempt = 0; attempt < target * 60 && placed < target; attempt++) {
      const s = spot();
      if (!s) continue;
      const b = kind === 'boulder' ? makeBoulder(s.x, s.z) : makeRubble(s.x, s.z);
      if (!fits(s.x, s.z, b.radius, kind)) continue;
      out.push(b);
      placed++;
    }
  }
  return out;
}
