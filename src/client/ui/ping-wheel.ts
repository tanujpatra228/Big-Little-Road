import { PING_KINDS, PING_STYLES, pickKind, sliceAngle, type PingKind } from '../../shared/ping';
import { pingIconSvg } from './ping-icons';

const RADIUS = 96;

/**
 * The radial menu shown while the ping key is held. It sits where the mouse was when it opened, so
 * you flick from where you are, and the slice under the mouse lights up. A small crosshair at the
 * centre of the screen shows where Go, Wait and Look will land.
 */
export class PingWheel {
  private readonly root = document.createElement('div');
  private readonly reticle = document.createElement('div');
  private readonly slices = new Map<PingKind, HTMLElement>();
  private cx = 0;
  private cy = 0;
  private picked: PingKind | null = null;
  /** Last known mouse position in pixels. */
  private mouse = { x: innerWidth / 2, y: innerHeight / 2 };

  constructor() {
    const css = document.createElement('style');
    css.textContent = `
      .pingwheel{position:fixed;inset:0;pointer-events:none;display:none;z-index:30;font:600 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000c}
      .pingwheel.on{display:block}
      .pingwheel .hub{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff8;box-shadow:0 0 0 34px #00000030}
      .pingwheel .slice{position:absolute;width:70px;margin:-35px 0 0 -35px;text-align:center;transition:transform .08s}
      .pingwheel .slice .ico{width:56px;height:56px;margin:0 auto 4px;border-radius:50%;background:#10151ce6;border:3px solid var(--c);display:grid;place-items:center;color:var(--c);box-shadow:0 4px 14px #0008}
      .pingwheel .slice.on{transform:scale(1.2)}
      .pingwheel .slice.on .ico{background:var(--c);color:#10151c}
      .pingwheel .slice .lab{white-space:nowrap;margin-left:-20px;margin-right:-20px}
      .pingwheel .reticle{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;opacity:.9}
      .pingwheel .reticle::before,.pingwheel .reticle::after{content:'';position:absolute;background:#fff;box-shadow:0 0 3px #000}
      .pingwheel .reticle::before{left:10px;top:0;width:2px;height:22px}
      .pingwheel .reticle::after{top:10px;left:0;height:2px;width:22px}
    `;
    document.head.appendChild(css);
    this.root.className = 'pingwheel';
    this.reticle.className = 'reticle';
    const hub = document.createElement('div');
    hub.className = 'hub';
    this.root.append(this.reticle, hub);
    this.hub = hub;
    for (const kind of PING_KINDS) {
      const el = document.createElement('div');
      el.className = 'slice';
      el.style.setProperty('--c', PING_STYLES[kind].color);
      const ico = document.createElement('div');
      ico.className = 'ico';
      ico.innerHTML = pingIconSvg(kind, 28);
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.textContent = PING_STYLES[kind].label;
      el.append(ico, lab);
      this.root.appendChild(el);
      this.slices.set(kind, el);
    }
    document.body.appendChild(this.root);
    addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
  }

  private readonly hub: HTMLElement;

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }

  /** Opens the wheel around the mouse, kept far enough from the edges that every slice fits. */
  open(): void {
    const pad = RADIUS + 52;
    this.cx = Math.min(innerWidth - pad, Math.max(pad, this.mouse.x));
    this.cy = Math.min(innerHeight - pad, Math.max(pad, this.mouse.y));
    this.hub.style.left = `${this.cx}px`;
    this.hub.style.top = `${this.cy}px`;
    for (const kind of PING_KINDS) {
      const a = sliceAngle(kind);
      const el = this.slices.get(kind)!;
      el.style.left = `${this.cx + Math.sin(a) * RADIUS}px`;
      el.style.top = `${this.cy - Math.cos(a) * RADIUS}px`;
    }
    this.picked = null;
    this.root.classList.add('on');
    this.refresh();
  }

  close(): void {
    this.root.classList.remove('on');
  }

  /** The slice under the mouse right now, or null inside the dead zone. Call every frame while open. */
  pick(): PingKind | null {
    const p = pickKind(this.mouse.x - this.cx, this.mouse.y - this.cy);
    if (p !== this.picked) {
      this.picked = p;
      this.refresh();
    }
    return p;
  }

  private refresh(): void {
    for (const [kind, el] of this.slices) el.classList.toggle('on', kind === this.picked);
  }
}
