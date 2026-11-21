import { describe, expect, it } from 'vitest';
import { DIST_MAX, DIST_MIN, PITCH_MAX, PITCH_MIN, aboveGround, clampOrbit, dragOrbit, orbitFromChase, orbitOffset, zoomOrbit, type OrbitState } from '../src/shared/orbit';

const base: OrbitState = { yaw: 0, pitch: 0.4, distance: 8 };
const near = (a: number, b: number, tol = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('orbit offset', () => {
  it('yaw 0 puts the camera behind a car facing +z, like the chase camera', () => {
    const o = orbitOffset({ yaw: 0, pitch: 0, distance: 5 });
    near(o.x, 0);
    near(o.y, 0);
    near(o.z, -5);
  });

  it('a quarter turn moves the camera to the -x side', () => {
    const o = orbitOffset({ yaw: Math.PI / 2, pitch: 0, distance: 5 });
    near(o.x, -5);
    near(o.z, 0, 1e-9);
  });

  it('pitch lifts the camera, and the distance is always the orbit distance', () => {
    for (const yaw of [0, 1, 2.5, -2]) {
      for (const pitch of [0.1, 0.7, 1.3]) {
        const o = orbitOffset({ yaw, pitch, distance: 9 });
        near(Math.hypot(o.x, o.y, o.z), 9, 1e-9);
        expect(o.y).toBeGreaterThan(0);
      }
    }
  });
});

describe('drag and zoom', () => {
  it('dragging right swings the camera to its left, dragging down lifts it', () => {
    const right = dragOrbit(base, 100, 0);
    expect(right.yaw).toBeLessThan(base.yaw);
    // Camera's left when facing +z is +x: the camera x offset should grow.
    expect(orbitOffset(right).x).toBeGreaterThan(orbitOffset(base).x);
    expect(dragOrbit(base, 0, 60).pitch).toBeGreaterThan(base.pitch);
  });

  it('never goes under the horizon or over the top, and wraps yaw', () => {
    expect(dragOrbit(base, 0, -9999).pitch).toBe(PITCH_MIN);
    expect(dragOrbit(base, 0, 9999).pitch).toBe(PITCH_MAX);
    const spun = dragOrbit(base, -9000, 0);
    expect(Math.abs(spun.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('zoom is proportional, clamped, and symmetric', () => {
    const out = zoomOrbit(base, 100);
    const back = zoomOrbit(out, -100);
    expect(out.distance).toBeGreaterThan(base.distance);
    near(back.distance, base.distance, 1e-9);
    expect(zoomOrbit(base, 1e6).distance).toBeLessThanOrEqual(DIST_MAX);
    for (let i = 0; i < 200; i++) expect(zoomOrbit({ ...base, distance: DIST_MIN }, -400).distance).toBe(DIST_MIN);
  });

  it('clampOrbit fixes wild values', () => {
    const c = clampOrbit({ yaw: 10, pitch: 9, distance: 1000 });
    expect(c.pitch).toBe(PITCH_MAX);
    expect(c.distance).toBe(DIST_MAX);
    expect(Math.abs(c.yaw)).toBeLessThanOrEqual(Math.PI);
  });
});

describe('switching from the chase camera', () => {
  it('keeps the same spot behind the car', () => {
    const o = orbitFromChase(0.7, 7.5, 3.2);
    const off = orbitOffset(o);
    // The chase camera sits `distance` behind and `height` above, along the heading.
    near(off.y, 3.2, 1e-6);
    near(off.x, -Math.sin(0.7) * 7.5, 1e-6);
    near(off.z, -Math.cos(0.7) * 7.5, 1e-6);
  });
});

describe('ground clearance', () => {
  it('lifts a camera that would be under the terrain, leaves the rest', () => {
    expect(aboveGround(0.2, 1, 0.8)).toBeCloseTo(1.8);
    expect(aboveGround(5, 1, 0.8)).toBe(5);
  });
});
