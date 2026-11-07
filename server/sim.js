// Pure deterministic simulation. Field frame: meters, origin at center, +x toward red, h CCW from +x.
export const DT = 1 / 60;
export const MAX_V = 3.8, MAX_W = 5, ACCEL = 8, ANG_ACCEL = 25;
export const INPUT_TIMEOUT_MS = 300, MAX_PER_ALLIANCE = 3;

export function createWorld({ field, robot, obstacles, spawns }) {
  return { field, robot, obstacles, spawns, robots: new Map(), time: 0 };
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
  const r = { id, name, team, alliance, inputAt: w.time };
  place(r, list[i], i);
  w.robots.set(id, r);
  return r;
}

export const removeRobot = (w, id) => w.robots.delete(id);

const clamp1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0);

export function setInput(w, id, fwd, turn) {
  const r = w.robots.get(id);
  if (!r) return;
  r.fwd = clamp1(fwd); r.turn = clamp1(turn); r.inputAt = w.time;
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
}

const rnd = (n, p) => Math.round(n * p) / p;

export function snapshot(w) {
  return {
    time: Math.round(w.time),
    robots: [...w.robots.values()].map((r) => ({
      id: r.id, name: r.name, team: r.team, alliance: r.alliance,
      x: rnd(r.x, 1000), y: rnd(r.y, 1000), h: rnd(r.h, 10000),
    })),
  };
}
