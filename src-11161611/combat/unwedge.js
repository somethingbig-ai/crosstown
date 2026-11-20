// combat/unwedge.js (gameplay lane, stuck helper, Nov 13; public report 20261113215021-1b7ddd "Got stuck here. Cannot proceed forward."):
// that player's car stood nose-on against the invisible wall at the EDGE OF THE MAP (y = -550.5; he was at y -548.3 heading -1.12), on a street the
// picture shows running on for another 480 m. Nothing told him, and W did nothing. This module, all from outside (game.step and hud.draw are wrapped):
//  1. EDGE: a car pressed against the map's edge is told so ("END OF THE MAP") and, once the pedal has been down against it for 0.8 s in all (taps add up), is set on the nearest
//     clear lane pointing back into the city. On foot at the edge: the same line, no move.
//  2. WEDGED: the player's car has had its pedals worked (both W and S tried, or one held for five seconds with no room the other way) and has not
//     left a 0.75 m circle (or, after twice the pedal time, a 1.8 m one, without turning): it is set on the nearest clear spot of a travel lane, facing along the lane. Never with no pedal pressed (a parked car, a
//     stop), never while a traffic car is touching it unless that has lasted longer than any red light (36 s), only to a spot the car can reach
//     without crossing a wall (straight, or round one corner: no way into or through a building), never onto a kerb, a car, a pole or out of the map.
//  0. OUTSIDE THE MAP (Nov 14, telemetry 002101d0): a car whose centre is beyond the edge wall is set on the nearest clear lane inside after 0.8 s of any pedal;
//     a player on foot beyond the wall stands just inside it after a second (?uwfoot=1). The edge wall is the only wall the rescue crosses, and only inward.
//  3. ON FOOT: when the player has got out and stands on the far side of a wall from his car (the door was against a building) or outside the map,
//     he is put beside the car on the open side.
// ?unwedge=0 off.   ?uwt=3 pedal seconds   ?uwone=5 one-pedal seconds   ?uwedge=0.8 edge seconds   ?uwq=36 seconds against traffic   ?uwr=24 search radius
// LANES (Nov 16, gameplay stuck/onelane; telemetry 004147df, 00307598, 00487855; ?uwlane=0 = the rescue as it was): (a) a spot on a LANE CENTRE is roadway whatever the sidewalk
//  polygons say (they cover a fifth of all lane points, so every spot was refused: "no clear spot"); (b) when nothing is found within 24 m the search widens to 45 m and then
//  90 m, taking the nearest clear lane spot (as the outside-the-map case always did); (c) a spot facing the lane's own way within 30 m is taken before one facing against it (45 m in a widened search)
//  (a car turned round at the foot of a one-way avenue was left facing up it); (d) never onto a person.
import { wrapPi } from '../geo.js';

export function install(game) {
  if (game.P.get('unwedge') === '0' || !game.statics || !game.roads) return null;
  const g = game, st = g.statics, R = g.roads, BX = g.bounds.x + 6, BY = g.bounds.y + 6, BCX = g.bounds.cx || 0, BCY = g.bounds.cy || 0,     /* tiles lane: the playable box may sit off the origin */ P = (k, d) => (g.P.has(k) && isFinite(+g.P.get(k)) ? +g.P.get(k) : d);
  const T_BOTH = P('uwt', 3), T_ONE = P('uwone', 5), T_EDGE = P('uwedge', 0.8), T_QUEUE = P('uwq', 36), REACH0 = P('uwr', 24), T_FOOT = P('uwfoot', 1), NEAR = P('uwnear', 0.45), MOVE = 0.75, WIDE = 1.8, K3 = [0.3, 0, -0.3], LANE = g.P.get('uwlane') !== '0', _pe = { x: 0, y: 0, h: 0, def: { len: 0.7, wid: 0.7 } };
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
  const clearAt = (v, x, y, h, m = 0.25, road = true, lane = false) => {
    const L = v.def.len, wd = v.def.wid, r = wd * 0.5, c = Math.cos(h), s = Math.sin(h);
    for (const k of K3) { const cx = x + c * L * k, cy = y + s * L * k; if (Math.abs(cx - BCX) > BX - r - 0.3 || Math.abs(cy - BCY) > BY - r - 0.3) return false; if (st.resolve(cx, cy, r + m, _o) > 0) return false; if (road && !lane && st.onSidewalk(cx, cy)) return false; }
    for (const o of g.traffic.cars) { if (Math.abs(o.x - x) > 16 || Math.abs(o.y - y) > 16) continue; if (boxHit(x, y, h, L, wd, o, m + 0.25)) return false;
      if (road && o.v > 1) { const ox = Math.cos(o.h), oy = Math.sin(o.h), ah = (x - o.x) * ox + (y - o.y) * oy, sd = Math.abs(-(x - o.x) * oy + (y - o.y) * ox); if (ah > 0 && ah < 6 + o.v * 1.2 && sd < 2.2) return false; } }      // not into the path of a car that is driving
    for (const o of g.vehicles) if (o !== v && Math.abs(o.x - x) < 16 && Math.abs(o.y - y) < 16 && boxHit(x, y, h, L, wd, o, m + 0.15)) return false;
    if (lane) { const hitP = (a) => { if (a) for (const p of a) { if (p.gone || Math.abs(p.x - x) > 8 || Math.abs(p.y - y) > 8) continue; _pe.x = p.x; _pe.y = p.y; if (boxHit(x, y, h, L, wd, _pe, 0.2)) return true; } return false; };      /* LANES (d): not onto a person */
      try { if (hitP(g.peds && g.peds.list) || hitP(g.crowd && g.crowd.on && g.crowd.sim && g.crowd.sim.agents)) return false; } catch (e) {} }
    return true;
  };
  const inward = (x, y, h, d = 35) => Math.abs(x + Math.cos(h) * d - BCX) < BX - 4 && Math.abs(y + Math.sin(h) * d - BCY) < BY - 4;
  // beyond the map's edge wall (telemetry 002101d0, Nov 14: a player on foot and then in an SUV OUTSIDE the south wall; every lane was across the wall, so no spot was ever found)
  const outside = (x, y, m = 0) => Math.abs(x - BCX) > BX + m || Math.abs(y - BCY) > BY + m, inPt = (x, y, m, o) => { o.x = Math.min(BCX + BX - m, Math.max(BCX - BX + m, x)); o.y = Math.min(BCY + BY - m, Math.max(BCY - BY + m, y)); return o; };
  // the nearest clear lane spot for v within REACH that the car can reach without crossing a wall; edge: pointing back into the map (either way along the lane)
  const spot1 = (v, edge, wide) => {
    cand.length = 0; const out = outside(v.x, v.y), REACH = out ? 90 : wide || REACH0, KN = out ? 40 : wide ? Math.ceil(wide / 1.5) : 10, vx0 = v.x, vy0 = v.y, B0 = out ? inPt(v.x, v.y, 2, {}) : v, bx0 = B0.x, by0 = B0.y;
    for (const e of R.edges) {
      const b = e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
      if (bx0 < b[0] - REACH || bx0 > b[2] + REACH || by0 < b[1] - REACH || by0 > b[3] + REACH) continue;
      const pr = e.line.project(bx0, by0); if (pr.d > REACH) continue;
      for (const dir of [1, -1]) { const n = R.laneCount(e, dir), s0 = dir > 0 ? pr.s : e.len - pr.s;
        for (let li = 0; li < n; li++) for (let k = -KN; k <= KN; k++) { const s = s0 + k * 1.5; if (s < 3 || s > e.len - 3) continue; R.lanePos(e, dir, li, s, _p);
          const d = Math.hypot(_p.x - bx0, _p.y - by0); if (d > REACH) continue;
          // facing along the lane; where the lane runs out of the map within 35 m (or at the edge itself), facing back along it instead: never left pointing at the invisible wall
          for (const hh of edge || !inward(_p.x, _p.y, _p.h) ? [_p.h, wrapPi(_p.h + Math.PI)] : [_p.h]) { if (!inward(_p.x, _p.y, hh)) continue;
            cand.push({ x: _p.x, y: _p.y, h: hh, d, legal: hh === _p.h, score: d + (1 - Math.cos(hh - (edge ? v.h + Math.PI : v.h))) * (edge ? 2 : 4) + (hh !== _p.h ? 3 : 0) }); } } }
    }
    cand.sort((a, b) => a.score - b.score); if (!cand.length) return null;
    // a way to the spot that crosses no wall: straight from one of the car's three body circles, or by one corner (a point the car sees that sees the spot)
    const c = Math.cos(v.h), s = Math.sin(v.h), L = v.def.len; from.length = 0; relay.length = 0;
    if (out) from.push(bx0, by0); else for (const k of K3) from.push(vx0 + c * L * k, vy0 + s * L * k);
    for (let a = 0; a < 16; a++) for (const d of [4, 9, 14]) { const x = bx0 + Math.cos(a * 0.3927) * d, y = by0 + Math.sin(a * 0.3927) * d; if (st.raycast(bx0, by0, x, y) >= 1) relay.push(x, y); else break; }
    const sees = (q) => { for (let i = 0; i < from.length; i += 2) if (st.raycast(from[i], from[i + 1], q.x, q.y) >= 1) return true; for (let i = 0; i < relay.length; i += 2) if (st.raycast(relay[i], relay[i + 1], q.x, q.y) >= 1) return true; return false; };
    let n = 0; if (LANE) { for (const q of cand) { if (!q.legal || q.d > (wide ? 45 : 30) || !clearAt(v, q.x, q.y, q.h, 0.25, true, true)) continue; if (out || wide || sees(q)) return q; if (++n > 60) break; } n = 0; }      /* LANES (c): the lane's own way first */
    for (const q of cand) { if (!clearAt(v, q.x, q.y, q.h, 0.25, true, LANE)) continue; if (out || wide || sees(q)) return q; if (++n > 60) break; }
    return null;
  };
  const spot = (v, edge) => { let q = spot1(v, edge, 0); if (q || !LANE || outside(v.x, v.y)) return q; for (const w of [45, 90]) if (w > REACH0 && (q = spot1(v, edge, w))) { q.wide = w; return q; } return null; };      /* LANES (b) */
  const place = (v, q, why) => {
    const dh = Math.abs(wrapPi(q.h - v.h)); U.last = { why, t: +g.t.toFixed(2), from: [+v.x.toFixed(2), +v.y.toFixed(2), +v.h.toFixed(2)], to: [+q.x.toFixed(2), +q.y.toFixed(2), +q.h.toFixed(2)] };
    v.x = q.x; v.y = q.y; v.h = q.h; v.vx = v.vy = 0; v.vf = v.vs = 0; v.yawV = 0; v.steer = 0; v.slip = 0; g._sSteer = 0; g.player.x = v.x; g.player.y = v.y; g.player.h = v.h;
    g.cam.lookT = 9; if (dh > 1 || q.d > 6) { try { g.cam.yaw = v.h; g.snapCamera(); } catch (e) {} }
    A.v = null; B.v = null; U.edgeT = 0; console.log('[unwedge] ' + why + ': car set at ' + U.last.to.join(', ') + ' from ' + U.last.from.join(', '));
  };
  const touchingTraffic = (v) => { for (const o of g.traffic.cars) if (Math.abs(o.x - v.x) < 12 && Math.abs(o.y - v.y) < 12 && !(o.stun > 30) && boxHit(v.x, v.y, v.h, v.def.len, v.def.wid, o, 0.45)) return true; return false; };
  // 3. the player on foot after getting out: never left behind a wall or outside the map
  const footCheck = (c) => {
    const pl = g.player, ok = (x, y) => Math.abs(x - BCX) < BX - 0.4 && Math.abs(y - BCY) < BY - 0.4 && st.raycast(c.x, c.y, x, y) >= 1;
    if (ok(pl.x, pl.y) || Math.hypot(pl.x - c.x, pl.y - c.y) > 9) return; const cs = Math.cos(c.h), sn = Math.sin(c.h), L = c.def.len, w = c.def.wid / 2 + 0.7; let best = null, bd = 1e9;
    for (const sd of [1, -1]) for (const a of [0, 0.25, -0.25, 0.5, -0.5]) { const x = c.x + cs * L * a - sn * w * sd, y = c.y + sn * L * a + cs * w * sd; if (!ok(x, y) || st.resolve(x, y, 0.34, _o) > 0) continue; let hit = false; for (const o of g.traffic.cars) if (Math.hypot(o.x - x, o.y - y) < 1.4) hit = true; if (hit) continue; const d = Math.hypot(x - pl.x, y - pl.y); if (d < bd) { bd = d; best = [x, y]; } }
    for (const a of [1, -1]) { if (best) break; const x = c.x + cs * (L / 2 + 0.7) * a, y = c.y + sn * (L / 2 + 0.7) * a; if (ok(x, y) && st.resolve(x, y, 0.34, _o) === 0) best = [x, y]; }
    if (best) { pl.x = best[0]; pl.y = best[1]; U.foot++; console.log('[unwedge] on foot: put beside the car on its open side'); }
  };
  // 4. on foot OUTSIDE the edge wall (however he got there): after a second he stands just inside it, at the nearest clear place that has open way to a road
  const footIn = () => {
    const pl = g.player, ix = pl.x - BCX > BX ? -1 : pl.x - BCX < -BX ? 1 : 0, iy = pl.y - BCY > BY ? -1 : pl.y - BCY < -BY ? 1 : 0, q = {};
    for (const inn of [0.9, 1.8, 3.2, 5, 8]) for (const al of [0, 1.5, -1.5, 3, -3, 5, -5, 8, -8, 12, -12, 18, -18, 26, -26, 36, -36, 50, -50]) { inPt(pl.x - iy * al, pl.y + ix * al, inn, q); const x = q.x, y = q.y;
      if (st.resolve(x, y, 0.34, _o) > 0) continue; let hit = false; for (const o of g.traffic.cars) if (Math.abs(o.x - x) < 9 && Math.abs(o.y - y) < 9 && boxHit(x, y, 0, 0.7, 0.7, o, 0.35)) { hit = true; break; } if (!hit) for (const o of g.vehicles) if (Math.abs(o.x - x) < 9 && Math.abs(o.y - y) < 9 && boxHit(x, y, 0, 0.7, 0.7, o, 0.25)) { hit = true; break; } if (!hit) for (const o of g.parked.near(x, y, 8, _pk)) if (boxHit(x, y, 0, 0.7, 0.7, o, 0.2)) { hit = true; break; } if (!hit) for (const o of g.traffic.cars) { if (!(o.v > 1) || Math.abs(o.x - x) > 40 || Math.abs(o.y - y) > 40) continue; const ox = Math.cos(o.h), oy = Math.sin(o.h), ah = (x - o.x) * ox + (y - o.y) * oy, sd = Math.abs(-(x - o.x) * oy + (y - o.y) * ox); if (ah > 0 && ah < 6 + o.v * 1.5 && sd < 1.6) { hit = true; break; } } if (hit) continue;      /* never in or against a car's body, parked cars too, nor in the path of a car that is driving */
      const ne = R.nearestEdge(x, y, 40); if (!ne || outside(ne.x, ne.y, -0.5) || st.raycast(x, y, ne.x, ne.y) < 1) continue;      // not into a building: the road must be in plain sight
      pl.x = x; pl.y = y; U.foot++; U.footIn = (U.footIn || 0) + 1; say('END OF THE MAP', '', 2.2); console.log('[unwedge] on foot outside the map: put back inside at ' + x.toFixed(1) + ', ' + y.toFixed(1)); return true; }
    // no such place near (a stretch of wall with no road within 40 m): the nearest road inside, at a point clear of walls and car bodies
    { const b0 = inPt(pl.x, pl.y, 2, q), bx = b0.x, by = b0.y, far = [];      /* (roads run on beyond the wall: only their points inside it count) */
      for (const e of R.edges) { if (e.line.project(bx, by).d > 250) continue; for (let s = 1; s < e.len; s += 3) { e.line.at(s, _p); const d = Math.hypot(_p.x - bx, _p.y - by); if (d < 250 && !outside(_p.x, _p.y, -1.5)) far.push({ x: _p.x, y: _p.y, d }); } }
      far.sort((a, b) => a.d - b.d); let n = 0; for (const f of far) { if (++n > 80) break; const x = f.x, y = f.y; if (st.resolve(x, y, 0.34, _o) > 0) continue;
        let hit = false; for (const o of g.traffic.cars) if (Math.abs(o.x - x) < 9 && Math.abs(o.y - y) < 9 && boxHit(x, y, 0, 0.7, 0.7, o, 0.35)) { hit = true; break; } if (!hit) for (const o of g.vehicles) if (Math.abs(o.x - x) < 9 && Math.abs(o.y - y) < 9 && boxHit(x, y, 0, 0.7, 0.7, o, 0.25)) { hit = true; break; } if (hit) continue;
        pl.x = x; pl.y = y; U.foot++; U.footIn = (U.footIn || 0) + 1; U.footFar = (U.footFar || 0) + 1; say('END OF THE MAP', '', 2.2); try { g.snapCamera(); } catch (e) {} console.log('[unwedge] on foot outside the map: put on the nearest road inside at ' + x.toFixed(1) + ', ' + y.toFixed(1)); return true; } }
    return false; };
  let car = null, footOut = 0; const _pk = [];
  const tick = (dt) => {
    const pl = g.player, v = pl.vehicle, I = g.input; if (U.noteT > 0) U.noteT -= dt;
    const off = g.demo || (g.fly && g.fly.on) || (g.heli && (g.heli.piloted || g.heli.busy));
    if (!v) { A.v = null; B.v = null; U.edgeT = 0; if (off) { car = null; return; }
      if (pl.busy) { if (pl.busy.v) car = pl.busy.kind === 'out' ? pl.busy.v : null; return; }
      if (car) { const c = car; car = null; try { footCheck(c); } catch (e) {} }
      if (outside(pl.x, pl.y, 0.05) && !(pl.alt > 2) && !(pl.alt < 0)) { if ((footOut += dt) >= T_FOOT) { footOut = footIn() ? 0 : T_FOOT - 1; } return; } footOut = 0;
      if ((BX - Math.abs(pl.x - BCX) < 0.45 || BY - Math.abs(pl.y - BCY) < 0.45) && Math.hypot(I.mx, I.my) > 0.1 && !(pl.alt > 2) && !(pl.alt < 0)) say('END OF THE MAP', '', 0.6);
      return; }
    car = v; if (off || v.wreck || (v._ck && v._ck.pow === 0)) { A.v = null; B.v = null; return; }      /* (dead engine: on fire or wrecked, src/cars: not wedged, never moved; on foot he is looked after by 3 and 4) */
    const fwd = I.throttle > 0.3, rev = I.brake > 0.3, sp = Math.hypot(v.vx, v.vy), c = Math.cos(v.h), s = Math.sin(v.h);
    if (A.v !== v || Math.hypot(v.x - A.x, v.y - A.y) > MOVE || Math.abs(wrapPi(v.h - A.h)) > 0.6) { A.v = v; A.x = v.x; A.y = v.y; A.h = v.h; A.age = 0; A.fw = 0; A.rv = 0; A.idle = 0; A.retry = 0; if (B.v !== v) B.v = null; }
    if (B.v !== v || Math.hypot(v.x - B.x, v.y - B.y) > WIDE || Math.abs(wrapPi(v.h - B.h)) > 0.6) { B.v = v; B.x = v.x; B.y = v.y; B.h = v.h; B.fw = 0; B.rv = 0; }      // the wider watch: shuffling in a pocket under two metres across without getting anywhere or turning
    A.age += dt; if (fwd) { A.fw += dt; B.fw += dt; } if (rev) { A.rv += dt; B.rv += dt; } if (fwd || rev) A.idle = 0; else if ((A.idle += dt) > 8) { A.fw = 0; A.rv = 0; B.fw = 0; B.rv = 0; }
    // 0. the car stands OUTSIDE the edge wall: any pedal counts (it cannot be driven back in: the wall stops it from this side too)
    if (outside(v.x, v.y)) { say('END OF THE MAP', '', 0.8); if (fwd || rev) U.edgeT += dt;
      if (U.edgeT >= T_EDGE) { U.tried++; const q = spot(v, true); if (q) { place(v, q, 'outside the map'); U.edge++; U.outIn = (U.outIn || 0) + 1; say('END OF THE MAP', 'Back on the road', 3.2); } else U.edgeT = Math.max(0, T_EDGE - 1); }
      return; }
    // 1. the edge of the map
    { const L = v.def.len, r = v.def.wid * 0.5; let ox = 0, oy = 0;      // which way is out of the map, if a body circle is against the wall
      for (const k of K3) { const cx = v.x + c * L * k, cy = v.y + s * L * k; if (BX - Math.abs(cx - BCX) < r + NEAR) ox = Math.sign(cx - BCX); if (BY - Math.abs(cy - BCY) < r + NEAR) oy = Math.sign(cy - BCY); }
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
