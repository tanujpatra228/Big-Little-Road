import { DurableObject } from 'cloudflare:workers';
import { encode, parseClientMessage, ROOM_CODE } from '../shared/net/protocol';
import { RoomLogic, type Result, type SavedPlayer } from '../shared/net/room-logic';
import type { PropState } from '../shared/net/props';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

interface Attachment {
  conn: string;
}

const MAX_SOCKETS = 12; // players plus a few stragglers; stops a flood of idle connections

/**
 * One room = one Durable Object. A thin shell around RoomLogic: it validates frames, feeds the state
 * machine, and sends what it returns. WebSocket hibernation means an idle room costs nothing.
 * Nothing runs on a timer, so there are no alarm requests. Poses are never written to storage.
 */
export class Room extends DurableObject<Env> {
  private logic: RoomLogic | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the room, and free of charge.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = new URL(request.url).pathname.split('/')[3] ?? '';
    if (!ROOM_CODE.test(code)) return new Response('Bad room code', { status: 400 });
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('Room is busy', { status: 429 });

    if (!this.logic) await this.ensureLogic(code);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ conn: crypto.randomUUID() } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Rebuild the room after hibernation, or start a fresh one. */
  private async ensureLogic(code?: string): Promise<RoomLogic | null> {
    if (this.logic) return this.logic;
    const storedCode = code ?? (await this.ctx.storage.get<string>('code'));
    if (!storedCode) return null;
    if (code) await this.ctx.storage.put('code', code);
    const saved = (await this.ctx.storage.get<SavedPlayer[]>('players')) ?? [];
    const live = this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment | null)?.conn ?? '');
    const props = (await this.ctx.storage.get<PropState[]>('props')) ?? [];
    this.logic = RoomLogic.restore(storedCode, saved, live, Date.now(), props);
    return this.logic;
  }

  private async persist(): Promise<void> {
    if (!this.logic) return;
    await this.ctx.storage.put({ players: this.logic.save(), props: this.logic.saveProps() });
  }

  private dispatch(result: Result): void {
    const sockets = new Map<string, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) sockets.set(att.conn, ws);
    }
    for (const { to, msg } of result.out) {
      const text = encode(msg);
      for (const [conn, ws] of sockets) {
        const hit = to === 'all' || ('conn' in to && to.conn === conn) || ('except' in to && to.except !== conn);
        if (!hit) continue;
        try {
          ws.send(text);
        } catch {
          /* that socket is going away; its close handler will clean up */
        }
      }
    }
    for (const { conn, reason } of result.close) {
      try {
        sockets.get(conn)?.close(1008, reason);
      } catch {
        /* already closed */
      }
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || typeof message !== 'string') {
      ws.close(1003, 'text frames only');
      return;
    }
    const msg = parseClientMessage(message);
    if (!msg) {
      ws.close(1008, 'bad frame');
      return;
    }
    const logic = await this.ensureLogic();
    if (!logic) {
      ws.close(1011, 'room not ready');
      return;
    }
    const now = Date.now();
    const result = msg.type === 'hello' ? logic.hello(att.conn, msg, now) : logic.message(att.conn, msg, now);
    this.dispatch(result);
    if (msg.type === 'hello' || msg.type === 'car' || msg.type === 'attach' || msg.type === 'detach' || msg.type === 'reset') await this.persist();
  }

  override async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.drop(ws);
    try {
      ws.close(code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1000, 'bye');
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.drop(ws);
  }

  private async drop(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    const logic = await this.ensureLogic();
    if (!att || !logic) return;
    const result = logic.close(att.conn, Date.now());
    this.dispatch(result);
    if (result.out.length) await this.persist(); // players or a released prop changed
  }
}
