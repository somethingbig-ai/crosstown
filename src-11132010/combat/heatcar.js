/* combat/heatcar.js: what makes the kit's plain dark sedan / SUV a patrol car. Loaded by heat.js (end of buildShared); heat.js calls
   dress / undress / draw per patrol car and frame(dt) once per drawn frame.
   - Livery painted ON the real body: the body's own paint triangles are taken again from the street layer's geometry (so the white
     doors, the roof panel and the stripe follow every curve), drawn with a copy of the body's own paint material and one shared
     picture per kind of car (made here on a canvas: nothing from any real department or game).
   - Front doors: the body's own door triangles (skin, window frame, glass) on a hinge, with an inner trim panel; a dark doorway is
     drawn over the body where the door was.
   - Light bar: a housing on feet with separate lens modules (red left, blue right, clear in the middle of the front, amber in the
     middle of the rear), grille and rear-deck flashers; each module is lit on its own by one number per lamp group.
   - Light on the world, with no THREE light at all: a multiply-add pass that reads the ambient-occlusion pass's depth and normals
     (every surface within a few metres gets more red / blue of its own colour), a flat ground version of it when that pass is off,
     a mirror highlight on the car's own lacquer, and a small glare point per lamp.
   - Siren: WebAudio synthesis, a wail while it drives in, a short yelp when it stops.
   Car frame: x forward, y up, z to the car's right (three.js); sim space is (x east, y north), three.js is (x, z, -y). */
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';

const AW = 2048, AH = 1024, SC = AW / 4.9, NL = 14, LOD_NEAR = 22, DIRT = 0.55 /* was 0.3: the clean lacquer mirrored the street in every facet ('mirror-chrome reflections', 'faceted', rounds 23, 25); road film on it as on the reference's cars */, SEED = 0.37, DOOR_OPEN = 1.15;
export const TYPES = {
  sedan: { belt: [[-2.4, 1.03], [-1.7, 1.035], [1.0, 0.95], [2.4, 0.85]], sill: 0.262, door: [-0.265, 0.94], rear: [[-1.22, 1.02], [-1.2, 0.84], [-1.06, 0.69], [-0.965, 0.5], [-0.95, 0.25]],
    band: [0.50, 0.60], Y0: 0.15, doorY0: 0.15, doorH: 1.35, roof: [-0.74, 0.20, 0.60], barX: -0.12, barW: 1.12, rearTxt: [0.765, 0.835], grille: [0.645, 0.25], deck: [-1.55, 1.105, 0.28],
    spot: [0.66, 1.17, 0.85], ant: -1.95, push: [0.36, 0.80], head: [-0.12, 1.16], numRoof: [-0.52, 0.30], numDoor: [-0.68, 0.76, 0.16] },
  suv: { belt: [[-2.45, 1.17], [1.0, 1.125], [2.45, 1.0]], sill: 0.365, door: [-0.265, 0.92], rear: [[-1.33, 1.15], [-1.31, 0.98], [-1.12, 0.84], [-0.96, 0.6], [-0.95, 0.35]],
    band: [0.66, 0.77], Y0: 0.28, doorY0: 0.30, doorH: 1.5, roof: [-1.85, 0.12, 0.68], barX: -0.15, barW: 1.2, rearTxt: [0.66, 0.73], grille: [0.77, 0.30], deck: null,
    spot: [0.62, 1.37, 0.91], ant: -1.9, push: [0.46, 0.94], head: [-0.12, 1.42], numRoof: [-0.95, 0.40], numDoor: [-0.72, 0.93, 0.17] },
};
const WHITE = '#e9ebee', NAVY = '#14254a', GOLD = '#d8a21c', BODY = '#0b0b0d';
const _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const sm = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const beltAt = (T, x) => { const b = T.belt; for (let i = 0; i + 1 < b.length; i++) if (x <= b[i + 1][0] || i + 2 === b.length) { const k = (x - b[i][0]) / (b[i + 1][0] - b[i][0]); return b[i][1] + (b[i + 1][1] - b[i][1]) * Math.min(1, Math.max(0, k)); } return b[0][1]; };

/* ------------------------------------------------------------------ triangles of the body, cut to the parts we repaint */
export function soupOf(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, ix = geo.index, cnt = ix ? ix.count : p.count, S = [];
  for (let i = 0; i + 2 < cnt; i += 3) { const t = { p: [], n: [] }; for (let k = 0; k < 3; k++) { const a = ix ? ix.getX(i + k) : i + k; t.p.push(p.getX(a), p.getY(a), p.getZ(a)); if (n) t.n.push(n.getX(a), n.getY(a), n.getZ(a)); else t.n.push(0, 1, 0); } S.push(t); }
  return S;
}
const cen = (t) => [(t.p[0] + t.p[3] + t.p[6]) / 3, (t.p[1] + t.p[4] + t.p[7]) / 3, (t.p[2] + t.p[5] + t.p[8]) / 3];
const fN = (t) => { const p = t.p, ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2], x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
/* keep the part of every triangle where sg * (coord[ax] - c) >= 0 */
export function clip(S, ax, c, sg) {
  const out = [];
  for (const t of S) {
    const d = [sg * (t.p[ax] - c), sg * (t.p[3 + ax] - c), sg * (t.p[6 + ax] - c)];
    if (d[0] >= 0 && d[1] >= 0 && d[2] >= 0) { out.push(t); continue; }
    if (d[0] < 0 && d[1] < 0 && d[2] < 0) continue;
    const P = [], N = [];
    for (let i = 0; i < 3; i++) { const j = (i + 1) % 3;
      if (d[i] >= 0) { P.push(t.p.slice(i * 3, i * 3 + 3)); N.push(t.n.slice(i * 3, i * 3 + 3)); }
      if ((d[i] >= 0) !== (d[j] >= 0)) { const k = d[i] / (d[i] - d[j]), q = [], m = []; for (let a = 0; a < 3; a++) { q.push(t.p[i * 3 + a] + (t.p[j * 3 + a] - t.p[i * 3 + a]) * k); m.push(t.n[i * 3 + a] + (t.n[j * 3 + a] - t.n[i * 3 + a]) * k); } q[ax] = c; P.push(q); N.push(m); } }
    for (let i = 1; i + 1 < P.length; i++) out.push({ p: [...P[0], ...P[i], ...P[i + 1]], n: [...N[0], ...N[i], ...N[i + 1]] });
  }
  return out;
}
const newB = () => ({ p: [], n: [], u: [], c: [], g: [], l: [] });
/* triangles into a builder: uv from a function of the position; off moves them along their normals; flip turns them over */
function put(B, S, uv, off = 0, flip = false) {
  for (const t of S) for (let k0 = 0; k0 < 3; k0++) { const k = flip ? 2 - k0 : k0, x = t.p[k * 3], y = t.p[k * 3 + 1], z = t.p[k * 3 + 2], nx = t.n[k * 3], ny = t.n[k * 3 + 1], nz = t.n[k * 3 + 2], l = Math.hypot(nx, ny, nz) || 1, s = flip ? -1 : 1;
    B.p.push(x + nx / l * off, y + ny / l * off, z + nz / l * off); B.n.push(s * nx / l, s * ny / l, s * nz / l); const q = uv(x, y, z); B.u.push(q[0], q[1]); }
}
function quad(B, bl, br, tr, tl, r) {
  const ux = br[0] - bl[0], uy = br[1] - bl[1], uz = br[2] - bl[2], vx = tl[0] - bl[0], vy = tl[1] - bl[1], vz = tl[2] - bl[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const V = [[bl, r[0], r[1]], [br, r[2], r[1]], [tr, r[2], r[3]], [bl, r[0], r[1]], [tr, r[2], r[3]], [tl, r[0], r[3]]];
  for (const q of V) { B.p.push(q[0][0], q[0][1], q[0][2]); B.n.push(nx, ny, nz); B.u.push(q[1], q[2]); }
}
function geoOf(B, extra) {
  const g = new THREE.BufferGeometry(), n = B.p.length / 3; g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
  if (B.u.length === n * 2) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
  if (B.c.length === n * 3) g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
  if (B.g.length === n * 3) g.setAttribute('aGlow', new THREE.Float32BufferAttribute(B.g, 3));
  if (B.l.length === n) g.setAttribute('aLamp', new THREE.Float32BufferAttribute(B.l, 1));
  if (extra === 'var') { const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) { a[i * 4] = DIRT; a[i * 4 + 1] = SEED; } g.setAttribute('aVar', new THREE.BufferAttribute(a, 4)); const m = new Float32Array(n * 4); for (let i = 0; i < n; i++) { m[i * 4] = 0.3; m[i * 4 + 1] = 0.2; } g.setAttribute('aMat', new THREE.BufferAttribute(m, 4)); }
  return g;
}
/* where the picture's parts are (pixels of the canvas -> uv) */
const UV = (px, py) => [px / AW, 1 - py / AH];
const stripUV = (T) => (x, y) => UV((x + 2.45) * SC, 390 - (y - T.Y0) * SC);
const doorPx = (T, k, x, y) => { const SD = 450 / T.doorH; return [k * 440 + 4 + (x - (T.door[0] - 0.02)) * SD, 850 - (y - T.doorY0) * SD]; };
const doorUV = (T, k) => (x, y) => { const q = doorPx(T, k, x, y); return UV(q[0], q[1]); };
const flatUV = (px, py) => { const q = UV(px, py); return () => q; };
const digitRect = (d) => { const a = UV(d * 100 + 4, 1018), b = UV(d * 100 + 96, 862); return [a[0], a[1], b[0], b[1]]; };

/* The body cut into our parts. paint / glass: the street layer's geometries of one detail level; hw: half the body's width.
   Returns builders: skin (stripe, rear doors, roof panel; alpha-tested), door[2] (outer skin + inner trim + edges), glass[2], gap
   (the doorway painted over the body), side 0 is the car's right (z > 0), side 1 its left. */
export function cutBody(T, paint, glass, hw) {
  const S = soupOf(paint), G = glass ? soupOf(glass) : [], out = { skin: newB(), door: [newB(), newB()], trim: [newB(), newB()], glass: [newB(), newB()], gap: newB() }, xd0 = T.door[0], xd1 = T.door[1], sUV = stripUV(T);
  for (let si = 0; si < 2; si++) { const zs = si ? -1 : 1;
    const side = S.filter((t) => { const c = cen(t), n = fN(t); return c[2] * zs > 0.45 && n[1] < 0.8 && n[2] * zs > -0.2 && Math.max(t.p[2] * zs, t.p[5] * zs, t.p[8] * zs) < hw + 0.05; });
    /* the stripe and the rear door: everything of the side below the glass, outside the front door */
    const low = clip(clip(side.filter((t) => fN(t)[2] * zs > 0.3), 1, T.Y0 + 0.004, 1), 1, T.Y0 + 0.928, -1);
    put(out.skin, clip(low, 0, xd0, -1), sUV); put(out.skin, clip(low, 0, xd1, 1), sUV);
    /* the front door: skin and window frame from the sill to the roof rail */
    const door = clip(clip(clip(side, 0, xd0, 1), 0, xd1, -1), 1, T.sill, 1), dUV = doorUV(T, si), B = out.door[si];
    put(B, door, dUV);
    /* inner trim: the part below the glass again, set in by 6 cm and turned over, and a rim between the two */
    const yb = Math.min(beltAt(T, xd0), beltAt(T, xd1)) - 0.025, card = clip(door.filter((t) => fN(t)[2] * zs > 0.3), 1, yb, -1), tUV = doorUV(T, 2), IN = 0.06;
    const B2 = out.trim[si]; put(B2, card, tUV, -IN, true);
    { const key = (x, y, z) => Math.round(x * 2000) + ',' + Math.round(y * 2000) + ',' + Math.round(z * 2000), E = new Map();
      for (const t of card) for (let i = 0; i < 3; i++) { const j = (i + 1) % 3, a = key(t.p[i * 3], t.p[i * 3 + 1], t.p[i * 3 + 2]), b = key(t.p[j * 3], t.p[j * 3 + 1], t.p[j * 3 + 2]); if (a === b) continue; const k = a < b ? a + '|' + b : b + '|' + a, e = E.get(k); if (e) e.n++; else E.set(k, { n: 1, t, i, j }); }
      const dark = doorPx(T, 2, xd0 + 0.05, T.sill + 0.03), r = UV(dark[0], dark[1]), R = [r[0], r[1], r[0], r[1]];
      for (const e of E.values()) { if (e.n !== 1) continue; const t = e.t, P = (i) => [t.p[i * 3], t.p[i * 3 + 1], t.p[i * 3 + 2]], Q = (i) => { const l = Math.hypot(t.n[i * 3], t.n[i * 3 + 1], t.n[i * 3 + 2]) || 1; return [t.p[i * 3] - t.n[i * 3] / l * IN, t.p[i * 3 + 1] - t.n[i * 3 + 1] / l * IN, t.p[i * 3 + 2] - t.n[i * 3 + 2] / l * IN]; };
        quad(B2, P(e.j), P(e.i), Q(e.i), Q(e.j), R); } }
    const gl = clip(clip(G.filter((t) => { const c = cen(t), n = fN(t); return c[2] * zs > 0.45 && Math.abs(n[2]) > 0.5; }), 0, xd0, 1), 0, xd1, -1);
    put(out.glass[si], gl, () => [0, 0]);
    const aUV = doorUV(T, 3); put(out.gap, door, aUV); put(out.gap, gl, aUV);
  }
  /* the roof panel: plain white */
  const r = T.roof, top = clip(clip(clip(clip(S.filter((t) => fN(t)[1] > 0.6), 0, r[0], 1), 0, r[1], -1), 2, -r[2], 1), 2, r[2], -1);
  put(out.skin, top, flatUV(2032, 1004));
  return out;
}
/* highest / foremost / widest point of the body at a place (through its triangles) */
function prober(geos) {
  const T = []; for (const g of geos) for (const t of soupOf(g)) T.push(t.p);
  return (ax, sg, a, b, tol, lim) => { const i1 = (ax + 1) % 3, i2 = (ax + 2) % 3; let best = -1e9;
    for (const p of T) { const x0 = p[i1] - a, y0 = p[i2] - b, x1 = p[3 + i1] - a, y1 = p[3 + i2] - b, x2 = p[6 + i1] - a, y2 = p[6 + i2] - b, d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (Math.abs(d) < 1e-12) continue;
      const w0 = (x1 * y2 - x2 * y1) / d, w1 = (x2 * y0 - x0 * y2) / d, w2 = 1 - w0 - w1; if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const q = (w0 * p[ax] + w1 * p[3 + ax] + w2 * p[6 + ax]) * sg; if (lim !== undefined && q > lim) continue; if (q > best) best = q; }
    return best > -1e8 ? best * sg : null; };
}

/* ------------------------------------------------------------------ parts we model: bar, lamps, push bar, spot lamp, aerials, crew */
function addGeo(B, geo, col, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo; _e.set(rx, ry, rz); _m.makeRotationFromEuler(_e).setPosition(x, y, z); g.applyMatrix4(_m);
  const p = g.attributes.position, n = g.attributes.normal; for (let i = 0; i < p.count; i++) { B.p.push(p.getX(i), p.getY(i), p.getZ(i)); B.n.push(n.getX(i), n.getY(i), n.getZ(i)); B.c.push(col[0], col[1], col[2]); }
  g.dispose(); if (g !== geo) geo.dispose();
}
const mbox = (B, col, x, y, z, sx, sy, sz, rz = 0) => addGeo(B, new THREE.BoxGeometry(sx, sy, sz), col, x, y, z, 0, 0, rz);
/* a lens: a box with a grid of LED dots on the faces named in led ({ px: [n along y, n along z], pz: [n along x, n along y], ... }) */
function lens(B, x, y, z, sx, sy, sz, col, glow, lamp, led = {}) {
  const h = [sx / 2, sy / 2, sz / 2], c = [x, y, z], names = ['x', 'y', 'z'];
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) { const b = (a + 1) % 3, d = (a + 2) % 3, L = led[(s > 0 ? 'p' : 'n') + names[a]], C = [[-1, -1], [1, -1], [1, 1], [-1, 1]], o = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of o) { const q = [0, 0, 0]; q[a] = c[a] + s * h[a]; q[b] = c[b] + C[k][0] * h[b]; q[d] = c[d] + C[k][1] * h[d]; B.p.push(q[0], q[1], q[2]); const n = [0, 0, 0]; n[a] = s; B.n.push(n[0], n[1], n[2]);
      if (L) B.u.push(1 + (C[k][0] * 0.5 + 0.5) * L[0], 1 + (C[k][1] * 0.5 + 0.5) * L[1]); else B.u.push(0, 0);
      B.c.push(col[0], col[1], col[2]); B.g.push(glow[0], glow[1], glow[2]); B.l.push(lamp); } }
}
const RED = { col: [0.22, 0.01, 0.012], glow: [5, 0.04, 0.02], halo: [1.6, 0.05, 0.03] }, BLUE = { col: [0.012, 0.03, 0.26], glow: [0.02, 0.12, 6], halo: [0.06, 0.25, 2.0] },
  CLEAR = { col: [0.42, 0.43, 0.45], glow: [5, 5, 5.4], halo: [1.1, 1.1, 1.2] }, AMBER = { col: [0.36, 0.15, 0.02], glow: [5, 1.5, 0.04], halo: [1.5, 0.55, 0.02] };
const DARK = [0.022, 0.022, 0.025], SATIN = [0.035, 0.035, 0.04];
function buildKit(T, probe, hw) {
  const H = newB(), L = newB(), halo = [], crew = newB(), roofY = (x, z) => probe(1, 1, z, x, 0.07) ?? 1.4, frontX = (y, z) => probe(0, 1, y, z, 0.06) ?? 2.4;
  const x0 = T.barX, W = T.barW, yr = Math.max(roofY(x0, 0.12), roofY(x0, 0.3)), LH = 0.046, yb = yr + 0.032, yl = yb + 0.01 + LH / 2, yc = yb + 0.01 + LH + 0.006; /* a low bar, 9 cm from roof to cap and 25 cm deep: at 14 cm by 33 it read as 'a block', 'a grid of blue cubes' (rounds 21, 25, 26) */
  /* housing: feet on the roof edges, a base, a core that shows between the modules, a cap */
  for (const s of [1, -1]) { const zf = s * (W / 2 - 0.06), y0 = roofY(x0, Math.abs(zf)) - 0.012; mbox(H, DARK, x0, (y0 + yb) / 2, zf, 0.2, yb - y0, 0.07); mbox(H, DARK, x0, y0 + 0.012, s * (W / 2 + 0.01), 0.16, 0.03, 0.09); }
  mbox(H, DARK, x0, yb, 0, 0.26, 0.02, W); mbox(H, DARK, x0, yl, 0, 0.19, LH - 0.004, W - 0.04); mbox(H, DARK, x0, yl, 0, 0.24, LH, 0.12); mbox(H, DARK, x0, yc, 0, 0.255, 0.012, W + 0.012);
  const hp = (x, y, z, dx, dz, lamp, K, size) => halo.push({ p: [x + dx * 0.03, y, z + dz * 0.03], d: [dx, 0, dz], lamp, col: K.halo, size: size || 1 });
  for (const s of [1, -1]) {      /* s = -1: the car's left: red */
    const K = s < 0 ? RED : BLUE, mods = [[0.115, 0.40], [0.42, 0.705], [0.725, 0.99]];
    for (let i = 0; i < 3; i++) { const z0 = mods[i][0] * W / 2, z1 = mods[i][1] * W / 2, zc = s * (z0 + z1) / 2, w = z1 - z0, cols = Math.max(3, Math.round(w / 0.027));
      for (const f of [1, -1]) { const KK = i === 0 ? (f > 0 ? CLEAR : AMBER) : K, lamp = i === 0 ? (f > 0 ? (s < 0 ? 4 : 5) : (s < 0 ? 6 : 7)) : i === 1 ? (s < 0 ? 1 : 2) : (s < 0 ? 0 : 3), led = {}; led[f > 0 ? 'px' : 'nx'] = [2, cols]; if (i === 2) led[s > 0 ? 'pz' : 'nz'] = [5, 2];
        lens(L, x0 + f * 0.0635, yl, zc, 0.117, LH, w, KK.col, KK.glow, lamp, led); hp(x0 + f * 0.125, yl, zc, f, 0, lamp, KK, 1.5); }
      if (i === 2) hp(x0, yl, s * W / 2, 0, s, s < 0 ? 0 : 3, K, 1.5); }
    /* behind the grille */
    { const gy = T.grille[0], gz = s * T.grille[1], gx = frontX(gy, Math.abs(gz)) + 0.014, lamp = s < 0 ? 8 : 9; lens(L, gx, gy, gz, 0.022, 0.036, 0.12, K.col, K.glow, lamp, { px: [1, 5] }); hp(gx + 0.011, gy, gz, 1, 0, lamp, K, 0.8); }
    /* on the rear shelf, seen through the back window */
    if (T.deck) { const lamp = s < 0 ? 10 : 11; lens(L, T.deck[0], T.deck[1], s * T.deck[2], 0.03, 0.032, 0.24, K.col, K.glow, lamp, { nx: [1, 9] }); hp(T.deck[0] - 0.05, T.deck[1] + 0.05, s * T.deck[2], -1, 0, lamp, K, 0.8); }
  }
  /* push bar in front of the grille */
  { const fx = frontX((T.push[0] + T.push[1]) / 2, 0.3), y0 = T.push[0], y1 = T.push[1], px = fx + 0.10;
    for (const s of [1, -1]) { mbox(H, SATIN, px, (y0 + y1) / 2, s * 0.30, 0.05, y1 - y0, 0.07); mbox(H, SATIN, px - 0.08, y0 + 0.05, s * 0.30, 0.2, 0.04, 0.04); mbox(H, SATIN, px + 0.012, (y0 + y1) / 2 + 0.02, s * 0.30, 0.03, (y1 - y0) * 0.7, 0.05); }
    addGeo(H, new THREE.CylinderGeometry(0.024, 0.024, 0.76, 8), SATIN, px, y0 + (y1 - y0) * 0.3, 0, Math.PI / 2, 0, 0); addGeo(H, new THREE.CylinderGeometry(0.024, 0.024, 0.76, 8), SATIN, px, y0 + (y1 - y0) * 0.82, 0, Math.PI / 2, 0, 0); }
  /* spot lamp on the driver's screen pillar */
  { const s = T.spot, z = -s[2]; addGeo(H, new THREE.CylinderGeometry(0.062, 0.05, 0.1, 12), DARK, s[0], s[1], z - 0.06, 0, 0, -Math.PI / 2); addGeo(H, new THREE.CylinderGeometry(0.054, 0.054, 0.012, 12), [0.55, 0.56, 0.58], s[0] + 0.05, s[1], z - 0.06, 0, 0, -Math.PI / 2); mbox(H, DARK, s[0] - 0.01, s[1] - 0.03, z - 0.02, 0.025, 0.025, 0.1); }
  /* two aerials */
  for (const s of [1, -1]) { const y = roofY(T.ant, 0.35); addGeo(H, new THREE.CylinderGeometry(0.004, 0.006, 0.5, 5), DARK, T.ant - 0.03, y + 0.24, s * 0.35, 0, 0, 0.12); addGeo(H, new THREE.CylinderGeometry(0.02, 0.026, 0.03, 8), DARK, T.ant, y + 0.012, s * 0.35); }
  /* the crew seated, seen through the glass while it drives: head, cap, shoulders */
  for (const s of [1, -1]) { const hx = T.head[0], hy = T.head[1], z = s * 0.37, UNI = [0.012, 0.016, 0.036], SKIN = [0.3, 0.2, 0.15];
    addGeo(crew, new THREE.SphereGeometry(0.1, 10, 8), SKIN, hx, hy, z); addGeo(crew, new THREE.CylinderGeometry(0.108, 0.104, 0.05, 10), UNI, hx - 0.005, hy + 0.085, z); addGeo(crew, new THREE.CylinderGeometry(0.09, 0.105, 0.028, 10), UNI, hx - 0.005, hy + 0.118, z); mbox(crew, [0.01, 0.01, 0.012], hx + 0.105, hy + 0.062, z, 0.08, 0.012, 0.15);
    addGeo(crew, new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), SKIN, hx - 0.01, hy - 0.12, z); addGeo(crew, new THREE.CapsuleGeometry(0.105, 0.24, 3, 10), UNI, hx - 0.03, hy - 0.2, z, Math.PI / 2, 0, 0); mbox(crew, UNI, hx - 0.06, hy - 0.42, z, 0.2, 0.42, 0.34, 0.14); }
  const lp = { red: [x0, yl + 0.03, -W * 0.5 - 0.2], blue: [x0, yl + 0.03, W * 0.5 + 0.2], white: [x0 + 0.6, yl, 0] };
  return { H, L, halo, crew, lp, roofY, frontX };
}

/* ------------------------------------------------------------------ the picture (one per kind of car) */
function makeAtlas(T, heavy) {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const x = cv.getContext('2d'), F = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const X = (m) => (m + 2.45) * SC, Y = (m) => 390 - (m - T.Y0) * SC, b0 = T.band[0], b1 = T.band[1], xd0 = T.door[0], xd1 = T.door[1];
  const rect = (fx, fy, x0, y0, x1, y1, col) => { x.fillStyle = col; const a = fx(x0), b = fx(x1), c = fy(y1), d = fy(y0); x.fillRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c)); };
  /* the strip of the sides: a white stripe with a gold line under it on the dark body, the rear door white with the stripe in navy */
  rect(X, Y, -2.33, b0, 2.31, b1, WHITE); rect(X, Y, -2.33, b0 - 0.042, 2.31, b0 - 0.022, GOLD);
  x.save(); x.beginPath(); x.moveTo(X(xd0) + 4, Y(T.sill)); for (let i = T.rear.length - 1; i >= 0; i--) { const q = T.rear[i]; x.lineTo(X(q[0]), Y(Math.min(Math.max(q[1], T.sill), beltAt(T, q[0]) - 0.014))); } x.lineTo(X(xd0) + 4, Y(beltAt(T, xd0) - 0.014)); x.closePath(); x.clip();
  rect(X, Y, -2.4, 0, 2.4, 2, WHITE); rect(X, Y, -2.4, b0, 2.4, b1, NAVY); rect(X, Y, -2.4, b0 - 0.042, 2.4, b0 - 0.022, GOLD); x.restore();
  /* the two front doors (right, left), the inner trim, the doorway */
  const SD = 450 / T.doorH;
  for (let k = 0; k < 4; k++) { const DX = (m) => doorPx(T, k, m, 0)[0], DY = (m) => doorPx(T, k, 0, m)[1], top = (m) => beltAt(T, m) - 0.014, poly = (pts, col) => { x.fillStyle = col; x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(DX(q[0]), DY(q[1])) : x.moveTo(DX(q[0]), DY(q[1])))); x.closePath(); x.fill(); };
    x.fillStyle = k === 2 ? '#2a2c31' : k === 3 ? '#0c0d0f' : BODY; x.fillRect(k * 440, 396, 438, 458);
    if (k < 2) {
      poly([[xd0 - 0.02, T.sill], [xd1 + 0.02, T.sill], [xd1 + 0.02, top(xd1)], [xd0 - 0.02, top(xd0)]], WHITE); rect(DX, DY, xd0 - 0.02, b0, xd1 + 0.02, b1, NAVY); rect(DX, DY, xd0 - 0.02, b0 - 0.042, xd1 + 0.02, b0 - 0.022, GOLD);
      const cx = (xd0 + xd1) / 2 - 0.02, text = (s, y, hgt, w) => { x.save(); x.translate(DX(cx), DY(y)); if (k === 1) x.scale(-1, 1); x.font = '800 ' + Math.round(hgt * SD / 0.72) + 'px ' + F; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillStyle = NAVY; x.fillText(s, 0, 0, w * SD); x.restore(); };
      text('CITY PATROL', b1 + 0.075, 0.105, xd1 - xd0 - 0.2); text(heavy ? 'HEAVY RESPONSE' : 'UNIFORM DIVISION', b0 - 0.125, 0.042, xd1 - xd0 - 0.3);
    } else if (k === 2) {
      const s = T.sill, bt = Math.min(top(xd0), top(xd1)); x.fillStyle = '#3d4047'; x.beginPath(); x.roundRect(DX(xd0 + 0.1), DY(bt - 0.08), (xd1 - xd0 - 0.22) * SD, (bt - s - 0.2) * SD, 14); x.fill();
      rect(DX, DY, xd0 + 0.12, s + 0.36, xd1 - 0.2, s + 0.43, '#17181b'); rect(DX, DY, xd0 + 0.2, bt - 0.2, xd0 + 0.34, bt - 0.17, '#a3a6ac'); rect(DX, DY, xd0 + 0.14, s + 0.1, xd1 - 0.5, s + 0.12, '#0c0d0e');
      x.fillStyle = '#0d0e10'; x.beginPath(); x.arc(DX(xd1 - 0.28), DY(s + 0.2), 0.085 * SD, 0, 7); x.fill(); x.strokeStyle = '#2c2e33'; x.lineWidth = 2; x.stroke();
    } else {
      const s = T.sill, bt = Math.min(top(xd0), top(xd1));
      poly([[-0.2, s + 0.16], [0.36, s + 0.16], [0.38, s + 0.3], [-0.2, s + 0.31]], '#4a4d55'); poly([[-0.2, s + 0.28], [-0.04, s + 0.3], [-0.17, bt + 0.14], [-0.34, bt + 0.12]], '#42454c');
      x.fillStyle = '#42454c'; x.beginPath(); x.ellipse(DX(-0.27), DY(bt + 0.25), 0.07 * SD, 0.1 * SD, 0.2, 0, 7); x.fill();
      poly([[0.62, s + 0.42], [xd1 + 0.02, s + 0.38], [xd1 + 0.02, bt + 0.05], [0.66, bt + 0.05]], '#2a2c31'); x.strokeStyle = '#5a5d64'; x.lineWidth = 0.032 * SD; x.beginPath(); x.ellipse(DX(0.5), DY(bt + 0.02), 0.04 * SD, 0.18 * SD, 0.38, 0, 7); x.stroke();
      rect(DX, DY, xd0 - 0.02, s, xd1 + 0.02, s + 0.022, '#70737a'); rect(DX, DY, xd0 - 0.02, s + 0.022, xd0 + 0.05, T.doorY0 + T.doorH, '#0d0d10');
    } }
  /* digits (navy), the words for the tail (white), a white patch for the roof */
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = NAVY; x.font = '800 168px ' + F; for (let d = 0; d < 10; d++) x.fillText(String(d), d * 100 + 50, 946, 90);
  x.fillStyle = WHITE; x.font = '800 84px ' + F; x.fillText('CITY PATROL', 1520, 924, 960); x.fillRect(2018, 990, 28, 28);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/* ------------------------------------------------------------------ materials */
const BAKE_V = '\n varying vec3 vWPos; varying vec3 vWNrm;', BAKE_F = '\n varying vec3 vWPos; varying vec3 vWNrm; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;';
/* a plain lit material that takes the city's baked light the way the cars do (dark in a building's shade); lamp: lens modules */
function bake(m, shared, tag, lampU) {
  m.onBeforeCompile = (sh) => {
    for (const k of ['tLight', 'uHalf', 'uSunColor', 'uShadowFar', 'uShadowCenter']) sh.uniforms[k] = shared[k]; if (lampU) sh.uniforms.uLamp = lampU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + BAKE_V + (lampU ? '\n attribute vec3 aGlow; attribute float aLamp; uniform float uLamp[' + NL + ']; varying vec3 vGlow; varying float vLampI; varying vec2 vLed;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);' + (lampU ? '\n vGlow = aGlow; vLampI = uLamp[int(aLamp + 0.5)]; vLed = uv;' : ''));
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>' + BAKE_F + (lampU ? '\n varying vec3 vGlow; varying float vLampI; varying vec2 vLed;' : ''))
      .replace('#include <aomap_fragment>', '\n bakeN = normalize(vWNrm); bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeV.r *= 0.5 + 0.5 * bakeN.y;\n' + BAKE_LIGHT_GLSL);
    if (lampU) f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec2 lq = fract(vLed) - 0.5; float lw = max(fwidth(vLed.x), fwidth(vLed.y)), has = step(0.5, vLed.x + vLed.y);
        float core = has * mix(smoothstep(0.42, 0.10, length(lq)), 0.3, smoothstep(0.35, 0.9, lw));
        vec3 hot = vGlow * 4.0 + vec3(dot(vGlow, vec3(0.3333))) * 1.3;
        totalEmissiveRadiance += vLampI * mix(vGlow, hot, core);
        diffuseColor.rgb *= 1.0 + 1.2 * core; }`);
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'heatcar-' + tag; return m;
}
/* a copy of the body's own paint (its dirt, its lacquer, its shade) carrying our picture */
function paintCopy(src, map, alpha) {
  const m = src.clone(); m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey; m.map = map; m.color.set(0xffffff); m.transparent = false; m.depthWrite = true;
  if (alpha) { m.alphaTest = 0.5; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } else { m.side = THREE.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; }
  return m;
}
const LIGHT_F = `
  uniform vec3 uLw[3]; uniform vec3 uLc[3]; uniform float uR, uShade; uniform sampler2D tLight; uniform vec2 uHalf;
  #ifdef FLAT
    varying vec3 vP;
  #else
    uniform sampler2D tDepth; uniform sampler2D tNormal; uniform mat4 uPI; uniform mat4 uVW;
  #endif
  void main() {
    #ifdef FLAT
      vec3 P = vP, N = vec3(0.0, 1.0, 0.0);
    #else
      vec2 uv = gl_FragCoord.xy / vec2(textureSize(tDepth, 0)); float d = texture2D(tDepth, uv).x; if (d >= 0.99999) discard;
      vec4 c = uPI * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 P = (uVW * vec4(c.xyz / c.w, 1.0)).xyz;
      vec3 N = normalize(mat3(uVW) * (texture2D(tNormal, uv).xyz * 2.0 - 1.0));
    #endif
    vec3 s = vec3(0.0);
    for (int i = 0; i < 3; i++) { vec3 L = uLw[i] - P; float r2 = dot(L, L), a = max(0.0, 1.0 - r2 / (uR * uR)); a = a * a / (1.0 + r2 * 0.6); s += uLc[i] * a * (0.1 + 0.9 * max(dot(N, L * inversesqrt(r2 + 1e-4)), 0.0)); }
    float sun = texture2D(tLight, vec2(P.x / (2.0 * uHalf.x) + 0.5, -P.z / (2.0 * uHalf.y) + 0.5)).g;
    gl_FragColor = vec4(min(s * mix(uShade, 0.3, sun), vec3(1.2)), 1.0);   /* in full sun a light bar barely tints the road: it shows in shade */
  }`;
const LIGHT_V = `
  #ifdef FLAT
    varying vec3 vP;
  #endif
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0);
    #ifdef FLAT
      vP = wp.xyz;
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp; }`;
const SPEC_V = 'varying vec3 vP; varying vec3 vN; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }';
const SPEC_F = `uniform vec3 uLw[3]; uniform vec3 uLc[3]; uniform float uSpec; varying vec3 vP; varying vec3 vN;
  void main() { vec3 N = normalize(vN), V = normalize(cameraPosition - vP), s = vec3(0.0);
    for (int i = 0; i < 3; i++) { vec3 L = uLw[i] - vP; float r2 = dot(L, L); L *= inversesqrt(r2 + 1e-4); float nl = dot(N, L); if (nl <= 0.0) continue; vec3 H = normalize(L + V); s += uLc[i] * (pow(max(dot(N, H), 0.0), 90.0) * 2.0 + 0.22 * nl) / (1.0 + r2 * 3.0); /* and the colour itself on the roof and bonnet round the bar ('no cast light on the bodywork', round 21) */ }
    gl_FragColor = vec4(s * uSpec, 1.0); }`;
const HALO_V = `attribute vec3 aDir; attribute vec3 aCol; attribute float aLamp; attribute float aSize; uniform float uLamp[${NL}]; uniform float uPx; varying vec3 vC;
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vec3 wn = normalize(mat3(modelMatrix) * aDir), V = normalize(cameraPosition - wp.xyz);
    float I = uLamp[int(aLamp + 0.5)] * smoothstep(0.05, 0.55, dot(wn, V)); vC = aCol * I; vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
    gl_PointSize = I > 0.001 ? clamp(uPx * 0.5 * aSize / max(0.1, -mv.z), 6.0, 210.0) : 0.0; }`;
const HALO_F = `varying vec3 vC; void main() { vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0, core = pow(max(0.0, 1.0 - r), 3.0), st = max(0.0, 1.0 - abs(q.x) * 2.0); st = st * st * st * smoothstep(0.07, 0.0, abs(q.y));
    gl_FragColor = vec4(vC * (core * 0.9 + st * 0.45), 1.0); }`;

export class CarLook {
  constructor(heat) {
    this.heat = heat; this.g = heat.g; this.c = heat.c; const sc = this.g.world.scene;
    this.solid = new THREE.Group(); this.solid.name = 'heatcar'; sc.add(this.solid);
    this.fxg = new THREE.Group(); this.fxg.name = 'heatcar_light'; (this.c.fx && this.c.fx.group ? this.c.fx.group : sc).add(this.fxg);
    this.types = {}; this.list = new Set(); this.stamp = -1; this.depthOK = false; this.voices = 0;
    const sh = this.g.world.shared;
    this.U = { tDepth: { value: null }, tNormal: { value: null }, uPI: { value: new THREE.Matrix4() }, uVW: { value: new THREE.Matrix4() }, tLight: sh.tLight, uHalf: sh.uHalf, uR: { value: 4.2 }, uShade: { value: 2 }, uSpec: { value: 0.3 }, uPx: { value: 600 } };
    this.matte = bake(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 }), sh, 'matte');
    this.sphere = new THREE.SphereGeometry(4.6, 16, 10); this.plane = new THREE.PlaneGeometry(11, 11); this.plane.rotateX(-Math.PI / 2);
    this.P = { flash: 1, vol: 1, spec: 1, halo: 1 }; for (const k in this.P) if (this.g.P && this.g.P.has('hc' + k)) this.P[k] = +this.g.P.get('hc' + k);
  }
  /* everything shared by the cars of one kind: cut once from the street layer's geometry */
  kind(type) {
    if (this.types[type]) return this.types[type];
    const T = TYPES[type], sv = this.g.streetVehicles, K = sv && sv.types && sv.types[type]; if (!T || !K || !K.lods[0]) throw new Error('no body for ' + type);
    const sh = this.g.world.shared, hw = (K.meta && K.meta.wid ? K.meta.wid : 1.87) / 2, find = (L) => { const r = {}; for (const im of L.main.meshes) { const k = im.material.customProgramCacheKey ? String(im.material.customProgramCacheKey()) : ''; if (/"lens"/.test(k)) continue; if (/"paint":1/.test(k)) r.paint = im; else if (/"glass":1/.test(k)) r.glass = im; } return r; };
    const R = { T, hw, lods: [], atlas: makeAtlas(T, type === 'suv') }, probe = prober(K.lods[0].main.meshes.map((im) => im.geometry));
    R.gapMat = bake(new THREE.MeshStandardMaterial({ map: R.atlas, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), sh, 'gap');
    R.trimMat = bake(new THREE.MeshStandardMaterial({ map: R.atlas, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), sh, 'trim');
    for (let lod = 0; lod < 2; lod++) { const L = K.lods[lod]; if (!L) { R.lods.push(R.lods[0]); continue; } const f = find(L); if (!f.paint) throw new Error('no paint in ' + type + ' level ' + lod);
      const cut = cutBody(T, f.paint.geometry, f.glass && f.glass.geometry, hw);
      R.lods.push({ paintGeo: f.paint.geometry, skin: cut.skin, door: cut.door.map((b) => geoOf(b, 'var')), trim: cut.trim.map((b) => geoOf(b)), glass: lod === 0 && f.glass ? cut.glass.map((b) => (b.p.length ? geoOf(b, 'var') : null)) : [null, null], gap: geoOf(cut.gap),
        skinMat: paintCopy(f.paint.material, R.atlas, true), doorMat: paintCopy(f.paint.material, R.atlas, false), glassMat: f.glass ? f.glass.material : null }); }
    const kit = buildKit(T, probe, hw); R.kit = kit; R.housing = geoOf(kit.H); R.lens = geoOf(kit.L); R.crew = geoOf(kit.crew);
    { const n = kit.halo.length, g = new THREE.BufferGeometry(), p = [], d = [], c = [], l = [], s = []; for (const h of kit.halo) { p.push(...h.p); d.push(...h.d); c.push(...h.col); l.push(h.lamp); s.push(h.size); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aDir', new THREE.Float32BufferAttribute(d, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(c, 3)); g.setAttribute('aLamp', new THREE.Float32BufferAttribute(l, 1)); g.setAttribute('aSize', new THREE.Float32BufferAttribute(s, 1)); R.halo = g; R.haloN = n; }
    /* where the unit number goes: two digits on each rear door and on the roof, and the words across the tail (corners on the body) */
    const sideZ = (x, y, zs) => (probe(2, zs, x, y, 0.06, hw + 0.05) ?? zs * hw) + zs * 0.004, slots = [];
    { const [xc, yc, h] = T.numDoor, w = h * 0.6; for (const zs of [1, -1]) for (let i = 0; i < 2; i++) { const xa = xc + zs * (i - 1) * w, xb = xa + zs * w, P = (x, y) => [x, y, sideZ(x, y, zs)]; slots.push({ i, c: [P(xa, yc - h / 2), P(xb, yc - h / 2), P(xb, yc + h / 2), P(xa, yc + h / 2)] }); } }
    { const [xc, h] = T.numRoof, w = h * 0.6; for (let i = 0; i < 2; i++) { const za = (i - 1) * w, zb = za + w, P = (x, z) => [x, kit.roofY(x, Math.max(0.1, Math.abs(z))) + 0.004, z]; slots.push({ i, c: [P(xc - h / 2, za), P(xc - h / 2, zb), P(xc + h / 2, zb), P(xc + h / 2, za)] }); } }
    R.slots = slots; R.words = [];
    { const y0 = T.rearTxt[0], y1 = T.rearTxt[1], zw = 0.36, n = 6, a = UV(1040, 966), b = UV(2000, 882); for (let i = 0; i < n; i++) { const za = -zw + 2 * zw * i / n, zb = -zw + 2 * zw * (i + 1) / n, X = (y, z) => (probe(0, -1, y, z, 0.06) ?? -2.4) - 0.004, P = (y, z) => [X(y, z), y, z];
      R.words.push({ c: [P(y0, za), P(y0, zb), P(y1, zb), P(y1, za)], r: [a[0] + (b[0] - a[0]) * i / n, a[1], a[0] + (b[0] - a[0]) * (i + 1) / n, b[1]] }); } }
    return (this.types[type] = R);
  }
  dress(v) {
    const R = this.kind(v.def.type || v.type), T = R.T, D = { R, g: new THREE.Group(), f: new THREE.Group(), lod: [], own: [], lamp: new Float32Array(NL), sir: null, dPrev: 0, lit: false };
    const mesh = (geo, mat, parent, cast) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !!cast; m.receiveShadow = true; parent.add(m); return m; };
    /* bar, lamps, crew */
    mesh(R.housing, this.matte, D.g, true);
    const lensMat = bake(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.0 }), this.g.world.shared, 'lens', { value: D.lamp }); D.own.push(lensMat); mesh(R.lens, lensMat, D.g, false);
    D.crew = mesh(R.crew, this.matte, D.g, false);
    /* per detail level: the painted skin (with this car's number), the two doors, the doorway */
    const no = String(v.id % 100).padStart(2, '0');
    for (let lod = 0; lod < 2; lod++) { const L = R.lods[lod], G = new THREE.Group(), B = { p: L.skin.p.slice(), n: L.skin.n.slice(), u: L.skin.u.slice(), c: [], g: [], l: [] };
      for (const s of R.slots) quad(B, s.c[0], s.c[1], s.c[2], s.c[3], digitRect(+no[s.i])); for (const w of R.words) quad(B, w.c[0], w.c[1], w.c[2], w.c[3], w.r);
      const sg = geoOf(B, 'var'); D.own.push(sg); mesh(sg, L.skinMat, G, false);
      const doors = []; for (let si = 0; si < 2; si++) { const zs = si ? -1 : 1, piv = new THREE.Group(); piv.position.set(T.door[1], 0, zs * R.hw); const dm = mesh(L.door[si], L.doorMat, piv, true); dm.position.set(-T.door[1], 0, -zs * R.hw); mesh(L.trim[si], R.trimMat, piv, false).position.copy(dm.position);
        if (L.glass[si] && L.glassMat) { const gm = mesh(L.glass[si], L.glassMat, piv, false); gm.position.copy(dm.position); gm.renderOrder = 2; } G.add(piv); doors.push({ piv, zs }); }
      const gap = mesh(L.gap, R.gapMat, G, false); gap.visible = false; D.g.add(G); D.lod.push({ G, doors, gap }); }
    /* light: the mirror highlight on this car's own lacquer (the body's own geometry, drawn once more, added), glare points, and the light on what stands around */
    D.Lw = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]; D.Lc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };
    const specMat = new THREE.ShaderMaterial({ uniforms: { uLw: { value: D.Lw }, uLc: { value: D.Lc }, uSpec: this.U.uSpec }, vertexShader: SPEC_V, fragmentShader: SPEC_F, ...add, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }); D.own.push(specMat);
    D.spec = [0, 1].map((lod) => { const m = new THREE.Mesh(R.lods[lod].paintGeo, specMat); m.renderOrder = 6; m.visible = false; D.f.add(m); return m; });
    const haloMat = new THREE.ShaderMaterial({ uniforms: { uLamp: { value: D.lamp }, uPx: this.U.uPx }, vertexShader: HALO_V, fragmentShader: HALO_F, ...add }); D.own.push(haloMat);
    D.halo = new THREE.Points(R.halo, haloMat); D.halo.frustumCulled = false; D.halo.renderOrder = 8; D.f.add(D.halo);
    const U = this.U, lu = () => ({ uLw: { value: D.Lw }, uLc: { value: D.Lc }, uR: U.uR, uShade: U.uShade, tLight: U.tLight, uHalf: U.uHalf, tDepth: U.tDepth, tNormal: U.tNormal, uPI: U.uPI, uVW: U.uVW });
    const mul = { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false, toneMapped: false, fog: false };
    const volMat = new THREE.ShaderMaterial({ uniforms: lu(), vertexShader: LIGHT_V, fragmentShader: LIGHT_F, ...mul, depthTest: false, side: THREE.BackSide }); D.own.push(volMat);
    D.vol = new THREE.Mesh(this.sphere, volMat); D.vol.frustumCulled = false; D.vol.renderOrder = 30; D.vol.visible = false; this.fxg.add(D.vol);
    D.vol.onBeforeRender = (r, s, cam) => { U.uPI.value.copy(cam.projectionMatrixInverse); U.uVW.value.copy(cam.matrixWorld); };
    const flatMat = new THREE.ShaderMaterial({ defines: { FLAT: 1 }, uniforms: lu(), vertexShader: LIGHT_V, fragmentShader: LIGHT_F, ...mul, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }); D.own.push(flatMat);
    D.flat = new THREE.Mesh(this.plane, flatMat); D.flat.frustumCulled = false; D.flat.renderOrder = 5; D.flat.visible = false; this.fxg.add(D.flat);
    this.solid.add(D.g); this.fxg.add(D.f); v._hc = D; this.list.add(v);
  }
  undress(v) {
    const D = v._hc; if (!D) return; this.quiet(D, true); this.solid.remove(D.g); this.fxg.remove(D.f); this.fxg.remove(D.vol); this.fxg.remove(D.flat);
    for (const o of D.own) o.dispose(); v._hc = null; this.list.delete(v);
  }
  /* once per drawn frame, before the first car: is the depth of the ambient-occlusion pass there to light the surroundings with? */
  sync() {
    const g = this.g, w = g.world, gt = w.gtao; this.stamp = g.frame; this.voices = 0;
    this.depthOK = !!(this.P.vol && gt && gt.enabled !== false && gt.depthTexture && gt.normalTexture && w.composer); if (this.depthOK) { this.U.tDepth.value = gt.depthTexture; this.U.tNormal.value = gt.normalTexture; }
    const cam = w.camera; this.U.uPx.value = w.renderer.getDrawingBufferSize(_v2).y * 0.5 * cam.projectionMatrix.elements[5]; this.kLens = Math.tan((cam.fov * Math.PI) / 360) / Math.tan((55 * Math.PI) / 360);
  }
  /* which lamp groups are lit now. 0 1: red outer, inner; 2 3: blue inner, outer; 4 5: clear front; 6 7: amber rear; 8 9: grille; 10 11: rear deck */
  flash(v, D, on) {
    const A = D.lamp; A.fill(0); if (!on || !this.P.flash) return false;
    const p = (((this.heat.t * 1.15 + v.id * 0.37) % 1) + 1) % 1, dbl = (a) => { const q = (((p - a) % 1) + 1) % 1; return q < 0.09 || (q > 0.13 && q < 0.22) || (q > 0.26 && q < 0.37) ? 1 : 0; /* three flashes a side, so that one end of the bar is lit in four frames of five (it was dark in most stills: 'no bloom', 'never visibly lit') */ }, moving = !!v.drive;
    A[0] = dbl(0.0); A[1] = dbl(0.07); A[3] = dbl(0.5); A[2] = dbl(0.57);
    if (moving) { A[4] = p > 0.30 && p < 0.47 ? 1 : 0; A[5] = p > 0.80 && p < 0.97 ? 1 : 0; }
    else { const s = (((this.heat.t * 0.9 + v.id * 0.21) % 1) + 1) % 1; A[6] = s < 0.42 ? 1 : 0; A[7] = s > 0.5 && s < 0.92 ? 1 : 0; }
    A[8] = dbl(0.5); A[9] = dbl(0.0); A[10] = dbl(0.25); A[11] = dbl(0.75);
    return true;
  }
  draw(v, dt) {
    const D = v._hc; if (!D) return; const g = this.g, cam = g.world.camera, R = D.R; if (this.stamp !== g.frame) this.sync();
    /* the body under us: a clean, cared-for car with nothing on the roof but our bar */
    const vv = v._vv; if (vv && !vv.hc) { vv.hc = 1; vv.dirt = DIRT; vv.seed01 = SEED; vv.rack = false; vv.livery = -1; }
    _e.set(v.roll || 0, v.h, v.pitch || 0, 'YZX'); D.g.quaternion.setFromEuler(_e); D.g.position.set(v.x, (v.z || 0) + (vv ? vv.ride : 0) - 0.012, -v.y); D.f.quaternion.copy(D.g.quaternion); D.f.position.copy(D.g.position);
    const d0 = Math.hypot(v.x - cam.position.x, -v.y - cam.position.z), lod = d0 * this.kLens < LOD_NEAR ? 0 : 1, far = d0 > 258;
    D.g.visible = !far; D.f.visible = !far; for (let i = 0; i < 2; i++) D.lod[i].G.visible = i === lod;
    const mine = g.player && g.player.vehicle === v, k = mine || v.wreck ? 0 : sm(v.doorK || 0), L = D.lod[lod];
    for (const d of L.doors) d.piv.rotation.y = d.zs * DOOR_OPEN * k; L.gap.visible = k > 0.02;
    D.crew.visible = lod === 0 && !!v.drive && !v.out && !mine;
    /* lamps */
    const on = !v.wreck && !v.stolen && !mine && (this.heat.level > 0 || !!v.drive), lit = this.flash(v, D, on) && !far, A = D.lamp, red = Math.max(A[0], A[1]), blue = Math.max(A[2], A[3]), white = Math.max(A[4], A[5]) * 0.5 + Math.max(A[6], A[7]) * 0.0;
    /* the light that falls on things does not snap with the lenses: each colour swells and fades from its own end of the bar, so both are there at once */
    const dk = Math.exp(-(dt || 0.016) / 0.16); D.cr = lit ? Math.max(red, (D.cr || 0) * dk, 0.04) : 0; D.cb = lit ? Math.max(blue, (D.cb || 0) * dk, 0.04) : 0; D.cw = lit ? Math.max(white, (D.cw || 0) * dk) : 0;
    const any = lit && d0 < 150; D.halo.visible = lit && !!this.P.halo;
    D.spec[0].visible = any && lod === 0 && !!this.P.spec; D.spec[1].visible = any && lod === 1 && d0 < 90 && !!this.P.spec; D.vol.visible = any && this.depthOK; D.flat.visible = any && !this.depthOK && !!this.P.vol;
    if (any) { D.g.updateMatrixWorld(true); const lp = R.kit.lp; D.Lw[0].fromArray(lp.red).applyMatrix4(D.g.matrixWorld); D.Lw[1].fromArray(lp.blue).applyMatrix4(D.g.matrixWorld); D.Lw[2].fromArray(lp.white).applyMatrix4(D.g.matrixWorld);
      D.Lc[0].set(1, 0.05, 0.03).multiplyScalar(1.5 * D.cr); D.Lc[1].set(0.05, 0.18, 1).multiplyScalar(1.5 * D.cb); D.Lc[2].set(1, 1, 1).multiplyScalar(1.2 * D.cw);
      D.vol.position.set(v.x, (v.z || 0) + 1.2, -v.y); D.flat.position.set(v.x, (g.statics.onSidewalk(v.x, v.y) ? 0.15 : 0) + 0.02, -v.y); }
    try { this.siren(v, D, dt, on, d0); } catch (e) { this.quiet(D, true); }
  }
  frame(dt) { if (this.stamp !== this.g.frame) this.sync(); }
  /* for measuring what all this costs: everything of ours off / on */
  setVisible(b) { this.solid.visible = b; this.fxg.visible = b; }

  /* ---------------------------------------------------------------- siren (synthesis: two oscillators through a horn's resonances) */
  quiet(D, now) {
    const S = D.sir; if (!S) return; D.sir = null;
    try { const t = S.a.currentTime; S.gain.gain.cancelScheduledValues(t); S.gain.gain.setTargetAtTime(0, t, now ? 0.02 : 0.08); for (const o of S.osc) o.stop(t + (now ? 0.1 : 0.5)); setTimeout(() => { try { S.pan.disconnect(); } catch (e) {} }, 800); } catch (e) {}
  }
  siren(v, D, dt, on, d0) {
    const g = this.g, s = g.sound;
    if (!s || !s.on || !s.ac || !s.out || g.capture || s.ac.state !== 'running') { if (D.sir) this.quiet(D, true); return; }
    /* wail while it drives in; when it stops, a short yelp and then quiet with the lamps on */
    /* w3: a car driving off after it is over makes no sound (its lamps stay on): a wail after IN THE CLEAR reads as still wanted */ if (v.away && this.heat.level === 0) { D.yelp = 0; if (D.sir) this.quiet(D, false); return; }
    if (v.drive && on) { D.yelp = 1.25; D.sirT = (D.sirT || 0) + dt; } else if (D.yelp > 0 && on) { D.yelp -= dt; D.sirT = (D.sirT || 0) + dt; } else { D.yelp = 0; if (D.sir) this.quiet(D, false); return; }
    const cam = g.world.camera, dx = v.x - cam.position.x, dz = -v.y - cam.position.z, dy = (v.z || 0) + 1.5 - cam.position.y, d = Math.hypot(dx, dy, dz);
    if (!D.sir) { if (d > 320 || this.voices >= 3) return; const a = s.ac, t = a.currentTime, S = { a, osc: [], t0: t };
      const o1 = a.createOscillator(), o2 = a.createOscillator(), mix = a.createGain(), hp = a.createBiquadFilter(), pk = a.createBiquadFilter(), pk2 = a.createBiquadFilter(), lp = a.createBiquadFilter(), gain = a.createGain(), pan = a.createStereoPanner ? a.createStereoPanner() : a.createGain();
      o1.type = 'square'; o2.type = 'sawtooth'; o2.detune.value = 9; mix.gain.value = 0.5; hp.type = 'highpass'; hp.frequency.value = 480; pk.type = 'peaking'; pk.frequency.value = 1450; pk.Q.value = 1.3; pk.gain.value = 9; pk2.type = 'peaking'; pk2.frequency.value = 2900; pk2.Q.value = 2; pk2.gain.value = 5; lp.type = 'lowpass'; lp.frequency.value = 4200; gain.gain.value = 0;
      o1.connect(mix); o2.connect(mix); mix.connect(hp); hp.connect(pk); pk.connect(pk2); pk2.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(s.out); o1.start(t); o2.start(t);
      Object.assign(S, { osc: [o1, o2], lp, gain, pan }); D.sir = S; D.dPrev = d; D.hid = 0; D.hidT = 0; }
    this.voices++;
    const S = D.sir, t = S.a.currentTime, T = D.sirT + v.id * 0.71; let f;
    if (v.drive) { const p = (T % 4.4) / 4.4; f = p < 0.56 ? 640 + 760 * sm(p / 0.56) : 1400 - 760 * sm((p - 0.56) / 0.44); } else { const p = (T % 0.32) / 0.32; f = p < 0.78 ? 700 + 820 * (p / 0.78) : 1520 - 820 * ((p - 0.78) / 0.22); }
    /* the pitch bends with the speed at which it closes on the camera */
    const vr = dt > 0 ? Math.max(-40, Math.min(40, (D.dPrev - d) / dt)) : 0; D.dPrev = d; D.vr = (D.vr || 0) + (vr - (D.vr || 0)) * Math.min(1, dt * 4); f *= 343 / (343 - D.vr);
    for (const o of S.osc) o.frequency.setTargetAtTime(f, t, 0.012);
    /* behind a building it is duller and quieter (one ray every fifth of a second) */
    D.hidT -= dt; if (D.hidT <= 0) { D.hidT = 0.2; D.hid = (this.heat.wall || g.statics).raycast(cam.position.x, -cam.position.z, v.x, v.y) < 1 ? 1 : 0; /* w3: buildings only: a tree guard or a fence between the camera and the car is not 'behind a building' (the game's collision set holds those too) */ } D.hidK = (D.hidK || 0) + (D.hid - (D.hidK || 0)) * Math.min(1, dt * 5);
    const vol = 0.11 / (1 + Math.pow(d / 45, 1.6)) * (1 - 0.45 * D.hidK) * (v.drive ? 1 : Math.min(1, D.yelp / 0.15));
    S.gain.gain.setTargetAtTime(vol, t, 0.05); S.lp.frequency.setTargetAtTime((4200 - 2800 * D.hidK) / (1 + d / 260), t, 0.08);
    if (S.pan.pan) { cam.matrixWorld.extractBasis(_v, _v2, new THREE.Vector3()); S.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, (dx * _v.x + dy * _v.y + dz * _v.z) / Math.max(d, 4))), t, 0.05); }
  }
}
