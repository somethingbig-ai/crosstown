// surprises/slice.js: a dollar slice you pick up, that folds and drips (surprises lane, Nov 15; Matt's list, item 9).
// On the counter of the slice shop (the shops lane's pizza interior) a hot slice waits on a paper plate. E takes it, and for as long as you
// hold it you see it in your own hand:
//   - it is a soft sheet, not a board: lifted flat by the crust it sags, the point hanging; fold the crust (the hand does, the New York
//     way) and the same sheet stiffens along its length and the point comes up. Nothing here is keyed: the slice is a small cloth body
//     (points, stretch and bend limits, gravity) and the fold is only the two crust corners brought together;
//   - it swings and lags as you walk and turn;
//   - orange grease gathers in the fold, runs to the point and drips off, a drop at a time;
//   - E takes a bite (three and it is gone): the point goes, the cheese strings stretch and let go.
//   ?slice=0 off     game.surprises.mods.slice.info()
// Cost: nothing unless the pizza shop is within 40 m. Holding: 4 draws (slice top and underside, hand, strings), a 77-point body.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU } from './kit.js';

// ------------------------------------------------------------------------------------------------ the body
// rows from the crust (0) to the point (NR), NC+1 points across each. Local frame of the hand: x across the slice, y up, z from the crust to the point.
export const NR = 10, NC = 6, LEN = 0.265, WID = 0.2;
export class SliceBody {
  constructor() {
    const n = (NR + 1) * (NC + 1); this.n = n; this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3); this.rest = new Float32Array(n * 3); this.w = new Float32Array(n); this.cons = []; this.fold = 0; this.rows = NR;
    for (let i = 0; i <= NR; i++) for (let j = 0; j <= NC; j++) { const k = i * (NC + 1) + j, wd = WID * (1 - i / NR) + 0.006; this.rest[k * 3] = (j / NC - 0.5) * wd; this.rest[k * 3 + 1] = 0; this.rest[k * 3 + 2] = (i / NR) * LEN; this.w[k] = i <= 1 ? 0 : 1; }
    this.p.set(this.rest); this.q.set(this.rest);
    const id = (i, j) => i * (NC + 1) + j, add = (a, b, st) => { const dx = this.rest[a * 3] - this.rest[b * 3], dz = this.rest[a * 3 + 2] - this.rest[b * 3 + 2]; this.cons.push([a, b, Math.hypot(dx, dz), st, Math.max(Math.floor(a / (NC + 1)), Math.floor(b / (NC + 1)))]); };
    for (let i = 0; i <= NR; i++) for (let j = 0; j <= NC; j++) { if (j < NC) add(id(i, j), id(i, j + 1), 1); if (i < NR) add(id(i, j), id(i + 1, j), 1); if (i < NR && j < NC) { add(id(i, j), id(i + 1, j + 1), 0.9); add(id(i, j + 1), id(i + 1, j), 0.9); }
      if (j + 2 <= NC) add(id(i, j), id(i, j + 2), 0.05); }      // (a weak pull back to flat across the slice)
    // bending along the length is not a link but a beam: each run of three points down a column is pulled straight with a stiffness that depends on the
    // SHAPE of the slice's cross-section there, as a real beam's does: flat, the section is a thin strip (kF, weak: it sags); folded to a V, the
    // section is deep (kF + kV * rise^2, strong: it holds). rise = how far the edges stand above the middle, per half width.
    this.kF = 0.82; this.kV = 2;      /* tuned in node (tests/slicetune.mjs): flat, the point hangs 12 cm below the crust; folded, 4 cm */ this.sec = new Float32Array(NR + 1);
  }
  // the crust as the hand holds it: flat, or folded to a V by angle `fold` (radians each side)
  pin() { const f = this.fold; for (let i = 0; i <= 1; i++) for (let j = 0; j <= NC; j++) { const k = (i * (NC + 1) + j) * 3, x = this.rest[k], a = Math.abs(x); this.p[k] = Math.sign(x) * a * Math.cos(f); this.p[k + 1] = a * Math.sin(f); this.p[k + 2] = this.rest[k + 2]; } }
  // g: gravity in the hand's frame (m/s2); acc: the hand's own acceleration felt by the slice
  step(dt, gx, gy, gz, iters = 14) {
    const { p, q, w, n } = this, damp = Math.pow(0.02, dt);
    for (let k = 0; k < n; k++) { if (!w[k]) continue; const o = k * 3, vx = (p[o] - q[o]) * damp, vy = (p[o + 1] - q[o + 1]) * damp, vz = (p[o + 2] - q[o + 2]) * damp; q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2]; p[o] += vx + gx * dt * dt; p[o + 1] += vy + gy * dt * dt; p[o + 2] += vz + gz * dt * dt; }
    this.pin();
    for (let it = 0; it < iters; it++) { for (const c of this.cons) { if (c[4] > this.rows) continue; const a = c[0] * 3, b = c[1] * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], d = Math.hypot(dx, dy, dz) || 1e-9, wa = w[c[0]], wb = w[c[1]], ws = wa + wb; if (!ws) continue;
      const k = ((d - c[2]) / d) * c[3] / ws; p[a] += dx * k * wa; p[a + 1] += dy * k * wa; p[a + 2] += dz * k * wa; p[b] -= dx * k * wb; p[b + 1] -= dy * k * wb; p[b + 2] -= dz * k * wb; }
      this.beam(); }
  }
  beam() { const { p, w, sec } = this, R = Math.min(this.rows, NR), C1 = NC + 1, mid = NC >> 1;
    for (let i = 0; i <= R; i++) { const o = i * C1 * 3, e0 = o, e1 = o + NC * 3, m = o + mid * 3, hw = Math.hypot(p[e1] - p[e0], p[e1 + 1] - p[e0 + 1], p[e1 + 2] - p[e0 + 2]) * 0.5; if (hw < 0.012) { sec[i] = i ? sec[i - 1] : 0; continue; }
      // the depth of the section: how far the edges' midpoint is from the middle point, across the slice's own surface
      const dx = (p[e0] + p[e1]) / 2 - p[m], dy = (p[e0 + 1] + p[e1 + 1]) / 2 - p[m + 1], dz = (p[e0 + 2] + p[e1 + 2]) / 2 - p[m + 2]; sec[i] = Math.min(1, Math.hypot(dx, dy, dz) / hw); }
    for (let i = 1; i < R; i++) { const k = Math.min(0.985, this.kF + this.kV * sec[i - 1] * sec[i - 1]); for (let j = 0; j <= NC; j++) { const a = ((i - 1) * C1 + j) * 3, m = (i * C1 + j) * 3, b = ((i + 1) * C1 + j) * 3, wa = w[(i - 1) * C1 + j], wm = w[i * C1 + j], wb = w[(i + 1) * C1 + j];
        const den = 0.25 * wa + 0.25 * wb + wm; if (!den) continue; for (let q = 0; q < 3; q++) { const d = ((p[a + q] + p[b + q]) / 2 - p[m + q]) * k / den; p[m + q] += d * wm; p[a + q] -= d * 0.5 * wa; p[b + q] -= d * 0.5 * wb; } } }
  }
  tip(out = [0, 0, 0]) { const i = Math.min(this.rows, NR), a = (i * (NC + 1)) * 3, b = (i * (NC + 1) + NC) * 3; out[0] = (this.p[a] + this.p[b]) / 2; out[1] = (this.p[a + 1] + this.p[b + 1]) / 2; out[2] = (this.p[a + 2] + this.p[b + 2]) / 2; return out; }
}

// ------------------------------------------------------------------------------------------------ how it looks
function topArt() { const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'); let sd = 4242; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  // melted low-moisture mozzarella over a thin red sauce: pale yellow-white, mottled with orange where the oil sits, a few browned bubbles
  g.fillStyle = '#f1c86a'; g.fillRect(0, 0, S, S);
  const soft = (x, y, rr, c0, c1) => { const gr = g.createRadialGradient(x, y, 0, x, y, rr); if (!gr) { g.fillStyle = c0; } else { gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; } g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); };
  for (let k = 0; k < 260; k++) soft(r() * S, 60 + r() * (S - 60), 14 + r() * 34, 'rgba(250,232,170,0.55)', 'rgba(250,232,170,0)');
  for (let k = 0; k < 150; k++) soft(r() * S, 64 + r() * (S - 64), 8 + r() * 22, 'rgba(236,150,48,0.4)', 'rgba(236,150,48,0)');
  for (let k = 0; k < 40; k++) soft(r() * S, 66 + r() * (S - 66), 5 + r() * 12, 'rgba(206,74,30,0.42)', 'rgba(206,74,30,0)');      // sauce showing through
  for (let k = 0; k < 26; k++) { const x = r() * S, y = 80 + r() * (S - 90), rr = 4 + r() * 9; soft(x, y, rr, 'rgba(150,84,30,0.55)', 'rgba(150,84,30,0)'); }      // browned bubbles
  for (let k = 0; k < 50; k++) { g.fillStyle = 'rgba(60,78,34,0.5)'; g.fillRect(r() * S, 70 + r() * (S - 70), 2 + r() * 2, 1 + r() * 2); }
  g.fillStyle = '#c4491f'; g.fillRect(0, 52, S, 9);      // the sauce line under the crust
  const cg = g.createLinearGradient(0, 0, 0, 54); if (cg) { cg.addColorStop(0, '#b97a36'); cg.addColorStop(0.5, '#dda95c'); cg.addColorStop(1, '#cf9145'); g.fillStyle = cg; } else g.fillStyle = '#cf9145'; g.fillRect(0, 0, S, 54);
  for (let k = 0; k < 30; k++) soft(r() * S, r() * 50, 4 + r() * 10, 'rgba(110,62,22,0.4)', 'rgba(110,62,22,0)');
  return cv; }
function underArt() { const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'); let sd = 99; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; }; g.fillStyle = '#c99a58'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 500; k++) { g.fillStyle = ['rgba(235,215,170,0.5)', 'rgba(120,72,30,0.35)', 'rgba(70,40,18,0.28)'][k % 3]; g.beginPath(); g.arc(r() * S, r() * S, 1 + r() * 7, 0, TAU); g.fill(); } return cv; }
const THICK = (i) => (i === 0 ? 0.013 : i === 1 ? 0.0095 : 0.0042);

export function install(game, kit) {
  const g = game, w = g.world;
  const S = { state: 'none', shop: null, spot: null, t: 0, bites: 0, taken: 0, drips: 0, ms: 0, body: null, tune: { fold: 0.82 } };
  let rig = null, counter = null, ps = null, voice = null; const L3 = [0, 0, 0], _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), tipL = [0, 0, 0];

  // ---- the slice shop and the spot on its counter
  function findShop() { const I = g.interiors; if (!I || !I.shops) return null; for (const sh of I.shops) { if (!sh.d || sh.d.kind !== 'pizza' || !sh.plan || !sh.plan.items) continue; const it = sh.plan.items.find((q) => q.m === 'pizzaCase'); if (!it) continue; const b = it.box, u = b[1] + 0.17, z = b[5] - 0.22, d = sh.d;
      const at = (uu, zz) => [d.x + uu * d.dx + zz * d.nx, d.y + uu * d.dy + zz * d.ny], pos = at(u, z), stand = at(u, b[5] + 0.75); return { sh, x: pos[0], y: pos[1], h: b[2] + 0.004 + (d.z0 || 0), sx: stand[0], sy: stand[1], face: Math.atan2(-d.ny, -d.nx) }; } return null; }
  const flatSlice = (mats) => { const b = new SliceBody(), geo = sliceGeo(); fill(geo, b); const G = new THREE.Group(); G.add(new THREE.Mesh(geo.top, mats.top), new THREE.Mesh(geo.under, mats.under)); return G; };
  let mats = null;
  const mkMats = () => mats || (mats = { top: new THREE.MeshStandardMaterial({ map: tex(topArt()), roughness: 0.38, metalness: 0 }), under: new THREE.MeshStandardMaterial({ map: tex(underArt()), roughness: 0.85 }), plate: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 }), skin: new THREE.MeshStandardMaterial({ color: 0xb8805f, roughness: 0.65 }), cheese: new THREE.MeshStandardMaterial({ color: 0xf0c060, roughness: 0.4 }) });
  const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  // two skins on the same points: top (cheese) lifted by the thickness along the normal, underside (crust) at the points; a rim joins them
  function sliceGeo() { const n = (NR + 1) * (NC + 1), mk = (flip) => { const ge = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = []; for (let i = 0; i <= NR; i++) for (let j = 0; j <= NC; j++) { const k = i * (NC + 1) + j; uv[k * 2] = 0.5 + (j / NC - 0.5) * (1 - i / NR); uv[k * 2 + 1] = 1 - i / NR; }
      for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) { const a = i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1; if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
      ge.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); ge.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); ge.setIndex(idx); return ge; };
    return { top: mk(false), under: mk(true) }; }
  function fill(geo, b) { const P = geo.under.attributes.position.array, T = geo.top.attributes.position.array; P.set(b.p); geo.under.attributes.position.needsUpdate = true; geo.under.computeVertexNormals(); const N = geo.under.attributes.normal.array;
    for (let i = 0; i <= NR; i++) for (let j = 0; j <= NC; j++) { const k = (i * (NC + 1) + j) * 3, th = THICK(i) * (j === 0 || j === NC ? 0.25 : 1); T[k] = P[k] - N[k] * th; T[k + 1] = P[k + 1] - N[k + 1] * th; T[k + 2] = P[k + 2] - N[k + 2] * th; }
    geo.top.attributes.position.needsUpdate = true; geo.top.computeVertexNormals(); const dr = Math.max(0, Math.min(NR, b.rows)) * NC * 6; geo.top.setDrawRange(0, dr); geo.under.setDrawRange(0, dr); }
  function mkCounter(spot) { const M = mkMats(), G = new THREE.Group(); G.name = 'sur_slice_counter'; const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.008, 28), M.plate); plate.position.y = 0.004; G.add(plate); const sl = flatSlice(M); sl.position.set(0, 0.012, -0.13); sl.name = 'slice'; G.add(sl);
    G.position.set(spot.x, spot.h, -spot.y); G.rotation.y = spot.face + Math.PI / 2 + 0.5; G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); w.scene.add(G); return G; }
  // the held slice: a group that rides the camera; the hand: palm and fingers under the crust, the thumb on top
  function mkRig() { const M = mkMats(), G = new THREE.Group(); G.name = 'sur_slice_held'; const geo = sliceGeo(), top = new THREE.Mesh(geo.top, M.top), under = new THREE.Mesh(geo.under, M.under); top.frustumCulled = under.frustumCulled = false; G.add(top, under);
    const hand = new THREE.Group(), cap = (r, l) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), M.skin), put = (m, x, y, z, rx, ry, rz) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); hand.add(m); return m; };
    put(cap(0.0105, 0.034), 0.02, 0.019, 0.014, Math.PI / 2, 0, 0.9);      // the thumb, lying across the top of the crust at its edge
    put(cap(0.028, 0.03), 0.0, -0.045, 0.0, Math.PI / 2, 0, 0); put(cap(0.026, 0.22), 0.03, -0.13, -0.1, Math.PI / 2 - 0.9, 0, -0.2);      // the fingers and palm are a pad under the crust (hidden by the slice from above); the forearm drops away below the picture
    G.add(hand); const strings = new THREE.Mesh(new THREE.BufferGeometry(), M.cheese); strings.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage)); strings.frustumCulled = false; strings.visible = false; G.add(strings);
    G.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.renderOrder = 8; } }); G.matrixAutoUpdate = false; w.scene.add(G); return { G, geo, hand, strings }; }

  function take() { S.state = 'held'; S.t = 0; S.bites = 0; S.taken++; S.body = new SliceBody(); S.body.fold = 0; if (!rig) rig = mkRig(); rig.G.visible = true; S.grease = 0; S.biteT = -1; S.sway = [0, 0]; S.yaw0 = g.cam.yaw; if (counter) { const sl = counter.getObjectByName('slice'); if (sl) sl.visible = false; S.back = 40; }
    const v = (voice = voice || kit.voice({ ref: 1, max: 12, level: 0.6 })); if (v) kit.burst(v, { type: 'highpass', freq: 3000, q: 0.5, gain: 0.25, att: 0.01, dec: 0.12 }); }
  function drop() { S.state = 'none'; if (rig) rig.G.visible = false; g.player.vis.object.visible = true; S.body = null; }

  kit.onFrame((dt, t) => {
    const t0 = performance.now(), pl = g.player;
    if (S.state === 'none') {
      if (!S.spot) { S.chk = (S.chk || 0) - dt; if (S.chk > 0) return; S.chk = 2; S.spot = findShop(); if (!S.spot) return; }
      const sp = S.spot, d = Math.hypot(sp.x - pl.x, sp.y - pl.y); if (d > 40) { if (counter) counter.visible = false; return; }
      if (!counter) counter = mkCounter(sp); counter.visible = true; if (S.back > 0) { S.back -= dt; if (S.back <= 0) { const sl = counter.getObjectByName('slice'); if (sl) sl.visible = true; } }
      const there = counter.getObjectByName('slice'); if (d < 1.9 && kit.onFoot() && there && there.visible && Math.hypot(sp.sx - pl.x, sp.sy - pl.y) < 1.6) { kit.prompt('take a slice'); if (kit.use()) take(); }
      return; }
    // ---- in the hand
    if (!kit.onFoot()) { drop(); return; }
    S.t += dt; const b = S.body, cam = w.camera, C = g.cam;
    // your own eyes: the camera is put at the player's head, the body is not drawn
    pl.vis.object.visible = false; const eye = 1.62 + (pl.alt || (g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0)), pitch = clamp(-C.pitch * 0.9 - 0.12, -1.2, 1.2), cy = Math.cos(C.yaw), sy = Math.sin(C.yaw);
    cam.position.set(pl.x + cy * 0.08, eye, -(pl.y + sy * 0.08)); cam.lookAt(pl.x + cy * 10 * Math.cos(pitch), eye + 10 * Math.sin(pitch), -(pl.y + sy * 10 * Math.cos(pitch))); cam.updateMatrixWorld();
    if (dt > 0) {
      // the hand's programme: lift it flat (it sags), then fold it (it comes up); afterwards the fold eases a little as you walk
      b.fold = S.tune.fold * smooth(1.25, 2.05, S.t) * (S.biteT >= 0 ? 1 : 1 - 0.08 * Math.sin(S.t * 0.9));
      // gravity in the hand's frame, plus the lag from walking and turning
      const yawV = (C.yaw - S.yaw0) / dt; S.yaw0 = C.yaw; S.sway[0] += (clamp(-yawV * 0.6, -3, 3) - S.sway[0]) * Math.min(1, dt * 6); const walk = pl.speed || 0, bob = Math.sin(S.t * (walk > 3 ? 11 : 7.2)) * Math.min(1, walk / 2) * 1.6;
      const tilt = -0.2 + pitch * 0.25, gy = -9.81 * Math.cos(tilt) + bob, gz = 9.81 * Math.sin(tilt) * 0.3; for (let k = 0; k < 2; k++) b.step(Math.min(dt, 1 / 30) / 2, S.sway[0], gy, gz);
      // a bite: up to the mouth, the point goes, strings
      if (S.biteT >= 0) { S.biteT += dt; if (S.biteT > 0.42 && !S.bit) { S.bit = true; S.bites++; b.rows = NR - S.bites * 3; if (voice) { kit.burst(voice, { type: 'lowpass', freq: 700, q: 0.7, gain: 0.5, att: 0.01, dec: 0.1 }); kit.burst(voice, { type: 'bandpass', freq: 1800, q: 1, gain: 0.2, att: 0.005, dec: 0.06, at: 0.05 }); } } if (S.biteT > 1.25) { S.biteT = -1; S.bit = false; if (S.bites >= 3) { drop(); return; } } }
      else if (S.t > 3.2) { kit.prompt(S.bites ? 'another bite' : 'take a bite'); if (kit.use()) { S.biteT = 0; S.bit = false; } }
      // grease: gathers in the fold once it is folded, runs to the point, lets go
      if (b.fold > 0.4 && S.biteT < 0) { S.grease += dt * (0.34 + 0.2 * Math.sin(S.t * 0.7)); if (S.grease >= 1) { S.grease = 0; S.drips++; S.dripNow = true; } }
    }
    // where the hand is in the picture: centred and close while it is being shown off, then low on the right
    const show = 1 - smooth(2.6, 3.6, S.t), bt = S.biteT >= 0 ? Math.sin(Math.min(1, S.biteT / 0.84) * Math.PI) : 0, hx = lerp(0.1, 0.02, show) - 0.07 * bt, hy = lerp(-0.165, -0.13, show) + 0.09 * bt, hz = -(lerp(0.34, 0.3, show) - 0.16 * bt), lift = smooth(0, 0.5, S.t);
    rig.G.matrix.compose(_v.set(hx, hy - (1 - lift) * 0.12, hz), _q.setFromEuler(new THREE.Euler(-0.5 - 0.5 * bt - (1 - lift) * 0.2, Math.PI + lerp(0.45, 0.2, show), 0, 'YXZ'))      /* tipped toward the eye: you look down onto the cheese */, new THREE.Vector3(1, 1, 1)); rig.G.matrix.premultiply(cam.matrixWorld); rig.G.matrixWorldNeedsUpdate = true;
    fill(rig.geo, b);
    // the fingers close with the fold
    rig.hand.children[0].position.y = 0.019 + b.fold * 0.01;
    // strings of cheese for half a second after the bite
    const st = rig.strings; if (S.bit && S.biteT < 1.0) { const u = (S.biteT - 0.42) / 0.5, P = st.geometry.attributes.position.array, tp = b.tip(tipL); let o = 0; for (let k = 0; k < 4; k++) { const x = tp[0] + (k - 1.5) * 0.012, wdt = 0.0022 * Math.max(0, 1 - u * (1.2 + k * 0.25)), len = 0.02 + u * 0.09, sag = -0.03 * u * u; const A = [x - wdt, tp[1], tp[2]], B = [x + wdt, tp[1], tp[2]], Cc = [x + wdt * 0.4, tp[1] + 0.03 * u + sag, tp[2] + len], D = [x - wdt * 0.4, tp[1] + 0.03 * u + sag, tp[2] + len]; for (const q of [A, B, Cc, A, Cc, D]) { P[o++] = q[0]; P[o++] = q[1]; P[o++] = q[2]; } } st.geometry.attributes.position.needsUpdate = true; st.geometry.computeVertexNormals(); st.visible = u < 1; } else st.visible = false;
    // a drop lets go of the point
    if (!ps) ps = kit.particles({ max: 40, kind: 'drop', blending: 'mix', stretch: 0.012, order: 9, name: 'sur_slice_grease' });
    if (S.dripNow) { S.dripNow = false; const tp = b.tip(tipL); _v.set(tp[0], tp[1] - 0.004, tp[2]).applyMatrix4(rig.G.matrix); ps.emit(_v.x, -_v.z, _v.y, 0, 0, -0.05, { life: 1.6, s0: 0.0045, s1: 0.0035, r: 0.93, g: 0.42, b: 0.06, a: 0.95, grav: 9.81, drag: 0, fin: 0.02, floor: (pl.alt || 0) + 0.02 }); }
    if (dt > 0) ps.step(dt); kit.light(0.9, L3); ps.draw(L3);
    S.ms = S.ms * 0.95 + (performance.now() - t0) * 0.05;
  }, 'slice');

  S.info = () => { const b = S.body, tp = b ? b.tip() : null; return { state: S.state, shop: !!S.spot, spot: S.spot ? [+S.spot.x.toFixed(1), +S.spot.y.toFixed(1), +S.spot.h.toFixed(2)] : null, t: +S.t.toFixed(1), fold: b ? +b.fold.toFixed(2) : 0, tipDrop: tp ? +(-tp[1]).toFixed(3) : 0, bites: S.bites, taken: S.taken, drips: S.drips, ms: +S.ms.toFixed(3) }; };
  S.take = take; S.drop = drop; S.find = () => (S.spot = S.spot || findShop());
  return S;
}

// stand the player at the slice shop's counter (or, where there is no slice shop on this map, hand him a slice where he stands)
export function show(game, kit, S) {
  const pl = game.player, sp = S.find(); if (pl.vehicle) { pl.vehicle = null; pl.vis.object.visible = true; game.cam.mode = 'foot'; }
  if (sp) { pl.x = sp.sx; pl.y = sp.sy; pl.h = sp.face; game.focus.x = pl.x; game.focus.y = pl.y; game.cam.yaw = pl.h; game.snapCamera(); return sp; }
  S.take(); return true;
}
