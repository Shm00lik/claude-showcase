import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FIELD, ROBOT, BUMPS, FUEL, HUBS, toThree } from '/shared/field.js';

const ALLIANCE = { red: '#d01c1c', blue: '#1c4fd0' };
export const CAMERAS = ['chase', 'driver station', 'top-down'];

// ---- analytic bump height (visual only) ----
const bumps = BUMPS.map(b => ({ ...b, c: Math.cos(b.rot), s: Math.sin(b.rot) }));
export function groundHeight(x, y) {
  let h = 0;
  for (const b of bumps) {
    const dx = x - b.x, dy = y - b.y;
    const u = dx * b.c + dy * b.s, v = -dx * b.s + dy * b.c;
    if (Math.abs(u) > b.len / 2 || Math.abs(v) > b.wid / 2) continue;
    h = Math.max(h, b.height * (1 - Math.abs(u) / (b.len / 2))); // triangle profile along len
  }
  return h;
}
function poseOnGround(x, y, hd) {
  const c = Math.cos(hd), s = Math.sin(hd), hl = ROBOT.length / 2, hw = ROBOT.width / 2;
  const hF = groundHeight(x + c * hl, y + s * hl), hB = groundHeight(x - c * hl, y - s * hl);
  const hL = groundHeight(x - s * hw, y + c * hw), hR = groundHeight(x + s * hw, y - c * hw);
  return { y: (hF + hB + hL + hR) / 4, pitch: Math.atan2(hF - hB, ROBOT.length), roll: Math.atan2(hL - hR, ROBOT.width) };
}

function makeLabel(text, color) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const font = '600 40px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.min(900, Math.ceil(ctx.measureText(text).width) + 40), h = 64;
  cv.width = w; cv.height = h;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(11,14,19,.78)'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillText(text, w / 2, h / 2 + 2, w - 24);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(0.3 * w / h, 0.3, 1); spr.renderOrder = 10;
  return spr;
}

export function createWorld(canvas, fieldGroup, robotTemplate) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a2029');
  scene.fog = new THREE.Fog('#1a2029', 40, 90);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; // field/robot materials are metallic=1
  scene.environmentIntensity = 0.25;
  scene.add(new THREE.HemisphereLight('#dbeaff', '#4a4f57', 0.35));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.position.set(6, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -6, near: 4, far: 32 });
  sun.shadow.radius = 4; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  // Tame the CAD's metallic=1 materials; the carpet is the material with the most upward-facing area at floor level.
  const area = new Map();
  fieldGroup.traverse(o => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    const m = o.material;
    m.metalness = Math.min(m.metalness, 0.15); m.roughness = Math.max(m.roughness, 0.6);
    const pos = o.geometry.attributes.position, idx = o.geometry.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let sum = 0;
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
      if (Math.max(a.y, b.y, c.y) > 0.02) continue;
      b.sub(a); c.sub(a); sum += Math.abs(b.cross(c).y) / 2;
    }
    area.set(m, (area.get(m) || 0) + sum);
  });
  const carpet = [...area].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (carpet) { carpet.metalness = 0; carpet.roughness = 1; carpet.color.set('#4a4d52'); }
  robotTemplate.traverse(o => {
    if (!o.isMesh) return;
    o.material.metalness = Math.min(o.material.metalness, 0.5); o.material.roughness = Math.max(o.material.roughness, 0.4);
  });
  scene.add(fieldGroup);

  for (const h of HUBS) { // 2.5 m shooting-range hint
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.46, 2.54, 96),
      new THREE.MeshBasicMaterial({ color: ALLIANCE[h.alliance], transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    const p = toThree(h.x, h.y);
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.012, p.z);
    scene.add(ring);
  }

  const balls = new THREE.InstancedMesh(
    new THREE.SphereGeometry(FUEL.radius, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#f5d000', roughness: 0.9, metalness: 0 }),
    FUEL.pool,
  );
  balls.castShadow = true; balls.frustumCulled = false;
  scene.add(balls);
  const ballM = new THREE.Matrix4(), hiddenM = new THREE.Matrix4().makeScale(0, 0, 0);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 8, 8);
  let camMode = 0;
  const robots = new Map(); // id -> {root, label, alliance}
  const look = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3(), wantUp = new THREE.Vector3(0, 1, 0);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  const bumperMats = {};
  for (const a in ALLIANCE) {
    bumperMats[a] = new THREE.MeshStandardMaterial({ color: ALLIANCE[a], roughness: 0.85, metalness: 0 });
  }

  function addRobot(r) {
    const root = new THREE.Group(), model = robotTemplate.clone();
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.userData.bumper) o.material = bumperMats[r.alliance] || o.material;
    });
    root.add(model);
    const label = makeLabel(`${r.team} \u00b7 ${r.name}`, ALLIANCE[r.alliance]);
    scene.add(root, label);
    const e = { root, label, alliance: r.alliance };
    robots.set(r.id, e);
    return e;
  }

  function update(poses, ownId, dt, fuel = []) {
    const seen = new Set();
    for (const r of poses) {
      seen.add(r.id);
      const e = robots.get(r.id) || addRobot(r);
      const p = toThree(r.x, r.y), g = poseOnGround(r.x, r.y, r.h);
      e.root.position.set(p.x, g.y, p.z);
      e.root.rotation.set(g.roll, r.h, g.pitch, 'YZX');
      e.label.position.set(p.x, g.y + ROBOT.height + 0.45, p.z);
    }
    for (const [id, e] of robots) if (!seen.has(id)) {
      scene.remove(e.root, e.label); e.label.material.map.dispose(); e.label.material.dispose(); robots.delete(id);
    }
    for (let i = 0; i < FUEL.pool; i++) {
      const f = fuel[i];
      if (f) { const p = toThree(f[0], f[1]); balls.setMatrixAt(i, ballM.makeTranslation(p.x, f[2], p.z)); }
      else balls.setMatrixAt(i, hiddenM);
    }
    balls.instanceMatrix.needsUpdate = true;
    const me = poses.find(r => r.id === ownId);
    if (me) aimCamera(me); // else keep last camera
    const k = 1 - Math.exp(-dt * (camMode === 0 ? 6 : 3));
    camera.position.lerp(wantPos, k);
    look.lerp(wantLook, k);
    camera.up.lerp(wantUp, k).normalize();
    camera.lookAt(look);
    renderer.render(scene, camera);
  }

  function aimCamera(me) {
    const p = toThree(me.x, me.y), c = Math.cos(me.h), s = Math.sin(me.h);
    const fwd = new THREE.Vector3(c, 0, -s); // heading in three space
    wantUp.set(0, 1, 0);
    if (camMode === 0) {
      wantPos.set(p.x - fwd.x * 3, 1.7, p.z - fwd.z * 3);
      wantLook.set(p.x + fwd.x * 1.5, 0.3, p.z + fwd.z * 1.5);
      camera.fov = 65;
    } else if (camMode === 1) {
      const side = me.alliance === 'red' ? 1 : -1; // red wall at +x
      wantPos.set(side * (FIELD.length / 2 + 2.2), 2.6, 0);
      wantLook.set(p.x * 0.6, 0.3, p.z * 0.6);
      camera.fov = 55;
    } else {
      const side = me.alliance === 'red' ? 1 : -1, t = Math.tan(THREE.MathUtils.degToRad(45) / 2);
      const hgt = Math.max((FIELD.length + 1.5) / (2 * t), (FIELD.width + 1.5) / (2 * t * camera.aspect));
      wantPos.set(0, hgt, 0); wantLook.set(0, 0, 0);
      wantUp.set(-side, 0, 0); // own wall at the bottom of the screen
      camera.fov = 45;
    }
    camera.updateProjectionMatrix();
  }

  return {
    update, resize,
    drawCalls: () => renderer.info.render.calls,
    cycleCamera() { camMode = (camMode + 1) % CAMERAS.length; return CAMERAS[camMode]; },
    get cameraName() { return CAMERAS[camMode]; },
  };
}
