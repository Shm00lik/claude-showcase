import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUEL, FUEL_START, HUBS, SHOOTER, OBSTACLES, ROBOT, FIELD, SPAWNS } from '../shared/field.js';
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
  assert.deepEqual(Object.keys(s.robots[0]).sort(), ['alliance', 'h', 'held', 'id', 'name', 'team', 'x', 'y']);
  assert.ok(s.time > 90);
});

// ---- FUEL ----
const fw = (balls = [], over = {}) => createWorld({
  field: { length: 16, width: 8 }, robot: { length: 1, width: 0.8, height: 0.5 }, obstacles: [], spawns: params().spawns,
  fuel: { radius: 0.075, capacity: 8 }, fuelStart: balls, ...over,
});
const real = (over = {}) => createWorld({ field: FIELD, robot: ROBOT, obstacles: OBSTACLES, spawns: SPAWNS, fuel: FUEL, fuelStart: FUEL_START, hubs: HUBS, shooter: SHOOTER, ...over });
const far = (n) => Array.from({ length: n }, (_, i) => ({ x: -7 + i * 0.3, y: 3.5 }));
const give = (w, r, n) => { let k = 0; for (const b of w.balls) if (b.state === 'field' && k < n) { b.state = 'held'; b.owner = r.id; k++; } r.held = n; };
const drive = (w, id, secs, fwd, turn, shoot) => { for (let i = 0; i < Math.round(secs / DT); i++) { setInput(w, id, fwd, turn, shoot); step(w, DT); } };

test('ball in front of a driving robot is collected', { timeout: 5000 }, () => {
  const w = fw([{ x: 1.5, y: 0.1 }]); const r = join(w, 'a'); place(r, 0, 0, 0);
  drive(w, 'a', 1, 1, 0);
  assert.equal(r.held, 1); assert.equal(w.balls[0].state, 'held');
  assert.equal(snapshot(w).fuel[0], 0);
});

test('ball touching side or back is pushed, not collected', { timeout: 5000 }, () => {
  for (const [bx, by] of [[0, 0.45], [0, -0.45], [-0.55, 0]]) {
    const w = fw([{ x: bx, y: by }]); const r = join(w, 'a'); place(r, 0, 0, 0);
    run(w, 0.1);
    assert.equal(r.held, 0, `${bx},${by}`); assert.equal(w.balls[0].state, 'field');
    assert.ok(Math.hypot(w.balls[0].x, w.balls[0].y) > 0.45, 'pushed out of the robot');
  }
});

test('capacity 8 enforced', { timeout: 5000 }, () => {
  const w = fw([...far(8), { x: 1.5, y: 0 }]); const r = join(w, 'a'); place(r, 0, 0, 0);
  give(w, r, 8);
  drive(w, 'a', 1, 1, 0);
  assert.equal(r.held, 8); assert.equal(w.balls[8].state, 'field');
});

test('shoot from 2.5 m facing own hub scores; from 6 m does not', { timeout: 10000 }, () => {
  const hub = HUBS[0];
  const w = real({ fuelStart: far(3) }); const r = join(w, 'a', 'red'); place(r, hub.x - 2.5, 0, 0); give(w, r, 1);
  drive(w, 'a', 2, 0, 0, true);
  assert.deepEqual(w.score, { red: 1, blue: 0 });
  const w2 = real({ fuelStart: far(3) }); const r2 = join(w2, 'a', 'red'); place(r2, hub.x - 6, 0, 0); give(w2, r2, 1);
  drive(w2, 'a', 3, 0, 0, true);
  assert.deepEqual(w2.score, { red: 0, blue: 0 });
  assert.equal(w2.balls.filter((b) => b.state === 'field').length, 3, 'shot ball is back on the field');
  const w3 = real({ fuelStart: far(3) }); const r3 = join(w3, 'a', 'red'); place(r3, hub.x - 2.5, 1.2, 0); give(w3, r3, 1); // passes beside the opening
  drive(w3, 'a', 2, 0, 0, true);
  assert.deepEqual(w3.score, { red: 0, blue: 0 });
});

test('scored ball sits in hub, then returns on the neutral side', { timeout: 10000 }, () => {
  const hub = HUBS[0];
  const w = real({ fuelStart: far(1) }); const r = join(w, 'a', 'red'); place(r, hub.x - 2.5, 0, 0); give(w, r, 1);
  let t = 0;
  while (w.balls[0].state !== 'hub' && t++ < 200) drive(w, 'a', DT, 0, 0, true);
  assert.equal(w.balls[0].state, 'hub'); assert.equal(snapshot(w).fuel[0], 0);
  drive(w, 'a', 0.9, 0, 0, false); assert.equal(w.balls[0].state, 'hub');
  drive(w, 'a', 0.2, 0, 0, false);
  const b = w.balls[0];
  assert.equal(b.state, 'field'); assert.ok(b.x < hub.x - 0.6, 'neutral side, x=' + b.x);
  drive(w, 'a', 1, 0, 0, false);
  assert.deepEqual(w.score, { red: 1, blue: 0 }, 'not counted again');
});

test('long random sim: balls stay in the field and out of hubs', { timeout: 20000 }, () => {
  const w = real(); let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (const [id, al] of [['a', 'red'], ['b', 'red'], ['c', 'blue']]) join(w, id, al);
  for (const r of w.robots.values()) { place(r, (rand() - 0.5) * 3, (rand() - 0.5) * 3, rand() * 6); give(w, r, 4); }
  Object.assign(w.balls[0], { x: 6, y: 0.3, z: 1.5, vx: 6 }); Object.assign(w.balls[1], { x: -6, y: -0.3, z: 1.5, vx: -6 }); // lobbed at the towers
  for (let i = 0; i < 2000; i++) {
    if (i % 20 === 0) for (const id of ['a', 'b', 'c']) setInput(w, id, rand() * 2 - 0.7, rand() * 2 - 1, rand() < 0.5);
    else for (const id of ['a', 'b', 'c']) w.robots.get(id).inputAt = w.time;
    step(w, DT);
    assert.equal([...w.robots.values()].reduce((n, r) => n + r.held, 0), w.balls.filter((b) => b.state === 'held').length, `held invariant step ${i}`);
    for (const b of w.balls) if (b.state === 'field') {
      for (const o of OBSTACLES) assert.ok(b.z >= (o.name.endsWith('_hub') ? 1.829 : 1.0) || Math.abs(b.x - o.x) > o.len / 2 - 0.01 || Math.abs(b.y - o.y) > o.wid / 2 - 0.01, `ball inside ${o.name} step ${i}: ${b.x},${b.y},${b.z}`);
      assert.ok(Math.abs(b.x) <= FIELD.length / 2 - FUEL.radius + 1e-9 && Math.abs(b.y) <= FIELD.width / 2 - FUEL.radius + 1e-9, `ball outside field step ${i}: ${b.x},${b.y}`);
    }
  }
  for (const b of w.balls) if (b.state === 'field' && b.z < 1.829) for (const h of HUBS) {
    assert.ok(Math.abs(b.x - h.x) > 0.591 + 0.07 || Math.abs(b.y - h.y) > 0.597 + 0.07, `ball inside hub ${b.x},${b.y}`);
  }
  assert.ok(w.balls.some((b) => b.state === 'field'));
});

test('removing a robot drops its balls on the field', { timeout: 5000 }, () => {
  const w = fw(far(5)); const r = join(w, 'a'); place(r, 1, 1, 0); give(w, r, 3);
  removeRobot(w, 'a');
  const dropped = w.balls.filter((b) => Math.hypot(b.x - 1, b.y - 1) < 0.5);
  assert.equal(dropped.length, 3); assert.ok(dropped.every((b) => b.state === 'field'));
  assert.equal(snapshot(w).fuel.filter((f) => f === 0).length, 0);
});

test('shoot must be boolean true; input timeout clears it', { timeout: 5000 }, () => {
  const w = fw(far(8)); const r = join(w, 'a');
  for (const bad of [1, 'true', null, undefined, {}]) { setInput(w, 'a', 0, 0, bad); assert.equal(r.shoot, false); }
  setInput(w, 'a', 0, 0, true); assert.equal(r.shoot, true);
  run(w, 0.5); assert.equal(r.shoot, false);
});

test('fire rate is 4 shots per second', { timeout: 5000 }, () => {
  const w = fw(far(8), { shooter: { x: 0.2, z: 0.55, angle: 1.05, speed: 6 } }); const r = join(w, 'a'); place(r, 0, 0, 0); give(w, r, 8);
  drive(w, 'a', 0.9, 0, 0, true);
  assert.equal(r.held, 4);
});

test('snapshot has fuel, score and held', { timeout: 5000 }, () => {
  const w = real(); const r = join(w, 'a', 'red'); give(w, r, 2);
  const s = snapshot(w);
  assert.equal(s.fuel.length, FUEL.pool);
  assert.equal(s.fuel.filter((f) => f === 0).length, 2);
  assert.deepEqual(s.fuel[99].map((v) => v), s.fuel[99].map((v) => Math.round(v * 100) / 100));
  assert.deepEqual(s.score, { red: 0, blue: 0 }); assert.equal(s.robots[0].held, 2);
});

test('ball hitting the wall above an obstacle does not get stuck inside it', { timeout: 5000 }, () => {
  const w = real({ fuelStart: [{ x: 6, y: 0.3 }] }); const b = w.balls[0];
  Object.assign(b, { z: 1.5, vx: 6 });
  run(w, 3);
  const t = OBSTACLES.find((o) => o.name === 'red_tower');
  assert.ok(Math.abs(b.x - t.x) > t.len / 2 || Math.abs(b.y - t.y) > t.wid / 2, `ball inside tower at ${b.x},${b.y}`);
});
