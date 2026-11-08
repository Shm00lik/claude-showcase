import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { FIELD, ROBOT, OBSTACLES, SPAWNS, FUEL, FUEL_START, HUBS, SHOOTER } from '../shared/field.js';
import { isLanAddress, originAllowed, hostAllowed } from './lan.js';
import { createWorld, addRobot, removeRobot, setInput, respawn, step, snapshot, DT } from './sim.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [ // longest prefix first; '/' last
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const MAX_SOCKETS = 12, JOIN_TIMEOUT_MS = 5000, MAX_MSGS_PER_S = 60, MAX_BUFFERED = 64 * 1024;

async function serveStatic(req, res) {
  const notFound = () => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]); } catch { return notFound(); }
  if (p.includes('\0') || !p.startsWith('/')) return notFound();
  const [prefix, root] = ROOTS.find(([pre]) => p.startsWith(pre));
  let file = path.resolve(root, '.' + path.sep + p.slice(prefix.length));
  if (file !== root && !file.startsWith(root + path.sep)) return notFound();
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { notFound(); }
}

const validName = (n) => {
  if (typeof n !== 'string') return null;
  const t = n.trim();
  const len = [...t].length;
  return len >= 1 && len <= 16 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(t) ? t : null;
};

export function start({ port = Number(process.env.PORT) || 3000, quiet = false, isLan = isLanAddress } = {}) {
  const world = createWorld({ field: FIELD, robot: ROBOT, obstacles: OBSTACLES, spawns: SPAWNS, fuel: FUEL, fuelStart: FUEL_START, hubs: HUBS, shooter: SHOOTER });
  const server = http.createServer((req, res) => {
    if (!isLan(req.socket.remoteAddress) || !hostAllowed(req)) { res.writeHead(403); return res.end('LAN only'); }
    serveStatic(req, res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (!isLan(req.socket.remoteAddress) || !hostAllowed(req) || pathname !== '/ws' || !originAllowed(req) || wss.clients.size >= MAX_SOCKETS) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.on('error', () => {});
    let id = null, missed = 0, msgs = 0, lastRespawn = 0;
    const reject = (reason) => { ws.send(JSON.stringify({ t: 'reject', reason })); ws.close(); };
    const joinTimer = setTimeout(() => { if (!id) ws.close(); }, JOIN_TIMEOUT_MS);
    const rateTimer = setInterval(() => { msgs = 0; }, 1000);
    const pingTimer = setInterval(() => {
      if (missed >= 2) return ws.terminate();
      missed++;
      ws.ping();
    }, 2000);
    ws.on('pong', () => { missed = 0; });
    ws.on('close', () => {
      clearTimeout(joinTimer); clearInterval(rateTimer); clearInterval(pingTimer);
      if (id) removeRobot(world, id);
    });
    ws.on('message', (data, isBinary) => {
      if (++msgs > MAX_MSGS_PER_S) return ws.close();
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') {
        if (id) return;
        const name = validName(m.name);
        if (!name || !Number.isInteger(m.team) || m.team < 1 || m.team > 99999 || (m.alliance !== 'red' && m.alliance !== 'blue')) return reject('invalid');
        const nid = randomUUID();
        if (!addRobot(world, { id: nid, name, team: m.team, alliance: m.alliance })) return reject('alliance_full');
        id = nid;
        ws.send(JSON.stringify({ t: 'welcome', id }));
      } else if (!id) {
        return;
      } else if (m.t === 'input') {
        setInput(world, id, m.fwd, m.turn, m.shoot);
      } else if (m.t === 'respawn') {
        const now = Date.now();
        if (now - lastRespawn < 1000) return;
        lastRespawn = now;
        respawn(world, id);
      }
    });
  });

  let acc = 0, last = performance.now(), tick = 0, lastSent = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) / 1000, 0.25);
    last = now;
    let stepped = false;
    while (acc >= DT) {
      acc -= DT;
      step(world, DT);
      stepped = true;
      tick++;
    }
    if (stepped && tick - lastSent >= 2) { lastSent = tick; broadcast(now); } // one snapshot per interval, even after catch-up
  }, 1000 / 60);
  function broadcast(now) {
    const msg = JSON.stringify({ t: 'state', ...snapshot(world), time: Math.round(now) });
    for (const c of wss.clients) if (c.readyState === 1 && c.bufferedAmount <= MAX_BUFFERED) c.send(msg);
  }

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const actual = server.address().port;
      if (!quiet) {
        console.log('FRC sim listening. LAN URLs:');
        for (const list of Object.values(os.networkInterfaces()))
          for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${actual}`);
      }
      resolve({
        port: actual,
        close: () => new Promise((r) => {
          clearInterval(loop);
          for (const c of wss.clients) c.terminate();
          server.close(() => r());
          server.closeAllConnections();
        }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
