import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { WebSocket } from 'ws';
import { start } from '../server/index.js';

let srv, port;
before(async () => { srv = await start({ port: 0, quiet: true }); port = srv.port; });
after(() => srv.close());

const origin = `http://127.0.0.1:`;
function client(headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: headers ?? { Origin: origin + port } });
    const msgs = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()); msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    });
    const c = {
      ws, msgs,
      send: (o) => ws.send(JSON.stringify(o)),
      next: (pred) => new Promise((res, rej) => {
        const hit = msgs.find(pred);
        if (hit) return res(hit);
        waiters.push({ pred, res });
        setTimeout(() => rej(new Error('timeout waiting for message')), 3000).unref();
      }),
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('unexpected-response', (_q, r) => reject(new Error('status ' + r.statusCode)));
  });
}
const join = async (c, name, alliance) => {
  c.send({ t: 'join', name, team: 254, alliance });
  return (await c.next((m) => m.t === 'welcome' || m.t === 'reject'));
};
const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { r.resume(); r.on('end', () => res(r.statusCode)); }).on('error', rej));

test('two clients: input from one is seen by the other', { timeout: 10000 }, async () => {
  const a = await client(), b = await client();
  const wa = await join(a, 'Alice', 'blue');
  const wb = await join(b, 'Bob', 'red');
  assert.equal(wa.t, 'welcome'); assert.equal(wb.t, 'welcome');
  const pose = (c) => c.msgs.filter((m) => m.t === 'state').map((m) => m.robots.find((r) => r.id === wa.id)).filter(Boolean);
  await b.next((m) => m.t === 'state' && m.robots.length === 2);
  const start0 = pose(b)[0];
  const iv = setInterval(() => a.send({ t: 'input', fwd: 1, turn: 0 }), 50);
  try {
    await b.next((m) => m.t === 'state' && Math.hypot(m.robots.find((r) => r.id === wa.id).x - start0.x, m.robots.find((r) => r.id === wa.id).y - start0.y) > 0.2);
  } finally { clearInterval(iv); }
  a.ws.close(); b.ws.close();
});

test('alliance_full on 4th red; invalid join rejected', { timeout: 10000 }, async () => {
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = await client(); cs.push(c); assert.equal((await join(c, 'r' + i, 'red')).t, 'welcome'); }
  const d = await client();
  assert.deepEqual(await join(d, 'late', 'red'), { t: 'reject', reason: 'alliance_full' });
  const e = await client();
  e.send({ t: 'join', name: '   ', team: 1, alliance: 'red' });
  assert.deepEqual(await e.next((m) => m.t === 'reject'), { t: 'reject', reason: 'invalid' });
  for (const c of [...cs, d, e]) c.ws.close();
});

test('path traversal gets 404, static works', { timeout: 5000 }, async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/shared/../../package.json', '/vendor/three/../../package.json', '/%00'])
    assert.equal(await get(p), 404, p);
  assert.equal(await get('/shared/field.js'), 200);
  assert.equal(await get('/vendor/three/package.json'), 200);
});

test('bad or missing Origin and wrong path are rejected', { timeout: 5000 }, async () => {
  await assert.rejects(client({ Origin: 'http://evil.example' }));
  await assert.rejects(client({}));
  await assert.rejects(new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other`, { headers: { Origin: origin + port } });
    ws.on('open', res); ws.on('error', rej);
  }));
});

test('13th socket is refused before handshake and cannot crash the server', { timeout: 10000 }, async () => {
  const cs = [];
  for (let i = 0; i < 12; i++) cs.push(await client());
  const reply = await new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin + port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
      setTimeout(() => s.write(Buffer.from([0x81, 0x01, 0x78])), 200); // unmasked frame
    });
    let buf = '';
    s.on('data', (d) => { buf += d; });
    s.on('error', () => {});
    s.on('close', () => resolve(buf));
    setTimeout(() => reject(new Error('socket stayed open')), 3000).unref();
  });
  assert.ok(!reply.includes('101'), 'handshake must be refused');
  assert.equal(await get('/shared/field.js'), 200, 'server still alive');
  for (const c of cs) c.ws.close();
});
