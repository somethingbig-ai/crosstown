// park/heroes/mall.js (park lane, helper heroes, Nov 16): THE MALL and Literary Walk: the straight promenade from about 66th St to the Terrace.
// FROM THE DATA: the centre line and the 12 m width (OSM's paved areas 18042492 and 1315432496: the walk is 12.0 to 12.6 m wide and runs 1.6 degrees
// off the arcade's axis), the ground (lidar).
// MINE: the elms' places. The lidar gives one record per crown dome (about 50 along the walk, the canopy is closed), so the quadruple row is set out
// by rule: two rows a side, 9.4 m and 17.0 m from the centre line, a tree every 10.5 m, the outer row staggered; a place is left empty where a lidar
// tree already stands within 3 m or a path crosses. Bench rows and the low rail fence behind them are continuous by rule (OSM maps none of them),
// broken where a path crosses. Elm shape (vase: a short bole, four or five limbs rising steeply and arching out) from the photographs.
import * as THREE from 'three';
import { mk, F, instanced } from './kit.js';

const ML = [F(-445, -12.4, 0), F(-355, -10.3, 0), F(-177, -5.3, 0), F(-52, -0.5, 0)], HWID = 6.1;
let KIT = null;
function elm(seed) {
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647, B = mk(0), BARK = [0.10, 0.085, 0.07], LEAFS = [[0.85, 0.62, 0.10], [0.95, 0.72, 0.16], [0.70, 0.46, 0.08], [0.60, 0.58, 0.12], [0.88, 0.50, 0.08]], lean = [(rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7], tips = [];
  B.tube([[0, 0, -0.4], [lean[0] * 0.3, lean[1] * 0.3, 2.6], [lean[0], lean[1], 5.6]], [0.50, 0.40, 0.34], 8, BARK, 9);
  const nl = 4 + (rnd() > 0.5 ? 1 : 0);
  for (let i = 0; i < nl; i++) { const az = i / nl * 6.283 + rnd() * 0.6, out = 6.5 + rnd() * 3, top = 19 + rnd() * 5, P = [], R = [];
    for (let k = 0; k <= 5; k++) { const t = k / 5, rho = 0.25 + out * Math.pow(t, 1.9), w = (rnd() - 0.5) * 0.25 * t; P.push([lean[0] + Math.cos(az + w) * rho, lean[1] + Math.sin(az + w) * rho, 5.4 + (top - 5.4) * Math.sin(t * 1.35) / Math.sin(1.35)]); R.push(0.24 * (1 - t) + 0.035); }
    B.tube(P, R, 5, BARK, 9); tips.push(P[5]);
    for (const k of [2, 4]) { const b = P[k], a2 = az + (rnd() - 0.5) * 2.4, len = 4 + rnd() * 3.5, Q = [b], RR = [R[k] * 0.6]; for (let j = 1; j <= 3; j++) { const t = j / 3; Q.push([b[0] + Math.cos(a2) * len * t, b[1] + Math.sin(a2) * len * t, b[2] + len * (0.8 * t - 0.5 * t * t)]); RR.push(R[k] * 0.6 * (1 - t) + 0.02); } B.tube(Q, RR, 3, BARK, 9); tips.push(Q[3]); } }
  for (const p of tips) { const a = rnd() * 6.283, dx = Math.cos(a), dy = Math.sin(a), e = [p[0] + dx * 2.6, p[1] + dy * 2.6, p[2] - 1.6]; B.tube([p, [p[0] + dx * 1.3, p[1] + dy * 1.3, p[2] + 0.3], e], [0.03, 0.02, 0.008], 3, BARK);      // the drooping twig ends
    // sprays of leaves round each twig end (mode 8: the card is pierced into leaves in the shader): some lying flat, some hanging
    for (let j = 0; j < 7; j++) { const c = [e[0] + (rnd() - 0.5) * 4.5, e[1] + (rnd() - 0.5) * 4.5, e[2] + 0.4 + rnd() * 2.6], s = 1.1 + rnd() * 0.9, b = rnd() * 6.283, cx = Math.cos(b) * s, cy = Math.sin(b) * s, flat = rnd() < 0.55, u0 = Math.floor(rnd() * 97), K = LEAFS[Math.floor(rnd() * LEAFS.length)];
      const w = flat ? [-cy, cx, (rnd() - 0.5) * 0.9 * s] : [-cy * 0.25, cx * 0.25, s];
      B.q([c[0] - cx - w[0], c[1] - cy - w[1], c[2] - w[2]], [c[0] + cx - w[0], c[1] + cy - w[1], c[2] - w[2]], [c[0] + cx + w[0], c[1] + cy + w[1], c[2] + w[2]], [c[0] - cx + w[0], c[1] - cy + w[1], c[2] + w[2]], K, 8, [[u0, 0], [u0 + 1, 0], [u0 + 1, 1], [u0, 1]]); } }
  return B;
}
function kit() {
  if (KIT) return KIT; const Fl = (a, e, z) => [e, a, z], WOOD = [0.26, 0.16, 0.085], IRON = [0.04, 0.05, 0.04], bench = mk(0), fence = mk(0);
  bench.box(Fl, -0.05, 0.42, -0.92, 0.92, 0.40, 0.45, WOOD); bench.box(Fl, -0.13, -0.07, -0.92, 0.92, 0.45, 0.86, WOOD); for (const x of [-0.88, 0, 0.88]) bench.box(Fl, -0.12, 0.40, x - 0.02, x + 0.02, 0, 0.40, IRON);
  fence.box(Fl, -0.025, 0.025, -0.025, 0.025, 0, 0.78, IRON); fence.box(Fl, -0.015, 0.015, 0, 2.6, 0.70, 0.74, IRON); fence.box(Fl, -0.015, 0.015, 0, 2.6, 0.36, 0.39, IRON);
  const mkI = (B) => { const g = B.geo(); g.userData.shared = true; return { geo: g, tris: B.tris() }; };
  KIT = { bench: mkI(bench), fence: mkI(fence), elms: [11, 207, 3301].map((s) => mkI(elm(s))) }; return KIT;
}

export function build(game, S, C, park, inC) {
  // stations every 0.65 m along the centre line; nothing to do in a chunk the walk does not cross
  const Q = []; let s = 0; for (let k = 0; k + 1 < ML.length; k++) { const a = ML[k], b = ML[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(L / 0.65), tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; for (let q = 0; q < n; q++) { const t = q / n; Q.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx, ty, s: s + L * t }); } s += L; }
  const at = (q, o) => [q.x + q.ty * o, q.y - q.tx * o]; if (!Q.some((q) => inC(q.x, q.y) || inC(...at(q, 17)) || inC(...at(q, -17)))) return null;
  const T = game.terrain, sg = game.statics, K = kit(), B = mk(), grp = new THREE.Group(); grp.name = 'hero_mall'; let tris = 0;
  // a path that crosses the walk here (not one that runs along it)
  const cross = (x, y, R, tx, ty) => { for (const p of C.data.paths || []) { const P = p.pts; if (!P || p.kind === 'steps') continue; for (let k = 0; k + 1 < P.length; k++) { const ax = P[k][0], ay = P[k][1], dx = P[k + 1][0] - ax, dy = P[k + 1][1] - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < R + (p.w || 3) / 2 && Math.abs(dx * tx + dy * ty) / Math.sqrt(l2) < 0.8) return true; } } return false; };
  const rh = (k, j) => { const v = Math.sin(k * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  // 1. the hexagonal block paving, laid on the relief
  for (let k = 0; k + 3 < Q.length; k += 3) { const a = Q[k], b = Q[k + 3]; if (!inC((a.x + b.x) / 2, (a.y + b.y) / 2)) continue; for (let j = 0; j < 4; j++) { const o0 = -HWID + j * HWID / 2, o1 = o0 + HWID / 2, P = [[a, o0], [a, o1], [b, o1], [b, o0]].map(([q, o]) => { const p = at(q, o); return [p[0], p[1], T.ground(p[0], p[1]) + 0.05]; }); B.q(P[3], P[2], P[1], P[0], [1, 1, 1], 4); } }
  if (B.tris()) { const me = B.mesh(game, 'hero_mall_paving'); me.castShadow = false; grp.add(me); tris += B.tris(); }
  // 2. benches down both sides, the rail fence behind them
  const LB = [], LF = [], LE = [[], [], []];
  for (let k = 0; k < Q.length; k++) { const q = Q[k], th = Math.atan2(q.ty, q.tx); for (const sd of [-1, 1]) {
    if (k % 3 === 0) { const p = at(q, sd * 5.45); if (inC(p[0], p[1]) && !cross(p[0], p[1], 1.2, q.tx, q.ty)) { LB.push({ x: p[0], y: p[1], z: T.ground(p[0], p[1]) + 0.05, rot: th + (sd > 0 ? 0 : Math.PI) }); sg.addCircle(p[0], p[1], 0.55, 'furniture'); } }
    if (k % 4 === 0) { const p = at(q, sd * 6.4); if (inC(p[0], p[1]) && !cross(p[0], p[1], 1.5, q.tx, q.ty) && !cross(p[0] + q.tx * 2.6, p[1] + q.ty * 2.6, 1.5, q.tx, q.ty)) LF.push({ x: p[0], y: p[1], z: T.ground(p[0], p[1]), rot: th }); }
    // 3. the elms: two rows a side
    if (k % 16 === 0 || k % 16 === 8) for (const [row, o] of [[0, 9.4], [1, 17.0]]) { if ((k % 16 === 8) !== (row === 1)) continue; const p = at(q, sd * (o + (rh(k, row + sd) - 0.5) * 1.2)); p[0] += q.tx * (rh(k, 7 + sd) - 0.5) * 1.4; p[1] += q.ty * (rh(k, 7 + sd) - 0.5) * 1.4;
      if (!inC(p[0], p[1]) || cross(p[0], p[1], 1.5, q.tx, q.ty) || (C.trees || []).some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 3)) continue;
      LE[Math.floor(rh(k, 3 * sd + row) * 3) % 3].push({ x: p[0], y: p[1], z: T.ground(p[0], p[1]), rot: rh(k, sd) * 6.283, s: 0.9 + rh(k, 5 + sd * row) * 0.22 }); sg.addCircle(p[0], p[1], 0.45, 'tree'); } } }
  const add = (I, L, name) => { if (!L.length) return; const im = instanced(game, I.geo, I.tris, L, name); grp.add(im); tris += im.userData.tris; };
  add(K.bench, LB, 'hero_mall_bench'); add(K.fence, LF, 'hero_mall_fence'); LE.forEach((L, k) => add(K.elms[k], L, 'hero_mall_elm' + k));
  grp.userData.tris = tris; grp.userData.n = { benches: LB.length, fence: LF.length, elms: LE[0].length + LE[1].length + LE[2].length };
  return grp;
}
