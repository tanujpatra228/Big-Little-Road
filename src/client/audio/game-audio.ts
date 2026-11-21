import { CARS, type CarRole } from '../../shared/cars';
import { Surface } from '../../shared/surfaces';
import {
  ENGINE_PROFILES, IDLE_RPM, engineHz, impactVoice, parseVolumes, squealGain, stepRpm, targetRpm, tyreSound, volumeToGain, windGain,
  type EngineProfile, type Impact, type Volumes,
} from '../../shared/audio-model';

export interface AudioState {
  role: CarRole;
  /** Signed forward speed, m/s. */
  speed: number;
  throttle: number;
  surface: Surface;
  groundedWheels: number;
  braking: boolean;
}

const STORAGE_KEY = 'blr-sound';
const VOLUME_KEY = 'blr-volumes';

/**
 * Everything you hear, synthesized live with Web Audio: no audio files, nothing to download.
 * The rules live in shared/audio-model.ts; this file turns them into a node graph.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private muted = false;
  private volumes: Volumes = parseVolumes(null);
  private engineBus!: GainNode;
  private fxBus!: GainNode;
  private ambienceBus!: GainNode;

  private noise!: AudioBuffer;
  private crackle!: AudioBuffer;

  // Engine
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private oscC!: OscillatorNode;
  private gainB!: GainNode;
  private gainC!: GainNode;
  private shaper!: WaveShaperNode;
  private engineLp!: BiquadFilterNode;
  private engineGain!: GainNode;
  private wobble!: GainNode;

  // Tyres, wind, squeal
  private tyreBp!: BiquadFilterNode;
  private tyreGain!: GainNode;
  private crackleSrc!: AudioBufferSourceNode;
  private crackleGain!: GainNode;
  private windGainNode!: GainNode;
  private squealGainNode!: GainNode;

  // Horn
  private hornGain!: GainNode;
  private hornA!: OscillatorNode;
  private hornB!: OscillatorNode;

  private role: CarRole = 'scout';
  private rpm = IDLE_RPM;
  private lastImpactAt = -1;
  private birdTimer = 3;
  private hornOn = false;
  private levelBuf = new Float32Array(1024);

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === 'off';
      this.volumes = parseVolumes(localStorage.getItem(VOLUME_KEY));
    } catch {
      /* private mode: start with sound on */
    }
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Browsers only allow audio after a gesture. Call from a key or pointer event. */
  unlock(): void {
    if (!this.ctx) this.build();
    void this.ctx?.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? 'off' : 'on');
    } catch {
      /* ignore */
    }
    this.applyVolumes();
    return this.muted;
  }

  getVolumes(): Volumes {
    return { ...this.volumes };
  }

  /** Move one slider. Takes effect smoothly and is remembered. */
  setVolume(which: keyof Volumes, v: number): void {
    this.volumes = { ...this.volumes, [which]: Math.min(1, Math.max(0, v)) };
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volumes));
    } catch {
      /* ignore */
    }
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : volumeToGain(this.volumes.master), t, 0.04);
    this.engineBus.gain.setTargetAtTime(volumeToGain(this.volumes.engine), t, 0.04);
    this.fxBus.gain.setTargetAtTime(volumeToGain(this.volumes.effects), t, 0.04);
    this.ambienceBus.gain.setTargetAtTime(volumeToGain(this.volumes.ambience), t, 0.04);
  }

  /** Overall output level, 0..1 RMS. Used by tests and debugging. */
  level(): number {
    if (!this.ctx) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    return Math.sqrt(sum / this.levelBuf.length);
  }

  setCar(role: CarRole): void {
    this.role = role;
    if (this.ctx) this.applyProfile(ENGINE_PROFILES[role]);
    if (this.hornOn) this.setHornPitch();
  }

  // ---------------------------------------------------------------- graph

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.engineBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    for (const bus of [this.engineBus, this.fxBus, this.ambienceBus]) bus.connect(this.master);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination);
    this.applyVolumes();
    this.master.gain.value = this.muted ? 0 : volumeToGain(this.volumes.master); // no fade-in click on first start
    this.engineBus.gain.value = volumeToGain(this.volumes.engine);
    this.fxBus.gain.value = volumeToGain(this.volumes.effects);
    this.ambienceBus.gain.value = volumeToGain(this.volumes.ambience);

    this.noise = this.makeNoise(ctx);
    this.crackle = this.makeCrackle(ctx);

    this.buildEngine(ctx);
    this.buildTyres(ctx);
    this.buildHorn(ctx);
    this.buildAmbience(ctx);
    this.applyProfile(ENGINE_PROFILES[this.role]);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Sparse little clicks: played faster they become a gravel crunch. */
  private makeCrackle(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const tail = Math.floor(ctx.sampleRate * 0.0025);
    for (let i = 0; i < d.length; i++) {
      if (Math.random() < 0.0016) {
        const amp = 0.3 + Math.random() * 0.7;
        for (let k = 0; k < tail && i + k < d.length; k++) d[i + k] = (d[i + k] ?? 0) + (Math.random() * 2 - 1) * amp * Math.exp(-k / (tail * 0.3));
      }
    }
    return buf;
  }

  private loopNoise(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  private buildEngine(ctx: AudioContext): void {
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    this.oscC = ctx.createOscillator();
    this.oscC.type = 'triangle';
    const gainA = ctx.createGain();
    gainA.gain.value = 0.6;
    this.gainB = ctx.createGain();
    this.gainC = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.engineLp = ctx.createBiquadFilter();
    this.engineLp.type = 'lowpass';
    this.engineLp.Q.value = 0.9;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.oscA.connect(gainA).connect(this.shaper);
    this.oscB.connect(this.gainB).connect(this.shaper);
    this.oscC.connect(this.gainC).connect(this.shaper);
    this.shaper.connect(this.engineLp).connect(this.engineGain).connect(this.engineBus);

    // Slow pitch wobble: the lumpy idle.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    this.wobble = ctx.createGain();
    lfo.connect(this.wobble);
    this.wobble.connect(this.oscA.frequency);
    this.wobble.connect(this.oscB.frequency);
    for (const o of [this.oscA, this.oscB, this.oscC, lfo]) o.start();
  }

  private applyProfile(p: EngineProfile): void {
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * p.drive);
    }
    this.shaper.curve = curve;
    const t = this.ctx!.currentTime;
    this.gainB.gain.setTargetAtTime(p.upper, t, 0.05);
    this.gainC.gain.setTargetAtTime(p.sub, t, 0.05);
  }

  private buildTyres(ctx: AudioContext): void {
    const src = this.loopNoise(ctx, this.noise);
    this.tyreBp = ctx.createBiquadFilter();
    this.tyreBp.type = 'bandpass';
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    src.connect(this.tyreBp).connect(this.tyreGain).connect(this.fxBus);

    this.crackleSrc = this.loopNoise(ctx, this.crackle);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackleSrc.connect(hp).connect(this.crackleGain).connect(this.fxBus);

    const windSrc = this.loopNoise(ctx, this.noise);
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 800;
    this.windGainNode = ctx.createGain();
    this.windGainNode.gain.value = 0;
    windSrc.connect(windLp).connect(this.windGainNode).connect(this.fxBus);

    const sqSrc = this.loopNoise(ctx, this.noise);
    const sqBp = ctx.createBiquadFilter();
    sqBp.type = 'bandpass';
    sqBp.frequency.value = 2150;
    sqBp.Q.value = 24;
    this.squealGainNode = ctx.createGain();
    this.squealGainNode.gain.value = 0;
    sqSrc.connect(sqBp).connect(this.squealGainNode).connect(this.fxBus);
  }

  private buildHorn(ctx: AudioContext): void {
    this.hornA = ctx.createOscillator();
    this.hornB = ctx.createOscillator();
    this.hornA.type = this.hornB.type = 'square';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornA.connect(lp);
    this.hornB.connect(lp);
    lp.connect(this.hornGain).connect(this.fxBus);
    this.hornA.start();
    this.hornB.start();
    this.setHornPitch();
  }

  private setHornPitch(): void {
    const [a, b] = ENGINE_PROFILES[this.role].horn;
    const t = this.ctx!.currentTime;
    this.hornA.frequency.setValueAtTime(a, t);
    this.hornB.frequency.setValueAtTime(b, t);
  }

  /** A breeze bed and crickets. Quiet on purpose. Birds are scheduled in update(). */
  private buildAmbience(ctx: AudioContext): void {
    const src = this.loopNoise(ctx, this.noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const slow = ctx.createOscillator();
    slow.frequency.value = 0.12;
    const depth = ctx.createGain();
    depth.gain.value = 0.02;
    slow.connect(depth).connect(g.gain);
    slow.start();
    src.connect(lp).connect(g).connect(this.ambienceBus);

    const cricket = ctx.createOscillator();
    cricket.frequency.value = 4300;
    const cg = ctx.createGain();
    cg.gain.value = 0.0015;
    const am = ctx.createOscillator();
    am.type = 'square';
    am.frequency.value = 27;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.0015;
    am.connect(amDepth).connect(cg.gain);
    cricket.connect(cg).connect(this.ambienceBus);
    cricket.start();
    am.start();
  }

  // ---------------------------------------------------------------- per frame

  update(s: AudioState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const tc = 0.045;
    const p = ENGINE_PROFILES[s.role];
    if (s.role !== this.role) this.setCar(s.role);

    // Engine: rpm through the gearbox, then pitch, tone and level.
    this.rpm = stepRpm(this.rpm, targetRpm(s.speed, CARS[s.role].topSpeed, s.throttle), dt);
    const hz = engineHz(p, this.rpm);
    const load = Math.max(0, s.throttle);
    this.oscA.frequency.setTargetAtTime(hz, t, tc);
    this.oscB.frequency.setTargetAtTime(hz * 2.007, t, tc);
    this.oscC.frequency.setTargetAtTime(hz * 0.5, t, tc);
    this.wobble.gain.setTargetAtTime(hz * p.wobble * (1.4 - this.rpm), t, 0.1);
    this.engineLp.frequency.setTargetAtTime(p.cutLow + (p.cutHigh - p.cutLow) * (0.3 * this.rpm + 0.7 * load * this.rpm + 0.1), t, 0.08);
    this.engineGain.gain.setTargetAtTime(p.gain * (0.55 + 0.45 * load) * (0.7 + 0.3 * this.rpm), t, 0.06);

    const tyre = tyreSound(s.surface, s.speed, s.groundedWheels);
    this.tyreBp.frequency.setTargetAtTime(tyre.hz, t, 0.08);
    this.tyreBp.Q.setTargetAtTime(tyre.q, t, 0.08);
    this.tyreGain.gain.setTargetAtTime(tyre.gain, t, 0.08);
    this.crackleGain.gain.setTargetAtTime(tyre.crackle, t, 0.08);
    this.crackleSrc.playbackRate.setTargetAtTime(tyre.crackleRate, t, 0.1);
    this.windGainNode.gain.setTargetAtTime(windGain(s.speed), t, 0.12);
    this.squealGainNode.gain.setTargetAtTime(squealGain(s.braking, s.speed, s.surface), t, 0.05);

    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 8;
      this.chirp();
    }
  }

  /** Tiny two-to-four note bird call, panned somewhere in the yard. */
  private chirp(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    g.gain.value = 0;
    const base = 2300 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 3);
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const f0 = base * (1 + (Math.random() - 0.5) * 0.3);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.75), t + 0.09);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.02, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.1);
      t += 0.11;
    }
    let out: AudioNode = g;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 2 - 1;
      g.connect(pan);
      out = pan;
    }
    osc.connect(g);
    out.connect(this.ambienceBus);
    osc.start(t0);
    osc.stop(t + 0.05);
    osc.onended = () => out.disconnect();
  }

  // ---------------------------------------------------------------- one shots

  /** A crash or landing. Surface decides whether it rings bright or lands dull. */
  impact(impact: Impact, surface: Surface): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.lastImpactAt < 0.1) return; // one per crunch, not one per physics step
    this.lastImpactAt = now;
    const v = impactVoice(impact, surface);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(v.thumpHz, now);
    thump.frequency.exponentialRampToValueAtTime(v.thumpHz / 2.7, now + 0.22);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(v.gain, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    thump.connect(tg).connect(this.fxBus);
    thump.start(now);
    thump.stop(now + 0.3);

    const burst = ctx.createBufferSource();
    burst.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = v.noiseHz;
    bp.Q.value = 0.7;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(v.gain * 0.9, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + v.decay);
    burst.connect(bp).connect(bg).connect(this.fxBus);
    burst.start(now, Math.random());
    burst.stop(now + v.decay + 0.05);

    if (v.clank > 0.05) {
      const clank = ctx.createOscillator();
      clank.type = 'triangle';
      clank.frequency.value = 520 + Math.random() * 380;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(v.clank * 0.35, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      clank.connect(cg).connect(this.fxBus);
      clank.start(now);
      clank.stop(now + 0.14);
    }
  }

  /** Another player's honk: a short two-tone beep, panned and softened by distance. */
  remoteHorn(role: CarRole, gain: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || gain < 0.01) return;
    const now = ctx.currentTime;
    const [fa, fb] = ENGINE_PROFILES[role].horn;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.14 * gain, now + 0.02);
    out.gain.setValueAtTime(0.14 * gain, now + 0.3);
    out.gain.linearRampToValueAtTime(0, now + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    let tail: AudioNode = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(p);
      tail = p;
    }
    tail.connect(this.fxBus);
    for (const f of [fa, fb]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(now);
      o.stop(now + 0.42);
    }
    lp.connect(out);
    window.setTimeout(() => tail.disconnect(), 600);
  }

  /**
   * The transformation: a servo whirr that rises then falls, a whoosh of air, and two metallic
   * clanks as parts lock into place. `gain` and `pan` let other players' transformations sound distant.
   */
  transform(gain = 1, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || gain < 0.01) return;
    const now = ctx.currentTime;
    let out: AudioNode = this.fxBus;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.fxBus);
      out = p;
      window.setTimeout(() => p.disconnect(), 1200);
    }

    // Servo whirr
    const whirr = ctx.createOscillator();
    whirr.type = 'sawtooth';
    whirr.frequency.setValueAtTime(180, now);
    whirr.frequency.exponentialRampToValueAtTime(760, now + 0.24);
    whirr.frequency.exponentialRampToValueAtTime(300, now + 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 3;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, now);
    wg.gain.linearRampToValueAtTime(0.09 * gain, now + 0.08);
    wg.gain.setValueAtTime(0.09 * gain, now + 0.4);
    wg.gain.exponentialRampToValueAtTime(0.0005, now + 0.65);
    whirr.connect(bp).connect(wg).connect(out);
    whirr.start(now);
    whirr.stop(now + 0.7);

    // Whoosh: noise swept up into the flash, then down
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const abp = ctx.createBiquadFilter();
    abp.type = 'bandpass';
    abp.Q.value = 1.2;
    abp.frequency.setValueAtTime(400, now);
    abp.frequency.exponentialRampToValueAtTime(3200, now + 0.25);
    abp.frequency.exponentialRampToValueAtTime(700, now + 0.6);
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, now);
    ag.gain.linearRampToValueAtTime(0.13 * gain, now + 0.22);
    ag.gain.exponentialRampToValueAtTime(0.0005, now + 0.65);
    air.connect(abp).connect(ag).connect(out);
    air.start(now, Math.random());
    air.stop(now + 0.7);

    // Clanks as it locks: one before the swap, one as the new shape settles
    for (const [at, hz, level] of [[0.14, 1250, 0.1], [0.3, 820, 0.14]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(hz, now + at);
      o.frequency.exponentialRampToValueAtTime(hz * 0.55, now + at + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * gain, now + at);
      g.gain.exponentialRampToValueAtTime(0.0005, now + at + 0.12);
      o.connect(g).connect(out);
      o.start(now + at);
      o.stop(now + at + 0.14);
    }
  }

  /** A short happy fanfare: a rising arpeggio with a shimmer. Plays when a goal is reached. */
  fanfare(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
    notes.forEach((hz, i) => {
      const t = now + i * 0.11;
      const last = i === notes.length - 1;
      for (const [type, mult, level] of [['triangle', 1, 0.16], ['square', 2, 0.04]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0005, t + (last ? 0.9 : 0.32));
        o.connect(g).connect(this.fxBus);
        o.start(t);
        o.stop(t + (last ? 0.95 : 0.36));
      }
    });
    // Shimmer on the last note.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    const t = now + 4 * 0.11;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    air.connect(hp).connect(g).connect(this.fxBus);
    air.start(t, Math.random());
    air.stop(t + 0.85);
  }

  /** A short metallic click for hooking or letting go of a rope. */
  hook(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1500, now);
    o.frequency.exponentialRampToValueAtTime(620, now + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    o.connect(g).connect(this.fxBus);
    o.start(now);
    o.stop(now + 0.1);
  }

  /** Hold-to-honk. Safe to call every frame. */
  horn(on: boolean): void {
    if (!this.ctx || on === this.hornOn) return;
    this.hornOn = on;
    if (on) this.setHornPitch();
    this.hornGain.gain.setTargetAtTime(on ? 0.14 : 0, this.ctx.currentTime, on ? 0.015 : 0.04);
  }
}
