// surprises/hydrant.js: an open fire hydrant (surprises lane, helper "water", Nov 15).
// Shoot any street hydrant: the cap blows off and a hard white jet leaves the side nozzle across the street, arcs down and lands in a churn.
// Hit one with the car at 18 km/h or more: it shears off, lies nearby, and a geyser several storeys high falls back as rain round the stump.
// Either way mist drifts downwind, a sheet of water spreads on the roadway and runs along the gutter (hydrant-water.js), the jet roars, kids
// come running and play in it, walkers skirt it or hurry through, cars throw spray and the player's car aquaplanes in the water. It runs
// TUNE.run seconds, weakens, stops; the road dries slowly.
//   ?hydrant=0 off (index.js)   ?surshow=hydrant [&hydshow=geyser]   game.surprises.mods.hydrant.openHydrant(i, 'jet' | 'geyser') / .info()
// Nothing of anyone else's is edited: game.combat.hit is wrapped on the instance (a bullet that ends on a static circle tagged 'hydrant'),
// the car is tested against the hydrants of its own 24 m cell once a step while the player drives, traffic.gapAhead is wrapped the first time
// a child stands on the roadway (cars wait for them, as they do for the crowd). Closed and not driving: one comparison a step.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU } from './kit.js';
import { makeSheet, aquaplane, waterLook } from './hydrant-water.js';

const TUNE = { run: 150, fade: 25, dry: 240, v0: 13.5, elev: 0.16, up: 16, mist: 0.03, kids: 3, grown: 1, breakSpeed: 5, light: 1.0, lamp: 0.38, far: 230, vol: 0.9 };
const G = 9.81, CELL = 24;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _o = {}, ID = new THREE.Quaternion();
const hsh = (a, b = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233 + 0.5) * 43758.5453; return s - Math.floor(s); };

export function install(game, kit) {
  const g = game, st = g.statics, P = g.P || new URLSearchParams(''), list = (g.city && g.city.props && g.city.props.hydrant) || [];
  const S = { open: [], road: [], opened: 0, shot: 0, sheared: 0, hurried: 0, skirted: 0, sprayCars: 0, aqK: 0, aqMax: 0, ms: 0, tune: TUNE, list };
  for (const k in TUNE) if (P.has('hyd_' + k)) TUNE[k] = +P.get('hyd_' + k);
  S.info = () => ({ hydrants: list.length, open: S.open.map((o) => ({ i: o.i, mode: o.mode, T: +o.T.toFixed(1), pr: +o.pr.toFixed(2), kids: o.kids.length, hid: o.hid.length, body: !!o.body, len: +o.len.toFixed(1), wid: +o.wid.toFixed(1), range: +o.range.toFixed(1) })), opened: S.opened, shot: S.shot, sheared: S.sheared, hurried: S.hurried, skirted: S.skirted, sprayCars: S.sprayCars, aqK: +S.aqK.toFixed(2), aqMax: +S.aqMax.toFixed(2), puffs: R ? R.puff.n : 0, drops: R ? R.drop.n : 0, ms: +S.ms.toFixed(3), hook: !!(g.combat && g.combat.__hydHook) });
  if (!list.length || !st) { S.why = 'no hydrants on this map'; return S; }
  const grid = new Map(), gk = (x, y) => Math.floor(x / CELL) * 100003 + Math.floor(y / CELL);
  list.forEach((p, i) => { const k = gk(p[0], p[1]); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); });
  S.nearest = (x, y, r = 30) => { let best = -1, bd = r * r; const n = Math.ceil(r / CELL); for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) { const L = grid.get(gk(x + a * CELL, y + b * CELL)); if (L) for (const i of L) { const d = (list[i][0] - x) ** 2 + (list[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } } } return best; };

  // ---------------------------------------------------------------- what is made the first time a hydrant opens
  let R = null;
  const res = () => { if (R) return R; R = { puff: kit.particles({ max: 1900, kind: 'puff', blending: 'mix', order: 6, name: 'sur_hydrant_water' }), drop: kit.particles({ max: 3200, kind: 'drop', blending: 'mix', stretch: 0.022, order: 7, name: 'sur_hydrant_drops' }), sheet: makeSheet(g, kit, 2), L: [1, 1, 1], boxes: [], nb: 0 };
    waterLook(R.puff, { stretch: 0.03 }); waterLook(R.drop, { bead: true, stretch: 0.007, minPx: 1.3 }); R.puff.onLand = (i, x, y) => { landed(x, y); }; S.sheet = R.sheet; return R; };
  const oCore = { life: 1, s0: 0.1, s1: 0.8, r: 1, g: 1, b: 1, a: 0.9, drag: 0.25, grav: G, fin: 0.02, floor: 0.02 }, oDrop = { life: 1.2, s0: 0.03, s1: 0.02, r: 1, g: 1, b: 1, a: 0.85, drag: 0.12, grav: G, fin: 0.02, floor: 0.02 },
    oMist = { life: 5, s0: 0.5, s1: 3.2, r: 1, g: 1, b: 1, a: 0.1, drag: 0.5, grav: 0, fin: 0.25, floor: -1e9 }, oChurn = { life: 0.7, s0: 0.25, s1: 0.95, r: 1, g: 1, b: 1, a: 0.5, drag: 0.3, grav: G, fin: 0.02, floor: -1e9 };
  const mist = (i) => { if (i >= 0) R.puff.seed[i] += 2; };      /* seed >= 2: drawn as a soft wisp (hydrant-water.js waterLook) */
  const rnd = Math.random;
  function landed(x, y) { const q = rnd(); if (q < 0.35) { const a = rnd() * TAU, sp = 1.4 + rnd() * 2.8; oChurn.life = 0.25 + rnd() * 0.25; oChurn.s0 = 0.08 + rnd() * 0.1; oChurn.s1 = 0.2 + rnd() * 0.25; oChurn.a = 0.6; oChurn.grav = G; R.puff.emit(x, y, 0.05, Math.cos(a) * sp, Math.sin(a) * sp, 1.2 + rnd() * 2.2, oChurn); }
    for (let k = q > 0.3 ? 2 : 1; k > 0; k--) { const a = rnd() * TAU, sp = 1 + rnd() * 3.8; oDrop.life = 0.45 + rnd() * 0.4; oDrop.s0 = 0.016 + rnd() * 0.03; oDrop.s1 = oDrop.s0 * 0.7; oDrop.a = 0.9; oDrop.floor = 0.02; R.drop.emit(x, y, 0.06, Math.cos(a) * sp, Math.sin(a) * sp, 1.5 + rnd() * 3.5, oDrop); } }

  // ---------------------------------------------------------------- where the street is, seen from a hydrant
  function frame(H) {
    let nx = 0, ny = 0, kd = 0;
    for (let r = 0.3; r <= 5 && !kd; r += 0.2) { let sx = 0, sy = 0, c = 0; for (let k = 0; k < 24; k++) { const a = (k * TAU) / 24, x = H.x + Math.cos(a) * r, y = H.y + Math.sin(a) * r; if (!st.onSidewalk(x, y) && g.roads.inLane(x, y, 3.2)) { sx += Math.cos(a); sy += Math.sin(a); c++; } }
      if (c) { const L = Math.hypot(sx, sy); if (L > 1e-3) { nx = sx / L; ny = sy / L; kd = r; } } }
    if (!kd) { const e = g.roads.nearestEdge(H.x, H.y, 40); if (!e) return null; const d = Math.hypot(e.x - H.x, e.y - H.y) || 1; nx = (e.x - H.x) / d; ny = (e.y - H.y) / d; kd = Math.max(0.4, d - (e.e.lanes * e.e.lw) / 2 - 2); }
    let wid = 0; for (let d = 0.5; d < 32; d += 0.5) { wid = d; if (st.onSidewalk(H.x + nx * (kd + d), H.y + ny * (kd + d))) break; }
    return { nx, ny, kd, wid };
  }
  function circlesAt(H) { const out = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const L = st.circ.get(st.key(Math.floor(H.x / st.cell) + a, Math.floor(H.y / st.cell) + b)); if (L) for (const c of L) if (c.on && c.r < 0.45 && Math.hypot(c.x - H.x, c.y - H.y) < 0.35) out.push(c); } return out; }
  function instances(H) { const out = [], scan = (m, lod) => { if (!m || !m.isInstancedMesh || !m.instanceMatrix) return; const a = m.instanceMatrix.array; for (let i = 0; i < m.count; i++) if (Math.abs(a[i * 16 + 12] - H.x) < 0.3 && Math.abs(a[i * 16 + 14] + H.y) < 0.3 && Math.abs(a[i * 16] ) + Math.abs(a[i * 16 + 5]) > 1e-6) out.push({ m, i, lod, keep: Array.from(a.subarray(i * 16, i * 16 + 16)) }); };
    try { const F = g.streets && g.streets.parts && g.streets.parts.furniture; if (F && F.meshes) for (const m of F.meshes) { const k = m.userData && m.userData.kind; if (k === 'st_hydrant') scan(m, false); else if (k === 'st_hydLod') scan(m, true); }
      for (const m of g.propMeshes || []) if (m.userData && m.userData.kind === 'hydrant' && m.visible) scan(m, false); } catch (e) { kit.fail('hydrant.instances', e); }
    return out; }

  // ---------------------------------------------------------------- open / shear / close
  function open(i, mode = 'jet', cx = 0, cy = 0) {
    const had = S.open.find((o) => o.i === i);
    if (had) { if (mode === 'geyser' && had.mode !== 'geyser') { had.mode = 'geyser'; had.T = Math.min(had.T, 3); shearLook(had, cx, cy); S.sheared++; } return had; }
    if (S.open.length >= 2 || !list[i]) return null;
    const H = { x: list[i][0], y: list[i][1] }, f = frame(H); if (!f) return null; res();
    const o = { i, mode, H, nx: f.nx, ny: f.ny, tx: -f.ny, ty: f.nx, kd: f.kd, wid: f.wid, sgn: hsh(i, 3) < 0.5 ? 1 : -1, T: 0, pr: 0, end: -1, len: 0, range: 0, kids: [], hid: [], circles: [], body: null, eC: 0, eD: 0, eM: 0, kidT: 1.5, clearT: 0, snd: null, zS: st.onSidewalk(H.x, H.y) ? 0.15 : 0,
      wx: (hsh(i, 5) - 0.5) * 2.4, wy: (hsh(i, 6) - 0.5) * 2.4, I: [0, 0], Gp: [0, 0], E: [0, 0], patch: null };
    { const vh = TUNE.v0 * Math.sin(TUNE.elev), vz = TUNE.v0 * Math.cos(TUNE.elev), h0 = o.zS + 0.55, tf = (vh + Math.sqrt(vh * vh + 2 * G * h0)) / G; o.range = vz * tf * 0.9; }
    o.patch = R.sheet.add({ p0: o.I, p1: o.Gp, p2: o.E, r0: 0.3, r1: 0.1, level: 0, damp: 0, flow: 1, seed: hsh(i, 9) });
    if (!o.patch) return null;
    place(o); S.open.push(o); S.opened++; if (mode === 'geyser') { shearLook(o, cx, cy); S.sheared++; } else S.shot++;
    sound(o); return o;
  }
  function place(o) { const H = o.H, far = o.mode === 'jet' && o.range - o.kd > o.wid / 2, gd = o.kd + (far ? Math.max(0.8, o.wid - 0.8) : 0.8);
    o.Gp[0] = H.x + o.nx * gd; o.Gp[1] = H.y + o.ny * gd;
    if (o.mode === 'jet') { const r = Math.min(o.range, o.kd + o.wid - 0.5); o.I[0] = H.x + o.nx * r; o.I[1] = H.y + o.ny * r; } else { o.I[0] = H.x + o.nx * (o.kd + 1.3); o.I[1] = H.y + o.ny * (o.kd + 1.3); } }
  function shearLook(o, cx, cy) {
    place(o); let dl = Math.hypot(cx, cy); if (dl < 1e-3) { cx = o.tx; cy = o.ty; dl = 1; } cx /= dl; cy /= dl;
    for (const c of circlesAt(o.H)) { c.on = false; o.circles.push(c); }
    const I = instances(o.H); o.hid = I;
    for (const q of I) { const a = q.m.instanceMatrix.array, b = q.i * 16; if (!q.lod && !o.body) { try { const bm = new THREE.InstancedMesh(q.m.geometry, q.m.material, 1); bm.frustumCulled = false; bm.matrixAutoUpdate = false; bm.castShadow = false; bm.receiveShadow = true; bm.userData = { kind: 'sur_hydrant_body' }; bm.renderOrder = q.m.renderOrder; _m.fromArray(q.keep); _m.decompose(_v, _q, _s);
          o.body = { parts: [bm], p0: _v.clone(), q0: _q.clone(), s: _s.clone(), cx, cy, t: 0 }; (q.m.parent || g.world.scene).add(bm); } catch (e) { kit.fail('hydrant.body', e); } }
        else if (!q.lod && o.body && o.body.parts.length < 6) { try { const bm = new THREE.InstancedMesh(q.m.geometry, q.m.material, 1); bm.frustumCulled = false; bm.matrixAutoUpdate = false; bm.receiveShadow = true; bm.renderOrder = q.m.renderOrder; o.body.parts.push(bm); (q.m.parent || g.world.scene).add(bm); } catch (e) {} }
      for (let k = 0; k < 12; k++) if (k !== 3 && k !== 7 && k !== 11) a[b + k] = 0; q.m.instanceMatrix.needsUpdate = true; }
    if (o.body) bodyPose(o, 0);
  }
  // the broken-off hydrant: thrown 2.4 m the way the car went, a quarter turn over and a bit more, comes to rest on its side
  function bodyPose(o, dt) { const B = o.body; B.t += dt; const u = clamp(B.t / 0.7, 0, 1), e = 1 - (1 - u) * (1 - u), d = 2.4 * e, ang = (Math.PI / 2) * Math.min(1, e * 1.15), hop = Math.sin(Math.PI * u) * 0.55, rest = 0.19 * (B.s.y || 1) * Math.sin(ang);
    const zG = st.onSidewalk(o.H.x + B.cx * d, o.H.y + B.cy * d) ? 0.15 : 0;
    _v.set(B.p0.x + B.cx * d, zG + hop * (1 - u) + rest + (B.p0.y - o.zS) * (1 - e), B.p0.z - B.cy * d); _v2.set(-B.cy, 0, -B.cx).normalize(); _q2.setFromAxisAngle(_v2, ang); _q3.copy(_q2).multiply(B.q0);
    _m.compose(_v, _q3, B.s); for (const bm of B.parts) { bm.setMatrixAt(0, _m); bm.instanceMatrix.needsUpdate = true; } B.x = o.H.x + B.cx * d; B.y = o.H.y + B.cy * d; }
  function close(o, restore) { const k = S.open.indexOf(o); if (k >= 0) S.open.splice(k, 1); if (R) R.sheet.remove(o.patch); for (const kd of o.kids) dropKid(kd); o.kids.length = 0; if (o.snd) { try { o.snd.stop(); } catch (e) {} o.snd = null; }
    if (restore) { for (const q of o.hid) { q.m.instanceMatrix.array.set(q.keep, q.i * 16); q.m.instanceMatrix.needsUpdate = true; } for (const c of o.circles) c.on = true; if (o.body) for (const bm of o.body.parts) { bm.parent && bm.parent.remove(bm); bm.dispose && bm.dispose(); } }
    if (!S.open.length && R) { R.sheet.draw(); R.puff.draw(); R.drop.draw(); } }
  S.openHydrant = open; S.closeHydrant = (o) => close(o, true);

  // ---------------------------------------------------------------- sound: a roar and a hiss, heard from down the block
  function sound(o) { const s = kit.audio(); if (!s || !s.white) return; try { const a = s.ac, V = kit.voice({ ref: 9, max: 190, level: 0, wall: true, roll: 0.9 }); if (!V) return;
      const mk = (type, f, q, gain, rate) => { const src = a.createBufferSource(); src.buffer = s.white; src.loop = true; src.playbackRate.value = rate; const fl = a.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = a.createGain(); gn.gain.value = gain; src.connect(fl); fl.connect(gn); gn.connect(V.in); src.start(0, Math.random()); return src; };
      const srcs = [mk('bandpass', 420, 0.5, 0.9, 0.7), mk('bandpass', 1500, 0.6, 0.5, 1), mk('highpass', 3800, 0.4, 0.3, 1.3)];
      o.snd = { V, stop() { for (const x of srcs) { try { x.stop(); } catch (e) {} } V.stop(); } }; kit.burst(V, { freq: 2600, q: 9, gain: 0.8, dec: 0.3 }); kit.burst(V, { type: 'lowpass', freq: 500, gain: 1, dec: 0.5 }); } catch (e) { kit.fail('hydrant.sound', e); } }

  // ---------------------------------------------------------------- the kids (and a grown-up): the game's own figures, small, with their arms up
  const KID = [0.95, 1.0, 0.92, 0.97], FORMAL = /suit|busi|office|formal|exec|police|cop|guard|worker|chef|doctor|nurse/i;
  function addKid(o, k) { const grown = k >= TUNE.kids, side = k % 2 ? 1 : -1, d0 = 16 + 5 * k, kd = { o, k, grown, scale: grown ? 0.96 : KID[k % KID.length], st: 'come', t: 0, dwell: 0, x: o.H.x + o.tx * side * d0 - o.nx * 1.3, y: o.H.y + o.ty * side * d0 - o.ny * 1.3, z: 0.15, h: 0, v: 0, tgx: 0, tgy: 0, hop: 0, arms: 0, ph: rnd() * 6, onRoad: false, vis: null, sp: grown ? 2.4 : 2.8 + rnd() * 0.5, def: null };
    if (st.resolve(kd.x, kd.y, 0.3, _o)) { kd.x = _o.x; kd.y = _o.y; } kd.hx = kd.x; kd.hy = kd.y; kerbSpot(kd);
    try { const all = g.peds && g.peds.kinds, cas = all && (S.casual || (S.casual = all.filter((n) => !FORMAL.test(n)))), kinds = cas && cas.length >= 3 ? cas : all, name = kinds && kinds[(o.i * 7 + k * 3) % kinds.length], p = name && g.kit.person && g.kit.person(name);
      if (p && p.object) { const B = (n) => p.object.getObjectByName(name + '_' + n); kd.vis = p; kd.bones = { head: B('head'), uaL: B('upper_arm_L'), faL: B('forearm_L'), haL: B('hand_L'), uaR: B('upper_arm_R'), faR: B('forearm_R'), haR: B('hand_R') }; p.object.scale.setScalar(kd.scale); p.object.traverse((c) => { if (c.isSkinnedMesh) c.frustumCulled = false; }); g.world.scene.add(p.object); } } catch (e) { kit.fail('hydrant.kid', e); }
    o.kids.push(kd); return kd; }
  function dropKid(kd) { if (kd.vis) { try { kd.vis.mixer && kd.vis.mixer.stopAllAction(); kd.vis.object.parent && kd.vis.object.parent.remove(kd.vis.object); } catch (e) {} kd.vis = null; } }
  function kerbSpot(kd) { const o = kd.o, s = (kd.k % 2 ? 1 : -1) * (1.3 + 0.75 * (kd.k >> 1)) + (rnd() - 0.5) * 0.5; kd.tgx = o.H.x + o.tx * s - o.nx * (0.3 + rnd() * 0.5); kd.tgy = o.H.y + o.ty * s - o.ny * (0.3 + rnd() * 0.5); }
  function playSpot(kd) { const o = kd.o; if (o.mode === 'jet') { const r = Math.min(o.range, o.kd + o.wid - 1) - (kd.grown ? 4.5 : rnd() * 3.2 - 0.6), s = (rnd() - 0.5) * (kd.grown ? 1 : 3); kd.tgx = o.H.x + o.nx * r + o.tx * s; kd.tgy = o.H.y + o.ny * r + o.ty * s; }
    else for (let q = 0; q < 6; q++) { const a = rnd() * TAU, r = (kd.grown ? 3.4 : 1.5) + rnd() * 1.8; kd.tgx = o.H.x + Math.cos(a) * r; kd.tgy = o.H.y + Math.sin(a) * r; if (st.onSidewalk(kd.tgx, kd.tgy) && !st.resolve(kd.tgx, kd.tgy, 0.3, _o)) break; } }
  function kidStep(kd, dt) { const o = kd.o; kd.t += dt; const dx = kd.tgx - kd.x, dy = kd.tgy - kd.y, d = Math.hypot(dx, dy); let want = 0;
    if (d > 0.3) { kd.v += (kd.sp - kd.v) * Math.min(1, dt * 5); const nxp = kd.x + (dx / d) * kd.v * dt, nyp = kd.y + (dy / d) * kd.v * dt; st.resolve(nxp, nyp, 0.24, _o); kd.x = _o.x; kd.y = _o.y; let dh = Math.atan2(dy, dx) - kd.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); kd.h += clamp(dh, -9 * dt, 9 * dt); kd.dwell = 0; if (kd.t > 14) { kd.t = 0; kerbSpot(kd); } }
    else { kd.v = 0; kd.dwell += dt;
      if (kd.st === 'come') { kd.st = 'kerb'; kd.t = 0; kd.wait = 0.4 + rnd(); }
      else if (kd.st === 'kerb') { if (kd.dwell > kd.wait && o.pr > 0.3 && o.clearT <= 0) { kd.st = 'play'; kd.t = 0; kd.wait = 1.6 + rnd() * 2.6; playSpot(kd); } else if (o.pr <= 0.05 && o.T > o.end + 5 && o.end > 0) { kd.st = 'leave'; kd.t = 0; kd.tgx = kd.hx; kd.tgy = kd.hy; kd.sp = 1.5; } else { const fx = o.H.x + o.nx * 3 - kd.x, fy = o.H.y + o.ny * 3 - kd.y; let dh = Math.atan2(fy, fx) - kd.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); kd.h += clamp(dh, -5 * dt, 5 * dt); if (o.pr > 0.3) want = 0.35; } }
      else if (kd.st === 'play') { want = 1; kd.h += dt * (kd.k % 2 ? 2.2 : -1.7) * (kd.grown ? 0.2 : 1); if (kd.dwell > kd.wait) { kd.t = 0; if (rnd() < 0.55 && o.pr > 0.3) { kd.wait = 1.2 + rnd() * 2.4; playSpot(kd); } else { kd.st = 'kerb'; kd.wait = 1.5 + rnd() * 3; kerbSpot(kd); } } }
      else if (kd.st === 'leave') { kd.gone = true; } }
    if (kd.st === 'play' && (o.clearT > 0 || o.pr < 0.2)) { kd.st = 'kerb'; kd.t = 0; kd.wait = 1 + rnd() * 2; kerbSpot(kd); }
    kd.onRoad = !st.onSidewalk(kd.x, kd.y); kd.z += ((kd.onRoad ? 0 : 0.15) - kd.z) * Math.min(1, dt * 12);
    kd.arms += (want - kd.arms) * Math.min(1, dt * 6); if (want > 0.9 && !kd.grown) kd.ph += dt * 8.5; kd.hop = want > 0.9 && !kd.grown ? Math.max(0, Math.sin(kd.ph)) * 0.09 : kd.hop * Math.max(0, 1 - dt * 10); }
  const UPL = new THREE.Vector3(), aimT = new THREE.Vector3(), aimC = new THREE.Vector3();
  function aim(bone, child, dir, w) { if (!bone || !child || w <= 0.01) return; bone.getWorldPosition(aimT); child.getWorldPosition(aimC); aimC.sub(aimT).normalize(); _q.setFromUnitVectors(aimC, dir); _q2.copy(ID).slerp(_q, w); bone.getWorldQuaternion(_q3); _q2.multiply(_q3); bone.parent.getWorldQuaternion(_q3); bone.quaternion.copy(_q3.invert().multiply(_q2)); bone.updateMatrixWorld(true); }
  function kidDraw(kd, dt) { const p = kd.vis; if (!p) return; const ob = p.object, mv = kd.v > 0.4, name = mv ? (p.acts.run ? 'run' : 'jog') : p.acts.idle ? 'idle' : 'idleshift';
    if (p.cur !== name && p.acts[name]) { if (p.cur && p.acts[p.cur]) p.acts[p.cur].fadeOut(0.18); p.acts[name].reset().fadeIn(0.18).play(); p.cur = name; }
    if (p.mixer) { p.mixer.timeScale = mv ? clamp(kd.v / ((p.runSpeed || 5) * kd.scale * (name === 'jog' ? 0.55 : 1)), 0.5, 1.5) : 1; p.mixer.update(dt); }
    ob.position.set(kd.x, kd.z + kd.hop, -kd.y); ob.rotation.set(0, kd.h, 0); const b = kd.bones;
        if (kd.arms > 0.02) { ob.updateMatrixWorld(true); const sw = Math.sin(kd.ph * 0.5) * 0.25, c = Math.cos(kd.h), s = Math.sin(kd.h);
      UPL.set(-s * (0.45 + sw), 1, -c * (0.45 + sw)).normalize(); aim(b.uaL, b.faL, UPL, kd.arms); UPL.set(-s * 0.2, 1, -c * 0.2).normalize(); aim(b.faL, b.haL, UPL, kd.arms * 0.9);
      UPL.set(s * (0.45 - sw), 1, c * (0.45 - sw)).normalize(); aim(b.uaR, b.faR, UPL, kd.arms); UPL.set(s * 0.2, 1, c * 0.2).normalize(); aim(b.faR, b.haR, UPL, kd.arms * 0.9); } }
  function wrapGap() { const tr = g.traffic; if (S.gapWrapped || !tr || typeof tr.gapAhead !== 'function') return; S.gapWrapped = true; const gap0 = tr.gapAhead.bind(tr);
    tr.gapAhead = function (c, look) { let gap = gap0(c, look); const Rd = S.road; if (!Rd.length) return gap; const fx = Math.cos(c.h), fy = Math.sin(c.h), half = c.def.len / 2;
      for (const q of Rd) { const dx = q.x - c.x, dy = q.y - c.y, f = dx * fx + dy * fy; if (f < 0.5 || f > look + 0.4 + half) continue; if (Math.abs(-dx * fy + dy * fx) > 1.5) continue; const gp = f - half - 0.6; if (gp < gap) { gap = gp; tr._blk = q; } } return gap; }; }

  // ---------------------------------------------------------------- people of the street: skirt the nozzle, hurry through the rain
  function hurry(sim, a) { a.state = 'flee'; a.t = 0.2; a.vx = Math.cos(a.h); a.vy = Math.sin(a.h); a.standT = 0; try { sim.setClip(a, sim.jog); } catch (e) {} S.hurried++; }
  function people(o, dt) { const gey = o.mode === 'geyser', Rr = gey ? 0.6 + 4.2 * o.pr : 1.5, R1 = Rr + 0.9, hx = o.H.x, hy = o.H.y, t = g.t || 0; if (o.pr < 0.15) return;
    const cr = g.crowd, sim = cr && cr.on !== false && cr.sim;
    if (sim && sim.agents) { const A = sim.agents; for (let i = 0; i < A.length; i++) { const a = A[i]; if (!a || a.gone) continue; const dx = a.x - hx; if (dx > R1 || dx < -R1) continue; const dy = a.y - hy; if (dy > R1 || dy < -R1) continue; if (a.state !== 'walk' || a.lead) continue; const d = Math.hypot(dx, dy);
        if (gey) { if (d < Rr && !(a._hydT > t)) { a._hydT = t + 8; hurry(sim, a); } }
        else if (d < R1 && d > 1e-3) { const k = (R1 - d) * Math.min(1, dt * 4); a.x += (dx / d) * k; a.y += (dy / d) * k; if (!(a._hydT > t)) { a._hydT = t + 8; S.skirted++; } } } }
    const L = g.peds && g.peds.list; if (L && gey) for (const p of L) { if (p.state !== 'walk') continue; const d = Math.hypot(p.x - hx, p.y - hy); if (d < Rr && !(p._hydT > t)) { p._hydT = t + 8; p.state = 'flee'; p.t = 0.3; p.fx = Math.cos(p.h); p.fy = Math.sin(p.h); try { g.peds.setAnim(p, 'run'); } catch (e) {} S.hurried++; } } }

  // ---------------------------------------------------------------- cars: boxes the water breaks on, spray from the tyres, the player's tyres in the water
  const AQ = { k: 0, has: false }, boxPool = [];
  function boxes(o) { const B = R.boxes; let n = R.nb; const add = (x, y, h, hl, hw, top, sp, vx, vy, car) => { const q = boxPool[n] || (boxPool[n] = {}); q.x = x; q.y = y; q.c = Math.cos(h); q.s = Math.sin(h); q.hl = hl; q.hw = hw; q.top = top; q.sp = sp; q.vx = vx; q.vy = vy; q.car = car; B[n++] = q; };
    const mx = (o.H.x + o.I[0]) / 2, my = (o.H.y + o.I[1]) / 2, rr = 34 + o.len;
    if (g.traffic && g.traffic.cars) for (const c of g.traffic.cars) { if (!c.def || Math.abs(c.x - mx) > rr || Math.abs(c.y - my) > rr) continue; const v = c.v || 0; add(c.x, c.y, c.h, c.def.len / 2, c.def.wid / 2, c.def.hgt || 1.45, v, Math.cos(c.h) * v, Math.sin(c.h) * v, c); }
    for (const c of g.vehicles || []) { if (!c.def || Math.abs(c.x - mx) > rr || Math.abs(c.y - my) > rr) continue; add(c.x, c.y, c.h, c.def.len / 2, c.def.wid / 2, c.def.hgt || 1.45, Math.hypot(c.vx || 0, c.vy || 0), c.vx || 0, c.vy || 0, c); }
    R.nCars = n; for (const kd of o.kids) add(kd.x, kd.y, 0, 0.22, 0.22, 1.75 * kd.scale * 0.8, 0, 0, 0, null);
    R.nb = n; }
  function fieldOf(PS) { return (i, p, v) => { const o3 = i * 3, x = p[o3], y = p[o3 + 1], h = p[o3 + 2]; const thru = v[o3 + 2] > 6 && PS.seed[i] < 0.65;      /* a geyser under a car: two thirds of the column comes up round it (ref3) */
      for (let k = 0; k < R.nb; k++) { const b = R.boxes[k]; if (h > b.top || (thru && b.car)) continue; const dx = x - b.x, dy = y - b.y; if (dx > 6 || dx < -6 || dy > 6 || dy < -6) continue; const f = dx * b.c + dy * b.s, s = -dx * b.s + dy * b.c;
        if (f > -b.hl && f < b.hl && s > -b.hw && s < b.hw) { const a = rnd() * TAU, sp = 1.5 + rnd() * 3; v[o3] = Math.cos(a) * sp + b.vx * 0.5; v[o3 + 1] = Math.sin(a) * sp + b.vy * 0.5; v[o3 + 2] = 0.5 + rnd() * 3.5; p[o3 + 2] = Math.min(b.top + 0.05, h + 0.3); PS.age[i] = Math.max(PS.age[i], PS.life[i] - 0.3 - rnd() * 0.3); if (b.car) R.hits++; return; } } }; }
  function tyres(o, dt) { const sh = R.sheet; for (let k = 0; k < R.nCars; k++) { const b = R.boxes[k]; if (b.sp < 2.5) continue; const fxp = b.x + b.c * b.hl * 0.62, fyp = b.y + b.s * b.hl * 0.62; let any = false;
      for (let sd = -1; sd <= 1; sd += 2) { const wx = fxp - b.s * b.hw * 0.85 * sd, wy = fyp + b.c * b.hw * 0.85 * sd, wet = sh.wetAt(wx, wy); if (wet < 0.08) continue; any = true;
        let n = wet * Math.min(b.sp, 22) * 16 * dt; n = Math.floor(n) + (rnd() < n % 1 ? 1 : 0); const out = 1.6 + 0.3 * b.sp, up = 1.3 + 0.16 * b.sp;
        for (let j = 0; j < n; j++) { const u = rnd(), q = 0.4 + rnd() * 0.9; oDrop.life = 0.5 + rnd() * 0.5; oDrop.s0 = 0.012 + rnd() * 0.025; oDrop.s1 = oDrop.s0 * 0.6; oDrop.a = 0.8; oDrop.floor = 0.02;
          R.drop.emit(wx - b.c * u * b.hl * 1.3, wy - b.s * u * b.hl * 1.3, 0.06, -b.s * sd * out * q + b.vx * (0.25 + 0.3 * rnd()), b.c * sd * out * q + b.vy * (0.25 + 0.3 * rnd()), up * (0.4 + rnd() * 0.9), oDrop); }
        for (let j = wet * b.sp * 2.2 * dt, c2 = Math.floor(j) + (rnd() < j % 1 ? 1 : 0); c2 > 0; c2--) { oChurn.life = 0.45 + rnd() * 0.4; oChurn.s0 = 0.2; oChurn.s1 = 0.7 + 0.04 * b.sp; oChurn.a = 0.62; oChurn.grav = G; R.puff.emit(wx - b.c * b.hl * 0.3, wy - b.s * b.hl * 0.3, 0.15, b.vx * 0.35 - b.s * sd * (1.5 + 0.12 * b.sp), b.vy * 0.35 + b.c * sd * (1.5 + 0.12 * b.sp), 1.6 + 0.1 * b.sp + rnd(), oChurn); } }
      if (any && b.car && !(b.car._hydSp > (g.t || 0))) { b.car._hydSp = (g.t || 0) + 3; S.sprayCars++; if (o.snd) kit.burst(o.snd.V, { type: 'highpass', freq: 1800, gain: 0.5 * clamp(b.sp / 12, 0.2, 1), att: 0.03, dec: 0.7 }); } } }

  // ---------------------------------------------------------------- the water itself
  function emit(o, dt) { const pr = o.pr, H = o.H; if (pr <= 0.01) return; const flut = 1 + 0.05 * Math.sin(o.T * 7.3) + 0.03 * Math.sin(o.T * 17.1);
    if (o.mode === 'jet') { const v0 = TUNE.v0 * (0.25 + 0.75 * pr) * flut, ce = Math.cos(TUNE.elev), se = Math.sin(TUNE.elev), ox = H.x + o.nx * 0.24, oy = H.y + o.ny * 0.24, oh = o.zS + 0.55;
      o.eC += 300 * dt * (0.4 + 0.6 * pr); while (o.eC >= 1) { o.eC--; const j = 0.05, a = (rnd() - 0.5) * j * 2, e2 = (rnd() - 0.5) * j * 1.6, k = 0.93 + rnd() * 0.12, vx = (o.nx * ce + o.tx * a) * v0 * k, vy = (o.ny * ce + o.ty * a) * v0 * k, vh = (se + e2) * v0 * k, u = rnd() * dt;
        oCore.life = 1.25; oCore.s0 = 0.075 + rnd() * 0.04; oCore.s1 = 0.3 + rnd() * 0.3; oCore.a = 0.9; oCore.drag = 0.3; oCore.floor = 0.03; R.puff.emit(ox + vx * u, oy + vy * u, oh + vh * u, vx, vy, vh, oCore); }
      o.eD += 800 * dt * pr; while (o.eD >= 1) { o.eD--; const j = 0.05 + rnd() * rnd() * 0.17, a = (rnd() - 0.5) * j * 2, e2 = (rnd() - 0.35) * j * 1.5, k = 0.7 + rnd() * 0.38, vx = (o.nx * ce + o.tx * a) * v0 * k, vy = (o.ny * ce + o.ty * a) * v0 * k, vh = (se + e2) * v0 * k, u = rnd() * dt + rnd() * 0.05;
        oDrop.life = 1.3; oDrop.s0 = 0.016 + rnd() * rnd() * 0.05; oDrop.s1 = oDrop.s0 * 0.75; oDrop.a = 0.95; oDrop.floor = 0.02; R.drop.emit(ox + vx * u, oy + vy * u, oh + vh * u, vx, vy, vh, oDrop); }
      o.eM += 6 * dt * pr; while (o.eM >= 1) { o.eM--; const u = 0.25 + rnd() * 0.75, r = o.range * u; oMist.life = 3 + rnd() * 2.5; oMist.s0 = 0.4 + rnd() * 0.4; oMist.s1 = 1.6 + rnd() * 1.4; oMist.a = TUNE.mist * (0.7 + rnd() * 0.6);
        mist(R.puff.emit(H.x + o.nx * r + o.tx * (rnd() - 0.5), H.y + o.ny * r + o.ty * (rnd() - 0.5), 0.3 + rnd() * 1.1, o.wx + o.nx * 1.5 * u + (rnd() - 0.5), o.wy + o.ny * 1.5 * u + (rnd() - 0.5), 0.25 + rnd() * 0.6, oMist)); } }
    else { const v0 = TUNE.up * Math.sqrt(0.08 + 0.92 * pr) * flut, oh = o.zS + 0.12;
      o.eC += 620 * dt * (0.4 + 0.6 * pr); while (o.eC >= 1) { o.eC--; const veil = rnd() < 0.1, a = rnd() * TAU, sp = veil ? 1.4 + rnd() * 1.8 : rnd() * 1.2, k = 0.8 + rnd() * 0.26, vx = Math.cos(a) * sp + o.wx * 0.15, vy = Math.sin(a) * sp + o.wy * 0.15, vh = v0 * k, u = rnd() * dt, r0 = rnd() * 0.42;
        if (veil) { oCore.life = 3.3; oCore.s0 = 0.4; oCore.s1 = 1.5 + rnd(); oCore.a = 0.5; oCore.drag = 0.12; oCore.floor = 0.03; } else { oCore.life = 1.5 + rnd() * 0.6; oCore.s0 = 0.4 + rnd() * 0.25; oCore.s1 = 0.9 + rnd() * 0.7; oCore.a = 0.9; oCore.drag = 0.12; oCore.floor = -1e9; } R.puff.emit(H.x + Math.cos(a) * r0 + vx * u, H.y + Math.sin(a) * r0 + vy * u, oh + vh * u, vx, vy, vh, oCore); }
      o.eD += 680 * dt * pr; while (o.eD >= 1) { o.eD--; const a = rnd() * TAU, sp = 0.2 + rnd() * 2.6, k = 0.72 + rnd() * 0.36, vx = Math.cos(a) * sp + o.wx * 0.3, vy = Math.sin(a) * sp + o.wy * 0.3, vh = v0 * k, u = rnd() * dt + rnd() * 0.04;
        oDrop.life = 3.8; oDrop.s0 = 0.018 + rnd() * rnd() * 0.05; oDrop.s1 = oDrop.s0 * 0.8; oDrop.a = 0.9; oDrop.floor = 0.03; R.drop.emit(H.x + vx * u, H.y + vy * u, oh + vh * u, vx, vy, vh, oDrop); }
      o.eM += 6 * dt * pr; while (o.eM >= 1) { o.eM--; const hh = 2 + rnd() * 8 * pr; oMist.life = 3 + rnd() * 3; oMist.s0 = 0.6 + rnd() * 0.6; oMist.s1 = 2 + rnd() * 1.6; oMist.a = TUNE.mist * (0.7 + rnd() * 0.6);
        mist(R.puff.emit(H.x + (rnd() - 0.5) * 2, H.y + (rnd() - 0.5) * 2, hh, o.wx + (rnd() - 0.5), o.wy + (rnd() - 0.5), -0.3 - rnd() * 0.5, oMist)); }
      o.eG = (o.eG || 0) + 40 * dt * pr; while (o.eG >= 1) { o.eG--; const a = rnd() * TAU, r = 0.4 + rnd() * 3.6 * pr; landed(H.x + Math.cos(a) * r, H.y + Math.sin(a) * r); } } }

  function sheet(o) { const T = o.T, p = o.patch, live = o.end < 0, Td = live ? 0 : T - o.end; o.len = Math.min(30, 1.1 * Math.max(0, T - 2)) * (live ? 1 : Math.max(0.5, 1 - Td / (TUNE.dry * 0.5)));
    o.E[0] = o.Gp[0] + o.tx * o.sgn * o.len; o.E[1] = o.Gp[1] + o.ty * o.sgn * o.len;
    p.r0 = (o.mode === 'jet' ? 0.5 + 2.4 * smooth(0, 7, T) : 0.5 + 3.6 * smooth(0, 6, T)); p.r1 = 0.08 + 0.78 * smooth(1, 6, T);
    p.level = live ? smooth(0, 1.2, T) : 1 - smooth(0, TUNE.dry * 0.45, Td); p.damp = live ? smooth(0, 1.5, T) : 1 - smooth(TUNE.dry * 0.4, TUNE.dry, Td); p.flow = o.pr; }

  // ---------------------------------------------------------------- hooks
  function hook() { const c = g.combat; if (!c || c.__hydHook || typeof c.hit !== 'function') return; c.__hydHook = true; const hit0 = c.hit;
    c.hit = function (h, W, first) { try { if (h && h.kind === 'prop' && h.obj && h.obj.tag === 'hydrant' && h.obj.on) { const i = S.nearest(h.obj.x, h.obj.y, 1); if (i >= 0) open(i, 'jet'); } } catch (e) { kit.fail('hydrant.hit', e); } return hit0.call(this, h, W, first); }; }
  let hookT = 0;
  kit.onStep((dt) => {
    if (!(g.combat && g.combat.__hydHook) && (hookT -= dt) <= 0) { hookT = 2; hook(); }
    const pl = g.player, v = pl && pl.vehicle;
    if (v && v.def) { const sp = Math.hypot(v.vx, v.vy);
      if (sp >= TUNE.breakSpeed) { const gi = Math.floor(v.x / CELL), gj = Math.floor(v.y / CELL), fx0 = v.x / CELL - gi, fy0 = v.y / CELL - gj; for (let ga = fx0 < 0.3 ? -1 : 0; ga <= (fx0 > 0.7 ? 1 : 0); ga++) for (let gb = fy0 < 0.3 ? -1 : 0; gb <= (fy0 > 0.7 ? 1 : 0); gb++) { const L = grid.get((gi + ga) * 100003 + gj + gb); if (!L) continue; const r = v.def.wid * 0.5 + 0.2 + sp * dt * 2 + 0.05, c = Math.cos(v.h), s = Math.sin(v.h);
          for (const i of L) { const hx = list[i][0], hy = list[i][1]; if (Math.abs(hx - v.x) > 6 || Math.abs(hy - v.y) > 6) continue; const had = S.open.find((o) => o.i === i); if (had && had.mode === 'geyser') continue;
            for (let q = -1; q <= 1; q++) { const cx = v.x + c * v.def.len * 0.3 * q, cy = v.y + s * v.def.len * 0.3 * q, dx = hx - cx, dy = hy - cy; if (dx * dx + dy * dy < r * r && dx * v.vx + dy * v.vy > 0) { const o = open(i, 'geyser', v.vx, v.vy); if (o) { v.vx *= 0.86; v.vy *= 0.86; try { g.onCrash(v, 4.5); } catch (e) {} } break; } } } } }
      if (S.open.length && R) { const c = Math.cos(v.h), s = Math.sin(v.h), fx = v.x + c * v.def.len * 0.3, fy = v.y + s * v.def.len * 0.3, hw = v.def.wid * 0.42;
        S.aqK = aquaplane(v, R.sheet.wetAt(fx - s * hw, fy + c * hw), R.sheet.wetAt(fx + s * hw, fy - c * hw), dt, AQ); if (S.aqK > S.aqMax) S.aqMax = S.aqK; } else AQ.has = false;
    } else AQ.has = false;
    if (!S.open.length) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0; S.road.length = 0; R.nb = 0; R.nCars = 0;
    for (let k = S.open.length - 1; k >= 0; k--) { const o = S.open[k]; o.T += dt;
      if (o.end < 0 && o.T > TUNE.run + TUNE.fade) o.end = o.T;
      o.pr = smooth(0, 0.35, o.T) * (1 - smooth(TUNE.run, TUNE.run + TUNE.fade, o.T));
      const far = Math.hypot(o.H.x - g.focus.x, o.H.y - g.focus.y); o.far = far;
      if (o.end > 0 && o.T > o.end + TUNE.dry) { close(o, far > 160); continue; }
      if (far > 420) { close(o, true); continue; }
      sheet(o); if (o.body && o.body.t < 0.8) bodyPose(o, dt);
      if (far > TUNE.far) continue;
      people(o, dt);
      if (o.pr > 0.3 && o.kids.length < TUNE.kids + TUNE.grown && (o.kidT -= dt) <= 0) { o.kidT = 1.2 + rnd() * 2.5; addKid(o, o.kids.length); }
      o.clearT -= dt; let onRoad = 0;
      for (let q = o.kids.length - 1; q >= 0; q--) { const kd = o.kids[q]; kidStep(kd, dt); if (kd.gone) { dropKid(kd); o.kids.splice(q, 1); continue; } if (kd.onRoad) { S.road.push(kd); onRoad++; } }
      if (onRoad) { wrapGap(); if (o.clearT <= -5 && g.traffic && g.traffic.cars) for (const c of g.traffic.cars) if ((c.v || 0) < 0.6 && Math.abs(c.x - o.I[0]) < 16 && Math.abs(c.y - o.I[1]) < 16) { o.clearT = 7; break; } }
      boxes(o); }
    if (t0) S.ms += (performance.now() - t0 - S.ms) * 0.05;
  }, 'hydrant');
  let fPuff = null, fDrop = null;
  kit.onFrame((dt) => {
    if (!S.open.length || !R) return; const t0 = typeof performance !== 'undefined' ? performance.now() : 0; let near = false; R.hits = 0;
    for (const o of S.open) { if (o.far > TUNE.far) { if (o.snd) o.snd.V.off(); continue; } near = true; if (dt > 0) { emit(o, dt); tyres(o, dt); } for (const kd of o.kids) kidDraw(kd, dt);
      if (o.snd) { o.snd.V.level = TUNE.vol * o.pr; o.snd.V.at(o.mode === 'jet' ? o.H.x + o.nx * 2 : o.H.x, o.mode === 'jet' ? o.H.y + o.ny * 2 : o.H.y, 1.2, dt || 0.016); } }
    if (near || R.puff.n || R.drop.n) { if (dt > 0) { if (!fPuff) { fPuff = fieldOf(R.puff); fDrop = fieldOf(R.drop); } R.puff.step(dt, R.nb ? fPuff : null); R.drop.step(dt, R.nb ? fDrop : null); }
      kit.light(1, R.L); { const m = Math.max(R.L[0], R.L[1], R.L[2], 1e-3), k = (m > 1 ? 1 / m : 1) * TUNE.light; R.L[0] *= k; R.L[1] *= k; R.L[2] *= k; const nn = g.night ? g.night.n || 0 : 0, lp = TUNE.lamp * nn; R.L[0] += lp; R.L[1] += lp * 0.93; R.L[2] += lp * 0.8;      /* Nov 17: at night the water was lit by the sky's colour only and all but vanished; the street lamps' share (?hyd_lamp=0 = as it was) */ } R.puff.draw(R.L); R.drop.draw(R.L); }
    R.sheet.draw();
    if (t0) S.ms += (performance.now() - t0 - S.ms) * 0.05;
  }, 'hydrant');
  return S;
}

// ?surshow=hydrant: stand the player on the sidewalk a few metres from the nearest hydrant on a proper street and open it (&hydshow=geyser: sheared)
export function show(game, kit, S) {
  const g = game, pl = g.player, st = g.statics; if (!S || !S.list || !S.list.length) return;
  let best = -1, bd = 1e18; S.list.forEach((p, i) => { const d = (p[0] - pl.x) ** 2 + (p[1] - pl.y) ** 2; if (d < bd && d > 36 && st.onSidewalk(p[0], p[1])) { bd = d; best = i; } });
  if (best < 0) return; const mode = g.P && g.P.get('hydshow') === 'geyser' ? 'geyser' : 'jet', o = S.openHydrant(best, mode, 0, 0); if (!o) return;
  let x = o.H.x + o.tx * 7 - o.nx * 1.2 + o.nx * 0, y = o.H.y + o.ty * 7 - o.ny * 1.2; if (st.resolve(x, y, 0.4, _o)) { x = _o.x; y = _o.y; }
  if (pl.vehicle) { pl.vehicle = null; if (pl.vis && pl.vis.object) pl.vis.object.visible = true; if (g.cam) g.cam.mode = 'foot'; }
  pl.x = x; pl.y = y; pl.h = Math.atan2(o.H.y + o.ny * 3 - y, o.H.x + o.nx * 3 - x); if (g.focus) { g.focus.x = x; g.focus.y = y; } try { g.snapCamera(); } catch (e) {}
  return o;
}
