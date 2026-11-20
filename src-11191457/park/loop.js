// park/loop.js (park lane, helper loop, Nov 17): runners and cyclists on the park's drives (the brief: "runners and cyclists on the loop").
// Nothing is modelled or loaded here: a runner is one of the crowd's own bodies playing the crowd's Jog / Run clip, handed to the crowd's
// renderer for the length of its update (so it rides in the crowd's instanced draws, with its shadows and its far forms: no draw of its own);
// a cyclist is the delivery riders' bicycle (riders/ridermodel.js: buildBike, buildWheel, no box) under the riders' figure from the cast in
// its riding pose (riders/riderpeople.js: buildPeople), in road and commuter colours. They follow the park's own data: the one-way ways of
// East, West and Center Drive (kind drive, in the chunks' json), in the direction the data draws them, which is the loop's (counter-clockwise:
// north on the east side, south on the west). Runners keep to the inner (left) side, cyclists towards the middle. A pool only: `?parkloop=N`
// figures (default 24 = 16 runners + 8 cyclists) within 220 m of the camera (the runners within 120 m), put back on the drives ahead or behind when they fall out of
// reach; four in ten as many at night. `?parkloop=0` = none. The player's car is NOT stopped by them and does not knock them down: when the
// player moves faster than a walk within 9 m they move over to the far edge of the asphalt (see the hand-over's NOT DONE).
import * as THREE from 'three';
import { BASE } from './ground.js';
import { buildBike, buildWheel, AXLES, riderMaterial, BIKE } from '../riders/ridermodel.js';
import { buildPeople } from '../riders/riderpeople.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), R_NEAR = 220, R_OFF = 245, R_RUN = 120, R_RUN_OFF = 135;      /* the runners keep nearer the camera than the cyclists: 16 spread over 220 m of reach left one every 40 m of drive and none in most views (hold lp1) */
const pack = (c) => (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);
// November running kit, as the crowd's tints (top, bottom): a jacket or long sleeve, dark tights
const RUN_TOP = [[0.86, 0.9, 0.2], [0.85, 0.16, 0.14], [0.12, 0.3, 0.7], [0.06, 0.06, 0.07], [0.55, 0.57, 0.6], [0.9, 0.42, 0.1], [0.1, 0.5, 0.48], [0.82, 0.3, 0.52], [0.9, 0.9, 0.9], [0.2, 0.22, 0.3]].map(pack);
const RUN_BOT = [[0.05, 0.05, 0.06], [0.07, 0.08, 0.14], [0.14, 0.14, 0.15], [0.05, 0.05, 0.06], [0.22, 0.23, 0.26]].map(pack);
// the cyclists (riders' paint channels: jacket, trousers, helmet, vest, skin; the bike: frame, bar tape)
const JACKET = [[0.5, 0.03, 0.03], [0.03, 0.1, 0.42], [0.62, 0.7, 0.05], [0.015, 0.015, 0.018], [0.5, 0.5, 0.52], [0.6, 0.2, 0.02], [0.02, 0.26, 0.24], [0.55, 0.55, 0.5]];
const TIGHTS = [[0.012, 0.012, 0.014], [0.015, 0.02, 0.05], [0.03, 0.03, 0.032]], HELM = [[0.7, 0.7, 0.7], [0.02, 0.02, 0.02], [0.5, 0.04, 0.03], [0.05, 0.16, 0.5], [0.6, 0.62, 0.1]];
const SKIN = [[0.6, 0.4, 0.3], [0.42, 0.26, 0.18], [0.24, 0.14, 0.09], [0.66, 0.48, 0.38]];
const FRAME = [[0.015, 0.015, 0.016], [0.7, 0.7, 0.68], [0.25, 0.62, 0.55], [0.5, 0.03, 0.03], [0.04, 0.12, 0.45], [0.3, 0.3, 0.32], [0.55, 0.3, 0.03]], TAPE = [[0.02, 0.02, 0.02], [0.75, 0.75, 0.75], [0.02, 0.02, 0.02]];
const W1 = [1, 1, 1];
const tint16 = (c1, c2, c3, c4, c5) => { const t = new Float32Array(16); t.set([c1[0], c1[1], c1[2], c5[0], c2[0], c2[1], c2[2], c5[1], c3[0], c3[1], c3[2], c5[2], c4[0], c4[1], c4[2], 1]); return t; };

export function install(game, park) {
  const Q = game.P || new URLSearchParams(location.search), qv = Q.get('parkloop'); if (qv === '0' || park.loop) return park.loop || null;
  const N = qv !== null && qv !== '' && +qv > 0 ? Math.min(120, Math.round(+qv)) : 24, NR = Math.round((N * 2) / 3), NC = N - NR;
  const L = (park.loop = { on: false, n: N, runners: 0, cyclists: 0, ways: 0, places: 0, night: 1, draws: 0, people: null, err: null });
  let seed = 20261117; const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length];

  // ---------------------------------------------------------------- the drives: the loop's one-way ways, joined end to start
  const ways = new Map(), wayList = [], seenData = new WeakSet();
  const mkWay = (p) => { const P = p.pts, X = [], Y = []; for (const q of P) { const k = X.length; if (k && Math.hypot(q[0] - X[k - 1], q[1] - Y[k - 1]) < 0.3) continue; X.push(q[0]); Y.push(q[1]); } const n = X.length - 1; if (n < 1) return null;
    const w = { id: p.id, n, X: Float32Array.from(X), Y: Float32Array.from(Y), U: new Float32Array(n), V: new Float32Array(n), S: new Float32Array(n + 1), len: 0, hw: clamp((p.w || 10) / 2 - 0.9, 1.6, 4.2), next: [], x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    for (let i = 0; i < n; i++) { const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i], l = Math.hypot(dx, dy); w.U[i] = dx / l; w.V[i] = dy / l; w.S[i + 1] = w.S[i] + l; }
    for (let i = 0; i <= n; i++) { w.x0 = Math.min(w.x0, X[i]); w.x1 = Math.max(w.x1, X[i]); w.y0 = Math.min(w.y0, Y[i]); w.y1 = Math.max(w.y1, Y[i]); } w.len = w.S[n]; return w; };
  const scanWays = () => { let added = false;
    for (const C of park.chunks.values()) { const d = C.data; if (!d || seenData.has(d)) continue; seenData.add(d);
      for (const p of d.paths || []) { if (p.kind !== 'drive' || p.oneway !== 'yes' || p.tunnel || !p.pts || p.pts.length < 2 || ways.has(p.id) || !/^(East|West|Center) Drive$/.test(p.name || '')) continue; const w = mkWay(p); if (w && w.len > 6) { ways.set(p.id, w); wayList.push(w); added = true; } } }
    if (added) { for (const a of wayList) { a.next.length = 0; const ex = a.X[a.n], ey = a.Y[a.n]; for (const b of wayList) if (b !== a && Math.hypot(b.X[0] - ex, b.Y[0] - ey) < 4) a.next.push(b); } L.ways = wayList.length; } };

  // ---------------------------------------------------------------- the pool. A runner is shaped as the crowd's renderer reads a walker.
  const F = [];
  for (let k = 0; k < N; k++) F.push({ run: k < NR, on: false, way: null, i: 0, t: 0, lat: 0, lat0: 0, v: 0, v0: 0, x: 0, y: 0, z: BASE, h: 0, d: 0,
    id: 900000 + k, char: 0, scale: 1, tall: 1, lag: 0, rate: 1, clip: 0, clipB: 0, ph: rand(), phB: 0, blend: 0, fall: 0, tint: [0xffffff, 0xffffff, 0xffffff], state: 'walk', seatOf: null, acc: 0, accT: [],
    pv: 0, tr: null, tb: null, odo: rand() * 2, pitch: 0 });
  const T = game.terrain, world = game.world;
  let R = null, sim = null, up0 = null, mine = null, jog = null, runc = null, fails = 0;
  // where figures may be put: points every 9 m along the ways within reach of the camera (made again once a second)
  const CAP = 700, cW = new Array(CAP), cS = new Float32Array(CAP), cD = new Float32Array(CAP); let cN = 0, cx = 0, cy = 0, fx = 0, fy = 1;
  const places = () => { cN = 0; for (const w of wayList) { if (w.x1 < cx - R_NEAR || w.x0 > cx + R_NEAR || w.y1 < cy - R_NEAR || w.y0 > cy + R_NEAR) continue;
      let i = 0; for (let s = 2 + ((w.len * 7) % 5); s < w.len - 1 && cN < CAP; s += 9) { while (i < w.n - 1 && w.S[i + 1] < s) i++; const t = s - w.S[i], d = Math.hypot(w.X[i] + w.U[i] * t - cx, w.Y[i] + w.V[i] * t - cy); if (d < R_NEAR) { cW[cN] = w; cS[cN] = s; cD[cN] = d; cN++; } } } L.places = cN; };
  const at = (f) => { const w = f.way, i = f.i, c = Math.cos(f.h), s = Math.sin(f.h); f.x = w.X[i] + w.U[i] * f.t - s * f.lat; f.y = w.Y[i] + w.V[i] * f.t + c * f.lat; };
  const dress = (f) => {
    if (f.run) { const A = sim.adults && sim.adults.length ? sim.adults : null, ci = A ? A[Math.floor(rand() * A.length) % A.length] : 0, ch = sim.chars[ci] || {}; f.char = ci; f.scale = 0.96 + rand() * 0.08; f.tall = ((ch.height || 1.75) * f.scale) / 1.78;
      const c = jog, nat = (c.speed > 0.5 ? c.speed : 2.8) * f.tall; f.v0 = nat * (0.95 + rand() * rand() * 0.4);      /* the pace is the Jog clip's own, up to 1.35 times it: the stride never plays faster than the feet cover ground (the crowd's cast has no Run: crowd.js leaves it out) */ f.clip = f.clipB = c.i; f.tint[0] = pick(RUN_TOP); f.tint[1] = pick(RUN_BOT); f.tint[2] = ch.hair && ch.hair.length ? pack(pick(ch.hair)) : 0xffffff; f.lat0 = 0.3 + rand() * 0.62; }
    else { f.v0 = 5 + rand() * 3; f.pv = rand() < 0.7 ? (rand() < 0.5 ? 0 : 2) : rand() < 0.5 ? 1 : 3; const jk = pick(JACKET); f.tr = tint16(jk, pick(TIGHTS), pick(HELM), jk, pick(SKIN)); f.tb = tint16(pick(FRAME), pick(TAPE), W1, W1, W1); f.lat0 = -0.5 + rand() * 0.62; } };
  const spawn = (f, first) => { if (!cN) return false; const k = Math.floor(rand() * cN) % cN, w = cW[k], s = cS[k], d = cD[k]; let i = 0; while (i < w.n - 1 && w.S[i + 1] < s) i++;
    const px = w.X[i] + w.U[i] * (s - w.S[i]), py = w.Y[i] + w.V[i] * (s - w.S[i]);
    if (f.run && d > R_RUN) return false;
    if (first ? d < 6 : d < 70 && !(d > 30 && (px - cx) * fx + (py - cy) * fy < 0)) return false;       // not popped into view: far off, or behind the camera
    for (const g of F) if (g.on && Math.abs(g.x - px) < 7 && Math.abs(g.y - py) < 7) return false;
    if (!f.v0 || rand() < 0.5) dress(f); f.way = w; f.i = i; f.t = s - w.S[i]; f.h = Math.atan2(w.V[i], w.U[i]); f.lat = f.lat0 * w.hw; f.v = f.v0; f.on = true; at(f); return true; };
  const off = (f) => { f.on = false; f.way = null; };

  // ---------------------------------------------------------------- the cyclists' draws (the riders' own geometry and materials)
  const batches = []; let PB = null, BKb = null, WHb = null, ppTry = 0;
  const batch = (geo, cap, material) => { const im = new THREE.InstancedMesh(geo, material, cap), tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); tint.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aTint', tint);
    im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.count = 0; im.visible = false; im.name = 'parkloop'; im.userData.brkOwn = true; world.scene.add(im); const b = { im, tint, n: 0, cap }; batches.push(b); return b; };
  const put = (b, m, t) => { if (b.n >= b.cap) return; b.im.setMatrixAt(b.n, m); b.tint.array.set(t, b.n * 16); b.n++; };
  const figures = () => { if (PB || !NC || ppTry > 30) return; ppTry++; let P = null; try { P = buildPeople(game); } catch (e) { ppTry = 99; L.err = 'figures: ' + (e && e.message); console.log('[game] park loop: the cyclists\' figures were not made: ' + (e && e.message)); return; } if (!P || !P.ride) return;
    for (const k of Object.keys(P)) if (k !== 'ride' && Array.isArray(P[k])) for (const f of P[k]) if (f && f.geometry) f.geometry.dispose();      // only the riding pose is used
    const mat = riderMaterial(); BKb = batch(buildBike(true), NC, mat); WHb = batch(buildWheel(), NC * 2, mat); PB = P.ride.map((f) => batch(f.geometry, NC, f.material)); L.people = P.report || true; };
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1), WT = new Float32Array(16).fill(1);
  const drawBikes = () => { for (const b of batches) b.n = 0;
    if (PB) for (const f of F) { if (!f.on || f.run || f.d > R_NEAR) continue; const c = Math.cos(f.h), s = Math.sin(f.h), z = BASE + T.h(f.x, f.y);
      _q.setFromAxisAngle(AY, f.h); _q2.setFromAxisAngle(AZ, f.pitch); _q.multiply(_q2); _m.compose(_p.set(f.x, z, -f.y), _q, ONE);
      put(BKb, _m, f.tb); const a = -f.odo / BIKE.R; for (const ax of AXLES) put(WHb, _m2.multiplyMatrices(_m, _l.makeRotationZ(a + ax[0]).setPosition(ax[0], ax[1], 0)), WT); put(PB[f.pv % PB.length], _m, f.tr);
      const hF = T.h(f.x + c * 0.58, f.y + s * 0.58), hR = T.h(f.x - c * 0.56, f.y - s * 0.56); f.pitch += (clamp(Math.atan2(hF - hR, 1.14), -0.2, 0.2) - f.pitch) * 0.2; }
    let n = 0; for (const b of batches) { b.im.count = b.n; b.im.visible = b.n > 0; if (b.n) { b.im.instanceMatrix.needsUpdate = true; b.tint.needsUpdate = true; n++; } } L.draws = n; };

  // ---------------------------------------------------------------- one frame
  let last = 0, lastT = null, scanAt = 0, pcx = 0, pcy = 0, px0 = 0, py0 = 0, pSp = 0, wantR = NR, wantC = NC;
  const allOff = () => { for (const f of F) if (f.on) off(f); L.runners = L.cyclists = 0; };
  const second = () => { scanWays(); places(); figures(); const u = world.shared && world.shared.uNightK, k = u ? (u.value ? u.value.x : u.x) : 1; const nf = !(k < 0.5) ? 1 : 0.4 + 0.6 * clamp((k - 0.15) / 0.35, 0, 1); L.night = nf; wantR = Math.round(NR * nf); wantC = PB ? Math.round(NC * nf) : 0; };
  const fill = (first) => { let nr = 0, nc = 0; for (const f of F) if (f.on) { if (f.run) nr++; else nc++; }
    let tries = first ? N * 8 : 3; for (const f of F) { if (f.on) continue; if (f.run ? nr >= wantR : nc >= wantC) continue; if (tries-- <= 0) break; if (spawn(f, first)) { if (f.run) nr++; else nc++; } }
    L.runners = nr; L.cyclists = nc; };
  function step() {
    const now = performance.now(); let dt = clamp((now - last) / 1000, 0, 0.1); last = now; if (typeof game.t === 'number') { dt = lastT === null ? 0 : clamp(game.t - lastT, 0, 3); lastT = game.t; }
    const cam = world.camera; cx = cam.position.x; cy = -cam.position.z; { const e = cam.matrixWorld.elements, l = Math.hypot(e[8], e[10]) || 1; fx = -e[8] / l; fy = e[10] / l; }
    if (!T.inBox(cx, cy)) { if (L.runners + L.cyclists) allOff(); if (L.draws) drawBikes(); return; }
    if (now - scanAt > 1000 || Math.abs(cx - pcx) + Math.abs(cy - pcy) > 25) { const first = !scanAt; scanAt = now; pcx = cx; pcy = cy; second(); if (first) fill(true); }
    const pl = game.player; let plx = 1e9, ply = 1e9; if (pl && typeof pl.x === 'number') { plx = pl.x; ply = pl.y; if (dt > 0) { pSp += (Math.min(40, Math.hypot(plx - px0, ply - py0) / dt) - pSp) * 0.2; } px0 = plx; py0 = ply; }
    const fast = pSp > 2.2;
    for (const f of F) { if (!f.on) continue; const w = f.way, c = Math.cos(f.h), s = Math.sin(f.h);
      // the others: move over for a slower one ahead, never run into its back; move to the far edge for the player's vehicle
      let goal = f.lat0 * w.hw, vmax = f.v0, quick = 1.2;
      for (const g of F) { if (g === f || !g.on) continue; const dx = g.x - f.x, dy = g.y - f.y; if (dx > 14 || dx < -14 || dy > 14 || dy < -14) continue; const ah = dx * c + dy * s, sd = -dx * s + dy * c;
        if (ah > -1.2 && ah < 1.2 && Math.abs(sd) < 0.95) goal += sd >= 0 ? -0.8 : 0.8;      /* side by side: apart */
        if (ah > 0 && ah < 4 + f.v && Math.abs(sd) < 1.1 && g.v < f.v0) { goal += sd >= 0 ? -1.3 : 1.3; if (ah < (f.run ? 1.3 : 2.6) && Math.abs(sd) < 0.75) vmax = Math.min(vmax, g.v); } }
      if (fast) { const dx = plx - f.x, dy = ply - f.y; if (dx * dx + dy * dy < 81) { goal = -dx * s + dy * c >= 0 ? -(w.hw + 0.7) : w.hw + 0.7; quick = 3.2; } }
      goal = clamp(goal, -(w.hw + 0.7), w.hw + 0.7); f.lat += clamp(goal - f.lat, -quick * dt, quick * dt); f.v += clamp(vmax - f.v, -3 * dt, 1.5 * dt);
      f.t += f.v * dt; let i = f.i, gone = false; while (f.t > w.S[i + 1] - w.S[i]) { f.t -= w.S[i + 1] - w.S[i]; i++; if (i >= f.way.n) { const nx = f.way.next; if (!nx.length) { gone = true; break; } const b = nx[Math.floor(rand() * nx.length) % nx.length]; f.lat = clamp(f.lat, -(b.hw + 0.7), b.hw + 0.7); f.way = b; i = 0; } if (f.way !== w) break; }
      if (gone) { off(f); continue; } f.i = i; const w2 = f.way; let dh = Math.atan2(w2.V[i], w2.U[i]) - f.h; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI; f.h += dh * Math.min(1, dt * (f.run ? 5 : 3.5)); at(f);
      f.d = Math.hypot(f.x - cx, f.y - cy); if (f.d > (f.run ? R_RUN_OFF : R_OFF)) { off(f); continue; }
      if (f.run) { const cl = sim.clips[f.clip]; f.rate = cl.speed > 0 ? clamp(f.v / (cl.speed * f.tall), 0, 1.6) : 1; f.ph += (dt * f.rate) / cl.duration; if (f.ph >= 1) f.ph -= Math.floor(f.ph); } else f.odo += f.v * dt; }
    // the night: fewer; those over the count leave when they are out of sight
    { let nr = 0, nc = 0; for (const f of F) if (f.on) { if (f.run ? ++nr > wantR : ++nc > wantC) { if (f.d > 60 || (f.x - cx) * fx + (f.y - cy) * fy < 0) off(f); } } }
    fill(false); drawBikes();
  }
  L.fill = () => { try { if (!R) hookUp(); if (!R) return; scanAt = performance.now(); const cam = world.camera; cx = cam.position.x; cy = -cam.position.z; second(); fill(true); cam.updateMatrixWorld(); R.update(); } catch (e) { L.err = String(e && e.message); } };      /* settle(): the figures for where the camera is now are placed and drawn (stills) */

  // ---------------------------------------------------------------- joined to the crowd's renderer: our runners are in its list while it draws
  function hookUp() { const r = game.crowd && game.crowd.render, s = r && r.sim; if (!r || !s || !Array.isArray(s.agents) || !s.clips || typeof r.update !== 'function') return;
    const by = (re) => s.clips.find((c) => re.test(c.name) && c.duration > 0); jog = by(/^jog$/i) || s.jog || null; runc = by(/^run$/i) || null; if (!jog) { L.err = 'the crowd has no Jog clip'; clearInterval(timer); return; }
    R = r; sim = s; up0 = r.update;
    mine = r.update = function () { let n0 = -1; if (fails < 3) try { step(); const A = sim.agents; n0 = A.length; for (const f of F) if (f.on && f.run) A.push(f); } catch (e) { fails++; L.err = String(e && (e.stack || e.message)).slice(0, 300); console.log('[game] park loop: ' + L.err); if (fails >= 3) { allOff(); for (const b of batches) b.im.visible = false; } }
      try { return up0.apply(this, arguments); } finally { if (n0 >= 0 && sim.agents.length > n0) sim.agents.length = n0; } };
    L.on = true; clearInterval(timer); console.log('[game] park loop: ' + NR + ' runners and ' + NC + ' cyclists on the drives (?parkloop=0 = none)'); }
  let tries = 0; const timer = setInterval(() => { if (++tries > 120) { clearInterval(timer); if (!L.err) L.err = 'no crowd: no runners or cyclists'; return; } try { hookUp(); } catch (e) { L.err = String(e && e.message); } }, 1000);
  L.stop = () => { clearInterval(timer); if (R && R.update === mine) R.update = up0; allOff(); for (const b of batches) { world.scene.remove(b.im); b.im.geometry.dispose(); } batches.length = 0; PB = null; L.on = false; };
  L._dbg = () => F;      /* tools/lp-dry.mjs reads the pool */
  const d0 = park.dispose; if (d0) park.dispose = () => { L.stop(); d0(); };
  const c0 = park.count; if (c0) park.count = () => Object.assign(c0(), { loop: [L.runners, L.cyclists, L.ways, L.places, L.draws, L.night, L.err] });
  const s0 = park.settle; if (s0) park.settle = async () => { await s0(); L.fill(); };
  return L;
}
