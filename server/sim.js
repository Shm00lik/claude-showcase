// Pure deterministic simulation. Field frame: meters, origin at center, +x toward red, h CCW from +x.
export const DT = 1 / 60;
export const MAX_V = 3.8, MAX_W = 5, ACCEL = 8, ANG_ACCEL = 25;
export const INPUT_TIMEOUT_MS = 300, MAX_PER_ALLIANCE = 3;

export const GRAVITY = 9.81, SHOT_INTERVAL_MS = 250, HUB_HOLD_MS = 1000, HUB_EXIT = 0.75, BLOCK_H = 1.0;

// fuel = { radius, pool, capacity }; fuelStart = [{x,y}]; hubs/shooter as in shared/field.js. All optional (no balls by default).
export function createWorld({ field, robot, obstacles, spawns, fuel = { radius: 0.075, capacity: 8 }, fuelStart = [], hubs = [], shooter }) {
  const balls = fuelStart.map((p) => ({ x: p.x, y: p.y, z: fuel.radius, vx: 0, vy: 0, vz: 0, state: 'field' }));
  return { field, robot, obstacles, spawns, fuel, hubs, shooter, balls, score: { red: 0, blue: 0 }, robots: new Map(), time: 0 };
}

const obb = (x, y, h, len, wid) => ({ x, y, c: Math.cos(h), s: Math.sin(h), hl: len / 2, hw: wid / 2 });

// Minimum translation to push `a` out of `b` (unit normal pointing b -> a), or null if apart.
function mtv(a, b) {
  let best = null;
  for (const o of [a, b]) {
    for (const [ax, ay] of [[o.c, o.s], [-o.s, o.c]]) {
      const proj = (q) => Math.abs(ax * q.c + ay * q.s) * q.hl + Math.abs(-ax * q.s + ay * q.c) * q.hw;
      const d = (a.x - b.x) * ax + (a.y - b.y) * ay;
      const overlap = proj(a) + proj(b) - Math.abs(d);
      if (overlap <= 0) return null;
      if (!best || overlap < best.depth) {
        const sg = d < 0 ? -1 : 1;
        best = { nx: ax * sg, ny: ay * sg, depth: overlap };
      }
    }
  }
  return best;
}

const robotObb = (w, r) => obb(r.x, r.y, r.h, w.robot.length, w.robot.width);

function spawnFree(w, sp, ignoreId) {
  const so = obb(sp.x, sp.y, sp.h, w.robot.length, w.robot.width);
  for (const r of w.robots.values()) if (r.id !== ignoreId && mtv(so, robotObb(w, r))) return false;
  return true;
}

function place(r, sp, i) {
  Object.assign(r, { x: sp.x, y: sp.y, h: sp.h, v: 0, w: 0, fwd: 0, turn: 0, spawn: i });
}

export function addRobot(w, { id, name, team, alliance }) {
  const list = w.spawns[alliance];
  if (!list || w.robots.has(id)) return null;
  let n = 0;
  for (const r of w.robots.values()) if (r.alliance === alliance) n++;
  if (n >= MAX_PER_ALLIANCE) return null;
  // cap guarantees a spot exists unless robots sit on spawns; fall back to the first spawn (separation resolves it)
  let i = list.findIndex((sp) => spawnFree(w, sp, id));
  if (i < 0) i = 0;
  const r = { id, name, team, alliance, inputAt: w.time, held: 0, shoot: false, nextShot: 0 };
  place(r, list[i], i);
  w.robots.set(id, r);
  return r;
}

export function removeRobot(w, id) {
  let k = 0;
  const r = w.robots.get(id);
  for (const b of w.balls) if (b.state === 'held' && b.owner === id) { // drop on the field around the robot
    const a = k++ * 2.4;
    Object.assign(b, { state: 'field', x: r.x + Math.cos(a) * 0.3, y: r.y + Math.sin(a) * 0.3, z: w.fuel.radius, vx: 0, vy: 0, vz: 0, owner: undefined });
  }
  return w.robots.delete(id);
}

const clamp1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0);

export function setInput(w, id, fwd, turn, shoot = false) {
  const r = w.robots.get(id);
  if (!r) return;
  r.fwd = clamp1(fwd); r.turn = clamp1(turn); r.shoot = shoot === true; r.inputAt = w.time;
}

export function respawn(w, id) {
  const r = w.robots.get(id);
  if (!r) return false;
  const list = w.spawns[r.alliance];
  for (let k = 1; k <= list.length; k++) {
    const i = (r.spawn + k) % list.length;
    if (spawnFree(w, list[i], id)) { place(r, list[i], i); r.inputAt = w.time; return true; }
  }
  return false;
}

const slew = (cur, target, rate) => cur + Math.max(-rate, Math.min(rate, target - cur));

export function step(w, dt = DT) {
  w.time += dt * 1000;
  const rs = [...w.robots.values()];
  for (const r of rs) {
    const stale = w.time - r.inputAt > INPUT_TIMEOUT_MS;
    if (stale) r.shoot = false;
    r.v = slew(r.v, stale ? 0 : r.fwd * MAX_V, ACCEL * dt);
    r.w = slew(r.w, stale ? 0 : r.turn * MAX_W, ANG_ACCEL * dt);
    r.h += r.w * dt;
    r.x += Math.cos(r.h) * r.v * dt;
    r.y += Math.sin(r.h) * r.v * dt;
  }
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const m = mtv(robotObb(w, rs[i]), robotObb(w, rs[j]));
      if (!m) continue;
      rs[i].x += m.nx * m.depth / 2; rs[i].y += m.ny * m.depth / 2;
      rs[j].x -= m.nx * m.depth / 2; rs[j].y -= m.ny * m.depth / 2;
    }
  }
  for (const r of rs) {
    for (const o of w.obstacles) {
      const m = mtv(robotObb(w, r), obb(o.x, o.y, o.rot, o.len, o.wid));
      if (!m) continue;
      r.x += m.nx * m.depth; r.y += m.ny * m.depth;
      const vn = r.v * (Math.cos(r.h) * m.nx + Math.sin(r.h) * m.ny); // speed along the push normal
      if (vn < 0) r.v -= vn * (Math.cos(r.h) * m.nx + Math.sin(r.h) * m.ny);
    }
    const c = Math.abs(Math.cos(r.h)), s = Math.abs(Math.sin(r.h));
    const hx = c * w.robot.length / 2 + s * w.robot.width / 2;
    const hy = s * w.robot.length / 2 + c * w.robot.width / 2;
    const mx = Math.max(0, w.field.length / 2 - hx), my = Math.max(0, w.field.width / 2 - hy);
    r.x = Math.max(-mx, Math.min(mx, r.x));
    r.y = Math.max(-my, Math.min(my, r.y));
  }
  stepBalls(w, dt, rs);
}

// Circle (cx,cy,rad) vs OBB: push-out normal (obb -> circle), depth, and the circle centre in the OBB's frame; null if apart.
function circleObb(cx, cy, rad, o) {
  const dx = cx - o.x, dy = cy - o.y, lx = dx * o.c + dy * o.s, ly = -dx * o.s + dy * o.c;
  const px = Math.max(-o.hl, Math.min(o.hl, lx)), py = Math.max(-o.hw, Math.min(o.hw, ly));
  let nlx = lx - px, nly = ly - py, depth;
  const d = Math.hypot(nlx, nly);
  if (d > 0) { if (d >= rad) return null; nlx /= d; nly /= d; depth = rad - d; }
  else if (o.hl - Math.abs(lx) < o.hw - Math.abs(ly)) { nlx = Math.sign(lx) || 1; nly = 0; depth = o.hl - Math.abs(lx) + rad; }
  else { nlx = 0; nly = Math.sign(ly) || 1; depth = o.hw - Math.abs(ly) + rad; }
  return { nx: nlx * o.c - nly * o.s, ny: nlx * o.s + nly * o.c, depth, lx, ly };
}

// Push ball out along n by depth; reflect its velocity relative to a surface moving at (ux,uy) with restitution e.
function bounce(b, n, ux, uy, e) {
  b.x += n.nx * n.depth; b.y += n.ny * n.depth;
  const vn = (b.vx - ux) * n.nx + (b.vy - uy) * n.ny;
  if (vn < 0) { b.vx -= (1 + e) * vn * n.nx; b.vy -= (1 + e) * vn * n.ny; }
}

function stepBalls(w, dt, rs) {
  const R = w.fuel.radius, sh = w.shooter, balls = w.balls;
  for (const r of rs) { // shooting: one held ball every SHOT_INTERVAL_MS
    if (!r.shoot || !r.held || !sh || w.time < r.nextShot) continue;
    const b = balls.find((q) => q.state === 'held' && q.owner === r.id);
    const c = Math.cos(r.h), s = Math.sin(r.h), vh = sh.speed * Math.cos(sh.angle) + r.v;
    Object.assign(b, { state: 'field', owner: undefined, x: r.x + c * sh.x, y: r.y + s * sh.x, z: sh.z, vx: c * vh, vy: s * vh, vz: sh.speed * Math.sin(sh.angle) });
    r.held--; r.nextShot = w.time + SHOT_INTERVAL_MS;
  }
  balls.forEach((b, i) => {
    if (b.state === 'hub') { // hub exit: reappear on the neutral side with a deterministic spread
      if (w.time < b.until) return;
      const hub = b.hub, sg = -Math.sign(hub.x);
      Object.assign(b, { state: 'field', x: hub.x + sg * HUB_EXIT, y: hub.y + (((i * 7) % 13) / 6 - 1) * 0.6, z: R, vx: sg * (1 + (i % 5) / 4), vy: 0, vz: 0, hub: undefined });
    }
    if (b.state !== 'field') return;
    const px = b.x, py = b.y, pz = b.z;
    b.vz -= GRAVITY * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= R) { b.z = R; if (b.vz < 0) b.vz = -b.vz * 0.4; if (b.vz < 0.3) b.vz = 0; }
    if (b.z === R && b.vz === 0) { // rolling deceleration
      const sp = Math.hypot(b.vx, b.vy), k = sp > 0 ? Math.max(0, sp - 2 * dt) / sp : 0;
      b.vx *= k; b.vy *= k;
    }
    for (const hub of w.hubs) { // score: descending through the rim plane inside the opening
      if (b.vz >= 0 || pz < hub.top || b.z >= hub.top) continue;
      const f = (pz - hub.top) / (pz - b.z);
      if (Math.hypot(px + (b.x - px) * f - hub.x, py + (b.y - py) * f - hub.y) >= hub.radius) continue;
      Object.assign(b, { state: 'hub', until: w.time + HUB_HOLD_MS, hub, vx: 0, vy: 0, vz: 0 });
      w.score[hub.alliance]++;
      return;
    }
    for (const o of w.obstacles) {
      const hub = w.hubs.find((h) => o.name === h.alliance + '_hub');
      if (b.z >= (hub ? hub.top : BLOCK_H)) continue;
      const n = circleObb(b.x, b.y, R, obb(o.x, o.y, o.rot, o.len, o.wid));
      if (n) bounce(b, n, 0, 0, 0.5);
    }
    if (b.z < w.robot.height) for (const r of rs) {
      const o = robotObb(w, r), n = circleObb(b.x, b.y, R, o);
      if (!n) continue;
      if (n.lx > o.hl - R && Math.abs(n.ly) < o.hw && r.held < w.fuel.capacity) {
        Object.assign(b, { state: 'held', owner: r.id }); r.held++;
        break;
      }
      bounce(b, n, Math.cos(r.h) * r.v, Math.sin(r.h) * r.v, 0.5);
    }
  });
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.state !== 'field' || a.z >= 0.3) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.state !== 'field' || b.z >= 0.3) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 2 * R) continue;
      const nx = d > 0 ? dx / d : 1, ny = d > 0 ? dy / d : 0, half = (2 * R - d) / 2;
      a.x -= nx * half; a.y -= ny * half; b.x += nx * half; b.y += ny * half;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn < 0) { const j2 = -(1 + 0.5) * vn / 2; a.vx -= j2 * nx; a.vy -= j2 * ny; b.vx += j2 * nx; b.vy += j2 * ny; }
    }
  }
  const mx = w.field.length / 2 - R, my = w.field.width / 2 - R; // static constraint last, like robots
  for (const b of balls) {
    if (b.state !== 'field') continue;
    if (Math.abs(b.x) > mx) { b.vx = -0.5 * Math.abs(b.vx) * Math.sign(b.x); b.x = Math.sign(b.x) * mx; }
    if (Math.abs(b.y) > my) { b.vy = -0.5 * Math.abs(b.vy) * Math.sign(b.y); b.y = Math.sign(b.y) * my; }
  }
}

const rnd = (n, p) => Math.round(n * p) / p;

export function snapshot(w) {
  return {
    time: Math.round(w.time),
    robots: [...w.robots.values()].map((r) => ({
      id: r.id, name: r.name, team: r.team, alliance: r.alliance,
      x: rnd(r.x, 1000), y: rnd(r.y, 1000), h: rnd(r.h, 10000), held: r.held,
    })),
    fuel: w.balls.map((b) => (b.state === 'field' ? [rnd(b.x, 100), rnd(b.y, 100), rnd(b.z, 100)] : 0)),
    score: { ...w.score },
  };
}
