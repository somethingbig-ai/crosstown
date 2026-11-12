// ground.js (lanes/streets, part GROUND): road, sidewalk, kerb, markings and the flat things set into them.
// Everything is a rule over city.json; nothing is placed by hand or keyed to a camera.
//   - a "field" texture rendered once on the GPU from the kerb lines, building walls and junctions (distance to kerb on the grid,
//     distance to kerb off the grid, distance to a wall, distance to a junction) drives the shaders: flag orientation, kerb dirt, gutter, gum;
//   - the sidewalk is re-triangulated from city.blocks with a notch at every crosswalk end, filled by a ramp with flares;
//   - the kerb is rebuilt (face + top stone with a height profile that drops at ramps), plus a kerb-side band of paving on long kerbs;
//   - every street gets a ribbon over the road plane carrying lane coordinates (wheel paths, oil, paving sections, stop-line build-up);
//   - markings are rebuilt from the lead's rules (prep.py) with per-quad wear, plus arrows and legends from a canvas atlas;
//   - decals from real textures: manhole covers, valve boxes, drain inlets, vault grates, cellar plates, tactile pads, gutter litter.
// Replaces at load: the materials of road_* and grass_*; hides sidewalk_*, curb_*, marks_* of the lead's city (they are rebuilt here).
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';

const CURB = 0.15, FLAG = 1.22, D2R = Math.PI / 180;
const RAMP_HW = 0.9, RAMP_FL = 0.5, RAMP_DEP = 1.35, RAMP_LOW = 0.022, KERB_W = 0.18, BAND_W = 1.1;
const FIELD_D = 12, FIELD_DB = 6, FIELD_DN = 24;

// ------------------------------------------------------------------ small helpers (CPU)
const fract = (v) => v - Math.floor(v);
function rnd(a, b = 0, c = 0) { const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + 1.3) * 43758.5453; return v - Math.floor(v); }
function ringArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function pointInRing(p, x, y) {
  let c = false;
  for (let i = 0, n = p.length, j = n - 1; i < n; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return [Math.hypot(px - x1 - dx * t, py - y1 - dy * t), t];
}
class SegGrid {
  constructor(c) { this.c = c; this.m = new Map(); }
  add(x1, y1, x2, y2, ref) {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (this.c * 0.5))); let last = null;
    for (let k = 0; k <= n; k++) {
      const ky = Math.floor((x1 + (x2 - x1) * k / n) / this.c) * 100003 + Math.floor((y1 + (y2 - y1) * k / n) / this.c);
      if (ky !== last) { let a = this.m.get(ky); if (!a) this.m.set(ky, a = []); if (a[a.length - 1] !== ref) a.push(ref); last = ky; }
    }
  }
  near(x, y, cb) { const i = Math.floor(x / this.c), j = Math.floor(y / this.c); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = this.m.get((i + a) * 100003 + j + b); if (l) for (const r of l) cb(r); } }
}
// accumulators: one set of attribute arrays per (mesh type, map tile)
class Acc {
  constructor(spec, tile = 200) { this.spec = spec; this.tile = tile; this.t = new Map(); this.n = 0; }
  get(x, y) { const k = Math.floor((x + 4000) / this.tile) * 1000 + Math.floor((y + 4000) / this.tile); let a = this.t.get(k); if (!a) { a = {}; for (const s in this.spec) a[s] = []; this.t.set(k, a); } return a; }
  meshes(material, setup) {
    const out = [];
    for (const a of this.t.values()) {
      const g = new THREE.BufferGeometry();
      for (const s in this.spec) g.setAttribute(s, new THREE.BufferAttribute(new Float32Array(a[s]), this.spec[s]));
      if (!g.attributes.normal) { const nv = new Float32Array(g.attributes.position.count * 3); for (let i = 1; i < nv.length; i += 3) nv[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nv, 3)); }
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, material); m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); setup && setup(m);
      this.n += g.attributes.position.count / 3; out.push(m);
    }
    return out;
  }
}

// ------------------------------------------------------------------ the city, read once
function gridAngleDeg(city) {
  // direction of the street grid modulo 90 degrees, from the street centre lines (length-weighted peak of the direction histogram)
  const bins = new Float64Array(360);
  for (const e of city.edges) for (let i = 1; i < e.pts.length; i++) {
    const dx = e.pts[i][0] - e.pts[i - 1][0], dy = e.pts[i][1] - e.pts[i - 1][1], L = Math.hypot(dx, dy); if (L < 2) continue;
    const a = ((Math.atan2(dy, dx) / D2R) % 90 + 90) % 90; bins[Math.floor(a * 4) % 360] += L;
  }
  let pk = 0; for (let i = 0; i < 360; i++) if (bins[i] > bins[pk]) pk = i;
  let sw = 0, sa = 0; for (let d = -8; d <= 8; d++) { const w = bins[(pk + d + 360) % 360]; sw += w; sa += w * (pk + d + 0.5) / 4; }
  return sa / sw;
}
const offGrid = (deg, grid) => { let d = ((deg - grid) % 90 + 90) % 90; if (d > 45) d -= 90; return d; };   // -45..45

function mkEdge(e, ei, nodes) {
  const p = e.pts, cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const L = cum[cum.length - 1], na = nodes[e.a], nb = nodes[e.b];
  const ra = na && na.e.length >= 3 ? na.r : 0, rb = nb && nb.e.length >= 3 ? nb.r : 0;
  const n = e.lanes, lw = n > 1 ? 3.3 : 3.4;
  const odd2 = !e.oneway && n % 2 === 1 && n >= 3;
  return { e, ei, p, cum, L, ra, rb, n, lw, wn: odd2 ? n - 1 : n, wlw: odd2 ? n * lw / (n - 1) : lw, hlf: n * lw / 2, W: e.width, oneway: !!e.oneway, ave: !!e.ave, seed: fract(ei * 0.6180339) + 0.013 };
}
function at(E, s) {
  const { p, cum } = E; s = Math.max(0, Math.min(E.L, s)); let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const l = cum[i + 1] - cum[i] || 1, f = (s - cum[i]) / l, dx = (p[i + 1][0] - p[i][0]) / l, dy = (p[i + 1][1] - p[i][1]) / l;
  return { x: p[i][0] + (p[i + 1][0] - p[i][0]) * f, y: p[i][1] + (p[i + 1][1] - p[i][1]) * f, dx, dy };
}
function atSmooth(E, s) {   // tangent averaged over a metre: offsets stay continuous through polyline bends
  const q = at(E, s), a = at(E, s - 0.5), b = at(E, s + 0.5); const dx = a.dx + b.dx, dy = a.dy + b.dy, l = Math.hypot(dx, dy) || 1; q.dx = dx / l; q.dy = dy / l; return q;
}
function breaks(E, s0, s1) { const o = [s0]; for (const c of E.cum) if (c > s0 + 0.05 && c < s1 - 0.05) o.push(c); o.push(s1); return o; }

function readCity(city) {
  const grid = gridAngleDeg(city);
  const E = city.edges.map((e, i) => mkEdge(e, i, city.nodes));
  const eg = new SegGrid(40);
  for (const ed of E) for (let i = 1; i < ed.p.length; i++) eg.add(ed.p[i - 1][0], ed.p[i - 1][1], ed.p[i][0], ed.p[i][1], { x1: ed.p[i - 1][0], y1: ed.p[i - 1][1], x2: ed.p[i][0], y2: ed.p[i][1], ed });
  const rings = [], rg = new SegGrid(40);
  city.blocks.forEach((b, bi) => {
    [b.ext, ...(b.holes || [])].forEach((r, k) => {
      const pts = []; for (const q of r) { const l = pts[pts.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-3) pts.push([q[0], q[1]]); }
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) pts.pop();
      if (pts.length < 3) return;
      if ((ringArea(pts) > 0) !== (k === 0)) pts.reverse();          // sidewalk always on the left of the direction of travel
      const ring = { pts, bi, hole: k > 0, segs: [], seed: rnd(bi, k, 7) }; let run = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), dx = (c[0] - a[0]) / (L || 1), dy = (c[1] - a[1]) / (L || 1);
        const sg = { ring, i, a, b: c, L, dx, dy, nx: -dy, ny: dx, run, notches: [], ave: false, ed: null, off: 0 }; run += L;
        const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2; let best = 60;
        eg.near(mx, my, (r) => { const d = segDist(mx, my, r.x1, r.y1, r.x2, r.y2)[0]; if (d < best) { best = d; sg.ed = r.ed; } });
        sg.ave = !!(sg.ed && sg.ed.ave);
        const og = offGrid(Math.atan2(dy, dx) / D2R, grid); if (L >= 5 && Math.abs(og) > 3) sg.off = Math.round(og * 2) / 2;   // half-degree steps
        ring.segs.push(sg); if (L > 0.01) rg.add(a[0], a[1], c[0], c[1], sg);
      }
      rings.push(ring);
    });
  });
  // kerb ramps: where the middle of each crosswalk meets the kerb, on a straight kerb long enough to take the ramp and its flares
  const ramps = [];
  for (const ed of E) for (const end of [0, 1]) {
    const r_ = end ? ed.rb : ed.ra; if (!r_) continue;
    const sC = end ? ed.L - r_ - 2.05 : r_ + 2.05; if (sC < 0 || sC > ed.L || ed.L < 2 * r_ + 9) continue;
    const q = at(ed, sC), node = city.nodes[end ? ed.e.b : ed.e.a];
    for (const sgn of [-1, 1]) {
      const px = q.x + q.dy * sgn * ed.W / 2, py = q.y - q.dx * sgn * ed.W / 2; let best = 1.6, hit = null, ht = 0;
      rg.near(px, py, (sg) => {
        if (sg.L < 2 * (RAMP_HW + RAMP_FL) + 0.5 || Math.abs(sg.dx * q.dx + sg.dy * q.dy) < 0.9) return;
        const [d, t] = segDist(px, py, sg.a[0], sg.a[1], sg.b[0], sg.b[1]); if (d < best) { best = d; hit = sg; ht = t * sg.L; }
      });
      if (!hit) continue;
      const lim = RAMP_HW + RAMP_FL + 0.25; ht = Math.max(lim, Math.min(hit.L - lim, ht));
      const qx = hit.a[0] + hit.dx * ht + hit.nx * (RAMP_DEP + 0.6), qy = hit.a[1] + hit.dy * ht + hit.ny * (RAMP_DEP + 0.6);
      if (pointInRing(hit.ring.pts, qx, qy) === hit.ring.hole) continue;       // the block is too thin here
      const kx = hit.a[0] + hit.dx * ht, ky = hit.a[1] + hit.dy * ht;
      hit.notches.push({ t: ht, node, away: (kx - node.p[0]) * hit.dx + (ky - node.p[1]) * hit.dy > 0 ? 1 : -1, seed: rnd(node.p[0], node.p[1], 3) });
    }
  }
  for (const ring of rings) for (const sg of ring.segs) {
    if (!sg.notches.length) continue;
    sg.notches.sort((a, b) => a.t - b.t); const keep = [];
    for (const nt of sg.notches) if (!keep.length || nt.t - keep[keep.length - 1].t > 2 * (RAMP_HW + RAMP_FL) + 0.3) keep.push(nt);
    sg.notches = keep; for (const nt of keep) ramps.push({ sg, nt });
  }
  return { city, grid, E, rings, ramps, eg, rg };
}

// ------------------------------------------------------------------ static meshes: sidewalk, ramps, kerb, kerb band, ribbons, markings
const P3 = (x, y, h) => [x, h, -y];
function pushTri(a, A, B, C) {
  a.position.push(...A, ...B, ...C);
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (a.normal) a.normal.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function buildSidewalk(C) {
  const acc = new Acc({ position: 3, normal: 3, aS: 4 });
  const byBlock = new Map(); for (const r of C.rings) { if (!byBlock.has(r.bi)) byBlock.set(r.bi, []); byBlock.get(r.bi).push(r); }
  for (const rs of byBlock.values()) {
    const loops = rs.map((ring) => {
      const out = [];
      for (const sg of ring.segs) {
        out.push(new THREE.Vector2(sg.a[0], sg.a[1]));
        for (const nt of sg.notches) {
          const P = (t, d) => [sg.a[0] + sg.dx * t + sg.nx * d, sg.a[1] + sg.dy * t + sg.ny * d];
          const Bl = P(nt.t - RAMP_HW - RAMP_FL, 0), Al = P(nt.t - RAMP_HW, 0), Ar = P(nt.t + RAMP_HW, 0), Br = P(nt.t + RAMP_HW + RAMP_FL, 0), Cl = P(nt.t - RAMP_HW, RAMP_DEP), Cr = P(nt.t + RAMP_HW, RAMP_DEP);
          out.push(new THREE.Vector2(...Bl), new THREE.Vector2(...Cl), new THREE.Vector2(...Cr), new THREE.Vector2(...Br));
          const a = acc.get(Al[0], Al[1]), z = [0, 0, 0, 0];
          const tri = (p, q, r) => { pushTri(a, p, q, r); a.aS.push(...z, ...z, ...z); };
          tri(P3(...Al, RAMP_LOW), P3(...Ar, RAMP_LOW), P3(...Cr, CURB)); tri(P3(...Al, RAMP_LOW), P3(...Cr, CURB), P3(...Cl, CURB));
          tri(P3(...Bl, CURB), P3(...Al, RAMP_LOW), P3(...Cl, CURB)); tri(P3(...Ar, RAMP_LOW), P3(...Br, CURB), P3(...Cr, CURB));
        }
      }
      return out;
    });
    const ext = loops[rs.findIndex((r) => !r.hole)], holes = loops.filter((l, i) => rs[i].hole); if (!ext) continue;
    const all = ext.concat(...holes); let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(ext, holes); } catch (e) { tris = []; }
    for (const t of tris) {
      let [p, q, r] = [all[t[0]], all[t[1]], all[t[2]]];
      if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0) [q, r] = [r, q];
      const a = acc.get((p.x + q.x + r.x) / 3, (p.y + q.y + r.y) / 3);
      a.position.push(p.x, CURB, -p.y, q.x, CURB, -q.y, r.x, CURB, -r.y); a.normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0); a.aS.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }
  return acc;
}

function buildKerb(C) {
  const kerb = new Acc({ position: 3, normal: 3, aK: 4 }), band = new Acc({ position: 3, normal: 3, aS: 4 });
  const cIn = (CURB - RAMP_LOW) * KERB_W / RAMP_DEP;
  for (const ring of C.rings) for (const sg of ring.segs) {
    if (sg.L < 0.02) continue;
    // height profile of the kerb top along the segment: [t, outer height, inner height]
    const bp = [[0, CURB, CURB]];
    for (const nt of sg.notches) {
      const tB = nt.t - RAMP_HW - RAMP_FL, tA = nt.t - RAMP_HW, k = cIn / (CURB - RAMP_LOW);
      bp.push([tB, CURB, CURB], [tB + (tA - tB) * k, CURB - cIn, CURB], [tA, RAMP_LOW, RAMP_LOW + cIn], [nt.t + RAMP_HW, RAMP_LOW, RAMP_LOW + cIn],
        [nt.t + RAMP_HW + RAMP_FL * (1 - k), CURB - cIn, CURB], [nt.t + RAMP_HW + RAMP_FL, CURB, CURB]);
    }
    bp.push([sg.L, CURB, CURB]);
    const kind = sg.ave && rnd(ring.bi, 31) < 0.35 ? 1 : 0, sd = ring.seed, a = kerb.get(sg.a[0], sg.a[1]);
    const X = (t, d) => sg.a[0] + sg.dx * t + sg.nx * d, Y = (t, d) => sg.a[1] + sg.dy * t + sg.ny * d;
    for (let i = 1; i < bp.length; i++) {
      const [t0, h0, i0] = bp[i - 1], [t1, h1, i1] = bp[i]; if (t1 - t0 < 1e-4) continue;
      const s0 = sg.run + t0, s1 = sg.run + t1;
      const f = [P3(X(t0, 0), Y(t0, 0), -0.03), P3(X(t1, 0), Y(t1, 0), -0.03), P3(X(t1, 0), Y(t1, 0), h1 + 0.003), P3(X(t0, 0), Y(t0, 0), h0 + 0.003)];
      const g = [f[3], f[2], P3(X(t1, KERB_W), Y(t1, KERB_W), i1 + 0.003), P3(X(t0, KERB_W), Y(t0, KERB_W), i0 + 0.003)];
      // face: seen from the road, travel runs left to right, so (t0, t1) along the bottom then up is counter-clockwise
      a.position.push(...f[0], ...f[1], ...f[2], ...f[0], ...f[2], ...f[3]);
      for (let k = 0; k < 6; k++) a.normal.push(-sg.nx, 0, sg.ny);
      a.aK.push(s0, 0, kind, sd, s1, 0, kind, sd, s1, 1, kind, sd, s0, 0, kind, sd, s1, 1, kind, sd, s0, 1, kind, sd);
      a.position.push(...g[0], ...g[1], ...g[2], ...g[0], ...g[2], ...g[3]);
      for (let k = 0; k < 6; k++) a.normal.push(0, 1, 0);
      a.aK.push(s0, 1, kind, sd, s1, 1, kind, sd, s1, 2, kind, sd, s0, 1, kind, sd, s1, 2, kind, sd, s0, 2, kind, sd);
    }
    // kerb-side band of paving (the strip between the kerb stone and the flags), on long kerbs, between ramps
    if (sg.L >= 12 && (sg.ave || rnd(ring.bi, sg.i, 5) < 0.6)) {
      const spans = []; let t = 1.0;
      for (const nt of sg.notches) { const e = nt.t - RAMP_HW - RAMP_FL - 0.05; if (e - t > 2) spans.push([t, e]); t = nt.t + RAMP_HW + RAMP_FL + 0.05; }
      if (sg.L - 1.0 - t > 2) spans.push([t, sg.L - 1.0]);
      for (const [t0, t1] of spans) {
        const tm = (t0 + t1) / 2; if (pointInRing(ring.pts, X(tm, BAND_W + 0.4), Y(tm, BAND_W + 0.4)) === ring.hole) continue;
        const b = band.get(X(tm, 0), Y(tm, 0)), h = CURB + 0.0015, s0 = sg.run + t0, s1 = sg.run + t1, sd2 = 1 + Math.floor(rnd(ring.bi, sg.i, 9) * 97);
        const q = [P3(X(t0, KERB_W), Y(t0, KERB_W), h), P3(X(t1, KERB_W), Y(t1, KERB_W), h), P3(X(t1, BAND_W), Y(t1, BAND_W), h), P3(X(t0, BAND_W), Y(t0, BAND_W), h)];
        b.position.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]); for (let k = 0; k < 6; k++) b.normal.push(0, 1, 0);
        b.aS.push(s0, 0, 1, sd2, s1, 0, 1, sd2, s1, 1, 1, sd2, s0, 0, 1, sd2, s1, 1, 1, sd2, s0, 1, 1, sd2);
      }
    }
  }
  return { kerb, band };
}

function frameAngle(C, ed) {   // the angle (degrees) of the frame in which a street's patches and cuts are laid out: x along the street
  const p = ed.p, phi = Math.atan2(p[p.length - 1][1] - p[0][1], p[p.length - 1][0] - p[0][0]) / D2R, d = offGrid(phi, C.grid);
  return Math.abs(d) < 3 ? phi - d : Math.round(phi * 2) / 2;
}

function buildRibbons(C) {
  const acc = new Acc({ position: 3, aL: 4, aE: 4, aS2: 4 });
  for (const ed of C.E) {
    const sA = ed.ra, sB = ed.L - ed.rb; if (sB - sA < 1) continue;
    const psi = frameAngle(C, ed) * D2R, cs = Math.cos(psi), sn = Math.sin(psi), y = 0.003 + (ed.ei % 7) * 0.0005;
    const stopA = !ed.oneway && ed.ra ? ed.ra + 4.3 : -1e5, stopB = ed.rb ? ed.L - ed.rb - 4.3 : 1e5;
    const pad = ed.ave && ed.rb && ed.n >= 2 && rnd(ed.ei, 4) < 0.16 ? 1 : 0;      // bus-stop pads: avenues only
    const ss = breaks(ed, sA, sB), row = ss.map((s) => {
      const q = atSmooth(ed, s), h = ed.W / 2; return [[q.x - q.dy * h, q.y + q.dx * h, -h, s], [q.x + q.dy * h, q.y - q.dx * h, h, s]];
    });
    for (let i = 1; i < row.length; i++) {
      const [L0, R0] = row[i - 1], [L1, R1] = row[i], a = acc.get((L0[0] + R1[0]) / 2, (L0[1] + R1[1]) / 2);
      for (const v of [L0, R0, R1, L0, R1, L1]) {
        a.position.push(v[0], y, -v[1]); a.aL.push(v[2], v[3], v[0] * cs + v[1] * sn, -v[0] * sn + v[1] * cs);
        a.aE.push(ed.wn, ed.wlw, ed.oneway ? 1 : 0, ed.seed); a.aS2.push(stopA, stopB, pad, 0);
      }
    }
  }
  return acc;
}

// markings. The layout follows pipeline/prep.py (lane lines, double yellow, parking lines, crosswalk bars, stop lines); added: arrows, legends.
const MARK_CELLS = { ahead: 0, turn: 1, only: 2, bus: 3 };
function buildMarks(C) {
  const acc = new Acc({ position: 3, uv: 2, aM: 4, aT: 4, aF: 3 }), city = C.city; let count = 0;
  const quad = (ed, s0, s1, off, wdt, kind, seed, uvf) => {
    const q0 = atSmooth(ed, s0), q1 = atSmooth(ed, s1), o1 = off - wdt / 2, o2 = off + wdt / 2;
    if (ed.fc === undefined) { const psi = frameAngle(C, ed) * D2R; ed.fc = Math.cos(psi); ed.fs = Math.sin(psi); }
    const c = [[q0, o1, 0, -1], [q0, o2, 0, 1], [q1, o2, 1, 1], [q1, o1, 1, -1]].map(([q, o, u, v]) => ({ x: q.x + q.dy * o, y: q.y - q.dx * o, o, u, v }));
    const a = acc.get(c[0].x, c[0].y);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const v = c[k]; a.position.push(v.x, 0.012, -v.y); a.aM.push(v.u * (s1 - s0), v.v, wdt / 2, seed); a.aT.push(v.o, ed.wlw, ed.wn, kind); a.aF.push(ed.fc, ed.fs, ed.seed);
      const t = uvf ? uvf(v.u, v.v) : [0, 0]; a.uv.push(t[0], t[1]);
    }
    count++;
  };
  const solid = (ed, s0, s1, off, wdt, kind, seed) => { const b = breaks(ed, s0, s1); for (let i = 1; i < b.length; i++) quad(ed, b[i - 1], b[i], off, wdt, kind, seed); };
  const legend = (ed, sc, len, off, wid, cell, flow, mirror, seed) => quad(ed, sc - len / 2, sc + len / 2, off, wid, 2, seed, (u, v) => {
    let U = flow > 0 ? (v + 1) / 2 : (1 - v) / 2; const V = flow > 0 ? u : 1 - u; if (mirror) U = 1 - U;
    return [(cell + 0.03 + 0.94 * U) / 4, 0.02 + 0.96 * V];
  });
  const near = (nd, h) => Math.hypot(nd.p[0] - h[0], nd.p[1] - h[1]) < 3;
  const hero = (nd) => HERO_NODES.some((h) => near(nd, h));     // the two hero crossings: paint of middling age, worn where the wheels run (the shader), old bars ghosting beside the new
  for (const ed of C.E) {
    const { L, ra, rb, n, lw, hlf, W, ei } = ed, s0 = ra ? ra + 4.6 : 0, s1 = L - (rb ? rb + 4.6 : 0);
    if (s1 - s0 < 6) {     // a short link between two junctions is part of the junction: a two-way street's centre line carries through it as dashes
      if (!ed.oneway && !ed.shared) for (let s = 0.3; s + 0.6 < L - 0.3; s += 1.8) for (const o of [-0.15, 0.15]) quad(ed, s, s + 0.6, o, 0.11, 1, Math.min(1, 0.15 + 0.25 * rnd(ei, 13) + 0.75 * Math.pow(rnd(ei, Math.round(s * 10), 14), 2.2)));
      continue;
    }
    const age = HERO_NODES.some((h) => near(city.nodes[ed.e.a], h) || near(city.nodes[ed.e.b], h)) ? 0.78 : rnd(ei, 11);                         // how long ago this street was last painted (the hero streets: years ago)
    const lined = !ed.shared;                        // a shared street has one unmarked lane
    if (!lined) { /* no lane lines */ } else if (!ed.oneway && n % 2 === 1) {
      solid(ed, s0, s1, -0.15, 0.12, 1, age * 0.8); solid(ed, s0, s1, 0.15, 0.12, 1, age * 0.8 + 0.1);
      const sl = Math.floor(n / 2), lws = hlf / Math.max(1, sl);
      for (let k = 1; k < sl; k++) for (const sg of [-1, 1]) { let s = s0 + 1, j = 0; while (s + 3 < s1) { quad(ed, s, s + 3, sg * k * lws, 0.13, 0, Math.min(1, age * 0.7 + 0.5 * rnd(ei, k * sg, j++))); s += 9; } }
    } else for (let k = 1; k < n; k++) {
      const off = -hlf + k * lw;
      if (!ed.oneway && k === n / 2) { solid(ed, s0, s1, off - 0.15, 0.12, 1, age * 0.8); solid(ed, s0, s1, off + 0.15, 0.12, 1, age * 0.8 + 0.1); }
      else { let s = s0 + 1, j = 0; while (s + 3 < s1) { quad(ed, s, s + 3, off, 0.13, 0, Math.min(1, age * 0.7 + 0.5 * rnd(ei, k, j++))); s += 9; } }
    }
    if (lined && n > 1 && rnd(ei, 12) < 0.6) { solid(ed, s0, s1, -hlf, 0.1, 0, 0.55 + 0.45 * age); solid(ed, s0, s1, hlf, 0.1, 0, 0.5 + 0.5 * age); }
    for (const end of [0, 1]) {
      const r_ = end ? rb : ra; if (!r_) continue;
      const ndE = city.nodes[end ? ed.e.b : ed.e.a], isH = hero(ndE), jw = isH ? 0.45 : rnd(end ? ed.e.b : ed.e.a, 13), base = end ? L - r_ - 3.6 : r_ - 1.0;       // crosswalks of one junction age together
      const phX = end === 1 && ed.e.name === 'West 22nd Street' && near(ndE, [-281.1, -427.3]);      // the photographed crossing (buildHistory)
      let k = -W / 2 + 0.5, j = 0;
      // Broadway's crosswalk on the north side of 23rd St is a photograph (photo/soho.webp, items/road/photos/soho.json): it brings its own bars up to
      // 3.3 m west of the centre line; the last two toward the west kerb are ours, at the photo's spacing and length
      const phB = end === 1 && ed.e.name === 'Broadway' && near(ndE, [-201.4, -374.4]);
      if (phB) { for (const o of [3.92, 4.90]) quad(ed, base + 0.2, base + 4.1, o, 0.33, 0, 0.22 + 0.1 * rnd(ei, end, j++)); k = 1e9; }
      if (phX) { for (let o = 1.55 - 0.87 * 6; o < W / 2 - 0.4; o += 0.87) if (o > -W / 2 + 0.4) quad(ed, base, Math.min(L, base + 4.6), o, 0.30, 0, 0.55 + 0.15 * rnd(ei, end, j++)); k = 1e9; }
      while (k + 0.40 < W / 2 - 0.3) { quad(ed, Math.max(0, base), Math.min(L, base + 4.6), k + 0.20, 0.40, 0, isH ? Math.min(0.9, 0.30 + 0.26 * rnd(ei, end, j++) + 0.22 * (Math.abs(k + 0.2) < hlf ? Math.exp(-(((Math.abs(((k + 0.2 + hlf) % ed.wlw) - ed.wlw / 2) - 0.85) / 0.34) ** 2)) : 0)) : Math.min(1, 0.05 + 0.35 * jw + 0.75 * Math.pow(rnd(ei, end, j++), 2))); k += 1.0; }
      if (!ed.oneway && r_ >= 8 && !isH) {
        // guide dashes through the box on this street's own centre line: 0.6 m every 1.8 m. Where another two-way street crosses, stop short of its line.
        const nd = city.nodes[end ? ed.e.b : ed.e.a], qd = at(ed, end ? L - 0.5 : 0.5);
        const crossed = nd.e.some((k) => { const o = C.E[k]; if (!o || o === ed || o.oneway) return false; const q2 = at(o, o.e.a === (end ? ed.e.b : ed.e.a) ? 0.5 : o.L - 0.5); return Math.abs(q2.dx * qd.dx + q2.dy * qd.dy) < 0.8; });
        for (let s = crossed ? 1.5 : 0.3; s + 1.1 < r_ - 1.2; s += 2.0) for (const o of [-0.15, 0.15]) quad(ed, end ? L - s - 1.1 : s, end ? L - s : s + 1.1, o, 0.11, 1, Math.min(1, 0.10 + 0.2 * jw + 0.35 * Math.pow(rnd(ei, end, Math.round(s * 10)), 2.2)));
      }
      if ((end || !ed.oneway) && !phX && !phB) {
        const sl = end ? L - r_ - 5.1 : r_ + 5.1, lo = ed.oneway ? -hlf : (end ? 0 : -hlf), hi = ed.oneway ? hlf : (end ? hlf : 0);
        quad(ed, sl - (end ? 0.45 : 0.0), sl + (end ? 0.0 : 0.45), (lo + hi) / 2, hi - lo, 0, 0.05 + 0.3 * jw);        // a 45 cm stop bar, 1.5 m back from the crosswalk
        // turn arrows and ONLY on the outer lanes of wide approaches
        const flow = end ? 1 : -1, lanes = []; for (let q = 0; q < n; q++) if (ed.oneway || (q >= n / 2) === (flow > 0)) lanes.push(q);
        const bus = !ed.oneway && n >= 4;
        if (lined && lanes.length >= 2 && s1 - s0 > 60 && rnd(ei, end, 14) < 0.6) {
          const left = flow > 0 ? lanes[0] : lanes[lanes.length - 1], right = flow > 0 ? lanes[lanes.length - 1] : lanes[0];
          const put = (lane, mirror, sd) => {
            const off = -hlf + (lane + 0.5) * lw; legend(ed, sl - flow * 9, 3.6, off, 1.5, MARK_CELLS.turn, flow, mirror, 0.25 + 0.6 * sd);
            if (sd < 0.6) legend(ed, sl - flow * 16.5, 2.6, off, 2.1, MARK_CELLS.only, flow, false, 0.25 + 0.6 * sd);
          };
          if (rnd(ei, end, 15) < 0.75) put(left, false, rnd(ei, end, 16));
          if (!bus && lanes.length >= 3 && rnd(ei, end, 17) < 0.5) put(right, true, rnd(ei, end, 18));
          if (lanes.length >= 3 && rnd(ei, end, 19) < 0.4) legend(ed, sl - flow * 9, 3.6, -hlf + (lanes[1] + 0.5) * lw, 1.1, MARK_CELLS.ahead, flow, false, 0.3 + 0.6 * rnd(ei, end, 20));
        }
      }
    }
    // bus lanes on the wide two-way crosstown streets: BUS ONLY in the kerb lanes, a solid line inside them
    if (lined && !ed.oneway && n >= 4) for (const flow of [1, -1]) {
      const lane = flow > 0 ? n - 1 : 0, off = -hlf + (lane + 0.5) * lw;
      for (let s = flow > 0 ? s0 + 26 : s1 - 26, j = 0; s > s0 + 20 && s < s1 - 20; s += flow * 78, j++) {
        const sd = 0.2 + 0.6 * rnd(ei, flow, j); legend(ed, s, 2.6, off, 2.1, MARK_CELLS.bus, flow, false, sd); legend(ed, s + flow * 4.4, 2.6, off, 2.1, MARK_CELLS.only, flow, false, sd);
      }
    }
  }
  acc.count = count; return acc;
}

function marksAtlas() {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'miter'; g.lineCap = 'butt';
  // cell 0: ahead arrow (points up)
  g.beginPath(); g.moveTo(128, 20); g.lineTo(236, 250); g.lineTo(160, 250); g.lineTo(160, 492); g.lineTo(96, 492); g.lineTo(96, 250); g.lineTo(20, 250); g.closePath(); g.fill();
  // cell 1: left-turn arrow: a shaft that bends to the left with the head pointing left
  g.save(); g.translate(256, 0);
  g.beginPath(); g.moveTo(150, 492); g.lineTo(226, 492); g.lineTo(226, 150); g.quadraticCurveTo(226, 70, 150, 70); g.lineTo(120, 70); g.lineTo(120, 16); g.lineTo(14, 108); g.lineTo(120, 200); g.lineTo(120, 146); g.lineTo(138, 146); g.quadraticCurveTo(150, 146, 150, 160); g.closePath(); g.fill();
  g.restore();
  const word = (t, cx) => { g.save(); g.font = '900 100px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; const m = g.measureText(t), sx = 232 / m.width, sy = 480 / 72; g.translate(cx + 128, 496); g.scale(sx, sy); g.fillText(t, 0, 0); g.restore(); };
  word('ONLY', 512); word('BUS', 768);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
}

// ------------------------------------------------------------------ the field textures (GPU, once)
const PLAZA_KIND = { paving_stones: 1, sett: 1, concrete: 2, asphalt: 3 };
function straightRuns(pts, tol = 7) {     // per edge: { len: length of the straight run it belongs to, ang: that run's direction in degrees }
  const n = pts.length, out = new Array(n), dir = (i) => { const a = pts[i], b = pts[(i + 1) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R; };
  const dd = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  let start = 0; for (let i = 0; i < n; i++) if (dd(dir(i), dir((i + n - 1) % n)) > tol) { start = i; break; }
  for (let k = 0; k < n;) {
    const i0 = (start + k) % n; let m = 1;
    while (k + m < n) { const j = (start + k + m) % n, e = pts[j], c = Math.atan2(e[1] - pts[i0][1], e[0] - pts[i0][0]) / D2R; if (dd(dir(j), c) > tol || dd(dir(j), dir((j + n - 1) % n)) > tol * 2) break; m++; }
    const e = pts[(i0 + m) % n], len = Math.hypot(e[0] - pts[i0][0], e[1] - pts[i0][1]), ang = Math.atan2(e[1] - pts[i0][1], e[0] - pts[i0][0]) / D2R;
    for (let q = 0; q < m; q++) out[(i0 + q) % n] = { len, ang };
    k += m;
  }
  return out;
}
function plazaShape(pz) {       // -> counter-clockwise outline, its triangles (as point triples), the surface kind
  const pts = []; for (const q of pz.poly || []) { const l = pts[pts.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-3) pts.push([q[0], q[1]]); }
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) pts.pop();
  if (pts.length < 3) return null; if (ringArea(pts) < 0) pts.reverse();
  const v2 = pts.map((q) => new THREE.Vector2(q[0], q[1])); let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (e) { return null; }
  return { pts, kind: PLAZA_KIND[pz.surface] || 0, tris: tris.map((t) => { let [p, q, r] = [v2[t[0]], v2[t[1]], v2[t[2]]]; if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0) [q, r] = [r, q]; return [p, q, r]; }) };
}
function fieldGeometry(C, fx, fy, plazas = []) {
  const main = { p: [], v: [], g: [] }, lines = { p: [], v: [], g: [] };
  const inBox = (x, y, m) => Math.abs(x) < fx + m && Math.abs(y) < fy + m;
  const tent = (o, x1, y1, x2, y2, D, ch, ang, K) => {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (L < 1e-3) return; const nx = -dy / L * D, ny = dx / L * D;
    const V = (x, y, v) => { o.p.push(x, y, ch); o.v.push(v); o.g.push(ang); };
    for (const s of [1, -1]) { V(x1, y1, 0); V(x2, y2, 0); V(x2 + nx * s, y2 + ny * s, 1); V(x1, y1, 0); V(x2 + nx * s, y2 + ny * s, 1); V(x1 + nx * s, y1 + ny * s, 1); }
    for (let k = 0; k < K; k++) { const a0 = k / K * 6.2832, a1 = (k + 1) / K * 6.2832; V(x1, y1, 0); V(x1 + Math.cos(a0) * D, y1 + Math.sin(a0) * D, 1); V(x1 + Math.cos(a1) * D, y1 + Math.sin(a1) * D, 1); }
  };
  const code = (og) => (Math.round(og * 2) / 2 + 45) * 2 / 255;
  // a reference line for the flags, if it belongs to a long straight run. Off the grid only a really long wall or kerb sets its own frame
  // (one frame per stretch of sidewalk: short odd-angled bits would lay patches of flags that collide)
  const line = (run, x1, y1, x2, y2, minLen, minOff, K) => {
    if (!run || run.len < minLen) return; const og = offGrid(run.ang, C.grid);
    if (Math.abs(og) > 3) { if (run.len >= minOff) tent(lines, x1, y1, x2, y2, FIELD_D, 1, code(og), K); } else tent(lines, x1, y1, x2, y2, FIELD_D, 0, 0, K);
  };
  for (const ring of C.rings) {
    const runs = straightRuns(ring.pts);
    for (const sg of ring.segs) {
      if (!inBox(sg.a[0], sg.a[1], FIELD_D + sg.L)) continue;
      tent(main, sg.a[0], sg.a[1], sg.b[0], sg.b[1], FIELD_D, 0, 0, 8);
      line(runs[sg.i], sg.a[0], sg.a[1], sg.b[0], sg.b[1], 10, 30, 8);
    }
  }
  for (const b of C.city.buildings) {
    if (b.far || (b.minh || 0) > 1 || !inBox(b.poly[0][0], b.poly[0][1], 40)) continue;
    for (const r of [b.poly, ...(b.holes || [])]) {
      const runs = r.length >= 3 ? straightRuns(r) : [];
      for (let i = 0; i < r.length; i++) { const q = r[(i + 1) % r.length]; tent(main, r[i][0], r[i][1], q[0], q[1], FIELD_DB, 2, 0, 5); line(runs[i], r[i][0], r[i][1], q[0], q[1], 6, 20, 6); }
    }
  }
  for (const nd of C.city.nodes) {
    if (nd.e.length < 3 || !inBox(nd.p[0], nd.p[1], 40)) continue;
    const R = nd.r + FIELD_DN, K = 20;
    for (let k = 0; k < K; k++) {
      const a0 = k / K * 6.2832, a1 = (k + 1) / K * 6.2832;
      main.p.push(nd.p[0], nd.p[1], 3, nd.p[0] + Math.cos(a0) * R, nd.p[1] + Math.sin(a0) * R, 3, nd.p[0] + Math.cos(a1) * R, nd.p[1] + Math.sin(a1) * R, 3);
      main.v.push(-nd.r / FIELD_DN, 1, 1); main.g.push(0, 0, 0);
    }
  }
  // plaza polygons into the spare channel: inside = a low value that also says which surface (kind / 20)
  for (const pz of plazas) { const sh = plazaShape(pz); if (!sh) continue; for (const t of sh.tris) for (const q of t) { main.p.push(q.x, q.y, 1); main.v.push(sh.kind / 20); main.g.push(0); } }
  // shared streets: a band 9 m deep behind both kerbs, code 4
  for (const ed of C.E) {
    if (!ed.shared) continue; const ss = breaks(ed, ed.ra, ed.L - ed.rb).map((s) => atSmooth(ed, s));
    for (let i = 1; i < ss.length; i++) for (const sd of [-1, 1]) {
      const P = (q, o) => [q.x + q.dy * o * sd, q.y - q.dx * o * sd], c = [P(ss[i - 1], ed.W / 2 - 0.3), P(ss[i], ed.W / 2 - 0.3), P(ss[i], ed.W / 2 + 9), P(ss[i - 1], ed.W / 2 + 9)];
      for (const k of [0, 1, 2, 0, 2, 3]) { main.p.push(c[k][0], c[k][1], 1); main.v.push(4 / 20); main.g.push(0); }
    }
  }
  const G = (o) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.p), 3)); g.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(o.v), 1)); g.setAttribute('aAng', new THREE.BufferAttribute(new Float32Array(o.g), 1)); return g; };
  return { main: G(main), lines: G(lines) };
}

function renderField(renderer, C, fx, fy, plazas) {
  const N = Math.min(4096, renderer.capabilities.maxTextureSize), { main, lines } = fieldGeometry(C, fx, fy, plazas);
  const rt1 = new THREE.WebGLRenderTarget(N, N, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const rtB = new THREE.WebGLRenderTarget(N / 2, N / 2, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const rt2 = new THREE.WebGLRenderTarget(N / 2, N / 2, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const vs = `attribute float aV; attribute float aAng; uniform vec2 uH; varying float vV; varying float vA; varying float vC;
    void main(){ vV = aV; vA = aAng; vC = position.z; gl_Position = vec4(position.xy / uH, clamp(aV, 0.0, 1.0) * 1.8 - 0.9, 1.0); }`;
  const U = { uH: { value: new THREE.Vector2(fx, fy) } };
  const m1 = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vs, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    fragmentShader: `varying float vV; varying float vA; varying float vC; void main(){ float v = clamp(vV, 0.0, 1.0); gl_FragColor = vec4(vC < 0.5 ? v : 1.0, (vC > 0.5 && vC < 1.5) ? v : 1.0, (vC > 1.5 && vC < 2.5) ? v : 1.0, vC > 2.5 ? v : 1.0); }`,
    blending: THREE.CustomBlending, blendEquation: THREE.MinEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.MinEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  const m2 = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vs, side: THREE.DoubleSide, depthTest: true, depthWrite: true,
    fragmentShader: `varying float vV; varying float vA; varying float vC; void main(){ if (vC < 0.5) discard; gl_FragColor = vec4(vA, 0.0, 0.0, 1.0); }` });
  const cam = new THREE.Camera(), s1 = new THREE.Scene(), sB = new THREE.Scene(), s2 = new THREE.Scene();
  for (const [s, g, m] of [[s1, main, m1], [sB, lines, m1], [s2, lines, m2]]) { const o = new THREE.Mesh(g, m); o.frustumCulled = false; s.add(o); }
  const prevRT = renderer.getRenderTarget(), prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt1); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(s1, cam);
  renderer.setRenderTarget(rtB); renderer.clear(); renderer.render(sB, cam);
  renderer.setRenderTarget(rt2); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(s2, cam);   // only read where an off-grid kerb is the nearest, and there a tent has written
  const px = new Uint8Array(N * N * 4); renderer.readRenderTargetPixels(rt1, 0, 0, N, N, px);
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCol, prevA); renderer.autoClear = prevAuto;
  main.dispose(); lines.dispose(); m1.dispose(); m2.dispose();
  // CPU copy for placement rules: [kerb distance, wall distance, junction distance] in metres at a map point
  const sample = (x, y) => {
    const i = Math.floor((x / fx + 1) / 2 * N), j = Math.floor((y / fy + 1) / 2 * N); if (i < 0 || j < 0 || i >= N || j >= N) return [FIELD_D, FIELD_DB, FIELD_DN];
    const k = (j * N + i) * 4; return [px[k] / 255 * FIELD_D, px[k + 2] / 255 * FIELD_DB, px[k + 3] / 255 * FIELD_DN];
  };
  return { tField: rt1.texture, tLines: rtB.texture, tAng: rt2.texture, sample, rts: [rt1, rtB, rt2] };
}

// one tiling RGBA texture of four independent 4-octave value-noise fields (period 32 units), rendered once: the road shader's fbm
function renderNoise(renderer) {
  const N = 1024, half = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: false, type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
  const mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: `varying vec2 vUv;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p, float per, float salt){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); vec2 a = mod(i, per), b = mod(i + 1.0, per);
      return mix(mix(h21(a + salt), h21(vec2(b.x, a.y) + salt), f.x), mix(h21(vec2(a.x, b.y) + salt), h21(b + salt), f.x), f.y); }
    float fbm(vec2 p, float salt){ float a = .5, s = 0., per = 32.0; for (int i = 0; i < 4; i++) { s += a * vn(p, per, salt); p *= 2.0; per *= 2.0; salt += 71.3; a *= .5; } return s; }
    void main(){ vec2 p = vUv * 32.0; gl_FragColor = vec4(fbm(p, 3.1), fbm(p, 117.7), fbm(p, 231.9), fbm(p, 349.3)); }` });
  const sc = new THREE.Scene(), o = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); o.frustumCulled = false; sc.add(o);
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear; renderer.autoClear = true;
  renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
  o.geometry.dispose(); mat.dispose(); return rt;
}

// ------------------------------------------------------------------ the road history of the hero blocks, laid by hand from street-works practice
// Nothing here is traced from a photograph. It is what a crosstown Manhattan street carries after decades of utility work, placed where
// the utilities of these streets would run: a gas main under the outer eastbound lane of 23rd St relaid in sections, its service laterals cut
// square to the kerb, an electric duct bank along the north side still under steel plates by the avenue, the water main under 5th Ave's west
// lane (an old, pale restoration), Broadway's sewer crossing the 23rd St box on Broadway's own slant, single keyhole cuts, concrete bus pads
// in the kerb lanes, cold patch in potholes, poured crack sealant, and covers on the lines they belong to. Every cut is geometry laid a few
// millimetres over the road with its own asphalt (FS_PATCH); "over" cuts are newer than the paint and interrupt it; plates have real thickness.
const HERO_NODES = [[-240.1, -353.8], [-201.4, -374.4]];
function triTo(V, n) {      // the three vertices ordered so the face looks along n
  const [A, B, C] = V, u = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]], v = [C.p[0] - A.p[0], C.p[1] - A.p[1], C.p[2] - A.p[2]];
  return (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2] >= 0 ? V : [A, C, B];
}
function buildHistory(C) {
  const N = C.city.nodes, nearP = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 4, [n62, n63] = HERO_NODES;
  const find = (a, b) => C.E.find((e) => nearP(N[e.e.a].p, a) && nearP(N[e.e.b].p, b));
  const W23 = find([-301.7, -319.6], n62), M23 = find(n62, n63), E23 = find(n63, [-171.4, -390.7]), F5N = find([-202.1, -286.1], n62), F5S = find(n62, [-263.7, -395.1]), BWN = find([-184.9, -302.1], n63), BWS = find(n63, [-212.5, -419.7]);
  const spec = { position: 3, aQ: 4, aR: 4, aW: 4 }, under = new Acc(spec), over = new Acc(spec), plates = new Acc({ position: 3, normal: 3, aQ: 4, aR: 4, aW: 4 }), covers = [];
  const d23 = Math.hypot(n63[0] - n62[0], n63[1] - n62[1]), t23 = [(n63[0] - n62[0]) / d23, (n63[1] - n62[1]) / d23];
  const out = { under, over, plates, covers, count: 0, cap: [-301.7, -319.6, -171.4, -390.7], n23: [t23[1], -t23[0]], nx: [0.87, -0.49, 0.96, -0.27] };
  if (!(W23 && M23 && E23 && F5N && F5S && BWN && BWS)) return out;
  const qa = at(F5N, F5N.L - 0.5), qb = at(BWN, BWN.L - 0.5); out.nx = [qa.dy, -qa.dx, qb.dy, -qb.dx];
  let k = 0; const Y_UNDER = 0.0085, Y_OVER = 0.0135, UP = [0, 1, 0];
  const solid = [];      // newer cuts and slabs: a crack in the old road stops at them
  const quadQ = (acc, x, y, ang, hl, hw, h, kind, tone, seed, off = 0, lw = 0, nl = 0, mg = 0.17) => {
    const ux = Math.cos(ang), uy = Math.sin(ang), a = acc.get(x, y); if (kind === 1 || (kind === 0 && tone < 0.95)) solid.push([x, y, ux, uy, hl, hw]);
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => { const lx = p * (hl + mg), ly = q * (hw + mg); return { p: [x + ux * lx - uy * ly, h, -(y + uy * lx + ux * ly)], lx, ly }; });
    for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) for (const v of triTo(tri, UP)) { a.position.push(...v.p); a.aQ.push(v.lx, v.ly, hl, hw); a.aR.push(kind, tone, seed, off - v.ly); a.aW.push(lw, nl, ux, uy); }
    out.count++;
  };
  // a rectangle in a street's own frame: from s0 to s1 along it, centred off metres right of its centre line, wid across. kind 0 newer asphalt,
  // 1 concrete, 2 old pale asphalt, 3 cold patch (an ellipse). o.over: newer than the paint; o.lv: 0..6, a later repair lies over an earlier one
  const R = (ed, s0, s1, off, wid, kind, tone, o = {}) => { const q = at(ed, (s0 + s1) / 2); quadQ(o.over ? over : under, q.x + q.dy * off, q.y - q.dx * off, Math.atan2(q.dy, q.dx), (s1 - s0) / 2, wid / 2, (o.over ? Y_OVER : Y_UNDER) + (o.lv || 0) * 0.0003, kind, tone, rnd(++k, 77), off, ed.wlw, ed.wn); };
  const trench = (ed, s0, s1, off, wid, tones, o = {}) => { let s = s0, j = 0; while (s < s1 - 0.5) { let len = 9 + 14 * rnd(ed.ei, off, j); if (s1 - s - len < 5) len = s1 - s; const tn = tones[j % tones.length]; R(ed, s, s + len - 0.015, off, wid * (0.95 + 0.1 * rnd(j, off, 5)), tn > 1 ? 2 : 0, tn, o); s += len; j++; } };
  const snake = (ed, s0, off0, s1, off1, w = 0.013) => {
    const n = Math.max(2, Math.ceil(Math.hypot(s1 - s0, off1 - off0) / 0.3)), pts = [], sd = rnd(++k, 78), amp = 0.03 + 0.09 * rnd(k, 79);
    for (let i = 0; i <= n; i++) {
      const f = i / n, wig = amp * (Math.sin(f * 7.3 + sd * 20) * 0.6 + Math.sin(f * 17.1 + sd * 50) * 0.3 + (rnd(k, i, 80) - 0.5) * 0.22);
      const al = (s1 - s0) / Math.hypot(s1 - s0, off1 - off0), ac = (off1 - off0) / Math.hypot(s1 - s0, off1 - off0), q = at(ed, s0 + (s1 - s0) * f - ac * wig), o = off0 + (off1 - off0) * f + al * wig;
      pts.push([q.x + q.dy * o, q.y - q.dx * o]);
    }
    let run = 0, len = 0; for (let i = 0; i < n; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const hw = w + 0.03, a = over.get(pts[0][0], pts[0][1]);
    const nrm = (i) => { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]; };
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n0 = nrm(i), n1 = nrm(i + 1);
      const V = (j, sg, r, nn) => ({ p: [pts[j][0] + nn[0] * hw * sg, Y_OVER + 0.0022, -(pts[j][1] + nn[1] * hw * sg)], lx: r, ly: sg * hw });
      const c = [V(i, -1, run, n0), V(i + 1, -1, run + d, n1), V(i + 1, 1, run + d, n1), V(i, 1, run, n0)];
      for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) for (const v of triTo(tri, UP)) { a.position.push(...v.p); a.aQ.push(v.lx, v.ly, len, w); a.aR.push(4, 1, sd, 0); a.aW.push(0, 0, 1, 0); }
      run += d;
    }
    out.count++;
  };
  // cracks: a jagged random walk with branches, laid over everything (paint included). th: heading in the street's frame (0 = along it)
  const inSolid = (x, y) => solid.some(([cx, cy, ux, uy, hl, hw]) => Math.abs((x - cx) * ux + (y - cy) * uy) < hl - 0.01 && Math.abs(-(x - cx) * uy + (y - cy) * ux) < hw - 0.01);
  const walk = (x, y, a, len, w, depth, bp = 0.035) => {
    const kk = ++k, sd = rnd(kk, 83), pts = [], n = Math.max(3, Math.round(len / 0.11)), drift = (rnd(kk, 84) - 0.5) * 0.05;
    for (let i = 0; i <= n; i++) {
      if (inSolid(x, y)) break;
      pts.push([x, y]); const st = 0.07 + 0.08 * rnd(kk, i, 85), j = (rnd(kk, i, 86) - 0.5) * 1.1; x += Math.cos(a + j) * st; y += Math.sin(a + j) * st; a += drift + (rnd(kk, i, 87) - 0.5) * 0.16;
      if (depth < 3 && i > 2 && i < n - 2 && rnd(kk, i, 88) < bp) walk(x, y, a + (rnd(kk, i, 89) < 0.5 ? -1 : 1) * (0.6 + 0.7 * rnd(kk, i, 90)), len * (0.15 + 0.3 * rnd(kk, i, 91)), w * 0.75, depth + 1, bp);
    }
    if (pts.length > 2) strip(pts, w, 5, sd);
  };
  // block ("alligator") cracking where the base has failed: short cracks from one spot, branching hard
  const gator = (ed, s, off, r = 1.6) => { const q = at(ed, s), x = q.x + q.dy * off, y = q.y - q.dx * off; for (let i = 0; i < 5; i++) walk(x + (rnd(k, i, 92) - 0.5) * 0.5, y + (rnd(k, i, 93) - 0.5) * 0.5, i * 1.257 + rnd(k, i, 94), r * (0.6 + 0.8 * rnd(k, i, 95)), 0.0045, 1, 0.16); };
  const crack = (ed, s, off, th, len, w = 0.006) => { const q = at(ed, s); walk(q.x + q.dy * off, q.y - q.dx * off, Math.atan2(q.dy, q.dx) - th, len, w, 0); };
  const strip = (pts, w, kind, sd) => {
    const n = pts.length - 1; if (n < 1) return; let run = 0, len = 0; for (let i = 0; i < n; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const hw = w + 0.012, a = over.get(pts[0][0], pts[0][1]);
    const nrm = (i) => { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]; };
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n0 = nrm(i), n1 = nrm(i + 1);
      const V = (j, sg, r, nn) => ({ p: [pts[j][0] + nn[0] * hw * sg, Y_OVER + 0.0024, -(pts[j][1] + nn[1] * hw * sg)], lx: r, ly: sg * hw });
      const c = [V(i, -1, run, n0), V(i + 1, -1, run + d, n1), V(i + 1, 1, run + d, n1), V(i, 1, run, n0)];
      for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) for (const v of triTo(tri, UP)) { a.position.push(...v.p); a.aQ.push(v.lx, v.ly, len, w); a.aR.push(kind, 1, sd, 0); a.aW.push(0, 0, 1, 0); }
      run += d;
    }
    out.count++;
  };
  // a steel road plate, 27 mm thick, with the asphalt ramp that is packed against its edges
  const plate = (ed, s0, s1, off, wid) => {
    const q = at(ed, (s0 + s1) / 2), x = q.x + q.dy * off, y = q.y - q.dx * off, ang = Math.atan2(q.dy, q.dx) + (rnd(++k, 81) - 0.5) * 0.07, ux = Math.cos(ang), uy = Math.sin(ang), hl = (s1 - s0) / 2, hw = wid / 2, sd = rnd(k, 82), T = 0.031, a = plates.get(x, y);
    const P = (lx, ly, h) => ({ p: [x + ux * lx - uy * ly, h, -(y + uy * lx + ux * ly)], lx, ly });
    const put = (V, n, part) => { for (const v of triTo(V, n)) { a.position.push(...v.p); a.normal.push(...n); a.aQ.push(v.lx, v.ly, hl, hw); a.aR.push(part, sd, 0, 0); a.aW.push(0, 0, ux, uy); } };
    const cr = [[-1, -1], [1, -1], [1, 1], [-1, 1]], top = cr.map(([p, q]) => P(p * hl, q * hw, T)), Wd = 0.17, low = cr.map(([p, q]) => P(p * (hl + Wd), q * (hw + Wd), 0.0125));
    put([top[0], top[1], top[2]], UP, 0); put([top[0], top[2], top[3]], UP, 0);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mx = (cr[i][0] + cr[j][0]) / 2, my = (cr[i][1] + cr[j][1]) / 2, nx = ux * mx - uy * my, ny = uy * mx + ux * my, nW = [nx * 0.12, 0.99, -ny * 0.12], nS = [nx, 0, -ny];
      const e0 = P(cr[i][0] * hl, cr[i][1] * hw, T - 0.008), e1 = P(cr[j][0] * hl, cr[j][1] * hw, T - 0.008);
      put([e0, e1, low[j]], nW, 2); put([e0, low[j], low[i]], nW, 2); put([e0, e1, top[j]], nS, 1); put([e0, top[j], top[i]], nS, 1);
    }
    out.count++;
  };
  const MH = (ed, s, off, d, type, collar = -1, tone = 1) => { const q = at(ed, s), x = q.x + q.dy * off, y = q.y - q.dx * off; covers.push({ x, y, d, type }); if (collar >= 0) R(ed, s - d * 0.68, s + d * 0.68, off, d * 1.36, collar, tone, { lv: 5 });
    else if (d > 0.6 && false) for (let i = 0, n = 2 + Math.floor(rnd(x, y, 96) * 2); i < n; i++) { const a = (i + rnd(x, y, i + 97)) * 6.2832 / n; walk(x + Math.cos(a) * d * 0.52, y + Math.sin(a) * d * 0.52, a + (rnd(x, y, i + 98) - 0.5) * 0.8, 0.5 + 1.3 * rnd(x, y, i + 99), 0.0045, 2); } };     // the road cracks away from a frame that has settled

  // W 22nd St where it meets 5th Ave: a real New York side street laid from a photograph (street76.webp: "76th w Street (Manhattan)
  // May 2023", CC0, not a judging photo; prep_street76.py). The camera that took it stood 2.74 m short of the far ends of the crosswalk bars,
  // looking down the street; the texture is the photo's own pixels from 1.35 m to 11.35 m ahead of it, masked to the road it really shows
  // (FS_PATCH kind 6 maps road metres into the photo through that camera, so the near road keeps the photo's millimetres).
  const W22 = C.E.find((e) => e.e.name === 'West 22nd Street' && nearP(N[e.e.b].p, [-281.1, -427.3]));
  if (W22 && W22.rb && false) {      // r28's quad; from r29 the photographed road is its own layer (buildPhotos, photo/photos.json)
    const sCam = W22.L - W22.rb - 3.6 + 2.74, sC = sCam - 6.35, q = at(W22, sC), ang = Math.atan2(q.dy, q.dx), ux = Math.cos(ang), uy = Math.sin(ang), a = over.get(q.x, q.y);
    const c = [[-5, -4.6], [5, -4.6], [5, 4.6], [-5, 4.6]].map(([lx, ly]) => ({ p: [q.x + ux * lx - uy * ly, Y_OVER + 0.0018, -(q.y + uy * lx + ux * ly)], lx, ly }));
    for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) for (const v of triTo(tri, UP)) { a.position.push(...v.p); a.aQ.push(v.lx, v.ly, 5, 4.6); a.aR.push(6, 6.35, 0.37, 0); a.aW.push(0, 0, ux, uy); }
    out.count++; out.photo = { edge: W22.ei, sCam, cam: [at(W22, sCam).x, at(W22, sCam).y], dir: [-q.dx, -q.dy] };
  }
  // 23rd St: + offsets are the south (eastbound) side. Lanes are 4.1 m wide each way
  trench(W23, 5, 70.4, 6.1, 1.1, [0.80, 0.66, 0.86, 1.18, 0.72]); trench(M23, 0.1, 43.7, 6.1, 1.1, [0.70, 0.84, 0.62, 0.80]); trench(E23, 0.1, 30, 6.1, 1.1, [0.84, 0.70, 1.16]);
  for (const [ed, s, tn] of [[W23, 17.5, 0.74], [W23, 39.0, 0.60], [E23, 15, 0.66], [E23, 24, 0.8]]) R(ed, s - 0.36, s + 0.36, 8.55, 3.8, 0, tn, { lv: 2 });
  // a duct crossing cut right across the street through the 5th Ave crosswalk after it was painted: the bars stop at it
  R(W23, 58.5, 59.05, -8.1, 4.6, 0, 0.76, { over: 1 }); R(W23, 58.47, 59.03, -3.3, 5.0, 0, 0.84, { over: 1, lv: 1 });
  trench(W23, 22, 62, -6.3, 0.85, [0.62, 0.70, 0.58]); plate(W23, 62.3, 64.7, -6.3, 1.5); plate(W23, 64.8, 67.2, -6.3, 1.5);
  trench(M23, 3.5, 24.3, -6.3, 0.85, [0.66, 0.60]); plate(M23, 24.5, 26.9, -6.2, 1.5);
  // the avenues: 5th Ave's water main (old and pale), Broadway's sewer on its slant through the 23rd St box
  trench(F5N, 44, 77.5, 3.4, 1.3, [1.20, 1.12, 1.26]); trench(F5S, 0.1, 33, 3.4, 1.3, [1.14, 1.22]);
  trench(BWN, 44, 74.2, 4.6, 1.2, [0.78, 0.90, 0.70]); trench(BWS, 0.1, 30, 4.6, 1.2, [0.86, 0.74]);
  // single repairs
  R(M23, 34.6, 39.4, 2.9, 4.0, 0, 0.74, { lv: 1 });
  R(M23, 4.8, 6.4, 4.2, 1.3, 0, 0.64); R(W23, 48.2, 49.9, 1.9, 1.3, 2, 1.22); R(E23, 5, 6.5, -3, 1.3, 0, 0.70);
  // concrete bus pads in the kerb lanes
  R(M23, 15.2, 29.0, 8.75, 3.3, 1, 1.0, { lv: 3 }); R(W23, 26, 53.6, -8.75, 3.3, 1, 0.94, { lv: 3 });
  // cold patch in potholes
  for (const [ed, s, off, hl, hw] of [[W23, 46.6, 0.8, 0.26, 0.17], [M23, 39.9, -5.6, 0.22, 0.15], [W23, 55.6, 3.9, 0.16, 0.2], [M23, 27.8, 3.3, 0.3, 0.2]]) R(ed, s - hl, s + hl, off, hw * 2, 3, 1, { over: 1, lv: 4 });
  // poured crack sealant
  // (no poured sealant lines for now: on these pale roads they read as drawn strokes)
  // cracks: along the old paving joints, across the street, off the corners of cuts
  const CRACKS = false;      // r24: drawn cracks read as drawn; the aerial scan's own cracks stand in
  if (CRACKS) { crack(W23, 40, 4.15, 0.02, 17); crack(W23, 44, -4.1, -0.03, 16); crack(W23, 49.5, 9.0, 1.52, 8.5); crack(W23, 53.0, 0.4, -1.6, 7.0); crack(W23, 56.0, 5.3, 0.35, 5.5); crack(W23, 57.6, -1.2, 0.1, 6.0); crack(W23, 59.2, 7.3, -0.5, 4.0);
  crack(W23, 12, 0.3, 0.0, 24, 0.005); crack(W23, 21, 8.0, 1.5, 7.5); crack(W23, 31, -1.0, -1.55, 6.5); crack(W23, 36, 4.3, 0.04, 9);
  crack(M23, 43.2, 1.2, 3.1, 9.0); crack(M23, 42.5, -3.0, 3.2, 7.5); crack(M23, 40.2, -7.0, 1.5, 7.0); crack(M23, 34.4, 4.95, 0.9, 3.5); crack(M23, 39.5, 0.85, 2.2, 3.0); crack(M23, 37.0, -5.2, 3.6, 4.5); crack(M23, 33.0, -0.5, 3.14, 12, 0.005);
  gator(W23, 52.2, 6.9); gator(M23, 41.0, 3.1, 1.3); gator(W23, 27, 2.2, 1.4); }
  // covers
  MH(M23, 37.6, -4.3, 0.92, 1, 0, 0.8); MH(M23, 41.4, 6.0, 0.30, 0); MH(M23, 41.9, 6.3, 0.26, 1); MH(M23, 27.0, 2.06, 0.95, 0, 0, 0.72);
  MH(W23, 61.2, -1.6, 0.92, 0); MH(W23, 64.5, 1.5, 0.95, 1, 1, 0.58); MH(W23, 67.5, -2.5, 0.90, 0); MH(W23, 44.5, -2.06, 0.95, 1, 0, 0.68);
  MH(F5N, 65.5, 3.3, 0.26, 0); MH(F5N, 66.2, 3.6, 0.30, 1);
  return out;
}


// ------------------------------------------------------------------ decals placed by rule
const SUBWAY = /^(Broadway|6th Avenue|Avenue of the Americas|7th Avenue|8th Avenue|Park Avenue South|Park Avenue|Lexington Avenue)$/;
const CELL = { mh: (i) => [i, 0, 1, 1], box: [0, 1, 2, 1], inlet: [2, 1, 2, 1], drain: [0, 2, 1, 1], tactile: [1, 2, 1, 1], grate: [2, 2, 1, 1], plate: [3, 2, 1, 1], leaves: [0, 3, 1, 1], card: [1, 3, 1, 1], clump: [2, 3, 1, 1], patch: [3, 3, 1, 1] };
function buildDecals(C, sample, hist) {
  const acc = new Acc({ position: 3, uv: 2, aTint: 4, aP: 2 }), accUnder = new Acc({ position: 3, uv: 2, aTint: 4, aP: 2 }), grates = []; let count = 0;      // accUnder: slabs and collars, which paint goes over
  const { city } = C, bx = city.meta.px + 40, by = city.meta.py + 40, inPlay = (x, y) => Math.abs(x) < bx && Math.abs(y) < by;
  // c: centre, (ux, uy): unit vector of the long axis, hl / hw: half sizes, h: height or the four corner heights, tiled cells keep the whole cell
  const decal = (x, y, ux, uy, hl, hw, cell, tint, rough, metal, h, inset = 0.012, flag = 0) => {
    const a = (flag === 2 ? accUnder : acc).get(x, y), hs = typeof h === 'number' ? [h, h, h, h] : h, cr = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [p, q, U, V] = cr[k];
      a.position.push(x + ux * p * hl - uy * q * hw, hs[k], -(y + uy * p * hl + ux * q * hw));
      a.uv.push((cell[0] + inset + U * (cell[2] - 2 * inset)) * 0.25, 1 - (cell[1] + cell[3] - inset) * 0.25 + V * (cell[3] - 2 * inset) * 0.25);
      a.aTint.push(tint[0], tint[1], tint[2], rough); a.aP.push(metal, flag);
    }
    count++;
  };
  const RY = 0.016, SY = CURB + 0.006, IRON = [0.95, 0.91, 0.84], CONC = [0.215, 0.21, 0.195], TAR = [0.085, 0.085, 0.088];
  const cover = (x, y, type, d, r1) => { const a = r1 * 6.2832; decal(x, y, Math.cos(a), Math.sin(a), d / 1.56, d / 1.56, CELL.mh(type % 2), IRON, 0.38, 0.5, RY + 0.002, 0.012, 1); };      // cells 0, 1: the two photographed New York covers
  const collar = (x, y, ang, hl, hw, r1) => decal(x, y, Math.cos(ang), Math.sin(ang), hl * 1.25, hw * 1.25, CELL.patch, r1 < 0.55 ? CONC : TAR, 0.85, 0, RY, 0.0, 2);
  // along the streets: covers in the lanes, valve boxes near the kerb lane, rectangular boxes in the parking lane
  for (const ed of C.E) {
    const s0 = ed.ra + 6, s1 = ed.L - ed.rb - 6; if (s1 - s0 < 10) continue;
    const fa = frameAngle(C, ed) * D2R;
    for (let s = s0 + rnd(ed.ei, 21) * 30, j = 0; s < s1; s += 22 + 46 * rnd(ed.ei, j, 22), j++) {
      const q = at(ed, s); if (!inPlay(q.x, q.y)) continue;
      const r = [rnd(ed.ei, j, 23), rnd(ed.ei, j, 24), rnd(ed.ei, j, 25), rnd(ed.ei, j, 26)];
      const lane = Math.floor(r[0] * ed.n), o = r[1] < 0.2 ? -ed.hlf + lane * ed.lw : -ed.hlf + (lane + 0.5) * ed.lw + (r[1] - 0.6) * 0.5;
      const x = q.x + q.dy * o, y = q.y - q.dx * o, d = 0.86 + 0.2 * r[2], twin = r[3] < 0.14;
      if (r[3] < 0.5) collar(x + (twin ? q.dx * 0.8 : 0), y + (twin ? q.dy * 0.8 : 0), fa, twin ? 1.85 : 0.95, 0.95, r[2]);
      cover(x, y, Math.floor(r[2] * 3.999), d, r[1]); if (twin) cover(x + q.dx * 1.6, y + q.dy * 1.6, Math.floor(r[1] * 3.999), d, r[0]);
    }
    for (let s = s0 + rnd(ed.ei, 27) * 50, j = 0; s < s1; s += 35 + 60 * rnd(ed.ei, j, 28), j++) {
      const q = at(ed, s); if (!inPlay(q.x, q.y)) continue;
      const side = rnd(ed.ei, j, 29) < 0.5 ? -1 : 1, o = side * (ed.W / 2 - 0.9 - 1.2 * rnd(ed.ei, j, 30)), x = q.x + q.dy * o, y = q.y - q.dx * o;
      if (rnd(ed.ei, j, 31) < 0.45) decal(x, y, q.dx, q.dy, 0.62, 0.31, CELL.box, [0.62, 0.61, 0.6], 0.7, 0.1, RY);
      else for (let k = 0, m = 1 + Math.floor(rnd(ed.ei, j, 32) * 3); k < m; k++) cover(x + q.dx * k * 0.55 + q.dy * (rnd(j, k, 33) - 0.5) * 0.4, y + q.dy * k * 0.55 - q.dx * (rnd(j, k, 33) - 0.5) * 0.4, Math.floor(rnd(ed.ei, j, k + 34) * 3.999), 0.2 + 0.08 * rnd(j, k, 35), rnd(j, k, 36));
    }
  }
  for (const c of (hist ? hist.covers : [])) { const a = rnd(c.x, c.y, 3) * 6.2832; decal(c.x, c.y, Math.cos(a), Math.sin(a), c.d / 1.56, c.d / 1.56, CELL.mh(c.type), IRON, 0.38, 0.5, RY + 0.002, 0.012, 1); }
  // junctions: a cluster of covers in the box, now and then two of them in one concrete pad
  const ga = C.grid * D2R;
  city.nodes.forEach((nd, ni) => {
    if (nd.e.length < 3 || !inPlay(nd.p[0], nd.p[1])) return;
    if (HERO_NODES.some((h) => Math.hypot(nd.p[0] - h[0], nd.p[1] - h[1]) < 3)) return;      // laid by hand (buildHistory)
    const n = 2 + Math.floor(rnd(ni, 41) * 3), got = [];
    for (let sl = 0, nsl = nd.r >= 10 ? 2 : nd.r >= 7 ? 1 : (rnd(ni, 42) < 0.5 ? 1 : 0); sl < nsl; sl++) {
      let x = 0, y = 0, ok = false; const fa = ga + (rnd(ni, 45 + sl) < 0.5 ? 0 : Math.PI / 2);
      for (let tr = 0; tr < 10 && !ok; tr++) {      // not across a two-way street's centre line (the paint there runs on plain asphalt), not on the other slab
        const a = rnd(ni, 43 + tr * 7 + sl * 91) * 6.2832, rr = nd.r * (0.3 + 0.55 * Math.sqrt(rnd(ni, 44 + tr * 7 + sl * 91))); x = nd.p[0] + Math.cos(a) * rr; y = nd.p[1] + Math.sin(a) * rr;
        ok = !nd.e.some((k) => { const o = C.E[k]; if (!o || o.oneway) return false; const q = at(o, o.e.a === ni ? 0.5 : o.L - 0.5); return Math.abs((x - nd.p[0]) * q.dy - (y - nd.p[1]) * q.dx) < 3.0; }) && !got.some((g) => Math.hypot(g[0] - x, g[1] - y) < 6.5);
      }
      if (!ok) continue;
      decal(x, y, Math.cos(fa), Math.sin(fa), 2.75, 1.6, CELL.patch, CONC, 0.85, 0, RY, 0.0, 2);
      cover(x - Math.cos(fa) * 1.0, y - Math.sin(fa) * 1.0, Math.floor(rnd(ni, 46 + sl) * 3.999), 1.0, rnd(ni, 47 + sl)); cover(x + Math.cos(fa) * 1.0, y + Math.sin(fa) * 1.0, Math.floor(rnd(ni, 48 + sl) * 3.999), 1.0, rnd(ni, 49 + sl));
      got.push([x, y, 3]);
    }
    for (let k = 0; k < n; k++) {
      const a = rnd(ni, k, 50) * 6.2832, rr = nd.r * 0.85 * Math.sqrt(rnd(ni, k, 51)), x = nd.p[0] + Math.cos(a) * rr, y = nd.p[1] + Math.sin(a) * rr;
      if (got.some((g) => Math.hypot(g[0] - x, g[1] - y) < g[2] + 0.8)) continue; got.push([x, y, 0.9]);
      if (rnd(ni, k, 52) < 0.45) collar(x, y, ga, 0.95, 0.95, rnd(ni, k, 53));
      cover(x, y, Math.floor(rnd(ni, k, 54) * 3.999), 0.84 + 0.2 * rnd(ni, k, 55), rnd(ni, k, 56));
    }
  });
  // ramps: tactile warning pad on the slope, a drain inlet in the gutter beside most of them
  for (const { sg, nt } of C.ramps) {
    const kx = sg.a[0] + sg.dx * nt.t, ky = sg.a[1] + sg.dy * nt.t; if (!inPlay(kx, ky)) continue;
    const tint = nt.seed < 0.5 ? [0.74, 0.56, 0.08] : nt.seed < 0.8 ? [0.50, 0.17, 0.11] : [0.30, 0.30, 0.30];
    const H = (d) => RAMP_LOW + (CURB - RAMP_LOW) * d / RAMP_DEP + 0.006, d0 = 0.14, d1 = 0.75, w = (2 * RAMP_HW - 0.12) / 3;
    for (let k = -1; k <= 1; k++) decal(kx + sg.dx * k * w + sg.nx * (d0 + d1) / 2, ky + sg.dy * k * w + sg.ny * (d0 + d1) / 2, sg.dx, sg.dy, w / 2, (d1 - d0) / 2, CELL.tactile, tint, 0.75, 0, [H(d0), H(d0), H(d1), H(d1)], 0.004);
    if (rnd(kx, ky, 61) < 0.9) { const t = nt.away * (RAMP_HW + RAMP_FL + 0.9 + 1.5 * rnd(kx, ky, 62)); decal(kx + sg.dx * t - sg.nx * 0.36, ky + sg.dy * t - sg.ny * 0.36, sg.dx, sg.dy, 0.62, 0.36, CELL.inlet, [0.42, 0.40, 0.385], 0.6, 0.3, RY); }
  }
  // props keep their place: nothing flat under a tree pit, pole or hydrant
  const pg = new SegGrid(40); for (const k in city.props) for (const p of city.props[k]) pg.add(p[0], p[1], p[0], p[1], p);
  const clear = (x, y, r) => { let ok = true; pg.near(x, y, (p) => { if (Math.hypot(p[0] - x, p[1] - y) < r) ok = false; }); return ok; };
  for (const ring of C.rings) for (const sg of ring.segs) {
    if (sg.L < 6 || !inPlay(sg.a[0], sg.a[1])) continue;
    const X = (t, d) => sg.a[0] + sg.dx * t + sg.nx * d, Y = (t, d) => sg.a[1] + sg.dy * t + sg.ny * d, id = ring.bi * 131 + sg.i;
    const inNotch = (t, m) => sg.notches.some((n) => Math.abs(n.t - t) < RAMP_HW + RAMP_FL + m);
    // gutter and kerb-line litter
    for (let t = rnd(id, 71) * 5, j = 0; t < sg.L; t += 2.5 + 7 * rnd(id, j, 72), j++) {
      if (inNotch(t, 0.6)) continue; const r = [rnd(id, j, 73), rnd(id, j, 74), rnd(id, j, 75)], a = r[1] * 6.2832, ux = Math.cos(a), uy = Math.sin(a);
      if (r[0] < 0.5) { const z = 0.3 + 0.35 * r[2]; decal(X(t, -0.12 - 0.3 * r[1]), Y(t, -0.12 - 0.3 * r[1]), sg.dx, sg.dy, z * 1.5, z * 0.75, CELL.leaves, [0.62, 0.52, 0.36], 0.9, 0, RY + 0.003); }
      else if (r[0] < 0.78) { const z = 0.09 + 0.14 * r[2], d = r[1] < 0.6 ? -0.1 - 0.5 * r[2] : 0.35 + 2.2 * r[2], pal = r[1] < 0.35 ? [0.8, 0.8, 0.78] : r[1] < 0.7 ? [0.55, 0.42, 0.28] : [0.3, 0.3, 0.32]; decal(X(t, d), Y(t, d), ux, uy, z, z * (0.6 + 0.5 * r[0]), CELL.card, pal, 0.8, 0, d < 0 ? RY + 0.004 : SY + 0.002); }
      else { const z = 0.18 + 0.2 * r[2]; decal(X(t, -0.25), Y(t, -0.25), ux, uy, z, z, CELL.clump, [0.4, 0.38, 0.35], 0.95, 0, RY + 0.003); }
    }
    if (ring.hole) continue;
    // sidewalk vault grates: runs of steel grating a couple of metres in from the kerb along the avenues
    // subway ventilation grating: only over the subway (the streets with a line under them): one straight run of identical framed panels.
    // Along an ordinary sidewalk it lies in the kerb zone, parallel to the kerb. Beside a shared street it lies on the line between the
    // walkway by the buildings and the plaza (5.2 m from the walls), straight from end to end of the kerb.
    if (sg.ed && SUBWAY.test(sg.ed.e.name || '') && sg.L >= 9.5) {
      const panel = (x, y, ux, uy, hl = 0.75) => { grates.push([x, y, ux, uy, hl, 0.6]); decal(x, y, ux, uy, hl, 0.6, CELL.grate, [1, 1, 1], 0.38, 0.7, SY - 0.004, 0.0, 3); };
      if (!sg.ed.shared) {
        const len = Math.floor((sg.L - 8) / 1.5) * 1.5, t0 = 4 + (sg.L - 8 - len) / 2, ok = [];
        for (let k = 0; k * 1.5 < len; k++) { const t = t0 + (k + 0.5) * 1.5, x = X(t, 1.7), y = Y(t, 1.7), f = sample(x, y); ok.push(!(f[0] < 1.2 || f[0] > 2.3 || f[1] < 1.0 || !clear(x, y, 0.95) || inNotch(t, 1.2))); }
        for (let k = 0; k < ok.length; k++) { if (!ok[k]) continue; let a = k, b = k; while (a > 0 && ok[a - 1]) a--; while (b < ok.length - 1 && ok[b + 1]) b++; if (b - a < 1) continue; const t = t0 + (k + 0.5) * 1.5; panel(X(t, 1.7), Y(t, 1.7), sg.dx, sg.dy); }
      } else {
        const pts = [];
        for (let t = 0.5; t < sg.L - 0.4; t += 1.0) for (let d = 2.5; d < 10; d += 0.2) if (sample(X(t, d), Y(t, d))[1] < 5.2) { pts.push([X(t, d - 0.1), Y(t, d - 0.1)]); break; }
        // straight pieces of that line: split where the points leave the chord by more than 0.5 m
        const piece = (i0, i1) => {
          if (i1 - i0 < 1) return; const A = pts[i0], B = pts[i1], L2 = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L2 < 1.1) return;
          let worst = 0, wi = -1; for (let i = i0 + 1; i < i1; i++) { const d = segDist(pts[i][0], pts[i][1], A[0], A[1], B[0], B[1])[0]; if (d > worst) { worst = d; wi = i; } }
          if (worst > 0.8) { piece(i0, wi); piece(wi, i1); return; }
          // whole panels end to end over the full piece (their length eased a little so they fill it exactly); a panel is laid only if all of it lies on paving
          const ux = (B[0] - A[0]) / L2, uy = (B[1] - A[1]) / L2, n = Math.max(1, Math.round(L2 / 1.5)), pl = L2 / n;
          for (let k = 0; k < n; k++) {
            const x = A[0] + ux * (k + 0.5) * pl, y = A[1] + uy * (k + 0.5) * pl;
            if ([[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => sample(x + ux * a * pl / 2 - uy * b * 0.6, y + uy * a * pl / 2 + ux * b * 0.6)[0] > 0.7)) panel(x, y, ux, uy, pl / 2);
          }
        };
        piece(0, pts.length - 1);
      }
    }
    // cellar plates at the building line
    for (let t = 6 + rnd(id, 91) * 30, j = 0; t < sg.L - 6; t += 24 + 40 * rnd(id, j, 92), j++) {
      if (rnd(id, j, 93) > 0.55) continue; let wall = 0;
      for (let d = 2.0; d < 9; d += 0.25) { const f = sample(X(t, d), Y(t, d)); if (f[0] < d - 0.8) break; if (f[1] < 0.35) { wall = d + f[1]; break; } }
      if (wall < 3.2) continue; const d = wall - 0.82, x = X(t, d), y = Y(t, d); if (!clear(x, y, 1.3)) continue;
      const tint = rnd(id, j, 94) < 0.5 ? [0.52, 0.44, 0.38] : [0.36, 0.37, 0.39];
      for (const k of [-1, 1]) decal(x + sg.dx * k * 0.38, y + sg.dy * k * 0.38, sg.nx, sg.ny, 0.66, 0.365, CELL.plate, tint, 0.5, 0.5, SY, 0.0);
    }
  }
  acc.count = count; acc.under = accUnder; acc.grates = grates; return acc;
}

// pedestrian plazas (plazas.json: OSM highway=pedestrian areas): a flush surface laid over the roadway inside each polygon, with an edge band
// against the traffic. It sits above the ribbons, markings and road decals, so none of them show inside; where the polygon overlaps a
// block the sidewalk (15 cm higher) covers it and keeps its own flags.
const PLAZA_Y = 0.03;
function buildPlazas(plazas) {
  const acc = new Acc({ position: 3, aZ: 4 }, 400); let count = 0;
  plazas.forEach((pz, pi) => {
    const sh = plazaShape(pz); if (!sh) return; const { pts, kind } = sh, sd = rnd(pi, 5) * 50, a = acc.get(pts[0][0], pts[0][1]);
    for (const [p, q, r] of sh.tris) { a.position.push(p.x, PLAZA_Y, -p.y, q.x, PLAZA_Y, -q.y, r.x, PLAZA_Y, -r.y); for (let k = 0; k < 3; k++) a.aZ.push(kind, 0, sd, 0); }
    let run = 0; const W = 0.32, y = PLAZA_Y + 0.004;
    for (let i = 0; i < pts.length; i++) {
      const A = pts[i], B = pts[(i + 1) % pts.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 0.05) continue;
      const nx = -(B[1] - A[1]) / L * W, ny = (B[0] - A[0]) / L * W;
      const c = [[A[0], A[1], run, 0], [B[0], B[1], run + L, 0], [B[0] + nx, B[1] + ny, run + L, 1], [A[0] + nx, A[1] + ny, run, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { a.position.push(c[k][0], y, -c[k][1]); a.aZ.push(kind, 1 + c[k][3], sd, c[k][2]); }
      run += L;
    }
    count++;
  });
  acc.count = count; return acc;
}

// shared streets (shared_streets.json: OSM highway=living_street): one lane of asphalt stays on the centre line, the rest of the roadway out
// to both kerbs is plaza surface with a worn painted line against the lane. Edges are matched to the ways by position and direction.
const SHARED_LANE = 3.3;
function markShared(C, ways) {
  let n = 0;
  for (const ed of C.E) {
    const q = at(ed, ed.L / 2); ed.shared = false;
    for (const w of ways) { for (let i = 1; i < (w.pts || []).length && !ed.shared; i++) {
      const a = w.pts[i - 1], b = w.pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (segDist(q.x, q.y, a[0], a[1], b[0], b[1])[0] < 4 && Math.abs(((b[0] - a[0]) * q.dx + (b[1] - a[1]) * q.dy) / l) > 0.9) ed.shared = true;
    } if (ed.shared) break; }
    if (ed.shared) n++;
  }
  return n;
}
function buildShared(C) {
  const acc = new Acc({ position: 3, aZ: 4 }, 400);
  for (const ed of C.E) {
    if (!ed.shared || ed.W / 2 < SHARED_LANE / 2 + 0.8) continue;
    const sA = ed.ra, sB = ed.L - ed.rb; if (sB - sA < 2) continue;
    const ss = breaks(ed, sA, sB).map((s) => [atSmooth(ed, s), s]), sd = rnd(ed.ei, 77) * 50;
    for (let i = 1; i < ss.length; i++) for (const side of [-1, 1]) {
      const [q0, s0] = ss[i - 1], [q1, s1] = ss[i], P = (q, o) => [q.x + q.dy * o * side, q.y - q.dx * o * side];
      const band = (o0, o1, y, e0, e1) => {
        let c = [[P(q0, o0), e0, s0], [P(q1, o0), e0, s1], [P(q1, o1), e1, s1], [P(q0, o1), e1, s0]];
        if ((c[1][0][0] - c[0][0][0]) * (c[2][0][1] - c[0][0][1]) - (c[1][0][1] - c[0][0][1]) * (c[2][0][0] - c[0][0][0]) < 0) c = [c[1], c[0], c[3], c[2]];
        const a = acc.get(c[0][0][0], c[0][0][1]);
        for (const k of [0, 1, 2, 0, 2, 3]) { a.position.push(c[k][0][0], y, -c[k][0][1]); a.aZ.push(0, c[k][1], sd, c[k][2]); }
      };
      band(SHARED_LANE / 2, ed.W / 2 + 0.05, PLAZA_Y, 0, 0); band(SHARED_LANE / 2, SHARED_LANE / 2 + 0.32, PLAZA_Y + 0.004, 1, 2);
    }
  }
  return acc;
}

// ------------------------------------------------------------------ shaders
const GLSL_COMMON = /* glsl */`
float gh21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 gh32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float gvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(gh21(i), gh21(i+vec2(1,0)), f.x), mix(gh21(i+vec2(0,1)), gh21(i+vec2(1,1)), f.x), f.y); }
float gfbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*gvn(p); p = p*2.03+17.1; a *= .5; } return s; }
// four independent fbm fields (the same 4-octave value noise as gfbm) from one tiling texture, period 32 units: one tap instead of 16 hashes
vec4 gN(vec2 p){ return texture2D(tNoise, p / 32.0); }
vec4 gN0(vec2 p){ return textureLod(tNoise, p / 32.0, 0.0); }
float gsq(float x){ return x * x; }
float gfbmT(vec2 p){ return texture2D(tNoise, p / 32.0).r; }
float gfbm0(vec2 p){ return textureLod(tNoise, p / 32.0, 0.0).r; }      // the same, never blurred by distance: for edges that must stay crisp      // the same fbm from the texture: one tap (not inside branches)
vec2 grot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x + s * p.y, -s * p.x + c * p.y); }
// box-filtered coverage of a line of half-width hw at distance d from its centre, for a pixel footprint fw (all in the same unit)
float gline(float d, float hw, float fw){ fw = max(fw, 1e-5); return clamp((d + hw) / fw, -0.5, 0.5) - clamp((d - hw) / fw, -0.5, 0.5); }
// coverage of the zero isoline of a field f, drawn hwM metres wide, pxM = metres per pixel
float giso(float f, float hwM, float pxM){ float g = length(vec2(dFdx(f), dFdy(f))) + 1e-7; float wpx = hwM / pxM; return clamp(wpx + 0.5 - abs(f) / g, 0.0, min(1.0, 2.0 * wpx)); }
float gbox(float v, float a, float b, float fw){ return clamp((v - a) / fw + 0.5, 0.0, 1.0) * clamp((b - v) / fw + 0.5, 0.0, 1.0); }
vec4 gfieldLod(vec2 m){ vec4 f = textureLod(tField, m / (2.0 * uField.xy) + 0.5, 0.0); float k = step(abs(m.x), uField.x - 1.0) * step(abs(m.y), uField.y - 1.0); return mix(vec4(1.0), f, k); }
vec4 gfield(vec2 m){ vec4 f = texture2D(tField, m / (2.0 * uField.xy) + 0.5); float k = step(abs(m.x), uField.x - 1.0) * step(abs(m.y), uField.y - 1.0); return mix(vec4(1.0), f, k); }
// where the tyres run (x) and where the oil drips (y) across a carriageway: t = metres right of the centre line, lanes of width lw
vec2 glane(float t, float lw, float nl){ float hl = nl * lw * 0.5, x = t + hl; float k = step(0.0, x) * step(x, 2.0 * hl); float lx = (fract(x / lw) - 0.5) * lw;
  float q = (abs(lx) - 0.85) / 0.32; float c = lx / 0.42; return vec2(exp(-q * q), exp(-c * c)) * k; }
// paving strips 3.7 m wide with staggered ends, each with its own tone (0..1, mostly near 0.5); borders fade to the mean over a pixel
float gstrips(vec2 p, float salt, float pxm){
  float row = floor(p.y / 3.7), fy = fract(p.y / 3.7), h1 = gh21(vec2(row, salt)), Lr = 16.0 + 30.0 * h1;
  float xx = (p.x + h1 * 53.0) / Lr, cell = floor(xx), fxr = fract(xx);
  float t = gh21(vec2(cell, row + salt * 7.0));
  float e = min(min(fxr, 1.0 - fxr) * Lr, min(fy, 1.0 - fy) * 3.7);
  return mix(0.5, t, clamp(e / pxm, 0.0, 1.0));
}
// rectangular utility cuts: x = tone change inside the cut, y = tar-sealed edge
vec2 gcuts(vec2 p, vec2 cell, float prob, float salt, float pxm){
  vec2 c = floor(p / cell); vec3 h = gh32(c + salt), k = gh32(c + salt + 19.7);
  vec2 hs = cell * (0.08 + 0.30 * k.xy), ctr = (c + 0.5 + (h.yz - 0.5) * 0.2) * cell;
  vec2 pw = p + 0.10 * (vec2(gvn(p * 1.3 + salt), gvn(p * 1.3 + salt + 31.0)) - 0.5) + 0.18 * (vec2(gvn(p.yx * 0.23 + salt), gvn(p * 0.23 + salt + 5.0)) - 0.5);
  pw = ctr + grot(pw - ctr, (h.y - 0.5) * 0.09);            // cut by hand: a little off square, edges that wander
  vec2 q = abs(pw - ctr) - hs; float d = max(q.x, q.y);
  float ins = clamp(0.5 - d / pxm, 0.0, 1.0), ed = gline(abs(d), 0.016, pxm) * smoothstep(0.30, 0.48, gvn(p * 0.8 + salt));
  float tn = k.z < 0.62 ? -0.22 - 0.5 * k.z : 0.10 + 0.6 * (k.z - 0.62);
  float on = step(h.x, prob);
  float seam = max(ed, gline(abs(d), 0.006 + 0.006 * gvn(p * 3.0 + salt), pxm) * 0.75);
  return vec2(tn * ins, seam * step(0.08, h.z)) * on;
}
// the photo asphalt (ambientCG Asphalt023L, a 2.5 m scan) without visible repeats: two taps at offsets chosen by a slow noise k, blended
vec4 gnotile(sampler2D t, vec2 uv, vec2 dx, vec2 dy, float k){
  float l = k * 8.0, i = floor(l), f = fract(l);
  vec2 oa = sin(vec2(3.0, 7.0) * i), ob = sin(vec2(3.0, 7.0) * (i + 1.0));
  vec4 a = textureGrad(t, uv + oa, dx, dy), b = textureGrad(t, uv + ob, dx, dy);
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * dot(a.rgb - b.rgb, vec3(1.0))));
}
// distance (in cells) to the nearest edge of a jittered cell pattern: the polygons of block cracking
float gvedge(vec2 p){
  vec2 i = floor(p), f = fract(p), mr = vec2(0.0), mg = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) { vec2 g = vec2(float(k), float(j)), r = g + 0.1 + 0.8 * gh32(i + g).xy - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }
  md = 8.0;
  for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) { vec2 g = mg + vec2(float(k), float(j)), r = g + 0.1 + 0.8 * gh32(i + g).xy - f; vec2 dd = r - mr; if (dot(dd, dd) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(dd))); }
  return md;
}
// cracks in the asphalt, shared by the road and the paint over it: x = coverage of the crack line, y = metres to it (9 where none)
vec2 gcrack(vec2 m, float px){
  float zone = smoothstep(0.55, 0.63, gN(m * 0.075 + 41.0).r);
  if (zone < 0.01 || px > 0.06) return vec2(0.0, 9.0);
  vec2 w = m + 0.22 * (vec2(gvn(m * 0.8), gvn(m * 0.8 + 7.0)) - 0.5) + 0.035 * (vec2(gvn(m * 6.0), gvn(m * 6.0 + 3.0)) - 0.5);
  float e = gvedge(w / 2.4) * 2.4;
  float on = zone * smoothstep(0.40, 0.55, gvn(m * 0.9 + 13.0));
  float wid = 0.0025 + 0.0065 * gvn(m * 2.3 + 5.0);
  return vec2(gline(e, wid, px * 1.4) * on * (1.0 - smoothstep(0.03, 0.06, px)), mix(9.0, e, step(0.01, on)));
}
`;

function mkMat(shared, U, o) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  if (o.setup) o.setup(m);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vWPos;\n${o.vsDecl || ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz;\n${o.vsMain || ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
        uniform sampler2D tField; uniform sampler2D tLines; uniform sampler2D tAng; uniform sampler2D tPack1; uniform sampler2D tPack2; uniform sampler2D tDecal; uniform sampler2D tMarks; uniform vec4 uField;
        uniform sampler2D tAsC; uniform sampler2D tAsN; uniform sampler2D tPaint; uniform vec4 uHN; uniform vec4 uHC; uniform vec4 uHD; uniform vec4 uHX; uniform vec2 uHR; uniform sampler2D tNoise; uniform sampler2D tMacro; uniform sampler2D tPhoto;
        vec3 bakeV; vec3 bakeN; float gRough; float gMetal; float gSpec; vec3 gNrm; float gNs;
        ${GLSL_COMMON}
        ${o.fsDecl || ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 m = vec2(vWPos.x, -vWPos.z);
          bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);
          gRough = 0.9; gMetal = 0.0; gSpec = 1.0; gNrm = vec3(0.0, 0.0, 1.0); gNs = 0.0;
          vec2 mdx = dFdx(m), mdy = dFdy(m); float px = max(length(mdx), length(mdy)) + 1e-5;
          ${o.fsMain}
          ${o.graze ? 'diffuseColor.rgb *= 1.0 + ' + o.graze.toFixed(2) + ' * pow(1.0 - clamp(dot(normalize(vViewPosition), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0, 1.0), 3.0);' : ''}      // a road seen at a grazing angle is paler: the stone tops catch the sky
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gNs > 0.0) { vec3 nw = normalize(vec3(gNrm.x * gNs, gNrm.z, -gNrm.y * gNs)); normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(gRough, 0.08, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = clamp(gMetal, 0.0, 1.0);')
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + '\n reflectedLight.directSpecular *= gSpec; reflectedLight.indirectSpecular *= gSpec;');
  };
  m.customProgramCacheKey = () => 'stground75-' + o.name + (o.graze || '');
  return m;
}

const FS_SIDEWALK = /* glsl */`
  vec4 F = gfield(m);
  float dK = F.r * ${FIELD_D}.0, dB = F.b * ${FIELD_DB}.0, dN = F.a * ${FIELD_DN}.0;
  // the flags follow the nearest long kerb or wall: the street grid, or that line's own direction where it runs off the grid
  vec2 fuv = m / (2.0 * uField.xy) + 0.5; vec4 FL = texture2D(tLines, fuv);
  float aOff = radians(texture2D(tAng, fuv).r * 127.5 - 45.0);
  float inF = step(abs(m.x), uField.x - 1.0) * step(abs(m.y), uField.y - 1.0);
  float ang = uField.z + ((FL.g < FL.r - 0.002 && FL.g < 0.75 && inF > 0.5) ? aOff : 0.0);
  float isBand = step(0.5, vS.z);
  vec2 g = grot(m, ang) / ${FLAG}; vec2 gsz = vec2(${FLAG});
  if (isBand > 0.5) { g = vec2(vS.x / ${FLAG}, vS.y); gsz = vec2(${FLAG}, ${(BAND_W - KERB_W).toFixed(3)}); dK = ${KERB_W} + vS.y * ${(BAND_W - KERB_W).toFixed(3)}; }
  else g += 0.022 * (vec2(gvn(g.yx * 1.3 + 3.0), gvn(g * 1.3 + 8.0)) - 0.5) + 0.006 * (vec2(gvn(g.yx * 7.0), gvn(g * 7.0 + 2.0)) - 0.5);       // score lines are cut by hand: never dead straight
  vec2 gi = floor(g), gf = fract(g);
  vec3 h = gh32(gi + floor(ang * 57.0) + vS.w * 13.0);
  vec3 hp = gh32(floor((gi + vec2(1.0, 0.0)) / vec2(4.0, 3.0)) + floor(ang * 57.0) + 71.0);      // the pour this flag belongs to
  float cl = gvn(gi * 0.31 + 5.0);
  float isNew = step(0.84, cl) * (1.0 - isBand * 0.5);                                     // relaid together, in runs
  float isOld = max(step(h.y, 0.03), step(gvn(gi * 0.27 + 61.0), 0.16)) * (1.0 - isNew);
  float big = gfbmT(m * 0.045), mid = gfbmT(m * 0.33 + 9.0);
  float nearK = 1.0 - smoothstep(0.02, 0.08, px);
  vec2 o1 = h.zx * 5.0;
  float cdet = textureGrad(tPack1, m / 2.3 + o1, mdx / 2.3, mdy / 2.3).g;
  float grain = textureGrad(tPack1, m / 0.55 + o1.yx, mdx / 0.55, mdy / 0.55).r;
  float agg = textureGrad(tPack1, m / 0.83 + o1.yx, mdx / 0.83, mdy / 0.83).b;
  // matte broom-finished concrete, warm off-white; tone differs pour to pour and a little flag to flag
  vec3 col = vec3(0.365, 0.345, 0.305);
  col *= (0.90 + 0.20 * hp.x) * (0.975 + 0.05 * h.x); col *= vec3(1.0 + 0.05 * (hp.z - 0.5), 1.0, 1.0 - 0.07 * (hp.z - 0.5));
  col = mix(col, vec3(0.385, 0.366, 0.327), isNew * 0.8);
  col *= mix(vec3(1.0), vec3(0.94, 0.93, 0.90), isOld);
  col *= 0.97 + 0.06 * gfbmT(grot(m, ang) * vec2(1.3, 5.0) + o1);                       // trowel passes
  col *= 0.74 + 0.52 * grain;
  col *= mix(1.0, 0.40 + 1.2 * agg, 0.12 + 0.45 * isOld);       // older pours: the stone of the mix stands out
  vec2 gb = grot(m, ang);
  col *= 1.0 + 0.07 * (gvn(gb * vec2(170.0, 9.0) + o1) - 0.5) * (1.0 - smoothstep(0.003, 0.012, px));       // broom strokes
  // pits and popped stones: round, soft-edged, of mixed size, each at its own place in its cell (never a square of noise)
  vec2 pq = m * 31.0 + 0.35 * vec2(gvn(m * 7.0), gvn(m * 7.0 + 19.0)); vec3 ph = gh32(floor(pq));
  float pr = 0.10 + 0.30 * ph.x * ph.x;
  float pit = step(0.86, ph.z) * (1.0 - smoothstep(pr * 0.45, pr, length(fract(pq) - 0.3 - 0.4 * ph.xy))) * (1.0 - smoothstep(0.006, 0.02, px));
  col *= 1.0 - 0.30 * pit * (0.4 + 0.6 * ph.y);
  col *= 0.90 + 0.20 * big;
  col *= mix(1.0, 0.80 + 0.10 * h.x, isBand);
  // patch repairs: saw-cut rectangles of other concrete that ignore the flag grid
  vec2 rp = gcuts(gb, vec2(5.3, 3.7), 0.30, 7.0 + floor(ang * 57.0), px) * (1.0 - isBand);
  col *= 1.0 + 0.7 * min(rp.x, 0.06); col *= mix(1.0, 0.55 + 0.9 * agg, min(1.0, abs(rp.x) * 3.0));
  // pedestrian plazas (the polygons of plazas.json, written into the field): a tan gravel coating, worn through in places
  vec2 mC = grot((gi + 0.5) * gsz, -ang); vec4 FC = gfieldLod(mC); float cK = FC.r * ${FIELD_D}.0, cB = FC.b * ${FIELD_DB}.0;       // the field at this flag's centre
  float pzSh = step(0.175, FC.g);                                   // beside a shared street (code 4), not a mapped polygon
  float pzShF = step(0.175, F.g) * step(F.g, 0.5), eB = fwidth(dB) + 1e-4;
  float pzIn = mix(step(FC.g, 0.5) * step(2.5, cK) * (1.0 - pzSh), step(0.9, dK) * clamp((dB - 5.2 + 0.30 * (gfbmT(m * 2.6 + 4.0) - 0.47) + 0.10 * (gvn(m * 13.0) - 0.5)) / eB + 0.5, 0.0, 1.0), pzShF),   // polygons keep a flagged kerb zone; beside a shared street the walkway by the buildings stays flags
    pzKind = FC.g < 0.17 ? floor(FC.g * 20.0 + 0.5) : 0.0;
  float plaza = pzIn * (1.0 - step(1.5, pzKind) * step(pzKind, 2.5)) * (1.0 - isBand) * inF;     // only where the map says plaza
  float wornP = smoothstep(0.60, 0.72, gfbmT(m * 0.45 + 60.0));
  float grit = gfbmT(m * 11.0 + 3.0), scuff = smoothstep(0.60, 0.74, gfbmT(grot(m, 0.7) * vec2(0.5, 3.4) + 12.0));
  vec3 gravel = mix(vec3(0.52, 0.44, 0.31), vec3(0.46, 0.40, 0.30), big) * (0.50 + 1.0 * agg) * (0.70 + 0.6 * grain) * (0.84 + 0.34 * grit) * (1.0 - 0.3 * scuff);
  gravel = mix(gravel, vec3(0.17, 0.17, 0.17) * (0.6 + 0.8 * grain), wornP * 0.7);
  vec3 pav = vec3(0.30, 0.295, 0.285) * (0.62 + 0.76 * agg) * mix(0.80 + 0.40 * gh21(floor(gb / vec2(0.30, 0.15))), 1.0, smoothstep(0.02, 0.07, px));
  gravel = pzKind > 2.5 ? vec3(0.105) * clamp(1.0 + (grain - 0.5) * 2.2, 0.5, 1.6) : (pzKind > 0.5 ? pav : gravel);
  col = mix(col, gravel, plaza);
  // dirt: the kerb edge, the foot of the walls, the band where people walk
  float kerbDirt = 1.0 - smoothstep(0.0, 0.8, dK), wallDirt = 1.0 - smoothstep(0.05, 0.7, dB);
  col *= 1.0 - 0.16 * (1.0 - smoothstep(0.5, 1.5, dB)) * (0.5 + mid);          // the darker strip along the building line
  float tread = smoothstep(0.9, 2.2, dK) * smoothstep(0.5, 1.6, dB);
  float shade = 1.0 - bakeV.g;                   // no direct sun reaches here (baked): shaded paving stays damp and holds dirt
  col *= vec3(1.0, 0.985, 0.95) * (1.0 - 0.20 * shade) * (1.0 - 0.26 * shade * (1.0 - smoothstep(0.3, 3.2, dB)) * (0.5 + mid));
  col *= 1.0 - 0.10 * tread * (0.4 + 1.2 * mid);
  col *= 1.0 - 0.24 * kerbDirt * (0.3 + 1.4 * mid) - 0.26 * wallDirt * (0.3 + 1.4 * mid);
  // stains: blotches, runs that follow the fall of the slab, single drips
  float blot = smoothstep(0.62, 0.68, gfbmT(m * 1.7 + 31.0)) * 0.6;
  float runA = smoothstep(0.64, 0.76, gfbmT(gb * vec2(0.33, 2.4) + 7.0)), runB = smoothstep(0.66, 0.76, gfbmT(gb * vec2(2.4, 0.33) + 77.0));
  vec2 dc = floor(m / 0.45); vec3 dh = gh32(dc + 9.0);
  float drip = step(dh.x, 0.24) * (1.0 - smoothstep(0.45, 1.0, (length((fract(m / 0.45) - 0.2 - 0.6 * dh.yz) * vec2(1.0, 0.6 + 0.8 * dh.y)) + 0.05 * (gvn(m * 27.0) - 0.5)) / (0.02 + 0.30 * dh.z * dh.z))) * nearK * (0.35 + 0.65 * dh.y);
  float stain = max(max(blot * 0.8, max(runA, runB) * 0.3) * (1.0 - 0.65 * isNew), drip);
  col *= 1.0 - 0.26 * stain;
  // old chewing gum: densest at corners, by the walls and where people wait
  float corner = 1.0 - smoothstep(0.0, 7.0, dN);
  float hot = smoothstep(0.56, 0.72, gfbmT(m * 0.09 + 50.0));
  float dens = clamp((0.26 + 0.50 * corner + 0.40 * hot + 0.30 * (1.0 - smoothstep(0.3, 1.6, dB)) * smoothstep(0.5, 0.65, gfbmT(m * 0.16 + 80.0))) * (1.0 - 0.75 * isNew), 0.0, 1.0);
  vec2 m2 = grot(m, 1.1);
  // the scanned gum sheet at two sizes (spots of 2-3 cm); a fine mask keeps single spots, more of them where dens is high; each fades with age
  float gA = textureGrad(tPack2, m / 1.0, mdx / 1.0, mdy / 1.0).g, gB = textureGrad(tPack2, m2 / 1.45 + 0.37, grot(mdx, 1.1) / 1.45, grot(mdy, 1.1) / 1.45).g;
  float clus = smoothstep(0.42, 0.62, gfbmT(m * 0.55 + 21.0)) * (0.3 + 0.7 * gvn(m * 0.23 + 5.0));        // gum comes in loose clusters with bare paving between
  dens *= 0.30 + 1.0 * clus;
  float gth = mix(0.93, 0.50, clamp(dens, 0.0, 1.0)), gFar = smoothstep(0.03, 0.10, px);
  float mA = mix(smoothstep(gth, gth + 0.12, gvn(m * 9.0 + 11.0)), 0.9 * dens * dens, gFar), mB = mix(smoothstep(gth, gth + 0.12, gvn(m2 * 7.0 + 47.0)), 0.9 * dens * dens, gFar);
  float gum = max(smoothstep(0.3, 0.7, gA) * mA, smoothstep(0.3, 0.7, gB) * mB);
  float gAge = gvn(m * 4.3 + 3.0); gAge = 0.16 + 0.62 * gAge * gAge * (0.6 + 0.8 * gvn(m * 0.7 + 9.0));
  float pale = smoothstep(0.80, 0.86, gvn(m * 5.0 + 71.0));
  col = mix(col, mix(col * 0.36 + 0.012, vec3(0.42, 0.41, 0.39), pale), gum * gAge);
  // joints: shallow tooled score lines holding dirt, grime beside them, a crack across some flags
  vec2 dj = min(gf, 1.0 - gf) * gsz, fwj = fwidth(g) * gsz;
  float farK = smoothstep(0.3, 0.75, max(fwj.x / gsz.x, fwj.y / gsz.y));
  float jl = max(gline(dj.x, 0.0042, fwj.x), gline(dj.y, 0.0042, fwj.y));
  jl = mix(jl, 0.017 / ${FLAG}, farK) * (0.25 + 1.5 * gvn(g * 0.9 + 13.0));
  float halo = max(1.0 - smoothstep(0.0, 0.07, dj.x), 1.0 - smoothstep(0.0, 0.07, dj.y)) * (1.0 - farK);
  float ca = h.x * 6.2832; vec2 cn = vec2(cos(ca), sin(ca)), cp = (gf - 0.5) * gsz;
  float cf = dot(cp, cn) - (h.z - 0.5) * 0.5 + 0.10 * (gvn(g * 3.3 + 4.0) - 0.5) + 0.04 * (gvn(g * 11.0) - 0.5);
  float cwid = 0.0012 + 0.0075 * pow(gvn(g * 2.7 + h.xy * 9.0), 2.0);        // a crack opens and closes along its length
  float crack = giso(cf, cwid, px) * step(0.88, h.y) * step(h.y, 0.93) * (1.0 - farK) * (1.0 - isBand);
  float crackDirt = (1.0 - smoothstep(0.0, 0.05, abs(cf))) * step(0.88, h.y) * step(h.y, 0.93) * (1.0 - farK) * (1.0 - isBand);
  float lines_ = (1.0 - plaza);
  // chipped corners, filled with dirt
  vec2 cq = dj; float hc = gh21(floor(g + 0.5) + 3.0 + floor(ang * 57.0)), cr = 0.015 + 0.055 * hc;
  float chipc = (1.0 - smoothstep(cr * 0.75, cr, length(cq) + 0.035 * (gvn(g * 17.0) - 0.5))) * step(0.78, hc) * (1.0 - farK) * (1.0 - isBand);
  col *= 1.0 - lines_ * 0.42 * chipc;
  col *= 1.0 - lines_ * 0.6 * rp.y;
  col *= 1.0 - lines_ * 0.12 * halo * (0.4 + 1.2 * mid);
  col *= 1.0 - lines_ * 0.07 * (1.0 - smoothstep(0.0, 0.38, min(dj.x, dj.y))) * (0.2 + 1.6 * mid) * (1.0 - farK);
  col *= 1.0 - lines_ * 0.14 * crackDirt * (0.3 + 1.4 * mid);
  col *= 1.0 - lines_ * 0.14 * isOld * (1.0 - smoothstep(0.0, 0.10 + 0.08 * gvn(g * 9.0), min(dj.x, dj.y)));     // an old flag's edges crumble
  float bandB = (1.0 - step(0.62, dB)) * (1.0 - isBand);                     // the tooled edge band along the building line
  col *= 1.0 - 0.10 * bandB; col *= 1.0 - 0.4 * gline(abs(dB - 0.62), 0.006, fwidth(dB) + 1e-4) * (1.0 - isBand) * (1.0 - farK);
  col *= 1.0 - lines_ * 0.36 * max(jl, crack);
  diffuseColor.rgb = col;
  gRough = 0.96 - 0.2 * stain - 0.2 * gum * gAge; gSpec = 0.3 + 0.5 * stain;
`;

const FS_ROAD = /* glsl */`
  vec4 F = gfield(m);
  float dK = F.r * ${FIELD_D}.0, dN = F.a * ${FIELD_DN}.0;
  #ifdef RIBBON
    float t = vL.x, s = vL.y, seed = vE.w; vec2 fr = vL.zw;
  #else
    float seed = 0.37; vec2 fr = grot(m, uField.z);
  #endif
  // the photo asphalt: albedo (neutralised to its mean, so the shader's tone rules still set the level) and its scanned relief
  // one tap each, a sharper mip (derivatives x 0.6)
  vec2 auv = m / 1.0, adx = mdx / 1.0 * 0.5, ady = mdy / 1.0 * 0.5;      // the scan's stone is coarse: laid smaller it is New York's fine mix
  vec3 asC = textureGrad(tAsC, auv, adx, ady).rgb / vec3(0.166, 0.152, 0.135);
  vec4 asN = textureGrad(tAsN, auv, adx, ady);
  vec4 nA = gN(m * 0.045), nB = gN(m * 0.33 + 9.0), nC = gN(m * 0.9 + 11.0);
  float big = nA.r, mid = nB.r;
  // the hero corridor (23rd St through the 5th Ave and Broadway crossings): its history is laid as geometry (buildHistory), not by these rules
  vec2 hp = m - uHC.xy, hd = uHC.zw - uHC.xy; float hero = 1.0 - smoothstep(uHR.x, uHR.y, length(hp - hd * clamp(dot(hp, hd) / dot(hd, hd), 0.0, 1.0)));
  float calm = 1.0 - smoothstep(uHR.x + 75.0, uHR.y + 85.0, length(hp - hd * clamp(dot(hp, hd) / dot(hd, hd), 0.0, 1.0)));      // the blocks around the hero corridor: no rule-drawn cuts, seams or tar lines (critics call every one of them drawn)
  float tone = 0.148 * (0.98 + 0.04 * big);
  float tar = 0.0, rgh = 0.89, oil = 0.0, pad = 0.0, polish = 0.0;
  #ifndef RIBBON
    // junction boxes and open roadway: paving passes of different ages, lane-wide strips with staggered ends
    float st = gstrips(fr, 3.0, px);
    tone *= mix(0.48 + 0.98 * st, 0.90 + 0.20 * st, calm);
    // through traffic keeps to its lanes across the box: polished wheel paths and oil along both street directions
    vec2 jx = glane(mod(fr.y, 3.3) - 1.65, 3.3, 1.0), jy = glane(mod(fr.x, 3.3) - 1.65, 3.3, 1.0);
    if (hero > 0.0) {      // in the hero boxes: the real lanes of 23rd St and of the avenue that crosses, straight on through the box
      vec2 d0 = m - uHN.xy, d1 = m - uHN.zw; bool west = dot(d0, d0) < dot(d1, d1);
      vec2 hx = glane(dot(west ? d0 : d1, uHD.xy), 4.125, 4.0);
      vec2 hy = west ? glane(dot(d0, uHX.xy), 3.3, 3.0) : glane(dot(d1, uHX.zw), 3.3, 2.0);
      jx = mix(jx, hx, hero); jy = mix(jy, hy * 0.7, hero);
    }
    float jdrip = 0.55 + 0.45 * smoothstep(0.36, 0.60, gN(fr * vec2(0.4, 2.0) + 9.0).g);
    polish = 0.9 * jx.x + 0.55 * jy.x;
    oil = max(oil, (0.16 * jx.y + 0.10 * jy.y) * jdrip);
  #endif
  #ifdef RIBBON
    // paving: sections along the street and passes across it, each laid at a different time, with a joint between them
    float secL = 38.0 + 60.0 * fract(seed * 7.13), sc = s / secL + seed * 13.0, si = floor(sc);
    float hs1 = gh21(vec2(si, seed * 91.0));
    tone *= mix(0.72 + 0.56 * hs1, 0.93 + 0.14 * hs1, calm);
    float lp = (t + 60.0) / 3.7, li = floor(lp), hs2 = gh21(vec2(li + si * 7.0, seed * 31.0));
    tone *= mix(0.88 + 0.24 * hs2, 0.96 + 0.08 * hs2, calm);
    float seam = max(gline(min(fract(sc), 1.0 - fract(sc)) * secL, 0.014, fwidth(s)), gline(min(fract(lp), 1.0 - fract(lp)) * 3.7, 0.011, fwidth(t)) * step(0.35, gh21(vec2(li, si + seed))));
    tar = max(tar, seam * 0.8 * (1.0 - calm));
    // lanes: polished wheel paths, oil between them that builds up before the stop line, a dirty parking strip
    vec2 lane = glane(t, vE.y, vE.x);
    float hl = vE.x * vE.y * 0.5, inl = step(abs(t), hl);
    float flowB = vE.z > 0.5 ? 1.0 : step(0.0, t);
    float dStop = mix(s - vS2.x, vS2.y - s, flowB);
    float nearStop = dStop > -0.6 ? exp(-max(dStop, 0.0) / 15.0) : 0.0;
    float drip = 0.55 + 0.45 * smoothstep(0.36, 0.60, gN(vec2(s * 0.45, t * 2.2) + seed * 50.0).g);
    oil = lane.y * (0.13 + 0.50 * nearStop) * drip;
    polish = lane.x * (0.6 + 0.8 * big);
    float parkSpot = (1.0 - inl) * smoothstep(0.50, 0.66, nC.b);
    oil = max(oil, parkSpot * 0.8);
    tone *= 1.0 + (1.0 - inl) * 0.40 * smoothstep(0.38, 0.6, nB.g);      // dust and dried mud where nothing sweeps
    // a concrete pad in the kerb lane before some stop lines (bus stops)
    pad = vS2.z * gbox(t, hl - vE.y, hl + 0.2, fwidth(t)) * gbox(dStop, 3.0, 30.0, fwidth(s));
    float pj = gline(min(fract(s / 4.6), 1.0 - fract(s / 4.6)) * 4.6, 0.012, fwidth(s));
  #endif
  tone *= 1.0 + 0.07 * polish; rgh -= 0.17 * polish;      // where the tyres run the stone is polished: paler, smoother
  // utility cuts and trench patches by rule in the street's own frame, their edges sealed with tar (not in the hero corridor)
  if (calm < 0.999) {
    vec2 c1 = gcuts(fr, vec2(11.0, 3.6), 0.72, seed * 61.0, px) * (1.0 - calm), c2 = gcuts(fr + 5.0, vec2(21.0, 5.6), 0.62, seed * 23.0 + 4.0, px) * (1.0 - calm);
    tone *= (1.0 + c1.x) * (1.0 + c2.x);
    rgh += clamp((c1.x + c2.x) * 0.9, -0.28, 0.05);                 // newer, darker patches are tighter and shinier; old pale ones dry and open
    tar = max(tar, max(c1.y, c2.y));
  }
  // sealed cracks (tar snakes) by rule, and long cracks that run on across patches and lanes
  float snake = 0.7 * giso(gN(fr * vec2(0.035, 0.30) + 3.0).r - 0.47, 0.013, px) * smoothstep(0.54, 0.64, nA.g) * (1.0 - calm);
  tar = max(tar, snake);
  vec2 ld = vec2(0.94, 0.34); float lf = dot(grot(m, uField.z), ld) + 2.2 * gN(m * 0.11 + 5.0).r + 0.25 * gvn(m * 1.3);
  float lcr = giso((fract(lf / 31.0) - 0.5) * 31.0, 0.011 + 0.012 * gvn(m * 0.6), px) * smoothstep(0.40, 0.5, nA.b);
  tar = max(tar, lcr * 0.9 * (1.0 - calm));
  float allig = textureGrad(tPack2, m / 2.6, mdx / 2.6, mdy / 2.6).r * smoothstep(0.66, 0.73, nA.a);
  // gutter: the dark wet-dirt band against the kerb, flecks of litter in it
  float gut = 1.0 - smoothstep(0.05, 1.15, dK);
  tone *= 1.0 - 0.74 * gut * (0.5 + 1.0 * mid);
  tone *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, 5.0, dN));
  // oil and fluid stains: soft dark spots, single and in groups
  vec2 oc = floor(m / 1.7); vec3 oh = gh32(oc + 3.0);
  float ospot = step(oh.x, 0.15 * (0.3 + 1.4 * mid)) * (1.0 - smoothstep(0.72, 1.0, (length((fract(m / 1.7) - 0.25 - 0.5 * oh.yz) * vec2(1.0, 0.5 + oh.y)) + 0.12 * (gvn(m * 7.0) - 0.5) + 0.05 * (gvn(m * 23.0) - 0.5)) / (0.06 + 0.2 * oh.x / 0.26))) * (1.0 - smoothstep(0.1, 0.3, px));
  oil = max(oil, ospot * 0.5);
  tone *= 1.0 - 0.58 * oil;
  vec3 col = tone * mix(vec3(1.03, 1.0, 0.96), vec3(1.07, 1.0, 0.91), clamp(big * 1.2 + (tone - 0.15) * 2.0, 0.0, 1.0));
  col *= mix(vec3(1.0), mix(vec3(dot(asC, vec3(0.333))), asC, 0.5), mix(0.80, 0.55, smoothstep(0.004, 0.02, px)) - 0.12 * clamp(polish, 0.0, 1.0));
  // real road from centimetres to metres: a 15 m aerial scan of worn asphalt at 3.7 mm a pixel (Poly Haven aerial_asphalt_01, CC0): its own
  // cracks, stains, tyre arcs and stone; laid in the street's frame, each street at its own place in the scan
  vec2 muv = fr / 15.0 + seed * 7.3;
  float mk = max(1.3, 0.008 / px);      // close up the scan is never read finer than 8 mm (two of its pixels): there the close scan carries the stone
  float mac = pow(gnotile(tMacro, muv, dFdx(muv) * mk, dFdy(muv) * mk, nA.a).r, 2.2) / 0.1407;      // two places of the scan, blended by a slow noise: no repeat every 15 m
  col *= mix(1.0, clamp(pow(mac, 0.8), 0.5, 1.6), 0.50 * (1.0 - 0.4 * smoothstep(0.012, 0.08, px)));      // measured against photographs (items/road/bands.py): real asphalt varies by about 1 % at scales above a few centimetres, far less than the scan read at full strength      // a camera loses the stone with distance: the far road is smoother
  // ghost markings: fragments of old lane lines, ground off and painted over, at their own old offsets
  float gy = fr.y / 3.3 + seed * 3.0, gI = floor(gy + 0.5), gd = (gy - gI) * 3.3 - 0.6 * (gh21(vec2(gI, 3.0 + seed)) - 0.5);
  float gOn = step(0.72, gh21(vec2(gI, floor(fr.x / 23.0) + seed * 17.0)));
  float gFr = smoothstep(0.60, 0.64, gN0(fr * vec2(0.5, 3.0) + gI * 7.0).r * 0.8 + 0.2 * gvn(fr * 9.0));
  float ghost = gline(gd, 0.055, px) * gOn * gFr * (1.0 - smoothstep(0.03, 0.08, px));
  col = mix(col, vec3(0.34, 0.335, 0.32), ghost * 0.75);
  col *= 1.0 - 0.5 * allig;
  // trodden gum, black with dirt, thick where people cross
  float gumK = smoothstep(0.0, 0.6, dN) * (1.0 - smoothstep(3.0, 7.0, dN)) * (1.0 - smoothstep(0.004, 0.02, px));
  if (gumK > 0.01) { float gm = textureGrad(tPack2, m / 0.8, mdx / 0.8, mdy / 0.8).g; col *= 1.0 - 0.45 * smoothstep(0.45, 0.75, gm) * smoothstep(0.56, 0.64, nC.g) * gumK; }
  // block cracking in old surface: thin dark cracks, a little dirt held beside them
  vec2 ck = gcrack(m, px);
  col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.05, ck.y)) * (1.0 - smoothstep(0.03, 0.06, px));
  col = mix(col, vec3(0.03, 0.029, 0.027), ck.x * 0.7);
  #ifdef RIBBON
    if (pad > 0.0) {
      float cdet = textureGrad(tPack1, m / 2.3, mdx / 2.3, mdy / 2.3).g;
      col = mix(col, vec3(0.20, 0.195, 0.18) * (0.55 + 0.9 * cdet) * (1.0 - 0.5 * pj) * (1.0 - 0.3 * oil) * (0.8 + 0.4 * big), pad);
      tar *= 1.0 - pad;
    }
  #endif
  col = mix(col, vec3(0.030, 0.030, 0.032), tar * 0.88);
  float fleckFade = 1.0 - smoothstep(0.015, 0.05, px);
  vec3 fh = gh32(floor(m * 13.0));
  float fleck = step(0.955, fh.x) * gut * fleckFade * step(length(fract(m * 13.0) - 0.5), 0.2 + 0.25 * fh.y);
  col = mix(col, mix(vec3(0.20, 0.15, 0.09), vec3(0.36, 0.36, 0.34), step(0.7, fh.z)), fleck);
  diffuseColor.rgb = col;
  gRough = clamp((rgh - 0.28 * oil - 0.42 * tar + 0.06 * gut) * (0.72 + 0.4 * asN.b / 0.66), 0.3, 1.0); gSpec = clamp(0.5 + 0.5 * max(tar, oil) + (0.93 - rgh) * 1.5, 0.3, 1.0);
  gNrm = vec3(asN.xy * 2.0 - 1.0, 0.0); gNrm.z = sqrt(max(0.0, 1.0 - dot(gNrm.xy, gNrm.xy)));
  gNs = 1.3 * (1.0 - 0.7 * tar) * (1.0 - 0.5 * oil) * (1.0 - 0.3 * clamp(polish, 0.0, 1.0));
`;

const FS_KERB = /* glsl */`
  float s = vK.x, v = vK.y, granite = step(0.5, vK.z);
  float len = mix(3.05, 1.83, granite), sj = s / len + vK.w * 7.0, dj = min(fract(sj), 1.0 - fract(sj)) * len;
  float h = gh21(vec2(floor(sj), vK.w * 91.0 + 3.0));
  vec2 kuv = vec2(s, v * ${KERB_W});
  float sp = texture2D(tPack1, kuv / 0.7).b, cd = texture2D(tPack1, kuv / 1.9).g;
  vec3 gran = vec3(0.27, 0.27, 0.265) * (0.5 + 1.0 * sp) * (0.68 + 0.64 * h);
  vec3 conc = vec3(0.235, 0.23, 0.215) * (0.6 + 0.8 * cd) * (0.70 + 0.60 * h);
  float steelBand = (1.0 - granite) * (1.0 - smoothstep(1.28, 1.32, v));
  float rust = smoothstep(0.45, 0.70, gfbmT(vec2(s * 1.3, v * 3.0) + vK.w * 9.0));
  vec3 steel = mix(vec3(0.055, 0.055, 0.056), vec3(0.075, 0.062, 0.054), rust);
  float arris = 1.0 - smoothstep(0.0, 0.16, abs(v - 1.0));
  steel = mix(steel, vec3(0.34, 0.33, 0.32), (1.0 - smoothstep(0.0, 0.07, abs(v - 1.0))) * 0.8 * (1.0 - 0.6 * rust));
  vec3 col = mix(mix(conc, gran, granite), steel, steelBand);
  col *= 1.0 - 0.75 * gline(dj, 0.009, fwidth(s));
  float chip = smoothstep(0.52, 0.60, gfbmT(vec2(s * 3.1, 7.0 + vK.w))) * (1.0 - smoothstep(0.0, 0.3, abs(v - 1.0)));
  col = mix(col, mix(vec3(0.20, 0.12, 0.08), vec3(0.50, 0.50, 0.49), granite), chip * 0.6);
  float face = 1.0 - step(1.0, v);
  col *= mix(1.0, 0.26 + 0.5 * v, face);
  col *= 0.74 + 0.5 * gfbmT(vec2(s * 0.4, v * 2.0));
  col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.12, 2.0 - v));
  col *= 1.0 - 0.45 * smoothstep(0.50, 0.68, gfbmT(vec2(s * 0.9, 3.0)));
  diffuseColor.rgb = col;
  gSpec = 0.5; gRough = mix(0.86, 0.5, steelBand * (1.0 - rust)); gMetal = steelBand * 0.45 * (1.0 - rust);
`;

const FS_MARKS = /* glsl */`
  float kind = vT.w;
  vec3 col = (kind > 0.5 && kind < 1.5) ? vec3(0.38, 0.29, 0.11) : kind > 2.5 ? vec3(0.34, 0.085, 0.055) : vec3(0.60, 0.60, 0.58);
  float shape = (kind > 1.5 && kind < 2.5) ? smoothstep(0.35, 0.65, texture2D(tMarks, vMuv).r) : 1.0;
  vec2 lane = glane(vT.x, vT.y, vT.z);
  float fine = 1.0 - smoothstep(0.02, 0.07, px);
  vec2 mw = grot(m, 0.6); float n = gfbm0(m * clamp(0.26 / vM.z, 0.8, 6.0) + vM.w * 40.0) * 0.74 + (gfbm0(mw * 6.0) * 0.28 - 0.0) * fine + 0.13 * (1.0 - fine);
  float wear = -0.06 + 0.42 * vM.w * vM.w * vM.w + 0.10 * smoothstep(0.85, 1.0, vM.w) + 0.14 * lane.x * vM.w + 0.07 * smoothstep(0.85, 1.0, abs(vM.y));     // paint goes grey long before it goes missing; a few marks are nearly gone
  float e = max(px * 1.2, 0.025);                // paint thins where it is ground away, with a firm edge ...
  float a = smoothstep(-e, e, n - (0.25 + 0.5 * wear)) * shape;
  // a real painted line (ambientCG RoadLines003, from a photo) laid along every line and bar: its ragged edges, cracks and grime
  vec4 pt = vec4(0.71);
  if (kind < 1.5) {
    vec2 puv = vec2(0.5 + vM.y * 0.468, vM.x / (19.5 * vM.z) + fract(vM.w * 137.13) * 11.0 + fract(vM.w * 71.7));
    pt = textureGrad(tPaint, puv, dFdx(puv) * 0.6, dFdy(puv) * 0.6);
    a *= smoothstep(0.25, 0.65, pt.a);
  }
  // ... and thermoplastic also breaks off in flakes with crisp edges: most in the wheel paths and on old paint, along the cracks under it
  vec2 ck = gcrack(m, px);
  // wear goes with the wheels: inside a wheel path the paint is ground thin (grey, the asphalt through it) and breaks off in clusters
  vec4 nM = gN(m * 0.8 + 5.0), nM2 = gN(m * 1.6 + 23.0);
  float wz = smoothstep(0.15, 0.8, lane.x * (0.45 + 0.75 * nM.r) * (0.5 + vM.w));
  // where thermoplastic lets go it goes in sheets: whole sections of a bar gone, crisp-edged islands left; elsewhere it holds
  vec2 bw = vec2(vM.x * 0.45, vM.y * vM.z * 7.0) + vM.w * 13.0 + 4.0;      // bar frame: metres along, metres across (stretched): streaks run with the tyres
  float zoneB = clamp(smoothstep(0.50, 0.66, gfbm0(bw) * 0.75 + 0.25 * gfbm0(m * 0.55 + 9.0)) * (0.5 + 0.7 * vM.w + 0.6 * wz), 0.0, 1.0) * smoothstep(0.45, 0.9, vM.w);
  float fl = gfbm0(vec2(vM.x * 2.5, vM.y * vM.z * 14.0) + vM.w * 37.0) * 0.55 + 0.2 * gfbm0(grot(m, 0.4) * 6.0) + 0.25 * gvn(m * 45.0 + 3.0);
  float fe = max(px * 0.8, 0.002), thr = 0.86 - 0.42 * zoneB - 0.10 * wz;
  float flake = smoothstep(thr - fe, thr + fe, fl);
  // the long edges are ragged by a centimetre or two, more on old paint
  float sideD = (1.0 - abs(vM.y)) * vM.z, rag = gvn(m * 47.0) * 0.6 + gvn(m * 12.0) * 0.4;
  a *= smoothstep(0.0, max(px, 0.002), sideD - 0.010 * rag * (0.4 + vM.w + wz));
  float alongCk = (1.0 - smoothstep(0.004, 0.012 + 0.05 * gvn(m * 13.0 + 2.0) * gvn(m * 2.0), ck.y));
  float lost = max(flake * (1.0 - smoothstep(0.03, 0.08, px) * 0.5), alongCk * step(mix(0.6, 0.2, smoothstep(0.55, 0.9, vM.w)), gvn(m * 4.0 + 9.0)));
  float stk = gN0(vec2(vM.x * 0.30, vM.y * vM.z * 11.0) + vM.w * 23.0).g;       // where the wheels run the paint is scrubbed off in streaks along the bar
  // thermoplastic lets go in hard-edged chips a few centimetres across: thick where the wheels run and where it is old
  float lossP = clamp(0.02 + 0.55 * wz * smoothstep(0.40, 0.60, nM.r) + 0.30 * zoneB + 0.22 * vM.w * vM.w * vM.w, 0.0, 0.92) * (1.0 - smoothstep(0.012, 0.03, px));
  vec2 cw = (gN0(m * 13.0 + 2.0).rg - 0.47) * 2.0 + (gN0(m * 41.0).ba - 0.47) * 0.7, c1p = (m * 24.0 + cw * 1.7) * clamp(0.16 / vM.z, 1.0, 2.6), c2p = (m * 8.5 + cw * 0.9) * clamp(0.16 / vM.z, 1.0, 2.6) + 7.0;      // chips break along wandering lines, not a grid
  lost = max(lost, max(step(gh21(floor(c1p) + 3.0), lossP), step(gh21(floor(c2p) + 11.0), lossP * 0.55)));
  // what lies under the paint comes through it: the road's own cracks and stains, read at the same place of the scan
  vec2 frm = vec2(m.x * vF.x + m.y * vF.y, -m.x * vF.y + m.y * vF.x), muv = frm / 15.0 + vF.z * 7.3; float mk = max(1.3, 0.008 / px);
  float mac = pow(gnotile(tMacro, muv, dFdx(muv) * mk, dFdy(muv) * mk, gN(m * 0.045).a).r, 2.2) / 0.1407;
  col *= mix(1.0, clamp(pow(mac, 0.8) * 1.08, 0.3, 1.0), 0.5);
  float stk2 = gN0(vec2(vM.x * 0.13, vM.y * vM.z * 23.0) + vM.w * 51.0).b;
  col *= 1.0 - 0.22 * wz * (0.5 + nM.b);      // and a grey film of it over the whole wheel path
  col *= 1.0 - 0.36 * wz * smoothstep(0.38, 0.56, stk2) * (0.4 + 0.6 * smoothstep(0.3, 0.6, stk));                 // tyre rubber ground into what is left, in streaks the way the wheels run
  if (kind > 0.5 && kind < 1.5) col = mix(col, col * 0.62 + vec3(0.025), 0.25 + 0.5 * nM.r);      // yellow paint under a film of road dirt
  a *= 1.0 - lost;
  col *= (0.86 + 0.18 * nM.g) * (1.0 - 0.15 * vM.w) * (0.92 + 0.12 * nM2.g);        // thin, scuffed, dirty by age
  col *= 1.0 - 0.20 * lane.x * (0.35 + nM.b) * (0.5 + vM.w) - 0.2 * lane.y * vM.w;
  // the asphalt's grain shows through the paint; tyre and shoe grime, darker toward the edges of the worn places
  vec3 asC = textureGrad(tAsC, m / 1.0, mdx / 1.0 * 0.6, mdy / 1.0 * 0.6).rgb / vec3(0.166, 0.152, 0.135);
  vec4 asN = textureGrad(tAsN, m / 1.0, mdx / 1.0 * 0.6, mdy / 1.0 * 0.6);
  col *= mix(vec3(1.0), clamp(vec3(dot(asC, vec3(0.333))), 0.55, 1.4), 0.30 + 0.20 * vM.w);
  float grime = clamp(smoothstep(0.42, 0.72, nM2.r) * (0.5 + 0.8 * lane.x) + 0.5 * wz, 0.0, 1.0);
  col *= mix(vec3(1.0), vec3(0.66, 0.645, 0.61), grime);
  col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.03, abs(n - (0.25 + 0.5 * wear)))) * (1.0 - smoothstep(0.02, 0.05, px));
  col *= mix(1.0, 0.88, smoothstep(0.4, 0.9, vM.w));
  col *= clamp(vec3(dot(pt.rgb, vec3(0.333)) / 0.71), 0.45, 1.25);
  col = mix(col, vec3(0.03), ck.x * 0.85 * smoothstep(0.55, 0.9, vM.w));                // on old paint the cracks have come through
  col = min(col, vec3(0.62));                                                      // off-white: never a clipped highlight
  if (kind > 3.5) {      // an older marking that was ground off: pale fragments, no body
    float gf = gN0(vec2(vM.x * 0.7, vM.y * vM.z * 6.0) + vM.w * 31.0).r * 0.75 + 0.25 * gN0(m * 5.0).g;
    a = smoothstep(0.50, 0.53, gf) * smoothstep(0.0, 0.01, sideD); col = vec3(0.30, 0.295, 0.28) * (0.7 + 0.5 * nM.g);
  }
  // thermoplastic is opaque: where it is there it is fully there, where it has gone it has gone (a crisp edge, never a milky film)
  float aw = max(fwidth(a) * 0.7, 0.03);
  a = smoothstep(0.42 - aw, 0.42 + aw, a);
  if (kind > 3.5) a *= 0.6;
  // thermoplastic has thickness (3 mm): its edge toward the sun is lit, the edge away from it is in its own shade
  vec2 ga = vec2(dFdx(a), dFdy(a)); float det = mdx.x * mdy.y - mdx.y * mdy.x; det = abs(det) < 1e-12 ? 1e-12 : det;
  vec2 gm = vec2(ga.x * mdy.y - ga.y * mdx.y, ga.y * mdx.x - ga.x * mdy.x) / det;
  float eg = clamp(length(ga) * 1.6, 0.0, 1.0) * (1.0 - smoothstep(0.004, 0.02, px)) * step(kind, 3.5);
  float lit = dot(normalize(gm + 1e-9), normalize(vec2(uSunDir.x, -uSunDir.z) + 1e-6));
  col *= 1.0 - 0.50 * eg * max(lit, 0.0); col += vec3(0.16) * eg * max(-lit, 0.0);
  diffuseColor = vec4(col, a);
  gRough = 0.8; gSpec = 0.4;
  gNrm = vec3(asN.xy * 2.0 - 1.0, 0.0); gNrm.z = sqrt(max(0.0, 1.0 - dot(gNrm.xy, gNrm.xy))); gNs = 0.7;
`;

// a repair laid as geometry over the road (buildHistory): vQ = local metres (along, across) and the half sizes, vR = kind, tone, seed
const FS_PATCH = /* glsl */`
  float kind = vR.x;
  vec4 nW = gN(m * 0.31 + vR.z * 19.0), nF = gN(m * 2.7 + vR.z * 7.0), nR = gN(m * 12.0 + 3.0);
  float rotA = 0.7 + vR.z * 5.0, sc = (kind > 1.5 && kind < 2.5) ? 1.5 : 0.8;
  vec2 puv = grot(m, rotA) / sc + vR.z * 9.0, pdx = grot(mdx, rotA) / sc * 0.6, pdy = grot(mdy, rotA) / sc * 0.6;
  vec3 asC = textureGrad(tAsC, puv, pdx, pdy).rgb / vec3(0.166, 0.152, 0.135);
  float asL = dot(asC, vec3(0.333));
  vec2 q = abs(vQ.xy) - vQ.zw;
  float wob = 0.085 * (nW.r - 0.47) + 0.050 * (nF.r - 0.47) + 0.018 * (nR.r - 0.47) + 0.022 * (asL - 1.0);      // the edge breaks from stone to stone
  float sd = max(q.x, q.y) + wob * ((kind > 0.5 && kind < 1.5) ? 0.2 : 1.0);            // metres outside the cut line: saw cuts wander a little, formed concrete hardly
  float sealOn = smoothstep(0.60, 0.66, nW.b) * step(kind, 0.5), sealOut = 0.035 * sealOn * (0.3 + nF.g);
  if (kind > 2.5 && kind < 3.5) sd = (length(vQ.xy / vQ.zw) - 1.0) * min(vQ.z, vQ.w) + 2.2 * wob;
  if (kind > 3.5) { float e = min(vQ.x, vQ.z - vQ.x), wd = kind > 4.5 ? vQ.w * (0.12 + 2.4 * nW.g * nW.g + 0.8 * nR.g * nR.g) * (1.0 - smoothstep(0.03, 0.09, px)) : vQ.w * (0.35 + 0.9 * nF.r); sd = abs(vQ.y + (kind > 4.5 ? 0.004 : 0.02) * (nF.g - 0.47)) - wd * smoothstep(0.0, 0.25, e); }
  if (kind > 5.5) sd = -1.0;
  if (sd > sealOut) discard;
  vec4 asN = textureGrad(tAsN, puv, pdx, pdy);
  vec2 muv = grot(m, rotA) / 15.0 + vR.z * 3.1;
  float mk = max(1.3, 0.008 / px);
  float mac = pow(textureGrad(tMacro, muv, grot(mdx, rotA) / 15.0 * mk, grot(mdy, rotA) / 15.0 * mk).r, 2.2) / 0.1407;
  float phz = max(vR.y - vQ.x, 0.8), phv = 2525.0 / phz;       // the photographed street: metres ahead of its camera -> the photo's own row and column
  vec2 phuv = vec2((1385.0 + vQ.y * phv / 1.58) / 2860.0, 1.0 - (phv - 222.0) / 1712.0); vec4 ph = textureGrad(tPhoto, phuv, dFdx(phuv) * 0.7, dFdy(phuv) * 0.7);
  vec3 col; float rgh = 0.9, ns = 1.0, spec = 0.5;
  float edge = 1.0 - smoothstep(0.0, 0.02 + 0.16 * nF.g * nF.g * 2.0, -sd);       // 1 at the cut line, 0 a few centimetres inside it
  float nearK = 1.0 - smoothstep(0.008, 0.03, px);
  // traffic runs on over a repair: the same wheel paths and oil line as the road around it
  vec2 ln = glane(vR.w, max(vW.x, 0.1), vW.y);
  // a cut settles a few millimetres (or stands proud): the edge toward the sun is shaded by the step, the far edge catches the light
  vec2 oq = q.x > q.y ? vec2(sign(vQ.x), 0.0) : vec2(0.0, sign(vQ.y)), om = vec2(vW.z * oq.x - vW.w * oq.y, vW.w * oq.x + vW.z * oq.y);
  float lip = dot(om, normalize(vec2(uSunDir.x, -uSunDir.z) + 1e-6)) * (fract(vR.z * 57.0) < 0.7 ? 1.0 : -1.0) * (1.0 - smoothstep(0.0, 0.028, -sd)) * nearK * step(kind, 2.5);
  if (kind < 0.5) {            // newer asphalt in a trench or keyhole: darker, finer, tighter, the roller's passes along it
    float pass = gN0(vec2(vQ.x * 0.21, vQ.y * 2.4) + vR.z * 31.0).g;
    col = vec3(0.148 * mix(1.0, vR.y, 0.62)) * vec3(1.03, 1.0, 0.96) * mix(vec3(1.0), mix(vec3(asL), asC, 0.5), 0.45) * (0.84 + 0.34 * pass) * (0.88 + 0.26 * nW.a);
    col *= (1.0 + 0.16 * ln.x) * (1.0 - 0.30 * ln.y * (0.3 + 0.7 * nW.g)) * clamp(1.0 + (mac - 1.0) * 0.36, 0.6, 1.5);
    rgh = 0.70; ns = 0.6; spec = 0.8;
    float seal = max(edge, step(0.0, sd)) * sealOn;       // hot-poured sealant along the saw cut, most of the way round, lapping onto the old road
    col = mix(col, vec3(0.028, 0.028, 0.030) * (0.8 + 0.5 * nF.b), seal * 0.93); rgh = mix(rgh, 0.30, seal); ns *= 1.0 - 0.8 * seal; spec = mix(spec, 1.0, seal);
    col *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.006 + px, -sd)) * (1.0 - sealOn) * nearK * smoothstep(0.52, 0.6, nW.g) * 0.6;            // unsealed stretches: a hairline open joint, rarely
  } else if (kind < 1.5) {     // a concrete slab: sawn joints, oil where buses stand, tyre marks, a dirty joint against the asphalt
    float wide = smoothstep(1.0, 1.6, vQ.w);
    float jd = abs(fract(vQ.x / 4.6) - 0.5) * 4.6;
    float cd = gN0(m * 1.9 + 3.0).r;
    col = vec3(0.250, 0.243, 0.222) * vR.y * (0.78 + 0.46 * cd) * (0.84 + 0.34 * nF.b) * (0.70 + 0.30 * asL);
    float drip = exp(-gsq(vQ.y / (0.36 * vQ.w))) * (0.35 + 0.65 * nW.g) * wide;
    float tyre = exp(-gsq((abs(vQ.y) - 0.62 * vQ.w) / (0.17 * vQ.w))) * (0.3 + 0.7 * nW.a) * wide;
    col *= (1.0 - 0.50 * drip - 0.20 * tyre) * clamp(1.0 + (mac - 1.0) * 0.4, 0.7, 1.4);
    col *= 1.0 - 0.25 * smoothstep(0.55, 0.68, nW.b);
    col *= 1.0 - 0.7 * (1.0 - smoothstep(0.004, 0.012 + px, jd)) * wide;
    col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.03, -sd));
    rgh = 0.93 - 0.3 * drip; ns = 0.35; spec = 0.35 + 0.4 * drip;
  } else if (kind < 2.5) {     // an old, oxidised patch: pale, open, stony, cracked
    col = vec3(0.148 * mix(1.0, vR.y, 0.62)) * vec3(1.05, 1.0, 0.93) * mix(vec3(asL), asC, 0.6) * (0.72 + 0.5 * asL) * (0.90 + 0.22 * nW.a);
    col *= (1.0 + 0.14 * ln.x) * (1.0 - 0.30 * ln.y * (0.3 + 0.7 * nW.g)) * clamp(1.0 + (mac - 1.0) * 0.45, 0.5, 1.6);
    float ck = gN0(grot(m, rotA) * vec2(0.5, 1.7) + vR.z * 3.0).a;
    col *= 1.0 - 0.55 * (1.0 - smoothstep(0.002, 0.006 + 0.3 * px, abs(ck - 0.47))) * (1.0 - smoothstep(0.02, 0.05, px));
    col *= 1.0 - 0.45 * edge * smoothstep(0.35, 0.5, nW.g) * nearK;
    rgh = 0.97; ns = 1.5;
  } else if (kind < 3.5) {     // cold patch thrown into a pothole: black, lumpy
    col = vec3(0.046) * (0.6 + 0.8 * asL) * (0.8 + 0.4 * nF.b); rgh = 0.7; ns = 2.2; spec = 0.8;
    col *= 1.0 - 0.3 * edge;
  } else if (kind > 5.5) {     // a photographed street (street76.webp): its own asphalt, paint, cover, patches and cracks; our close scan's stone only nearer than it resolves
    float pe = min(min(phuv.x, 1.0 - phuv.x) * 40.0, min(phuv.y, 1.0 - phuv.y) * 25.0);       // the photo's own frame: nothing beyond it
    if (pe < 0.0 || ph.a * clamp(pe, 0.0, 1.0) < 0.5 + 0.7 * (nR.r - 0.47) + 0.5 * (asL - 1.0)) discard;
    float pl = dot(ph.rgb, vec3(0.333)) / 0.2408;
    col = ph.rgb / vec3(0.2518, 0.2479, 0.2226) * 0.135 * vec3(1.03, 1.0, 0.96) * mix(1.0, 0.8 + 0.2 * asL, 1.0 - smoothstep(0.0008, 0.003, px));
    float pnt = smoothstep(1.7, 2.3, pl); rgh = mix(0.9, 0.8, pnt); ns = 0.5 * (1.0 - pnt); spec = 0.5;
  } else if (kind < 4.5) {     // crack sealant: a black band poured along a crack, dulled by dust
    col = vec3(0.030, 0.030, 0.032) * (0.8 + 0.6 * nF.b); rgh = 0.36 + 0.3 * nW.g; ns = 0.15; spec = 1.0;
  } else {                     // an open crack: dark, dirt in it
    col = mix(vec3(0.028), vec3(0.075, 0.071, 0.066), smoothstep(0.35, 1.0, abs(vQ.y) / max(vQ.w * 1.5, 1e-4))) * (0.7 + 0.8 * nR.g); rgh = 0.98; ns = 0.0; spec = 0.2;
  }
  col *= 1.0 - 0.52 * max(lip, 0.0) + 0.42 * max(-lip, 0.0);
  diffuseColor.rgb = col;
  gRough = clamp(rgh * (0.72 + 0.4 * asN.b / 0.66), 0.3, 1.0); gSpec = spec;
  gNrm = vec3(asN.xy * 2.0 - 1.0, 0.0); gNrm.z = sqrt(max(0.0, 1.0 - dot(gNrm.xy, gNrm.xy)));
  gNs = ns;
`;

// a photographed road (photo/photos.json, items/road/photolay.py): vQ.xy = ground metres in the photo camera's frame (X right, Z ahead).
// uPH maps them to the texture; its alpha is the feathered outline; uPN = the photo's asphalt (linear rgb) and the paint threshold;
// uPL = level, grain, texture width and height; uPM = mirror line Z (below it the photo is read mirrored: bars carried on toward the camera), near end Z, contrast, paint gain (a sunlit photo exposes its pale road up toward its paint: the paint's step above the road is put back)
const FS_PHOTO = /* glsl */`
  vec2 g = vQ.xy; float zr = g.y;
  if (g.y < uPM.x) g.y = 2.0 * uPM.x - g.y;
  vec3 hh = uPH * vec3(g, 1.0); vec2 puv = hh.xy / hh.z;
  vec4 ph = textureGrad(tPh, puv, dFdx(puv) * 0.65, dFdy(puv) * 0.65);
  vec4 nW = gN(m * 0.31 + 3.0), nF = gN(m * 2.7 + 7.0);
  float a = ph.a;
  a = smoothstep(0.0, 1.0, a + ((nW.r - 0.47) * 0.9 + (nF.r - 0.47) * 0.45) * (1.0 - abs(2.0 * a - 1.0)));      // the photo gives way to the road beside it over a wide, uneven band: never a line
  a *= smoothstep(uPM.y, uPM.y + 0.45, zr + 0.15 * (nF.g - 0.47));
  if (a < 0.004) discard;
  vec3 asC = textureGrad(tAsC, m / 1.0, mdx / 1.0 * 0.5, mdy / 1.0 * 0.5).rgb / vec3(0.166, 0.152, 0.135);
  vec4 asN = textureGrad(tAsN, m / 1.0, mdx / 1.0 * 0.5, mdy / 1.0 * 0.5);
  float asL = dot(asC, vec3(0.333));
  float pl = dot(ph.rgb, vec3(0.333)) / dot(uPN.rgb, vec3(0.333));
  float pnt = smoothstep(uPN.a * 0.85, uPN.a * 1.15, pl);
  vec3 col = pow(ph.rgb / uPN.rgb, vec3(uPM.z)) * uPL.x * mix(vec3(1.03, 1.0, 0.96), vec3(1.0), pnt);      // a little more contrast than the photo's own (the film pass lifts blacks); paint stays white, not cream
  col *= mix(1.0, uPM.w * 0.86, pnt);      // paint: off-white, never clipped, the road's stone telling through it close up
  vec2 tx = puv * uPL.zw; float mag = 1.0 - clamp(min(length(dFdx(tx)), length(dFdy(tx))) * 1.4, 0.0, 1.0);      // 1 where the photo has fewer pixels than the screen (seen from the side, a photo taken along the street is thin in one direction)
  col *= mix(1.0, clamp(asL, 0.5, 1.5), clamp(uPL.y * (0.35 + 1.5 * mag), 0.0, 0.9) * (1.0 - pnt) * (1.0 - smoothstep(0.006, 0.03, px)));       // the stone a phone camera smears away, from our close scan, on asphalt only
  if (uPT.x + uPT.y + uPT.z > 0.0) {      // fresh loop f2-f4 (Nov 12): what a sunlit, noise-reduced photograph lost, put back from scans: stone-level aggregate at its real size, paint worn off the stone tops, the slow stains of a used road
    vec3 sC = textureGrad(tAsC, m / 2.2, mdx / 2.2 * 0.5, mdy / 2.2 * 0.5).rgb / vec3(0.166, 0.152, 0.135); float sL = dot(sC, vec3(0.333));
    float sk = 1.0 - uPT.w * smoothstep(0.012, 0.06, px);
    vec2 muv = m / 15.0 + 0.37; float mac = pow(textureGrad(tMacro, muv, mdx / 15.0, mdy / 15.0).r, 2.2) / 0.1407;
    col *= mix(1.0, mix(clamp(mac, 0.55, 1.5), min(1.0, 0.5 + 0.5 * mac + 0.5 * min(mac, 0.8) - 0.4), pnt), uPT.z);      // on paint only the scan's dark features tell, never a lighter patch
    float fl = smoothstep(0.0, 0.22, sL * 0.55 + nF.r * 0.5 + (nW.g - 0.47) * 2.2 * uPT.y - 0.88) * pnt * step(0.001, uPT.y) * sk;
    col = mix(col, uPL.x * sC * 0.9, fl * 0.85);
    col *= mix(1.0, clamp(sL, 0.35, 1.9), uPT.x * sk * mix(1.0, 0.4, pnt * (1.0 - fl)));
  }
  diffuseColor = vec4(col, a);
  gRough = clamp(mix(mix(0.9, 0.8, pnt), mix(0.56, 0.40, pnt), uPS.x) * (0.72 + 0.4 * asN.b / 0.66), 0.25, 1.0); gSpec = mix(0.5, 1.0, uPS.x);      // sheen: worn stone and thermoplastic glare toward the sun (the light's direction reads on the road)
  gNrm = vec3(asN.xy * 2.0 - 1.0, 0.0); gNrm.z = sqrt(max(0.0, 1.0 - dot(gNrm.xy, gNrm.xy)));
  gNs = mix(0.5 * (1.0 - pnt), 0.9 * (1.0 - 0.6 * pnt), uPS.x);
`;

// a steel road plate: vR.x = 0 top, 1 edge, 2 the asphalt ramp packed against it; vQ = local metres and half sizes
const FS_PLATE = /* glsl */`
  float part = vR.x;
  vec4 nW = gN(m * 0.7 + vR.y * 17.0), nF = gN(m * 5.0 + 3.0);
  vec3 asC = textureGrad(tAsC, m / 1.3, mdx / 1.3, mdy / 1.3).rgb / vec3(0.166, 0.152, 0.135);
  float asL = dot(asC, vec3(0.333));
  vec3 col; float rgh = 0.7, met = 0.0;
  if (part < 0.5) {
    float rust = smoothstep(0.40, 0.60, nW.r * 0.7 + nF.g * 0.3);
    col = mix(vec3(0.060, 0.058, 0.058), vec3(0.082, 0.058, 0.044), rust);
    float tr = exp(-gsq((abs(vQ.y) - 0.50 * vQ.w) / (0.26 * vQ.w))) * (0.45 + 0.55 * nF.r);     // where the tyres cross it the steel is polished bright
    col = mix(col, vec3(0.19, 0.185, 0.18), tr * 0.65);
    col *= 0.80 + 0.40 * nF.b;
    vec2 hq = (abs(vQ.xy) - vec2(0.72 * vQ.z, 0.0)) / vec2(0.045, 0.022);
    col *= 1.0 - 0.9 * (1.0 - smoothstep(0.8, 1.0, length(hq)));                                      // the two lifting holes
    vec2 eq = vQ.zw - abs(vQ.xy); float ed = min(eq.x, eq.y);
    col = mix(col, vec3(0.21, 0.20, 0.19), (1.0 - smoothstep(0.0, 0.02, ed)) * 0.6);                  // worn bright arris
    rgh = mix(0.72, 0.42, tr * (1.0 - rust)); met = 0.75 * (1.0 - 0.6 * rust);
  } else if (part < 1.5) {
    col = vec3(0.050, 0.040, 0.034); rgh = 0.8; met = 0.3;
  } else {
    col = vec3(0.050) * (0.6 + 0.8 * asL) * (0.8 + 0.4 * nF.b); rgh = 0.72;
  }
  diffuseColor.rgb = col;
  gRough = rgh; gMetal = met; gSpec = 0.8;
`;
const FS_DECAL = /* glsl */`
  vec4 tx = texture2D(tDecal, vMuv, -0.9); float gMetalK = 1.0;
  float a = smoothstep(0.30, 0.72, tx.a);
  vec3 col = tx.rgb / max(tx.a, 0.35);
  vec2 lu = fract(vMuv * 4.0) - 0.5; float rr = length(lu) * 2.0, frr = fwidth(rr) + 1e-4; vec2 ludx = dFdx(vMuv) * 4.0, ludy = dFdy(vMuv) * 4.0;
  float ag = texture2D(tPack1, m / 1.1).r, cd = texture2D(tPack1, m / 2.3).g, dirt = gfbm(m * 0.9 + 13.0), nz = gfbm(m * 5.0);
  vec2 cc = (floor(vMuv * 4.0) + 0.5) / 4.0; vec3 tc = texture2D(tDecal, clamp(cc + (vMuv - cc) / 0.80, cc - 0.122, cc + 0.122), -0.9).rgb;
  if (vP.y > 0.5 && vP.y < 1.5) {
    // cast-iron cover (inner 78 % of the quad): a true circle, the casting at full contrast, patina, a worn rim, a dark seating gap;
    // outside it a stain of rust water and tyre dirt that fades into the road
    float r2 = rr / 0.78;
    float l = dot(tc, vec3(0.333)); col = mix(vec3(l), tc, 0.25); col = clamp(vec3(0.165, 0.155, 0.14) + (col - 0.2) * 0.55, 0.05, 0.32);      // the photographed cover keeps its own rust and wear
    col = mix(col, vec3(0.10, 0.08, 0.065) * (0.6 + 0.8 * gvn(m * 23.0)), 0.25 * smoothstep(0.35, 0.7, nz));
    col = mix(col, vec3(0.26, 0.25, 0.24), 0.6 * smoothstep(0.84, 0.87, r2) * (1.0 - smoothstep(0.90, 0.92, r2)));
    col *= 1.0 - 0.6 * smoothstep(0.94, 0.955, r2);
    // the cover sits a centimetre down in its frame: the sun-side wall shades it, the far lip catches the light
    float jd = ludx.x * ludy.y - ludx.y * ludy.x; vec2 wv = (mdx * (lu.x * ludy.y - lu.y * ludy.x) + mdy * (lu.y * ludx.x - lu.x * ludx.y)) / (abs(jd) < 1e-12 ? 1e-12 : jd);
    float sd = dot(normalize(wv + 1e-6), normalize(vec2(uSunDir.x, -uSunDir.z) + 1e-6));
    col *= 1.0 - 0.75 * smoothstep(0.1, 0.9, sd) * smoothstep(0.70, 0.86, r2) * (1.0 - smoothstep(0.93, 0.96, r2));
    col += vec3(0.22, 0.21, 0.19) * smoothstep(0.2, 0.9, -sd) * smoothstep(0.90, 0.93, r2) * (1.0 - smoothstep(0.97, 1.0, r2));
    if (vTint.r > 1.1) {
      col = vec3(0.075, 0.077, 0.064) * (0.8 + 0.4 * gfbm(m * 6.0 + 2.0)) * (1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.7, r2)));
      col *= 1.0 - 0.18 * smoothstep(0.55, 0.7, gfbm(m * 9.0 + 7.0));
      col *= 1.0 - 0.35 * smoothstep(0.90, 0.97, r2); col /= vTint.rgb; gMetalK = 0.0;
    }
    float inC = clamp((1.0 - r2) / (frr / 0.78) + 0.5, 0.0, 1.0), halo = (1.0 - smoothstep(0.78, 0.99, rr)) * (0.08 + 0.2 * nz);
    float ring = (1.0 - smoothstep(0.88, 0.97, rr + 0.22 * (nz - 0.47))) * 0.6;
    col = mix(vec3(0.085, 0.082, 0.078) * (0.6 + 0.8 * ag), col, inC); a = mix(max(halo, ring), 1.0, inC);
  } else if (vP.y > 1.5 && vP.y < 2.5) {
    // concrete or asphalt make-good around covers: a saw-cut outline that is nearly but not quite straight, its own aggregate, stains, a thin sealed joint
    float ed = max(abs(lu.x), abs(lu.y)) * 2.0 + 0.012 * (gvn(m * 4.0) - 0.5), fe = fwidth(ed) + 1e-4;
    a = clamp((0.80 - ed) / fe + 0.5, 0.0, 1.0);
    col = vec3(1.0) * (0.50 + 1.0 * ag) * clamp(1.0 + (cd - 0.5) * 2.5, 0.6, 1.4) * (0.75 + 0.5 * nz);
    col = mix(col, vec3(0.03), (0.35 + 0.45 * smoothstep(0.25, 0.4, dirt)) * clamp((ed - 0.775) / fe + 0.5, 0.0, 1.0));
    col *= 1.0 - 0.4 * smoothstep(0.5, 0.7, gfbm(m * 1.7 + 3.0));
    col *= 0.78 + 0.44 * gfbm(m * 3.3 + 17.0);
    col *= 1.0 - 0.35 * smoothstep(0.6, 0.66, gfbm(m * 5.0 + 3.0));
  } else if (vP.y > 2.5) {
    // grating: plain dark steel, a little dust; the texture carries the frame, the slots and the concrete border
    col = mix(vec3(dot(col, vec3(0.333))), col, 0.5) * (0.9 + 0.2 * nz);
    col /= (0.72 + 0.5 * dirt); gMetalK = smoothstep(0.10, 0.22, dot(tx.rgb, vec3(0.333))) * (1.0 - smoothstep(0.42, 0.5, dot(tx.rgb, vec3(0.333))));   // steel where the texture is bar or frame, not gap or concrete
  }
  col *= (0.72 + 0.5 * dirt) * vTint.rgb;
  diffuseColor = vec4(col, a);
  gRough = mix(0.85, vTint.a, gMetalK); gMetal = vP.x * gMetalK;
`;

const FS_PLAZA = /* glsl */`
  vec4 F = gfield(m); float dK = F.r * ${FIELD_D}.0;
  float kind = vZ.x, isEdge = step(0.5, vZ.y), big = gfbm(m * 0.045 + vZ.z), mid = gfbm(m * 0.33 + 9.0);
  float grain = textureGrad(tPack1, m / 0.55, mdx / 0.55, mdy / 0.55).r, agg = textureGrad(tPack1, m / 0.83, mdx / 0.83, mdy / 0.83).b;
  float cdet = textureGrad(tPack1, m / 2.3, mdx / 2.3, mdy / 2.3).g;
  // tan epoxy-gravel coating over the old asphalt, worn through to it where feet and wheels turn
  float wornP = smoothstep(0.58, 0.72, gfbm(m * 0.45 + 60.0 + vZ.z));
  float grit = gfbm(m * 11.0 + 3.0), scuff = smoothstep(0.60, 0.74, gfbm(grot(m, 0.7) * vec2(0.5, 3.4) + 12.0));
  vec3 col = mix(vec3(0.52, 0.44, 0.31), vec3(0.46, 0.40, 0.30), big) * (0.50 + 1.0 * agg) * (0.70 + 0.6 * grain) * (0.84 + 0.34 * grit) * (1.0 - 0.3 * scuff);
  col = mix(col, vec3(0.12, 0.12, 0.12) * (0.6 + 0.8 * grain), wornP * 0.65);
  vec2 g = grot(m, uField.z); vec2 fwg = fwidth(g); float fws = fwidth(vZ.w);
  if (kind > 0.5 && kind < 1.5) {          // unit pavers
    vec2 q = g / vec2(0.30, 0.15); q.x += 0.5 * mod(floor(q.y), 2.0); vec2 qi = floor(q), qf = fract(q), sz = vec2(0.30, 0.15);
    vec2 dj = min(qf, 1.0 - qf) * sz, fw = fwg; float farK = smoothstep(0.25, 0.7, max(fw.x, fw.y) / 0.15);
    float jl = mix(max(gline(dj.x, 0.003, fw.x), gline(dj.y, 0.003, fw.y)), 0.05, farK);
    col = vec3(0.30, 0.295, 0.285) * mix(0.82 + 0.36 * gh21(qi + vZ.z), 1.0, farK) * (0.62 + 0.76 * agg) * (0.8 + 0.4 * big);
    col *= 1.0 - 0.5 * jl;
  } else if (kind > 1.5 && kind < 2.5) {   // concrete in large bays
    vec2 q = g / 3.0; vec2 qi = floor(q), qf = fract(q), dj = min(qf, 1.0 - qf) * 3.0, fw = fwg;
    col = vec3(0.39, 0.38, 0.355) * (0.86 + 0.28 * gh21(qi + vZ.z)) * clamp(1.0 + (cdet - 0.5) * 1.3, 0.8, 1.2) * (0.74 + 0.52 * grain) * (0.9 + 0.2 * big);
    col *= 1.0 - 0.5 * max(gline(dj.x, 0.006, fw.x), gline(dj.y, 0.006, fw.y)) * (1.0 - smoothstep(0.3, 0.75, max(fw.x, fw.y) / 3.0));
  } else if (kind > 2.5) {                 // left as asphalt, closed to traffic
    col = vec3(0.105) * (0.8 + 0.4 * big) * clamp(1.0 + (grain - 0.5) * 2.2, 0.5, 1.6);
  }
  float blot = smoothstep(0.60, 0.72, gfbm(m * 0.8 + 31.0));
  col *= 1.0 - 0.22 * blot; col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.8, dK)) * (0.3 + 1.4 * mid);
  // the edge against the roadway: a band of granite blocks, or a worn painted line on coated and asphalt plazas
  if (isEdge > 0.5) {
    float s = vZ.w, across = vZ.y - 1.0;
    if (kind > 0.5 && kind < 2.5) { float bj = min(fract(s / 0.45), 1.0 - fract(s / 0.45)) * 0.45; col = vec3(0.30, 0.30, 0.295) * (0.5 + 1.0 * agg) * (0.8 + 0.4 * gh21(vec2(floor(s / 0.45), vZ.z))) * (1.0 - 0.6 * gline(bj, 0.005, fws)); }
    else { float w = smoothstep(-0.05, 0.05, gfbm(m * 1.1 + vZ.z) * 0.74 + gvn(m * 9.0) * 0.2 - 0.38) * step(across, 0.5); col = mix(col, vec3(0.62, 0.62, 0.59) * (0.8 + 0.3 * mid), w); }
  }
  diffuseColor.rgb = col; gRough = 0.94; gSpec = 0.35;
`;

const FS_GRASS = /* glsl */`
  float big = gfbm(m * 0.05), mid = gfbm(m * 0.4 + 9.0), det = texture2D(tPack2, m / 2.1).b;
  vec3 col = mix(vec3(0.050, 0.085, 0.022), vec3(0.085, 0.105, 0.030), big) * (0.55 + 0.9 * mid) * (0.6 + 0.8 * det);
  float bare = smoothstep(0.62, 0.74, gfbm(m * 0.13 + 40.0));
  col = mix(col, vec3(0.115, 0.095, 0.065) * (0.6 + 0.8 * det), bare * 0.8);
  diffuseColor.rgb = col; gRough = 0.95;
`;

// ------------------------------------------------------------------ the part
export async function add(game, ctx) {
  const world = game.world, city = game.city || ctx.city, shared = world.shared, renderer = world.renderer;
  const group = new THREE.Group(); group.name = 'streets_ground';
  const L = new THREE.TextureLoader();
  const load = (f, srgb, rep) => new Promise((res, rej) => L.load(ctx.A + 'ground/' + f, (t) => {
    t.wrapS = t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.anisotropy = srgb ? 16 : 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t);
  }, undefined, () => rej(new Error('ground texture ' + f))));
  // a grey image as a one-channel texture (a quarter of the memory of RGBA); the shader undoes the sRGB curve itself
  const lum = (f) => new Promise((res, rej) => { const im = new Image(); im.onerror = () => rej(new Error('ground texture ' + f)); im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data, r = new Uint8Array(c.width * c.height); for (let i = 0; i < r.length; i++) r[i] = px[i * 4];
    const t = new THREE.DataTexture(r, c.width, c.height, THREE.RedFormat, THREE.UnsignedByteType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; res(t);
  }; im.src = ctx.A + 'ground/' + f; });
  const [tPack1, tPack2, tDecal, tAsC, tAsN, tPaint, tPhoto, tMacro] = await Promise.all([load('pack1.jpg', false, true), load('pack2.jpg', false, true), load('decals.webp', true, false), load('asph_col.jpg', true, true), load('asph_nrm.jpg', false, true), load('paint.webp', true, true), Promise.resolve(null), lum('asph_macro4k.jpg')]);
  const photos = await fetch(ctx.A + 'ground/photo/photos.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const tPh = await Promise.all(photos.map((p) => load(p.file, true, false)));
  const maxAniso = renderer.capabilities.getMaxAnisotropy(); for (const t of [tAsC, tAsN, tPaint, tMacro, ...tPh]) t.anisotropy = maxAniso;


  const plazas = await fetch(ctx.A + 'ground/plazas.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const sharedWays = await fetch(ctx.A + 'ground/shared_streets.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const C = readCity(city); const nShared = markShared(C, sharedWays); const hist = buildHistory(C);
  const fx = city.meta.px + 60, fy = city.meta.py + 60;
  const field = renderField(renderer, C, fx, fy, plazas);
  const U = { tField: { value: field.tField }, tLines: { value: field.tLines }, tAng: { value: field.tAng }, tPack1: { value: tPack1 }, tPack2: { value: tPack2 }, tDecal: { value: tDecal }, tMarks: { value: marksAtlas() },
    tAsC: { value: tAsC }, tAsN: { value: tAsN }, tPaint: { value: tPaint }, tNoise: { value: renderNoise(renderer).texture }, tMacro: { value: tMacro }, tPhoto: { value: tPack1 }, uHN: { value: new THREE.Vector4(-240.1, -353.8, -201.4, -374.4) },
    uHC: { value: new THREE.Vector4(...hist.cap) }, uHR: { value: new THREE.Vector2(30, 36) }, uHD: { value: new THREE.Vector4(...hist.n23, 0, 0) }, uHX: { value: new THREE.Vector4(...hist.nx) }, uField: { value: new THREE.Vector4(fx, fy, C.grid * D2R, 0) } };

  const vary = (decl, body) => ({ vsDecl: decl.map((d) => `attribute ${d}; varying ${d.replace(' a', ' v')};`).join(' '), vsMain: body, fsDecl: decl.map((d) => `varying ${d.replace(' a', ' v')};`).join(' ') });
  const mats = {
    sidewalk: mkMat(shared, U, { name: 'walk', ...vary(['vec4 aS'], 'vS = aS;'), fsMain: FS_SIDEWALK }),
    band: mkMat(shared, U, { name: 'walk', ...vary(['vec4 aS'], 'vS = aS;'), fsMain: FS_SIDEWALK, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; } }),
    kerb: mkMat(shared, U, { name: 'kerb', ...vary(['vec4 aK'], 'vK = aK;'), fsMain: FS_KERB, setup: (m) => { m.side = THREE.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } }),
    road: mkMat(shared, U, { name: 'road', vsDecl: '', vsMain: '', fsDecl: '', fsMain: FS_ROAD, graze: 0.55 }),
    ribbon: (() => { const v = vary(['vec4 aL', 'vec4 aE', 'vec4 aS2'], 'vL = aL; vE = aE; vS2 = aS2;'); v.fsDecl = '#define RIBBON\n' + v.fsDecl; return mkMat(shared, U, { name: 'ribbon', ...v, fsMain: FS_ROAD, graze: 0.55, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; } }); })(),
    marks: (() => { const v = vary(['vec4 aM', 'vec4 aT', 'vec3 aF'], 'vM = aM; vT = aT; vF = aF; vMuv = uv;'); v.vsDecl += ' varying vec2 vMuv;'; v.fsDecl += ' varying vec2 vMuv;'; return mkMat(shared, U, { name: 'marks', ...v, fsMain: FS_MARKS, graze: 0.08, setup: (m) => { m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } }); })(),
    decal: (() => { const v = vary(['vec4 aTint', 'vec2 aP'], 'vTint = aTint; vP = aP; vMuv = uv;'); v.vsDecl += ' varying vec2 vMuv;'; v.fsDecl += ' varying vec2 vMuv;'; return mkMat(shared, U, { name: 'decal', ...v, fsMain: FS_DECAL, setup: (m) => { m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -6; } }); })(),
    plaza: mkMat(shared, U, { name: 'plaza', ...vary(['vec4 aZ'], 'vZ = aZ;'), fsMain: FS_PLAZA, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -8; } }),
    grass: mkMat(shared, U, { name: 'grass', fsMain: FS_GRASS, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } }),
    patch: mkMat(shared, U, { name: 'patch', ...vary(['vec4 aQ', 'vec4 aR', 'vec4 aW'], 'vQ = aQ; vR = aR; vW = aW;'), fsMain: FS_PATCH, graze: 0.55, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -1.5; m.polygonOffsetUnits = -3; } }),
    patchOver: mkMat(shared, U, { name: 'patch', ...vary(['vec4 aQ', 'vec4 aR', 'vec4 aW'], 'vQ = aQ; vR = aR; vW = aW;'), fsMain: FS_PATCH, graze: 0.55, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -2.5; m.polygonOffsetUnits = -5; } }),
    plate: mkMat(shared, U, { name: 'plate', ...vary(['vec4 aQ', 'vec4 aR', 'vec4 aW'], 'vQ = aQ; vR = aR; vW = aW;'), fsMain: FS_PLATE, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -3.5; m.polygonOffsetUnits = -7; } }),
  };

  let tris = 0; const addAll = (acc, mat, setup) => { for (const m of acc.meshes(mat, setup)) group.add(m); tris += acc.n; };
  addAll(buildSidewalk(C), mats.sidewalk);
  const kb = buildKerb(C); addAll(kb.kerb, mats.kerb); addAll(kb.band, mats.band);
  addAll(buildRibbons(C), mats.ribbon, (m) => { m.renderOrder = -2; });
  const marks = buildMarks(C); addAll(marks, mats.marks, (m) => { m.renderOrder = 2; });
  addAll(hist.under, mats.patch, (m) => { m.renderOrder = -1.5; }); addAll(hist.over, mats.patchOver, (m) => { m.renderOrder = -1.4; }); addAll(hist.plates, mats.plate, (m) => { m.renderOrder = -1.3; });
  // photographed road: one quad per photo over the ground it shows, drawn over the markings (it brings its own), blended at its feathered outline
  photos.forEach((p, i) => {
    const acc = new Acc({ position: 3, aQ: 4 }), d = p.world.dir, dl = Math.hypot(d[0], d[1]), dx = d[0] / dl, dy = d[1] / dl, rx = dy, ry = -dx;
    const mz = p.mirror ? p.mirror.z : -1e3, z0 = p.mirror ? p.mirror.to : p.box[2], Y = 0.016 + (p.lift || 0);
    const c = [[p.box[0], z0], [p.box[1], z0], [p.box[1], p.box[3]], [p.box[0], p.box[3]]].map(([X, Z]) => ({ p: [p.world.x + dx * Z + rx * X, Y, -(p.world.y + dy * Z + ry * X)], X, Z }));
    const a = acc.get(p.world.x, p.world.y);
    for (const tri of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]]) for (const v of triTo(tri, [0, 1, 0])) { a.position.push(...v.p); a.aQ.push(v.X, v.Z, 0, 0); }
    const v = vary(['vec4 aQ'], 'vQ = aQ;'); v.fsDecl += ' uniform sampler2D tPh; uniform mat3 uPH; uniform vec4 uPN; uniform vec4 uPL; uniform vec4 uPM; uniform vec2 uPS; uniform vec4 uPT;';
    const H = new THREE.Matrix3(); H.set(...p.H);
    const mat = mkMat(shared, { ...U, tPh: { value: tPh[i] }, uPH: { value: H }, uPN: { value: new THREE.Vector4(p.norm[0], p.norm[1], p.norm[2], p.paintAt || 1.9) }, uPL: { value: new THREE.Vector4(p.level, p.grain, p.size[0], p.size[1]) }, uPM: { value: new THREE.Vector4(mz, z0, p.contrast || 1.0, p.paintGain || 1.0) }, uPS: { value: new THREE.Vector2(p.sheen || 0, 0) }, uPT: { value: new THREE.Vector4(p.stone || 0, p.flake || 0, p.macro || 0, p.stoneFade === undefined ? 1 : p.stoneFade) } },
      { name: 'photo', ...v, fsMain: FS_PHOTO, graze: 0.55, setup: (m) => { m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -6; } });
    addAll(acc, mat, (m) => { m.renderOrder = 2.5 + i * 0.01; });      // in the order listed: a photo cut in two (for pixels enough) overlaps itself seamlessly
  });
  const decals = buildDecals(C, field.sample, hist); addAll(decals.under, mats.decal, (m) => { m.renderOrder = 1; }); addAll(decals, mats.decal, (m) => { m.renderOrder = 3; });

  const pz = buildPlazas(plazas); addAll(pz, mats.plaza, (m) => { m.renderOrder = -1; });
  /* lead, Nov 10 (Matt: z-fighting): the shared-street bands lie in the plaza polygons' plane with the same material; their own material, one offset step nearer. */
  addAll(buildShared(C), mkMat(shared, U, { name: 'plaza', ...vary(['vec4 aZ'], 'vZ = aZ;'), fsMain: FS_PLAZA, setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -5; m.polygonOffsetUnits = -10; } }), (m) => { m.renderOrder = -1; });
  // the lead's ground: road and grass keep their meshes with new materials; sidewalk, kerb and markings are superseded by the meshes above
  const replaced = [];
  world.cityRoot.traverse((o) => {
    if (!o.isMesh) return; const k = /^(road|sidewalk|curb|grass|marks)(_\d+)?$/.exec(o.name); if (!k) return;
    if (k[1] === 'road') o.material = mats.road; else if (k[1] === 'grass') o.material = mats.grass; else o.visible = false;
    replaced.push(o.name);
  });
  world.scene.add(group);
  return { group, mats, field, grates: decals.grates, report: { photos: photos.length, history: hist.count, instances: decals.count + marks.count, ktris: Math.round(tris / 1000), ramps: C.ramps.length, plazas: pz.count, shared: nShared, grates: decals.grates.length, decals: decals.count, marks: marks.count, grid: +C.grid.toFixed(2), replaced: replaced.join(',') } };
}

export const _test = { buildHistory, buildPlazas, markShared, buildShared, readCity, buildSidewalk, buildKerb, buildRibbons, buildMarks, buildDecals, fieldGeometry };
