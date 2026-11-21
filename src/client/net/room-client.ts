import type { CarRole } from '../../shared/cars';
import { quantizePose, type PoseState } from '../../shared/net/pose';
import { encode, parseServerMessage, type PingKind, type PlayerInfo, type PoseFrame } from '../../shared/net/protocol';

export type NetStatus = 'off' | 'connecting' | 'on' | 'reconnecting' | 'full' | 'failed';

export interface RoomHandlers {
  welcome(id: string, code: string, players: PlayerInfo[]): void;
  join(p: PlayerInfo): void;
  leave(id: string): void;
  /** `at` is performance.now() when the frame arrived. */
  pose(id: string, frame: PoseFrame, at: number): void;
  car(id: string, role: CarRole): void;
  horn(id: string, on: boolean): void;
  ping(id: string, kind: PingKind, x: number, z: number): void;
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

  private ws: WebSocket | null = null;
  private readonly key = tabKey();
  private wantOpen = false;
  private tries = 0;
  private seq = 0;
  private pingTimer: number | undefined;
  private pingSentAt = 0;

  constructor(
    private readonly h: RoomHandlers,
    private readonly who: { name(): string; role(): CarRole },
  ) {}

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
      ws.send(encode({ type: 'hello', name: this.who.name(), role: this.who.role(), key: this.key }));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.pingSentAt = performance.now();
          ws.send('ping'); // answered by the runtime without waking the room
        }
      }, 2000);
    };

    ws.onmessage = (e: MessageEvent<unknown>) => {
      if (e.data === 'pong') {
        this.rttMs = Math.round(performance.now() - this.pingSentAt);
        return;
      }
      const msg = parseServerMessage(e.data);
      if (!msg) return;
      switch (msg.type) {
        case 'welcome':
          this.selfId = msg.id;
          this.tries = 0;
          this.setStatus('on');
          this.h.welcome(msg.id, msg.code, msg.players);
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
        case 'ping':
          this.h.ping(msg.id, msg.kind, msg.x, msg.z);
          break;
        case 'full':
          this.wantOpen = false;
          this.setStatus('full');
          break;
        case 'error':
          break;
      }
    };

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

  private send(text: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || this.status !== 'on') return false;
    this.ws.send(text);
    return true;
  }

  sendPose(state: PoseState): void {
    this.send(encode({ type: 'pose', ...quantizePose(state, ++this.seq, performance.now()) }));
  }

  sendCar(role: CarRole): void {
    this.send(encode({ type: 'car', role }));
  }

  sendHorn(on: boolean): void {
    this.send(encode({ type: 'horn', on }));
  }

  sendPing(kind: PingKind, x: number, z: number): void {
    this.send(encode({ type: 'ping', kind, x: Math.round(x * 100), z: Math.round(z * 100) }));
  }
}
