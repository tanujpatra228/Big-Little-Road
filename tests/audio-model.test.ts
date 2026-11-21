import { describe, expect, it } from 'vitest';
import { CAR_ORDER } from '../src/shared/cars';
import { Surface } from '../src/shared/surfaces';
import {
  DEFAULT_VOLUMES, ENGINE_PROFILES, IDLE_RPM, parseVolumes, volumeToGain, engineHz, impactFromDelta, impactVoice, squealGain, stepRpm, targetRpm, tyreSound, windGain,
} from '../src/shared/audio-model';

describe('engine rpm', () => {
  it('idles when stopped and off the throttle', () => {
    expect(targetRpm(0, 20, 0)).toBeCloseTo(IDLE_RPM);
  });

  it('revs up when you floor it at a standstill', () => {
    expect(targetRpm(0, 20, 1)).toBeGreaterThan(IDLE_RPM + 0.3);
  });

  it('rises with speed inside a gear and dips at a shift', () => {
    expect(targetRpm(5, 24, 1)).toBeGreaterThan(targetRpm(1, 24, 1));
    // A flat-out launch climbs without a dip big enough to hear.
    let prev = 0;
    for (let v = 0; v <= 7.5; v += 0.5) {
      const r = targetRpm(v, 24, 1);
      expect(r).toBeGreaterThanOrEqual(prev - 0.08); // the flywheel smoothing hides anything this small
      prev = r;
    }
    const justBefore = targetRpm(7.9, 24, 1); // end of first gear (24/3 = 8)
    const justAfter = targetRpm(8.2, 24, 1);
    expect(justAfter).toBeLessThan(justBefore - 0.2);
  });

  it('never leaves its range', () => {
    for (const speed of [0, 3, 9, 20, 40, -15]) for (const th of [-1, 0, 0.5, 1]) {
      const r = targetRpm(speed, 20, th);
      expect(r).toBeGreaterThanOrEqual(IDLE_RPM);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('rises faster than it falls, and never overshoots', () => {
    const up = stepRpm(0.2, 0.9, 0.1) - 0.2;
    const down = 0.9 - stepRpm(0.9, 0.2, 0.1);
    expect(up).toBeGreaterThan(down);
    expect(stepRpm(0.5, 0.52, 1)).toBeCloseTo(0.52);
  });

  it('maps rpm to rising pitch, and each car has its own voice', () => {
    for (const role of CAR_ORDER) {
      const p = ENGINE_PROFILES[role];
      expect(engineHz(p, 1)).toBeCloseTo(p.maxHz);
      expect(engineHz(p, 0)).toBeCloseTo(p.minHz);
      expect(engineHz(p, 0.6)).toBeGreaterThan(engineHz(p, 0.3));
    }
    expect(ENGINE_PROFILES.hauler.minHz).toBeLessThan(ENGINE_PROFILES.relay.minHz);
    expect(ENGINE_PROFILES.relay.minHz).toBeLessThan(ENGINE_PROFILES.scout.minHz);
  });
});

describe('tyre and wind sound', () => {
  it('is silent when airborne or stopped', () => {
    expect(tyreSound(Surface.Gravel, 12, 0).gain).toBe(0);
    expect(tyreSound(Surface.Gravel, 0, 4).gain).toBe(0);
  });

  it('gets louder with speed', () => {
    expect(tyreSound(Surface.Grass, 12, 4).gain).toBeGreaterThan(tyreSound(Surface.Grass, 4, 4).gain);
  });

  it('every surface sounds different', () => {
    const hz = new Set([Surface.Patio, Surface.Grass, Surface.Sand, Surface.Mud, Surface.Rock, Surface.Gravel, Surface.Water]
      .map((s) => Math.round(tyreSound(s, 10, 4).hz)));
    expect(hz.size).toBe(7);
  });

  it('gravel crunches, patio and grass do not, water splashes loudest', () => {
    expect(tyreSound(Surface.Gravel, 10, 4).crackle).toBeGreaterThan(0.1);
    expect(tyreSound(Surface.Patio, 10, 4).crackle).toBe(0);
    expect(tyreSound(Surface.Grass, 10, 4).crackle).toBe(0);
    expect(tyreSound(Surface.Water, 10, 4).gain).toBeGreaterThan(tyreSound(Surface.Mud, 10, 4).gain);
  });

  it('wind rises with speed', () => {
    expect(windGain(0)).toBe(0);
    expect(windGain(20)).toBeGreaterThan(windGain(8));
  });

  it('squeals on hard ground when braking fast, never on mud or when slow', () => {
    expect(squealGain(true, 15, Surface.Patio)).toBeGreaterThan(0.03);
    expect(squealGain(true, 15, Surface.Mud)).toBe(0);
    expect(squealGain(true, 3, Surface.Patio)).toBe(0);
    expect(squealGain(false, 15, Surface.Patio)).toBe(0);
  });
});

describe('impacts', () => {
  it('ignores ordinary driving', () => {
    expect(impactFromDelta(0.1, 0.05, 0.2)).toBeNull();
  });

  it('a head-on crash is hard and horizontal; a landing is vertical', () => {
    const crash = impactFromDelta(0, 0.1, -6)!;
    const landing = impactFromDelta(0.1, 5, 0.2)!;
    expect(crash.intensity).toBeGreaterThan(0.5);
    expect(crash.vertical).toBeLessThan(0.2);
    expect(landing.vertical).toBeGreaterThan(0.9);
  });

  it('bigger bumps are louder, and always bounded', () => {
    expect(impactFromDelta(0, 0, 6)!.intensity).toBeGreaterThan(impactFromDelta(0, 0, 2)!.intensity);
    expect(impactFromDelta(0, 0, 400)!.intensity).toBe(1);
  });

  it('rock rings bright, sand and mud thud dull', () => {
    const hit = { intensity: 0.7, vertical: 0.1 };
    expect(impactVoice(hit, Surface.Rock).noiseHz).toBeGreaterThan(impactVoice(hit, Surface.Sand).noiseHz * 2);
    expect(impactVoice(hit, Surface.Rock).clank).toBeGreaterThan(impactVoice(hit, Surface.Mud).clank * 3);
  });
});

describe('volume sliders', () => {
  it('map to gain on a curve: silent at 0, full at 1, never louder than the slider', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeLessThan(0.5);
    for (let v = 0; v < 1; v += 0.1) expect(volumeToGain(v + 0.1)).toBeGreaterThan(volumeToGain(v));
  });

  it('survive nonsense input', () => {
    expect(volumeToGain(-3)).toBe(0);
    expect(volumeToGain(9)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it('defaults keep the loudness the game had before there were sliders', () => {
    expect(Math.abs(volumeToGain(DEFAULT_VOLUMES.master) - 0.75)).toBeLessThan(0.01);
    expect(volumeToGain(DEFAULT_VOLUMES.engine)).toBe(1);
    expect(volumeToGain(DEFAULT_VOLUMES.effects)).toBe(1);
    expect(volumeToGain(DEFAULT_VOLUMES.ambience)).toBe(1);
  });

  it('are read back leniently from storage', () => {
    expect(parseVolumes(null)).toEqual(DEFAULT_VOLUMES);
    expect(parseVolumes('not json')).toEqual(DEFAULT_VOLUMES);
    expect(parseVolumes('{"master":0.3,"engine":0.5,"effects":2,"ambience":-1}')).toEqual({ master: 0.3, engine: 0.5, effects: 1, ambience: 0 });
    expect(parseVolumes('{"master":"loud"}')).toEqual(DEFAULT_VOLUMES);
  });
});
