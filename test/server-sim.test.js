import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, addRobot, removeRobot, setInput, respawn, step, snapshot, DT } from '../server/sim.js';

const params = (over = {}) => ({
  field: { length: 16, width: 8 },
  robot: { length: 1, width: 0.8 },
  obstacles: [{ name: 'box', x: 3, y: 0, len: 1, wid: 1, rot: 0 }],
  spawns: {
    red: [{ x: 6, y: -2, h: Math.PI }, { x: 6, y: 0, h: Math.PI }, { x: 6, y: 2, h: Math.PI }],
    blue: [{ x: -6, y: -2, h: 0 }, { x: -6, y: 0, h: 0 }, { x: -6, y: 2, h: 0 }],
  },
  ...over,
});
const mk = (over) => createWorld(params(over));
const join = (w, id, alliance = 'blue') => addRobot(w, { id, name: id, team: 1, alliance });
const run = (w, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) step(w, DT); };
const place = (r, x, y, h = 0) => Object.assign(r, { x, y, h, v: 0, w: 0 });

test('forward input drives along heading', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a', 'red');
  place(r, 0, 0, Math.PI / 2);
  setInput(w, 'a', 1, 0); run(w, 0.25);
  assert.ok(Math.abs(r.x) < 1e-9, 'x unchanged');
  assert.ok(r.y > 0.2, 'moved +y: ' + r.y);
});

test('negative fwd reverses, turn rotates CCW', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a'); place(r, 0, 0, 0);
  setInput(w, 'a', -1, 0); run(w, 0.25);
  assert.ok(r.x < -0.2);
  place(r, 0, 0, 0); setInput(w, 'a', 0, 1); run(w, 0.25);
  assert.ok(r.h > 0.3 && Math.abs(r.x) < 1e-9);
});

test('speed slew limited and capped', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a'); place(r, 0, 0, 0);
  setInput(w, 'a', 1, 1); step(w, DT);
  assert.ok(Math.abs(r.v - 8 * DT) < 1e-9, 'v after 1 step ' + r.v);
  assert.ok(Math.abs(r.w - 25 * DT) < 1e-9, 'w after 1 step ' + r.w);
  for (let i = 0; i < 120; i++) { setInput(w, 'a', 1, 1); step(w, DT); }
  assert.ok(Math.abs(r.v - 3.8) < 1e-9 && Math.abs(r.w - 5) < 1e-9);
  assert.ok(r.v <= 3.8 + 1e-9 && r.w <= 5 + 1e-9);
});

test('input clamped, non-finite to 0', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a');
  setInput(w, 'a', 99, -99); assert.equal(r.fwd, 1); assert.equal(r.turn, -1);
  setInput(w, 'a', NaN, Infinity); assert.equal(r.fwd, 0); assert.equal(r.turn, 0);
  setInput(w, 'a', 'x', null); assert.equal(r.fwd, 0); assert.equal(r.turn, 0);
});

test('input timeout zeroes command after 300 ms', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a'); place(r, 0, 0, 0);
  setInput(w, 'a', 1, 0); run(w, 0.2);
  assert.ok(r.v > 1, 'accelerating');
  run(w, 1.0);
  assert.ok(Math.abs(r.v) < 1e-9, 'stopped');
  const x = r.x; run(w, 0.5);
  assert.equal(r.x, x);
  assert.ok(r.x < 1.5, 'did not keep driving: ' + r.x);
});

test('obstacle pushes robot out and blocks it', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a'); place(r, 0, 0, 0);
  for (let i = 0; i < 300; i++) { setInput(w, 'a', 1, 0); step(w, DT); }
  // box spans x 2.5..3.5; robot half length 0.5 -> stops at x<=2.0
  assert.ok(r.x <= 2.0 + 1e-6, 'x=' + r.x);
  assert.ok(r.x > 1.9, 'touching, x=' + r.x);
  assert.ok(Math.abs(r.v) < 0.5, 'velocity into wall removed, v=' + r.v);
});

test('obstacle pushes out from the correct side and when overlapping deeply', { timeout: 5000 }, () => {
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const w = mk(); const r = join(w, 'a'); place(r, 3 + sx * 0.8, sy * 0.8, 0);
    step(w, DT);
    assert.ok(sx * (r.x - 3) + sy * r.y > 0.8, `side ${sx},${sy}`);
  }
});

test('robot-robot separate, 50/50', { timeout: 5000 }, () => {
  const w = mk(); const a = join(w, 'a'); const b = join(w, 'b');
  place(a, 0, 0, 0); place(b, 0.6, 0, 0);
  step(w, DT);
  assert.ok(b.x - a.x >= 1.0 - 1e-6, 'gap ' + (b.x - a.x));
  assert.ok(Math.abs(a.x + 0.2) < 1e-6 && Math.abs(b.x - 0.8) < 1e-6, 'symmetric push');
});

test('perimeter keeps all corners inside', { timeout: 5000 }, () => {
  const w = mk(); const r = join(w, 'a'); place(r, 7.9, 3.9, 0.7);
  step(w, DT);
  const c = Math.cos(r.h), s = Math.sin(r.h);
  for (const [lx, ly] of [[.5, .4], [.5, -.4], [-.5, .4], [-.5, -.4]]) {
    const px = r.x + lx * c - ly * s, py = r.y + lx * s + ly * c;
    assert.ok(Math.abs(px) <= 8 + 1e-9 && Math.abs(py) <= 4 + 1e-9, `corner ${px},${py}`);
  }
  place(r, -50, 50, 0); step(w, DT);
  assert.ok(r.x >= -7.5 - 1e-9 && r.y <= 3.6 + 1e-9);
});

test('static constraints win: robot pinned between robot and wall stays in field', { timeout: 5000 }, () => {
  const w = mk(); const a = join(w, 'a'); const b = join(w, 'b');
  place(a, 7.4, 0, 0); place(b, 6.5, 0, 0);
  for (let i = 0; i < 60; i++) { setInput(w, 'b', 1, 0); step(w, DT); }
  assert.ok(a.x <= 7.5 + 1e-9);
});

test('addRobot: spawns free spot, alliance cap 3, remove frees slot', { timeout: 5000 }, () => {
  const w = mk();
  const xs = [1, 2, 3].map((i) => join(w, 'r' + i, 'red'));
  assert.deepEqual(xs.map((r) => r.y), [-2, 0, 2]);
  assert.equal(join(w, 'r4', 'red'), null);
  assert.ok(join(w, 'b1', 'blue'));
  removeRobot(w, 'r2');
  assert.ok(join(w, 'r5', 'red'));
});

test('respawn picks next free spawn; ignored when none free', { timeout: 5000 }, () => {
  const w = mk(); const a = join(w, 'a', 'red'); // spawn 0
  place(a, 0, 0, 0);
  assert.equal(respawn(w, 'a'), true);
  assert.deepEqual([a.x, a.y, a.h], [6, 0, Math.PI]); // next after 0
  const b = join(w, 'b', 'red'); // takes spawn 0 (free)
  assert.equal(b.y, -2);
  assert.equal(respawn(w, 'a'), true); // a on spawn 1 -> spawn 2 (free)
  assert.equal(a.y, 2);
  const c = join(w, 'c', 'red');
  assert.equal(c.y, 0);
  // all three red spawns occupied; a moves off nothing: it is on spawn 2, others on 0 and 1
  place(a, 6, 2, 0); // still occupies spawn 2 itself (ignored as self)
  const blocker = join(w, 'x', 'blue'); place(blocker, 6, 2.3, 0);
  assert.equal(respawn(w, 'a'), false, 'spawns 0,1 held by b,c; spawn 2 blocked by blocker');
  assert.deepEqual([a.x, a.y], [6, 2]);
  assert.equal(respawn(w, 'nope'), false);
});

test('snapshot lists robots', { timeout: 5000 }, () => {
  const w = mk(); join(w, 'a', 'red'); run(w, 0.1);
  const s = snapshot(w);
  assert.equal(s.robots.length, 1);
  assert.deepEqual(Object.keys(s.robots[0]).sort(), ['alliance', 'h', 'id', 'name', 'team', 'x', 'y']);
  assert.ok(s.time > 90);
});
