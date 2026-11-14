// subway/build.js: one station's underground as a handful of merged meshes, from its layout in subway.json (floor rects + things).
// Everything is unlit: the light of the lamps (and the daylight down an open stair) is worked out here per vertex and stored in the vertex colours.
// buildStation is a generator: it yields between pieces so the caller can spread the work over frames.
// Map (x, y, z up) -> scene (x, z, -y).
import { Walk } from './walk.js';

export const K = 0.30;            // scene units of a white surface right under a station lamp (daylight on the street is about 0.3 to 0.8)
const DAY = 1.5;                  // the sky down an open stair, in lamp units, at the top
const CELL = 1.25;                // largest side of a lit patch (m)
const LAMP = [1.0, 0.965, 0.88], SKY = [0.86, 0.93, 1.0];

class Bucket {
  constructor(mat) { this.mat = mat; this.p = []; this.u = []; this.c = []; this.i = []; this.n = 0; }
  v(x, y, z, u, v, r, g, b) { this.p.push(x, z, -y); this.u.push(u, v); this.c.push(r, g, b); return this.n++; }
  mesh(THREE, name) { if (!this.n) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); const m = new THREE.Mesh(g, this.mat); m.name = name; m.matrixAutoUpdate = false; m.castShadow = false; m.receiveShadow = false; return m; }
}

export function* buildStation(THREE, S, meta, look, opts = {}) {
  const walk = new Walk(meta), B = new Map(), M = look.mat, group = new THREE.Group(); group.name = 'subway_' + S.id;
  // two parts: 'well' (street stairs, landings, passages: drawn whenever the station is loaded, they are what is seen from the street) and 'core' (the rest: only drawn when someone is down there)
  let part = 'core'; const BW = new Map(), bk = (mat) => { const T = part === 'well' ? BW : B; let b = T.get(mat); if (!b) T.set(mat, (b = new Bucket(mat))); return b; };
  const F0 = S.frame || { x: S.floors[0].x, y: S.floors[0].y, a: S.floors[0].a }, fca = Math.cos(F0.a), fsa = Math.sin(F0.a);
  const sOf = (x, y) => (x - F0.x) * fca + (y - F0.y) * fsa, tOf = (x, y) => -(x - F0.x) * fsa + (y - F0.y) * fca;
  const zM = meta.zM, zP = meta.zP, hM = meta.hM, hP = meta.hP, rise = meta.rise, zW = meta.zWalk;
  for (const f of S.floors) walk.addFloor(f);

  // ---------------------------------------------------------------- the light
  const lamps = [], lg = new Map(), LC = 6;
  const addLamp = (x, y, z, I, reach, col = LAMP) => { const l = { x, y, z, I, reach, col }; lamps.push(l); for (let i = Math.floor((x - 9) / LC); i <= Math.floor((x + 9) / LC); i++) for (let j = Math.floor((y - 9) / LC); j <= Math.floor((y + 9) / LC); j++) { const k = i * 100003 + j; let a = lg.get(k); if (!a) lg.set(k, (a = [])); a.push(l); } };
  for (const t of S.things || []) if (t.k === 'lamp') addLamp(t.x, t.y, t.z, t.lvl === 'p' ? 1.9 : 1.5, t.lvl === 'p' ? 6.2 : 3.3);
  const wells = S.floors.filter((f) => f.k === 'street');
  for (const f of wells) { const d = meta.lOpen + 2.2 - f.l / 2; addLamp(f.x + f.ca * d, f.y + f.sa * d, Walk.zAt(f, d) + hM - 0.25, 1.1, 3.4); }      // one lamp under the slab of every street stair
  const out = [0, 0, 0];
  const light = (x, y, z, nx, ny, nz, amb) => { let r = amb, g = amb, b = amb; const a = lg.get(Math.floor(x / LC) * 100003 + Math.floor(y / LC));
    if (a) for (const l of a) { const dz = l.z - z; if (dz < -0.35 || dz > l.reach) continue; const dx = l.x - x, dy = l.y - y, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 81) continue; const d = Math.sqrt(d2) || 1e-3, cs = Math.abs(nx * dx + ny * dy + nz * dz) / d, e = l.I * (0.3 + 0.7 * cs) / (1 + d2 / 5.5) * (d2 > 49 ? (81 - d2) / 32 : 1); r += e * l.col[0]; g += e * l.col[1]; b += e * l.col[2]; }
    for (const f of wells) { const u = Walk.u(f, x, y) + f.l / 2, v = Walk.v(f, x, y); if (u < -1 || u > f.l + 5 || Math.abs(v) > 3) continue; const e = DAY * Math.exp(-Math.max(0, zW - z) / 2.4) * (u < meta.lOpen ? 1 : Math.exp(-(u - meta.lOpen) / 1.7)) * (Math.abs(v) > f.w / 2 + 0.1 ? Math.exp(-(Math.abs(v) - f.w / 2) / 0.8) : 1) * (0.55 + 0.45 * Math.abs(nz)); r += e * SKY[0]; g += e * SKY[1]; b += e * SKY[2]; }
    const m = Math.max(r, g, b), k = (m > 1.7 ? 1.7 / m : 1) * K; out[0] = r * k; out[1] = g * k; out[2] = b * k; return out; };

  // ---------------------------------------------------------------- a lit, tessellated quad: corners a b c d (map [x, y, z]) in order, uv at each
  const quad = (mat, a, b, c, d, ua, ub, uc, ud, o = {}) => { const bu = bk(mat), amb = o.amb ?? 0.085;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]; let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const cell = o.cell || CELL, nu = Math.min(160, Math.max(1, Math.ceil(Math.max(Math.hypot(...e1), Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2])) / cell))), nv = Math.min(160, Math.max(1, Math.ceil(Math.max(Math.hypot(...e2), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2])) / cell))), base = bu.n;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const s = i / nu, t = j / nv, w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = s * t, w3 = (1 - s) * t;
      const x = a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, y = a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3, z = a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3;
      let L; if (o.flat !== undefined) { out[0] = out[1] = out[2] = o.flat * (o.raw ? 1 : K); L = out; } else L = light(x + nx * 0.03 * (o.in || 0), y + ny * 0.03 * (o.in || 0), z, nx, ny, nz, amb); const k = o.k || 1;
      bu.v(x, y, z, ua[0] * w0 + ub[0] * w1 + uc[0] * w2 + ud[0] * w3, ua[1] * w0 + ub[1] * w1 + uc[1] * w2 + ud[1] * w3, L[0] * k, L[1] * k, L[2] * k); }
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

  // ---------------------------------------------------------------- what is beyond an edge of a flat floor: open floor, a platform edge, a drop, or nothing (a wall)
  const classify = (F, zF, x, y) => { let res = 'wall', top = 0;
    for (const G of walk.near(x, y)) { if (G === F) continue; const u = Walk.u(G, x, y); if (Math.abs(u) > G.l / 2) continue; if (Math.abs(Walk.v(G, x, y)) > G.w / 2) continue; const zG = Walk.zAt(G, u);
      if (F.k === 'pit') { if (G.k === 'pit') return 'open'; if (G.k === 'platform') { res = 'low'; top = zG; } continue; }
      if (G.k === 'pit') { if (F.k === 'platform') return 'edge'; continue; }
      if (Math.abs(zG - zF) <= 0.25 && (!G.stair || Math.abs(u) > G.l / 2 - 0.7)) return 'open';
      if (zG < zF - 0.25 && res === 'wall') res = 'rail'; }
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
    if (k === 'pit') { const a = P(F, -L, -W, z), b = P(F, L, -W, z), c = P(F, L, W, z), d = P(F, -L, W, z); quad(fmat, a, b, c, d, [sOf(a[0], a[1]), 0], [sOf(b[0], b[1]), 0], [sOf(c[0], c[1]), F.w], [sOf(d[0], d[1]), F.w], { amb: 0.03, cell: 2.5 }); }
    else flatQuad(fmat, F, -L, L, -W, W, z - e, { amb: 0.085 });
    if (k !== 'platform' && k !== 'pit') flatQuad(M.ceiling, F, -L, L, -W, W, z + hM + e, { amb: 0.10 });
    for (const [a, b, n] of edgesOf(F)) for (const sp of spans(F, z, a, b, n)) { const c = sp.c;
      if (c === 'open') continue;
      if (k === 'pit') { const st = inStation((sp.a[0] + sp.b[0]) / 2, (sp.a[1] + sp.b[1]) / 2);
        if (c.startsWith('low')) wallQuad(M.concrete, sp.a, sp.b, z, +c.slice(4), { amb: 0.03 });
        else if (st) { // the far wall across the tracks, seen from the platform: split where the station ends, tile above platform height
          wallQuad(M.concrete, sp.a, sp.b, z, zP + 0.1, { amb: 0.03 }); wallQuad(M.tile, sp.a, sp.b, zP + 0.1, zP + hP, { amb: 0.06, v0: zP }); }
        else wallQuad(M.concrete, sp.a, sp.b, z, zP + hP, { amb: 0.022, cell: 2.5 });
        continue; }
      if (c === 'edge') { // the platform's edge: the yellow strip just inside it
        const dx = sp.b[0] - sp.a[0], dy = sp.b[1] - sp.a[1], Ls = Math.hypot(dx, dy), u0 = (sp.a[0] * dx + sp.a[1] * dy) / Ls, zz = z + 0.004, i0 = [sp.a[0] - n[0] * 0.6, sp.a[1] - n[1] * 0.6], i1 = [sp.b[0] - n[0] * 0.6, sp.b[1] - n[1] * 0.6];
        quad(M.edge, [sp.a[0], sp.a[1], zz], [sp.b[0], sp.b[1], zz], [i1[0], i1[1], zz], [i0[0], i0[1], zz], [u0, 0], [u0 + Ls, 0], [u0 + Ls, 0.6], [u0, 0.6], { amb: 0.085 }); continue; }
      if (c === 'rail') { wallQuad(M.tileDark, sp.a, sp.b, z, z + 1.05, { amb: 0.085, v0: z }); wallQuad(M.concrete, sp.a, sp.b, z - 0.4, z, { amb: 0.05 });
        const dx = sp.b[0] - sp.a[0], dy = sp.b[1] - sp.a[1], Ls = Math.hypot(dx, dy) || 1, o2 = [n[1] * 0, 0]; const t = 0.05, a2 = [sp.a[0] + n[0] * t, sp.a[1] + n[1] * t], b2 = [sp.b[0] + n[0] * t, sp.b[1] + n[1] * t]; wallQuad(M.tileDark, a2, b2, z - 0.0, z + 1.05, { amb: 0.085, v0: z });
        quad(M.metal, [sp.a[0], sp.a[1], z + 1.05], [sp.b[0], sp.b[1], z + 1.05], [b2[0], b2[1], z + 1.05], [a2[0], a2[1], z + 1.05], [0, 0], [Ls, 0], [Ls, t], [0, t], { amb: 0.085 }); continue; }
      const top = k === 'platform' ? zP + hP : z + hM; wallQuad(M.tile, sp.a, sp.b, z, top, { amb: 0.085, v0: z, in: -1 }); }
    if (++work % 6 === 0) yield; }
  part = 'core';
  for (const C of S.ceils || []) for (const R of C.rects) { R.ca = Math.cos(R.a); R.sa = Math.sin(R.a); flatQuad(M.ceiling, R, -R.l / 2, R.l / 2, -R.w / 2, R.w / 2, R.z0, { amb: 0.05, cell: inStationRect(R) ? CELL : 3 }); if (++work % 6 === 0) yield; }
  function inStationRect(R) { return S.plen && Math.abs(sOf(R.x, R.y)) < S.plen / 2 + 20 && R.l < 60; }

  // ---------------------------------------------------------------- stairs
  for (const F of S.floors) { if (!F.stair) continue; part = WELL[F.k] ? 'well' : 'core'; const n = F.n || Math.round(Math.abs(F.z1 - F.z0) / rise), dn = F.z0 > F.z1 ? 1 : -1, zTop = Math.max(F.z0, F.z1), zBot = Math.min(F.z0, F.z1), tr = F.l / n, W = F.w / 2;
    // d = metres from the top edge along the way down; local u = dn * (d - l/2)
    const U = (d) => dn * (d - F.l / 2), lineZ = (d) => zTop - (d / F.l) * (zTop - zBot), stepZ = (i) => zTop - (i + 1) * rise;
    const street = F.k === 'street', lO = meta.lOpen, topAt = (d) => (street ? (d < lO - 1e-6 ? zW : Math.min(zW - meta.slab, lineZ(d) + hM)) : 0);
    for (let i = 0; i < n; i++) { const d0 = i * tr, d1 = d0 + tr, z = stepZ(i), a = P(F, U(d0), -W * dn, z), b = P(F, U(d0), W * dn, z), c = P(F, U(d1), W * dn, z), d = P(F, U(d1), -W * dn, z);
      quad(M.stair, a, b, c, d, [0, 0], [F.w, 0], [F.w, tr], [0, tr], { amb: 0.085, cell: 0.8 });                                         // tread: v = 0 at the nosing
      const ra = P(F, U(d0), -W * dn, z + rise), rb = P(F, U(d0), W * dn, z + rise); quad(M.stair, ra, rb, b, a, [0, 0.5 + rise], [F.w, 0.5 + rise], [F.w, 0.5], [0, 0.5], { amb: 0.085, cell: 0.8, k: 0.8 }); }      // riser
    if (street) {
      for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const d0 = i * tr, d1 = d0 + tr, z = stepZ(i), a = P(F, U(d0), sd * W, 0), b = P(F, U(d1), sd * W, 0); const t0 = topAt(d0 + 1e-4), t1 = topAt(d1 - 1e-4);
        wallQuad(M.tile, a, b, [z, z], [t0, t1], { amb: 0.085, v0: zM, u0: d0, in: -sd * dn }); }
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
      if (dc > 0 && dc < F.l) { for (const sd of [-1, 1]) wallQuad(M.tile, P(F, U(dc), sd * W, 0), P(F, U(F.l), sd * W, 0), zBot, [zLo(dc), zLo(F.l)], { amb: 0.07, v0: zBot });
        wallQuad(M.tile, P(F, U(dc), -W, 0), P(F, U(dc), W, 0), zBot, zLo(dc), { amb: 0.07, v0: zBot }); }
    }
    if (++work % 3 === 0) yield; }
  // a thin square rod between two map points (handrails)
  function rod(mat, a, b, r) { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * r, ny = dx / L * r; const o = { amb: 0.12, cell: 3 };
    quad(mat, [a[0] + nx, a[1] + ny, a[2] + r], [b[0] + nx, b[1] + ny, b[2] + r], [b[0] - nx, b[1] - ny, b[2] + r], [a[0] - nx, a[1] - ny, a[2] + r], [0, 0], [L, 0], [L, 2 * r], [0, 2 * r], o);
    for (const s of [-1, 1]) quad(mat, [a[0] + nx * s, a[1] + ny * s, a[2] - r], [b[0] + nx * s, b[1] + ny * s, b[2] - r], [b[0] + nx * s, b[1] + ny * s, b[2] + r], [a[0] + nx * s, a[1] + ny * s, a[2] + r], [0, 0], [L, 0], [L, 2 * r], [0, 2 * r], o); }

  // ---------------------------------------------------------------- tracks: running rails, the third rail and its glow
  part = 'core'; const glowMat = opts.glowMat;
  for (const T of S.tracks || []) { const dx = T.b[0] - T.a[0], dy = T.b[1] - T.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux, mid = [(T.a[0] + T.b[0]) / 2, (T.a[1] + T.b[1]) / 2], ang = Math.atan2(dy, dx), o = { amb: 0.035, cell: 4 };
    for (const g of [-0.7175, 0.7175]) box(M.rail, mid[0] + nx * g, mid[1] + ny * g, T.z - meta.railH, ang, L, 0.07, meta.railH, o);
    const g3 = T.side * 1.42;       // the third rail runs on the side away from the platform
    box(M.rail, mid[0] + nx * g3, mid[1] + ny * g3, T.z - 0.02, ang, L, 0.09, 0.11, o); box(M.black, mid[0] + nx * (g3 + T.side * 0.03), mid[1] + ny * (g3 + T.side * 0.03), T.z + 0.17, ang, L, 0.26, 0.035, { ...o, bottom: true });
    if (glowMat) { const bu = bk(glowMat), w0 = g3 - 0.4, w1 = g3 + 0.4, z = T.z - meta.railH + 0.012, N = Math.ceil(L / 6), base = bu.n;      // a soft warm pool on the track floor under the third rail (additive)
      for (let i = 0; i <= N; i++) { const s = i / N, px = T.a[0] + dx * s, py = T.a[1] + dy * s, fl = 0.75 + 0.25 * Math.sin(i * 12.9898) * Math.sin(i * 4.1); for (const [w, e] of [[w0, 0], [g3, 1], [w1, 0]]) bu.v(px + nx * w, py + ny * w, z, s * L, w, 0.15 * e * fl * K, 0.06 * e * fl * K, 0.01 * e * fl * K); }
      for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const p = base + i * 3 + j; bu.i.push(p, p + 3, p + 4, p, p + 4, p + 1); } }
    yield; }

  // ---------------------------------------------------------------- things
  const signs = new Map(), signOf = (key, make) => { let s = signs.get(key); if (!s) { s = make(); signs.set(key, s); const m = s.material; if (m && !m.vertexColors && !m.userData.subK) { m.userData.subK = 1; m.color.multiplyScalar(K * 1.25); } if (m) { m.side = 2; m.fog = false; } } return s; };
  const inWell = (x, y) => { for (const f of walk.near(x, y)) if (WELL[f.k] && f.k !== 'street' && Math.abs(Walk.u(f, x, y)) <= f.l / 2 && Math.abs(Walk.v(f, x, y)) <= f.w / 2) { let hall = false; for (const g of walk.near(x, y)) if (g.k === 'hall' && Math.abs(Walk.u(g, x, y)) <= g.l / 2 && Math.abs(Walk.v(g, x, y)) <= g.w / 2) hall = true; if (!hall) return true; } return false; };
  for (const t of S.things || []) { part = t.k === 'gate' || (t.k === 'lamp' && inWell(t.x, t.y)) ? 'well' : 'core';
    if (t.k === 'col') { box(M.steel, t.x, t.y, t.z, t.a, 0.3, 0.3, t.h, { amb: t.lvl === 't' ? 0.03 : 0.085, noTop: true, cell: 1.4 }); if (t.lvl !== 't') walk.addObstacle({ x: t.x, y: t.y, a: t.a, l: 0.3, w: 0.3, zlo: t.z - 0.3, zhi: t.z + 2 }); }
    else if (t.k === 'lamp') { box(M.black, t.x, t.y, t.z, t.a, 1.25, 0.2, 0.1, { flat: 0.25, noTop: true }); const f = { x: t.x, y: t.y, ca: Math.cos(t.a), sa: Math.sin(t.a) }; quad(M.glowWhite, P(f, -0.6, -0.08, t.z - 0.004), P(f, 0.6, -0.08, t.z - 0.004), P(f, 0.6, 0.08, t.z - 0.004), P(f, -0.6, 0.08, t.z - 0.004), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 1, raw: true }); }
    else if (t.k === 'bench') { box(M.steel, t.x, t.y, t.z + 0.4, t.a, 1.9, 0.5, 0.06, { amb: 0.085, bottom: true }); for (const d of [-0.8, 0.8]) box(M.black, t.x + Math.cos(t.a) * d, t.y + Math.sin(t.a) * d, t.z, t.a, 0.08, 0.44, 0.4, { amb: 0.085, noTop: true }); walk.addObstacle({ x: t.x, y: t.y, a: t.a, l: 1.9, w: 0.5, zlo: t.z - 0.3, zhi: t.z + 1 }); }
    else if (t.k === 'psign' && look.sign) { const sg = signOf('p|' + t.text + '|' + t.dirn + '|' + (t.routes || []).join(''), () => look.sign([{ text: t.text }, { text: t.dirn, routes: S.routes }], { h: 0.30 }));
      const hw = Math.min(sg.w, S.pw - 0.6) / 2, hh = hw / sg.w * sg.h, f = { x: t.x, y: t.y, ca: Math.cos(t.a + Math.PI / 2), sa: Math.sin(t.a + Math.PI / 2) };
      for (const dir of [1, -1]) { const o = 0.03 * dir, q = (u, z) => [f.x + f.ca * u * dir + Math.cos(t.a) * o, f.y + f.sa * u * dir + Math.sin(t.a) * o, z]; quad(sg.material, q(-hw, t.z - hh), q(hw, t.z - hh), q(hw, t.z + hh), q(-hw, t.z + hh), [0, 0], [1, 0], [1, 1], [0, 1], { flat: 1.15 }); }
      box(M.black, t.x, t.y, t.z - hh - 0.02, t.a + Math.PI / 2, hw * 2 + 0.04, 0.05, hh * 2 + 0.04, { flat: 0.05, bottom: true }); for (const d of [-hw * 0.7, hw * 0.7]) box(M.black, t.x + f.ca * d, t.y + f.sa * d, t.z + hh, t.a, 0.03, 0.03, zP + hP - t.z - hh, { flat: 0.1, noTop: true }); }
    else if (t.k === 'tablet' && look.tablet) { const tb = signOf('t|' + t.text, () => look.tablet(t.text, { color: S.color, h: 0.95 })), hw = tb.w / 2, hh = tb.h / 2, f = { x: t.x, y: t.y, ca: Math.cos(t.a + Math.PI / 2), sa: Math.sin(t.a + Math.PI / 2) }, ox = Math.cos(t.a) * 0.025, oy = Math.sin(t.a) * 0.025;
      const q = (u, z) => [f.x + f.ca * u + ox, f.y + f.sa * u + oy, z]; quad(tb.material, q(-hw, t.z - hh), q(hw, t.z - hh), q(hw, t.z + hh), q(-hw, t.z + hh), [0, 0], [1, 0], [1, 1], [0, 1], { amb: 0.06, in: 1 }); }
    else if (t.k === 'gate') { const F = S.floors.find((f) => f.k === 'landing' && f.ent === t.ent); if (F) { const a = P(F, F.l / 2 - 0.25, -F.w / 2, 0), b = P(F, F.l / 2 - 0.25, F.w / 2, 0); wallQuad(M.steel, a, b, zM, zM + hM, { amb: 0.085, v0: zM });
        if (look.sign) { const sg = signOf('closed', () => look.sign([{ text: 'This entrance is closed' }], { h: 0.16 })), hw = Math.min(F.w * 0.42, sg.w / 2), hh = hw / sg.w * sg.h, c = P(F, F.l / 2 - 0.28, 0, zM + 1.55); quad(sg.material, [c[0] + F.sa * hw, c[1] - F.ca * hw, c[2] - hh], [c[0] - F.sa * hw, c[1] + F.ca * hw, c[2] - hh], [c[0] - F.sa * hw, c[1] + F.ca * hw, c[2] + hh], [c[0] + F.sa * hw, c[1] - F.ca * hw, c[2] + hh], [0, 0], [1, 0], [1, 1], [0, 1], { flat: 0.9 }); }
        walk.addObstacle({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, a: F.a, l: 0.3, w: F.w, zlo: zM - 1, zhi: zM + 3 }); } }
    if (++work % 40 === 0) yield; }
  // the colour band course along both outer walls, at the tablets' height
  part = 'core';
  if (S.plen && look.band) { const bm = look.band({ color: S.color, h: 0.25 }), h = S.plen / 2;
    for (const sd of [-1, 1]) { const t = sd * (S.tout - 0.012), a = [F0.x + fca * -h - fsa * t, F0.y + fsa * -h + fca * t], b = [F0.x + fca * h - fsa * t, F0.y + fsa * h + fca * t]; wallQuad(bm, a, b, zP + 2.45, zP + 2.7, { amb: 0.06, v0: zP + 2.45, in: -sd, cell: 2 }); } }
  yield;
  // ---------------------------------------------------------------- meshes: the stair wells and passages stay drawn from the street; the rest only when someone is down there
  const core = new THREE.Group(), well = new THREE.Group(); core.name = 'core'; well.name = 'well'; group.add(well, core); let tris = 0, verts = 0;
  for (const [T, g] of [[BW, well], [B, core]]) for (const [mat, b] of T) { const m = b.mesh(THREE, 'sub_' + (mat.name || 'm')); if (m) { m.renderOrder = -20; m.updateMatrix(); g.add(m); tris += b.i.length / 3; verts += b.n; } }
  return { group, core, well, walk, lamps: lamps.length, tris, verts, signs };
}

// the materials when look.js is not there (or fails): plain colours, same names
export function plainLook(THREE) { const mk = (c, o = {}) => { const m = new THREE.MeshBasicMaterial({ color: c, vertexColors: true, fog: false, side: THREE.DoubleSide, ...o }); return m; }, glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false, toneMapped: false, side: THREE.DoubleSide });
  const mat = { tile: mk(0xd9d6cc), tileDark: mk(0x3c5a4a), floor: mk(0x8a8782), platform: mk(0x7d7a74), edge: mk(0xd8b020), stair: mk(0x8c8a84), ceiling: mk(0xb8b6ae), concrete: mk(0x4a4844), trackbed: mk(0x2e2c2a), steel: mk(0x24362c), metal: mk(0xa8aaac), rail: mk(0x5a5650), black: mk(0x0c0c0c),
    glowWarm: glow(3.2, 2.3, 1.2), glowWhite: glow(3.4, 3.4, 3.2), glowRed: glow(3, 0.2, 0.1), glowGreen: glow(0.2, 3, 0.6) }; for (const k in mat) mat[k].name = k; return { mat, plain: true }; }
