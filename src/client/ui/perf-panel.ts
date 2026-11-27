import { LADDER, MAX_LEVEL } from '../../shared/auto-quality';
import type { AutoQualityController } from '../game/auto-quality';
import type { Grass } from '../render/grass';
import type { Stage } from '../render/stage';

/**
 * A live performance panel (F3, or ?perf in the address). It shows what a frame costs and lets you
 * switch the expensive things off one at a time, so you can see which one is eating your frame rate
 * on your own machine. It changes nothing permanently.
 *
 * Reading it: if "frame" is much longer than "JS" (our code plus draw submission), the graphics card
 * is the limit and the toggles below will show what it is struggling with. If JS itself is long, the
 * game's own code is the limit.
 */
export class PerfPanel {
  private readonly root = document.createElement('div');
  private readonly readout = document.createElement('pre');
  private frames = 0;
  private acc = 0;
  private cpu = 0;
  private submit = 0;
  private shown = false;
  private autoBox: HTMLInputElement | null = null;
  private fx: { enabled: boolean; setEnabled(on: boolean): void; stats(): string } | null = null;
  /** Pulls each control back in line with the real settings, so Auto's changes show on the panel. */
  private sync: Array<() => void> = [];

  constructor(
    private readonly stage: Stage,
    private readonly grass: Grass,
    private readonly auto: AutoQualityController,
    show: boolean,
  ) {
    const css = document.createElement('style');
    css.textContent = `
      .perfpanel{position:fixed;left:14px;top:64px;z-index:40;width:236px;background:#10151ce8;color:#fff;border:1px solid #fff3;border-radius:10px;padding:10px 12px;font:12px/1.4 system-ui,sans-serif;display:none;pointer-events:auto}
      .perfpanel.on{display:block}
      .perfpanel h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.7}
      .perfpanel pre{margin:0 0 8px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre;color:#cfe}
      .perfpanel label{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0}
      .perfpanel input[type=range]{width:110px}
      .perfpanel select{background:#0007;color:#fff;border:1px solid #fff3;border-radius:6px;font:inherit;padding:1px 4px}
      .perfpanel .hint{margin-top:6px;opacity:.6;font-size:11px}
    `;
    document.head.appendChild(css);
    this.root.className = 'perfpanel';
    const title = document.createElement('h4');
    title.textContent = 'Performance (F3)';
    this.root.append(title, this.readout);

    const row = (label: string, control: HTMLElement): void => {
      const l = document.createElement('label');
      const t = document.createElement('span');
      t.textContent = label;
      l.append(t, control);
      this.root.appendChild(l);
    };

    // Auto quality. Touching any control below hands the choice to you, so Auto turns itself off.
    const autoBox = document.createElement('input');
    autoBox.type = 'checkbox';
    autoBox.checked = this.auto.enabled;
    autoBox.onchange = () => this.auto.setEnabled(autoBox.checked);
    row('Auto quality', autoBox);
    const manual = (): void => {
      if (this.auto.enabled) {
        this.auto.setEnabled(false);
        autoBox.checked = false;
      }
    };
    this.autoBox = autoBox;

    const density = document.createElement('input');
    density.type = 'range';
    density.min = '0';
    density.max = '100';
    density.value = '100';
    density.oninput = () => {
      manual();
      this.grass.setDensity(Number(density.value) / 100);
    };
    this.sync.push(() => {
      if (document.activeElement !== density) density.value = String(Math.round(this.grass.density() * 100));
    });
    row('Grass', density);

    const check = (label: string, on: boolean, set: (v: boolean) => void, read: () => boolean): void => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = on;
      this.sync.push(() => {
        if (document.activeElement !== c) c.checked = read();
      });
      c.onchange = () => {
        manual();
        set(c.checked);
      };
      row(label, c);
    };
    check('Flowers', true, (v) => this.grass.setFlowers(v), () => this.grass.flowersOn());
    check(
      'Shadows',
      true,
      (v) => {
        this.stage.sun.castShadow = v;
      },
      () => this.stage.sun.castShadow,
    );
    check('Effects (bloom, AA)', this.stage.post(), (v) => this.stage.setPost(v), () => this.stage.post());

    const res = document.createElement('select');
    for (const [v, t] of [['auto', 'Auto'], ['0.75', '0.75x'], ['1', '1x'], ['1.25', '1.25x'], ['1.5', '1.5x'], ['2', '2x']] as const) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      res.appendChild(o);
    }
    res.onchange = () => {
      manual();
      this.stage.setPixelRatio(res.value === 'auto' ? null : Number(res.value));
    };
    row('Resolution', res);

    const tier = document.createElement('select');
    for (const t of ['high', 'low'] as const) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      tier.appendChild(o);
    }
    tier.value = this.stage.quality();
    tier.onchange = () => {
      manual();
      this.stage.setQuality(tier.value as 'high' | 'low');
    };
    this.sync.push(() => {
      if (document.activeElement !== tier) tier.value = this.stage.quality();
    });
    row('Quality tier', tier);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Turn things off one at a time and watch fps.';
    this.root.appendChild(hint);
    document.body.appendChild(this.root);

    addEventListener('keydown', (e) => {
      if (e.code === 'F3' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.toggle();
      }
    });
    if (show) this.toggle();
  }

  /** Adds the dust and tyre marks to the panel: a switch for them and a count. */
  attachFx(fx: { enabled: boolean; setEnabled(on: boolean): void; stats(): string }): void {
    this.fx = fx;
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = fx.enabled;
    c.onchange = () => {
      if (this.auto.enabled) {
        this.auto.setEnabled(false);
        if (this.autoBox) this.autoBox.checked = false;
      }
      fx.setEnabled(c.checked);
    };
    this.sync.push(() => {
      if (document.activeElement !== c) c.checked = fx.enabled;
    });
    const l = document.createElement('label');
    const t = document.createElement('span');
    t.textContent = 'Dust, spray, tyre marks';
    l.append(t, c);
    this.root.insertBefore(l, this.root.querySelector('.hint'));
  }

  toggle(): void {
    this.shown = !this.shown;
    this.root.classList.toggle('on', this.shown);
  }

  /** Call once per frame. `cpuMs` is the time our own code took before drawing, `submitMs` the time spent handing the draw to the card. */
  frame(dt: number, cpuMs: number, submitMs: number): void {
    this.frames++;
    this.acc += dt;
    this.cpu += cpuMs;
    this.submit += submitMs;
    if (this.acc < 0.5) return;
    if (this.shown) {
      const n = this.frames;
      const info = this.stage.renderer.info;
      const g = this.grass.stats();
      const fmt = (v: number): string => v.toFixed(1).padStart(5);
      for (const s of this.sync) s();
      if (this.autoBox && document.activeElement !== this.autoBox) this.autoBox.checked = this.auto.enabled;
      const px = this.stage.renderer.getPixelRatio();
      this.readout.textContent = [
        `fps      ${(n / this.acc).toFixed(0).padStart(5)}`,
        `frame    ${fmt((this.acc / n) * 1000)} ms`,
        `JS       ${fmt(this.cpu / n)} ms  (logic)`,
        `submit   ${fmt(this.submit / n)} ms  (draws)`,
        // The renderer's counters are reset every frame, so these are the last frame's, not a sum.
        `calls    ${String(info.render.calls).padStart(5)}`,
        `tris     ${String(Math.round(info.render.triangles / 1000)).padStart(4)} k`,
        `grass    ${String(Math.round(g.tufts / 1000)).padStart(4)} k tufts`,
        `pixels   ${px.toFixed(2)}x  ${Math.round(innerWidth * px)}x${Math.round(innerHeight * px)}`,
        `tier     ${this.stage.quality()}${this.stage.post() ? ' + effects' : ''}`,
        `fx       ${this.fx ? (this.fx.enabled ? this.fx.stats() : 'off') : ''}`,
        `auto     ${this.auto.enabled ? `level ${this.auto.level}/${MAX_LEVEL}  grass ${Math.round(LADDER[this.auto.level]!.density * 100)}%` : 'off'}`,
      ].join('\n');
    }
    this.frames = 0;
    this.acc = 0;
    this.cpu = 0;
    this.submit = 0;
  }
}
