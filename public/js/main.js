import { FIELD_MODEL, ROBOT_MODEL, FUEL } from '/shared/field.js';
import { loadGLB, mergeByMaterial, mergeVertexColors } from './models.js';
import { createWorld } from './world.js';
import { readInput, setInputEnabled, clearInput } from './input.js';

const $ = id => document.getElementById(id);
const joinEl = $('join'), hud = $('hud'), msg = $('msg'), drive = $('drive');
const REJECT = {
  alliance_full: 'That alliance already has 3 robots. Pick the other alliance.',
  full: 'The server is full.',
  invalid: 'The server rejected your name or team number.',
};
const FALLBACK_BYTES = [18.2e6, 21.3e6];

// ---------- form ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
$('name').value = store.get('frc.name') || '';
$('team').value = store.get('frc.team') || '';
const saved = store.get('frc.alliance');
if (saved === 'red' || saved === 'blue') document.querySelector(`input[name=alliance][value=${saved}]`).checked = true;

function say(text, info = false) { msg.textContent = text; msg.className = info ? 'info' : ''; }

function validate() {
  const name = $('name').value.trim(), teamStr = $('team').value.trim();
  const len = [...name].length;
  if (len < 1 || len > 16) return { err: 'Name must be 1-16 characters.' };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return { err: 'Name contains control characters.' };
  const team = /^\d{1,5}$/.test(teamStr) ? Number(teamStr) : NaN;
  if (!(team >= 1 && team <= 99999)) return { err: 'Team number must be 1-99999.' };
  return { name, team, alliance: document.querySelector('input[name=alliance]:checked').value };
}

// ---------- asset loading ----------
let world = null, loadFailed = false;
const prog = [{ l: 0, t: 0 }, { l: 0, t: 0 }];
function showProgress() {
  const l = prog[0].l + prog[1].l, t = prog.reduce((s, p, i) => s + (p.t || FALLBACK_BYTES[i]), 0);
  $('bar').style.width = `${(Math.min(1, l / t) * 100).toFixed(1)}%`;
  $('loadText').textContent = `Loading field and robot... ${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`;
}
const track = i => (l, t) => { prog[i] = { l, t }; showProgress(); };

async function loadAssets() {
  try {
    const [f, r] = await Promise.all([loadGLB(FIELD_MODEL.url, track(0)), loadGLB(ROBOT_MODEL.url, track(1))]);
    $('loadText').textContent = 'Preparing models...';
    await new Promise(requestAnimationFrame);
    const field = mergeByMaterial(f.scene, FIELD_MODEL);
    const robot = mergeVertexColors(mergeByMaterial(r.scene, ROBOT_MODEL));
    if (!robot.children.some(m => m.userData.bumper)) console.warn('no bumper mesh found; robots will not be recoloured');
    world = createWorld($('view'), field, robot);
    $('bar').style.width = '100%';
    $('loadText').textContent = 'Ready';
    drive.disabled = false;
  } catch (e) {
    loadFailed = true;
    console.error(e);
    say(`Failed to load models: ${e.message || e}. Reload the page to retry.`);
    $('loadText').textContent = 'Load failed';
  }
}
loadAssets();

// ---------- network ----------
let ws = null, myId = null, inGame = false, sentKey = '';
const snaps = [];
let offset = null; // receipt-time offset: local now - server time
let roster = '', hudKey = '';

$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!world || loadFailed || ws) return;
  const v = validate();
  if (v.err) return say(v.err);
  store.set('frc.name', v.name); store.set('frc.team', String(v.team)); store.set('frc.alliance', v.alliance);
  connect(v);
});

function connect(join) {
  say('Connecting...', true); drive.disabled = true;
  let sock;
  try { sock = new WebSocket(`ws://${location.host}/ws`); } catch { drive.disabled = false; return say('Could not connect.'); }
  ws = sock;
  let rejected = false;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'join', ...join }));
  sock.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'welcome') { myId = m.id; enterGame(); }
    else if (m.t === 'reject') { rejected = true; say(REJECT[m.reason] || `Rejected (${m.reason}).`); }
    else if (m.t === 'state') onState(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; myId = null; snaps.length = 0; offset = null;
    const wasIn = inGame;
    leaveGame();
    if (!rejected) say(wasIn ? 'Disconnected' : 'Could not connect to the server.');
  };
}

function onState(m) {
  const d = performance.now() - m.time;
  offset = offset === null || d < offset ? d : offset + (d - offset) * 0.01;
  snaps.push({ t: m.time, robots: m.robots, fuel: Array.isArray(m.fuel) ? m.fuel : null, score: m.score });
  if (snaps.length > 40) snaps.shift();
}

const lerp = (a, b, k) => a + (b - a) * k;
function sample() {
  if (!snaps.length) return { poses: [], fuel: [] };
  const rt = performance.now() - offset - 100; // render in the server's past
  let i = snaps.length - 1;
  while (i > 0 && snaps[i].t > rt) i--;
  const a = snaps[i], b = snaps[Math.min(i + 1, snaps.length - 1)];
  const k = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
  const fuel = b.fuel ? b.fuel.map((fb, j) => {
    const fa = a.fuel?.[j];
    if (!Array.isArray(fb) || !Array.isArray(fa)) return null; // held/in hub/missing: hidden, never slid in or out
    return [lerp(fa[0], fb[0], k), lerp(fa[1], fb[1], k), lerp(fa[2], fb[2], k)];
  }) : [];
  const poses = b.robots.map(rb => {
    const ra = a.robots.find(r => r.id === rb.id);
    if (!ra || Math.hypot(rb.x - ra.x, rb.y - ra.y) > 0.5) return rb; // new or respawned: no sliding
    let dh = (rb.h - ra.h) % (2 * Math.PI);
    if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
    return { ...rb, x: lerp(ra.x, rb.x, k), y: lerp(ra.y, rb.y, k), h: ra.h + dh * k };
  });
  return { poses, fuel };
}

function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
let lastSent = 0;
function pushInput(force) {
  const { fwd, turn, shoot } = readInput();
  const key = `${fwd.toFixed(3)},${turn.toFixed(3)},${shoot}`, now = performance.now();
  // on change at most every 50 ms (server drops sockets over 60 msg/s); the next frame retries
  if (force || (key !== sentKey && now - lastSent >= 50)) { sentKey = key; lastSent = now; send({ t: 'input', fwd, turn, shoot }); }
}
// keepalive: server zeroes input after 300 ms of silence
setInterval(() => { if (inGame) pushInput(true); }, 100);

function zero() { clearInput(); sentKey = '0.000,0.000,false'; send({ t: 'input', fwd: 0, turn: 0, shoot: false }); }
addEventListener('blur', () => inGame && zero());
document.addEventListener('visibilitychange', () => document.hidden && inGame && zero());

addEventListener('keydown', e => {
  if (!inGame || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyR') send({ t: 'respawn' });
  else if (e.code === 'KeyC') $('cam').textContent = world.cycleCamera();
});

// ---------- screens / HUD ----------
function enterGame() {
  inGame = true; setInputEnabled(true);
  joinEl.hidden = true; hud.hidden = false;
  $('status').classList.remove('off'); $('statusText').textContent = 'Connected';
  say(''); roster = ''; hudKey = ''; $('cam').textContent = world.cameraName;
  last = performance.now(); requestAnimationFrame(frame);
}
function leaveGame() {
  inGame = false; setInputEnabled(false);
  hud.hidden = true; joinEl.hidden = false; drive.disabled = !world;
}

function renderRoster(poses) {
  const sig = poses.map(p => `${p.id}|${p.alliance}|${p.team}|${p.name}`).sort().join('\n');
  if (sig === roster) return;
  roster = sig;
  const ul = $('players'); ul.replaceChildren();
  for (const p of [...poses].sort((a, b) => a.alliance.localeCompare(b.alliance) || a.team - b.team)) {
    const li = document.createElement('li');
    li.className = p.alliance + (p.id === myId ? ' me' : '');
    const t = document.createElement('span'); t.className = 't'; t.textContent = String(p.team);
    const n = document.createElement('span'); n.textContent = p.name;
    li.append(t, n); ul.append(li);
  }
}

function renderScore(poses) {
  const score = snaps.at(-1)?.score, held = poses.find(p => p.id === myId)?.held;
  const key = `${score?.red}|${score?.blue}|${held}`;
  if (key === hudKey) return;
  hudKey = key;
  $('score').hidden = !score;
  if (score) { $('scoreRed').textContent = score.red; $('scoreBlue').textContent = score.blue; }
  $('fuel').hidden = held === undefined;
  $('fuel').textContent = `FUEL ${held}/${FUEL.capacity}`;
}

let last = 0, calls = 0, fpsAcc = 0, fpsN = 0;
function frame(now) {
  if (!inGame) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  pushInput(false);
  const { poses, fuel } = sample();
  renderRoster(poses);
  renderScore(poses);
  world.update(poses, myId, dt, fuel);
  calls = world.drawCalls();
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 1) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${calls} calls`; fpsAcc = fpsN = 0; }
}
