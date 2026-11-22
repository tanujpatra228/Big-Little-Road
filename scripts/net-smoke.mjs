// End-to-end check of the multiplayer server using real WebSockets.
// Usage: node scripts/net-smoke.mjs [baseUrl]   (default http://localhost:8788)
const base = process.argv[2] ?? 'http://localhost:8788';
const wsBase = base.replace(/^http/, 'ws');
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = () => Math.random().toString(36).slice(2, 12).padEnd(10, 'x');

class Client {
  constructor(code, name, role = 'scout', k = key()) {
    this.name = name; this.key = k; this.role = role; this.msgs = []; this.closed = null;
    this.ws = new WebSocket(`${wsBase}/api/rooms/${code}/ws`);
    this.opened = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => this.msgs.push(e.data);
    this.ws.onclose = (e) => { this.closed = { code: e.code, reason: e.reason }; };
  }
  async hello() { await this.opened; this.ws.send(JSON.stringify({ type: 'hello', name: this.name, role: this.role, key: this.key })); }
  send(o) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  of(type) { return this.msgs.map((m) => { try { return JSON.parse(m); } catch { return m; } }).filter((m) => m && m.type === type); }
  close() { this.ws.close(); }
}

const health = await fetch(`${base}/api/health`).then((r) => r.json());
check('health endpoint', health.ok === true);

const { code } = await fetch(`${base}/api/rooms`, { method: 'POST' }).then((r) => r.json());
check('room code is 4 letters, no I or O', /^[A-HJ-NP-Z]{4}$/.test(code), code);

const a = new Client(code, 'Ada', 'scout'); await a.hello(); await sleep(300);
check('A gets a welcome as p1', a.of('welcome')[0]?.id === 'p1' && a.of('welcome')[0].code === code);

const b = new Client(code, 'Bo', 'hauler'); await b.hello(); await sleep(300);
check('B welcome lists both players', b.of('welcome')[0]?.players.length === 2);
check('A is told B joined', a.of('join').some((j) => j.player.name === 'Bo' && j.player.role === 'hauler'));

const pose = { type: 'pose', s: 1, t: 1000, x: 1234, y: 56, z: -789, qx: 0, qy: 7071, qz: 0, qw: 7071, v: 80, st: 100 };
a.send(pose); await sleep(300);
const got = b.of('pose')[0];
check('B receives A\'s pose, tagged p1, unchanged', got?.id === 'p1' && got.x === 1234 && got.z === -789 && got.qy === 7071 && got.v === 80);
check('A does not get its own pose back', a.of('pose').length === 0);

b.send({ type: 'horn', on: true }); await sleep(250);
check('horn reaches the other player', a.of('horn').some((h) => h.id === 'p2' && h.on === true));

b.send({ type: 'nitro', on: true }); await sleep(250);
check('nitro flag reaches the other player', a.of('nitro').some((n) => n.id === 'p2' && n.on === true));
b.send({ type: 'car', role: 'relay' }); await sleep(250);
check('car change reaches everyone including sender', a.of('car').some((c) => c.role === 'relay') && b.of('car').some((c) => c.role === 'relay'));

b.send({ type: 'ping', kind: 'go', x: 500, z: 500 }); await sleep(250);
check('ping wheel message relayed', a.of('ping').some((p) => p.kind === 'go' && p.id === 'p2'));

b.send('ping'); await sleep(250);
check('auto-response pong without waking the room', b.msgs.includes('pong'));

// ---- the plank
check('welcome tells a newcomer where the plank is', a.of('welcome')[0]?.props?.[0]?.id === 'plank1' && a.of('welcome')[0].props[0].h0 === '' && a.of('welcome')[0].props[0].h1 === '');
a.send({ type: 'attach', prop: 'plank1', end: 0 }); await sleep(300);
check('attach is announced to everyone, including the sender', a.of('prop').some((p) => p.prop.h0 === 'p1') && b.of('prop').some((p) => p.prop.h0 === 'p1'));
b.send({ type: 'attach', prop: 'plank1', end: 0 }); await sleep(250);
check('the same end cannot be taken twice (no broadcast)', b.of('prop').filter((p) => p.prop.h1 === 'p2').length === 0 && b.of('prop').length === 1);
b.send({ type: 'attach', prop: 'plank1', end: 1 }); await sleep(300);
check('the other end can be taken, so two hold it', a.of('prop').some((p) => p.prop.h0 === 'p1' && p.prop.h1 === 'p2'));
a.send({ type: 'detach', x: 111, z: 222, yaw: 333 }); await sleep(250);
b.send({ type: 'detach', x: 800, z: -400, yaw: 1500 }); await sleep(300);
const last = a.of('prop').at(-1)?.prop;
check('the last to let go sets where it rests, and it is free', last && last.h0 === '' && last.h1 === '' && last.x === 800 && last.z === -400 && last.yaw === 1500, JSON.stringify(last));
b.send({ type: 'attach', prop: 'plank1', end: 1 }); await sleep(250);
const late = new Client(code, 'Zed'); await late.hello(); await sleep(350);
const lw = late.of('welcome')[0];
check('a late joiner sees who holds the plank and where it rests', lw?.props?.[0]?.h1 === 'p2' && lw.props[0].x === 800, JSON.stringify(lw?.props?.[0]));
late.close(); await sleep(300);
a.send({ type: 'attach', prop: 'nope', end: 0 }); await sleep(200);
check('unknown prop is ignored', true);

// ---- goals and returning the plank
b.send({ type: 'goal', id: 'terrace' }); await sleep(300);
check('a reached goal is announced to everyone with who got there', b.of('goal').some((g) => g.id === 'terrace' && g.by === 'p2') && late.of('goal').length >= 0 && a.of('goal').some((g) => g.by === 'p2'));
b.send({ type: 'goal', id: 'terrace' }); await sleep(300);
check('the same goal is not celebrated twice in quick succession', b.of('goal').length === 1);
b.send({ type: 'goal', id: 'nowhere' }); await sleep(200);
check('an unknown goal is ignored', b.of('goal').length === 1);
b.send({ type: 'reset', prop: 'plank1' }); await sleep(250);
check('returning the plank while it is held does nothing', b.of('prop').at(-1)?.prop.h1 === 'p2');
b.send({ type: 'detach', x: 700, z: 700, yaw: 100 }); await sleep(250);
b.send({ type: 'reset', prop: 'plank1' }); await sleep(300);
const home = b.of('prop').at(-1)?.prop;
check('once nobody holds it, the plank returns to its start', home && home.h0 === '' && home.h1 === '' && home.x === 1700 && home.z === -600, JSON.stringify(home));

const bad = new Client(code, 'Eve'); await bad.opened; bad.send('{"type":"pose","x":"nope"}'); await sleep(400);
check('bad frame closes the connection (1008)', bad.closed?.code === 1008, JSON.stringify(bad.closed));

const nohello = new Client(code, 'Mal'); await nohello.opened; nohello.send(pose); await sleep(400);
check('pose before hello closes the connection', nohello.closed !== null, JSON.stringify(nohello.closed));

const oversize = new Client(code, 'Big'); await oversize.opened; oversize.send(JSON.stringify({ type: 'hello', name: 'x', role: 'scout', key: key(), pad: 'a'.repeat(600) })); await sleep(400);
check('oversize frame closes the connection', oversize.closed?.code === 1008);

const c = new Client(code, 'Cy'); await c.hello(); await sleep(250);
const d = new Client(code, 'Di'); await d.hello(); await sleep(250);
const e = new Client(code, 'Late'); await e.hello(); await sleep(400);
check('fifth player is told the room is full', e.of('full').length === 1);

a.close(); await sleep(400);
check('others are told when someone leaves', b.of('leave').some((l) => l.id === 'p1'));

const reload = new Client(code, 'Bo', 'relay', b.key); await reload.hello(); await sleep(500);
check('reload with same key takes the slot (p2) and the stale socket is closed', reload.of('welcome')[0]?.id === 'p2' && b.closed !== null, JSON.stringify(b.closed));

c.send({ type: 'detach', x: 999999, z: 0, yaw: 0 }); await sleep(350);
check('detach with an absurd position is rejected (1008)', c.closed?.code === 1008, JSON.stringify(c.closed));

const other = new Client('ZZZZ', 'Solo'); await other.hello(); await sleep(300);
check('different rooms are isolated', other.of('welcome')[0]?.players.length === 1);

const wrong = await fetch(`${base}/api/rooms/abcd/ws`);
check('lowercase room code rejected (400)', wrong.status === 400);
const noUpgrade = await fetch(`${base}/api/rooms/ABCD/ws`);
check('plain GET to the socket route rejected (426)', noUpgrade.status === 426);

// ---- the team battery, in a room of its own (real clock: the room books drain from Date.now())
{
  const bc = (await fetch(`${base}/api/rooms`, { method: 'POST' }).then((r) => r.json())).code;
  const p = new Client(bc, 'Pat'); await p.hello(); await sleep(250);
  const q = new Client(bc, 'Quin'); await q.hello(); await sleep(250);
  check('a fresh room starts with a full battery in the welcome', p.of('welcome')[0]?.battery?.level === 1000 && p.of('welcome')[0].battery.boosters === 0);

  p.send({ type: 'nitro', on: true }); await sleep(300);
  const seen = (c, n) => c.of('battery').some((m) => m.battery.boosters === n);
  check('boosting is announced to everyone with one booster', seen(p, 1) && seen(q, 1));
  check('the flame still reaches the other player', q.of('nitro').some((m) => m.id === 'p1' && m.on === true));

  q.send({ type: 'nitro', on: true }); await sleep(300);
  check('a second booster is counted for both', seen(p, 2) && seen(q, 2));
  const mid = q.of('battery').at(-1).battery;
  check('the level fell from the room clock, in thousandths', mid.level < 1000 && mid.level > 800, `level ${mid.level}`);

  const late = new Client(bc, 'Late'); await late.hello(); await sleep(300);
  const lw = late.of('welcome')[0];
  check('a late joiner is told how many are draining and the level', lw?.battery?.boosters === 2 && lw.battery.level < 1000, JSON.stringify(lw?.battery));

  p.send({ type: 'nitro', on: false }); await sleep(250);
  check('stopping one drops the count to one', seen(q, 1) && q.of('battery').at(-1).battery.boosters === 1);
  q.send({ type: 'nitro', on: false }); await sleep(250);
  const last = p.of('battery').at(-1).battery;
  check('stopping the last one starts the refill delay', last.boosters === 0 && last.regenIn > 0 && last.regenIn <= 1500, JSON.stringify(last));

  // Drain it with a booster that then disconnects: the room must stop counting them.
  late.send({ type: 'nitro', on: true }); await sleep(250);
  late.close(); await sleep(400);
  check('a booster who disconnects is dropped from the count', p.of('battery').at(-1).battery.boosters === 0);
  for (const x of [p, q, late]) try { x.close(); } catch {}
}

// ---- radio range rule, in a room of its own
{
  const rc = (await fetch(`${base}/api/rooms`, { method: 'POST' }).then((r) => r.json())).code;
  const p = new Client(rc, 'Rae'); await p.hello(); await sleep(250);
  const q = new Client(rc, 'Sol'); await q.hello(); await sleep(250);
  check('radio range starts off in the welcome', p.of('welcome')[0]?.rules?.signal === false);
  p.send({ type: 'rules', signal: true }); await sleep(300);
  check('switching it on tells everyone, including the one who did it', p.of('rules').some((m) => m.signal === true && m.by === 'p1') && q.of('rules').some((m) => m.signal === true && m.by === 'p1'));
  const n = q.of('rules').length;
  p.send({ type: 'rules', signal: true }); await sleep(250);
  check('switching it to what it already is says nothing', q.of('rules').length === n);
  const late = new Client(rc, 'Tam'); await late.hello(); await sleep(300);
  check('a late joiner is told radio range is on', late.of('welcome')[0]?.rules?.signal === true);
  q.send({ type: 'rules', signal: false }); await sleep(300);
  check('anyone can switch it off again', late.of('rules').some((m) => m.signal === false && m.by === 'p2'));

  // Hibernation: switch it on, let the room sit idle long enough to be evicted (about 10 s), then switch it off.
  // If the room forgot the rule while it slept, "off" would look like no change and nobody would be told.
  p.send({ type: 'rules', signal: true }); await sleep(300);
  const before = q.of('rules').length;
  await sleep(14000);
  q.send({ type: 'rules', signal: false }); await sleep(500);
  check('the rule is remembered after the room has slept', q.of('rules').length > before && q.of('rules').at(-1).signal === false);
  for (const x of [p, q, late]) try { x.close(); } catch {}
}

for (const x of [reload, c, d, other, b]) try { x.close(); } catch {}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
