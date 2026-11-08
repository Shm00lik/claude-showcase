// Usage: node tools/record-gameplay.mjs <repoDir> <outDir> <seconds>  (server must be running on :3000; NOCHROME=1 runs bots only)
// Gameplay recorder: 5 scripted ws bots + one real Chrome player driven by the same AI through CDP key events.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [repo, out, secs = '40'] = process.argv.slice(2).map((a, i) => (i < 2 ? path.resolve(a) : a));
const require = createRequire(repo + '/package.json');
const WebSocket = require('ws');
const F = await import(pathToFileURL(repo + '/shared/field.js'));
const URL0 = 'http://127.0.0.1:3000';
mkdirSync(out + '/frames', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

let state = null;
// AI: collect nearest fuel until `goal` held, then go to a spot 2.5 m from own hub (alliance-zone side), face it, shoot.
function brain(me, mem) {
  const now = Date.now();
  if (!mem.chk || now - mem.chk.t > 1200) {
    if (mem.chk && Math.hypot(me.x - mem.chk.x, me.y - mem.chk.y) < 0.08 && !mem.shooting) mem.unstick = now + 700;
    mem.chk = { t: now, x: me.x, y: me.y };
  }
  if (mem.unstick > now) return { fwd: -0.8, turn: 0.8, shoot: false };
  const hub = F.HUBS.find((h) => h.alliance === me.alliance), out = Math.sign(hub.x);
  if (me.held >= mem.goal || (mem.shooting && me.held > 0)) {
    if ((me.x - hub.x) * out < 0.3 && !mem.shooting) { // still on the neutral side: cross over the bump on our side
      const by = me.y >= 0 ? 1.5 : -1.5;
      if ((me.x - hub.x) * out < -0.9) return seek(me, hub.x - out * 1.0, by, false);
      return seek(me, hub.x + out * 1.2, by, false);
    }
    const ang = (out > 0 ? 0 : Math.PI) + mem.side;
    const tx = hub.x + Math.cos(ang) * 2.5, ty = hub.y + Math.sin(ang) * 2.5;
    if (Math.hypot(tx - me.x, ty - me.y) > 0.3 && !mem.shooting) return seek(me, tx, ty, false);
    mem.shooting = true;
    const d = Math.hypot(me.x - hub.x, me.y - hub.y);
    const e = wrap(Math.atan2(hub.y - me.y, hub.x - me.x) - me.h);
    return { fwd: Math.abs(e) < 0.3 && Math.abs(d - 2.5) > 0.2 ? Math.sign(d - 2.5) * 0.5 : 0, turn: Math.max(-1, Math.min(1, e * 3)), shoot: Math.abs(e) < 0.05 };
  }
  mem.shooting = false;
  let best = null, bd = 1e9;
  (state.fuel || []).forEach((b, i) => {
    if (!b || b[2] > 0.2 || Math.abs(b[0]) > 7) return;
    if ((b[0] - hub.x) * out > -0.7 && (b[0] - hub.x) * out < 0.7) return; // skip balls in the hub/bump column
    const c = mem.claimed.get(i);
    const d = Math.hypot(b[0] - me.x, b[1] - me.y) + (c && c !== me.id ? 3 : 0);
    if (d < bd) { bd = d; best = i; }
  });
  if (best == null) return { fwd: 0, turn: 0.5, shoot: false };
  mem.claimed.set(best, me.id);
  const b = state.fuel[best];
  return seek(me, b[0], b[1], true);
}
function seek(me, tx, ty, slow) {
  const e = wrap(Math.atan2(ty - me.y, tx - me.x) - me.h), d = Math.hypot(tx - me.x, ty - me.y);
  return { fwd: Math.abs(e) > 1.2 ? 0.15 : Math.min(1, slow ? 0.35 + d * 0.3 : 0.3 + d * 0.5), turn: Math.max(-1, Math.min(1, e * 2.5)), shoot: false };
}
const claimed = new Map();

// ---- bots ----
const bots = [['Hoot', 254, 'blue'], ['Volt', 1678, 'blue'], ['Gizmo', 118, 'red'], ['Rusty', 971, 'red'], ['Pixel', 2056, 'blue']];
for (const [i, [name, team, alliance]] of bots.entries()) {
  const ws = new WebSocket(URL0.replace('http', 'ws') + '/ws', { origin: URL0 });
  const mem = { goal: 3 + (i % 3) * 2, side: (i % 2 ? 0.5 : -0.5), claimed };
  let id = null;
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, team, alliance })));
  ws.on('close', (c) => console.log('bot closed', name, c));
  setInterval(() => { const me = state?.robots.find((r) => r.id === id); if (me && ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', ...brain(me, mem) })); }, 50);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') id = m.id;
    if (m.t === 'state') state = m;
    if (m.t === 'reject') console.log('reject', name, m);
  });
  await sleep(150);
}

if (process.env.NOCHROME) { const t1 = Date.now(); setInterval(() => console.log(Math.round((Date.now()-t1)/1000)+'s', JSON.stringify(state?.score), state?.robots.map(r => r.name+':'+r.held+'@'+r.x.toFixed(1)+','+r.y.toFixed(1)).join(' ')), 3000); setTimeout(() => process.exit(), +secs*1000); await new Promise(() => {}); }
// ---- chrome ----
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--remote-debugging-port=9333', `--user-data-dir=${out}/profile`, '--window-size=1280,800', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', `--app=${URL0}`], { stdio: 'ignore' });
let target;
for (let k = 0; k < 50 && !target; k++) {
  await sleep(300);
  try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch {}
}
const cdp = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => cdp.on('open', r));
let seq = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); cdp.send(JSON.stringify({ id, method, params })); });
const frames = [];
cdp.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Page.screencastFrame') {
    const n = frames.length; frames.push(m.params.metadata.timestamp);
    writeFileSync(`${out}/frames/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(m.params.data, 'base64'));
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  }
});
const ev = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }).then((r) => r?.result?.value);
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
for (let k = 0; k < 200 && !(await ev(`!document.getElementById('drive').disabled`)); k++) await sleep(250);
await ev(`document.getElementById('name').value='You';document.getElementById('team').value='5990';document.querySelector('input[name=alliance][value=red]').checked=true;document.getElementById('drive').click();true`).then((r) => console.log('click ->', r));
await sleep(1000); console.log('msg:', await ev(`document.getElementById('msg').textContent + ' | ws? ' + document.getElementById('drive').disabled`));
await sleep(1500);

const KEYS = { w: ['KeyW', 87, 'w'], s: ['KeyS', 83, 's'], a: ['KeyA', 65, 'a'], d: ['KeyD', 68, 'd'], ' ': ['Space', 32, ' '], c: ['KeyC', 67, 'c'] };
const down = new Set();
const key = (k, on) => { if (on === down.has(k)) return; on ? down.add(k) : down.delete(k); const [code, kc, key] = KEYS[k]; return send('Input.dispatchKeyEvent', { type: on ? 'keyDown' : 'keyUp', code, key, windowsVirtualKeyCode: kc, text: on && k === ' ' ? ' ' : undefined }); };
const tap = async (k) => { await key(k, true); await sleep(60); await key(k, false); };

const t0 = Date.now(); await send('Page.bringToFront'); writeFileSync(out + '/joined.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); console.log('hud hidden?', await ev(`document.getElementById('hud')?.hidden`), target.url);
setInterval(() => console.log(Math.round((Date.now()-t0)/1000)+'s', JSON.stringify(state?.score), state?.robots.map(r => r.name+':'+r.held+'@'+r.x.toFixed(1)+','+r.y.toFixed(1)).join(' '), 'frames', frames.length), 5000);
await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
const mem = { goal: 6, side: 0, claimed };
const dur = +secs * 1000;
const camAt = [dur * 0.55, dur * 0.8]; let cams = 0;
while (Date.now() - t0 < dur) {
  const me = state?.robots.find((r) => r.name === 'You');
  if (me) {
    const c = brain(me, mem);
    await key('w', c.fwd > 0.25); await key('s', c.fwd < -0.25);
    await key('a', c.turn > 0.3); await key('d', c.turn < -0.3); await key(' ', c.shoot);
  }
  if (cams < camAt.length && Date.now() - t0 > camAt[cams]) { cams++; await tap('c'); }
  await sleep(40);
}
await send('Page.stopScreencast');
writeFileSync(`${out}/frames.json`, JSON.stringify(frames));
console.log('frames', frames.length, 'score', JSON.stringify(state?.score));
spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F']); await sleep(500); process.exit(0);
