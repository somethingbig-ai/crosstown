// storefronts.js (lanes/streets): the street floor as real geometry. By rule from city.json, every street-facing ground-floor wall of the
// playable city gets piers, an entablature, a sign fascia and, bay by bay, a shopfront (bulkhead, mullions, transom, door with rails,
// kick plate, pull and step, some set back between projecting showcases), a lobby, a residential entry, a closed gate, a service bay
// or a loading dock. Glass is one quad per run of panes: a mirror of the street (sky from the environment; the kerb, parked cars, road
// and the buildings opposite are traced analytically and lit from the ground bake) over a lit room (interior mapping with a back wall,
// two rows of standing things and a window display from canvas atlases). Signs are lettering masks tinted per shop.
// Layout mirrors pipeline/dressing/place.py (wall runs, street-front rule, per-style gh and shop width) so the floor meets the facade
// above; nothing else of facade.js is relied on. Everything is instanced per 128 m tile in two distance bands.
// storefronts.art.js = the atlases, storefronts.glsl.js = the shader text.
// Collision (Nov 12, a player: "I can walk through walls"): the game's solid wall is the building footprint, and every front here stands 0.1-0.7 m
// proud of it (piers 0.26-0.48 m, corner piers also that far past the corner), so a walker's 0.34 m circle sat inside the piers. layout() now also
// returns the drawn front line of every bay (pier faces, glass line, showcases, recessed doors, gates, lobby portals) and add() puts it into
// game.statics as wall segments. Off: ?sfsolid=0. Not added on hero footprints (hero.js removes the fronts there) or inside a traffic lane.
// A corner pier's reach past its corner is solid only where that closes no way through (solExt): at an alley mouth it stays as it was.
import * as THREE from 'three';
import * as FAC from '../facade.js';
import { makeMask, makeRooms, makeProps } from './storefronts.art.js';
import * as G from './storefronts.glsl.js';

const SW = 0.15, TILE = 128, FAR_MAJOR = 520, FAR_FINE = 150;
const f = Math.fround, fr = (x) => f(x - Math.floor(x));
function hash32(px, py) {
  let p0 = fr(f(f(px) * f(0.1031))), p1 = fr(f(f(py) * f(0.1030))), p2 = fr(f(f(px) * f(0.0973)));
  const k = f(33.33), d = f(f(p0 * f(p1 + k)) + f(p1 * f(p0 + k)) + f(p2 * f(p2 + k)));
  p0 = f(p0 + d); p1 = f(p1 + d); p2 = f(p2 + d);
  return [fr(f(f(p0 + p1) * p2)), fr(f(f(p0 + p2) * p1)), fr(f(f(p1 + p2) * p0))];
}
function rnd(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); };
const pack = (c) => { const q = (v) => Math.min(255, Math.round(Math.sqrt(Math.max(0, v)) * 255)); return q(c[0]) + q(c[1]) * 256 + q(c[2]) * 65536; };
const WALL_MEAN = [[0.152, 0.097, 0.080], [0.453, 0.362, 0.244], [0.266, 0.237, 0.161], [0.122, 0.084, 0.052], [0.393, 0.268, 0.166]];

// the painted facade's layout for one building (mirrors facade.js facade() through place.py's Layout)
function layoutOf(style, seed) {
  const v = f(style + Math.min(0.999, seed)), sd = f(v - Math.floor(v)), h3 = hash32(f(sd * f(913)), f(f(sd * f(37)) + f(1)));
  let gh = 4.4 + h3[1] * 0.8, bw, layer, tint;
  if (style === 0) { bw = 1.9 + h3[0] * 0.7; layer = h3[2] < 0.6 ? 0 : (h3[2] < 0.8 ? 4 : 3); tint = mix3([0.82, 0.74, 0.70], [1.08, 0.98, 0.94], h3[0]); gh = 3.9 + h3[1] * 0.5; }
  else if (style === 1) { bw = 2.5 + h3[0] * 0.9; layer = 1; tint = mul(mix3([0.95, 0.90, 0.80], [0.78, 0.76, 0.72], h3[0]), 0.85 + 0.25 * h3[2]); }
  else if (style === 2) { bw = 1.5; layer = 2; tint = [1, 1, 1]; }
  else if (style === 3) { bw = 1.45 + h3[0] * 0.4; layer = h3[2] < 0.5 ? 4 : 2; tint = h3[2] < 0.5 ? mix3([1.05, 1.0, 0.9], [1.25, 1.22, 1.15], h3[1]) : [1.05, 1.03, 1.0]; }
  else { bw = 2.9 + h3[0] * 0.8; layer = h3[1] < 0.6 ? 3 : 0; tint = mix3([0.75, 0.7, 0.68], [1.0, 0.95, 0.9], h3[0]); gh = 4.6 + h3[1] * 0.8; }
  const frameCol = h3[1] < 0.45 ? [0.035, 0.035, 0.04] : (h3[1] < 0.7 ? [0.34, 0.33, 0.31] : [0.10, 0.07, 0.05]);
  return { style, gh, bw, shopW: bw * (style === 2 ? 6 : (style === 4 ? 2 : 3)), frameCol, layer, wall: WALL_MEAN[layer].map((m, i) => m * tint[i] * 0.9) };
}

class SegGrid {
  constructor(cell = 24) { this.c = cell; this.g = new Map(); this.stamp = 0; }
  add(ax, ay, bx, by, tag) {
    const c = this.c, seg = [ax, ay, bx, by, tag, 0];
    for (let i = Math.floor(Math.min(ax, bx) / c); i <= Math.floor(Math.max(ax, bx) / c); i++) for (let j = Math.floor(Math.min(ay, by) / c); j <= Math.floor(Math.max(ay, by) / c); j++) { const k = i * 100003 + j; let a = this.g.get(k); if (!a) this.g.set(k, (a = [])); a.push(seg); }
  }
  ring(pts, tag) { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.add(a[0], a[1], b[0], b[1], tag); } }
  ray(ox, oy, dx, dy, maxd, skip) {                    // nearest hit [t, tag] along a unit ray, or null
    const c = this.c, ex = ox + dx * maxd, ey = oy + dy * maxd, st = ++this.stamp; let best = null;
    for (let i = Math.floor(Math.min(ox, ex) / c); i <= Math.floor(Math.max(ox, ex) / c); i++) for (let j = Math.floor(Math.min(oy, ey) / c); j <= Math.floor(Math.max(oy, ey) / c); j++) {
      const a = this.g.get(i * 100003 + j); if (!a) continue;
      for (const s of a) {
        if (s[5] === st) continue; s[5] = st; if (skip !== undefined && s[4] === skip) continue;
        const sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx; if (Math.abs(den) < 1e-9) continue;
        const t = ((s[0] - ox) * sy - (s[1] - oy) * sx) / den, u = ((s[0] - ox) * dy - (s[1] - oy) * dx) / den;
        if (t >= 0 && t <= maxd && u >= -1e-6 && u <= 1 + 1e-6 && (!best || t < best[0])) best = [t, s[4]];
      }
    }
    return best;
  }
  nearest(x, y, maxd) {
    const c = this.c, st = ++this.stamp; let best = null;
    for (let i = Math.floor((x - maxd) / c); i <= Math.floor((x + maxd) / c); i++) for (let j = Math.floor((y - maxd) / c); j <= Math.floor((y + maxd) / c); j++) {
      const a = this.g.get(i * 100003 + j); if (!a) continue;
      for (const s of a) { if (s[5] === st) continue; s[5] = st; const sx = s[2] - s[0], sy = s[3] - s[1], L2 = sx * sx + sy * sy || 1e-9; const t = Math.max(0, Math.min(1, ((x - s[0]) * sx + (y - s[1]) * sy) / L2)), d = Math.hypot(x - s[0] - sx * t, y - s[1] - sy * t); if (d <= maxd && (!best || d < best[0])) best = [d, s[4]]; }
    }
    return best;
  }
}
function pip(x, y, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function area2(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a; }
// build.py's walk round a footprint: runs of segments [x, y, dx, dy, L, u at start, ring index], a new run at corners sharper than 25 degrees
function wallRuns(ring) {
  const n = ring.length, dirs = [];
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6; dirs.push([(b[0] - a[0]) / L, (b[1] - a[1]) / L, L]); }
  let start = 0;
  for (let i = 0; i < n; i++) { const d0 = dirs[(i - 1 + n) % n], d1 = dirs[i]; if (d0[0] * d1[0] + d0[1] * d1[1] < 0.906) { start = i; break; } }
  const out = []; let i = 0;
  while (i < n) {
    const segs = []; let run = 0;
    for (;;) { const k = (start + i) % n, d = dirs[k], p = ring[k]; segs.push([p[0], p[1], d[0], d[1], d[2], run, k]); run += d[2]; i++; if (i >= n) break; const dn = dirs[(start + i) % n]; if (d[0] * dn[0] + d[1] * dn[1] < 0.906) break; }
    for (const s of segs) s[5] -= run / 2;
    out.push(segs);
  }
  return { runs: out, dirs };
}

// ------------------------------------------------------------------------------------------------ what the shops are
// g = name group (storefronts.art.js NAMES), back = back wall cell, floor (+10 = warm light), fr / mr = cut-out family of the window and the room
const T = {
  deli: { g: 0, back: 0, floor: 0, fr: 2, mr: 2, cl: 0.7, lit: 0.9, sg: [2, 1, 4, 0, 4], out: 'produce' }, pharmacy: { g: 1, back: 1, floor: 3, fr: 2, mr: 2, cl: 0.4, lit: 1.25, sg: [1, 5, 3, 1, 1] },
  liquor: { g: 2, back: 2, floor: 11, fr: 2, mr: 2, cl: 0.5, lit: 0.9, sg: [3, 2, 3, 1, 2] }, clothes: { g: 3, back: 3, floor: 11, fr: 0, mr: 0, cl: 0, lit: 1.0, sg: [3, 4, 0, 3, 2] },
  diner: { g: 4, back: 5, floor: 10, fr: 1, mr: 1, cl: 0.2, lit: 0.9, sg: [2, 3, 2, 0, 3] }, pizza: { g: 5, back: 5, floor: 10, fr: 1, mr: 1, cl: 0.5, lit: 1.0, sg: [2, 1, 4, 0, 4] },
  bar: { g: 6, back: 6, floor: 11, fr: 1, mr: 1, cl: 0.08, lit: 0.6, sg: [4, 1, 0, 4, 2] }, nails: { g: 7, back: 7, floor: 3, fr: 3, mr: 3, cl: 0.4, lit: 1.25, sg: [1, 2, 4, 0, 4] },
  laundry: { g: 8, back: 8, floor: 0, fr: 3, mr: 3, cl: 0.35, lit: 1.15, sg: [2, 1, 4, 0, 4] }, bank: { g: 9, back: 9, floor: 2, fr: 4, mr: 4, cl: 0, lit: 1.0, sg: [0, 6, 1, 3, 0], dbl: true },
  hardware: { g: 10, back: 11, floor: 3, fr: 2, mr: 2, cl: 0.6, lit: 1.0, sg: [4, 1, 2, 0, 3] }, home: { g: 11, back: 12, floor: 11, fr: 4, mr: 4, cl: 0, lit: 0.95, sg: [3, 3, 0, 3, 1] },
  cafe: { g: 12, back: 13, floor: 11, fr: 1, mr: 1, cl: 0.12, lit: 0.85, sg: [4, 2, 0, 2, 3] }, florist: { g: 13, back: 14, floor: 0, fr: 4, mr: 3, cl: 0.1, lit: 1.0, sg: [3, 1, 0, 2, 4], out: 'flowers' },
  jewelry: { g: 14, back: 15, floor: 14, fr: 0, mr: 2, cl: 0.25, lit: 1.2, sg: [2, 3, 3, 2, 2] }, barber: { g: 15, back: 7, floor: 0, fr: 3, mr: 3, cl: 0.2, lit: 1.1, sg: [4, 1, 1, 2, 3] },
  lobby: { g: -1, back: 10, floor: 12, fr: 4, mr: 4, cl: 0, lit: 0.9 }, vacant: { g: -1, back: 12, floor: 3, fr: 0, mr: 0, cl: 0, lit: 0.12 },
};
Object.keys(T).forEach((k, i) => { T[k].name = k; T[k].id = i; });
const MIXES = [
  'deli deli deli pizza pizza nails nails laundry laundry barber barber bar bar diner liquor liquor cafe cafe hardware florist clothes pharmacy',
  'bank bank pharmacy pharmacy clothes clothes clothes cafe cafe jewelry jewelry deli deli diner home liquor florist',
  'bank bank bank clothes clothes clothes cafe cafe pharmacy pharmacy home deli',
  'pharmacy pharmacy deli deli laundry laundry bank bank nails liquor cafe florist clothes barber diner',
  'clothes clothes clothes home home home cafe cafe cafe jewelry jewelry jewelry bar bar deli hardware florist diner',
].map((s) => s.split(' '));
const SIGNPAL = [['#16233f', '#f2efe6'], ['#7a1414', '#fff3d6'], ['#f1ede2', '#1c1c1c'], ['#0f3d2a', '#f4e9c8'], ['#111111', '#e9c46a'], ['#f4d03f', '#1b1b1b'], ['#2b2b2b', '#ffffff'], ['#5a2d0c', '#ffe8c2'],
  ['#e9e4d8', '#8a1c1c'], ['#143a5a', '#ffffff'], ['#3b0f3b', '#f6e7ff'], ['#d9d4c7', '#143a5a'], ['#b3261e', '#ffffff'], ['#1d6b3a', '#ffffff'], ['#0d0d0d', '#f2f2f2'], ['#e8762a', '#ffffff'], ['#274c8f', '#ffd84a'], ['#f6f3ea', '#0f3d2a']].map((p) => p.map(lin));
const LIGHTBOX = [['#f6f3e8', '#b3261e'], ['#f4d03f', '#b3261e'], ['#f6f3e8', '#1d4f9c'], ['#f6f3e8', '#1d6b3a'], ['#f4d03f', '#111111'], ['#ffffff', '#c2185b'], ['#b3261e', '#f6f3e8'], ['#1d4f9c', '#ffffff']].map((p) => p.map(lin));
const AWNCOL = [[0.03, 0.10, 0.05], [0.16, 0.025, 0.03], [0.025, 0.04, 0.12], [0.05, 0.05, 0.055], [0.36, 0.035, 0.03], [0.30, 0.22, 0.13], [0.04, 0.11, 0.33], [0.45, 0.16, 0.03], [0.42, 0.30, 0.04], [0.12, 0.12, 0.13], [0.07, 0.20, 0.22], [0.30, 0.29, 0.26], [0.03, 0.10, 0.05]];
const FRAMES = [[[0.02, 0.02, 0.022], 0.45, 0.2], [[0.05, 0.035, 0.025], 0.4, 0.5], [[0.30, 0.31, 0.32], 0.34, 0.85], [[0.02, 0.02, 0.022], 0.45, 0.2], [[0.20, 0.21, 0.22], 0.35, 0.8], [[0.04, 0.03, 0.025], 0.5, 0.3], [[0.36, 0.36, 0.34], 0.5, 0.0], [[0.025, 0.045, 0.035], 0.5, 0.0], [[0.075, 0.025, 0.022], 0.5, 0.0], [[0.025, 0.035, 0.06], 0.5, 0.0], [[0.16, 0.11, 0.06], 0.55, 0.0]];
const PAINT = [[0.42, 0.40, 0.34], [0.22, 0.22, 0.22], [0.03, 0.03, 0.035], [0.13, 0.035, 0.03], [0.035, 0.07, 0.05], [0.36, 0.345, 0.31], [0.06, 0.075, 0.11], [0.27, 0.21, 0.15]];
const FLOWERS = [[0.70, 0.03, 0.06], [0.80, 0.45, 0.03], [0.72, 0.70, 0.62], [0.70, 0.18, 0.38], [0.30, 0.08, 0.45], [0.80, 0.62, 0.05], [0.75, 0.25, 0.20]];
const CHROME = [0.62, 0.63, 0.65], BRASS = [0.72, 0.52, 0.20], DARK = [0.03, 0.03, 0.033], STEEL = [0.24, 0.25, 0.26];
const K = { PLAIN: 0, MAS: 1, GATE: 2, SIGN: 3, AWN: 4, TILE: 5, PRODUCE: 6, WOOD: 7, BOUQUET: 8 };
export const BOX_STRIDE = 17, GLASS_STRIDE = 27;

// ------------------------------------------------------------------------------------------------ layout: city.json -> instance records
export function layout(C, opts = {}) {
  const B = C.buildings, px = C.meta.px, py = C.meta.py;
  const bgrid = new SegGrid(), kgrid = new SegGrid(), egrid = new SegGrid(30), cells = new Map();
  B.forEach((b, bi) => {
    if (b.minh > 3) return; bgrid.ring(b.poly, bi);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of b.poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let i = Math.floor(x0 / 32); i <= Math.floor(x1 / 32); i++) for (let j = Math.floor(y0 / 32); j <= Math.floor(y1 / 32); j++) { const k = i * 100003 + j; let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(bi); }
  });
  const inBuilding = (x, y) => { const a = cells.get(Math.floor(x / 32) * 100003 + Math.floor(y / 32)); if (a) for (const bi of a) { const b = B[bi]; if (pip(x, y, b.poly) && !(b.holes || []).some((h) => pip(x, y, h))) return true; } return false; };
  for (const bl of C.blocks) { kgrid.ring(bl.ext); for (const h of bl.holes || []) kgrid.ring(h); }
  C.edges.forEach((e, ei) => { for (let i = 0; i + 1 < e.pts.length; i++) egrid.add(e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1], ei); });
  const front = (x, y, nx, ny, maxd = 20) => {          // distance to the kerb straight ahead, or null when the wall does not face a street
    const ox = x + nx * 0.4, oy = y + ny * 0.4; if (inBuilding(ox, oy)) return null;
    const k = kgrid.ray(ox, oy, nx, ny, maxd); if (!k) return null; if (bgrid.ray(ox, oy, nx, ny, k[0])) return null; return k[0] + 0.4;
  };
  const LC = new Map(), lay = (bi) => { let l = LC.get(bi); if (!l) LC.set(bi, (l = layoutOf(B[bi].style, B[bi].seed))); return l; };

  // collision: how much of a corner pier's reach past its corner (ext) may be solid: none of the way a walker has today between this corner and the
  // next wall (an alley mouth, a slot between two buildings) may be closed, so 0.9 m of any such gap stays open, shared between its two sides;
  // and solOut: a front line is never solid nearer than 0.9 m to a wall across from it (a bay inside a slot between buildings)
  const solExt = (cx, cy, ux, uy, nx, ny, ext, out) => { let g = 1e9; for (const z of [-0.7, -0.35, 0.03, out / 2, out]) { const ox = cx + ux * 0.02 + nx * z, oy = cy + uy * 0.02 + ny * z; if (z < 0 && inBuilding(ox, oy)) continue; const h = bgrid.ray(ox, oy, ux, uy, 1.9); if (h && h[0] < g) g = h[0]; }     /* 1.9 m: the deepest pier on both sides (0.48 m each) and the 0.9 m kept open */
    if (g > 1e8) return ext; stats.solidCut++; const e = Math.min(ext, (g - 0.9) / 2); return e > 0.05 ? e : 0; };
  const solOut = (P, a, b2, z) => { let g = 1e9; for (const u of b2 - a > 0.8 ? [a + 0.35, (a + b2) / 2, b2 - 0.35] : [(a + b2) / 2]) { const ox = P.x + P.dx * u + P.nx * 0.03, oy = P.y + P.dy * u + P.ny * 0.03; if (inBuilding(ox, oy)) continue;     /* buried in the next building: nothing to keep open */
      const h = bgrid.ray(ox, oy, P.nx, P.ny, z + 0.9); if (h && h[0] < g) g = h[0]; }
    if (g > 1e8) return z; stats.solidCut++; return Math.min(z, g + 0.03 - 0.9); };
  const tiles = new Map(), frames = [], shops = [], solid = []; const stats = { buildings: 0, bays: 0, shops: 0, kinds: {}, signs: {}, samples: {}, solidCut: 0 };
  let tile = null, fi = 0;
  const bx = (major, x0, x1, y0, y1, z0, z1, kind, col, p0 = 0, p1 = 0, p2 = 0, p3 = 0) => bc(major, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, 0, 0, kind, col, p0, p1, p2, p3);
  const bc = (major, cx, cy, cz, sx, sy, sz, yaw, tilt, kind, col, p0 = 0, p1 = 0, p2 = 0, p3 = 0) => { if (sx <= 0.001 || sy <= 0.001 || sz <= 0.001) return; (major ? tile.major : tile.fine).push(fi, cx, cy, cz, sx, sy, sz, yaw, tilt, kind, col[0], col[1], col[2], p0, p1, p2, p3); };
  const awn = (cx, y, z, w, drop, proj, col, cell, flags, fg, seed) => tile.awn.push(fi, cx, y, z, w, drop, proj, 0, 0, K.AWN, col[0], col[1], col[2], cell, flags, pack(fg), seed);

  B.forEach((b, bi) => {
    if (b.far || b.minh >= 0.5) return;
    let ext = b.poly; if (area2(ext) < 0) ext = ext.slice().reverse();
    let cx = 0, cy = 0; for (const p of ext) { cx += p[0]; cy += p[1]; } cx /= ext.length; cy /= ext.length;
    if (!(Math.abs(cx) < px + 40 && Math.abs(cy) < py + 40)) return;
    const L = lay(bi), style = b.style, bid = b.id ?? bi, h = b.h;
    if (h < 3.2) return;
    const gh = Math.min(L.gh, h - 0.05), Hh = gh - SW, sLo = Hh - 1.25, sHi = Hh - 0.35;
    if (sLo < 2.3) return;                                // a hut: leave it painted
    const shed = h >= 12 && b.area > 120 && rnd(bid, 11) < 0.11;
    const dressCanopy = (style === 1 || style === 3) && h >= 20 && b.area >= 300 && !shed && rnd(bid, 31) < 0.4 && !opts.noDressing;
    // the look of this building's street floor
    const rb = (k) => rnd(bid, 700, k);
    let baseCol, mas, pproud = 0.40, pw = 0.3;
    if (style === 2) { baseCol = rb(1) < 0.5 ? [0.05, 0.052, 0.055] : [0.30, 0.31, 0.32]; mas = 3; pw = 0.22; pproud = 0.26; }
    else if (style === 1) { baseCol = mul(L.wall, 1.0); mas = 0; pw = 0.42; pproud = 0.48; }
    else if (style === 3) { baseCol = rb(1) < 0.5 ? mul(L.wall, 0.95) : [0.33, 0.31, 0.28]; mas = rb(1) < 0.5 ? 1 : 0; }
    else if (rb(1) < 0.42) { baseCol = mul(L.wall, 0.95); mas = 1; }
    else if (rb(1) < 0.62) { baseCol = [0.36, 0.33, 0.28]; mas = 0; }
    else { baseCol = PAINT[Math.floor(rb(2) * PAINT.length)]; mas = 2; }
    const bFrame = rb(3) < 0.5 ? [L.frameCol, 0.45, L.frameCol[0] > 0.2 ? 0.8 : 0.1] : FRAMES[Math.floor(rb(4) * FRAMES.length)];

    // ---- pieces: the street-front bays of every wall segment, cut on the facade's shop grid
    const { runs, dirs } = wallRuns(ext), n = ext.length, pieces = [];
    for (const segs of runs) for (const [x0, y0, dx, dy, SL, u0, ri] of segs) {
      if (SL < 0.6) continue;
      const nx = dy, ny = -dx, ns = Math.max(1, Math.floor(SL / 3)), frs = [];
      for (let k = 0; k < ns; k++) frs.push(front(x0 + dx * SL * (k + 0.5) / ns, y0 + dy * SL * (k + 0.5) / ns, nx, ny));
      if (!frs.some((q) => q !== null)) continue;
      const cuts = [0]; for (let k = Math.ceil((u0 + 0.4) / L.shopW - 0.5); (k + 0.5) * L.shopW < u0 + SL - 0.4; k++) cuts.push((k + 0.5) * L.shopW - u0); cuts.push(SL);
      for (let guard = 0; guard < 40 && cuts.length > 2; guard++) {     // no slivers: a bay narrower than 2.6 m joins its smaller neighbour
        let m = -1; for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] - cuts[i] < 2.6 && (m < 0 || cuts[i + 1] - cuts[i] < cuts[m + 1] - cuts[m])) m = i;
        if (m < 0) break; const left = m > 0 ? cuts[m] - cuts[m - 1] : 1e9, right = m + 2 < cuts.length ? cuts[m + 2] - cuts[m + 1] : 1e9; cuts.splice(left < right ? m : m + 1, 1);
      }
      const dp = dirs[(ri - 1 + n) % n], dn = dirs[(ri + 1) % n], convA = dp[0] * dy - dp[1] * dx > 0.3, convB = dx * dn[1] - dy * dn[0] > 0.3;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i], bb = cuts[i + 1], mid = (a + bb) / 2, kd = frs[Math.max(0, Math.min(ns - 1, Math.floor(mid / SL * ns)))]; if (kd === null) continue;
        pieces.push({ x: x0 + dx * mid, y: y0 + dy * mid, dx, dy, nx, ny, Lp: bb - a, kd, SL, mid, extA: i === 0 && convA ? pproud : 0, extB: i + 2 === cuts.length && convB ? pproud : 0, key: ri * 64 + i, ox: x0, oy: y0, ri });
      }
    }
    if (!pieces.length) return;
    stats.buildings++;
    // which street each bay faces, and what stands opposite
    for (const P of pieces) {
      const e = egrid.nearest(P.x + P.nx * (P.kd + 3), P.y + P.ny * (P.kd + 3), 40); P.ave = e ? !!C.edges[e[1]].ave : false;
      const o = bgrid.ray(P.x + P.nx * 0.5, P.y + P.ny * 0.5, P.nx, P.ny, 90, bi);
      if (o && o[0] > 6) { const ob = B[o[1]]; P.oppD = o[0] + 0.5; P.oppH = ob.h; P.oppC = lay(o[1]).wall; if (ob.style === 2) P.oppC = [0.08, 0.10, 0.12]; } else { P.oppD = 0; P.oppH = 0; P.oppC = [0, 0, 0]; }
    }
    // roles: a lobby in the middle of the longest front of a big building, a residential entry beside a shop on walk-ups and lofts
    let lobby = null;
    if ((style === 1 || style === 2 || style === 3) && h >= 20 && b.area >= 300) for (const P of pieces) if (P.Lp >= 4 && (!lobby || P.SL - Math.abs(P.mid - P.SL / 2) * 2 > lobby.SL - Math.abs(lobby.mid - lobby.SL / 2) * 2)) lobby = P;
    if (lobby) lobby.role = 'lobby';
    else if ((style === 0 || style === 4 || style === 3) && h > 8) {
      const P = pieces.find((q) => q.Lp >= 5.2);
      if (P) { const side = rnd(bid, 701) < 0.5 ? -1 : 1, w = 1.7; pieces.push({ ...P, x: P.x + P.dx * side * (P.Lp - w) / 2, y: P.y + P.dy * side * (P.Lp - w) / 2, Lp: w, role: 'entry', extA: side < 0 ? P.extA : 0, extB: side > 0 ? P.extB : 0, key: P.key + 32 });
        P.x -= P.dx * side * w / 2; P.y -= P.dy * side * w / 2; P.Lp -= w; if (side < 0) P.extA = 0; else P.extB = 0; }
    }
    let prev = null; const mixl = MIXES[style] || MIXES[0];
    for (const P of pieces) {
      const r = (k) => rnd(bid, P.key + 1000, k);
      if (!P.role) {
        if (P.Lp < 2.3) P.role = 'infill';
        else if (r(1) < (P.ave ? 0.03 : 0.16)) P.role = P.Lp >= 4.4 && !P.ave && r(2) < 0.4 && P.kd < 9 ? 'dock' : 'service';
        else if (r(3) < 0.07) P.role = 'gate';
        else if (r(3) < 0.105) P.role = 'vacant';
        else P.role = 'shop';
      }
      if (P.role === 'shop' || P.role === 'gate') { let t = mixl[Math.floor(r(4) * mixl.length)]; if (t === prev) t = mixl[Math.floor(r(5) * mixl.length)]; if (t === prev) t = mixl[(mixl.indexOf(t) + 3) % mixl.length]; P.type = T[t]; prev = t; }
      else if (P.role === 'lobby') P.type = T.lobby; else P.type = T.vacant;
    }

    // ---- emit
    const solG = new Map();                               // collision: per wall segment, [from, to, how far out] along the wall of everything drawn solid
    for (const P of pieces) {
      const r = (k) => rnd(bid, P.key + 2000, k), Lp = P.Lp, rot = Math.atan2(P.dy, P.dx);
      const tk = Math.floor(P.x / TILE) + ',' + Math.floor(P.y / TILE); tile = tiles.get(tk); if (!tile) tiles.set(tk, (tile = { major: [], fine: [], awn: [], glass: [], bq: [] }));
      fi = frames.length / 3; frames.push(P.x, P.y, rot);
      stats.bays++; stats.kinds[P.role] = (stats.kinds[P.role] || 0) + 1; { const nm = P.role === 'shop' ? P.type.name : P.role, a = (stats.samples[nm] ||= []); if (Math.hypot(P.x + 200, P.y + 250) < 260 && P.kd > 3.4) a.push([+P.x.toFixed(1), +P.y.toFixed(1), +rot.toFixed(3)]); }
      const seed = r(0), TY = P.type, masP = [mas, 0, 0, seed];
      const xa = -Lp / 2, xb = Lp / 2;
      let sq = solG.get(P.ri); if (!sq) solG.set(P.ri, (sq = { P, iv: [] })); const pu = (P.x - P.ox) * P.dx + (P.y - P.oy) * P.dy, so = (a, b2, z) => { if (b2 - a > 0.01 && (z = solOut(P, a, b2, z)) > 0.03) sq.iv.push(pu + a, pu + b2, z); };
      const eA = P.extA ? solExt(P.x + P.dx * xa, P.y + P.dy * xa, -P.dx, -P.dy, P.nx, P.ny, P.extA, pproud) : 0, eB = P.extB ? solExt(P.x + P.dx * xb, P.y + P.dy * xb, P.dx, P.dy, P.nx, P.ny, P.extB, pproud) : 0;
      // entablature over the bay and its lip
      const entCol = style === 2 ? baseCol : mul(baseCol, 1.04);
      bx(1, xa - P.extA, xb + P.extB, sHi, Hh + 0.03, 0, pproud - 0.05, K.MAS, entCol, mas === 1 ? 2 : mas, 0, 0, seed);
      if (style !== 2) bx(1, xa - P.extA - 0.04, xb + P.extB + 0.04, Hh - 0.08, Hh + 0.05, 0, pproud + 0.10, K.MAS, mul(entCol, 1.05), 2, 0, 0, seed);
      if (P.role === 'infill') { so(xa - eA, xb + eB, pproud); bx(1, xa - P.extA, xb + P.extB, 0, sHi, 0, pproud, K.MAS, baseCol, ...masP); bx(0, xa - P.extA - 0.03, xb + P.extB + 0.03, 0, 0.4, 0, pproud + 0.04, K.MAS, mul(baseCol, 0.85), mas === 1 ? 0 : mas, 0, 0, seed); continue; }
      const ppw = P.role === 'entry' ? 0.3 : pw;
      // piers with a plinth
      bx(1, xa - P.extA, xa + ppw, 0, sHi, 0, pproud, K.MAS, baseCol, ...masP); bx(1, xb - ppw, xb + P.extB, 0, sHi, 0, pproud, K.MAS, baseCol, ...masP);
      bx(0, xa - P.extA - 0.03, xa + ppw + 0.03, 0, 0.38, 0, pproud + 0.04, K.MAS, mul(baseCol, 0.85), mas === 1 ? 0 : mas, 0, 0, seed); bx(0, xb - ppw - 0.03, xb + P.extB + 0.03, 0, 0.38, 0, pproud + 0.04, K.MAS, mul(baseCol, 0.85), mas === 1 ? 0 : mas, 0, 0, seed);
      const W = Lp - 2 * ppw, x0 = -W / 2, x1 = W / 2;
      so(xa - eA, xa + ppw, pproud); so(xb - ppw, xb + eB, pproud);
      const fc = r(1) < 0.4 ? bFrame : FRAMES[Math.floor(Math.pow(r(2), 1.5) * FRAMES.length)], F = (major, a, b2, c, d, e, g2) => bx(major, a, b2, c, d, e, g2, K.PLAIN, fc[0], fc[1], fc[2], 0.6, seed);
      const D = 5 + 4 * r(3), Hr = Math.min(Hh - 0.15, sLo + 0.45);
      let zF = 0.10, bk = 0.4, flagsAll = 0, clutter = TY.cl, tagCell = 0, lit = TY.lit * (0.8 + 0.4 * r(4));
      const gl = (cx, cy, cz, w, hh, yaw, flags) => { if (w < 0.08 || hh < 0.08) return; tile.glass.push(fi, cx, cy, cz, w, hh, yaw, W, Hr, D, rot, TY.id, seed, lit, flags | flagsAll, P.oppD, P.oppH, pack(P.oppC), P.kd, TY.fr + 8 * TY.mr, zF, bk, sLo, TY.back, TY.floor, clutter, (flags & 1) ? tagCell : 0); };
      const pull = (hx, y0, zd, brass) => { bx(0, hx - 0.016, hx + 0.016, y0 + 0.85, y0 + 1.35, zd + 0.075, zd + 0.105, K.PLAIN, brass ? BRASS : CHROME, 0.25, 1, 0.2, seed); bx(0, hx - 0.012, hx + 0.012, y0 + 0.9, y0 + 0.925, zd + 0.03, zd + 0.08, K.PLAIN, brass ? BRASS : CHROME, 0.25, 1, 0, seed); bx(0, hx - 0.012, hx + 0.012, y0 + 1.28, y0 + 1.305, zd + 0.03, zd + 0.08, K.PLAIN, brass ? BRASS : CHROME, 0.25, 1, 0, seed); };
      // a glazed door with its frame: leaves between dl and dr at depth zd, standing on a step of height st
      const door = (dl, dr, zd, st, dbl, brass, hTop) => {
        const dh = 2.15 + st;
        bx(0, dl, dr, 0, sLo, 0, 0.03, K.PLAIN, DARK, 0.8, 0, 0, seed);
        F(0, dl, dl + 0.06, 0, hTop, zd - 0.04, zd + 0.07); F(0, dr - 0.06, dr, 0, hTop, zd - 0.04, zd + 0.07); F(0, dl, dr, dh, dh + 0.07, zd - 0.04, zd + 0.07); F(0, dl, dr, hTop - 0.05, hTop, zd - 0.04, zd + 0.07);
        gl((dl + dr) / 2, (dh + 0.07 + hTop - 0.05) / 2, zd, dr - dl - 0.12, hTop - 0.05 - dh - 0.07, 0, 8);
        const leaves = dbl ? [[dl + 0.06, (dl + dr) / 2, 1], [(dl + dr) / 2, dr - 0.06, -1]] : [[dl + 0.06, dr - 0.06, r(30) < 0.5 ? 1 : -1]];
        for (const [la, lb, side] of leaves) {
          F(0, la, la + 0.075, st + 0.01, dh, zd - 0.02, zd + 0.035); F(0, lb - 0.075, lb, st + 0.01, dh, zd - 0.02, zd + 0.035); F(0, la, lb, dh - 0.10, dh, zd - 0.02, zd + 0.035);
          if (r(31) < 0.55) bx(0, la, lb, st + 0.01, st + 0.27, zd - 0.02, zd + 0.04, K.PLAIN, brass ? BRASS : [0.50, 0.51, 0.52], 0.32, 1, 0.9, seed); else F(0, la, lb, st + 0.01, st + 0.27, zd - 0.02, zd + 0.035);
          gl((la + lb) / 2, (st + 0.27 + dh - 0.10) / 2, zd, lb - la - 0.15, dh - 0.10 - st - 0.27, 0, 4);
          pull(side > 0 ? lb - 0.13 : la + 0.13, st, zd, brass);
        }
      };
      const stepTile = [0.30 + 0.2 * r(6), 0.29 + 0.18 * r(6), 0.27 + 0.15 * r(6)];

      if (P.role === 'service' || P.role === 'dock') {
        so(x0, x1, 0.16);
        bx(1, x0, x1, 0, sHi, 0, 0.10, K.MAS, mul(baseCol, 0.92), mas === 3 ? 3 : (r(5) < 0.5 ? 1 : mas), 0, 0, seed);
        if (P.role === 'dock') {
          const gw = Math.min(W - 0.5, 3.4), gt = Math.min(sLo - 0.05, 3.5);
          bx(1, -gw / 2, gw / 2, 0, gt - 0.3, 0.10, 0.16, K.GATE, mix3([0.30, 0.31, 0.32], [0.12, 0.2, 0.3], r(7) < 0.3 ? 1 : 0), 0.11, 0, 0, seed);
          bx(1, -gw / 2 - 0.08, gw / 2 + 0.08, gt - 0.3, gt, 0.10, 0.34, K.PLAIN, STEEL, 0.5, 0.6, 1, seed);
          for (const s of [-1, 1]) { bx(0, s * (gw / 2 + 0.05) - 0.05, s * (gw / 2 + 0.05) + 0.05, 0, gt - 0.3, 0.10, 0.22, K.PLAIN, STEEL, 0.5, 0.6, 1, seed); bx(0, s * (gw / 2 + 0.32) - 0.08, s * (gw / 2 + 0.32) + 0.08, 0, 1.05, 0.34, 0.50, K.PLAIN, [0.62, 0.45, 0.03], 0.5, 0, 1, seed); bx(0, s * (gw / 2 + 0.32) - 0.085, s * (gw / 2 + 0.32) + 0.085, 0.62, 0.78, 0.335, 0.505, K.PLAIN, DARK, 0.5, 0, 1, seed); }
          bx(0, -0.3, 0.3, gt + 0.12, gt + 0.72, 0.10, 0.125, K.SIGN, [0.6, 0.6, 0.57], 130, 0, pack([0.5, 0.03, 0.03]), seed);
        } else {
          const dxs = (r(8) - 0.5) * Math.max(0, W - 1.6);
          if (W > 1.3) { bx(0, dxs - 0.56, dxs + 0.56, 0, 2.2, 0.10, 0.16, K.PLAIN, STEEL, 0.5, 0.5, 1, seed); bx(0, dxs - 0.48, dxs + 0.48, 0.02, 2.12, 0.10, 0.14, K.PLAIN, PAINT[Math.floor(r(9) * PAINT.length)], 0.55, 0.2, 1, seed); bx(0, dxs + 0.34, dxs + 0.40, 0.95, 1.12, 0.14, 0.2, K.PLAIN, CHROME, 0.3, 1, 0, seed); }
          if (W > 3.2) { const vx = dxs > 0 ? x0 + 0.9 : x1 - 0.9; bx(0, vx - 0.6, vx + 0.6, 2.35, 3.0 > sLo ? sLo : 3.0, 0.10, 0.14, K.GATE, [0.28, 0.29, 0.30], 0.05, 0, 0, seed);
            bx(0, vx - 0.2, vx + 0.2, 0.55, 0.78, 0.10, 0.2, K.PLAIN, r(10) < 0.5 ? [0.45, 0.03, 0.02] : BRASS, 0.4, r(10) < 0.5 ? 0 : 1, 0.6, seed); for (const s of [-1, 1]) bx(0, vx + s * 0.1 - 0.045, vx + s * 0.1 + 0.045, 0.62, 0.71, 0.2, 0.27, K.PLAIN, BRASS, 0.35, 1, 0.5, seed); }
        }
        continue;
      }
      if (P.role === 'entry') {
        so(x0, x1, 0.12);
        bx(1, x0, x1, sLo, sHi, 0, 0.12, K.MAS, baseCol, ...masP);
        const st = r(11) < 0.6 ? 0.14 : 0.03, wood = r(12) < 0.5, dc = wood ? [0.075, 0.036, 0.018] : PAINT[Math.floor(r(13) * PAINT.length)], dl = -0.52, dr = 0.52;
        bx(0, x0, x1, 0, sLo, 0, 0.04, K.PLAIN, DARK, 0.8, 0, 0, seed); bx(0, x0 - 0.05, x1 + 0.05, 0, st, 0, 0.5, K.TILE, [0.33, 0.31, 0.28], 0.6, 0, 0, seed);
        F(0, x0, dl, 0, sLo, 0.03, 0.12); F(0, dr, x1, 0, sLo, 0.03, 0.12); F(0, dl, dr, 2.15 + st, 2.23 + st, 0.03, 0.12);
        bx(0, dl, dr, st + 0.01, 2.15 + st, 0.04, 0.09, wood ? K.WOOD : K.PLAIN, dc, 0.55, 0, 1, seed);
        lit = 0.15; gl(0, st + 1.55, 0.095, 0.5, 0.75, 0, 0); gl(0, (2.23 + st + sLo) / 2, 0.06, dr - dl, sLo - 2.23 - st, 0, 8);
        bx(0, 0.36, 0.40, st + 0.95, st + 1.12, 0.09, 0.15, K.PLAIN, BRASS, 0.3, 1, 0, seed); bx(0, x0 - 0.22, x0 - 0.06, 1.3, 1.62, pproud, pproud + 0.04, K.PLAIN, [0.45, 0.46, 0.47], 0.35, 0.9, 0.5, seed);
        continue;
      }
      if (P.role === 'gate') {
        so(x0, x1, 0.17);
        const gc = r(14) < 0.6 ? [0.17, 0.175, 0.18] : mul(PAINT[Math.floor(r(15) * PAINT.length)], 0.8);
        bx(1, x0, x1, 0, sLo - 0.28, 0.06, 0.13, K.GATE, gc, 0.075, 0, 0, seed); bx(1, x0, x1, sLo - 0.28, sLo, 0.04, 0.3, K.PLAIN, STEEL, 0.5, 0.6, 1, seed);
        F(0, x0, x0 + 0.07, 0, sLo - 0.28, 0.05, 0.17); F(0, x1 - 0.07, x1, 0, sLo - 0.28, 0.05, 0.17);
      }
      // ---- the glazed front: shop, lobby, vacant
      const isLobby = P.role === 'lobby', modern = style === 2 || (style === 3 && r(16) < 0.5) || isLobby;
      const brass = isLobby || TY === T.bank || TY === T.jewelry ? r(17) < 0.7 : r(17) < 0.15;
      if (P.role !== 'gate') {
        bk = modern ? 0.12 + 0.1 * r(18) : 0.36 + 0.36 * r(18);
        const dbl = isLobby || TY.dbl || (W > 6.8 && r(19) < 0.5), dw = Math.min(dbl ? 1.86 : 1.02, W - 0.1);
        const rec = !isLobby && W > dw + 2.6 && r(20) < (style === 0 || style === 4 ? 0.55 : 0.28);
        zF = rec ? pproud + 0.14 : 0.10; const zd = rec ? 0.08 : zF;
        let dxc = isLobby || r(21) < 0.35 ? 0 : (r(22) < 0.5 ? -1 : 1) * (W / 2 - dw / 2 - (r(23) < 0.5 ? 0.02 : 0.9)); if (W < dw + 1.2) dxc = (r(22) < 0.5 ? -1 : 1) * (W - dw) / 2;
        dxc = Math.max(x0 + dw / 2, Math.min(x1 - dw / 2, dxc));
        const dl = dxc - dw / 2, dr = dxc + dw / 2, st = !modern && (style === 0 || style === 4) && r(24) < 0.4 ? 0.14 : 0.025;
        if (rec) { so(x0, dl, dl - x0 > 0.12 ? zF + 0.085 : zd + 0.07); so(dl, dr, zd + 0.07); so(dr, x1, x1 - dr > 0.12 ? zF + 0.085 : zd + 0.07); } else so(x0, x1, zF + 0.085);     // the glass line; a set-back door stays a closed door at the back of its recess
        if (isLobby) for (const s of [-1, 1]) so(s * (dw / 2 + 0.2) - 0.2, s * (dw / 2 + 0.2) + 0.2, pproud + 0.08);
        if (P.role === 'vacant') { flagsAll = r(25) < 0.6 ? 2 : 0; clutter = 0; tagCell = r(26) < 0.7 ? 131 : 0; }
        else if (!isLobby && r(27) < 0.6) tagCell = 200 + TY.g;
        const bkKind = r(28), bkCol = bkKind < 0.3 ? mul(fc[0], 1.0) : (bkKind < 0.55 ? [0.07 + 0.3 * r(29), 0.07 + 0.25 * r(29), 0.07 + 0.2 * r(29)] : (bkKind < 0.8 ? mul(baseCol, 0.9) : [0.5, 0.5, 0.48]));
        for (const [sa, sb] of [[x0, dl], [dr, x1]]) {
          if (sb - sa < 0.12) continue;
          if (bkKind < 0.3) bx(1, sa, sb, 0, bk, 0, zF + 0.05, K.PLAIN, bkCol, fc[1], fc[2], 1, seed); else if (bkKind < 0.55) bx(1, sa, sb, 0, bk, 0, zF + 0.05, K.TILE, bkCol, r(32) < 0.5 ? 0.1 : 0.15, r(33) < 0.25 ? 1 : 0, 0, seed);
          else bx(1, sa, sb, 0, bk, 0, zF + 0.05, K.MAS, bkCol, bkKind < 0.8 || bk < 0.5 ? (mas === 3 ? 3 : 2) : 0, 0, 0, seed);
          F(0, sa, sb, bk, bk + 0.05, zF - 0.05, zF + 0.085); F(0, sa, sb, sLo - 0.06, sLo, zF - 0.05, zF + 0.07);
          const np = Math.max(1, Math.round((sb - sa) / 1.7));
          for (let k = 0; k <= np; k++) { const mx = sa + (sb - sa) * k / np; F(0, Math.max(sa, mx - 0.028), Math.min(sb, mx + 0.028), bk, sLo, zF - 0.05, zF + 0.07); }
          if (sLo > 3.25 && !modern) F(0, sa, sb, 2.5, 2.555, zF - 0.04, zF + 0.06);
          gl((sa + sb) / 2, (bk + sLo) / 2, zF, sb - sa, sLo - bk, 0, 1);
          if (rec) bx(0, sa, sb, sLo - 0.02, sLo + 0.02, 0, zF + 0.06, K.PLAIN, fc[0], fc[1], fc[2], 1, seed);
        }
        // the door bay
        bx(0, dl - 0.02, dr + 0.02, 0, st, 0, zF + (st > 0.1 ? 0.32 : 0.06), K.TILE, stepTile, r(34) < 0.5 ? 0.05 : 0.3, r(35) < 0.2 ? 1 : 0, 0, seed);
        door(dl, dr, zd, st, dbl, brass, sLo);
        if (rec) {
          const zc = (zd + zF) / 2, rl = zF - zd;
          if (dl - x0 > 0.12) { gl(dl, (bk + sLo) / 2, zc, rl, sLo - bk, Math.PI / 2, 0); bx(0, dl - 0.1, dl, 0, bk, zd, zF, K.PLAIN, bkCol, 0.6, 0, 1, seed); F(0, dl - 0.03, dl + 0.03, bk, sLo, zF - 0.02, zF + 0.07); } else F(0, dl - 0.06, dl, 0, sLo, zd, zF);
          if (x1 - dr > 0.12) { gl(dr, (bk + sLo) / 2, zc, rl, sLo - bk, -Math.PI / 2, 0); bx(0, dr, dr + 0.1, 0, bk, zd, zF, K.PLAIN, bkCol, 0.6, 0, 1, seed); F(0, dr - 0.03, dr + 0.03, bk, sLo, zF - 0.02, zF + 0.07); } else F(0, dr, dr + 0.06, 0, sLo, zd, zF);
          bx(0, dl, dr, sLo - 0.05, sLo, zd, zF + 0.05, K.PLAIN, [0.5, 0.49, 0.46], 0.7, 0, 1, seed);
        }
        if (isLobby) {                                  // a portal round the doors and, where the dressing layer has no fabric canopy, a marquee
          const pc = style === 2 ? [0.20, 0.21, 0.22] : mul(baseCol, 1.08), pk = style === 2 ? 3 : 0;
          for (const s of [-1, 1]) bx(1, s * (dw / 2 + 0.2) - 0.2, s * (dw / 2 + 0.2) + 0.2, 0, sLo, 0, pproud + 0.08, K.MAS, pc, pk, 0, 0, seed);
          if (!dressCanopy && !shed && P.kd > 3) { const out = Math.min(P.kd - 0.9, 2.6), mw = dw / 2 + 0.9; bx(1, -mw, mw, 2.72, 2.92, 0.1, out, K.PLAIN, style === 2 ? [0.06, 0.06, 0.065] : [0.10, 0.08, 0.05], 0.4, 0.7, 1, seed); bx(0, -mw - 0.02, mw + 0.02, 2.90, 2.96, 0.1, out + 0.02, K.PLAIN, brass ? BRASS : CHROME, 0.3, 1, 0.6, seed);
            for (const s of [-1, 1]) bc(0, s * (mw - 0.2), 2.94 + (sLo - 2.94) / 2, out * 0.45, 0.025, Math.hypot(sLo - 2.94, out * 0.9), 0.025, 0, -Math.atan2(out * 0.9, sLo - 2.94), K.PLAIN, STEEL, 0.4, 0.9, 0, seed); }
        }
        stats.shops++;
        if (P.role === 'shop') shops.push({ x: +P.x.toFixed(2), y: +P.y.toFixed(2), h: +rot.toFixed(4), nx: +P.nx.toFixed(4), ny: +P.ny.toFixed(4), w: +W.toFixed(2), kerb: +P.kd.toFixed(2), out: +Math.max(zF + 0.1, pproud).toFixed(2), door: +dxc.toFixed(2), type: TY.name, food: ['deli', 'diner', 'pizza', 'bar', 'cafe'].includes(TY.name), stand: !!(TY.out && P.kd - zF > 3.3 && r(59) < 0.75), shed });
      }
      // ---- sign fascia
      const zs = zF > 0.2 ? zF + 0.04 : pproud + 0.02, sx0 = x0, sx1 = x1;
      if (isLobby) { bx(1, x0, x1, sLo, sHi, 0, zs, K.MAS, baseCol, ...masP); bx(1, -0.5, 0.5, sLo + 0.12, sHi - 0.1, zs, zs + 0.02, K.SIGN, style === 2 ? [0.05, 0.05, 0.055] : mul(baseCol, 0.9), 120 + Math.floor(r(40) * 8), 3, 0, seed); continue; }
      let sgn = 5;
      if (P.role !== 'vacant') { const w = TY.sg, tot = w[0] + w[1] + w[2] + w[3] + w[4]; let q = r(41) * tot; for (sgn = 0; sgn < 4 && q >= w[sgn]; sgn++) q -= w[sgn]; }
      const canAwn = !shed && P.kd - zs > 2.5 && style !== 2;
      if (sgn === 4 && !canAwn) sgn = r(42) < 0.5 ? 0 : 1;
      const cell = TY.g >= 0 ? TY.g * 5 + Math.floor(r(43) * 5) : 0;
      const pal = SIGNPAL[Math.floor(r(44) * SIGNPAL.length)], fasc = r(45) < 0.45 ? mul(fc[0], 1.0) : (r(45) < 0.7 ? [0.03, 0.03, 0.033] : mul(baseCol, 0.9));
      stats.signs[sgn] = (stats.signs[sgn] || 0) + 1;
      if (sgn === 0) { bx(1, sx0, sx1, sLo, sHi, 0, zs, K.PLAIN, mul(pal[0], 0.8), 0.6, 0, 1, seed); bx(1, sx0 + 0.04, sx1 - 0.04, sLo + 0.05, sHi - 0.05, zs, zs + 0.035, K.SIGN, pal[0], cell, 0, pack(pal[1]), seed); }
      else if (sgn === 1) { const lc = r(46) < 0.5 ? [0.78, 0.78, 0.76] : (r(46) < 0.75 ? pal[0] : [0.75, 0.05, 0.04]); const fb = (lc[0] + lc[1] + lc[2]) > 1.2 && (fasc[0] + fasc[1] + fasc[2]) > 0.9 ? [0.04, 0.04, 0.045] : fasc;
        bx(1, sx0, sx1, sLo, sHi, 0, zs, K.PLAIN, fb, 0.6, 0.1, 1, seed); bx(1, sx0 + 0.15, sx1 - 0.15, sLo + 0.1, sHi - 0.1, zs, zs + 0.03, K.SIGN, fb, cell, 1, pack(lc), seed); }
      else if (sgn === 2) { const lb = LIGHTBOX[Math.floor(r(47) * LIGHTBOX.length)]; bx(1, sx0, sx1, sLo, sHi, 0, zs, K.PLAIN, fasc, 0.6, 0, 1, seed); bx(1, sx0 + 0.05, sx1 - 0.05, sLo + 0.02, sHi - 0.03, zs, zs + 0.2, K.SIGN, lb[0], cell, 2, pack(lb[1]), seed); }
      else if (sgn === 3) { const stone = r(48) < 0.5 && mas !== 3; bx(1, sx0, sx1, sLo, sHi, 0, zs, stone ? K.MAS : K.PLAIN, stone ? mul(baseCol, 1.05) : [0.025, 0.025, 0.03], stone ? 2 : 0.5, 0, 1, seed); bx(1, sx0 + 0.3, sx1 - 0.3, sLo + 0.16, sHi - 0.16, zs, zs + 0.012, K.SIGN, stone ? mul(baseCol, 1.05) : [0.025, 0.025, 0.03], cell, 3, 0, seed); }
      else bx(1, sx0, sx1, sLo, sHi, 0, zs, K.PLAIN, sgn === 5 ? mul(fasc, 0.8) : fasc, 0.7, 0, 1, seed);
      // awning: the sign itself (lettered valance), or a plain one under the sign
      const under = sgn !== 4 && canAwn && P.role !== 'vacant' && r(49) < 0.5 && sLo - 2.2 >= 0.5;
      if (sgn === 4 || under) {
        const ya = sgn === 4 ? sHi - 0.04 : sLo - 0.02, drop = Math.min(sgn === 4 ? 1.25 : 0.9, ya - 2.18), proj = Math.min(P.kd - zs - 1.3, 1.0 + 0.9 * r(50));
        if (drop > 0.4 && proj > 0.5) { const col = AWNCOL[Math.floor(r(51) * AWNCOL.length)], stripes = r(52) < 0.16, lum = col[0] + col[1] + col[2];
          awn(0, ya, zs + 0.01, W - 0.02, drop, proj, col, cell, (stripes ? 1 : 0) + (r(53) < 0.5 ? 2 : 0) + (sgn === 4 && r(54) < 0.4 && !stripes ? 4 : 0), lum > 0.7 ? [0.03, 0.03, 0.035] : [0.82, 0.80, 0.74], seed);
          for (const s of [-1, 1]) bc(0, s * (W / 2 - 0.03), ya - drop * 0.7, zs + proj / 2, 0.022, 0.022, proj, 0, 0, K.PLAIN, STEEL, 0.4, 0.9, 0, seed); }
      }
      // blade sign on the pier
      if (!shed && P.role === 'shop' && r(55) < 0.4 && P.kd > 3) { const bp = SIGNPAL[Math.floor(r(56) * SIGNPAL.length)], yb = Math.min(sHi - 0.35, 3.3), xb2 = r(57) < 0.5 ? x0 - 0.05 : x1 + 0.05, lb = r(58) < 0.3;
        bc(1, xb2, yb, pproud + 0.5, 0.72, 0.62, 0.07, Math.PI / 2, 0, K.SIGN, bp[0], 100 + TY.g, lb ? 2 : 0, pack(bp[1]), seed); bc(0, xb2, yb + 0.36, pproud + 0.45, 0.025, 0.025, 0.95, 0, 0, K.PLAIN, DARK, 0.5, 0.6, 0, seed); }
      // goods on the sidewalk
      if (TY.out && P.role === 'shop' && P.kd - zF > 3.3 && r(59) < 0.75) {
        const left = r(60) < 0.5; let sa = left ? x0 + 0.1 : Math.max(x0 + 0.1, x1 - 3.4), sb = Math.min(sa + 3.3, x1 - 0.1);
        if (sb - sa > 1.4) { const cxs = (sa + sb) / 2, len = sb - sa, green = [0.02, 0.07, 0.035];
          if (TY.out === 'produce') { bx(0, sa, sb, 0, 0.42, zF + 0.08, zF + 1.02, K.WOOD, green, 0, 0, 0, seed); for (let t = 0; t < 2; t++) bc(0, cxs, 0.86 - 0.3 * t, zF + 0.36 + 0.46 * t, len, 0.13, 0.52, 0, 0.36, K.PRODUCE, [0.28, 0.18, 0.09], 0, 0, 0, seed + t); bx(0, sa, sb, 0.42, 0.52, zF + 0.08, zF + 0.5, K.WOOD, green, 0, 0, 0, seed); }
          else for (let t = 0; t < 3; t++) { const yt = 0.12 + 0.2 * (2 - t), z0 = zF + 0.1 + 0.3 * t; bx(0, sa, sb, 0, yt, z0 - 0.02, z0 + 0.3, K.PLAIN, [0.025, 0.03, 0.025], 0.6, 0, 1, seed);
            for (let xq = sa + 0.04, q = 0; xq + 0.26 < sb; xq += 0.3, q++) { const rq = rnd(bid, P.key + 3000 + t, q); if (rq < 0.12) continue; const hb = 0.26 + 0.1 * rq, wf = 0.3 + 0.14 * rnd(bid, P.key + 3100 + t, q);
              bx(0, xq + 0.02, xq + 0.24, yt, yt + hb, z0 + 0.02, z0 + 0.24, K.PLAIN, rq < 0.5 ? [0.02, 0.02, 0.022] : [0.30, 0.31, 0.32], 0.5, rq < 0.5 ? 0 : 0.8, 1, seed); tile.bq.push(fi, xq + 0.13, yt + hb - 0.03, z0 + 0.13, wf * 1.5, wf * 1.5, wf * 1.5, rq * 6.28, 0, K.BOUQUET, ...FLOWERS[Math.floor(rnd(bid, P.key + 3200 + t, q) * FLOWERS.length)], 0, 0.3 + 0.5 * rnd(bid, P.key + 3300 + t, q), 0, rq); } }
        }
      }
    }
    // ---- the solid line of each wall segment: the outermost drawn face at every point along it, runs of one depth joined
    for (const { P, iv } of solG.values()) {
      const cut = []; for (let i = 0; i < iv.length; i += 3) cut.push(iv[i], iv[i + 1]); cut.sort((a, b2) => a - b2);
      let ua = 0, za = -1; const out = (ub) => { if (za > 0 && ub - ua > 0.01) solid.push(P.ox + P.dx * ua + P.nx * za, P.oy + P.dy * ua + P.ny * za, P.ox + P.dx * ub + P.nx * za, P.oy + P.dy * ub + P.ny * za); };
      for (let k = 0; k + 1 < cut.length; k++) { const a = cut[k], b2 = cut[k + 1]; if (b2 - a < 1e-4) continue; const m = (a + b2) / 2; let z = -1; for (let i = 0; i < iv.length; i += 3) if (iv[i] < m && iv[i + 1] > m && iv[i + 2] > z) z = iv[i + 2];
        if (Math.abs(z - za) > 1e-3) { out(a); ua = a; za = z; } }
      if (cut.length) out(cut[cut.length - 1]);
    }
  });
  return { tiles, frames, stats, shops, solid };
}

// ------------------------------------------------------------------------------------------------ meshes
function awningGeometry() {
  const P = [], N = [], U = [], I = []; const quad = (a, b, c, d, n, uv) => { const k = P.length / 3; for (const v of [a, b, c, d]) { P.push(...v); N.push(...n); } U.push(...uv); I.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const s = Math.hypot(1, 0.7);
  quad([-0.5, 0, 0], [-0.5, -0.7, 1], [0.5, -0.7, 1], [0.5, 0, 0], [0, 1 / s, 0.7 / s], [0, 1, 0, 0, 1, 0, 1, 1]);
  quad([-0.5, -1, 1], [0.5, -1, 1], [0.5, -0.7, 1], [-0.5, -0.7, 1], [0, 0, 1], [0, 2, 1, 2, 1, 3, 0, 3]);
  for (const x of [-0.5, 0.5]) { const n = [x * 2, 0, 0];
    quad([x, -0.7, 0.35], [x, -0.7, 1], [x, 0, 0], [x, 0, 0], n, [0.35, 4.3, 1, 4.3, 0, 5, 0, 5]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
}
function bouquetGeometry() {            // a bunch: leaves low and outside, blooms high, in an opening cone 1 m tall
  const P = [], N = [], U = [], I = []; let a = 12345; const R = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  for (let i = 0; i < 80; i++) { const hgt = 0.12 + 0.5 * Math.pow(R(), 0.6), ang = R() * 6.283, rad = (0.05 + 0.3 * hgt) * Math.sqrt(R()) * 1.2, c = [Math.cos(ang) * rad, hgt, Math.sin(ang) * rad], sz = 0.035 + 0.035 * R();
    const n = new THREE.Vector3(Math.cos(ang) * (0.3 + R()), 0.5 + R(), Math.sin(ang) * (0.3 + R())).normalize(), t = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).cross(n).normalize(), b = new THREE.Vector3().crossVectors(n, t), k = P.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { P.push(c[0] + (t.x * (u - 0.5) + b.x * (v - 0.5)) * sz * 2, c[1] + (t.y * (u - 0.5) + b.y * (v - 0.5)) * sz * 2, c[2] + (t.z * (u - 0.5) + b.z * (v - 0.5)) * sz * 2); N.push(n.x, n.y, n.z); U.push(i + u * 0.9, v); }
    I.push(k, k + 1, k + 2, k, k + 2, k + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
}
async function detailArrays(A) {
  const names = ['stone', 'brick', 'paint', 'shutter'], S = 1024, mk = () => new Uint8Array(S * S * 4 * names.length), dD = mk(), dN = mk(), means = [];
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < names.length; i++) for (const [suf, dst] of [['_d', dD], ['_n', dN]]) {
    const r = await fetch(A + 'storefronts/tex/' + names[i] + suf + '.jpg'); if (!r.ok) throw new Error('storefront texture missing: ' + names[i] + suf);
    g.drawImage(await createImageBitmap(await r.blob()), 0, 0, S, S); const px = g.getImageData(0, 0, S, S).data; dst.set(px, i * S * S * 4);
    if (suf === '_d') { const m = [0, 0, 0]; let n = 0; for (let k = 0; k < px.length; k += 4 * 37) { for (let q = 0; q < 3; q++) { const v = px[k + q] / 255; m[q] += v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } n++; } means.push(new THREE.Vector3(m[0] / n, m[1] / n, m[2] / n)); }
  }
  const tx = (data, srgb) => { const t = new THREE.DataArrayTexture(data, S, S, names.length); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return { tDet: tx(dD, true), tDetN: tx(dN, false), means };
}
function solidMaterial(shared, tMask, double, det) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide }); m.shadowSide = THREE.DoubleSide;
  const bake = FAC.BAKE_LIGHT_GLSL || '';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSunColor: shared.uSunColor, uSunDir: shared.uSunDir, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter, tLight: shared.tLight, uHalf: shared.uHalf, tMask: { value: tMask }, tDet: { value: det.tDet }, tDetN: { value: det.tDetN }, uDetMean: { value: det.means } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + G.BOX_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + G.BOX_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + G.BOX_FRAG_PARS)
      .replace('#include <map_fragment>', 'sfSurface(); diffuseColor.rgb = sfAlb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sfRough;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sfMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(normal + (viewMatrix * vec4(sfBump, 0.0)).xyz * (gl_FrontFacing ? 1.0 : -1.0));')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = sfEmis;')
      .replace('#include <aomap_fragment>', `{ vec3 sK = sfBake(vWPos.xz + vOut.xz * 1.1); bakeN = normalize(inverseTransformDirection(normal, viewMatrix)); bakeV = vec3(sK.r * (0.5 + 0.5 * bakeN.y), sK.g, sK.b * 0.6); }\n` + bake);
  };
  m.customProgramCacheKey = () => 'sfSolid10' + (double ? 'd' : '');
  return m;
}
function glassMaterial(shared, tex, tune) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSunColor: shared.uSunColor, uSunDir: shared.uSunDir, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter, tLight: shared.tLight, uHalf: shared.uHalf, tMask: { value: tex.mask }, tRoom: { value: tex.rooms }, tProp: { value: tex.props }, uSf: tune });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + G.GLASS_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + G.GLASS_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + G.GLASS_FRAG_PARS).replace('#include <aomap_fragment>', G.GLASS_FRAG_MAIN);
  };
  m.customProgramCacheKey = () => 'sfGlass11';
  return m;
}

export async function add(game, ctx) {
  const w = game.world, shared = w.shared, C = game.city;
  const hasDressing = !!(game.dressing && game.dressing.meshes && game.dressing.meshes.length);
  const { tiles, frames, stats, shops, solid } = layout(C, { noDressing: !hasDressing });
  const tex = { mask: makeMask(THREE), rooms: makeRooms(THREE), props: makeProps(THREE) };
  const tune = { value: new THREE.Vector4(0.15, 2.8, 0.55, 0.6) };
  const det = await detailArrays(ctx.A); const mSolid = solidMaterial(shared, tex.mask, false, det), mAwn = solidMaterial(shared, tex.mask, true, det), mGlass = glassMaterial(shared, tex, tune);
  const gBox = new THREE.BoxGeometry(1, 1, 1), gAwn = awningGeometry(), gBq = bouquetGeometry(), gPlane = new THREE.PlaneGeometry(1, 1);
  const group = new THREE.Group(); group.name = 'storefronts'; const meshes = []; let inst = 0, tris = 0;
  const mF = new THREE.Matrix4(), mL = new THREE.Matrix4(), mM = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const frameM = (i) => mF.compose(v.set(frames[i * 3], SW, -frames[i * 3 + 1]), q.setFromAxisAngle(up, frames[i * 3 + 2]), s.set(1, 1, 1));
  const share = (g0) => { const g = new THREE.BufferGeometry(); for (const a in g0.attributes) g.setAttribute(a, g0.attributes[a]); g.setIndex(g0.index); return g; };
  const finish = (im, key, far, shadow) => {
    const [ti, tj] = key.split(',').map(Number); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix(); im.castShadow = shadow; im.receiveShadow = true;
    im.userData = { cx: (ti + 0.5) * TILE, cz: -(tj + 0.5) * TILE, r: TILE * 0.7072, far }; group.add(im); meshes.push(im); inst += im.count; tris += im.count * (im.geometry.index.count / 3);
  };
  const solids = (rec, g0, mat, key, far, shadow, name) => {
    const n = rec.length / BOX_STRIDE; if (!n) return; const g = share(g0), col = new Float32Array(n * 4), par = new Float32Array(n * 4), im = new THREE.InstancedMesh(g, mat, n); im.name = name;
    for (let i = 0; i < n; i++) { const o = i * BOX_STRIDE; frameM(rec[o]); e.set(rec[o + 8], rec[o + 7], 0); mL.compose(v.set(rec[o + 1], rec[o + 2], rec[o + 3]), q.setFromEuler(e), s.set(rec[o + 4], rec[o + 5], rec[o + 6])); im.setMatrixAt(i, mM.multiplyMatrices(mF, mL));
      col[i * 4] = rec[o + 10]; col[i * 4 + 1] = rec[o + 11]; col[i * 4 + 2] = rec[o + 12]; col[i * 4 + 3] = rec[o + 9]; par[i * 4] = rec[o + 13]; par[i * 4 + 1] = rec[o + 14]; par[i * 4 + 2] = rec[o + 15]; par[i * 4 + 3] = rec[o + 16]; }
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 4)); g.setAttribute('aPar', new THREE.InstancedBufferAttribute(par, 4)); finish(im, key, far, shadow);
  };
  for (const [key, t] of tiles) {
    solids(t.major, gBox, mSolid, key, FAR_MAJOR, true, 'sf_major'); solids(t.fine, gBox, mSolid, key, FAR_FINE, false, 'sf_fine'); solids(t.awn, gAwn, mAwn, key, FAR_MAJOR, true, 'sf_awn'); solids(t.bq, gBq, mAwn, key, FAR_FINE, false, 'sf_bouquet');
    const rec = t.glass, n = rec.length / GLASS_STRIDE; if (!n) continue;
    const g = share(gPlane), A = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(n * 4)), im = new THREE.InstancedMesh(g, mGlass, n); im.name = 'sf_glass';
    for (let i = 0; i < n; i++) { const o = i * GLASS_STRIDE; frameM(rec[o]); mL.compose(v.set(rec[o + 1], rec[o + 2], rec[o + 3]), q.setFromAxisAngle(up, rec[o + 6]), s.set(rec[o + 4], rec[o + 5], 1)); im.setMatrixAt(i, mM.multiplyMatrices(mF, mL));
      A[0].set([rec[o + 1], rec[o + 2], rec[o + 3], rec[o + 6]], i * 4); for (let k = 0; k < 5; k++) for (let c = 0; c < 4; c++) A[k + 1][i * 4 + c] = rec[o + 7 + k * 4 + c]; }
    A.forEach((a, k) => g.setAttribute('aG' + k, new THREE.InstancedBufferAttribute(a, 4))); finish(im, key, FAR_MAJOR, false);
  }
  // distance bands (once per frame, before the scene is walked)
  const prev = w.scene.onBeforeRender;
  w.scene.onBeforeRender = function (renderer, scene, camera, rt) {
    if (prev) prev.call(this, renderer, scene, camera, rt);
    if (!camera.isPerspectiveCamera) return; const p = camera.position;
    for (const m of meshes) { const u = m.userData; m.visible = Math.max(0, Math.hypot(p.x - u.cx, p.z - u.cz) - u.r) < u.far; }
  };
  w.scene.add(group);
  // what this layer supersedes in the dressing layer: its awnings (ours carry the lettering) and its shopfront piers (ours stand on the same grid)
  const hid = { awnings: 0, piers: 0 };
  if (hasDressing) for (const m of game.dressing.meshes) {
    const k = m.userData && m.userData.kind; if (!k) continue;
    if (k.startsWith('awn_')) { hid.awnings += m.count; m.count = 0; }
    else if (k === 'pier') { const a = m.instanceMatrix.array; for (let i = 0; i < m.count; i++) if (Math.abs(a[i * 16 + 13] - SW) < 0.02) { for (let c = 0; c < 12; c++) a[i * 16 + c] = 0; hid.piers++; } m.instanceMatrix.needsUpdate = true; }
  }
  // collision: the drawn front line into game.statics (see the note at the top). One switch: ?sfsolid=0
  const Q = new URLSearchParams(location.search), sol = { on: Q.get('sfsolid') !== '0', segs: 0, metres: 0, hero: 0, lane: 0 }, solidSegs = [];
  if (sol.on && game.statics && game.statics.addSeg) {
    let polys = [];                                     // hero.js takes this layer's instances off every hero footprint (2.2 m round it): no front drawn, no wall added
    if (Q.get('hero') !== '0' && !(window.__CFG && window.__CFG.hero === false && Q.get('hero') !== '1')) { try { const r = await fetch(ctx.A.replace(/streets\/$/, 'hero/') + 'hero.json'); if (r.ok) polys = (await r.json()).filter((h) => !h.off && h.footprint && h.footprint.length > 2).map((h) => h.footprint); } catch (err) { /* no hero list: every front is solid */ } }
    const onHero = (x, y) => polys.some((P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < 2.2) return true; } return c; });
    const inLane = (x, y) => !!(game.roads && game.roads.inLane && game.roads.inLane(x, y, 0.25));
    for (let i = 0; i < solid.length; i += 4) {
      const L = Math.hypot(solid[i + 2] - solid[i], solid[i + 3] - solid[i + 1]), n = Math.max(1, Math.ceil(L / 6));     // long runs in pieces of 6 m or less, each judged on its own
      for (let k = 0; k < n; k++) { const ax = solid[i] + (solid[i + 2] - solid[i]) * k / n, ay = solid[i + 1] + (solid[i + 3] - solid[i + 1]) * k / n, bx2 = solid[i] + (solid[i + 2] - solid[i]) * (k + 1) / n, by2 = solid[i + 1] + (solid[i + 3] - solid[i + 1]) * (k + 1) / n;
        if (onHero((ax + bx2) / 2, (ay + by2) / 2)) { sol.hero++; continue; }
        if (inLane(ax, ay) || inLane(bx2, by2) || inLane((ax + bx2) / 2, (ay + by2) / 2)) { sol.lane++; continue; }
        game.statics.addSeg(ax, ay, bx2, by2); solidSegs.push(ax, ay, bx2, by2); sol.segs++; sol.metres += L / n; }
    }
    sol.metres = Math.round(sol.metres);
  }
  return { group, meshes, tune, stats, shops, solidSegs, report: { instances: inst, ktris: Math.round(tris / 1000), bays: stats.bays, shops: stats.shops, kinds: stats.kinds, signs: stats.signs, hid, solid: Object.assign(sol, { cornersHeldBack: stats.solidCut }) } };
}
