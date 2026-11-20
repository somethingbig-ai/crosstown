// garages/garages.js (lanes/shops/garages): parking garages you can drive into, with cars to take. Loaded by streets/storefronts.js (its "garages" lines)
// with the bays of garages/slots.js: for each, the bay's measurements, its mouth (ml..mr, mh high) and which storefront instance is its closed gate.
//   At load (data only): the room is re-checked against the building (plan.js roomTester), the plan is made (plan.js planGarage) and the collision goes
//   in: the footprint wall is cut across the mouth; the room's walls, the platforms' faces, the ramp's sides, the booth and the columns go into
//   game.statics (and the police's own wall set when the police exist).
//   At the first step: kerb-side parked cars standing across the mouth are taken away (a garage has a kerb cut).
//   Near the player (within ?gnear=95 m): the garage is built (two meshes: painted concrete, lettering), its cars are added to game.parked (the same
//   slot objects the street uses, so F takes them exactly like a car at the kerb), the closed gate is hidden and the building tile behind wears the
//   copy of the facade material that cuts the mouth (the walk-in shops' own copy when they are loaded: one program). Beyond ?gnear + 20 m all of it is
//   dropped: the gate is shut again, the cars leave game.parked, nothing is drawn or stepped.
//   HEIGHT. The game's collision is flat, so the garage is a split-level deck in which no floor lies over another (plan.js): a ramp up the middle to an
//   upper deck 1.75 m higher. After every step, each of the player's cars inside the room gets the floor's height (v.z) and the ramp's slope
//   (v.pitch, taken out again before the next step); the player on foot gets player.alt (what the camera and the jump lane read) and is drawn there.
// Knobs: ?garages=0 off (storefronts.js never loads this file, the bay is a roll-up gate as before)  ?gnear=95  ?gman=0 no attendant  ?ghole=0 no cut (tests)
import * as THREE from 'three';
import { planGarage, roomTester, toSim, toLocal, simHeading, K } from './plan.js';
import { paintGarageAtlas, CELLS } from './art.js';

const Q = new URLSearchParams(location.search), num = (k, d) => (Q.has(k) && isFinite(+Q.get(k)) ? +Q.get(k) : d);
const NEAR = num('gnear', 95), FAR = NEAR + 20, MAN = Q.get('gman') !== '0', HOLE = Q.get('ghole') !== '0', TILE = 128, FLOOR = 0.15;
const lin = (c) => c.map((v) => Math.pow(v, 2.2));

function removeSeg(st, s) { const c = st.cell; for (let i = Math.floor(Math.min(s[0], s[2]) / c); i <= Math.floor(Math.max(s[0], s[2]) / c); i++) for (let j = Math.floor(Math.min(s[1], s[3]) / c); j <= Math.floor(Math.max(s[1], s[3]) / c); j++) { const k = st.key(i, j), a = st.segs.get(k); if (!a) continue; const b = a.filter((o) => o !== s); if (b.length) st.segs.set(k, b); else st.segs.delete(k); } }
// the wall across the mouth: every segment lying along the front (within 0.6 m of the wall line, roughly parallel) loses the part across the mouth
function cutMouth(st, d) {
  const a = d.ml + 0.02, b = d.mr - 0.02, c = st.cell, [cx, cy] = toSim(d, 0, 0), seen = new Set(), hit = []; let n = 0;
  for (let i = Math.floor((cx - 6) / c); i <= Math.floor((cx + 6) / c); i++) for (let j = Math.floor((cy - 6) / c); j <= Math.floor((cy + 6) / c); j++) { const arr = st.segs.get(st.key(i, j)); if (arr) for (const s of arr) if (!seen.has(s)) { seen.add(s); hit.push(s); } }
  for (const s of hit) {
    const [u1, z1] = toLocal(d, s[0], s[1]), [u2, z2] = toLocal(d, s[2], s[3]);
    if (Math.abs(z1) > 0.6 || Math.abs(z2) > 0.6 || Math.abs(u2 - u1) < 0.05) continue;
    if (Math.max(u1, u2) <= a || Math.min(u1, u2) >= b) continue;
    removeSeg(st, s); n++; const owner = st.owner; st.owner = s.set || null;
    const at = (u) => { const t = (u - u1) / (u2 - u1); return [s[0] + (s[2] - s[0]) * t, s[1] + (s[3] - s[1]) * t]; };
    const lo = Math.min(u1, u2), hi = Math.max(u1, u2);
    if (a - lo > 0.01) { const p = at(lo), q = at(a); st.addSeg(p[0], p[1], q[0], q[1], s.low, s.kind); }
    if (hi - b > 0.01) { const p = at(b), q = at(hi); st.addSeg(p[0], p[1], q[0], q[1], s.low, s.kind); }
    st.owner = owner;
  }
  return n;
}

// ------------------------------------------------------------------------------------------------------------------ the drawn garage
// Everything is written in the bay frame (u, y above the lower floor, t in from the wall line) and placed in the world by the bay's own axes.
function buildGeo(d, P) {
  const pos = [], col = [], tpos = [], tcol = [], tuv = [];
  const W3 = (u, y, t) => [u * d.dx - t * d.nx, y, -(u * d.dy - t * d.ny)];
  const quad = (a, b, c, e, cl, k = 1) => { for (const p of [a, b, c, a, c, e]) { pos.push(...W3(...p)); col.push(cl[0] * k, cl[1] * k, cl[2] * k); } };
  const box = (u0, u1, y0, y1, t0, t1, c, top = 1) => { const cl = lin(c);
    quad([u0, y1, t0], [u1, y1, t0], [u1, y1, t1], [u0, y1, t1], cl, top); quad([u0, y0, t0], [u1, y0, t0], [u1, y0, t1], [u0, y0, t1], cl, 0.5);
    quad([u0, y0, t0], [u1, y0, t0], [u1, y1, t0], [u0, y1, t0], cl, 0.78); quad([u0, y0, t1], [u1, y0, t1], [u1, y1, t1], [u0, y1, t1], cl, 0.7);
    quad([u0, y0, t0], [u0, y0, t1], [u0, y1, t1], [u0, y1, t0], cl, 0.86); quad([u1, y0, t0], [u1, y0, t1], [u1, y1, t1], [u1, y1, t0], cl, 0.82); };
  // a lettered panel: centre (u, y, t), facing the bay-frame direction (fu, ft) (or straight up: flat = the direction its top points), w wide, h high
  const sign = (cell, u, y, t, fu, ft, w, h, flat = null, tint = 1) => { const c = CELLS[cell], N = W3(fu, 0, ft), o = W3(u, y, t); let Rv, Uv;
    if (flat) { Uv = W3(flat[0], 0, flat[1]); Rv = [Uv[2], 0, -Uv[0]]; } else { Uv = [0, 1, 0]; Rv = [N[2], 0, -N[0]]; }      // right = up x normal
    const pt = (a, b2) => [o[0] + Rv[0] * a * w / 2 + Uv[0] * b2 * h / 2, o[1] + Rv[1] * a * w / 2 + Uv[1] * b2 * h / 2, o[2] + Rv[2] * a * w / 2 + Uv[2] * b2 * h / 2];
    const u0 = c[0] / 1024, u1 = (c[0] + c[2]) / 1024, v1 = 1 - c[1] / 1024, v0 = 1 - (c[1] + c[3]) / 1024;
    for (const [a, b2, uu, vv] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, -1, u0, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) { tpos.push(...pt(a, b2)); tuv.push(uu, vv); tcol.push(tint, tint, tint); } };
  const { ua, ub, D, TA, TS, RISE, CEIL, RW, A, ml, mr, mh } = P, T0 = K.T0;
  const FLR = [0.42, 0.42, 0.41], FLR2 = [0.46, 0.46, 0.45], WALL = [0.74, 0.73, 0.69], DADO = [0.16, 0.25, 0.42], YEL = [0.93, 0.72, 0.05], CEI = [0.50, 0.50, 0.48], BEAM = [0.44, 0.44, 0.42], STEEL = [0.30, 0.31, 0.33], WHITE = [0.92, 0.92, 0.88], TUBE = [1, 1, 0.97], BLK = [0.07, 0.07, 0.07], RED = [0.75, 0.08, 0.06];
  // floors: the lower deck with the sill under the mouth, the two platforms, the upper deck, the ramp
  box(ua, ub, -0.3, 0.004, T0 - 0.05, TA, FLR); box(ml, mr, -0.3, 0.004, -0.11, T0 - 0.05, FLR);
  box(ua, -RW, 0, RISE, TA, D, FLR2); box(RW, ub, 0, RISE, TA, D, FLR2); box(-RW, RW, 0, RISE, TS, D, FLR2);
  { const cl = lin(FLR2); quad([-RW, 0.004, TA], [RW, 0.004, TA], [RW, RISE, TS], [-RW, RISE, TS], cl, 0.92);
    for (let i = 1; i < K.RAMP; i++) { const t = TA + i, y = RISE * i / K.RAMP + 0.012; quad([-RW + 0.15, y, t], [RW - 0.15, y, t], [RW - 0.15, y + 0.008, t + 0.07], [-RW + 0.15, y + 0.008, t + 0.07], lin(FLR), 0.8); } }      // grip grooves across the ramp
  // yellow nosing at the top and foot of the ramp, kerb stripes along the platforms' edges
  box(-RW, RW, 0.004, 0.012, TA - 0.12, TA, YEL); box(-RW, RW, RISE, RISE + 0.008, TS, TS + 0.12, YEL);
  for (const s of [-1, 1]) { const e = s * RW, o = s * (RW + 0.14); box(Math.min(e, o), Math.max(e, o), RISE, RISE + 0.16, TA, TS, YEL); box(s < 0 ? ua : RW, s < 0 ? -RW : ub, RISE, RISE + 0.16, TA, TA + 0.14, YEL); }
  // walls with a painted dado; the wall over and beside the mouth; ceiling and beams
  const wall = (u0, u1, t0, t1, y0) => { box(u0, u1, y0, y0 + 1.15, t0, t1, DADO); box(u0, u1, y0 + 1.15, y0 + 1.25, t0, t1, YEL); box(u0, u1, y0 + 1.25, CEIL, t0, t1, WALL); };
  wall(ua - 0.1, ua, T0, TA, 0); wall(ub, ub + 0.1, T0, TA, 0); wall(ua - 0.1, ua, TA, D, RISE); wall(ub, ub + 0.1, TA, D, RISE); wall(ua, ub, D, D + 0.1, RISE);
  wall(ua, ml, T0 - 0.1, T0, 0); wall(mr, ub, T0 - 0.1, T0, 0); box(ml, mr, mh, CEIL, T0 - 0.1, T0, WALL);
  box(ml - 0.12, ml, 0, mh, -0.1, T0, WALL); box(mr, mr + 0.12, 0, mh, -0.1, T0, WALL); box(ml, mr, mh, mh + 0.2, -0.1, T0, WALL);      // the mouth's jambs and soffit through the wall
  box(ua, ub, CEIL, CEIL + 0.2, T0 - 0.1, D, CEI);
  for (let t = 4; t < D - 1; t += 5) box(ua, ub, CEIL - 0.45, CEIL, t - 0.2, t + 0.2, BEAM);
  // strip lights: a row down the aisle and one over each side
  for (let t = 2.5; t < D - 1; t += 5) for (const u of [0, (ua - A) / 2, (ub + A) / 2]) if (u === 0 || Math.abs(u) > A + 1.2) { box(u - 0.09, u + 0.09, CEIL - 0.58, CEIL - 0.5, t - 0.75, t + 0.75, TUBE, 2); box(u - 0.13, u + 0.13, CEIL - 0.5, CEIL - 0.45, t - 0.8, t + 0.8, STEEL); }
  // columns, stall lines
  for (const c of P.cols) { box(c[0] - 0.22, c[0] + 0.22, c[2], CEIL, c[1] - 0.22, c[1] + 0.22, WALL); box(c[0] - 0.235, c[0] + 0.235, c[2], c[2] + 1.15, c[1] - 0.235, c[1] + 0.235, YEL); }
  for (const L of P.lines) { const dx = L[2] - L[0], dt = L[3] - L[1], n = Math.hypot(dx, dt) || 1, ox = -dt / n * 0.05, ot = dx / n * 0.05, y = L[4] + 0.014; quad([L[0] - ox, y, L[1] - ot], [L[0] + ox, y, L[1] + ot], [L[2] + ox, y, L[3] + ot], [L[2] - ox, y, L[3] - ot], lin(WHITE), 1); }
  // rails: along the ramp's two sides and the platforms' front edges (posts, a top rail, a mid rail)
  const rail = (u0, t0, u1, t1, y) => { const n = Math.max(1, Math.round(Math.hypot(u1 - u0, t1 - t0) / 1.6)); for (let i = 0; i <= n; i++) { const u = u0 + (u1 - u0) * i / n, t = t0 + (t1 - t0) * i / n; box(u - 0.03, u + 0.03, y, y + 1.05, t - 0.03, t + 0.03, STEEL); }
    const a = Math.min(u0, u1) - 0.03, b = Math.max(u0, u1) + 0.03, c = Math.min(t0, t1) - 0.03, e = Math.max(t0, t1) + 0.03; box(a, b, y + 1.0, y + 1.06, c, e, YEL); box(a, b, y + 0.52, y + 0.56, c, e, STEEL); };
  for (const s of [-1, 1]) { rail(s * (RW + 0.07), TA + 0.07, s * (RW + 0.07), TS, RISE); rail(s < 0 ? ua + 0.05 : RW + 0.07, TA + 0.07, s < 0 ? -RW - 0.07 : ub - 0.05, TA + 0.07, RISE); }
  // the attendant's booth and the raised barrier arm beside it
  { const b = P.booth, s = b.side, a0 = s > 0 ? b.u0 : b.u1;      // a0: the booth's aisle side
    box(b.u0, b.u1, 0, 1.0, b.t0, b.t1, YEL); box(b.u0 + 0.03, b.u1 - 0.03, 1.0, 2.05, b.t0 + 0.03, b.t1 - 0.03, [0.10, 0.14, 0.17]); box(b.u0 - 0.1, b.u1 + 0.1, 2.05, 2.3, b.t0 - 0.1, b.t1 + 0.1, WHITE);
    for (const [u, t] of [[b.u0, b.t0], [b.u1, b.t0], [b.u0, b.t1], [b.u1, b.t1]]) box(u - 0.05, u + 0.05, 1.0, 2.05, t - 0.05, t + 0.05, WHITE);
    box(a0 - s * 0.05 - 0.09, a0 - s * 0.05 + 0.09, 0, 1.05, b.t1 + 0.35, b.t1 + 0.6, YEL);
    for (let i = 0; i < 6; i++) box(a0 - s * 0.05 - 0.04, a0 - s * 0.05 + 0.04, 1.05 + i * 0.42, 1.47 + i * 0.42, b.t1 + 0.44, b.t1 + 0.51, i % 2 ? WHITE : RED);
    sign('pay', (b.u0 + b.u1) / 2, 2.55, b.t0 - 0.11, 0, -1, 1.5, 0.5); box(b.u0 - 0.02, b.u1 + 0.02, 2.3, 2.8, b.t0 - 0.1, b.t0 - 0.04, BLK); }
  // lettering inside: levels, the way out, the speed, arrows on the floor
  const sL = P.booth.side < 0 ? 1 : -1;      // the lower side wall without the booth
  sign('level1', sL < 0 ? ua + 0.012 : ub - 0.012, 2.3, (T0 + TA) / 2, -sL, 0, 2.4, 1.2); sign('level2', 0, RISE + 2.15, D - 0.012, 0, -1, 2.4, 1.2);
  sign('mph', P.booth.side > 0 ? ub - 0.012 : ua + 0.012, 2.4, Math.min(TA - 1, P.booth.t1 + 3), -P.booth.side, 0, 0.8, 1.0);
  sign('exit', 0, mh + 0.55, T0 + 0.012, 0, 1, 2.0, 0.6); { const uy = Math.min(CEIL - 0.8, 3.75); sign('up', 0, uy, TA + 4.2, 0, -1, 2.4, 0.6); box(-1.25, 1.25, uy - 0.32, uy + 0.32, TA + 4.2, TA + 4.26, BLK); if (CEIL - uy > 0.9) for (const u of [-1.1, 1.1]) box(u - 0.02, u + 0.02, uy + 0.32, CEIL, TA + 4.21, TA + 4.25, STEEL); }      // the board over the ramp hangs at 3.75 m on two rods
  const rs = d.dy * d.nx - d.dx * d.ny >= 0 ? 1 : -1;      // +u is on the right of a driver coming in: he keeps right
  sign('arrow', rs * 1.5, 0.016, 5.5, 0, 0, 1.0, 2.6, [0, 1]); sign('arrow', -rs * 1.5, 0.016, 5.5, 0, 0, 1.0, 2.6, [0, -1]);
  sign('arrow', rs * 1.3, RISE + 0.016, TS + 2.2, 0, 0, 1.0, 2.6, [0, 1]); sign('arrow', -rs * 1.3, RISE + 0.016, TS + 2.2, 0, 0, 1.0, 2.6, [0, -1]);
  // outside: the band over the mouth, the clearance bar, the rate board beside the mouth, the yellow PARK blade standing out from the wall
  const sw = Math.min(mr - ml, 6.2), bandY = Math.min(mh + 0.72, d.sHi - 0.3);
  sign('band', 0, bandY, -0.36, 0, -1, sw, sw * 96 / 1024 * 1.6); box(-sw / 2 - 0.05, sw / 2 + 0.05, bandY - sw * 0.075 - 0.05, bandY + sw * 0.075 + 0.05, -0.35, -0.1, BLK);
  box(ml + 0.3, mr - 0.3, mh - 0.32, mh - 0.14, -0.2, -0.14, YEL); sign('clear', 0, mh - 0.23, -0.205, 0, -1, Math.min(3.2, mr - ml - 0.8), 0.17);
  const side = d.x1 - mr >= 0.95 ? 1 : d.ml - d.x0 >= 0.95 ? -1 : 0, bu = side > 0 ? mr + 0.12 + 0.42 : ml - 0.12 - 0.42;
  if (side) { box(bu - 0.45, bu + 0.45, 0.95, 2.45, -0.135, -0.1, STEEL); sign('rates', bu, 1.7, -0.14, 0, -1, 0.84, 1.4); }
  const bladeTop = Math.min(8.6, d.h - 0.5), bladeH = Math.min(4.2, bladeTop - (d.sHi + 0.2)), pu = (side < 0 ? ml - 0.5 : mr + 0.5);
  if (bladeH > 2.2) { const y0 = bladeTop - bladeH, y1 = bladeTop, w = bladeH / 4;
    box(pu - 0.09, pu + 0.09, y0, y1, -0.3 - w, -0.3, YEL); for (const y of [y0 + 0.3, y1 - 0.3]) box(pu - 0.04, pu + 0.04, y - 0.04, y + 0.04, -0.3, -0.1, STEEL);
    sign('blade', pu + 0.095, (y0 + y1) / 2, -0.3 - w / 2, 1, 0, w - 0.04, bladeH - 0.04); sign('blade', pu - 0.095, (y0 + y1) / 2, -0.3 - w / 2, -1, 0, w - 0.04, bladeH - 0.04); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const tgeo = new THREE.BufferGeometry(); tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3)); tgeo.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3)); tgeo.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  return { geo, tgeo, tris: (pos.length + tpos.length) / 9 };
}

// ------------------------------------------------------------------------------------------------------------------ the layer
export async function addGarages(game, { gars, meshes, ctx }) {
  const t0 = performance.now(), w = game.world, C = game.city, st = game.statics, scene = w.scene, rep = { garages: [], ms: 0, cut: 0, cleared: 0, blocked: {} };
  let hero = []; if (Q.get('hero') !== '0') try { const r = await fetch(ctx.A.replace(/streets\/$/, 'hero/') + 'hero.json'); if (r.ok) hero = (await r.json()).filter((h) => !h.off && h.footprint && h.footprint.length > 2).map((h) => h.footprint); } catch (e) {}
  const list = [];
  for (const d of gars) {
    const room = d.room, ok = room && roomTester(d, C, hero)(room.ua, room.ub, room.D, 1.4), P = ok ? planGarage(d, room, d.h) : null;
    if (!P || !P.ok) { rep.garages.push({ id: d.id, room: null }); console.log('[garages] no room behind ' + d.id); continue; }
    const segs = P.segs.map((s) => [...toSim(d, s[0], s[1]), ...toSim(d, s[2], s[3])]);
    const S = { d, P, segs, built: null, slots: null, man: null, at: toSim(d, 0, 0), mid: toSim(d, (room.ua + room.ub) / 2, -room.D / 2), hole: { d: { ...d, x0: d.ml, x1: d.mr, sLo: d.mh - 0.02 }, doorAt: toSim(d, 0, 0) }, gateSaved: null, had: false };
    S.local = (x, y) => { const q = toLocal(d, x, y); q[1] = -q[1]; return q; };      // -> [u, t]
    if (st && st.addSeg) { rep.cut += cutMouth(st, d); const ow = st.owner; st.owner = null; for (const s of segs) st.addSeg(s[0], s[1], s[2], s[3], undefined, 'garage'); st.owner = ow; }
    list.push(S); rep.garages.push({ id: d.id, at: d.x.toFixed(0) + ',' + d.y.toFixed(0), room: [+(room.ub - room.ua).toFixed(1), room.D], mouth: +(d.mr - d.ml).toFixed(1), stalls: P.stalls.length });
  }
  if (!list.length) return { garages: list, report: rep };

  const tex = new THREE.CanvasTexture(paintGarageAtlas()); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const matFlat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), matTex = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  // shader warm-up: tiny meshes far under the street, so the start screen's compile covers the two materials
  const warm = new THREE.Group(); warm.name = 'garages_warm'; warm.position.set(game.player.x, -60, -game.player.y);
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(6).fill(0), 2));
    for (const m of [matFlat, matTex]) { const o = new THREE.Mesh(g, m); o.frustumCulled = false; warm.add(o); } }
  scene.add(warm); setTimeout(() => { scene.remove(warm); }, 45000);

  // ---- the mouth through the building front: the walk-in shops' cutting material when they are loaded (one program for both), else a copy of our own
  const tileMeshes = () => (w.buildingMeshes || []).filter((m) => m.userData && m.userData.tile);
  let own = null;
  const syncHoles = async () => {
    if (!HOLE) return; const I = game.interiors;
    if (I && I.extraHoles && I.syncHoles && I.hole) { I.extraHoles.length = 0; for (const S of list) if (S.built) I.extraHoles.push(S.hole); I.syncHoles(); return; }
    if (!own) { let facade = null; for (const m of tileMeshes()) if (m.material && m.material.onBeforeCompile && !(m.material.userData && m.material.userData.shopHole)) { facade = m.material; break; } if (!facade) return;
      own = { facade, ...(await import('../interiors/hole.js')).holeMaterial(facade) }; }
    const on = list.filter((S) => S.built).slice(0, 4); own.U.uHoleN.value = on.length;
    on.forEach((S, i) => { const d = S.d; own.U.uHoleA.value[i].set(S.at[0], (0.15 + d.mh - 0.3) / 2, -S.at[1], (d.mr - d.ml) / 2 + 0.04); own.U.uHoleB.value[i].set(d.dx, -d.dy, (d.mh + 0.15 + 0.3) / 2, 0.32); });
    for (const m of tileMeshes()) { const c = m.userData.c; let want = false; if (c) for (const S of on) if (Math.hypot(c[0] - S.at[0], c[1] + S.at[1]) < c[2] + 6) { want = true; break; }
      if (want && m.material !== own.m) { m.userData.__gmat = m.material; m.material = own.m; } else if (!want && m.material === own.m) m.material = m.userData.__gmat || own.facade; }
  };
  const gateMesh = (key) => { const [ti, tj] = key.split(',').map(Number), cx = (ti + 0.5) * TILE, cz = -(tj + 0.5) * TILE; return (meshes || []).find((m) => m.name === 'sf_major' && Math.abs(m.userData.cx - cx) < 1 && Math.abs(m.userData.cz - cz) < 1); };
  const gate = (S, open) => {
    if (open && !S.gateSaved) { const m = gateMesh(S.d.tile); if (!m) return; const A = m.instanceMatrix.array, a = Math.round(S.d.gate); S.gateSaved = [m, a, A.slice(a * 16, a * 16 + 16)]; A.fill(0, a * 16, a * 16 + 16); m.instanceMatrix.needsUpdate = true; }
    else if (!open && S.gateSaved) { const [m, a, saved] = S.gateSaved; m.instanceMatrix.array.set(saved, a * 16); m.instanceMatrix.needsUpdate = true; S.gateSaved = null; }
  };

  // ---- the cars: slot objects of the same shape the street's parked cars have (made once per garage, from kinds and colours the kerbs already use)
  const PK = game.parked, gkey = (s) => Math.floor(s.x / 80) + ',' + Math.floor(s.y / 80);
  const makeSlots = (S) => {
    const d = S.d, pool = PK.slots.filter((s) => s.def && s.def.len <= 5.0 && s.def.wid <= 2.05 && !s.mission && !s.garage && s.type !== 'moto'); if (!pool.length) return [];
    return S.P.stalls.map((q, i) => { const tp = pool[Math.floor(q.r * pool.length) % pool.length], [x, y] = toSim(d, q.u, -q.t), h = simHeading(d, q.du, q.dz);
      const s = { x, y, h, z: FLOOR + q.y, type: tp.type, def: tp.def, color: tp.color, gone: false, circles: [], vseed: (d.bid * 131 + i * 977 + 7) >>> 0, garage: d.id, level: q.level };
      const fx = Math.cos(h), fy = Math.sin(h), o = s.def.len * 0.27; for (const k of [o, -o]) { const c = st.addCircle(x + fx * k, y + fy * k, s.def.wid * 0.5, s); c.on = false; s.circles.push(c); } return s; });
  };
  const slotsIn = (S, on) => {
    if (on && !S.slots) S.slots = makeSlots(S); if (!S.slots) return;
    for (const s of S.slots) { for (const c of s.circles) c.on = on && !s.gone; const k = gkey(s); let a = PK.grid.get(k), i = PK.slots.indexOf(s);
      if (on) { if (i < 0) PK.slots.push(s); if (!a) PK.grid.set(k, (a = [])); if (!a.includes(s)) a.push(s); }
      else { if (i >= 0) PK.slots.splice(i, 1); if (a) { const j = a.indexOf(s); if (j >= 0) a.splice(j, 1); } } }
    S.grid = PK.grid;
  };
  // ---- the attendant: one of the game's own people, standing by the booth
  const man = (S, on) => {
    if (!on) { if (S.man) { const v = S.man; if (v.mixer) v.mixer.stopAllAction(); scene.remove(v.object); S.man = null; } return; }
    if (!MAN || S.man || !game.kit || !game.kit.person || !game.kit.pedKinds) return; const kinds = game.kit.pedKinds(); if (!kinds.length) return;
    const v = game.kit.person(kinds[(S.d.bid * 3 + 1) % kinds.length]); if (!v) return; const b = S.P.booth, [x, y] = toSim(S.d, b.side > 0 ? b.u0 - 0.5 : b.u1 + 0.5, -(b.t0 + 0.8));
    v.object.traverse((c) => { if (c.isMesh) c.castShadow = false; }); v.object.position.set(x, FLOOR, -y); v.object.rotation.set(0, simHeading(S.d, 0, 1), 0); scene.add(v.object);
    const a = v.acts && (v.acts.idle || Object.values(v.acts)[0]); if (a) a.reset().play(); if (v.mixer) v.mixer.setTime(S.d.bid % 5); S.man = v; S.manAt = [x, y];
  };

  const build = (S) => {
    const t = performance.now(), d = S.d, r = buildGeo(d, S.P), grp = new THREE.Group(); grp.name = 'garage_' + d.id; grp.position.set(d.x, FLOOR, -d.y); grp.matrixAutoUpdate = false; grp.updateMatrix();
    const a = new THREE.Mesh(r.geo, matFlat), b = new THREE.Mesh(r.tgeo, matTex); a.name = 'gar_static'; b.name = 'gar_signs'; for (const m of [a, b]) { m.matrixAutoUpdate = false; m.frustumCulled = false; grp.add(m); }
    scene.add(grp); grp.updateMatrixWorld(true);
    S.built = { grp, geos: [r.geo, r.tgeo], tris: r.tris, ms: 0 }; gate(S, true); slotsIn(S, true); man(S, true); syncHoles();
    S.built.ms = +(performance.now() - t).toFixed(1); rep.lastBuild = { id: d.id, ms: S.built.ms, tris: r.tris, cars: S.slots ? S.slots.length : 0 };
  };
  const drop = (S) => { if (!S.built) return; scene.remove(S.built.grp); for (const g of S.built.geos) g.dispose(); S.built = null; gate(S, false); slotsIn(S, false); man(S, false); syncHoles(); };

  // ---- once, at the first step (the kerbs' parked cars exist by then): no parked car across a garage mouth; what else stands in the way is reported
  let first = true, heatDone = false;
  const firstStep = () => {
    first = false;
    for (const S of list) { const d = S.d, hw = (d.mr - d.ml) / 2 + 1.6, far = Math.min(14, (d.kd || 4) + 4.5);
      for (const s of PK.near(S.at[0], S.at[1], 30)) { if (s.garage || s.mission) continue; const [u, z] = toLocal(d, s.x, s.y); if (Math.abs(u) < hw + (s.def ? s.def.len / 2 : 2.4) && z > 0 && z < far) { PK.take(s); rep.cleared++; } }
      const c = st.cell, tags = {}; for (let i = Math.floor((S.at[0] - 16) / c); i <= Math.floor((S.at[0] + 16) / c); i++) for (let j = Math.floor((S.at[1] - 16) / c); j <= Math.floor((S.at[1] + 16) / c); j++) { const a = st.circ.get(st.key(i, j)); if (a) for (const o of a) { if (!o.on || (o.tag && typeof o.tag === 'object')) continue; const [u, z] = toLocal(d, o.x, o.y); if (Math.abs(u) < (d.mr - d.ml) / 2 + 0.3 + o.r && z > 0.2 && z < far - 2) tags[o.tag || '?'] = (tags[o.tag || '?'] || 0) + 1; } }
      if (Object.keys(tags).length) rep.blocked[d.id] = tags; }
  };
  const hookHeat = () => { const H = game.combat && game.combat.heat; if (!H || !H.wall || !H.wall.addSeg) return; heatDone = true; try { for (const S of list) { cutMouth(H.wall, S.d); for (const s of S.segs) H.wall.addSeg(s[0], s[1], s[2], s[3]); } rep.heat = true; } catch (e) { rep.heat = String(e && e.message); } };

  // ---- every step: build / drop by distance; inside a built garage the floor's height for the player's cars and for the player on foot
  const tilted = [], RAMP_A = Math.atan(K.RISE / K.RAMP);
  const before = () => { for (const v of tilted) { v.pitch -= v._gp || 0; v._gp = 0; } tilted.length = 0; };
  const after = (dt) => {
    if (first) firstStep(); if (!heatDone) hookHeat();
    const pl = game.player, cam = w.camera.position, fx = game.focus ? game.focus.x : pl.x, fy = game.focus ? game.focus.y : pl.y;
    for (const S of list) {
      const [mx, my] = S.mid, dist = Math.min(Math.hypot(fx - mx, fy - my), Math.hypot(cam.x - mx, -cam.z - my), Math.hypot(fx - S.at[0], fy - S.at[1]));
      if (!S.built && dist < NEAR) build(S); else if (S.built && dist > FAR) { drop(S); if (S.had) { S.had = false; if (!pl.roof && !(game.subway && game.subway.own)) pl.alt = 0; } continue; }
      if (!S.built) continue;
      if (S.grid !== PK.grid) slotsIn(S, true);      // the kerbs were laid out again (a map area arrived): our cars go back in
      if (dist > S.d.room.D + 30) continue;
      const P = S.P;
      for (const v of game.vehicles) { const [u, t] = S.local(v.x, v.y); if (!P.inside(u, t)) continue; const h = P.height(u, t); if (h === null) continue;
        v.z = FLOOR + h; if (P.onRamp(u, t)) { v._gp = -RAMP_A * (Math.cos(v.h) * S.d.nx + Math.sin(v.h) * S.d.ny); v.pitch += v._gp; tilted.push(v); } }
      if (!pl.roof && !(game.subway && game.subway.own)) { const [u, t] = S.local(pl.x, pl.y), h = P.inside(u, t) ? P.height(u, t) : null;
        if (h !== null) { pl.alt = FLOOR + h; S.had = true; } else if (S.had) { S.had = false; pl.alt = 0; } }
      if (S.man && S.man.mixer && dist < 45) S.man.mixer.update(dt);
      if (S.man && !pl.vehicle && !pl.busy) { const ex = pl.x - S.manAt[0], ey = pl.y - S.manAt[1], e = Math.hypot(ex, ey); if (e < 0.5 && e > 1e-3) { pl.x = S.manAt[0] + ex / e * 0.5; pl.y = S.manAt[1] + ey / e * 0.5; } }
    }
  };
  const step0 = game.step.bind(game);
  game.step = function (dt) { try { before(); } catch (e) {} step0(dt); try { after(dt); } catch (e) { if (!rep.err) { rep.err = String(e && (e.stack || e.message)); console.log('[garages] step: ' + rep.err); } } };
  // the player on foot is drawn on the floor he stands on (and gets into a car from that floor, not from the street's height)
  const sync0 = game.syncVisuals.bind(game);
  game.syncVisuals = function (dt) { sync0(dt); try { const pl = game.player; if (pl.vehicle || !(pl.alt > 0.16) || pl.roof || !list.some((S) => S.had)) return; const o = pl.vis.object, J = game.jump;
    if (pl.busy) { const v = pl.busy.v, top = v ? (v.z || 0) + 0.45 : 1; o.position.y += (pl.alt) * (1 - Math.min(1, Math.max(0, (pl.busy.z || 0) / Math.max(0.3, top)))); }
    else if (!(J && J.core && J.core.own) && o.position.y < pl.alt - 0.01) o.position.y = pl.alt; } catch (e) {} };

  rep.ms = Math.round(performance.now() - t0);
  console.log('[garages] ' + list.length + ' garages: ' + rep.garages.map((g) => g.id + (g.room ? ' ' + g.room[0] + 'x' + g.room[1] + ' m, ' + g.stalls + ' cars' : ' NO ROOM')).join('; ') + '; walls cut ' + rep.cut + '; ' + rep.ms + ' ms');
  return {
    garages: list, report: rep, matFlat, matTex,
    cost() { return list.map((S) => ({ id: S.d.id, built: !!S.built, draws: S.built ? 2 : 0, tris: S.built ? S.built.tris : 0, cars: S.slots ? S.slots.filter((s) => !s.gone).length : 0, buildMs: S.built ? S.built.ms : null })); },
    // tests: a point of garage i in map metres (u along the wall, t in from the wall line; t < 0 = out on the street), and a heading in its frame
    at(i, u, t) { return toSim(list[i].d, u, -t); }, heading(i, du, dt) { return simHeading(list[i].d, du, -dt); }, height(i, x, y) { const [u, t] = list[i].local(x, y); return list[i].P.height(u, t); },
    dropAll() { for (const S of list) drop(S); },
  };
}
