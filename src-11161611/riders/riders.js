// riders/riders.js (people lane, Nov 15; Matt: "delivery ppl on bikes with those boxes omg"): food-delivery riders on e-bikes.
//   ?cychit=0   the player's car into a rider: the plain tip-over as it was (see knock() below)
//   ?riders=0   all of it off          ?riders=N   how many ride around the player (default 22)          ?riderclumps=0   no parked clumps
// New files only (riders.js, ridermodel.js). One line in Game.init() after the moto line:
//     if (this.P.get('riders') !== '0') import('./riders/riders.js').then((m) => m.install(this)).catch((e) => console.log('[riders] not loaded: ' + (e && (e.stack || e.message))));
// What it is:
//   - riders in the roadway on their own lines: along either kerb edge of the lanes or between two lanes, quicker than the queue, changing line when
//     one is blocked; about one in five rides AGAINST a one-way street along its kerb; most roll through a red light when nothing is crossing;
//   - a few on the sidewalk at little more than walking pace, slowing and steering round people;
//   - parked clumps: three to six bikes on their stands at the kerb outside food fronts (the street layer's shop list), riders standing by on their phones.
// It wraps (nothing of the game's is edited): game.step, game.syncVisuals, traffic.gapAhead (cars brake for a rider in their way), traffic.populate.
// The player's car hitting a rider or a parked bike at speed knocks it down (it slides, lies there, is taken away after 9 s).
import * as THREE from 'three';
import { clamp, wrapPi, rng } from '../geo.js';
import { buildBike, buildBox, buildCrate, buildRider, buildWheel, AXLES, riderMaterial, BIKE } from './ridermodel.js';
import { furnitureOf } from '../crowd/nav.js';
import { buildPeople, VARIANTS, PEOPLE_POSES } from './riderpeople.js';

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const JACKET = [0x26282d, 0x283048, 0x34373d, 0x413e36, 0x2c3f33, 0x26282d, 0x1c1d21, 0x3c4150, 0x4a4c50].map(lin).map((c) => c.map((v) => v * 0.6)), PANTS = [0x24262b, 0x2e3038, 0x33405e, 0x4c5058, 0x1c1d20, 0x5a5346].map(lin).map((c) => c.map((v) => v * 0.75));
const HELM = [0x101012, 0x101012, 0x101012, 0x2a2b2e, 0xb9b9b4, 0x7a1f1a, 0x1c2f5a, 0x4a4c50].map(lin), VEST = [0xc9de1c, 0xc9de1c, 0xf0660f].map(lin), SKIN = [0xc68f6a, 0x9a6a48, 0x7a5236, 0xdcae8a, 0x5c3b28, 0xb37a52].map(lin);
const BOXC = [0x121214, 0x121214, 0x121214, 0x17181b, 0x1d1e21, 0x2b2d31, 0x3a3c40, 0x55575a, 0x121214, 0x8f2219, 0xa8281c, 0x1d6b4e, 0x23624a, 0xb55a12, 0x1b7f7c, 0x20416f].map(lin), CRATEC = [0x141416, 0x141416, 0x1c3566, 0x7a1d18, 0x24502f, 0x3a3c40, 0x6b4a2a].map(lin), BAGC = [0xd8d6cf, 0xd8d6cf, 0x8a6a45, 0x1b1b1d, 0xc9c2a8].map(lin), FRAME = [0x1c1d20, 0x1c1d20, 0x3a3c42, 0xb01e18, 0x1b4a9a, 0xd4d4d2, 0x2c6436, 0x6a6c70].map(lin), TAPE = [0xcf281a, 0x1a50c8, 0xe2c015, 0x129a46, 0xe4e4e4, 0x0e0e0e, 0xe07410].map(lin);
const BACK = { ride: [-0.62, 1.02, -0.3], astride: [-0.6, 1.03, -0.25] };
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1), o1 = {}, o2 = {};

export async function install(g) {
  const P = g.P, sel = P && P.get('riders'); if (sel === '0' || sel === 'none') return null;
  const R = g.roads, TR = g.traffic, st = g.statics, pl = g.player, rand = rng(60606), scene = g.world.scene;
  const TARGET0 = Math.max(0, Math.min(80, sel ? +sel || 32 : 32)), WALKERS = Math.round(TARGET0 * 0.12), CLUMPS = !(P && P.get('riderclumps') === '0');
  const out = { on: true, list: [], clumps: [], stats: { spawned: 0, hits: 0, shoved: 0, touch: 0, furn: 0, pushed: 0, ms: 0, drawn: 0 }, target: TARGET0 }; g.riders = out;
  const CYC = !(P && P.get('cychit') === '0'), HARD = 4; if (CYC) { out.stats.thrown = 0; out.stats.clatter = 0; }
  // lunch and dinner bring more of them out, the small hours fewer (the game's clock, when it has one)
  let TARGET = TARGET0; const hours = () => { let h = 12; try { if (g.night && isFinite(g.night.tod)) h = g.night.tod; } catch (e) {} const k = (h >= 11.5 && h < 14.5) || (h >= 17.5 && h < 21.5) ? 1.3 : h >= 1 && h < 6 ? 0.5 : 1; TARGET = Math.round(TARGET0 * k); out.target = TARGET; };
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length], kerbZ = (x, y) => (st.onSidewalk(x, y) ? 0.15 : 0);

  // ------------------------------------------------------------------ drawing: instances
  const mat = riderMaterial(), batches = [];
  function batch(geo, cap, shadow = true, material = mat) { const im = new THREE.InstancedMesh(geo, material, cap), tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); tint.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aTint', tint);
    im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true; im.count = 0; im.visible = false; im.name = 'rider'; im.userData.brkOwn = true; scene.add(im); const b = { im, tint, n: 0, cap }; batches.push(b); return b; }
  const put = (b, m, t) => { if (b.n >= b.cap) return; b.im.setMatrixAt(b.n, m); b.tint.array.set(t, b.n * 16); b.n++; };
  const BK = [batch(buildBike(true), 110), batch(buildBike(false), 60)], BX = batch(buildBox(), 150), CR = batch(buildCrate(), 70), WH = batch(buildWheel(), 340), RD = {}, WT = new Float32Array(16).fill(1);
  for (const pose of ['ride', 'astride', 'stand', 'stand2']) for (const gear of ['helmet', 'hood']) RD[pose + gear] = batch(buildRider(pose, gear), pose === 'ride' ? 60 : 50);
  // the rider as one of the game's own people (riderpeople.js): the crowd's bodies, posed and dressed; near the camera only, the made-in-code figure beyond
  const NEAR_R = Math.max(0, +(P && P.get('riderpeople') !== null && P.get('riderpeople') !== '' ? P.get('riderpeople') : 48) || 0); let PP = null, ppTry = 0;
  function people() { if (PP || !NEAR_R || ppTry > 40) return; ppTry++; let F = null; try { F = buildPeople(g); } catch (e) { ppTry = 99; console.log('[riders] people figures not made: ' + (e && (e.stack || e.message))); return; } if (!F) return;
    const B = {}; for (const pose of PEOPLE_POSES) B[pose] = F[pose].map((f) => Object.assign(batch(f.geometry, pose === 'ride' ? 14 : pose === 'stand' ? 12 : 10, true, f.material), { back: f.back })); PP = B; out.people = F.report; console.log('[riders] figures from the crowd cast: ' + JSON.stringify(F.report)); }
  const tint = (c1, c2, c3, c4, c5) => { const t = new Float32Array(16); t.set([c1[0], c1[1], c1[2], c5[0], c2[0], c2[1], c2[2], c5[1], c3[0], c3[1], c3[2], c5[2], c4[0], c4[1], c4[2], 1]); return t; };
  // what one rider and bike look like
  function looks(o) { const jk = pick(JACKET), W = [1, 1, 1]; o.pv = Math.floor(rand() * VARIANTS.length) % VARIANTS.length; o.gear = VARIANTS[o.pv].gear === 'helmet' ? 'helmet' : 'hood'; o.tr = tint(jk, pick(PANTS), pick(HELM), rand() < 0.13 ? pick(VEST) : jk, pick(SKIN));
    o.bk = rand() < 0.72 ? 0 : 1; o.tb = tint(pick(FRAME), pick(TAPE), W, W, W); { const q = rand(); o.box = q < 0.62 ? 1 : q < 0.8 ? 2 : q < 0.9 ? 4 : q < 0.96 ? 3 : 0; } o.tx = tint(pick(BOXC), W, W, W, W); o.tc = tint(pick(CRATEC), pick(BAGC), W, W, W); o.odo = rand() * 2; o.bs = 0.9 + rand() * 0.24; o.bh = 0.88 + rand() * 0.2; o.sc = 0.95 + rand() * 0.09; return o; }
  function bikeMat(x, y, z, h, lean, sc) { _q.setFromAxisAngle(AY, h); _q2.setFromAxisAngle(AX, lean); _q.multiply(_q2); _m.compose(_p.set(x, z, -y), _q, ONE); return _m; }
  function draw(o, x, y, z, h, lean, pose, nearBy) {      // pose: null = the bike alone; nearBy: close enough for the figure from the cast
    const M = bikeMat(x, y, z, h, lean); put(BK[o.bk], M, o.tb); { const a = -(o.odo || 0) / BIKE.R; for (const ax of AXLES) put(WH, _m2.multiplyMatrices(M, _l.makeRotationZ(a + ax[0]).setPosition(ax[0], ax[1], 0)), WT); }
    if (o.box === 1) { _l.makeScale(o.bs, o.bs * o.bh, o.bs).setPosition(BIKE.rack[0] - (o.bs - 1) * 0.12, BIKE.rack[1], 0); put(BX, _m2.multiplyMatrices(M, _l), o.tx); }
    else if (o.box >= 3) put(CR, _m2.multiplyMatrices(M, _l.makeTranslation(BIKE.rack[0], BIKE.rack[1], 0)), o.tc);
    if (!pose) return; const pb = nearBy && PP ? PP[pose][o.pv] : null; put(pb || RD[pose + o.gear], M, o.tr);
    if (o.box === 2 || o.box === 4) { const b = pb ? pb.back : BACK[pose] || BACK.ride; _l.makeRotationZ(b[2]).setPosition(b[0], b[1], 0); put(BX, _m2.multiplyMatrices(M, _l), o.tx); }
  }

  // ------------------------------------------------------------------ where one can ride
  const half = (e) => (e.oneway ? e.lanes * e.lw / 2 : Math.max(1, Math.floor(e.lanes / 2)) * e.lw);
  // the lines a rider keeps on a block, metres to the right of the centre line seen the way he goes
  function slots(e, dir, a = []) { a.length = 0; const W = half(e);
    if (e.oneway && dir < 0) a.push(-(W - 0.2), W - 0.2);
    else if (e.oneway) { a.push(-(W - 0.3)); for (let k = 1; k < e.lanes; k++) a.push((k - e.lanes / 2) * e.lw); a.push(W - 0.3); }
    else { const n = Math.max(1, Math.floor(e.lanes / 2)); for (let k = 1; k < n; k++) a.push(k * e.lw); a.push(W - 0.3); }
    return a; }
  function posOn(e, dir, s, lo, o) { (dir > 0 ? e.line : e.rev).at(s, o); o.x += o.ty * lo; o.y -= o.tx * lo; o.h = Math.atan2(o.ty, o.tx); return o; }
  const usable = (e) => e.s0 !== undefined && !e.out && e.len > 30;
  let near = [], nearT = 0;
  function nearEdges(px, py) { if (--nearT > 0) return near; nearT = 20; near = []; for (const e of R.edges) { if (!usable(e)) continue; e.line.at(e.len / 2, o1); if (Math.hypot(o1.x - px, o1.y - py) < 300 + e.len / 2) near.push(e); } return near; }
  function spawnRoad(px, py, anywhere) {
    const N = nearEdges(px, py); if (!N.length) return null;
    for (let k = 0; k < 10; k++) {
      let e = pick(N); if (!e.ave && rand() < 0.55) e = pick(N); const salmon = rand() < 0.2, dir = e.oneway ? (salmon ? -1 : 1) : rand() < 0.5 ? 1 : -1, sl = slots(e, dir), s = 8 + rand() * (e.len - 20);
      const lo = rand() < 0.68 ? (rand() < 0.5 ? sl[0] : sl[sl.length - 1]) : pick(sl); posOn(e, dir, s, lo, o1); const d = Math.hypot(o1.x - px, o1.y - py);
      if (d > 240 || d < (anywhere ? 14 : 90) || !g.bounds.in(o1.x, o1.y, -5)) continue;
      if (!anywhere && ((px - o1.x) * Math.cos(o1.h) + (py - o1.y) * Math.sin(o1.h)) < 0.3 * d && rand() < 0.8) continue;
      if (!anywhere && d < 210 && st.raycast(px, py, o1.x, o1.y) >= 1) continue;
      let ok = true; for (const q of out.list) if (Math.abs(q.x - o1.x) < 5 && Math.abs(q.y - o1.y) < 5) { ok = false; break; } if (ok) for (const c of TR.cars) if (Math.abs(c.x - o1.x) < 4 && Math.abs(c.y - o1.y) < 4) { ok = false; break; } if (!ok) continue;
      const r = looks({ mode: 'road', e, dir, s, lo, tlo: lo, x: o1.x, y: o1.y, h: o1.h, hv: o1.h, v: 5, v0: (e.oneway && dir < 0 ? 5 : 6.6) + rand() * 2.4, salmon, runner: rand() < 0.65, lean: 0, state: 'ride', t: 0, cool: rand() * 3, j: null, stopT: 0, z: 0, id: out.stats.spawned });
      out.list.push(r); out.stats.spawned++; return r;
    }
    return null;
  }
  function spawnWalk(px, py, anywhere) {
    const L = g.peds && g.peds.nearLoops ? g.peds.nearLoops(px, py) : null; if (!L || !L.length) return null;
    for (let k = 0; k < 8; k++) { const l = pick(L), s = rand() * l.len; l.at(s, o1); const d = Math.hypot(o1.x - px, o1.y - py); if (d > 220 || d < (anywhere ? 12 : 90) || !st.onSidewalk(o1.x, o1.y)) continue; if (!anywhere && d < 170 && st.raycast(px, py, o1.x, o1.y) >= 1) continue;
      const r = looks({ mode: 'walk', loop: l, s, dir: rand() < 0.5 ? 1 : -1, off: (rand() - 0.5) * 1.6, toff: 0, x: o1.x, y: o1.y, h: 0, hv: 0, v: 2.5, v0: 2.6 + rand() * 1.3, lean: 0, state: 'ride', t: 0, cool: 0, z: 0.15, id: out.stats.spawned }); r.toff = r.off;
      out.list.push(r); out.stats.spawned++; return r; }
    return null;
  }
  out.populate = (px, py) => { let n = 0; for (let k = 0; k < 200 && count('road') < TARGET; k++) if (spawnRoad(px, py, true)) n++; for (let k = 0; k < 40 && count('walk') < WALKERS; k++) spawnWalk(px, py, true); return n; };
  const count = (mode) => { let n = 0; for (const r of out.list) if (r.mode === mode && r.state === 'ride') n++; return n; };

  // ------------------------------------------------------------------ what is in the way: cars (traffic, the player's), people on the roadway, the player on foot
  const obs = []; let obsN = 0;
  // the street layer's furniture that is not in the game's collision world (planters, blocks, racks, docks, cones ...): crowd/nav.js's own list, in an 8 m grid
  let FG = null; const fk = (i, j) => i * 8192 + j;
  function furn() { let ex = []; try { ex = furnitureOf(g).extra; } catch (e) {} FG = new Map(); for (const o of ex) { const k = fk(Math.floor(o.x / 8), Math.floor(o.y / 8)); let a = FG.get(k); if (!a) FG.set(k, (a = [])); a.push({ x: o.x, y: o.y, h: o.h || o.r || 0.3, road: undefined }); } out.stats.furniture = ex.length; props(); }
  // everything the street layer stands on the ground, for placing the parked rows: nav's list knows only what walkers must round, so chalk boards,
  // lamp and signal poles, sign posts, hydrants and the rest are read here from the same lists (visual size, not walking size), and the trees from the collision world
  let PG = null;
  function props() { PG = new Map(); let n = 0; const F = g.streets && g.streets.parts && g.streets.parts.furniture; if (!F) return; const all = []; if (F.sets) for (const k in F.sets) if (F.sets[k] && F.sets[k].kinds && !all.includes(F.sets[k].kinds)) all.push(F.sets[k].kinds); if (F.kinds && !all.includes(F.kinds)) all.push(F.kinds);
    const R0 = [[/^(scrap|cbflat|shed|scaf|net|banner|fence)/, 0], [/^(lamp|sig|twin|cab)/, 0.34], [/^(meter|spost|psign|busstop|armsign|oneway|blade|delin|cone)/, 0.2], [/^(chalk|aframe)/, 0.5], [/^hyd/, 0.35], [/^(ptable|planter|block|kiosk|cart|shelter|bench)/, 0.8], [/^(bike|rack|dock)/, 0.75]];
    for (const K of all) for (const name in K) { const L = K[name] && K[name].list; if (!L) continue; const m = R0.find((q) => q[0].test(name)), r = m ? m[1] : 0.42; if (!r) continue;
      for (const it of L) { if (!(it[2] <= 1)) continue; const k = fk(Math.floor(it[0] / 8), Math.floor(it[1] / 8)); let a = PG.get(k); if (!a) PG.set(k, (a = [])); a.push(it[0], it[1], r); n++; } }
    out.stats.props = n; }
  function propHit(x, y, r) { if (PG) { const i0 = Math.floor((x - r - 1) / 8), i1 = Math.floor((x + r + 1) / 8), j0 = Math.floor((y - r - 1) / 8), j1 = Math.floor((y + r + 1) / 8);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = PG.get(fk(i, j)); if (a) for (let q = 0; q < a.length; q += 3) if (Math.hypot(a[q] - x, a[q + 1] - y) < a[q + 2] + r) return true; } }
    try { const c = st.cell, i0 = Math.floor((x - r - 1.2) / c), i1 = Math.floor((x + r + 1.2) / c), j0 = Math.floor((y - r - 1.2) / c), j1 = Math.floor((y + r + 1.2) / c);      // a tree: clear of its pit, not only of its trunk
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = st.circ.get(st.key(i, j)); if (a) for (const o of a) if (o.on && o.tag === 'tree' && Math.hypot(o.x - x, o.y - y) < 0.75 + r) return true; } } catch (e) {}
    return false; }
  function furnHit(x, y, r) { if (!FG) return null; const i0 = Math.floor((x - r - 1.6) / 8), i1 = Math.floor((x + r + 1.6) / 8), j0 = Math.floor((y - r - 1.6) / 8), j1 = Math.floor((y + r + 1.6) / 8);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = FG.get(fk(i, j)); if (a) for (const o of a) if (Math.hypot(o.x - x, o.y - y) < o.h + r) return o; } return null; }
  function gather(fx, fy) { obsN = 0; const add = (x, y, h, hl, hw, vx, vy, who) => { let o = obs[obsN]; if (!o) o = obs[obsN] = {}; obsN++; o.x = x; o.y = y; o.c = Math.cos(h); o.s = Math.sin(h); o.hl = hl; o.hw = hw; o.vx = vx; o.vy = vy; o.who = who; };
    for (const c of TR.cars) { if (Math.abs(c.x - fx) > 330 || Math.abs(c.y - fy) > 330 || !c.def) continue; add(c.x, c.y, c.h, c.def.len / 2, c.def.wid / 2, Math.cos(c.h) * c.v, Math.sin(c.h) * c.v, c); }
    for (const v of g.vehicles) { if (!v.def || Math.abs(v.x - fx) > 330 || Math.abs(v.y - fy) > 330) continue; add(v.x, v.y, v.h, v.def.len / 2, v.def.wid / 2, v.vx || 0, v.vy || 0, v); }
    if (!pl.vehicle) add(pl.x, pl.y, pl.h || 0, 0.45, 0.45, 0, 0, pl);
    const S = g.crowd && g.crowd.on && g.crowd.sim; if (S && S.road) for (const a of S.road) add(a.x, a.y, 0, 0.45, 0.45, 0, 0, a);
    if (g.peds) for (const p of g.peds.list) if (p.onRoad) add(p.x, p.y, 0, 0.45, 0.45, 0, 0, p);
    for (const q of out.list) if (q.state === 'ride') add(q.x, q.y, q.hv, 0.8, 0.26, Math.cos(q.h) * q.v, Math.sin(q.h) * q.v, q);      // each other
  }
  const sl = [], seen = [];
  // look ahead along heading (cx, cy) from r: sets r._gap (metres of clear road), r._ov (how fast what blocks is going his way); pushes him out of anything he overlaps
  function look(r, cx, cy, reach, dt) {
    let gap = 1e9, ov = 0; seen.length = 0;
    for (let i = 0; i < obsN; i++) { const o = obs[i], dx = o.x - r.x, dy = o.y - r.y; if (dx > 34 || dx < -34 || dy > 34 || dy < -34 || o.who === r) continue;
      const f = dx * cx + dy * cy, l = -dx * cy + dy * cx, al = Math.abs(o.c * cx + o.s * cy), hl = al > 0.7 ? o.hl : al < 0.4 ? o.hw + 0.2 : o.hl * 0.8, hw = al > 0.7 ? o.hw : al < 0.4 ? o.hl : o.hl * 0.8;
      if (f > -hl - 3 && f - hl < 12) seen.push(f, l, hl, hw);
      if (Math.abs(l) < hw + 0.3 && Math.abs(f) < hl + 0.8) {      // touching: out to the nearer side; the player's car at speed knocks him down
        const sp = Math.hypot(o.vx, o.vy); if (o.who === pl.vehicle && sp > 2.5) { if (!(CYC && knock(r, o.who, true))) down(r, o.vx, o.vy, l); return; }
        const pen = Math.min(hw + 0.3 - Math.abs(l), 5 * dt), sg = l > 0 ? 1 : -1; r.x += cy * sg * pen; r.y -= cx * sg * pen; if (r.j) { r.jx = (r.jx || 0) + cy * sg * pen; r.jy = (r.jy || 0) - cx * sg * pen; } if (o.who && o.who.def && o.who !== pl.vehicle) { r.sq = 0.6; r.sqv = o.vx * cx + o.vy * cy; } if (r.mode === 'road' && !r.j) { const W2 = half(r.e) + 0.35; r.lo = clamp(r.lo + sg * pen, -W2, W2); r.tlo = r.lo; }      // he keeps the line he was pushed to
        if (!(r.sh > 0)) out.stats.shoved++; r.sh = 0.6; out.stats.touch++; }
      if (f <= 0 || f - hl > reach || Math.abs(l) > hw + 0.34) continue;
      const gp = f - hl - 0.85; if (gp < gap) { gap = gp; ov = o.vx * cx + o.vy * cy; } }
    // things standing in the roadway that the collision world does not hold: round them like a stopped car
    if (FG && r.mode === 'road') { const gi = Math.floor((r.x + cx * 5) / 8), gj = Math.floor((r.y + cy * 5) / 8);
      for (let i = gi - 1; i <= gi + 1; i++) for (let j = gj - 1; j <= gj + 1; j++) { const a = FG.get(fk(i, j)); if (!a) continue; for (const o of a) { if (o.road === undefined) o.road = !st.onSidewalk(o.x, o.y); if (!o.road) continue;
        const dx = o.x - r.x, dy = o.y - r.y, f = dx * cx + dy * cy, l = -dx * cy + dy * cx, h = o.h; if (f > -h - 3 && f - h < 12) seen.push(f, l, h, h);
        if (r.j || f < -h - 0.5 || f > 11 || Math.abs(l) > h + 0.4) continue; const W2 = half(r.e) + 0.35, sg = l > 0 ? 1 : -1, want = clamp(r.lo + sg * (h + 0.45 - Math.abs(l)), -W2, W2); if (sg > 0 ? want > r.tlo : want < r.tlo) r.tlo = want; out.stats.furn++; } } }
    r._gap = gap; r._ov = ov;
  }
  function slotFree(r, lo) { for (let i = 0; i < seen.length; i += 4) { const f = seen[i], l = seen[i + 1], hl = seen[i + 2], hw = seen[i + 3]; if (f - hl < 10 && f + hl > -2.5 && Math.abs(r.lo - l - lo) < hw + 0.42) return false; } return true; }
  out.releaseRider = (r, hit) => {
    if (r.sit) {
      const group = out.clumps.find(c => c.bikes.includes(r));
      if (!group) return false;
      group.bikes.splice(group.bikes.indexOf(r), 1);
      for (const circle of r.circ) circle.on = false;
      Object.assign(r, {sit:null, z:0.15, hv:r.h, v:0});
      out.list.push(r);
    } else if (r.state !== 'ride') return false;
    r.mode = 'fallen'; r.rider = false;
    down(r, Math.cos(r.hv)*r.v, Math.sin(r.hv)*r.v, hit.dy*Math.cos(r.hv) - hit.dx*Math.sin(r.hv));
    return true;
  };
  function down(r, vx, vy, l) { r.state = 'down'; r.t = 0; const sp = Math.hypot(vx, vy) || 1, sg = l > 0 ? -1 : 1; r.dvx = vx * 0.8 + (vy / sp) * sg * 1.5; r.dvy = vy * 0.8 - (vx / sp) * sg * 1.5; r.roll = sg; r.spin = (rand() - 0.5) * 3; out.stats.hits++;
    try { g.sound.thud(); } catch (e) {} try { g.missions.onPedHit(); } catch (e) {} }

  // ------------------------------------------------------------------ struck hard by the player's car (lead cychit, Nov 16; Matt, report 20261116-124454-32bf7f:
  // "they just fall to the side ... it doesn't look real at all ... there's no sound"). ?cychit=0 = the tip-over above, as it was.
  // At 4 m/s closing speed or more (14 km/h; slower keeps the gentle tip-over): the rider leaves the bike as one of the game's own people and is thrown by the
  // lead's pedhit ragdoll (game.onPedHit: its thud by speed, its camera knock, the street scattering); the bike alone is thrown ahead of the car and to the
  // side it was struck on, turns over in the air, comes down with a clatter, bounces once and slides to rest on its side. Nothing here runs until a hit.
  function clatter(f) { out.stats.clatter++; try { const s = g.sound; (s.clatter ? s : s.sfx).clatter(f); } catch (e) {} }
  function body(x, y, z, h, pv, v, act) { const PH = g.__pedhit, pd = g.peds; if (!PH || !PH.on || !pd || !pd.kinds || !pd.kinds.length || !pd.visual) return false;
    const vis = pd.visual(pd.kinds[(pv || 0) % pd.kinds.length]); if (!vis || !vis.object) return false;
    const p = { x, y, h, kind: vis.kind, vis, scale: 1, fall: 0, t: 0, state: 'down', speed: 0, vx: v.vx * 0.9, vy: v.vy * 0.9 };
    vis.object.scale.setScalar(1); vis.object.position.set(x, z, -y); vis.object.rotation.set(0, h, 0);
    if (vis.mixer) { vis.mixer.stopAllAction(); vis.cur = null; vis.mixer.timeScale = 1; const a = vis.acts[act] || vis.acts.idle; if (a) a.reset().play(); vis.mixer.setTime(0.2); vis.mixer.timeScale = 0; }
    vis.object.updateMatrixWorld(true); pd.list.push(p); try { g.onPedHit(p, v); } catch (e) { console.log('[riders] cychit: ' + (e && e.message)); } if (vis.mixer) vis.mixer.timeScale = 0; return true; }
  function knock(r, v, own) {      // own: he was riding, so his own speed counts; false: a bike on its stand. false back = not hard enough (or no ragdoll to give him): the caller tips him over as before
    const sp = Math.hypot(v.vx || 0, v.vy || 0), ox = own ? Math.cos(r.h) * r.v : 0, oy = own ? Math.sin(r.h) * r.v : 0, cs = Math.hypot(v.vx - ox, v.vy - oy); if (cs < HARD || sp < 0.5) return false;
    const had = own || !!r.rider; if (had && !body(r.x, r.y, r.z || 0, r.hv, own ? r.pv : r.sit ? r.sit.pv : r.pv, v, 'drive')) return false;
    const ux = v.vx / sp, uy = v.vy / sp, lat = -(r.x - v.x) * uy + (r.y - v.y) * ux, sg = Math.abs(lat) < 0.05 ? (rand() < 0.5 ? 1 : -1) : lat > 0 ? 1 : -1, side = 1.6 + 0.14 * cs + rand();
    r.state = 'down'; r.t = 0; r.mode = 'fallen'; r.rider = false; r.kn = 1; r.air = true; r.bz = 0; r.bvz = Math.min(5.5, 1.6 + 0.2 * cs); r.rest = 0;
    r.dvx = v.vx * 1.15 - uy * sg * side; r.dvy = v.vy * 1.15 + ux * sg * side; r.roll = -r.dvx * Math.sin(r.hv) + r.dvy * Math.cos(r.hv) > 0 ? -1 : 1;      // it turns over the way it is going
    r.tum = r.roll * Math.min(11, 3 + 0.5 * cs); r.spin = (rand() - 0.5) * (4 + 0.4 * cs); r.cf = cs; out.stats.hits++; out.stats.thrown++; clatter(cs);
    if (!had) { try { g.cam.shake = Math.min(0.6, (g.cam.shake || 0) + 0.08 + cs * 0.008); g.missions.onPedHit(); } catch (e) {} }
    return true; }
  function flyStep(r, dt) { r.t += dt;
    if (r.air) { r.bvz -= 9.81 * dt; r.bz += r.bvz * dt; r.lean += r.tum * dt; r.hv += r.spin * dt;
      if (r.bz <= 0) { const hit = -r.bvz; r.bz = 0; clatter(Math.min(r.cf * 0.8, hit * 1.5 + Math.hypot(r.dvx, r.dvy) * 0.35)); r.cf *= 0.7; r.dvx *= 0.6; r.dvy *= 0.6; r.tum *= 0.5; r.spin *= 0.6;
        if (hit > 2.4) r.bvz = hit * 0.35; else { r.air = false; r.bvz = 0; const a = wrapPi(r.lean); r.rest = r.lean - a + (a >= 0 ? 1.42 : -1.42); } } }
    else { const k = Math.exp(-2.5 * dt); r.dvx *= k; r.dvy *= k; r.spin *= k; r.hv += r.spin * dt; r.lean += (r.rest - r.lean) * Math.min(1, dt * 9); }
    st.resolve(r.x + r.dvx * dt, r.y + r.dvy * dt, 0.3, o2, true); if (o2.depth > 0) { r.dvx *= 0.5; r.dvy *= 0.5; } r.x = o2.x; r.y = o2.y; r.v = Math.hypot(r.dvx, r.dvy); }

  // ------------------------------------------------------------------ one step of a rider in the roadway
  function crossBusy(nd, e, node) { const rr = (nd.r || 6) + 15; for (const c of TR.cars) { if (c.v < 1.5 || Math.abs(c.x - nd.p[0]) > rr || Math.abs(c.y - nd.p[1]) > rr) continue; if (c.junction ? c.junction.e !== e : c.e !== e && R.endNode(c.e, c.dir) === node) return true; }
    for (const v of g.vehicles) if (Math.hypot(v.vx || 0, v.vy || 0) > 2 && Math.abs(v.x - nd.p[0]) < rr && Math.abs(v.y - nd.p[1]) < rr) return true; return false; }
  function nextEdge(r, node) { const nd = R.nodes[node], hin = r.h; let tot = 0; const C = [];
    for (const k of nd.e) { const e2 = R.edges[k]; if (e2 === r.e || !e2.line) continue; const d2 = e2.a === node ? 1 : e2.b === node ? -1 : 0; if (!d2) continue; const legal = !e2.oneway || d2 > 0; if (!legal && !r.salmon) continue;
      posOn(e2, d2, 0, 0, o2); const turn = Math.abs(wrapPi(o2.h - hin)); let w = turn < 0.5 ? 8 : turn < 2.2 ? 1.6 : 0.02; if (!legal) w *= 0.6; if (!usable(e2)) w *= 0.05; C.push([e2, d2, w]); tot += w; }
    if (!C.length) return null; let q = rand() * tot; for (const c of C) { q -= c[2]; if (q <= 0) return c; } return C[0]; }
  function roadStep(r, dt, t) {
    const e = r.e, L = e.len, node = R.endNode(e, r.dir), nd = R.nodes[node], big = nd.e.length >= 3, rEnd = big ? nd.r : 0.5; let cx = Math.cos(r.h), cy = Math.sin(r.h), limit = r.v0;
    look(r, cx, cy, 5 + r.v * 1.3, dt); if (r.state !== 'ride') return;
    let gap = r._gap; r.cool -= dt;
    if (!r.j) {
      // the light: most roll up to it and go when nothing is crossing; the rest wait for green
      const stopS = L - rEnd - 2.2, d = stopS - r.s;
      if (big && d > -1 && d < 40 && R.signal(node, e, t) !== 'g') { if (r.runner && !(d < 12 && crossBusy(nd, e, node))) limit = Math.min(limit, 3.4 + Math.max(0, d - 4) * 0.5); else gap = Math.min(gap, Math.max(0, d) + 0.5); }
      else if (big && L - r.s < 16) limit = Math.min(limit, 7);
      // a line that is blocked, or just a change of line: to another one that is free
      const blocked = gap < 4 + r.v * 0.9;
      if (r.cool <= 0 && (blocked || (rand() < dt * 0.1 && e.lanes > 1))) { slots(e, r.dir, sl); let best = null, bd = 1e9; for (const s2 of sl) { const dd = Math.abs(s2 - r.tlo); if (dd < 0.2 || dd > (blocked ? 3.6 : 7) || !slotFree(r, s2)) continue; const sc = blocked ? dd : Math.abs(dd - 3.3) + rand(); if (sc < bd) { bd = sc; best = s2; } }
        if (best !== null) { r.tlo = best; r.cool = 1.6 + rand() * 2; } else r.cool = 0.5; }
    } else limit = Math.min(limit, r.j.vmax);
    if (r.sq > 0) { r.sq -= dt; limit = Math.min(limit, Math.max(1.2, r.sqv - 2.5)); }      // a car is against him: he lets it go by
    // speed: what can still stop in the gap behind something going r._ov his way
    const want = Math.min(limit, Math.max(0, r._ov) + Math.sqrt(Math.max(0, 2 * 4 * (gap - 0.4)))); r.v += clamp(want - r.v, -8 * dt, 2.4 * dt); if (r.v < 0.03) r.v = 0;
    r.stopT = r.v < 0.4 ? r.stopT + dt : 0; if (r.stopT > 8 && !r.j && gap < 2 && r._gap < 2) { r.tlo = pick(slots(e, r.dir, sl)); r.stopT = 4; }      // never stands for good behind something
    const ds = r.v * dt, ph = r.hv; r.odo = (r.odo || 0) + ds;
    if (r.j) { const j = r.j; j.u += ds / j.len;
      if (j.u >= 1) { r.e = j.e; r.dir = j.dir; r.s = j.s1 + (j.u - 1) * j.len; r.lo = r.tlo = j.lo; r.j = null; r.jx = r.jy = 0; r.v0 = (r.e.oneway && r.dir < 0 ? 5 : 6.6) + rand() * 2.4; posOn(r.e, r.dir, r.s, r.lo, r); r.hv = r.h; }
      else { const u = j.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; { const kk = Math.exp(-1.2 * dt); r.jx = (r.jx || 0) * kk; r.jy = (r.jy || 0) * kk; } r.x = a * j.p0x + b * j.cx + d * j.p1x + r.jx; r.y = a * j.p0y + b * j.cy + d * j.p1y + r.jy; r.h = r.hv = Math.atan2(2 * (1 - u) * (j.cy - j.p0y) + 2 * u * (j.p1y - j.cy), 2 * (1 - u) * (j.cx - j.p0x) + 2 * u * (j.p1x - j.cx)); }
    } else {
      r.s += ds; const dl = clamp(r.tlo - r.lo, -1, 1) * Math.min(1.7, 0.25 * r.v) * dt, mv = Math.abs(r.tlo - r.lo) < Math.abs(dl) ? r.tlo - r.lo : dl; r.lo += mv;
      if (r.s >= L - rEnd) { const nx = nextEdge(r, node); if (!nx) { r.gone = true; return; }
        const e2 = nx[0], d2 = nx[1], n2 = R.nodes[R.startNode(e2, d2)], s1 = Math.min(e2.len * 0.5, n2.e.length >= 3 ? n2.r : 0.5); slots(e2, d2, sl); const fr = half(e) ? r.lo / half(e) : 0; let lo2 = sl[0], bd = 1e9; for (const s2 of sl) { const dd = Math.abs(s2 - fr * half(e2)); if (dd < bd) { bd = dd; lo2 = s2; } }
        posOn(e, r.dir, L - rEnd, r.lo, o1); posOn(e2, d2, s1, lo2, o2); const d0x = Math.cos(o1.h), d0y = Math.sin(o1.h), d1x = Math.cos(o2.h), d1y = Math.sin(o2.h), den = d0x * d1y - d0y * d1x; let mx = (o1.x + o2.x) / 2, my = (o1.y + o2.y) / 2;
        if (Math.abs(den) > 0.2) { const tt = ((o2.x - o1.x) * d1y - (o2.y - o1.y) * d1x) / den; if (tt > 0 && tt < 60) { mx = o1.x + d0x * tt; my = o1.y + d0y * tt; } }
        r.j = { e: e2, dir: d2, lo: lo2, s1, p0x: o1.x, p0y: o1.y, cx: mx, cy: my, p1x: o2.x, p1y: o2.y, len: Math.max(1, Math.hypot(mx - o1.x, my - o1.y) + Math.hypot(o2.x - mx, o2.y - my)) * 0.95, u: 0, vmax: Math.abs(den) > 0.2 ? 4.6 : 9 }; r.x = o1.x; r.y = o1.y; }
      else { posOn(e, r.dir, r.s, r.lo, r); r.hv = r.h - Math.atan2(mv / Math.max(dt, 1e-4), Math.max(r.v, 1.5)); }
    }
    const yaw = wrapPi(r.hv - ph) / Math.max(dt, 1e-4), wl = r.v < 0.5 ? -0.09 : clamp(-Math.atan(r.v * yaw / 9.81), -0.45, 0.45); r.lean += (wl - r.lean) * Math.min(1, dt * 6); r.z = 0;
  }
  // ------------------------------------------------------------------ a rider on the sidewalk
  let walkers = null, walkT = 0;
  function walkStep(r, dt) {
    const l = r.loop; l.at(r.s, o1); const tx = o1.tx * r.dir, ty = o1.ty * r.dir, h0 = Math.atan2(ty, tx); r.h = h0; let gap = 1e9, side = 0, wf = 1e9;
    look(r, tx, ty, 6, dt); if (r.state !== 'ride') return; gap = r._gap;
    if (walkers) for (const a of walkers) { const dx = a.x - r.x, dy = a.y - r.y; if (dx > 8 || dx < -8 || dy > 8 || dy < -8) continue; const f = dx * tx + dy * ty, s = -dx * ty + dy * tx; if (f < -0.4 || f > 7 || Math.abs(s) > 0.85) continue;
      if (f < 0.9 && Math.abs(s) < 0.55) { const pen = (0.55 - Math.abs(s)) * Math.min(1, dt * 8), sg = s > 0 ? 1 : -1; r.off += sg * pen; }      // never through a person
      const gp = f - 0.9; if (gp < gap) gap = gp; if (f < wf) { wf = f; side = s > 0 ? 1 : -1; } }
    if (!side && gap < 5) side = r.id % 2 ? 1 : -1; if (r.v < 0.1 && (r.stopT = (r.stopT || 0) + dt) > 3) { r.toff = clamp(-r.toff || side, -2.2, 2.2); r.stopT = 0; } else if (r.v >= 0.1) r.stopT = 0;
    if (gap < 5 && r.cool <= 0) { r.toff = clamp(r.off + side * 1.1, -2.2, 2.2); r.cool = 1.2; } r.cool -= dt;
    if (FG && (r.fc = (r.fc || 0) - 1) <= 0) { r.fc = 5; for (const d of [1.6, 3.4]) { const ax = r.x + tx * d, ay = r.y + ty * d; if (!furnHit(ax + ty * (r.toff - r.off), ay - tx * (r.toff - r.off), 0.55)) continue;      // something stands in his line: the nearest clear line beside it
        let best = null; for (const k of [0.8, -0.8, 1.5, -1.5, 2.2, -2.2]) { const o = clamp(r.off + k, -2.6, 2.6), bx = ax + ty * (o - r.off), by = ay - tx * (o - r.off); if (st.onSidewalk(bx, by) && !furnHit(bx, by, 0.55) && !(st.resolve(bx, by, 0.4, o2) > 0)) { best = o; break; } }
        if (best !== null) r.toff = best; else gap = Math.min(gap, d - 1.2); break; } }
    const want = Math.min(r.v0, 0.9 + Math.sqrt(Math.max(0, 2 * 2.5 * (gap - 0.3)))); r.v += clamp((gap < 0.2 ? 0 : want) - r.v, -6 * dt, 1.5 * dt); if (r.v < 0.03) r.v = 0;
    const d0 = clamp(r.toff - r.off, -0.9 * dt, 0.9 * dt); r.off += d0; r.s += r.dir * r.v * dt; r.odo = (r.odo || 0) + r.v * dt; if (r.s > l.len) r.s -= l.len; if (r.s < 0) r.s += l.len;
    l.at(r.s, o1); let nx = o1.x + ty * r.off, ny = o1.y - tx * r.off; if (!st.onSidewalk(nx, ny)) { r.toff *= 0.5; r.off *= 0.8; nx = o1.x + ty * r.off; ny = o1.y - tx * r.off; }
    st.resolve(nx, ny, 0.35, o2); if (o2.depth > 0) { r.off += ((o2.x - nx) * ty - (o2.y - ny) * tx) * 0.6; } { const o = furnHit(nx, ny, 0.4); if (o) { const s = -(o.x - nx) * ty + (o.y - ny) * tx; r.off += (s > 0 ? 1 : -1) * Math.min(1, dt * 4) * 0.5; r.toff = r.off; out.stats.furn++; } } r.x = nx; r.y = ny; r.hv = h0 - Math.atan2(d0 / Math.max(dt, 1e-4), Math.max(r.v, 1.2)); r.lean += ((r.v < 0.4 ? -0.09 : 0) - r.lean) * Math.min(1, dt * 5); r.z = st.onSidewalk(r.x, r.y) ? 0.15 : 0;
  }
  function downStep(r, dt) { r.t += dt; const k = Math.exp(-3 * dt); r.dvx *= k; r.dvy *= k; st.resolve(r.x + r.dvx * dt, r.y + r.dvy * dt, 0.3, o2, true); r.x = o2.x; r.y = o2.y; r.lean += (r.roll * 1.42 - r.lean) * Math.min(1, dt * 7); r.hv += r.spin * dt * k; r.v = Math.hypot(r.dvx, r.dvy); }

  // ------------------------------------------------------------------ parked clumps outside food fronts
  let shopsN = -1, clT = 0;
  // a parked bike is a 1.7 m line; the nearest point of it to (px, py) -> o2.x, o2.y; returns the distance
  function toBike(px, py, b) { const c = Math.cos(b.h), sn = Math.sin(b.h), u = clamp((px - b.x) * c + (py - b.y) * sn, -0.85, 0.85); o2.x = b.x + c * u; o2.y = b.y + sn * u; return Math.hypot(px - o2.x, py - o2.y); }
  function buildClumps() {
    const SH = g.streets && g.streets.parts && g.streets.parts.storefronts && g.streets.parts.storefronts.shops; if (!SH || SH.length === shopsN) return; shopsN = SH.length; furn(); const tB = performance.now(); out.stats.builds = (out.stats.builds || 0) + 1;
    for (const c of out.clumps) { for (const b of c.bikes) for (const q of b.circ) q.on = false; for (const q of c.men) if (q.circ) q.circ.on = false; } out.clumps.length = 0; const rc = rng(31337);
    // shop doors: nothing stands in the strip from a door to the kerb (a 16 m grid of the doors)
    const DG = new Map(); for (const s of SH) { if (typeof s.door !== 'number' || typeof s.h !== 'number') continue; const dx = s.x + Math.cos(s.h) * s.door, dy = s.y + Math.sin(s.h) * s.door, k = fk(Math.floor(dx / 16), Math.floor(dy / 16)); let a = DG.get(k); if (!a) DG.set(k, (a = [])); a.push(dx, dy, s.nx, s.ny, (s.kerb || 4) + 0.5); }
    const doorway = (x, y, hw) => { const i0 = Math.floor((x - 3) / 16), i1 = Math.floor((x + 3) / 16), j0 = Math.floor((y - 12) / 16), j1 = Math.floor((y + 12) / 16);
      for (let i = Math.min(i0, Math.floor((x - 12) / 16)); i <= Math.max(i1, Math.floor((x + 12) / 16)); i++) for (let j = j0; j <= j1; j++) { const a = DG.get(fk(i, j)); if (a) for (let q = 0; q < a.length; q += 5) { const ex = x - a[q], ey = y - a[q + 1], f = ex * a[q + 2] + ey * a[q + 3], l = Math.abs(-ex * a[q + 3] + ey * a[q + 2]); if (f > -0.5 && f < a[q + 4] && l < hw) return true; } } return false; };
    const clear = (x, y, r) => st.onSidewalk(x, y) && !(st.resolve(x, y, r, o1) > 0) && !furnHit(x, y, r + 0.15) && !propHit(x, y, r + 0.12) && !doorway(x, y, 0.75 + r);
    for (let i = 0; i < SH.length; i++) { const s = SH[i]; if (!s.food || !(s.kerb > 3.2) || rc() > 0.3) continue; let ok = true; for (const c of out.clumps) if (Math.abs(c.x - s.x) < 55 && Math.abs(c.y - s.y) < 55) { ok = false; break; } if (!ok) continue;
      // the bikes: one row at the kerb edge, all on their stands at the same slant to the kerb, a hand's width between bar and bar
      const n = 3 + Math.floor(rc() * 4), tx = -s.ny, ty = s.nx, along = (rc() - 0.5) * Math.max(0, s.w - 2), ang = (rc() < 0.5 ? 1 : -1) * (0.85 + rc() * 0.3), sa = Math.abs(Math.sin(ang)), pitch = (0.64 + rc() * 0.07) / sa, dep = s.kerb - 0.22 - 0.9 * sa - rc() * 0.1;
      const kx = s.x + s.nx * dep + tx * along, ky = s.y + s.ny * dep + ty * along, h0 = Math.atan2(ty, tx) + ang + (rc() < 0.5 ? Math.PI : 0), c = { x: s.x, y: s.y, cx: kx, cy: ky, rad: n * pitch / 2 + 2.6, nx: s.nx, ny: s.ny, bikes: [], men: [], type: s.type };
      for (let k = 0; k < n; k++) { const u = (k - (n - 1) / 2) * pitch, jn = (rc() - 0.5) * 0.06, x = kx + tx * u + s.nx * jn, y = ky + ty * u + s.ny * jn, h = h0 + (rc() - 0.5) * 0.07, ex = Math.cos(h) * 0.72, ey = Math.sin(h) * 0.72;
        if (!clear(x, y, 0.36) || !clear(x + ex, y + ey, 0.36) || !clear(x - ex, y - ey, 0.36) || !st.onSidewalk(x + ex * 1.22, y + ey * 1.22) || !st.onSidewalk(x - ex * 1.22, y - ey * 1.22)) continue;
        const b = looks({ x, y, h, u, lean: -0.16 - rc() * 0.04, state: 'park', circ: [] }); if (b.box === 2) b.box = rc() < 0.65 ? 1 : 0; else if (b.box === 4) b.box = 3; c.bikes.push(b); }
      if (c.bikes.length < 3) continue;
      // the riders: STANDING at the ends of the row or just behind it, on their phones, two of them talking; now and then one sits on his own bike at the end of the row
      const B0 = c.bikes[0], B1 = c.bikes[c.bikes.length - 1], m = Math.max(2, Math.min(c.bikes.length, 2 + Math.floor(rc() * 3))), hin = Math.atan2(-s.ny, -s.nx);
      const free = (x, y) => { if (!clear(x, y, 0.3)) return false; for (const b of c.bikes) if (toBike(x, y, b) < (b.sit ? 0.85 : 0.62)) return false; for (const q of c.men) if (Math.hypot(q.x - x, q.y - y) < 0.72) return false; return true; };
      const man = (x, y, h, pose) => { if (!free(x, y)) return null; const o = looks({}); o.box = 0; o.x = x; o.y = y; o.h = h; o.pose = pose; c.men.push(o); return o; };
      if (rc() < 0.3) { const left = -Math.sin(h0) * tx + Math.cos(h0) * ty, b = left > 0 ? B1 : B0, sg = left > 0 ? 1 : -1; b.x += tx * sg * 0.22; b.y += ty * sg * 0.22; b.sit = looks({}); b.sit.box = 0; b.lean = -0.09; }
      const end = (sg, d) => { const b = sg > 0 ? B1 : B0, q = d + (b.sit ? 0.45 : 0), w = (rc() - 0.5) * 0.5; return [b.x + tx * sg * q - s.nx * w, b.y + ty * sg * q - s.ny * w]; };
      const e0 = rc() < 0.5 ? 1 : -1;
      if (rc() < 0.6) { const p = end(e0, 1.25 + rc() * 0.3), a = rc() * Math.PI, dx = Math.cos(a) * 0.41, dy = Math.sin(a) * 0.41;      // two talking, face to face
        if (free(p[0] + dx, p[1] + dy) && free(p[0] - dx, p[1] - dy)) { man(p[0] + dx, p[1] + dy, Math.atan2(-dy, -dx) + (rc() - 0.5) * 0.3, 'stand2'); man(p[0] - dx, p[1] - dy, Math.atan2(dy, dx) + (rc() - 0.5) * 0.3, rc() < 0.5 ? 'stand' : 'stand2'); } }
      for (let k = 0; k < 14 && c.men.length < m; k++) { const q = rc();
        if (q < 0.5) { const sg = k % 2 ? e0 : -e0, p = end(sg, 0.85 + rc() * 0.5); man(p[0], p[1], Math.atan2(ty, tx) + (sg > 0 ? Math.PI : 0) + (rc() - 0.5) * 1.6, rc() < 0.75 ? 'stand' : 'stand2'); }      // at an end of the row, turned to the bikes
        else if (s.kerb > 4.6 && !c.behind) { const b = c.bikes[Math.floor(rc() * c.bikes.length) % c.bikes.length], d = 0.9 * sa + 0.75 + rc() * 0.3, w = (rc() - 0.5) * 0.4; c.behind = 1; man(b.x - s.nx * d + tx * w, b.y - s.ny * d + ty * w, hin + Math.PI + (rc() - 0.5) * 1.2, rc() < 0.75 ? 'stand' : 'stand2'); } }      // behind his bike, facing it and the street
      for (const b of c.bikes) b.circ.push(st.addCircle(b.x + Math.cos(b.h) * 0.45, b.y + Math.sin(b.h) * 0.45, 0.3), st.addCircle(b.x - Math.cos(b.h) * 0.45, b.y - Math.sin(b.h) * 0.45, 0.3)); for (const q of c.men) q.circ = st.addCircle(q.x, q.y, 0.28);
      out.clumps.push(c); }
    out.stats.buildMs = (out.stats.buildMs || 0) + performance.now() - tB;
    console.log('[riders] parked clumps: ' + out.clumps.length + ' of ' + SH.filter((s) => s.food).length + ' food fronts');
  }
  // walkers go round a clump, never through a bike or a standing rider (the collision circles do most of it; this is the net under them)
  function clumpPush(dt, fx, fy) { if (!walkers) return; const mx = 3 * dt;
    for (const C of out.clumps) { if (Math.abs(C.cx - fx) > 70 || Math.abs(C.cy - fy) > 70) continue;
      for (const a of walkers) { if (a === pl || Math.abs(a.x - C.cx) > C.rad || Math.abs(a.y - C.cy) > C.rad || a.state === 'sit' || a.state === 'down') continue;
        for (const b of C.bikes) { const d = toBike(a.x, a.y, b); if (d < 0.55) { const k = Math.min(0.55 - d, mx); if (d > 0.02) { a.x += (a.x - o2.x) / d * k; a.y += (a.y - o2.y) / d * k; } else { a.x -= C.nx * k; a.y -= C.ny * k; } out.stats.pushed++; } }
        for (const q of C.men) { if (q.fall) continue; const dx = a.x - q.x, dy = a.y - q.y, d = Math.hypot(dx, dy); if (d < 0.55 && d > 0.02) { const k = Math.min(0.55 - d, mx); a.x += dx / d * k; a.y += dy / d * k; out.stats.pushed++; } } } } }
  function clumpHits() { const v = pl.vehicle; if (!v || !v.def) return; const sp = Math.hypot(v.vx || 0, v.vy || 0); if (sp < 2.5) return; const c = Math.cos(v.h), s = Math.sin(v.h);
    for (const C of out.clumps) { if (Math.abs(C.x - v.x) > 30 || Math.abs(C.y - v.y) > 30) continue;
      for (let i = C.bikes.length - 1; i >= 0; i--) { const b = C.bikes[i], dx = b.x - v.x, dy = b.y - v.y, f = dx * c + dy * s, l = -dx * s + dy * c; if (Math.abs(f) > v.def.len / 2 + 1.1 || Math.abs(l) > v.def.wid / 2 + 0.6) continue;
        for (const q of b.circ) q.on = false; C.bikes.splice(i, 1); const r = Object.assign(b, { mode: 'fallen', hv: b.h, z: 0.15, v: 0, id: -1 }); r.rider = !!b.sit; if (!(CYC && knock(r, v, false))) down(r, v.vx, v.vy, l); out.list.push(r); }
      for (let i = C.men.length - 1; i >= 0; i--) { const q = C.men[i]; if (q.fall) continue; const dx = q.x - v.x, dy = q.y - v.y, f = dx * c + dy * s, l = -dx * s + dy * c; if (Math.abs(f) > v.def.len / 2 + 0.5 || Math.abs(l) > v.def.wid / 2 + 0.4) continue;
        if (CYC && sp >= HARD && body(q.x, q.y, kerbZ(q.x, q.y), q.h, q.pv, v, 'idle')) { q.circ.on = false; q.fall = { t: 99, vx: 0, vy: 0, sg: 1 }; out.stats.hits++; out.stats.thrown++; continue; }      // a man standing by: thrown as a body too (his figure here is no longer drawn)
        q.circ.on = false; q.fall = { t: 0, vx: v.vx * 0.8, vy: v.vy * 0.8, sg: l > 0 ? 1 : -1 }; out.stats.hits++; try { g.sound.thud(); g.missions.onPedHit(); } catch (e) {} } } }

  // ------------------------------------------------------------------ the step
  function step(dt) {
    const t0 = performance.now(), fx = g.focus.x, fy = g.focus.y, t = g.t;
    if (CLUMPS && --clT <= 0) { clT = 240; buildClumps(); if (!PP) people(); hours(); }
    gather(fx, fy); if (--walkT <= 0) { walkT = 6; const S = g.crowd && g.crowd.on && g.crowd.sim; walkers = []; if (S && S.agents) for (const a of S.agents) if (a && !a.gone && Math.abs(a.x - fx) < 230 && Math.abs(a.y - fy) < 230) walkers.push(a); if (g.peds) for (const p of g.peds.list) walkers.push(p); if (!pl.vehicle) walkers.push(pl); }
    let nr = 0, nw = 0;
    for (let i = out.list.length - 1; i >= 0; i--) { const r = out.list[i], d = Math.hypot(r.x - fx, r.y - fy);
      if (r.mode === 'road' && r.state === 'ride' && d > 150 && (fx - r.x) * Math.cos(r.h) + (fy - r.y) * Math.sin(r.h) < -0.4 * d) { if ((r.far = (r.far || 0) + dt) > 2.5) r.gone = true; } else r.far = 0;
      if (r.gone || d > 290 || (r.state === 'down' && r.t > 9)) { out.list.splice(i, 1); continue; }
      if (r.sh > 0) r.sh -= dt; if (r.state === 'down') { if (r.kn) flyStep(r, dt); else downStep(r, dt); } else if (r.mode === 'road') { roadStep(r, dt, t); nr++; } else if (r.mode === 'walk') { walkStep(r, dt); nw++; } }
    if (nr < TARGET) spawnRoad(fx, fy, false); if (nw < WALKERS && rand() < 0.1) spawnWalk(fx, fy, false);
    if (CLUMPS) { clumpHits(); clumpPush(dt, fx, fy); for (const C of out.clumps) for (const q of C.men) if (q.fall) { const F = q.fall; F.t += dt; const k = Math.exp(-3 * dt); F.vx *= k; F.vy *= k; q.x += F.vx * dt; q.y += F.vy * dt; } }
    { const d = performance.now() - t0; out.stats.ms += (d - out.stats.ms) * 0.05; if (d > (out.stats.stepMax || 0)) out.stats.stepMax = d; out.stats.stepSum = (out.stats.stepSum || 0) + d; }
  }
  // ------------------------------------------------------------------ the frame
  function sync() {
    const tS = performance.now(); for (const b of batches) b.n = 0; const fx = g.focus.x, fy = g.focus.y, cam = g.world.camera.position, cx = cam.x, cy = -cam.z, near = (x, y) => Math.abs(x - cx) < NEAR_R && Math.abs(y - cy) < NEAR_R && Math.hypot(x - cx, y - cy) < NEAR_R;
    for (const r of out.list) { if (Math.abs(r.x - fx) > 260 || Math.abs(r.y - fy) > 260) continue; const dn = r.state === 'down', z = dn ? kerbZ(r.x, r.y) + 0.12 * Math.min(1, r.t * 4) + (r.kn ? r.bz + Math.max(0, -1.1 * Math.cos(r.lean)) : 0) : r.z;
      draw(r, r.x, r.y, z, r.hv, r.lean, r.mode === 'fallen' ? (r.rider ? 'astride' : null) : r.v < 0.35 || dn ? 'astride' : 'ride', near(r.x, r.y)); }
    for (const C of out.clumps) { if (Math.abs(C.x - fx) > 230 || Math.abs(C.y - fy) > 230) continue;
      const nb = near(C.cx, C.cy); for (const b of C.bikes) { draw(b, b.x, b.y, 0.15, b.h, b.lean, null); if (b.sit) put(nb && PP ? PP.astride[b.sit.pv] : RD['astride' + b.sit.gear], bikeMat(b.x, b.y, 0.15, b.h, b.lean), b.sit.tr); }
      for (const q of C.men) { if (q.fall) { if (q.fall.t > 9) continue; _q.setFromAxisAngle(AY, q.h); _q2.setFromAxisAngle(AX, q.fall.sg * 1.5 * Math.min(1, q.fall.t * 4)); _q.multiply(_q2); _m.compose(_p.set(q.x, kerbZ(q.x, q.y) + 0.14, -q.y), _q, ONE); } else { _q.setFromAxisAngle(AY, q.h); _m.compose(_p.set(q.x, 0.15, -q.y), _q, _s.set(q.sc, q.sc, q.sc)); }
        put(nb && PP ? PP[q.pose][q.pv] : RD[q.pose + q.gear], _m, q.tr); } }
    let n = 0; for (const b of batches) { b.im.count = b.n; b.im.visible = b.n > 0; n += b.n; if (b.n) { b.im.instanceMatrix.needsUpdate = true; b.tint.needsUpdate = true; } } out.stats.drawn = n; out.stats.syncSum = (out.stats.syncSum || 0) + performance.now() - tS;
  }
  // ------------------------------------------------------------------ the hooks
  const step0 = g.step.bind(g); g.step = function (dt) { step0(dt); if (out.on) try { step(dt); } catch (e) { out.on = false; console.log('[riders] stopped: ' + (e && (e.stack || e.message))); } };
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) { sv0(dt); try { if (out.on) sync(); else for (const b of batches) b.im.visible = false; } catch (e) { out.on = false; console.log('[riders] stopped: ' + (e && (e.stack || e.message))); } };
  // cars brake for a rider in their way (one alongside, on his own line at the lane's edge, is not in the way)
  const gap0 = TR.gapAhead.bind(TR); TR.gapAhead = function (c, lk) { let gap = gap0(c, lk); if (!out.on) return gap; const cx = Math.cos(c.h), cy = Math.sin(c.h), hf = c.def.len / 2, hw = c.def.wid / 2 + 0.3;
    for (const r of out.list) { const dx = r.x - c.x, dy = r.y - c.y; if (dx > 40 || dx < -40 || dy > 40 || dy < -40) continue; const f = dx * cx + dy * cy; if (f < 0.5 || f > lk + 0.9 + hf) continue; if (Math.abs(-dx * cy + dy * cx) > hw) continue; const gp = f - hf - 0.9; if (gp < gap) { gap = gp; TR._blk = r; } } return gap; };
  const pop0 = TR.populate.bind(TR); TR.populate = function (px, py) { const q = pop0(px, py); try { out.list = out.list.filter((r) => r.state !== 'ride' ? true : false); out.populate(px, py); } catch (e) {} return q; };
  out._t = { furnHit, toBike };
  if (CLUMPS) buildClumps(); else furn(); people(); hours(); out.populate(g.focus.x, g.focus.y);
  console.log('[riders] on: ' + out.list.length + ' riding of ' + TARGET + ', ' + out.clumps.length + ' parked clumps');
  return out;
}
