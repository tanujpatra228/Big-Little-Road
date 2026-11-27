import { describe, expect, it } from 'vitest';
import {
  FX, MARK_LIFE, MARK_STEP, MAX_RATE, MIN_FX_SPEED, ParticlePool, SkidMarks, SkidTrail, burstFx, fxCapacity, markStrength, markable, wheelFx, type FxKind,
} from '../src/shared/particles';
import { Surface } from '../src/shared/surfaces';

const base = { surface: Surface.Grass, speed: 10, slip: 0, braking: false, throttle: 1, grounded: true };
const kinds = (o: Partial<typeof base>) => wheelFx({ ...base, ...o }).map((e) => e.kind);

describe('what a wheel throws up', () => {
  it('each surface has its own: dust, sand, mud, splash, gravel', () => {
    expect(kinds({ surface: Surface.Grass })).toEqual(['dust']);
    expect(kinds({ surface: Surface.Sand })).toEqual(['sand']);
    expect(kinds({ surface: Surface.Mud })).toEqual(['mud']);
    expect(kinds({ surface: Surface.Water })).toEqual(['splash']);
    expect(kinds({ surface: Surface.Gravel })).toEqual(['gravel']);
    expect(kinds({ surface: Surface.Patio })).toEqual(['dust']);
    expect(kinds({ surface: Surface.Rock })).toEqual(['dust']);
  });

  it('nothing when slow, parked or in the air', () => {
    expect(wheelFx({ ...base, speed: MIN_FX_SPEED - 0.1 })).toEqual([]);
    expect(wheelFx({ ...base, speed: 0 })).toEqual([]);
    expect(wheelFx({ ...base, grounded: false })).toEqual([]);
  });

  it('more speed, more spray; never more than the cap', () => {
    const rate = (speed: number) => wheelFx({ ...base, speed })[0]!.rate;
    expect(rate(8)).toBeGreaterThan(rate(4));
    expect(rate(24)).toBeLessThanOrEqual(MAX_RATE);
    for (const s of [Surface.Grass, Surface.Sand, Surface.Mud, Surface.Water, Surface.Gravel, Surface.Patio, Surface.Rock]) {
      for (const e of wheelFx({ ...base, surface: s, speed: 60, slip: 1, braking: true })) expect(e.rate).toBeLessThanOrEqual(MAX_RATE);
    }
  });

  it('the throttle matters a little: coasting throws less than flat out', () => {
    expect(wheelFx({ ...base, throttle: 0 })[0]!.rate).toBeLessThan(wheelFx({ ...base, throttle: 1 })[0]!.rate);
  });

  it('paving throws up less than grass and sand more', () => {
    const r = (s: Surface) => wheelFx({ ...base, surface: s })[0]!.rate;
    expect(r(Surface.Patio)).toBeLessThan(r(Surface.Grass));
    expect(r(Surface.Sand)).toBeGreaterThan(r(Surface.Grass));
  });

  it('a slide on hard ground makes tyre smoke, and braking hard does too, but not on sand, mud or water', () => {
    expect(kinds({ surface: Surface.Patio, slip: 0.7 })).toContain('smoke');
    expect(kinds({ surface: Surface.Grass, braking: true, speed: 14 })).toContain('smoke');
    expect(kinds({ surface: Surface.Patio, slip: 0.1 })).not.toContain('smoke');
    for (const s of [Surface.Sand, Surface.Mud, Surface.Water]) expect(kinds({ surface: s, slip: 0.9, braking: true, speed: 14 })).not.toContain('smoke');
  });

  it('a hop or a landing is a burst that grows with how hard', () => {
    expect(burstFx(Surface.Grass, 1).count).toBeGreaterThan(burstFx(Surface.Grass, 0).count);
    expect(burstFx(Surface.Sand, 0.5).kind).toBe('sand');
    expect(burstFx(Surface.Grass, 5).count).toBe(burstFx(Surface.Grass, 1).count);
  });

  it('every kind has sane numbers', () => {
    for (const [k, s] of Object.entries(FX)) {
      expect(s.life, k).toBeGreaterThan(0.2);
      expect(s.life, k).toBeLessThan(2);
      expect(s.alpha, k).toBeGreaterThan(0);
      expect(s.alpha, k).toBeLessThanOrEqual(1);
      for (const c of s.color) expect(c).toBeGreaterThanOrEqual(0);
    }
    expect(FX.boost.additive).toBe(true);
  });
});

describe('the particle pool', () => {
  it('births, ages and retires particles, and compacts the live ones', () => {
    const p = new ParticlePool(100, 7);
    p.emit('dust', 0, 0, 0, 0, 0, 10);
    expect(p.count).toBe(10);
    p.update(0.3);
    expect(p.count).toBe(10);
    p.emit('dust', 5, 0, 5, 0, 0, 5);
    p.update(0.7); // the first ten are past their life (about 0.85 s +/- 25%) or nearly; the new five are young
    expect(p.count).toBeLessThanOrEqual(15);
    expect(p.count).toBeGreaterThanOrEqual(5);
    p.update(3);
    expect(p.count).toBe(0);
  });

  it('never goes past its limit, and says how many it dropped', () => {
    const p = new ParticlePool(50, 3);
    p.setLimit(20);
    p.emit('mud', 0, 0, 0, 0, 0, 100);
    expect(p.count).toBe(20);
    expect(p.dropped).toBe(80);
    p.setLimit(1000);
    expect(p.limit).toBe(50);
    p.setLimit(-5);
    expect(p.limit).toBe(0);
  });

  it('is deterministic for a seed', () => {
    const run = (): number[] => {
      const p = new ParticlePool(40, 99);
      p.emit('splash', 1, 0, 2, 3, 4, 12);
      p.update(0.2);
      return [...p.px.slice(0, p.count), ...p.pz.slice(0, p.count)];
    };
    expect(run()).toEqual(run());
  });

  it('matter falls and settles on the ground, smoke rises', () => {
    const p = new ParticlePool(20, 5);
    p.emit('mud', 0, 1, 0, 0, 0, 5);
    for (let i = 0; i < 20; i++) p.update(0.02, () => 1);
    for (let i = 0; i < p.count; i++) expect(p.py[i]!).toBeGreaterThanOrEqual(1 - 1e-6);
    const q = new ParticlePool(20, 5);
    q.emit('smoke', 0, 0, 0, 0, 0, 5);
    const y0 = q.py[0]!;
    for (let i = 0; i < 20; i++) q.update(0.02);
    expect(q.py[0]!).toBeGreaterThan(y0);
  });

  it('inherits a little of the car\'s velocity so a trail lags behind it', () => {
    const p = new ParticlePool(20, 5);
    p.emit('dust', 0, 0, 0, 20, 0, 10);
    p.update(0.3);
    const mean = Array.from({ length: p.count }, (_, i) => p.px[i]!).reduce((a, b) => a + b, 0) / p.count;
    expect(mean).toBeGreaterThan(0.2);
  });

  it('costs next to nothing: a full pool updates in well under a millisecond', () => {
    const p = new ParticlePool(1000, 1);
    p.emit('dust', 0, 0, 0, 0, 0, 1000);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      p.update(0.001);
      p.emit('dust', 0, 0, 0, 0, 0, 5);
    }
    const per = (performance.now() - t0) / 100;
    expect(per).toBeLessThan(1);
  });

  it('quality scales the capacity', () => {
    expect(fxCapacity(1)).toBe(600);
    expect(fxCapacity(0.5)).toBe(300);
    expect(fxCapacity(0)).toBe(0);
    expect(fxCapacity(9)).toBe(600);
  });
});

describe('tyre marks', () => {
  it('paving, grass, sand, gravel and mud keep a mark; water and rock do not', () => {
    for (const s of [Surface.Patio, Surface.Grass, Surface.Sand, Surface.Gravel, Surface.Mud]) {
      expect(markable(s)).toBe(true);
      expect(markStrength(s)).toBeGreaterThan(0);
    }
    for (const s of [Surface.Water, Surface.Rock]) {
      expect(markable(s)).toBe(false);
      expect(markStrength(s)).toBe(0);
    }
    expect(markStrength(Surface.Patio)).toBeGreaterThan(markStrength(Surface.Grass));
  });

  it('a sliding wheel lays a segment every MARK_STEP metres, along its path', () => {
    const t = new SkidTrail();
    expect(t.step(0, 0, true, Surface.Patio)).toBeNull(); // the first point only starts the trail
    expect(t.step(0, MARK_STEP * 0.5, true, Surface.Patio)).toBeNull();
    const m = t.step(0, MARK_STEP * 1.2, true, Surface.Patio);
    expect(m).not.toBeNull();
    expect(m!.length).toBeCloseTo(MARK_STEP * 1.2, 5);
    expect(m!.yaw).toBeCloseTo(0, 5); // heading +z
    expect(m!.z).toBeCloseTo(MARK_STEP * 0.6, 5);
  });

  it('stops when the wheel stops slipping or leaves markable ground, and starts fresh after', () => {
    const t = new SkidTrail();
    t.step(0, 0, true, Surface.Patio);
    expect(t.step(0, 1, false, Surface.Patio)).toBeNull();
    expect(t.step(0, 5, true, Surface.Patio)).toBeNull(); // new trail: no segment joining 1 to 5
    expect(t.step(0, 6, true, Surface.Water)).toBeNull();
    expect(t.step(0, 7, true, Surface.Patio)).toBeNull();
  });

  it('is a ring: the oldest go when it is full, and every mark fades out', () => {
    const marks = new SkidMarks(3);
    const mk = (x: number) => ({ x, z: 0, yaw: 0, length: 0.4, strength: 0.5, age: 0 });
    for (let i = 0; i < 5; i++) marks.add(mk(i));
    expect(marks.count).toBe(3);
    expect(marks.marks.map((m) => m.x).sort()).toEqual([2, 3, 4]);
    marks.update(MARK_LIFE - 1);
    expect(marks.count).toBe(3);
    marks.update(2);
    expect(marks.count).toBe(0);
  });

  it('a capacity of 0 keeps nothing', () => {
    const marks = new SkidMarks(0);
    marks.add({ x: 0, z: 0, yaw: 0, length: 1, strength: 1, age: 0 });
    expect(marks.count).toBe(0);
  });
});

describe('every kind can be emitted', () => {
  it('without error', () => {
    const p = new ParticlePool(500, 2);
    for (const k of Object.keys(FX) as FxKind[]) p.emit(k, 0, 0, 0, 1, 1, 3);
    expect(p.count).toBe(Object.keys(FX).length * 3);
  });
});
