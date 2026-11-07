// Usage (run from repo root):
//   node tools/inspect-glb.mjs field|robot bbox            per-node-name bboxes (glTF Y-up world)
//   node tools/inspect-glb.mjs field|robot find <regex> [x<0]   bbox in FIELD frame (y = -gltf z) per node name, x>0 half by default
//   node tools/inspect-glb.mjs field grid [cell_m]         bumper-height occupancy slice -> tmp/grid.json
//   node tools/inspect-glb.mjs field profile x|y <fixed> <from> <to> [step]   top surface height along a line
//   node tools/inspect-glb.mjs field svg                   writes docs/geometry-debug.svg (needs shared/field.js)
// Parses the plain GLBs by hand (no extensions) and flattens every mesh to world-space triangles.
import fs from 'node:fs';
import * as THREE from 'three';

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const GET = { 5126: 'getFloat32', 5123: 'getUint16', 5125: 'getUint32', 5121: 'getUint8', 5122: 'getInt16', 5120: 'getInt8' };

export function loadGlb(path) {
  const b = fs.readFileSync(path);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bin = b.subarray(20 + jl + 8);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const acc = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], n = NC[a.type], T = CT[a.componentType];
    const stride = v.byteStride || n * T.BYTES_PER_ELEMENT, off = (v.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float64Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[GET[a.componentType]](off + k * stride + c * T.BYTES_PER_ELEMENT, true);
    return out;
  };
  const tris = []; // {name, path, v:[9 floats world]}
  const walk = (ni, parent, pathNames) => {
    const n = j.nodes[ni];
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
    const w = parent.clone().multiply(m);
    const names = [...pathNames, n.name || ''];
    if (n.mesh !== undefined) {
      for (const p of j.meshes[n.mesh].primitives) {
        if (p.mode !== undefined && p.mode !== 4) continue;
        const pos = acc(p.attributes.POSITION);
        const idx = p.indices !== undefined ? acc(p.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
        const vs = [];
        for (let k = 0; k < pos.length; k += 3) vs.push(new THREE.Vector3(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(w));
        for (let k = 0; k < idx.length; k += 3) {
          const a = vs[idx[k]], bb = vs[idx[k + 1]], c = vs[idx[k + 2]];
          tris.push({ name: n.name || '', mat: p.material, path: names, v: [a.x, a.y, a.z, bb.x, bb.y, bb.z, c.x, c.y, c.z] });
        }
      }
    }
    for (const c of n.children || []) walk(c, w, names);
  };
  for (const r of j.scenes[j.scene || 0].nodes) walk(r, new THREE.Matrix4(), []);
  return { json: j, tris };
}

export function bbox(tris) {
  const b = new THREE.Box3();
  for (const t of tris) for (let k = 0; k < 9; k += 3) b.expandByPoint(new THREE.Vector3(t.v[k], t.v[k + 1], t.v[k + 2]));
  return b;
}
const fmt = (b) => `min(${b.min.toArray().map((v) => v.toFixed(3))}) max(${b.max.toArray().map((v) => v.toFixed(3))}) size(${b.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(3))})`;
const isFuel = (t) => t.path.some((n) => /Fuel/.test(n)); // game pieces are not field structure

// Max top-surface height at field-frame (x, y) over the given triangles (barycentric test on the xz projection).
export function topHeight(tris, x, y) {
  const px = x, pz = -y;
  let best = -1;
  for (const t of tris) {
    const v = t.v;
    if (px < Math.min(v[0], v[3], v[6]) || px > Math.max(v[0], v[3], v[6]) || pz < Math.min(v[2], v[5], v[8]) || pz > Math.max(v[2], v[5], v[8])) continue;
    const d = (v[5] - v[8]) * (v[0] - v[6]) + (v[6] - v[3]) * (v[2] - v[8]);
    if (!d) continue;
    const a = ((v[5] - v[8]) * (px - v[6]) + (v[6] - v[3]) * (pz - v[8])) / d;
    const b = ((v[8] - v[2]) * (px - v[6]) + (v[0] - v[6]) * (pz - v[8])) / d;
    const c = 1 - a - b;
    if (a < 0 || b < 0 || c < 0) continue;
    best = Math.max(best, a * v[1] + b * v[4] + c * v[7]);
  }
  return best;
}

// ---- occupancy grid. Field frame: x = gltf x, y = -gltf z. Each triangle is clipped to the slab [Y0,Y1] above the
// carpet (so ramps/bumps only count where they are actually that high), the clipped polygon is rasterized, and
// the node names touching a cell are recorded. Cell (i,j): x = i*cs - HX, y = j*cs - HY (row 0 = y -HY).
const Y0 = 0.08, Y1 = 0.30, HX = 8.27, HY = 4.035;
function clipY(poly, y, keepAbove) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = keepAbove ? a[1] >= y : a[1] <= y, ib = keepAbove ? b[1] >= y : b[1] <= y;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (y - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), y, a[2] + t * (b[2] - a[2])]); }
  }
  return out;
}
function grid(tris, cs) {
  const nx = Math.ceil(2 * HX / cs), ny = Math.ceil(2 * HY / cs);
  const cells = new Array(nx * ny).fill(null);
  const mark = (px, pz, name) => {
    const i = Math.floor((px + HX) / cs), j = Math.floor((-pz + HY) / cs);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    (cells[j * nx + i] ||= new Set()).add(name);
  };
  for (const t of tris) {
    if (isFuel(t)) continue;
    const v = t.v;
    if (Math.max(v[1], v[4], v[7]) < Y0 || Math.min(v[1], v[4], v[7]) > Y1) continue;
    const poly = clipY(clipY([[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]], Y0, true), Y1, false);
    if (poly.length < 2) continue;
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    for (const p of poly) mark(p[0], p[2], t.name);
    if (x1 - x0 < cs && z1 - z0 < cs) continue;
    for (let x = Math.floor(x0 / cs) * cs + cs / 2; x <= x1 + cs; x += cs)
      for (let z = Math.floor(z0 / cs) * cs + cs / 2; z <= z1 + cs; z += cs) {
        let pos = 0, neg = 0;
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          const c = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
          if (c > 0) pos++; else if (c < 0) neg++;
        }
        if (pos === 0 || neg === 0) mark(x, z, t.name);
      }
  }
  console.log('grid', nx, 'x', ny, 'occupied cells', cells.filter(Boolean).length);
  return { cs, nx, ny, cells: cells.map((c) => (c ? [...c] : 0)) };
}

async function svg(g) {
  const F = await import('../shared/field.js');
  const cfg = JSON.parse(fs.readFileSync('public/assets/field2026.config.json', 'utf8'));
  const S = 100, M = 40, W = F.FIELD.length * S + 2 * M, H = F.FIELD.width * S + 2 * M;
  const X = (x) => (x + F.FIELD.length / 2) * S + M, Y = (y) => (F.FIELD.width / 2 - y) * S + M;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="11">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<rect x="${X(-F.FIELD.length / 2)}" y="${Y(F.FIELD.width / 2)}" width="${F.FIELD.length * S}" height="${F.FIELD.width * S}" fill="none" stroke="#000"/>`];
  // grid is in the raw CAD frame; FIELD_MODEL rotates it 180 deg about the vertical, so draw it flipped
  for (let j = 0; j < g.ny; j++) {
    let i = 0;
    while (i < g.nx) {
      if (!g.cells[j * g.nx + i]) { i++; continue; }
      const i0 = i; while (i < g.nx && g.cells[j * g.nx + i]) i++;
      o.push(`<rect x="${X(HX - i * g.cs).toFixed(1)}" y="${Y(HY - j * g.cs).toFixed(1)}" width="${((i - i0) * g.cs * S).toFixed(1)}" height="${(g.cs * S).toFixed(1)}" fill="#ccc"/>`);
    }
  }
  const rect = (r, stroke) => o.push(`<g transform="translate(${X(r.x)} ${Y(r.y)}) rotate(${-r.rot * 180 / Math.PI})"><rect x="${-r.len * S / 2}" y="${-r.wid * S / 2}" width="${r.len * S}" height="${r.wid * S}" fill="none" stroke="${stroke}" stroke-width="2"/></g><text x="${X(r.x)}" y="${Y(r.y)}" fill="${stroke}" text-anchor="middle">${r.name}</text>`);
  F.BUMPS.forEach((b) => rect(b, '#06f'));
  F.OBSTACLES.forEach((b) => rect(b, '#e00'));
  const L = F.ROBOT.length * S / 2;
  for (const [al, list] of Object.entries(F.SPAWNS)) for (const s of list) {
    const col = al === 'red' ? '#c00' : '#00c';
    o.push(`<g transform="translate(${X(s.x)} ${Y(s.y)}) rotate(${-s.h * 180 / Math.PI})"><rect x="${-L}" y="${-F.ROBOT.width * S / 2}" width="${2 * L}" height="${F.ROBOT.width * S}" fill="none" stroke="${col}"/><path d="M0 0 L${L} 0 M${L - 8} -5 L${L} 0 L${L - 8} 5" stroke="${col}" stroke-width="2" fill="none"/></g>`);
  }
  for (const t of cfg.aprilTags) o.push(`<circle cx="${X(t.position[0])}" cy="${Y(t.position[1])}" r="3" fill="#080"/><text x="${X(t.position[0]) + 4}" y="${Y(t.position[1]) - 4}" fill="#080">${t.id}</text>`);
  o.push('</svg>');
  fs.writeFileSync('docs/geometry-debug.svg', o.join('\n'));
  console.log('wrote docs/geometry-debug.svg');
}

if (process.argv[1]?.endsWith('inspect-glb.mjs')) {
  const [, , which = 'field', mode = 'bbox', a1, a2, a3, a4, a5] = process.argv;
  const { tris } = loadGlb(`public/assets/${which === 'robot' ? 'kitbot2026' : 'field2026'}.glb`);
  if (mode === 'bbox') {
    console.log('all', tris.length, 'tris', fmt(bbox(tris)));
    const by = new Map();
    for (const t of tris) (by.get(t.name) || by.set(t.name, []).get(t.name)).push(t);
    for (const [k, v] of [...by].sort((x, y) => y[1].length - x[1].length).slice(0, 80)) console.log(k.padEnd(50), String(v.length).padStart(6), fmt(bbox(v)));
  } else if (mode === 'find') {
    const re = new RegExp(a1), sign = a2 === 'x<0' ? -1 : 1, by = new Map();
    for (const t of tris) {
      if (!re.test(t.name) || (which === 'field' && sign * (t.v[0] + t.v[3] + t.v[6]) < 0)) continue;
      (by.get(t.name) || by.set(t.name, []).get(t.name)).push(t);
    }
    for (const [k, v] of by) {
      const b = bbox(v);
      console.log(k.slice(0, 48).padEnd(48), `x[${b.min.x.toFixed(3)},${b.max.x.toFixed(3)}] y[${(-b.max.z).toFixed(3)},${(-b.min.z).toFixed(3)}] h[${b.min.y.toFixed(3)},${b.max.y.toFixed(3)}]`);
    }
  } else if (mode === 'grid' || mode === 'svg') {
    const g = grid(tris, Number(mode === 'grid' ? a1 : 0) || 0.04);
    if (mode === 'grid') { fs.mkdirSync('tmp', { recursive: true }); fs.writeFileSync('tmp/grid.json', JSON.stringify(g)); }
    else await svg(g);
  } else if (mode === 'colors') {
    // base color of materials per side (x>0 / x<0) for nodes matching regex a1, e.g. "Hub Side Panel Vinyl|Bump Plastic"
    const re = new RegExp(a1), j = loadGlb(`public/assets/${which === 'robot' ? 'kitbot2026' : 'field2026'}.glb`).json, res = {};
    for (const t of tris) {
      if (!re.test(t.name)) continue;
      const m = j.materials[t.mat] || {}, c = (m.pbrMetallicRoughness?.baseColorFactor || []).slice(0, 3).map((v) => v.toFixed(2)).join(',');
      const k = `${t.name.slice(0, 40)} | ${m.name} | rgb(${c}) | x${t.v[0] + t.v[3] + t.v[6] > 0 ? '>0' : '<0'}`;
      res[k] = (res[k] || 0) + 1;
    }
    console.log(res);
  } else if (mode === 'profile') {
    const t2 = tris.filter((t) => !isFuel(t)), [fixed, from, to, step] = [+a2, +a3, +a4, +a5 || 0.05];
    for (let s = from; s <= to + 1e-9; s += step) console.log(s.toFixed(2), topHeight(t2, a1 === 'x' ? s : fixed, a1 === 'x' ? fixed : s).toFixed(3));
  }
}
