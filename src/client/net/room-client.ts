import type { CarRole } from '../../shared/cars';
import { quantizePose, type PoseState } from '../../shared/net/pose';
import { encode, parseServerMessage, type PingKind, type PlayerInfo, type PoseFrame } from '../../shared/net/protocol';
import type { PropInfo } from '../../shared/net/props';

export type NetStatus = 'off' | 'connecting' | 'on' | 'reconnecting' | 'full' | 'failed';

export interface RoomHandlers {
  welcome(id: string, code: string, players: PlayerInfo[], props: PropInfo[]): void;
  join(p: PlayerInfo): void;
  leave(id: string): void;
  /** `at` is performance.now() when the frame arrived. */
  pose(id: string, frame: PoseFrame, at: number): void;
  car(id: string, role: CarRole): void;
  horn(id: string, on: boolean): void;
  nitro(id: string, on: boolean): void;
  ping(id: string, kind: PingKind, x: number, z: number): void;
  prop(p: PropInfo): void;
  goal(id: string, by: string): void;
  status(s: NetStatus): void;
}

const KEY_STORAGE = 'blr-key';

/** Per-tab secret: lets a reload or a dropped connection take the same slot back. */
function tabKey(): string {
  try {
    let k = sessionStorage.getItem(KEY_STORAGE);
    if (!k) {
      k = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      sessionStorage.setItem(KEY_STORAGE, k);
    }
    return k;
  } catch {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  }
}

/** The WebSocket side of multiplayer. Knows nothing about rendering or physics. */
export class RoomClient {
  status: NetStatus = 'off';
  code = '';
  selfId = '';
  rttMs = 0;
  /** Simulated one-way delay in ms, from ?lag=. Lets you feel a slow link on a fast one. */
  readonly lagMs: number;
  private readonly jitterMs: number;

  private ws: WebSocket | null = null;
  private readonly key = tabKey();
  private wantOpen = false;
  private tries = 0;
  private seq = 0;
  private pingTimer: number | undefined;
  private pingSentAt = 0;
  private lastOut = 0;
  private lastIn = 0;

  constructor(
    private readonly h: RoomHandlers,
    private readonly who: { name(): string; role(): CarRole },
  ) {
    const q = new URLSearchParams(location.search);
    this.lagMs = Math.min(1500, Math.max(0, Number(q.get('lag')) || 0));
    this.jitterMs = Math.min(500, Math.max(0, Number(q.get('jitter')) || 0));
  }

  /** Runs `fn` after the simulated delay, keeping messages in order. */
  private delayed(dir: 'in' | 'out', fn: () => void): void {
    if (this.lagMs <= 0) {
      fn();
      return;
    }
    const now = performance.now();
    const last = dir === 'in' ? this.lastIn : this.lastOut;
    const due = Math.max(last, now + this.lagMs + Math.random() * this.jitterMs);
    if (dir === 'in') this.lastIn = due;
    else this.lastOut = due;
    window.setTimeout(fn, due - now);
  }

  /** Ask the server for a fresh room code. */
  async create(): Promise<string> {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error(`create failed: ${res.status}`);
    return ((await res.json()) as { code: string }).code;
  }

  connect(code: string): void {
    this.wantOpen = true;
    this.code = code;
    this.tries = 0;
    this.open();
  }

  leave(): void {
    this.wantOpen = false;
    window.clearInterval(this.pingTimer);
    this.ws?.close(1000, 'leaving');
    this.ws = null;
    this.selfId = '';
    this.setStatus('off');
  }

  private setStatus(s: NetStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.h.status(s);
  }

  private open(): void {
    this.setStatus(this.tries === 0 ? 'connecting' : 'reconnecting');
    const url = `${location.origin.replace(/^http/, 'ws')}/api/rooms/${this.code}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.delayed('out', () => ws.readyState === WebSocket.OPEN && ws.send(encode({ type: 'hello', name: this.who.name(), role: this.who.role(), key: this.key })));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.pingSentAt = performance.now();
          this.delayed('out', () => ws.readyState === WebSocket.OPEN && ws.send('ping')); // answered by the runtime without waking the room
        }
      }, 2000);
    };

    ws.onmessage = (e: MessageEvent<unknown>) => this.delayed('in', () => this.handle(e.data));

    ws.onclose = (e) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return; // an old socket
      this.ws = null;
      if (!this.wantOpen) return;
      // Taken over by another tab with the same key, or kicked for bad behaviour: do not fight it.
      if (e.reason === 'replaced' || e.reason === 'rate limit') {
        this.wantOpen = false;
        this.setStatus('off');
        return;
      }
      if (this.tries >= 5) {
        this.wantOpen = false;
        this.setStatus('failed');
        return;
      }
      const delay = 500 * 2 ** this.tries++;
      this.setStatus('reconnecting');
      window.setTimeout(() => this.wantOpen && this.open(), delay);
    };
  }

  private handle(data: unknown): void {
    if (data === 'pong') {
      this.rttMs = Math.round(performance.now() - this.pingSentAt);
      return;
    }
    const msg = parseServerMessage(data);
    if (!msg) return;
    switch (msg.type) {
      case 'welcome':
        this.selfId = msg.id;
        this.tries = 0;
        this.setStatus('on');
        this.h.welcome(msg.id, msg.code, msg.players, msg.props ?? []);
        break;
      case 'join':
        this.h.join(msg.player);
        break;
      case 'leave':
        this.h.leave(msg.id);
        break;
      case 'pose': {
        const { type: _t, id, ...frame } = msg;
        this.h.pose(id, frame, performance.now());
        break;
      }
      case 'car':
        this.h.car(msg.id, msg.role);
        break;
      case 'horn':
        this.h.horn(msg.id, msg.on);
        break;
      case 'nitro':
        this.h.nitro(msg.id, msg.on);
        break;
      case 'ping':
        this.h.ping(msg.id, msg.kind, msg.x, msg.z);
        break;
      case 'prop':
        this.h.prop(msg.prop);
        break;
      case 'goal':
        this.h.goal(msg.id, msg.by);
        break;
      case 'full':
        this.wantOpen = false;
        this.setStatus('full');
        break;
      case 'error':
        break;
    }
  }

  private send(text: string): boolean {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN || this.status !== 'on') return false;
    this.delayed('out', () => ws.readyState === WebSocket.OPEN && ws.send(text));
    return true;
  }

  sendPose(state: PoseState): void {
    this.send(encode({ type: 'pose', ...quantizePose(state, ++this.seq, performance.now()) }));
  }

  sendCar(role: CarRole): void {
    this.send(encode({ type: 'car', role }));
  }

  sendNitro(on: boolean): void {
    this.send(encode({ type: 'nitro', on }));
  }

  sendHorn(on: boolean): void {
    this.send(encode({ type: 'horn', on }));
  }

  sendPing(kind: PingKind, x: number, z: number): void {
    this.send(encode({ type: 'ping', kind, x: Math.round(x * 100), z: Math.round(z * 100) }));
  }

  sendAttach(prop: string, end: 0 | 1): void {
    this.send(encode({ type: 'attach', prop, end }));
  }

  sendGoal(id: string): void {
    this.send(encode({ type: 'goal', id }));
  }

  sendReset(prop: string): void {
    this.send(encode({ type: 'reset', prop }));
  }

  /** Let go of whatever we hold, reporting where we saw it (used if nobody else holds it). */
  sendDetach(x: number, z: number, yaw: number): void {
    this.send(encode({ type: 'detach', x: Math.round(x * 100), z: Math.round(z * 100), yaw: Math.round(yaw * 1000) }));
  }
}
