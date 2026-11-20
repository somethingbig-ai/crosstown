// hero/setts.js (brooklyn lane, Nov 16): DUMBO's Belgian-block streets. Six blind critic rounds named "smooth asphalt where the street is Belgian
// block" first, so the streets in LIST below get a ribbon of photographed granite setts over the roadway: rows running ACROSS the street, a strip
// of larger, flatter, paler stone down the middle of Washington St (as the real street has), every junction where two such streets meet filled
// out to the kerbs. An overlay of this lane's own: the streets lane's ground (streets/ground.js) is not touched; the ribbon lies at the height of
// the painted markings (12 mm) with a little more polygon offset than they have, so the paint and the asphalt patches are hidden on these streets
// at any distance, and the cars' contact shadows (which have more offset still) stay on top. Lit like the road: the sun and its shadow map, the
// city's baked light (facade.js BAKE_LIGHT_GLSL), fog, night. ONE draw call, one material, three 1k maps (Poly Haven "Cobblestone Floor 09", CC0:
// lanes/brooklyn/out/SOURCES.md). A map with no such street (every Manhattan map) builds nothing and fetches nothing. ?setts=0 = off.
// window.__setts for a look: { mesh, edges, fills, tris, mat, tone(k) }.
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';

// map metres (x east, y north). An edge is taken when its name matches AND its middle lies in BOX (and in the entry's own x range, if it has one).
export const BOX = [-700, -4720, 150, -4380];
export const LIST = [
  { re: /^washington st/i, strip: 1.7, railE: 2.55, stones: true },      // strip = half width of the flat-stone band down the middle; railE = the old track's centre, metres EAST of the street's; stones = each kerb stone its own piece
  { re: /^plymouth st/i, rail: 0 },           // rail = the old track's centre, metres to the right of the way the edge runs
  { re: /^water st/i }, { re: /^main st/i }, { re: /^dock st/i }, { re: /^john st/i },
  { re: /^front st/i, x1: -25 },              // Front St only between Old Fulton St and Jay St
];
const Y = 0.012, TU = 2.4, TV = 3.5;     /* round 10: two critics running read the setts as asphalt at 100 m: blocks 1.6 x real size so the pattern survives the distance */      // the lift; metres one repeat of the texture covers across (u) and along (v) the street
// round 12 (helper "kerbs"): relief. The roadway is crowned (real geometry: CROWN m higher at the middle than at the gutters, and the whole ribbon
// LIFT m over the old 12 mm so the streets lane's cover decals with their concrete squares are under the stone; this shader draws its own iron
// covers with setts up to the frame), tapered to the old height over TAPER m where a sett street runs into asphalt. KH / KW: the granite kerb.
const CROWN = 0.12, LIFT = 0.018, TAPER = 6, KH = 0.156, KW = 0.17, GAUGE = 1.435;
const STRIP_K = 1.45;                         // the middle band's stones are that much larger

const hyp = Math.hypot;
function pick(e) {
  const nm = e.name || ''; let ent = null; for (const l of LIST) if (l.re.test(nm)) { ent = l; break; }
  if (!ent || !e.pts || e.pts.length < 2) return null;
  let L = 0; const p = e.pts, cum = [0]; for (let i = 1; i < p.length; i++) cum.push(L += hyp(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  let s = L / 2, i = 1; while (i < p.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), mx = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, my = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
  if (mx < BOX[0] || mx > BOX[2] || my < BOX[1] || my > BOX[3]) return null;
  if (ent.x1 !== undefined && mx > ent.x1) return null; if (ent.x0 !== undefined && mx < ent.x0) return null;
  return { e, ent, cum, L };
}
// the point at s along an edge and the way it runs there
function at(p, cum, s) {
  let i = 1; while (i < p.length - 1 && cum[i] < s) i++;
  const l = (cum[i] - cum[i - 1]) || 1, t = (s - cum[i - 1]) / l, dx = (p[i][0] - p[i - 1][0]) / l, dy = (p[i][1] - p[i - 1][1]) / l;
  return { x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, y: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t, dx, dy };
}
function raySeg(ox, oy, dx, dy, a, b) {      // distance along the ray to the segment a-b, or Infinity
  const ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den, u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
  return t > 1e-4 && u >= -1e-4 && u <= 1.0001 ? t : Infinity;
}

const hs = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const colOffs = (h, c) => { const o = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((f) => f * h); if (c) o.push(-c, c); o.sort((a, b) => a - b); return o.filter((v, i) => !i || v - o[i - 1] > 0.05); };

// Pure geometry (no three.js, no fetch): { position, uv, normal, aP, aQ, dirt, dirtColor, edges, fills, tris ... } or null when the map has none of
// these streets. aP = (metres across from the centre line, metres along, kind 0 setts / 1 middle band / 2 kerb, the track's centre or 99);
// on a kerb aP = (0 foot of the face .. 0.5 arris .. 1 back of the top, stones along, 2, seed). aQ = (metres in from the kerb, seed).
export function build(city, opt = {}) {
  if (!city || !city.edges || !city.nodes) return null;
  const sel = new Map(); city.edges.forEach((e, i) => { const k = pick(e); if (k) sel.set(i, k); });
  if (!sel.size) return null;
  const CR = opt.crown === undefined ? CROWN : opt.crown, KERB = opt.kerb !== false;
  const N = city.nodes, pos = [], uv = [], aP = [], aQ = [], nor = [], dpos = [], dcol = [];
  const deg = (n) => (N[n] && N[n].e ? N[n].e.length : 0);
  const trim = (e, n, L) => (deg(n) >= 3 ? Math.min(N[n].r || 0, L / 2) : 0);
  const put = (q) => { pos.push(q.x, q.z, -q.y); uv.push(q.u, q.v); aP.push(q.p[0], q.p[1], q.p[2], q.p[3]); aQ.push(q.q[0], q.q[1]); nor.push(q.n[0], q.n[1], q.n[2]); };
  const tri = (a, b, c) => {      // wound to face the way a's normal points (world: x, height, -y)
    const ux = b.x - a.x, uy = b.z - a.z, uz = a.y - b.y, vx = c.x - a.x, vy = c.z - a.z, vz = a.y - c.y;
    if ((uy * vz - uz * vy) * a.n[0] + (uz * vx - ux * vz) * a.n[1] + (ux * vy - uy * vx) * a.n[2] < 0) { const t = b; b = c; c = t; }
    put(a); put(b); put(c);
  };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const want = new Map(); for (const [i, k] of sel) for (const n of [k.e.a, k.e.b]) if (deg(n) >= 3) { if (!want.has(n)) want.set(n, []); want.get(n).push(i); }
  const full = (n) => { const d = deg(n); return d >= 3 ? (want.get(n) || []).length >= 2 : d === 2 && N[n].e.every((i) => sel.has(i)); };      // the stone carries on past this end at full height
  const bsegs = []; for (const b of city.blocks || []) for (const r of [b.ext, ...(b.holes || [])]) {
    if (!r || r.length < 2) continue;
    for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length]; if (Math.max(a[0], c[0]) < BOX[0] - 120 || Math.min(a[0], c[0]) > BOX[2] + 120 || Math.max(a[1], c[1]) < BOX[1] - 120 || Math.min(a[1], c[1]) > BOX[3] + 120) continue; bsegs.push([a, c]); }
  }
  const kerbAt = (x, y, dx, dy) => { let t = Infinity; for (const s of bsegs) t = Math.min(t, raySeg(x, y, dx, dy, s[0], s[1])); return t; };      // from the centre line out to the first block edge
  const railOf = (k) => { const m = at(k.e.pts, k.cum, k.L / 2); return k.ent.railE !== undefined ? (m.dy >= 0 ? 1 : -1) * k.ent.railE : k.ent.rail !== undefined ? k.ent.rail : 99; };
  // one kerb stone (or one run of them) from (x0,y0) to (x1,y1) on the kerb line; (ox,oy) = the unit vector out of the road
  let nKerb = 0, kerbDev = 0;
  const kerb = (x0, y0, x1, y1, ox, oy, k0, k1, seed, dz0, dz1, dout) => {
    const nf = [-ox, 0.25, oy], nu = [0, 1, 0];
    const mk = (x, y, back, z, cr, k, n) => ({ x: x + ox * back, y: y + oy * back, z, u: k, v: cr, p: [cr, k, 2, seed], q: [9, seed], n });
    quad(mk(x0, y0, -0.035 + dout, 0, 0, k0, nf), mk(x1, y1, -0.035 + dout, 0, 0, k1, nf), mk(x1, y1, -0.012 + dout, KH + dz1, 0.5, k1, nf), mk(x0, y0, -0.012 + dout, KH + dz0, 0.5, k0, nf));
    quad(mk(x0, y0, -0.012 + dout, KH + dz0, 0.5, k0, nu), mk(x1, y1, -0.012 + dout, KH + dz1, 0.5, k1, nu), mk(x1, y1, KW, KH + dz1, 1, k1, nu), mk(x0, y0, KW, KH + dz0, 1, k0, nu));
    nKerb += 4;
  };
  // the first metre of sidewalk behind the kerb, darker (a second, see-through mesh: black with this much alpha)
  const dirt = (x0, y0, x1, y1, ox, oy) => {
    const rows = [[KW - 0.01, 0.40], [KW + 0.35, 0.20], [KW + 1.1, 0]], P = (x, y, r) => { dpos.push(x + ox * r[0], KH - 0.001, -(y + oy * r[0])); dcol.push(0.07, 0.065, 0.055, r[1]); };
    for (let i = 0; i < 2; i++) { P(x0, y0, rows[i]); P(x1, y1, rows[i]); P(x1, y1, rows[i + 1]); P(x0, y0, rows[i]); P(x1, y1, rows[i + 1]); P(x0, y0, rows[i + 1]); }
  };
  // ---- the ribbons
  let stone = 0;
  for (const [ei, k] of sel) {
    const e = k.e, p = e.pts, L = k.L, h = e.width / 2, sa = trim(e, e.a, L), sb = L - trim(e, e.b, L); if (sb - sa < 0.05) continue;
    const fa = full(e.a), fb = full(e.b), T = Math.min(TAPER, (sb - sa) / 3), seed = (ei * 0.6180339887) % 1, rc = railOf(k);
    let ss = [sa, sb]; for (let i = 1; i < p.length - 1; i++) if (k.cum[i] > sa + 0.2 && k.cum[i] < sb - 0.2) ss.push(k.cum[i]);
    if (!fa) ss.push(sa + T); if (!fb) ss.push(sb - T);
    ss.sort((a, b) => a - b); ss = ss.filter((s, i, a) => !i || s - a[i - 1] > 0.05);
    // one cross-section per station, mitred at bends inside the edge
    const st = ss.map((s, j) => {
      const q = at(p, k.cum, s); let dx = q.dx, dy = q.dy, m = 1;
      if (j > 0 && j < ss.length - 1) { const a = at(p, k.cum, s - 0.05), b = at(p, k.cum, s + 0.05); let tx = a.dx + b.dx, ty = a.dy + b.dy; const tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl; m = 1 / Math.max(0.5, tx * a.dx + ty * a.dy); dx = tx; dy = ty; }
      const f = Math.min(fa ? 1 : Math.min(1, (s - sa) / T), fb ? 1 : Math.min(1, (sb - s) / T));
      return { x: q.x, y: q.y, ux: dy, uy: -dx, nx: dy * m, ny: -dx * m, s, f };      // n = to the right of the way the edge runs
    });
    const c = k.ent.strip && k.ent.strip < h - 0.5 ? k.ent.strip : 0, offs = colOffs(h, c);
    const w = (S, o, kk) => {
      const ku = kk ? TU * STRIP_K : TU, kv = kk ? TV * STRIP_K : TV, t = Math.max(-1, Math.min(1, o / h)), sl = 2 * CR * S.f * t / h;
      return { x: S.x + S.nx * o, y: S.y + S.ny * o, z: Y + S.f * (LIFT + CR * (1 - t * t)), u: o / ku, v: S.s / kv, p: [o, S.s, kk, rc], q: [Math.max(0, h - Math.abs(o)), seed], n: [S.ux * sl, 1, -S.uy * sl] };
    };
    for (let j = 1; j < st.length; j++) {
      const A = st[j - 1], B = st[j];
      for (let i = 1; i < offs.length; i++) { const o0 = offs[i - 1], o1 = offs[i], kk = c && Math.abs(o0 + o1) / 2 < c ? 1 : 0; quad(w(A, o0, kk), w(A, o1, kk), w(B, o1, kk), w(B, o0, kk)); }
      if (KERB) for (const sg of [1, -1]) {
        // the kerb stands on the block's own edge (city.blocks), found by rays from the centre line near both ends and the middle of the stretch
        const cl = hyp(B.x - A.x, B.y - A.y); if (cl < 0.3) continue;
        const dxs = (B.x - A.x) / cl, dys = (B.y - A.y) / cl, ox = sg * dys, oy = -sg * dxs, e1 = Math.min(1, cl * 0.25);
        const tA = kerbAt(A.x + dxs * e1, A.y + dys * e1, ox, oy), tB = kerbAt(B.x - dxs * e1, B.y - dys * e1, ox, oy), tM = kerbAt((A.x + B.x) / 2, (A.y + B.y) / 2, ox, oy);
        if (!(tA > h - 1.5 && tA < h + 3 && Math.abs(tB - tA) < 0.5 && Math.abs(tM - (tA + tB) / 2) < 0.3)) continue;      // no straight sidewalk edge beside this stretch: no kerb
        kerbDev = Math.max(kerbDev, Math.abs(tM - h));
        if (Math.max(tA, tB) > h + 0.02) quad(w(A, sg * h, 0), w(A, sg * Math.max(h, tA), 0), w(B, sg * Math.max(h, tB), 0), w(B, sg * h, 0));      // the map's roadway is narrower than the gap between the kerbs here: setts out to the kerb
        const x0 = A.x + ox * tA, y0 = A.y + oy * tA, x1 = B.x + ox * tB, y1 = B.y + oy * tB, len = hyp(x1 - x0, y1 - y0);
        if (k.ent.stones) {
          for (let t0 = 0; t0 < len - 1e-3;) {
            let l = 1.2 + 0.7 * hs(stone, 1); if (len - t0 - l < 0.8) l = len - t0;
            const a = t0 / len, b = (t0 + l) / len, dz = (hs(stone, 2) - 0.5) * 0.010;
            kerb(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, ox, oy, stone, stone + 1, seed, dz, dz + (hs(stone, 3) - 0.5) * 0.007, (hs(stone, 4) - 0.5) * 0.018);
            t0 += l; stone++;
          }
        } else kerb(x0, y0, x1, y1, ox, oy, A.s / 1.5 + sg * 0.3, A.s / 1.5 + sg * 0.3 + len / 1.5, seed, 0, 0, 0);
        dirt(x0, y0, x1, y1, ox, oy);
      }
    }
  }
  const nRib = pos.length / 9 - nKerb;
  // ---- the junctions: a fan from the node out to the kerbs (city.blocks) and to the mouths of the streets that meet there
  let fills = 0;
  for (const [n, list] of want) {
    if (list.length < 2) continue;      // one sett street running into an asphalt junction: the junction stays asphalt
    const nd = N[n], cx = nd.p[0], cy = nd.p[1], caps = [], seed = (n * 0.7548776662) % 1; let R = 0;
    for (const ei of nd.e) {
      const e = city.edges[ei]; if (!e || !e.pts || e.pts.length < 2) continue;
      const p = e.a === n ? e.pts : e.pts.slice().reverse(); let L = 0; const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(L += hyp(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
      const q = at(p, cum, Math.min(nd.r || 0, L / 2)), h = e.width / 2;
      const a = [q.x + q.dy * h, q.y - q.dx * h], b = [q.x - q.dy * h, q.y + q.dx * h]; caps.push({ a, b, q, h, k: sel.get(ei) }); R = Math.max(R, hyp(a[0] - cx, a[1] - cy), hyp(b[0] - cx, b[1] - cy));
    }
    R += 0.5;
    const segs = caps.map((c) => [c.a, c.b]), pts = [], angs = []; for (const c of caps) pts.push(c.a, c.b);
    for (const [a, c] of bsegs) {
      if (Math.min(a[0], c[0]) > cx + R || Math.max(a[0], c[0]) < cx - R || Math.min(a[1], c[1]) > cy + R || Math.max(a[1], c[1]) < cy - R) continue;
      segs.push([a, c]); if (hyp(a[0] - cx, a[1] - cy) < R) pts.push(a);
    }
    for (let i = 0; i < 60; i++) angs.push(i * Math.PI / 30 - Math.PI);
    for (const q of pts) { const a = Math.atan2(q[1] - cy, q[0] - cx); angs.push(a - 2e-3, a, a + 2e-3); }
    // the ribbon's own columns on each sett mouth, so the fan meets its crowned end without a crack
    for (const c of caps) if (c.k) { const cc = c.k.ent.strip && c.k.ent.strip < c.h - 0.5 ? c.k.ent.strip : 0; for (const o of colOffs(c.h, cc)) if (Math.abs(o) < c.h - 0.01) angs.push(Math.atan2(c.q.y - c.q.dx * o - cy, c.q.x + c.q.dy * o - cx)); }
    angs.sort((a, b) => a - b);
    // the stones of the junction carry on from the street that runs through it (a name that arrives twice), else the first
    const names = list.map((i) => sel.get(i).e.name), main = sel.get(list.find((i, j) => names.indexOf(names[j]) !== names.lastIndexOf(names[j])) ?? list[0]);
    const me = main.e, isA = me.a === n, t0 = at(me.pts, main.cum, isA ? 0 : main.L), s0 = isA ? 0 : main.L, nx = t0.dy, ny = -t0.dx, rc = railOf(main);
    const w = (x, y, z, g) => ({ x, y, z, u: ((x - cx) * nx + (y - cy) * ny) / TU, v: (s0 + (x - cx) * t0.dx + (y - cy) * t0.dy) / TV, p: [(x - cx) * nx + (y - cy) * ny, s0 + (x - cx) * t0.dx + (y - cy) * t0.dy, 0, rc], q: [g, seed], n: [0, 1, 0] });
    const ring = angs.map((a) => {
      const dx = Math.cos(a), dy = Math.sin(a); let t = R, si = -1; for (let i = 0; i < segs.length; i++) { const u = raySeg(cx, cy, dx, dy, segs[i][0], segs[i][1]); if (u < t) { t = u; si = i; } }
      const x = cx + dx * t, y = cy + dy * t; let z = Y + LIFT, g = 0;
      if (si >= 0 && si < caps.length) { const c = caps[si]; if (c.k) { const o = (x - c.q.x) * c.q.dy - (y - c.q.y) * c.q.dx, tt = Math.min(1, Math.abs(o) / c.h); z = Y + LIFT + CR * (1 - tt * tt); g = c.h - Math.abs(o); } else { z = Y; g = 1; } }
      const v = w(x, y, z, Math.max(0, g)); v.si = si; return v;
    });
    const C0 = w(cx, cy, Y + LIFT + CR, 9);
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (hyp(a.x - b.x, a.y - b.y) < 1e-4) continue; tri(C0, b, a); }
    if (KERB) {      // kerb stones round the corners: runs of the ring that lie on block edges
      let run = null;
      const flush = () => {
        if (run) { const ex = run.b.x - run.a.x, ey = run.b.y - run.a.y, l = hyp(ex, ey); if (l > 0.12) { let ox = ey / l, oy = -ex / l; if (ox * (run.a.x - cx) + oy * (run.a.y - cy) < 0) { ox = -ox; oy = -oy; } kerb(run.a.x, run.a.y, run.b.x, run.b.y, ox, oy, run.k, run.k + l / 1.5, seed, 0, 0, 0); dirt(run.a.x, run.a.y, run.b.x, run.b.y, ox, oy); } }
        run = null;
      };
      let ks = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], l = hyp(a.x - b.x, a.y - b.y);
        if (a.si >= caps.length && b.si >= caps.length && (a.si === b.si || l < 1.0)) { if (run && run.si === a.si && a.si === b.si) run.b = b; else { flush(); run = { si: a.si === b.si ? a.si : -2, a, b, k: ks }; } ks += l / 1.5; } else flush();
      }
      flush();
    }
    fills++;
  }
  return { position: new Float32Array(pos), uv: new Float32Array(uv), normal: new Float32Array(nor), aP: new Float32Array(aP), aQ: new Float32Array(aQ), dirt: new Float32Array(dpos), dirtColor: new Float32Array(dcol),
    edges: sel.size, fills, tris: pos.length / 9 + dpos.length / 9, ribTris: nRib, kerbTris: nKerb, dirtTris: dpos.length / 9, stones: stone, kerbDev };
}

function material(W, maps) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: maps[0], normalMap: maps[1], roughnessMap: maps[2], roughness: 1, metalness: 0 });
  m.polygonOffset = true; m.polygonOffsetFactor = -2.6; m.polygonOffsetUnits = -5.2;      // over the road's paint (-2/-4) and patches (-2.5/-5), under the cars' contact shadows (-3/-6)
  const U = { uSettTone: { value: 0.95 }      /* after the first stills (runs/setts1): sunlit setts read as pale as the sidewalk */ }, shared = W.shared;
  m.onBeforeCompile = (sh) => {
    for (const k of ['tLight', 'uHalf', 'uSunColor', 'uShadowFar', 'uShadowCenter']) sh.uniforms[k] = shared[k]; sh.uniforms.uSettTone = U.uSettTone;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vWPos; attribute vec4 aP; attribute vec2 aQ; varying vec4 vP; varying vec2 vQ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vP = aP; vQ = aQ;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec4 vP; varying vec2 vQ; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; uniform float uSettTone;
        vec3 bakeV; vec3 bakeN; float stFlat; float stSteel;
        float stH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float stN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(stH(i), stH(i + vec2(1.0, 0.0)), f.x), mix(stH(i + vec2(0.0, 1.0)), stH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float kind = vP.z, band = step(0.5, kind) * step(kind, 1.5); stFlat = 0.55 * band; stSteel = 0.0;
          vec3 c = diffuseColor.rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          if (kind < 1.5) {
            float o = vP.x, s = vP.y, rc = vP.w, sd = vQ.y, fo = fwidth(o) + 1e-4, fine = 0.8 + 0.4 * stN(vWPos.xz * 3.1);
            c = mix(vec3(l), c, 0.25) * vec3(0.97, 0.99, 1.1);                       // New York granite: grey with a little brown, not the scan's earth brown
            c *= pow(clamp(l / 0.09, 0.2, 3.0), 1.15);                               // the joints darker, the worn tops paler
            float run = smoothstep(0.38, 0.62, stN(vec2(s * 0.055 + sd * 17.0, o * 0.22 + sd * 5.0)));      // runs of darker and paler block, relaid at different times
            c *= 0.78 + 0.20 * stN(vWPos.xz * 0.11) + 0.10 * stN(vWPos.xz * 0.9 + 7.0) + 0.17 * run;      // no two metres of an old street the same tone
            c = mix(c, vec3(dot(c, vec3(0.3333))) * 0.74, 0.75 * band);              // the running strip down the middle: flat slabs, greyer, darker, worn
            c *= mix(0.60, 1.0, smoothstep(-0.15, 1.2, vQ.x + 0.6 * (stN(vec2(s * 0.35, sd * 9.0)) - 0.5)));      // the gutters dark with dirt, the crown clean
            // repair patches: asphalt (most) or concrete, square to the street, one in about half of every 17 m
            float cl = floor(s / 17.0), h1 = stH(vec2(cl, sd * 31.0 + 1.0)), h2 = stH(vec2(cl, sd * 31.0 + 2.0)), h3 = stH(vec2(cl, sd * 31.0 + 3.0));
            vec2 pd = abs(vec2(s, o) - vec2((cl + 0.25 + 0.5 * h2) * 17.0, (h3 - 0.5) * 5.0)) - vec2(1.1 + 2.4 * h2 * h3 + 0.8 * h1, 0.6 + 1.1 * h3) + 0.14 * (stN(vec2(s, o) * 1.7) - 0.5);
            float pm = step(h1, 0.48) * (1.0 - band) * (1.0 - smoothstep(-0.03, 0.03, max(pd.x, pd.y)));
            c = mix(c, mix(vec3(0.075, 0.075, 0.08), vec3(0.21, 0.205, 0.195), step(0.72, fract(h1 * 7.3))) * fine, pm);
            // the old freight track: two rails, a flangeway inside each, stretches of it under an asphalt strip
            if (rc < 50.0) {
              float side = step(0.0, o - rc), a = abs(o - rc) - ${(GAUGE / 2).toFixed(4)}, hw = clamp(0.75 * fo, 0.04, 0.12);
              float bur = smoothstep(0.56, 0.66, stN(vec2(s * 0.045 + sd * 3.0, side * 7.0 + 0.5)));
              float tar = bur * (1.0 - smoothstep(0.17, 0.23, abs(a) + 0.05 * (stN(vec2(s * 2.3, side)) - 0.5)));
              float rl = (1.0 - bur) * (1.0 - smoothstep(hw - 0.5 * fo, hw + 0.5 * fo, abs(a)));
              float gr = (1.0 - bur) * (1.0 - smoothstep(0.025, 0.025 + fo, abs(a + hw + 0.03)));
              c = mix(c, vec3(0.07) * fine, tar); c = mix(c, vec3(0.02), 0.85 * gr);
              c = mix(c, vec3(0.085, 0.075, 0.07) + 0.05 * (1.0 - smoothstep(0.0, 0.02, abs(a))), rl);      /* after runs/setts2: 0.15 brown + 0.12 read as brass in the sun */
              stSteel = rl; pm = max(pm, max(tar, rl));
            }
            // an iron cover now and then, the setts laid up to its frame (the streets lane's covers lie under the crown)
            {
              float cm = floor(s / 41.0), g1 = stH(vec2(cm, sd * 13.0 + 5.0)), g2 = stH(vec2(cm, sd * 13.0 + 6.0));
              vec2 cc = vec2(s - (cm + 0.3 + 0.4 * g2) * 41.0, o - (rc < 50.0 ? rc : (g2 - 0.5) * 2.2)); float r = length(cc);
              if (g1 < 0.6 && r < 0.5) {
                float fr = fwidth(r) + 1e-4, pat = (0.5 + 0.5 * sign(sin(cc.x * 52.0) * sin(cc.y * 52.0))) * clamp(1.5 - fr * 26.0, 0.0, 1.0);
                vec3 ir = vec3(0.05, 0.044, 0.04) * (0.8 + 0.55 * pat * step(r, 0.31) + 0.5 * step(0.33, r) * step(r, 0.365));
                ir = mix(ir, vec3(0.015), smoothstep(0.372, 0.380, r) * (1.0 - smoothstep(0.392, 0.400, r)));
                float cv = 1.0 - smoothstep(0.455 - fr, 0.455 + fr, r);
                c = mix(c, ir, cv); pm = max(pm, cv); stSteel = max(stSteel, 0.6 * cv);
              }
            }
            stFlat = max(stFlat, pm);
            c *= 1.0 + 0.08 * pow(1.0 - clamp(dot(normalize(vViewPosition), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0, 1.0), 3.0);      // paler at a grazing angle, as the road is
            diffuseColor.rgb = c * uSettTone;
          } else {
            // the kerb: grey speckled granite, a joint between stones, each stone its own tone, the foot of the face dirty, the arris worn
            float ks = vP.y, cr = vP.x, tone = stH(vec2(floor(ks), vP.w * 91.0)), fk = fwidth(ks) + 1e-5;
            vec2 wp = vWPos.xz + vWPos.y * vec2(3.0, 1.7); float grain = clamp(1.3 - fwidth(wp.x) * 150.0, 0.0, 1.0), sp = stH(floor(wp * 170.0));
            vec3 k = vec3(0.20, 0.20, 0.212) * (0.80 + 0.32 * tone) * (0.80 + 0.22 * stN(wp * 36.0) * grain + 0.11 * (1.0 - grain) + 0.18 * stN(wp * 4.0));
            k = mix(k, vec3(0.06), 0.75 * grain * step(0.88, sp)); k = mix(k, vec3(0.46), 0.55 * grain * step(sp, 0.08));
            float j = min(fract(ks), 1.0 - fract(ks));
            k *= 1.0 - 0.72 * (1.0 - smoothstep(0.008 - 0.5 * fk, 0.008 + 0.5 * fk, j)) * clamp(0.03 / fk, 0.0, 1.0);
            k *= mix(0.50, 1.0, smoothstep(0.0, 0.38, cr)) * (1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.07, abs(cr - 0.5)))) * mix(1.0, 0.78, smoothstep(0.75, 1.0, cr));
            diffuseColor.rgb = k; stFlat = 1.0;
          }
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.68, stSteel); if (vP.z > 1.5) roughnessFactor = 0.82;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, stFlat));`)
      .replace('#include <aomap_fragment>', '\n bakeN = vec3(0.0, 1.0, 0.0); bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb;\n' + BAKE_LIGHT_GLSL);
  };
  m.customProgramCacheKey = () => 'bk-setts-4';
  m.userData.U = U;
  return m;
}
// the dirt on the first metre of sidewalk: unlit black, alpha from the vertices, broken up by noise
function dirtMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vDW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vDW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vDW;
        float dH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float dN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(dH(i), dH(i + vec2(1.0, 0.0)), f.x), mix(dH(i + vec2(0.0, 1.0)), dH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= 0.35 + 1.5 * dN(vDW.xz * 0.6) * dN(vDW.xz * 2.7 + 4.0) + 0.25 * dN(vDW.xz * 9.0);');
  };
  m.customProgramCacheKey = () => 'bk-setts-dirt-1';
  return m;
}

export async function install(game) {
  const W = game.world, city = game.city; if (!W || !W.scene || !W.shared || !city) return null;
  const P = game.P, num = (k) => (P && P.get && P.get(k) !== null && isFinite(+P.get(k)) ? +P.get(k) : undefined);      // ?settcrown=0.05 (metres; 0 = flat), ?settkerb=0 (no kerb stones, no dirt)
  const g = build(city, { crown: num('settcrown'), kerb: num('settkerb') !== 0 }); if (!g) return null;      // no such street on this map: nothing built, nothing fetched
  const ld = new THREE.TextureLoader(), an = Math.min(16, (W.renderer && W.renderer.capabilities.getMaxAnisotropy && W.renderer.capabilities.getMaxAnisotropy()) || 4);
  const tex = (f, srgb) => ld.loadAsync('assets/tex/' + f).then((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = an; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; });
  const maps = await Promise.all([tex('setts_floor09_diff.jpg', true), tex('setts_floor09_nor.jpg'), tex('setts_floor09_rough.jpg')]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2)); geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  geo.setAttribute('aP', new THREE.BufferAttribute(g.aP, 4)); geo.setAttribute('aQ', new THREE.BufferAttribute(g.aQ, 2));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const mat = material(W, maps), mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'hero:setts'; mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  W.scene.add(mesh);
  let dirt = null;
  if (g.dirt.length) {
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(g.dirt, 3)); dg.setAttribute('color', new THREE.BufferAttribute(g.dirtColor, 4)); dg.computeBoundingSphere(); dg.computeBoundingBox();
    dirt = new THREE.Mesh(dg, dirtMaterial()); dirt.name = 'hero:setts-dirt'; dirt.matrixAutoUpdate = false; dirt.updateMatrix(); W.scene.add(dirt);
  }
  const api = { mesh, dirt, mat, edges: g.edges, fills: g.fills, tris: g.tris, tone: (k) => { mat.userData.U.uSettTone.value = k; } };
  if (typeof window !== 'undefined') window.__setts = api;
  console.log('[setts] ' + g.edges + ' streets, ' + g.fills + ' junctions, ' + g.tris + ' triangles (' + g.kerbTris + ' kerb, ' + g.dirtTris + ' dirt), ' + (dirt ? 2 : 1) + ' draw calls');
  return api;
}
