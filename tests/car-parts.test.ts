import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CARS, CAR_ORDER, type CarRole } from '../src/shared/cars';
import { FRAME_IDS, REGION_IDS } from '../src/shared/transform-anim';
import { buildCar } from '../src/client/render/car-builder';

// buildCar draws door badges on a canvas; node has none, so give it a do-nothing one.
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => undefined), set: () => true }),
  }),
};

/** Recorded from the models before the parts were tagged. If these change, a car looks different. */
const BEFORE: Record<CarRole, { meshes: number; verts: number; min: string; max: string }> = {
  scout: { meshes: 6, verts: 12612, min: '-0.441,-0.242,-1.065', max: '0.441,0.901,0.964' },
  hauler: { meshes: 7, verts: 18600, min: '-0.555,-0.322,-1.060', max: '0.555,0.838,1.190' },
  relay: { meshes: 9, verts: 18108, min: '-0.570,-0.299,-1.016', max: '0.570,1.635,0.940' },
};

describe.each(CAR_ORDER)('%s model parts', (role) => {
  const model = buildCar(CARS[role]);

  it('draws exactly what it drew before the parts were tagged', () => {
    let verts = 0;
    for (const c of model.bodyGroup.children) verts += ((c as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute).count;
    const box = new THREE.Box3().setFromObject(model.bodyGroup);
    const f = (v: THREE.Vector3): string => v.toArray().map((n) => n.toFixed(3)).join(',');
    expect(model.bodyGroup.children.length).toBe(BEFORE[role].meshes);
    expect(verts).toBe(BEFORE[role].verts);
    expect(f(box.min)).toBe(BEFORE[role].min);
    expect(f(box.max)).toBe(BEFORE[role].max);
  });

  it('has all five big boxes, with real sizes', () => {
    for (const id of FRAME_IDS) {
      const fr = model.parts.frames.get(id);
      expect(fr, `${role} frame ${id}`).toBeDefined();
      for (const n of fr!.size) expect(n).toBeGreaterThan(0.01);
    }
    expect(model.parts.frames.size).toBe(FRAME_IDS.length);
  });

  it('keeps every other shape as a detail, sorted into a region', () => {
    let pieces = 0;
    for (const r of REGION_IDS) pieces += model.parts.details[r].length;
    expect(pieces).toBeGreaterThan(10);
    // Details are non-indexed copies ready to merge, each with a material.
    for (const r of REGION_IDS) for (const d of model.parts.details[r]) expect(d.geo.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('puts the roll cage, rack or mast on top and the lights at the ends', () => {
    expect(model.parts.details.top.length).toBeGreaterThan(2);
    expect(model.parts.details.front.length).toBeGreaterThan(0);
    expect(model.parts.details.rear.length).toBeGreaterThan(0);
  });

  it('exposes the body group, badges and leaves wheels outside the body', () => {
    expect(model.badges.length).toBe(2);
    expect(model.group.children).toContain(model.bodyGroup);
    expect(model.wheels.length).toBe(4);
  });
});
