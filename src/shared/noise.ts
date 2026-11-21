import { mulberry32 } from './rng';

/** Seeded 2D value noise with fbm. Output roughly in [-1, 1]. */
export function createNoise(seed: number): (x: number, z: number, octaves?: number) => number {
  const rand = mulberry32(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rand() * 2 - 1;

  const at = (ix: number, iz: number): number =>
    table[((iz & (size - 1)) * size + (ix & (size - 1)))] ?? 0;
  const fade = (t: number): number => t * t * (3 - 2 * t);

  const base = (x: number, z: number): number => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fz = fade(z - iz);
    const a = at(ix, iz);
    const b = at(ix + 1, iz);
    const c = at(ix, iz + 1);
    const d = at(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };

  return (x, z, octaves = 3) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += base(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}
