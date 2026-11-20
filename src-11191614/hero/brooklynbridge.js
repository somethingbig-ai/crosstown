// hero/brooklynbridge.js (brooklyn lane, Nov 15): the Brooklyn Bridge, built by hand in code at its real place in the world frame.
//   ?bblat=0     plain steel (no lacing / rivets / rust in the wire shader)
//   ?bbridge=0   never fetched (the hook line in game.js)        ?bbwater=1   a stand-in river and two flat banks under it (stills only)
// WHY CODE AND NOT A .glb: the road and promenade surfaces are drawn straight from assets/decks/decks.json (the same polylines the game's cars and
// walkers ride, so wheels and planks agree to the millimetre); the cables, stays, suspenders, truss lattice and rails are thousands of members 2 to
// 40 cm thick which a mesh file can only give as tubes that crawl and vanish a few hundred metres off, where here each is a camera-facing ribbon
// never thinner than a pixel that fades by its true width; and it costs no download beyond the towers' stone (two 2k photographs, fetched only when the near form is first shown; the planks are painted at build time).
// COST: nothing is built and nothing fetched until the camera is within FAR_ON metres of the bridge's axis; one distance test a frame until then.
//   near form (inside ~1.5 km): stone 1 + painted steel and roads 1 + planks 1 + wires 1 (+ lights 1 at night) draw calls
//   far form  (out to ~4 km):   stone 1 + deck slab 1 + wires 1
// FRAME: the bridge's own axes: X = metres along the axis from the Manhattan anchorage toward Brooklyn ("station"), Y = up from street level,
// Z = metres to the right of that (south-west). One group matrix sets it into the game's world (x east, y up, z = -north).
// game.bbridge = { info(), root, zRoad(s), zWalk(s), zCable(s) }.
import * as THREE from 'three';

const A0 = [-1173.0, -3939.0], _d = [727.0, -758.2], _l = Math.hypot(_d[0], _d[1]);
const U = [_d[0] / _l, _d[1] / _l], N = [U[1], -U[0]];
const SPAN = 1052, T1 = 284, T2 = 770, MID = 527, WATER = -1.6;
const FAR_ON = 4000, NEAR_ON = 1500;
const O_OUT = 12.75, O_IN = 3.35;           // the four truss lines
const C_OUT = 13.15, C_IN = 3.0, C_IN_T = 0.95;   // the cables: outer pair just outside the outer trusses; the inner pair lean in to meet over the middle pier at each tower
const TRUSS_H = 5.2;                        // outer truss, top chord above the road
const Z_SADDLE = 75.5, Z_STAY = 74.5, TOWER_TOP = 82;
const OPEN0 = 2.6, OPEN1 = 12.9;            // each tower's two arch openings, across the axis
const Z_SPRING = 60.4;
const ANCH_L = 39, ANCH_W = 18.5;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const rgb = (r, g, b) => [lin(r), lin(g), lin(b)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const C = {
  stone: [1, 1, 1], asphalt: rgb(58, 58, 60), line: rgb(214, 214, 204), yellow: rgb(206, 166, 48), concrete: rgb(152, 148, 140),
  steel: rgb(146, 130, 108), under: rgb(104, 93, 80), wire: rgb(150, 114, 76), cable: rgb(162, 136, 100), band: rgb(108, 88, 64), rail: rgb(96, 89, 80),
  wood: [1, 1, 1], lamp: rgb(204, 198, 178), dark: rgb(46, 42, 38),
};

// ------------------------------------------------------------------------------------------------ geometry builders
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; }
  get tris() { return this.p.length / 9; }
  // a, b, c: [X, Y, Z]; col: [r, g, b] or three of them; hint: a rough outward direction (the winding is turned to agree); uvs: three [u, v] or none (box-mapped, 8 m a tile)
  tri(a, b, c, col, hint, uvs) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return; nx /= l; ny /= l; nz /= l;
    const per = Array.isArray(col[0]);
    let c0 = per ? col[0] : col, c1 = per ? col[1] : col, c2 = per ? col[2] : col, u0 = uvs && uvs[0], u1 = uvs && uvs[1], u2 = uvs && uvs[2];
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; const tc = c1; c1 = c2; c2 = tc; const tu = u1; u1 = u2; u2 = tu; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.c.push(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]);
    if (uvs) this.uv.push(u0[0], u0[1], u1[0], u1[1], u2[0], u2[1]);
    else { const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), k = 1 / 8;
      for (const v of [a, b, c]) { if (ay >= ax && ay >= az) this.uv.push(v[0] * k, v[2] * k); else if (ax >= az) this.uv.push(v[2] * k, v[1] * k); else this.uv.push(v[0] * k, v[1] * k); } }
  }
  quad(a, b, c, d, col, hint, uvs) {
    const per = Array.isArray(col[0]);
    this.tri(a, b, c, per ? [col[0], col[1], col[2]] : col, hint, uvs && [uvs[0], uvs[1], uvs[2]]);
    this.tri(a, c, d, per ? [col[0], col[2], col[3]] : col, hint, uvs && [uvs[0], uvs[2], uvs[3]]);
  }
  // an upright prism between two outlines of the same count ([X, Z] lists) at heights y0, y1; caps as asked
  loft(lo, hi, y0, y1, col, { top = false, bottom = false, colTop = null } = {}) {
    let A = 0; for (let i = 0, j = lo.length - 1; i < lo.length; j = i++) A += lo[j][0] * lo[i][1] - lo[i][0] * lo[j][1];
    const sg = A > 0 ? 1 : -1;
    for (let i = 0; i < lo.length; i++) { const j = (i + 1) % lo.length, dx = lo[j][0] - lo[i][0], dz = lo[j][1] - lo[i][1];
      if (Math.hypot(dx, dz) < 1e-6 && Math.hypot(hi[j][0] - hi[i][0], hi[j][1] - hi[i][1]) < 1e-6) continue;
      this.quad([lo[i][0], y0, lo[i][1]], [lo[j][0], y0, lo[j][1]], [hi[j][0], y1, hi[j][1]], [hi[i][0], y1, hi[i][1]], col, [dz * sg, 0, -dx * sg]); }
    const cap = (P, y, up, cc) => { const tr = THREE.ShapeUtils.triangulateShape(P.map((q) => new THREE.Vector2(q[0], q[1])), []);
      for (const t of tr) this.tri([P[t[0]][0], y, P[t[0]][1]], [P[t[1]][0], y, P[t[1]][1]], [P[t[2]][0], y, P[t[2]][1]], cc, [0, up, 0]); };
    if (top) cap(hi, y1, 1, colTop || col); if (bottom) cap(lo, y0, -1, mul(col, 0.6));
  }
  box(x0, x1, y0, y1, z0, z1, col, o) { const P = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; this.loft(P, P, y0, y1, col, o || { top: true, bottom: true }); }
  mesh(mat, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    const cc = new Uint8Array(this.c.length); for (let i = 0; i < cc.length; i++) cc[i] = Math.max(0, Math.min(255, Math.round(Math.sqrt(this.c[i]) * 255)));     // stored as a square root (finer steps in the darks), squared again in the shader
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3, true)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; m.userData.tris = this.tris; return m;
  }
}
// rows along a path: { p: [X, Y, Z], l: [lX, lZ] (unit, the path's left in plan), d: metres from the start }
function rowsOf(pts, marks = null) {
  const out = []; let d = 0;
  const put = (p, dd) => out.push({ p, l: null, d: dd });
  for (let i = 0; i < pts.length; i++) {
    if (i) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (L < 1e-4) continue;
      if (marks) for (const m of marks(d, d + L)) { const t = (m - d) / L; put([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], m); }
      d += L; }
    put(pts[i], d);
  }
  for (let i = 0; i < out.length; i++) { const a = out[Math.max(0, i - 1)].p, b = out[Math.min(out.length - 1, i + 1)].p, dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1; out[i].l = [dz / L, -dx / L]; }
  return out;
}
const at = (r, t, h) => [r.p[0] + r.l[0] * t, r.p[1] + h, r.p[2] + r.l[1] * t];
const rowAt = (rows, d) => { let i = 0; while (i < rows.length - 2 && rows[i + 1].d < d) i++; const a = rows[i], b = rows[i + 1], t = Math.max(0, Math.min(1, (d - a.d) / ((b.d - a.d) || 1)));
  const l = [a.l[0] + (b.l[0] - a.l[0]) * t, a.l[1] + (b.l[1] - a.l[1]) * t], L = Math.hypot(l[0], l[1]) || 1;
  return { p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t], l: [l[0] / L, l[1] / L], d }; };
// a flat band between lateral offsets ts[k] .. ts[k+1], coloured per column (col(k, row a, row b) -> colour or null to leave open)
function ribbon(G, rows, ts, col, h = 0, uvK = null) {
  for (let i = 0; i < rows.length - 1; i++) { const a = rows[i], b = rows[i + 1];
    for (let k = 0; k < ts.length - 1; k++) { const c = col(k, a, b); if (!c) continue;
      G.quad(at(a, ts[k], h), at(a, ts[k + 1], h), at(b, ts[k + 1], h), at(b, ts[k], h), c, [0, 1, 0],
        uvK && [[a.d * uvK[0], ts[k] * uvK[1]], [a.d * uvK[0], ts[k + 1] * uvK[1]], [b.d * uvK[0], ts[k + 1] * uvK[1]], [b.d * uvK[0], ts[k] * uvK[1]]]); } }
}
// a box section along a path between lateral t0..t1 and heights h0..h1 above the path
function strip(G, rows, t0, t1, h0, h1, col, { top = true, bottom = true, sides = true, colBottom = null } = {}) {
  for (let i = 0; i < rows.length - 1; i++) { const a = rows[i], b = rows[i + 1];
    const H0 = typeof h0 === 'function' ? [h0(a), h0(b)] : [h0, h0], H1 = typeof h1 === 'function' ? [h1(a), h1(b)] : [h1, h1];
    if (top) G.quad(at(a, t0, H1[0]), at(a, t1, H1[0]), at(b, t1, H1[1]), at(b, t0, H1[1]), col, [0, 1, 0]);
    if (bottom) G.quad(at(a, t0, H0[0]), at(a, t1, H0[0]), at(b, t1, H0[1]), at(b, t0, H0[1]), colBottom || mul(col, 0.55), [0, -1, 0]);
    if (sides) { const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
      G.quad(at(a, hi, H0[0]), at(b, hi, H0[1]), at(b, hi, H1[1]), at(a, hi, H1[0]), col, [a.l[0], 0, a.l[1]]);
      G.quad(at(a, lo, H0[0]), at(b, lo, H0[1]), at(b, lo, H1[1]), at(a, lo, H1[0]), col, [-a.l[0], 0, -a.l[1]]); } }
}
// a wall standing on the street along a path at lateral t, its top following the path's height (+dz), with round blind arches bay by bay.
// out = +1: the wall's face looks toward the path's left, -1: toward its right.
function wallAlong(G, rows, t, out, { bay = 15, aw = 10, cover = 1.8, maxSpring = 14, minSpring = 2.2, depth = 2.2, dz = 0, y0 = 0, col = C.stone, minH = 0.05 } = {}) {
  const d0 = rows[0].d, L = rows[rows.length - 1].d - d0; if (L < 0.5) return;
  const nb = Math.max(1, Math.round(L / bay)), bl = L / nb, hw = aw / 2;
  const P = (u, y, dep = 0) => { const r = rowAt(rows, d0 + u); return [r.p[0] + r.l[0] * (t - out * dep), y, r.p[2] + r.l[1] * (t - out * dep)]; };
  const zt = (u) => rowAt(rows, d0 + u).p[1] + dz;
  const face = (u) => { const r = rowAt(rows, d0 + u); return [r.l[0] * out, 0, r.l[1] * out]; };
  for (let k = 0; k < nb; k++) { const u0 = k * bl, u1 = u0 + bl, uc = (u0 + u1) / 2, h = face(uc), ztc = zt(uc), spring = Math.min(maxSpring, ztc - cover - hw);
    if (Math.max(zt(u0), zt(u1)) - y0 < minH) continue;
    if (spring < minSpring || bl < aw + 1.2) { const um = uc; G.quad(P(u0, y0), P(um, y0), P(um, zt(um)), P(u0, zt(u0)), col, h); G.quad(P(um, y0), P(u1, y0), P(u1, zt(u1)), P(um, zt(um)), col, h); continue; }
    const a = uc - hw, b = uc + hw;
    G.quad(P(u0, y0), P(a, y0), P(a, zt(a)), P(u0, zt(u0)), col, h); G.quad(P(b, y0), P(u1, y0), P(u1, zt(u1)), P(b, zt(b)), col, h);
    const n = 10, pts = []; for (let i = 0; i <= n; i++) { const th = Math.PI * (1 - i / n); pts.push([uc + hw * Math.cos(th), spring + hw * Math.sin(th)]); }
    const dir = (() => { const p = P(a, 0), q = P(b, 0), l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1; return [(q[0] - p[0]) / l, 0, (q[2] - p[2]) / l]; })();
    const shade = mul(col, 0.62), back = mul(col, 0.2);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[i + 1];
      G.quad(P(p[0], p[1]), P(q[0], q[1]), P(q[0], zt(q[0])), P(p[0], zt(p[0])), col, h);
      const mu = (p[0] + q[0]) / 2 - uc, mz = (p[1] + q[1]) / 2 - spring;
      G.quad(P(p[0], p[1]), P(q[0], q[1]), P(q[0], q[1], depth), P(p[0], p[1], depth), shade, [-dir[0] * mu, -mz, -dir[2] * mu]); }
    G.quad(P(a, y0), P(a, spring), P(a, spring, depth), P(a, y0, depth), shade, dir);
    G.quad(P(b, y0), P(b, spring), P(b, spring, depth), P(b, y0, depth), shade, [-dir[0], 0, -dir[2]]);
    G.quad(P(a, y0, depth), P(b, y0, depth), P(b, spring + hw, depth), P(a, spring + hw, depth), [mul(col, 0.34), mul(col, 0.34), back, back], h);
  }
}

// thin members: each a ribbon turned to the camera in the vertex shader, never under a pixel wide, faded by its true width, shaded as a round bar
class Wires {
  constructor() { this.p = []; this.d = []; this.sr = []; this.c = []; this.ix = []; this.n = 0; }
  get tris() { return this.ix.length / 3; }
  _v(p, d, s, r, c) { this.p.push(p[0], p[1], p[2]); this.d.push(d[0], d[1], d[2]); this.sr.push(s, r); this.c.push(c[0], c[1], c[2]); return this.n++; }
  seg(a, b, r, c) { this.path([a, b], r, c); }
  path(pts, r, c) {
    let prev = null;
    for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(d[0], d[1], d[2]) || 1; d = [d[0] / l, d[1] / l, d[2] / l];
      const rr = typeof r === 'function' ? r(i) : r, v0 = this._v(pts[i], d, -1, rr, c), v1 = this._v(pts[i], d, 1, rr, c);
      if (prev) this.ix.push(prev[0], prev[1], v1, prev[0], v1, v0); prev = [v0, v1]; }
  }
  mesh(mat, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(this.d), 3));
    g.setAttribute('aSR', new THREE.BufferAttribute(new Float32Array(this.sr), 2)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setIndex(this.n > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.ix), 1) : new THREE.BufferAttribute(new Uint16Array(this.ix), 1));
    g.computeBoundingSphere(); g.boundingSphere.radius += 2;
    const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; m.castShadow = false; m.receiveShadow = false; m.userData.tris = this.tris; return m;
  }
}
function wireMaterial(lat = false) {
  const uni = { uCamL: { value: new THREE.Vector3() }, uPix: { value: 0.001 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0, transparent: true, depthWrite: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCamL = uni.uCamL; sh.uniforms.uPix = uni.uPix;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aDir; attribute vec2 aSR; uniform vec3 uCamL; uniform float uPix; varying float vWA; varying float vWS; varying vec3 vWSide; varying vec3 vWP; varying float vWR;')
      .replace('#include <beginnormal_vertex>', 'vec3 wToCam = uCamL - position; vec3 wSide = normalize(cross(aDir, wToCam)); vec3 objectNormal = normalize(cross(wSide, aDir));')
      .replace('#include <begin_vertex>', 'float wR = max(aSR.y, uPix * length(wToCam)); vWA = aSR.y / wR; vWS = aSR.x; vWP = position; vWR = aSR.y; vWSide = normalize(normalMatrix * wSide);\n vec3 transformed = position + wSide * (aSR.x * wR);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWA; varying float vWS; varying vec3 vWSide; varying vec3 vWP; varying float vWR;\nfloat wH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat wN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wH(i), wH(i + vec2(1.0, 0.0)), f.x), mix(wH(i + vec2(0.0, 1.0)), wH(i + vec2(1.0, 1.0)), f.x), f.y); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= pow(vWA, 0.55);\n { float wn = wN(vWP.xz * 1.9 + vWP.y * 2.7), wm = wN(vWP.xy * 0.35 + vWP.z); diffuseColor.rgb *= (0.72 + 0.28 * wn) * (0.84 + 0.16 * wm) * mix(1.0, mix(1.0, 0.6, smoothstep(0.55, 0.95, abs(vWS))), step(0.05, vWR)); }')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(normal * sqrt(max(0.0, 1.0 - vWS * vWS)) + vWSide * vWS);');
    if (lat) {     // ?bblat=1 (helper bridge 3): laced overhead girders, rivet rows, rust, cable bands
      sh.vertexShader = sh.vertexShader.replace('varying float vWR;', 'varying float vWR; varying float vWL; varying float vWPx;').replace('vWR = aSR.y;', 'vWR = aSR.y; vWL = dot(position, aDir); vWPx = aSR.y / max(1e-6, uPix * length(wToCam));');
      const i0 = sh.fragmentShader.indexOf(' { float wn = wN('), i1 = sh.fragmentShader.indexOf('\n', i0);
      sh.fragmentShader = (sh.fragmentShader.slice(0, i0) + LAT_GLSL + sh.fragmentShader.slice(i1)).replace('varying float vWR;', 'varying float vWR; varying float vWL; varying float vWPx;');
    }
  };
  m.customProgramCacheKey = () => (lat ? 'bb_wire5' : 'bb_wire2');
  m.userData.uni = uni; return m;
}
const LAT_GLSL = ` { float wn = wN(vWP.xz * 1.9 + vWP.y * 2.7), wm = wN(vWP.xy * 0.35 + vWP.z), au = abs(vWS), thick = step(0.05, vWR);
   vec3 wc = diffuseColor.rgb * (0.72 + 0.28 * wn) * (0.84 + 0.16 * wm) * mix(1.0, mix(1.0, 0.6, smoothstep(0.55, 0.95, au)), thick);
   float rust = smoothstep(0.6, 0.9, wN(vWP.xz * 0.55 + vWP.y * 0.8 + 7.3)) * thick;
   wc = mix(wc, wc * vec3(0.8, 0.55, 0.4), rust * 0.6);
   float nearK = smoothstep(2.5, 6.0, vWPx), cov = 1.0;
   if (vWR > 0.24) {
     if (au < 0.74) { float p = vWL / (vWR * 1.48) * 0.5, d = min(abs(fract(p + vWS * 0.676) - 0.5), abs(fract(p - vWS * 0.676) - 0.5)), bar = 1.0 - smoothstep(0.06, 0.1, d);
       cov = mix(0.5, bar, nearK); wc *= mix(0.85, 1.0, bar); }
   } else if (vWR > 0.185 && vWR < 0.215) { wc *= mix(1.0, 0.8 + 0.2 * step(0.5, fract(vWL / 0.045)), smoothstep(14.0, 30.0, vWPx));
     wc *= (0.8 + 0.3 * wN(vec2(vWL * 0.4, vWS * 1.3 + 3.0))) * (0.9 + 0.14 * wN(vec2(vWL * 3.1, vWS * 4.0))); wc *= 1.0 - 0.22 * exp(-abs(fract(vWL / 2.3 + 0.5) - 0.5) * 2.3 / 0.22); }
   if (thick > 0.5 && vWPx > 9.0 && au > 0.74) wc *= 1.0 - 0.4 * step(abs(fract(vWL / 0.17) - 0.5), 0.17) * step(abs(au - 0.87), 0.07);
   diffuseColor.rgb = wc; diffuseColor.a *= cov; if (diffuseColor.a < 0.03) discard; }`;
// vertex colours are stored as square roots (see Geo.mesh)
function sqColor(m, weather = false, uni = null) { const prev = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); if (uni) Object.assign(sh.uniforms, uni); sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vColor.rgb *= vColor.rgb;');
    if (weather) { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBBp; varying vec3 vBBn;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBBp = position; vBBn = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBBp; varying vec3 vBBn; uniform sampler2D uBBd; uniform sampler2D uBBnm; uniform vec3 uBBg; uniform mat3 normalMatrix;\nfloat bbH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat bbN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(bbH(i), bbH(i + vec2(1.0, 0.0)), f.x), mix(bbH(i + vec2(0.0, 1.0)), bbH(i + vec2(1.0, 1.0)), f.x), f.y); }' + STONE_FN)
        .replace('#include <normal_fragment_maps>', STONE_N).replace('#include <color_fragment>', '#include <color_fragment>\n' + STONE_A + ' { float st = bbN(vec2((vBBp.x + vBBp.z) * 1.1, vBBp.y * 0.045)), bl = bbN(vBBp.xy * 0.11 + vBBp.z * 0.13), fine = bbN(vBBp.xy * 0.9 + vBBp.z * 0.7);\n diffuseColor.rgb *= (0.66 + 0.34 * smoothstep(0.15, 0.8, st)) * (0.8 + 0.2 * bl) * (0.92 + 0.08 * fine) * mix(0.5, 1.0, smoothstep(-1.2, 3.5, vBBp.y));\n float sk = bbN(vec2((vBBp.x + vBBp.z) * 0.8 + 3.1, vBBp.y * 0.02)), sk2 = bbN(vec2((vBBp.x + vBBp.z) * 2.6 + 9.7, vBBp.y * 0.05)), dC = 76.4 - vBBp.y, dS = 59.4 - vBBp.y, dB = 34.4 - vBBp.y;\n float drip = max(max(step(0.0, dC) * exp(-dC * 0.2), step(0.0, dS) * exp(-dS * 0.26) * 0.85), step(0.0, dB) * exp(-dB * 0.18) * 0.75);\n diffuseColor.rgb *= 1.0 - drip * (0.16 + 0.5 * smoothstep(0.3, 0.72, sk) * (0.55 + 0.45 * sk2));\n diffuseColor.rgb *= 1.0 - 0.3 * step(0.0, dC) * exp(-dC * 1.1);\n diffuseColor.rgb *= mix(vec3(1.04, 0.99, 0.9), vec3(0.95, 0.97, 1.0), smoothstep(0.25, 0.8, bbN(vBBp.xy * 0.07 + vBBp.z * 0.09 + 5.0))); }'); } };
  m.customProgramCacheKey = () => (weather ? 'bb_sq_w6' : 'bb_sq'); return m; }
// helper stone (round 7): the towers and anchorages wear a PHOTOGRAPHED ashlar (Poly Haven medieval_blocks_03, CC0), mapped by position in the bridge's own metres:
// one tile = 4 m, so its five courses are 0.75 to 0.83 m high and its blocks 0.7 to 1.7 m long. Side faces project along X or Z (courses level), tops along Y.
// bbCU slides every course sideways by its own random amount (the tile's five bed joints run its full width, so a slide lands joint on joint) and gives it its own tone:
// no tile-shaped repeat is left across a 40 m face. Mip level from the unslid coordinates (textureGrad), so the slide makes no seam.
const STONE_FN = `
vec3 bbCU(vec2 p, float sd) { vec2 q = p * 0.25; float g = q.y - 0.004, t = floor(g), f = g - t, c = f < 0.186 ? 0.0 : f < 0.388 ? 1.0 : f < 0.594 ? 2.0 : f < 0.794 ? 3.0 : 4.0, h = bbH(vec2(t * 5.0 + c, 3.7 + sd)); q.x += h; return vec3(q, 0.9 + 0.2 * bbH(vec2(h * 91.0, 1.3))); }
`;
const STONE_A = ` vec3 bbW = pow(abs(normalize(vBBn)), vec3(8.0)); bbW /= bbW.x + bbW.y + bbW.z;
 vec2 bbPx = vBBp.zy * 0.25, bbPy = vBBp.xz * 0.25, bbPz = vBBp.xy * 0.25, bbXa = dFdx(bbPx), bbXb = dFdy(bbPx), bbYa = dFdx(bbPy), bbYb = dFdy(bbPy), bbZa = dFdx(bbPz), bbZb = dFdy(bbPz);
 vec3 bbUx = bbCU(vBBp.zy, 0.0), bbUz = bbCU(vBBp.xy, 5.0);
 diffuseColor.rgb *= uBBg * (textureGrad(uBBd, bbUx.xy, bbXa, bbXb).rgb * (bbW.x * bbUx.z) + textureGrad(uBBd, bbPy, bbYa, bbYb).rgb * bbW.y + textureGrad(uBBd, bbUz.xy, bbZa, bbZb).rgb * (bbW.z * bbUz.z));
`;
const STONE_N = `#include <normal_fragment_maps>
 { vec3 bN = normalize(vBBn), tx = textureGrad(uBBnm, bbUx.xy, bbXa, bbXb).xyz * 2.0 - 1.0, ty = textureGrad(uBBnm, bbPy, bbYa, bbYb).xyz * 2.0 - 1.0, tz = textureGrad(uBBnm, bbUz.xy, bbZa, bbZb).xyz * 2.0 - 1.0;
   tx.xy *= 1.5; ty.xy *= 1.5; tz.xy *= 1.5;     // the photo is laid at twice its real size, so its relief is steepened to keep the rock face rough under the sun
   vec3 on = vec3(tx.xy + bN.zy, abs(tx.z) * bN.x).zyx * bbW.x + vec3(ty.xy + bN.xz, abs(ty.z) * bN.y).xzy * bbW.y + vec3(tz.xy + bN.xy, abs(tz.z) * bN.z).xyz * bbW.z;
   normal = normalize(normalMatrix * normalize(on)); }`;

// ------------------------------------------------------------------------------------------------ painted pictures
function planks() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'); let seed = 5; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const n = 16, bw = S / n;
  for (let i = 0; i < n; i++) { const v = 0.78 + r() * 0.34, warm = r() * 14; g.fillStyle = `rgb(${Math.round(84 * v + warm * 0.5)},${Math.round(77 * v + warm * 0.25)},${Math.round(69 * v)})`; g.fillRect(i * bw, 0, bw, S);
    for (let k = 0; k < 26; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '50,40,30' : '225,215,195'},${0.04 + r() * 0.07})`; g.fillRect(i * bw + r() * bw, 0, 0.6 + r() * 1.2, S); }
    g.fillStyle = 'rgba(28,22,16,0.85)'; g.fillRect(i * bw, 0, 1.3, S); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ------------------------------------------------------------------------------------------------ the bridge
async function build(game, st) {
  const w = game.world, Q = game.P || new URLSearchParams(location.search), LAT = Q.get('bblat') !== '0';     // laced overhead girders, rivets, rust, cable bands (seen in runs/r4, Nov 15); ?bblat=0 = the plain wire shader
  const A = (typeof window !== 'undefined' && window.__ASSETS) || 'assets/';
  const decks = (await (await fetch(A + 'decks/decks.json')).json()).decks;
  const toL = (p) => { const dx = p[0] - A0[0], dy = p[1] - A0[1]; return [dx * U[0] + dy * U[1], p[2], dx * N[0] + dy * N[1]]; };
  const D = {}; for (const d of decks) D[d.id] = { ...d, L: d.pts.map(toL) };
  const tab = (pts, all = false) => { const a = pts.filter((p) => all || (p[0] >= -0.5 && p[0] <= SPAN + 0.5)).map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]);
    return (s) => { if (s <= a[0][0]) return a[0][1]; let lo = 0, hi = a.length - 1; if (s >= a[hi][0]) return a[hi][1]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m][0] <= s) lo = m; else hi = m; } const t = (s - a[lo][0]) / ((a[hi][0] - a[lo][0]) || 1); return a[lo][1] + (a[hi][1] - a[lo][1]) * t; }; };
  const zRoad = tab(D['bb-bk'].L), zAll = tab(D['bb-bk'].L, true);
  const walkIds = decks.filter((d) => d.kind === 'walk' && /^bb-/.test(d.id)).map((d) => d.id);
  const zWalk = tab([].concat(...walkIds.map((i) => D[i].L)));
  // the main cables: one parabola each span, the same curvature in all three (the same pull), tangent to the deck at the anchorages
  const zLow = zRoad(MID) + 2.2, kC = (2 * (Z_SADDLE - zLow)) / ((T2 - T1) / 2) ** 2;
  const zA1 = zRoad(0) + 1.5, zA2 = zRoad(SPAN) + 1.5, L2 = SPAN - T2, a1 = (Z_SADDLE - zA1 - 0.5 * kC * T1 * T1) / T1, a2 = (Z_SADDLE - zA2 - 0.5 * kC * L2 * L2) / L2;
  const zCable = (s) => { if (s < 0) return zA1 + a1 * s - 0.02 * s * s; if (s > SPAN) { const x = SPAN - s; return zA2 + a2 * x - 0.02 * x * x; }
    if (s <= T1) return zA1 + a1 * s + 0.5 * kC * s * s; if (s >= T2) { const x = SPAN - s; return zA2 + a2 * x + 0.5 * kC * x * x; }
    return zLow + 0.5 * kC * (s - MID) * (s - MID); };
  const oCab = (o, s) => { if (Math.abs(o) > 5) return o; const c = Math.max(0, Math.min(SPAN, s)), ref = c <= T1 ? zA1 : c >= T2 ? zA2 : zLow, f = Math.max(0, Math.min(1, (zCable(c) - ref) / (Z_SADDLE - ref))); return Math.sign(o) * (C_IN + (C_IN_T - C_IN) * f); };
  const inTop = (s) => Math.max(zRoad(s) + 1.0, zWalk(s) - 0.35);            // inner truss top chord (carries the promenade)
  const outTop = (s) => zRoad(s) + TRUSS_H;
  const nearTower = (s, r) => Math.abs(s - T1) < r || Math.abs(s - T2) < r;

  const stone = new Geo(), paint = new Geo(), wood = new Geo(), far = new Geo(), wires = new Wires();
  const lights = [], lampPts = [];
  await tick0();

  // ---------------------------------------------------------------- towers
  const tower = (T) => {
    const Tk = (y) => (y < 35 ? 18 + (15.5 - 18) * (y - WATER) / (35 - WATER) : 15.5 + (13.7 - 15.5) * (y - 35) / (78 - 35)) / 2;       // half thickness along the axis
    const Wh = (y) => (y < 35 ? 21.35 + (20.3 - 21.35) * (y - WATER) / (35 - WATER) : 20.3 + (19.7 - 20.3) * (y - 35) / (78 - 35));     // half width across it
    const outline = (y, e = 0, wall = true) => { const ts = Tk(y) + e, tw = ts - 1.2, W = Wh(y) + e, I = [[-W, -OPEN1 + e], [-OPEN0 - e, OPEN0 + e], [OPEN1 - e, W]]; const P = [];
      if (!wall) return null;
      for (let i = 0; i < 3; i++) { P.push([T + ts, I[i][0]], [T + ts, I[i][1]]); if (i < 2) P.push([T + tw, I[i][1]], [T + tw, I[i + 1][0]]); }
      for (let i = 2; i >= 0; i--) { P.push([T - ts, I[i][1]], [T - ts, I[i][0]]); if (i > 0) P.push([T - tw, I[i][0]], [T - tw, I[i - 1][1]]); }
      return P; };
    const rect = (y, e, o0, o1) => { const ts = Tk(y) + e; return [[T + ts, o0 - e], [T + ts, o1 + e], [T - ts, o1 + e], [T - ts, o0 - e]]; };
    const lower = mul(C.stone, 0.93);
    // footing in the river, and the body up to the roadway (solid: shafts as buttresses on a recessed wall)
    { const e = 1.6, y = WATER, P = [[T + Tk(y) + e, -Wh(y) - e], [T + Tk(y) + e, Wh(y) + e], [T - Tk(y) - e, Wh(y) + e], [T - Tk(y) - e, -Wh(y) - e]]; stone.loft(P, P, -9, 1.0, mul(C.stone, 0.8), { top: true }); }
    const steps = [[-3, 13.6], [13.6, 34.4]];
    for (const [y0, y1] of steps) stone.loft(outline(y0), outline(y1), y0, y1, lower);
    stone.loft(outline(13.6, 0.3), outline(14.3, 0.3), 13.6, 14.3, C.stone, { top: true, bottom: true });
    stone.loft(outline(34.4, 0.35), outline(35.5, 0.35), 34.4, 35.5, C.stone, { top: true, bottom: true });
    // the three shafts through the roadway to the cornice, with an impost band at the springing of the arches
    const shafts = (y) => [[-Wh(y), -OPEN1], [-OPEN0, OPEN0], [OPEN1, Wh(y)]];
    for (let i = 0; i < 3; i++) { const a = shafts(35.5)[i], b = shafts(76.4)[i]; stone.loft(rect(35.5, 0, a[0], a[1]), rect(76.4, 0, b[0], b[1]), 35.5, 76.4, C.stone);
      const c = shafts(Z_SPRING)[i]; stone.loft(rect(Z_SPRING - 1.0, 0.55, c[0], c[1]), rect(Z_SPRING, 0.55, c[0], c[1]), Z_SPRING - 1.0, Z_SPRING, C.stone, { top: true, bottom: true }); }
    // the two pointed arches: an equilateral arch 10.3 m wide, its point 35.7 m over the roadway; wall from the curve up to the cornice
    const tw = Tk(70) - 1.2, wd = OPEN1 - OPEN0, soff = mul(C.stone, 0.4), RV = 2.1, RD = 0.6, a2 = Math.acos(wd / (2 * (wd - RD)));
    for (const sg of [1, -1]) { const pts = [], pt2 = [], n = 9;
      for (let i = 0; i <= n; i++) { const th = Math.PI - a2 * (i / n); pt2.push([OPEN1 + (wd - RD) * Math.cos(th), Z_SPRING + (wd - RD) * Math.sin(th)]); }
      for (let i = 1; i <= n; i++) { const th = a2 - a2 * (i / n); pt2.push([OPEN0 + (wd - RD) * Math.cos(th), Z_SPRING + (wd - RD) * Math.sin(th)]); }
      for (let i = 0; i <= n; i++) { const th = Math.PI - (Math.PI / 3) * (i / n); pts.push([OPEN1 + wd * Math.cos(th), Z_SPRING + wd * Math.sin(th)]); }
      for (let i = 1; i <= n; i++) { const th = Math.PI / 3 - (Math.PI / 3) * (i / n); pts.push([OPEN0 + wd * Math.cos(th), Z_SPRING + wd * Math.sin(th)]); }
      const cy = Z_SPRING, co = (OPEN0 + OPEN1) / 2;
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1];
        for (const f of [1, -1]) stone.quad([T + f * tw, p[1], sg * p[0]], [T + f * tw, q[1], sg * q[0]], [T + f * tw, 76.4, sg * q[0]], [T + f * tw, 76.4, sg * p[0]], mul(C.stone, 0.9), [f, 0, 0]);
        const p2 = pt2[i], q2 = pt2[i + 1], hn = [0, cy - (p[1] + q[1]) / 2, sg * (co - (p[0] + q[0]) / 2)], ti = tw - RV;      // helper bridge 4: the arch in two orders: the outer ring's soffit RV deep, a ring face set back, then the inner soffit through the tower
        for (const f of [1, -1]) { stone.quad([T + f * ti, p[1], sg * p[0]], [T + f * tw, p[1], sg * p[0]], [T + f * tw, q[1], sg * q[0]], [T + f * ti, q[1], sg * q[0]], mul(C.stone, 0.66), hn);
          stone.quad([T + f * ti, p[1], sg * p[0]], [T + f * ti, q[1], sg * q[0]], [T + f * ti, q2[1], sg * q2[0]], [T + f * ti, p2[1], sg * p2[0]], mul(C.stone, 0.84), [f, 0, 0]); }
        stone.quad([T - ti, p2[1], sg * p2[0]], [T + ti, p2[1], sg * p2[0]], [T + ti, q2[1], sg * q2[0]], [T - ti, q2[1], sg * q2[0]], soff, hn); } }
    // the stepped cornice and the block above it
    const cs = [[76.4, 77.0, 0.55], [77.0, 77.6, 1.15], [77.6, 78.3, 1.85]];     // helper bridge 4: 1.85 m out at the top step (was 1.35)
    for (const [y0, y1, e] of cs) stone.loft(outline(y0, e), outline(y1, e), y0, y1, C.stone, { top: true, bottom: true });
    stone.loft(outline(78.3, 0.75), outline(81.0, 0.6), 78.3, 81.0, C.stone, { top: true });
    stone.loft(outline(81.0, 1.1), outline(81.5, 1.1), 81.0, 81.5, C.stone, { top: true, bottom: true });
    stone.loft(outline(81.5, 0.2), outline(TOWER_TOP, 0.1), 81.5, TOWER_TOP, C.stone, { top: true, colTop: mul(C.stone, 0.7) });
    for (let i = 0; i < 3; i++) { const c = shafts(81)[i]; stone.loft(rect(81.5, 1.0, c[0], c[1]), rect(82.7, 0.9, c[0], c[1]), 81.5, 82.7, C.stone, { top: true, bottom: true, colTop: mul(C.stone, 0.75) }); }     // the raised block over each shaft
    // helper stone: a dark opening in the face where each main cable enters the tower (the saddles sit inside the masonry under the cornice, as on the real bridge), so a cable no longer ends on bare wall
    for (const o of [-C_OUT, -C_IN_T, C_IN_T, C_OUT]) for (const f of [1, -1]) { const ya = Z_SADDLE - 0.75, yb = Z_SADDLE + 0.6, hw = 0.55, dk = mul(C.stone, 0.1);
      stone.quad([T + f * (Tk(ya) + 0.05), ya, o - hw], [T + f * (Tk(ya) + 0.05), ya, o + hw], [T + f * (Tk(yb) + 0.05), yb, o + hw], [T + f * (Tk(yb) + 0.05), yb, o - hw], dk, [f, 0, 0]); }
    wires.seg([T, TOWER_TOP, 0], [T, TOWER_TOP + 11, 0], 0.07, C.rail);
    { const y1 = TOWER_TOP + 10.8, fh = 2.6, fl = 4.6, red = rgb(170, 30, 40), wh = rgb(225, 225, 220), blue = rgb(30, 40, 100);       // the flag
      for (const f of [1, -1]) { for (let i = 0; i < 7; i++) paint.quad([T, y1 - fh * (i + 1) / 7, 0], [T + fl, y1 - fh * (i + 1) / 7, 0], [T + fl, y1 - fh * i / 7, 0], [T, y1 - fh * i / 7, 0], i % 2 ? wh : red, [0, 0, f]);
        paint.quad([T, y1 - fh * 4 / 7, f * 0.03], [T + fl * 0.4, y1 - fh * 4 / 7, f * 0.03], [T + fl * 0.4, y1, f * 0.03], [T, y1, f * 0.03], blue, [0, 0, f]); } }
  };
  tower(T1); tower(T2);
  await tick0();

  // ---------------------------------------------------------------- anchorages
  const anchorage = (s0, s1) => {
    const top = Math.min(zRoad(Math.max(0, Math.min(SPAN, s0))), zRoad(Math.max(0, Math.min(SPAN, s1)))) - 2.2, par = top + 3.6;
    const P = (e) => [[s0 - e, -ANCH_W - e], [s1 + e, -ANCH_W - e], [s1 + e, ANCH_W + e], [s0 - e, ANCH_W + e]];
    stone.loft(P(1.0), P(1.0), 0, 2.6, mul(C.stone, 0.9), { top: true });
    for (const sg of [1, -1]) { const rows = rowsOf([[s0, top, 0], [s1, top, 0]]).map((r) => ({ ...r, l: [0, 1] }));
      wallAlong(stone, rows, sg * ANCH_W, sg, { bay: 13, aw: 7.6, cover: 3.4, maxSpring: 15.5, depth: 1.3 });
      stone.box(s0, s1, top + 0.9, par, sg * ANCH_W - (sg > 0 ? 0.7 : 0), sg * ANCH_W + (sg > 0 ? 0 : 0.7), C.stone, { top: true }); }
    const y0e = zAll(s0) - 0.03, y1e = zAll(s1) - 0.03;
    stone.quad([s0, 0, -ANCH_W], [s0, 0, ANCH_W], [s0, y0e, ANCH_W], [s0, y0e, -ANCH_W], C.stone, [-1, 0, 0]);
    stone.quad([s1, 0, -ANCH_W], [s1, 0, ANCH_W], [s1, y1e, ANCH_W], [s1, y1e, -ANCH_W], C.stone, [1, 0, 0]);
    stone.loft(P(0.45), P(0.45), top, top + 0.9, C.stone, { top: true, bottom: true });
  };
  anchorage(-ANCH_L, 0); anchorage(SPAN, SPAN + ANCH_L);

  // ---------------------------------------------------------------- roadways (decks.json), their barriers, the approach viaducts
  const dash = (a, b) => { const out = []; for (let m = Math.ceil(a / 12) * 12; m < b; m += 12) { if (m > a) out.push(m); } for (let m = Math.ceil((a - 3) / 12) * 12 + 3; m < b; m += 12) { if (m > a) out.push(m); } return out.sort((x, y) => x - y); };
  const onDash = (a) => ((a.d % 12) + 12) % 12 < 2.99;
  const susp = (r) => r.p[0] > -0.01 && r.p[0] < SPAN + 0.01;
  const road = (id) => { const d = D[id], rows = rowsOf(d.L, dash), bike = !!d.bike, A_ = C.asphalt, Ln = C.line;
    // lateral t: + = the driver's left (the promenade side), - = the outer side
    if (!bike) ribbon(paint, rows, [-4.2, -4.05, -1.42, -1.28, 1.28, 1.42, 4.05, 4.2], (k, a) => (k === 0 || k === 6 ? Ln : (k === 2 || k === 4) ? (onDash(a) ? Ln : A_) : A_));
    else ribbon(paint, rows, [-4.2, -4.05, -1.47, -1.33, 1.25, 1.4, 1.7, 2.9, 3.0, 4.2], (k, a) => (k === 0 || k === 4 ? Ln : k === 2 ? (onDash(a) ? Ln : A_) : k === 5 ? null : k === 7 ? (onDash(a) ? C.yellow : mul(A_, 1.15)) : k > 5 ? mul(A_, 1.15) : A_));
    if (bike) strip(paint, rows, 1.4, 1.7, 0, 0.85, C.concrete, { bottom: false });
    const span = rows.filter(susp), i0 = rows.indexOf(span[0]), i1 = rows.indexOf(span[span.length - 1]);
    const land = [rows.slice(0, i0 + 1), rows.slice(i1)];
    strip(paint, rows, 4.2, 4.42, 0, (r) => (susp(r) ? 0.42 : 0.2), mul(C.concrete, 0.72), { bottom: false });     // on land the promenade lies beside it a kerb's height (0.2 m) up: the wall stays flush with it
    strip(paint, span, -4.42, -4.2, 0, 0.42, mul(C.concrete, 0.72), { bottom: false });
    for (const [rr, t] of [[rows, 4.31], [span, -4.31]]) { for (const h of [0.62, 0.86]) wires.path(rr.map((r) => at(r, t, h)), 0.045, C.rail);
      const L0 = rr[0].d, L1 = rr[rr.length - 1].d; for (let u = L0 + 1; u < L1; u += 3) { const r = rowAt(rr, u); wires.seg(at(r, t, 0.42), at(r, t, 0.9), 0.04, C.rail); } }
    for (const seg of land) { if (seg.length < 2) continue;
      strip(stone, seg, -4.85, -4.2, -0.4, 1.05, C.stone, { bottom: false });
      const off = seg.filter((r) => r.p[0] < -ANCH_L || r.p[0] > SPAN + ANCH_L);      // beyond the anchorage: the viaduct wall under the outer edge
      if (off.length > 1) wallAlong(stone, off, -4.85, -1, { bay: 15, aw: 10.2, cover: 2.0, maxSpring: 13, depth: 2.4, dz: -0.4 });
      const onA = seg.filter((r) => r.p[0] >= -ANCH_L - 8 && r.p[0] <= SPAN + ANCH_L + 8);   // on the anchorage: paving out to its parapet
      for (let i = 0; i < onA.length - 1; i++) { const a = onA[i], b = onA[i + 1], sg = Math.sign(a.p[2]) || 1, e = (r) => [Math.max(-ANCH_L, Math.min(SPAN + ANCH_L, r.p[0])), r.p[1] - 0.02, sg * (ANCH_W - 0.2)];
        stone.quad(at(a, -4.85, -0.02), at(b, -4.85, -0.02), e(b), e(a), mul(C.stone, 0.8), [0, 1, 0]); } }
    return rows; };
  const rBk = road('bb-bk'), rMn = road('bb-mn');
  await tick0();

  // ---------------------------------------------------------------- the promenade
  const nearestOn = (rows, p) => { let best = null, bd = 1e18; for (let i = 0; i < rows.length - 1; i++) { const a = rows[i].p, b = rows[i + 1].p, dx = b[0] - a[0], dz = b[2] - a[2], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / (dx * dx + dz * dz || 1)));
      const x = a[0] + dx * t, z = a[2] + dz * t, dd = (x - p[0]) ** 2 + (z - p[2]) ** 2; if (dd < bd) { bd = dd; best = [x, a[1] + (b[1] - a[1]) * t, z]; } } return best; };
  const toward = (from, to, dist) => { const dx = to[0] - from[0], dz = to[2] - from[2], l = Math.hypot(dx, dz) || 1; return [from[0] + dx / l * dist, from[1], from[2] + dz / l * dist]; };
  const UVW = [1 / 2.4, 1 / 2.5];
  for (const id of ['bb-walk-man', 'bb-walk-mid', 'bb-walk-bk']) { const d = D[id], rows = rowsOf(d.L), hw = d.w / 2;
    ribbon(wood, rows, [-hw, hw], () => C.wood, 0, UVW);
    ribbon(paint, rows.filter((r) => r.p[1] > 1), [-0.07, 0.07], () => mul(C.line, 0.8), 0.012);     // the white line down the middle
    const span = rows.filter(susp);
    if (span.length > 1) strip(paint, span, -hw, hw, -0.4, -0.02, C.steel, { top: false, colBottom: C.under });
    // land: paving between the promenade and the two roadways
    const land = rows.filter((r) => !susp(r) || r.p[0] < 1 || r.p[0] > SPAN - 1);
    for (let i = 0; i < land.length - 1; i++) { const a = land[i], b = land[i + 1]; if (Math.abs(b.d - a.d) > 30) continue;
      for (const [rr, sg] of [[rBk, -1], [rMn, 1]]) { const qa = nearestOn(rr, a.p), qb = nearestOn(rr, b.p), ea = toward(qa, a.p, 4.2), eb = toward(qb, b.p, 4.2);
        stone.quad(at(a, sg * hw, 0), at(b, sg * hw, 0), eb, ea, mul(C.stone, 0.78), [0, 1, 0]); } }
    // rails: a top bar, three wires, posts
    for (const sg of [1, -1]) { let run = [];
      const flush = () => { if (run.length > 1) { wires.path(run.map((r) => at(r, sg * hw, 1.12)), 0.035, C.rail); for (const h of [0.3, 0.58, 0.86]) wires.path(run.map((r) => at(r, sg * hw, h)), 0.011, C.rail); } run = []; };
      for (const r of rows) { if (nearTower(r.p[0], 21)) { flush(); continue; } run.push(r); } flush();
      const L = rows[rows.length - 1].d; for (let u = 1; u < L; u += 2.4) { const r = rowAt(rows, u); if (nearTower(r.p[0], 21)) continue; wires.seg(at(r, sg * hw, 0), at(r, sg * hw, 1.12), 0.03, C.rail); }
      for (let u = 14; u < L; u += 30) { const r = rowAt(rows, u); if (nearTower(r.p[0], 20) || r.p[1] < 6) continue; const b = at(r, sg * (hw + 0.15), 0), t = at(r, sg * (hw + 0.15), 3.5);
        const X = b[0], Y = b[1], Z = b[2], P = (h) => [X, Y + h, Z];     /* helper bridge 5: a lantern, not a box */
        wires.path([P(0), P(0.85), P(0.97), P(3.0)], (i) => [0.085, 0.075, 0.046, 0.034][i], C.rail); wires.seg([X - 0.3, Y + 2.8, Z], [X + 0.3, Y + 2.8, Z], 0.015, C.rail);
        for (const e of [-1, 1]) wires.seg([X + e * 0.26, Y + 2.8, Z], [X, Y + 2.48, Z], 0.012, C.rail);
        wires.path([P(3.0), P(3.05), P(3.4)], (i) => [0.045, 0.08, 0.135][i], C.lamp); wires.path([P(3.4), P(3.44), P(3.56), P(3.68)], (i) => [0.165, 0.15, 0.05, 0.014][i], C.dark); lampPts.push([X, Y + 3.25, Z]); } }
  }
  // the platforms round each tower's middle pier (the walk splits and passes through both arches, over the inner lanes)
  for (const T of [T1, T2]) { const X = [-21, -19, -18, -9, -4.5, 0, 4.5, 9, 18, 19, 21], hwAt = (dx) => { const a = Math.abs(dx); return a <= 9 ? 6.9 : a <= 18 ? 4.0 + (6.9 - 4.0) * (18 - a) / 9 : a <= 19 ? 4.0 : 2.5 + 1.5 * (21 - a) / 2; };     // out to 21 m: the side passages' skewed ends (decks.json) reach 0.6 m past station 18
    for (let i = 0; i < X.length - 1; i++) { const sa = T + X[i], sb = T + X[i + 1], ya = zWalk(sa), yb = zWalk(sb), ha = hwAt(X[i]), hb = hwAt(X[i + 1]), inner = Math.abs(X[i]) >= 9 && Math.abs(X[i + 1]) >= 9 ? 2.5 : 0;
      for (const sg of inner ? [1, -1] : [1]) { const z0a = inner ? sg * inner : -ha, z0b = inner ? sg * inner : -hb, z1a = inner ? sg * ha : ha, z1b = inner ? sg * hb : hb;
        wood.quad([sa, ya, z0a], [sa, ya, z1a], [sb, yb, z1b], [sb, yb, z0b], C.wood, [0, 1, 0], [[sa * UVW[0], z0a * UVW[1]], [sa * UVW[0], z1a * UVW[1]], [sb * UVW[0], z1b * UVW[1]], [sb * UVW[0], z0b * UVW[1]]]);
        paint.quad([sa, ya - 0.4, z0a], [sa, ya - 0.4, z1a], [sb, yb - 0.4, z1b], [sb, yb - 0.4, z0b], C.under, [0, -1, 0]); }
      for (const sg of [1, -1]) { paint.quad([sa, ya - 0.4, sg * ha], [sb, yb - 0.4, sg * hb], [sb, yb, sg * hb], [sa, ya, sg * ha], C.steel, [0, 0, sg]);
        wires.seg([sa, ya + 1.12, sg * ha], [sb, yb + 1.12, sg * hb], 0.035, C.rail); for (const h of [0.3, 0.58, 0.86]) wires.seg([sa, ya + h, sg * ha], [sb, yb + h, sg * hb], 0.011, C.rail);
        const n = Math.max(1, Math.round((sb - sa) / 2.3)); for (let k = 0; k <= n; k++) { const t = k / n, s = sa + (sb - sa) * t, y = ya + (yb - ya) * t, z = sg * (ha + (hb - ha) * t); wires.seg([s, y, z], [s, y + 1.12, z], 0.03, C.rail); } } } }
  await tick0();

  // ---------------------------------------------------------------- the suspended deck: floor, trusses, overhead bracing
  { const rows = []; for (let s = 0; s <= SPAN + 0.01; s += 8) rows.push({ p: [Math.min(s, SPAN), zRoad(Math.min(s, SPAN)), 0], l: [0, 1], d: s }); if (rows[rows.length - 1].p[0] < SPAN) rows.push({ p: [SPAN, zRoad(SPAN), 0], l: [0, 1], d: SPAN });
    strip(paint, rows, -13, 13, -1.15, -0.05, C.steel, { top: false, colBottom: C.under });
    // far form: one slab with the road colour on top
    const fr = rows.filter((r, i) => i % 2 === 0 || i === rows.length - 1); strip(far, fr, -13, 13, -1.15, 0.0, C.steel, { colBottom: C.under }); ribbon(far, fr, [-12.5, -4.1, 4.1, 12.5], (k) => (k === 1 ? null : C.asphalt), 0.03);
    strip(far, fr, -2.5, 2.5, (r) => zWalk(r.p[0]) - r.p[1] - 0.4, (r) => zWalk(r.p[0]) - r.p[1], mul(C.steel, 0.8), { colBottom: C.under });
  }
  const PANEL = 4.6, nP = Math.round(SPAN / PANEL), pl = SPAN / nP;
  for (const [o, top] of [[O_OUT, outTop], [-O_OUT, outTop], [O_IN, inTop], [-O_IN, inTop]]) {
    const tp = [], bt = []; for (let k = 0; k <= nP; k++) { const s = k * pl; tp.push([s, top(s), o]); bt.push([s, zRoad(s) - 0.55, o]); }
    wires.path(tp, 0.1, C.steel); wires.path(bt, 0.13, C.steel);
    for (let k = 0; k <= nP; k++) { wires.seg(bt[k], tp[k], 0.055, C.steel); if (k < nP && tp[k][1] - bt[k][1] > 2.2) { wires.seg(bt[k], tp[k + 1], 0.035, C.steel); wires.seg(tp[k], bt[k + 1], 0.035, C.steel); } }
  }
  for (const sg of [1, -1]) for (let k = 0; k <= nP; k++) { const s = k * pl, yi = inTop(s), yo = outTop(s); if (yi - zRoad(s) < 4.4) continue;
    if (LAT) wires.seg([s, yo - 0.2, sg * O_OUT], [s, Math.max(yi, yo - 0.25) - 0.2, sg * O_IN], 0.3, C.steel); else wires.seg([s, yo, sg * O_OUT], [s, Math.max(yi, yo - 0.25), sg * O_IN], 0.13, C.steel); }

  // ---------------------------------------------------------------- the four cables, their suspenders, the stays from the tower tops
  for (const o of [C_OUT, C_IN, -C_IN, -C_OUT]) {
    const inner = Math.abs(o) < 5, oT = inner ? Math.sign(o) * O_IN : Math.sign(o) * O_OUT;          // the truss line this cable carries
    const pts = []; for (let s = -12; s <= SPAN + 12.01; s += 5) pts.push([s, zCable(s), oCab(o, s)]);
    for (const T of [T1, T2]) pts.push([T, Z_SADDLE, oCab(o, T)]); pts.sort((a, b) => a[0] - b[0]);
    wires.path(pts, 0.2, C.cable);
    for (let s = 2.3; s < SPAN; s += 2.3) { if (nearTower(s, 6.2)) continue; wires.seg([s - 0.06, zCable(s - 0.06), oCab(o, s - 0.06)], [s + 0.06, zCable(s + 0.06), oCab(o, s + 0.06)], 0.218, C.band); }     /* helper bridge 5: slim 12 cm bands, buff-brown, not boxes */     // helper bridge 4: a cast band round the cable at every suspender
    const top = inner ? inTop : outTop;
    for (let s = 2.3; s < SPAN; s += 2.3) { if (nearTower(s, 7.5)) continue; const yc = zCable(s) - 0.18, yt = top(s); if (yc - yt > 0.35) { const zc = oCab(o, s), fk = Math.min(0.5, 0.16 / (yc - yt)); wires.seg([s, yc, zc], [s, yt, oT], 0.02, C.wire); wires.seg([s, yc, zc], [s, yc - (yc - yt) * fk, zc + (oT - zc) * fk], 0.034, C.band); } }     /* helper bridge 5: 4 cm rust-tan rope with a slim socket under the band */
    for (const T of [T1, T2]) for (const dir of [1, -1]) { const tk = 5.6;
      const kM = (T === T1) === (dir === 1) ? 35 : 24;     /* helper bridge 5: the stays reach a third of the main span */
      for (let k = 2; k <= kM; k++) { const s = T + dir * k * pl; if (s < 6 || s > SPAN - 6) break; const yt = top(s), y0 = Z_STAY - (k - 2) * 0.06;
        if (yt > zCable(s) - 0.3) break; const zs = Math.sign(o) * (inner ? 0.95 + 5.6 * (k - 2) / (kM - 2) : 13.15 - 5.4 * (k - 2) / (kM - 2)), az = Math.abs(zs), fx = az < OPEN0 || az > OPEN1 ? 6.92 : 5.78;     // helper bridge 4: the stays leave the tower in a row along its top, under the cornice, not from one point
        wires.seg([T + dir * fx, 76.3, zs], [s, yt, oT], 0.022, C.wire); } }
    for (let s = 5; s < SPAN; s += 10) { if (nearTower(s, 4)) continue; lights.push([s, zCable(s) + 0.32, oCab(o, s)]); }
  }
  await tick0();

  // ---------------------------------------------------------------- materials and meshes
  const tW = planks();
  // helper stone: until the near form is first shown the stone is the photo's average colour (two 1 x 1 pictures, nothing fetched); st.stoneTex() fetches the two 2k pictures once (see tick)
  const px1 = (r, g, b, srgb) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const sUni = { uBBd: { value: px1(118, 106, 88, true) }, uBBnm: { value: px1(128, 128, 255, false) }, uBBg: { value: new THREE.Vector3(1.75, 1.72, 1.7) } };
  st.stoneTex = () => { if (st.stx || typeof Image === 'undefined') return; st.stx = 1; const L = new THREE.TextureLoader();
    for (const [key, file, srgb] of [['uBBd', 'medieval_blocks_03_diff.jpg', true], ['uBBnm', 'medieval_blocks_03_nor.jpg', false]]) L.load(A + 'tex/' + file, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; sUni[key].value = t; st.stx++; }, undefined, () => console.warn('[bbridge] stone picture not loaded: ' + file)); };
  const mStone = sqColor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, emissive: new THREE.Color(0, 0, 0) }), true, sUni);
  const mPaint = sqColor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }));
  const mWood = sqColor(new THREE.MeshStandardMaterial({ map: tW, vertexColors: true, roughness: 0.88, metalness: 0 }));
  const mWire = wireMaterial(LAT);
  const root = new THREE.Group(); root.name = 'bb_bridge'; root.matrixAutoUpdate = false;
  root.matrix.makeBasis(new THREE.Vector3(U[0], 0, -U[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(N[0], 0, -N[1])).setPosition(A0[0], 0, -A0[1]); root.matrixWorld.copy(root.matrix);
  const near = new THREE.Group(), farG = new THREE.Group(); near.matrixAutoUpdate = farG.matrixAutoUpdate = false;
  const sM = stone.mesh(mStone, 'bb_stone'), pM = paint.mesh(mPaint, 'bb_deck'), wM = wood.mesh(mWood, 'bb_planks'), fM = far.mesh(mPaint, 'bb_far'), wiM = wires.mesh(mWire, 'bb_wires');
  for (const m of [sM, pM, wM]) { m.castShadow = true; m.receiveShadow = true; } fM.castShadow = false; fM.receiveShadow = false;
  const _v = new THREE.Vector3(), _inv = new THREE.Matrix4().copy(root.matrix).invert(), _sz = new THREE.Vector2();
  wiM.onBeforeRender = (r, scene, cam) => { _v.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(_inv); mWire.userData.uni.uCamL.value.copy(_v);
    const rt = r.getRenderTarget(), H = rt ? rt.height : r.getDrawingBufferSize(_sz).y; mWire.userData.uni.uPix.value = cam.isPerspectiveCamera ? (0.62 * 2 * Math.tan((cam.fov * Math.PI) / 360)) / H : 0; };
  // lights: the necklace along the cables and the promenade lamps (night only)
  const lp = new Float32Array((lights.length + lampPts.length) * 3), lc = new Float32Array(lp.length); let li = 0;
  for (const p of lights) { lp.set(p, li * 3); lc.set([1.0, 0.93, 0.78], li * 3); li++; } for (const p of lampPts) { lp.set(p, li * 3); lc.set([1.6, 1.25, 0.8], li * 3); li++; }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3)); lg.computeBoundingSphere();
  const mLight = new THREE.PointsMaterial({ size: 0.9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  mLight.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n gl_PointSize = max(gl_PointSize, 2.2);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n { float q = length(gl_PointCoord - 0.5); if (q > 0.5) discard; diffuseColor.rgb *= smoothstep(0.5, 0.1, q); }'); };
  const lM = new THREE.Points(lg, mLight); lM.name = 'bb_lights'; lM.matrixAutoUpdate = false; lM.visible = false;
  near.add(pM, wM); farG.add(fM); root.add(sM, wiM, near, farG, lM); farG.visible = false;
  root.traverse((o) => { o.matrixAutoUpdate = false; });
  // ?bbwater=1: a stand-in river and banks for stills (the water lane owns the real ones)
  if (Q.get('bbwater') === '1') { const ctx = new THREE.Group(); ctx.name = 'bb_standin';
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.013, 0.026, 0.028), roughness: 0.16, metalness: 0 })); wm.rotation.x = -Math.PI / 2; wm.position.set(SPAN / 2, WATER, 0); ctx.add(wm);
    const lm = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.09, 0.09, 0.088), roughness: 0.95, metalness: 0 });
    for (const [x0, x1] of [[-4500, 268], [786, 5500]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 3, 9000), lm); b.position.set((x0 + x1) / 2, -1.52, 0); b.receiveShadow = true; ctx.add(b); }
    root.add(ctx); ctx.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; }); }
  root.traverse((o) => { if (o !== root) o.updateMatrix(); }); root.updateMatrixWorld(true);
  w.scene.add(root);
  Object.assign(st, { root, near, far: farG, lights: lM, mStone, mLight, zRoad, zWalk, zCable,
    tris: { stone: stone.tris, deck: paint.tris, planks: wood.tris, wires: wires.tris, far: far.tris, lights: li },
    nearTris: stone.tris + paint.tris + wood.tris + wires.tris, farTris: stone.tris + far.tris + wires.tris });
}
const tick0 = () => new Promise((r) => setTimeout(r, 0));

export function install(game) {
  if (game.bbridge) return game.bbridge;
  const w = game.world, st = (game.bbridge = { root: null, building: false, failed: 0, dist: 1e9, form: 'none' });
  const p0 = [A0[0] - U[0] * 350, A0[1] - U[1] * 350], LEN = 350 + SPAN + 560;
  const dist = (x, y) => { const t = Math.max(0, Math.min(LEN, (x - p0[0]) * U[0] + (y - p0[1]) * U[1])); return Math.hypot(x - p0[0] - U[0] * t, y - p0[1] - U[1] * t); };
  let nearOn = false;
  const tick = () => { const c = w.camera.position, d = (st.dist = dist(c.x, -c.z));
    if (st.off) { if (st.root) st.root.visible = false; st.form = 'off'; return; }     // game.bbridge.off = true hides it (fps comparisons)
    if (d > (st.root && st.root.visible ? FAR_ON + 200 : FAR_ON)) { if (st.root && st.root.visible) { st.root.visible = false; st.form = 'none'; } return; }
    if (!st.root) { if (!st.building && st.failed < 3) { st.building = true; build(game, st).catch((e) => { st.failed++; console.warn('[bbridge] ' + String((e && e.stack) || e).slice(0, 400)); }).finally(() => { st.building = false; }); } return; }
    st.root.visible = true; nearOn = d < (nearOn ? NEAR_ON + 150 : NEAR_ON); st.near.visible = nearOn; st.far.visible = !nearOn; st.form = nearOn ? 'near' : 'far'; if (nearOn && !st.stx) st.stoneTex();
    const n = game.night && typeof game.night.n === 'number' ? game.night.n : 0;
    if (n !== st._n) { st._n = n; st.lights.visible = n > 0.05; st.mLight.color.setScalar(6 * n); st.mStone.emissive.setRGB(0.05 * n, 0.036 * n, 0.02 * n); }
  };
  const render0 = w.render.bind(w);
  w.render = function (t, focus) { try { tick(); } catch (e) { if (st.failed++ > 20) w.render = render0; } return render0(t, focus); };
  st.info = () => ({ form: st.form, stoneTex: st.stx || 0, dist: Math.round(st.dist), tris: st.tris, nearTris: st.nearTris, farTris: st.farTris, calls: st.root ? { near: 4 + (st.lights.visible ? 1 : 0), far: 3 } : null });
  return st;
}
