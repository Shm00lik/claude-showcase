// GLB loading + draw-call reduction. No DOM / no /shared imports, so it also runs under node for checks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function loadGLB(url, onProgress) {
  return new GLTFLoader().loadAsync(url, e => onProgress?.(e.loaded, e.lengthComputable ? e.total : 0));
}

function applyModel(obj, m) {
  obj.position.fromArray(m.position);
  obj.rotation.set(m.rotation[0], m.rotation[1], m.rotation[2], 'XYZ');
  if (typeof m.scale === 'number') obj.scale.setScalar(m.scale); else obj.scale.fromArray(m.scale);
}

const underBumper = o => { for (; o; o = o.parent) if (/bumper/i.test(o.name)) return true; return false; };

// Bakes `model` transform + node transforms into geometry and merges all meshes sharing a material.
// Bumper-fabric meshes (blue material under a node named *bumper*) get their own material, flagged userData.bumper.
export function mergeByMaterial(gltfScene, model) {
  applyModel(gltfScene, model);
  gltfScene.updateMatrixWorld(true);
  const groups = new Map(); // key -> {material, geoms}
  gltfScene.traverse(o => {
    if (!o.isMesh) return;
    const src = o.geometry, mat = o.material;
    const bumper = underBumper(o) && mat.color && mat.color.b > 3 * mat.color.r && mat.color.b > 0.2;
    const key = bumper ? 'bumper' : mat;
    if (!groups.has(key)) {
      const m = bumper ? mat.clone() : mat;
      if (bumper) m.userData.bumper = true;
      groups.set(key, { material: m, geoms: [] });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position.clone());
    if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
    if (src.index) g.setIndex(src.index.clone());
    else g.setIndex([...Array(src.attributes.position.count).keys()]);
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (o.matrixWorld.determinant() < 0) { // mirrored node: restore outward winding
      const a = g.index.array;
      for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    }
    groups.get(key).geoms.push(g);
  });
  const out = new THREE.Group();
  for (const { material, geoms } of groups.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms) ?? fail(), material);
    mesh.userData.bumper = !!material.userData.bumper;
    out.add(mesh);
    geoms.forEach(g => g.dispose());
  }
  return out;
}

// Collapses an already material-merged model into: one vertex-coloured mesh for opaque parts, plus the
// bumper mesh and any transparent meshes kept separate. ~62 draw calls per robot -> 2-3.
export function mergeVertexColors(group) {
  const geoms = [], out = new THREE.Group();
  for (const mesh of group.children) {
    const m = mesh.material;
    if (mesh.userData.bumper || m.transparent || m.opacity < 1) { out.add(mesh); continue; }
    const g = mesh.geometry, n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) m.color.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geoms.push(g);
  }
  const body = new THREE.Mesh(mergeGeometries(geoms) ?? fail(), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.55 }));
  out.add(body);
  return out;
}

function fail() { throw new Error('merge failed'); }
