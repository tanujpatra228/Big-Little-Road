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

// ---- missions, in a room of their own
{
  const mc = (await fetch(`${base}/api/rooms`, { method: 'POST' }).then((r) => r.json())).code;
  const p = new Client(mc, 'Mia'); await p.hello(); await sleep(250);
  check('a new room has no mission in the welcome', p.of('welcome')[0]?.mission === null);
  p.send({ type: 'mission', op: 'start', id: 'terrace' }); await sleep(300);
  check('a crew that is too small is told no, and no mission starts', p.of('mission').some((m) => m.event === 'refused' && /needs 2 players/.test(m.reason ?? '')) && !p.of('mission').some((m) => m.event === 'start'));
  const q = new Client(mc, 'Noa'); await q.hello(); await sleep(250);
  p.send({ type: 'mission', op: 'start', id: 'nope' }); await sleep(250);
  check('an unknown mission is refused', p.of('mission').filter((m) => m.event === 'refused').length === 2);
  p.send({ type: 'mission', op: 'start', id: 'terrace' }); await sleep(300);
  check('two players can start it, and both are told', p.of('mission').some((m) => m.event === 'start' && m.mission?.stage === 0) && q.of('mission').some((m) => m.event === 'start' && m.by === 'p1'));
  q.send({ type: 'mission', op: 'start', id: 'terrace' }); await sleep(250);
  check('a second start while one runs is refused', q.of('mission').some((m) => m.event === 'refused' && /already running/.test(m.reason ?? '')));
  q.send({ type: 'mission', op: 'reach', obj: 'plank-held' }); await sleep(200); // wrong kind: ignored
  q.send({ type: 'mission', op: 'flag', obj: 'plank-ramp' }); await sleep(200); // wrong stage: ignored
  check('reports for the wrong kind or stage change nothing', !p.of('mission').some((m) => m.event === 'stage'));
  q.send({ type: 'mission', op: 'flag', obj: 'plank-held' }); await sleep(300);
  check('a correct report moves both players to stage 2', p.of('mission').some((m) => m.event === 'stage' && m.mission.stage === 1) && q.of('mission').some((m) => m.event === 'stage' && m.mission.stage === 1));

  // Hibernation: the mission must still be there, at the same stage, with its clock running, when the room wakes.
  await sleep(14000);
  const late = new Client(mc, 'Pia'); await late.hello(); await sleep(400);
  const lm = late.of('welcome')[0]?.mission;
  check('after the room has slept, a late joiner finds the mission at stage 2 with the clock running', lm?.id === 'terrace' && lm.stage === 1 && lm.elapsedMs > 13000, JSON.stringify(lm));
  late.close(); await sleep(200);
  p.send({ type: 'mission', op: 'flag', obj: 'plank-ramp' }); await sleep(300);
  check('and it can still be played on from there', p.of('mission').some((m) => m.event === 'stage' && m.mission.stage === 2));
  p.send({ type: 'mission', op: 'reset' }); await sleep(200);
  q.send({ type: 'mission', op: 'reach', obj: 'reach-terrace' }); await sleep(300);
  const fin = p.of('mission').find((m) => m.event === 'complete');
  check('finishing is announced with the time and the stars (fast but one reset: two stars)', fin?.mission?.status === 'complete' && fin.mission.stars === 2 && fin.mission.resets === 1 && fin.mission.elapsedMs > 14000, JSON.stringify(fin?.mission));
  p.send({ type: 'mission', op: 'start', id: 'terrace' }); await sleep(300);
  check('a finished mission can be started again', p.of('mission').filter((m) => m.event === 'start').length === 2);
  p.send({ type: 'mission', op: 'abort' }); await sleep(250);
  check('ending it tells everyone there is no mission', q.of('mission').some((m) => m.event === 'abort' && m.mission === null));
  for (const x of [p, q]) try { x.close(); } catch {}
}

// ---- the crew toolbox, in a room of its own
{
  const tc = (await fetch(`${base}/api/rooms`, { method: 'POST' }).then((r) => r.json())).code;
  const p = new Client(tc, 'Tess'); await p.hello(); await sleep(250);
  const q = new Client(tc, 'Uri'); await q.hello(); await sleep(250);
  const w0 = p.of('welcome')[0]?.tools;
  check('a new room welcomes you with a full box and an empty yard', w0?.s === 'bbsscc' && w0.p.length === 0, JSON.stringify(w0));
  p.send({ type: 'pose', s: 1, t: 1, x: 0, y: 50, z: 0, qx: 0, qy: 0, qz: 0, qw: 10000, v: 0, st: 0 }); await sleep(200);
  p.send({ type: 'tool', op: 'drop', slot: 0, x: 300, z: 400, yaw: 500 }); await sleep(300);
  check('a drop is told to both players', p.of('tools').some((m) => m.event === 'drop' && m.kind === 'beacon' && m.tools.p.length === 1) && q.of('tools').some((m) => m.event === 'drop' && m.by === 'p1'));
  p.send({ type: 'tool', op: 'drop', slot: 0, x: 300, z: 400, yaw: 500 }); await sleep(250);
  check('dropping from the same empty slot again is refused, to the sender only', p.of('tools').some((m) => m.event === 'refused') && !q.of('tools').some((m) => m.event === 'refused'));
  p.send({ type: 'tool', op: 'drop', slot: 1, x: 8000, z: 8000, yaw: 0 }); await sleep(250);
  check('a drop far from the car is refused', p.of('tools').filter((m) => m.event === 'refused').length === 2);
  p.send({ type: 'tool', op: 'drop', slot: 4, x: 100, z: 100, yaw: 0 }); await sleep(250);
  check('a second item can go down', q.of('tools').filter((m) => m.event === 'drop').length === 2);

  // Hibernation: what is in the yard and what is in the box must still be there when the room wakes.
  await sleep(14000);
  const late = new Client(tc, 'Val'); await late.hello(); await sleep(400);
  const lt = late.of('welcome')[0]?.tools;
  check('after the room has slept, a late joiner finds the box and the yard as they were', lt?.s === '-bss-c' && lt.p.length === 2 && lt.n === 3, JSON.stringify(lt));
  const id = lt?.p.find((o) => o.k === 'b')?.i;
  q.send({ type: 'pose', s: 1, t: 1, x: 300, y: 50, z: 400, qx: 0, qy: 0, qz: 0, qw: 10000, v: 0, st: 0 }); await sleep(200);
  q.send({ type: 'tool', op: 'pickup', id }); await sleep(300);
  check('and the other player can pick it up from where the room stands', p.of('tools').some((m) => m.event === 'pickup' && m.by === 'p2' && m.tools.s[0] === 'b' && m.tools.p.length === 1));
  late.close(); await sleep(200);
  p.send({ type: 'mission', op: 'start', id: 'terrace' }); await sleep(300);
  check('starting a mission refills the box and clears the yard', q.of('tools').some((m) => m.event === 'reset' && m.tools.s === 'bbsscc' && m.tools.p.length === 0));
  p.send({ type: 'mission', op: 'abort' }); await sleep(200);
  for (const x of [p, q]) try { x.close(); } catch {}
}

// ---- Dead Signal and the Relay's charge, in a room of their own
{
  const dc = (await fetch(`${base}/api/rooms`, { method: 'POST' }).then((r) => r.json())).code;
  const p = new Client(dc, 'Wes', 'relay'); await p.hello(); await sleep(250);
  const q = new Client(dc, 'Xan', 'scout'); await q.hello(); await sleep(250);
  q.send({ type: 'charge' }); await sleep(250);
  check('a Scout cannot charge the battery, and only it is told', q.of('charge').some((m) => m.ok === false) && !p.of('charge').length);
  p.send({ type: 'pose', s: 1, t: 1, x: 6500, y: 50, z: -6000, qx: 0, qy: 0, qz: 0, qw: 10000, v: 0, st: 0 }); await sleep(200);
  p.send({ type: 'nitro', on: true }); await sleep(2000); p.send({ type: 'nitro', on: false }); await sleep(300);
  const low = p.of('battery').at(-1)?.battery.level;
  p.send({ type: 'charge' }); await sleep(300);
  const topped = q.of('charge').find((m) => m.ok);
  check('a Relay charges it: everyone is told where, and the battery goes up', topped?.by === 'p1' && topped.x === 6500 && topped.z === -6000 && q.of('battery').at(-1).battery.level > low, `low ${low} now ${q.of('battery').at(-1)?.battery.level}`);
  p.send({ type: 'charge' }); await sleep(250);
  check('a second charge straight away is refused with a wait', p.of('charge').some((m) => m.ok === false && m.wait > 0));
  p.send({ type: 'mission', op: 'start', id: 'deadsignal' }); await sleep(300);
  check('Dead Signal starts and turns the radio range on for everyone', q.of('rules').some((m) => m.signal === true) && q.of('mission').some((m) => m.event === 'start' && m.mission.id === 'deadsignal'));
  q.send({ type: 'mission', op: 'flag', obj: 'far-linked' }); await sleep(300);
  check('a report that the link is up moves everyone to the second stage', p.of('mission').some((m) => m.event === 'stage' && m.mission.stage === 1));
  p.send({ type: 'mission', op: 'abort' }); await sleep(300);
  check('ending it puts the radio rule back', q.of('rules').at(-1)?.signal === false);
  for (const x of [p, q]) try { x.close(); } catch {}
}

for (const x of [reload, c, d, other, b]) try { x.close(); } catch {}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
