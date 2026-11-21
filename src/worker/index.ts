import { ROOM_CODE } from '../shared/net/protocol';
import { Room, type Env } from './room';

export { Room };

// Letters that read clearly aloud and on screen: no I or O.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}

/** Runs only for /api/*. Game files are static assets and never touch this. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', CODE, 'ws']

    if (url.pathname === '/api/health') return Response.json({ ok: true, game: 'big-little-road' });

    if (request.method === 'POST' && url.pathname === '/api/rooms') return Response.json({ code: newCode() });

    if (parts[0] === 'api' && parts[1] === 'rooms' && parts[3] === 'ws' && parts.length === 4) {
      const code = parts[2] ?? '';
      if (!ROOM_CODE.test(code)) return new Response('Bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
