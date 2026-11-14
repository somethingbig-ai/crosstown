// shape.js: the airframe of the helicopter as geometry: fuselage pod and tail boom (one lofted skin with true compound curvature),
// engine cowling, glass, doors, fin, stabiliser, landing gear, and all the small things bolted on. Pure maths (meshkit), no three.js.
// An original design in the AS350 / H125 class, built to dims.js. Model space: +X nose, +Y up, +Z right, metres.
import { Soup, S, LN, SL, mat, curve, loft, tube, rod, lathe, box, split, sideOf, cutClass, extract, rims, zeroPaths, alongPath, roundAll, rrect, smoothPath, rotX, rotY, rotZ, mul3, alignY, I3 } from './meshkit.js';

// ---------------------------------------------------------------- surfaces
export const M = {
  paint: mat(0xffffff, 0.5, 0, 1, 1),            // the livery picture, lacquered
  paintFlat: mat(0xa6a6a2, 0.5, 0, 1, 0),        // the game's exposure clips anything lighter in sun; the white is this grey so that glints and mirror images can sit above it
  gear: mat(0x5c6064, 0.4, 0, 0.8, 0),            // mid grey gloss on the landing gear (light grey read as lit from inside in sun)
         // the same white with no picture (top and bottom faces the side picture cannot reach)
  navy: mat(0x13254a, 0.5, 0, 1, 0),
  liner: mat(0xa9acae, 0.92, 0, 0, 0),           // cabin trim
  linerDark: mat(0x2b2d30, 0.9, 0, 0, 0),
  rubber: mat(0x0b0b0c, 0.75, 0, 0, 0), seal: mat(0x1d1e20, 0.7, 0, 0, 0),
  black: mat(0x0d0e10, 0.42, 0, 0.6, 0),         // black gloss paint (skids, cross tubes)
  blackMatte: mat(0x101113, 0.85, 0, 0, 0),
  steel: mat(0xa3a5a8, 0.32, 1, 0, 0),
  steelDark: mat(0x4b4d50, 0.45, 1, 0, 0),
  hot: mat(0x4c4743, 0.5, 1, 0, 0),             // heat-stained exhaust
  soot: mat(0x050505, 0.95, 0, 0, 0),
  alu: mat(0xc3c5c7, 0.4, 1, 0, 0),
  grey: mat(0x6f7377, 0.55, 0, 0.4, 0),
  grille: mat(0x15171a, 0.7, 0.6, 0, 0),
  lensRed: mat(0x6a0d0d, 0.15, 0, 1, 0), lensGreen: mat(0x0a4a22, 0.15, 0, 1, 0), lensClear: mat(0xcfd3d6, 0.1, 0, 1, 0),
  yellow: mat(0xe2b012, 0.5, 0, 0.6, 0),
};
export const GLASS = 1, DOOR = 2, GRILLE = 4;
const NOSE = 3.35, TAIL = -7.47;

// ---------------------------------------------------------------- the pod and boom: stations from the nose back
// x, top, bottom, half width, height of the widest point, squareness above, squareness below
const ST = [
  [3.35, 1.02, 1.02, 0, 1.02, 2.2, 2.2],
  [3.30, 1.135, 0.905, 0.175, 1.02, 2.2, 2.2],
  [3.15, 1.265, 0.80, 0.34, 1.02, 2.25, 2.2],
  [2.90, 1.44, 0.70, 0.50, 1.03, 2.3, 2.2],
  [2.60, 1.64, 0.625, 0.65, 1.05, 2.5, 2.3],
  [2.30, 1.84, 0.58, 0.77, 1.08, 2.8, 2.5],
  [2.00, 2.01, 0.555, 0.86, 1.11, 3.2, 2.8],
  [1.70, 2.115, 0.545, 0.915, 1.14, 3.6, 3.0],
  [1.40, 2.155, 0.54, 0.94, 1.15, 3.9, 3.1],
  [1.00, 2.165, 0.54, 0.945, 1.15, 4.0, 3.2],
  [0.00, 2.165, 0.54, 0.945, 1.15, 4.0, 3.2],
  [-0.60, 2.16, 0.55, 0.935, 1.16, 3.8, 3.1],
  [-1.20, 2.14, 0.62, 0.87, 1.25, 3.3, 2.8],
  [-1.80, 2.12, 0.90, 0.71, 1.45, 2.8, 2.5],
  [-2.40, 2.11, 1.30, 0.48, 1.68, 2.4, 2.2],
  [-3.00, 2.115, 1.615, 0.25, 1.865, 2, 2],
  [-7.30, 2.085, 1.855, 0.115, 1.97, 2, 2],
  [-7.41, 2.045, 1.895, 0.075, 1.97, 2, 2],
  [-7.47, 1.97, 1.97, 0, 1.97, 2, 2],
];
const tOf = (x) => Math.sqrt(Math.max(0, NOSE - x));           // the nose is round: its tables run on the root of the distance from the tip
const col = (k) => curve(ST.map((r) => [tOf(r[0]), r[k]]));
const fTop = col(1), fBot = col(2), fW = col(3), fMid = col(4), fNu = col(5), fNl = col(6);
export const podSect = (x) => { const t = tOf(Math.max(TAIL, x)); return { yt: fTop(t), yb: fBot(t), w: fW(t), ym: fMid(t), nu: fNu(t), nl: fNl(t) }; };
// a point of a section: a = 0 top, pi/2 right (+z), pi bottom
function sect(x, a, q, out) {
  if (q.w < 1e-7) { out[0] = x; out[1] = q.ym; out[2] = 0; return out; }
  const c = Math.cos(a), s = Math.sin(a), up = c >= 0, h = up ? q.yt - q.ym : q.ym - q.yb, n = up ? q.nu : q.nl;
  const r = 1 / Math.pow(Math.pow(Math.abs(s) / q.w, n) + Math.pow(Math.abs(c) / Math.max(h, 1e-7), n), 1 / n);
  out[0] = x; out[1] = q.ym + c * r; out[2] = s * r; return out;
}
export const podPoint = (x, a, out) => sect(Math.min(NOSE, Math.max(TAIL, x)), a, podSect(x), out);
// the skin at (x, y) on one side (sg +1 right, -1 left): { p, n }
export function podAt(x, y, sg = 1) {
  let lo = 0, hi = Math.PI; const p = [0, 0, 0];
  for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; podPoint(x, m, p); if (p[1] > y) lo = m; else hi = m; }
  const a = (lo + hi) / 2, e = 1e-3, A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  podPoint(x, a, p); podPoint(x + e, a, A); podPoint(x - e, a, B); podPoint(x, a + e, C); podPoint(x, a - e, D);
  const ux = A[0] - B[0], uy = A[1] - B[1], uz = A[2] - B[2], vx = C[0] - D[0], vy = C[1] - D[1], vz = C[2] - D[2];
  let n = [-(uy * vz - uz * vy), -(uz * vx - ux * vz), -(ux * vy - uy * vx)]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  return { p: [p[0], p[1], p[2] * sg], n: [n[0], n[1], n[2] * sg] };
}

// ---------------------------------------------------------------- the cowling (mast fairing and engine doghouse on the roof)
const CW = [   // x, top, half width
  [0.72, 2.165, 0.16], [0.55, 2.30, 0.27], [0.30, 2.50, 0.345], [0.10, 2.62, 0.38], [-0.20, 2.665, 0.41], [-0.60, 2.63, 0.45], [-1.20, 2.61, 0.47],
  [-1.90, 2.58, 0.45], [-2.35, 2.52, 0.38], [-2.70, 2.42, 0.27], [-2.86, 2.34, 0.2],
];
const cTop = curve(CW.map((r) => [-r[0], r[1]])), cW = curve(CW.map((r) => [-r[0], r[2]]));
const cowlPoint = (x, a, out) => sect(x, a, { yt: cTop(-x), yb: 1.80, w: cW(-x), ym: 2.14, nu: 2.7, nl: 2.0 }, out);

// ---------------------------------------------------------------- where the cuts go (all distances positive inside)
const doorFront = (y) => 1.85 - 0.22 * (y - 1.36);       // the front doors' leading edge leans back with the windscreen post
const W = {
  windscreen: (x, y, z) => roundAll([Math.abs(z) - 0.034, y - (1.145 + 0.07 * (3.2 - x)), 3.19 - x, x - (doorFront(y) + 0.062)], 0.075),
  chin: (x, y, z) => roundAll([Math.abs(z) - 0.06, 0.935 - y, 3.10 - x, x - 2.2, 1.16 - Math.abs(z) + (y - 0.6) * 1.2], 0.08),
  doorWin: (x, y, z) => (Math.abs(z) < 0.3 ? -1 : roundAll([doorFront(y) - 0.075 - x, x - 0.335, y - 1.19, 1.925 - y], 0.095)),
  rearWin: (x, y, z) => (Math.abs(z) < 0.3 ? -1 : rrect(x, y, -0.43, 0.105, 1.19, 1.925, 0.095)),
  roofWin: (x, y, z) => (y < 1.7 ? -1 : rrect(x, Math.abs(z), 0.82, 1.56, 0.10, 0.60, 0.07)),
};
const L = {
  doorR: (x, y, z) => (z < 0.3 ? -1 : roundAll([doorFront(y) - x, x - 0.25, y - 0.74, 1.98 - y], 0.06)),
  doorL: (x, y, z) => (z > -0.3 ? -1 : roundAll([doorFront(y) - x, x - 0.25, y - 0.74, 1.98 - y], 0.06)),
  rearDoor: (x, y, z) => (Math.abs(z) < 0.3 ? -1 : rrect(x, y, -0.52, 0.19, 0.74, 1.98, 0.06)),
  hatch: (x, y, z) => (Math.abs(z) < 0.2 ? -1 : rrect(x, y, -1.74, -0.80, 0.99, 1.60, 0.07)),
  panelAft: (x, y, z) => (Math.abs(z) < 0.15 ? -1 : rrect(x, y, -2.55, -1.98, 1.50, 1.93, 0.045)),
  filler: (x, y, z) => (z > -0.3 ? -1 : 0.058 - Math.hypot(x + 1.08, y - 1.80)),
  nosePanel: (x, y, z) => (z < 0.1 || y < 0.9 ? -1 : rrect(x, y, 2.50, 2.92, 0.965, 1.115, 0.03)),
  boat: (x, y, z) => 0.705 - y,
  ring0: (x) => x + 3.0, ring1: (x) => x + 4.42, ring2: (x) => x + 5.84, ring3: (x) => x + 6.62, ring4: (x) => x + 3.72, ring5: (x) => x + 5.13,
  frame: (x) => x + 0.61, noseRing: (x) => 3.04 - x, roofSeam: (x, y, z) => (y < 1.9 ? -1 : rrect(x, Math.abs(z), -0.5, 0.74, -1, 0.7, 0.05)),
  bellyPanel: (x, y, z) => (y > 0.8 ? -1 : rrect(x, Math.abs(z), -1.15, 1.95, -1, 0.36, 0.05)),
};
const inGlass = (x, y, z, pad = 0.03) => { for (const k in W) if (W[k](x, y, z) > -pad) return true; return false; };

// little bodies -------------------------------------------------------------
function ball(s, c, r, m, seg = 10, half = false) { const prof = [], n = half ? 4 : 8; for (let i = 0; i <= n; i++) { const a = (half ? 0 : -Math.PI / 2) + (i / n) * (half ? Math.PI / 2 : Math.PI); prof.push([Math.cos(a) * r, Math.sin(a) * r]); } const b = lathe(s, prof, seg, m); s.place(b, I3, c); return b; }
// rivets: a low dome on the skin at p with normal n
export function rivet(s, p, n, r, m, h = 0.25) {
  const R = alignY(n), k = s.nv, seg = 6;
  s.add(p[0] + n[0] * r * h, p[1] + n[1] * r * h, p[2] + n[2] * r * h, n[0], n[1], n[2], m);
  for (let j = 0; j < seg; j++) { const a = j / seg * Math.PI * 2, x = Math.cos(a), z = Math.sin(a), dx = R[0] * x + R[2] * z, dy = R[3] * x + R[5] * z, dz = R[6] * x + R[8] * z, t = 0.75; const nx = n[0] + dx * t, ny = n[1] + dy * t, nz = n[2] + dz * t, l = Math.hypot(nx, ny, nz); s.add(p[0] + dx * r, p[1] + dy * r, p[2] + dz * r, nx / l, ny / l, nz / l, m); }
  for (let j = 0; j < seg; j++) s.tri(k, k + 1 + (j + 1) % seg, k + 1 + j);
  // which way round faces out is settled by the normal
  const v = s.v, a = (k + 1) * S, b = (k + 2) * S, cx = (v[a + 1] - p[1]) * (v[b + 2] - p[2]) - (v[a + 2] - p[2]) * (v[b + 1] - p[1]), cy = (v[a + 2] - p[2]) * (v[b] - p[0]) - (v[a] - p[0]) * (v[b + 2] - p[2]), cz = (v[a] - p[0]) * (v[b + 1] - p[1]) - (v[a + 1] - p[1]) * (v[b] - p[0]);
  if (cx * n[0] + cy * n[1] + cz * n[2] > 0) for (let t = s.i.length - seg * 3; t < s.i.length; t += 3) { const q = s.i[t + 1]; s.i[t + 1] = s.i[t + 2]; s.i[t + 2] = q; }
}
// an aerofoil's half thickness at chord fraction xc (NACA four-digit, closed trailing edge), for thickness ratio t
export const naca = (xc, t) => 5 * t * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);

// ---------------------------------------------------------------- the whole airframe
// q: 0 full detail, 1 middle distance, 2 far
export function buildAirframe(DIMS, q = 0) {
  const body = new Soup(), door = new Soup(), glass = new Soup(), doorGlass = new Soup(), rivets = new Soup(), lamps = new Soup(), decals = [];
  const trim = new Soup(), doorTrim = new Soup();      // what exists only to be seen from inside the cabin (the cockpit hides these while the camera is inside)
  const P = [0, 0, 0];

  // ---- pod and boom skin
  const xs = [], nNose = [36, 22, 10][q], dx = [0.045, 0.09, 0.25][q], nAround = [96, 56, 24][q];
  for (let i = 0; i <= nNose; i++) { const t = (i / nNose) * Math.sqrt(1.35); xs.push(NOSE - t * t); }
  for (let x = 2.0 - dx; x > -3.0 + 1e-6; x -= dx) xs.push(x);
  for (let x = -3.0; x > -7.3; x -= [0.142, 0.43, 1.07][q]) xs.push(x);
  xs.push(-7.30, -7.36, -7.41, -7.45, TAIL);
  const as = []; for (let j = 0; j < nAround; j++) as.push(j / nAround * Math.PI * 2);
  const pod = new Soup();
  loft(pod, (u, v, o) => podPoint(u, v, o), xs, as, M.paint, { wrap: true, away: (u) => [u, podSect(u).ym, 0], pole: (u) => [u > 0 ? 1 : -1, 0, 0] });

  const rivetLines = [];        // [soup, distances, pitch, offset, radius]
  if (q < 2) {
    for (const k of ['windscreen', 'chin', 'doorWin', 'rearWin', 'roofWin']) cutClass(pod, W[k], (c) => c | GLASS, SL);
    const dR = cutClass(pod, L.doorR, (c) => c | DOOR, LN);
    for (const k of ['doorL', 'rearDoor', 'hatch', 'panelAft', 'filler', 'nosePanel']) { const d = split(pod, L[k], LN); if (q === 0 && (k === 'hatch' || k === 'panelAft' || k === 'nosePanel')) rivetLines.push([pod, d, k === 'hatch' ? 0.045 : 0.032, k === 'hatch' ? -0.02 : -0.012, 0.0032, 1]); }
    for (const k of ['boat', 'ring0', 'ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'frame', 'noseRing', 'roofSeam', 'bellyPanel']) { const d = split(pod, L[k], LN); if (q === 0) rivetLines.push([pod, d, k === 'boat' ? 0.04 : 0.026, 0.014, 0.003, 2]); }
  } else {
    // far away the glass is only a dark patch
    for (const k of ['windscreen', 'chin', 'doorWin', 'rearWin']) cutClass(pod, W[k], (c) => c | GLASS, -1);
  }
  const isPaint = (c) => c === 0, isGlass = (c) => c === GLASS, isDoorPaint = (c) => c === DOOR, isDoorGlass = (c) => c === (DOOR | GLASS), isDoor = (c) => (c & DOOR) !== 0, notDoor = (c) => (c & DOOR) === 0;
  body.append(extract(pod, isPaint)); door.append(extract(pod, isDoorPaint));
  const sink = (g, d) => { for (let k = 0; k < g.v.length; k += S) { g.v[k] -= g.v[k + 3] * d; g.v[k + 1] -= g.v[k + 4] * d; g.v[k + 2] -= g.v[k + 5] * d; } return g; };
  glass.append(sink(extract(pod, isGlass), 0.006)); doorGlass.append(sink(extract(pod, isDoorGlass), 0.006));
  if (q < 2) {
    const TH = 0.03;
    // window reveals: a narrow seal at the skin, then the frame's depth in the trim colour (that inner part belongs to the inside)
    rims(pod, isGlass, isPaint, 0.009, M.seal, body, { double: false }); rims(pod, isDoorGlass, isDoorPaint, 0.009, M.seal, door, { double: false });      // one-sided: from inside this seal is not there to draw a dark line
    if (q === 0) { rims(pod, isGlass, isPaint, TH, M.liner, trim, { from: 0.009 }); rims(pod, isDoorGlass, isDoorPaint, TH, M.liner, doorTrim, { from: 0.009 }); }
    rims(pod, isDoor, notDoor, TH, M.linerDark, door); rims(pod, notDoor, isDoor, TH, M.linerDark, body);
    // the inner side of the cabin shell (trim), from the nose back to the rear bulkhead
    const inner = (src, dst, pred) => {
      const map = new Map(), v = src.v;
      for (let t = 0; t < src.nt; t++) {
        if (!pred(src.tc[t])) continue; const a = src.i[t * 3], b = src.i[t * 3 + 1], c = src.i[t * 3 + 2];
        if ((v[a * S] + v[b * S] + v[c * S]) / 3 < -0.62) continue;
        const idx = [a, c, b].map((e) => { let k = map.get(e); if (k === undefined) { const o = e * S, dark = v[o] > 2.25 || v[o + 1] < 0.74; k = dst.add(v[o] - v[o + 3] * TH, v[o + 1] - v[o + 4] * TH, v[o + 2] - v[o + 5] * TH, -v[o + 3], -v[o + 4], -v[o + 5], dark ? M.linerDark : M.liner); map.set(e, k); } return k; });
        dst.tri(idx[0], idx[1], idx[2]);
      }
    };
    if (q === 0) { inner(pod, trim, isPaint); inner(pod, doorTrim, isDoorPaint); }
    // rear bulkhead of the cabin
    if (q === 0) { const x = -0.62, c = trim.add(x, 1.3, 0, 1, 0, 0, M.liner), k0 = trim.nv, n = 40; for (let j = 0; j < n; j++) { podPoint(x, j / n * Math.PI * 2, P); trim.add(x, P[1], P[2], 1, 0, 0, M.liner); } for (let j = 0; j < n; j++) trim.triN(c, k0 + j, k0 + (j + 1) % n); }
  }

  // ---- cowling
  const cowl = new Soup(), cxs = []; for (let x = 0.72; x > -2.86; x -= [0.045, 0.12, 0.4][q]) cxs.push(x); cxs.push(-2.86);
  const cas = []; { const n = [56, 28, 12][q]; for (let j = 0; j <= n; j++) cas.push(-1.75 + (j / n) * 3.5); }
  loft(cowl, (u, v, o) => cowlPoint(Math.min(0.72, Math.max(-2.86, u)), v, o), cxs, cas, M.paint, { away: (u) => [u, 2.14, 0] });
  { // closed at the back, round the exhaust
    const k0 = cowl.nv, n = cas.length; const c = cowl.add(-2.86, 2.16, 0, -1, 0, 0, M.paint); for (let j = 0; j < n; j++) { cowlPoint(-2.86, cas[j], P); cowl.add(P[0], P[1], P[2], -1, 0, 0, M.paint); } for (let j = 0; j < n - 1; j++) cowl.triN(c, k0 + 1 + j, k0 + 2 + j); }
  if (q < 2) {
    const grille = (x, y, z) => (y < 2.3 ? -1 : rrect(x, Math.abs(z), -1.02, -0.50, -1, 0.27, 0.05));
    const sideVent = (x, y, z) => { let d = -1; for (let i = 0; i < 5; i++) d = Math.max(d, rrect(x, y, -1.78 + i * 0.085, -1.735 + i * 0.085, 2.25, 2.43, 0.018)); return Math.abs(z) < 0.1 ? -1 : d; };
    const oil = (x, y, z) => (Math.abs(z) < 0.1 ? -1 : rrect(x, y, -2.42, -2.12, 2.2, 2.36, 0.03));
    cutClass(cowl, grille, (c) => c | GRILLE, LN); cutClass(cowl, sideVent, (c) => c | GRILLE, LN); cutClass(cowl, oil, (c) => c | GRILLE, LN);
    const cl = { a: (x) => x + 0.34, b: (x) => x + 1.12, c: (x) => x + 2.0, d: (x, y) => y - 2.2, f: (x) => x - 0.22, g: (x) => x + 2.5, e: (x, y, z) => z };
    for (const k in cl) { const d = split(cowl, cl[k], LN); if (q === 0 && k !== 'e') rivetLines.push([cowl, d, 0.085, 0.016, 0.0052, 2, 1]); }
    const g = extract(cowl, (c) => c === GRILLE); g.setMat(0, M.grille); for (let k = 0; k < g.v.length; k += S) { g.v[k] -= g.v[k + 3] * 0.012; g.v[k + 1] -= g.v[k + 4] * 0.012; g.v[k + 2] -= g.v[k + 5] * 0.012; g.v[k + LN] = 1; }
    body.append(g); rims(cowl, (c) => c === GRILLE, (c) => c === 0, 0.012, M.blackMatte, body, { double: false });
    body.append(extract(cowl, (c) => c === 0));
  } else body.append(cowl);

  // ---- rivet rows along the panel lines
  if (q === 0) for (const [src, d, pitch, off, r, sides, big] of rivetLines) for (const path of zeroPaths(src, d)) alongPath(src, path, pitch, (p, n, t) => {
    const bx = n[1] * t[2] - n[2] * t[1], by = n[2] * t[0] - n[0] * t[2], bz = n[0] * t[1] - n[1] * t[0];
    for (const sg of sides === 2 ? [1, -1] : [1]) { const c = [p[0] + bx * off * sg, p[1] + by * off * sg, p[2] + bz * off * sg]; if (src === pod && (inGlass(c[0], c[1], c[2]) || L.doorR(c[0], c[1], c[2]) > -0.03)) continue; if (src === cowl && c[1] < podSect(c[0]).yt + 0.01) continue; rivet(rivets, c, n, r, big ? M.steel : M.paint, big ? 0.12 : 0.25); }
  });
  // rows along the boom's stringers and the frames between the rings
  if (q === 0) {
    const row = (x0, x1, a, pitch) => { for (let x = x0; x > x1; x -= pitch) { const A = [0, 0, 0], e = 1e-3, B = [0, 0, 0], C = [0, 0, 0]; podPoint(x, a, A); podPoint(x - e, a, B); podPoint(x, a + e, C); const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]; let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; const l = Math.hypot(...n); n = n.map((c) => c / l); const q0 = podSect(x); if ((A[1] - q0.ym) * n[1] + A[2] * n[2] < 0) n = n.map((c) => -c); rivet(rivets, A, n, 0.0028, M.paint); } };
    for (let k = 0; k < 10; k++) { const a = (k + 0.5) / 10 * Math.PI * 2; if (Math.abs(a) < 0.5 || Math.abs(a - Math.PI * 2) < 0.5) continue; row(-3.06, -7.2, a, 0.03); }
    for (const x of [-3.38, -3.74, -4.08, -4.76, -5.1, -5.48, -6.2]) for (let j = 0; j < 44; j++) { const a = j / 44 * Math.PI * 2; if (Math.abs(a) < 0.3 || a > Math.PI * 2 - 0.3) continue; const A = [0, 0, 0]; podPoint(x, a, A); const sq = podSect(x); let n = [0.03, A[1] - sq.ym, A[2]]; const l = Math.hypot(...n); rivet(rivets, A, n.map((c) => c / l), 0.0028, M.paint); }
  }

  // ---- drive shaft cover along the top of the boom, and the tail rotor gearbox
  {
    const pts = []; for (let x = -2.78; x >= -6.42; x -= 0.26) pts.push([x, podSect(x).yt + 0.012, 0]);
    tube(body, pts, (i) => (i === 0 || i === pts.length - 1 ? 0.03 : 0.052), q ? 6 : 12, M.paint, { caps: 1 });
    if (q === 0) for (const x of [-3.3, -3.82, -4.34, -4.86, -5.38, -5.9]) for (const sg of [-1, 1]) { const y = podSect(x).yt; box(body, 0.05, 0.012, 0.02, M.paint); body.place(body.nv - 24, I3, [x, y + 0.012, sg * 0.058]); rivet(rivets, [x, y + 0.02, sg * 0.058], [0, 1, 0], 0.005, M.steel, 0.3); }
    const g0 = body.nv; lathe(body, [[0, -0.02], [0.118, -0.02], [0.118, 0.10], [0.095, 0.22], [0.07, 0.30], [0.045, 0.335], [0.03, 0.39]], q ? 10 : 20, M.paint); body.place(g0, rotX(Math.PI / 2), [DIMS.tailRotor[0], DIMS.tailRotor[1], 0.02]);
    // the gearbox's own fairing into the boom
    const f0 = body.nv; lathe(body, [[0, -0.45], [0.06, -0.38], [0.125, -0.15], [0.14, 0], [0.125, 0.16], [0.07, 0.33], [0, 0.4]], q ? 10 : 18, M.paint); body.place(f0, rotZ(Math.PI / 2), [DIMS.tailRotor[0] + 0.02, DIMS.tailRotor[1], 0.055]);
  }

  // ---- fin (upper and lower in one skin) and the tail skid under it
  {
    const le = curve([[0.80, -6.99], [1.2, -6.80], [1.75, -6.56], [2.02, -6.50], [2.5, -6.78], [2.96, -7.10]]), te = curve([[0.80, -7.22], [1.2, -7.33], [1.75, -7.43], [2.02, -7.49], [2.5, -7.56], [2.96, -7.58]]);
    const ys = [], n = [44, 18, 8][q]; for (let i = 0; i <= n; i++) ys.push(0.80 + (2.96 - 0.80) * (0.5 - 0.5 * Math.cos(Math.PI * i / n)));
    const vs = [], na = [30, 16, 8][q]; for (let j = 0; j < na; j++) vs.push(j / na * Math.PI * 2);
    const fin = new Soup();
    loft(fin, (u, v, o) => { const y = Math.min(2.96, Math.max(0.80, u)), c = le(y) - te(y), xc = 0.5 * (1 + Math.cos(v)), tip = Math.sqrt(Math.min(1, Math.max(0, Math.min(y - 0.80, 2.96 - y) / 0.07))); o[0] = le(y) - xc * c; o[1] = y; o[2] = Math.sin(v) >= 0 ? naca(xc, 0.105) * c * tip : -naca(xc, 0.105) * c * tip; return o; }, ys, vs, M.paint, { wrap: true, away: (u) => [(le(u) + te(u)) / 2, u, 0], pole: (u) => [0, u > 1.5 ? 1 : -1, 0] });
    if (q === 0) for (const yc of [1.16, 1.5, 2.22, 2.56]) { const d = split(fin, (x, y) => y - yc, LN); for (const path of zeroPaths(fin, d)) alongPath(fin, path, 0.028, (p, nn, t) => { for (const sg of [1, -1]) rivet(rivets, [p[0], p[1] + 0.013 * sg, p[2]], nn, 0.0028, M.paint); }); }
    body.append(fin);
    if (q < 2) for (const y of [2.62, 2.3, 1.35]) rod(body, [te(y) + 0.01, y, 0], [te(y) - 0.15, y - 0.02, 0], 0.0025, 4, M.blackMatte);
    // tail skid: a steel tube bowed down and back under the lower fin
    tube(body, smoothPath([[-6.62, 1.72, 0], [-6.78, 1.25, 0], [-6.9, 0.86, 0], [-6.96, 0.76, 0], [-7.08, 0.735, 0], [-7.2, 0.78, 0]], 5), 0.016, q ? 5 : 8, M.steelDark, { caps: 1 });
  }
  // ---- horizontal stabiliser
  {
    const zs = [], n = [40, 16, 6][q]; for (let i = 0; i <= n; i++) zs.push(-1.28 * Math.cos(Math.PI * i / n));
    const vs = [], na = [26, 14, 8][q]; for (let j = 0; j < na; j++) vs.push(j / na * Math.PI * 2);
    const st = new Soup();
    loft(st, (u, v, o) => { const z = Math.min(1.28, Math.max(-1.28, u)), az = Math.abs(z), c = 0.62 - 0.13 * az / 1.28, xc = 0.5 * (1 + Math.cos(v)), tip = Math.sqrt(Math.min(1, Math.max(0, (1.28 - az) / 0.05))), th = naca(xc, 0.11) * c * tip; o[0] = -4.54 - 0.06 * az / 1.28 - xc * c; o[1] = 1.915 + (Math.sin(v) >= 0 ? th * 0.75 : -th * 1.25) + 0.012 * xc; o[2] = z; return o; }, zs, vs, M.paintFlat, { wrap: true, away: (u) => [-4.85, 1.915, u], pole: (u) => [0, 0, u > 0 ? 1 : -1] });
    if (q === 0) for (const zc of [-0.9, -0.5, 0.5, 0.9]) { const d = split(st, (x, y, z) => z - zc, LN); for (const path of zeroPaths(st, d)) alongPath(st, path, 0.028, (p, nn) => { for (const sg of [1, -1]) rivet(rivets, [p[0], p[1], p[2] + 0.013 * sg], nn, 0.0028, M.paintFlat); }); }
    body.append(st);
    if (q < 2) for (const sg of [-1, 1]) for (const zz of [1.2, 0.95]) rod(body, [-5.03 - 0.05 * zz, 1.918, sg * zz], [-5.2 - 0.05 * zz, 1.905, sg * zz], 0.0025, 4, M.blackMatte);     // static wicks
  }

  // ---- engine exhaust
  {
    const a = [-2.62, 2.33, 0], b = [-3.02, 2.40, 0], seg = q ? 10 : 20;
    tube(body, [a, b], 0.118, seg, M.hot); tube(body, [[b[0], b[1], 0], [b[0] + 0.012, b[1] - 0.002, 0]], (i) => (i ? 0.108 : 0.121), seg, M.hot);
    const k = body.nv; tube(body, [[-2.7, 2.345, 0], [b[0] + 0.01, b[1], 0]], 0.108, seg, M.soot); for (let e = k * S; e < body.v.length; e += S) { body.v[e + 3] *= -1; body.v[e + 4] *= -1; body.v[e + 5] *= -1; } for (let t = body.i.length - (seg * 2) * 3; t < body.i.length; t += 3) { const w = body.i[t + 1]; body.i[t + 1] = body.i[t + 2]; body.i[t + 2] = w; }
    const c = body.nv; lathe(body, [[0, 0], [0.108, 0]], seg, M.soot); body.place(c, rotZ(-Math.PI / 2 - 0.17), [-2.72, 2.342, 0]);
  }

  // ---- mast fairing, mast and the fixed half of the swashplate
  {
    // the gearbox top: a stepped grey casting with a bolted flange, a rubber boot round the mast, three servo jacks to the fixed plate
    lathe(body, [[0.25, 2.55], [0.25, 2.60], [0.215, 2.61], [0.185, 2.66], [0.14, 2.70], [0.14, 2.72], [0.1, 2.73], [0.1, 2.745]], q ? 12 : 24, M.grey, { sharp: q < 2 });
    lathe(body, [[0.1, 2.745], [0.085, 2.76], [0.092, 2.775], [0.078, 2.79], [0.082, 2.802], [0.064, 2.81]], q ? 10 : 20, M.rubber);
    rod(body, [0, 2.72, 0], [0, DIMS.rotorY - 0.02, 0], 0.046, q ? 8 : 16, M.steel, { caps: 0 });
    if (q < 2) {
      for (let j = 0; j < 10; j++) { const a = j / 10 * Math.PI * 2 + 0.2; rivet(body, [Math.cos(a) * 0.232, 2.601, Math.sin(a) * 0.232], [0, 1, 0], 0.011, M.steel, 0.6); }
      lathe(body, [[0.10, 2.815], [0.255, 2.815], [0.272, 2.825], [0.272, 2.838], [0.255, 2.846], [0.10, 2.846]], 24, M.steelDark, { sharp: true });
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.5, c = Math.cos(a), sn = Math.sin(a); rod(body, [c * 0.2, 2.66, sn * 0.2], [c * 0.235, 2.818, sn * 0.235], 0.015, 8, M.alu); rod(body, [c * 0.19, 2.585, sn * 0.19], [c * 0.207, 2.74, sn * 0.207], 0.032, 10, M.steelDark); const k = body.nv; box(body, 0.06, 0.034, 0.07, M.steelDark); body.place(k, rotY(-a), [c * 0.25, 2.822, sn * 0.25]); }
      // a harness up the housing to the plate, as every head has
      tube(body, smoothPath([[-0.2, 2.6, 0.1], [-0.17, 2.68, 0.13], [-0.13, 2.74, 0.12], [-0.12, 2.80, 0.1]], 3), 0.007, 5, M.blackMatte);
    }
  }

  // ---- landing gear: skids, cross tubes with fairings where they enter the belly, clamps, boarding steps
  {
    const seg = q ? 6 : 12, R = 0.055, GP = M.gear;      // our own constants: tubes a little fatter than dims.js's 0.045 (they read as wire at 20 m), bottom still at y = 0; light grey so their roundness shows
    for (const sg of [-1, 1]) {
      const z = sg * DIMS.skidZ;
      tube(body, [[DIMS.skidRear, R, z], [-1.0, R, z], [0, R, z], [1.0, R, z], ...smoothPath([[1.22, R, z], [1.36, R + 0.022, z], [1.47, R + 0.085, z], [1.55, R + 0.185, z]], 4)], R, seg, GP, { caps: 1 });
      if (q < 2) {
        for (const x of [-1.2, -0.6, 0.35, 1.05]) { box(body, 0.3, 0.016, 0.07, M.steelDark); body.place(body.nv - 24, I3, [x, 0.006, z]); }      // wear shoes
        { const k = body.nv; lathe(body, [[0, -0.012], [R * 0.9, -0.01], [R * 1.04, 0], [R * 1.04, 0.03]], 10, M.rubber); body.place(k, rotZ(Math.PI / 2), [DIMS.skidRear + 0.02, R, z]); }      // heel cap
        // step: a long rail with a non-slip tread, on three brackets off the cross tubes
        tube(body, [[-0.72, 0.40, sg * 1.02], [-0.6, 0.415, sg * 1.03], [1.25, 0.415, sg * 1.03], [1.37, 0.40, sg * 1.02]], 0.019, 8, GP, { caps: 1 });
        box(body, 1.75, 0.012, 0.11, M.blackMatte); body.place(body.nv - 24, I3, [0.325, 0.438, sg * 0.99]);
        box(body, 1.79, 0.02, 0.13, GP); body.place(body.nv - 24, I3, [0.325, 0.424, sg * 0.985]);
        for (const x of [-0.6, 0.3, 1.2]) rod(body, [x, 0.41, sg * 1.0], [x, 0.5, sg * 0.76], 0.012, 6, GP);
      }
    }
    for (const x of [0.95, -0.95]) {
      const half = [[x, R * 1.6, 1.085], [x, 0.17, 1.045], [x, 0.36, 0.93], [x, 0.52, 0.72], [x, 0.60, 0.46], [x, 0.625, 0.2]], path = smoothPath([...half.map((p) => [p[0], p[1], -p[2]]), ...half.slice().reverse()], q ? 2 : 5);
      tube(body, path, 0.046, seg, GP);
      if (q < 2) for (const sg of [-1, 1]) {
        tube(body, [[x, R * 1.2, sg * 1.085], [x, 0.16, sg * 1.05]], (i) => (i ? 0.052 : 0.07), seg, GP);
        const k = body.nv; lathe(body, [[0.062, -0.08], [0.072, -0.07], [0.072, 0.07], [0.062, 0.08]], 10, GP); body.place(k, rotZ(Math.PI / 2), [x, R, sg * 1.085]);
        for (const dx of [-0.045, 0.045]) { const c = body.nv; lathe(body, [[0.074, -0.008], [0.076, 0], [0.074, 0.008]], 10, M.steel); body.place(c, rotZ(Math.PI / 2), [x + dx, R, sg * 1.085]); }
        // fairing where the tube goes into the belly
        const f = body.nv; loft(body, (u, v, o) => { const uu = Math.min(1, Math.max(-1, u)), r = Math.sqrt(Math.max(0, 1 - uu * uu)); o[0] = uu * 0.17; o[1] = Math.cos(v) * r * 0.075; o[2] = Math.sin(v) * r * 0.1; return o; }, [-1, -0.92, -0.7, -0.35, 0, 0.35, 0.7, 0.92, 1], [0, 0.52, 1.05, 1.57, 2.09, 2.62, 3.14, 3.67, 4.19, 4.71, 5.24, 5.76], M.paint, { wrap: true, away: () => [0, 0, 0], pole: (u) => [u > 0 ? 1 : -1, 0, 0] }); body.place(f, I3, [x, 0.6, sg * 0.5]);
      }
    }
    // under the belly: a cargo hook on its beam, a red beacon, a bonding strap
    if (q < 2) {
      box(body, 0.34, 0.03, 0.06, M.steelDark); body.place(body.nv - 24, I3, [0.0, 0.525, 0]);
      box(body, 0.09, 0.11, 0.05, M.steelDark); body.place(body.nv - 24, I3, [0.0, 0.46, 0]);
      tube(body, smoothPath([[0.0, 0.41, 0], [0.035, 0.37, 0], [0.02, 0.33, 0], [-0.03, 0.33, 0], [-0.045, 0.37, 0]], 4), 0.011, 6, M.steel, { caps: 1 });
      { const k = body.nv; lathe(body, [[0.045, 0], [0.045, 0.012], [0.03, 0.02]], 12, M.steelDark); body.place(k, rotX(Math.PI), [-0.55, podSect(-0.55).yb + 0.004, 0]); }
    }
  }

  // ---- small things
  if (q < 2) {
    // door handles (both front doors, both rear doors) and hinges
    for (const sg of [-1, 1]) {
      for (const [hx, hy] of [[0.40, 1.08], [-0.37, 1.08]]) {
        const { p, n } = podAt(hx, hy, sg), tgt = hx > 0.2 && sg > 0 ? door : body, k = tgt.nv; box(tgt, 0.13, 0.03, 0.014, M.steelDark); tgt.place(k, alignZ(n), [p[0] + n[0] * 0.006, p[1] + n[1] * 0.006, p[2] + n[2] * 0.006]);
        const k2 = tgt.nv; box(tgt, 0.17, 0.062, 0.004, M.blackMatte); tgt.place(k2, alignZ(n), [p[0] + n[0] * 0.001, p[1] + n[1] * 0.001, p[2] + n[2] * 0.001]);
      }
      for (const hy of [0.95, 1.72]) { const hx = doorFront(hy) + 0.012, { p, n } = podAt(hx, hy, sg); rod(body, [p[0] + n[0] * 0.006, p[1] - 0.04, p[2] + n[2] * 0.006], [p[0] + n[0] * 0.006 - 0.0176, p[1] + 0.04, p[2] + n[2] * 0.006], 0.011, 8, M.paintFlat); }
      for (const hy of [0.95, 1.72]) { const { p, n } = podAt(0.2, hy, sg); rod(body, [p[0], p[1] - 0.035, p[2] + n[2] * 0.006], [p[0], p[1] + 0.035, p[2] + n[2] * 0.006], 0.010, 8, M.paintFlat); }
      // latches on the baggage hatch
      for (const hx of [-1.5, -1.05]) { const { p, n } = podAt(hx, 1.03, sg), k = body.nv; box(body, 0.05, 0.022, 0.006, M.steel); body.place(k, alignZ(n), [p[0] + n[0] * 0.002, p[1] + n[1] * 0.002, p[2] + n[2] * 0.002]); }
    }
    // fuel cap
    { const { p, n } = podAt(-1.08, 1.80, -1), k = body.nv; lathe(body, [[0, 0.006], [0.036, 0.006], [0.042, 0.0], [0.05, -0.004]], 16, M.steel); body.place(k, alignY(n), p); }
    // pitot tube under the nose, left
    { const { p, n } = podAt(2.72, 0.70, -1); tube(body, smoothPath([[p[0], p[1] + 0.01, p[2]], [p[0] + 0.01, p[1] - 0.07, p[2] - 0.035], [p[0] + 0.06, p[1] - 0.105, p[2] - 0.05], [p[0] + 0.26, p[1] - 0.105, p[2] - 0.05]], 4), (i) => (i > 10 ? 0.006 : 0.009), 8, M.alu, { caps: 1 }); }
    // blade antennas: one under the belly, one on the boom; a whip on the cowling
    const blade = (x, y, z, h, dir, m) => { const k = body.nv; loft(body, (u, v, o) => { const c = 0.14 - 0.07 * u, xc = 0.5 * (1 + Math.cos(v)); o[0] = -u * h * 0.45 - xc * c + 0.07; o[1] = u * h; o[2] = (Math.sin(v) >= 0 ? 1 : -1) * naca(xc, 0.12) * c * (u > 0.97 ? 0.3 : 1); return o; }, [0, 0.25, 0.5, 0.75, 0.97, 1], [0, 0.6, 1.2, 1.9, 2.6, 3.14, 3.7, 4.4, 5.1, 5.7], m, { wrap: true, away: (u) => [-u * h * 0.45, u * h, 0] }); body.place(k, dir < 0 ? rotX(Math.PI) : I3, [x, y, z]); };
    blade(0.55, 0.545, 0.0, 0.2, -1, M.paintFlat); blade(-3.9, podSect(-3.9).yb + 0.004, 0, 0.17, -1, M.paintFlat); blade(-1.0, podSect(-1.0).yb + 0.004, 0.25, 0.14, -1, M.paintFlat);
    rod(body, [-2.25, 2.5, 0.18], [-2.52, 2.98, 0.18], 0.004, 5, M.blackMatte); { const k = body.nv; lathe(body, [[0.03, -0.01], [0.028, 0.01], [0.012, 0.03], [0.006, 0.05]], 10, M.blackMatte); body.place(k, rotZ(0.5), [-2.25, 2.5, 0.18]); }
    for (const [bx, by, bz] of [[0.55, 0.545, 0], [-3.9, podSect(-3.9).yb + 0.004, 0], [-1.0, podSect(-1.0).yb + 0.004, 0.25]]) { box(body, 0.2, 0.012, 0.06, M.paintFlat); body.place(body.nv - 24, I3, [bx - 0.01, by, bz]); for (const ex of [-0.085, 0.07]) rivet(rivets, [bx + ex, by - 0.007, bz], [0, -1, 0], 0.005, M.steel, 0.4); }
    { const k = body.nv; lathe(body, [[0.055, 0], [0.055, 0.012], [0.04, 0.024], [0, 0.026]], 14, M.paintFlat); body.place(k, I3, [-1.5, cTop(1.5) - 0.004, 0.12]); }      // GPS puck
    // outside air probe and a drain mast under the belly
    rod(body, [0.1, 0.55, -0.3], [0.08, 0.47, -0.3], 0.006, 6, M.alu); rod(body, [-0.5, 0.55, 0.2], [-0.52, 0.49, 0.2], 0.005, 6, M.alu);
    // cable cutter style grab handle on the door post (a plain rail), both sides
    for (const sg of [-1, 1]) { const a = podAt(0.225, 1.5, sg), b = podAt(0.225, 1.75, sg); tube(body, smoothPath([a.p, [a.p[0], a.p[1] + 0.02, a.p[2] + sg * 0.03], [b.p[0], b.p[1] - 0.02, b.p[2] + sg * 0.03], b.p], 3), 0.008, 6, M.steelDark); }
  }

  // ---- lamps: housings on the airframe, the lit lenses in their own little mesh (colour = light colour, roughness slot = which lamp)
  {
    const lens = (c, r, col, id, dir) => { const k = lamps.nv; ball(lamps, [0, 0, 0], r, { c: col, r: id, m: 0, cc: 0, t: 0 }, 10, true); const dl = Math.hypot(dir[0], dir[1], dir[2]); lamps.place(k, alignY([dir[0] / dl, dir[1] / dl, dir[2] / dl]), c); };
    const [rx, ry, rz] = DIMS.navRed, st = DIMS.strobe, ll = DIMS.landingLight;
    for (const sg of [-1, 1]) {
      const { p } = podAt(rx, ry, sg), k = body.nv;
      loft(body, (u, v, o) => { const r = 0.034 * Math.sqrt(Math.max(0, 1 - u * u)); o[0] = u * 0.11; o[1] = Math.cos(v) * r; o[2] = Math.sin(v) * r * 1.1; return o; }, [-1, -0.9, -0.6, -0.2, 0.2, 0.6, 0.9, 1], [0, 0.785, 1.57, 2.356, 3.14, 3.93, 4.71, 5.5], M.paintFlat, { wrap: true, away: (u) => [u * 0.11, 0, 0], pole: (u) => [u > 0 ? 1 : -1, 0, 0] }); body.place(k, I3, [p[0], p[1], p[2] + sg * 0.012]);
      lens([rx + 0.03, ry, sg * Math.abs(rz) * 1.0 + sg * (Math.abs(p[2]) + 0.04 - Math.abs(rz))], 0.024, sg < 0 ? [1, 0.04, 0.02] : [0.03, 1, 0.25], 0, [0.3, 0, sg]);
    }
    // beacon on the fin top; white light at the tail; landing light under the nose
    { const k = body.nv; lathe(body, [[0.03, -0.012], [0.03, 0.004], [0.022, 0.008]], 12, M.steelDark); body.place(k, I3, [st[0], 2.925, 0]); lens([st[0], 2.932, 0], 0.024, [1, 0.03, 0.02], 1, [0, 1, 0]); }
    lens([TAIL + 0.012, 1.97, 0], 0.02, [1, 1, 0.95], 0, [-1, 0, 0]); lens([-0.55, podSect(-0.55).yb - 0.014, 0], 0.028, [1, 0.03, 0.02], 1, [0, -1, 0]);
    { const { p } = podAt(ll[0], 0.6, 1), y = podSect(ll[0]).yb, k = body.nv; lathe(body, [[0.07, -0.05], [0.078, 0.0], [0.07, 0.008]], 16, M.black); const R = rotZ(-Math.PI / 2 - 0.32); body.place(k, R, [ll[0], y - 0.055, 0]); rod(body, [ll[0] - 0.03, y + 0.01, 0], [ll[0] - 0.02, y - 0.05, 0], 0.02, 8, M.black); const k2 = lamps.nv; lathe(lamps, [[0, 0.006], [0.05, 0.004], [0.066, 0]], 16, { c: [1, 0.97, 0.9], r: 2, m: 0, cc: 0, t: 0 }); lamps.place(k2, R, [ll[0] + 0.004, y - 0.057, 0]); void p; }
  }

  // ---- stencils and placards: small flat pieces a hair above the skin, each with its own patch of the livery picture
  if (q === 0) {
    const put = (name, x, y, sg, w, h) => decals.push({ name, x, y, sg, w, h });
    put('nostep', 0.9, 0.80, 1, 0.16, 0.035); put('nostep', 0.9, 0.80, -1, 0.16, 0.035);
    put('fuel', -1.08, 1.69, -1, 0.15, 0.06); put('danger', -5.55, 1.90, 1, 0.34, 0.085); put('danger', -5.55, 1.90, -1, 0.34, 0.085);
    put('rescue', 0.95, 0.90, 1, 0.26, 0.05); put('rescue', 0.95, 0.90, -1, 0.26, 0.05);
    put('baggage', -1.27, 1.52, 1, 0.2, 0.05); put('baggage', -1.27, 1.52, -1, 0.2, 0.05);
    put('static', 2.72, 1.04, 1, 0.085, 0.045); put('ground', -0.7, 0.84, -1, 0.11, 0.04); put('hoist', -2.05, 1.36, 1, 0.12, 0.05); put('jack', 1.6, 0.66, 1, 0.07, 0.035); put('jack', -0.9, 0.70, 1, 0.07, 0.035); put('jack', 1.6, 0.66, -1, 0.07, 0.035);
    put('handle', 0.40, 1.165, 1, 0.12, 0.03); put('handle', 0.40, 1.165, -1, 0.12, 0.03); put('handle', -0.37, 1.165, 1, 0.12, 0.03); put('handle', -0.37, 1.165, -1, 0.12, 0.03);
  }
  // the livery picture is laid on from the side: every painted corner looks up its own place in it
  for (const s of [body, door, rivets]) sideUV(s, 0);
  for (const d of decals) {
    const tgt = L.doorR(d.x, d.y, d.sg) > 0 ? door : body, r = DECALS[d.name], nx = Math.max(2, Math.round(d.w / 0.04)), k0 = tgt.nv; if (!r) continue;
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= nx; i++) {
      const { p, n } = podAt(d.x + (i / nx - 0.5) * d.w, d.y + (j - 0.5) * d.h, d.sg), u = d.sg > 0 ? i / nx : 1 - i / nx;
      tgt.add(p[0] + n[0] * 0.0007, p[1] + n[1] * 0.0007, p[2] + n[2] * 0.0007, n[0], n[1], n[2], M.paint, (r[0] + u * r[2]) / AT.w, 1 - (r[1] + (1 - j) * r[3]) / AT.h);
    }
    for (let i = 0; i < nx; i++) tgt.quadN(k0 + i, k0 + i + 1, k0 + nx + 2 + i, k0 + nx + 1 + i);
  }
  return { body, door, glass, doorGlass, rivets, lamps, decals, trim, doorTrim };
}
// ---------------------------------------------------------------- the livery picture's layout (livery.js paints to the same numbers)
// One canvas: the top half is the right side seen from the right (nose to the right), the bottom half the left side (nose to the left).
export const AT = { w: 4096, h: 2048, x0: -7.75, x1: 3.45, y0: 0.45, y1: 3.0 };
export const atlasPx = (x, y, right) => [(right ? x - AT.x0 : AT.x1 - x) / (AT.x1 - AT.x0) * AT.w, (AT.y1 - y) / (AT.y1 - AT.y0) * (AT.h / 2) + (right ? 0 : AT.h / 2)];
// placards live in the empty picture space under the boom of the right side: name -> [px x, px y, px w, px h]
export const DECALS = {
  danger: [560, 640, 680, 170], rescue: [560, 815, 520, 100], handle: [560, 920, 360, 90], nostep: [1250, 640, 320, 70], fuel: [1250, 715, 300, 120],
  baggage: [1250, 840, 320, 80], static: [1250, 925, 170, 85], ground: [1425, 925, 140, 60], hoist: [1090, 815, 150, 64], jack: [1090, 885, 140, 70],
};
function sideUV(s, from) {
  const v = s.v;
  for (let k = from * S; k < v.length; k += S) { if (v[k + 14] <= 0) continue; const right = Math.abs(v[k + 2]) > 1e-4 ? v[k + 2] > 0 : v[k + 5] >= 0, p = atlasPx(v[k], v[k + 1], right); v[k + 6] = p[0] / AT.w; v[k + 7] = 1 - p[1] / AT.h; }
}
// the rotation that carries +Z onto n, keeping +X as near to the model's X as it can (for plates lying on the side skin)
function alignZ(n) {
  let ux = 1 - n[0] * n[0], uy = -n[0] * n[1], uz = -n[0] * n[2]; const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  const vx = n[1] * uz - n[2] * uy, vy = n[2] * ux - n[0] * uz, vz = n[0] * uy - n[1] * ux;
  return [ux, vx, n[0], uy, vy, n[1], uz, vz, n[2]];
}
// The window outlines (W) and the panel and door lines (L, of which L.doorR is the pilot's door): each is a function (x, y, z) -> metres
// inside the outline (positive inside, zero on the cut). The cockpit cuts its own trim from the same numbers.
export { doorFront, NOSE, TAIL, W, L, inGlass };
export const WINDOWS = W, DOOR_R = L.doorR;
