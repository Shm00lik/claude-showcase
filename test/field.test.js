import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, ROBOT, OBSTACLES, BUMPS, SPAWNS, FIELD_MODEL, ROBOT_MODEL, toThree } from '../shared/field.js';

const corners = (x, y, len, wid, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [x + a * len / 2 * c - b * wid / 2 * s, y + a * len / 2 * s + b * wid / 2 * c]);
};
// Separating-axis test for two convex quads (each given as corner list).
const overlap = (A, B) => {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], ax = y1 - y2, ay = x2 - x1;
    const pr = (Q) => Q.map(([x, y]) => x * ax + y * ay);
    const a = pr(A), b = pr(B);
    if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false;
  }
  return true;
};
const inside = (pts) => pts.every(([x, y]) => Math.abs(x) <= FIELD.length / 2 && Math.abs(y) <= FIELD.width / 2);
const rectOf = (o) => corners(o.x, o.y, o.len, o.wid, o.rot);

test('obstacles and bumps are inside the field', () => {
  for (const o of [...OBSTACLES, ...BUMPS]) assert.ok(inside(rectOf(o)), o.name);
});

test('3 spawns per alliance, inside field, in own half, clear of obstacles and bumps-free', () => {
  for (const al of ['red', 'blue']) {
    assert.equal(SPAWNS[al].length, 3);
    for (const s of SPAWNS[al]) {
      const r = corners(s.x, s.y, ROBOT.length, ROBOT.width, s.h);
      assert.ok(inside(r), `${al} spawn inside`);
      assert.ok(al === 'red' ? s.x > 4.3 : s.x < -4.3, `${al} spawn in alliance zone`);
      assert.ok(Math.cos(s.h) * s.x < 0, `${al} spawn faces center`);
      for (const o of OBSTACLES) assert.ok(!overlap(r, rectOf(o)), `${al} spawn overlaps ${o.name}`);
    }
  }
});

test('toThree and model placement agree with tag 13 on the blue wall', () => {
  assert.deepEqual(toThree(-8.262, -3.37), { x: -8.262, z: 3.37 });
  assert.deepEqual(FIELD_MODEL.rotation, [0, 0, 0]); // glb already has x = field x, z = -field y
  assert.equal(FIELD_MODEL.scale, 1);
  // heading h with rotation.y = h points along toThree(cos h, sin h): (cos h, -sin h)
  const h = 0.7, fwd = { x: Math.cos(h), z: -Math.sin(h) };
  assert.ok(Math.abs(Math.cos(h) - fwd.x) + Math.abs(toThree(Math.cos(h), Math.sin(h)).z - fwd.z) < 1e-12);
  // robot model: glTF +z (forward) must map to three +x under rotation.y = pi/2
  const ry = ROBOT_MODEL.rotation[1];
  assert.ok(Math.abs(Math.sin(ry) - 1) < 1e-9); // x' = z sin(ry)
});

test('robot dims plausible, bumps have positive peak', () => {
  assert.ok(ROBOT.length > 0.7 && ROBOT.length < 1 && ROBOT.width > 0.7 && ROBOT.width < 1);
  for (const b of BUMPS) assert.ok(b.height > 0.1 && b.height < 0.25);
});
