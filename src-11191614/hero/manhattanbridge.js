// hero/manhattanbridge.js (brooklyn lane, helper mbridge, Nov 15): the Manhattan Bridge, built by hand in code at its real place.
//   ?mbridge=0   never fetched (the hook line in game.js)
// Same shape as hero/brooklynbridge.js (its geometry helpers are copied below unchanged): every road and path surface is drawn straight from the
// "mb-" decks of assets/decks/decks.json (tools/mb_decks.py), trusses / cables / suspenders / lattice are camera-facing ribbons, nothing is built
// or fetched until the camera is within FAR_ON metres of the axis.
//   near form (inside ~1.5 km): stone 1 + tower steel 1 + decks 1 + wires 1 (+ lights 1 at night) draw calls
//   far form  (out to ~4 km):   stone 1 + tower steel 1 + deck slabs 1 + wires 1
// FRAME: X = metres along the axis from the Manhattan street end toward Brooklyn ("station": towers 668 and 1112, anchorages 447 and 1333),
// Y = up from street level, Z = metres to the right of that (south-west: the walkway side). game.mbridge = { info(), root, zLow(s), zCable(s) }.
import * as THREE from 'three';

const A0 = [-660.95, -3359.42], _d = [688.04, -1616.32], _l = Math.hypot(_d[0], _d[1]);
const U = [_d[0] / _l, _d[1] / _l], N = [U[1], -U[0]];
const LEN = 2002, UPF = 1998, T1 = 668, T2 = 1112, MID = 890, SIDE = 221, AN1 = 447, AN2 = 1333, WATER = -1.6;
const FAR_ON = 4000, NEAR_ON = 1500;
const O_IN = 6.1, O_OUT = 14.0, LIFT = 7.2;          // the four truss / cable / tower-leg lines; upper roadways above the lower
const ANCH_L = 62, ANCH_W = 21, Y_PIER = 8, Y_SAD = 97.5;
const PIERS = [94, 152, 210, 268, 326], BENTS = [123, 181, 239, 297, 355];   // Manhattan approach: evenly spaced (no street data there)
// Brooklyn approach: [station, kind, lateral lines that carry a column, bays that may be braced down to the ground], picked by lanes/brooklyn/tools/mb_streets.py so
// that nothing stands in a road edge (+1.2 m) or a building of the DUMBO map: Front, Pearl (it runs diagonally under the viaduct), York, Jay, Prospect and Sands pass under.
const BK_SUP = [[1446.0, "bent", [-6.1, 6.1, 14.0], [[-6.1, 6.1], [6.1, 14.0]]], [1475.0, "bent", [6.1, 14.0], [[6.1, 14.0]]], [1504.0, "bent", [-14.0, 14.0], []], [1533.0, "bent", [-14.0, -6.1], [[-14.0, -6.1]]], [1562.0, "pier", [-14.0, -6.1, 6.1, 14.0], []], [1591.0, "bent", [-14.0, -6.1, 6.1, 14.0], [[-14.0, -6.1], [-6.1, 6.1], [6.1, 14.0]]], [1616.5, "pier", [-14.0, -6.1, 6.1, 14.0], []], [1638.5, "bent", [-6.1, 6.1], [[-6.1, 6.1]]], [1667.5, "bent", [-14.0, -6.1, 6.1], [[-14.0, -6.1], [-6.1, 6.1]]], [1693.0, "bent", [-14.0, -6.1, 6.1], [[-14.0, -6.1], [-6.1, 6.1]]], [1718.0, "bent", [-14.0, -6.1, 6.1, 14.0], [[-14.0, -6.1], [-6.1, 6.1], [6.1, 14.0]]], [1753.0, "pier", [-14.0, -6.1, 6.1, 14.0], []], [1782.0, "bent", [6.1, 14.0], [[6.1, 14.0]]], [1811.0, "bent", [-6.1, 6.1], [[-6.1, 6.1]]], [1840.0, "bent", [-6.1, 6.1], [[-6.1, 6.1]]], [1869.0, "bent", [-14.0, -6.1, 6.1, 14.0], [[-14.0, -6.1], [-6.1, 6.1], [6.1, 14.0]]]];
const ARCH_BK = 1351, ARCH_MN = 429, ARCH_HW = 7, ARCH_SPRING = 7.5;      // the archway through each anchorage (Brooklyn: OSM way 407529264 "Dumbo Archway", Water St's line), 14 m wide, 14.5 m to the crown

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const rgb = (r, g, b) => [lin(r), lin(g), lin(b)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const C = {
  stone: [0.9, 0.93, 0.97], asphalt: rgb(58, 58, 60), line: rgb(214, 214, 204), yellow: rgb(206, 166, 48), concrete: rgb(150, 150, 146),
  steel: rgb(33, 50, 72), under: rgb(30, 35, 42), wire: rgb(82, 92, 104), cable: rgb(90, 100, 112), rail: rgb(66, 76, 88),
  tie: rgb(74, 62, 50), grate: rgb(60, 68, 76), railtop: rgb(150, 150, 150), dark: rgb(14, 14, 16), lamp: rgb(240, 232, 205),
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
function wireMaterial() {
  const uni = { uCamL: { value: new THREE.Vector3() }, uPix: { value: 0.001 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0, transparent: true, depthWrite: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCamL = uni.uCamL; sh.uniforms.uPix = uni.uPix;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aDir; attribute vec2 aSR; uniform vec3 uCamL; uniform float uPix; varying float vWA; varying float vWS; varying vec3 vWSide;')
      .replace('#include <beginnormal_vertex>', 'vec3 wToCam = uCamL - position; vec3 wSide = normalize(cross(aDir, wToCam)); vec3 objectNormal = normalize(cross(wSide, aDir));')
      .replace('#include <begin_vertex>', 'float wR = max(aSR.y, uPix * length(wToCam)); vWA = aSR.y / wR; vWS = aSR.x; vWSide = normalize(normalMatrix * wSide);\n vec3 transformed = position + wSide * (aSR.x * wR);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWA; varying float vWS; varying vec3 vWSide;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= pow(vWA, 0.55);')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectSpecular *= 0.0; reflectedLight.directSpecular *= 0.3;')     // matte paint: no mirror of the sky (see sqColor)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(normal * sqrt(max(0.0, 1.0 - vWS * vWS)) + vWSide * vWS);');
  };
  m.customProgramCacheKey = () => 'mb_wire3';
  m.userData.uni = uni; return m;
}
// vertex colours are stored as square roots (see Geo.mesh)
// matte (helper mbridge 3): the paint's mirror of the sky is switched off. The steel's own colour reflects 1 to 3 % of the light, so the 4 % sky mirror every
// MeshStandardMaterial has was as bright as the paint and did not move when the colour table was lowered: the tower stayed sky blue.
function sqColor(m, weather = false, matte = false) { const prev = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vColor.rgb *= vColor.rgb;');
    if (matte) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectSpecular *= 0.0; reflectedLight.directSpecular *= 0.3;');
    if (weather) { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBBp;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBBp = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBBp;\nfloat bbH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat bbN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(bbH(i), bbH(i + vec2(1.0, 0.0)), f.x), mix(bbH(i + vec2(0.0, 1.0)), bbH(i + vec2(1.0, 1.0)), f.x), f.y); }')
        .replace('#include <color_fragment>', '#include <color_fragment>\n { float st = bbN(vec2((vBBp.x + vBBp.z) * 1.1, vBBp.y * 0.045)), bl = bbN(vBBp.xy * 0.11 + vBBp.z * 0.13), fine = bbN(vBBp.xy * 0.9 + vBBp.z * 0.7);\n diffuseColor.rgb *= (0.66 + 0.34 * smoothstep(0.15, 0.8, st)) * (0.8 + 0.2 * bl) * (0.92 + 0.08 * fine) * mix(0.5, 1.0, smoothstep(-1.2, 3.5, vBBp.y)); }'); } };
  m.customProgramCacheKey = () => (weather ? 'mb_sq_w' : 'mb_sq') + (matte ? '_m3' : ''); return m; }

// ------------------------------------------------------------------------------------------------ painted picture: pale granite ashlar
function ashlar() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'); let seed = 23; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = 'rgb(96,94,90)'; g.fillRect(0, 0, S, S);
  const rows = 8, rh = S / rows;
  for (let j = 0; j < rows; j++) { let x = -r() * 90;
    while (x < S) { const w = 80 + r() * 90, v = 0.88 + r() * 0.18, warm = (r() - 0.5) * 8; g.fillStyle = `rgb(${Math.round(186 * v + warm)},${Math.round(182 * v)},${Math.round(174 * v - warm)})`;
      for (const xx of [x, x - S]) g.fillRect(xx + 1.2, j * rh + 1.2, w - 2.4, rh - 2.4); x += w; } }
  for (let i = 0; i < 14000; i++) { const x = r() * S, y = r() * S, a = 0.03 + r() * 0.06; g.fillStyle = r() < 0.5 ? `rgba(40,38,34,${a})` : `rgba(240,238,230,${a})`; g.fillRect(x, y, 1 + r() * 2.5, 1 + r() * 2.5); }
  for (let i = 0; i < 30; i++) { const x = r() * S, y = r() * S, h = 60 + r() * 200, a = 0.04 + r() * 0.06; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, `rgba(30,28,24,${a})`); gr.addColorStop(1, 'rgba(30,28,24,0)'); g.fillStyle = gr; for (const yy of [y, y - S]) g.fillRect(x, yy, 4 + r() * 14, h); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// rows by station on the straight axis: lateral t = Z
const SR = (s0, s1, step, zf) => { const n = Math.max(1, Math.round((s1 - s0) / step)), out = []; for (let k = 0; k <= n; k++) { const s = s0 + (s1 - s0) * k / n; out.push({ p: [s, zf(s), 0], l: [0, 1], d: s }); } return out; };
// a wall across the axis between Z = -zh..zh and X0..X1 whose underside is half an ellipse (spring at the sides, crown in the middle), filled up to yTop
function archFill(G, X0, X1, zc, zh, ySpring, yCrown, yTop, col, n = 12) {
  const yy = (z) => ySpring + (yCrown - ySpring) * Math.sqrt(Math.max(0, 1 - (z / zh) ** 2));
  for (let i = 0; i < n; i++) { const a = -zh + 2 * zh * i / n, b = -zh + 2 * zh * (i + 1) / n, ya = yy(a), yb = yy(b);
    for (const [X, f] of [[X0, -1], [X1, 1]]) G.quad([X, ya, zc + a], [X, yb, zc + b], [X, yTop, zc + b], [X, yTop, zc + a], col, [f, 0, 0]);
    G.quad([X0, ya, zc + a], [X1, ya, zc + a], [X1, yb, zc + b], [X0, yb, zc + b], mul(col, 0.6), [0, -1, 0]); }
  G.quad([X0, yTop, zc - zh], [X1, yTop, zc - zh], [X1, yTop, zc + zh], [X0, yTop, zc + zh], col, [0, 1, 0]);
}
function ball(G, c, r, col, nu = 10, nv = 6) {
  const P = (i, j) => { const th = Math.PI * j / nv, ph = 2 * Math.PI * i / nu; return [c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph)]; };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = P(i, j), b = P(i + 1, j), d = P(i, j + 1), e = P(i + 1, j + 1), m = [(a[0] + e[0]) / 2 - c[0], (a[1] + e[1]) / 2 - c[1], (a[2] + e[2]) / 2 - c[2]]; G.tri(a, b, e, col, m); G.tri(a, e, d, col, m); }
}
const tick0 = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------------------------------------ the bridge
async function build(game, st) {
  const w = game.world;
  const A = (typeof window !== 'undefined' && window.__ASSETS) || 'assets/';
  const decks = (await (await fetch(A + 'decks/decks.json')).json()).decks;
  const toL = (p) => { const dx = p[0] - A0[0], dy = p[1] - A0[1]; return [dx * U[0] + dy * U[1], p[2], dx * N[0] + dy * N[1]]; };
  const D = {}; for (const d of decks) if (/^mb-/.test(d.id)) D[d.id] = { ...d, L: d.pts.map(toL) };
  if (!D['mb-low']) throw new Error('no mb- decks in decks.json (run lanes/brooklyn/tools/mb_decks.py)');
  const tab = (pts) => { const a = pts.map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]);
    return (s) => { if (s <= a[0][0]) return a[0][1]; let lo = 0, hi = a.length - 1; if (s >= a[hi][0]) return a[hi][1]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m][0] <= s) lo = m; else hi = m; } const t = (s - a[lo][0]) / ((a[hi][0] - a[lo][0]) || 1); return a[lo][1] + (a[hi][1] - a[lo][1]) * t; }; };
  const zLow = tab(D['mb-low'].L), zUpB = tab(D['mb-up-bk'].L), zUpM = tab(D['mb-up-mn'].L), zUp = (s, sg) => (sg > 0 ? zUpB(s) : zUpM(s));
  const S0 = AN1 - ANCH_L, S1 = AN2 + ANCH_L;                 // the trussed length: anchorage to anchorage, far ends
  const yLow = zLow(MID) + LIFT + 2.2, kC = (2 * (Y_SAD - yLow)) / ((T2 - T1) / 2) ** 2;
  const yA1 = zLow(AN1) + LIFT + 1.5, yA2 = zLow(AN2) + LIFT + 1.5, a1 = (Y_SAD - yA1 - 0.5 * kC * SIDE * SIDE) / SIDE, a2 = (Y_SAD - yA2 - 0.5 * kC * SIDE * SIDE) / SIDE;
  const zCable = (s) => { if (s < AN1) { const x = s - AN1; return yA1 + a1 * x - 0.02 * x * x; } if (s > AN2) { const x = AN2 - s; return yA2 + a2 * x - 0.02 * x * x; }
    if (s <= T1) { const x = s - AN1; return yA1 + a1 * x + 0.5 * kC * x * x; } if (s >= T2) { const x = AN2 - s; return yA2 + a2 * x + 0.5 * kC * x * x; }
    return yLow + 0.5 * kC * (s - MID) * (s - MID); };
  const stone = new Geo(), steel = new Geo(), paint = new Geo(), far = new Geo(), wires = new Wires(), lights = [];
  await tick0();

  // ---------------------------------------------------------------- towers: a granite pier in the river, four slender steel legs, X lattice, arched portals, finial balls
  const tower = (T) => {
    const zl = zLow(T), B = C.steel, Bd = mul(C.steel, 0.86);
    const R = (e) => [[T - 10.2 - e, -21.5 - e], [T + 10.2 + e, -21.5 - e], [T + 10.2 + e, 21.5 + e], [T - 10.2 - e, 21.5 + e]];
    stone.loft(R(0.6), R(0), -9, Y_PIER - 1.4, mul(C.stone, 0.92)); stone.loft(R(0.5), R(0.5), Y_PIER - 1.4, Y_PIER - 0.5, C.stone, { top: true, bottom: true }); stone.loft(R(-0.6), R(-0.6), Y_PIER - 0.5, Y_PIER, C.stone, { top: true });
    const hx = (y) => (y < zl ? 4.6 + (2.3 - 4.6) * (y - Y_PIER) / (zl - Y_PIER) : 2.3 + (1.6 - 2.3) * (y - zl) / (Y_SAD - zl));      // half length of a leg along the axis
    const leg = (zc, y, e = 0) => [[T - hx(y) - e, zc - 1.0 - e], [T + hx(y) + e, zc - 1.0 - e], [T + hx(y) + e, zc + 1.0 + e], [T - hx(y) - e, zc + 1.0 + e]];
    for (const zc of [-O_OUT, -O_IN, O_IN, O_OUT]) {
      steel.loft(leg(zc, Y_PIER), leg(zc, zl), Y_PIER, zl, B); steel.loft(leg(zc, zl), leg(zc, Y_SAD - 1.5), zl, Y_SAD - 1.5, B);
      steel.loft(leg(zc, Y_PIER, 0.5), leg(zc, Y_PIER, 0.4), Y_PIER, Y_PIER + 1.6, Bd, { top: true });                      // the shoe
      steel.loft(leg(zc, Y_SAD, 0.45), leg(zc, Y_SAD, 0.45), Y_SAD - 1.5, Y_SAD + 0.9, B, { top: true, bottom: true });           // the saddle housing
      steel.box(T - 0.8, T + 0.8, Y_SAD + 0.9, Y_SAD + 1.9, zc - 0.8, zc + 0.8, B, { top: true }); ball(steel, [T, Y_SAD + 2.95, zc], 1.15, B);
      wires.seg([T, Y_SAD + 4.0, zc], [T, Y_SAD + 5.6, zc], 0.07, C.rail); }
    const beam = (z0, z1, y0, y1, h = 1.25) => steel.box(T - h, T + h, y0, y1, z0, z1, B, { top: true, bottom: true });
    const LAT = mul(C.steel, 1.15), GUS = 0.55;      // lattice bars in the legs' own paint (they were the pale wire grey); a gusset plate where each X crosses
    const xpanel = (z0, z1, y0, y1) => { const zm = (z0 + z1) / 2, ym = (y0 + y1) / 2; for (const X of [T - 1.15, T + 1.15]) { wires.seg([X, y0, z0], [X, y1, z1], 0.2, LAT); wires.seg([X, y0, z1], [X, y1, z0], 0.2, LAT); }
      steel.box(T - 1.2, T + 1.2, ym - GUS, ym + GUS, zm - GUS, zm + GUS, B, { top: true, bottom: true }); };
    const stack = (z0, z1, ys) => { for (let i = 0; i < ys.length; i++) { const hb = i === 0 || i === ys.length - 1 ? 0.5 : 0.28; beam(z0, z1, ys[i] - hb, ys[i] + hb); if (i < ys.length - 1) xpanel(z0, z1, ys[i] + hb, ys[i + 1] - (i === ys.length - 2 ? 0.5 : 0.28)); } };
    const dk0 = zl - 3.4, dk1 = zl - 1.45, open = zl + LIFT + 6.3;
    for (const sg of [1, -1]) { const z0 = sg * (O_IN + 1.0), z1 = sg * (O_OUT - 1.0);
      { const yl = [], nL = 5; for (let k = 0; k <= nL; k++) yl.push(Y_PIER + 2.2 + (dk0 + 0.5 - Y_PIER - 2.2) * k / nL); stack(z0, z1, yl); }      // five X panels under the deck (were three)
      const ys = [], nU = 8; for (let k = 0; k <= nU; k++) ys.push(open + (Y_SAD - 4 - open) * k / nU); stack(z0, z1, ys); }      // eight X panels over the roadway (were five)
    beam(-O_OUT, O_OUT, dk0, dk1, 1.5);                                                                    // the girder the deck rests on
    beam(-O_IN + 1, O_IN - 1, Y_PIER + 1.7, Y_PIER + 2.7);
    archFill(steel, T - 1.25, T + 1.25, 0, O_IN - 1, dk0 - 6.5, dk0 - 1.4, dk0, B);                           // the arched opening under the deck (the one the Empire State Building shows through)
    archFill(steel, T - 1.25, T + 1.25, 0, O_IN - 1, Y_SAD - 17, Y_SAD - 10.5, Y_SAD - 3.6, B);            // the tall arched opening over the roadway, up to the top strut
    for (const X of [T - 1.1, T + 1.1]) wires.seg([X, zl + 24, -O_IN + 1], [X, zl + 24, O_IN - 1], 0.3, LAT);
    for (const sg of [1, -1]) archFill(steel, T - 1.25, T + 1.25, sg * (O_IN + O_OUT) / 2, (O_OUT - O_IN) / 2 - 1, open - 2.6, open - 0.6, open - 0.4, B, 8);
    steel.box(T - 2.0, T + 2.0, Y_SAD - 3.6, Y_SAD - 2.2, -O_OUT - 1.3, O_OUT + 1.3, B, { top: true, bottom: true });      // the cornice across all four legs
  };
  tower(T1); tower(T2);
  await tick0();

  // ---------------------------------------------------------------- anchorages: a granite block, a tall round arch through each side face
  const anchorage = (s0, s1, sa) => {
    const top = SR(s0, s1, (s1 - s0) / 4, zLow), W = ANCH_W, hw = ARCH_HW, sp = ARCH_SPRING, zt = (s) => zLow(s) + 1.1, shade = mul(C.stone, 0.62), n = 12;
    const arc = []; for (let i = 0; i <= n; i++) { const th = Math.PI * (1 - i / n); arc.push([sa + hw * Math.cos(th), sp + hw * Math.sin(th)]); }
    for (const sg of [1, -1]) { const Z = sg * W, h = [0, 0, sg];
      stone.quad([s0, 0, Z], [sa - hw, 0, Z], [sa - hw, zt(sa - hw), Z], [s0, zt(s0), Z], C.stone, h); stone.quad([sa + hw, 0, Z], [s1, 0, Z], [s1, zt(s1), Z], [sa + hw, zt(sa + hw), Z], C.stone, h);
      for (let i = 0; i < n; i++) { const p = arc[i], q = arc[i + 1]; stone.quad([p[0], p[1], Z], [q[0], q[1], Z], [q[0], zt(q[0]), Z], [p[0], zt(p[0]), Z], C.stone, h);
        const r0 = 1.0, r1 = 1.14, P = (v, k) => [sa + (v[0] - sa) * k, sp + (v[1] - sp) * k, Z + sg * 0.25];                                   // the ring of arch stones, a little proud of the face
        stone.quad(P(p, r0), P(q, r0), P(q, r1), P(p, r1), mul(C.stone, 1.04), h); stone.quad(P(p, r1), P(q, r1), [sa + (q[0] - sa) * r1, sp + (q[1] - sp) * r1, Z], [sa + (p[0] - sa) * r1, sp + (p[1] - sp) * r1, Z], C.stone, [p[0] - sa, p[1] - sp, 0]); }
      strip(stone, top, sg * W - (sg > 0 ? 0.8 : 0), sg * W + (sg > 0 ? 0 : 0.8), -0.06, 1.1, C.stone, { bottom: false });
      for (const s of [sa - hw - 5, sa + hw + 5, sa < (s0 + s1) / 2 ? s1 - 7 : s0 + 7]) { const P = [[s - 2.6, sg * W - 1], [s + 2.6, sg * W - 1], [s + 2.6, sg * (W + 1.1) + 0.1], [s - 2.6, sg * (W + 1.1) + 0.1]]; stone.loft(P, P, 0, zLow(s) + 2.4, C.stone, { top: true }); } }    // buttresses either side of the arch
    // the passage itself: open from side to side (a street runs through), barrel vault over it
    for (let i = 0; i < n; i++) { const p = arc[i], q = arc[i + 1]; stone.quad([p[0], p[1], -W], [q[0], q[1], -W], [q[0], q[1], W], [p[0], p[1], W], shade, [sa - (p[0] + q[0]) / 2, sp - (p[1] + q[1]) / 2, 0]); }
    for (const f of [-1, 1]) stone.quad([sa + f * hw, 0, -W], [sa + f * hw, 0, W], [sa + f * hw, sp, W], [sa + f * hw, sp, -W], shade, [-f, 0, 0]);
    ribbon(stone, top, [-W, W], () => mul(C.stone, 0.8), -0.06);
    for (const [s, f] of [[s0, -1], [s1, 1]]) { const y = zLow(s) - 0.06; stone.quad([s, 0, -W], [s, 0, W], [s, y, W], [s, y, -W], C.stone, [f, 0, 0]); }
    for (const [x0, x1] of [[s0 - 0.8, sa - hw], [sa + hw, s1 + 0.8]]) { const P = [[x0, -W - 0.8], [x1, -W - 0.8], [x1, W + 0.8], [x0, W + 0.8]]; stone.loft(P, P, 0, 2.4, mul(C.stone, 0.88), { top: true }); }
  };
  anchorage(S0, AN1, ARCH_MN); anchorage(AN2, S1, ARCH_BK);

  // ---------------------------------------------------------------- the surfaces (decks.json): roads, paths, their slabs, barriers and fences
  const dash = (a, b) => { const out = []; for (let m = Math.ceil(a / 12) * 12; m < b; m += 12) { if (m > a) out.push(m); } for (let m = Math.ceil((a - 3) / 12) * 12 + 3; m < b; m += 12) { if (m > a) out.push(m); } return out.sort((x, y) => x - y); };
  const onDash = (a) => ((a.d % 12) + 12) % 12 < 2.99;
  const halves = (rows, f) => [rows.filter((r) => r.p[0] < MID && f(r)), rows.filter((r) => r.p[0] >= MID && f(r))].filter((q) => q.length > 1);
  const lowWall = (rows, hw) => { for (const seg of halves(rows, (r) => r.p[1] < 4.6)) for (const sg of [1, -1]) wallAlong(stone, seg, sg * (hw + 0.3), sg, { bay: 8, aw: 4, cover: 0.7, maxSpring: 2, minSpring: 1.0, depth: 1.0, dz: -0.03 }); };
  for (const id of ['mb-low', 'mb-up-bk', 'mb-up-mn']) { const d = D[id], hw = d.w / 2, n = d.lanes, fine = rowsOf(d.L, dash), rows = rowsOf(d.L);
    const ts = [-hw, -hw + 0.15]; for (let k = 1; k < n; k++) { const x = -hw + (2 * hw * k) / n; ts.push(x - 0.07, x + 0.07); } ts.push(hw - 0.15, hw);
    ribbon(paint, fine, ts, (k, a) => (k === 0 || k === 2 * n ? C.line : k % 2 === 0 ? (onDash(a) ? C.line : C.asphalt) : C.asphalt));
    strip(paint, rows, -hw - 0.3, hw + 0.3, -1.4, -0.03, C.steel, { top: false, colBottom: C.under });
    for (const sg of [1, -1]) strip(paint, rows, sg * hw, sg * (hw + 0.3), -0.03, 0.85, C.steel, { bottom: false });     // the upper roadways' parapets in the bridge's paint too (were pale concrete: the 'plain slab' edge)
    for (const seg of halves(rows, (r) => r.p[0] < S0 || r.p[0] > S1)) for (const sg of [1, -1]) strip(paint, seg, sg * (hw + 0.02), sg * (hw + 0.3), -3.0, -1.4, C.steel, { top: false, colBottom: C.under });     // the approach viaduct's plate girders
    lowWall(rows, hw); }
  for (const id of ['mb-walk', 'mb-bike']) { const d = D[id], hw = d.w / 2, rows = rowsOf(d.L);
    ribbon(paint, rows, [-hw, hw], () => C.concrete);
    strip(paint, rows, -hw - 0.1, hw + 0.1, -0.45, -0.03, C.steel, { top: false, colBottom: C.under });
    for (const sg of [1, -1]) { for (const [h, r] of [[0.45, 0.02], [1.1, 0.035], [2.5, 0.035]]) wires.path(rows.map((q) => at(q, sg * hw, h)), r, C.rail);
      for (let i = 0; i < rows.length; i++) wires.seg(at(rows[i], sg * hw, 0), at(rows[i], sg * hw, 2.5), 0.04, C.rail); }
    lowWall(rows, hw); }
  await tick0();

  // ---------------------------------------------------------------- the two-level truss, anchorage to anchorage: floor, subway tracks, four Warren trusses
  { const rows = SR(S0, S1, 16, zLow);
    strip(paint, rows, -O_OUT - 0.3, O_OUT + 0.3, -1.75, -1.4, C.steel, { top: false, colBottom: C.under });
    { const nF = Math.round((S1 - S0) / 6.85), pf = (S1 - S0) / nF, FB = mul(C.steel, 0.55);      // the dark underside: a floor beam under every truss panel point, two stringers the length of it
      for (let k = 0; k <= nF; k++) { const s = S0 + k * pf, y = zLow(s); paint.box(s - 0.3, s + 0.3, y - 3.1, y - 1.75, -O_OUT - 0.3, O_OUT + 0.3, FB, { bottom: true }); }
      for (const zc of [-10.05, -3.0, 3.0, 10.05]) strip(paint, rows, zc - 0.25, zc + 0.25, -2.7, -1.75, FB, { top: false, colBottom: C.under }); }
    const fr = SR(0, LEN, 28, zLow); strip(far, fr, -O_OUT - 0.3, O_OUT + 0.3, -1.6, 0, C.asphalt, { colBottom: C.under });
    for (const sg of [1, -1]) { const fu = SR(-48, UPF, 28, (s) => zUp(s, sg)); strip(far, fu, sg * (O_IN + 0.3), sg * (O_OUT + 0.3), -1.4, 0, C.asphalt, { colBottom: C.under }); }
    const tr = SR(S0 + 8, S1 - 8, 8, zLow);
    for (const sg of [1, -1]) { ribbon(paint, tr, [6.5, 6.8, 9.4, 10.7, 13.3, 13.6].map((v) => sg * v), (k) => (k % 2 ? C.tie : C.grate), -0.3);
      for (const zc of [8.1, 12.0]) for (const e of [-0.72, 0.72]) wires.path(tr.map((q) => at(q, sg * (zc + e), -0.16)), 0.06, C.railtop);
      for (const s of [S0 + 8, S1 - 8]) paint.box(s - 1.5, s + 1.5, zLow(s) - 0.3, zLow(s) + 5.6, sg * 6.5, sg * 13.6, C.dark); } }     // where the tracks leave for their tunnels
  const nP = Math.round((S1 - S0) / 6.85), pl = (S1 - S0) / nP, yb = (s) => zLow(s) - 0.95, yt = (s) => zLow(s) + 6.45;
  for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) { const tp = [], bt = []; for (let k = 0; k <= nP; k++) { const s = S0 + k * pl; tp.push([s, yt(s), o]); bt.push([s, yb(s), o]); }
    wires.path(tp, 0.42, C.steel); wires.path(bt, 0.5, C.steel);
    for (let k = 0; k <= nP; k++) { wires.seg(bt[k], tp[k], 0.17, C.steel); if (k < nP) wires.seg(k % 2 ? tp[k] : bt[k], k % 2 ? bt[k + 1] : tp[k + 1], Math.abs(o) > 10 ? 0.34 : 0.26, C.steel); } }      // heavier Warren web (was 0.19 / 0.1): it reads as a truss from the street
  for (let k = 0; k <= nP; k++) { const s = S0 + k * pl; wires.seg([s, yt(s), -O_IN], [s, yt(s), O_IN], 0.16, C.steel); if (k < nP) wires.seg([s, yt(s), k % 2 ? -O_IN : O_IN], [s + pl, yt(s + pl), k % 2 ? O_IN : -O_IN], 0.07, C.steel); }

  // ---------------------------------------------------------------- four main cables and their suspenders
  for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) { const pts = [];
    for (let s = AN1 - 16; s <= AN2 + 16.01; s += 6) pts.push([s, zCable(s), o]); for (const T of [T1, T2]) pts.push([T, Y_SAD + 0.9, o]); pts.sort((a, b) => a[0] - b[0]);
    wires.path(pts, 0.27, C.cable);
    for (let k = 1; k < nP; k++) { const s = S0 + k * pl; if (s < AN1 + 5 || s > AN2 - 5 || Math.abs(s - T1) < 4 || Math.abs(s - T2) < 4) continue; const yc = zCable(s) - 0.25; if (yc - yt(s) > 0.5) wires.seg([s, yc, o], [s, yt(s), o], 0.05, C.wire); }
    for (let s = AN1 + 6; s < AN2; s += 12) { if (Math.abs(s - T1) < 4 || Math.abs(s - T2) < 4) continue; lights.push([s, zCable(s) + 0.4, o]); } }
  await tick0();

  // ---------------------------------------------------------------- the approach viaducts: granite piers, steel bents
  const pier = (s) => { const y = zLow(s) - 1.4; if (y < 1) return;
    const P = (e) => [[s - 2.2 - e, -19.5 - e], [s + 2.2 + e, -19.5 - e], [s + 2.2 + e, 19.5 + e], [s - 2.2 - e, 19.5 + e]];
    stone.loft(P(0.5), P(0), 0, y - 0.9, C.stone); stone.loft(P(0.4), P(0.4), y - 0.9, y, C.stone, { top: true, bottom: true });
    for (const sg of [1, -1]) { const yu = zUp(s, sg) - 1.4; if (yu - y > 0.8) stone.box(s - 1.5, s + 1.5, y, yu, sg * (O_IN + 0.3), sg * (O_OUT + 0.3), C.stone, { top: true }); } };
  // a steel bent: columns on the truss lines given, a cross girder under each roadway, X bracing in the bays given
  const bent = (s, cols, bays) => { const y = zLow(s) - 1.4, yOf = (o) => (Math.abs(o) > 10 ? zUp(s, Math.sign(o)) - 1.4 : y);
    for (const o of cols) { wires.seg([s, 0, o], [s, yOf(o), o], 0.42, C.steel); steel.box(s - 0.7, s + 0.7, 0, 0.9, o - 0.7, o + 0.7, C.concrete, { top: true }); }
    wires.seg([s, y - 0.5, -O_IN], [s, y - 0.5, O_IN], 0.5, C.steel);
    for (const sg of [1, -1]) { const yu = zUp(s, sg) - 1.4; wires.seg([s, yu - 0.5, sg * O_IN], [s, yu - 0.5, sg * O_OUT], 0.45, C.steel); if (yu - y > 0.6) wires.seg([s, y - 0.5, sg * O_IN], [s, yu - 0.5, sg * O_IN], 0.3, C.steel); }
    for (const [a, b] of bays) { const top = Math.min(yOf(a), yOf(b)) - 1.0; if (top < 3) continue;
      for (let k = 0, nk = Math.max(1, Math.round(top / 8)); k < nk; k++) { const y0 = (top * k) / nk, y1 = (top * (k + 1)) / nk; wires.seg([s, y0, a], [s, y1, b], 0.14, C.steel); wires.seg([s, y1, a], [s, y0, b], 0.14, C.steel); wires.seg([s, y1, a], [s, y1, b], 0.2, C.steel); } } };
  for (const s of PIERS) pier(s);
  for (const s of BENTS) bent(s, [-O_OUT, -O_IN, O_IN, O_OUT], [[-O_OUT, -O_IN], [O_IN, O_OUT]]);
  for (const [s, kind, cols, bays] of BK_SUP) { if (kind === 'pier') pier(s); else bent(s, cols, bays); }
  st.supports = { PIERS, BENTS, BK_SUP };

  // ---------------------------------------------------------------- the Manhattan plaza: the stone arch and the curved colonnade, as simple forms
  { const X0 = -82, X1 = -73, col = C.stone;
    for (const sg of [1, -1]) stone.box(X0, X1, 0, 19, sg * 5.6, sg * 14.5, col, { top: true });
    archFill(stone, X0, X1, 0, 5.6, 9.5, 15.1, 19, col); stone.box(X0 - 0.6, X1 + 0.6, 19, 20.2, -15.1, 15.1, col, { top: true, bottom: true }); stone.box(X0 + 0.5, X1 - 0.5, 20.2, 23.4, -13.5, 13.5, col, { top: true });
    for (const sg of [1, -1]) { let prev = null;
      for (let k = 0; k <= 9; k++) { const th = (Math.PI / 2) * (k / 9), x = -77.5 + 40 * Math.sin(th), z = sg * (16.5 + 30 * (1 - Math.cos(th)));
        stone.box(x - 0.6, x + 0.6, 0, 9.2, z - 0.6, z + 0.6, col, { top: false, bottom: false });
        if (prev) { const dx = x - prev[0], dz = z - prev[1], l = Math.hypot(dx, dz), nx = (-dz / l) * 0.8, nz = (dx / l) * 0.8, P = [[prev[0] + nx, prev[1] + nz], [x + nx, z + nz], [x - nx, z - nz], [prev[0] - nx, prev[1] - nz]]; stone.loft(P, P, 9.2, 11.2, col, { top: true, bottom: true }); }
        prev = [x, z]; } } }
  await tick0();

  // ---------------------------------------------------------------- materials and meshes
  const tA = ashlar();
  const mStone = sqColor(new THREE.MeshStandardMaterial({ map: tA, vertexColors: true, roughness: 0.94, metalness: 0, emissiveMap: tA, emissive: new THREE.Color(0, 0, 0) }));
  const mPaint = sqColor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, emissive: new THREE.Color(0, 0, 0) }), false, true);
  const mWire = wireMaterial();
  const root = new THREE.Group(); root.name = 'mb_bridge'; root.matrixAutoUpdate = false;
  root.matrix.makeBasis(new THREE.Vector3(U[0], 0, -U[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(N[0], 0, -N[1])).setPosition(A0[0], 0, -A0[1]); root.matrixWorld.copy(root.matrix);
  const near = new THREE.Group(), farG = new THREE.Group();
  const sM = stone.mesh(mStone, 'mb_stone'), tM = steel.mesh(mPaint, 'mb_towers'), pM = paint.mesh(mPaint, 'mb_deck'), fM = far.mesh(mPaint, 'mb_far'), wiM = wires.mesh(mWire, 'mb_wires');
  for (const m of [sM, tM, pM]) { m.castShadow = true; m.receiveShadow = true; } fM.castShadow = false; fM.receiveShadow = false;
  const _v = new THREE.Vector3(), _inv = new THREE.Matrix4().copy(root.matrix).invert(), _sz = new THREE.Vector2();
  wiM.onBeforeRender = (r, scene, cam) => { _v.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(_inv); mWire.userData.uni.uCamL.value.copy(_v);
    const rt = r.getRenderTarget(), H = rt ? rt.height : r.getDrawingBufferSize(_sz).y; mWire.userData.uni.uPix.value = cam.isPerspectiveCamera ? (0.62 * 2 * Math.tan((cam.fov * Math.PI) / 360)) / H : 0; };
  const lp = new Float32Array(lights.length * 3), lc = new Float32Array(lp.length); lights.forEach((p, i) => { lp.set(p, i * 3); lc.set([0.82, 0.92, 1.0], i * 3); });
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3)); lg.computeBoundingSphere();
  const mLight = new THREE.PointsMaterial({ size: 1.0, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  mLight.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n gl_PointSize = max(gl_PointSize, 2.2);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n { float q = length(gl_PointCoord - 0.5); if (q > 0.5) discard; diffuseColor.rgb *= smoothstep(0.5, 0.1, q); }'); };
  const lM = new THREE.Points(lg, mLight); lM.name = 'mb_lights'; lM.visible = false;
  near.add(pM); farG.add(fM); root.add(sM, tM, wiM, near, farG, lM); farG.visible = false;
  root.traverse((o) => { o.matrixAutoUpdate = false; if (o !== root) o.updateMatrix(); }); root.updateMatrixWorld(true);
  w.scene.add(root);
  Object.assign(st, { root, near, far: farG, lights: lM, mStone, mPaint, mLight, zLow, zCable,
    tris: { stone: stone.tris, towers: steel.tris, deck: paint.tris, wires: wires.tris, far: far.tris, lights: lights.length },
    nearTris: stone.tris + steel.tris + paint.tris + wires.tris, farTris: stone.tris + steel.tris + far.tris + wires.tris });
}

export function install(game) {
  if (game.mbridge) return game.mbridge;
  const w = game.world, st = (game.mbridge = { root: null, building: false, failed: 0, dist: 1e9, form: 'none' });
  const p0 = [A0[0] - U[0] * 90, A0[1] - U[1] * 90], L = 90 + LEN + 50;
  const dist = (x, y) => { const t = Math.max(0, Math.min(L, (x - p0[0]) * U[0] + (y - p0[1]) * U[1])); return Math.hypot(x - p0[0] - U[0] * t, y - p0[1] - U[1] * t); };
  let nearOn = false;
  const tick = () => { const c = w.camera.position, d = (st.dist = dist(c.x, -c.z));
    if (st.off) { if (st.root) st.root.visible = false; st.form = 'off'; return; }     // game.mbridge.off = true hides it (fps comparisons)
    if (d > (st.root && st.root.visible ? FAR_ON + 200 : FAR_ON)) { if (st.root && st.root.visible) { st.root.visible = false; st.form = 'none'; } return; }
    if (!st.root) { if (!st.building && st.failed < 3) { st.building = true; build(game, st).catch((e) => { st.failed++; console.warn('[mbridge] ' + String((e && e.stack) || e).slice(0, 400)); }).finally(() => { st.building = false; }); } return; }
    st.root.visible = true; nearOn = d < (nearOn ? NEAR_ON + 150 : NEAR_ON); st.near.visible = nearOn; st.far.visible = !nearOn; st.form = nearOn ? 'near' : 'far';
    const n = game.night && typeof game.night.n === 'number' ? game.night.n : 0;
    if (n !== st._n) { st._n = n; st.lights.visible = n > 0.05; st.mLight.color.setScalar(6 * n); st.mStone.emissive.setRGB(0.045 * n, 0.045 * n, 0.045 * n); }
  };
  const render0 = w.render.bind(w);
  w.render = function (t, focus) { try { tick(); } catch (e) { if (st.failed++ > 20) w.render = render0; } return render0(t, focus); };
  st.info = () => ({ form: st.form, dist: Math.round(st.dist), tris: st.tris, nearTris: st.nearTris, farTris: st.farTris, calls: st.root ? { near: 4 + (st.lights.visible ? 1 : 0), far: 4 } : null });
  return st;
}
