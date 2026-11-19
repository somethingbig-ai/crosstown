// subway/build.js: one station's underground as a handful of merged meshes, from its layout in subway.json (floor rects + things).
// Everything is unlit: the light of the lamps (and the daylight down an open stair) is worked out here per vertex and stored in the vertex colours.
// buildStation is a generator: it yields between pieces so the caller can spread the work over frames.
// Map (x, y, z up) -> scene (x, z, -y).
import { Walk } from './walk.js';

export const K = 0.30;            // scene units of a white surface right under a station lamp (daylight on the street is about 0.3 to 0.8).
// Pass 2 (Nov 17/18) tried K up to 1.8 so that the game's exposure meter would close down and its local tone step (world.js ltmLo 1.5 / ltmHi 2.0) stay off underground. On stills through
// the game's own tone curve the station at 0.30 (the meter stands at its cap of 4: a little under-exposed, dim like the photographs) looked MORE like the photos than the metered one, and
// a higher K needs the train, the clocks and every self-lit thing to follow. So K stays 0.30; `depth()` below (a ramp from K0 at the stair head to K) is inert while K = K0.
const K0 = 0.30;                  // the level at the head of a street stair, where the underground meets daylight: as before (the light rises from K0 to K between the stair head and 9 m past its foot)
const DAY = 1.5;                  // the sky down an open stair, in lamp units, at the top
const CELL = 1.25;                // largest side of a lit patch (m)
const LAMP = [1.0, 0.98, 0.935], SKY = [0.86, 0.93, 1.0];      // (pass 2: cooler tubes, was 1 0.965 0.88: the film pass's saturation turned every wall cream)
const BEAM = [0.5, 0.48, 0.46];   // ceiling beams: dark paint over the cream (the photos' ceilings are bays of pale panel between dark steel)
const TUBE = 12;                  // a lit tube, in units of a white wall right under it

class Bucket {
  constructor(mat) { this.mat = mat; this.p = []; this.u = []; this.c = []; this.i = []; this.n = 0; }
  v(x, y, z, u, v, r, g, b) { this.p.push(x, z, -y); this.u.push(u, v); this.c.push(r, g, b); return this.n++; }
  mesh(THREE, name) { if (!this.n) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); const m = new THREE.Mesh(g, this.mat); m.name = name; m.matrixAutoUpdate = false; m.castShadow = false; m.receiveShadow = false; return m; }
}

// Nov 17: the pauses were by count (every 6 floors, 3 flights, 40 things); a sign or a name tablet painted between two pauses took 50 ms and more, and the piece ran to 80 ms in one frame while
// he rode toward the station. Now a pause is due after 2.5 ms of work, whatever the piece (by count as before where there is no clock: node).
const due = (n, every) => { if (!due.now) return n % every === 0; if (due.t === undefined) due.t = due.now(); return due.now() - due.t >= 2.5; }; due.now = typeof performance !== 'undefined' && performance.now ? () => performance.now() : null;
export function* buildStation(THREE, S, meta, look, opts = {}) { due.t = due.now ? due.now() : undefined;
  const walk = new Walk(meta); walk.a = (S.frame && S.frame.a) || 0;      /* nav.js lays its lattice along the station */
  const B = new Map(), M = look.mat, group = new THREE.Group(); group.name = 'subway_' + S.id;
  // two parts: 'well' (street stairs, landings, passages: drawn whenever the station is loaded, they are what is seen from the street) and 'core' (the rest: only drawn when someone is down there)
  const gates = []; let special = null; let part = 'core'; const BW = new Map(), bk = (mat) => { if (special) return special; const T = part === 'well' ? BW : B; let b = T.get(mat); if (!b) T.set(mat, (b = new Bucket(mat))); return b; };
  const F0 = S.frame || { x: S.floors[0].x, y: S.floors[0].y, a: S.floors[0].a }, fca = Math.cos(F0.a), fsa = Math.sin(F0.a);
  const sOf = (x, y) => (x - F0.x) * fca + (y - F0.y) * fsa, tOf = (x, y) => -(x - F0.x) * fsa + (y - F0.y) * fca;
  const zM = meta.zM, zP = meta.zP, hM = meta.hM, hP = meta.hP, rise = meta.rise, zW = meta.zWalk;
  // things that differ only in place come packed as one record with xy = [x, y, x, y, ...] (subway.json since v3)
  const THINGS = []; for (const t of S.things || []) { if (t.xy) for (let i = 0; i < t.xy.length; i += 2) THINGS.push({ ...t, x: t.xy[i], y: t.xy[i + 1] }); else THINGS.push(t); }
  for (const f of S.floors) walk.addFloor(f);
  const SQ = (S.line === '6av' || S.line === '8av' || S.line === 'bway') && !look.plain && !!M.tileSq, TL = SQ ? M.tileSq : M.tile, zTile = zP + 3.02;      // 1930s lines: square tiles in a plain grid; on the platforms the tile stops at 3 m, painted wall above

  let bandM; const bandMat = () => { if (bandM === undefined) { bandM = null; try { if (look.band && !look.plain) { bandM = SQ ? look.band({ color: S.color, style: 'sq' }) : look.band({ color: S.color, h: 0.25 }); bandM.side = 2; bandM.fog = false; } } catch (e) { bandM = null; } } return bandM; };
  // pass 2: the station's wall art (look.wallArt: one atlas) and a framed poster on a wall seen along its outward normal (nx, ny) from inside the room
  let WAm; const wallArtOf = () => { if (WAm === undefined) { WAm = null; try { if (look.wallArt && !look.plain) { WAm = look.wallArt(String(S.tablet || S.name || '').split(' ')[0] || 'ST', (S.id || '').length); WAm.material.side = 2; WAm.material.fog = false; } } catch (e) { WAm = null; } } return WAm; };
  let nPost = 0; const posterAt = (mx, my, nx, ny, z0) => { const WA = wallArtOf(); if (!WA) return; const g = WA.reg['p' + (nPost++ % 4)], rx = ny, ry = -nx, w = WA.pw / 2, cx = mx - nx * 0.03, cy = my - ny * 0.03, qx = mx - nx * 0.068, qy = my - ny * 0.068;
    box(M.black, cx, cy, z0 - 0.035, Math.atan2(ry, rx), WA.pw + 0.07, 0.045, WA.ph + 0.07, { flat: 0.09, cell: 3 });
    quad(WA.material, [qx - rx * w, qy - ry * w, z0], [qx + rx * w, qy + ry * w, z0], [qx + rx * w, qy + ry * w, z0 + WA.ph], [qx - rx * w, qy - ry * w, z0 + WA.ph], [g[0], g[1]], [g[2], g[1]], [g[2], g[3]], [g[0], g[3]], { amb: 0.06, cell: 1.2 }); };
  // ---------------------------------------------------------------- the light
  const lamps = [], lg = new Map(), LC = 6;
  const addLamp = (x, y, z, I, reach, col = LAMP) => { const l = { x, y, z, I, reach, col }; lamps.push(l); for (let i = Math.floor((x - 9) / LC); i <= Math.floor((x + 9) / LC); i++) for (let j = Math.floor((y - 9) / LC); j <= Math.floor((y + 9) / LC); j++) { const k = i * 100003 + j; let a = lg.get(k); if (!a) lg.set(k, (a = [])); a.push(l); } };
  for (const t of THINGS) if (t.k === 'lamp') addLamp(t.x, t.y, t.z, t.lvl === 'p' ? 1.9 : 1.5, t.lvl === 'p' ? 6.2 : 3.3);
  const wells = S.floors.filter((f) => f.k === 'street');
  for (const f of wells) { const d = meta.lOpen + 2.2 - f.l / 2; addLamp(f.x + f.ca * d, f.y + f.sa * d, Walk.zAt(f, d) + hM - 0.25, 1.1, 3.4); }      // one lamp under the slab of every street stair
  // tunnel lamps (car look, Nov 14: "tunnel lights stream past the windows"): on both long walls of the track trench beyond the platforms a bare lamp every TL metres
  // at the height of the car's windows (every seventh one blue); each lights its patch of wall, and its bulb is drawn with the tracks below
  const TUN = []; { const TL = 9.2; for (const F of S.floors) { if (F.k !== 'pit' || !S.plen) continue; const ca = Math.cos(F.a), sa = Math.sin(F.a);
      for (const sd of [-1, 1]) { let n = 0; for (let u = -F.l / 2 + 3 + (sd > 0 ? TL / 2 : 0); u < F.l / 2 - 2; u += TL, n++) { const v = sd * (F.w / 2 - 0.035), x = F.x + ca * u - sa * v, y = F.y + sa * u + ca * v; if (Math.abs(sOf(x, y)) <= S.plen / 2 + 9.5) continue;      /* (out of reach of the platforms: the station's own light is not changed) */
          const blue = n % 7 === 3, col = blue ? [0.3, 0.5, 1.0] : [1.0, 0.86, 0.6]; TUN.push({ x, y, z: F.z0 + 2.72, ca, sa, col }); addLamp(x - sd * -sa * 0.7, y - sd * ca * 0.7, F.z0 + 3.0, blue ? 2.4 : 3.4, 3.6, col); } } } }      // (strong: the wall is dark concrete, and the pool of light on it has to show from a passing window)
  const out = [0, 0, 0], KS = K0 / K, sm = (q) => q * q * (3 - 2 * q);
  // how far in from daylight a point is, as a factor on K: K0 / K on the upper part of a street stair, 1 from 9 m past its foot and everywhere on the platform level
  const depth = (x, y, z) => { if (z < zM - 0.5 || !wells.length) return 1; let q = 1; for (const f of wells) { const u = Walk.u(f, x, y) + f.l / 2, v = Math.abs(Walk.v(f, x, y)); let qq; if (u <= f.l && v <= f.w / 2 + 0.6) qq = 0.35 * Math.max(0, u) / f.l; else { const fx = f.x + f.ca * f.l / 2, fy = f.y + f.sa * f.l / 2; qq = 0.35 + 0.65 * Math.min(1, Math.hypot(x - fx, y - fy) / 9); } if (qq < q) q = qq; } return KS + (1 - KS) * sm(q); };
  const light = (x, y, z, nx, ny, nz, amb) => { amb *= 0.6; let r = amb, g = amb, b = amb, dm = 1e9, r0 = r; const a = lg.get(Math.floor(x / LC) * 100003 + Math.floor(y / LC));
    if (a) for (const l of a) { const dz = l.z - z; if (dz < -0.35 || dz > l.reach) continue; const dx = l.x - x, dy = l.y - y, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 81) continue; const d = Math.sqrt(d2) || 1e-3, cs = Math.abs(nx * dx + ny * dy + nz * dz) / d, e = (dz < 0.3 ? l.I * 2.3 * (1.0 / (1 + d2 / 0.9) + 0.1 / (1 + d2 / 6)) : l.I * 1.0 * (0.3 + 0.7 * cs) / (1 + d2 / 6.5)) * (d2 > 49 ? (81 - d2) / 32 : 1); const dh = dx * dx + dy * dy; if (dh < dm) dm = dh; r += e * l.col[0]; g += e * l.col[1]; b += e * l.col[2]; }
    if (dm < 1e8) { const pf = 0.5 + 0.6 * Math.exp(-dm / 7);      /* pass 2: rows of tubes light a station evenly (was 0.22 + 1.03 exp(-dm / 4.5) with a 1 / (1 + d2 / 3) falloff: pools under each lamp, dusk between) */ r = r0 + (r - r0) * pf; g = r0 + (g - r0) * pf; b = r0 + (b - r0) * pf; }
    const dq = depth(x, y, z), sk = KS / dq;
    for (const f of wells) { const u = Walk.u(f, x, y) + f.l / 2, v = Walk.v(f, x, y); if (u < -1 || u > f.l + 5 || Math.abs(v) > 3) continue; const e = sk * DAY * Math.exp(-Math.max(0, zW - z) / 2.4) * (u < meta.lOpen ? 1 : Math.exp(-(u - meta.lOpen) / 1.7)) * (Math.abs(v) > f.w / 2 + 0.1 ? Math.exp(-(Math.abs(v) - f.w / 2) / 0.8) : 1) * (0.55 + 0.45 * Math.abs(nz)); r += e * SKY[0]; g += e * SKY[1]; b += e * SKY[2]; }
    const m = Math.max(r, g, b), k = (m > 1.7 ? 1.7 / m : 1) * K * dq; out[0] = r * k; out[1] = g * k; out[2] = b * k; return out; };

  // ---------------------------------------------------------------- a lit, tessellated quad: corners a b c d (map [x, y, z]) in order, uv at each
  const quad = (mat, a, b, c, d, ua, ub, uc, ud, o = {}) => { const bu = bk(mat), amb = o.amb ?? 0.085;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]; let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const cell = o.cell || CELL, nu = Math.min(160, Math.max(1, Math.ceil(Math.max(Math.hypot(...e1), Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2])) / cell))), nv = Math.min(160, Math.max(1, Math.ceil(Math.max(Math.hypot(...e2), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2])) / cell))), base = bu.n;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const s = i / nu, t = j / nv, w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = s * t, w3 = (1 - s) * t;
      const x = a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, y = a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3, z = a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3;
      let L; if (o.flat !== undefined) { out[0] = out[1] = out[2] = o.flat * (o.raw ? 1 : K * depth(x, y, z)); L = out; } else L = light(x + nx * 0.03 * (o.in || 0), y + ny * 0.03 * (o.in || 0), z, nx, ny, nz, amb); const k = ((o.k || 1) + (o.k1 !== undefined ? (o.k1 - (o.k || 1)) * t : 0)) * (o.kf ? o.kf(x, y) : 1);
      const tn = o.tint; bu.v(x, y, z, ua[0] * w0 + ub[0] * w1 + uc[0] * w2 + ud[0] * w3, ua[1] * w0 + ub[1] * w1 + uc[1] * w2 + ud[1] * w3, L[0] * k * (tn ? tn[0] : 1), L[1] * k * (tn ? tn[1] : 1), L[2] * k * (tn ? tn[2] : 1)); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const p = base + j * (nu + 1) + i; bu.i.push(p, p + 1, p + nu + 2, p, p + nu + 2, p + nu + 1); } };
  // a floor-like quad over a rect's local box [u0, u1] x [v0, v1] at heights z(u): uv in station metres (s, t) so neighbours tile together
  const P = (f, u, v, z) => [f.x + f.ca * u - f.sa * v, f.y + f.sa * u + f.ca * v, z];
  const flatQuad = (mat, f, u0, u1, v0, v1, z, o) => { const a = P(f, u0, v0, z), b = P(f, u1, v0, z), c = P(f, u1, v1, z), d = P(f, u0, v1, z), uv = (p) => [sOf(p[0], p[1]), tOf(p[0], p[1])]; quad(mat, a, b, c, d, uv(a), uv(b), uv(c), uv(d), o); };
  // an upright quad from map point a to b, from height z0 up to z1 (per end if arrays): uv = (metres along, height)
  const wallQuad = (mat, a, b, z0, z1, o = {}) => { const za = Array.isArray(z0) ? z0 : [z0, z0], zb = Array.isArray(z1) ? z1 : [z1, z1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, u0 = o.u0 ?? (a[0] * dx + a[1] * dy) / L, vb = o.v0 ?? 0;
    quad(mat, [a[0], a[1], za[0]], [b[0], b[1], za[1]], [b[0], b[1], zb[1]], [a[0], a[1], zb[0]], [u0, za[0] - vb], [u0 + L, za[1] - vb], [u0 + L, zb[1] - vb], [u0, zb[0] - vb], o); };
  // a box standing on (x, y, z): length l along direction a, width w, height h (5 faces; no bottom)
  const box = (mat, x, y, z, a, l, w, h, o = {}) => { const f = { x, y, ca: Math.cos(a), sa: Math.sin(a) }, c = [P(f, -l / 2, -w / 2, 0), P(f, l / 2, -w / 2, 0), P(f, l / 2, w / 2, 0), P(f, -l / 2, w / 2, 0)];
    for (let i = 0; i < 4; i++) wallQuad(mat, c[i], c[(i + 1) % 4], z, z + h, o); if (!o.noTop) quad(mat, [c[0][0], c[0][1], z + h], [c[1][0], c[1][1], z + h], [c[2][0], c[2][1], z + h], [c[3][0], c[3][1], z + h], [0, 0], [l, 0], [l, w], [0, w], o);
    if (o.bottom) quad(mat, [c[0][0], c[0][1], z], [c[1][0], c[1][1], z], [c[2][0], c[2][1], z], [c[3][0], c[3][1], z], [0, 0], [l, 0], [l, w], [0, w], o.bottom === true ? o : o.bottom); };

  // small-thing helpers (station look, Nov 14): an upright prism over a plan polygon (map points; top = a fan), and an n-sided tube between two map points [x, y, z]
  const prism = (mat, pts, z0, z1, o = {}) => { const n = pts.length; for (let i = 0; i < n; i++) wallQuad(mat, pts[i], pts[(i + 1) % n], z0, z1, o);
    if (!o.noTop) for (let i = 1; i + 1 < n; i += 2) { const q = [pts[0], pts[i], pts[i + 1], pts[Math.min(n - 1, i + 2)]].map((p) => [p[0], p[1], z1]); quad(mat, q[0], q[1], q[2], q[3], [0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], o); } };
  const tube = (mat, p, q, r, n = 6, o = {}) => { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, w = [d[0] / L, d[1] / L, d[2] / L], up = Math.abs(w[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    let a = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]]; const al = Math.hypot(a[0], a[1], a[2]); a = [a[0] / al, a[1] / al, a[2] / al]; const b = [w[1] * a[2] - w[2] * a[1], w[2] * a[0] - w[0] * a[2], w[0] * a[1] - w[1] * a[0]];
    const ring = (c, k) => { const t = k / n * 6.28319, cs = Math.cos(t) * r, sn = Math.sin(t) * r; return [c[0] + a[0] * cs + b[0] * sn, c[1] + a[1] * cs + b[1] * sn, c[2] + a[2] * cs + b[2] * sn]; }, oo = { cell: 3, ...o };
    for (let k = 0; k < n; k++) quad(mat, ring(p, k), ring(q, k), ring(q, k + 1), ring(p, k + 1), [0, k * 0.04], [L, k * 0.04], [L, k * 0.04 + 0.04], [0, k * 0.04 + 0.04], oo);
    if (o.cap) for (let k = 1; k + 1 < n; k += 2) quad(mat, ring(q, 0), ring(q, k), ring(q, k + 1), ring(q, Math.min(n - 1, k + 2)), [0, 0], [0.04, 0], [0.04, 0.04], [0, 0.04], oo); };

  const shadow = (x, y, z, a, l, w) => { if (!M.shade) return; const f = { x, y, ca: Math.cos(a), sa: Math.sin(a) }; quad(M.shade, P(f, -l / 2, -w / 2, z + 0.006), P(f, l / 2, -w / 2, z + 0.006), P(f, l / 2, w / 2, z + 0.006), P(f, -l / 2, w / 2, z + 0.006), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 0, cell: 9 }); };
  const halo = (f, z, len) => { const gm = opts.glowMat; if (!gm) return; const bu = bk(gm), us = [-len / 2 - 0.35, -len / 2 + 0.1, len / 2 - 0.1, len / 2 + 0.35], ue = [0, 1, 1, 0];      // the glare round a tube (additive)
    for (const up of [0, 1]) { const base = bu.n; for (let i = 0; i < 4; i++) for (const [w, e] of [[-0.42, 0], [0, 1], [0.42, 0]]) { const p = up ? P(f, us[i], 0, z + w * 0.6) : P(f, us[i], w, z - 0.03), c = 0.42 * e * ue[i] * K * depth(p[0], p[1], p[2]); bu.v(p[0], p[1], p[2], 0, 0, c, c * 0.97, c * 0.9); } for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const q = base + i * 3 + j; bu.i.push(q, q + 3, q + 4, q, q + 4, q + 1); } } };

  // ---------------------------------------------------------------- what is beyond an edge of a flat floor: open floor, a platform edge, a drop, or nothing (a wall)
  const PST = S.floors.filter((f) => f.k === 'pstair');      // (all of them, not walk.near: a point just outside a flight can lie in the next cell of the grid)
  const classify = (F, zF, x, y) => { let res = 'wall', top = 0;
    for (const G of walk.near(x, y)) { if (G === F) continue; const u = Walk.u(G, x, y); if (Math.abs(u) > G.l / 2) continue; if (Math.abs(Walk.v(G, x, y)) > G.w / 2) continue; const zG = Walk.zAt(G, u);
      if (F.k === 'pit') { if (G.k === 'pit') return 'open'; if (G.k === 'platform') { res = 'low'; top = zG; } continue; }
      if (G.k === 'pit') { if (F.k === 'platform') return 'edge'; continue; }
      if (Math.abs(zG - zF) <= 0.25 && (!G.stair || Math.abs(u) > G.l / 2 - 0.7)) return 'open';
      if (zG < zF - 0.25 && res === 'wall') res = 'rail'; }
    // a rail stands only round the opening of a stair down to a platform. Anywhere else a floor ends with only a platform far below (the hole the data cuts in the hall round a street
    // stair that comes down inside it, wider than a skew stair; the hall's own ends) there is a full wall: over a rail there the nothing beyond showed as a white void (Grand Central, Nov 15)
    if (res === 'rail' && F.k !== 'platform') { let hole = false; for (const G of PST) if (Math.abs(Walk.u(G, x, y)) <= G.l / 2 + 0.3 && Math.abs(Walk.v(G, x, y)) <= G.w / 2 + 0.3) hole = true; if (!hole) res = 'wall'; }
    return res === 'low' ? 'low:' + top : res; };
  const edgesOf = (F) => { const L = F.l / 2, W = F.w / 2; return [[P(F, -L, -W, 0), P(F, L, -W, 0), [F.sa, -F.ca]], [P(F, L, -W, 0), P(F, L, W, 0), [F.ca, F.sa]], [P(F, L, W, 0), P(F, -L, W, 0), [-F.sa, F.ca]], [P(F, -L, W, 0), P(F, -L, -W, 0), [-F.ca, -F.sa]]]; };
  const spans = (F, zF, a, b, n) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-3) return []; const ux = dx / L, uy = dy / L, at = (t) => classify(F, zF, a[0] + ux * t + n[0] * 0.06, a[1] + uy * t + n[1] * 0.06);
    const res = []; let t0 = 0, c0 = at(0.003), tp = 0.003; const N = Math.max(2, Math.ceil(L / 0.1));
    for (let i = 1; i <= N; i++) { const t = Math.min(L - 0.003, (i / N) * L), c = at(t); if (c !== c0) { let lo = tp, hi = t; for (let q = 0; q < 9; q++) { const m = (lo + hi) / 2; if (at(m) === c0) lo = m; else hi = m; } const tm = (lo + hi) / 2; res.push([t0, tm, c0]); t0 = tm; c0 = c; } tp = t; }
    res.push([t0, L, c0]); return res.map(([s0, s1, c]) => ({ a: [a[0] + ux * s0, a[1] + uy * s0], b: [a[0] + ux * s1, a[1] + uy * s1], c })); };

  // ---------------------------------------------------------------- flat floors, their ceilings and walls
  const EPS = { hall: 0, passage: 0.004, landing: 0.009, platform: 0, pit: 0 }, inStation = (x, y) => S.plen && Math.abs(sOf(x, y)) <= S.plen / 2;
  let work = 0;
  const WELL = { street: 1, landing: 1, passage: 1 };
  for (const F of S.floors) { if (F.stair) continue; part = WELL[F.k] ? 'well' : 'core'; const k = F.k, L = F.l / 2, W = F.w / 2, e = (EPS[k] || 0) + (k === 'passage' ? ((F.ent || 0) % 3) * 0.0012 + (Math.abs(Math.sin(F.a - F0.a)) > 0.5 ? 0.0035 : 0) : 0), z = F.z0;
    const fmat = k === 'platform' ? M.platform : k === 'pit' ? M.trackbed : M.floor;
    if (k === 'pit') { const a = P(F, -L, -W, z), b = P(F, L, -W, z), c = P(F, L, W, z), d = P(F, -L, W, z); quad(fmat, a, b, c, d, [sOf(a[0], a[1]), 0], [sOf(b[0], b[1]), 0], [sOf(c[0], c[1]), F.w], [sOf(d[0], d[1]), F.w], { amb: 0.045, cell: 2.5, k: 0.7 }); }
    else flatQuad(fmat, F, -L, L, -W, W, z - e, k === 'platform' && S.tout ? { amb: 0.085, kf: (x, y) => (S.tout - Math.abs(tOf(x, y)) < 0.35 ? 0.62 : 1) } : { amb: 0.085 });      /* pass 2: the platform's floor is dirtier along the foot of its wall */
    if (k !== 'platform' && k !== 'pit') flatQuad(M.ceiling, F, -L, L, -W, W, z + hM + e, { amb: 0.06, k: 0.55 });      /* pass 2: the lamps hang under it: a ceiling gets less light than the walls */
    for (const [a, b, n] of edgesOf(F)) for (const sp of spans(F, z, a, b, n)) { const c = sp.c;
      if (c === 'open') continue;
      if (k === 'pit') { const st = inStation((sp.a[0] + sp.b[0]) / 2, (sp.a[1] + sp.b[1]) / 2);
        if (c.startsWith('low')) wallQuad(M.concrete, sp.a, sp.b, z, +c.slice(4), { amb: 0.03 });
        else if (st) { // the far wall across the tracks, seen from the platform: split where the station ends, tile above platform height
          wallQuad(M.concrete, sp.a, sp.b, z, zP + 0.1, { amb: 0.03 }); wallQuad(TL, sp.a, sp.b, zP + 0.1, zTile, { amb: 0.06, v0: zP }); wallQuad(M.ceiling, sp.a, sp.b, zTile, zP + hP, { amb: 0.06, k: 0.7 }); }
        else wallQuad(M.concrete, sp.a, sp.b, z, zP + hP, { amb: 0.022, cell: TUN.length ? 1.3 : 2.5 });      // (finer where the tunnel lamps make pools of light on it)
        continue; }
      if (c === 'edge') { // the platform's edge: the yellow strip just inside it
        const dx = sp.b[0] - sp.a[0], dy = sp.b[1] - sp.a[1], Ls = Math.hypot(dx, dy), u0 = (sp.a[0] * dx + sp.a[1] * dy) / Ls, zz = z + 0.004, i0 = [sp.a[0] - n[0] * 0.6, sp.a[1] - n[1] * 0.6], i1 = [sp.b[0] - n[0] * 0.6, sp.b[1] - n[1] * 0.6];
        quad(M.edge, [sp.a[0], sp.a[1], zz], [sp.b[0], sp.b[1], zz], [i1[0], i1[1], zz], [i0[0], i0[1], zz], [u0, 0], [u0 + Ls, 0], [u0 + Ls, 0.6], [u0, 0.6], { amb: 0.085 }); continue; }
      if (c === 'rail') { wallQuad(M.tileDark, sp.a, sp.b, z, z + 1.05, { amb: 0.085, v0: z }); wallQuad(M.concrete, sp.a, sp.b, z - 0.4, z, { amb: 0.05 });
        const dx = sp.b[0] - sp.a[0], dy = sp.b[1] - sp.a[1], Ls = Math.hypot(dx, dy) || 1, o2 = [n[1] * 0, 0]; const t = 0.05, a2 = [sp.a[0] + n[0] * t, sp.a[1] + n[1] * t], b2 = [sp.b[0] + n[0] * t, sp.b[1] + n[1] * t]; wallQuad(M.tileDark, a2, b2, z - 0.0, z + 1.05, { amb: 0.085, v0: z });
        quad(M.metal, [sp.a[0], sp.a[1], z + 1.05], [sp.b[0], sp.b[1], z + 1.05], [b2[0], b2[1], z + 1.05], [a2[0], a2[1], z + 1.05], [0, 0], [Ls, 0], [Ls, t], [0, t], { amb: 0.085 }); continue; }
      { const a2 = [sp.a[0] - n[0] * 0.007, sp.a[1] - n[1] * 0.007], b2 = [sp.b[0] - n[0] * 0.007, sp.b[1] - n[1] * 0.007]; wallQuad(TL, a2, b2, z, z + 0.216, { amb: 0.085, v0: z, in: -1, tint: [0.1, 0.105, 0.11], cell: 2.5 }); }
      if (k === 'platform') { wallQuad(TL, sp.a, sp.b, z, z + 0.54, { amb: 0.085, v0: z, in: -1, k: 0.7, k1: 1 }); wallQuad(TL, sp.a, sp.b, z + 0.54, zTile, { amb: 0.085, v0: z, in: -1 });      /* pass 2: the lowest half metre of every wall is dirtier (mop water, shoes), fading up */ wallQuad(M.ceiling, sp.a, sp.b, zTile, zP + hP, { amb: 0.085, in: -1, k: 0.7 }); } else { wallQuad(TL, sp.a, sp.b, z, z + 0.54, { amb: 0.085, v0: z, in: -1, k: 0.7, k1: 1 }); wallQuad(TL, sp.a, sp.b, z + 0.54, z + hM + 0.012, { amb: 0.085, v0: z, in: -1 }); const bm = k === 'hall' ? bandMat() : null; if (bm) { const a3 = [sp.a[0] - n[0] * 0.009, sp.a[1] - n[1] * 0.009], b3 = [sp.b[0] - n[0] * 0.009, sp.b[1] - n[1] * 0.009], zb = z + 2.02; wallQuad(bm, a3, b3, zb, zb + (SQ ? 0.432 : 0.25), { amb: 0.085, v0: zb, in: -1, cell: 2.5 }); }
        if (k === 'hall') { const Ls = Math.hypot(sp.b[0] - sp.a[0], sp.b[1] - sp.a[1]); if (Ls >= 7 && (Math.round(sp.a[0] * 3.1 + sp.a[1] * 1.7) & 1)) posterAt((sp.a[0] + sp.b[0]) / 2, (sp.a[1] + sp.b[1]) / 2, n[0], n[1], z + 0.34); } } }      /* (pass 2: the colour band runs round the mezzanine too) */      /* 12 mm: over the highest ceiling of any neighbour (they differ by up to 10 mm so that they never lie in one plane); up to its OWN ceiling left a hairline where a lower wall met a higher ceiling (23 St, stair 56: out/well/zoom-fm23.jpg) */      // (+ e: up to this floor's own ceiling; a landing's is 9 mm higher and the slit showed as a white line)
    if (due(++work, 6)) { yield; due.t = due.now ? due.now() : 0; } }
  part = 'core';
  for (const C of S.ceils || []) for (const R of C.rects) { R.ca = Math.cos(R.a); R.sa = Math.sin(R.a); flatQuad(M.ceiling, R, -R.l / 2, R.l / 2, -R.w / 2, R.w / 2, R.z0, { amb: 0.04, k: 0.44, cell: inStationRect(R) ? CELL : 3, kf: overTrack }); if (due(++work, 6)) { yield; due.t = due.now ? due.now() : 0; } }
  function overTrack(x, y) { if (!S.tc || !S.pw) return 1; const t = tOf(x, y); let d = 1e9; for (const c of S.tc) d = Math.min(d, Math.abs(t - c) - S.pw / 2); return d <= 0 ? 1 : d > 0.5 ? 0.03 : 1 - 0.97 * d / 0.5; }      /* pass 2: black past the platform's edge (was 0.07 from 0.9 m out) */
  function inStationRect(R) { return S.plen && Math.abs(sOf(R.x, R.y)) < S.plen / 2 + 20 && R.l < 60; }

  // ---------------------------------------------------------------- stairs
  for (const F of S.floors) { if (!F.stair) continue; part = WELL[F.k] ? 'well' : 'core'; const n = F.n || Math.round(Math.abs(F.z1 - F.z0) / rise), dn = F.z0 > F.z1 ? 1 : -1, zTop = Math.max(F.z0, F.z1), zBot = Math.min(F.z0, F.z1), tr = F.l / n, W = F.w / 2;
    // d = metres from the top edge along the way down; local u = dn * (d - l/2)
    const U = (d) => dn * (d - F.l / 2), lineZ = (d) => zTop - (d / F.l) * (zTop - zBot), stepZ = (i) => zTop - (i + 1) * rise;
    const street = F.k === 'street', lO = meta.lOpen, topAt = (d) => (street ? (d < lO - 1e-6 ? zW : Math.min(zW - meta.slab, lineZ(d) + hM)) : 0);
    for (let i = 0; i < n; i++) { const d0 = i * tr, d1 = d0 + tr, z = stepZ(i), a = P(F, U(d0), -W * dn, z), b = P(F, U(d0), W * dn, z), c = P(F, U(d1), W * dn, z), d = P(F, U(d1), -W * dn, z);
      quad(M.stair, a, b, c, d, [0, 0], [F.w, 0], [F.w, tr], [0, tr], { amb: 0.085, cell: 0.8 });                                         // tread: v = 0 at the nosing
      const ra = P(F, U(d0), -W * dn, z + rise), rb = P(F, U(d0), W * dn, z + rise); quad(M.stair, ra, rb, b, a, [0, 0.5 + rise], [F.w, 0.5 + rise], [F.w, 0.5], [0, 0.5], { amb: 0.085, cell: 0.8, k: 0.55 }); }      // riser
    if (street) {
      for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const d0 = i * tr, d1 = d0 + tr, z = stepZ(i), a = P(F, U(d0), sd * W, 0), b = P(F, U(d1), sd * W, 0); const t0 = topAt(d0 + 1e-4), t1 = topAt(d1 - 1e-4);
        wallQuad(TL, a, b, [z, z], [t0, t1], { amb: 0.085, v0: zM, u0: d0, in: -sd * dn }); }
      // the soffit of the covered part: level under the sidewalk slab, then down with the stair; and the slab's edge over the mouth
      const dk = Math.min(F.l, (meta.slab + hM) * F.l / (zTop - zBot)), zs = zW - meta.slab;
      const sof = (d0, d1, z0, z1) => { const a = P(F, U(d0), -W, z0), b = P(F, U(d0), W, z0), c = P(F, U(d1), W, z1), d = P(F, U(d1), -W, z1); quad(M.ceiling, a, b, c, d, [0, d0], [F.w, d0], [F.w, d1], [0, d1], { amb: 0.10, cell: 0.9 }); };
      if (dk > lO) sof(lO, dk, zs, zs); sof(Math.max(lO, dk), F.l, Math.min(zs, lineZ(Math.max(lO, dk)) + hM), zBot + hM);
      wallQuad(M.concrete, P(F, U(lO), -W, 0), P(F, U(lO), W, 0), zs, zW + 0.02, { amb: 0.2 });
      for (const sd of [-1, 1]) { const off = sd * (W - 0.07), q0 = P(F, U(0.15), off, lineZ(0.15) + 0.92), q1 = P(F, U(F.l - 0.1), off, lineZ(F.l - 0.1) + 0.92); rod(M.metal, q0, q1, 0.022); }      // handrails
    } else {
      // free-standing flight in the platform hall: solid balustrades, a soffit, and the space under it walled in where a person could not stand
      const drop = 0.28, zLo = (d) => lineZ(d) - drop;
      for (const sd of [-1, 1]) { const a = P(F, U(0), sd * W, 0), b = P(F, U(F.l), sd * W, 0); wallQuad(M.steel, a, b, [zLo(0), zLo(F.l)], [zTop + 1.0, zBot + 1.0], { amb: 0.085, cell: 0.9 }); rod(M.metal, [a[0], a[1], zTop + 1.02], [b[0], b[1], zBot + 1.02], 0.03); }
      { const a = P(F, U(0), -W, zLo(0)), b = P(F, U(0), W, zLo(0)), c = P(F, U(F.l), W, zLo(F.l)), d = P(F, U(F.l), -W, zLo(F.l)); quad(M.concrete, a, b, c, d, [0, 0], [F.w, 0], [F.w, F.l], [0, F.l], { amb: 0.05 }); }
      flatQuad(M.ceiling, F, -F.l / 2 - 0.13, F.l / 2 + 0.13, -W - 0.16, W + 0.16, zTop + hM, { amb: 0.10 });      // the mezzanine's ceiling carries on over the stair's opening
      const dc = F.l * (1 - (2.0 + drop) / (zTop - zBot));       // from here down the clearance under the flight is under 2 m
      if (dc > 0 && dc < F.l) { for (const sd of [-1, 1]) wallQuad(TL, P(F, U(dc), sd * W, 0), P(F, U(F.l), sd * W, 0), zBot, [zLo(dc), zLo(F.l)], { amb: 0.07, v0: zBot });
        wallQuad(TL, P(F, U(dc), -W, 0), P(F, U(dc), W, 0), zBot, zLo(dc), { amb: 0.07, v0: zBot }); }
    }
    if (due(++work, 3)) { yield; due.t = due.now ? due.now() : 0; } }
  // a thin square rod between two map points (handrails)
  function rod(mat, a, b, r) { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * r, ny = dx / L * r; const o = { amb: 0.12, cell: 3 };
    quad(mat, [a[0] + nx, a[1] + ny, a[2] + r], [b[0] + nx, b[1] + ny, b[2] + r], [b[0] - nx, b[1] - ny, b[2] + r], [a[0] - nx, a[1] - ny, a[2] + r], [0, 0], [L, 0], [L, 2 * r], [0, 2 * r], o);
    for (const s of [-1, 1]) quad(mat, [a[0] + nx * s, a[1] + ny * s, a[2] - r], [b[0] + nx * s, b[1] + ny * s, b[2] - r], [b[0] + nx * s, b[1] + ny * s, b[2] + r], [a[0] + nx * s, a[1] + ny * s, a[2] + r], [0, 0], [L, 0], [L, 2 * r], [0, 2 * r], o); }

  // ---------------------------------------------------------------- tracks: running rails, the third rail and its glow
  part = 'core'; const glowMat = opts.glowMat;
  for (const T of S.tracks || []) { const dx = T.b[0] - T.a[0], dy = T.b[1] - T.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux, mid = [(T.a[0] + T.b[0]) / 2, (T.a[1] + T.b[1]) / 2], ang = Math.atan2(dy, dx), o = { amb: 0.035, cell: 4, k: 0.5 };
    for (const g of [-0.7175, 0.7175]) box(M.rail, mid[0] + nx * g, mid[1] + ny * g, T.z - meta.railH, ang, L, 0.07, meta.railH, o);
    const g3 = T.side * 1.42;       // the third rail runs on the side away from the platform
    box(M.rail, mid[0] + nx * g3, mid[1] + ny * g3, T.z - 0.02, ang, L, 0.09, 0.11, o); box(M.black, mid[0] + nx * (g3 + T.side * 0.03), mid[1] + ny * (g3 + T.side * 0.03), T.z + 0.17, ang, L, 0.26, 0.035, { ...o, bottom: true });
    if (glowMat) { const bu = bk(glowMat), w0 = g3 - 0.4, w1 = g3 + 0.4, z = T.z - meta.railH + 0.012, N = Math.ceil(L / 6), base = bu.n;      // a soft warm pool on the track floor under the third rail (additive)
      for (let i = 0; i <= N; i++) { const s = i / N, px = T.a[0] + dx * s, py = T.a[1] + dy * s, fl = 0.75 + 0.25 * Math.sin(i * 12.9898) * Math.sin(i * 4.1); for (const [w, e] of [[w0, 0], [g3, 1], [w1, 0]]) bu.v(px + nx * w, py + ny * w, z, s * L, w, 0.012 * e * fl * K, 0.005 * e * fl * K, 0.001 * e * fl * K); }
      for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const p = base + i * 3 + j; bu.i.push(p, p + 3, p + 4, p, p + 4, p + 1); } }
    yield; }
  // the tunnel lamps' bulbs, and a row of steel columns between neighbouring tracks beyond the platforms (they pass the windows of a moving train)
  if (TUN.length && M.glowWhite) { const bu = bk(M.glowWhite); for (const l of TUN) { const b = bu.n, k = 1.0 * K / 0.3;      /* (the lamp material is already bright) */ for (const [du, dz] of [[-0.11, -0.07], [0.11, -0.07], [0.11, 0.07], [-0.11, 0.07]]) bu.v(l.x + l.ca * du, l.y + l.sa * du, l.z + dz, 0.5, 0.5, l.col[0] * k, l.col[1] * k, l.col[2] * k); bu.i.push(b, b + 1, b + 2, b, b + 2, b + 3); } }
  if (S.plen && (S.tracks || []).length > 1) { const T0 = S.tracks[0], dx = T0.b[0] - T0.a[0], dy = T0.b[1] - T0.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, ang = Math.atan2(dy, dx), ts = S.tracks.map((T) => tOf((T.a[0] + T.b[0]) / 2, (T.a[1] + T.b[1]) / 2)).sort((p, q) => p - q), s0 = sOf(T0.a[0], T0.a[1]), zb = Math.min(...S.tracks.map((T) => T.z)) - meta.railH;
    for (let i = 0; i < ts.length - 1; i++) { if (ts[i + 1] - ts[i] > 5.5 || ts[i + 1] - ts[i] < 3.3) continue; const tm = (ts[i] + ts[i + 1]) / 2; let n = 0;
      for (let s = s0 + 2; s < s0 + L - 2; s += 4.6) { if (Math.abs(s) <= S.plen / 2 + 3) continue; box(M.steel, F0.x + fca * s - fsa * tm, F0.y + fsa * s + fca * tm, zb, ang, 0.2, 0.2, zP + hP - zb, { amb: 0.03, cell: 6, noTop: true }); if (++n % 40 === 0) yield; } } }

  // ---------------------------------------------------------------- things
  const signs = new Map(), signOf = (key, make) => { let s = signs.get(key); if (!s) { s = make(); signs.set(key, s); const m = s.material; if (m && !m.vertexColors && !m.userData.subK) { m.userData.subK = 1; m.color.multiplyScalar(K * 1.05); } if (m) { m.side = 2; m.fog = false; } } return s; };
  let nCol = 0, fareA; const fareArt = () => { if (fareA === undefined) { fareA = null; try { if (look.fare) { fareA = look.fare(); const m = fareA.material; m.side = 2; m.fog = false; } } catch (e) { fareA = null; } } return fareA; };
  const inWell = (x, y) => { for (const f of walk.near(x, y)) if (WELL[f.k] && f.k !== 'street' && Math.abs(Walk.u(f, x, y)) <= f.l / 2 && Math.abs(Walk.v(f, x, y)) <= f.w / 2) { let hall = false; for (const g of walk.near(x, y)) if (g.k === 'hall' && Math.abs(Walk.u(g, x, y)) <= g.l / 2 && Math.abs(Walk.v(g, x, y)) <= g.w / 2) hall = true; if (!hall) return true; } return false; };
  for (const t of THINGS) { part = t.k === 'gate' || (t.k === 'lamp' && inWell(t.x, t.y)) ? 'well' : 'core';
    if (t.k === 'turn' || t.k === 'rail' || t.k === 'booth') { const ca = Math.cos(t.a), sa = Math.sin(t.a), at = (u, v) => [t.x + ca * u - sa * v, t.y + sa * u + ca * v], mt = M.metal || M.steel; walk.addObstacle({ x: t.x, y: t.y, a: t.a, l: t.l, w: t.w, zlo: t.z - 0.3, zhi: t.z + t.h });
      const L3 = (u, v, z) => [t.x + ca * u - sa * v, t.y + sa * u + ca * v, t.z + z], ST = M.stainless || mt, FA = fareArt(), fq = (name, a, b, c, d, o) => { const g = FA.reg[name]; quad(FA.material, a, b, c, d, [g[0], g[1]], [g[2], g[1]], [g[2], g[3]], [g[0], g[3]], o); };
      if (t.k === 'turn') {      // the real machine's outline in our own dress: a low console with an undercut nose at the end he comes from, a tower with a sloped roof and a lamp panel at the far end,
        // the three-armed head on the lane side, a reader on the nose, and a tube hoop from tower to tower over each lane
        let pd = 1, bd = 1e9; for (const q of THINGS) if (q.k === 'rail') { const du = (q.x - t.x) * ca + (q.y - t.y) * sa, d = Math.hypot(q.x - t.x, q.y - t.y); if (d < bd && d < 6) { bd = d; pd = du >= 0 ? 1 : -1; } }      // the rails stand on the paid side
        const hl = t.bl / 2, hw = t.bw / 2 + 0.04, X = (x, v, z) => L3(pd * x, v * pd, z),      /* pass 2: the cabinet is drawn 8 cm wider than the data's (the lanes read too wide); its collision is unchanged */ xt = hl - 0.3, zc = 0.92, o = { cell: 1.6 }; shadow(t.x, t.y, t.z, t.a, t.bl + 0.26, t.bw + 0.26); shadow(t.x, t.y, t.z, t.a, t.bl + 0.02, t.bw + 0.1);      /* (a second, tighter patch: darkest right at the foot) */
        for (const v of [-hw - 0.002, hw + 0.002]) for (const [a, b] of [[[-hl + 0.13, 0.5], [hl, 0.5]], [[xt, 0.06], [xt, 0.92]], [[-hl + 0.45, 0.5], [-hl + 0.45, 0.92]]]) { const hz = a[1] === b[1] ? 0.002 : 0, hx = hz ? 0 : 0.002; quad(M.black, X(a[0] - hx, v, a[1] - hz), X(b[0] - hx, v, b[1] - hz), X(b[0] + hx, v, b[1] + hz), X(a[0] + hx, v, a[1] + hz), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 0.22, cell: 3 }); }      // sheet joints
        if (!t.arm && look.sign) { let n = 0, mx = 0, my = 0; for (const q of THINGS) if (q.k === 'turn' && Math.hypot(q.x - t.x, q.y - t.y) < 6 && Math.abs((q.x - t.x) * ca + (q.y - t.y) * sa) < 0.3) { n++; mx += q.x; my += q.y; } mx /= n; my /= n;      // a black sign hung over the row, facing the way in
          const sg = signOf('entry', () => look.sign([{ text: 'Entry   ' + (S.name || ''), routes: S.signRoutes || S.routes }], { h: 0.3 })), hw2 = Math.min(sg.w, 3.6) / 2, hh = hw2 / sg.w * sg.h, zs = zM + hM - 0.12 - hh, cx = mx - ca * pd * 0.75, cy = my - sa * pd * 0.75;
          for (const dir of [1, -1]) { const q = (u, z) => [cx - sa * u * dir * pd - ca * pd * 0.03 * dir, cy + ca * u * dir * pd - sa * pd * 0.03 * dir, z]; quad(sg.material, q(hw2, zs - hh), q(-hw2, zs - hh), q(-hw2, zs + hh), q(hw2, zs + hh), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 1.15 }); }
          box(M.black, cx, cy, zs - hh - 0.02, t.a + Math.PI / 2, hw2 * 2 + 0.04, 0.05, hh * 2 + 0.04, { flat: 0.05, bottom: true }); for (const e of [-0.8, 0.8]) box(M.black, cx - sa * hw2 * e, cy + ca * hw2 * e, zs + hh, t.a, 0.025, 0.025, Math.max(0.02, zM + hM - zs - hh), { flat: 0.1, noTop: true }); }      /* (pass 2: two hanger rods up to the ceiling) */      // X: x runs from the unpaid end (-hl) to the paid end (+hl)
        const sideQ = (v, a, b, c, d, oo) => quad(ST, X(a[0], v, a[1]), X(b[0], v, b[1]), X(c[0], v, c[1]), X(d[0], v, d[1]), [a[0], a[1]], [b[0], b[1]], [c[0], c[1]], [d[0], d[1]], oo);
        const span = (a, b, oo, m = ST) => quad(m, X(a[0], -hw, a[1]), X(a[0], hw, a[1]), X(b[0], hw, b[1]), X(b[0], -hw, b[1]), [0, 0], [t.bw, 0], [t.bw, Math.hypot(b[0] - a[0], b[1] - a[1])], [0, Math.hypot(b[0] - a[0], b[1] - a[1])], oo);
        const P0 = [-hl + 0.2, 0.06], P1 = [hl, 0.06], P2 = [hl, 1.5], P3 = [xt, 1.37], zn = 0.86, zd = 0.99, P4 = [xt, zd], P5 = [-hl, zn], Pm = [xt, 0.06];      /* pass 2: the deck slopes down from the post (zd) to the nose (zn), as the real machine's does (was level at zc) */
        for (const v of [-hw, hw]) { sideQ(v, P0, Pm, P4, P5, { ...o, k: 0.4, k1: 1.08 }); sideQ(v, Pm, P1, P2, P3, { ...o, k: 0.4, k1: 1.25 }); }      /* pass 2: a stronger floor-to-top gradient on every upright sheet (dark floor mirrored low, lamps high) */
        span(P0, P5, { ...o, k: 0.4, k1: 1.0 }); span(P5, P4, { ...o, k: 1.12 }); span(P4, P3, { ...o, k: 0.9 }); span(P3, P2, { ...o, k: 1.15 }); span(P1, P2, { ...o, k: 0.45, k1: 1.2 });
        { const eo = { cell: 3, k: 1.5 }, eq = (a, b, c, d) => quad(ST, a, b, c, d, [0, 0], [0.3, 0], [0.3, 0.02], [0, 0.02], eo);      // pass 2: a narrow bright strip along each folded edge (sheet steel catches the light on its bends: without them the cabinet read as a plain box)
          for (const s of [-1, 1]) { eq(X(-hl, s * (hw + 0.003), zn - 0.012), X(xt, s * (hw + 0.003), zd - 0.012), X(xt, s * (hw - 0.012), zd + 0.003), X(-hl, s * (hw - 0.012), zn + 0.003));
            eq(X(xt, s * (hw + 0.003), 1.37 - 0.012), X(hl, s * (hw + 0.003), 1.5 - 0.012), X(hl, s * (hw - 0.012), 1.5 + 0.003), X(xt, s * (hw - 0.012), 1.37 + 0.003));
            eq(X(hl + 0.003, s * (hw - 0.012), 0.06), X(hl + 0.003, s * (hw - 0.012), 1.5), X(hl - 0.012, s * (hw + 0.003), 1.5), X(hl - 0.012, s * (hw + 0.003), 0.06));
            eq(X(xt - 0.003, s * (hw - 0.012), zd), X(xt - 0.003, s * (hw - 0.012), 1.37), X(xt + 0.012, s * (hw + 0.003), 1.37), X(xt + 0.012, s * (hw + 0.003), zd)); } }
        { const [px, py] = at(pd * 0.1, 0); box(M.black, px, py, t.z, t.a, t.bl - 0.24, t.bw + 0.05, 0.06, { flat: 0.1, noTop: true }); }
        { const e0 = -hl - 0.03, e1 = -hl + 0.15, w = 0.075, z0 = zn + 0.012, zf = z0 + 0.02, zb = z0 + 0.11, A = X(e0, w, zf), B = X(e0, -w, zf), C = X(e1, -w, zb), D = X(e1, w, zb), A0 = X(e0, w, z0 - 0.03), B0 = X(e0, -w, z0 - 0.03), C0 = X(e1, -w, z0), D0 = X(e1, w, z0), bl = { flat: 0.16 };
          if (FA) fq('screen', A, B, C, D, { flat: 2.0 }); else quad(M.black, A, B, C, D, [0, 0], [1, 0], [1, 1], [0, 1], bl);
          for (const [a, b, c, d] of [[A0, B0, B, A], [B0, C0, C, B], [C0, D0, D, C], [D0, A0, A, D]]) quad(M.black, a, b, c, d, [0, 0], [1, 0], [1, 1], [0, 1], bl); }
        if (FA) { fq('go', X(xt - 0.004, 0.07, 0.96), X(xt - 0.004, -0.07, 0.96), X(xt - 0.004, -0.07, 1.34), X(xt - 0.004, 0.07, 1.34), { flat: 1.15 }); fq('no', X(hl + 0.004, -0.07, 1.04), X(hl + 0.004, 0.07, 1.04), X(hl + 0.004, 0.07, 1.42), X(hl + 0.004, -0.07, 1.42), { flat: 1.15 }); }
        if (t.arm) { const c = 0.70711, C = [-hl + 0.36, hw - 0.01, 0.78], Hh = [C[0], C[1] + c * 0.085, C[2] - c * 0.085], P3d = (q) => L3(pd * q[0], q[1], q[2]);
          tube(ST, P3d([C[0], C[1] - c * 0.02, C[2] + c * 0.02]), P3d(Hh), 0.055, 10, { cap: true, k: 0.45 });
          let gate;
          if (opts.turnstile) {
            const pivot = P3d(Hh), center = P3d([Hh[0], hw + t.lane / 2, 0]);
            gate = { x: center[0], y: center[1], z: t.z, ca, sa, pd, width: t.lane };
            gates.push(gate);
            special = new Bucket(ST);
            gate.origin = new THREE.Vector3(pivot[0], pivot[2], -pivot[1]);
          }
          for (const d of [[0, 1, 0], [0.612, 0.25, -0.75], [-0.612, 0.25, -0.75]]) tube(ST, P3d([Hh[0] + d[0] * 0.03, Hh[1] + d[1] * 0.03 - c * 0.02, Hh[2] + d[2] * 0.03 + c * 0.02]), P3d([Hh[0] + d[0] * 0.55, Hh[1] + d[1] * 0.55, Hh[2] + d[2] * 0.55]), 0.024, 8, { cap: true, k: 0.75 });
          if (gate) {
            gate.arm = special.mesh(THREE, 'turnstile_arm');
            gate.arm.geometry.translate(-gate.origin.x, -gate.origin.y, -gate.origin.z);
            gate.arm.position.copy(gate.origin);
            gate.arm.matrixAutoUpdate = true;
            gate.axis = new THREE.Vector3(-sa, -1, -ca).normalize().multiplyScalar(pd);
            special = null;
            if (FA) {
              special = new Bucket(FA.material);
              fq('paidScreen', X(-hl-0.03,0.075,zn+0.034), X(-hl-0.03,-0.075,zn+0.034),
                X(-hl+0.15,-0.075,zn+0.124), X(-hl+0.15,0.075,zn+0.124), {flat:2});
              gate.screen = special.mesh(THREE, 'reader_GO');
              gate.screen.visible = false;
              special = null;
            }
          }
          // the hoop over this lane, to the next machine's tower
          const xh = hl - 0.15, v0 = 0.062, W = t.lane + t.bw - v0, r = 0.26, zt = 1.4, zh = 2.06, pts = [[v0, zt], [v0, zh - r]]; for (let i = 1; i <= 10; i++) { const q = i / 10 * Math.PI / 2; pts.push([v0 + r - Math.cos(q) * r, zh - r + Math.sin(q) * r]); } for (let i = 0; i <= 10; i++) { const q = i / 10 * Math.PI / 2; pts.push([W - r + Math.sin(q) * r, zh - r + Math.cos(q) * r]); } pts.push([W, zt]);
          for (let i = 0; i + 1 < pts.length; i++) tube(ST, L3(pd * xh, pts[i][0], pts[i][1]), L3(pd * xh, pts[i + 1][0], pts[i + 1][1]), 0.042, 10, { k: 0.85 }); for (const vv of [v0, W]) tube(ST, L3(pd * xh, vv, zt - 0.005), L3(pd * xh, vv, zt + 0.06), 0.056, 10, { k: 0.7 }); } }      /* (a collar where each leg meets the cabinet) */      /* pass 2: fat tube hoops, as the photos (were r 0.027) */
      else if (t.k === 'rail') {      // an iron bar fence, floor to over head height: square bars between flat rails, dark gloss paint
        const zt = Math.min(2.25, zM + hM - t.z - 0.05), dk = { k: 0.16, cell: 3, tint: [0.8, 0.85, 0.9] }, n = Math.max(2, Math.round(t.l / 0.13)), nx = -sa * 0.011, ny = ca * 0.011, ux = ca * 0.011, uy = sa * 0.011;
        for (const h of [0.12, 1.1, zt]) { const [px, py] = at(0, 0); box(ST, px, py, t.z + h - 0.035, t.a, t.l, 0.05, 0.07, { ...dk, bottom: true }); }
        for (let i = 0; i <= n; i++) { const [px, py] = at(-t.l / 2 + t.l * i / n, 0), post = i === 0 || i === n, w = post ? 3.2 : 0.95; tube(ST, [px, py, t.z], [px, py, t.z + zt], 0.011 * w, 4, dk); } }
      else {      // the agent's booth: steel panels with ribs on a dark plinth, a sill, a lit room behind glass between posts, a deep fascia with its lit words
        shadow(t.x, t.y, t.z, t.a, t.l + 1.3, t.w + 1.3); const hl = t.l / 2, hw = t.w / 2, CR = [0.62, 0.6, 0.54], BL = [0.05, 0.065, 0.09];      /* pass 2: grey-cream panels in a near-black steel frame (was cream in bright navy) */ box(M.black, t.x, t.y, t.z, t.a, t.l - 0.05, t.w - 0.05, 0.1, { flat: 0.1, noTop: true }); box(ST, t.x, t.y, t.z + 0.1, t.a, t.l, t.w, 0.93, { cell: 1.2, noTop: true, k: 0.7, k1: 0.95, tint: CR });
        for (const sd of [-1, 1]) { for (let i = 0; i <= 4; i++) { const [px, py] = at(-hl + 0.04 + (t.l - 0.08) * i / 4, sd * (hw + 0.012)); box(ST, px, py, t.z + 0.1, t.a, 0.05, 0.026, 0.93, { cell: 1.2, noTop: true, tint: BL }); } for (let i = 0; i <= 3; i++) { const [px, py] = at(sd * (hl + 0.012), -hw + 0.04 + (t.w - 0.08) * i / 3); box(ST, px, py, t.z + 0.1, t.a, 0.026, 0.05, 0.93, { cell: 1.2, noTop: true, tint: BL }); } }
        box(ST, t.x, t.y, t.z + 1.03, t.a, t.l + 0.09, t.w + 0.09, 0.05, { cell: 1.2, bottom: true, tint: BL });
        if (FA) { const g = 0.035, z0 = 1.08, z1 = 2.0, cs = [[-hl + g, -hw + g], [hl - g, -hw + g], [hl - g, hw - g], [-hl + g, hw - g]]; for (let i = 0; i < 4; i++) { const a = cs[i], b = cs[(i + 1) % 4]; fq('win', L3(a[0], a[1], z0), L3(b[0], b[1], z0), L3(b[0], b[1], z1), L3(a[0], a[1], z1), { flat: 0.95 }); } }
        else box(M.black, t.x, t.y, t.z + 1.08, t.a, t.l - 0.07, t.w - 0.07, 0.92, { flat: 0.22, noTop: true });
        for (const [u, v] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [0, -hw], [0, hw]]) { const [px, py] = at(u * (1 - 0.045 / hl), v * (1 - 0.045 / hw)); box(ST, px, py, t.z + 1.08, t.a, 0.09, 0.09, 0.92, { cell: 1.2, noTop: true, tint: BL }); }
        box(ST, t.x, t.y, t.z + 2.0, t.a, t.l + 0.1, t.w + 0.1, t.h - 2.0, { cell: 1.2, bottom: true, tint: BL, k: 0.9 });
        { const u = -(hl + 0.05) - 0.004, f = { x: t.x, y: t.y, ca, sa }; if (FA) { fq('info', L3(u, 0.6, 2.075), L3(u, -0.6, 2.075), L3(u, -0.6, 2.225), L3(u, 0.6, 2.225), { flat: 2.0 }); fq('grille', L3(-hl - 0.002, 0.11, 1.42), L3(-hl - 0.002, -0.11, 1.42), L3(-hl - 0.002, -0.11, 1.64), L3(-hl - 0.002, 0.11, 1.64), { flat: 0.9 }); const [px, py] = at(-hl - 0.1, 0); box(ST, px, py, t.z + 1.03, t.a, 0.2, 0.46, 0.035, { cell: 1.2, bottom: true, k: 1.15 }); }
          else if (M.glowWhite) quad(M.glowWhite, P(f, u, -0.7, t.z + 2.06), P(f, u, 0.7, t.z + 2.06), P(f, u, 0.7, t.z + 2.24), P(f, u, -0.7, t.z + 2.24), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 1 }); } } }
    else if (t.k === 'col') { if (t.lvl === 't') box(M.steel, t.x, t.y, t.z, t.a, 0.3, 0.3, t.h, { amb: 0.03, noTop: true, cell: 1.4 });
      else {      // a riveted I-section: two flange plates facing the tracks and the wall, the web between them seen from along the platform
        const ca = Math.cos(t.a), sa = Math.sin(t.a), at = (u, v) => [t.x + ca * v - sa * u, t.y + sa * v + ca * u], z1 = t.z + t.h, H = 0.15, tf = 0.03, o = { amb: 0.085, cell: 1.4 };      // (u across the platform, v along it)
        for (const sd of [-1, 1]) { wallQuad(M.steel, at(-H, sd * H), at(H, sd * H), t.z, z1, { ...o, u0: 0 }); wallQuad(M.steel, at(-H, sd * (H - tf)), at(H, sd * (H - tf)), t.z, z1, { ...o, u0: 0, k: 0.62 });
          for (const e of [-1, 1]) wallQuad(M.steel, at(e * H, sd * (H - tf)), at(e * H, sd * H), t.z, z1, { ...o, u0: 0.1, k: 1.15 }); wallQuad(M.steel, at(sd * 0.012, -H + tf), at(sd * 0.012, H - tf), t.z, z1, { ...o, u0: 0.03, k: 0.8 }); }
        box(M.black, t.x, t.y, t.z, t.a, 0.34, 0.34, 0.1, { flat: 0.16 }); shadow(t.x, t.y, t.z, t.a, 1.1, 1.1); shadow(t.x, t.y, t.z, t.a, 0.56, 0.56);
        if (t.lvl === 'p' && look.plate && S.name && (nCol++ % 2 === 0)) { const pl = signOf('plate', () => look.plate(S.name)), hw = pl.w / 2 - 0.01, zc = t.z + 1.85; for (const sd of [-1, 1]) { const a = at(-hw * sd, sd * (H + 0.006)), b = at(hw * sd, sd * (H + 0.006)); quad(pl.material, [a[0], a[1], zc - pl.h / 2], [b[0], b[1], zc - pl.h / 2], [b[0], b[1], zc + pl.h / 2], [a[0], a[1], zc + pl.h / 2], [0, 0], [1, 0], [1, 1], [0, 1], { amb: 0.085, k: 2.2 }); } } }
      if (t.lvl !== 't') walk.addObstacle({ x: t.x, y: t.y, a: t.a, l: 0.3, w: 0.3, zlo: t.z - 0.3, zhi: t.z + 2 }); }
    else if (t.k === 'lamp') { const f = { x: t.x, y: t.y, ca: Math.cos(t.a), sa: Math.sin(t.a) }; let len = 1.25;      // a white enamelled channel under the ceiling, two bare tubes below it; on a platform the row runs nearly end to end
      if (t.lvl === 'p') { let gap = 1e9; for (const q of THINGS) { if (q === t || q.k !== 'lamp' || q.lvl !== 'p') continue; const du = Math.abs((q.x - t.x) * f.ca + (q.y - t.y) * f.sa), dv = Math.abs(-(q.x - t.x) * f.sa + (q.y - t.y) * f.ca); if (dv < 0.4 && du > 1.3 && du < gap) gap = du; } if (gap < 7) len = Math.max(1.25, Math.min(3.7, gap - 1.3)); } else if (t.lvl === 'm' && !inWell(t.x, t.y)) len = 2.4;
      const hwL = t.lvl === 'm' && len > 2 ? 0.13 : 0.07;      /* pass 2: a mezzanine fixture is a wide lensed strip, a platform one a narrow channel with two bare tubes */
      const lens = hwL > 0.1, zl = lens ? t.z - 0.04 : t.z + 0.032;      /* a lensed strip hangs 13 cm under the ceiling: enamel sides, dark end caps, the lens set in from its rim */
      const endCap = (hw, z0, z1) => { for (const e of [-1, 1]) { const u = e * (len / 2 + 0.013); quad(M.black, P(f, u, -hw, z0), P(f, u, hw, z0), P(f, u, hw, z1), P(f, u, -hw, z1), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 0.12, cell: 3 }); } };
      if (lens) { box(M.metal || M.black, t.x, t.y, t.z - 0.034, t.a, len + 0.02, hwL * 2 + 0.07, 0.134, { flat: 0.62, noTop: true, cell: 3, bottom: { flat: 0.3, cell: 3 } }); endCap(hwL + 0.04, t.z - 0.036, t.z + 0.1); }
      else { box(M.metal || M.black, t.x, t.y, t.z + 0.03, t.a, len + 0.02, hwL * 2 + 0.03, 0.07, { flat: 0.6, noTop: true, cell: 6, bottom: { flat: 0.75, cell: 6 } }); endCap(hwL + 0.015, t.z - 0.02, t.z + 0.1); }      /* a platform fixture: grey enamel channel, two bare tubes under it between dark lamp holders */
      { let nb = null, gap = 7; for (const q of THINGS) { if (q === t || q.k !== 'lamp' || q.lvl !== t.lvl) continue; const du = (q.x - t.x) * f.ca + (q.y - t.y) * f.sa, dv = Math.abs(-(q.x - t.x) * f.sa + (q.y - t.y) * f.ca); if (dv < 0.4 && du > 1.3 && du < gap) { gap = du; nb = q; } } if (nb && M.metal) { const a = P(f, 0, 0.1, t.z + 0.075), b = [nb.x - f.sa * 0.1, nb.y + f.ca * 0.1, nb.z + 0.075]; rod(M.metal, a, b, 0.016); } }
      const GT = M.glowTube || M.glowWhite, gl = { flat: TUBE * K * depth(t.x, t.y, t.z), raw: true, cell: 9 };      // (pass 2: the tubes are the brightest thing in the frame, well over the game's bloom threshold)
      if (!lens) for (const v of [-0.045, 0.045]) tube(GT, P(f, -len / 2 + 0.03, v, t.z + 0.004), P(f, len / 2 - 0.03, v, t.z + 0.004), 0.024, 4, gl);
      else { const li = 0.03, gl0 = gl.flat; gl.flat = gl0 * 0.5;      /* (a lens is a wide lit face, not a bare tube: half as bright, or the game's bloom makes a blob of it) */ quad(GT, P(f, -len / 2 + li, -hwL, zl - 0.006), P(f, len / 2 - li, -hwL, zl - 0.006), P(f, len / 2 - li, hwL, zl - 0.006), P(f, -len / 2 + li, hwL, zl - 0.006), [0, 0], [1, 0], [1, 1], [0, 1], gl); }
      halo(f, zl, len);
      }
    else if (t.k === 'bench') { shadow(t.x, t.y, t.z, t.a, 2.5, 1.0); box(M.steel, t.x, t.y, t.z + 0.4, t.a, 1.9, 0.5, 0.06, { amb: 0.085, bottom: true }); for (const d of [-0.8, 0.8]) box(M.black, t.x + Math.cos(t.a) * d, t.y + Math.sin(t.a) * d, t.z, t.a, 0.08, 0.44, 0.4, { amb: 0.085, noTop: true }); walk.addObstacle({ x: t.x, y: t.y, a: t.a, l: 1.9, w: 0.5, zlo: t.z - 0.3, zhi: t.z + 1 }); }
    else if (t.k === 'psign' && look.sign) { const sg = signOf('p|' + t.text + '|' + t.dirn + '|' + (t.routes || []).join(''), () => look.sign([{ text: t.text }, { text: t.dirn, routes: S.routes }], { h: 0.30 }));
      const hw = Math.min(sg.w, S.pw - 0.6) / 2, hh = hw / sg.w * sg.h, f = { x: t.x, y: t.y, ca: Math.cos(t.a + Math.PI / 2), sa: Math.sin(t.a + Math.PI / 2) };
      for (const dir of [1, -1]) { const o = 0.03 * dir, q = (u, z) => [f.x + f.ca * u * dir + Math.cos(t.a) * o, f.y + f.sa * u * dir + Math.sin(t.a) * o, z]; quad(sg.material, q(-hw, t.z - hh), q(hw, t.z - hh), q(hw, t.z + hh), q(-hw, t.z + hh), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 1.15 }); }
      box(M.black, t.x, t.y, t.z - hh - 0.02, t.a + Math.PI / 2, hw * 2 + 0.04, 0.05, hh * 2 + 0.04, { flat: 0.05, bottom: true }); for (const d of [-hw * 0.7, hw * 0.7]) box(M.black, t.x + f.ca * d, t.y + f.sa * d, t.z + hh, t.a, 0.03, 0.03, zP + hP - t.z - hh, { flat: 0.1, noTop: true }); }
    else if (t.k === 'tablet' && look.tablet) { const tb = signOf('t|' + t.text, () => look.tablet(t.text, SQ ? { color: '#1b1b1d', accent: S.color, h: 1.2, serif: false } : { color: S.color, h: 0.95 }))      /* pass 2: on the 1930s lines the tablet is white letters on black in a border of the line's colour */, hw = tb.w / 2, hh = tb.h / 2, f = { x: t.x, y: t.y, ca: Math.cos(t.a + Math.PI / 2), sa: Math.sin(t.a + Math.PI / 2) }, ox = Math.cos(t.a) * 0.025, oy = Math.sin(t.a) * 0.025;
      const q = (u, z) => [f.x + f.ca * u + ox, f.y + f.sa * u + oy, z]; quad(tb.material, q(-hw, t.z - hh), q(hw, t.z - hh), q(hw, t.z + hh), q(-hw, t.z + hh), [0, 0], [1, 0], [1, 1], [0, 1], { amb: 0.06, in: 1 }); }
    else if (t.k === 'gate') { const F = S.floors.find((f) => f.k === 'landing' && f.ent === t.ent); if (F) { const a = P(F, F.l / 2 - 0.25, -F.w / 2, 0), b = P(F, F.l / 2 - 0.25, F.w / 2, 0); wallQuad(M.steel, a, b, zM, zM + hM, { amb: 0.085, v0: zM });
        if (look.sign) { const sg = signOf('closed', () => look.sign([{ text: 'This entrance is closed' }], { h: 0.16 })), hw = Math.min(F.w * 0.42, sg.w / 2), hh = hw / sg.w * sg.h, c = P(F, F.l / 2 - 0.28, 0, zM + 1.55); quad(sg.material, [c[0] + F.sa * hw, c[1] - F.ca * hw, c[2] - hh], [c[0] - F.sa * hw, c[1] + F.ca * hw, c[2] - hh], [c[0] - F.sa * hw, c[1] + F.ca * hw, c[2] + hh], [c[0] + F.sa * hw, c[1] - F.ca * hw, c[2] + hh], [0, 0], [1, 0], [1, 1], [0, 1], { flat: 0.9 }); }
        walk.addObstacle({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, a: F.a, l: 0.3, w: F.w, zlo: zM - 1, zhi: zM + 3 }); } }
    if (due(++work, 40)) { yield; due.t = due.now ? due.now() : 0; } }
  { const cols = THINGS.filter((t) => t.k === 'col' && t.lvl !== 't'), dep = { m: 0.3, p: 0.42 }; part = 'core';
    for (const c of cols) { const s0 = sOf(c.x, c.y), t0 = tOf(c.x, c.y); let nb = null, bd = 5.2; for (const q of cols) { if (q === c || q.lvl !== c.lvl) continue; const ds = sOf(q.x, q.y) - s0; if (ds > 0.5 && ds < bd && Math.abs(tOf(q.x, q.y) - t0) < 0.2) { bd = ds; nb = q; } } if (!nb) continue;
      const d = dep[c.lvl] || 0.3, zt = c.z + c.h, mx = (c.x + nb.x) / 2, my = (c.y + nb.y) / 2; box(M.ceiling, mx, my, zt - d, Math.atan2(nb.y - c.y, nb.x - c.x), bd, 0.32, d, { amb: 0.07, cell: 2.4, noTop: true, k: 0.42, tint: BEAM, bottom: { amb: 0.07, cell: 2.4, k: 0.3, tint: BEAM } });
      if (c.lvl === 'm' && (M.metal || M.steel)) { const ux = (nb.x - c.x) / bd, uy = (nb.y - c.y) / bd; for (const [o2, dz, r, kk] of [[0.27, 0.36, 0.032, 0.5], [0.36, 0.34, 0.019, 0.4]]) tube(M.metal || M.steel, [c.x - uy * o2, c.y + ux * o2, zt - dz], [nb.x - uy * o2, nb.y + ux * o2, zt - dz], r, r > 0.03 ? 6 : 4, { cell: 6, k: kk, amb: 0.07 }); }      /* pass 2: a pipe and a conduit run under the ceiling along each column row */
      if (due(++work, 30)) { yield; due.t = due.now ? due.now() : 0; } }
    // pass 2: cross beams, so the ceiling reads as bays and not as one plane. Mezzanine: from each column to the next one across (same s). Platform: from each column to the long wall behind it.
    for (const c of cols) { const s0 = sOf(c.x, c.y), t0 = tOf(c.x, c.y), zt = c.z + c.h, ang = F0.a + Math.PI / 2, o = { amb: 0.07, cell: 2.4, noTop: true, k: 0.42, tint: BEAM, bottom: { amb: 0.07, cell: 2.4, k: 0.3, tint: BEAM } }; let t1 = null;
      if (c.lvl === 'm') { let bd = 9.6; for (const q of cols) { if (q.lvl !== 'm') continue; const dt = tOf(q.x, q.y) - t0; if (dt > 1.5 && dt < bd && Math.abs(sOf(q.x, q.y) - s0) < 0.3) { bd = dt; t1 = t0 + dt; } } }
      else if (c.lvl === 'p' && S.tout && Math.abs(Math.abs(t0) - S.tout) < 5.5 && Math.abs(Math.abs(t0) - S.tout) > 1) t1 = Math.sign(t0) * (S.tout - 0.02);
      if (t1 === null) continue; const tm = (t0 + t1) / 2, d = c.lvl === 'm' ? 0.2 : 0.3; box(M.ceiling, F0.x + fca * s0 - fsa * tm, F0.y + fsa * s0 + fca * tm, zt - d, ang, Math.abs(t1 - t0), 0.3, d, o);
      if (c.lvl === 'm') box(M.ceiling, F0.x + fca * (s0 + 2.3) - fsa * tm, F0.y + fsa * (s0 + 2.3) + fca * tm, zt - 0.13, ang, Math.abs(t1 - t0), 0.2, 0.13, { ...o, cell: 12, bottom: { ...o.bottom, cell: 12 } }); if (due(++work, 30)) { yield; due.t = due.now ? due.now() : 0; } } }
  { const mc = THINGS.filter((t) => t.k === 'col' && t.lvl === 'm'), o = { amb: 0.06, cell: 12, noTop: true, k: 0.42, tint: BEAM, bottom: { amb: 0.06, cell: 12, k: 0.3, tint: BEAM } }; let nr = 0;      // pass 2: a hall with no columns in it (the rooms by the stairs) gets plain ribs across its ceiling
    for (const F of S.floors) { if ((F.k !== 'hall' && F.k !== 'passage' && F.k !== 'landing') || F.stair || Math.max(F.l, F.w) < 3.5) continue; part = WELL[F.k] ? 'well' : 'core'; let has = false; for (const c of mc) if (Math.abs(Walk.u(F, c.x, c.y)) <= F.l / 2 + 0.4 && Math.abs(Walk.v(F, c.x, c.y)) <= F.w / 2 + 0.4) { has = true; break; } if (has) continue;
      const along = F.l >= F.w, len = along ? F.l : F.w, wid = along ? F.w : F.l, n = Math.floor(len / 2.3); for (let i = 1; i <= n && nr < 220; i++, nr++) { const u = -len / 2 + (len - (n - 1) * 2.3) / 2 + (i - 1) * 2.3, p = along ? P(F, u, 0, 0) : P(F, 0, u, 0); box(M.ceiling, p[0], p[1], F.z0 + hM - 0.15, F.a + (along ? Math.PI / 2 : 0), wid - 0.02, 0.24, 0.15, o); } }
    part = 'core'; yield; }
  if (S.plen && S.tc && S.pw) { const zc = zP + hP, ed = S.tc.length > 1 ? Math.min(...S.tc.map((c) => Math.abs(c))) - S.pw / 2 : 0; if (ed > 2) for (let s0 = -S.plen / 2 + 2.3; s0 < S.plen / 2; s0 += 4.6) { box(M.ceiling, F0.x + fca * s0, F0.y + fsa * s0, zc - 0.5, F0.a + Math.PI / 2, ed * 2, 0.3, 0.5, { amb: 0.02, cell: 3.6, noTop: true, k: 0.07, bottom: { amb: 0.02, cell: 3.6, k: 0.05 } }); } yield; }
  // the colour band course along both outer walls, at the tablets' height
  part = 'core';
  if (S.plen && look.band) { const bm = SQ ? look.band({ color: S.color, style: 'sq' }) : look.band({ color: S.color, h: 0.25 }), bz = SQ ? zP + 2.37 : zP + 2.45, bh = SQ ? 0.432 : 0.25, h = S.plen / 2; bm.side = 2; bm.fog = false;
    for (const sd of [-1, 1]) { const t = sd * (S.tout - 0.012), a = [F0.x + fca * -h - fsa * t, F0.y + fsa * -h + fca * t], b = [F0.x + fca * h - fsa * t, F0.y + fsa * h + fca * t]; wallQuad(bm, a, b, bz, bz + bh, { amb: 0.06, v0: bz, in: -sd, cell: 2 }); } }
  yield;
  // station look pass 2 (Nov 17): what hangs on and runs along the long walls. Framed posters between the name tablets where the wall stands on a platform, the small name tile
  // repeated under the band, and a pair of conduits under the ceiling along each wall. One material (look.wallArt), no collision.
  if (S.plen && S.tout && S.tc && look.wallArt && !look.plain) { let WA = null; try { WA = look.wallArt(String(S.tablet || S.name || '').split(' ')[0] || 'ST', (S.id || '').length); WA.material.side = 2; WA.material.fog = false; } catch (e) { WA = null; }
    const tabs = THINGS.filter((t) => t.k === 'tablet').map((t) => [sOf(t.x, t.y), tOf(t.x, t.y)]), platWall = Math.abs(Math.max(...S.tc.map((c) => Math.abs(c))) + S.pw / 2 - S.tout) < 0.6, bz = SQ ? zP + 2.37 : zP + 2.45, h = S.plen / 2;
    const W3 = (s, t, z) => [F0.x + fca * s - fsa * t, F0.y + fsa * s + fca * t, z], clearOf = (s, t) => { const p = W3(s, t, 0); for (const G of PST) if (Math.abs(Walk.u(G, p[0], p[1])) <= G.l / 2 + 0.5 && Math.abs(Walk.v(G, p[0], p[1])) <= G.w / 2 + 0.9) return false; return true; };
    const art = (name, s, sd, z0, w, hh, off, o) => { const g = WA.reg[name], t = sd * (S.tout - off), a = W3(s - sd * w / 2, t, z0), b = W3(s + sd * w / 2, t, z0); quad(WA.material, a, b, [b[0], b[1], z0 + hh], [a[0], a[1], z0 + hh], [g[0], g[1]], [g[2], g[1]], [g[2], g[3]], [g[0], g[3]], o); };
    let n = 0;
    if (WA) for (const sd of [-1, 1]) { const ts = tabs.filter((q) => q[1] * sd > 0).map((q) => q[0]).sort((p, q) => p - q);
      for (let i = 0; i < ts.length; i++) { for (const ds of [-5.4, -2.7, 2.7, 5.4]) { const s = ts[i] + ds; if (Math.abs(s) < h - 1) art('num', s, sd, bz - 0.07 - WA.nh, WA.nw, WA.nh, 0.016, { amb: 0.06, cell: 3 }); }
        if (platWall && i + 1 < ts.length && ts[i + 1] - ts[i] > 7) { const s = (ts[i] + ts[i + 1]) / 2 + ((i % 3) - 1) * 1.3; if (!clearOf(s, sd * (S.tout - 0.5))) continue; const c = W3(s, sd * (S.tout - 0.03), 0);
          box(M.black, c[0], c[1], zP + 0.6, F0.a, WA.pw + 0.07, 0.045, WA.ph + 0.07, { flat: 0.09, cell: 3 }); art('p' + (n++ % 4), s, sd, zP + 0.635, WA.pw, WA.ph, 0.068, { amb: 0.06, cell: 1.2 }); } } }
    const pm = M.metal || M.steel; for (const sd of [-1, 1]) { for (const [dt, dz, r, k] of [[0.42, 0.36, 0.045, 0.5], [0.56, 0.34, 0.028, 0.42], [1.7, 0.335, 0.022, 0.45], [1.78, 0.325, 0.013, 0.4], [3.05, 0.34, 0.026, 0.42], [3.14, 0.325, 0.013, 0.5]]) tube(pm, W3(-h, sd * (S.tout - dt), zP + hP - dz), W3(h, sd * (S.tout - dt), zP + hP - dz), r, r > 0.03 ? 6 : 4, { cell: 9.2, k, amb: 0.06 });      /* pipes and conduits hang under the cross beams */
      if (platWall) for (let s = -h + 3.1, i = 0; s < h - 2; s += 9.2, i++) { const j = W3(s, sd * (S.tout - 1.72), 0); box(pm, j[0], j[1], zP + hP - 0.4, F0.a, 0.24, 0.17, 0.1, { amb: 0.06, k: 0.5, cell: 3, bottom: { amb: 0.06, k: 0.4, cell: 3 } });      /* junction boxes on the conduit, and a loudspeaker every other one */
        if (i % 2) { const q = W3(s + 4.4, sd * (S.tout - 2.5), 0); box(M.black, q[0], q[1], zP + hP - 0.62, F0.a, 0.22, 0.3, 0.26, { flat: 0.13, cell: 3, bottom: { flat: 0.2, cell: 3 } }); box(M.black, q[0], q[1], zP + hP - 0.36, F0.a, 0.03, 0.03, 0.36, { flat: 0.1, noTop: true, cell: 3 }); } } }
    if (!platWall) for (const sd of [-1, 1]) for (const [dz, r] of [[0.42, 0.022], [0.5, 0.018], [0.57, 0.022]]) tube(M.black, W3(-h, sd * (S.tout - 0.05), zP + dz), W3(h, sd * (S.tout - 0.05), zP + dz), r, 4, { cell: 9, flat: 0.12 });      // signal cables along the wall across the tracks
    yield; }
  // ---------------------------------------------------------------- meshes: the stair wells and passages stay drawn from the street; the rest only when someone is down there
  const core = new THREE.Group(), well = new THREE.Group(); core.name = 'core'; well.name = 'well'; group.add(well, core); let tris = 0, verts = 0;
  for (const [T, g] of [[BW, well], [B, core]]) for (const [mat, b] of T) { const m = b.mesh(THREE, 'sub_' + (mat.name || 'm')); if (m) { m.renderOrder = -20; m.updateMatrix(); g.add(m); tris += b.i.length / 3; verts += b.n; } }
  for (const gate of gates) { core.add(gate.arm); if (gate.screen) core.add(gate.screen); }
  return { gates, group, core, well, walk, lamps: lamps.length, tris, verts, signs };
}

// the materials when look.js is not there (or fails): plain colours, same names
export function plainLook(THREE) { const mk = (c, o = {}) => { const m = new THREE.MeshBasicMaterial({ color: c, vertexColors: true, fog: false, side: THREE.DoubleSide, ...o }); return m; }, glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false, toneMapped: false, side: THREE.DoubleSide });
  const mat = { tile: mk(0xd9d6cc), tileDark: mk(0x3c5a4a), floor: mk(0x8a8782), platform: mk(0x7d7a74), edge: mk(0xd8b020), stair: mk(0x8c8a84), ceiling: mk(0xb8b6ae), concrete: mk(0x4a4844), trackbed: mk(0x2e2c2a), steel: mk(0x24362c), metal: mk(0xa8aaac), rail: mk(0x5a5650), black: mk(0x0c0c0c),
    glowWarm: glow(3.2, 2.3, 1.2), glowWhite: glow(3.4, 3.4, 3.2), glowRed: glow(3, 0.2, 0.1), glowGreen: glow(0.2, 3, 0.6) }; for (const k in mat) mat[k].name = k; return { mat, plain: true }; }
