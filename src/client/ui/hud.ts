import { SURFACE_NAMES } from '../../shared/surfaces';
import { CARS, CAR_ORDER, type CarRole } from '../../shared/cars';
import type { Vehicle } from '../physics/vehicle';

export class Hud {
  private readonly root = document.createElement('div');
  private readonly speed = document.createElement('div');
  private readonly info = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly cars = document.createElement('div');
  private readonly fps = document.createElement('div');
  private readonly sound = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly toastEl = document.createElement('div');
  private readonly nitroBar = document.createElement('div');
  private readonly nitroFill = document.createElement('i');
  private toastTimer = 0;
  private audioState = '';
  private frames = 0;
  private acc = 0;

  constructor(onPick: (role: CarRole) => void) {
    const css = document.createElement('style');
    css.textContent = `
      .hud{position:fixed;inset:0;pointer-events:none;font:14px/1.35 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000a}
      .hud .speed{position:absolute;left:20px;bottom:20px;font-size:44px;font-weight:700}
      .hud .speed small{font-size:16px;font-weight:500;opacity:.85;margin-left:6px}
      .hud .info{position:absolute;left:20px;bottom:80px;opacity:.9}
      .hud .cars{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:8px;pointer-events:auto}
      .hud .cars button{font:inherit;color:#fff;background:#0007;border:2px solid #fff3;border-radius:8px;padding:6px 12px;cursor:pointer}
      .hud .cars button.on{border-color:#fff;background:#000a}
      .hud .help{position:absolute;right:16px;bottom:16px;text-align:right;opacity:.75;font-size:12px}
      .hud .banner{position:absolute;top:30%;left:50%;transform:translateX(-50%);font-size:26px;font-weight:700;text-align:center;display:none}
      .hud .fps{position:absolute;right:16px;top:12px;font-size:12px;opacity:.7}
      .hud .toast{position:absolute;top:92px;left:50%;transform:translateX(-50%) scale(.9);text-align:center;background:#10151ce6;border:2px solid #ffd23f;border-radius:16px;padding:12px 26px;opacity:0;transition:opacity .25s,transform .25s}
      .hud .toast.show{opacity:1;transform:translateX(-50%) scale(1)}
      .hud .toast b{display:block;font-size:24px;color:#ffd23f}
      .hud .toast span{font-size:14px;opacity:.9}
      .hud .nitro{position:absolute;left:20px;bottom:128px;width:150px;height:10px;border-radius:999px;background:#0008;border:1px solid #fff4;overflow:hidden}
      .hud .nitro i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#ff7a1a,#ffd23f);transform-origin:left;transition:background .2s}
      .hud .nitro.low i{background:#e0412f}
      .hud .nitro.run i{background:linear-gradient(90deg,#ffd23f,#fff3b0)}
      .hud .prompt{position:absolute;left:50%;bottom:58px;transform:translateX(-50%);font-size:15px;font-weight:600;background:#000a;padding:7px 16px;border-radius:999px;display:none}
      .hud .sound{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);font-size:13px;opacity:.85;background:#0006;padding:5px 12px;border-radius:999px}
    `;
    document.head.appendChild(css);
    this.root.className = 'hud';
    this.speed.className = 'speed';
    this.info.className = 'info';
    this.banner.className = 'banner';
    this.cars.className = 'cars';
    this.fps.className = 'fps';
    this.sound.className = 'sound';
    this.prompt.className = 'prompt';
    this.toastEl.className = 'toast';
    this.nitroBar.className = 'nitro';
    this.nitroBar.title = 'Nitro (Shift)';
    this.nitroBar.append(this.nitroFill);
    const help = document.createElement('div');
    help.className = 'help';
    help.innerHTML = 'W/S throttle &middot; A/D steer &middot; Space jump &middot; Shift nitro &middot; C handbrake<br>V orbit camera &middot; 1 2 3 switch car &middot; H horn &middot; F hook plank &middot; T return plank &middot; M mute &middot; R reset (when flipped 10 s)';
    CAR_ORDER.forEach((role, i) => {
      const b = document.createElement('button');
      b.dataset.role = role;
      b.textContent = `${i + 1}  ${CARS[role].label}`;
      b.onclick = () => onPick(role);
      this.cars.appendChild(b);
    });
    this.root.append(this.speed, this.info, this.banner, this.cars, help, this.fps, this.sound, this.prompt, this.toastEl, this.nitroBar);
    document.body.appendChild(this.root);
  }

  /** A celebratory message for a few seconds. */
  toast(title: string, sub = '', ms = 4200): void {
    this.toastEl.replaceChildren();
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('span');
    s.textContent = sub;
    this.toastEl.append(b, s);
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** A contextual action hint near the bottom of the screen, or hidden when null. */
  setPrompt(text: string | null): void {
    this.prompt.style.display = text ? 'block' : 'none';
    if (text) this.prompt.textContent = text;
  }

  /** Shows a hint until the browser lets audio start, and a note when muted. */
  setAudio(state: 'locked' | 'on' | 'muted'): void {
    if (state === this.audioState) return;
    this.audioState = state;
    this.sound.style.display = state === 'on' ? 'none' : 'block';
    this.sound.textContent = state === 'locked' ? 'Press any key to turn on sound' : 'Sound off (M to turn on)';
  }

  update(v: Vehicle, role: CarRole, dt: number, quality = ''): void {
    // Toy-scale numbers: show units/s * 3.6 so top speeds read like km/h.
    this.speed.innerHTML = `${Math.abs(v.speed * 3.6).toFixed(0)}<small>km/h</small>`;
    this.info.textContent = `${SURFACE_NAMES[v.surface]}${v.grounded === 0 ? ' (airborne)' : ''}`;
    this.nitroFill.style.transform = `scaleX(${v.nitro.level.toFixed(3)})`;
    this.nitroBar.classList.toggle('run', v.nitro.active);
    this.nitroBar.classList.toggle('low', v.nitro.level < 0.2);
    for (const b of this.cars.querySelectorAll('button')) b.classList.toggle('on', b.dataset.role === role);
    if (v.isFlipped) {
      const left = Math.ceil(v.resetSecondsLeft);
      this.banner.style.display = 'block';
      this.banner.textContent = left > 0 ? `Flipped. Wait for a teammate, or reset in ${left}s (R)` : 'Press R to reset';
    } else {
      this.banner.style.display = 'none';
    }
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps.textContent = `${Math.round(this.frames / this.acc)} fps${quality ? ` · ${quality}` : ''}`;
      this.frames = 0;
      this.acc = 0;
    }
  }
}
