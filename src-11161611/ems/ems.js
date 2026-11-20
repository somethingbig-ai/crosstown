// ems/ems.js (built by the progress lane, item 4; taken over and rebased on the six-area map by the gameplay lane, Nov 15): help arrives after a bad crash, a shooting or a car fire, and then it is gone again.
//   - a person struck hard by the player's car (pedhit.js) or shot dead (combat/people.js): ONE ambulance drives in along the roads with
//     lights and a siren, parks OFF the travel lanes (in a gap of the kerb row), two medics get out, one tends the person, one brings the
//     stretcher, they load up and drive off;
//   - a car on fire (combat's car state today; the cars helper's `v.fire`; or game.ems.report('fire', x, y, { car })) or the player's own car
//     wrecked in a heavy crash: ONE fire truck does the same, a firefighter runs a hose out and sprays, the fire dies, they leave.
// Matt: "don't make it annoying". So: at most one of each at a time, a cool-down after each, only real incidents (not bumps), under a
// minute on scene, the siren is quiet, fades with distance and stops when they park, and they NEVER stop in a travel lane: if there is no
// clean place at the kerb within walking distance, or no clean way there, nobody comes (or the unit turns away and is taken off the
// street where the camera is not looking). No traffic is added: a unit is one car, and only while its incident lasts.
// One line in game.js init(): try { (await import('./ems/ems.js')).install(this); }   Off switch: ?ems=0 (nothing is built or wrapped).
// Police (combat/heat*.js) is not touched and not wrapped. While the player is wanted at step 2 or above nobody is sent and a unit on its way
// turns back (?emsheat=<step>, default 2). A unit is an ordinary loose car to everything else: not traffic, not a patrol car, no crime to take.
// Its dice are its own (the game's Math.random stream is left alone).
// Nothing of ours runs while there is no incident except one poll every half second (a few dozen comparisons).
// For other lanes: game.ems.report(kind, x, y, { car, body }) with kind 'hurt' | 'fire' | 'wreck'; a burning car that has
// `extinguish()` gets it called when the water has been on it for a few seconds, else `fire.out = true` / `fire.dead = true` is set,
// and game.ems.onOut(fn) calls fn(car) at that moment.
// gameplay e2 (Nov 15): bodies of our own that read as an ambulance and a fire engine (see visuals); a unit behind slow traffic takes the line between
// lanes sooner and is not sent into a one-lane queue; held up for 8 s it goes quiet. ?emsq=0 = e1's driving.
// Sim space is (x east, y north), heading atan2(dy, dx); three.js is (x, up, -y). A car's own frame: x forward, y up, z to its right.
import * as THREE from 'three';
import { Vehicle } from '../game.js';
import { clamp, lerp, wrapPi } from '../geo.js';

const hyp = Math.hypot, _o = {}, _t = {}, _t2 = {};
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

class Rig extends Vehicle {
  step(dt, inp, g) { if (this.drive && g.player.vehicle !== this) this.ems.drive(this, dt); else { this.drive = null; super.step(dt, inp, g); } }
}

export function install(game, opts = {}) {
  if (game.ems) return game.ems;
  const g = game, P = g.P || new URLSearchParams('');
  const E = (g.ems = { on: true, t: 0, units: [], strays: [], incidents: [], log: [], cool: { amb: 0, fire: 0 }, outFns: [],
    stats: { reports: 0, merged: 0, cooled: 0, busy: 0, noStop: 0, noRoute: 0, dropped: 0, sent: 0, aborted: 0, popped: 0, ghost: 0, laneStand: 0, playerRoadStand: 0 } });
  E.report = () => null; E.onOut = (fn) => { E.outFns.push(fn); };
  if (P.get('ems') === '0') { E.on = false; return E; }
  const REAL = typeof document !== 'undefined' && !!(g.world && g.world.scene) && !opts.headless;
  const R = g.roads, st = g.statics, fast = P.has('emsfast');
  const FIX = (E.fix = P.get('emsfix') !== '0');      // e3: the body is taken, the stretcher keeps out of walls, the ambulance may stop near a player on the walk (?emsfix=0 = e2)
  const num = (k, d) => (P.has(k) && isFinite(+P.get(k)) ? +P.get(k) : d);
  const C = (E.cfg = { hitMin: num('emshit', 4.2), crashMin: num('emscrash', 16), delay: fast ? 1 : 3.5, cool: fast ? 6 : num('emscool', 75), walk: { amb: 38, fire: 30 }, vmax: 15, sceneMax: 45, heatMax: num('emsheat', 2), vol: num('emsvol', 1),
    type: { amb: P.get('emsamb') || 'van', fire: P.get('emsfire') || 'stepvan' }, color: { amb: 0xeeeeea, fire: 0xd6160f }, q: num('emsq', 1) });
  let seed = 0x9e3779b9; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };      // our own dice
  const say = (s) => { if (E.debug || P.has('emslog')) console.log('[ems] ' + E.t.toFixed(1) + ' ' + s); };
  const defOf = (k) => g.kit.cars[C.type[k]] || g.kit.cars.van || g.kit.cars.sedan;

  // ---------------------------------------------------------------- what the camera can see (map metres)
  const camOf = () => { const c = g.world && g.world.camera; if (!c || !c.position) return null; const e = c.matrixWorld ? c.matrixWorld.elements : null, l = e ? hyp(e[8], e[10]) : 0; return { x: c.position.x, y: -c.position.z, dx: l > 0.01 ? -e[8] / l : 1, dy: l > 0.01 ? e[10] / l : 0, cos: Math.cos(Math.min(1.5, Math.atan(Math.tan(((c.fov || 55) * Math.PI) / 360) * (c.aspect || 1.78)) + 0.26)) }; };
  E.seen = (x, y) => { const c = camOf(); if (!c) return false; const ex = x - c.x, ey = y - c.y, d = hyp(ex, ey); if (d > 320) return false; if (d < 14) return true; if ((ex * c.dx + ey * c.dy) / d < c.cos) return false; return st.raycast(c.x, c.y, x, y) >= 1; };

  // ---------------------------------------------------------------- incidents
  const ragBody = (Rg) => ({ rag: Rg, pos: () => { const L = g.__pedhit && g.__pedhit.list; return L && L.includes(Rg) ? { x: Rg.P.hips.p.x, y: -Rg.P.hips.p.z, z: Rg.P.hips.p.y } : null; }, hold: () => { Rg.t = Math.min(Rg.t, 12); }, take: () => { Rg.t = 99; } });
  const standBody = (b, B) => ({ pos: () => (b.doll && B.live.includes(b) ? { x: b.doll.p[36], y: -b.doll.p[38], z: b.doll.p[37] } : null), hold: () => {}, take: () => { try { if (B.live.includes(b)) B.release(b); } catch (e) {} } });
  // e3: a walker of the street shot dead lies in combat.bodies.peds (people.js killPed: p.body.doll), not in bodies.live. It is taken the way the game itself clears a fallen walker (traffic.js: out of peds.list; people.js then drops its doll, blob and mark on its next step)
  const pedBody = (p, B) => ({ ped: p, pos: () => { const d = p.body && p.body.doll; return d && B.peds.includes(p) ? { x: d.p[36], y: -d.p[38], z: d.p[37] } : null; }, hold: () => { if (p.state === 'down') p.t = Math.min(p.t, 5); },
    take: () => { const L = g.peds && g.peds.list, i = L ? L.indexOf(p) : -1; if (i < 0 || p.state !== 'down') return; if (p.vis) { p.vis.used = false; if (p.vis.object) p.vis.object.visible = false; } L.splice(i, 1); } });
  // e3: no body was known at the report (or it was lost): the nearest one lying within 8 m of the scene is the patient
  const lateBody = (I) => { if (I.k !== 'amb' || I.taken || (I.body && I.body.pos())) return I; let best = null, bd = 8; const off = (x, y, mk) => { const d = hyp(x - I.x, y - I.y); if (d < bd) { bd = d; best = mk; } };
    try { const B = g.combat && g.combat.bodies; if (B) { if (B.peds) for (const q of B.peds) { const d = q.body && q.body.doll; if (d) off(d.p[36], -d.p[38], () => pedBody(q, B)); } if (B.live) for (const b of B.live) if (b.doll) off(b.doll.p[36], -b.doll.p[38], () => standBody(b, B)); }
      const L = g.__pedhit && g.__pedhit.list; if (L) for (const Rg of L) { const h = Rg.P && Rg.P.hips && Rg.P.hips.p; if (h) off(h.x, -h.z, () => ragBody(Rg)); } } catch (e) {}
    if (best) { I.body = best(); say('body found at the scene'); } return I; };
  E.report = (kind, x, y, o = {}) => {
    if (!E.on || !isFinite(x) || !isFinite(y)) return null; const k = kind === 'hurt' ? 'amb' : 'fire'; E.stats.reports++;
    for (const I of E.incidents) if (I.k === k && !I.done && hyp(I.x - x, I.y - y) < 35) { if (o.body && !I.body) I.body = o.body; if (o.car && !I.car) I.car = o.car; if (kind === 'fire') I.kind = 'fire'; I.n++; E.stats.merged++; return I; }
    if (E.t < E.cool[k]) { E.stats.cooled++; return null; }
    if (E.units.some((u) => u.k === k) || E.incidents.some((I) => I.k === k && !I.done)) { E.stats.busy++; return null; }
    const I = { k, kind, x, y, t0: E.t, body: o.body || null, car: o.car || null, n: 1, done: false, sent: false, shot: !!o.shot, tries: 0, retryT: 0 };
    E.incidents.push(I); say('incident ' + kind + ' at ' + x.toFixed(0) + ', ' + y.toFixed(0)); return I;
  };
  // a person struck by the player's car
  { const hit0 = g.onPedHit.bind(g); g.onPedHit = (p, v) => { const L = g.__pedhit && g.__pedhit.list, last = L && L[L.length - 1]; hit0(p, v);
    try { if (!E.on || v !== g.player.vehicle || hyp(v.vx, v.vy) < C.hitMin) return; const Rg = L && L[L.length - 1]; E.report('hurt', p.x, p.y, { body: Rg && Rg !== last ? ragBody(Rg) : null }); } catch (e) {} }; }
  // a person shot dead
  { const B = g.combat && g.combat.bodies; if (B && B.kill && B.live) { const k0 = B.kill.bind(B); B.kill = (p, kind, h, force) => { const last = B.live[B.live.length - 1], ok = k0(p, kind, h, force);
    if (ok && E.on) try { const b = B.live[B.live.length - 1]; E.report('hurt', p.x, p.y, { body: b && b !== last && b.doll ? standBody(b, B) : FIX && kind === 'ped' && p && p.body && p.body.doll && B.peds ? pedBody(p, B) : null, shot: true }); } catch (e) {} return ok; }; } }
  // the player's own car in a heavy crash
  let wreck = null;
  { const c0 = g.onCrash.bind(g); g.onCrash = (v, f) => { c0(v, f); if (E.on && v === g.player.vehicle && f >= C.crashMin) wreck = { v, t: E.t, x: v.x, y: v.y, f }; }; }
  // the cars helper's events (game/src/cars/cars.js): a car catches fire; a burning car blows and leaves a shell where it stood
  if (g.events && typeof g.events.on === 'function') try { g.events.on('carfire', (v) => { if (v && !v.ems) E.report('fire', v.x, v.y, { car: v }); });
    g.events.on('carexplode', (w, x, y) => { if (!w) return; const wx = isFinite(x) ? x : w.x, wy = isFinite(y) ? y : w.y; for (const I of E.incidents) if (I.k === 'fire' && !I.done && hyp(I.x - wx, I.y - wy) < 30) { I.car = w; I.x = wx; I.y = wy; return; } E.report('fire', wx, wy, { car: w }); });
    // the fire went out by itself, or the wreck was taken away, before anyone was at work on it: nobody is needed
    g.events.on('carfireout', (v) => { if (!v || v.wrecked) return; for (const I of E.incidents) if (I.k === 'fire' && I.kind === 'fire' && !I.done && I.car === v) I.over = 'the fire went out'; });
    g.events.on('carwreckgone', (v) => { for (const I of E.incidents) if (I.k === 'fire' && !I.done && I.car === v) I.over = 'the wreck was taken away'; }); } catch (e) {}
  const fireOf = (v) => { const S = g.combat && g.combat.cars && g.combat.cars.get(v); return S && !S.dead ? S : null; };
  const burning = (v) => { if (!v) return false; if (typeof v.fire === 'number' ? v.fire > 0 : v.fire && !(v.fire.out || v.fire.dead)) return true; const S = fireOf(v); return !!(S && S.fire && !S.fire.dead && S.fire.t <= S.fire.life); };
  let pollT = 0;
  function poll() {
    const pl = g.player, near = (v) => Math.abs(v.x - pl.x) < 220 && Math.abs(v.y - pl.y) < 220;
    const cc = g.combat && g.combat.cars; if (cc && cc.size) for (const [v, S] of cc) { if (S.dead || !S.fire || S.fire.dead || v.ems || !near(v)) continue; E.report('fire', v.x, v.y, { car: v }); }
    if (g.cars && g.cars.fires) for (const v of g.cars.fires) { if (v && !v.ems && near(v)) E.report('fire', v.x, v.y, { car: v }); }
    for (const v of g.vehicles) if (v.fire && !v.ems && !(v.fire.out || v.fire.dead)) E.report('fire', v.x, v.y, { car: v });
    if (wreck) { const v = wreck.v, age = E.t - wreck.t; if (age > 9 || hyp(v.x - wreck.x, v.y - wreck.y) > 25) wreck = null; else if (age > 2.5 && hyp(v.vx, v.vy) < 1.5) { E.report('wreck', v.x, v.y, { car: v }); wreck = null; } }
  }
  const wanted = () => { const H = g.combat && g.combat.heat; return !!H && (H.level || 0) >= C.heatMax; };      // a chase or a firefight: police only
  const quiet = () => { const H = g.combat && g.combat.heat; return !H || H.t - (H.lastShotT ?? -99) > 8; };

  // ---------------------------------------------------------------- where to stop: at the kerb, off every travel lane
  const boxOf = (e) => e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
  // the body's outline at a pose: is every part of it off the lanes, off the walks, clear of walls, posts, parked and standing cars?
  function clearPose(x, y, h, L, W, skip, lane) {
    const c = Math.cos(h), s = Math.sin(h), hl = L / 2, hw = W / 2;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw], [hl * 0.5, hw], [-hl * 0.5, hw], [hl * 0.5, -hw], [-hl * 0.5, -hw]]) { const px = x + c * a - s * b, py = y + s * a + c * b; if (st.onSidewalk(px, py)) return false; if (!lane && R.inLane(px, py, -0.3)) return false; }
    for (const a of [hl - hw, 0, hw - hl]) if (st.resolve(x + c * a, y + s * a, hw + 0.12, _o)) return false;
    const hit = (o, pad) => { const dx = o.x - x, dy = o.y - y; if (Math.abs(dx) > 14 || Math.abs(dy) > 14) return false; const oc = Math.cos(o.h), os = Math.sin(o.h), ol = (o.def ? o.def.len : 4.6) / 2, ow = (o.def ? o.def.wid : 1.9) / 2;
      for (const [a, b] of [[ol, ow], [ol, -ow], [-ol, ow], [-ol, -ow], [0, 0]]) { const qx = dx + oc * a - os * b, qy = dy + os * a + oc * b; if (Math.abs(qx * c + qy * s) < hl + pad && Math.abs(-qx * s + qy * c) < hw + pad * 0.5) return true; } return false; };
    if (g.parked && g.parked.near) for (const o of g.parked.near(x, y, 12, [])) if (hit(o, 0.7)) return false;
    for (const o of g.vehicles) if (o !== skip && hit(o, 1.2)) return false;
    for (const o of g.traffic.cars) if ((o.dbl || o.v < 0.3) && hit(o, 1.0)) return false;
    return true;
  }
  E.clearPose = clearPose;
  function planStop(ix, iy, def, k, minD = 0) {
    const L = def.len, W = def.wid, maxW = C.walk[k], pl = g.player; let best = null;
    const pe = R.nearestEdge(pl.x, pl.y, 14), afoot = FIX && k === 'amb' && !pl.vehicle && st.onSidewalk(pl.x, pl.y);      // e3: a player standing on the walk is not in the ambulance's way
    for (const e of R.edges) {
      if (e.out || e.len < L + 18) continue; const b = boxOf(e); if (ix < b[0] - maxW - 8 || ix > b[2] + maxW + 8 || iy < b[1] - maxW - 8 || iy > b[3] + maxW + 8) continue;
      for (const dir of e.oneway ? [1] : [1, -1]) for (const side of e.oneway ? [1, -1] : [1]) {
        const ln = dir > 0 ? e.line : e.rev, travel = e.oneway ? (e.lanes * e.lw) / 2 : Math.max(1, Math.floor(e.lanes / 2)) * e.lw, r0 = (R.nodes[R.startNode(e, dir)].r || 6) + L / 2 + 3, r1 = (R.nodes[R.endNode(e, dir)].r || 6) + L / 2 + 3;
        for (let s = r0; s < e.len - r1; s += 3) {
          ln.at(s, _t); const nx = _t.ty * side, ny = -_t.tx * side, cx = _t.x, cy = _t.y; if (hyp(cx - ix, cy - iy) > maxW + 10) continue;
          let kerb = -1; for (let d = travel + 0.2; d < travel + 5.2; d += 0.2) if (st.onSidewalk(cx + nx * d, cy + ny * d)) { kerb = d; break; }
          const nl = R.laneCount(e, dir); let off, inLane = false;
          if (kerb >= 0 && kerb - travel >= W + 0.3) off = kerb - 0.3 - W / 2;
          else if (nl >= 2 && !(pe && pe.e === e) && e.len > 60) { /* no room at the kerb: the kerb lane of a block with another lane beside it (as the double-parked vans of the street stand), tight to the parked row, and never on the block the player is on */ inLane = true; off = travel - W / 2 - 0.25; while (off > travel - e.lw && !clearPose(cx + nx * off, cy + ny * off, Math.atan2(_t.ty, _t.tx), L, W, null, true)) off -= 0.3; if (off <= travel - e.lw) continue; }
          else continue;
          const px = cx + nx * off, py = cy + ny * off, h = Math.atan2(_t.ty, _t.tx), walk = hyp(px - ix, py - iy); if (walk > maxW || walk < minD) continue;
          if (!g.bounds.in(px, py, -12) || !clearPose(px, py, h, L, W, null, inLane)) continue;
          { /* not where the last metres of the way in would pass the player or his car */ const ax = pl.x - px, ay = pl.y - py, f = ax * _t.tx + ay * _t.ty, sd = Math.abs(-ax * _t.ty + ay * _t.tx); if (f < L / 2 + 5 && sd < W / 2 + (afoot ? 1.2 : 4.2) && (f > -26 || (pe && pe.e === e))) continue; }
          const los = st.raycast(px, py, ix, iy) >= 1, mine = pe && pe.e === e && hyp(px - pl.x, py - pl.y) < 14 && !afoot;
          const score = walk + (los ? 0 : k === 'fire' ? 40 : 12) + (mine ? 25 : 0) + (k === 'fire' && walk < 9 ? 20 : 0) + (inLane ? 60 : 0);
          if (!best || score < best.score) best = { x: px, y: py, h, e, dir, side, s, off: off * side, walk, los, score, tx: _t.tx, ty: _t.ty, inLane };
        }
      }
    }
    return best;
  }
  E.planStop = (x, y, k = 'amb') => planStop(x, y, defOf(k), k);

  // ---------------------------------------------------------------- the way there, from a block the camera does not see
  function routeFor(stop, I) {
    const pl = g.player, target = R.startNode(stop.e, stop.dir), cand = [];
    for (const e of R.edges) { if (e.out || e.len < 40 || e === stop.e || e.s0 === undefined) continue; e.line.at(e.len / 2, _t); const d = hyp(_t.x - I.x, _t.y - I.y); if (d < 90 || d > 215 + 15 * I.tries) continue; if (!g.bounds.in(_t.x, _t.y, -20)) continue; if (hyp(_t.x - pl.x, _t.y - pl.y) < 90 || E.seen(_t.x, _t.y)) continue; cand.push(e); }
    // the player standing in a lane (in his car or on foot): not along that block, unless it is the block of the stop itself
    let avoid = null; { const pv = pl.vehicle; if (!pv || hyp(pv.vx, pv.vy) < 3) { const ne = R.nearestEdge(pl.x, pl.y, 12); if (ne && ne.e !== stop.e && R.inLane(pl.x, pl.y, 0.5)) avoid = ne.e; } }
    let best = null, tried = 0; const rnd = rand;
    while (cand.length && tried < 10) { const e = cand.splice(Math.floor(rnd() * cand.length), 1)[0]; tried++;
      for (const dir of e.oneway ? [1] : [1, -1]) { let segs = R.route(e, dir, target); if (!segs) continue; segs = segs.slice(1); if (segs.some((q) => q.e === stop.e)) continue;
        const li = Math.floor(R.laneCount(e, dir) / 2); R.lanePos(e, dir, li, e.len / 2, _t2); const sx = _t2.x, sy = _t2.y, sh = _t2.h; let len = e.len / 2 + stop.s; for (const q of segs) len += q.e.len; if (len > Math.min(400, 340 + 70 * I.tries)      /* gameplay e1: 400, was 480 (node, six-area map: every call sent over 450 m of road was turned away after 75 s) */ || (avoid && (e === avoid || segs.some((q) => q.e === avoid)))) continue;
        if (g.traffic.cars.some((q) => hyp(q.x - sx, q.y - sy) < 10) || g.vehicles.some((q) => hyp(q.x - sx, q.y - sy) < 14)) continue;
        if (!best || len < best.len) best = { e, dir, segs, len, x: sx, y: sy, h: sh }; } }
    if (!best) return null;
    const pts = [[best.x, best.y]], lane = (e, dir) => Math.floor(R.laneCount(e, dir) / 2), run = (e, dir, li, a, b) => { for (let s = a; s < b; s += 7) { R.lanePos(e, dir, li, s, _t); pts.push([_t.x, _t.y, R.laneCount(e, dir)]); } };
    run(best.e, best.dir, lane(best.e, best.dir), best.e.len / 2 + 7, best.e.len - 6);
    for (const q of best.segs) run(q.e, q.dir, lane(q.e, q.dir), 7, q.e.len - 6);
    { const e = stop.e, dir = stop.dir, n = R.laneCount(e, dir), li = stop.side > 0 ? n - 1 : 0; run(e, dir, li, 7, stop.s - 13); const bx = stop.x - stop.tx * 6.5, by = stop.y - stop.ty * 6.5; pts.push([bx, by], [stop.x, stop.y]); }
    if (C.q) { /* e2: not into a queue on a one-lane street (three or more cars standing on the one-lane part of the way): another way is tried, or nobody comes */ let nq = 0; for (const c of g.traffic.cars) { if (c.v > 1.2) continue; for (const p of pts) if (p[2] === 1 && Math.abs(p[0] - c.x) < 4 && Math.abs(p[1] - c.y) < 4) { nq++; break; } } if (nq >= 3) { E.stats.queued = (E.stats.queued || 0) + 1; return null; } }
    return { pts, len: best.len, x: best.x, y: best.y, h: best.h };
  }
  // the way off: out of the kerb into the nearest lane, then straight on for a few blocks
  function wayOut(v, stop) {
    const e0 = stop.e, dir0 = stop.dir, n = R.laneCount(e0, dir0), li = stop.side > 0 ? n - 1 : 0, pts = [[v.x, v.y]]; let e = e0, dir = dir0, len = 0;
    for (let s = stop.s + 9; s < e.len - 6; s += 7) { R.lanePos(e, dir, li, s, _t); pts.push([_t.x, _t.y]); }
    for (let k = 0; k < 7 && len < 420; k++) { const node = R.endNode(e, dir), hin = R.lanePos(e, dir, 0, e.len, _t).h; let pick = null, bd = 9; for (const x of R.exits(node, e)) { if (x.e.out) continue; const t = Math.abs(wrapPi(R.lanePos(x.e, x.dir, 0, 0, _t2).h - hin)); if (t < bd) { bd = t; pick = x; } } if (!pick) break;
      e = pick.e; dir = pick.dir; const l2 = Math.floor(R.laneCount(e, dir) / 2); for (let s = 7; s < e.len - 6; s += 7) { R.lanePos(e, dir, l2, s, _t); pts.push([_t.x, _t.y]); } len += e.len; }
    return pts.length > 2 ? pts : null;
  }

  // ---------------------------------------------------------------- driving (kinematic, as the patrol cars are driven)
  const circ = (v) => { const r = v.def.wid / 2, a = Math.max(0, v.def.len / 2 - r), c = Math.cos(v.h), s = Math.sin(v.h); return [[v.x + c * a, v.y + s * a, r], [v.x, v.y, r], [v.x - c * a, v.y - s * a, r]]; };
  function touchesPlayer(v) {
    const pl = g.player, pv = pl.vehicle, A = circ(v);
    if (pv && pv !== v) { if (Math.abs(pv.x - v.x) > 14 || Math.abs(pv.y - v.y) > 14) return false; for (const a of A) for (const b of circ(pv)) if (hyp(a[0] - b[0], a[1] - b[1]) < a[2] + b[2] + 0.25) return true; return false; }
    for (const a of A) if (hyp(a[0] - pl.x, a[1] - pl.y) < a[2] + 0.6) return true; return false;
  }
  E.drive = (v, dt) => {
    const U = v.unit, D = v.drive, pl = g.player, pv = pl.vehicle;
    if (D.settle) { const S = D.settle; S.t += dt; const k = sm(S.t / 0.7); v.x = lerp(S.x0, S.x, k); v.y = lerp(S.y0, S.y, k); v.h = wrapPi(S.h0 + wrapPi(S.h - S.h0) * k); v.vf = 0; v.vx = v.vy = 0; v.yawV = 0; v.steer *= 0.9; v.braking = true; if (S.t >= 0.7) { v.drive = null; U.parked = true; } return; }
    const Pt = D.pts; while (D.i < Pt.length - 1 && hyp(Pt[D.i][0] - v.x, Pt[D.i][1] - v.y) < 6) D.i++;
    const last = D.i >= Pt.length - 1, tx = Pt[D.i][0], ty = Pt[D.i][1], cs = Math.cos(v.h), sn = Math.sin(v.h); let wx = tx, wy = ty;
    if (D.off && D.i < Pt.length - 3) { const j = Math.max(1, D.i), sx = Pt[j][0] - Pt[j - 1][0], sy = Pt[j][1] - Pt[j - 1][1], sl = hyp(sx, sy) || 1; wx += (-sy / sl) * D.off; wy += (sx / sl) * D.off; if (st.onSidewalk(wx, wy)) { wx = tx; wy = ty; D.off = 0; } }
    const dh = wrapPi(Math.atan2(wy - v.y, wx - v.x) - v.h); let turn = Math.abs(dh); if (D.i + 2 < Pt.length) turn = Math.max(turn, Math.abs(wrapPi(Math.atan2(Pt[D.i + 2][1] - Pt[D.i + 1][1], Pt[D.i + 2][0] - Pt[D.i + 1][0]) - v.h)) * 0.8);
    let want = lerp(D.vmax || C.vmax, 5.5, clamp(turn / 0.7, 0, 1)), rem = hyp(tx - v.x, ty - v.y); for (let j = D.i; j < Pt.length - 1 && rem < 70; j++) rem += hyp(Pt[j + 1][0] - Pt[j][0], Pt[j + 1][1] - Pt[j][1]);
    if (D.park) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 3 * (rem - 0.5))) + 0.7);
    let gap = 99, mine = false; const look = 8 + v.vf * 1.5, half = v.def.len / 2, hw = v.def.wid / 2;
    const test = (ox, oy, rad, who) => { const dx = ox - v.x, dy = oy - v.y, f = dx * cs + dy * sn; if (f < 0.5 || f > look + rad + half) return; if (Math.abs(-dx * sn + dy * cs) > hw + 0.15 + rad) return; const gp = f - half - rad; if (gp < gap) { gap = gp; mine = who === 1; } };
    if (D.ghost > 0) D.ghost -= dt; else for (const o of g.traffic.cars) { if (Math.abs(o.x - v.x) > 45 || Math.abs(o.y - v.y) > 45) continue; const r2 = o.def.wid / 2, a2 = Math.max(0, o.def.len / 2 - r2), c2 = Math.cos(o.h), s2 = Math.sin(o.h); test(o.x + c2 * a2, o.y + s2 * a2, r2); test(o.x, o.y, r2); test(o.x - c2 * a2, o.y - s2 * a2, r2); }
    for (const o of g.vehicles) { if (o === v || Math.abs(o.x - v.x) > 45 || Math.abs(o.y - v.y) > 45) continue; for (const q of circ(o)) test(q[0], q[1], q[2] + (o === pv ? 0.7 : 0.2), o === pv ? 1 : 0); }
    if (!pv) test(pl.x, pl.y, 0.8, 1);
    for (const q of g.peds.list) if (q.onRoad && q.state !== 'down') test(q.x, q.y, 0.5);
    if (gap < 99) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 6 * (gap - 1.6))));
    D.gap = gap; D.mine = mine; let rev = false;
    if (D.revT > 0) { /* backing off to pull out round what is in the way: only while there is room behind */ D.revT -= dt; let rear = 99; const rt = (ox, oy, rad) => { const dx = ox - v.x, dy = oy - v.y, f = -(dx * cs + dy * sn); if (f < 0.3 || f > half + rad + 5) return; if (Math.abs(-dx * sn + dy * cs) > hw + 0.3 + rad * 0.6) return; rear = Math.min(rear, f - half - rad); };
      for (const o of g.traffic.cars) { if (Math.abs(o.x - v.x) > 16 || Math.abs(o.y - v.y) > 16) continue; rt(o.x, o.y, o.def.len * 0.42); } for (const o of g.vehicles) { if (o === v || Math.abs(o.x - v.x) > 16 || Math.abs(o.y - v.y) > 16) continue; for (const q of circ(o)) rt(q[0], q[1], q[2] + 0.3); } if (!pv) rt(pl.x, pl.y, 0.8);
      if (rear < 1.6 || st.onSidewalk(v.x - cs * (half + 1.2), v.y - sn * (half + 1.2)) || st.resolve(v.x - cs * (half + 0.8), v.y - sn * (half + 0.8), 0.9, _o)) D.revT = 0; else { rev = true; want = -2.6; } }
    else if (v.vf < 1 && gap < 5) { D.blockT += dt; D.stuckT += dt; if (D.blockT > 1.2 && !D.off) { D.side = -(D.side || 1); D.off = D.side * 3.2; D.offT = 5; }
      if (D.blockT > 1.7 && E.t - (D.revAt || -9) > 5 && (D.revN || 0) < 3 && D.i < Pt.length - 2) { D.revAt = E.t; D.revT = 1.7; D.revN = (D.revN || 0) + 1; D.side = -(D.side || 1); D.off = D.side * 3.2; D.offT = 7; D.blockT = 0; }
      if (D.blockT > 3 && !mine && !E.seen(v.x, v.y)) { D.ghost = 2.5; D.blockT = 0; E.stats.ghost++; } }
    else D.blockT = Math.max(0, D.blockT - dt);
    // held up by traffic: it takes the line between two lanes and the cars on either side of it move over (as they do for a siren); if after eight seconds that has not opened a way, it goes through
    if (!mine && gap < (C.q ? 12 : 7) && v.vf < (C.q ? 4.5 : 2.5) && !(D.ghost > 0)) { D.qT = (D.qT || 0) + dt; if (!D.off || Math.abs(D.off) > 2) { D.off = (D.side || 1) * 1.65; } D.offT = 4; if (D.qT > (C.q && !E.seen(v.x, v.y) ? 3.5 : 8)) { D.ghost = 3; D.qT = 3; E.stats.ghost++; if (E.seen(v.x, v.y)) E.stats.ghostSeen = (E.stats.ghostSeen || 0) + 1; } } else D.qT = Math.max(0, (D.qT || 0) - dt * 0.5);
    if (D.qT > 0.3 && g.traffic.shove) for (const o of g.traffic.cars) { const dx = o.x - v.x, dy = o.y - v.y; if (Math.abs(dx) > 22 || Math.abs(dy) > 22) continue; const f = dx * cs + dy * sn, lat = -dx * sn + dy * cs; if (f < -3 || f > 20 || Math.abs(lat) > 3.4) continue; const sg = lat >= 0 ? 1 : -1; try { g.traffic.shove(o, -sn * sg, cs * sg, 1.1 * dt, 1.3 * dt); } catch (e) {} }
    // is it getting anywhere? (a wall line across a lane, a corner it cannot make)
    D.pT = (D.pT || 0) + dt; if (D.pT >= 1) { const mv = D.px === undefined ? 9 : hyp(v.x - D.px, v.y - D.py); D.px = v.x; D.py = v.y; D.pT = 0; if (mv > 2) { D.stuckT = 0; D.wedge = 0; } else if (mv < 0.4 && gap > 5) { D.wedge = (D.wedge || 0) + 1; D.stuckT += 1; if (D.wedge >= 2 && !E.seen(v.x, v.y)) D.noclip = 3; } }
    if (D.noclip > 0) D.noclip -= dt;
    if (D.off) { D.offT -= dt; if (D.offT <= 0) D.off = 0; }
    const acc = clamp(want - v.vf, -9 * dt, 3.6 * dt); v.vf = Math.max(rev ? -2.6 : 0, v.vf + acc); v.braking = acc < -0.001 || v.vf < 0.3;
    const maxYaw = Math.max(0, Math.min(v.vf / 4.2, 6.5 / Math.max(v.vf, 1))); let yaw = clamp(dh * 3, -maxYaw, maxYaw); if (v.vf < 0) yaw = Math.sign(D.off || 1) * 0.3 * Math.min(1, -v.vf / 2);
    v.yawV = yaw; v.h = wrapPi(v.h + yaw * dt); v.steer = clamp(Math.atan((yaw * (v.def.wheelbase || 3.4)) / Math.max(v.vf, 2)), -0.6, 0.6);
    const x0 = v.x, y0 = v.y; v.vx = Math.cos(v.h) * v.vf; v.vy = Math.sin(v.h) * v.vf; v.x += v.vx * dt; v.y += v.vy * dt; v.spin += (v.vf * dt) / v.def.radius;
    if (touchesPlayer(v)) { v.x = x0; v.y = y0; v.vf = 0; v.vx = v.vy = 0; }      // never into the player or his car
    if (!(D.noclip > 0) && st.resolve(v.x, v.y, 1.0, _o, D.ghost > 0 || !!D.park)) { v.x = _o.x; v.y = _o.y; if (_o.depth > 0.05) v.vf *= 0.9; }
    v.roll += (clamp(-v.vf * yaw * 0.006, -0.06, 0.06) - v.roll) * Math.min(1, dt * 6); v.pitch += (clamp((-acc / Math.max(dt, 1e-4)) * 0.004, -0.04, 0.045) - v.pitch) * Math.min(1, dt * 6); v.z = 0; v.slip = 0; v.hitT = 0;
    if (D.park && last && (rem < 1.0 || (v.vf < 0.35 && rem < 3))) { const S = U.stop; D.settle = { t: 0, x0: v.x, y0: v.y, h0: v.h, x: S.x, y: S.y, h: S.h }; if (hyp(S.x - v.x, S.y - v.y) > 3.2 || !clearPose(S.x, S.y, S.h, v.def.len, v.def.wid, v, S.inLane)) { D.settle = null; U.failed = 'stop taken'; } }
    else if (!D.park && last && rem < 5) U.atEnd = true;
  };

  // ---------------------------------------------------------------- units
  function dispatch(I) {
    const k = I.k, def = defOf(k), stop = planStop(I.x, I.y, def, k); if (!stop) { E.stats.noStop++; return null; }
    const way = routeFor(stop, I); if (!way) { E.stats.noRoute++; return null; }
    const v = new Rig(def, way.x, way.y, way.h, C.color[k]); const U = { k, v, I, stop, state: 'in', t: 0, tDisp: E.t, tArr: 0, tLeave: 0, crew: [], phase: 0, pt: 0, parked: false, lane: 0, block: 0, id: ++E.n0, d0: way.len };
    Object.assign(v, { ems: E, unit: U, drive: { pts: way.pts, i: 1, blockT: 0, stuckT: 0, off: 0, offT: 0, ghost: 0, park: true }, vf: 9, id: 900 + U.id });
    g.vehicles.push(v); E.units.push(U); E.stats.sent++; U.rec = { kind: I.kind, unit: k, tInc: +I.t0.toFixed(1), tDisp: +E.t.toFixed(1), road: Math.round(way.len), walk: +stop.walk.toFixed(1), kerbLane: !!stop.inLane }; E.log.push(U.rec);
    say((k === 'amb' ? 'ambulance' : 'fire truck') + ' sent, ' + Math.round(way.len) + ' m by road, stop ' + stop.walk.toFixed(0) + ' m from the scene'); if (REAL) try { V.dress(U); } catch (e) { warn(e); }
    return U;
  }
  E.n0 = 0;
  let warned = 0; const warn = (e) => { if (warned++ < 4) console.warn('[ems] ' + String((e && e.stack) || e).slice(0, 500)); };
  function leave(U, why) {
    if (U.state === 'out') return; U.state = 'out'; U.t = 0; U.tLeave = E.t; U.I.done = true; U.why = why || 'done'; U.rec.tLeave = +E.t.toFixed(1); U.rec.why = U.why; if (U.tArr) U.rec.scene = +(E.t - U.tArr).toFixed(1);
    for (const m of U.crew) m.gone = true; U.wait = 0; say('unit ' + U.id + ' leaves: ' + U.why);
  }
  function remove(U, pop) {
    const v = U.v, i = g.vehicles.indexOf(v); if (i >= 0) g.vehicles.splice(i, 1); const j = E.units.indexOf(U); if (j >= 0) E.units.splice(j, 1); U.I.done = true; U.state = 'gone'; E.cool[U.k] = E.t + C.cool; if (pop) E.stats.popped++;
    U.rec.tGone = +E.t.toFixed(1); U.rec.lane = +U.lane.toFixed(1); U.rec.block = +U.block.toFixed(1); if (pop) U.rec.pop = true; if (REAL) try { V.undress(U); } catch (e) { warn(e); } say('unit ' + U.id + ' gone');
  }
  const scenePos = (I) => { let p = I.body && I.body.pos(); if (p) { I.x = p.x; I.y = p.y; return p; } if (I.k === 'fire' && I.car && g.combat && g.combat.cars) { /* the car that burnt may have become a wreck where it stood */ let bd = 12, b = null; for (const [c2, S] of g.combat.cars) { if (S.dead) continue; const d = hyp(c2.x - I.x, c2.y - I.y); if (d < bd && (S.fire || S.smoke || c2 === I.car)) { bd = d; b = c2; } } if (b) I.car = b; }
    if (I.car && isFinite(I.car.x) && hyp(I.car.x - I.x, I.car.y - I.y) < 60) { I.x = I.car.x; I.y = I.car.y; } return { x: I.x, y: I.y, z: 0 }; };
  // a walker of the crew: straight at its mark, sliding along what is in the way
  function walk(m, tx, ty, sp, dt) {
    const dx = tx - m.x, dy = ty - m.y, d = hyp(dx, dy); if (d < 0.25) { m.sp = 0; return true; }
    const h = Math.atan2(dy, dx); m.h += wrapPi(h - m.h) * Math.min(1, dt * 9); const stp = Math.min(d, sp * dt), nx = m.x + (dx / d) * stp, ny = m.y + (dy / d) * stp;
    if (m.nowall && m.gave) { if (hyp(tx - m.gave[0], ty - m.gave[1]) < 1.5) { m.sp = 0; return true; } m.gave = null; m.stuck = 0; }      // e3: a medic never goes through a wall: held for 2.5 s it stops where it is
    if (m.stuck > 2.5) { if (m.nowall) { m.gave = [tx, ty]; m.sp = 0; return true; } m.x = nx; m.y = ny; } else { st.resolve(nx, ny, 0.3, _o); const moved = hyp(_o.x - m.x, _o.y - m.y); m.stuck = moved < stp * 0.3 ? (m.stuck || 0) + dt : 0; m.x = _o.x; m.y = _o.y; }
    m.sp = sp; return false;
  }
  const local = (v, lx, lz) => ({ x: v.x + Math.cos(v.h) * lx + Math.sin(v.h) * lz, y: v.y + Math.sin(v.h) * lx - Math.cos(v.h) * lz });
  function stepUnit(U, dt) {
    const v = U.v, pl = g.player, I = U.I; U.t += dt;
    if (!g.vehicles.includes(v)) { if (U.state === 'gone') return; g.vehicles.push(v); }
    if (pl.vehicle === v || v.wrecked) { /* taken by the player: it is his now (or blown up: the shell is the cars helper's) */ U.stolen = true; for (const m of U.crew) m.gone = true; v.drive = null; v.ems = null; v.unit = null; const j = E.units.indexOf(U); if (j >= 0) E.units.splice(j, 1); I.done = true; E.cool[U.k] = E.t + C.cool; U.rec.why = v.wrecked ? 'wrecked' : 'stolen'; U.rec.tGone = +E.t.toFixed(1); E.strays.push(U); while (E.strays.length > 2) { const q = E.strays.shift(); if (REAL) try { V.undress(q); } catch (e) {} } return; }
    // standing in a travel lane? (never, by design: counted, and it ends the run)
    if (hyp(v.vx, v.vy) < 0.5 && U.state !== 'gone') { let inl = false; const c = Math.cos(v.h), s = Math.sin(v.h), hl = v.def.len / 2, hw = v.def.wid / 2; for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, 0]]) if (R.inLane(v.x + c * a - s * b, v.y + s * a + c * b, -0.35)) { inl = true; break; }
      const D = v.drive, head = !D || D.settle || D.mine || !(D.gap < 8); if (inl && U.stop.inLane && (U.parked || (D && D.settle)) && U.state !== 'in' ) { U.kerbT = (U.kerbT || 0) + dt; U.rec.kerbLaneT = +U.kerbT.toFixed(1); const pe = R.nearestEdge(pl.x, pl.y, 12); if (pe && pe.e === U.stop.e && hyp(v.x - pl.x, v.y - pl.y) < 70) { U.block += dt; E.stats.playerRoadStand += dt; } } else if (inl) { U.lane += dt; E.stats.laneStand += dt; { const w = U.state + (D ? (D.settle ? '-settle' : D.revT > 0 ? '-rev' : D.mine ? '-player' : D.gap < 8 ? '-queue' : U.rolling ? '-pullout' : '-drive') : U.wait > 0 ? '-wait' : '-parked'), q = U.rec.laneIn || (U.rec.laneIn = {}); q[w] = +((q[w] || 0) + dt).toFixed(2); } const pe = R.nearestEdge(pl.x, pl.y, 12), me = R.nearestEdge(v.x, v.y, 12); if (head && pe && me && pe.e === me.e && hyp(v.x - pl.x, v.y - pl.y) < 70) { U.block += dt; E.stats.playerRoadStand += dt; } } }
    const d = hyp(v.x - pl.x, v.y - pl.y);
    if (U.state === 'in') {
      const D = v.drive; scenePos(I); if (I.body) I.body.hold();
      if (D && !D.settle) { /* e2: held up for more than eight seconds it goes quiet, until it has run freely again */ if (v.vf < 2.5) U.held = (U.held || 0) + dt; else if (v.vf > 5) U.held = Math.max(0, (U.held || 0) - dt * 2); if (C.q && U.held > 8) { U.hushT = (U.hushT || 0) + dt; U.rec.hush = +U.hushT.toFixed(1); } else if (!(v.vf < 1 && (D.blockT || 0) > 1.5)) { U.sirT2 = (U.sirT2 || 0) + dt; U.rec.siren = +U.sirT2.toFixed(1); } }
      if (I.k === 'fire') { const S = fireOf(I.car); if (S && S.fire && !S.fire.dead) S.fire.life = Math.max(S.fire.life, S.fire.t + 14); }      // it burns until someone puts it out (or a minute has passed)
      if (I.over || wanted()) { abort(U, I.over || 'police at work'); return; }
      if (U.failed || !D) { if (U.parked) { U.state = 'scene'; U.t = 0; U.tArr = E.t; U.rec.tArr = +E.t.toFixed(1); U.rec.arrive = +(E.t - I.t0).toFixed(1); say('unit ' + U.id + ' on scene ' + U.rec.arrive + ' s after the incident'); return; } abort(U, U.failed || 'lost its way'); return; }
      { const lim = D.mine ? 4 : D.gap > 5 ? 9 : C.q ? 16 : 26; const far = U.t > 75 && (U.t > 95 || hyp(v.x - U.stop.x, v.y - U.stop.y) > 60);      /* gameplay e1: not turned away in the last metres, beside the player */ if (D.stuckT > lim || far) { abort(U, D.stuckT > lim ? 'held up' : 'too long on the way'); return; } }
      if (hyp(I.x - U.stop.x, I.y - U.stop.y) > C.walk[U.k] + 22) { abort(U, 'the scene moved away'); return; }
      return;
    }
    if (U.state === 'scene') {
      let over = false; try { over = U.k === 'amb' ? medics(U, dt) : firemen(U, dt); } catch (e) { warn(e); over = true; }
      if (over || U.t > C.sceneMax) {
        const pts = wayOut(v, U.stop); leave(U, over ? 'done' : 'time up'); U.crewIn = true; for (const m of U.crew) m.gone = true;
        if (pts) { U.out = pts; } else U.noWay = true;
      }
      return;
    }
    if (U.state === 'out') {
      if (!v.drive && U.out && !U.rolling) { /* pull out only when the player's car is not coming up beside or behind, and neither he nor his car is in the first metres of the way out; until then it stays where it is, off the lanes, and after ten seconds puts its lamps out */
        const pv = pl.vehicle; let busy = !!pv && hyp(pv.vx, pv.vy) > 2.5 && d < 45 && (pv.x - v.x) * pv.vx + (pv.y - v.y) * pv.vy < 0; if (!busy && d < 40) for (let j = 1; j < Math.min(U.out.length, 6) && !busy; j++) if (hyp(U.out[j][0] - pl.x, U.out[j][1] - pl.y) < (pv ? 5.5 : 3.6)) busy = true;
        U.wait += dt; if (U.wait > 10) U.dark = true; if (!busy) { U.rolling = true; U.rollT = U.t; v.drive = { pts: U.out, i: 1, blockT: 0, stuckT: 0, off: 0, offT: 0, ghost: 0, park: false, vmax: 12 }; v.vf = 0; } }
      const seen = E.seen(v.x, v.y);
      if (d > 230 || (!seen && d > 60) || (!seen && (U.noWay || !v.drive) && U.t > (U.quick ? 0.2 : 3))) { remove(U, false); return; }
      if (!U.rolling && !U.noWay) { if (U.t > 90) remove(U, seen); return; }
      if (U.atEnd || U.t - (U.rollT || 0) > 26 || (v.drive && v.drive.stuckT > (v.drive.mine || v.drive.gap > 5 ? 4 : 12)) || (U.noWay && U.t > (U.quick ? 5 : 14))) { remove(U, seen); return; }
    }
  }
  function abort(U, why) { E.stats.aborted++; const v = U.v, mine = !!(v.drive && v.drive.mine); U.rec.aborted = why + (mine ? ' by the player' : ''); leave(U, why); U.parked = false; if (mine) { /* the player is in its way: lamps out, and off the street as soon as the camera is not on it */ U.dark = true; U.noWay = true; U.quick = true; v.drive = null; return; } const lc = R.locate(v.x, v.y, v.h, 20);
    if (lc) { const stop = { e: lc.e, dir: lc.dir, side: 1, s: lc.s - 9 }; U.out = wayOut(v, stop); if (U.out) { U.rolling = true; v.drive = { pts: U.out, i: 1, blockT: 0, stuckT: 0, off: 0, offT: 0, ghost: 0, park: false, vmax: 11 }; return; } } U.noWay = true; v.drive = null; }

  // ---------------------------------------------------------------- the crews (who stands where and when; ems draws them if it can)
  const member = (U, i, x, y, h) => { const m = { i, x, y, h, sp: 0, pose: 'idle', gone: false, born: E.t, kind: U.k }; U.crew.push(m); return m; };
  function medics(U, dt) {
    const v = U.v, I = U.I, p = scenePos(FIX ? lateBody(I) : I), W = v.def.wid / 2; if (I.body) I.body.hold();
    const have = !!(I.body && I.body.pos()); if (have) U.hadBody = true; const gone = FIX && !!U.hadBody && !have;      // e3: the body went (the game cleared it) before it was loaded
    const T = (x, y, r) => { if (!FIX) return [x, y]; st.resolve(x, y, r, _o); return [_o.x, _o.y]; };      // e3: a mark inside a wall is moved out of it
    if (U.phase === 0) { if (U.t < 0.9) return false; const a = local(v, v.def.len * 0.2, -(W + 0.6)), b = local(v, -(v.def.len / 2 + 1.5), 0); member(U, 0, a.x, a.y, v.h); const m1 = member(U, 1, b.x, b.y, v.h + Math.PI); m1.cart = true; U.crew[0].nowall = m1.nowall = FIX; U.cart = { x: b.x, y: b.y, h: v.h, load: false, show: true }; U.phase = 1; U.pt = 0; return false; }
    const m0 = U.crew[0], m1 = U.crew[1], cart = U.cart; U.pt += dt;
    const push = (tx, ty, sp) => { const done = walk(m1, tx, ty, sp, dt); cart.h = m1.h; cart.x = m1.x + Math.cos(m1.h) * 1.25; cart.y = m1.y + Math.sin(m1.h) * 1.25; m1.pose = done ? 'idle' : 'push';
      if (FIX) { /* e3: the cot keeps out of walls and posts: its middle is pushed clear, and its nose turns along what it meets */ st.resolve(cart.x, cart.y, 0.75, _o); cart.x = _o.x; cart.y = _o.y; const nx = cart.x + Math.cos(cart.h) * 0.95, ny = cart.y + Math.sin(cart.h) * 0.95; st.resolve(nx, ny, 0.35, _o); if (hyp(_o.x - nx, _o.y - ny) > 0.02) cart.h = Math.atan2(_o.y - cart.y, _o.x - cart.x); }
      return done; };
    if (U.phase === 1) {
      const dx = p.x - m0.x, dy = p.y - m0.y, dl = hyp(dx, dy) || 1, k0 = T(p.x - (dx / dl) * 0.75, p.y - (dy / dl) * 0.75, 0.4), a0 = walk(m0, k0[0], k0[1], 3.4, dt); m0.pose = a0 ? 'kneel' : 'jog'; if (a0) m0.h = Math.atan2(p.y - m0.y, p.x - m0.x);
      const ex = p.x - m1.x, ey = p.y - m1.y, el = hyp(ex, ey) || 1, k1 = T(p.x - (ex / el) * 2.4 + (-ey / el) * 0.9, p.y - (ey / el) * 2.4 + (ex / el) * 0.9, 1.0), a1 = push(k1[0], k1[1], 2.6);
      if (a0 && !U.tend0) { U.tend0 = U.pt; U.rec.tend = +(E.t - I.t0).toFixed(1); }
      if ((a0 && a1 && U.pt - U.tend0 > 6.5) || (a0 && U.pt - U.tend0 > 11) || U.pt > 26 || (gone && a0 && U.pt - U.tend0 > 2.5)) { U.phase = 2; U.pt = 0; }
      return false;
    }
    if (U.phase === 2) { /* onto the stretcher */ m0.pose = 'kneel'; if (U.pt > 0.9) { if (I.body) try { I.body.take(); U.rec.took = have; } catch (e) {} I.body = null; cart.load = !gone; I.taken = true; m0.pose = 'idle'; U.phase = 3; U.pt = 0; } return false; }
    if (U.phase === 3) { const b = local(v, -(v.def.len / 2 + 2.6), 0), a = local(v, -(v.def.len / 2 + 1.2), W + 0.7); const a1 = push(b.x, b.y, 2.7), a0 = walk(m0, a.x, a.y, 2.9, dt); m0.pose = a0 ? 'idle' : 'walk'; if ((a0 && a1) || U.pt > 16) { U.phase = 4; U.pt = 0; } return false; }
    if (U.pt > 1.3) { cart.show = false; return true; } cart.x += Math.cos(v.h) * 1.4 * dt; cart.y += Math.sin(v.h) * 1.4 * dt; cart.h = v.h; cart.lift = sm(U.pt / 1.0); m1.pose = 'idle'; m0.pose = 'idle'; return false;
  }
  function putOut(I, U) {
    const c = I.car, S = fireOf(c); let any = false;
    if (S) { if (S.fire && !S.fire.dead) { S.fire.life = Math.min(S.fire.life, S.fire.t + 3); any = true; } S.burn = 0; if (S.smoke && !S.smoke.dead) { S.smoke.kind = 'steam'; S.smoke.rate = 1; S.smoke.life = Math.min(S.smoke.life, S.smoke.t + 7); } }
    if (c && c.fire) { any = true; try { if (g.cars && g.cars.extinguish) U.exT = 3; /* the flames die down under the water for three seconds, then the cars helper is told it is out */ else if (typeof c.extinguish === 'function') c.extinguish(); else if (typeof c.fire === 'object') { c.fire.out = true; if ('dead' in c.fire) c.fire.dead = true; } } catch (e) {} }
    for (const fn of E.outFns) try { fn(c, I); } catch (e) {}
    try { if (g.events && typeof g.events.emit === 'function') g.events.emit('fire-out', c); } catch (e) {}
    U.rec.out = +(E.t - I.t0).toFixed(1); U.rec.wasBurning = any; say('fire out');
  }
  function firemen(U, dt) {
    const v = U.v, I = U.I, p = scenePos(I), W = v.def.wid / 2, sd = (p.x - v.x) * Math.sin(v.h) - (p.y - v.y) * Math.cos(v.h) > 0 ? 1 : -1;      // the side of the truck the fire is on
    if (U.phase === 0) { if (U.t < 0.9) return false; const a = local(v, v.def.len * 0.25, sd * (W + 0.6)), b = local(v, v.def.len * 0.5 - 2.9, sd * (W + 0.65)); member(U, 0, a.x, a.y, v.h); member(U, 1, b.x, b.y, v.h); U.hose = { on: true, spray: 0 }; U.phase = 1; U.pt = 0; return false; }
    const m0 = U.crew[0], m1 = U.crew[1], pump = local(v, v.def.len * 0.5 - 2.9, sd * (W + 0.1)); U.pt += dt; U.pump = pump; m1.pose = 'idle'; m1.h += wrapPi(Math.atan2(p.y - m1.y, p.x - m1.x) - m1.h) * Math.min(1, dt * 4);
    if (U.phase === 1) { const dx = p.x - pump.x, dy = p.y - pump.y, dl = hyp(dx, dy) || 1, k = Math.max(0.15, 1 - 5.5 / dl), a0 = walk(m0, pump.x + dx * k, pump.y + dy * k, 3.1, dt); m0.pose = a0 ? 'hose' : 'jog';
      if (a0 || U.pt > 12) { m0.h = Math.atan2(p.y - m0.y, p.x - m0.x); U.phase = 2; U.pt = 0; U.rec.water = +(E.t - I.t0).toFixed(1); } return false; }
    if (U.phase === 2) { m0.pose = 'hose'; m0.h += wrapPi(Math.atan2(p.y - m0.y, p.x - m0.x) - m0.h) * Math.min(1, dt * 5); U.hose.spray = Math.min(1, U.hose.spray + dt * 3); U.hose.tx = p.x; U.hose.ty = p.y;
      if (U.pt > 2.6 && !U.outDone) { U.outDone = true; putOut(I, U); } if (U.exT > 0) { U.exT -= dt; if (U.exT <= 0) try { U.rec.extinguish = !!g.cars.extinguish(I.car); } catch (e) {} } if (U.pt > 7.5) { U.phase = 3; U.pt = 0; } return false; }
    if (U.phase === 3) { U.hose.spray = Math.max(0, U.hose.spray - dt * 4); const a = local(v, v.def.len * 0.25, sd * (W + 0.6)), a0 = walk(m0, a.x, a.y, 2.9, dt); m0.pose = a0 ? 'idle' : 'walk'; if (a0 || U.pt > 12) { U.phase = 4; U.pt = 0; U.hose.on = false; } return false; }
    return U.pt > 1.0;
  }
  // traffic does not drive over the people working in the road
  let holdT = 0;
  function holdTraffic() {
    const pts = []; for (const U of E.units) { if (U.state !== 'scene') continue; for (const m of U.crew) if (!m.gone && !st.onSidewalk(m.x, m.y)) pts.push(m); if (U.I.body) { const p = U.I.body.pos(); if (p && !st.onSidewalk(p.x, p.y)) pts.push(p); } }
    if (!pts.length) return;
    for (const c of g.traffic.cars) { const fx = Math.cos(c.h), fy = Math.sin(c.h); for (const p of pts) { const dx = p.x - c.x, dy = p.y - c.y; if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue; const f = dx * fx + dy * fy; if (f < 0 || f > c.def.len / 2 + 5 + c.v * 1.6) continue; if (Math.abs(-dx * fy + dy * fx) > c.def.wid / 2 + 0.9) continue; c.stun = Math.max(c.stun, 0.5); break; } }
  }

  // ---------------------------------------------------------------- the step (the game's fixed step, wrapped)
  const step0 = g.step.bind(g);
  g.step = (dt) => { step0(dt); if (!E.on) return; try { tick(dt); } catch (e) { warn(e); if (warned > 12) E.on = false; } };
  function tick(dt) {
    E.t += dt; pollT -= dt; if (pollT <= 0) { pollT = 0.5; poll(); }
    if (!E.incidents.length && !E.units.length) return;
    for (let i = E.incidents.length - 1; i >= 0; i--) { const I = E.incidents[i];
      if (I.done) { E.incidents.splice(i, 1); continue; } if (I.sent) continue; const age = E.t - I.t0; scenePos(I); if (I.body) I.body.hold();
      if (age > 50 || I.tries > 6 || hyp(I.x - g.player.x, I.y - g.player.y) > 260) { I.done = true; E.stats.dropped++; say('incident dropped'); continue; }
      if (I.over) { I.done = true; E.stats.dropped++; say('incident over: ' + I.over); continue; }
      if (age < C.delay || E.t < I.retryT || wanted() || (I.shot && !quiet())) continue;
      if (I.kind === 'wreck' && I.car && hyp(I.car.vx || 0, I.car.vy || 0) > 3) { I.done = true; E.stats.dropped++; continue; }
      if (dispatch(I)) I.sent = true; else { I.tries++; I.retryT = E.t + 2; } }
    for (let i = E.units.length - 1; i >= 0; i--) stepUnit(E.units[i], dt);
    holdT -= dt; if (holdT <= 0) { holdT = 0.2; holdTraffic(); const W = g.__world && g.__world.drivers; if (W && W.siren) for (const U of E.units) if (U.v.drive && !U.v.drive.settle && U.v.vf > 2 && U.state === 'in') W.siren(U.v.x, U.v.y); }
  }
  E.state = () => ({ t: +E.t.toFixed(1), units: E.units.map((U) => ({ k: U.k, state: U.state, phase: U.phase, t: +U.t.toFixed(1), x: +U.v.x.toFixed(1), y: +U.v.y.toFixed(1), h: +U.v.h.toFixed(2), vf: +U.v.vf.toFixed(1), d: +hyp(U.v.x - g.player.x, U.v.y - g.player.y).toFixed(0), crew: U.crew.map((m) => m.pose), lane: +U.lane.toFixed(1), stuck: U.v.drive ? +(U.v.drive.stuckT || 0).toFixed(1) : 0 })), incidents: E.incidents.map((I) => ({ kind: I.kind, sent: I.sent, age: +(E.t - I.t0).toFixed(1), tries: I.tries })), stats: E.stats, log: E.log, cool: E.cool });

  let V = null;
  if (REAL) { try { V = visuals(g, E, C, { local, scenePos, warn }); } catch (e) { warn(e); V = null; } if (!V) V = { dress() {}, undress() {} }; E.look = () => Object.fromEntries(Object.entries(V.kinds || {}).map(([k, K]) => [k, { tris: K.tris, draws: K.draws, box: K.box }])); }
  return E;
}

// ==================================================================== what is seen and heard (browser only)
function visuals(g, E, C, H) {
  const world = g.world, scene = world.scene, st = g.statics, hyp2 = Math.hypot;
  const grp = new THREE.Group(); grp.name = 'ems'; scene.add(grp);
  const glow = new THREE.Group(); glow.name = 'ems_light'; { const fxg = g.combat && g.combat.fx && g.combat.fx.group; (fxg || scene).add(glow); }
  const _e = new THREE.Euler(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _ax = new THREE.Vector3();
  const disc = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
  const mats = { dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.2 }), solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }) };
  const F = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  // gameplay e2: each unit wears a body of our own over the back of the kit's van: flat panels with a painted picture (one 1024 x 1024 canvas per
  // kind: right side, left side, back), so the markings cannot sink into the kit's body as e1's sheets did. Invented markings: no real service's name, colours or badge.
  function atlas(k) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024; const x = cv.getContext('2d'), amb = k === 'amb';
    const text = (s, px, py, size, colr, maxW, wt = 800) => { x.font = wt + ' ' + size + 'px ' + F; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = colr; x.fillText(s, px, py, maxW); };
    const slats = (px, py, w, h) => { x.fillStyle = '#23262a'; x.fillRect(px - 4, py - 4, w + 8, h + 8); x.fillStyle = '#b4b8be'; x.fillRect(px, py, w, h); x.fillStyle = '#8b9097'; for (let q = py + 7; q < py + h; q += 9) x.fillRect(px, q, w, 2); x.fillStyle = '#2b2e33'; x.fillRect(px + w / 2 - 22, py + h - 16, 44, 6); };
    const chev = (px, py, w, h, c1, c2) => { x.fillStyle = c1; x.fillRect(px, py, w, h); const s = 64; for (const sg of [1, -1]) { x.save(); x.beginPath(); x.rect(sg > 0 ? px + w / 2 : px, py, w / 2, h); x.clip(); x.fillStyle = c2; for (let i = 0; i < 14; i++) { const bx = px + w / 2 + sg * i * s; x.beginPath(); x.moveTo(bx, py + h); x.lineTo(bx + sg * s * 0.5, py + h); x.lineTo(bx + sg * s * 0.5 - sg * h, py); x.lineTo(bx - sg * h, py); x.fill(); } x.restore(); } };
    const side = (oy, right) => { const X = (f) => (right ? 1024 * (1 - f) : 1024 * f), rect = (f0, f1, a, b) => x.fillRect(Math.min(X(f0), X(f1)), oy + a, 1024 * (f1 - f0), b - a);
      if (amb) { x.fillStyle = '#f1f1ed'; x.fillRect(0, oy, 1024, 384); x.fillStyle = '#1d4fa3'; rect(0, 1, 200, 292); x.fillStyle = '#f26a1b'; rect(0, 1, 212, 280);
        text('AMBULANCE', 610, oy + 108, 128, '#1d4fa3', 720); text('PARAMEDIC UNIT 27', 610, oy + 247, 46, '#ffffff', 620, 700); text('27', 930, oy + 338, 64, '#1d4fa3', 120);
        /* the mark: a plain six-armed blue star, nothing in it */ x.save(); x.translate(128, oy + 106); x.fillStyle = '#1d4fa3'; for (let i = 0; i < 3; i++) { x.fillRect(-76, -18, 152, 36); x.rotate(Math.PI / 3); } x.restore(); }
      else { x.fillStyle = '#c9140e'; x.fillRect(0, oy, 1024, 384); x.fillStyle = '#f6cf3a'; rect(0, 1, 0, 9); x.fillStyle = '#f4f2ea'; rect(0.21, 1, 186, 214); x.fillStyle = '#f2c81e'; rect(0.21, 1, 214, 228);
        for (const [f0, f1] of [[0.24, 0.46], [0.5, 0.72], [0.76, 0.975]]) slats(Math.min(X(f0), X(f1)), oy + 246, 1024 * (f1 - f0), 124);
        const zx = right ? 0 : 225; text('FIRE', zx + 290, oy + 100, 150, '#f6cf3a', 400); text('ENGINE 7', zx + 640, oy + 104, 60, '#ffffff', 260);
        /* the pump panel behind the cab: gauges and outlets */ const p0 = Math.min(X(0), X(0.2)), pw = 1024 * 0.2; x.fillStyle = '#2a2d31'; x.fillRect(p0, oy + 60, pw, 324); x.fillStyle = '#c3c7cc'; x.fillRect(p0 + 8, oy + 68, pw - 16, 308);
        for (let i = 0; i < 4; i++) { const cx = p0 + 34 + (i * (pw - 68)) / 3, cy = oy + 110; x.fillStyle = '#1b1d20'; x.beginPath(); x.arc(cx, cy, 21, 0, 7); x.fill(); x.fillStyle = '#f4f4f0'; x.beginPath(); x.arc(cx, cy, 16, 0, 7); x.fill(); x.strokeStyle = '#c02010'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + 9, cy - 9); x.stroke(); }
        for (const [fx, py, r, c] of [[0.3, 205, 34, '#8f1410'], [0.72, 205, 34, '#1d4fa3'], [0.3, 310, 28, '#30343a'], [0.72, 310, 28, '#30343a']]) { const cx = p0 + pw * fx, cy = oy + py; x.fillStyle = '#eceef0'; x.beginPath(); x.arc(cx, cy, r + 8, 0, 7); x.fill(); x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); } } };
    side(0, true); side(384, false); const oy = 768;
    if (amb) { x.fillStyle = '#f1f1ed'; x.fillRect(0, oy, 512, 256); x.fillStyle = '#16191d'; x.fillRect(60, oy + 22, 170, 66); x.fillRect(282, oy + 22, 170, 66); text('AMBULANCE', 256, oy + 113, 46, '#1d4fa3', 400); x.fillStyle = '#1d4fa3'; x.fillRect(0, oy + 134, 512, 60); x.fillStyle = '#f26a1b'; x.fillRect(0, oy + 142, 512, 44); chev(0, oy + 198, 512, 58, '#f1f1ed', '#f26a1b'); x.fillStyle = '#6b7077'; x.fillRect(254, oy, 4, 256); }
    else { chev(0, oy, 512, 256, '#d8170f', '#f2c81e'); slats(150, oy + 30, 212, 116); x.fillStyle = '#c9140e'; x.fillRect(116, oy + 168, 280, 54); text('KEEP BACK', 256, oy + 196, 42, '#ffffff', 250); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  const kinds = {};
  function kind(k, def) {
    if (kinds[k]) return kinds[k]; const amb = k === 'amb', L = def.len, W = def.wid, Hh = def.hgt || (amb ? 2.7 : 3), K = {};
    const mk = () => ({ p: [], n: [], c: [] }), into = (A, c, x, y, z, sx, sy, sz) => { const b = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); b.translate(x, y, z); const p = b.attributes.position, n = b.attributes.normal; for (let i = 0; i < p.count; i++) { A.p.push(p.getX(i), p.getY(i), p.getZ(i)); A.n.push(n.getX(i), n.getY(i), n.getZ(i)); A.c.push(c[0], c[1], c[2]); } b.dispose(); };
    const geoOf = (A) => { const gb = new THREE.BufferGeometry(); gb.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); gb.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3)); gb.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3)); return gb; };
    const S = mk(), box = (c, ...a) => into(S, c, ...a), DARK = [0.03, 0.03, 0.035], STEEL = [0.6, 0.62, 0.65], WHITE = [0.87, 0.87, 0.85], REDB = [0.58, 0.008, 0.005], TAN = [0.5, 0.42, 0.2];
    // the body: a box over the back of the van (the ambulance's module; the engine's rear body), wider and taller than the kit's
    const hw = W / 2 + 0.06, xr = -L / 2 - 0.04, xf = L / 2 - (amb ? 1.75 : 2.4), y0 = amb ? 0.78 : 0.9, y1 = Hh + (amb ? 0.1 : 0.06);
    box(amb ? WHITE : REDB, (xr + xf) / 2, (y0 + y1) / 2, 0, xf - xr, y1 - y0, hw * 2);
    const xb = amb ? xf - 0.24 : L / 2 - 1.5, yb = amb ? y1 : Hh + 0.005, bw = W - 0.3;
    box(DARK, xb, yb + 0.035, 0, 0.36, 0.07, bw); box(STEEL, xr - 0.16, 0.5, 0, 0.32, 0.09, W - 0.1);      // the light bar's foot; the step at the back
    if (amb) box(WHITE, (xr + xf) / 2 - 0.3, y1 + 0.07, 0, 0.9, 0.14, 0.8);
    else { box(STEEL, L / 2 - 0.02, 0.55, 0, 0.4, 0.26, W - 0.06);      /* a bright front bumper; a ladder on its rack; the hose bed */
      const ya = y1 + 0.2, xa = xr + 0.25, xz = xf - 0.25, zl = -(hw - 0.42); for (const s of [1, -1]) box(STEEL, (xa + xz) / 2, ya, zl + s * 0.2, xz - xa, 0.08, 0.05); for (let i = 0; i <= 11; i++) box(STEEL, xa + 0.1 + ((xz - xa - 0.2) * i) / 11, ya, zl, 0.04, 0.04, 0.4); for (const xx of [xa + 0.4, xz - 0.4]) for (const s of [1, -1]) box(DARK, xx, y1 + 0.08, zl + s * 0.2, 0.07, 0.16, 0.07);
      box(TAN, (xr + xf) / 2 - 0.5, y1 + 0.09, hw - 0.6, 2.4, 0.18, 0.8); box(DARK, (xr + xf) / 2 - 0.5, y1 + 0.1, hw - 0.6, 2.44, 0.2, 0.05); }
    K.solid = geoOf(S);
    // lamps: six groups that flash together, one mesh each (e1: fourteen)
    const LG = [mk(), mk(), mk(), mk(), mk(), mk()], lamp = (gi, c, ...a) => into(LG[gi], c, ...a), RED = [1, 0.06, 0.04], WHT = [1, 1, 1], AMB = [1, 0.55, 0.05], n = 3, seg = (bw / 2 - 0.05) / n;
    for (const s of [1, -1]) for (let i = 0; i < n; i++) { const z = s * (0.05 + seg * (i + 0.5)); lamp(s > 0 ? (i === 0 ? 2 : 0) : i === 0 ? 3 : 1, i === 0 ? WHT : RED, xb + 0.1, yb + 0.125, z, 0.14, 0.11, seg - 0.02); lamp(s > 0 ? 0 : 1, i === 0 ? AMB : RED, xb - 0.1, yb + 0.125, z, 0.14, 0.11, seg - 0.02); }
    for (const s of [1, -1]) { lamp(s > 0 ? 4 : 5, amb ? AMB : RED, xr - 0.02, y1 - 0.16, s * (hw - 0.22), 0.05, 0.14, 0.3); lamp(s > 0 ? 0 : 1, RED, xf - 0.3, y1 - 0.14, s * (hw + 0.012), 0.34, 0.12, 0.03); lamp(s > 0 ? 5 : 4, RED, xr + 0.3, y1 - 0.14, s * (hw + 0.012), 0.34, 0.12, 0.03); }
    K.lamps = LG.map(geoOf);
    // the painted panels: right, left, back
    const dp = [], duv = [], di = [], quad = (a, b, c, d, u0, v0, u1, v1) => { const q = dp.length / 3; dp.push(...a, ...b, ...c, ...d); duv.push(u0, v0, u1, v0, u1, v1, u0, v1); di.push(q, q + 1, q + 2, q, q + 2, q + 3); }, zz = hw + 0.008, e = 0.002;
    quad([xr, y0, zz], [xf, y0, zz], [xf, y1, zz], [xr, y1, zz], e, 0.625 + e, 1 - e, 1 - e);
    quad([xf, y0, -zz], [xr, y0, -zz], [xr, y1, -zz], [xf, y1, -zz], e, 0.25 + e, 1 - e, 0.625 - e);
    quad([xr - 0.008, y0, -hw], [xr - 0.008, y0, hw], [xr - 0.008, y1, hw], [xr - 0.008, y1, -hw], e, e, 0.5 - e, 0.25 - e);
    const gd = new THREE.BufferGeometry(); gd.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); gd.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2)); gd.setIndex(di); gd.computeVertexNormals(); K.decal = gd;
    K.mat = new THREE.MeshStandardMaterial({ map: atlas(k), roughness: 0.5, metalness: 0.05 });
    K.tris = S.p.length / 9 + 6 + LG.reduce((a, A) => a + A.p.length / 9, 0); K.draws = 2 + LG.length + 4; K.barY = yb + 0.13; K.xb = xb; K.box = [+(xf - xr).toFixed(2), +(hw * 2).toFixed(2), +y1.toFixed(2)]; return (kinds[k] = K);
  }
  function dress(U) {
    const v = U.v, K = kind(U.k, v.def), D = (U.dress = { g: new THREE.Group(), lamps: [], halos: [], own: [] });
    const m0 = new THREE.Mesh(K.solid, mats.solid); m0.castShadow = true; D.g.add(m0); const m1 = new THREE.Mesh(K.decal, K.mat); m1.receiveShadow = true; D.g.add(m1);
    K.lamps.forEach((geo, gi) => { const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), m = new THREE.Mesh(geo, mat); D.g.add(m); D.own.push(mat); D.lamps.push({ mat, gi }); });
    for (const [gi, c, lx, lz] of [[0, [1.5, 0.08, 0.05], K.xb, 0.5], [1, [1.5, 0.08, 0.05], K.xb, -0.5], [2, [1.2, 1.2, 1.25], K.xb + 0.2, 0]]) { const sm2 = new THREE.SpriteMaterial({ map: disc, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), sp = new THREE.Sprite(sm2); sp.frustumCulled = false; sp.scale.setScalar(1.3); sp.visible = false; glow.add(sp); D.own.push(sm2); D.halos.push({ sp, gi, c, lx, lz }); }
    { const gm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: disc, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); gm.renderOrder = 5; gm.frustumCulled = false; gm.visible = false; gm.scale.setScalar(12); glow.add(gm); D.ground = gm; D.own.push(gm.material, gm.geometry); }
    D.barY = K.barY; grp.add(D.g); D.g.visible = false;
  }
  function undress(U) {
    const D = U.dress; if (!D) return; grp.remove(D.g); for (const h of D.halos) glow.remove(h.sp); glow.remove(D.ground); for (const o of D.own) o.dispose(); U.dress = null; quiet(U, true);
    for (const m of U.crew) freeFig(m); if (U.cartV) { U.cartV.visible = false; cartPool.push(U.cartV); U.cartV = null; } if (U.hoseV) { U.hoseV.g.visible = false; hosePool.push(U.hoseV); U.hoseV = null; }
  }
  function drawCar(U, dt) {
    const v = U.v, D = U.dress; if (!D) return; const vv = v._vv; if (vv && !vv.ems) { vv.ems = 1; vv.dirt = 0; vv.rack = false; vv.livery = -1; }
    _e.set(v.roll || 0, v.h, v.pitch || 0, 'YZX'); D.g.quaternion.setFromEuler(_e); D.g.position.set(v.x, (v.z || 0) + (vv ? vv.ride || 0 : 0) - 0.012, -v.y); D.g.visible = true;
    const on = !U.stolen && !U.dark && U.state !== 'gone', ph = (E.t * 1.6 + U.id * 0.31) % 1, dbl = (a) => { const q = (((ph - a) % 1) + 1) % 1; return q < 0.1 || (q > 0.16 && q < 0.26) ? 1 : 0; }, G = [dbl(0), dbl(0.5), ph > 0.25 && ph < 0.4 && v.drive ? 1 : 0, ph > 0.75 && ph < 0.9 && v.drive ? 1 : 0, ph < 0.5 ? 1 : 0, ph >= 0.5 ? 1 : 0];
    for (const q of D.lamps) q.mat.color.setScalar(on && G[q.gi] ? 6 : 0.14);
    const cs = Math.cos(v.h), sn = Math.sin(v.h); let any = 0;
    for (const h of D.halos) { const lit = on && G[h.gi]; h.sp.visible = !!lit; if (!lit) continue; any = Math.max(any, h.gi === 2 ? 0.4 : 1); h.sp.position.set(v.x + cs * h.lx + sn * h.lz, D.barY + 0.1, -(v.y + sn * h.lx - cs * h.lz)); h.sp.material.color.setRGB(h.c[0], h.c[1], h.c[2]); }
    D.ground.visible = any > 0; if (any) { D.ground.position.set(v.x + cs * 1.2, (st.onSidewalk(v.x, v.y) ? 0.15 : 0) + 0.03, -(v.y + sn * 1.2)); D.ground.material.color.setRGB(0.32 * any, 0.03, 0.02); }
    try { siren(U, dt, on); } catch (e) { quiet(U, true); }
  }
  // ---------------------------------------------------------------- siren: softer and lower than the patrol cars', only while it drives in and for a moment as it leaves
  function quiet(U, now) { const S = U.sir; if (!S) return; U.sir = null; try { const t = S.a.currentTime; S.gain.gain.cancelScheduledValues(t); S.gain.gain.setTargetAtTime(0, t, now ? 0.03 : 0.25); for (const o of S.osc) o.stop(t + (now ? 0.15 : 1.4)); setTimeout(() => { try { S.pan.disconnect(); } catch (e) {} }, 1800); } catch (e) {} }
  function siren(U, dt, on) {
    const s = g.sound, v = U.v; if (!s || !s.on || !s.ac || !s.out || g.capture || s.ac.state !== 'running' || !C.vol) { if (U.sir) quiet(U, true); return; }
    const want = on && !(C.q && U.held > 8) && ((U.state === 'in' && v.drive && !v.drive.settle && !(v.vf < 1 && (v.drive.blockT || 0) > 1.5)) || (U.state === 'out' && v.drive && U.t < 5 && U.why === 'done'));
    if (!want) { if (U.sir) quiet(U, false); return; }
    const cam = world.camera, dx = v.x - cam.position.x, dz = -v.y - cam.position.z, d = hyp2(dx, cam.position.y - 2, dz);
    if (!U.sir) { if (d > 330) return; const a = s.ac, t = a.currentTime, o1 = a.createOscillator(), o2 = a.createOscillator(), mix = a.createGain(), hp = a.createBiquadFilter(), pk = a.createBiquadFilter(), lp = a.createBiquadFilter(), gain = a.createGain(), pan = a.createStereoPanner ? a.createStereoPanner() : a.createGain();
      o1.type = 'triangle'; o2.type = 'sawtooth'; o2.detune.value = 7; mix.gain.value = 0.5; hp.type = 'highpass'; hp.frequency.value = 320; pk.type = 'peaking'; pk.frequency.value = 1100; pk.Q.value = 1.1; pk.gain.value = 6; lp.type = 'lowpass'; lp.frequency.value = 2600; gain.gain.value = 0;
      o1.connect(mix); o2.connect(mix); mix.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect((s.bus && s.bus.sirens) || s.out); o1.start(t); o2.start(t); U.sir = { a, osc: [o1, o2], lp, gain, pan }; U.sirT = 0; U.hid = 0; U.hidT = 0; U.hidK = 0; }
    const S = U.sir, t = S.a.currentTime; U.sirT += dt; let f;
    if (U.k === 'amb') { const p = (U.sirT % 5.2) / 5.2; f = p < 0.55 ? 520 + 520 * sm(p / 0.55) : 1040 - 520 * sm((p - 0.55) / 0.45); } else { const p = (U.sirT % 1.5) / 1.5; f = p < 0.5 ? 470 : 610; }      // the truck: two notes, low
    for (const o of S.osc) o.frequency.setTargetAtTime(f, t, U.k === 'amb' ? 0.02 : 0.05);
    U.hidT -= dt; if (U.hidT <= 0) { U.hidT = 0.25; U.hid = st.raycast(cam.position.x, -cam.position.z, v.x, v.y) < 1 ? 1 : 0; } U.hidK += (U.hid - U.hidK) * Math.min(1, dt * 5);
    let set = 1; try { if (g.settings && g.settings.get) set = +g.settings.get('ems.siren', 1); } catch (e) {} if (!isFinite(set)) set = 1;
    const vol = (0.07 * C.vol * set) / (1 + Math.pow(d / 38, 1.8)) * (1 - 0.5 * U.hidK) * (U.state === 'out' ? 0.6 * Math.max(0, 1 - U.t / 5) : Math.min(1, U.sirT / 0.6));
    S.gain.gain.setTargetAtTime(vol, t, 0.08); S.lp.frequency.setTargetAtTime((2600 - 1500 * U.hidK) / (1 + d / 220), t, 0.1);
    if (S.pan.pan) { const e = cam.matrixWorld.elements; S.pan.pan.setTargetAtTime(clamp((dx * e[0] + dz * e[2]) / Math.max(d, 4), -0.8, 0.8), t, 0.06); }
  }
  // ---------------------------------------------------------------- the crew's figures (the kit's people in our uniforms)
  const figPool = { amb: [], fire: [] }; let figN = 0;
  function makeFig(k) {
    const names = g.kit.pedKinds ? g.kit.pedKinds() : [], name = names[(figN++ * 2 + (k === 'fire' ? 1 : 0)) % Math.max(1, names.length)], p = name && g.kit.person ? g.kit.person(name) : null; if (!p) return null;
    const top = new THREE.Color(k === 'amb' ? 0x2c4d86 : 0x4a4130), low = new THREE.Color(k === 'amb' ? 0x1c2230 : 0x3a3326);
    p.object.traverse((o) => { if (!o.isSkinnedMesh || !o.material) return; const src = o.material, nm = String(src.name || ''); if (!/^(top|pants|shoes)_/.test(nm)) return; const m = src.clone(); m.onBeforeCompile = src.onBeforeCompile; if (src.customProgramCacheKey) m.customProgramCacheKey = src.customProgramCacheKey; m.map = /^shoes/.test(nm) ? src.map : null; m.color.copy(/^top/.test(nm) ? top : /^pants/.test(nm) ? low : new THREE.Color(0x101012)); o.material = m; });
    const B = {}; p.object.traverse((o) => { if (o.isBone) { const m = /_(hips|spine|chest|neck|head|upper_arm_[LR]|forearm_[LR]|hand_[LR]|thigh_[LR]|shin_[LR]|foot_[LR])$/.exec(o.name); if (m && !B[m[1]]) B[m[1]] = o; } });
    if (B.head) { const hat = new THREE.Group(), c = k === 'fire' ? 0xd9b21a : 0x1c2f55; const dome = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 8, 0, 6.3, 0, 1.6), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })); dome.castShadow = true; hat.add(dome);
      if (k === 'fire') { const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.175, 0.016, 14), dome.material); brim.position.y = 0.012; hat.add(brim); } else { const peak = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.1), dome.material); peak.position.set(0, 0.01, 0.13); hat.add(peak); }
      p.hat = hat; p.hatBone = B.head; scene.add(hat); }
    p.B = B; p.k = k; scene.add(p.object); p.object.visible = false; return p;
  }
  function takeFig(m) { let f = figPool[m.kind].pop(); if (!f) f = makeFig(m.kind); if (!f) { m.vis = null; m.noFig = true; return; } f.object.visible = true; if (f.hat) f.hat.visible = true; f.cur = null; m.vis = f; }
  function freeFig(m) { const f = m.vis; if (!f) return; f.object.visible = false; if (f.hat) f.hat.visible = false; if (f.mixer) f.mixer.stopAllAction(); f.cur = null; figPool[m.kind].push(f); m.vis = null; }
  const anim = (f, name) => { if (!f.mixer || f.cur === name || !f.acts[name]) return; if (f.cur && f.acts[f.cur]) f.acts[f.cur].fadeOut(0.18); f.acts[name].reset().fadeIn(0.18).play(); f.cur = name; };
  // turn a bone about an axis of the world
  const rotW = (b, ax, ang) => { if (!b) return; b.getWorldQuaternion(_q); _q2.setFromAxisAngle(ax, ang); _q.premultiply(_q2); b.parent.getWorldQuaternion(_q3).invert(); b.quaternion.copy(_q3.multiply(_q)); b.updateMatrixWorld(true); };
  function drawCrew(U, m, dt) {
    if (m.gone) { if (m.vis) freeFig(m); return; } if (!m.vis && !m.noFig) takeFig(m); const f = m.vis; if (!f) return; const o = f.object, B = f.B;
    const gz = st.onSidewalk(m.x, m.y) ? 0.15 : 0, pose = m.pose, clip = pose === 'jog' ? (f.acts.jog ? 'jog' : 'run') : pose === 'walk' ? (f.acts.walkbrisk ? 'walkbrisk' : 'walk') : pose === 'push' ? (f.acts.carrybox ? 'carrybox' : 'walk') : 'idle';
    anim(f, clip); if (f.mixer) { f.mixer.timeScale = pose === 'jog' ? (clip === 'jog' ? m.sp / 2.9 : m.sp / (f.runSpeed || 5)) : pose === 'walk' || pose === 'push' ? clamp(m.sp / 1.7, 0.6, 1.8) : 1; f.mixer.update(dt); }
    o.position.set(m.x, gz, -m.y); o.rotation.set(0, m.h, 0); m.k = (m.k || 0) + ((pose === 'kneel' ? 1 : 0) - (m.k || 0)) * Math.min(1, dt * 5); m.hk = (m.hk || 0) + ((pose === 'hose' ? 1 : 0) - (m.hk || 0)) * Math.min(1, dt * 5);
    if (m.k > 0.02 || m.hk > 0.02) { o.updateMatrixWorld(true); _ax.set(Math.sin(m.h), 0, Math.cos(m.h)); const k = m.k, hk = m.hk, bob = Math.sin(E.t * 11) * 0.07 * k;
      if (k > 0.02) { rotW(B.spine || B.chest, _ax, -(0.55 + bob) * k); for (const s of ['L', 'R']) { rotW(B['thigh_' + s], _ax, 1.75 * k); rotW(B['shin_' + s], _ax, -2.35 * k); rotW(B['upper_arm_' + s], _ax, (0.75 - bob) * k); rotW(B['forearm_' + s], _ax, 0.25 * k); }
        let low = 1e9; for (const s of ['L', 'R']) { const b = B['foot_' + s]; if (b) low = Math.min(low, b.getWorldPosition(_v).y); } if (low < 1e8) { if (f.foot0 === undefined) f.foot0 = 0.09; o.position.y -= (low - gz - f.foot0) * 1; } }
      if (hk > 0.02) { rotW(B.spine || B.chest, _ax, -0.12 * hk); rotW(B.upper_arm_R, _ax, 0.95 * hk); rotW(B.forearm_R, _ax, 0.55 * hk); rotW(B.upper_arm_L, _ax, 0.6 * hk); rotW(B.forearm_L, _ax, 0.9 * hk); } }
    if (f.hat && f.hatBone) { o.updateMatrixWorld(true); const hb = f.hatBone; hb.getWorldPosition(f.hat.position); hb.getWorldQuaternion(f.hat.quaternion); _v.set(0, 0.105, 0.01).applyQuaternion(f.hat.quaternion); f.hat.position.add(_v); }
    if (pose === 'hose' && B.hand_R) { B.hand_R.getWorldPosition(_v); m.hand = [_v.x, _v.y, _v.z]; } else m.hand = null;
  }
  // ---------------------------------------------------------------- the stretcher
  const cartPool = [], hosePool = [];
  function makeCart() {
    const G = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x8d9197, roughness: 0.4, metalness: 0.6 }), pad = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 }), sheet = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.9 }), blanket = new THREE.MeshStandardMaterial({ color: 0xc9692a, roughness: 0.95 });
    const add = (geo, mat, x, y, z, par = G) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; par.add(m); return m; };
    const bed = new THREE.Group(); G.add(bed); add(new THREE.BoxGeometry(1.95, 0.05, 0.56), steel, 0, 0, 0, bed); add(new THREE.BoxGeometry(1.85, 0.08, 0.5), pad, 0, 0.06, 0, bed); add(new THREE.BoxGeometry(0.5, 0.06, 0.44), sheet, 0.62, 0.12, 0, bed);
    const legs = new THREE.Group(); G.add(legs); for (const sx of [0.7, -0.7]) for (const sz of [0.22, -0.22]) { add(new THREE.BoxGeometry(0.035, 0.74, 0.035), steel, sx, 0.45, sz, legs); const w = add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), pad, sx, 0.06, sz, legs); w.rotation.x = Math.PI / 2; }
    const pat = new THREE.Group(); bed.add(pat); const body = add(new THREE.CapsuleGeometry(0.19, 1.15, 4, 10), blanket, -0.12, 0.25, 0, pat); body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 1.15); add(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb98f72, roughness: 0.7 }), 0.72, 0.26, 0, pat);
    G.userData = { bed, legs, pat }; scene.add(G); return G;
  }
  function drawCart(U) {
    const c = U.cart; if (!c) return; if (!c.show) { if (U.cartV) U.cartV.visible = false; return; } if (!U.cartV) U.cartV = cartPool.pop() || makeCart(); const G = U.cartV, u = G.userData; G.visible = true;
    G.position.set(c.x, st.onSidewalk(c.x, c.y) ? 0.15 : 0, -c.y); G.rotation.set(0, c.h, 0); const lift = c.lift || 0; u.bed.position.y = 0.84 + lift * 0.06; u.legs.scale.y = 1 - lift * 0.85; u.legs.visible = lift < 0.9; u.pat.visible = !!c.load;
  }
  // ---------------------------------------------------------------- hose and water
  function makeHose() {
    const N = 20, geo = new THREE.BufferGeometry(), pos = new Float32Array((N + 1) * 2 * 3), idx = []; for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xb9a36a, side: THREE.DoubleSide })); line.frustumCulled = false;
    const M = 150, pg = new THREE.BufferGeometry(), pp = new Float32Array(M * 3); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); const pts = new THREE.Points(pg, new THREE.PointsMaterial({ map: disc, color: 0xdcebf5, size: 0.3, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false })); pts.frustumCulled = false;
    const G = new THREE.Group(); G.add(line, pts); glow.parent.add(G); const drops = []; for (let i = 0; i < M; i++) drops.push({ t: 9, life: 0 }); return { g: G, line, pts, N, M, drops, acc: 0 };
  }
  function drawHose(U, dt) {
    const hs = U.hose; if (!hs || !hs.on || !U.pump) { if (U.hoseV) U.hoseV.g.visible = false; return; } if (!U.hoseV) U.hoseV = hosePool.pop() || makeHose(); const Hv = U.hoseV, m0 = U.crew[0]; Hv.g.visible = true;
    const a = [U.pump.x, 0.75, -U.pump.y], b = m0.hand || [m0.x + Math.cos(m0.h) * 0.3, 1.0, -(m0.y + Math.sin(m0.h) * 0.3)], P2 = Hv.line.geometry.attributes.position, N = Hv.N, dx = b[0] - a[0], dz = b[2] - a[2], dl = hyp2(dx, dz) || 1, nx = -dz / dl, nz = dx / dl;
    for (let i = 0; i <= N; i++) { const u = i / N, x = a[0] + dx * u + nx * Math.sin(u * 6.3) * Math.min(0.5, dl * 0.06), z = a[2] + dz * u + nz * Math.sin(u * 6.3) * Math.min(0.5, dl * 0.06), gy = (st.onSidewalk(x, -z) ? 0.15 : 0) + 0.035, y = Math.max(gy, a[1] * Math.max(0, 1 - u * 7) + b[1] * Math.max(0, 1 - (1 - u) * 7)); P2.setXYZ(i * 2, x + nx * 0.035, y, z + nz * 0.035); P2.setXYZ(i * 2 + 1, x - nx * 0.035, y, z - nz * 0.035); }
    P2.needsUpdate = true;
    const pp = Hv.pts.geometry.attributes.position, tx = hs.tx ?? m0.x, ty = hs.ty ?? m0.y, ex = tx - b[0], ez = -ty - b[2], el = hyp2(ex, ez) || 1, T = 0.75, vx = ex / T, vz = ez / T, vy = (0.9 - b[1]) / T + 4.9 * T;
    Hv.acc += dt * 190 * hs.spray; let any = false;
    for (let i = 0; i < Hv.M; i++) { const d = Hv.drops[i]; d.t += dt; if (d.t > d.life) { if (Hv.acc >= 1) { Hv.acc -= 1; d.t = 0; d.life = T * (1 + Math.random() * 0.25); d.x = b[0]; d.y = b[1]; d.z = b[2]; const sp = 0.07 * el; d.vx = vx + (Math.random() - 0.5) * sp; d.vy = vy + (Math.random() - 0.5) * 0.8; d.vz = vz + (Math.random() - 0.5) * sp; } else { pp.setXYZ(i, 0, -50, 0); continue; } }
      d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; if (d.y < 0.05) { d.y = 0.05; d.vx *= 0.3; d.vz *= 0.3; d.vy = 0.6; } pp.setXYZ(i, d.x, d.y, d.z); any = true; }
    pp.needsUpdate = true; Hv.pts.visible = any;
    if (hs.spray > 0.5 && g.combat && g.combat.fx && g.combat.fx.emitter && !U.steam && U.outDone) { U.steam = g.combat.fx.emitter({ pos: new THREE.Vector3(tx, 1.0, -ty), kind: 'steam', life: 6, rate: 2 }); }
  }
  // ---------------------------------------------------------------- once a drawn frame
  let last = performance.now(); const render0 = world.render.bind(world);
  world.render = (t, f) => { const now = performance.now(), dt = g.capture ? 1 / 60 : Math.min(0.05, (now - last) / 1000); last = now; if (E.units.length || E.strays.length) { try { frame(g.paused ? 0 : dt); } catch (e) { H.warn(e); } } return render0(t, f); };
  function frame(dt) {
    for (const U of E.units) { drawCar(U, dt); for (const m of U.crew) drawCrew(U, m, dt); drawCart(U); drawHose(U, dt); }
    for (let i = E.strays.length - 1; i >= 0; i--) { const U = E.strays[i]; if (!g.vehicles.includes(U.v)) { undress(U); E.strays.splice(i, 1); continue; } drawCar(U, dt); for (const m of U.crew) { m.gone = true; drawCrew(U, m, dt); } if (U.cart) U.cart.show = false; drawCart(U); if (U.hose) U.hose.on = false; drawHose(U, dt); }
  }
  // the shaders of our few materials are compiled in the background a few seconds after the game is up, not when the first unit comes into view
  if (!g.capture) setTimeout(async () => { try { const sc = new THREE.Scene(); sc.fog = scene.fog; const tmp = []; for (const k of ['amb', 'fire']) { const K = kind(k, g.kit.cars[C.type[k]] || g.kit.cars.van || g.kit.cars.sedan); tmp.push(new THREE.Mesh(K.solid, mats.solid), new THREE.Mesh(K.decal, K.mat), new THREE.Mesh(K.lamps[0], new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))); }
    for (const m of tmp) sc.add(m); const r = world.renderer; if (r.compileAsync) await r.compileAsync(sc, world.camera, scene); else r.compile(sc, world.camera, scene); E.warmed = tmp.length; } catch (e) { E.warmed = 'failed: ' + (e && e.message); } }, 7000);
  return { dress, undress, kinds };
}
