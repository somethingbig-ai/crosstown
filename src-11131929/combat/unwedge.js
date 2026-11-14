// combat/unwedge.js (gameplay lane, stuck helper, Nov 13; public report 20261113215021-1b7ddd "Got stuck here. Cannot proceed forward."):
// that player's car stood nose-on against the invisible wall at the EDGE OF THE MAP (y = -550.5; he was at y -548.3 heading -1.12), on a street the
// picture shows running on for another 480 m. Nothing told him, and W did nothing. This module, all from outside (game.step and hud.draw are wrapped):
//  1. EDGE: a car pressed against the map's edge is told so ("END OF THE MAP") and, once the pedal has been down against it for 0.8 s in all (taps add up), is set on the nearest
//     clear lane pointing back into the city. On foot at the edge: the same line, no move.
//  2. WEDGED: the player's car has had its pedals worked (both W and S tried, or one held for five seconds with no room the other way) and has not
//     left a 0.75 m circle (or, after twice the pedal time, a 1.8 m one, without turning): it is set on the nearest clear spot of a travel lane, facing along the lane. Never with no pedal pressed (a parked car, a
//     stop), never while a traffic car is touching it unless that has lasted longer than any red light (36 s), only to a spot the car can reach
//     without crossing a wall (straight, or round one corner: no way into or through a building), never onto a kerb, a car, a pole or out of the map.
//  3. ON FOOT: when the player has got out and stands on the far side of a wall from his car (the door was against a building) or outside the map,
//     he is put beside the car on the open side.
// ?unwedge=0 off.   ?uwt=3 pedal seconds   ?uwone=5 one-pedal seconds   ?uwedge=0.8 edge seconds   ?uwq=36 seconds against traffic   ?uwr=24 search radius
import { wrapPi } from '../geo.js';

export function install(game) {
  if (game.P.get('unwedge') === '0' || !game.statics || !game.roads) return null;
  const g = game, st = g.statics, R = g.roads, BX = g.bounds.x + 6, BY = g.bounds.y + 6, P = (k, d) => (g.P.has(k) && isFinite(+g.P.get(k)) ? +g.P.get(k) : d);
  const T_BOTH = P('uwt', 3), T_ONE = P('uwone', 5), T_EDGE = P('uwedge', 0.8), T_QUEUE = P('uwq', 36), REACH = P('uwr', 24), MOVE = 0.75, WIDE = 1.8, K3 = [0.3, 0, -0.3];
  const U = (g.unwedge = { freed: 0, edge: 0, foot: 0, tried: 0, last: null, note: '', sub: '', noteT: 0, edgeT: 0 });
  const A = { v: null, x: 0, y: 0, h: 0, age: 0, fw: 0, rv: 0, idle: 0, retry: 0 }, B = { x: 0, y: 0, h: 0, fw: 0, rv: 0 }, _o = {}, _p = {}, cand = [], from = [], relay = [];
  const say = (note, sub = '', t = 3.2) => { U.note = note; U.sub = sub; U.noteT = t; };
  // two car bodies as boxes with m metres of room added round the first: do they overlap?
  const boxHit = (x, y, h, len, wid, o, m) => {
    const ax = Math.cos(h), ay = Math.sin(h), bx = Math.cos(o.h), by = Math.sin(o.h), dx = o.x - x, dy = o.y - y, al = len / 2 + m, aw = wid / 2 + m, bl = o.def.len / 2, bw = o.def.wid / 2;
    if (dx * dx + dy * dy > (al + aw + bl + bw) ** 2) return false;
    const c = Math.abs(ax * bx + ay * by), s = Math.abs(ax * by - ay * bx);
    return !(Math.abs(dx * ax + dy * ay) > al + bl * c + bw * s || Math.abs(-dx * ay + dy * ax) > aw + bl * s + bw * c || Math.abs(dx * bx + dy * by) > bl + al * c + aw * s || Math.abs(-dx * by + dy * bx) > bw + al * s + aw * c);
  };
  // may car v stand at (x, y, h)? Roadway, inside the map, clear of walls, poles, parked cars (statics), of traffic and of the game's other cars
  const clearAt = (v, x, y, h, m = 0.25, road = true) => {
    const L = v.def.len, wd = v.def.wid, r = wd * 0.5, c = Math.cos(h), s = Math.sin(h);
    for (const k of K3) { const cx = x + c * L * k, cy = y + s * L * k; if (Math.abs(cx) > BX - r - 0.3 || Math.abs(cy) > BY - r - 0.3) return false; if (st.resolve(cx, cy, r + m, _o) > 0) return false; if (road && st.onSidewalk(cx, cy)) return false; }
    for (const o of g.traffic.cars) { if (Math.abs(o.x - x) > 16 || Math.abs(o.y - y) > 16) continue; if (boxHit(x, y, h, L, wd, o, m + 0.25)) return false;
      if (road && o.v > 1) { const ox = Math.cos(o.h), oy = Math.sin(o.h), ah = (x - o.x) * ox + (y - o.y) * oy, sd = Math.abs(-(x - o.x) * oy + (y - o.y) * ox); if (ah > 0 && ah < 6 + o.v * 1.2 && sd < 2.2) return false; } }      // not into the path of a car that is driving
    for (const o of g.vehicles) if (o !== v && Math.abs(o.x - x) < 16 && Math.abs(o.y - y) < 16 && boxHit(x, y, h, L, wd, o, m + 0.15)) return false;
    return true;
  };
  const inward = (x, y, h, d = 35) => Math.abs(x + Math.cos(h) * d) < BX - 4 && Math.abs(y + Math.sin(h) * d) < BY - 4;
  // the nearest clear lane spot for v within REACH that the car can reach without crossing a wall; edge: pointing back into the map (either way along the lane)
  const spot = (v, edge) => {
    cand.length = 0;
    for (const e of R.edges) {
      const b = e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
      if (v.x < b[0] - REACH || v.x > b[2] + REACH || v.y < b[1] - REACH || v.y > b[3] + REACH) continue;
      const pr = e.line.project(v.x, v.y); if (pr.d > REACH) continue;
      for (const dir of [1, -1]) { const n = R.laneCount(e, dir), s0 = dir > 0 ? pr.s : e.len - pr.s;
        for (let li = 0; li < n; li++) for (let k = -10; k <= 10; k++) { const s = s0 + k * 1.5; if (s < 3 || s > e.len - 3) continue; R.lanePos(e, dir, li, s, _p);
          const d = Math.hypot(_p.x - v.x, _p.y - v.y); if (d > REACH) continue;
          // facing along the lane; where the lane runs out of the map within 35 m (or at the edge itself), facing back along it instead: never left pointing at the invisible wall
          for (const hh of edge || !inward(_p.x, _p.y, _p.h) ? [_p.h, wrapPi(_p.h + Math.PI)] : [_p.h]) { if (!inward(_p.x, _p.y, hh)) continue;
            cand.push({ x: _p.x, y: _p.y, h: hh, d, score: d + (1 - Math.cos(hh - (edge ? v.h + Math.PI : v.h))) * (edge ? 2 : 4) + (hh !== _p.h ? 3 : 0) }); } } }
    }
    cand.sort((a, b) => a.score - b.score); if (!cand.length) return null;
    // a way to the spot that crosses no wall: straight from one of the car's three body circles, or by one corner (a point the car sees that sees the spot)
    const c = Math.cos(v.h), s = Math.sin(v.h), L = v.def.len; from.length = 0; relay.length = 0;
    for (const k of K3) from.push(v.x + c * L * k, v.y + s * L * k);
    for (let a = 0; a < 16; a++) for (const d of [4, 9, 14]) { const x = v.x + Math.cos(a * 0.3927) * d, y = v.y + Math.sin(a * 0.3927) * d; if (st.raycast(v.x, v.y, x, y) >= 1) relay.push(x, y); else break; }
    const sees = (q) => { for (let i = 0; i < from.length; i += 2) if (st.raycast(from[i], from[i + 1], q.x, q.y) >= 1) return true; for (let i = 0; i < relay.length; i += 2) if (st.raycast(relay[i], relay[i + 1], q.x, q.y) >= 1) return true; return false; };
    let n = 0; for (const q of cand) { if (!clearAt(v, q.x, q.y, q.h)) continue; if (sees(q)) return q; if (++n > 60) break; }
    return null;
  };
  const place = (v, q, why) => {
    const dh = Math.abs(wrapPi(q.h - v.h)); U.last = { why, t: +g.t.toFixed(2), from: [+v.x.toFixed(2), +v.y.toFixed(2), +v.h.toFixed(2)], to: [+q.x.toFixed(2), +q.y.toFixed(2), +q.h.toFixed(2)] };
    v.x = q.x; v.y = q.y; v.h = q.h; v.vx = v.vy = 0; v.vf = v.vs = 0; v.yawV = 0; v.steer = 0; v.slip = 0; g._sSteer = 0; g.player.x = v.x; g.player.y = v.y; g.player.h = v.h;
    g.cam.lookT = 9; if (dh > 1 || q.d > 6) { try { g.cam.yaw = v.h; g.snapCamera(); } catch (e) {} }
    A.v = null; B.v = null; U.edgeT = 0; console.log('[unwedge] ' + why + ': car set at ' + U.last.to.join(', ') + ' from ' + U.last.from.join(', '));
  };
  const touchingTraffic = (v) => { for (const o of g.traffic.cars) if (Math.abs(o.x - v.x) < 12 && Math.abs(o.y - v.y) < 12 && !(o.stun > 30) && boxHit(v.x, v.y, v.h, v.def.len, v.def.wid, o, 0.45)) return true; return false; };
  // 3. the player on foot after getting out: never left behind a wall or outside the map
  const footCheck = (c) => {
    const pl = g.player, ok = (x, y) => Math.abs(x) < BX - 0.4 && Math.abs(y) < BY - 0.4 && st.raycast(c.x, c.y, x, y) >= 1;
    if (ok(pl.x, pl.y)) return; const cs = Math.cos(c.h), sn = Math.sin(c.h), L = c.def.len, w = c.def.wid / 2 + 0.7; let best = null, bd = 1e9;
    for (const sd of [1, -1]) for (const a of [0, 0.25, -0.25, 0.5, -0.5]) { const x = c.x + cs * L * a - sn * w * sd, y = c.y + sn * L * a + cs * w * sd; if (!ok(x, y) || st.resolve(x, y, 0.34, _o) > 0) continue; let hit = false; for (const o of g.traffic.cars) if (Math.hypot(o.x - x, o.y - y) < 1.4) hit = true; if (hit) continue; const d = Math.hypot(x - pl.x, y - pl.y); if (d < bd) { bd = d; best = [x, y]; } }
    for (const a of [1, -1]) { if (best) break; const x = c.x + cs * (L / 2 + 0.7) * a, y = c.y + sn * (L / 2 + 0.7) * a; if (ok(x, y) && st.resolve(x, y, 0.34, _o) === 0) best = [x, y]; }
    if (best) { pl.x = best[0]; pl.y = best[1]; U.foot++; console.log('[unwedge] on foot: put beside the car on its open side'); }
  };
  let car = null;
  const tick = (dt) => {
    const pl = g.player, v = pl.vehicle, I = g.input; if (U.noteT > 0) U.noteT -= dt;
    const off = g.demo || (g.fly && g.fly.on) || (g.heli && (g.heli.piloted || g.heli.busy));
    if (!v) { A.v = null; B.v = null; U.edgeT = 0; if (off) { car = null; return; }
      if (pl.busy) { if (pl.busy.v) car = pl.busy.kind === 'out' ? pl.busy.v : null; return; }
      if (car) { const c = car; car = null; try { footCheck(c); } catch (e) {} }
      if ((BX - Math.abs(pl.x) < 0.45 || BY - Math.abs(pl.y) < 0.45) && Math.hypot(I.mx, I.my) > 0.1 && !(pl.alt > 2)) say('END OF THE MAP', '', 0.6);
      return; }
    car = v; if (off || v.wreck) { A.v = null; B.v = null; return; }
    const fwd = I.throttle > 0.3, rev = I.brake > 0.3, sp = Math.hypot(v.vx, v.vy), c = Math.cos(v.h), s = Math.sin(v.h);
    if (A.v !== v || Math.hypot(v.x - A.x, v.y - A.y) > MOVE || Math.abs(wrapPi(v.h - A.h)) > 0.6) { A.v = v; A.x = v.x; A.y = v.y; A.h = v.h; A.age = 0; A.fw = 0; A.rv = 0; A.idle = 0; A.retry = 0; if (B.v !== v) B.v = null; }
    if (B.v !== v || Math.hypot(v.x - B.x, v.y - B.y) > WIDE || Math.abs(wrapPi(v.h - B.h)) > 0.6) { B.v = v; B.x = v.x; B.y = v.y; B.h = v.h; B.fw = 0; B.rv = 0; }      // the wider watch: shuffling in a pocket under two metres across without getting anywhere or turning
    A.age += dt; if (fwd) { A.fw += dt; B.fw += dt; } if (rev) { A.rv += dt; B.rv += dt; } if (fwd || rev) A.idle = 0; else if ((A.idle += dt) > 8) { A.fw = 0; A.rv = 0; B.fw = 0; B.rv = 0; }
    // 1. the edge of the map
    { const L = v.def.len, r = v.def.wid * 0.5; let ox = 0, oy = 0;      // which way is out of the map, if a body circle is against the wall
      for (const k of K3) { const cx = v.x + c * L * k, cy = v.y + s * L * k; if (BX - Math.abs(cx) < r + 0.15) ox = Math.sign(cx); if (BY - Math.abs(cy) < r + 0.15) oy = Math.sign(cy); }
      const out = c * ox + s * oy, push = (ox || oy) && sp < 1.5 && ((fwd && out > 0.15) || (rev && out < -0.15));
      if (push) { U.edgeT += dt; say('END OF THE MAP', '', 0.8); } else if (!(ox || oy)) U.edgeT = Math.max(0, U.edgeT - dt * 0.5);      /* taps count: the time adds up while the car stays against the edge (the player of the report tapped W a tenth of a second at a time) */
      if (U.edgeT >= T_EDGE) { U.tried++; const q = spot(v, true); if (q) { place(v, q, 'edge of the map'); U.edge++; say('END OF THE MAP', 'Turned you round', 3.2); return; } U.edgeT = Math.max(0, T_EDGE - 1); } }
    // 2. wedged
    if (sp > 1 || A.retry > g.t) return;
    const both = (A.fw >= 0.7 && A.rv >= 0.7 && A.fw + A.rv >= T_BOTH) || (B.fw >= 1.5 && B.rv >= 1.5 && B.fw + B.rv >= T_BOTH * 2); let one = false;
    if (!both && (A.fw >= T_ONE || A.rv >= T_ONE)) { const k = A.fw >= T_ONE ? -1 : 1; one = !clearAt(v, v.x + c * k, v.y + s * k, v.h, -0.1, false); if (!one) A.retry = g.t + 1; }      // one pedal only: is there a metre of room the other way? then it is not wedged
    if (!both && !one) return;
    if (A.age < T_QUEUE && touchingTraffic(v)) { A.retry = g.t + 0.5; return; }      // in a queue: the cars round it will drive on
    U.tried++; const q = spot(v, false); if (!q) { A.retry = g.t + 1.5; return; }
    place(v, q, 'wedged'); U.freed++; say('CAR FREED', '', 2.6);
  };
  const step0 = g.step.bind(g); g.step = function (dt) { step0(dt); if (U.pause) return; try { tick(dt); } catch (e) { if (!U.err) { U.err = String(e && e.stack || e); console.log('[unwedge] ' + U.err); } } };
  try { const H = g.hud; if (H && H.draw && H.text && H.panel) { const d0 = H.draw.bind(H); H.draw = function () { d0(); if (!(U.noteT > 0) || !H.ctx) return; const c = H.ctx, W = H.w / H.k, a = Math.min(1, U.noteT * 3), hh = U.sub ? 66 : 42, y = 176;      /* upper middle, clear of the car, the job card and the timer */
    c.globalAlpha = a; H.panel(W / 2 - 170, y, 340, hh, 6); H.text(U.note, W / 2, y + 28, 18, '#ffb82e', 'center', 700, 3); if (U.sub) H.text(U.sub, W / 2, y + 53, 16, '#fff', 'center', 500); c.globalAlpha = 1; }; } } catch (e) {}
  U.tick = tick; U.spot = spot; U.clearAt = clearAt;
  return U;
}
