// geo.js: the cockpit's small modelling kit. Everything is plain three.js geometry, built at load, merged into a few meshes.
// A Builder gathers pieces (each with its own colour, roughness, metalness, surface grain and wear) into ONE indexed geometry, so a
// whole cabin is one draw. No DOM here: the same code runs under node for the ambient-occlusion bake (items/cockpit/bake_ao.mjs).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color(), _nm = new THREE.Matrix3();

// surface grains (the detail picture's channels): 0 none, 1 moulded-plastic stipple, 2 woven fabric, 3 leather / vinyl grain, 4 brushed / scratched
export const GRAIN = { none: 0, plastic: 1, fabric: 2, leather: 3, brushed: 4 };

// a deterministic random stream (the bake under node and the page must build the very same vertices)
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// build quality: 1 = full (the pilot's eye), below 1 = the coarse cabin seen through the glass from outside (fewer spans, small parts dropped)
let Q = 1; export const setQuality = (q) => { Q = q; };
const _bb = new THREE.Box3(), _sz = new THREE.Vector3();

export class Builder {
  constructor(skinned = false) { this.pos = []; this.nor = []; this.col = []; this.mat = []; this.wear = []; this.idx = []; this.skin = skinned ? [] : null; this.n = 0; this.uv = []; }
  // geo: BufferGeometry (position, normal; index or not). m: { c: 0xrrggbb, r: roughness, m: metalness, g: grain, s: grain repeats per metre, w: wear 0..1, bump: 0..1 }.
  // xf: Matrix4 or null. bone: bone index for a skinned builder.
  add(geo, m, xf = null, bone = 0) {
    const p = geo.attributes.position, nn = geo.attributes.normal, uv = geo.attributes.uv, base = this.n;
    if (Q < 1) { _bb.setFromBufferAttribute(p); if (_bb.getSize(_sz).length() < 0.075) { geo.dispose(); return this; } }
    if (xf) _nm.getNormalMatrix(xf);
    _c.set(m.c ?? 0x808080);       // sRGB hex -> linear working space (ColorManagement is on)
    const flip = xf ? xf.determinant() < 0 : false;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i); if (xf) _v.applyMatrix4(xf); this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nn, i); if (xf) _n.applyMatrix3(_nm).normalize(); this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(_c.r, _c.g, _c.b); this.mat.push(m.r ?? 0.6, m.m ?? 0, (m.g ?? 0) + 0.25 * Math.min(0.99, m.bump ?? 0.5) * 0, m.s ?? 60); this.wear.push(m.w ?? 0.25, m.bump ?? 0.5);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
      if (this.skin) this.skin.push(bone);
    }
    const ix = geo.index;
    if (ix) for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i) + base, b = ix.getX(i + 1) + base, c = ix.getX(i + 2) + base; if (flip) this.idx.push(a, c, b); else this.idx.push(a, b, c); }
    else for (let i = 0; i < p.count; i += 3) { if (flip) this.idx.push(base + i, base + i + 2, base + i + 1); else this.idx.push(base + i, base + i + 1, base + i + 2); }
    this.n += p.count; geo.dispose();
    return this;
  }
  get tris() { return this.idx.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    const ao = new Float32Array(this.n * 3); for (let i = 0; i < this.n; i++) { ao[i * 3] = 1; ao[i * 3 + 1] = this.wear[i * 2]; ao[i * 3 + 2] = this.wear[i * 2 + 1]; }
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 3));      // x: baked sky visibility (filled from the bake), y: wear, z: bump strength
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.skin) { const si = new Uint16Array(this.n * 4), sw = new Float32Array(this.n * 4); for (let i = 0; i < this.n; i++) { si[i * 4] = this.skin[i]; sw[i * 4] = 1; } g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---- transforms
export const M = {
  t: (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z),
  rx: (a) => new THREE.Matrix4().makeRotationX(a), ry: (a) => new THREE.Matrix4().makeRotationY(a), rz: (a) => new THREE.Matrix4().makeRotationZ(a),
  s: (x, y = x, z = x) => new THREE.Matrix4().makeScale(x, y, z),
  mul: (...ms) => { const o = new THREE.Matrix4(); for (const m of ms) o.multiply(m); return o; },
  // a frame from an origin and two axes (x across, y up along the face); z = x cross y comes toward the viewer of the face
  frame: (o, x, y) => { const X = new THREE.Vector3(...x).normalize(), Y = new THREE.Vector3(...y).normalize(), Z = new THREE.Vector3().crossVectors(X, Y).normalize(); return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(o[0], o[1], o[2]); },
};

// ---- shapes
// A box with rounded edges and corners: w (x), h (y), d (z), edge radius r, k segments per corner arc, and optionally mx/my/mz extra
// spans across the flats (for cushions that bulge, or faces that need vertices for the baked shading).
export function rbox(w, h, d, r = 0.01, k = 2, mx = 0, my = 0, mz = 0) {
  r = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5);
  if (Q < 1) { k = Math.max(1, Math.round(k * 0.5)); mx = Math.ceil(mx * 0.25); my = Math.ceil(my * 0.25); mz = Math.ceil(mz * 0.25); }
  const nx = 2 * k + mx, ny = 2 * k + my, nz = 2 * k + mz;
  const g = new THREE.BoxGeometry(2, 2, 2, nx, ny, nz), p = g.attributes.position, n = g.attributes.normal;
  const map = (c, N, m, half) => {       // grid coordinate -> [cube coordinate for the sphere direction, offset of the inner box]
    const i = Math.round((c + 1) / 2 * N), inner = half - r;
    if (i < k) return [Math.tan((i / k - 1) * Math.PI / 4), -inner];
    if (i > N - k) return [Math.tan((1 - (N - i) / k) * Math.PI / 4), inner];
    return [0, m > 0 ? -inner + 2 * inner * (i - k) / m : 0];
  };
  for (let i = 0; i < p.count; i++) {
    const [cx, ox] = map(p.getX(i), nx, mx, w / 2), [cy, oy] = map(p.getY(i), ny, my, h / 2), [cz, oz] = map(p.getZ(i), nz, mz, d / 2);
    // on a face the face's own coordinate is +-1 and the others run -1..1 through the corner arcs
    const fx = Math.abs(n.getX(i)) > 0.5, fy = Math.abs(n.getY(i)) > 0.5, fz = Math.abs(n.getZ(i)) > 0.5;
    let dx = fx ? Math.sign(n.getX(i)) : cx, dy = fy ? Math.sign(n.getY(i)) : cy, dz = fz ? Math.sign(n.getZ(i)) : cz;
    const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    const X = fx ? Math.sign(n.getX(i)) * (w / 2 - r) : ox, Y = fy ? Math.sign(n.getY(i)) * (h / 2 - r) : oy, Z = fz ? Math.sign(n.getZ(i)) * (d / 2 - r) : oz;
    p.setXYZ(i, X + dx * r, Y + dy * r, Z + dz * r); n.setXYZ(i, dx, dy, dz);
  }
  return g;
}
// push a geometry's vertices around: fn(v: Vector3, n: Vector3) edits v in place; normals are recomputed
export function warp(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i); _n.fromBufferAttribute(n, i); fn(_v, _n); p.setXYZ(i, _v.x, _v.y, _v.z); }
  return smooth(g);
}
// recompute smooth normals across coincident vertices (BoxGeometry splits faces; a warped cushion must not show the seams)
export function smooth(g) {
  const p = g.attributes.position, ix = g.index, acc = new Map(), key = (i) => Math.round(p.getX(i) * 2e4) + '_' + Math.round(p.getY(i) * 2e4) + '_' + Math.round(p.getZ(i) * 2e4);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const keys = new Array(p.count); for (let i = 0; i < p.count; i++) keys[i] = key(i);
  const count = ix ? ix.count : p.count;
  for (let i = 0; i < count; i += 3) {
    const ia = ix ? ix.getX(i) : i, ib = ix ? ix.getX(i + 1) : i + 1, ic = ix ? ix.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic); e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
    for (const k of [keys[ia], keys[ib], keys[ic]]) { let s = acc.get(k); if (!s) acc.set(k, (s = new THREE.Vector3())); s.add(e1); }
  }
  const n = g.attributes.normal; for (let i = 0; i < p.count; i++) { const s = acc.get(keys[i]); if (s && s.lengthSq() > 0) { _n.copy(s).normalize(); n.setXYZ(i, _n.x, _n.y, _n.z); } }
  return g;
}
// a body of revolution about +Y from a profile [[radius, y], ...] (bottom to top or any order), seg sides
export function lathe(profile, seg = 20) { if (Q < 1) seg = Math.max(6, Math.round(seg * 0.4)); const g = new THREE.LatheGeometry(profile.map((q) => new THREE.Vector2(Math.max(q[0], 1e-5), q[1])), seg); return g; }
// a capped cylinder about +Y with a small bevel on both rims, centred on its middle
export function cyl(r, h, seg = 16, bevel = 0.0008) { const b = Math.min(bevel, r * 0.4, h * 0.4), a = h / 2; return lathe([[0, -a], [r - b, -a], [r, -a + b], [r, a - b], [r - b, a], [0, a]], seg); }
// a tube swept along points (smoothed), radius a number or fn(t 0..1), with rounded end caps
export function tube(points, radius = 0.01, radial = 10, steps = 0, smoothPath = true) {
  const pts = points.map((q) => (q.isVector3 ? q : new THREE.Vector3(...q)));
  const curve = smoothPath && pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : null;
  if (Q < 1) { radial = Math.max(4, Math.round(radial * 0.5)); if (steps > 4) steps = Math.max(4, Math.round(steps * 0.3)); }
  const N = steps || (curve ? pts.length * (Q < 1 ? 2 : 6) : pts.length - 1), P = [], T = [];
  for (let i = 0; i <= N; i++) { const t = i / N; if (curve) { P.push(curve.getPoint(t)); T.push(curve.getTangent(t)); } else { const f = t * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(f)); P.push(pts[j].clone().lerp(pts[j + 1], f - j)); T.push(pts[j + 1].clone().sub(pts[j]).normalize()); } }
  const rad = (t) => (typeof radius === 'function' ? radius(t) : radius);
  // parallel-transport frames
  const pos = [], nor = [], idx = []; let nrm = new THREE.Vector3(0, 1, 0); if (Math.abs(T[0].y) > 0.9) nrm.set(1, 0, 0); nrm.sub(T[0].clone().multiplyScalar(nrm.dot(T[0]))).normalize();
  const bin = new THREE.Vector3();
  const ring = (c, t, r, push) => { bin.crossVectors(t, nrm).normalize(); for (let j = 0; j <= radial; j++) { const a = j / radial * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a); const nx = nrm.x * cs + bin.x * sn, ny = nrm.y * cs + bin.y * sn, nz = nrm.z * cs + bin.z * sn; pos.push(c.x + nx * r + t.x * push, c.y + ny * r + t.y * push, c.z + nz * r + t.z * push); nor.push(nx, ny, nz); } };
  let rows = 0; const row = (c, t, r, push = 0, capN = 0) => { ring(c, t, r, push); if (capN) { const o = nor.length - (radial + 1) * 3; for (let j = 0; j <= radial; j++) { const q = o + j * 3, k = Math.abs(capN) < 1 ? Math.sqrt(1 - capN * capN) : 0; nor[q] = nor[q] * k + t.x * capN; nor[q + 1] = nor[q + 1] * k + t.y * capN; nor[q + 2] = nor[q + 2] * k + t.z * capN; } } rows++; };
  // start cap (two rings: centre, a rounded shoulder), the body, the end cap
  row(P[0], T[0], rad(0) * 0.02, -rad(0) * 0.35, -1); row(P[0], T[0], rad(0) * 0.75, -rad(0) * 0.25, -0.7);
  for (let i = 0; i <= N; i++) { if (i > 0) { const v = T[i - 1].clone().cross(T[i]); if (v.lengthSq() > 1e-10) { const ang = Math.asin(Math.min(1, v.length())); nrm.applyAxisAngle(v.normalize(), ang); } nrm.sub(T[i].clone().multiplyScalar(nrm.dot(T[i]))).normalize(); } row(P[i], T[i], rad(i / N)); }
  row(P[N], T[N], rad(1) * 0.75, rad(1) * 0.25, 0.7); row(P[N], T[N], rad(1) * 0.02, rad(1) * 0.35, 1);
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
// a flat strap (belt webbing) swept along points: width w across `side` (a vector), thickness t
export function strap(points, w, t, side = [0, 0, 1], steps = 0) {
  const pts = points.map((q) => new THREE.Vector3(...q)), curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), N = Math.max(3, Math.round((steps || pts.length * 5) * (Q < 1 ? 0.35 : 1))), S = new THREE.Vector3(...side).normalize();
  const pos = [], nor = [], idx = [], uv = [];
  for (let i = 0; i <= N; i++) {
    const c = curve.getPoint(i / N), tg = curve.getTangent(i / N), s = S.clone().sub(tg.clone().multiplyScalar(S.dot(tg))).normalize(), up = new THREE.Vector3().crossVectors(s, tg).normalize();
    const q = [[-1, 1], [1, 1], [1, 1], [1, -1], [1, -1], [-1, -1], [-1, -1], [-1, 1]], nn = [up, up, s, s, up.clone().negate(), up.clone().negate(), s.clone().negate(), s.clone().negate()];
    for (let j = 0; j < 8; j++) { pos.push(c.x + s.x * q[j][0] * w / 2 + up.x * q[j][1] * t / 2, c.y + s.y * q[j][0] * w / 2 + up.y * q[j][1] * t / 2, c.z + s.z * q[j][0] * w / 2 + up.z * q[j][1] * t / 2); nor.push(nn[j].x, nn[j].y, nn[j].z); uv.push(j < 2 ? j : 0, i / N); }
    if (i < N) for (let f = 0; f < 4; f++) { const a = i * 8 + f * 2, b = a + 1, c2 = a + 8, d = c2 + 1; idx.push(a, b, c2, b, d, c2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
// a flat outline [[x, y], ...] pushed out along +Z by depth, with a rounded bevel; holes: [[[x, y], ...], ...]
export function extrude(outline, depth, bevel = 0.002, bevelSeg = 2, holes = [], curveSeg = 8) {
  const sh = new THREE.Shape(outline.map((q) => new THREE.Vector2(q[0], q[1])));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: bevelSeg, curveSegments: curveSeg, steps: 1 });
  g.translate(0, 0, bevel); return g;
}
// a rounded-rectangle outline, centred, n points per corner
export function rrect(w, h, r, n = 5, cx = 0, cy = 0) {
  r = Math.min(r, w / 2, h / 2); const o = [];
  for (const [sx, sy, a0] of [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]]) for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; o.push([cx + sx * (w / 2 - r) + Math.cos(a) * r, cy + sy * (h / 2 - r) + Math.sin(a) * r]); }
  return o;
}
export function circle(r, n = 24, cx = 0, cy = 0, cw = false) { const o = []; for (let i = 0; i < n; i++) { const a = (cw ? -1 : 1) * i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; }
// a flat grid in the XY plane facing +Z (w by h, nx by ny cells), for floors and liners that want vertices for the baked shading
export function grid(w, h, nx = 1, ny = 1) { return new THREE.PlaneGeometry(w, h, nx, ny); }
// a torus about +Z
export function torus(R, r, seg = 24, rad = 8, arc = Math.PI * 2) { if (Q < 1) { seg = Math.max(6, seg >> 1); rad = 4; } return new THREE.TorusGeometry(R, r, rad, seg, arc); }
export function sphere(r, w = 14, h = 10) { return new THREE.SphereGeometry(r, w, h); }
