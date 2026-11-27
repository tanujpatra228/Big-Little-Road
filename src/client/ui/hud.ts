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
  private readonly nitroLabel = document.createElement('div');
  private readonly gearBox = document.createElement('div');
  private readonly teamBox = document.createElement('div');
  private teamKey = '';
  private readonly signalBox = document.createElement('div');
  private readonly signalBars: HTMLElement[] = [];
  private readonly signalText = document.createElement('span');
  private toastTimer = 0;
  /** Set while a teammate is flipping us back over, to replace the usual flipped message. */
  rescueText: string | null = null;
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
      .hud .nitro.team i{background:linear-gradient(90deg,#2bb3ff,#7ef0d8)}
      .hud .nitro.team.run i{background:linear-gradient(90deg,#7ef0d8,#e6fff8)}
      .hud .signal{position:absolute;left:20px;bottom:166px;display:none;align-items:flex-end;gap:8px;font-size:11px;font-weight:600;letter-spacing:.04em}
      .hud .signal .bars{display:flex;align-items:flex-end;gap:2px;height:18px}
      .hud .signal .bars i{display:block;width:5px;border-radius:1px;background:#fff3}
      .hud .signal .bars i.on{background:var(--sc,#6dff9e)}
      .hud .signal.weak{--sc:#ffc247}
      .hud .signal.lost{--sc:#ff5a4d}
      .hud .signal.lost .txt{animation:sigblink .8s steps(2) infinite}
      @keyframes sigblink{50%{opacity:.35}}
      .hud .gear{position:absolute;left:20px;bottom:190px;display:none;font-size:11px;font-weight:700;letter-spacing:.05em;background:#000a;padding:3px 10px;border-radius:999px;border:1px solid #fff4}
      .hud .gear.low{border-color:#ffd23f;color:#ffd23f}
      .hud .teamlinks{position:absolute;left:20px;bottom:216px;display:none;flex-direction:column;gap:2px;font-size:11px;font-weight:600}
      .hud .teamlinks span{background:#000a;padding:2px 9px;border-radius:999px;border:1px solid #fff3;width:max-content}
      .hud .teamlinks span.weak{border-color:#ffc247;color:#ffc247}
      .hud .teamlinks span.lost{border-color:#ff5a4d;color:#ff5a4d;animation:sigblink .8s steps(2) infinite}
      .hud .nitrolabel{position:absolute;left:20px;bottom:142px;font-size:11px;font-weight:600;letter-spacing:.04em;opacity:.9;display:none}
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
    this.nitroLabel.className = 'nitrolabel';
    this.gearBox.className = 'gear';
    this.teamBox.className = 'teamlinks';
    this.signalBox.className = 'signal';
    const bars = document.createElement('span');
    bars.className = 'bars';
    [7, 11, 15, 19].forEach((h) => {
      const b = document.createElement('i');
      b.style.height = `${h}px`;
      bars.appendChild(b);
      this.signalBars.push(b);
    });
    this.signalText.className = 'txt';
    this.signalBox.append(bars, this.signalText);
    const help = document.createElement('div');
    help.className = 'help';
    help.innerHTML = 'W/S throttle &middot; A/D steer &middot; Space jump &middot; Shift nitro &middot; C handbrake<br>Q ping wheel &middot; V orbit camera &middot; 1 2 3 switch car &middot; H horn &middot; F hook plank &middot; G low range (Hauler, Relay) &middot; 4-9 toolbox slot, E drop, X pick up &middot; B Relay charges the battery &middot; T return plank &middot; M mute &middot; R reset (when flipped 10 s)';
    CAR_ORDER.forEach((role, i) => {
      const b = document.createElement('button');
      b.dataset.role = role;
      b.textContent = `${i + 1}  ${CARS[role].label}`;
      b.onclick = () => onPick(role);
      this.cars.appendChild(b);
    });
    this.root.append(this.speed, this.info, this.banner, this.cars, help, this.fps, this.sound, this.prompt, this.toastEl, this.nitroBar, this.nitroLabel, this.signalBox, this.gearBox, this.teamBox);
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

  /** Your teammates' radio links (empty hides it). Redraws only when something changed. */
  setTeamLinks(links: ReadonlyArray<{ name: string; strength: number; lost: boolean }>): void {
    const key = links.map((l) => `${l.name}:${l.lost ? 'x' : Math.round(l.strength * 20)}`).join('|');
    if (key === this.teamKey) return;
    this.teamKey = key;
    this.teamBox.style.display = links.length ? 'flex' : 'none';
    this.teamBox.replaceChildren(
      ...links.map((l) => {
        const el = document.createElement('span');
        el.className = l.lost ? 'lost' : l.strength < 0.5 ? 'weak' : '';
        el.textContent = l.lost ? `${l.name}: NO SIGNAL` : `${l.name}: ${Math.round(l.strength * 100)}%`;
        return el;
      }),
    );
  }

  /** The gear badge: null hides it (the Scout has no low range). */
  setGear(text: string | null, low = false): void {
    this.gearBox.style.display = text ? 'block' : 'none';
    if (text) {
      this.gearBox.textContent = text;
      this.gearBox.classList.toggle('low', low);
    }
  }

  /** A contextual action hint near the bottom of the screen, or hidden when null. */
  setPrompt(text: string | null): void {
    this.prompt.style.display = text ? 'block' : 'none';
    if (text) this.prompt.textContent = text;
  }

  /**
   * In a room the nitro bar is the TEAM battery: tinted blue-green and labelled, with how many cars are
   * draining it right now. Pass null when playing alone (the personal tank).
   */
  setTeamBattery(boosters: number | null): void {
    const team = boosters !== null;
    this.nitroBar.classList.toggle('team', team);
    this.nitroBar.title = team ? 'Team battery, shared by everyone in the room (Shift to boost)' : 'Nitro (Shift)';
    this.nitroLabel.style.display = team ? 'block' : 'none';
    if (team) this.nitroLabel.textContent = boosters > 0 ? `TEAM BATTERY · ${boosters} boosting` : 'TEAM BATTERY';
  }

  /**
   * The radio link, shown only while the room's radio range is on (pass null otherwise). Four bars for
   * strength, green when good, amber when the controls lag, red and blinking when cut off.
   */
  setSignal(s: { strength: number; quality: 'good' | 'weak' | 'lost'; lag: number } | null): void {
    this.signalBox.style.display = s ? 'flex' : 'none';
    if (!s) return;
    this.signalBox.classList.toggle('weak', s.quality === 'weak');
    this.signalBox.classList.toggle('lost', s.quality === 'lost');
    const filled = s.quality === 'lost' ? 0 : Math.max(1, Math.ceil(s.strength * 4 - 1e-9));
    this.signalBars.forEach((b, i) => b.classList.toggle('on', i < filled));
    this.signalText.textContent =
      s.quality === 'lost' ? 'NO SIGNAL: throttle cut. Reverse out, or bring a Relay closer' : s.quality === 'weak' ? `SIGNAL WEAK: controls lag ${Math.round(s.lag * 1000)} ms` : 'SIGNAL';
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
      this.banner.textContent = this.rescueText ?? (left > 0 ? `Flipped. A teammate who drives up to you will flip you back, or reset in ${left}s (R)` : 'Press R to reset');
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
