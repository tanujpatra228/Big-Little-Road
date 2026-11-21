import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER, type CarRole } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import { initRapier } from '../src/client/physics/world';
import { topSpeedOn } from './flat-world';

const OFFROAD = [Surface.Sand, Surface.Mud, Surface.Rock, Surface.Water];

describe('surfaces slow cars, never speed them up', () => {
  const grass: Record<string, number> = {};
  const ratio: Record<string, Record<number, number>> = {};

  beforeAll(async () => {
    await initRapier();
    for (const role of CAR_ORDER) {
      grass[role] = topSpeedOn(Surface.Grass, CARS[role]);
      ratio[role] = {};
      for (const s of OFFROAD) ratio[role]![s] = topSpeedOn(s, CARS[role]) / grass[role]!;
    }
  }, 120000);

  const r = (role: CarRole, s: Surface): number => ratio[role]![s] ?? NaN;

  it.each(CAR_ORDER)('%s is never faster off-road than on grass', (role) => {
    for (const s of OFFROAD) expect(r(role, s)).toBeLessThanOrEqual(1);
  });

  it('config never lists a surface above grass', () => {
    for (const role of CAR_ORDER) {
      for (const s of OFFROAD) expect(CARS[role].surfaceSpeed[s]).toBeLessThanOrEqual(CARS[role].surfaceSpeed[Surface.Grass]);
    }
  });

  it('Scout barely slows on sand; Hauler and Relay lose a lot', () => {
    expect(r('scout', Surface.Sand)).toBeGreaterThan(0.8);
    expect(r('hauler', Surface.Sand)).toBeLessThan(0.5);
    expect(r('relay', Surface.Sand)).toBeLessThan(0.55);
    expect(r('scout', Surface.Sand)).toBeGreaterThan(r('hauler', Surface.Sand) + 0.3);
  });

  it('Hauler copes with water best', () => {
    expect(r('hauler', Surface.Water)).toBeGreaterThan(r('scout', Surface.Water));
    expect(r('hauler', Surface.Water)).toBeGreaterThan(r('relay', Surface.Water));
  });

  it('Relay is quick on normal ground but halted by rough terrain', () => {
    expect(grass.relay).toBeGreaterThan(grass.hauler! * 1.4);
    expect(r('relay', Surface.Rock)).toBeLessThan(0.65);
    expect(r('relay', Surface.Mud)).toBeLessThan(0.5);
  });
});
