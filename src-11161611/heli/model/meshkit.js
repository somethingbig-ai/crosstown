// meshkit.js: a small triangle-soup kit for the helicopter's outside model. Pure maths (no three.js), so the same code builds the
// aircraft in the page and in node (lanes/heli/items/model/preview.mjs draws it without a browser).
// A vertex is S numbers: position 3, normal 3, uv 2, colour 3 (linear), roughness, metalness, clearcoat, texture mix,
// distance to the nearest panel line (m), distance to the nearest window edge (m), baked sky occlusion (1 = open; items/model/bake.mjs fills it).
export const S = 18, LN = 15, SL = 16, AO = 17;

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const lin = (hex) => [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
// a surface: colour (sRGB hex), roughness, metalness, clearcoat, how much of the livery picture shows (0..1)
export const mat = (hex, r = 0.5, m = 0, cc = 0, t = 0) => ({ c: lin(hex), r, m, cc, t });

export class Soup {
  constructor() { this.v = []; this.i = []; this.tc = []; }
  get nv() { return this.v.length / S; }
  get nt() { return this.i.length / 3; }
  add(px, py, pz, nx, ny, nz, m, u = 0, v = 0) { const k = this.v.length / S; this.v.push(px, py, pz, nx, ny, nz, u, v, m.c[0], m.c[1], m.c[2], m.r, m.m, m.cc, m.t, 1, 1, 1); return k; }
  tri(a, b, c, cls = 0) { this.i.push(a, b, c); this.tc.push(cls); }
  // a triangle wound so that its face agrees with the normals stored at its corners
  triN(a, b, c, cls = 0) {
    const v = this.v, A = a * S, B = b * S, C = c * S;
    const ux = v[B] - v[A], uy = v[B + 1] - v[A + 1], uz = v[B + 2] - v[A + 2], wx = v[C] - v[A], wy = v[C + 1] - v[A + 1], wz = v[C + 2] - v[A + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const d = fx * (v[A + 3] + v[B + 3] + v[C + 3]) + fy * (v[A + 4] + v[B + 4] + v[C + 4]) + fz * (v[A + 5] + v[B + 5] + v[C + 5]);
    if (d >= 0) this.tri(a, b, c, cls); else this.tri(a, c, b, cls);
  }
  quadN(a, b, c, d, cls = 0) { this.triN(a, b, c, cls); this.triN(a, c, d, cls); }
  // another soup's triangles added to this one
  append(o) { const base = this.nv; for (let k = 0; k < o.v.length; k++) this.v.push(o.v[k]); for (let k = 0; k < o.i.length; k++) this.i.push(o.i[k] + base); for (let k = 0; k < o.tc.length; k++) this.tc.push(o.tc[k]); return this; }
  // move the vertices from `from` on: p' = R p + t (R a row-major 3x3), normals turned with R
  place(from, R, t) {
    const v = this.v;
    for (let k = from * S; k < v.length; k += S) {
      const x = v[k], y = v[k + 1], z = v[k + 2], nx = v[k + 3], ny = v[k + 4], nz = v[k + 5];
      v[k] = R[0] * x + R[1] * y + R[2] * z + t[0]; v[k + 1] = R[3] * x + R[4] * y + R[5] * z + t[1]; v[k + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
      v[k + 3] = R[0] * nx + R[1] * ny + R[2] * nz; v[k + 4] = R[3] * nx + R[4] * ny + R[5] * nz; v[k + 5] = R[6] * nx + R[7] * ny + R[8] * nz;
    }
    return this;
  }
  // mirror the vertices from `from` on across z = 0 (and turn their triangles over)
  mirrorZ(fromV, fromT) { const v = this.v; for (let k = fromV * S; k < v.length; k += S) { v[k + 2] = -v[k + 2]; v[k + 5] = -v[k + 5]; } for (let k = fromT * 3; k < this.i.length; k += 3) { const q = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = q; } return this; }
  // a mirrored copy (across z = 0) of everything from vertex fromV / triangle fromT on
  mirrorCopyZ(fromV, fromT) {
    const v = this.v, nv0 = this.nv, nt0 = this.nt;
    for (let k = fromV * S; k < nv0 * S; k += S) { for (let q = 0; q < S; q++) v.push(v[k + q]); const e = v.length - S; v[e + 2] = -v[e + 2]; v[e + 5] = -v[e + 5]; }
    for (let t = fromT; t < nt0; t++) { this.i.push(this.i[t * 3] - fromV + nv0, this.i[t * 3 + 2] - fromV + nv0, this.i[t * 3 + 1] - fromV + nv0); this.tc.push(this.tc[t]); }
    return this;
  }
  setMat(from, m) { const v = this.v; for (let k = from * S; k < v.length; k += S) { v[k + 8] = m.c[0]; v[k + 9] = m.c[1]; v[k + 10] = m.c[2]; v[k + 11] = m.r; v[k + 12] = m.m; v[k + 13] = m.cc; v[k + 14] = m.t; } }
}

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
export const mul3 = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
// the rotation that carries +Y onto the unit vector d
export function alignY(d) {
  const [x, y, z] = d; if (y > 0.99999) return I3.slice(); if (y < -0.99999) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const ax = z, az = -x, s = Math.hypot(ax, az), c = y, ux = ax / s, uz = az / s, t = 1 - c;      // axis = Y x d
  return [t * ux * ux + c, -s * uz, t * ux * uz, s * uz, c, -s * ux, t * ux * uz, s * ux, t * uz * uz + c];
}

// a monotone cubic through the points [[x, y], ...] (x rising): smooth, and never overshoots its knots
export function curve(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = Math.hypot(a, b); if (h > 3) { m[i] = 3 * a / h * d[i]; m[i + 1] = 3 * b / h * d[i]; } }
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// a smooth path through 3D points (Catmull-Rom), `per` samples a span
export function smoothPath(pts, per = 8) {
  const out = [], n = pts.length, P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < per; k++) {
    const t = k / per, a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2), t2 = t * t, t3 = t2 * t, o = [0, 0, 0];
    for (let q = 0; q < 3; q++) o[q] = 0.5 * (2 * b[q] + (-a[q] + c[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t2 + (-a[q] + 3 * b[q] - 3 * c[q] + d[q]) * t3);
    out.push(o);
  }
  out.push(pts[n - 1].slice()); return out;
}

// a surface from a function: fn(u, v, out) writes a point; rows over `us`, columns over `vs`. wrap: the last column joins the first.
// Normals come from the function's own slopes; `out` says which way is outside: 1 or -1 times (dP/du x dP/dv).
export function loft(s, fn, us, vs, m, o = {}) {
  const nu = us.length, nw = vs.length, base = s.nv, e = o.eps || 2e-4, sg = o.out || 1, a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0], p = [0, 0, 0];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nw; j++) {
    const u = us[i], v = vs[j]; fn(u, v, p); fn(u + e, v, a); fn(u - e, v, b); fn(u, v + e, c); fn(u, v - e, d);
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
    let nx = (uy * vz - uz * vy) * sg, ny = (uz * vx - ux * vz) * sg, nz = (ux * vy - uy * vx) * sg, l = Math.hypot(nx, ny, nz);
    if (l < 1e-13) { const q = o.pole ? o.pole(u, v) : [1, 0, 0]; nx = q[0]; ny = q[1]; nz = q[2]; l = 1; }
    else if (o.away) { const q = o.away(u, v, p); if (nx * (p[0] - q[0]) + ny * (p[1] - q[1]) + nz * (p[2] - q[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; } }
    s.add(p[0], p[1], p[2], nx / l, ny / l, nz / l, m);
  }
  const cols = o.wrap ? nw : nw - 1, cls = o.cls || 0;
  for (let i = 0; i < nu - 1; i++) for (let j = 0; j < cols; j++) { const j1 = (j + 1) % nw, A = base + i * nw + j, B = base + i * nw + j1, C = base + (i + 1) * nw + j1, D = base + (i + 1) * nw + j; s.quadN(A, B, C, D, cls); }
  return base;
}

// a round tube along a path of points; r a number or a function of the point index; caps: 0 none, 1 flat ends
export function tube(s, pts, r, seg, m, o = {}) {
  const n = pts.length, base = s.nv, rf = typeof r === 'function' ? r : () => r;
  let T0 = null, Nx = 0, Ny = 0, Nz = 0;
  const tan = (i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
  const frames = [];
  for (let i = 0; i < n; i++) {
    const T = tan(i);
    if (!T0) { const up = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; Nx = up[1] * T[2] - up[2] * T[1]; Ny = up[2] * T[0] - up[0] * T[2]; Nz = up[0] * T[1] - up[1] * T[0]; }
    // carry the last normal along: take out what lies along the new tangent
    const dt = Nx * T[0] + Ny * T[1] + Nz * T[2]; Nx -= dt * T[0]; Ny -= dt * T[1]; Nz -= dt * T[2]; const l = Math.hypot(Nx, Ny, Nz) || 1; Nx /= l; Ny /= l; Nz /= l;
    const Bx = T[1] * Nz - T[2] * Ny, By = T[2] * Nx - T[0] * Nz, Bz = T[0] * Ny - T[1] * Nx; frames.push([T, [Nx, Ny, Nz], [Bx, By, Bz]]); T0 = T;
  }
  for (let i = 0; i < n; i++) { const [, N, B] = frames[i], p = pts[i], rr = rf(i); for (let j = 0; j < seg; j++) { const a = j / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), dx = ca * N[0] + sa * B[0], dy = ca * N[1] + sa * B[1], dz = ca * N[2] + sa * B[2]; s.add(p[0] + dx * rr, p[1] + dy * rr, p[2] + dz * rr, dx, dy, dz, m); } }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const j1 = (j + 1) % seg; s.quadN(base + i * seg + j, base + i * seg + j1, base + (i + 1) * seg + j1, base + (i + 1) * seg + j); }
  if (o.caps) for (const e of [0, n - 1]) {
    const T = frames[e][0], sg = e ? 1 : -1, p = pts[e], rr = rf(e), c = s.add(p[0], p[1], p[2], T[0] * sg, T[1] * sg, T[2] * sg, o.capMat || m), ring = s.nv;
    for (let j = 0; j < seg; j++) { const a = j / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), [, N, B] = frames[e]; s.add(p[0] + (ca * N[0] + sa * B[0]) * rr, p[1] + (ca * N[1] + sa * B[1]) * rr, p[2] + (ca * N[2] + sa * B[2]) * rr, T[0] * sg, T[1] * sg, T[2] * sg, o.capMat || m); }
    for (let j = 0; j < seg; j++) s.triN(c, ring + j, ring + (j + 1) % seg);
  }
  return base;
}
export const rod = (s, a, b, r, seg, m, o = { caps: 1 }) => tube(s, [a, b], r, seg, m, o);

// a turned shape about +Y: profile [[r, y], ...]; normals from the profile's slope (sharp: true splits the corners)
export function lathe(s, prof, seg, m, o = {}) {
  const base = s.nv, n = prof.length, rows = [];
  const nrm = (i0, i1) => { const dr = prof[i1][0] - prof[i0][0], dy = prof[i1][1] - prof[i0][1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; };
  if (o.sharp) for (let i = 0; i < n - 1; i++) { const q = nrm(i, i + 1); rows.push([prof[i], q], [prof[i + 1], q]); }
  else for (let i = 0; i < n; i++) rows.push([prof[i], nrm(Math.max(0, i - 1), Math.min(n - 1, i + 1))]);
  for (const [p, q] of rows) for (let j = 0; j < seg; j++) { const a = j / seg * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); s.add(p[0] * c, p[1], p[0] * sn, q[0] * c, q[1], q[0] * sn, m); }
  const step = o.sharp ? 2 : 1;
  for (let i = 0; i < rows.length - 1; i += step) for (let j = 0; j < seg; j++) { const j1 = (j + 1) % seg; if (rows[i][0][0] < 1e-6 && rows[i + 1][0][0] < 1e-6) continue; s.quadN(base + i * seg + j, base + i * seg + j1, base + (i + 1) * seg + j1, base + (i + 1) * seg + j); }
  return base;
}

// a box with flat faces, centred at the origin (then place() it)
export function box(s, sx, sy, sz, m) {
  const base = s.nv, h = [sx / 2, sy / 2, sz / 2];
  for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) {
    const n = [0, 0, 0]; n[ax] = sg; const u = (ax + 1) % 3, w = (ax + 2) % 3, k = s.nv;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = [0, 0, 0]; p[ax] = sg * h[ax]; p[u] = a * h[u]; p[w] = b * h[w]; s.add(p[0], p[1], p[2], n[0], n[1], n[2], m); }
    s.quadN(k, k + 1, k + 2, k + 3);
  }
  return base;
}

// Cut the soup along the zero line of sdf(x, y, z): afterwards no triangle crosses it. Returns the distance at every vertex
// (new ones included). attr (LN or SL): also record |distance| there, so the shader can draw the line.
export function split(s, sdf, attr = -1, eps = 3e-4) {
  const v = s.v, d = [], n0 = s.nv;
  for (let k = 0; k < n0; k++) { let x = sdf(v[k * S], v[k * S + 1], v[k * S + 2]); if (Math.abs(x) < eps) x = 0; d.push(x); }
  const cache = new Map(), ni = [], ntc = [];
  const cut = (a, b) => {
    const key = a < b ? a * 4194304 + b : b * 4194304 + a; let k = cache.get(key); if (k !== undefined) return k;
    const t = d[a] / (d[a] - d[b]); k = v.length / S; for (let q = 0; q < S; q++) v.push(v[a * S + q] + (v[b * S + q] - v[a * S + q]) * t);
    const e = k * S, l = Math.hypot(v[e + 3], v[e + 4], v[e + 5]) || 1; v[e + 3] /= l; v[e + 4] /= l; v[e + 5] /= l; d.push(0); cache.set(key, k); return k;
  };
  for (let t = 0; t < s.i.length; t += 3) {
    let a = s.i[t], b = s.i[t + 1], c = s.i[t + 2]; const cls = s.tc[t / 3];
    const pos = (d[a] > 0) + (d[b] > 0) + (d[c] > 0), neg = (d[a] < 0) + (d[b] < 0) + (d[c] < 0);
    if (!pos || !neg) { ni.push(a, b, c); ntc.push(cls); continue; }
    if (pos === 1 && neg === 1) {      // one corner sits on the line: cut the far edge
      while (d[a] !== 0) { const q = a; a = b; b = c; c = q; }
      const m = cut(b, c); ni.push(a, b, m, a, m, c); ntc.push(cls, cls);
    } else {
      const lone = pos === 1 ? 1 : -1; while (Math.sign(d[a]) !== lone) { const q = a; a = b; b = c; c = q; }
      const ab = cut(a, b), ac = cut(a, c); ni.push(a, ab, ac, ab, b, c, ab, c, ac); ntc.push(cls, cls, cls);
    }
  }
  s.i = ni; s.tc = ntc;
  if (attr >= 0) for (let k = 0; k < d.length; k++) { const x = Math.abs(d[k]); if (x < v[k * S + attr]) v[k * S + attr] = x; }
  return d;
}
// which side of a split a triangle is on: > 0 inside (the sdf's positive side)
export function sideOf(s, d, t, sdf) {
  const a = s.i[t * 3], b = s.i[t * 3 + 1], c = s.i[t * 3 + 2], q = d[a] + d[b] + d[c]; if (q !== 0 || !sdf) return q;
  const v = s.v; return sdf((v[a * S] + v[b * S] + v[c * S]) / 3, (v[a * S + 1] + v[b * S + 1] + v[c * S + 1]) / 3, (v[a * S + 2] + v[b * S + 2] + v[c * S + 2]) / 3);
}
// cut, then give the triangles inside a new class: fn(old class) -> new class
export function cutClass(s, sdf, fn, attr = -1) { const d = split(s, sdf, attr); for (let t = 0; t < s.nt; t++) if (sideOf(s, d, t, sdf) > 0) s.tc[t] = fn(s.tc[t]); return d; }
// the triangles whose class passes, as a new soup
export function extract(s, pred) {
  const o = new Soup(), map = new Map(), v = s.v;
  for (let t = 0; t < s.nt; t++) { if (!pred(s.tc[t])) continue; for (let q = 0; q < 3; q++) { const a = s.i[t * 3 + q]; let k = map.get(a); if (k === undefined) { k = o.v.length / S; for (let e = 0; e < S; e++) o.v.push(v[a * S + e]); map.set(a, k); } o.i.push(k); } o.tc.push(s.tc[t]); }
  return o;
}
// walls where triangles of kind A meet triangles of kind B: from the surface down `depth` along the inward normal, facing into A
export function rims(s, isA, isB, depth, m, out, o = {}) {
  const v = s.v, edges = new Map(), K = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (let t = 0; t < s.nt; t++) if (isA(s.tc[t])) for (let q = 0; q < 3; q++) { const a = s.i[t * 3 + q], b = s.i[t * 3 + (q + 1) % 3]; edges.set(K(a, b), [a, b]); }
  const found = [];
  for (let t = 0; t < s.nt; t++) if (isB(s.tc[t])) for (let q = 0; q < 3; q++) { const e = edges.get(K(s.i[t * 3 + q], s.i[t * 3 + (q + 1) % 3])); if (e) found.push(e); }
  for (const [a, b] of found) {
    const A = a * S, B = b * S, ex = v[B] - v[A], ey = v[B + 1] - v[A + 1], ez = v[B + 2] - v[A + 2];
    const nx = v[A + 3] + v[B + 3], ny = v[A + 4] + v[B + 4], nz = v[A + 5] + v[B + 5];
    let wx = ny * ez - nz * ey, wy = nz * ex - nx * ez, wz = nx * ey - ny * ex; const l = Math.hypot(wx, wy, wz) || 1; wx /= l; wy /= l; wz /= l;
    for (const sg of o.double === false ? [1] : [1, -1]) {
      const k = out.nv, d0 = o.from || 0;
      out.add(v[A] - v[A + 3] * d0, v[A + 1] - v[A + 4] * d0, v[A + 2] - v[A + 5] * d0, wx * sg, wy * sg, wz * sg, m); out.add(v[B] - v[B + 3] * d0, v[B + 1] - v[B + 4] * d0, v[B + 2] - v[B + 5] * d0, wx * sg, wy * sg, wz * sg, m);
      out.add(v[B] - v[B + 3] * depth, v[B + 1] - v[B + 4] * depth, v[B + 2] - v[B + 5] * depth, wx * sg, wy * sg, wz * sg, m); out.add(v[A] - v[A + 3] * depth, v[A + 1] - v[A + 4] * depth, v[A + 2] - v[A + 5] * depth, wx * sg, wy * sg, wz * sg, m);
      out.quadN(k, k + 1, k + 2, k + 3, o.cls || 0);
    }
  }
  return found;
}
// the lines a split left in the mesh (edges whose two ends are on the zero line), chained into paths of [vertex index, ...]
export function zeroPaths(s, d) {
  const nb = new Map(), seen = new Set(), K = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a), v = s.v;
  // corners that share a place (the loft's seam) are one corner
  for (let t = 0; t < s.nt; t++) for (let q = 0; q < 3; q++) {
    const a = s.i[t * 3 + q], b = s.i[t * 3 + (q + 1) % 3]; if (d[a] !== 0 || d[b] !== 0) continue; const k = K(a, b); if (seen.has(k)) continue; seen.add(k);
    if (Math.hypot(v[a * S] - v[b * S], v[a * S + 1] - v[b * S + 1], v[a * S + 2] - v[b * S + 2]) < 1e-7) continue;
    if (!nb.has(a)) nb.set(a, []); if (!nb.has(b)) nb.set(b, []); nb.get(a).push(b); nb.get(b).push(a);
  }
  const paths = [], used = new Set();
  const walk = (start) => { const p = [start]; let prev = -1, cur = start; used.add(start); for (;;) { const nx = (nb.get(cur) || []).find((q) => q !== prev && !used.has(q)); if (nx === undefined) break; p.push(nx); used.add(nx); prev = cur; cur = nx; } return p; };
  for (const [k, list] of nb) if (list.length === 1 && !used.has(k)) paths.push(walk(k));
  for (const k of nb.keys()) if (!used.has(k)) { const p = walk(k); if (nb.get(p[p.length - 1]).includes(p[0]) && p.length > 2) p.push(p[0]); paths.push(p); }
  return paths.filter((p) => p.length > 1);
}
// points every `pitch` metres along a path of vertex indices: calls fn(p, n, t) with position, surface normal, direction
export function alongPath(s, path, pitch, fn, phase = 0.5) {
  const v = s.v; let acc = pitch * phase;
  for (let k = 0; k < path.length - 1; k++) {
    const A = path[k] * S, B = path[k + 1] * S, ex = v[B] - v[A], ey = v[B + 1] - v[A + 1], ez = v[B + 2] - v[A + 2], L = Math.hypot(ex, ey, ez); if (L < 1e-9) continue;
    while (acc <= L) { const t = acc / L, n = [v[A + 3] + (v[B + 3] - v[A + 3]) * t, v[A + 4] + (v[B + 4] - v[A + 4]) * t, v[A + 5] + (v[B + 5] - v[A + 5]) * t], l = Math.hypot(n[0], n[1], n[2]) || 1; fn([v[A] + ex * t, v[A + 1] + ey * t, v[A + 2] + ez * t], [n[0] / l, n[1] / l, n[2] / l], [ex / L, ey / L, ez / L]); acc += pitch; }
    acc -= L;
  }
}

// distance helpers for cuts (positive inside)
// a rounded meeting of half-spaces: ds = distances inside each (positive inside), r = corner radius
export function roundAll(ds, r) { let mx = -1e9, q2 = 0; for (const d of ds) { const q = r - d; if (q > mx) mx = q; if (q > 0) q2 += q * q; } return r - (Math.sqrt(q2) + Math.min(mx, 0)); }
// a rounded rectangle in two coordinates
export function rrect(x, y, x0, x1, y0, y1, r) { return roundAll([x - x0, x1 - x, y - y0, y1 - y], r); }
