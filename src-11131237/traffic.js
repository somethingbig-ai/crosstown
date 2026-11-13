// traffic.js: moving traffic on the lane graph, parked cars along the kerbs, pedestrians on the sidewalks.
import * as THREE from 'three';
import { clamp, wrapPi, rng, Polyline, TAU } from './geo.js';
import { PAINTS } from './models.js';

// What is on a Manhattan street: yellow cabs first, then black hire cars and SUVs, white vans, and everyone else.
const TYPE_MIX = ['taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'suv', 'suv', 'suv', 'suv', 'sedan', 'sedan', 'sedan', 'sedan', 'van', 'van', 'taxi', 'suv', 'sedan', 'sedan'];
const TAXI_YELLOW = 0xf2b90c, BLACKS = [0x0d0d0f, 0x1a1c20, 0x202428], WHITES = [0xe9e9e6, 0xeeeeea, 0xd8d9d6];
const tmp = {}, tmp2 = {};
const pick = (a, r) => a[Math.floor(r * a.length) % a.length];
// Room for the player (public report 20261112132507, "got stuck and glitched": a car turned across one-lane W 21st St was boxed in by the queue).
// (gameplay lane, on the motion lane's file.) Traffic held up by one of the player's cars stops this.room metres further back (motion's 3.2), never drives
// into its body, never slips through the queue behind it, backs away when the player's car comes at it, and gives way at SHOVE m/s when leaned on.
const SHOVE = 1.5, LO_MAX = 1.4, REAR = 0.7;

export class Traffic {
  constructor(game) {
    this.g = game; this.cars = []; this.rand = rng(1234); this.target = 90; this.heldT = -1e9; this._pg = 1e9; this._mb = null; this._blk = null; this.room = game.P && game.P.get('unstick') === '0' ? 0 : 3.2; this.spawnT = 0; this.busT = 0; this.near = []; this.nearT = 0;
  }
  pickType() { const r = this.rand(); if (r < 0.035 && this.g.kit.cars.bus) return 'bus'; return TYPE_MIX[Math.floor(this.rand() * TYPE_MIX.length)]; }
  colorFor(type) {
    const r = this.rand(), q = this.rand();
    if (type === 'taxi') return TAXI_YELLOW; if (type === 'bus') return 0xe8eaec;
    if (type === 'van') return r < 0.75 ? pick(WHITES, q) : pick(PAINTS, q);
    if (type === 'suv') return r < 0.62 ? pick(BLACKS, q) : pick(PAINTS, q);
    return r < 0.3 ? pick(BLACKS, q) : pick(PAINTS, q);
  }

  spawn(e, dir, li, s) {
    const R = this.g.roads, type = this.pickType(), def = this.g.kit.cars[type];
    if (type === 'bus' && !e.ave) return null;
    const c = { type, def, e, dir, li, s, v: 0, x: 0, y: 0, h: 0, color: this.colorFor(type), spin: 0, steer: 0, junction: null, stun: 0, wait: 0, ghost: 0, v0: (e.ave ? 11.5 : 8) * (0.85 + this.rand() * 0.3), id: Math.floor(this.rand() * 1e9), honk: 0, lo: 0, lo0: 1, brake: false, held: 0, nx: undefined, plan: null, pass: null, passT: 0, heldByPlayer: 0, yield: false, dead: false, dbl: false, pt: -1e9, rev: 0, backT: 0, backV: 0, backD: 0, jamT: 0, avoid: null, mvT: -1e9, _shF: -1, _shD: 0 };
    R.lanePos(e, dir, li, s, c); c.v = c.v0 * 0.8; this.cars.push(c); return c;
  }
  // fill the streets around a point at start
  populate(px, py) {
    const R = this.g.roads;
    for (const e of R.edges) {
      if (e.s0 === undefined) continue; const mid = e.line.at(e.len / 2, tmp); const d = Math.hypot(mid.x - px, mid.y - py); if (d > 360 || Math.abs(mid.x) > this.g.bounds.x + 150 || Math.abs(mid.y) > this.g.bounds.y + 150) continue;
      for (const dir of [1, -1]) { const n = R.laneCount(e, dir); for (let li = 0; li < n; li++) {
        let s = 12 + this.rand() * 40; while (s < e.len - 14) { if (this.rand() < 0.5 && this.cars.length < this.target * 1.15) { R.lanePos(e, dir, li, s, tmp); if (Math.hypot(tmp.x - px, tmp.y - py) > 35) this.spawn(e, dir, li, s); } s += 22 + this.rand() * 60; }
      } }
    }
  }
  // a new car somewhere out of sight: on a block near the player, behind a building or far enough off not to be seen arriving
  trySpawn(px, py) {
    const g = this.g, R = g.roads;
    this.nearT--; if (this.nearT <= 0) { this.nearT = 8; this.near.length = 0; for (const e of R.edges) { if (e.s0 === undefined) continue; e.line.at(e.len / 2, tmp); const d = Math.hypot(tmp.x - px, tmp.y - py); if (d < 420 + e.len / 2) this.near.push(e); } }
    if (!this.near.length) return;
    for (let k = 0; k < 8; k++) {
      const e = this.near[Math.floor(this.rand() * this.near.length)];
      const dir = e.oneway ? 1 : (this.rand() < 0.5 ? 1 : -1), n = R.laneCount(e, dir); if (!n) continue;
      const li = Math.floor(this.rand() * n), s = 10 + this.rand() * Math.max(1, e.len - 24);
      R.lanePos(e, dir, li, s, tmp); const dx = tmp.x - px, dy = tmp.y - py, d = Math.hypot(dx, dy);
      if (d < 150 || d > 380) continue;
      if (Math.abs(tmp.x) > g.bounds.x - 5 || Math.abs(tmp.y) > g.bounds.y - 5) continue;
      if (d < 300 && g.statics.raycast(px, py, tmp.x, tmp.y) >= 1) continue;      // in plain view down the street
      let ok = true; for (const c of this.cars) if (Math.hypot(c.x - tmp.x, c.y - tmp.y) < 14) { ok = false; break; }
      if (ok) { this.spawn(e, dir, li, s); return; }
    }
  }

  chooseNext(c) {
    const R = this.g.roads, node = R.endNode(c.e, c.dir), ex = R.exits(node, c.e);
    if (!ex.length) return null;
    const hin = R.lanePos(c.e, c.dir, c.li, c.e.len, tmp).h; let tot = 0; const w = [];
    // turns are made from the lane on that side (left turns from the left lane, right turns from the right); the lanes between go straight
    const nl = R.laneCount(c.e, c.dir);
    for (const x of ex) { const ho = R.lanePos(x.e, x.dir, 0, 0, tmp2).h; const sgn = wrapPi(ho - hin), turn = Math.abs(sgn); let k = turn < 0.5 ? 7 : turn < 2.2 ? 2 : 0.05; if (c.type === 'bus' && turn > 0.5) k *= 0.15;
      if (nl > 1 && turn >= 0.5 && ((sgn > 0 && c.li !== 0) || (sgn < 0 && c.li !== nl - 1))) k *= 0.002; w.push(k); tot += k; }
    let r = this.rand() * tot, pick = ex[0]; for (let i = 0; i < ex.length; i++) { r -= w[i]; if (r <= 0) { pick = ex[i]; break; } }
    const n = R.laneCount(pick.e, pick.dir); const ho = R.lanePos(pick.e, pick.dir, 0, 0, tmp2).h; const turn = wrapPi(ho - hin);
    let li = Math.min(n - 1, c.li); if (turn > 0.5) li = 0; else if (turn < -0.5) li = n - 1; else li = clamp(Math.round((c.li / Math.max(1, R.laneCount(c.e, c.dir) - 1 || 1)) * (n - 1)), 0, n - 1);
    return { e: pick.e, dir: pick.dir, li };
  }
  // the way a car will cross the junction at the end of its block (decided before it gets there, so others can read its intent)
  planFor(c) {
    const R = this.g.roads, L = c.e.len, node = R.endNode(c.e, c.dir), nd = R.nodes[node], rEnd = nd.e.length >= 3 ? nd.r : 0.5;
    if (c.nx === undefined) { c.nx = this.chooseNext(c); for (let k = 0; k < 6 && c.avoid && c.nx && c.nx.e === c.avoid; k++) c.nx = this.chooseNext(c); }     // (a car told to avoid a block draws again while the draw is that block)
    const nx = c.nx; if (!nx) return null;
    const p0 = R.lanePos(c.e, c.dir, c.li, L - rEnd, {}), nn = R.nodes[R.startNode(nx.e, nx.dir)], s1 = Math.min(nx.e.len * 0.5, nn.e.length >= 3 ? nn.r : 0.5), p1 = R.lanePos(nx.e, nx.dir, nx.li, s1, {});
    // control point: where the two headings meet, or the midpoint when (nearly) straight
    const d0x = Math.cos(p0.h), d0y = Math.sin(p0.h), d1x = Math.cos(p1.h), d1y = Math.sin(p1.h), den = d0x * d1y - d0y * d1x;
    let cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
    if (Math.abs(den) > 0.2) { const tt = ((p1.x - p0.x) * d1y - (p1.y - p0.y) * d1x) / den; if (tt > 0 && tt < 60) { cx = p0.x + d0x * tt; cy = p0.y + d0y * tt; } }
    const len = Math.max(1, Math.hypot(cx - p0.x, cy - p0.y) + Math.hypot(p1.x - cx, p1.y - cy)) * 0.93;
    const pts = []; for (let q = 0; q <= 6; q++) { const u = q / 6, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; pts.push(a * p0.x + b * cx + d * p1.x, a * p0.y + b * cy + d * p1.y); }
    return { node, e: c.e, li: c.li, p0x: p0.x, p0y: p0.y, cx, cy, p1x: p1.x, p1y: p1.y, len, next: nx, s1, sEnt: L - rEnd, vmax: Math.abs(den) > 0.2 ? 5.2 : 11, cls: Math.abs(den) <= 0.2 ? 0 : den < 0 ? 1 : 2, pts, big: nd.e.length >= 3 };
  }
  // must this car hold at the edge of the junction? Yes if its way across meets the way of a car already in the box, or of one about to
  // enter with more right to go (straight before right turn before left turn).
  mustYield(c) {
    const R = this.g.roads, P = c.plan, t = this.g.t;
    for (const o of this.cars) {
      if (o === c || !o.plan || o.plan.node !== P.node) continue; const Q = o.plan;
      if (Q.e === P.e && Q.next.e === P.next.e) {                               // same movement: following, unless two lanes fold into one
        if (Q.li !== P.li && Q.next.li === P.next.li && (o.junction ? o.junction.u < 0.6 : Math.abs(o.s - c.s) < 7 && (o.s > c.s || (o.s === c.s && o.id < c.id)))) return true;
        continue;
      }
      if (o.junction) { if (o.junction.u > 0.85) continue; }
      else {
        if (Q.e === P.e) continue;
        const dEnt = Q.sEnt - o.s; if (o.v < 1.5 || dEnt > o.v * 3.2 + 4) continue;
        if (R.signal(Q.node, o.e, t) !== 'g' && o.s + o.def.len / 2 < R.stopS(o.e, o.dir)) continue;   // it will stop for its light
        if (Q.cls > P.cls || (Q.cls === P.cls && o.id > c.id)) continue;
      }
      let hit = false; const A = P.pts, B = Q.pts;
      for (let i = 0; i < A.length && !hit; i += 2) for (let j = 0; j < B.length; j += 2) if ((A[i] - B[j]) ** 2 + (A[i + 1] - B[j + 1]) ** 2 < 6.3) { hit = true; break; }
      if (hit) return true;
    }
    return false;
  }

  // is something in the way within `look` metres along the car's nose?
  // the player on foot cannot walk through a moving or waiting car: he is put back outside its body, on the nearer side
  pushPlayer(pl) { for (const c of this.cars) { const dx = pl.x - c.x, dy = pl.y - c.y; if (Math.abs(dx) > 6 || Math.abs(dy) > 6) continue; const fx = Math.cos(c.h), fy = Math.sin(c.h), f = dx * fx + dy * fy, sd = -dx * fy + dy * fx, hl = c.def.len / 2 + 0.3, hw = c.def.wid / 2 + 0.3;
      if (Math.abs(f) < hl && Math.abs(sd) < hw) { const pf = hl - Math.abs(f), ps = hw - Math.abs(sd); if (ps < pf) { const k = Math.sign(sd || 1) * ps; pl.x += -fy * k; pl.y += fx * k; } else { const k = Math.sign(f || 1) * pf; pl.x += fx * k; pl.y += fy * k; } } } }
  gapAhead(c, look) {
    const fx = Math.cos(c.h), fy = Math.sin(c.h); let gap = look; const half = c.def.len / 2; this._blk = null;
    const test = (ox, oy, rad, who) => {
      const dx = ox - c.x, dy = oy - c.y, f = dx * fx + dy * fy; if (f < 0.5 || f > look + rad + half) return;
      const s = Math.abs(-dx * fy + dy * fx); if (s > 1.25 + rad * 0.6) return; const gp = f - half - rad; if (gp < gap) { gap = gp; this._blk = who; }
    };
    for (const o of this.cars) { if (o === c || o === c.pass) continue; if (Math.abs(o.x - c.x) > look + 12 || Math.abs(o.y - c.y) > look + 12) continue; const r = o.def.len * 0.42; test(o.x, o.y, r, o);
      if (o.def.len > 7) { const ox = Math.cos(o.h) * 3.6, oy = Math.sin(o.h) * 3.6; test(o.x + ox, o.y + oy, 1.6, o); test(o.x - ox, o.y - oy, 1.6, o); } }
    // the player's cars: their whole body, from any angle, with room left (gapMine)
    { const m = this.gapMine(c, look); if (m < gap) { gap = m; this._blk = this._mb; } }
    // the player on foot is in the way like anyone else (public feedback Nov 11: "cars can't run me over, i phase right through them")
    { const pl = this.g.player; if (pl && !pl.vehicle) test(pl.x, pl.y, 0.5, pl); }
    // turning through a junction the nose points away from where the car is going: look along the arc for the player's cars
    if (c.junction) { const j = c.junction; for (const v of this.g.vehicles) { if (v === c.pass || Math.abs(v.x - c.x) > 16 || Math.abs(v.y - c.y) > 16) continue;
      for (let k = 1; k <= 5; k++) { const u = j.u + (k * 2.2) / j.len; if (u > 1.15) break; const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u, qx = a * j.p0x + b * j.cx + d * j.p1x, qy = a * j.p0y + b * j.cy + d * j.p1y;
        let hit = false; for (const o of [0.3, 0, -0.3]) if (Math.hypot(qx - v.x - Math.cos(v.h) * v.def.len * o, qy - v.y - Math.sin(v.h) * v.def.len * o) < (v.def.wid + c.def.wid) / 2 + 0.45) hit = true;
        if (hit) { const gp = k * 2.2 - half * 0.6 - this.roomFor(v); if (gp < gap) { gap = Math.max(0, gp); this._blk = v; } break; } } } }
    const p = this.g.player; if (!p.vehicle) test(p.x, p.y, 0.5, p);
    for (const q of this.g.peds.list) if (q.onRoad) test(q.x, q.y, 0.4, q);
    return gap;
  }
  // The player's cars in this car's way. Each is a row of circles down its length (so a car standing ACROSS the lane is seen for what it is: the
  // old test was one circle at its middle and missed a nose or a tail in the lane), swept along this car's nose. Sets _pg to the bare distance
  // from this car's bumper to the nearest of them (1e9: none) and _mb to that car; returns the gap to drive by: that distance less the room
  // a standing car is given. A car being passed (c.pass) gives no gap but still counts for _pg. Cost: the player's cars only (a handful).
  gapMine(c, look) {
    const g = this.g, fx = Math.cos(c.h), fy = Math.sin(c.h), half = c.def.len / 2, hw = c.def.wid / 2; let gap = look; this._pg = 1e9; this._mb = null;
    for (const v of g.vehicles) {
      const dx0 = v.x - c.x, dy0 = v.y - c.y, reach = look + half + v.def.len; if (Math.abs(dx0) > reach || Math.abs(dy0) > reach) continue;
      const r = v.def.wid / 2, vl = Math.max(0, v.def.len / 2 - r), n = vl > 1.9 * r ? 5 : 3, ux = Math.cos(v.h), uy = Math.sin(v.h), room = c.junction ? 0 : this.roomFor(v);
      for (let i = 0; i < n; i++) {
        const o = vl * (2 * i / (n - 1) - 1), dx = dx0 + ux * o, dy = dy0 + uy * o, f = dx * fx + dy * fy; if (f <= 0) continue;
        const clear = Math.abs(-dx * fy + dy * fx) - hw; if (clear >= r + 0.3 || (clear >= r && f < half + 0.2)) continue;     // beside the path, or beside the car itself
        const gp = f - half - (clear < r ? Math.sqrt(r * r - Math.max(0, clear) ** 2) : 0);
        if (c.junction && gp > 1.5) continue;     // turning: the nose points away from the way across; the arc is looked along in gapAhead
        if (gp < this._pg) this._pg = gp;
        if (v !== c.pass && gp - room < gap) { gap = gp - room; this._mb = v; }
      }
    }
    return gap;
  }
  // how much further back traffic stops behind one of the player's cars: a car length in all when it stands still, the usual gap when it is driving
  roomFor(v) { return this.g.demo ? 0 : this.room * clamp(1.25 - Math.hypot(v.vx, v.vy) / 4, 0, 1); }
  // A stopped car backs away: from the player's car coming at its nose, from the player's car standing across the street close in front of
  // it (room to turn), or because the car in front of it is backing into it (backT, passed down the queue). Only as far as there is room
  // behind. Returns true when it moved back this step.
  backOff(c, dt, pg) {
    const g = this.g, pv = g.demo ? null : g.player.vehicle; let want = 0;
    if (c.backT > 0) { c.backT -= dt; want = c.backV || 1; }
    if (c.dbl || c.stun > 5 || !this.room) return false;
    const fx = Math.cos(c.h), fy = Math.sin(c.h), half = c.def.len / 2;
    if (pv && Math.abs(c.x - pv.x) < 12 && Math.abs(c.y - pv.y) < 12) {
      const r = pv.def.wid / 2, cr = c.def.wid / 2, pl = Math.max(0, pv.def.len / 2 - r), cl = Math.max(0, half - cr), ux = Math.cos(pv.h), uy = Math.sin(pv.h); let best = 1e9, bx = 0, by = 0;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const dx = c.x + fx * cl * j - pv.x - ux * pl * i, dy = c.y + fy * cl * j - pv.y - uy * pl * i, dd = Math.hypot(dx, dy), d = dd - r - cr; if (d < best) { best = d; bx = dx / (dd || 1); by = dy / (dd || 1); } }
      if (best < 6 && -(bx * fx + by * fy) > 0.3) {     // the player's car is in front of this one
        const closing = pv.vx * bx + pv.vy * by;
        if (closing > 0.3 && closing < 6 && best < 1.0 + closing * 1.3) want = Math.max(want, Math.min(3.2, closing + 0.5));     // (a car coming faster than 6 m/s is a crash, not a manoeuvre)
        else if (pg < 2.4 && Math.hypot(pv.vx, pv.vy) < 2.5 && Math.abs(Math.sin(pv.h - c.h)) > 0.35) want = Math.max(want, 1.1);
      }
    }
    if (want <= 0 || c.backD > 8) return false;
    let rear = 1e9, fol = null;
    for (const o of this.cars) { if (o === c) continue; const dx = o.x - c.x, dy = o.y - c.y; if (Math.abs(dx) > 16 || Math.abs(dy) > 16) continue; const f = dx * fx + dy * fy; if (f > -0.5) continue;
      const rad = o.def.len * 0.42; if (Math.abs(-dx * fy + dy * fx) > 1.25 + rad * 0.6) continue; const gp = -f - half - rad; if (gp < rear) { rear = gp; fol = o; } }
    for (const v of g.vehicles) { if (v === pv) continue; const dx = v.x - c.x, dy = v.y - c.y; if (Math.abs(dx) > 16 || Math.abs(dy) > 16) continue; const f = dx * fx + dy * fy; if (f > -0.5) continue;
      const rad = v.def.len * 0.5; if (Math.abs(-dx * fy + dy * fx) > 1.25 + rad * 0.6) continue; const gp = -f - half - rad; if (gp < rear) { rear = gp; fol = null; } }
    if (fol && rear < REAR + 0.6 && fol.v < 0.5) { fol.backT = 0.3; fol.backV = want; }     // the car behind is asked to back up too
    if (rear < REAR + 0.01) return false;
    let d = Math.min(want * dt, rear - REAR);
    if (c.junction) { const j = c.junction; if (j.u <= 0.02) return false; d = Math.min(d, j.u * j.len); j.u -= d / j.len; }
    else { if (c.s - d < 2) return false; c.s -= d; }
    c.x -= fx * d; c.y -= fy * d; c.rev = d / dt; c.backD += d; c.spin -= d / c.def.radius; return true;
  }
  // The player's car leaning on a traffic car at walking pace (game.collideCars): the car gives way along its lane and up to LO_MAX metres
  // sideways (it eases back to its lane as it drives on), as far as it is free to: not into a parked car, a pole or a wall, not into another
  // car (the next car is pushed along too, two deep), not across a stop line into a junction. Returns the metres it gave along (ux, uy).
  shove(c, ux, uy, dist, cap, depth = 0) {
    const g = this.g; if (c.dbl || !(dist > 0) || !this.room) return 0;
    if (c._shF !== g.frame) { c._shF = g.frame; c._shD = 0; } dist = Math.min(dist, cap - c._shD); if (dist < 1e-5) return 0;
    const fx = Math.cos(c.h), fy = Math.sin(c.h), L = c.def.len, rad = c.def.wid / 2 - 0.08, j = c.junction, pv = g.player.vehicle;
    const sl = ux * fy - uy * fx; let al = (ux * fx + uy * fy) * dist, lat = j || Math.abs(sl) < 0.5 ? 0 : sl * dist;     // forward, rightward (a push within 30 degrees of the car's own line moves it along the lane only: nose to tail it would slide off sideways)
    if (j) al = clamp(j.u + al / j.len, 0.01, 0.995) * j.len - j.u * j.len;
    else { const top = (c.plan ? c.plan.sEnt : c.e.len - 13) - 0.1; al = al > 0 ? Math.max(0, Math.min(al, top - c.s)) : -Math.max(0, Math.min(-al, c.s - 2)); const lm = Math.max(LO_MAX, Math.abs(c.lo)); lat = clamp(c.lo + lat, -lm, lm) - c.lo; }
    const ce = Math.max(L * 0.28, L / 2 - c.def.wid / 2), depthAt = (x, y, o) => { let m = 0; const oe = Math.max(o.def.len * 0.28, o.def.len / 2 - o.def.wid / 2), R = rad + o.def.wid / 2; for (const a of [1, 0, -1]) for (const b of [1, 0, -1]) { const d = R - Math.hypot(x + fx * ce * a - o.x - Math.cos(o.h) * oe * b, y + fy * ce * a - o.y - Math.sin(o.h) * oe * b); if (d > m) m = d; } return m; };
    const wall = (x, y) => { let m = 0; for (const a of [1, 0, -1]) { const px = x + fx * ce * a, py = y + fy * ce * a; if (g.statics.resolve(px, py, rad, tmp)) m = Math.max(m, Math.hypot(tmp.x - px, tmp.y - py)); } return m; };
    const free = (a, l) => {
      const nx = c.x + fx * a + fy * l, ny = c.y + fy * a - fx * l;
      if (wall(nx, ny) > wall(c.x, c.y) + 1e-3) return false;
      for (const v of g.vehicles) { if (v === pv || Math.abs(v.x - c.x) > 12 || Math.abs(v.y - c.y) > 12) continue; const d1 = depthAt(nx, ny, v); if (d1 > 0.02 && d1 > depthAt(c.x, c.y, v) + 1e-3) return false; }
      for (const o of this.cars) { if (o === c || Math.abs(o.x - c.x) > 12 || Math.abs(o.y - c.y) > 12) continue; const d1 = depthAt(nx, ny, o); if (d1 > 0.02 && d1 > depthAt(c.x, c.y, o) + 1e-3) {
        if (depth >= 2 || this.shove(o, ux, uy, dist, cap, depth + 1) < dist * 0.98) return false; } }
      return true;
    };
    if (!free(al, lat)) { if (Math.abs(al) > 1e-6 && lat && free(al, 0)) lat = 0; else if (Math.abs(lat) > 1e-6 && al && free(0, lat)) al = 0; else return 0; }
    if (Math.abs(al) < 1e-7 && Math.abs(lat) < 1e-7) return 0;
    const mx = fx * al + fy * lat, my = fy * al - fx * lat;
    if (j) j.u += al / j.len; else { c.s += al; if (lat) { if (Math.abs(c.lo) < 0.02) c.lo0 = 30; c.lo += lat; if (Math.abs(c.lo) < 0.021) c.lo = Math.sign(lat) * 0.021; } }     // (the step zeroes an offset under 2 cm)
    c.x += mx; c.y += my; c.spin += al / c.def.radius; c._shD += dist; c.rev = al < 0 ? -al * 60 : 0;
    return mx * ux + my * uy;
  }
  // room to move over into lane `li` beside where the car is now?
  laneFree(c, li) {
    for (const o of this.cars) { if (o === c || o.junction || o.e !== c.e || o.dir !== c.dir || o.li !== li) continue; const ds = o.s - c.s; if (ds > -(8 + o.v * 2) && ds < 9) return false; }
    const p = this.g.roads.lanePos(c.e, c.dir, li, c.s, tmp); for (const v of this.g.vehicles) if (Math.hypot(v.x - p.x, v.y - p.y) < 8) return false;
    return true;
  }

  step(dt, t) {
    const g = this.g, R = g.roads, px = g.focus.x, py = g.focus.y, pv = g.demo ? null : g.player.vehicle;
    this.spawnT -= dt; if (this.spawnT <= 0 && this.cars.length < this.target) { this.spawnT = 0.25; this.trySpawn(px, py); }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - px, c.y - py) > 420 || c.dead) { this.cars.splice(i, 1); continue; }
      if (c.stun > 0) { c.stun -= dt; c.v = Math.max(0, c.v - 12 * dt); }
      let limit = c.v0; const look = 8 + c.v * 2.2, v0 = c.v;
      // a car slipping through a jam (ghost) still stops for the player's cars: it used to drive through the car in front of it AND into the player's car
      let gap, blk; if (c.ghost > 0) { gap = this.gapMine(c, look); blk = this._mb; if (!blk) gap = 1e9; } else { gap = this.gapAhead(c, look); blk = this._blk; } const pg = this._pg;
      // held up by one of the player's cars or by the player, or by a car that is (the queue behind): c.pt is when the car at the head of the queue last
      // saw the player's car in its way, handed back from car to car, so a ring of cars with no such head forgets it within 1.5 s
      // (the queue is the cars behind it on the same block, and a car in the junction waiting to get onto that block: cross traffic is not part of it)
      c.pt = c.v < 0.5 && blk ? (blk === g.player || (blk.def && blk.e === undefined) ? t : blk.pt !== undefined && t - blk.pt < 1.5 && !blk.junction && (c.junction ? c.junction.next.e === blk.e : blk.e === c.e && blk.dir === c.dir) ? blk.pt : -1e9) : -1e9; let heldP = t - c.pt < 1.5;
      if (heldP && c.pt === t) this.heldT = t;
      // a parked car the player shoved into the lane and then left there (motion's unstick: o.loosed = its kerb place) held the queue behind it for
      // good: unstick puts such cars back only from collideCars, which runs only while the player drives, and only 110 m away. A car that has waited
      // 4 s behind one, with the player's own car not near, eases it back to its place at walking pace
      if (blk && blk.loosed && c.held > 4 && c.v < 0.3 && blk !== g.player.vehicle && !(pv && Math.abs(pv.x - blk.x) < 15 && Math.abs(pv.y - blk.y) < 15)) { const sl = blk.loosed, dx = sl.x - blk.x, dy = sl.y - blk.y, d = Math.hypot(dx, dy), m = Math.min(d, 1.2 * dt);
        if (d > 1e-3) { blk.x += dx / d * m; blk.y += dy / d * m; } blk.h = wrapPi(blk.h + wrapPi(sl.h - blk.h) * Math.min(1, dt * 1.5)); blk.vx = blk.vy = 0; blk.vf = 0; blk.yawV = 0; }
      if (c.ghost > 0) c.ghost -= dt;
      if (c.passT > 0) { c.passT -= dt; if (c.passT <= 0) c.pass = null; }
      let atLight = false;
      if (!c.junction) {
        // the stop line
        const L = c.e.len, node = R.endNode(c.e, c.dir), nd = R.nodes[node], stopS = R.stopS(c.e, c.dir);
        const sig = R.signal(node, c.e, t), dStop = stopS - c.s - c.def.len / 2;
        if (R.stops(c.e, c.dir) && (sig === 'r' || (sig === 'y' && dStop > c.v * 1.2)) && dStop > -1.5) { gap = Math.min(gap, Math.max(0, dStop)); atLight = true; }
        if (L - c.s < 25 && nd.e.length >= 3) limit = Math.min(limit, 8.5);
        // the junction itself: know the way across early, and hold at its edge for anyone with the right of way
        if (!c.plan && L - c.s < 45) { c.plan = this.planFor(c); if (!c.plan && L - c.s < 1) { c.dead = true; continue; } }
        // Don't block the box: while the player's car holds up a block, a car does not drive into the junction toward that block unless there is room
        // for it beyond (it waits at its line; after 3 s it takes another way if the junction has one). Without this the queue backed up through the
        // junction, the cross street stood still behind it and the jam spread. Only looked at while the player is holding traffic up (heldT).
        if (c.plan && t - this.heldT < 2 && c.plan.sEnt - c.s < 14) { const P = c.plan, nx = P.next; let rear = 1e9, pt = -1e9, need = c.def.len + 1.8;
          for (const o of this.cars) { if (o === c) continue; if (o.junction) { if (o.junction.next.e === nx.e && o.junction.next.li === nx.li) need += o.def.len + 1.8; continue; }
            if (o.e !== nx.e || o.dir !== nx.dir || o.li !== nx.li || o.v > 0.5 || t - o.pt > 1.5) continue; const sr = o.s - o.def.len / 2; if (sr < rear) { rear = sr; pt = o.pt; } }
          if (rear - need < P.s1) { gap = Math.min(gap, dStop > -1.5 && R.stops(c.e, c.dir) ? Math.max(0, dStop) : Math.max(0, P.sEnt - c.s) + 1.6); if (c.v < 0.5) { c.pt = pt; heldP = true; c.jamT += dt; }
            if (c.jamT > 3 && c.avoid !== nx.e) { c.avoid = nx.e; c.jamT = 0; c.nx = undefined; c.plan = this.planFor(c); if (!c.plan) continue; } }
          else c.jamT = 0; }
        if (c.plan && c.plan.big && !atLight) { const dEnt = c.plan.sEnt - c.s; if (dEnt < 10 + c.v * 1.6 && c.wait < 14 && this.mustYield(c)) { gap = Math.min(gap, Math.max(0, dEnt) + 1.6); c.yield = true; } else c.yield = false; }
        // stuck behind something that is not going anywhere (a stopped player, a stalled car): move over if there is a lane to move into
        const n = R.laneCount(c.e, c.dir);
        if (blk && c.v < 0.6 && gap < 4 && !atLight && n > 1 && Math.abs(c.lo) < 0.1 && (blk.def ? (blk.vx !== undefined ? Math.hypot(blk.vx, blk.vy) < 0.3 : blk.stun > 0 || (blk.held > 2.5 && blk.pass === null && blk.e === c.e)) : false)) {
          c.held += dt;
          if (c.held > 1.6) { for (const l2 of [c.li - 1, c.li + 1]) { if (l2 < 0 || l2 >= n || !this.laneFree(c, l2)) continue; c.lo = c.lo0 = R.laneOffset(c.e, c.dir, c.li) - R.laneOffset(c.e, c.dir, l2); c.li = l2; c.pass = blk; c.passT = 6; c.held = 0; c.plan = null; if (c.nx) c.nx = undefined; break; } }
        } else if (c.v < 0.3 && !atLight && blk) c.held += dt; else c.held = 0;
      } else limit = Math.min(limit, c.junction.vmax);
      // follow: speed that can still stop inside the gap
      const safe = Math.sqrt(Math.max(0, 2 * 4.5 * (gap - 1.8)));
      const want = Math.min(limit, safe);
      c.v += clamp(want - c.v, -9 * dt, 2.6 * dt); if (c.v < 0.02) c.v = 0;
      c.brake = c.v < 0.4 || c.v - v0 < -1.2 * dt;
      // mvT: when this car, or the car it waits behind, or the one that one waits behind and so on, last moved, stood at a red light or was held up by
      // the player. A queue that is pulling away, or one that stands behind a red light two short blocks on, is not a jam: its cars used to slip
      // through each other after 16 s all the same
      if (c.v > 0.5 || atLight || heldP) c.mvT = t; else if (blk && blk.mvT !== undefined && blk.mvT > c.mvT) c.mvT = blk.mvT;
      // last resort against gridlock: a car that has sat behind something on a green for a long time pushes through
      if (c.v < 0.3 && gap < 3 && !atLight && (c.junction || R.signal(R.endNode(c.e, c.dir), c.e, t) === 'g')) { c.wait += dt; if (c.wait > 16) { if (!heldP && t - c.mvT > 16) c.ghost = 2.5; c.wait = c.ghost > 0 ? 0 : 10; } } else c.wait = 0; if (heldP) c.wait = 0;     /* (a car in the queue the player holds up does not count its wait: when the player lets the street go, the cars at the back still stand for some seconds while the queue pulls away, and must not slip through then) */
      c.heldByPlayer = heldP ? 0.6 : Math.max(0, c.heldByPlayer - dt);     /* motion lane: held up by the player, directly or down the queue */     /* a car stuck for 16 s slips through what blocks it so junctions never lock up, but never through the player or the player's cars ("cars drive through my cars") */
      c.rev = 0; if (c.v > 1.5) c.backD = 0; if (c.v < 1 && (c.backT > 0 || (pv && Math.abs(c.x - pv.x) < 12 && Math.abs(c.y - pv.y) < 12)) && this.backOff(c, dt, pg)) c.v = 0;
      let ds = c.v * dt; if (pg < 1e8 && ds > pg - 0.05) { ds = Math.max(0, pg - 0.05); if (pg < 0.25) c.v = 0; }     // never into the body of one of the player's cars
      c.spin += ds / c.def.radius;
      const ph = c.h;
      if (c.junction) {
        const j = c.junction; j.u += ds / j.len;
        if (j.u >= 1) { c.avoid = null; c.e = j.next.e; c.dir = j.next.dir; c.li = j.next.li; c.s = j.s1 + (j.u - 1) * j.len; c.junction = null; c.plan = null; c.nx = undefined; c.v0 = (c.e.ave ? 11.5 : 8) * (0.85 + this.rand() * 0.3); R.lanePos(c.e, c.dir, c.li, c.s, c); }
        else { const u = j.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; c.x = a * j.p0x + b * j.cx + d * j.p1x; c.y = a * j.p0y + b * j.cy + d * j.p1y;
          const tx = 2 * (1 - u) * (j.cx - j.p0x) + 2 * u * (j.p1x - j.cx), ty = 2 * (1 - u) * (j.cy - j.p0y) + 2 * u * (j.p1y - j.cy); c.h = Math.atan2(ty, tx); }
      } else {
        c.s += ds; const L = c.e.len;
        if (!c.plan && c.s >= L - 12) c.plan = this.planFor(c);
        if (c.s >= L - 0.5 && !c.plan) { c.dead = true; continue; }
        if (c.plan && c.s >= c.plan.sEnt) { c.junction = c.plan; c.junction.u = (c.s - c.plan.sEnt) / c.plan.len; c.lo = 0; }
        else {
          R.lanePos(c.e, c.dir, c.li, c.s, c);
          if (c.lo) {   // sliding across from the lane it left
            const k = Math.abs(c.lo) / Math.abs(c.lo0 || 1), sgn = Math.sign(c.lo); c.x += Math.sin(c.h) * c.lo; c.y -= Math.cos(c.h) * c.lo; c.h += sgn * 0.42 * Math.sin(Math.PI * clamp(1 - k, 0, 1));
            c.lo -= sgn * Math.min(Math.abs(c.lo), ds * 0.55); if (Math.abs(c.lo) < 0.02) c.lo = 0;
          }
        }
      }
      c.steer = clamp(wrapPi(c.h - ph) / Math.max(ds, 0.01) * c.def.wheelbase, -0.6, 0.6);
    }
  }
  remove(c) { const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); }
}

// Parked cars: slots from the city file; the ones near the player are drawn and collide.
export class Parked {
  constructor(game) {
    this.g = game; this.slots = []; const r = rng(99); const types = ['sedan', 'sedan', 'suv', 'suv', 'sedan', 'van', 'sedan', 'suv', 'sedan', 'suv', 'sedan', 'taxi', 'sedan', 'suv', 'van', 'sedan', 'sport'];
    const R = game.roads; let dropped = 0;
    for (const p of game.city.parked) {
      // a slot that stands in a travel lane (where two roadways run side by side, one road's kerb can lie in the other's lanes) is no
      // parking place: traffic and the route line would run straight through the car
      if (R.inLane(p[0], p[1], 0.75)) { dropped++; continue; }
      const type = types[p[3] % types.length], def = game.kit.cars[type] || game.kit.cars.sedan;
      const s = { x: p[0], y: p[1], h: p[2], type: def.type, def, color: type === 'taxi' ? 0xf2b90c : PAINTS[(p[3] * 7) % PAINTS.length], gone: false, circles: [] };
      const fx = Math.cos(s.h), fy = Math.sin(s.h), o = def.len * 0.27;
      s.circles.push(game.statics.addCircle(s.x + fx * o, s.y + fy * o, def.wid * 0.5, s), game.statics.addCircle(s.x - fx * o, s.y - fy * o, def.wid * 0.5, s));
      this.slots.push(s);
    }
    this.dropped = dropped;
    this.grid = new Map(); for (const s of this.slots) { const k = Math.floor(s.x / 80) + ',' + Math.floor(s.y / 80); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(s); }
  }
  near(x, y, r, out = []) {
    out.length = 0; const i0 = Math.floor((x - r) / 80), i1 = Math.floor((x + r) / 80), j0 = Math.floor((y - r) / 80), j1 = Math.floor((y + r) / 80);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.grid.get(i + ',' + j); if (a) for (const s of a) if (!s.gone && (s.x - x) ** 2 + (s.y - y) ** 2 < r * r) out.push(s); }
    return out;
  }
  take(s) { s.gone = true; for (const c of s.circles) c.on = false; }
}

// Pedestrians walking the sidewalk loops near the player.
export class Peds {
  constructor(game) {
    this.g = game; this.list = []; this.rand = rng(777); this.target = 44; this.loops = game.city.ped_loops.map((p) => new Polyline(p.concat([p[0]]))).filter((l) => l.len > 60 && l.len < 1500);
    this.pool = []; this.spawnT = 0; this.kinds = game.kit.pedKinds ? game.kit.pedKinds() : ['ped_a', 'ped_b', 'ped_c', 'ped_d'];
  }
  visual(kind) {
    const k = this.g.kit; let v = this.pool.find((p) => p.kind === kind && !p.used);
    if (!v) {
      const p = k.person(kind);
      if (p) v = Object.assign(p, { kind });
      else {   // stand-in figure until the modelled people are in the kit
        const o = new THREE.Group(); const col = new THREE.Color().setHSL(this.rand(), 0.25, 0.25 + this.rand() * 0.3);
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.75, 4, 8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 })); body.position.y = 1.05; body.castShadow = true;
        const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.9 })); legs.position.y = 0.45; legs.castShadow = true;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb08a6e, roughness: 0.7 })); head.position.y = 1.68; head.castShadow = true;
        o.add(body, legs, head); v = { object: o, mixer: null, acts: {}, kind };
      }
      this.g.world.scene.add(v.object); this.pool.push(v);
    }
    v.used = true; v.object.visible = true; return v;
  }
  nearLoops(px, py) {
    if (this._nl && Math.hypot(px - this._nx, py - this._ny) < 30) return this._nl;
    const out = this.loops.filter((l) => { const b = l.box || (l.box = l.p.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9])); return px > b[0] - 110 && px < b[2] + 110 && py > b[1] - 110 && py < b[3] + 110; });
    this._nl = out.length ? out : this.loops; this._nx = px; this._ny = py; return this._nl;
  }
  spawn(px, py, anywhere) {
    for (let k = 0; k < 8; k++) {
      const near = this.nearLoops(px, py), l = near[Math.floor(this.rand() * near.length)], s = this.rand() * l.len; l.at(s, tmp);
      const d = Math.hypot(tmp.x - px, tmp.y - py); if (d > 120 || (!anywhere && d < 55)) continue; if (d < 6) continue;
      const kind = this.kinds[Math.floor(this.rand() * this.kinds.length)];
      const p = { loop: l, s, dir: this.rand() < 0.5 ? 1 : -1, speed: 1.15 + this.rand() * 0.55, x: tmp.x, y: tmp.y, h: 0, off: (this.rand() - 0.5) * 2.4, state: 'walk', t: 0, vis: this.visual(kind), scale: 0.94 + this.rand() * 0.12, phase: this.rand() * 10, fall: 0, vx: 0, vy: 0, onRoad: false };
      const r1 = this.rand(), r2 = this.rand(), wk = p.vis.walks || []; p.walk = 'walk'; p.walkSpeed = 1.45;
      // a walk whose own pace is near this pedestrian's (so it plays at close to its captured rate), varied among the near ones
      if (wk.length) { const want = p.speed / p.scale, near = wk.filter((w) => Math.abs(Math.log(want / w.speed)) < 0.14), pick = near.length ? near[Math.floor(r1 * near.length)] : wk.reduce((a, b) => (Math.abs(Math.log(want / a.speed)) < Math.abs(Math.log(want / b.speed)) ? a : b)); p.walk = pick.name; p.walkSpeed = pick.speed; }
      if (p.vis.mixer) p.vis.mixer.setTime(r2 * 3);
      p.vis.object.scale.setScalar(p.scale); this.setAnim(p, p.walk); this.list.push(p); return;
    }
  }
  setAnim(p, name) {
    const v = p.vis; if (!v.mixer || v.cur === name) return; const a = v.acts[name]; if (!a) return;
    if (v.cur && v.acts[v.cur]) v.acts[v.cur].fadeOut(0.2); a.reset().fadeIn(0.2).play(); v.cur = name;
  }
  step(dt) {
    const g = this.g, px = g.focus.x, py = g.focus.y;
    this.spawnT -= dt; if (this.spawnT <= 0 && this.list.length < this.target) { this.spawnT = 0.15; this.spawn(px, py, false); }
    const car = g.player.vehicle; const cars = g.vehicles;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; const d = Math.hypot(p.x - px, p.y - py);
      if (d > 150 || (p.state === 'down' && p.t > 9)) { p.vis.used = false; p.vis.object.visible = false; this.list.splice(i, 1); continue; }
      p.t += dt;
      if (p.state === 'walk' || p.state === 'flee') {
        // a fast car close by and coming this way: get out of the way
        let threat = null;
        for (const v of cars) { const sp = Math.hypot(v.vx, v.vy); if (sp < 3) continue; const dx = p.x - v.x, dy = p.y - v.y, dd = Math.hypot(dx, dy); if (dd > 14) continue; const f = (dx * v.vx + dy * v.vy) / sp, side = Math.abs(dx * v.vy - dy * v.vx) / sp; if (f > -1 && f < 5 + sp * 1.1 && side < v.def.wid / 2 + 0.75) { threat = v; break; } }
        if (threat && p.state === 'walk') { p.state = 'flee'; p.t = 0; const dx = p.x - threat.x, dy = p.y - threat.y, sp = Math.hypot(threat.vx, threat.vy) || 1; const side = (dx * -threat.vy + dy * threat.vx) > 0 ? 1 : -1; p.fx = (-threat.vy / sp) * side; p.fy = (threat.vx / sp) * side; this.setAnim(p, 'run'); }
        if (p.state === 'flee') {
          const sp = 4.6; const o = {}; let nx = p.x + p.fx * sp * dt, ny = p.y + p.fy * sp * dt; g.statics.resolve(nx, ny, 0.3, o, true); p.x = o.x; p.y = o.y; p.h = Math.atan2(p.fy, p.fx);
          if (p.t > 1.6 && !threat) { p.state = 'walk'; const pr = p.loop.project(p.x, p.y); p.s = pr.s; p.back = 1; this.setAnim(p, p.walk); }
        } else {
          p.s += p.dir * p.speed * dt; if (p.s > p.loop.len) p.s -= p.loop.len; if (p.s < 0) p.s += p.loop.len;
          p.loop.at(p.s, tmp); const tx = tmp.tx * p.dir, ty = tmp.ty * p.dir; const gx = tmp.x + ty * p.off, gy = tmp.y - tx * p.off;
          if (p.back) { const dx = gx - p.x, dy = gy - p.y, dd = Math.hypot(dx, dy); if (dd < 0.3) p.back = 0; else { p.x += (dx / dd) * p.speed * 1.3 * dt; p.y += (dy / dd) * p.speed * 1.3 * dt; p.h = Math.atan2(dy, dx); } }
          else { p.x = gx; p.y = gy; p.h += wrapPi(Math.atan2(ty, tx) - p.h) * Math.min(1, dt * 6); }
          // step around the player on foot
          const pl = g.player; if (!pl.vehicle) { const dx = p.x - pl.x, dy = p.y - pl.y, dd = Math.hypot(dx, dy); if (dd < 0.7 && dd > 1e-3) { p.x += (dx / dd) * (0.7 - dd); p.y += (dy / dd) * (0.7 - dd); } }
        }
        p.onRoad = !g.statics.onSidewalk(p.x, p.y);
        // struck by a car
        for (const v of cars) { const sp = Math.hypot(v.vx, v.vy); if (sp < 2.2) continue; const dx = p.x - v.x, dy = p.y - v.y, fx = Math.cos(v.h), fy = Math.sin(v.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx;
          if (Math.abs(f) < v.def.len / 2 + 0.3 && Math.abs(s) < v.def.wid / 2 + 0.25) { p.state = 'down'; p.t = 0; p.vx = v.vx * 0.9 + (-fy) * Math.sign(s || 1) * 2; p.vy = v.vy * 0.9 + fx * Math.sign(s || 1) * 2; p.fall = 0; g.onPedHit(p, v); if (p.vis.mixer) p.vis.mixer.timeScale = 0; break; } }
      } else if (p.state === 'down') {
        p.x += p.vx * dt; p.y += p.vy * dt; const k = Math.exp(-3.5 * dt); p.vx *= k; p.vy *= k; p.fall = Math.min(1, p.fall + dt * 4);
      }
      const o = p.vis.object; const z = g.statics.onSidewalk(p.x, p.y) ? 0.15 : 0;
      o.position.set(p.x, z + (p.state === 'down' ? 0.12 * p.fall : 0), -p.y); o.rotation.set(0, p.h, 0);
      if (p.state === 'down') { o.rotation.z = -p.fall * 1.5; }
      if (p.vis.mixer) { if (p.state !== 'down') p.vis.mixer.timeScale = (p.state === 'flee' ? 4.6 / p.scale / (p.vis.runSpeed || 5) : (p.back ? 1.3 : 1) * p.speed / p.scale / (p.walkSpeed || 1.45)); if (d < 90) p.vis.mixer.update(dt); }
      else if (p.state !== 'down') { o.position.y += Math.abs(Math.sin((p.t + p.phase) * 7)) * 0.03; }
    }
  }
}
