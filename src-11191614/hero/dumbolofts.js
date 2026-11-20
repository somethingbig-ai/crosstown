// dumbolofts.js (brooklyn lane, helper gair, Nov 16): the four buildings that frame THE Washington St view in DUMBO (looking north to the
// Manhattan Bridge from Front St), by hand in place of the generated fronts:
//   2001964 (west, Front-Water) and 2001968 (east, Front-Water): cream reinforced-concrete lofts: flat pilasters, wide multi-pane steel sashes
//     set back in the wall, sills, a belt course and a plain cornice band, a raised loading platform with pipe rails along the Washington St
//     front; the east one has an entrance with "ROBERT GAIT COMPANY" cast over it (a parody name; never the real one).
//   2001971 (west, Water-Plymouth) and 2001962 (east): the matched pair of orange-red brick warehouses: segmental-arched windows in regular
//     bays, stone sills, a corbelled brick cornice, a black fire escape. Both are drawn 30 m tall (the data says 26.4 and 43.6: the photo's pair match).
//   2001974 and 2001975 (the next lots north, to Plymouth St) are brick warehouses of the same make at the heights the data gives: left generated, the east
//     one stood 3.8 m proud of the new brick front (see DX below).
// How: the hero list (assets/hero/hero.json) is a shared hard-linked file, so this module does hero.js's two jobs for its own lots:
//   1. the generated massing of those lots is cut out of the city tiles (hero.js's test: a triangle whose inner side lies in the footprint, and the
//      relief that stands proud of a street front); tiles swap between shell and full as the camera moves, so each new tile geometry is cut when it appears;
//   2. the street-floor layer's instances ('storefronts', 'dressing') on those fronts are taken off (no shop fronts, signs or awnings).
// Then three meshes are drawn (3 draw calls): concrete + trim + ironwork + sash bars + roofs (vertex colours, one small canvas for the cast name), brick (the
// game's photographed red_brick_03, tinted), glass (mirrors the street cube; one canvas tints the panes). MeshStandardMaterials, shadows cast and received.
// The game's solid walls (the footprints) are unchanged. Nothing is built on a map without those building ids. Off: ?lofts=0.
// window.__lofts = { ids, tris: {concrete, brick, glass, total}, cut, pruned, dx }.
import * as THREE from 'three';

const LOTS = { 2001964: { kind: 'loft' }, 2001968: { kind: 'loft', sign: true }, 2001971: { kind: 'brick', h: 30 }, 2001962: { kind: 'brick', h: 30 }, 2001974: { kind: 'brick' }, 2001975: { kind: 'brick' } };
const WASH = [[-235.1, -4521.4], [-238.7, -4594.2], [-242.6, -4669.2]];     // Washington St's centre line, Plymouth St to Front St
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const C = { conc: lin(0xbfae90), conc2: lin(0xb2a183), band: lin(0xc8b99c), dock: lin(0xa39d92), steel: lin(0x4a4d50), frame: lin(0x26282a), roof: lin(0x3b3b3d), door: lin(0x2a2420), iron: lin(0x1b1b1d), white: [1, 1, 1], brick: [2.1, 0.81, 0.73], brickDk: [1.58, 0.61, 0.55], stone: lin(0x8f8272), corn: lin(0x3d342f), corn2: lin(0x4b413a), bulk: lin(0x8d8577) };     // brick, brickDk: tints over the photographed brick (its mean is a dull 106, 83, 75), set so a sunlit front reads near the photo's 184, 108, 97

function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function segDist(x, y, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1); return [Math.hypot(x - a[0] - Math.max(0, Math.min(1, t)) * dx, y - a[1] - Math.max(0, Math.min(1, t)) * dy), t]; }
function washDist(x, y) { let d = 1e9; for (let i = 0; i + 1 < WASH.length; i++) d = Math.min(d, segDist(x, y, WASH[i], WASH[i + 1])[0]); return d; }

// one mesh's worth of quads; points are [x, y up, z]
class Buf {
  constructor(tile) { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.tile = tile || null; this.def = [0.5, 0.05]; }
  poly(pts, hint, col, uvs) {     // a convex polygon as a fan; winding turned to face the hint
    const a = pts[0], b = pts[1], d = pts[pts.length - 1];
    let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const base = this.p.length / 3; for (let k = 0; k < pts.length; k++) { const q = pts[k], uv = uvs ? uvs[k] : this.def; this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.u.push(uv[0], uv[1]); }
    for (let k = 1; k + 1 < pts.length; k++) { if (flip) this.i.push(base, base + k + 1, base + k); else this.i.push(base, base + k, base + k + 1); }
  }
  get tris() { return this.i.length / 3; }
  mesh(mat, name) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; return m; }
}
// a wall frame: s along the edge, z up, o out of the wall
const W3 = (F, s, z, o) => [F.ax + F.dx * s + F.nx * o, z, -(F.ay + F.dy * s + F.ny * o)];
const H3 = (F, h) => [F.dx * h[0] + F.nx * h[2], h[1], -(F.dy * h[0] + F.ny * h[2])];
function fq(buf, F, pts, hint, col, uvs) { const tl = buf.tile; buf.poly(pts.map((q) => W3(F, q[0], q[1], q[2])), H3(F, hint), col, tl ? pts.map((q) => [(F.u0 + q[0] + q[2]) / tl[0], q[1] / tl[1]]) : uvs); }
const panel = (buf, F, s0, s1, z0, z1, o, col, uvs) => { if (s1 - s0 > 1e-3 && z1 - z0 > 1e-3) fq(buf, F, [[s0, z0, o], [s1, z0, o], [s1, z1, o], [s0, z1, o]], [0, 0, 1], col, uvs); };
function box(buf, F, s0, s1, z0, z1, o0, o1, col, faces = 'flrtb') {
  if (faces.includes('f')) fq(buf, F, [[s0, z0, o1], [s1, z0, o1], [s1, z1, o1], [s0, z1, o1]], [0, 0, 1], col);
  if (faces.includes('k')) fq(buf, F, [[s0, z0, o0], [s1, z0, o0], [s1, z1, o0], [s0, z1, o0]], [0, 0, -1], col);
  if (faces.includes('l')) fq(buf, F, [[s0, z0, o0], [s0, z0, o1], [s0, z1, o1], [s0, z1, o0]], [-1, 0, 0], col);
  if (faces.includes('r')) fq(buf, F, [[s1, z0, o0], [s1, z0, o1], [s1, z1, o1], [s1, z1, o0]], [1, 0, 0], col);
  if (faces.includes('t')) fq(buf, F, [[s0, z1, o0], [s1, z1, o0], [s1, z1, o1], [s0, z1, o1]], [0, 1, 0], col);
  if (faces.includes('b')) fq(buf, F, [[s0, z0, o0], [s1, z0, o0], [s1, z0, o1], [s0, z0, o1]], [0, -1, 0], col);
}
// an opening set back `dep` into the wall: jambs, sill, head, and the glass (a quad of the glass canvas, uv = [u0, u1, v0, v1])
function opening(wallBuf, glass, F, s0, s1, z0, z1, dep, col, uv) {
  fq(wallBuf, F, [[s0, z0, 0], [s0, z0, -dep], [s0, z1, -dep], [s0, z1, 0]], [1, 0, 0], col); fq(wallBuf, F, [[s1, z0, 0], [s1, z0, -dep], [s1, z1, -dep], [s1, z1, 0]], [-1, 0, 0], col);
  fq(wallBuf, F, [[s0, z0, 0], [s1, z0, 0], [s1, z0, -dep], [s0, z0, -dep]], [0, 1, 0], col); fq(wallBuf, F, [[s0, z1, 0], [s1, z1, 0], [s1, z1, -dep], [s0, z1, -dep]], [0, -1, 0], col);
  fq(glass, F, [[s0, z0, -dep], [s1, z0, -dep], [s1, z1, -dep], [s0, z1, -dep]], [0, 0, 1], C.white, [[uv[0], uv[2]], [uv[1], uv[2]], [uv[1], uv[3]], [uv[0], uv[3]]]);
}
const hash = (a, b, c) => { const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return v - Math.floor(v); };
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

function wall(B, F, H, lot, exposed, onWash) {
  const loft = lot.kind === 'loft', wb = loft ? B.conc : B.brick, K = B.conc, base = loft ? C.conc : C.brick, L = F.L;
  if (!exposed || L < 5) { panel(wb, F, 0, L, 0, H, 0, loft ? C.conc2 : C.brickDk); return; }
  // bays and floors
  const cm = loft ? 1.3 : 0.9, n = Math.max(1, Math.round((L - 2 * cm) / (loft ? 6.0 : 3.3))), bw = (L - 2 * cm) / n, ww = loft ? bw - 1.5 : 1.5, cols = [];
  for (let i = 0; i < n; i++) { const c = cm + (i + 0.5) * bw; cols.push([c - ww / 2, c + ww / 2]); }
  const wins = [];
  if (loft) { const wh = 2.9, z1 = 6.3; let nf = Math.max(1, Math.floor((H - 2.3 - z1 - wh) / 4.3) + 1), fh = nf > 1 ? (H - 2.5 - z1 - wh) / (nf - 1) : 0; wins.push([2.0, 5.0]); for (let k = 0; k < nf; k++) wins.push([z1 + k * fh, z1 + k * fh + wh]); }
  else { const wh = 2.3, z1 = 1.25; let nf = Math.max(1, Math.floor((H - 2.8 - z1 - wh) / 3.9) + 1), fh = nf > 1 ? (H - 2.9 - z1 - wh) / (nf - 1) : 0; for (let k = 0; k < nf; k++) wins.push([z1 + k * fh, z1 + k * fh + wh]); }
  // the entrance bay (the sign lot's Washington St front): the bay nearest y = -4630
  let door = -1; if (lot.sign && onWash) { let best = 1e9; cols.forEach((c, i) => { const y = F.ay + F.dy * (c[0] + c[1]) / 2, d = Math.abs(y + 4630); if (d < best) { best = d; door = i; } }); }
  // wall face: piers full height, spandrels in each window column (brick spandrels a touch lighter or darker each, as repointed brick is); the doorway is a hole 3 m wide up to 4.5 m
  const edges = [0]; for (const c of cols) edges.push(c[0], c[1]); edges.push(L);
  for (let i = 0; i < edges.length; i += 2) panel(wb, F, edges[i], edges[i + 1], 0, H, 0, base);
  cols.forEach((c, ci) => { let z = 0; wins.forEach((w, wi) => { if (ci === door && wi === 0) return; const col = loft ? C.conc2 : mul(base, 0.94 + 0.1 * hash(F.u0, ci, wi));
      if (ci === door && wi === 1) { const m = (c[0] + c[1]) / 2; panel(wb, F, c[0], m - 1.5, 0, w[0], 0, col); panel(wb, F, m + 1.5, c[1], 0, w[0], 0, col); panel(wb, F, m - 1.5, m + 1.5, 4.5, w[0], 0, col); }
      else panel(wb, F, c[0], c[1], z, w[0], 0, col); z = w[1]; });
    panel(wb, F, c[0], c[1], z, H, 0, loft ? C.conc2 : base); });
  // windows: the glass is one quad of the canvas (a variant picked per window); the steel bars are geometry standing 6 cm proud of it
  cols.forEach((c, ci) => wins.forEach((w, wi) => { if (ci === door && wi === 0) return; const dep = loft ? 0.38 : 0.3, h = hash(F.u0 + 1, ci, wi), mo = -dep + 0.06;
    if (loft) { const v = Math.floor(h * 4) % 4; opening(wb, B.glass, F, c[0], c[1], w[0], w[1], dep, C.conc2, [(v * 256 + 2) / 1024, (v * 256 + 254) / 1024, 0.504, 0.996]);
      for (let i = 1; i < 6; i++) { const s = c[0] + (c[1] - c[0]) * i / 6, t = i === 2 || i === 4 ? 0.05 : 0.022; panel(K, F, s - t, s + t, w[0], w[1], mo, C.frame); }
      for (let j = 1; j < 4; j++) { const z = w[0] + (w[1] - w[0]) * j / 4; panel(K, F, c[0], c[1], z - 0.022, z + 0.022, mo, C.frame); }
      box(K, F, c[0] - 0.08, c[1] + 0.08, w[0] - 0.16, w[0], 0, 0.1, C.band, 'fb');
    } else { const v = Math.floor(h * 8) % 8, sc = (c[0] + c[1]) / 2, zm = (w[0] + w[1]) / 2, hw = ww / 2, r = 0.3, arc = (t) => w[1] - r * (1 - Math.cos(t * Math.PI / 2));
      opening(wb, B.glass, F, c[0], c[1], w[0], w[1], dep, C.brickDk, [(v * 128 + 2) / 1024, (v * 128 + 126) / 1024, 0.004, 0.496]);
      panel(K, F, sc - 0.035, sc + 0.035, w[0], w[1], mo, C.frame); panel(K, F, c[0], c[1], zm - 0.045, zm + 0.045, mo, C.frame);     // two-over-two sash bars
      box(K, F, c[0] - 0.14, c[1] + 0.14, w[0] - 0.2, w[0], 0, 0.12, C.stone, 'fb'); box(K, F, c[0] - 0.2, c[1] + 0.2, w[1] + 0.02, w[1] + 0.26, 0, 0.06, C.stone, 'f');     // stone sill and lintel
      for (const sg of [-1, 1]) { const pts = [[sc + sg * hw, w[1], 0.004]]; for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([sc + sg * hw * t, arc(t), 0.004]); } fq(wb, F, pts, [0, 0, 1], base); } }     // the segmental head: two brick corner pieces at the wall face
  }));
  if (loft) {
    for (let i = 0; i < edges.length; i += 2) { const a = edges[i], b = edges[i + 1], e0 = i === 0, e1 = i === edges.length - 2; box(K, F, e0 ? -0.2 : a + 0.22, e1 ? L + 0.2 : b - 0.22, 0, H - 1.7, 0, 0.2, C.conc, 'flr'); }     // flat pilasters
    box(K, F, -0.3, L + 0.3, 5.42, 5.72, 0, 0.3, C.band); box(K, F, -0.45, L + 0.45, H - 1.75, H - 1.15, 0, 0.5, C.band); box(K, F, -0.2, L + 0.2, H - 0.3, H, 0, 0.12, C.band);     // belt course, cornice band, coping
    if (door >= 0) {     // the entrance: a doorway set 0.5 m into the wall inside a surround of pilasters, architrave, a frieze with the name cast in a sunk panel, a cornice and a low segmental head
      const c = (cols[door][0] + cols[door][1]) / 2, z0 = 1.1, zt = 4.5, dr = 0.5, S = C.band;
      fq(K, F, [[c - 1.5, z0, 0], [c - 1.5, z0, -dr], [c - 1.5, zt, -dr], [c - 1.5, zt, 0]], [1, 0, 0], C.conc2); fq(K, F, [[c + 1.5, z0, 0], [c + 1.5, z0, -dr], [c + 1.5, zt, -dr], [c + 1.5, zt, 0]], [-1, 0, 0], C.conc2);
      fq(K, F, [[c - 1.5, zt, 0], [c + 1.5, zt, 0], [c + 1.5, zt, -dr], [c - 1.5, zt, -dr]], [0, -1, 0], C.conc2); fq(K, F, [[c - 1.5, z0, 0.3], [c + 1.5, z0, 0.3], [c + 1.5, z0, -dr], [c - 1.5, z0, -dr]], [0, 1, 0], C.dock);
      panel(K, F, c - 1.5, c + 1.5, z0, zt, -dr, C.door); panel(K, F, c - 0.05, c + 0.05, z0, 3.62, -dr + 0.05, C.steel); panel(K, F, c - 1.5, c + 1.5, 3.58, 3.72, -dr + 0.05, C.steel);
      for (const sg of [-1, 1]) { const a = c + sg * 0.75 - 0.5, b = a + 1.0; fq(B.glass, F, [[a, z0 + 0.95, -dr + 0.02], [b, z0 + 0.95, -dr + 0.02], [b, 3.4, -dr + 0.02], [a, 3.4, -dr + 0.02]], [0, 0, 1], C.white, [[0.01, 0.52], [0.07, 0.52], [0.07, 0.72], [0.01, 0.72]]); panel(K, F, a + 0.85, a + 0.9, z0 + 1.0, z0 + 1.5, -dr + 0.06, C.band); }     // glazed leaves, pull handles
      fq(B.glass, F, [[c - 1.4, 3.8, -dr + 0.02], [c + 1.4, 3.8, -dr + 0.02], [c + 1.4, 4.42, -dr + 0.02], [c - 1.4, 4.42, -dr + 0.02]], [0, 0, 1], C.white, [[0.26, 0.76], [0.49, 0.76], [0.49, 0.86], [0.26, 0.86]]);     // transom light
      for (const sg of [-1, 1]) { const a = sg < 0 ? c - 2.3 : c + 1.5, b = a + 0.8; box(K, F, a, b, z0, zt, 0, 0.3, S, 'flr'); box(K, F, a - 0.08, b + 0.08, z0, z0 + 0.45, 0, 0.38, S, 'flrt'); box(K, F, a - 0.08, b + 0.08, zt - 0.25, zt, 0, 0.38, S, 'flrtb'); box(K, F, a + 0.2, b - 0.2, z0 + 0.6, zt - 0.4, 0.3, 0.34, C.conc, 'flrtb'); }     // pilasters: plinth, cap, a raised panel
      box(K, F, c - 2.45, c + 2.45, zt, 4.72, 0, 0.36, S, 'flrtb');     // architrave
      box(K, F, c - 2.3, c + 2.3, 4.72, 5.42, 0, 0.3, S, 'lr'); panel(K, F, c - 2.3, c + 2.3, 4.72, 4.82, 0.3, S); panel(K, F, c - 2.3, c + 2.3, 5.32, 5.42, 0.3, S); panel(K, F, c - 2.3, c - 2.15, 4.82, 5.32, 0.3, S); panel(K, F, c + 2.15, c + 2.3, 4.82, 5.32, 0.3, S);     // frieze: a frame
      panel(K, F, c - 2.15, c + 2.15, 4.82, 5.32, 0.24, S, [[0, 0.5], [1, 0.5], [1, 1], [0, 1]]);     // the name, in the sunk panel
      fq(K, F, [[c - 2.15, 5.32, 0.24], [c + 2.15, 5.32, 0.24], [c + 2.15, 5.32, 0.3], [c - 2.15, 5.32, 0.3]], [0, -1, 0], C.conc2); fq(K, F, [[c - 2.15, 4.82, 0.24], [c + 2.15, 4.82, 0.24], [c + 2.15, 4.82, 0.3], [c - 2.15, 4.82, 0.3]], [0, 1, 0], S);
      box(K, F, c - 2.65, c + 2.65, 5.42, 5.58, 0, 0.46, S, 'flrb'); box(K, F, c - 2.75, c + 2.75, 5.58, 5.76, 0, 0.58, S, 'flrtb');     // cornice, two steps
      { const N = 8, hw = 2.5, zb = 5.76, rise = 0.36, o = 0.42, ar = (i) => [c - hw + 2 * hw * i / N, zb + rise * Math.sin(Math.PI * i / N)], pts = []; for (let i = 0; i <= N; i++) { const q = ar(i); pts.push([q[0], q[1], o]); }
        fq(K, F, pts, [0, 0, 1], S); for (let i = 0; i < N; i++) { const p = ar(i), q = ar(i + 1); fq(K, F, [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], o], [p[0], p[1], o]], [0, 1, 0], S); } }     // the segmental head over the cornice
    }
    if (onWash) {     // the raised loading platform and its pipe rails
      const p0 = 0.6, p1 = L - 0.6, top = 1.1, out = 1.9; box(K, F, p0, p1, 0, top, 0, out, C.dock, 'flrt');
      for (const z of [1.45, 1.8, 2.15]) box(K, F, p0, p1, z - 0.025, z + 0.025, out - 0.1, out - 0.05, C.steel, 'ftbk');
      const np = Math.max(2, Math.round((p1 - p0) / 2.4)); for (let k = 0; k <= np; k++) { const s = p0 + 0.03 + (p1 - p0 - 0.06) * k / np; box(K, F, s - 0.03, s + 0.03, top, 2.17, out - 0.105, out - 0.045, C.steel, 'flrk'); }
      for (const s of [p0 + 0.03, p1 - 0.03]) for (const z of [1.45, 1.8, 2.15]) box(K, F, s - 0.025, s + 0.025, z - 0.025, z + 0.025, 0, out - 0.1, C.steel, 'lrtb'); }
  } else {
    // a brick string course under each floor's sills; the cornice: a dentil row, two corbelled brick courses, then a dark bracketed cornice standing 0.85 m out
    wins.forEach((w, wi) => { if (wi) box(wb, F, 0, L, w[0] - 0.52, w[0] - 0.34, 0, 0.05, C.brickDk, 'fb'); });
    for (let s = 0.2; s + 0.45 < L; s += 0.9) box(wb, F, s, s + 0.45, H - 2.3, H - 1.9, 0, 0.14, C.brickDk, 'flrb');
    box(wb, F, -0.14, L + 0.14, H - 1.9, H - 1.6, 0, 0.14, base, 'flrb'); box(wb, F, -0.28, L + 0.28, H - 1.6, H - 1.3, 0, 0.28, base, 'flrb');
    box(K, F, -0.3, L + 0.3, H - 1.3, H - 0.5, 0, 0.3, C.corn, 'flrb');
    for (let i = 0; i <= 2 * n; i++) { const s = Math.min(L - 0.3, Math.max(0.08, cm + i * bw / 2 - 0.11)); box(K, F, s, s + 0.22, H - 1.2, H - 0.5, 0.3, 0.72, C.corn2, 'flrb'); }
    box(K, F, -0.85, L + 0.85, H - 0.5, H - 0.15, 0, 0.85, C.corn, 'flrtb'); box(K, F, -0.95, L + 0.95, H - 0.15, H, -0.05, 0.95, C.corn2, 'flrtb');
    box(K, F, 0, L, 0, 0.5, 0, 0.07, C.stone, 'ftlr');
    if (onWash && cols.length > 2 && wins.length > 2) {     // the fire escape: at each floor from the second up a landing (a frame with open slats, two rails on balusters), open stairs zig-zagging between (two stringers, treads, a handrail), a drop ladder
      const ci = Math.min(cols.length - 2, Math.floor(cols.length * 0.6)), c = (cols[ci][0] + cols[ci][1]) / 2, a = c - 2.1, b = c + 2.1, D = 1.05, I = C.iron, bar = (s0, s1, z0, z1, o0, o1, f) => box(K, F, s0, s1, z0, z1, o0, o1, I, f);
      const two = (pts, h) => { fq(K, F, pts, h, I); fq(K, F, pts, [-h[0], -h[1], -h[2]], I); };
      for (let k = 1; k < wins.length; k++) { const z = wins[k][0] - 0.3;
        bar(a, b, z - 0.07, z, D - 0.05, D, 'ftbk'); bar(a, b, z - 0.07, z, 0.02, 0.07, 'fb'); for (const s of [a, b - 0.05]) bar(s, s + 0.05, z - 0.07, z, 0.07, D - 0.05, 'lrb');
        for (let s = a + 0.4; s < b - 0.2; s += 0.4) bar(s, s + 0.06, z - 0.03, z, 0.07, D - 0.05, 'tb');
        for (const zr of [z + 0.5, z + 0.95]) { bar(a, b, zr - 0.02, zr + 0.02, D - 0.04, D, 'ftbk'); for (const s of [a, b - 0.04]) bar(s, s + 0.04, zr - 0.02, zr + 0.02, 0, D, 'lrtb'); }
        for (let s = a; s <= b + 1e-3; s += 0.42) { const q = Math.min(s, b - 0.03); bar(q, q + 0.03, z, z + 0.95, D - 0.035, D - 0.005, 'flr'); }
        for (const s of [a + 0.3, b - 0.3]) two([[s, z - 0.07, D - 0.1], [s, z - 0.9, 0.03], [s, z - 0.8, 0.03], [s, z - 0.02, D - 0.1]], [1, 0, 0]);     // wall struts under the landing
        if (k > 1) { const zl = wins[k - 1][0] - 0.3, dz = z - zl, sg = k % 2 ? 1 : -1, sA = c + 1.35 * sg, sB = c - 1.35 * sg, nT = Math.max(4, Math.round(dz / 0.3));
          for (const o of [0.3, 0.9]) two([[sB, zl - 0.14, o], [sB, zl + 0.04, o], [sA, z + 0.04, o], [sA, z - 0.14, o]], [0, 0, 1]);
          two([[sB, zl + 0.84, 0.9], [sB, zl + 0.89, 0.9], [sA, z + 0.89, 0.9], [sA, z + 0.84, 0.9]], [0, 0, 1]);
          for (let t = 1; t < nT; t++) { const s = sB + (sA - sB) * t / nT, zt = zl + dz * t / nT; two([[s - 0.1, zt, 0.3], [s + 0.1, zt, 0.3], [s + 0.1, zt, 0.9], [s - 0.1, zt, 0.9]], [0, 1, 0]); } } }
      const z1 = wins[1][0] - 0.3; for (const s of [c - 1.45, c - 1.05]) bar(s, s + 0.04, 2.7, z1, D - 0.3, D - 0.26, 'flrk'); for (let z = 2.9; z < z1; z += 0.32) bar(c - 1.45, c - 1.01, z, z + 0.03, D - 0.3, D - 0.27, 'ftb');
    }
  }
}

function glassCanvas() {     // what the glass mirrors is tinted by this: upper half four variants of the lofts' 6 by 4 panes, lower half eight of the warehouses' two-over-two sashes. No bars are painted: they are geometry.
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const g = cv.getContext('2d'); let sd = 7; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const pane = (x, y, w, h) => { const t = rnd(); let a = 118 + rnd() * 66; if (t < 0.08) a = 34; else if (t > 0.93) a = 232;     /* a pane open or unlit behind; a pane catching the light */
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, `rgb(${a + 8},${a + 14},${a + 18})`); gr.addColorStop(1, `rgb(${a - 14},${a - 10},${a - 8})`); g.fillStyle = gr; g.fillRect(x, y, w + 1, h + 1); };
  for (let v = 0; v < 4; v++) for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) pane(v * 256 + i * 256 / 6, j * 64, 256 / 6, 64);
  for (let v = 0; v < 8; v++) { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) pane(v * 128 + i * 64, 256 + j * 128, 64, 128); if (v % 3 === 1) { g.fillStyle = 'rgb(236,230,214)'; g.fillRect(v * 128, 256, 128, 50 + rnd() * 70); } }     // some with a blind part down
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function nameCanvas() {     // the name cast into the frieze (upper half: letters sunk, dark on the lit-from-above upper edge, light on the lower), plain white below for every other face of the concrete mesh
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#ece6da'; g.fillRect(0, 0, 1024, 128); g.font = 'bold 76px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; try { g.letterSpacing = '9px'; } catch (e) {}
  const y = 66, N = 'ROBERT GAIT COMPANY'; g.fillStyle = '#ffffff'; g.fillText(N, 515, y + 3, 990); g.fillStyle = '#3d362c'; g.fillText(N, 509, y - 3, 990); g.fillStyle = '#857a69'; g.fillText(N, 512, y, 990);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function install(game) {
  const W = game.world, city = game.city; if (!W || !W.scene || !city || !city.buildings) return null;
  const lots = []; for (const b of city.buildings) { const lot = LOTS[b.id]; if (lot && b.poly && b.poly.length > 2) lots.push({ ...lot, id: b.id, h: lot.h || b.h, poly: b.poly.map((p) => [p[0], p[1]]) }); }
  if (!lots.length) return null;
  const stats = (window.__lofts = { ids: lots.map((l) => l.id), tris: {}, cut: 0, pruned: 0 });
  // frames: polygons turned counter-clockwise (x east, y north), so (dy, -dx) looks out; an edge is exposed unless another building stands against it
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const l of lots) for (const p of l.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const near = city.buildings.filter((b) => !LOTS[b.id] && b.poly && b.poly.some((p) => p[0] > x0 - 6 && p[0] < x1 + 6 && p[1] > y0 - 6 && p[1] < y1 + 6)).map((b) => b.poly).concat(lots.map((l) => l.poly));
  for (const l of lots) { let A = 0; const P = l.poly; for (let i = 0, j = P.length - 1; i < P.length; j = i++) A += P[j][0] * P[i][1] - P[i][0] * P[j][1]; if (A < 0) P.reverse();
    l.frames = []; let u0 = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, F = { ax: a[0], ay: a[1], dx, dy, nx: dy, ny: -dx, L, u0, a, b }; u0 += L;
      let hits = 0; for (const t of [0.25, 0.5, 0.75]) { const x = a[0] + dx * L * t + F.nx * 1.3, y = a[1] + dy * L * t + F.ny * 1.3; if (near.some((Q) => Q !== P && inPoly(x, y, Q))) hits++; }
      F.exposed = hits < 2; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; F.onWash = F.exposed && L > 12 && Math.abs(dy) > 0.9 && washDist(mx, my) < 16; l.frames.push(F); } }
  const hitLot = (x, y) => lots.some((l) => inPoly(x, y, l.poly));
  const nearFront = (x, y, R) => lots.some((l) => l.frames.some((F) => { if (!F.exposed) return false; const [d, t] = segDist(x, y, F.a, F.b); return d < R && t > 0 && t < 1; }));

  // 1. the generated massing off those lots, in every tile geometry as it appears.
  // MEASURED Nov 16 (runs/lofts1 and the tile files bld_4_4 / bld_4_5 of assets/tiles-bk/dumbo): on this block the baked massing stands about 3.8 m WEST of
  // city-dumbo.json's footprints (walls facing Washington St at x -254 and -234 where the footprints say -250 and -230.5; north-south it agrees), and the
  // street-floor layer's fronts stand on the baked walls. The buildings here are drawn on the footprints (where the roadway, kerbs and solid walls are), so
  // the cut and the prune look for the old ones DX metres west. If the tiles are ever re-baked in line with the city file: ?loftsdx=0.
  const qdx = new URLSearchParams(location.search).get('loftsdx'), DX = qdx !== null && isFinite(+qdx) ? +qdx : 3.8;
  const bx0 = x0 - 5, bx1 = x1 + 5, by0 = y0 - 5, by1 = y1 + 5;
  const cutMesh = (mesh) => { const geo = mesh.geometry, ix = geo && geo.index, pos = geo && geo.attributes.position; if (!ix || !pos || geo.userData.loftsCut) return; geo.userData.loftsCut = true;
    if (!geo.boundingSphere) geo.computeBoundingSphere(); mesh.updateMatrixWorld(true); const M = mesh.matrixWorld, bs = geo.boundingSphere, c = bs.center.clone().applyMatrix4(M); if (c.x < bx0 - DX - bs.radius || c.x > bx1 + bs.radius || -c.z < by0 - bs.radius || -c.z > by1 + bs.radius) return;
    const k3 = geo.attributes.uv3, a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3(), src = ix.array, out = new src.constructor(src.length); let k = 0;
    for (let i = 0; i < src.length; i += 3) { a.fromBufferAttribute(pos, src[i]).applyMatrix4(M); b.fromBufferAttribute(pos, src[i + 1]).applyMatrix4(M); d.fromBufferAttribute(pos, src[i + 2]).applyMatrix4(M);
      const cx = (a.x + b.x + d.x) / 3, cy = -(a.z + b.z + d.z) / 3; let hit = false;
      if (cx > bx0 - DX && cx < bx1 && cy > by0 && cy < by1) { n.subVectors(b, a).cross(e.subVectors(d, a)); n.y = 0; const l = n.length(); if (l > 1e-9) n.multiplyScalar(0.5 / l); else n.set(0, 0, 0);
        const sx = cx + DX; hit = hitLot(sx - n.x, cy + n.z) || hitLot(sx - 3 * n.x, cy + 3 * n.z) || (k3 && k3.getX(src[i]) >= 320 && nearFront(sx, cy, 3.2)); }
      if (hit) stats.cut++; else { out[k++] = src[i]; out[k++] = src[i + 1]; out[k++] = src[i + 2]; } }
    if (k !== src.length) geo.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1)); };
  let sig = null; const cutAll = () => { const bm = W.buildingMeshes || [], s = (W.tiles ? W.tiles.rev : 0) + ':' + bm.length; if (s === sig) return; sig = s; for (const m of bm) { try { cutMesh(m); } catch (e) {} } };
  stats.dx = DX; cutAll(); const tick = () => { cutAll(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  // 2. the street-floor layer's instances off those fronts (shop fronts, signs, awnings, wall dressing)
  const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  setInterval(() => { for (const name of ['storefronts', 'dressing']) { const g = W.scene.getObjectByName(name); if (!g) continue;
    g.traverse((o) => { if (!o.isInstancedMesh || o.userData.loftsPruned === o.count) return; o.userData.loftsPruned = o.count; let k = 0;
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); p3.setFromMatrixPosition(m4); const x = p3.x, y = -p3.z; if (x > bx0 - DX && x < bx1 && y > by0 && y < by1 && (hitLot(x, y) || nearFront(x, y, 2.6) || hitLot(x + DX, y) || nearFront(x + DX, y, 2.6)))     /* seen in runs/lofts1 and lofts2: the west side's fronts stand on the footprints, the east side's on the baked walls */ { o.setMatrixAt(i, zero); k++; } }
      if (k) { o.instanceMatrix.needsUpdate = true; stats.pruned += k; } }); } }, 1000);

  // 3. the buildings
  const B = { conc: new Buf(), brick: new Buf([0.9, 0.9]), glass: new Buf() };
  for (const l of lots) { const H = l.h;
    for (const F of l.frames) wall(B, F, H, l, F.exposed, F.onWash);
    const tri = THREE.ShapeUtils.triangulateShape(l.poly.map((p) => new THREE.Vector2(p[0], p[1])), []); for (const t of tri) B.conc.poly(t.map((i) => [l.poly[i][0], H - 0.02, -l.poly[i][1]]), [0, 1, 0], C.roof);
    const F = l.frames.reduce((a, b) => (b.L > a.L ? b : a)); if (F.L > 16) box(B.conc, F, F.L / 2 - 3.5, F.L / 2 + 3.5, H - 0.02, H + 3.3, -9, -4, l.kind === 'loft' ? C.bulk : C.dock, 'flrtk'); }     // a stair bulkhead
  const grp = new THREE.Group(); grp.name = 'dumbolofts'; grp.userData.streetCube = true;
  // helper lofts 2, Nov 16. Brick: the game's own photographed brick (assets/tex/red_brick_03, CC0 Poly Haven, 0.9 m a tile), fetched here, so only on a map with these lots; the vertex colour
  // lifts its dull brown to the photo's dusty red. Glass: mostly mirror (metalness 0.9) of the street cube, as hero.js gives its glass; the canvas only tints pane by pane.
  // Fill: brick and concrete get a little light of their own colour (uLoftFill, scaled with the sun) so shaded fronts are not black.
  const fill = { value: 0.3 }, lift = (m) => { m.onBeforeCompile = (sh) => { sh.uniforms.uLoftFill = fill; sh.fragmentShader = 'uniform float uLoftFill;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uLoftFill;'); }; return m; };
  const mats = [lift(new THREE.MeshStandardMaterial({ vertexColors: true, map: nameCanvas(), roughness: 0.9, metalness: 0 })), lift(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })), new THREE.MeshStandardMaterial({ vertexColors: true, map: glassCanvas(), roughness: 0.07, metalness: 0.9, envMap: W.streetRT ? W.streetRT.texture : null, envMapIntensity: 1.0 })];
  const TL = new THREE.TextureLoader(), tex = (f, srgb) => { const t = TL.load('assets/tex/' + f, undefined, undefined, () => { if (srgb) { mats[1].map = null; mats[1].color.setRGB(0.17, 0.13, 0.12); } else mats[1].normalMap = null; mats[1].needsUpdate = true; }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  mats[1].map = tex('red_brick_03_diff.jpg', true); mats[1].normalMap = tex('red_brick_03_nor.jpg', false); mats[1].normalScale = new THREE.Vector2(0.7, 0.7);
  grp.add(B.conc.mesh(mats[0], 'lofts_concrete'), B.brick.mesh(mats[1], 'lofts_brick'), B.glass.mesh(mats[2], 'lofts_glass'));     // the glass casts shadow too: without it the sun went in at one wall's windows and out at the other's, the "orange sun patches" of round 11
  W.scene.add(grp);
  setInterval(() => { fill.value = W.sun ? 0.3 * Math.min(1, W.sun.intensity / 8) : 0.3; if (W.streetRT && !W.heroGlass) W.streetRT.texture.needsPMREMUpdate = true; }, 500);     // the mirror is three's PMREM copy of the street cube: refreshed here unless hero.js already does
  stats.tris = { concrete: B.conc.tris, brick: B.brick.tris, glass: B.glass.tris, total: B.conc.tris + B.brick.tris + B.glass.tris };
  console.log('[lofts] DUMBO lofts in: lots ' + stats.ids.join(' ') + ', triangles ' + JSON.stringify(stats.tris) + ', 3 draw calls');
  return grp;
}
