import { CARS, type CarRole } from '../../shared/cars';
import type { NetStatus } from '../net/room-client';

export interface PanelPlayer {
  id: string;
  name: string;
  role: CarRole;
  self: boolean;
  rtt: number;
}

export interface PanelState {
  status: NetStatus;
  code: string;
  max: number;
  players: PanelPlayer[];
  /** Simulated one-way delay in ms (?lag=), shown so nobody mistakes it for their real connection. */
  lag?: number;
  /** Radio range (signal web) is on. */
  signal?: boolean;
  /** The missions on offer, and which one is running (its id), if any. */
  missions?: { list: Array<{ id: string; name: string; minPlayers: number }>; running: string | null };
}

const NAME_KEY = 'blr-name';

function defaultName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return `Driver${100 + Math.floor(Math.random() * 900)}`;
}

/** The "play with friends" box: start a room, share the link, see who is here. */
export class CoopPanel {
  private readonly root = document.createElement('div');
  private nameValue = defaultName();
  private rttEl: HTMLElement | null = null;

  constructor(private readonly actions: { start(): void; leave(): void; setSignal(on: boolean): void; startMission(id: string): void; abortMission(): void }) {
    const css = document.createElement('style');
    css.textContent = `
      .coop{position:fixed;top:36px;right:14px;width:230px;font:13px/1.4 system-ui,sans-serif;color:#fff;background:#10151cb8;border:1px solid #ffffff22;border-radius:12px;padding:10px 12px;text-shadow:none;backdrop-filter:blur(6px)}
      .coop b{font-size:13px}
      .coop .code{font:700 26px/1 ui-monospace,monospace;letter-spacing:.18em;margin:4px 0 8px}
      .coop button{font:inherit;color:#fff;background:#3a7bd5;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;margin:2px 4px 2px 0}
      .coop button.ghost{background:#ffffff1f}
      .coop input{font:inherit;width:100%;box-sizing:border-box;margin:6px 0;padding:5px 8px;border-radius:8px;border:1px solid #ffffff33;background:#0006;color:#fff}
      .coop ul{list-style:none;margin:6px 0;padding:0}
      .coop li{display:flex;align-items:center;gap:8px;padding:2px 0}
      .coop .dot{width:10px;height:10px;border-radius:50%}
      .coop .rtt{margin-left:auto;opacity:.7;font-size:12px}
      .coop .note{opacity:.75;font-size:12px}
      .coop .missions{margin:8px 0 2px;border-top:1px solid #ffffff22;padding-top:6px}
      .coop .missions b{display:block;margin-bottom:4px}
      .coop .missions button{display:block;width:100%;text-align:left}
      .coop .missions button:disabled{opacity:.45;cursor:default}
      .coop label.rule{display:flex;align-items:center;gap:8px;margin:8px 0 2px;cursor:pointer}
      .coop label.rule input{width:auto;margin:0}
    `;
    document.head.appendChild(css);
    this.root.className = 'coop';
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    this.render({ status: 'off', code: '', max: 4, players: [] });
  }

  get name(): string {
    return this.nameValue.trim().slice(0, 16) || 'Driver';
  }

  private saveName(v: string): void {
    this.nameValue = v;
    try {
      localStorage.setItem(NAME_KEY, this.name);
    } catch {
      /* ignore */
    }
  }

  /** Updates only the ping readout, so buttons and hover state are not rebuilt under the player's cursor. */
  setRtt(ms: number): void {
    if (this.rttEl) this.rttEl.textContent = ms ? `${ms} ms` : '';
  }

  /** The radio range switch: shared with everyone in a room, local when playing alone. */
  private signalRow(s: PanelState): HTMLElement {
    const label = document.createElement('label');
    label.className = 'rule';
    label.title = 'Cars lose control far from the base station unless a Relay truck carries the signal';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!s.signal;
    box.addEventListener('change', () => this.actions.setSignal(box.checked));
    const text = document.createElement('span');
    text.textContent = 'Radio range (needs a Relay)';
    label.append(box, text);
    return label;
  }

  render(s: PanelState): void {
    const root = this.root;
    root.replaceChildren();
    this.rttEl = null;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };

    if (s.status === 'off' || s.status === 'failed' || s.status === 'full') {
      root.append(el('b', 'Play with friends'));
      if (s.status === 'full') root.append(el('div', 'That room is full (4 players).', 'note'));
      if (s.status === 'failed') root.append(el('div', 'Could not connect. Check your connection and try again.', 'note'));
      const input = el('input');
      input.value = this.nameValue;
      input.maxLength = 16;
      input.placeholder = 'Your name';
      input.addEventListener('input', () => this.saveName(input.value));
      const start = el('button', 'Start a room');
      start.addEventListener('click', () => this.actions.start());
      root.append(input, start, this.signalRow(s));
      return;
    }

    if (s.status === 'connecting' || s.status === 'reconnecting') {
      root.append(el('b', s.status === 'connecting' ? 'Connecting...' : 'Reconnecting...'));
      return;
    }

    root.append(el('b', 'Room code'), el('div', s.code, 'code'));
    const copy = el('button', 'Copy invite link');
    copy.addEventListener('click', () => {
      const link = `${location.origin}/?room=${s.code}`;
      void navigator.clipboard?.writeText(link).then(
        () => (copy.textContent = 'Copied!'),
        () => (copy.textContent = link),
      );
      window.setTimeout(() => (copy.textContent = 'Copy invite link'), 1800);
    });
    const leave = el('button', 'Leave', 'ghost');
    leave.addEventListener('click', () => this.actions.leave());
    root.append(copy, leave);

    const list = el('ul');
    for (const p of s.players) {
      const li = el('li');
      const dot = el('span', '', 'dot');
      dot.style.background = `#${CARS[p.role].color.toString(16).padStart(6, '0')}`;
      const rtt = el('span', p.self && p.rtt ? `${p.rtt} ms` : '', 'rtt');
      if (p.self) this.rttEl = rtt;
      li.append(dot, el('span', p.self ? `${p.name} (you)` : p.name), rtt);
      list.append(li);
    }
    root.append(list, el('div', `${s.players.length} of ${s.max} drivers`, 'note'), this.signalRow(s));
    if (s.missions) {
      const box = el('div', '', 'missions');
      box.append(el('b', 'Missions'));
      const running = s.missions.list.find((m) => m.id === s.missions!.running);
      if (running) {
        box.append(el('div', `Running: ${running.name}`, 'note'));
        const abort = el('button', 'End the mission', 'ghost');
        abort.addEventListener('click', () => this.actions.abortMission());
        box.append(abort);
      } else {
        for (const m of s.missions.list) {
          const need = s.players.length < m.minPlayers;
          const b = el('button', need ? `${m.name} (needs ${m.minPlayers} players)` : `Start: ${m.name}`);
          b.disabled = need;
          b.addEventListener('click', () => this.actions.startMission(m.id));
          box.append(b);
        }
      }
      root.append(box);
    }
    if (s.lag) root.append(el('div', `Simulated lag: ${s.lag} ms each way`, 'note'));
  }
}
