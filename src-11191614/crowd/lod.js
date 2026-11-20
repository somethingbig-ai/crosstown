// crowd/lod.js: a cheap far mesh by vertex clustering (done once at load, a few ms a character): vertices that fall in one grid cell
// become one (the first keeps its uv, normal, skin weights and mask), triangles that collapse are dropped. Good enough past ~25 m, and
// for shadow casting at any distance (the sun shadow map has 7 cm texels).
import * as THREE from 'three';
export function clusterGeometry(geo, cell = 0.045, keepBones = 4) {
  const pos = geo.attributes.position, idx = geo.index, n = pos.count, map = new Map(), remap = new Int32Array(n), keep = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) / cell) + 512 + (Math.round(pos.getY(i) / cell) + 512) * 1024 + (Math.round(pos.getZ(i) / cell) + 512) * 1048576;
    let j = map.get(k); if (j === undefined) { j = keep.length; map.set(k, j); keep.push(i); } remap[i] = j;
  }
  const tri = [], N = idx ? idx.count : n;
  for (let t = 0; t < N; t += 3) { const a = remap[idx ? idx.getX(t) : t], b = remap[idx ? idx.getX(t + 1) : t + 1], c = remap[idx ? idx.getX(t + 2) : t + 2]; if (a !== b && b !== c && a !== c) tri.push(a, b, c); }
  const out = new THREE.BufferGeometry();
  for (const name in geo.attributes) {
    const src = geo.attributes[name], sz = src.itemSize, A = new src.array.constructor(keep.length * sz);
    for (let j = 0; j < keep.length; j++) for (let c = 0; c < sz; c++) A[j * sz + c] = src.array[(src.isInterleavedBufferAttribute ? keep[j] * src.data.stride + src.offset : keep[j] * sz) + c];
    out.setAttribute(name, new THREE.BufferAttribute(A, sz, src.normalized));
  }
  // the heaviest bone first (the far band and the shadow casters skin with that one alone)
  const si = out.attributes.skinIndex, sw = out.attributes.skinWeight;
  if (si && sw) for (let j = 0; j < keep.length; j++) { let b = 0; for (let c = 1; c < 4; c++) if (sw.array[j * 4 + c] > sw.array[j * 4 + b]) b = c; if (b) { const ti = si.array[j * 4], tw = sw.array[j * 4]; si.array[j * 4] = si.array[j * 4 + b]; sw.array[j * 4] = sw.array[j * 4 + b]; si.array[j * 4 + b] = ti; sw.array[j * 4 + b] = tw; } }
  out.setIndex(keep.length > 65535 ? new THREE.BufferAttribute(new Uint32Array(tri), 1) : new THREE.BufferAttribute(new Uint16Array(tri), 1));
  out.userData.tris = tri.length / 3; return out;
}
// several parts of one character as one geometry (position + skin only): the shadow caster
export function mergeForShadow(geos) {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(nv * 3), SI = new Uint8Array(nv * 4), SW = new Float32Array(nv * 4), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni); let v0 = 0, i0 = 0;
  for (const g of geos) { const p = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) { P[(v0 + i) * 3] = p.getX(i); P[(v0 + i) * 3 + 1] = p.getY(i); P[(v0 + i) * 3 + 2] = p.getZ(i); for (let c = 0; c < 4; c++) { SI[(v0 + i) * 4 + c] = si.getComponent(i, c); SW[(v0 + i) * 4 + c] = sw.getComponent(i, c); } }
    for (let i = 0; i < g.index.count; i++) I[i0 + i] = g.index.getX(i) + v0; v0 += p.count; i0 += g.index.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4)); out.setIndex(new THREE.BufferAttribute(I, 1)); out.userData.tris = ni / 3; return out;
}
