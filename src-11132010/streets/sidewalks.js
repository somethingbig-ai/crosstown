// sidewalks.js (lanes/streets, item SIDEWALKS AND KERBS). Loads right after ground.js and takes over, in the hero blocks
// (Flatiron to W 23rd St), the sidewalk slabs and the kerbs that ground.js draws:
//   - the slabs are laid out by hand rules in the frame of the nearest kerb line (metres along it, metres in from it): frontages of
//     different owners with their own pour, tint, flag size and age; a kerb course; a strip at the building line; tooled joints with a
//     real groove (normal), expansion joints, cracks from a scanned slab, gum from a scan, stains, wear where people walk;
//     the material is three real photographed concretes (Poly Haven) with their normal maps, a different window of them per flag;
//   - the kerb is real geometry: stones of granite or steel-faced concrete with a battered face, a rounded arris, their own length,
//     small steps between stones, mitred at corners, dropping at the ramps.
// Outside the hero blocks ground.js's rule stays; its sidewalk colour is scaled once here (it rendered near-white under the light lane's sun).
// At load: removes ground.js's sidewalk / kerb-band / kerb triangles inside the hero blocks; wraps its sidewalk material's shader.
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';

const CURB = 0.15, KW = 0.18, D2R = Math.PI / 180, NS = 24;
const RAMP_HW = 0.9, RAMP_FL = 0.5, RAMP_DEP = 1.35, RAMP_LOW = 0.022;        // as ground.js lays its ramps (its notches are reused)
const HERO = [[-240, -354], [-201, -374], [-244, -408], [-228, -440]], HERO_R = 60;

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
  return Math.hypot(px - x1 - dx * t, py - y1 - dy * t);
}
function ringDist(pts, x, y) { let d = 1e9; for (let i = 0, n = pts.length; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1])); } return d; }

// the kerb rings of the city (same reading as ground.js: sidewalk on the left of the direction of travel)
function readRings(city) {
  const rings = [];
  city.blocks.forEach((b, bi) => {
    [b.ext, ...(b.holes || [])].forEach((r, k) => {
      const pts = []; for (const q of r) { const l = pts[pts.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-3) pts.push([q[0], q[1]]); }
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) pts.pop();
      if (pts.length < 3) return;
      if ((ringArea(pts) > 0) !== (k === 0)) pts.reverse();
      const ring = { pts, bi, hole: k > 0, segs: [], seed: rnd(bi, k, 7) }; let run = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), dx = (c[0] - a[0]) / (L || 1), dy = (c[1] - a[1]) / (L || 1);
        ring.segs.push({ ring, i, a, b: c, L, dx, dy, nx: -dy, ny: dx, run, notches: [], ave: false }); run += L;
      }
      ring.len = run; rings.push(ring);
    });
  });
  return rings;
}

// (r23) a real kerb radius at the corners. The city's block outlines cut each corner off with one or two straight chamfers; here every such
// chamfer between two long kerb lines becomes an arc tangent to both, lying on the road side of the chamfer (so the walk only grows and the
// road mesh underneath stays whole). Ramp notches and the avenue flag of the long lines are carried over.
function roundCorners(ring) {
  const S = ring.segs, n = S.length; if (ring.hole || n < 4) return 0;
  const long = S.map((sg) => sg.L >= 5), i0 = long.findIndex((v) => v); if (i0 < 0) return 0;
  const pts = []; let made = 0;       // [x, y, arcTag]
  for (let q = 0; q < n;) {
    const A = S[(i0 + q) % n]; let k = 1; while (k < n && !long[(i0 + q + k) % n]) k++;
    const B = S[(i0 + q + k) % n];
    pts.push([A.a[0], A.a[1], 0]);
    if (k > 1 && B !== A) {
      const P1 = A.b, P2 = B.a, cr = A.dx * B.dy - A.dy * B.dx; let done = false;
      if (cr > 0.2) {
        const u = ((P2[0] - P1[0]) * B.dy - (P2[1] - P1[1]) * B.dx) / cr, V = [P1[0] + A.dx * u, P1[1] + A.dy * u];       // where the two kerb lines would meet
        const c1 = u, c2 = (P2[0] - V[0]) * B.dx + (P2[1] - V[1]) * B.dy, c = Math.min(c1, c2);
        if (c1 >= -1e-3 && c2 >= -1e-3 && c > 0.5 && c < 9 && c1 - c < A.L * 0.4 + 3 && c2 - c < 3.5) {
          const phi = Math.atan2(cr, A.dx * B.dx + A.dy * B.dy), r = c / Math.tan(phi / 2), T1 = [V[0] - A.dx * c, V[1] - A.dy * c];
          const C = [T1[0] + A.nx * r, T1[1] + A.ny * r], a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), N = Math.max(4, Math.ceil(phi / (7.5 * D2R)));
          made++;
          for (let j = 0; j <= N; j++) { const an = a0 + phi * j / N; pts.push([C[0] + r * Math.cos(an), C[1] + r * Math.sin(an), j < N ? made : -made, r, phi]); }
          done = true;
        }
      }
      if (!done) for (let j = 1; j < k; j++) { const sg = S[(i0 + q + j) % n]; pts.push([sg.a[0], sg.a[1], 0]); }
    }
    q += k;
  }
  if (!made) return 0;
  // drop doubled points, rebuild the segments; a new segment that lies along an old long kerb line inherits its notches
  const P = []; for (const p2 of pts) { const l = P[P.length - 1]; if (!l || Math.hypot(p2[0] - l[0], p2[1] - l[1]) > 2e-3) P.push(p2); else if (p2[2] > 0) { l[2] = p2[2]; l[3] = p2[3]; l[4] = p2[4]; } }
  if (P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 2e-3) { const e = P.pop(); if (e[2] > 0 && !(P[0][2] > 0)) { P[0][2] = e[2]; P[0][3] = e[3]; P[0][4] = e[4]; } }
  for (let i = 0; i < P.length; i++) {       // the old start of a kerb line that now begins at the end of a bend: no longer a corner
    const pv = P[(i + P.length - 1) % P.length], p2 = P[i], nx2 = P[(i + 1) % P.length];
    if (p2[2] === 0 && pv[2] < 0 && Math.abs((p2[0] - pv[0]) * (nx2[1] - p2[1]) - (p2[1] - pv[1]) * (nx2[0] - p2[0])) < 1e-3 * Math.hypot(nx2[0] - p2[0], nx2[1] - p2[1])) { P.splice(i, 1); i--; }
  }
  const segs = []; let run = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), dx = (c[0] - a[0]) / (L || 1), dy = (c[1] - a[1]) / (L || 1);
    const sg = { ring, i, a: [a[0], a[1]], b: [c[0], c[1]], L, dx, dy, nx: -dy, ny: dx, run, notches: [], ave: false }; run += L;
    if (a[2] > 0) { sg.arc = a[2]; sg.arcR = a[3]; sg.arcPhi = a[4]; }
    else for (const o of S) {
      if (!(o.L >= 5) || o.dx * dx + o.dy * dy < 0.9999) continue;
      if (Math.abs((a[0] - o.a[0]) * o.nx + (a[1] - o.a[1]) * o.ny) > 0.01) continue;
      const sh = (o.a[0] - a[0]) * dx + (o.a[1] - a[1]) * dy; if (sh > L || sh + o.L < 0) continue;
      sg.ave = o.ave; sg.notches = o.notches.map((nt) => ({ t: nt.t + sh })).filter((nt) => nt.t > RAMP_HW + RAMP_FL + 0.05 && nt.t < L - RAMP_HW - RAMP_FL - 0.05); break;
    }
    segs.push(sg);
  }
  // each arc: its place along the bend, and the outward direction at both ends of every piece (for smooth shading)
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i]; if (!sg.arc) continue;
    const pv = segs[(i + segs.length - 1) % segs.length], nx2 = segs[(i + 1) % segs.length];
    sg.arcFirst = pv.arc !== sg.arc; sg.arcLast = nx2.arc !== sg.arc; sg.arcT0 = sg.arcFirst ? 0 : pv.arcT0 + pv.L; sg.arcLen = sg.arcR * sg.arcPhi;
    const mA = [pv.nx + sg.nx, pv.ny + sg.ny], mB = [sg.nx + nx2.nx, sg.ny + nx2.ny], la = Math.hypot(mA[0], mA[1]), lb = Math.hypot(mB[0], mB[1]);
    sg.nA = sg.arcFirst ? [sg.nx, sg.ny] : [mA[0] / la, mA[1] / la]; sg.nB = sg.arcLast ? [sg.nx, sg.ny] : [mB[0] / lb, mB[1] / lb];
  }
  ring.pts = P.map((p2) => [p2[0], p2[1]]); ring.segs = segs; ring.len = run; return made;
}

// ------------------------------------------------------------------ geometry
const P3 = (x, y, h) => [x, h, -y];
function pushTri(a, A, B, C) {
  a.position.push(...A, ...B, ...C);
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  a.normal.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}
function mkGeo(a, spec) {
  const g = new THREE.BufferGeometry();
  for (const s in spec) g.setAttribute(s, new THREE.BufferAttribute(new Float32Array(a[s]), spec[s]));
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}

// one block's sidewalk: the block outline with a notch at every ramp, the ramps as sloped triangles (aR = 1)
function buildWalk(rs, bedH = CURB) {
  const a = { position: [], normal: [], aR: [] };
  const loops = rs.map((ring) => {
    const out = [];
    for (const sg of ring.segs) {
      out.push(new THREE.Vector2(sg.a[0], sg.a[1]));
      for (const nt of sg.notches) {
        const P = (t, d) => [sg.a[0] + sg.dx * t + sg.nx * d, sg.a[1] + sg.dy * t + sg.ny * d];
        const Bl = P(nt.t - RAMP_HW - RAMP_FL, 0), Al = P(nt.t - RAMP_HW, 0), Ar = P(nt.t + RAMP_HW, 0), Br = P(nt.t + RAMP_HW + RAMP_FL, 0), Cl = P(nt.t - RAMP_HW, RAMP_DEP), Cr = P(nt.t + RAMP_HW, RAMP_DEP);
        out.push(new THREE.Vector2(...Bl), new THREE.Vector2(...Cl), new THREE.Vector2(...Cr), new THREE.Vector2(...Br));
        const tri = (p, q, r) => { pushTri(a, p, q, r); a.aR.push(1, 1, 1); };
        tri(P3(...Al, RAMP_LOW), P3(...Ar, RAMP_LOW), P3(...Cr, CURB)); tri(P3(...Al, RAMP_LOW), P3(...Cr, CURB), P3(...Cl, CURB));
        tri(P3(...Bl, CURB), P3(...Al, RAMP_LOW), P3(...Cl, CURB)); tri(P3(...Ar, RAMP_LOW), P3(...Br, CURB), P3(...Cr, CURB));
      }
    }
    return out;
  });
  const ext = loops[rs.findIndex((r) => !r.hole)], holes = loops.filter((l, i) => rs[i].hole); if (!ext) return null;
  const all = ext.concat(...holes); let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(ext, holes); } catch (e) { tris = []; }
  for (const t of tris) {
    let [p, q, r] = [all[t[0]], all[t[1]], all[t[2]]];
    if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0) [q, r] = [r, q];
    a.position.push(p.x, bedH, -p.y, q.x, bedH, -q.y, r.x, bedH, -r.y); a.normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0); a.aR.push(0, 0, 0);
  }
  return mkGeo(a, { position: 3, normal: 3, aR: 1 });
}

// the kerb of one ring: stones with a profile. Profile point = (d: metres in from the kerb line, h: fraction of the kerb height, extra mm, v)
//   v: 0 foot of the face .. 0.9 top of the face .. 1.1 end of the rounding .. 2 inner edge of the top
const PROFILE = [[-0.004, 0, -0.03, 0], [0.004, 1, -0.016, 0.9], [0.007, 1, -0.0075, 0.97], [0.012, 1, -0.0025, 1.04], [0.020, 1, 0.0, 1.1], [KW, 1, 0.0, 2]];       // (r24) a squared kerb with a 16 mm nose: the 3 cm rounding read as a pipe
function buildKerb(ring, a, gut, sun, skirt, dbg = '') {
  const segs = ring.segs, n = segs.length;
  const mitre = segs.map((sg, i) => {         // at each ring vertex: the direction in which an inward offset moves the corner
    const p = segs[(i + n - 1) % n], k = 1 + p.nx * sg.nx + p.ny * sg.ny; if (k < 0.3) return [sg.nx, sg.ny];
    return [(p.nx + sg.nx) / k, (p.ny + sg.ny) / k];
  });
  for (let si = 0; si < n; si++) {
    const sg = segs[si]; if (sg.L < 0.02) continue;
    if (sg.flush) {                             // the Flatiron's Broadway edge: walk and plaza are one surface in the photographs; the 15 cm fall is taken up over a metre
      const n2 = Math.max(1, Math.round(sg.L / 2)), P = (t, d, h) => [sg.a[0] + sg.dx * t + sg.nx * d, h, -(sg.a[1] + sg.dy * t + sg.ny * d)];
      for (let i = 0; i < n2; i++) {
        const t0 = sg.L * i / n2 - (i === 0 ? 0.25 : 0), t1 = sg.L * (i + 1) / n2 + (i === n2 - 1 ? 0.25 : 0);
        for (const [d0, h0, d1, h1] of [[KW + 0.02, CURB + 0.004, 0, CURB + 0.004], [0, CURB + 0.004, -1.1, 0.040]]) {
          const q = [P(t0, d0, h0), P(t1, d0, h0), P(t1, d1, h1), P(t0, d1, h1)];
          pushTri(skirt, q[0], q[2], q[1]); pushTri(skirt, q[0], q[3], q[2]);
        }
      }
      continue;
    }
    const mA = mitre[si], mB = mitre[(si + 1) % n], kind = sg.kind, sd = ring.seed;
    const cIn = (CURB - RAMP_LOW) * KW / RAMP_DEP;
    // height of the kerb top along the segment: [t, outer height, inner height]
    const bp = [[0, CURB, CURB]];
    for (const nt of sg.notches) {
      const tB = nt.t - RAMP_HW - RAMP_FL, tA = nt.t - RAMP_HW, k = cIn / (CURB - RAMP_LOW);
      bp.push([tB, CURB, CURB], [tB + (tA - tB) * k, CURB - cIn, CURB], [tA, RAMP_LOW, RAMP_LOW + cIn], [nt.t + RAMP_HW, RAMP_LOW, RAMP_LOW + cIn],
        [nt.t + RAMP_HW + RAMP_FL * (1 - k), CURB - cIn, CURB], [nt.t + RAMP_HW + RAMP_FL, CURB, CURB]);
    }
    bp.push([sg.L, CURB, CURB]);
    const hAt = (t) => { let i = 1; while (i < bp.length - 1 && bp[i][0] < t) i++; const [t0, o0, i0] = bp[i - 1], [t1, o1, i1] = bp[i], f = t1 - t0 > 1e-6 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0; return [o0 + (o1 - o0) * f, i0 + (i1 - i0) * f]; };
    // cuts along the segment: stone joints (each stone its own length) and the ramp break points
    const sl = kind > 0.5 ? 1.45 : 3.05, cuts = [];
    if (sg.arc) cuts.push([0, sg.arcFirst || (sg.arcLen > 3.6 && Math.abs(sg.arcT0 - sg.arcLen / 2) < sg.L * 0.5) ? 1 : 0]);       // a bend is one curved length (two when it is long)
    else for (let t = 0, j = 0; t < sg.L - 0.4; j++) { cuts.push([t, 1]); t += sl * (kind > 0.5 ? 0.62 + 0.76 * rnd(ring.bi, si, j) : 1); }
    for (const b of bp) if (b[0] > 0.05 && b[0] < sg.L - 0.05) cuts.push([b[0], 0]);
    if (sg.hero) for (let t = 0.45; t < sg.L - 0.2; t += 0.45) cuts.push([t, 0]);
    // stretches where the steel facing has gone (torn off by a plough, rusted through): the old concrete shows, set back by the plate's thickness, its arris broken
    const vnS = (x, q) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return rnd(ring.bi * 3.7 + si, i, q) * (1 - u) + rnd(ring.bi * 3.7 + si, i + 1, q) * u; };
    const bareAt = (t) => (sg.hero && kind < 0.5 && !sg.arc ? Math.max(0, Math.min(1, (vnS((sg.run + t) / 6.5, 61) - 0.76) / 0.045)) : 0);
    if (sg.hero && kind < 0.5) for (let t = 0.15; t < sg.L - 0.05; t += 0.15) if (bareAt(t) > 0 || bareAt(t + 0.15) > 0 || bareAt(t - 0.15) > 0) cuts.push([t, 0]);          // hand-dressed stone, worn concrete: no edge is a ruled line
    cuts.sort((p, q) => p[0] - q[0]); cuts.push([sg.L, sg.arc && !sg.arcLast ? 0 : 1]);
    const pt = (t, d) => { const wA = Math.max(0, 1 - t / 0.4), wB = Math.max(0, 1 - (sg.L - t) / 0.4), wN = Math.max(0, 1 - wA - wB), q = wA + wB + wN;      // square across the kerb; mitred only at the corner itself (blended all along, every stone joint lay askew and the stones read as overlapping)
      return [sg.a[0] + sg.dx * t + (mA[0] * wA + mB[0] * wB + sg.nx * wN) / q * d, sg.a[1] + sg.dy * t + (mA[1] * wA + mB[1] * wB + sg.ny * wN) / q * d]; };
    // the foot of the kerb on the road: its own cast shadow (when the sun stands behind it), the crease, the silt line
    const shPerH = Math.max(0, (sun[0] * sg.nx + sun[1] * sg.ny) / Math.max(0.2, sun[2]));        // metres of shadow per metre of kerb, across the kerb line
    for (let c = 1; c < cuts.length; c++) {
      const t0 = cuts[c - 1][0], t1 = cuts[c][0]; if (t1 - t0 < 1e-4) continue;
      const q = [[t0, 0], [t1, 0], [t1, 1], [t0, 1]];
      for (const idx of [0, 2, 1, 0, 3, 2]) { const [t, o] = q[idx], [x, y] = pt(t, o ? -0.55 : 0.0); gut.position.push(x, 0.0185, -y); gut.normal.push(0, 1, 0); gut.aG.push(o * 0.55, hAt(t)[0], shPerH, sg.run + t); }
    }
    if (sg.hero && kind < 0.5 && !sg.arc && !dbg.includes('s')) {                // what the gutter keeps: a fillet of silt and grit against the kerb foot, wide where water stands, gone where it runs
      const wS = (t) => { const i = Math.floor(t / 1.3), f = t / 1.3 - i, u = f * f * (3 - 2 * f), q = rnd(ring.bi * 5.1 + si, i, 71) * (1 - u) + rnd(ring.bi * 5.1 + si, i + 1, 71) * u; return 0.045 + 0.05 * q + Math.max(0, q - 0.30) * 0.55 + 0.03 * rnd(ring.bi + si, Math.round(t * 5), 72) * (q > 0.38 ? 1 : 0); };       // (r30) a thin line of dust everywhere, a wide fillet where water stands
      for (let c = 1; c < cuts.length; c++) {
        const t0 = cuts[c - 1][0], t1 = cuts[c][0]; if (t1 - t0 < 1e-4) continue;
        const w0 = wS(t0), w1 = wS(t1); if (w0 + w1 < 0.01) continue;
        const A0 = pt(t0, -w0), A1 = pt(t1, -w1), B0 = pt(t0, 0.002), B1 = pt(t1, 0.002), hb0 = 0.010 + 0.07 * w0, hb1 = 0.010 + 0.07 * w1;
        const q = [[A0, 0.021, t0, 0], [A1, 0.021, t1, 0], [B1, 0.021 + hb1, t1, 1], [B0, 0.021 + hb0, t0, 1]];
        for (const idx of [0, 2, 1, 0, 3, 2]) { const [p2, h2, t2, e2] = q[idx]; a.position.push(p2[0], h2, -p2[1]); a.normal.push(-sg.nx * 0.12, 0.99, sg.ny * 0.12); a.aK.push(sg.run + t2, e2, 2, sd); a.aK2.push(9, 9, 0, 0); }
      }
    }
    // (r38) a fallen leaf: one scanned leaf (leaves.webp, 16 cells) on a quad folded along its midrib, its edges curled up off the ground
    const leaf = (P3f, r, big) => {
      const lf = a.leaf; if (!lf) return false;
      const ci = big ? Math.floor(r(21) * 7.999) : 8 + Math.floor(r(21) * 7.999), hs = big ? 0.030 + 0.026 * r(22) : 0.020 + 0.022 * r(22), cu = hs * (0.10 + 0.45 * r(23)), up = r(24) < 0.7 ? 1 : -0.6;
      const cx = ci % 4, cy = Math.floor(ci / 4), tint = r(25), sh = r(26);
      const V = (lx, ly, lz) => ({ p: P3f(lx, ly, lz), u: (cx + lx / hs * 0.5 + 0.5) / 4, v: 1 - (cy + 0.5 - ly / hs * 0.5) / 4 });
      const e = Math.abs(cu * up), m0 = up > 0 ? 0.002 : e + 0.002, e0 = up > 0 ? e + 0.002 : 0.002;
      const M0 = V(0, -hs, m0), M1 = V(0, hs, m0 + cu * 0.5 * r(27)), L0 = V(-hs, -hs, e0 * (0.4 + 0.6 * r(28))), L1 = V(-hs, hs, e0), R0 = V(hs, -hs, e0), R1 = V(hs, hs, e0 * (0.4 + 0.6 * r(29)));
      for (const [A, B, C] of [[L0, M0, M1], [L0, M1, L1], [M0, R0, R1], [M0, R1, M1]]) {
        const ux = B.p[0] - A.p[0], uy = B.p[1] - A.p[1], uz = B.p[2] - A.p[2], vx = C.p[0] - A.p[0], vy = C.p[1] - A.p[1], vz = C.p[2] - A.p[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const T = ny < 0 ? [A, C, B] : [A, B, C]; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        for (const q of T) { lf.position.push(q.p[0], q.p[1], q.p[2]); lf.normal.push(nx, ny, nz); lf.aL.push(q.u, q.v, tint, sh); }
      }
      return true;
    };
    if (sg.hero && kind < 0.5 && !sg.arc && !dbg.includes('d')) {                // what lies in the gutter, as real pieces: stones off the road, dead leaves, butt ends (r23)
      const wS = (t) => { const i = Math.floor(t / 1.3), f = t / 1.3 - i, u = f * f * (3 - 2 * f), q = rnd(ring.bi * 5.1 + si, i, 71) * (1 - u) + rnd(ring.bi * 5.1 + si, i + 1, 71) * u; return Math.max(0, q - 0.30) * 0.55; };
      const tri = (A, B, C, col) => { pushTri(a, A, B, C); for (let q = 0; q < 3; q++) { a.aK.push(sg.run, 0.5, 3, sd); a.aK2.push(col[0], col[1], col[2], 0); } };
      const W3 = (t, d, h) => { const q = pt(t, d); return [q[0], h, -q[1]]; };
      for (let i = 0, n3 = Math.floor(sg.L * 6); i < n3; i++) {
        const r = (q) => rnd(ring.bi * 9.7 + si * 1.3, i, q), t = 0.3 + r(1) * (sg.L - 0.6); if (t < 0.3 || t > sg.L - 0.3) continue;
        const w = wS(t), inSilt = w > 0.03; if (!inSilt && r(2) > 0.22) continue;
        if (hAt(t)[0] < CURB - 0.01) continue;                                                   // not on a ramp
        const dOut = inSilt ? 0.012 + w * 1.15 * Math.pow(r(3), 1.4) : 0.015 + 0.42 * r(3) * r(3), base = 0.0225 + (inSilt ? Math.max(0, 0.010 + 0.07 * w) * Math.max(0, 1 - dOut / Math.max(w, 0.01)) : 0);
        const kindD = r(4), ang = r(5) * 6.2832, ca = Math.cos(ang), sa = Math.sin(ang), g = 0.75 + 0.5 * r(6);
        const L3 = (lx, ly, lz) => W3(t + (lx * ca - ly * sa), -dOut + (lx * sa + ly * ca), base + lz);
        if (kindD < 0.66) {                                                                     // a stone
          const rx = 0.005 + 0.013 * r(7) * r(7), ry = rx * (0.6 + 0.5 * r(8)), rz = rx * (0.45 + 0.4 * r(9)), c3 = [0.07 * g + 0.08 * r(10), 0.068 * g + 0.075 * r(10), 0.064 * g + 0.066 * r(10)];
          const E = [L3(rx, 0, rz * 0.4), L3(0, ry, rz * 0.5), L3(-rx, 0, rz * 0.35), L3(0, -ry, rz * 0.45)], T = L3(rx * 0.15, -ry * 0.1, rz), Bt = L3(0, 0, -0.002);
          for (let q = 0; q < 4; q++) tri(E[q], E[(q + 1) % 4], T, c3);       // (r31) no underside: nobody sees it
        } else if (kindD < 0.90 && leaf(L3, r, r(20) < 0.45)) {                                 // (r38) a dead leaf: a scanned one
        } else if (kindD < 0.90) {                                                              // a dead leaf, curled (kept for a build without the leaf mesh)
          const ll = 0.030 + 0.035 * r(7), lw = ll * (0.30 + 0.2 * r(8)), cu = 0.004 + 0.012 * r(9), c3 = r(10) < 0.5 ? [0.11 * g, 0.070 * g, 0.036 * g] : [0.16 * g, 0.12 * g, 0.055 * g];
          const A0 = L3(-ll, 0, cu * 0.7), A1 = L3(ll, 0, cu), M0 = L3(-ll * 0.2, 0, 0.002), Lf = L3(0, lw, cu * 0.8 + 0.002), Rt = L3(0.1 * ll, -lw, 0.003);
          tri(A0, M0, Lf, c3); tri(M0, A1, Lf, c3); tri(A0, Rt, M0, c3); tri(M0, Rt, A1, c3);
        } else {                                                                                // a butt end, a scrap of paper
          const isP = r(7) < 0.22, bl = isP ? 0.025 + 0.04 * r(8) : 0.013, bw = isP ? bl * (0.5 + 0.4 * r(9)) : 0.004, bh = isP ? 0.003 + 0.010 * r(11) : 0.0075, c3 = isP ? [0.30 * g, 0.29 * g, 0.265 * g] : (r(10) < 0.5 ? [0.30, 0.24, 0.15] : [0.40, 0.39, 0.36]);
          const jq = isP ? 0.45 * bl : 0, q0 = L3(-bl + jq * r(12), -bw, 0.001), q1 = L3(bl, -bw + jq * r(13), isP ? bh : 0.001), q2 = L3(bl - jq * r(14), bw, 0.001 + (isP ? bh * 0.3 : 0)), q3 = L3(-bl, bw - jq * r(15), isP ? bh * 0.6 : 0.001), u0 = L3(-bl, -bw, bh), u1 = L3(bl, -bw, bh), u2 = L3(bl, bw, bh), u3 = L3(-bl, bw, bh);
          if (isP) { tri(q0, q1, q2, c3); tri(q0, q2, q3, c3); }
          else { tri(u0, u1, u2, c3); tri(u0, u2, u3, c3); tri(q0, q1, u1, c3); tri(q0, u1, u0, c3); tri(q2, q3, u3, c3); tri(q2, u3, u2, c3); tri(q1, q2, u2, c3); tri(q1, u2, u1, c3); tri(q3, q0, u0, c3); tri(q3, u0, u3, c3); }
        }
      }
    }
    if (sg.hero && kind < 0.5 && !sg.arc && !dbg.includes('d') && sg.L > 6) {         // (r25) and what lies on the walk itself: butt ends, bits of leaf, scraps; thickest in the kerb zone
      const tri = (A, B, C, col) => { pushTri(a, A, B, C); for (let q = 0; q < 3; q++) { a.aK.push(sg.run, 0.5, 3, sd); a.aK2.push(col[0], col[1], col[2], 0); } };
      for (let i = 0, n3 = Math.floor(sg.L * 3.2); i < n3; i++) {       // (r32) more of it, most of it gathered against the kerb
        const r = (q) => rnd(ring.bi * 4.3 + si * 2.9, i, q + 40), t = 0.6 + r(1) * (sg.L - 1.2), dIn = KW + 0.03 + 3.0 * Math.pow(r(3), 3.2);
        if (hAt(t)[0] < CURB - 0.01 || (sg.wallD > 0 && dIn > sg.wallD - 0.3)) continue;
        let onRamp = false; for (const nt of sg.notches) if (Math.abs(t - nt.t) < RAMP_HW + RAMP_FL + 0.3 && dIn < RAMP_DEP + 0.3) onRamp = true; if (onRamp) continue;
        const kindD = r(4), ang = r(5) * 6.2832, ca = Math.cos(ang), sa = Math.sin(ang), g = 0.75 + 0.5 * r(6), base = CURB + 0.0025;
        const L3 = (lx, ly, lz) => { const q = pt(t + (lx * ca - ly * sa), dIn + (lx * sa + ly * ca)); return [q[0], base + lz, -q[1]]; };
        if (kindD < 0.50) {                                                                     // a butt end
          const bl = 0.012 + 0.004 * r(8), bw = 0.0038, bh = 0.0075, c3 = r(10) < 0.5 ? [0.30, 0.24, 0.15] : [0.40, 0.39, 0.36];
          const q0 = L3(-bl, -bw, 0), q1 = L3(bl, -bw, 0), q2 = L3(bl, bw, 0), q3 = L3(-bl, bw, 0), u0 = L3(-bl, -bw, bh), u1 = L3(bl, -bw, bh), u2 = L3(bl, bw, bh), u3 = L3(-bl, bw, bh);
          tri(u0, u1, u2, c3); tri(u0, u2, u3, c3); tri(q0, q1, u1, c3); tri(q0, u1, u0, c3); tri(q2, q3, u3, c3); tri(q2, u3, u2, c3); tri(q1, q2, u2, c3); tri(q1, u2, u1, c3); tri(q3, q0, u0, c3); tri(q3, u0, u3, c3);
        } else if (kindD < 0.64) { leaf(L3, r, r(20) < 0.4);                                    // (r38) leaves on the walk again, as scanned leaves this time
        } else if (kindD < 0.50) {                                                              // (r33: no leaf pieces on the walk: they read as orange diamonds)
          const ll = 0.014 + 0.032 * r(7), lw = ll * (0.30 + 0.25 * r(8)), cu = 0.003 + 0.010 * r(9), c3 = r(10) < 0.6 ? [0.085 * g, 0.060 * g, 0.036 * g] : [0.125 * g, 0.100 * g, 0.060 * g];
          const A0 = L3(-ll, 0, cu * 0.7), A1 = L3(ll, 0, cu), M0 = L3(-ll * 0.2, 0, 0.001), Lf = L3(0, lw, cu * 0.8 + 0.001), Rt = L3(0.1 * ll, -lw, 0.002);
          tri(A0, M0, Lf, c3); tri(M0, A1, Lf, c3); tri(A0, Rt, M0, c3); tri(M0, Rt, A1, c3);
        } else if (kindD > 0.74) {                                                              // a scrap of paper, a wrapper, trodden flat (r37: one in seven pieces, dirty grey, not white)
          const bl = 0.012 + 0.03 * r(8), bw = bl * (0.45 + 0.4 * r(9)), jq = 0.18 * bl, c3 = [0.25 * g, 0.245 * g, 0.225 * g];       // (r35) grey-white paper, near square: the tan skewed ones read as yellow diamonds
          const q0 = L3(-bl + jq * r(12), -bw, 0.0005), q1 = L3(bl, -bw + jq * r(13), 0.001 + 0.004 * r(11)), q2 = L3(bl - jq * r(14), bw, 0.0005), q3 = L3(-bl, bw - jq * r(15), 0.001);
          tri(q0, q1, q2, c3); tri(q0, q2, q3, c3);
        }
      }
    }
    if (sg.hero && kind < 0.5 && !sg.arc && !dbg.includes('d') && sg.L > 6) {         // (r38) grit: what a street sheds on its walk. Stones of 2 to 7 mm, thick by the kerb, thinning toward the wall
      const tri = (A, B, C, col) => { pushTri(a, A, B, C); for (let q = 0; q < 3; q++) { a.aK.push(sg.run, 0.5, 3, sd); a.aK2.push(col[0], col[1], col[2], 0); } };
      for (let i = 0, n4 = Math.floor(sg.L * 7); i < n4; i++) {
        const r = (q) => rnd(ring.bi * 6.1 + si * 3.7, i, q + 70), t = 0.5 + r(1) * (sg.L - 1.0), dIn = KW + 0.02 + 3.4 * Math.pow(r(3), 2.4);
        if (hAt(t)[0] < CURB - 0.01 || (sg.wallD > 0 && dIn > sg.wallD - 0.2)) continue;
        let onRamp = false; for (const nt of sg.notches) if (Math.abs(t - nt.t) < RAMP_HW + RAMP_FL + 0.3 && dIn < RAMP_DEP + 0.3) onRamp = true; if (onRamp) continue;
        const ang = r(5) * 6.2832, ca = Math.cos(ang), sa = Math.sin(ang), g = 0.6 + 0.8 * r(6), base = CURB + 0.0015;
        const L3 = (lx, ly, lz) => { const q = pt(t + (lx * ca - ly * sa), dIn + (lx * sa + ly * ca)); return [q[0], base + lz, -q[1]]; };
        const rx = 0.0013 + 0.0026 * r(7) * r(7), ry = rx * (0.6 + 0.5 * r(8)), rz = rx * (0.6 + 0.5 * r(9)), k = r(10);
        const c3 = k < 0.55 ? [0.050 * g, 0.048 * g, 0.045 * g] : (k < 0.85 ? [0.11 * g, 0.10 * g, 0.085 * g] : [0.07 * g, 0.045 * g, 0.03 * g]);
        const E = [L3(rx, 0, 0), L3(0, ry, 0), L3(-rx, 0, 0), L3(0, -ry, 0)], T = L3(rx * 0.15, -ry * 0.1, rz);
        for (let q = 0; q < 4; q++) tri(E[q], E[(q + 1) % 4], T, c3);
      }
    }
    let stone = 0, st0 = 0;
    for (let c = 1; c < cuts.length; c++) {
      const t0 = cuts[c - 1][0], t1 = cuts[c][0]; if (cuts[c - 1][1]) { stone++; st0 = t0; } if (t1 - t0 < 1e-4) continue;
      // each stone sits a few millimetres off its neighbours: out of line and out of level
      const j = (k) => (rnd(ring.bi * 7 + si, stone, k) - 0.5), moved = sg.hero && kind < 0.5 && !sg.arc && rnd(ring.bi * 7 + si, stone, 5) < 0.30 ? 1 : 0;       // a length reset after a dig, pushed by a truck, or sunk with its bed
      const off = 0.0024 * j(1) + moved * 0.026 * j(6), lift = 0.0012 * j(2) + moved * (0.004 - 0.020 * rnd(ring.bi * 7 + si, stone, 7)), skew = 0, tilt = moved * 0.022 * j(8);
      const patched = sg.hero && kind < 0.5 && !sg.arc && rnd(ring.bi * 7 + si, stone, 9) < 0.04 ? 1 : 0;       // a length re-poured in plain concrete after a utility cut: no steel, square, pale       // seen low along the kerb a 3 mm step reads as 2 cm: the line must run true
      let stEnd = sg.L; for (let e = c; e < cuts.length; e++) if (cuts[e][1]) { stEnd = cuts[e][0]; break; }
      const vnz = (x, q) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return rnd(ring.bi * 3.7 + si, i, q) * (1 - u) + rnd(ring.bi * 3.7 + si, i + 1, q) * u; };
      const row = (t, low = 0) => {
        // decades of tyres and ploughs: the steel nose is pushed in and out along its length, sags where the bed has gone, and is crushed in here and there
        const bendD = kind > 0.5 || sg.arc ? 0 : 0.075 * (vnz(t / 1.9, 51) - 0.5) + 0.030 * (vnz(t / 0.5, 52) - 0.5);
        const sagH = kind > 0.5 || sg.arc ? 0 : -0.045 * Math.max(0, vnz(t / 2.7, 53) - 0.55) / 0.45 - 0.035 * Math.max(0, vnz(t / 0.8, 54) - 0.80) / 0.2;
        const [ho, hi] = hAt(t), e = (t - st0) / Math.max(0.5, stEnd - st0) - 0.5, br = patched ? 0 : bareAt(t), bq = Math.round(t / 0.15);
        const R = PROFILE.map(([d, hf, mm, v], k) => {
          const wob = k < 5 ? 0.006 * (rnd(ring.bi * 13 + si, Math.round(t * 8), 3) - 0.5) * (kind > 0.5 ? 1 : 0.5) : 0.006 * (vnz((sg.run + t) / 0.9, 7) - 0.5) * (kind > 0.5 ? 1 : 0.6);       // (r32) the joint to the flags wanders slowly; a new offset every 12 cm read as stamped notches
          // the broken arris of the bare concrete: bites of one to three centimetres, each its own
          const bite = k >= 1 && k <= 4 ? br * rnd(ring.bi * 17 + si, bq, 31) * rnd(ring.bi * 17 + si, bq, 32) : 0;
          const [x, y] = pt(t, d + (k < 5 ? off + skew * e + low * 0.003 + bendD * (k === 0 ? 0.3 : 1) + 0.007 * br + bite * 0.030 * (k === 4 ? 0.4 : 1) - (patched && k >= 1 && k <= 3 ? [0, 0.004, 0.009, 0.014][k] * 0.8 : 0) : 0) + (k > 0 ? wob : 0));
          const h = hf ? (k === 5 ? hi : ho) + (patched && k >= 1 && k <= 4 ? mm * 0.25 : mm) + (lift + tilt * e) * (k === 5 ? 0.3 : 1) - low * (k === 5 ? 0.001 : 0.0025) + (k < 5 ? sagH * (1 - patched) : sagH * 0.25) - bite * 0.022 * (k === 4 ? 0.5 : 1) : mm;
          return [x, h + 0.003, -y, v];
        });
        R.bare = Math.max(br, patched); R.patch = patched; return R;
      };
      // the ends of a stone are broken back: a real gap between stones (granite: wide and ragged; steel-faced: a hairline)
      const gE = kind > 0.5 ? 0.005 + 0.007 * rnd(ring.bi * 3 + si, stone, 9) : 0.004, rows = [];
      const sF = cuts[c - 1][1] && t1 - t0 > 4 * gE, eF = cuts[c][1] && t1 - t0 > 4 * gE;
      if (sF) rows.push([t0, 1, -1], [t0 + gE, 0, -1]); else rows.push([t0, 0, 0]);
      if (eF) rows.push([t1 - gE, 0, 1], [t1, 1, 1]); else rows.push([t1, 0, 0]);
      const pn = [[1, 0.05], [0.97, 0.24], [0.75, 0.66], [0.4, 0.92], [0.12, 0.99], [0, 1]];       // [outward, upward] across the profile, smooth over the rounding
      for (let ri = 1; ri < rows.length; ri++) {
        const [ta, la, ea] = rows[ri - 1], [tb, lb, eb] = rows[ri], R0 = row(ta, la), R1 = row(tb, lb), s0 = sg.run + ta, s1 = sg.run + tb;
        for (let k = 0; k < 5; k++) {
          const q = [[R0[k], pn[k], s0, ta, la * ea, R0], [R1[k], pn[k], s1, tb, lb * eb, R1], [R1[k + 1], pn[k + 1], s1, tb, lb * eb, R1], [R0[k + 1], pn[k + 1], s0, ta, la * ea, R0]];
          for (const idx of [0, 1, 2, 0, 2, 3]) {
            const [p, nn, s, t, en, RR] = q[idx]; let onx = sg.nx, ony = sg.ny;
            if (sg.arc) { const f = t / sg.L; onx = sg.nA[0] * (1 - f) + sg.nB[0] * f; ony = sg.nA[1] * (1 - f) + sg.nB[1] * f; const ol = Math.hypot(onx, ony); onx /= ol; ony /= ol; }
            const ux = -onx * nn[0] + sg.dx * en * 0.9, uz = ony * nn[0] - sg.dy * en * 0.9, ul = Math.hypot(ux, nn[1], uz);
            a.position.push(p[0], p[1], p[2]); a.normal.push(ux / ul, nn[1] / ul, uz / ul);
            a.aK.push(s, p[3], kind, sd + (sg.arc ? sg.arc * 3.3 : stone) * 0.6180339);
            if (sg.arc) { const h2 = sg.arcLen > 3.6 ? sg.arcLen / 2 : sg.arcLen, ta2 = sg.arcT0 + t; a.aK2.push(ta2 % h2 + (ta2 >= 2 * h2 - 1e-4 ? h2 : 0), h2 - (ta2 % h2) + (ta2 >= 2 * h2 - 1e-4 ? -h2 : 0), 0, 0); }
            else a.aK2.push(t - st0, stEnd - t, RR.bare, RR.patch);
          }
        }
        // the end of a length that stands proud of its neighbour or has sunk: its end face shows
        if (moved || patched) for (const [RE, tE, dirE] of [[ri === 1 ? R0 : null, ta, -1], [ri === rows.length - 1 ? R1 : null, tb, 1]]) {
          if (!RE) continue; const c2 = pt(tE, 0.09), C = [c2[0], 0.02, -c2[1]];
          for (let k = 0; k < 5; k++) for (const [p, vv] of [[RE[k], RE[k][3]], [RE[k + 1], RE[k + 1][3]], [C, 0.5]]) {
            a.position.push(p[0], p[1], p[2]); a.normal.push(sg.dx * dirE, 0.0, -sg.dy * dirE);
            a.aK.push(sg.run + tE, vv, kind, sd + stone * 0.6180339); a.aK2.push(0, 0, 1, RE.patch);
          }
        }
      }
      // end caps are not needed: stones butt against each other
    }
  }
}

// ------------------------------------------------------------------ the flags as real slabs (hero blocks)
// Each flag of a kerb line's band (kerb to building line) is its own piece of mesh: a top a few millimetres out of level and out of
// square, a rounded shoulder, a tooled groove of its own width down to the joint line, a corner broken off here and there.
// Light, shading and anti-aliasing then make the joint; the flat walk (lowered 2 cm) stays underneath as the bed and shows where no whole flag fits.
function clipHP(poly, ax, ay, nx, ny, k) {       // keep the side where (p - a) . n >= k
  const out = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n], dp = (p[0] - ax) * nx + (p[1] - ay) * ny - k, dq = (q[0] - ax) * nx + (q[1] - ay) * ny - k;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const f = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
  }
  return out;
}
const polyArea = (p) => (p.length < 3 ? 0 : ringArea(p));
function insetPoly(poly, dist) {                 // convex, counter-clockwise
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e2x = c[0] - b[0], e2y = c[1] - b[1], l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    const n1x = -e1y / l1, n1y = e1x / l1, n2x = -e2y / l2, n2y = e2x / l2, k = Math.max(0.35, 1 + n1x * n2x + n1y * n2y);
    out.push([b[0] + (n1x + n2x) / k * dist, b[1] + (n1y + n2y) / k * dist]);
  }
  return out;
}
function insetPolyE(poly, ds) {             // convex, counter-clockwise; ds[i] = how far the edge from poly[i] to poly[i + 1] moves in
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e2x = c[0] - b[0], e2y = c[1] - b[1], l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    const n1x = -e1y / l1, n1y = e1x / l1, n2x = -e2y / l2, n2y = e2x / l2, d1 = ds[(i + n - 1) % n], d2 = ds[i], det = n1x * n2y - n1y * n2x;
    if (Math.abs(det) < 0.2) { const k = Math.max(0.35, 1 + n1x * n2x + n1y * n2y), d = (d1 + d2) / 2; out.push([b[0] + (n1x + n2x) / k * d, b[1] + (n1y + n2y) / k * d]); }
    else out.push([b[0] + (d1 * n2y - d2 * n1y) / det, b[1] + (n1x * d2 - n2x * d1) / det]);
  }
  return out;
}
function buildSlabs(rs, frames, plazaAt) {
  const P = [], N = [], A = [], B = [], C = [], D = [], I = []; let nv = 0, nSlab = 0;
  const edges = [], holes = rs.filter((r) => r.hole), ramps = [];
  for (const r of rs) for (const sg of r.segs) { if (!r.hole && sg.L > 0.02) edges.push(sg); for (const nt of sg.notches) ramps.push([sg, nt.t - RAMP_HW - RAMP_FL - 0.012, nt.t + RAMP_HW + RAMP_FL + 0.012]); }
  for (const F of frames) {
    if (!(F.wallD > 1.2)) continue;
    const X = (s, d) => [F.a[0] + F.dx * (s - F.run) + F.nx * d, F.a[1] + F.dy * (s - F.run) + F.ny * d];
    const fit = (poly) => {
      let cx = 0, cy = 0; for (const p of poly) { cx += p[0] / poly.length; cy += p[1] / poly.length; }
      poly = clipHP(poly, F.a[0], F.a[1], F.dx, F.dy, -0.5); poly = clipHP(poly, F.b[0], F.b[1], -F.dx, -F.dy, -0.5);
      for (const e of edges) {                    // the kerbs of this block (the corner chamfers, the crossing street)
        if (poly.length < 3) return null;
        const t = (cx - e.a[0]) * e.dx + (cy - e.a[1]) * e.dy, dn = (cx - e.a[0]) * e.nx + (cy - e.a[1]) * e.ny;
        if (t < -3 || t > e.L + 3 || Math.abs(dn) > 14) continue;
        poly = clipHP(poly, e.a[0], e.a[1], e.nx, e.ny, KW);
      }
      for (const H of frames) {                   // a more important street keeps its own band to the corner (as the bed's shader rules)
        if (H === F || H.pr <= F.pr) continue; if (poly.length < 3) return null;
        let any = false; for (const p of poly) { const a = (p[0] - H.a[0]) * H.dx + (p[1] - H.a[1]) * H.dy, b = (p[0] - H.a[0]) * H.nx + (p[1] - H.a[1]) * H.ny; if (a > -0.5 && a < H.L + 0.5 && b > -0.3 && b < H.band) { any = true; break; } }
        if (!any) continue;
        const tu = (cx - H.a[0]) * H.dx + (cy - H.a[1]) * H.dy, dn = (cx - H.a[0]) * H.nx + (cy - H.a[1]) * H.ny;
        if (dn >= H.band) poly = clipHP(poly, H.a[0], H.a[1], H.nx, H.ny, H.band);
        else if (tu <= -0.5) poly = clipHP(poly, H.a[0], H.a[1], -H.dx, -H.dy, 0.5);
        else if (tu >= H.L + 0.5) poly = clipHP(poly, H.b[0], H.b[1], H.dx, H.dy, 0.5);
        else return null;
      }
      for (const [e, t0, t1] of ramps) {          // a ramp: keep the larger part of the flag beside or behind it
        if (poly.length < 3) return null;
        const ax0 = e.a[0] + e.dx * t0, ay0 = e.a[1] + e.dy * t0, ax1 = e.a[0] + e.dx * t1, ay1 = e.a[1] + e.dy * t1;
        let q = clipHP(poly, ax0, ay0, e.dx, e.dy, 0); q = clipHP(q, ax1, ay1, -e.dx, -e.dy, 0); q = clipHP(q, e.a[0], e.a[1], -e.nx, -e.ny, -(RAMP_DEP + 0.012));
        if (polyArea(q) < 1e-4) continue;
        const cs = [clipHP(poly, ax0, ay0, -e.dx, -e.dy, 0), clipHP(poly, ax1, ay1, e.dx, e.dy, 0), clipHP(poly, e.a[0], e.a[1], e.nx, e.ny, RAMP_DEP + 0.012)];
        cs.sort((p, q2) => polyArea(q2) - polyArea(p)); poly = cs[0];
      }
      if (poly.length < 3) return null;
      let shared = false;
      for (const p of poly) { for (const hr of holes) if (pointInRing(hr.pts, p[0], p[1]) || ringDist(hr.pts, p[0], p[1]) < KW) return null; const z = plazaAt(p[0], p[1]); if (z === 1) return null; if (z === 2) shared = true; }
      if (shared) poly = clipHP(poly, F.a[0], F.a[1], F.nx, F.ny, F.wallD - 6.27);
      const out = []; for (const p of poly) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.03) out.push(p); }
      if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.03) out.pop();
      return out.length >= 3 && polyArea(out) > 0.05 ? out : null;
    };
    const emit = (poly, k, col, row, sc, dc, hw, hh, ck = null, piece = 0) => {        // ck: per edge, true where the edge is a crack through the flag (r31); piece: which part of a broken flag
      const hs = (q) => rnd(k * 7.3 + col * 1.37, row * 3.1 + F.seedF * 31, q), ageF = rnd(k, F.seedF * 17, 41);
      const gw = 0.0055 + 0.0065 * hs(1), rim0 = ck ? insetPolyE(poly, ck.map((c) => (c ? 0.0010 + 0.0016 * hs(90 + piece) : gw))) : insetPoly(poly, gw), n0 = poly.length, rim = [], out = [];
      for (let i = 0; i < n0; i++) {              // a corner broken off: the arris cut back, falling to the joint
        const p = rim0[i];
        if (!ck && hs(10 + i) < 0.05 + 0.10 * ageF) {
          const a = rim0[(i + n0 - 1) % n0], c = rim0[(i + 1) % n0], la = Math.hypot(a[0] - p[0], a[1] - p[1]), lc = Math.hypot(c[0] - p[0], c[1] - p[1]);
          const ca = Math.min(0.3 * la, 0.015 + 0.075 * hs(20 + i) * hs(20 + i)) / (la || 1), cc = Math.min(0.3 * lc, 0.015 + 0.075 * hs(30 + i) * hs(30 + i)) / (lc || 1);
          rim.push([p[0] + (a[0] - p[0]) * ca, p[1] + (a[1] - p[1]) * ca], [p[0] + (c[0] - p[0]) * cc, p[1] + (c[1] - p[1]) * cc]); out.push(poly[i], poly[i]);
        } else { rim.push(p); out.push(poly[i]); }
      }
      const m = rim.length, inner = ck ? insetPolyE(rim, ck.map((c) => (c ? 0.0035 : 0.014))) : insetPoly(rim, 0.014);
      const sunk = hs(5) < 0.07 + 0.10 * ageF, tk = sunk || ck ? 3.4 : 1, pq = 60 * piece;       // the parts of a broken flag no longer lie in one plane: each has its own level and fall
      const hc = CURB - 0.0045 + (hs(2 + pq) - 0.5) * 0.005 * (0.4 + ageF) - (sunk ? 0.003 : 0) - (ck ? 0.0015 + 0.0055 * hs(71 + pq) * (piece > 0 ? 1 : 0.3) : 0), ax = (hs(3 + pq) - 0.5) * 0.006 * tk / hw, ay = (hs(4 + pq) - 0.5) * 0.006 * tk / hh;
      const gx = ax * F.dx + ay * F.nx, gy = ax * F.dy + ay * F.ny, nl = Math.hypot(gx, 1, gy), np = [-gx / nl, 1 / nl, gy / nl];
      const pack = F.style * 10 + F.scz;
      const vert = (p, ring, o) => {
        const t = (p[0] - F.a[0]) * F.dx + (p[1] - F.a[1]) * F.dy, d = (p[0] - F.a[0]) * F.nx + (p[1] - F.a[1]) * F.ny, s = F.run + t, lx = s - sc, ly = d - dc;
        let h = Math.min(CURB + 0.004, Math.max(CURB - 0.019, hc + ax * lx + ay * ly)); if (ring === 1) h -= 0.0012; if (ring === 2) h = Math.min(h - 0.006, CURB - 0.0135);
        P.push(p[0], h, -p[1]);
        const kk = ring === 0 ? 0 : (ring === 1 ? 0.22 : 1.0), nx = np[0] + kk * o[0], ny = np[1], nz = np[2] - kk * o[1], l = Math.hypot(nx, ny, nz);
        N.push(nx / l, ny / l, nz / l); A.push(s, d, ring === 2 ? 1 : 0, F.wallD); B.push(col + (ck ? 0.25 : 0), row, k, F.seedF); C.push(lx, ly, hw, hh); D.push(F.dx, F.dy, F.stripW, pack);
      };
      const od = out.map((q, i) => { const x = q[0] - inner[i][0], y = q[1] - inner[i][1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; });
      for (let i = 0; i < m; i++) vert(inner[i], 0, od[i]); for (let i = 0; i < m; i++) vert(rim[i], 1, od[i]); for (let i = 0; i < m; i++) vert(out[i], 2, od[i]);
      for (let i = 1; i < m - 1; i++) I.push(nv, nv + i, nv + i + 1);
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; I.push(nv + i, nv + m + i, nv + m + j, nv + i, nv + m + j, nv + j, nv + m + i, nv + 2 * m + i, nv + 2 * m + j, nv + m + i, nv + 2 * m + j, nv + m + j); }
      nv += 3 * m; nSlab++;
    };
    const k0 = Math.floor((F.run - 1) / 22) - 1, k1 = Math.floor((F.run + F.L + 1) / 22) + 1, bnd = (k) => (k + 0.6 * rnd(k, F.seedF * 91, 3)) * 22;
    for (let k = k0; k <= k1; k++) {
      const b0 = bnd(k), b1 = bnd(k + 1); if (b1 < F.run - 0.5 || b0 > F.run + F.L + 0.5) continue;
      const r1 = rnd(k, F.seedF * 57, 11), r2 = rnd(k, F.seedF * 57, 12), r3 = rnd(k, F.seedF * 57, 13);
      let len = r1 < 0.90 ? 1.524 : 1.829, c0 = r2 < 0.80 ? 0 : 0.45 + 0.45 * r3;       // New York's 5 ft grid, joints running through; a kerb course only here and there
      if (F.style === 1) { len = 3.048; c0 = 0; }
      const strip = F.stripW > 0 ? F.wallD - F.stripW : 0, top = strip || F.wallD + 0.7;
      const grid = (step, Dl, rows, tag) => {
        const S = []; for (let s = b0; s < b1 - 0.35 * step; s += step) S.push(s); S.push(b1);
        const node = (i, j) => X(S[i] + (i > 0 && i < S.length - 1 ? 0.024 * (rnd(k * 13.1 + i, j + tag, 21 + F.seedF) - 0.5) : 0), Dl[j] + (tag === 0 && rows[j] > 0 && j < Dl.length - 1 ? 0.024 * (rnd(k * 13.1 + i, j + tag, 22 + F.seedF) - 0.5) : 0));
        for (let i = 0; i < S.length - 1; i++) {
          if (S[i + 1] < F.run - 0.5 || S[i] > F.run + F.L + 0.5) continue;
          for (let j = 0; j < Dl.length - 1; j++) {
            let poly = fit([node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)]); if (!poly) continue;
            if (polyArea(poly) < 0) poly.reverse();
            const eArgs = [k, i, rows[j], (S[i] + S[i + 1]) / 2, (Dl[j] + Dl[j + 1]) / 2, (S[i + 1] - S[i]) / 2, (Dl[j + 1] - Dl[j]) / 2];
            // (r31) a broken flag is broken: the crack is a real gap between two or three pieces of mesh, each settled its own way
            const rr = (q) => rnd(k * 3.7 + i * 1.9, rows[j] * 2.3 + F.seedF * 77, 61 + q);
            if (rows[j] >= 0 && rows[j] < 40 && polyArea(poly) > 1.3 && rr(0) < 0.0) {       // (r34) OFF: a straight chord with a square branch read as ruled pencil lines in the steep view; needs a wandering cut before it comes back
              let cx = 0, cy = 0; for (const p2 of poly) { cx += p2[0] / poly.length; cy += p2[1] / poly.length; }
              const L1 = [cx + (rr(1) - 0.5) * 0.7, cy + (rr(2) - 0.5) * 0.7, Math.cos(rr(3) * Math.PI), Math.sin(rr(3) * Math.PI)];
              const lines = [L1], onL = (p2, Ln) => Math.abs((p2[0] - Ln[0]) * Ln[2] + (p2[1] - Ln[1]) * Ln[3]) < 1e-6;
              const tidy = (q) => { const o = []; for (const p2 of q) { const l = o[o.length - 1]; if (!l || Math.hypot(p2[0] - l[0], p2[1] - l[1]) > 0.004) o.push(p2); } if (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) <= 0.004) o.pop(); return o; };
              let parts = [tidy(clipHP(poly, L1[0], L1[1], L1[2], L1[3], 0)), tidy(clipHP(poly, L1[0], L1[1], -L1[2], -L1[3], 0))];
              if (parts.every((q) => q.length >= 3 && polyArea(q) > 0.12)) {
                if (rr(5) < 0.40) {               // a second crack running off the first
                  parts.sort((p2, q2) => polyArea(q2) - polyArea(p2));
                  const tq = (rr(6) - 0.5) * 0.5, a2 = rr(3) * Math.PI + Math.PI / 2 + (rr(7) - 0.5) * 0.9, L2 = [L1[0] - L1[3] * tq, L1[1] + L1[2] * tq, Math.cos(a2), Math.sin(a2)];
                  const sp = [tidy(clipHP(parts[0], L2[0], L2[1], L2[2], L2[3], 0)), tidy(clipHP(parts[0], L2[0], L2[1], -L2[2], -L2[3], 0))];
                  if (sp.every((q) => q.length >= 3 && polyArea(q) > 0.10)) { parts = [sp[0], sp[1], parts[1]]; lines.push(L2); }
                }
                parts.forEach((q, pi) => emit(q, ...eArgs, q.map((p2, ii) => lines.some((Ln) => onL(p2, Ln) && onL(q[(ii + 1) % q.length], Ln))), pi));
                continue;
              }
            }
            emit(poly, ...eArgs);
          }
        }
      };
      const Dl = [KW], rows = []; if (c0) { Dl.push(KW + c0); rows.push(-1); }
      for (let d = KW + c0 + len, r = 0; ; d += len, r++) { if (d < top - 0.35 * len) { Dl.push(d); rows.push(r); } else { Dl.push(top); rows.push(r); break; } }
      grid(len, Dl, rows, 0);
      if (strip) grid(1.524, [strip, F.wallD + 0.7], [40], 50);
    }
  }
  if (!nSlab) return null;
  const g = new THREE.BufferGeometry(), set = (name, arr, sz) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(arr), sz));
  set('position', P, 3); set('normal', N, 3); set('aA', A, 4); set('aB', B, 4); set('aC', C, 4); set('aD', D, 4); g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
  g.computeBoundingSphere(); g.computeBoundingBox(); g.userData.slabs = nSlab; return g;
}

// ------------------------------------------------------------------ shaders
const GLSL_LIB = /* glsl */`
float gh21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 gh32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float gvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(gh21(i), gh21(i+vec2(1,0)), f.x), mix(gh21(i+vec2(0,1)), gh21(i+vec2(1,1)), f.x), f.y); }
float gfbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*gvn(p); p = p*2.03+17.1; a *= .5; } return s; }
vec2 grot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x + s * p.y, -s * p.x + c * p.y); }
float gline(float d, float hw, float fw){ fw = max(fw, 1e-5); return clamp((d + hw) / fw, -0.5, 0.5) - clamp((d - hw) / fw, -0.5, 0.5); }
`;

let SWK = 1, SWC = 1;       // (Nov 11) tone of the hero flags and of the city-wide sidewalk, set in add(); ?swk= and ?swc= try other values
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
        uniform sampler2D tConcD; uniform sampler2D tConc2a; uniform sampler2D tConc2b; uniform sampler2D tConcN1; uniform sampler2D tConcN2; uniform sampler2D tMasks; uniform sampler2D tGum; uniform sampler2D tMetalD; uniform sampler2D tNoise; uniform sampler2D tTacC; uniform sampler2D tTacN; uniform sampler2D tField; uniform vec4 uField; uniform sampler2D tPit; uniform vec4 uPit;
        vec3 bakeV; vec3 bakeN; float gRough; float gMetal; float gSpec; vec3 gNrm;
        ${GLSL_LIB}
        ${o.fsDecl || ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 m = vec2(vWPos.x, -vWPos.z);
          bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);
          gRough = 0.9; gMetal = 0.0; gSpec = 1.0; gNrm = vec3(0.0);
          vec2 mdx = dFdx(m), mdy = dFdy(m); float px = max(length(mdx), length(mdy)) + 1e-5;
          float pxs = min(length(mdx), length(mdy)) + 1e-5, pxg = sqrt(px * pxs);       // (r38) a pixel's footprint on the ground: long side, short side, their mean. Looking along the walk the long side is 3-4 times the short one; what the anisotropic filter can still show is nearer the mean
          ${o.fsMain}
          ${/^(walk|slab)/.test(o.name) ? 'diffuseColor.rgb *= ' + SWK.toFixed(3) + ';' : ''}
          diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.003));        // an albedo of exactly zero comes out of the lighting as NaN (a black block after bloom)
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gNrm.y > 0.0) normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(gRough, 0.08, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = clamp(gMetal, 0.0, 1.0);')
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + '\n reflectedLight.directSpecular *= gSpec; reflectedLight.indirectSpecular *= gSpec;');
  };
  m.customProgramCacheKey = () => 'stwalkD40-' + SWK + o.name;
  return m;
}

const FS_WALK = /* glsl */`
  // ---- the frame: nearest kerb line of this block -> s metres along it, d metres in from it
  #ifdef SLAB
  // a real slab (buildSlabs): its place in the frame, its own numbers and the distance to its edges come from the mesh
  vec2 dir = vD.xy, nrm = vec2(-dir.y, dir.x);
  float s = vA.x, d = vA.y, seed = vB.w, fi = vB.z;
  vec2 sdx = vec2(dot(mdx, dir), dot(mdx, nrm)), sdy = vec2(dot(mdy, dir), dot(mdy, nrm));
  float fws = length(vec2(sdx.x, sdy.x)) + 1e-5, fwd = length(vec2(sdx.y, sdy.y)) + 1e-5;
  float nearK = 1.0 - smoothstep(0.004, 0.016, pxg);
  float nearF = 1.0 - smoothstep(0.022, 0.032, px); bool isNear = px < 0.032;
  vec3 fh = gh32(vec2(fi, seed * 31.0 + 7.0)), fh2 = gh32(vec2(fi + 91.0, seed * 17.0 + 3.0));
  float style = floor(vD.w / 10.0 + 0.01), tinted = step(fh.x, vD.w - style * 10.0), age = fh2.z;
  if (style > 0.5 && style < 1.5) { tinted = 1.0; age = 0.35 + 0.3 * fh2.z; }
  float wallD = vA.w, stripW = vD.z, dB = wallD > 0.0 ? wallD - d : 9.0, row = vB.y;
  float inStrip = step(39.5, row), inCourse = step(row, -0.5), len = 2.0 * min(vC.z, vC.w);
  float u = vB.x + 0.5, v = row + 0.5, b0 = 1e6, b1 = -1e6, seam = 9.0, isExp = 0.0;
  float xs = vC.z - abs(vC.x), xd = vC.w - abs(vC.y);
  vec3 h = gh32(vec2(vB.x, row) + fi * 13.7 + seed * 57.0);
  vec2 cpv = vC.xy;
  #else
  float bd = 1e9, bd2 = 1e9; vec4 sg = uSeg[0], sb = uSegB[0], sc = uSegC[0];
  for (int i = 0; i < ${NS}; i++) {
    if (i >= uNSeg) break;
    vec4 a = uSeg[i], c = uSegC[i]; vec2 r = m - a.xy; float tu = dot(r, a.zw), t = clamp(tu, 0.0, uSegB[i].x); float dd = distance(r, a.zw * t);
    // a sidewalk runs on to the corner in its own frame: inside a kerb line's own band (kerb to building line) the more important street wins
    float dn = dot(r, vec2(-a.w, a.z)), band = c.x > 0.0 ? c.x + 0.05 : 4.5;
    if (tu > -0.5 && tu < uSegB[i].x + 0.5 && dn > -0.3 && dn < band) dd -= 100.0 * c.w;
    if (dd < bd) { bd2 = bd; bd = dd; sg = a; sb = uSegB[i]; sc = c; } else if (dd < bd2) bd2 = dd;
  }
  vec2 dir = sg.zw, nrm = vec2(-dir.y, dir.x), rr = m - sg.xy;
  float s = sb.y + dot(rr, dir), d = dot(rr, nrm), seed = sb.z;
  vec2 sdx = vec2(dot(mdx, dir), dot(mdx, nrm)), sdy = vec2(dot(mdy, dir), dot(mdy, nrm));
  float fws = length(vec2(sdx.x, sdy.x)) + 1e-5, fwd = length(vec2(sdx.y, sdy.y)) + 1e-5;
  float nearK = 1.0 - smoothstep(0.004, 0.016, pxg);                 // close enough to see relief
  float nearF = 1.0 - smoothstep(0.022, 0.032, px); bool isNear = px < 0.032;       // beyond about 20 m the fine work is skipped: it is below a pixel there
  // ---- frontages: every owner pours his own sidewalk
  float L0 = 22.0, fi = floor(s / L0), b0 = (fi + 0.6 * gh21(vec2(fi, seed))) * L0, b1;
  if (s < b0) { b1 = b0; fi -= 1.0; b0 = (fi + 0.6 * gh21(vec2(fi, seed))) * L0; } else b1 = (fi + 1.0 + 0.6 * gh21(vec2(fi + 1.0, seed))) * L0;
  vec3 fh = gh32(vec2(fi, seed * 31.0 + 7.0)), fh2 = gh32(vec2(fi + 91.0, seed * 17.0 + 3.0));
  float style = sb.w;
  float tinted = step(fh.x, sc.z);
  float len = fh.y < 0.70 ? 1.524 : (fh.y < 0.90 ? 1.219 : 1.829);
  float c0 = fh2.x < 0.45 ? 0.0 : 0.45 + 0.45 * fh2.y;
  float age = fh2.z;
  if (style > 0.5 && style < 1.5) { tinted = 1.0; len = 3.048; c0 = 0.0; age = 0.35 + 0.3 * fh2.z; }       // Broadway by the Flatiron: tinted, in large panels
  float wallD = sc.x, stripW = sc.y, dB = wallD > 0.0 ? wallD - d : 9.0;
  float inStrip = (wallD > 0.0 && stripW > 0.0) ? step(wallD - stripW, d) : 0.0;
  float inCourse = step(d, ${KW} + c0) * step(0.001, c0) * (1.0 - inStrip);
  float u = (s - b0) / len, v = (d - ${KW} - c0) / len;
  float row = inStrip > 0.5 ? 40.0 : (inCourse > 0.5 ? -1.0 : floor(v));
  if (inStrip > 0.5) { len = 1.524; u = (s - b0) / len; }
  float fu = fract(u), xs = (fu < 0.5 ? fu : fu - 1.0) * len;               // signed metres from the nearest cross joint
  if (b1 - s < abs(xs)) xs = s - b1;
  float isExp = (abs(s - b1) < len * 0.5 || mod(floor(u + 0.5), 4.0) < 0.5) ? 1.0 : 0.0;       // expansion joint: every fourth, and where two owners meet
  float fv = fract(v), xd = (fv < 0.5 ? fv : fv - 1.0) * len;                // signed metres from the nearest joint along the kerb
  if (inStrip > 0.5 || inCourse > 0.5) xd = 9.0;
  float t1 = d - ${KW}; if (abs(t1) < abs(xd)) xd = t1;
  if (c0 > 0.0) { t1 = d - ${KW} - c0; if (abs(t1) < abs(xd)) xd = t1; }
  if (wallD > 0.0 && stripW > 0.0) { t1 = d - (wallD - stripW); if (abs(t1) < abs(xd)) xd = t1; }
  { vec4 nw = texture2D(tNoise, vec2(s, d) / 1.7 + fh.xy); xs += 0.006 * (nw.g - 0.5) * step(abs(xs), 1.0); xd += 0.006 * (nw.r - 0.5) * step(abs(xd), 1.0); }      // tooled by hand along a board: never dead straight
  float seam = (bd2 - bd) * 0.5;                                              // where two kerb frames meet
  if (bd < -50.0) seam = min(wallD > 0.0 ? wallD + 0.05 - d : 4.5 - d, min(s - sb.y + 0.5, sb.y + sb.x + 0.5 - s));
  vec3 h = gh32(vec2(floor(u), row) + fi * 13.7 + seed * 57.0);
  vec2 cpv = vec2(fu - 0.5, fract(v) - 0.5) * len;
  #endif
  #ifdef SLAB
  float geoCk = step(0.1, fract(vB.x));        // this flag is broken in the mesh (buildSlabs)
  #else
  float geoCk = 0.0;
  #endif
  // ---- the concrete: a window of the photographed slabs per flag
  vec2 sd = vec2(s, d), uvA = sd / 2.3 + h.xy * 7.0 + fh.xy * 3.0;
  vec3 cd = textureGrad(tConcD, uvA, sdx / 2.3, sdy / 2.3).rgb;
  vec3 cf = vec3(0.5); if (isNear) cf = mix(cf, textureGrad(tConcD, uvA * 4.3 + 0.37, sdx * 1.87, sdy * 1.87).rgb, nearF);
  float det = 2.0 * mix(cd.r, cd.g, fh2.y * 0.10), fine = 2.0 * mix(cf.b, cf.r, 0.15);       // (r38) less of the brushed scan: with the grain carried further out its brush lines drew stripes across whole flags
  float tone = tinted > 0.5 ? mix(0.180, 0.200, fh.z) : mix(0.205, 0.255, fh.z);       // (r27; r30: a fifth darker, so that a trowelled band and a lit lip can be paler than the flag) the tinted frontages are a shade darker, not a different material
  if (inStrip > 0.5) tone = mix(0.21, 0.27, fh.z);
  // (r23) one whole photographed concrete per POUR: an owner relays his walk a few flags at a time, and each pour is its own mix, finish and age.
  // Six scans (Poly Haven); every flag takes its own window of its pour's scan, turned by quarter turns
  vec3 pH = gh32(vec2(floor((floor(u) + 9.0 * fh.x) / (2.0 + floor(3.0 * fh2.x))), floor((row + 5.0 * fh.y) / (1.0 + floor(2.99 * fh2.y)))) * 1.31 + fi * 3.1 + seed * 41.0);
  float scan = pH.x < 0.28 ? 0.0 : (pH.x < 0.45 ? 1.0 : (pH.x < 0.65 ? 2.0 : (pH.x < 0.75 ? 3.0 : (pH.x < 0.90 ? 4.0 : 1.0))))       /* (r24) the sixth scan (dirty_concrete) is out: its brush lines beat into a weave at a distance */;
  if (inStrip > 0.5) scan = 3.0;
  float qt = floor(h.z * 3.999), tS = scan < 0.5 ? 1.62 : (scan < 1.5 ? 1.89 : (scan < 2.5 ? 3.0 : (scan < 3.5 ? 2.0 : (scan < 4.5 ? 2.0 : 3.0))));
  vec2 rA = qt < 0.5 ? vec2(1.0, 0.0) : (qt < 1.5 ? vec2(0.0, 1.0) : (qt < 2.5 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0)));
  vec2 uvP = vec2(rA.x * sd.x - rA.y * sd.y, rA.y * sd.x + rA.x * sd.y) / tS + h.xy * 5.0 + pH.yz * 3.0;
  vec2 gPx = vec2(rA.x * sdx.x - rA.y * sdx.y, rA.y * sdx.x + rA.x * sdx.y) / tS, gPy = vec2(rA.x * sdy.x - rA.y * sdy.y, rA.y * sdy.x + rA.x * sdy.y) / tS;
  vec3 p3 = scan < 2.5 ? textureGrad(tConc2a, uvP, gPx, gPy).rgb : textureGrad(tConc2b, uvP, gPx, gPy).rgb;
  float sc3 = mod(scan, 3.0), pRat = 2.0 * (sc3 < 0.5 ? p3.r : (sc3 < 1.5 ? p3.g : p3.b));
  if (scan > 2.5 && scan < 3.5) pRat = 1.0 + (pRat - 1.0) * 0.45;       // (r24) the stone-showing scan at full strength read as a sandy tiled texture and hid the joints
  vec3 p3L = scan < 2.5 ? textureLod(tConc2a, uvP, 5.0).rgb : textureLod(tConc2b, uvP, 5.0).rgb;        // the same scan with its grain blurred away: its blotches, stains and bleached patches alone
  float pBig = 2.0 * (sc3 < 0.5 ? p3L.r : (sc3 < 1.5 ? p3L.g : p3L.b));
  float pTone = scan < 0.5 ? 1.10 : (scan < 1.5 ? 1.0 : (scan < 2.5 ? 0.93 : (scan < 3.5 ? 0.80 : (scan < 4.5 ? 0.90 : 1.02))));
  vec3 pTint = scan > 2.5 && scan < 4.5 ? vec3(1.02, 1.0, 0.955) : (scan < 0.5 ? vec3(1.0, 0.995, 0.98) : vec3(1.0));
  tone *= 0.925 + 0.15 * h.x;                                                  // flag to flag (r37: wider; the difference is tone and finish now, not scan marbling)
  tone *= mix(1.0, pTone, 0.6) * (0.94 + 0.12 * pH.y);       // (r39) pours nearer each other: a hard tonal step on a straight joint read as tinted tiles                                        // pour to pour
  float isNew = step(0.95, h.z) * (1.0 - inCourse), isPatch = step(h.z, 0.06);  // relaid flags: a newer pale one, an older dark repair
  tone *= 1.0 + 0.20 * isNew - 0.13 * isPatch;
  vec3 col = tone * pTint * mix(vec3(1.0, 0.975, 0.925), vec3(1.0, 0.99, 0.965), tinted * 0.8 + 0.2 * fh2.x) * mix(1.0, det, (0.08 + 0.08 * age) * (0.5 + 0.6 * h.y)) * mix(1.0, fine, (0.22 + 0.12 * age) * (0.45 + 1.1 * fract(h.z * 7.7)));       // (r37) finish differs flag by flag: one floated nearly smooth, the next sandy
  col *= mix(1.0, pRat, 0.42 * (1.0 - smoothstep(0.02, 0.09, px)));       // (r36) at 0.92 the scans read sharp as marble; under half, a pour still differs from its neighbour           // the scan itself, to where a flag is a few pixels
  col *= clamp(1.0 + 0.15 * (pBig - 1.0), 0.9, 1.1);          // (r25) a little only: at 1.1 it read as a procedural cloud layer     // (r24) and its large marks once more: real flags differ at the scale of a hand, a foot, a metre
  col *= 1.0 + isPatch * 0.35 * (cf.b - 0.5) - isNew * 0.3 * (det - 1.0);       // (r27) without the float-finished scan: its trowel arcs read as a tread stamp from afar
  if (inStrip > 0.5) col *= 1.0 + 1.1 * (cf.b - 0.5) + 0.6 * (cd.b - 0.5);       // the old strip at the building line: pitted, its stone showing
  // ---- noise (a texture, not maths)
  vec4 nzA = texture2D(tNoise, m / 37.0), nzB = texture2D(tNoise, m / 6.1 + 0.31), nzC = textureGrad(tNoise, m / 1.9 + 0.7, mdx / 1.9, mdy / 1.9);
  float big = nzA.r, mid = nzB.g;
  // ---- dirt by place: the kerb zone, the foot of the wall, the lane people walk
  float kerbZ = 1.0 - smoothstep(0.1, 0.9 + 0.8 * nzB.r, d), wallZ = 1.0 - smoothstep(0.0, 0.35 + 0.6 * nzB.r, dB);
  float lane = smoothstep(0.8, 1.9, d) * smoothstep(0.5, 1.5, dB);
  col *= 1.0 - 0.22 * kerbZ * (0.35 + 1.3 * mid) - 0.26 * wallZ * (0.35 + 1.3 * mid);
  col *= 1.0 - 0.45 * exp(-max(dB, 0.0) / 0.10);                              // where slab meets wall
  col *= 0.92 + 0.16 * big;
  col *= mix(vec3(1.012, 1.0, 0.985), vec3(0.99, 1.0, 1.012), nzA.b);          // warm and cool drift between clean and dirty stretches
  { vec4 wz = texture2D(tNoise, vec2(s / 7.0, d / 1.1) + 0.37), wy = texture2D(tNoise, vec2(s / 23.0, d / 6.0) + 0.11);
    col *= 0.93 + 0.14 * wz.g;    // feet wear it in streaks along the walk
    col *= 1.0 - 0.13 * lane * smoothstep(0.38, 0.70, wy.r * 0.7 + wz.r * 0.3) * (1.0 - isNew); }       // (r37) broad foot-traffic grime: a darker band where most people walk, coming and going over several flags
  if (isNear) { vec4 gz = textureGrad(tNoise, sd / 0.8 + h.xy, sdx / 0.8, sdy / 0.8); col *= 1.0 + nearK * (0.32 * (gz.a - 0.5) - 0.20 * smoothstep(0.80, 0.92, gz.a) * step(0.5, gz.b)); }      // sand and stone of the mix: crisp at arm's length
  col *= 1.0 - 0.10 * smoothstep(0.45, 0.75, nzA.g) * (1.0 - 0.6 * lane);     // where water stands and dries
  { // a utility trench relaid along the walk: a band of other concrete with its own edges
    float tOn = step(0.55, fh2.y) * (1.0 - inStrip), d0 = ${KW} + 0.75 + 1.6 * fh.z, tw = 0.65 + 0.5 * fh2.x;
    float inT = tOn * step(d0, d) * step(d, d0 + tw) * step(b0 + 1.3, s) * step(s, b1 - 2.1);
    col *= mix(1.0, fh.x > 0.5 ? 1.20 : 0.80, inT);
    float eT = min(abs(d - d0), abs(d - d0 - tw)) + 0.012 * (nzB.g - 0.5); if (tOn > 0.5 && s > b0 + 1.3 && s < b1 - 2.1 && eT < abs(xd)) xd = (d - d0 - 0.5 * tw) > 0.0 ? d - d0 - tw : d - d0;
  }
  col *= 1.0 + 0.03 * lane * (1.0 - isNew);
  // ---- stains: blotches, runs down the fall of the slab to the kerb, drips
  float blot = smoothstep(0.62, 0.74, nzB.g) * smoothstep(0.35, 0.6, nzA.g);
  float runs = smoothstep(0.55, 0.78, texture2D(tNoise, vec2(s / 1.3, d / 11.0) + seed).g) * (0.4 + 0.6 * age);
  float drip = smoothstep(0.70, 0.78, nzC.b) * smoothstep(0.45, 0.6, nzB.r) * nearK;
  float stain = clamp(max(blot * 0.75, runs * 0.45) * (1.0 - 0.7 * isNew) + drip * 0.8, 0.0, 1.0);
  float kerbStain = smoothstep(0.52, 0.66, nzB.b * 0.6 + nzA.g * 0.4) * (1.0 - smoothstep(0.3, 1.6, d));       // where the bags are put out: a dark greasy patch against the kerb
  stain = clamp(stain + 0.5 * kerbStain * (0.5 + 0.5 * nzC.g), 0.0, 1.0);
  col *= 1.0 - 0.11 * stain;
  if (isNear) { float spk = 2.0 * textureGrad(tMasks, sd / 0.83 + h.xy * 5.0, sdx / 0.83, sdy / 0.83).b; col *= mix(1.0, clamp(spk, 0.55, 1.6), 0.17 * nearF); }      // the stone of the mix: pale chips and dark pocks (a granite scan's speckle), not a cloud
  { // (r29) marks with a cause
    // a trail of drips where a leaking bag was carried along the walk
    float tk = floor(s / 7.0), th = gh21(vec2(tk, seed * 13.0 + 5.0));
    if (th < 0.38 && isNear) {
      float dl = 0.9 + 2.2 * gh21(vec2(tk, seed * 7.0 + 1.0)) + 0.35 * sin(s * 0.9 + th * 40.0);
      float ci = floor(s / 0.19); vec3 ch = gh32(vec2(ci, tk + seed * 3.0));
      vec2 q = vec2(s - (ci + 0.2 + 0.6 * ch.x) * 0.19, d - dl - 0.05 * (ch.y - 0.5));
      float rr = 0.005 + 0.012 * ch.z * ch.z;
      float drop = step(ch.y, 0.7) * (1.0 - smoothstep(rr * 0.7, rr, length(q * vec2(1.0, 1.0 + ch.x))));
      col *= 1.0 - 0.42 * drop * nearF;
    }
    // the tracks of a hand truck from the kerb to a door: two thin grey lines across the walk
    float hk = floor(s / 11.0), hh = gh21(vec2(hk, seed * 23.0 + 9.0));
    if (hh < -1.0) {       // (r37) off: three critics read the two thin lines as ghost overlays
      float s0 = (hk + 0.2 + 0.6 * gh21(vec2(hk, seed * 3.1))) * 11.0, bend = 0.5 * (gh21(vec2(hk, 4.0 + seed)) - 0.5);
      float xh = s - s0 - bend * d * (0.4 + 0.1 * d);
      float tr = max(gline(xh - 0.21, 0.012, fws), gline(xh + 0.21, 0.012, fws)) * smoothstep(0.15, 0.6, d);
      col *= 1.0 - 0.13 * tr * (0.5 + 0.8 * nzB.g) * (1.0 - 0.6 * isNew);
    }
  }
  // ---- cracks: a line across a flag that wanders and opens and closes; a few flags are shattered (scan). Old chewing gum (scan)
  float crack = 0.0, gum = 0.0, gumAge = 0.0, spall = 0.0; vec4 nzS = vec4(0.5);
  float clus = smoothstep(0.50, 0.72, nzB.r) * smoothstep(0.35, 0.6, nzA.b + 0.2 * lane);      // gum comes in patches: by a doorway, a bus stop, a bin; whole flags have none
  float dens = clamp(0.10 + 0.80 * clus + 0.30 * kerbZ * smoothstep(0.4, 0.7, nzB.b), 0.0, 1.0) * (1.0 - isNew);       // (r37) thick where people stand (by the kerb, in patches), none on a fresh pour
  if (isNear) {
    float hasCk = step(h.y, 0.07 + 0.13 * age) * step(fract(h.z * 11.3 + h.x * 3.1), 0.45)       /* (r39) a third as many: a crack on every second flag, each much like the last, read as one decal repeated */ * (1.0 - isNew) * (1.0 - geoCk), shat = step(h.y, 0.012 * (0.3 + age)) * (1.0 - isNew);
    float ca = h.x * 6.2832; vec2 cn = vec2(cos(ca), sin(ca)), cp = cpv;
    vec4 nzK = texture2D(tNoise, sd / 2.9 + h.xy), nzK2 = textureGrad(tNoise, sd / 0.43 + h.yx, sdx / 0.43, sdy / 0.43);
    nzS = textureGrad(tNoise, sd / 0.61 + h.xy, sdx / 0.61, sdy / 0.61);
    float cal = dot(cp, vec2(-cn.y, cn.x)); vec4 nzL1 = texture2D(tNoise, vec2(cal / mix(1.7, 4.6, fract(h.z * 3.7)), h.x * 7.0 + 0.5)), nzL2 = texture2D(tNoise, vec2(cal / 0.37, h.y * 5.0 + 0.5));
    float cfl = dot(cp, cn) - (h.z - 0.5) * 0.5 + mix(0.08, 0.26, fract(h.y * 9.1)) * (nzL1.g - 0.5) +       /* (r40) each crack its own reach and scale: two alike on neighbouring flags read as one decal */ (0.004 + 0.012 * fract(h.x * 5.7)) * (nzL2.g - 0.5) + 0.004 * (nzL2.b - 0.5);       // (r40b) the 4 cm wander at the old strength drew regular saw teeth at a grazing view       // (r39) the fine wander differs crack by crack: at one strength it was a regular sawtooth       // (r36) the line is a graph over the distance along it: as the zero of a 2D noise it closed into rings       // (r28) the fine wander fades with distance: sampled coarsely it broke the line into dots
    float cgr = length(vec2(dFdx(cfl), dFdy(cfl))) + 1e-6, cwid = (0.0008 + 0.0048 * nzL1.r * nzL1.r) * smoothstep(0.20, 0.45, nzL1.b + 0.25);       // hairline to 5 mm, and dying out along its length
    float ckLine = clamp(cwid / cgr + 0.5 - abs(cfl) / cgr, 0.0, min(1.0, 2.0 * cwid / cgr)) * hasCk * (1.0 - inCourse) * (1.0 - inStrip);
    crack = ckLine * 0.9;
    if (shat > 0.5) crack = max(crack, smoothstep(0.45, 0.8, textureGrad(tMasks, sd / 2.6 + h.yx * 3.0, sdx / 2.6, sdy / 2.6).g) * smoothstep(0.40, 0.55, nzK.r));
    crack *= nearF;
    float ckDirt = (1.0 - smoothstep(0.0, 0.035, abs(cfl))) * hasCk;
    col *= 1.0 - 0.16 * ckDirt * (0.4 + 1.2 * mid) * nearF;
    col *= 1.0 - 0.80 * crack;
    { // (r30) the two sides of a crack no longer sit level: the lip toward the sun is lit, the other falls into shade; bits have come out along it
      vec2 sunFr = vec2(dot(vec2(uSunDir.x, -uSunDir.z), dir), dot(vec2(uSunDir.x, -uSunDir.z), nrm));
      float lipC = (1.0 - smoothstep(0.003, 0.018, abs(cfl))) * hasCk * nearF * (1.0 - inCourse) * (1.0 - inStrip) * (1.0 - crack);
      col *= 1.0 + 0.11 * lipC * sign(cfl) * sign(dot(sunFr, cn)) * bakeV.g;
      float chipC = smoothstep(0.60, 0.70, nzK2.b) * (1.0 - smoothstep(0.0, 0.010 + 0.022 * nzK2.r, abs(cfl))) * hasCk * nearK * (1.0 - inCourse) * (1.0 - inStrip);
      col = mix(col, col * 0.52, chipC);
    }
    // old chewing gum, spot by spot: most flags carry none or one, a few carry a group; each its own size, shape and age
    { // (r37) old chewing gum, each spot CUT FROM A SCANNED ONE (gum.png: 64 outlines of ambientCG's gum scans as distance fields, with the scan's own folds):
      // cells of 0.38 m, up to three spots each; every spot has its own outline, size (1.2 to 5.6 cm), turn and AGE: most are old, trodden flat and
      // grey-black with a paler worn middle and a ring of dirt; some are ghosts with a broken outline; a few are newer and paler than the flag
      vec2 gc = sd / 0.38 + fh.xy * 3.0, gi = floor(gc), gf = (fract(gc) - 0.5) * 0.38;
      float pxn = pxs;       // the pixel's SHORT side on the ground: at a grazing view its long side is four times that, and a spot chosen and edged by the long side blurred away
      float gfade = 1.0 - smoothstep(0.010, 0.026, pxg), gumP = (0.26 + 0.50 * dens) * (1.0 - inCourse) * (1.0 - isNew);
      for (int k = 0; k < 3; k++) {
        vec3 g3 = gh32(gi * 1.7 + float(k) * 17.3 + seed * 11.0), g4 = gh32(gi * 2.9 + float(k) * 7.1 + 3.0 + seed * 5.0);
        float gr_ = 0.009 + 0.021 * g3.z;       // 1.8 to 6 cm across (the first cut, mostly 1 to 2 cm, drew as specks)
        vec2 gp = (g3.xy - 0.5) * (0.38 - 3.2 * gr_ - 0.01);
        vec2 tq = grot(gf - gp, g4.y * 6.2832) * vec2(1.0, 0.82 + 0.36 * g4.z) / (3.2 * gr_);
        if (g4.x < gumP && max(abs(tq.x), abs(tq.y)) < 0.48) {
          float ti = floor(fract(g4.z * 9.7 + g3.x * 3.3) * 63.999);
          vec4 ga = textureLod(tGum, (vec2(mod(ti, 8.0), floor(ti / 8.0)) + 0.5 + tq) / 8.0, clamp(log2(pxn * 64.0 / (3.2 * gr_)), 0.0, 2.5));
          float sdf = (ga.r - 0.5) * 0.8 * gr_, ew = max(pxn * 0.7, 0.0005), ag = fract(g3.x * 7.3 + g4.x * 31.7), fold = 2.0 * ga.g;
          if (ag < 0.52) {                 // old: flat, grey-black, the middle worn paler, dirt gathered round it
            float body = smoothstep(-ew - 0.05 * gr_, ew + 0.12 * gr_, sdf + 0.16 * gr_ * (nzK2.g - 0.5));       // (r38) worn into the concrete: a soft, bitten edge, not a cut-out
            float worn = smoothstep(0.15 * gr_, 0.55 * gr_, sdf) * (0.25 + 0.6 * fract(ag * 23.0)) * smoothstep(0.30, 0.60, nzK2.r + 0.3 * (fold - 1.0));
            float dkk = (0.42 + 0.50 * fract(ag * 57.0) * fract(ag * 57.0) + 0.08) * (1.0 - 0.55 * worn) * clamp(0.9 + 0.4 * (fold - 1.0), 0.8, 1.05);       // (r37e) drawn top-down offline (prep sim): at 0.6 the old spots were mid-grey smudges
            float ring = (1.0 - smoothstep(0.0, 0.32 * gr_, -sdf)) * (1.0 - body) * (0.10 + 0.14 * fract(ag * 91.0));
            col *= 1.0 - ring * gfade;
            col = mix(col, vec3(0.014, 0.014, 0.015) + col * 0.14, body * dkk * gfade * (0.75 + 0.5 * nzK2.a));       // grey, grainy like the flag it is trodden into; r37's were near-black gum = max(gum, body * dkk);
          } else if (ag < 0.95) {          // a ghost: the stain a spot leaves when it has been scraped or trodden away, its outline broken
            float body = smoothstep(-ew * 2.0, ew * 2.0 + 0.2 * gr_, sdf + 0.5 * gr_ * (nzK2.b - 0.55)) * smoothstep(0.25, 0.55, nzK2.g + 0.25);
            col *= 1.0 - body * (0.08 + 0.22 * fract(ag * 23.0)) * gfade; gum = max(gum, body * 0.2);
          } else {                         // newer: still gum-coloured, paler than the flag, dirt along its edge, a hair proud
            float body = smoothstep(-ew, ew + 0.15 * gr_, sdf);
            vec3 gcol = (col * 1.22 + vec3(0.030, 0.026, 0.022)) * clamp(0.85 + 0.3 * (fold - 1.0), 0.8, 1.1) * (0.9 + 0.2 * fract(ag * 41.0));       // (r37b) no dark rim: a pale spot with a dark edge drew a ring
            col = mix(col, gcol, body * 0.85 * gfade); gum = max(gum, body * 0.5);
          }
        }
      }
    }
    { // (r38) stains with a cause and an outline: where something was spilt, leaked or stood. The scanned outlines again, at 16 to 50 cm, soft-edged, each its own strength; a few rusty
      vec2 zc = sd / 1.9 + fh.yx * 5.0, zi = floor(zc), zf = (fract(zc) - 0.5) * 1.9;
      vec3 z3 = gh32(zi * 1.3 + seed * 19.0 + 4.0), z4 = gh32(zi * 3.1 + seed * 7.0 + 9.0);
      float zr = 0.08 + 0.17 * z3.z * z3.z;
      vec2 zq = grot(zf - (z3.xy - 0.5) * (1.9 - 3.2 * zr - 0.05), z4.y * 6.2832) * vec2(1.0, 0.6 + 0.5 * z4.z) / (3.2 * zr);
      if (z4.x < 0.55 * (1.0 - isNew) && max(abs(zq.x), abs(zq.y)) < 0.48) {
        float zt = floor(z4.z * 63.999);
        float zs = (textureLod(tGum, (vec2(mod(zt, 8.0), floor(zt / 8.0)) + 0.5 + zq) / 8.0, 1.0).r - 0.5) * 0.8 + 0.22 * (nzK.g - 0.5) + 0.10 * (nzS.g - 0.5);
        float zb = smoothstep(-0.03, 0.14, zs), zrim = smoothstep(-0.03, 0.02, zs) * (1.0 - smoothstep(0.02, 0.10, zs));
        float zk = (0.06 + 0.13 * z3.x) * (0.6 + 0.8 * nzK2.g);
        col *= mix(vec3(1.0), z4.x < 0.05 ? vec3(0.985, 0.95, 0.90) : vec3(0.99, 0.995, 1.0), zb) * (1.0 - zb * zk - 0.05 * zrim);
      }
    }
    gumAge = 1.0;
    { // a dried spill on some flags: a stain with an edge, darker at its rim
      vec3 s3 = gh32(vec2(floor(u), row) * 2.3 + fi * 5.7 + seed * 23.0);
      float sr = 0.10 + 0.22 * s3.z, sq = length((cp - (s3.xy - 0.5) * len * 0.7) * vec2(1.0, 0.6 + 0.8 * s3.x)) / sr + 0.55 * (nzK.g - 0.5) + 0.25 * (nzS.g - 0.5);
      float spill = step(s3.z, 0.42 + 0.3 * age) * step(0.55, s3.y) * (1.0 - smoothstep(0.93, 1.0, sq));
      col *= 1.0 - spill * (0.07 + 0.10 * s3.x + 0.10 * smoothstep(0.78, 0.95, sq)) * nearF;
    }
    float pit = smoothstep(0.80, 0.84, nzK2.b) * smoothstep(0.45, 0.6, nzS.g) * nearK;      // pits and popped stones
    col *= 1.0 - 0.45 * pit;
  }
  gum *= 1.0 - smoothstep(0.010, 0.026, pxg); gumAge = 1.0;          // (r37) the spots are coloured where they are cut (above); this is what roughness and relief read
  // ---- joints: a tooled groove holding dirt, a smooth margin beside it; expansion joints wider, filled
  float jwv = 0.55 + 1.0 * nzC.g;                                              // the groove is tooled by hand and half filled: its dark line swells and thins
  float hwS = mix(0.0048, 0.009, isExp) * jwv, hwD = 0.0048 * jwv;
  float jS = gline(xs, hwS, fws), jD = gline(xd, hwD, fwd), jM = gline(seam, 0.0045, max(fws, fwd));
  float jl = max(max(jS, jD), jM);
  float dj = min(abs(xs), abs(xd));
  float farJ = 0.0;
  #ifdef SLAB
  farJ = smoothstep(0.004, 0.010, max(fws, fwd));       // beyond a few metres the real groove is thinner than a pixel and breaks into dashes: it hands over to a drawn line
  jS = gline(xs, hwS * 1.7, fws) * 0.80 * farJ; jD = gline(xd, hwD * 1.7, fwd) * 0.80 * farJ; jM = 0.0; jl = max(jS, jD);
  #endif
  #ifdef SLAB
  // (r30) every flag was edged by hand, edge by edge: one edge carries a wide pale trowelled band, the next a narrow one, the next none
  float eH = (xs < xd) ? gh21(vec2(vB.x + 0.31 * sign(vC.x), row) * 1.7 + fi * 13.7 + seed * 57.0 + 3.0) : gh21(vec2(vB.x, row + 0.31 * sign(vC.y)) * 1.7 + fi * 13.7 + seed * 57.0 + 7.0);
  float bw = mix(0.036, 0.072, fract(eH * 7.3)), bk = smoothstep(0.16, 0.60, eH);
  float margin = (1.0 - smoothstep(bw - 0.009, bw + 0.009, dj + 0.010 * (nzC.b - 0.5))) * bk * (0.55 + 0.45 * fh2.y) * (1.0 - 0.35 * age);
  #else
  float margin = (1.0 - smoothstep(0.036, 0.054, dj + 0.008 * (nzC.b - 0.5))) * (0.5 + 0.5 * fh2.y) * (1.0 - 0.40 * age);
  #endif       // the band the edging tool leaves either side of a joint: smoother and paler
  #ifdef SLAB
  col *= 1.0 + 0.44 * margin * (0.25 + 0.75 * smoothstep(0.28, 0.66, nzB.r * 0.7 + nzA.g * 0.3));       // (r35) fading in and out along the edge: a stripe of one width and brightness on every flag read as painted
  #ifdef SLAB
  col *= 1.0 - 0.10 * gline(dj - bw - 0.005, 0.0035, max(fws, fwd)) * bk * (1.0 - smoothstep(0.004, 0.010, max(fws, fwd)));       // the ridge the edging tool's lip leaves at the band's outer edge
  #endif       // (r26) a joint is first of all a PALE trowelled band; its groove is a hairline in the middle       // the edging tool's band shows on some stretches of some flags, never as a border round every one (r25: back to the r22 band, which the judges read as tooled)
  #else
  col *= 1.0 + 0.16 * margin;
  #endif
  col *= 1.0 - 0.30 * (1.0 - smoothstep(0.0, 0.12 + 0.30 * mid, dj)) * (0.3 + 1.2 * nzB.r) * (0.3 + 0.7 * age);      // grime gathers along the joints
  // the rounded shoulders of the groove fall away from the light of the sky: a soft dark edge either side of the line
  vec3 vv = cameraPosition - vWPos; vec2 vF = vec2(dot(vec2(vv.x, -vv.z), dir), dot(vec2(vv.x, -vv.z), nrm)) / max(vv.y, 0.05);       // the view, per metre of eye height, in the frame
  vec2 sunF = vec2(dot(vec2(uSunDir.x, -uSunDir.z), dir), dot(vec2(uSunDir.x, -uSunDir.z), nrm)) / max(uSunDir.y, 0.2);
  float edS = gline(abs(xs) - hwS - 0.005, 0.006, fws), edD = gline(abs(xd) - hwD - 0.005, 0.006, fwd);
  #ifdef SLAB
  edS = 0.0; edD = 0.0;
  #endif
  col *= 1.0 - 0.14 * max(edS, edD) - 0.13 * max(1.0 - smoothstep(0.0, 0.022, abs(xs) - hwS), 1.0 - smoothstep(0.0, 0.022, abs(xd) - hwD)) * (0.5 + nzC.g) * (1.0 - smoothstep(0.02, 0.06, max(fws, fwd)));     // the tooled shoulder rolls down into the groove
  col *= 1.0 + 0.10 * smoothstep(0.45, 0.7, nzC.b) * bakeV.g * (edS * clamp(-sign(xs) * sunF.x, -0.5, 1.0) + edD * clamp(-sign(xd) * sunF.y, -0.5, 1.0));       // the lip that faces the sun is bright, the other falls away
  // spalled edges: bites out of the arris, the stone of the mix showing, dirt in the hollow
  spall = smoothstep(0.62, 0.70, nzS.g + 0.10 * (nzC.b - 0.5)) * smoothstep(0.50, 0.68, nzB.r * 0.6 + nzC.g * 0.4) *       /* (r39) in stretches, each bite its own size: with the 3 cm noise alone they strung along the joint like beads */ (1.0 - smoothstep(0.012, 0.045 * (0.5 + nzS.r), dj)) * (0.1 + 0.6 * age) * nearK * 0.45;       // (r40) quieter: bites every few centimetres read as a beaded, perforated joint
  col = mix(col, col * (0.50 + 0.5 * fine) * 0.62, clamp(spall, 0.0, 1.0));
  vec3 jcol = mix(vec3(0.018, 0.017, 0.016) + 0.12 * col, vec3(0.035, 0.050, 0.018), smoothstep(0.68, 0.74, nzB.g + 0.2 * (nzS.b - 0.5)) * clamp(kerbZ + wallZ, 0.0, 1.0) * 0.8);   // dirt; moss and weeds where nobody walks
  jcol = mix(jcol, col * 0.42, 0.45);
  // the groove is a hollow 8 mm deep: along it you look at its dirty bottom; across it at a low angle the near lip hides the bottom and the far
  // wall shows instead, bright if the sun stands behind you, dull if it stands ahead
  float botS = clamp(1.0 - 0.008 * abs(vF.x) / (2.0 * hwS), 0.0, 1.0), botD = clamp(1.0 - 0.008 * abs(vF.y) / (2.0 * hwD), 0.0, 1.0);
  vec3 wallS = col * (0.30 + 0.45 * clamp(sign(vF.x) * sunF.x, 0.0, 1.5) * bakeV.g), wallDd = col * (0.30 + 0.45 * clamp(sign(vF.y) * sunF.y, 0.0, 1.5) * bakeV.g);
  float jfill = mix(0.22, 1.0, smoothstep(0.34, 0.62, nzB.g * 0.75 + nzC.r * 0.25)) * (style > 0.5 && style < 1.5 ? 0.42 : 1.0);      // the big tinted panels by the Flatiron are scored faintly (as their photograph shows)
  #ifdef SLAB
  { vec3 jfar = mix(col * mix(0.50, 0.30, smoothstep(0.42, 0.66, nzB.g * 0.6 + nzA.r * 0.4)), jcol, 0.40); float jk = mix(0.80, 1.0, jfill);       // (r27) the drawn line beyond a few metres carries the same colour and fill as the real groove nearer by: cross joints and long joints are one thing
    col = mix(col, jfar, jS * jk); col = mix(col, jfar, jD * jk); }
  #else
  col = mix(col, mix(wallS, jcol, botS), jS * jfill); col = mix(col, mix(wallDd, jcol, botD), jD * jfill); col = mix(col, jcol, jM * jfill);
  #endif       // packed black in one stretch, swept nearly clean in the next
  #ifdef SLAB
  { // the groove is real here: what lies in it (packed dirt in one stretch, swept nearly clean in the next) and the sky it does not see
    // seen from standing height a tooled joint is a soft grey line, not a black one: its dirt is the colour of the dust on the flags, darker only where it is damp or packed
    float gq = smoothstep(0.10, 0.80, vA.z + 0.5 * (nzC.r - 0.5) + 0.55 * (nzB.b - 0.55));
    float pack = smoothstep(0.42, 0.66, nzB.g * 0.6 + nzA.r * 0.4);                 // long stretches packed dark, long stretches swept pale
    vec3 jc2 = mix(col * mix(0.50, 0.30, pack), jcol, 0.25 + 0.40 * pack * jfill);       // (r33) seen beside the photograph our groove was a faint grey line: a tooled joint is a dark, shadowed cut
    col = mix(col, jc2, gq * mix(0.80, 1.0, jfill) * (1.0 - farJ));
    col *= 1.0 - 0.10 * smoothstep(0.0, 0.6, vA.z) * (1.0 - farJ);
  }
  #else
  // ---- flags a few millimetres out of level: the higher one throws a hairline shadow on the lower when the sun stands behind it
  if (isNear) {
    vec2 sunM = vec2(uSunDir.x, -uSunDir.z) / max(uSunDir.y, 0.2); float sunS = dot(sunM, dir), sunD = dot(sunM, nrm);
    float hS = gh21(vec2(floor(u + 0.5), row) + fi * 7.1 + seed * 3.3) - 0.5, lipS = sign(hS) * max(abs(hS) - 0.2, 0.0) * 0.03 * (0.35 + age);
    float hD = gh21(vec2(floor(u), floor(v + 0.5)) + fi * 5.3 + seed * 9.1) - 0.5, lipD = sign(hD) * max(abs(hD) - 0.2, 0.0) * 0.03 * (0.35 + age);
    float wS = lipS * sunS, qS = -sign(lipS) * xs, wD = lipD * sunD, qD = -sign(lipD) * xd;
    float shS = wS > 0.0 ? clamp((wS - qS) / fws + 0.5, 0.0, 1.0) * clamp(qS / fws + 0.5, 0.0, 1.0) : 0.0;
    float shD = wD > 0.0 ? clamp((wD - qD) / fwd + 0.5, 0.0, 1.0) * clamp(qD / fwd + 0.5, 0.0, 1.0) : 0.0;
    col *= 1.0 - 0.6 * max(shS, shD) * bakeV.g;
    col *= 1.0 - 0.30 * max(step(0.002, abs(lipS)) * (1.0 - smoothstep(0.0, 0.012, qS)) * step(0.0, qS), step(0.002, abs(lipD)) * (1.0 - smoothstep(0.0, 0.012, qD)) * step(0.0, qD)) * (1.0 - smoothstep(0.004, 0.012, max(fws, fwd)));
  }
  #endif
  { // (r25) history: where an old flag's corner broke up, the hole was filled with cold-patch asphalt
    #ifdef SLAB
    vec2 hv = vC.zw;
    #else
    vec2 hv = vec2(len * 0.5);
    #endif
    float hasA = step(fract(h.x * 13.7 + h.z * 5.1), 0.03 + 0.06 * age) * (1.0 - isNew) * (1.0 - inStrip) * (1.0 - inCourse);
    if (hasA > 0.5 && isNear) {
      vec2 cq = vec2(h.y < 0.5 ? -hv.x : hv.x, fract(h.z * 3.3) < 0.5 ? -hv.y : hv.y);
      vec4 nA1 = texture2D(tNoise, sd / 0.9 + h.xy), nA2 = textureGrad(tNoise, sd / 0.17 + h.yx, sdx / 0.17, sdy / 0.17);
      float dA = length((cpv - cq) * vec2(1.0, 0.65 + 0.7 * h.x)) - (0.20 + 0.30 * fract(h.y * 9.7)) + 0.16 * (nA1.g - 0.5) + 0.03 * (nA2.g - 0.5);
      float inA = 1.0 - smoothstep(-0.006, 0.006, dA);
      vec3 acol = vec3(0.060, 0.059, 0.058) * (0.55 + 0.9 * nA2.a) * (0.85 + 0.3 * nA1.r);
      acol = mix(acol, vec3(0.20, 0.19, 0.175), smoothstep(0.86, 0.92, nA2.b) * 0.7);                 // its stone showing
      acol *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.02, -dA));                                       // the tarry edge
      col = mix(col, acol, inA * nearF);
      col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.05, dA)) * step(0.0, dA) * nearF;                 // dirt against its rim
    }
  }
  // ---- ramps: their own newer pour
  if (vR > 0.5) { col = tone * 1.10 * vec3(1.0, 0.985, 0.95) * mix(1.0, det, 0.5) * mix(1.0, fine, 0.6) * (0.92 + 0.16 * big) * (1.0 - 0.25 * stain) * (0.94 + 0.12 * step(0.5, fract(d / 0.05)) * nearK) * (0.72 + 0.28 * smoothstep(0.1, 0.9, d + 0.3 * (nzB.g - 0.5))); jl = 0.0; margin = 0.0; }
  // ---- pedestrian plaza coating where ground.js's field says so (the plaza agent's surface; kept as ground.js painted it)
  #if defined(USE_FIELD) && !defined(SLAB)
  {
    vec2 fuv = m / (2.0 * uField.xy) + 0.5; vec4 F = texture2D(tField, fuv); float inF = step(abs(m.x), uField.x - 1.0) * step(abs(m.y), uField.y - 1.0);
    float fdK = F.r * 12.0, fdB = F.b * 6.0;
    float pzShF = step(0.175, F.g) * step(F.g, 0.5), eB = fwidth(fdB) + 1e-4;
    float pzPoly = step(F.g, 0.17) * step(2.5, fdK), pzKind = F.g < 0.17 ? floor(F.g * 20.0 + 0.5) : 0.0;
    float pzEdge = wallD > 0.0 ? clamp((dB - 6.45) / fwd + 0.5, 0.0, 1.0) : clamp((fdB - 5.2 + 0.30 * (nzC.g - 0.47) + 0.10 * (nzC.b - 0.5)) / eB + 0.5, 0.0, 1.0);
    float pzIn = mix(pzPoly, step(0.9, fdK) * pzEdge, pzShF);
    if (wallD > 0.0 && pzShF > 0.5) {                                          // the flush granite kerb between walk and plaza
      float fk = gline(dB - 6.36, 0.09, fwd) * step(0.9, fdK);
      vec3 gk = vec3(0.115, 0.117, 0.12) * (2.0 * textureGrad(tMasks, sd / 0.42, sdx / 0.42, sdy / 0.42).b) * (0.85 + 0.3 * gh21(vec2(floor(s / 1.83), seed)));
      gk *= 1.0 - 0.7 * gline(min(fract(s / 1.83), 1.0 - fract(s / 1.83)) * 1.83, 0.004, fws);
      col = mix(col, gk, fk); jl *= 1.0 - fk; gum *= 1.0 - fk; crack *= 1.0 - fk;
      if (dB > 6.27) { xs = 9.0; xd = 9.0; }
    }
    float plaza = pzIn * (1.0 - step(1.5, pzKind) * step(pzKind, 2.5)) * inF * (1.0 - step(0.5, vR));
    if (plaza > 0.001) {
      float agg = textureGrad(tMasks, m / 0.83, mdx / 0.83, mdy / 0.83).b, grain = 2.0 * cf.b - 0.5;
      float wornP = smoothstep(0.60, 0.72, nzB.b * 0.5 + nzB.r * 0.5 + 0.08), grit = nzC.b, scuff = smoothstep(0.60, 0.74, texture2D(tNoise, grot(m, 0.7) * vec2(0.07, 0.45)).g);
      vec3 gravel = mix(vec3(0.52, 0.44, 0.31), vec3(0.46, 0.40, 0.30), big) * (0.50 + 1.0 * agg) * (0.70 + 0.6 * grain) * (0.84 + 0.34 * grit) * (1.0 - 0.3 * scuff) * 0.62;
      gravel = mix(gravel, vec3(0.105) * (0.6 + 0.8 * grain), wornP * 0.7);
      vec3 pav = vec3(0.19, 0.187, 0.18) * (0.62 + 0.76 * agg);
      gravel = pzKind > 2.5 ? vec3(0.07) * clamp(1.0 + (grain - 0.5) * 2.2, 0.5, 1.6) : (pzKind > 0.5 ? pav : gravel);
      col = mix(col, gravel, plaza); jl *= 1.0 - plaza; margin *= 1.0 - plaza; crack *= 1.0 - plaza; gum *= 1.0 - plaza;
    }
  }
  #endif
  // ---- the hero tree pits (trees.js, game.heroPits): no flag, joint, stain or gum of mine inside a pit; bare dark earth under its mulch
  float pitF = step(0.5, texture2D(tPit, (m - uPit.xy) * uPit.zw).r);
  if (pitF > 0.5) { col = vec3(0.034, 0.028, 0.022) * (0.7 + 0.6 * nzC.g); farJ = 1.0; }
  diffuseColor.rgb = col;
  // ---- relief: the slab's own surface, the broom finish where feet have not worn it off, the groove, each flag a hair out of level
  if (isNear && vR < 0.5) {
    vec2 nF = textureGrad(tConcN1, uvA * 4.3 + 0.37, sdx * 1.87, sdy * 1.87).xy * 2.0 - 1.0;
    vec2 nB = textureGrad(tConcN2, vec2(d, s) / 0.85 + h.yx * 3.0, vec2(sdx.y, sdx.x) / 0.85, vec2(sdy.y, sdy.x) / 0.85).xy * 2.0 - 1.0;
    float broomN = (0.35 + 0.65 * fh2.x) * (1.0 - 0.6 * lane) * (1.0 - margin);
    vec2 nt = nF * 0.55 * nearK * (1.0 - smoothstep(0.0018, 0.0045, pxg))       /* (r38) the scanned relief only within arm's reach: further out its brush lines beat against the pixels as a herringbone over half a flag */ + vec2(nB.y, nB.x) * broomN * 0.38 * nearK * (1.0 - smoothstep(0.0011, 0.0026, px));       // (r24) past two metres the broom relief beat against the pixels and read as hatched patches
    float gr = 1.0 - smoothstep(0.006, 0.02, max(fws, fwd));                  // the groove's walls, while they are wider than a pixel
    #ifndef SLAB
    nt.x -= sign(xs) * (1.0 - smoothstep(0.0, hwS + 0.013, abs(xs))) * 0.9 * gr;
    nt.y -= sign(xd) * (1.0 - smoothstep(0.0, hwD + 0.013, abs(xd))) * 0.9 * gr;
    #endif
    nt += (nzS.rg - 0.5) * 1.5 * clamp(spall, 0.0, 1.0);
    nt += (h.xy - 0.5) * (0.030 + 0.09 * step(0.8, h.z)) + crack * (nzC.rg - 0.5) * 1.2 * nearK;
    nt *= (1.0 - gum * gumAge * 0.8) * nearF;
    #ifdef SLAB
    nt *= 1.0 - smoothstep(0.0, 0.25, vA.z);       // (r40b) no scanned relief on the groove's walls: the broom lines crossing a steep wall lit up as a chain of beads along every joint (named since r36)
    nt *= 0.55;                               // on real slabs the two scanned reliefs crossing each other read as a woven hatch at arm's length
    gNrm = normalize(vec3(dir.x, 0.0, -dir.y) * nt.x + vec3(nrm.x, 0.0, -nrm.y) * nt.y + normalize(vNw)); gNrm.y = max(gNrm.y, 0.05);
    #else
    gNrm = normalize(vec3(dir.x, 0.0, -dir.y) * nt.x + vec3(nrm.x, 0.0, -nrm.y) * nt.y + vec3(0.0, 1.0, 0.0));
    #endif
  }
  #ifdef SLAB
  if (gNrm.y <= 0.0) gNrm = normalize(vNw);
  gNrm = normalize(mix(gNrm, vec3(0.0, 1.0, 0.0), farJ));
  #endif
  float broom = (0.35 + 0.65 * fh2.x) * (1.0 - 0.6 * lane);
  if (pitF > 0.5) gNrm = vec3(0.0, 1.0, 0.0);
  gRough = pitF > 0.5 ? 0.97 : 0.80 - 0.14 * stain - 0.2 * gum - 0.10 * lane + 0.08 * broom + 0.08 * (cd.r - 0.5); gSpec = 0.75 + 0.2 * stain;
`;

// the foot of the kerb on the road: an unlit darkening only (cast shadow, crease, damp dirt). It is a MeshBasicMaterial on purpose: as a lit
// transparent MeshStandardMaterial this strip came out of the lead's light chain as NaN in places (black blocks after bloom).
const FS_GUT = /* glsl */`
  float x = vG.x, w = vG.y * vG.z, s = vG.w;
  vec4 nz = texture2D(tNoise, vec2(s / 3.1, x * 0.7) + 0.2), nz2 = texture2D(tNoise, vec2(s / 0.6, x * 2.0));
  float fx = fwidth(x) + 1e-4;
  float vis = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).g;
  float sh = (1.0 - smoothstep(w - 0.010 - fx, w + 0.014 + fx, x)) * step(0.006, w) * (0.30 + 0.5 * vis);
  float crease = 0.6 * exp(-max(x, 0.0) / 0.03);
  float bw = 0.20 + 0.34 * smoothstep(0.30, 0.75, nz.g), damp = (1.0 - smoothstep(bw * 0.55, bw, x + 0.16 * (nz2.g - 0.5) + 0.05 * (nz2.r - 0.5))) * (0.34 + 0.36 * nz.b);
  float dark = clamp(1.0 - (1.0 - 0.45 * sh) * (1.0 - crease) * (1.0 - 0.55 * damp), 0.0, 0.40);       // (r23) at a fixed exposure the old strength read as a black hole under the kerb
  diffuseColor = vec4(vec3(0.004), dark * (1.0 - smoothstep(0.45, 0.55, x)));
`;
function mkGutMat(shared, U) {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, tNoise: U.tNoise });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n attribute vec4 aG; varying vec4 vG; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vG = aG; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec4 vG; varying vec3 vWPos; uniform sampler2D tLight; uniform vec2 uHalf; uniform sampler2D tNoise;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n {' + FS_GUT + '}');
  };
  m.customProgramCacheKey = () => 'stwalk-gutD4';
  return m;
}

// tactile warning pads on the ramps: ambientCG's scanned tactile paving (colour + normal), cast panels of yellow, brick red or dark grey
const FS_TAC = /* glsl */`
  vec2 uv = vTuv / 1.22 + vT.w * vec2(3.7, 1.3);
  vec3 tc = texture2D(tTacC, uv).rgb; vec3 tn = texture2D(tTacN, uv).xyz * 2.0 - 1.0;
  float lum = dot(tc, vec3(0.333)), kind = vT.z;
  vec3 col = kind < 0.5 ? tc * vec3(1.0, 0.86, 0.55) : (kind < 1.5 ? lum * vec3(0.78, 0.20, 0.13) * 1.5 : vec3(lum) * 0.42);
  vec4 nz = texture2D(tNoise, m / 2.3 + vT.w), nz2 = texture2D(tNoise, m / 0.37);
  col *= 0.50 + 0.55 * nz.g;                                                   // walked-in dirt
  col = mix(col, vec3(0.05, 0.048, 0.045), 0.55 * smoothstep(0.55, 0.75, nz.r * 0.6 + nz2.g * 0.4));      // black grime between the domes, scuffs
  vec2 e = min(vTuv - vTe.xy, vTe.zw - vTuv); col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.012, min(e.x, e.y)));        // the seam where the panel sits in the concrete
  col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.006, abs(fract(vTuv.x / 0.61 + 0.5) - 0.5) * 0.61));            // panels are two feet wide
  diffuseColor.rgb = col * 0.62;
  vec2 dir = vT.xy, nrm = vec2(-dir.y, dir.x);
  gNrm = normalize(vec3(dir.x, 0.0, -dir.y) * tn.x * 1.6 + vec3(nrm.x, 0.0, -nrm.y) * tn.y * 1.6 + vec3(0.0, 1.0, 0.0) * max(tn.z, 0.2));
  gRough = 0.62 + 0.25 * nz.g; gSpec = 0.7;
`;

const FS_KERB = /* glsl */`
  float s = vK.x, v = vK.y, granite = step(0.5, vK.z), sd = vK.w;
  vec2 kuv = vec2(s, v * 0.16);
  float sd0 = fract(sd * 0.01) ;       // dirt, scuffs and wear run on along the kerb line: they do not start afresh at every stone
  vec4 nz = texture2D(tNoise, kuv / vec2(2.6, 1.3) + sd0), nz2 = texture2D(tNoise, kuv / vec2(0.9, 0.5) + sd0 * 3.0);
  float sp = 2.0 * texture2D(tMasks, kuv / 0.42 + sd).b, cdet = 2.0 * texture2D(tConcD, kuv / 1.7 + sd).r, rust = 2.0 * texture2D(tMetalD, kuv / 0.8 + sd).r;
  float hs = gh21(vec2(floor(sd * 37.0), 3.0)), face = 1.0 - smoothstep(0.93, 1.0, v), top = smoothstep(1.08, 1.12, v), arris = 1.0 - smoothstep(0.0, 0.11, abs(v - 1.0));
  // granite: weathered grey stone, its speckle, each stone its own tone
  vec3 gran = mix(vec3(0.062, 0.063, 0.066), vec3(0.078, 0.077, 0.076), hs) * mix(1.0, sp, 0.75) * (0.80 + 0.40 * nz.g) * (0.90 + 0.20 * gh21(vec2(floor(sd * 53.0), 9.0)));
  // steel-faced concrete: a rusted steel plate on the face and over the edge, concrete behind it
  float patchK = step(0.5, vK2.w);
  float bare = max(patchK, smoothstep(0.30, 0.70, vK2.z + 0.40 * (nz2.r - 0.5) + 0.2 * (nz2.b - 0.5)) * step(0.02, vK2.z));       // stretches where the steel is gone and the old concrete kerb shows, broken (the mesh is set back and bitten there)
  float plate = (1.0 - smoothstep(1.12, 1.15, v)) * (1.0 - bare);       // (r24) the steel is a face plate turned a thumb's width over the top, not half the kerb
  vec3 conc = vec3(0.092, 0.096, 0.104)       /* (r39) darker and bluer than the flags: seen from the walk the kerb must be its own thing */ * mix(1.0, cdet, 0.6) * (0.90 + 0.20 * nz.g) * (1.0 - 0.35 * bare * smoothstep(0.4, 0.6, nz2.g)) * (1.0 - 0.38 * bare);
  conc *= 1.0 - 0.65 * (1.0 - smoothstep(0.0, 0.035 + 0.03 * nz2.g, abs(v - 1.15))) ;                    // the seam where concrete meets the steel: open, full of dirt
  conc *= 1.0 - 0.35 * smoothstep(0.55, 0.7, nz2.b) * (1.0 - smoothstep(1.15, 1.5, v));                   // the concrete breaks away behind the steel
  // the steel: a rolled angle, dark with rust where nothing touches it, rubbed to bare grey metal by tyres along the nose and the upper face
  float rusty = smoothstep(0.35, 0.7, nz2.g + 0.3 * (rust - 1.0));
  float polish = clamp((1.0 - smoothstep(0.03, 0.16, abs(v - 1.0))) * (0.75 + 0.5 * nz.r) * smoothstep(0.30, 0.62, nz2.b + 0.5 * nz.g) * smoothstep(0.35, 0.55, texture2D(tNoise, vec2(s / 2.1, 0.61) + sd0).r) + 0.35 * smoothstep(0.3, 0.9, v) * smoothstep(0.45, 0.7, nz.r) * step(v, 1.0), 0.0, 1.0);
  vec3 steel = mix(vec3(0.042, 0.040, 0.039), vec3(0.054, 0.042, 0.034), rusty) * mix(1.0, rust, 0.40);
  steel = mix(steel, vec3(0.17, 0.168, 0.165), polish * 0.55);
  { // where the steel is gone: the rusty studs that held it, a rust stain running down from each, rust washed into the concrete
    float ax = (fract(s / 0.61 + sd0 * 7.0) - 0.5) * 0.61, ay = (v - 0.50) * 0.166, onFace = step(v, 0.92) * bare * (1.0 - patchK);
    float stud = 1.0 - smoothstep(0.007, 0.012, length(vec2(ax, ay))), run = (1.0 - smoothstep(0.004, 0.022 + 0.02 * nz2.g, abs(ax))) * step(ay, 0.0) * (0.35 + 0.65 * nz2.r);
    conc = mix(conc, vec3(0.16, 0.085, 0.045) * (0.6 + 0.8 * nz2.g), onFace * clamp(0.75 * run + 0.30 * smoothstep(0.35, 0.7, nz.g), 0.0, 0.85));
    conc = mix(conc, vec3(0.030, 0.018, 0.012), onFace * stud);
    conc = mix(conc, vec3(0.160, 0.158, 0.152) * mix(1.0, cdet, 0.5) * (0.9 + 0.2 * nz.g), patchK * (1.0 - 0.25 * smoothstep(0.5, 0.8, nz.b)));        // the re-poured length: newer, paler, cleaner
  }
  vec3 col = mix(mix(conc, steel, plate), gran, granite);
  // what tyres and the gutter do: black scuffs on the upper face, road dirt at its foot, grime on top
  col *= mix(0.72 + 0.56 * nz.b, 0.90 + 0.20 * nz.b, top * (1.0 - granite));
  { // (r25) a kerb is the dirtiest thing on the street: grime in patches along its top, black tyre rubber dragged along the nose and the top, a dirt line at the gutter
    vec4 nzL = texture2D(tNoise, vec2(s / 1.9, v * 0.21) + sd0 * 5.0), nzT = texture2D(tNoise, vec2(s / 0.31, v * 0.9) + sd0 * 9.0);
    col *= 1.0 - 0.18 * top * (1.0 - granite) * smoothstep(0.40, 0.72, nzL.g);
    float rub = smoothstep(0.58, 0.78, nzT.r * 0.6 + nzL.b * 0.4) * smoothstep(0.75, 0.95, v) * (1.0 - smoothstep(1.25, 1.7, v));
    col = mix(col, vec3(0.020, 0.020, 0.021), 0.62 * rub * (1.0 - granite));
    col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.16 + 0.2 * nzL.r, v)) * (1.0 - granite);
    float scr = smoothstep(0.80, 0.90, texture2D(tNoise, vec2(s / 0.07, v * 0.05) + sd0).b) * face * plate;        // scrapes down the steel
    col = mix(col, col * 1.6 + 0.01, 0.5 * scr * smoothstep(0.45, 0.7, nzL.r));
  }
  float scuff = face * smoothstep(0.35, 0.95, v) * smoothstep(0.42, 0.62, nz.r + 0.25 * (nz2.r - 0.5));
  col = mix(col, vec3(0.022), 0.55 * scuff);
  col *= 1.0 - 0.30 * top * smoothstep(0.4, 0.7, nz.g);
  col = mix(col, vec3(0.016), smoothstep(1.90 - 0.06 * nz2.g, 1.95, v) * 0.9);                 // the open joint between kerb and slab, packed with dirt
  float wornE = (1.0 - smoothstep(0.0, 0.075, abs(v - 1.02))) * smoothstep(0.34, 0.56, nz.g + 0.45 * (nz2.r - 0.5)) * plate * (1.0 - granite);       // (r27) the steel nose worn bright by tyres, in broken stretches: the one thing that says steel
  col = mix(col, vec3(0.23, 0.228, 0.225) * (0.8 + 0.4 * nz2.g), 0.85 * wornE);
  col = mix(col, col * 1.5 + 0.006, (1.0 - smoothstep(0.0, 0.06, abs(v - 1.04))) * smoothstep(0.42, 0.62, nz.g + 0.3 * (nz2.r - 0.5)) * 0.8 * (1.0 - plate));      // the arris rubbed pale by tyres and feet
  // chipped arris: fresh stone / bright steel shows
  float chip = smoothstep(0.50, 0.58, nz2.b + 0.3 * (nz2.g - 0.5)) * (1.0 - smoothstep(0.0, 0.2 + 0.25 * nz.b, abs(v - 1.0)));
  col = mix(col, mix(vec3(0.085, 0.062, 0.048), vec3(0.24, 0.24, 0.235), granite), chip * 0.7 * mix(1.0 - plate * 0.6, 1.0, granite));
  // stone joints: a dark open joint at both ends of each stone
  float jw = fwidth(vK2.x) + 1e-5; col *= 1.0 - 0.42 * gline(min(vK2.x, vK2.y), 0.004, jw) * mix(1.6, 1.0, granite) * smoothstep(0.25, 0.6, nz2.r + 0.3 * nz.g);       // tight joints: seen along the kerb an open one draws a long slanting line and the stones read as overlapping
  col *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.05, min(vK2.x, vK2.y))) * nz2.g;
  float silt = step(1.5, vK.z);
  if (silt > 0.5) {
    vec4 z1 = texture2D(tNoise, vec2(s, v * 0.3) / 0.23 + sd0), z2 = texture2D(tNoise, vec2(s, v * 0.3) / 1.7 + sd0);
    if (vK.z < 2.5 && v < 0.55 * z1.g + 0.35 * z2.b - 0.05) discard;                                             // a ragged, thinning edge, not a ruled one
    col = mix(vec3(0.085, 0.080, 0.072), vec3(0.165, 0.150, 0.125), z2.g) * (0.65 + 0.7 * z1.a);    // (r23) dry road dust is paler than the asphalt, not black
    col = mix(col, vec3(0.16, 0.11, 0.05), step(0.90, z1.b) * step(0.5, z2.r) * 0.8);               // bits of leaf
    col = mix(col, vec3(0.30), step(0.955, z1.g) * 0.7);                                           // grit, glass, a butt end
    col *= 0.75 + 0.25 * smoothstep(0.0, 0.5, 1.0 - v);
  }
  float deb = step(2.5, vK.z);
  if (deb > 0.5) col = vK2.rgb * (0.75 + 0.5 * nz2.g) * (0.55 + 0.45 * smoothstep(-0.3, 0.6, normalize(vNk).y));       // gutter debris: its own colour, darker underneath
  diffuseColor.rgb = col;
  gSpec = mix(mix(0.5, 1.0, plate), 0.5, granite); gRough = mix(mix(0.9, mix(0.78, 0.50, polish), plate), 0.8, granite); gMetal = (1.0 - granite) * plate * mix(0.30, 0.70, polish);
  gRough = mix(gRough, 0.38, wornE); gMetal = mix(gMetal, 0.85, wornE);
  if (silt > 0.5) { gRough = 0.95; gMetal = 0.0; gSpec = 0.3; }
  if (deb > 0.5) { gRough = 0.85; gMetal = 0.0; gSpec = 0.4; }
`;

// ------------------------------------------------------------------ the part
export async function add(game, ctx) {
  if (!ctx.swNext && game.P && game.P.get('swnext')) { ctx.swNext = 1; return (await import('./sidewalks_next.js')).add(game, ctx); }     // ?swnext=1: the version under test (drawn cleanly once before it becomes this file)
  const world = game.world, city = game.city || ctx.city, shared = world.shared;
  if (game.P && game.P.get('swk')) SWK = +game.P.get('swk') || 1; if (game.P && game.P.get('swc')) SWC = +game.P.get('swc') || 1;
  const gp = (ctx.parts && ctx.parts.ground) || null;
  const group = new THREE.Group(); group.name = 'streets_sidewalks';
  const L = new THREE.TextureLoader();
  const load = (f, srgb = false) => new Promise((res, rej) => L.load(ctx.A + 'sidewalks/' + f, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t);
  }, undefined, () => rej(new Error('sidewalk texture ' + f))));
  const [tConcD, tConcN1, tConcN2, tMasks, tMetalD, tNoise, tTacN] = await Promise.all(['conc_d.jpg', 'conc_n1.jpg', 'conc_n2.jpg', 'masks.jpg', 'metal_d.jpg', 'noise.png', 'tactile_n.jpg'].map((f) => load(f)));
  const tTacC = await load('tactile_c.jpg', true);
  const [tConc2a, tConc2b, tGum] = await Promise.all(['conc2a.jpg', 'conc2b.jpg', 'gum.png'].map((f) => load(f)));
  let tLeaf = null; try { tLeaf = await load('leaves.webp', true); tLeaf.wrapS = tLeaf.wrapT = THREE.ClampToEdgeWrapping; } catch (e) { console.log('[sidewalks] no leaf atlas: ' + (e && e.message)); }
  tConcD.anisotropy = 16; tConc2a.anisotropy = 16; tConc2b.anisotropy = 16;

  // the rings, with ground.js's ramp notches when it is there (its crosswalks and tactile pads sit on them)
  const rings = readRings(city);
  try {
    const G = (await import('./ground.js'))._test, C = G.readCity(city), by = new Map(C.rings.map((r) => [r.bi + (r.hole ? ':h' + r.pts.length : ''), r]));
    for (const r of rings) { const o = by.get(r.bi + (r.hole ? ':h' + r.pts.length : '')); if (!o || o.segs.length !== r.segs.length) continue; r.segs.forEach((sg, i) => { sg.notches = o.segs[i].notches.map((n) => ({ t: n.t })); sg.ave = o.segs[i].ave; }); }
  } catch (e) { console.log('[sidewalks] no ramp notches from ground.js: ' + (e && e.message)); }

  const isHero = (ring) => { for (const p of ring.pts) for (const hq of HERO) if (Math.hypot(p[0] - hq[0], p[1] - hq[1]) < HERO_R) return true; for (const hq of HERO) if (ringDist(ring.pts, hq[0], hq[1]) < HERO_R) return true; return false; };
  const heroBlocks = new Map();
  for (const r of rings) if (!r.hole && isHero(r)) heroBlocks.set(r.bi, []);
  for (const r of rings) if (heroBlocks.has(r.bi)) heroBlocks.get(r.bi).push(r);
  let nArcs = 0; if (!(game.P && game.P.get('swdbg') || '').includes('r')) for (const rs of heroBlocks.values()) for (const r of rs) { try { nArcs += roundCorners(r); } catch (e) { console.log('[sidewalks] corner not rounded: ' + (e && e.message)); } }

  // buildings near the hero blocks, for the distance from each kerb line to the building line
  let hx0 = 1e9, hy0 = 1e9, hx1 = -1e9, hy1 = -1e9; for (const rs of heroBlocks.values()) for (const r of rs) for (const p of r.pts) { hx0 = Math.min(hx0, p[0]); hy0 = Math.min(hy0, p[1]); hx1 = Math.max(hx1, p[0]); hy1 = Math.max(hy1, p[1]); }
  const near = city.buildings.filter((b) => !b.far && (b.minh || 0) < 1 && b.poly && b.poly.length >= 3 && b.poly[0][0] > hx0 - 30 && b.poly[0][0] < hx1 + 30 && b.poly[0][1] > hy0 - 30 && b.poly[0][1] < hy1 + 30).map((b) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of b.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return { b, x0, y0, x1, y1 }; });
  const inBuilding = (x, y) => { for (const q of near) if (x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1 && pointInRing(q.b.poly, x, y)) return true; return false; };
  const wallDist = (sg) => {
    const ds = [];
    for (let k = 1; k <= 9; k++) { const t = sg.L * k / 10; let hit = 0; for (let d = 0.6; d < 16; d += 0.1) if (inBuilding(sg.a[0] + sg.dx * t + sg.nx * d, sg.a[1] + sg.dy * t + sg.ny * d)) { hit = d; break; } if (hit) ds.push(hit); }
    if (ds.length < 5) return 0; ds.sort((p, q) => p - q); const med = ds[ds.length >> 1]; return ds[ds.length - 2] - ds[1] < 0.8 ? med : 0;
  };

  const fx = city.meta.px + 60, fy = city.meta.py + 60, tField = gp && gp.field && gp.field.tField;
  const U = { tConcD: { value: tConcD }, tConc2a: { value: tConc2a }, tConc2b: { value: tConc2b }, tConcN1: { value: tConcN1 }, tConcN2: { value: tConcN2 }, tMasks: { value: tMasks }, tGum: { value: tGum }, tMetalD: { value: tMetalD }, tNoise: { value: tNoise }, tTacC: { value: tTacC }, tTacN: { value: tTacN },
    tField: { value: tField || tNoise }, uField: { value: new THREE.Vector4(fx, fy, 0, 0) },
    tPit: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, uPit: { value: new THREE.Vector4(0, 0, 1, 1) } };
  U.tPit.value.needsUpdate = true;
  // trees.js loads after this part and sets game.heroPits = [[x, y, heading, length, width], ...]: when it appears, draw the rectangles (grown 5 cm) into a mask
  { let tries = 0; const mk = () => {
      const pits = game.heroPits;
      if (!pits || !pits.length) { if (++tries < 240) setTimeout(mk, 500); return; }
      try {
        const px = 0.08, x0 = hx0 - 12, y0 = hy0 - 12, W = Math.min(4096, Math.ceil((hx1 - hx0 + 24) / px)), H = Math.min(4096, Math.ceil((hy1 - hy0 + 24) / px)), buf = new Uint8Array(W * H);
        for (const [cx, cy, hd, len, wid] of pits) {
          const c = Math.cos(hd), sn = Math.sin(hd), hl = len / 2 + 0.05, hw = wid / 2 + 0.05, r = Math.hypot(hl, hw) + px;
          for (let j = Math.max(0, Math.floor((cy - r - y0) / px)); j <= Math.min(H - 1, Math.ceil((cy + r - y0) / px)); j++) for (let i = Math.max(0, Math.floor((cx - r - x0) / px)); i <= Math.min(W - 1, Math.ceil((cx + r - x0) / px)); i++) {
            const dx = x0 + (i + 0.5) * px - cx, dy = y0 + (j + 0.5) * px - cy;
            if (Math.abs(dx * c + dy * sn) <= hl && Math.abs(-dx * sn + dy * c) <= hw) buf[j * W + i] = 255;
          }
        }
        const t = new THREE.DataTexture(buf, W, H, THREE.RedFormat); t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
        U.tPit.value = t; U.uPit.value.set(x0, y0, 1 / (W * px), 1 / (H * px));
        console.log('[sidewalks] ' + pits.length + ' hero tree pits kept clear (' + W + 'x' + H + ' mask)');
      } catch (e) { console.log('[sidewalks] tree pit mask not made: ' + (e && e.message)); }
    }; setTimeout(mk, 500); }
  const walkDecl = `uniform vec4 uSeg[${NS}]; uniform vec4 uSegB[${NS}]; uniform vec4 uSegC[${NS}]; uniform int uNSeg; varying float vR;` + (tField ? '\n#define USE_FIELD\n' : '');
  const kerbMat = mkMat(shared, U, { name: 'kerb', vsDecl: 'attribute vec4 aK; attribute vec4 aK2; varying vec4 vK; varying vec4 vK2; varying vec3 vNk;', vsMain: 'vK = aK; vK2 = aK2; vNk = normal;', fsDecl: 'varying vec4 vK; varying vec4 vK2; varying vec3 vNk;', fsMain: FS_KERB,
    setup: (m) => { m.side = THREE.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } });

  // (r38) fallen leaves: scanned leaves, dried brown in the shader (a few still yellow)
  const leafMat = tLeaf ? mkMat(shared, Object.assign({ tLeaf: { value: tLeaf } }, U), { name: 'leaf', vsDecl: 'attribute vec4 aL; varying vec4 vL;', vsMain: 'vL = aL;', fsDecl: 'uniform sampler2D tLeaf; varying vec4 vL;', fsMain: `
      vec4 lc = texture2D(tLeaf, vL.xy); if (lc.a < 0.42) discard;
      float ll = dot(lc.rgb, vec3(0.30, 0.60, 0.10));
      vec3 dry = ll * mix(vec3(1.00, 0.66, 0.34), vec3(0.86, 0.72, 0.52), fract(vL.z * 7.3));
      vec3 lcol = mix(dry, lc.rgb * vec3(0.80, 0.66, 0.42), step(0.85, vL.z) * 0.30);       // a bright yellow one read as a sprite
      diffuseColor.rgb = lcol * (0.42 + 0.40 * vL.w); gRough = 0.86; gSpec = 0.35;`,
    setup: (m) => { m.side = THREE.DoubleSide; } }) : null;
  let nLeaves = 0;
  const gutMat = mkGutMat(shared, U), swDbg = (game.P && game.P.get('swdbg')) || '';       // ?swdbg=s|g|d: build without the silt fillet / gutter strip / gutter debris (for finding a fault)
  const sd3 = world.sunDir || new THREE.Vector3(0.1, 0.74, 0.66), sun = [sd3.x, -sd3.z, sd3.y];          // toward the sun: (east, north, up)
  const tacMat = mkMat(shared, U, { name: 'tac', vsDecl: 'attribute vec4 aT; attribute vec4 aTe; attribute vec2 aTuv; varying vec4 vT; varying vec4 vTe; varying vec2 vTuv;', vsMain: 'vT = aT; vTe = aTe; vTuv = aTuv;', fsDecl: 'varying vec4 vT; varying vec4 vTe; varying vec2 vTuv;', fsMain: FS_TAC,
    setup: (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -6; } });
  const ta = { position: [], normal: [], aT: [], aTe: [], aTuv: [] }; let nPads = 0;
  let tris = 0, nSeg = 0, nSlabs = 0; const heroRings = [];
  const slabMat = mkMat(shared, U, { name: 'slab', vsDecl: 'attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec3 vNw;', vsMain: 'vA = aA; vB = aB; vC = aC; vD = aD; vNw = normal; transformed.y += aA.z * 0.0085 * smoothstep(1.6, 3.2, distance(cameraPosition, position));       /* (r39) beyond a few metres the 7 mm groove is lifted flat: under the depth-AO pass it drew as a stair-stepped black dash; the drawn line takes over there anyway */',
    fsDecl: '#define SLAB\n varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec3 vNw; const float vR = 0.0;', fsMain: FS_WALK });
  // where ground.js's field says pedestrian plaza (its green channel): 1 a plaza polygon, 2 the shared plaza beyond 6.3 m from the wall
  let plazaAt = () => 0;
  if (tField && gp.field.rts && world.renderer) {
    try {
      const rt = gp.field.rts[0], Nf = rt.width, toI = (x) => Math.floor((x / fx + 1) / 2 * Nf), toJ = (y) => Math.floor((y / fy + 1) / 2 * Nf);
      const i0 = Math.max(0, toI(hx0 - 20)), j0 = Math.max(0, toJ(hy0 - 20)), w = Math.min(Nf, toI(hx1 + 20) + 1) - i0, hgt = Math.min(Nf, toJ(hy1 + 20) + 1) - j0, buf = new Uint8Array(w * hgt * 4);
      world.renderer.readRenderTargetPixels(rt, i0, j0, w, hgt, buf);
      plazaAt = (x, y) => { const i = toI(x) - i0, j = toJ(y) - j0; if (i < 0 || j < 0 || i >= w || j >= hgt) return 0; const q = (j * w + i) * 4, gch = buf[q + 1] / 255, dk = buf[q] / 255 * 12; if (gch <= 0.17) return dk >= 2.2 ? 1 : 0; return gch <= 0.5 && dk >= 0.8 ? 2 : 0; };
    } catch (e) { console.log('[sidewalks] plaza field not read: ' + (e && e.message)); }
  }
  // the Flatiron block's Broadway kerb where the plaza lies on the old roadway (plaza.js 'bway-strip'): no kerb there, a coated fall instead
  const FLUSH = [[-230.7, -448.4], [-226.5, -430.8], [-225.2, -428.0], [-218.4, -418.9], [-217.9, -417.8], [-215.4, -407.5], [-214.5, -407.2], [-214.1, -406.3], [-212.8, -399.7], [-213.2, -398.5], [-209.4, -382.3]];
  const onFlush = (x, y) => { for (let i = 1; i < FLUSH.length; i++) if (segDist(x, y, FLUSH[i - 1][0], FLUSH[i - 1][1], FLUSH[i][0], FLUSH[i][1]) < 0.7) return true; return false; };
  const sk = { position: [], normal: [] };
  const tPlz = null;       // (Nov 10 12:50 rule) plaza_photo_c.jpg is cut from a judging photograph: not read here any more; the fall is coloured from numbers
  const BWAY = Math.atan2(0.974, 0.228);        // the Broadway kerb of the Flatiron block runs this way
  for (const [bi, rs] of heroBlocks) {
    // kerb lines of this block that set a frame: the long ones (corner chamfers follow their neighbours)
    let segs = []; for (const r of rs) for (const sg of r.segs) if (sg.L >= 5) segs.push(sg);
    segs.sort((p, q) => q.L - p.L); segs = segs.slice(0, NS);
    const A = [], B = [], Cc = [];
    for (const sg of segs) {
      const wd = sg.ring.hole ? 0 : wallDist(sg), ang = Math.atan2(sg.dy, sg.dx);
      let da = Math.abs(ang - BWAY) % Math.PI; da = Math.min(da, Math.PI - da);
      const flat = Math.hypot((sg.a[0] + sg.b[0]) / 2 + 228, (sg.a[1] + sg.b[1]) / 2 + 415) < 45 && da < 0.25;      // the Flatiron block's Broadway side
      sg.style = 0; sg.wallD = wd;       // (lane lead, Nov 10) the Broadway side by the Flatiron is the plain 5 ft grid like everywhere else: its 10 ft tinted panels had been laid out from a judging photograph
      A.push(new THREE.Vector4(sg.a[0], sg.a[1], sg.dx, sg.dy)); B.push(new THREE.Vector4(sg.L, sg.run, fract(sg.ring.seed * 7.3 + bi * 0.137), sg.style));
      sg.stripW = wd > 2.6 ? 0.45 + 0.6 * rnd(bi, sg.i, 4) : 0; sg.scz = 0.22; sg.pr = (flat ? 3 : sg.ave ? 2 : 1) + Math.min(0.9, sg.L / 400); sg.band = wd > 0 ? wd + 0.05 : 4.5; sg.seedF = fract(sg.ring.seed * 7.3 + bi * 0.137);
      Cc.push(new THREE.Vector4(wd, sg.stripW, sg.scz, sg.pr));
    }
    while (A.length < NS) { A.push(new THREE.Vector4(1e6, 1e6, 1, 0)); B.push(new THREE.Vector4(0, 0, 0, 0)); Cc.push(new THREE.Vector4()); }
    nSeg += segs.length;
    const mat = mkMat(shared, Object.assign({ uSeg: { value: A }, uSegB: { value: B }, uSegC: { value: Cc }, uNSeg: { value: segs.length } }, U),
      { name: 'walk' + (tField ? 'F' : ''), vsDecl: 'attribute float aR; varying float vR;', vsMain: 'vR = aR;', fsDecl: walkDecl, fsMain: FS_WALK });
    let sgeo = null; try { sgeo = buildSlabs(rs, segs, plazaAt); } catch (e) { console.log('[sidewalks] no slabs for block ' + bi + ': ' + (e && e.message)); }
    const g = buildWalk(rs, sgeo ? CURB - 0.034 : CURB); if (!g) continue;
    if (sgeo) { const sm = new THREE.Mesh(sgeo, slabMat); sm.receiveShadow = true; sm.matrixAutoUpdate = false; sm.updateMatrix(); sm.renderOrder = -1; sm.name = 'hero_slabs_' + bi; group.add(sm); tris += sgeo.index.count / 3; nSlabs += sgeo.userData.slabs; }
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.name = 'hero_walk_' + bi; group.add(mesh); tris += g.attributes.position.count / 3;
    for (const r of rs) for (const sg of r.segs) for (const nt of sg.notches) {
      const t0 = nt.t - RAMP_HW + 0.06, t1 = nt.t + RAMP_HW - 0.06, d0 = 0.20, d1 = 0.81, H = (d) => RAMP_LOW + (CURB - RAMP_LOW) * d / RAMP_DEP + 0.006;
      const P = (t, d) => P3(sg.a[0] + sg.dx * t + sg.nx * d, sg.a[1] + sg.dy * t + sg.ny * d, H(d)), kd = Math.floor(rnd(sg.a[0], nt.t, 5) * 2.999), sd = rnd(sg.a[1], nt.t, 6);
      const q = [[t0, d0], [t1, d0], [t1, d1], [t0, d1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const [t, d] = q[k]; ta.position.push(...P(t, d)); ta.normal.push(0, 1, 0); ta.aT.push(sg.dx, sg.dy, kd, sd); ta.aTe.push(t0, d0, t1, d1); ta.aTuv.push(t, d); }
      nPads++;
    }
    const ka = { position: [], normal: [], aK: [], aK2: [] }, ga = { position: [], normal: [], aG: [] }; if (tLeaf) ka.leaf = { position: [], normal: [], aL: [] };
    for (const r of rs) { for (const sg of r.segs) sg.hero = HERO.some((hq) => Math.hypot((sg.a[0] + sg.b[0]) / 2 - hq[0], (sg.a[1] + sg.b[1]) / 2 - hq[1]) < 140); for (const sg of r.segs) { sg.kind = r.hole ? 1 : 0; /* the hero streets have New York's steel-faced concrete kerb (refs/low_kerb_sun_walk.jpg, low_kerb_ramp_road.jpg); granite stays round the park beds */ sg.flush = !r.hole && !sg.notches.length && onFlush((sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2) && onFlush(sg.a[0], sg.a[1]) && onFlush(sg.b[0], sg.b[1]); } buildKerb(r, ka, ga, sun, sk, swDbg); heroRings.push(r); }
    const kg = mkGeo(ka, { position: 3, normal: 3, aK: 4, aK2: 4 }), km = new THREE.Mesh(kg, kerbMat); km.receiveShadow = true; km.matrixAutoUpdate = false; km.updateMatrix(); km.name = 'hero_kerb_' + bi; group.add(km); tris += kg.attributes.position.count / 3;
    if (ka.leaf && ka.leaf.position.length) { const lg = mkGeo(ka.leaf, { position: 3, normal: 3, aL: 4 }), lm = new THREE.Mesh(lg, leafMat); lm.receiveShadow = true; lm.matrixAutoUpdate = false; lm.updateMatrix(); lm.name = 'hero_leaves_' + bi; group.add(lm); tris += lg.attributes.position.count / 3; nLeaves += lg.attributes.position.count / 12; }
    const gg = mkGeo(ga, { position: 3, normal: 3, aG: 4 }), gm = new THREE.Mesh(gg, gutMat); gm.visible = !swDbg.includes('g'); gm.matrixAutoUpdate = false; gm.updateMatrix(); gm.renderOrder = 4; gm.name = 'hero_gutter_' + bi; group.add(gm); tris += gg.attributes.position.count / 3;
  }

  if (sk.position.length) {
    const FS_SKIRT = tPlz ? `
      vec4 nzA = texture2D(tNoise, m / 37.0), nzB = texture2D(tNoise, m / 6.1 + 0.31);
      vec3 ph = mix(texture2D(tPlz, m / 2.1).rgb, texture2D(tPlz, mat2(0.6, 0.8, -0.8, 0.6) * m / 2.37 + 0.41).rgb, smoothstep(0.3, 0.7, nzB.r));
      diffuseColor.rgb = ph * 0.82 * (0.92 + 0.14 * nzA.r) * (0.95 + 0.1 * nzB.g); gRough = 0.82; gSpec = 0.6;` : `
      vec4 nzA = texture2D(tNoise, m / 37.0), nzB = texture2D(tNoise, m / 0.9);
      vec4 nzC2 = texture2D(tNoise, m / 0.21 + 0.3);
      diffuseColor.rgb = vec3(0.235, 0.212, 0.180) * (0.92 + 0.14 * nzA.r) * (0.78 + 0.30 * nzB.g + 0.28 * nzC2.a); gRough = 0.82; gSpec = 0.6;`;
    const skMat = mkMat(shared, Object.assign({ tPlz: { value: tPlz || tNoise } }, U), { name: 'skirt' + (tPlz ? 'P' : ''), fsDecl: 'uniform sampler2D tPlz;', fsMain: FS_SKIRT, setup: (m) => { m.side = THREE.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = -7; m.polygonOffsetUnits = -14; } });
    const sgq = mkGeo(sk, { position: 3, normal: 3 }), smk = new THREE.Mesh(sgq, skMat); smk.receiveShadow = true; smk.matrixAutoUpdate = false; smk.updateMatrix(); smk.name = 'hero_plaza_fall'; group.add(smk); tris += sgq.attributes.position.count / 3;
  }
  if (nPads) { const tg = mkGeo(ta, { position: 3, normal: 3, aT: 4, aTe: 4, aTuv: 2 }), tm = new THREE.Mesh(tg, tacMat); tm.receiveShadow = true; tm.matrixAutoUpdate = false; tm.updateMatrix(); tm.name = 'hero_tactile'; group.add(tm); tris += nPads * 2; }
  // ---- ground.js: out of the hero blocks, and its sidewalk a real concrete grey
  let cut = 0;
  if (gp && gp.group && gp.mats) {
    const mine = new Set([gp.mats.sidewalk, gp.mats.band, gp.mats.kerb]);
    const ext = heroRings.filter((r) => !r.hole), box = ext.map((r) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of r.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0 - 1, y0 - 1, x1 + 1, y1 + 1]; });
    const inHero = (x, y) => { for (let i = 0; i < ext.length; i++) { const b = box[i]; if (x < b[0] || y < b[1] || x > b[2] || y > b[3]) continue; if (pointInRing(ext[i].pts, x, y) || ringDist(ext[i].pts, x, y) < 0.35) return true; } return false; };
    const plates = new Map();
    for (const o of gp.group.children) {
      const isDecal = nPads > 0 && o.material === gp.mats.decal;
      if (!o.isMesh || !(mine.has(o.material) || isDecal)) continue;
      const g = o.geometry, pos = g.attributes.position.array, n = pos.length / 9, keep = [], uvA = isDecal && g.attributes.uv ? g.attributes.uv.array : null;
      if (isDecal && !uvA) continue;
      for (let t = 0; t < n; t++) {
        const k = t * 9;
        if (isDecal) { const u = (uvA[t * 6] + uvA[t * 6 + 2] + uvA[t * 6 + 4]) / 3, v = (uvA[t * 6 + 1] + uvA[t * 6 + 3] + uvA[t * 6 + 5]) / 3, isPad = u > 0.25 && u < 0.5 && v > 0.25 && v < 0.5, isPlate = u > 0.75 && v > 0.25 && v < 0.5;      // its tactile pads (atlas cell 1,2) and its cellar plates (cell 3,2)
          if (!isPad && !isPlate) { keep.push(t); continue; }
          if (isPlate && inHero((pos[k] + pos[k + 3] + pos[k + 6]) / 3, -(pos[k + 2] + pos[k + 5] + pos[k + 8]) / 3)) { const key = Math.round(pos[k] * 200) + ',' + Math.round(pos[k + 2] * 200), q = plates.get(key) || []; q.push([pos[k], pos[k + 2], pos[k + 3], pos[k + 5], pos[k + 6], pos[k + 8]]); plates.set(key, q); } }
        if (!inHero((pos[k] + pos[k + 3] + pos[k + 6]) / 3, -(pos[k + 2] + pos[k + 5] + pos[k + 8]) / 3)) keep.push(t);
      }
      if (keep.length === n) continue; cut += n - keep.length;
      if (!keep.length) { o.visible = false; continue; }
      for (const name in g.attributes) {
        const at = g.attributes[name], sz = at.itemSize * 3, out = new Float32Array(keep.length * sz);
        keep.forEach((t, i) => out.set(at.array.subarray(t * sz, t * sz + sz), i * sz));
        g.setAttribute(name, new THREE.BufferAttribute(out, at.itemSize));
      }
      g.computeBoundingSphere(); g.computeBoundingBox();
    }
    // (r34) cellar doors: ground.js draws each leaf as a flat picture of diamond plate; in the hero blocks each is a real steel leaf in an angle-iron frame
    if (plates.size) {
      const ca = { position: [], normal: [], aQ: [], aR: [] }; let nLeaf = 0;
      const quad = (A, B, C, D, q) => { for (const [P, Q, R] of [[A, B, C], [A, C, D]]) { pushTri(ca, P.p, Q.p, R.p); { const nn = ca.normal, e = nn.length; if (nn[e - 2] < 0) for (let w = e - 9; w < e; w++) nn[w] = -nn[w]; } for (const V of [P, Q, R]) { ca.aQ.push(V.u, V.v, q[0], q[1]); ca.aR.push(q[2], q[3], q[4], q[5]); } } };
      for (const tr of plates.values()) {
        if (tr.length !== 2) continue;
        const c0 = [tr[0][0], tr[0][1]], c1 = [tr[0][2], tr[0][3]], c2 = [tr[0][4], tr[0][5]];       // three corners (x, z) of the leaf
        const ux = c1[0] - c0[0], uz = c1[1] - c0[1], vx = c2[0] - c1[0], vz = c2[1] - c1[1], hl = Math.hypot(ux, uz) / 2, hw = Math.hypot(vx, vz) / 2; if (hl < 0.2 || hw < 0.1) continue;
        const cx = (c0[0] + c2[0]) / 2, cz = (c0[1] + c2[1]) / 2, U = [ux / (2 * hl), uz / (2 * hl)], V = [vx / (2 * hw), vz / (2 * hw)], sdl = rnd(cx, cz, 5), tint = rnd(cx * 0.37, cz * 0.91, 6);
        const pt2 = (a, b, h) => ({ p: [cx + U[0] * a + V[0] * b, h, cz + U[1] * a + V[1] * b], u: a, v: b });
        const ring = (ea, eb, h) => [pt2(-ea, -eb, h), pt2(ea, -eb, h), pt2(ea, eb, h), pt2(-ea, eb, h)];
        const y0 = CURB - 0.002, R0 = ring(hl + 0.034, hw + 0.034, y0), R1 = ring(hl + 0.030, hw + 0.030, y0 + 0.011), R2 = ring(hl + 0.002, hw + 0.002, y0 + 0.011), R3 = ring(hl - 0.002, hw - 0.002, y0 + 0.006), R4 = ring(hl - 0.006, hw - 0.006, y0 + 0.016 + 0.004 * sdl);
        const band = (Ra, Rb, part) => { for (let i = 0; i < 4; i++) { const j2 = (i + 1) % 4; quad(Ra[i], Ra[j2], Rb[j2], Rb[i], [hl, hw, part, sdl, tint, 0]); } };
        band(R0, R1, 1); band(R1, R2, 1); band(R2, R3, 2); band(R3, R4, 2); quad(R4[0], R4[1], R4[2], R4[3], [hl, hw, 0, sdl, tint, 0]); nLeaf++;
      }
      if (nLeaf) {
        const FS_CELLAR = `
          vec2 q = vQ.xy; float part = vR.x, sdl = vR.y;
          vec4 nzc = texture2D(tNoise, q / 0.9 + sdl * 7.0), nzf = texture2D(tNoise, q / 0.13 + sdl * 3.0);
          // diamond tread: lozenges 3 cm long, every other one turned
          vec2 pc = q / 0.034, ci = floor(pc), f = fract(pc) - 0.5; float flip = mod(ci.x + ci.y, 2.0);
          vec2 r2 = flip < 0.5 ? vec2(f.x + f.y, f.x - f.y) : vec2(f.x - f.y, f.x + f.y);
          float lz = clamp(1.0 - (abs(r2.x) / 0.62 + abs(r2.y) / 0.17), 0.0, 1.0), up = smoothstep(0.0, 0.35, lz) * step(part, 0.5);
          vec2 e2 = vQ.zw - abs(q); float edge = min(e2.x, e2.y);
          vec3 base = mix(vec3(0.060, 0.050, 0.043), vec3(0.045, 0.046, 0.049), step(0.5, vR.z)) * (0.7 + 0.6 * nzc.g);
          vec3 rustc = vec3(0.090, 0.045, 0.022) * (0.6 + 0.8 * nzf.g);
          vec3 col = mix(base, rustc, smoothstep(0.45, 0.75, nzc.r * 0.7 + nzf.b * 0.3) * (1.0 - 0.7 * up));
          float worn = up * smoothstep(0.30, 0.62, nzc.b + 0.3 * (nzf.r - 0.5));                 // the tread tops rubbed bright where feet cross
          col = mix(col, vec3(0.17, 0.168, 0.165), 0.75 * worn);
          col = mix(col, vec3(0.030, 0.027, 0.024), (1.0 - up) * 0.45 * step(part, 0.5) * smoothstep(0.3, 0.7, nzc.g));       // dirt lying between the lozenges
          col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.03, edge)) * step(part, 0.5);            // and packed along the edges
          if (part > 1.5) col = vec3(0.012);                                                    // the gap round the leaf
          else if (part > 0.5) col = mix(vec3(0.052, 0.046, 0.042), rustc, smoothstep(0.4, 0.7, nzc.r)) * (0.7 + 0.6 * nzf.g);
          diffuseColor.rgb = col;
          vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);                                             // the tread is 2.5 mm proud: its slopes from the height's own gradient
          vec3 gw3 = dpx * dFdx(up) / max(dot(dpx, dpx), 1e-9) + dpy * dFdy(up) / max(dot(dpy, dpy), 1e-9);
          gNrm = normalize(normalize(vNc) - 0.0025 * gw3 * (1.0 - smoothstep(0.003, 0.008, px))); gNrm.y = max(gNrm.y, 0.05);
          gRough = mix(0.72, 0.40, worn); gMetal = mix(0.55, 0.85, worn); gSpec = 0.9;
          if (part > 1.5) { gRough = 1.0; gMetal = 0.0; gSpec = 0.0; }`;
        const cMat = mkMat(shared, U, { name: 'cellar', vsDecl: 'attribute vec4 aQ; attribute vec4 aR; varying vec4 vQ; varying vec4 vR; varying vec3 vNc; varying vec2 vU;', vsMain: 'vQ = aQ; vR = aR; vNc = normal; vU = vec2(0.0);', fsDecl: 'varying vec4 vQ; varying vec4 vR; varying vec3 vNc; varying vec2 vU;', fsMain: FS_CELLAR,
          setup: (m) => { m.side = THREE.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -6; } });
        const cg = mkGeo(ca, { position: 3, normal: 3, aQ: 4, aR: 4 }), cm = new THREE.Mesh(cg, cMat); cm.receiveShadow = true; cm.matrixAutoUpdate = false; cm.updateMatrix(); cm.name = 'hero_cellar_doors'; group.add(cm); tris += cg.attributes.position.count / 3;
        console.log('[sidewalks] ' + nLeaf + ' cellar door leaves as geometry');
      }
    }
    for (const m of [gp.mats.sidewalk, gp.mats.band]) {
      if (!m || m.userData.swTone) continue; m.userData.swTone = true;
      const prev = m.onBeforeCompile, key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
      m.onBeforeCompile = (sh, r) => { prev && prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vec3(0.585, 0.60, 0.645) * ' + SWC.toFixed(3) + ';'); };
      m.customProgramCacheKey = () => key + '-swtone1' + SWC; m.needsUpdate = true;
    }
  }
  world.scene.add(group);
  return { group, heroRings, report: { ktris: Math.round(tris / 1000), slabs: nSlabs, blocks: heroBlocks.size, frames: nSeg, cutFromGround: cut, field: !!tField, corners: nArcs, leaves: nLeaves } };
}
