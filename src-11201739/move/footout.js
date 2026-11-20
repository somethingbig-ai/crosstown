// move/footout.js (gameplay lane, Nov 19; a public player, report 20261117011359-bd6d92: "i climbed up a ladder into a building now i cant get out").
// THE RESCUE: a player on foot who is walled in gets out. A wall of game.statics is a line: inside a building's outline nothing pushes him, and the
// walls hold him in as well as they hold others out. So: when he has moved under 30 m net in 15 s with move keys held (most of the time), at street
// level, not in a car / the water / the subway / a shop, at most once every 2 s a flood over a 0.5 m grid from where he stands asks whether a man can
// walk 40 m away in any direction (and, if he stands inside a building's outline, out of that outline). If not, the prompt "F  climb out" shows (the pad's own name for it with a controller); F vaults him over the wall
// to the nearest open sidewalk point in 0.8 s, the camera following him over. No fade. ?footout=0 = no prompt (the tests below stay: water/swim.js asks ladderOut as it builds the ladders: one whose top is inside
// a building's outline, the cause of that report, takes him on over the wall to open ground; ?ladderin=1 = ladders as before).
// The game's own code is wrapped, never edited: step, stepBusy, tryEnter, hud.draw.
// QA: game.footout: enclosed(x, y) -> true / false; inside(x, y) = in a building's outline; target(x, y) -> { x, y, d, walk } | null;
//     check() = ask now (skips the 15 s rule); stats; tune; ladderOut(lx, ly), ladStats; v = the vault's camera state; cam = false / pose = false: the plain lift.
import { waterAt } from '../streets/water.js';

export const TUNE = { cell: 0.5, far: 40, body: 0.3, every: 2, window: 15, net: 30, heldMin: 8, dur: 0.8, durMax: 1.25, lift: 2.6, reach: 120, ladNear: 12, ladFar: 25, craneIn: 0.28, craneOut: 0.3, cranePitch: 1.42, craneDist: 1.2, lowMax: 1.2, maxNodes: 150000 };

export function install(g) {
  if (g.footout) return g.footout;
  const st = g.statics, city = g.city, T = { ...TUNE }, _o = {};
  let hudOn = false;
  const F = (g.footout = { on: !(g.P && g.P.get('footout') === '0'), tune: T, prompt: null, pocket: null, lastT: -9, hist: [], histT: 0, stats: { floods: 0, nodes: 0, ms: 0, prompts: 0, outs: 0 }, last: null });

  // ---- in a building's outline? (40 m buckets, built at first use)
  let bg = null;
  const pip = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const grid = () => { if (bg) return bg; bg = new Map(); for (const b of city.buildings || []) { if (!(b.minh < 2.5) || !b.poly) continue; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of b.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    const e = { b, x0, y0, x1, y1 }; for (let i = Math.floor(x0 / 40); i <= Math.floor(x1 / 40); i++) for (let j = Math.floor(y0 / 40); j <= Math.floor(y1 / 40); j++) { const k = i * 100003 + j; let a = bg.get(k); if (!a) bg.set(k, (a = [])); a.push(e); } } return bg; };
  F.inside = (x, y) => { const a = grid().get(Math.floor(x / 40) * 100003 + Math.floor(y / 40)); if (a) for (const e of a) { if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) continue; if (pip(x, y, e.b.poly) && !(e.b.holes || []).some((h) => pip(x, y, h))) return e.b; } return null; };

  // ---- does the step a -> b cross a wall? (walls a jump clears, seg.low up to lowMax, do not count)
  const crosses = (ax, ay, bx, by) => { const c = st.cell, ka = st.key(Math.floor(ax / c), Math.floor(ay / c)), kb = st.key(Math.floor(bx / c), Math.floor(by / c));
    for (let n = 0; n < 2; n++) { if (n && kb === ka) break; const a = st.segs.get(n ? kb : ka); if (!a) continue;
      for (const s of a) { if (s.low > 0 && s.low <= T.lowMax) continue; const rx = bx - ax, ry = by - ay, sx = s[2] - s[0], sy = s[3] - s[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue;
        const t = ((s[0] - ax) * sy - (s[1] - ay) * sx) / den, u = ((s[0] - ax) * ry - (s[1] - ay) * rx) / den; if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true; } }
    return false; };
  // a body's width of it: the line itself and one each side
  const blocked = (ax, ay, bx, by) => { if (crosses(ax, ay, bx, by)) return true; const l = Math.hypot(bx - ax, by - ay) || 1, px = (-(by - ay) / l) * T.body, py = ((bx - ax) / l) * T.body; return crosses(ax + px, ay + py, bx + px, by + py) || crosses(ax - px, ay - py, bx - px, by - py); };

  // ---- the flood: farthest-first over a grid of `cell` from (x, y). -> { open, nodes, seen (Set of node keys), x, y }
  const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function flood(x, y) {
    const G = T.cell, far2 = (T.far / G) * (T.far / G), seen = new Set([0]), heap = [0, 0, 0], B = F.inside(x, y); let nodes = 0, open = false;      /* B: he starts inside a building's outline: 40 m INSIDE it (a 74 m pier shed) is not a way out, the square must also lie outside that outline */
    const out = (i, j) => !B || !pip(x + i * G, y + j * G, B.poly) || (B.holes || []).some((h) => pip(x + i * G, y + j * G, h));      // heap of [d2, i, j] triples, largest d2 first
    const push = (d, i, j) => { let k = heap.length; heap.push(d, i, j); while (k > 0) { const p = (((k / 3 - 1) >> 1) * 3); if (heap[p] >= heap[k]) break; for (let q = 0; q < 3; q++) { const v = heap[p + q]; heap[p + q] = heap[k + q]; heap[k + q] = v; } k = p; } };
    const pop = () => { const n = heap.length - 3, r = [heap[0], heap[1], heap[2]]; for (let q = 0; q < 3; q++) heap[q] = heap[n + q]; heap.length = n; let k = 0; for (;;) { const a = (k / 3 * 2 + 1) * 3, b = a + 3; let m = k; if (a < n && heap[a] > heap[m]) m = a; if (b < n && heap[b] > heap[m]) m = b; if (m === k) break; for (let q = 0; q < 3; q++) { const v = heap[m + q]; heap[m + q] = heap[k + q]; heap[k + q] = v; } k = m; } return r; };
    while (heap.length) { const [d2, i, j] = pop(); nodes++; if (d2 >= far2 && out(i, j)) { open = true; break; } if (nodes > T.maxNodes) { open = true; break; }
      for (const [di, dj] of DIR) { const ni = i + di, nj = j + dj, k = ni * 100003 + nj; if (seen.has(k)) continue; if (blocked(x + i * G, y + j * G, x + ni * G, y + nj * G)) continue; seen.add(k); push(ni * ni + nj * nj, ni, nj); } }
    F.stats.floods++; F.stats.nodes += nodes; return { open, nodes, seen, x, y };
  }
  F.flood = flood;
  F.enclosed = (x, y) => !flood(x, y).open;

  // ---- where to: the nearest point he can stand on that is open, a sidewalk first
  const inPlay = (x, y) => { const p = (city.meta && city.meta.play) || null; return !p || (x > p[0] + 3 && x < p[2] - 3 && y > p[1] + 3 && y < p[3] - 3); };
  const wet = (x, y) => { try { return !!(city.water && waterAt(city, x, y)); } catch (e) { return false; } };
  function target(x, y, pocket, reach) {
    const G = T.cell, inPocket = (px, py) => !!pocket && pocket.seen.has(Math.round((px - pocket.x) / G) * 100003 + Math.round((py - pocket.y) / G));
    for (const walk of [true, false]) for (let r = 1.5; r <= (reach || T.reach); r += 1.5) { const n = Math.max(8, Math.round((6.283 * r) / 1.5));
      for (let a = 0; a < n; a++) { const an = (a / n) * 6.283 + r * 0.37, px = x + Math.cos(an) * r, py = y + Math.sin(an) * r;
        if (!inPlay(px, py) || (walk && !st.onSidewalk(px, py)) || inPocket(px, py) || F.inside(px, py) || wet(px, py)) continue;
        st.resolve(px, py, 0.34, _o); if (Math.hypot(_o.x - px, _o.y - py) > 0.02) continue;
        if (!flood(px, py).open) continue; return { x: px, y: py, d: r, walk }; } }
    return null;
  }
  F.target = (x, y) => target(x, y, null);
  // ---- a water ladder's top (water/swim.js ladderAt asks, as the ladders are built): null = it is in no building's outline, leave it; { x, y, d } = it is inside one:
  // he is taken on from the top to this open point outside (within ladNear m if there is one, else ladFar); false = no open point within ladFar m: no ladder there
  const lad = new Map(); F.ladStats = { asked: 0, reaimed: 0, dropped: 0 };
  F.ladderOut = (lx, ly) => { const k = Math.round(lx * 20) + ',' + Math.round(ly * 20); if (lad.has(k)) return lad.get(k); F.ladStats.asked++; let o = null;
    if (F.inside(lx, ly)) { const to = target(lx, ly, null, T.ladNear) || target(lx, ly, null, T.ladFar); o = to ? { x: to.x, y: to.y, d: to.d, walk: to.walk } : false; if (o) F.ladStats.reaimed++; else F.ladStats.dropped++; }
    lad.set(k, o); return o; };

  // ---- when
  const inShop = (x, y) => { for (const n of ['interiors', 'garages']) { const A = g[n] && g[n].shops; if (A) for (const S of A) try { if (S.inside && S.inside(x, y)) return true; } catch (e) {} } return false; };
  const onFoot = () => { const pl = g.player; return !!pl && !pl.vehicle && !pl.busy && !pl.alt && !g.demo && !g.capture && !(g.fly && g.fly.on) && !(g.combat && g.combat.dead) && !(g.jump && g.jump.air) && !inShop(pl.x, pl.y); };
  function ask(force) {
    const pl = g.player, t0 = typeof performance !== 'undefined' ? performance.now() : 0; F.lastT = g.t;
    // still in the pocket found last time: nothing to ask again
    if (F.pocket && !force) { const P = F.pocket, G = T.cell; if (P.seen.has(Math.round((pl.x - P.x) / G) * 100003 + Math.round((pl.y - P.y) / G))) return F.prompt; }
    const fl = flood(pl.x, pl.y); F.last = { t: g.t, x: pl.x, y: pl.y, open: fl.open, nodes: fl.nodes };
    if (fl.open) { F.pocket = null; F.prompt = null; } else { const to = target(pl.x, pl.y, fl); F.pocket = fl; F.prompt = to; if (to) { F.stats.prompts++; console.log('[footout] walled in at ' + pl.x.toFixed(1) + ', ' + pl.y.toFixed(1) + ' (' + fl.nodes + ' squares of ' + T.cell + ' m): the way out is ' + to.d.toFixed(1) + ' m off at ' + to.x.toFixed(1) + ', ' + to.y.toFixed(1) + (to.walk ? ' (sidewalk)' : '')); } }
    if (t0) F.stats.ms += performance.now() - t0; return F.prompt;
  }
  F.check = () => (onFoot() ? ask(true) : null);
  function watch(dt) {
    const pl = g.player; if (!F.on || !pl) return; if (!onFoot()) { F.prompt = null; F.pocket = null; F.hist.length = 0; return; }
    const I = g.input || {}, held = Math.hypot(I.mx || 0, I.my || 0) > 0.1; F.heldNow = F.heldNow || held; F.histT += dt;
    if (F.histT >= 1) { F.histT = 0; F.hist.push([pl.x, pl.y, F.heldNow ? 1 : 0]); F.heldNow = false; if (F.hist.length > T.window) F.hist.shift(); }
    if (F.prompt) { if (g.t - F.lastT >= T.every) ask(false); return; }
    if (F.hist.length < T.window || g.t - F.lastT < T.every) return;
    let n = 0, far = 0; const h0 = F.hist[0]; for (const h of F.hist) { n += h[2]; far = Math.max(far, Math.hypot(h[0] - h0[0], h[1] - h0[1])); }
    if (n < T.heldMin || far >= T.net || Math.hypot(pl.x - h0[0], pl.y - h0[1]) >= T.net) return;
    ask(false);
  }
  // ---- the way out: a vault of 0.8 s (longer for a long way: durMax at 25 m): up with the arms thrown up, over the wall line, down on the far side.
  // The camera follows HIM: its target is his chest at his height all the way, and from just before he crosses the first wall line until just after
  // the last it cranes up over his head and looks down (a wall is a line: a camera 0.2 m behind him crosses with him), then eases back behind him.
  // The game's own wall-avoid stays on underneath (placeCamera), pulled in at once instead of eased while he is in the air.
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a)), sm = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }, HOLD = 0.16;
  const along = (k) => sm((k - HOLD) / (1 - HOLD));      // of the way across at k of the time: the first sixth he only rises
  const kOf = (f) => { let a = 0, b = 1; for (let i = 0; i < 22; i++) { const m = (a + b) / 2; if (along(m) < f) a = m; else b = m; } return (a + b) / 2; };
  function start(to, why) { const pl = g.player; if (!to || pl.busy || pl.vehicle) return false; const d = Math.hypot(to.x - pl.x, to.y - pl.y), dur = Math.min(T.durMax, T.dur + Math.max(0, d - 6) * 0.024);
    pl.busy = { footout: true, kind: 'footout', t: 0, dur, x0: pl.x, y0: pl.y, x1: to.x, y1: to.y, z: 0, lift: T.lift + Math.max(0, d - 6) * 0.05, z1: st.onSidewalk(to.x, to.y) ? 0.15 : 0, z0: st.onSidewalk(pl.x, pl.y) ? 0.15 : 0 }; pl.busy.z = pl.busy.z0;
    let f1 = 1, f2 = 1; try { f1 = st.raycast(pl.x, pl.y, to.x, to.y); f2 = st.raycast(to.x, to.y, pl.x, pl.y); } catch (e) {}
    const V = (F.v = { t: 0, dur, w: 0, tA: 0, tB: 0, wall: f1 < 1, why: why || 'F' }); if (V.wall) { const t1 = kOf(f1) * dur, t2 = kOf(1 - f2) * dur; V.t1 = t1; V.tA = Math.max(0, t1 - 0.04 - T.craneIn); V.tIn = Math.max(0.05, t1 - 0.04 - V.tA); V.tB = t2 + 0.1; }
    pl.h = Math.atan2(to.y - pl.y, to.x - pl.x); F.prompt = null; F.pocket = null; F.hist.length = 0; F.stats.outs++; console.log('[footout] out (' + V.why + '): ' + d.toFixed(1) + ' m to ' + to.x.toFixed(1) + ', ' + to.y.toFixed(1) + ' in ' + dur.toFixed(2) + ' s'); return true; }
  function go() { return start(F.prompt, 'F'); }
  F.go = go;

  const step0 = g.step.bind(g); g.step = function (dt) { hudWrap(); try { ladWatch0(); } catch (e) {} step0(dt); try { if (dt > 0) { ladWatch1(dt); watch(dt); } } catch (e) { if (!F.err) { F.err = String(e && (e.stack || e.message)); console.log('[footout] ' + F.err); } } };
  const sb0 = g.stepBusy.bind(g); g.stepBusy = function (dt) { const pl = this.player, b = pl.busy; if (!b || !b.footout) return sb0(dt);
    b.t += dt; const k = Math.min(1, b.t / b.dur), s = along(k); pl.x = b.x0 + (b.x1 - b.x0) * s; pl.y = b.y0 + (b.y1 - b.y0) * s; b.k = k; b.z = b.z0 + (b.z1 - b.z0) * s + Math.sin(Math.PI * Math.pow(k, 0.85)) * b.lift; pl.speed = 0; g.focus.x = pl.x; g.focus.y = pl.y;
    if (k >= 1) { pl.busy = null; st.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; } };
  // a re-aimed water ladder (F.ladderOut): the climb ends on its top as before, and from there he goes straight on over the wall to the open point
  let climbL = null;
  const ladWatch0 = () => { const pl = g.player, b = pl && pl.busy, S = g.swim; climbL = b && b.swim && S && S.core && S.core.state === 'climb' && S.core.L && S.core.L.out ? S.core.L : climbL && F.ladT > 0 ? climbL : null; if (b && b.swim && climbL) F.ladT = 0.6; };
  const ladWatch1 = (dt) => { if (!climbL) return; const pl = g.player; if (pl.busy || pl.vehicle) { if (!(pl.busy && pl.busy.swim)) { F.ladT -= dt; } return; } const L = climbL; climbL = null; F.ladT = 0; if (Math.hypot(pl.x - L.lx, pl.y - L.ly) < 1.5 && start(L.out, 'ladder')) F.stats.ladders = (F.stats.ladders || 0) + 1; };
  // the camera (see above). Nothing is changed outside a vault.
  const ct0 = g.camTarget.bind(g); g.camTarget = function () { const t = ct0(), b = this.player.busy; if (b && b.footout) { t.z = b.z + 1.5; t.auto = 0; } return t; };
  const pc0 = g.placeCamera.bind(g); g.placeCamera = function (dt) { const V = F.v, pl = this.player, b = pl.busy; if (!V || F.cam === false || pl.vehicle) return pc0(dt);
    const C = this.cam, p0 = C.pitch, d0 = C.dist; V.t += dt || 0; if (b && b.footout) { C.tx = pl.x; C.ty = pl.y; C.tz = b.z + 1.5; C.yaw += wrapPi(pl.h - C.yaw) * Math.min(1, (dt || 0) * 5); }
    const w = (V.w = V.wall ? sm((V.t - V.tA) / V.tIn) * (1 - sm((V.t - V.tB) / T.craneOut)) : 0); let pitch = Math.max(-0.25, p0) + (T.cranePitch - Math.max(-0.25, p0)) * w, d = d0 + (Math.min(d0, T.craneDist) - d0) * w;
    try { const bx = -Math.cos(C.yaw), by = -Math.sin(C.yaw), hd = d * Math.cos(pitch); let hit = 1; for (const sd of [0, 0.45, -0.45]) hit = Math.min(hit, st.raycast(C.tx, C.ty, C.tx + bx * (hd + 0.6) - by * sd, C.ty + by * (hd + 0.6) + bx * sd));
      if (hit < 1) { const want = Math.max(0.9, d * hit - 0.35), room = Math.max(0.05, hit * (hd + 0.6) - 0.45), dd = Math.min(d, want); if (C.clip === undefined || want < C.clip) C.clip = want; if (dd * Math.cos(pitch) > room) pitch = Math.acos(Math.min(1, room / dd)); V.tip = (V.tip || 0) + 1; } } catch (e) {}
    C.pitch = pitch; C.dist = d; pc0(dt); C.pitch = p0; C.dist = d0; V.pitch = pitch;
    if (!(b && b.footout) && (!V.wall || V.t > V.tB + T.craneOut)) F.v = null; };
  // the figure: the jump's own pose (move/jump.js poseJump) laid over the clip while he is in the air; the bones are put back before the next frame's clip
  const TOUCH = ['hips', 'spine', 'chest', 'chest2', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R'];
  let PJ = null, saved = null, rig = null; if (!(g.P && g.P.get('jump') === '0') && typeof document !== 'undefined') Promise.all([import('./jump.js'), import('../entry/rig.js'), import('three')]).then(([j, r, three]) => { PJ = { pose: j.poseJump, Rig: r.EntryRig, THREE: three }; }).catch((e) => console.log('[footout] no pose: ' + (e && e.message)));
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) {
    if (saved && saved.live) { const B = rig.B; for (let i = 0; i < TOUCH.length; i++) { const bn = B[TOUCH[i]]; if (bn) bn.quaternion.copy(saved[i]); } B.hips.position.copy(saved.hp); saved.live = false; }
    sv0(dt); const pl = this.player, b = pl.busy; if (!b || !b.footout || !PJ || F.pose === false) return;
    try { const vis = pl.vis; if (!vis.mixer) return; rig = rig || (g.jump && g.jump.rig) || new PJ.Rig(vis, vis.name || 'player'); if (!rig.ok) return; const B = rig.B, k = b.k || 0; vis.object.updateMatrixWorld(true);
      if (!saved) { saved = TOUCH.map(() => new PJ.THREE.Quaternion()); saved.hp = new PJ.THREE.Vector3(); } for (let i = 0; i < TOUCH.length; i++) { const bn = B[TOUCH[i]]; if (bn) saved[i].copy(bn.quaternion); } saved.hp.copy(B.hips.position); saved.live = true;
      PJ.pose(rig, vis.object, pl.h, { wa: sm(Math.min(k / 0.1, (1 - k) / 0.1)), ck: 0, lk: 0, drop: 0, lean: 0, air: true, vz: 1 - 2 * k, v0: 1, launchSp: 4.6, G: 0, armed: false }); } catch (e) { if (!F.poseErr) { F.poseErr = String(e && (e.stack || e.message)); console.log('[footout] pose: ' + F.poseErr); } } };
  const te0 = g.tryEnter.bind(g); g.tryEnter = function () { if (F.on && F.prompt && go()) return; return te0(); };
  function hudWrap() { if (hudOn || !g.hud || typeof g.hud.draw !== 'function') return; hudOn = true; const hd0 = g.hud.draw.bind(g.hud);
    g.hud.draw = function () { hd0(); if (!F.on || !F.prompt || g.demo || g.capture || !this.w) return; try { const k = this.k || 1, Wd = this.w / k, H = 1080, key = g.menu && g.menu.keyName ? g.menu.keyName('KeyF') : 'F';
      this.panel(Wd / 2 - 130, H * 0.62, 260, 44, 22); this.text(key, Wd / 2 - 96, H * 0.62 + 30, 20, '#ffb52e', 'center', 800); this.text('climb out', Wd / 2 + 14, H * 0.62 + 29, 17, '#fff', 'center', 600); } catch (e) {} }; }
  return F;
}
