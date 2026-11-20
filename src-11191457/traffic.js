// traffic.js: moving traffic on the lane graph, parked cars along the kerbs, pedestrians on the sidewalks.
import * as THREE from 'three';
import { staticPathBlocked, exitsNearestBoxFace, segmentHitsBox, clamp, wrapPi, rng, Polyline, TAU } from './geo.js';
import { PAINTS } from './models.js';
import { buildingQuery, furnitureCrossing, overlapsVehicleHeight, pedestrianFurniture } from './crowd/nav.js';
import { plainSlide } from './move/plainfall.js';

// What is on a Manhattan street: yellow cabs first, then black hire cars and SUVs, white vans, and everyone else.
const TYPE_MIX = ['taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'suv', 'suv', 'suv', 'suv', 'sedan', 'sedan', 'sedan', 'sedan', 'van', 'van', 'taxi', 'suv', 'sedan', 'sedan'];
const TAXI_YELLOW = 0xf2b90c, BLACKS = [0x0d0d0f, 0x1a1c20, 0x202428], WHITES = [0xe9e9e6, 0xeeeeea, 0xd8d9d6];
const tmp = {}, tmp2 = {};
const pick = (a, r) => a[Math.floor(r * a.length) % a.length];
// Room for the player (public report 20261112132507, "got stuck and glitched": a car turned across one-lane W 21st St was boxed in by the queue).
// (gameplay lane, on the motion lane's file.) Traffic held up by one of the player's cars stops this.room metres further back (motion's 3.2), never drives
// into its body, never slips through the queue behind it, backs away when the player's car comes at it, and gives way at SHOVE m/s when leaned on.
const SHOVE = 1.5, LO_MAX = 1.4, REAR = 0.7;
// A person in the lane (lead's helper h-brake, Nov 14; off: ?body=0). Before: traffic braked only for the player on foot, for a kit pedestrian whose
// LAST STEP WALKING was on the roadway, and (crowd.js) for crowd people walking on it. Someone lying in the road was not looked for at all unless he
// was a kit pedestrian who had been on the roadway when he went down: a crowd person struck or shot, a pedhit ragdoll of a crowd person and a
// people.js body were driven over at full speed, and a kit pedestrian thrown off the pavement into the lane too. The one it did stop for it stood
// behind until the body was cleared away, or slipped through after 16 s; behind the player standing in the lane it stood for good.
// Now (bodies / gapAhead / round / sideRoom): every person down on the roadway is in this.bod; a car brakes for one in its way and stops B_BACK
// metres further back than behind a car; B_WAIT seconds after the first car has stood for him (cars that come later only slow to a crawl) it goes
// round: into the next lane if there is one and it is free (the lane change the file already has for a stalled car), else out to the side of its
// lane as far as it must (c.bs: the sideways offset c.lo, grown as it rolls, back as before) where sideRoom finds the way clear of the kerb, walls,
// posts, parked cars, the player's cars, other traffic and anyone coming the other way; if it stands too close to turn out it backs off first
// (backOff, the file's own). With no room on either side (a one-lane street between parked rows) it waits B_GIVEUP seconds and then crawls past at
// B_CREEP m/s with what room there is, so no street is shut by a body. The player standing in the lane is gone round the same way; with no room
// the car waits for him as it always did (it does not push through the player).
const B_WAIT = 3, B_RAD = 0.8, B_BACK = 1.6, B_SLOW = 2.2, B_CREEP = 1.2, B_GIVEUP = 6, B_TURN = 0.55;

// The fallen model tips about its feet, with its head pointing along its heading.
function fallenHalfLength(person) {
  return 0.85 * (person.scale || 1) * (person.fall || 0);
}

// Smooth joins (lead's helper traffic-fix, Nov 18; Matt: "cars flash/teleport, especially at the start, at the fork by the Flatiron"; off: ?joinsmooth=0).
// Four things made a car in traffic snap round or jump sideways in one step, all measured in the game's own traffic run in node (lanes/lead/traffic-fix):
//  - where two blocks of one street meet and the lane count changes (Broadway 61 m and 75 m from the spawn) the lanes do not line up; the car crossed
//    the 1.6 m between them on a 'curve' 1.8 m long: its heading went a radian off for nine frames and back. 692 of the 9,682 ways across a node did
//    that by more than 0.15 rad. Now the step sideways is taken over six times its width each side of the join (up to 16 m) on an S-shaped path, the
//    heading following the path, and a turn whose two legs do not meet in front of the car is no longer driven backwards (its heading turns evenly);
//  - a block's centre line is a row of straight pieces: at each corner the lanes off the centre jumped sideways (up to 1.3 m on an outer lane) and the
//    heading stepped. laneAt takes the lane's place and direction from 4 m behind to 4 m ahead, so the corner is driven as a bend 8 m long;
//  - on the short link between the two halves of one crossing the curve began behind the car, which jumped up to a metre onto it; it begins at the car;
//  - a car still easing across from a lane change lost its offset in one step on reaching a join (c.lo = 0); the offset now eases out across it.
const _la = {};
function laneAt(R, e, dir, li, s, out) {
  const ln = dir > 0 ? e.line : e.rev; if (ln.p.length < 3) return R.lanePos(e, dir, li, s, out);
  const w = Math.min(4, s, ln.len - s); if (!(w > 0.05)) return R.lanePos(e, dir, li, s, out);      // (the window closes toward the block's ends: a lane begins and ends where it did)
  ln.at(s - w, _la); const ax = _la.x, ay = _la.y; ln.at(s - w / 2, _la); let x = ax + 2 * _la.x, y = ay + 2 * _la.y; ln.at(s + w / 2, _la); x += 2 * _la.x; y += 2 * _la.y; ln.at(s + w, _la); const tx = _la.x - ax, ty = _la.y - ay, l = Math.hypot(tx, ty);
  ln.at(s, out); out.x = (x + _la.x + 2 * out.x) / 8; out.y = (y + _la.y + 2 * out.y) / 8; if (l > 1e-3) { out.tx = tx / l; out.ty = ty / l; }
  const off = R.laneOffset(e, dir, li); out.x += out.ty * off; out.y += -out.tx * off; out.h = Math.atan2(out.ty, out.tx); return out;
}
const PARKFREE = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('parkcars') === '1');     /* uptown lane, park lane's word 17:04 Nov 15 */
export class Traffic {
  constructor(game) {
    this.g = game; this.cars = []; this.rand = rng(1234); this.target = 90; this.heldT = -1e9; this._pg = 1e9; this._mb = null; this._blk = null; this.room = game.P && game.P.get('unstick') === '0' ? 0 : 3.2; this.spawnT = 0; this.busT = 0; this.near = []; this.nearT = 0;
    this.bodyOn = !(game.P && game.P.get('body') === '0'); this.sm = !(game.P && game.P.get('joinsmooth') === '0'); this.bod = []; this._dn = []; this._dnT = 0; this._bk = 0; this._be = null; this._pe = { o: null, x: 0, y: 0, ax: 0, ay: 0, t0: -1, cr: 0, k: 0 };
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
    const c = { type, def, e, dir, li, s, v: 0, x: 0, y: 0, h: 0, color: this.colorFor(type), spin: 0, steer: 0, junction: null, stun: 0, wait: 0, ghost: 0, v0: (e.ave ? 11.5 : 8) * (0.85 + this.rand() * 0.3), id: Math.floor(this.rand() * 1e9), honk: 0, lo: 0, lo0: 1, brake: false, held: 0, nx: undefined, plan: null, pass: null, passT: 0, heldByPlayer: 0, yield: false, dead: false, dbl: false, pt: -1e9, rev: 0, backT: 0, backV: 0, backD: 0, jamT: 0, avoid: null, mvT: -1e9, _shF: -1, _shD: 0, bd: null, bs: 0, bv: 0 };
    R.lanePos(e, dir, li, s, c);
    if (this.spawnOccupied(c)) return null;
    c.v = c.v0 * 0.8; this.cars.push(c); return c;
  }
  spawnOccupied(c) {
    const cos = Math.cos(c.h), sin = Math.sin(c.h);
    const inside = person => {
      if (!person || person.gone) return false;
      const dx = person.x - c.x, dy = person.y - c.y;
      const u = dx*cos + dy*sin, v = dy*cos - dx*sin;
      const length = c.def.len/2 + 0.25, width = c.def.wid/2 + 0.25;
      if (Math.abs(u) < length && Math.abs(v) < width) return true;
      if (person.state !== 'down' || !person.fall) return false;
      const r = fallenHalfLength(person);
      const du = Math.cos(person.h-c.h)*r, dv = Math.sin(person.h-c.h)*r;
      return segmentHitsBox(u+du, v+dv, du, dv, length, width);
    };
    return this.g.peds?.list.some(inside) || this.g.crowd?.sim?.agents.some(inside) ||
        (this.bodyOn && this.bod.some(inside));
  }
  // fill the streets around a point at start
  populate(px, py) {
    const R = this.g.roads;
    for (const e of R.edges) {
      if (e.s0 === undefined || (e.park === 1 && PARKFREE)) continue;     /* uptown: Central Park's drives (edge key park = 1) are car-free: the game's own traffic is not put on them (a player may still drive them); ?parkcars=1 = as before */ const mid = e.line.at(e.len / 2, tmp); const d = Math.hypot(mid.x - px, mid.y - py); if (d > 360 || !this.g.bounds.in(mid.x, mid.y, 150)) continue;
      for (const dir of [1, -1]) { const n = R.laneCount(e, dir); for (let li = 0; li < n; li++) {
        let s = 12 + this.rand() * 40; while (s < e.len - 14) { if (this.rand() < 0.5 && this.cars.length < this.target * 1.15) { R.lanePos(e, dir, li, s, tmp); if (Math.hypot(tmp.x - px, tmp.y - py) > 35) this.spawn(e, dir, li, s); } s += 22 + this.rand() * 60; }
      } }
    }
  }
  // a new car somewhere out of sight: on a block near the player, behind a building or far enough off not to be seen arriving
  trySpawn(px, py) {
    const g = this.g, R = g.roads;
    this.nearT--; if (this.nearT <= 0) { this.nearT = 8; this.near.length = 0; for (const e of R.edges) { if (e.s0 === undefined || (e.park === 1 && PARKFREE)) continue; e.line.at(e.len / 2, tmp); const d = Math.hypot(tmp.x - px, tmp.y - py); if (d < 420 + e.len / 2) this.near.push(e); } }
    if (!this.near.length) return;
    for (let k = 0; k < 8; k++) {
      const e = this.near[Math.floor(this.rand() * this.near.length)];
      const dir = e.oneway ? 1 : (this.rand() < 0.5 ? 1 : -1), n = R.laneCount(e, dir); if (!n) continue;
      const li = Math.floor(this.rand() * n), s = 10 + this.rand() * Math.max(1, e.len - 24);
      R.lanePos(e, dir, li, s, tmp); const dx = tmp.x - px, dy = tmp.y - py, d = Math.hypot(dx, dy);
      if (d < 150 || d > 380) continue;
      if (!g.bounds.in(tmp.x, tmp.y, -5)) continue;
      if (d < 300 && g.statics.raycast(px, py, tmp.x, tmp.y) >= 1) continue;      // in plain view down the street
      let ok = true; for (const c of this.cars) if (Math.hypot(c.x - tmp.x, c.y - tmp.y) < 14) { ok = false; break; }
      if (ok && this.spawn(e, dir, li, s)) return;
    }
  }

  chooseNext(c) {
    const R = this.g.roads, node = R.endNode(c.e, c.dir), ex = R.exits(node, c.e);
    if (!ex.length) return null;
    const hin = R.lanePos(c.e, c.dir, c.li, c.e.len, tmp).h; let tot = 0; const w = [];
    // turns are made from the lane on that side (left turns from the left lane, right turns from the right); the lanes between go straight
    const nl = R.laneCount(c.e, c.dir);
    for (const x of ex) { const ho = R.lanePos(x.e, x.dir, 0, 0, tmp2).h; const sgn = wrapPi(ho - hin), turn = Math.abs(sgn); let k = turn < 0.5 ? 7 : turn < 2.2 ? 2 : 0.05; if (c.type === 'bus' && turn > 0.5) k *= 0.15; if (x.e.park === 1 && PARKFREE) k *= 1e-6;     /* uptown: no turn into a park drive unless it is the only way on */
      if (nl > 1 && turn >= 0.5 && ((sgn > 0 && c.li !== 0) || (sgn < 0 && c.li !== nl - 1))) k *= 0.002; w.push(k); tot += k; }
    let r = this.rand() * tot, pick = ex[0]; for (let i = 0; i < ex.length; i++) { r -= w[i]; if (r <= 0) { pick = ex[i]; break; } }
    const n = R.laneCount(pick.e, pick.dir); const ho = R.lanePos(pick.e, pick.dir, 0, 0, tmp2).h; const turn = wrapPi(ho - hin);
    let li = Math.min(n - 1, c.li); if (turn > 0.5) li = 0; else if (turn < -0.5) li = n - 1; else li = clamp(Math.round((c.li / Math.max(1, R.laneCount(c.e, c.dir) - 1 || 1)) * (n - 1)), 0, n - 1);
    return { e: pick.e, dir: pick.dir, li };
  }
  // the way a car will cross the junction at the end of its block (decided before it gets there, so others can read its intent)
  planFor(c) {
    const R = this.g.roads, L = c.e.len, node = R.endNode(c.e, c.dir), nd = R.nodes[node], SM = this.sm, LP = SM ? laneAt : (R0, e, dir, li, s, out) => R0.lanePos(e, dir, li, s, out); let rEnd = nd.e.length >= 3 ? nd.r : 0.5;
    if (SM && c.s > L - rEnd) rEnd = Math.max(0.5, L - c.s);      // (smooth joins) on a block shorter than the junction's reach (the link between the two halves of a crossing) the way across begins where the car is, not behind it: it jumped up to a metre onto its curve
    if (c.nx === undefined) { c.nx = this.chooseNext(c); for (let k = 0; k < 6 && c.avoid && c.nx && c.nx.e === c.avoid; k++) c.nx = this.chooseNext(c); }     // (a car told to avoid a block draws again while the draw is that block)
    const nx = c.nx; if (!nx) return null;
    const nn = R.nodes[R.startNode(nx.e, nx.dir)]; let s1 = Math.min(nx.e.len * 0.5, nn.e.length >= 3 ? nn.r : 0.5), p0 = LP(R, c.e, c.dir, c.li, L - rEnd, {}), p1 = LP(R, nx.e, nx.dir, nx.li, s1, {});
    // (smooth joins) a plain join whose lanes do not line up, or where the street bends: the step sideways is taken over six times its width each side of the join, the bend over 30 m a radian (it was 0.5 m each side)
    if (SM && nd.e.length < 3) { const side = Math.abs(-(p1.x - p0.x) * Math.sin(p0.h) + (p1.y - p0.y) * Math.cos(p0.h)); const bend = Math.abs(wrapPi(p1.h - p0.h)); if (side > 0.2 || bend > 0.05) { const run = Math.min(Math.max(side * 6, bend * 30), 16); rEnd = Math.max(rEnd, Math.min(run, L * 0.4)); s1 = Math.max(s1, Math.min(run, nx.e.len * 0.4)); p0 = LP(R, c.e, c.dir, c.li, L - rEnd, {}); p1 = LP(R, nx.e, nx.dir, nx.li, s1, {}); } }
    // control point: where the two headings meet, or the midpoint when (nearly) straight
    const d0x = Math.cos(p0.h), d0y = Math.sin(p0.h), d1x = Math.cos(p1.h), d1y = Math.sin(p1.h), den = d0x * d1y - d0y * d1x;
    let cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2, ch = 1;      // ch: no curve through where the two headings meet: the straight line from p0 to p1
    if (Math.abs(den) > 0.2) { const tt = ((p1.x - p0.x) * d1y - (p1.y - p0.y) * d1x) / den; if (tt > 0 && tt < 60) { const kx = p0.x + d0x * tt, ky = p0.y + d0y * tt; if (!SM || (p1.x - kx) * d1x + (p1.y - ky) * d1y > 0) { cx = kx; cy = ky; ch = 0; } } }      /* (smooth joins: not when the meeting point lies beyond p1: the car drove the second leg tail first) */
    // (smooth joins) on such a line the heading turns evenly from the one lane's to the other's, and where the lanes are (nearly) parallel the car
    // moves over on an S: sx, sy = the step sideways, sa = that step over the run (step: curveAt)
    let h0 = p0.h, dh = 0, sx = 0, sy = 0, sa = 0;
    if (SM && ch) { dh = wrapPi(p1.h - p0.h); if (Math.abs(dh) < 0.6) { const hm = p0.h + dh / 2, fx = Math.cos(hm), fy = Math.sin(hm), A = (p1.x - p0.x) * fx + (p1.y - p0.y) * fy, S = -(p1.x - p0.x) * fy + (p1.y - p0.y) * fx; if (A > Math.abs(S) * 2) { sx = -fy * S; sy = fx * S; sa = S / A; } } }
    const len = Math.max(1, Math.hypot(cx - p0.x, cy - p0.y) + Math.hypot(p1.x - cx, p1.y - cy)) * 0.93;
    const pts = []; for (let q = 0; q <= 6; q++) { const u = q / 6, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; pts.push(a * p0.x + b * cx + d * p1.x, a * p0.y + b * cy + d * p1.y); }
    return { node, e: c.e, li: c.li, p0x: p0.x, p0y: p0.y, cx, cy, p1x: p1.x, p1y: p1.y, len, next: nx, s1, sEnt: L - rEnd, vmax: Math.abs(den) > 0.2 ? 5.2 : 11, cls: Math.abs(den) <= 0.2 ? 0 : den < 0 ? 1 : 2, pts, big: nd.e.length >= 3, ch: SM ? ch : 0, h0, dh, sx, sy, sa };
  }
  // (smooth joins) where a car is on its way across (c.junction, u already set) after rolling ds metres: place and heading. The curve as before; on a
  // straight line across (ch) the S and the even turn of planFor; a lane offset it brought along eases out as on the block
  curveAt(c, ds) {
    const j = c.junction, u = Math.max(0, j.u), a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; c.x = a * j.p0x + b * j.cx + d * j.p1x; c.y = a * j.p0y + b * j.cy + d * j.p1y;
    if (j.ch) { const k = u * u * (3 - 2 * u), w = k - u; c.x += j.sx * w; c.y += j.sy * w; c.h = wrapPi(j.h0 + j.dh * k + Math.atan(j.sa * 6 * u * (1 - u))); }
    else { const tx = 2 * (1 - u) * (j.cx - j.p0x) + 2 * u * (j.p1x - j.cx), ty = 2 * (1 - u) * (j.cy - j.p0y) + 2 * u * (j.p1y - j.cy); c.h = Math.atan2(ty, tx); }
    if (c.lo || c.bs) { c.lo += c.bs ? clamp(c.bs - c.lo, -ds * B_TURN, ds * B_TURN) : -Math.sign(c.lo) * Math.min(Math.abs(c.lo), ds * 0.55); if (!c.bs && Math.abs(c.lo) < 0.02) c.lo = 0; c.x += Math.sin(c.h) * c.lo; c.y -= Math.cos(c.h) * c.lo;
      if (!c.bs && c.lo) c.h += Math.sign(c.lo) * 0.42 * Math.sin(Math.PI * clamp(1 - Math.abs(c.lo) / Math.abs(c.lo0 || 1), 0, 1)); }      // (the nose stays turned the way it was on the block while the offset eases out)
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
  pushPlayer(pl, bodyHeight) { for (const c of this.cars) { const dx = pl.x - c.x, dy = pl.y - c.y; if (Math.abs(dx) > 6 || Math.abs(dy) > 6) continue; const fx = Math.cos(c.h), fy = Math.sin(c.h), f = dx * fx + dy * fy, sd = -dx * fy + dy * fx, hl = c.def.len / 2 + 0.3, hw = c.def.wid / 2 + 0.3;
      if (Math.abs(f) < hl && Math.abs(sd) < hw) {
        if (bodyHeight !== undefined && !overlapsVehicleHeight(c, this.g.statics.onSidewalk(pl.x,pl.y) ? 0.15 : 0, bodyHeight)) continue;
        const pf = hl - Math.abs(f), ps = hw - Math.abs(sd); if (ps < pf) { const k = Math.sign(sd || 1) * ps; pl.x += -fy * k; pl.y += fx * k; } else { const k = Math.sign(f || 1) * pf; pl.x += fx * k; pl.y += fy * k; } } } }
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
    { const pl = this.g.player; if (pl && !pl.vehicle && pl !== c.pass) test(pl.x, pl.y, 0.5, pl); }
    // turning through a junction the nose points away from where the car is going: look along the arc for the player's cars
    if (c.junction) { const j = c.junction; for (const v of this.g.vehicles) { if (v === c.pass || Math.abs(v.x - c.x) > 16 || Math.abs(v.y - c.y) > 16) continue;
      for (let k = 1; k <= 5; k++) { const u = j.u + (k * 2.2) / j.len; if (u > 1.15) break; const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u, qx = a * j.p0x + b * j.cx + d * j.p1x, qy = a * j.p0y + b * j.cy + d * j.p1y;
        let hit = false; for (const o of [0.3, 0, -0.3]) if (Math.hypot(qx - v.x - Math.cos(v.h) * v.def.len * o, qy - v.y - Math.sin(v.h) * v.def.len * o) < (v.def.wid + c.def.wid) / 2 + 0.45) hit = true;
        if (hit) { const gp = k * 2.2 - half * 0.6 - this.roomFor(v); if (gp < gap) { gap = Math.max(0, gp); this._blk = v; } break; } } } }
    const p = this.g.player; if (!p.vehicle && p !== c.pass) test(p.x, p.y, 0.5, p);
    for (const q of this.g.peds.list) if (q.onRoad && !(this.bodyOn && q.state === 'down')) test(q.x, q.y, 0.4, q);
    // people lying in the roadway (this.bod): stopped for further back than a car is, so there is room to turn out round them
    this._be = null;
    if (this.bodyOn) for (const B of this.bod) { if (B.o === c.pass) continue; const dx = B.x - c.x, dy = B.y - c.y, f = dx * fx + dy * fy; if (f < 0.5 || f > look + B_RAD + B_BACK + half) continue;
      if (Math.abs(-dx * fy + dy * fx) > 1.25 + B_RAD * 0.6) continue; const gp = f - half - B_RAD - B_BACK; if (gp < gap) { gap = gp; this._blk = B.o; this._be = B; } }
    return gap;
  }
  // The people down on the roadway, once a step: the game's own pedestrians (struck, shot, a policeman), crowd people who are down, pedhit's ragdolls
  // of crowd people, people.js's bodies of shot crowd people. One entry each, kept while he lies there: { o: who, x, y: his middle, ax, ay: where
  // he lay when a car first stood for him, t0: when that was (-1: no car has yet), cr: a car has had to crawl past him }. The crowd is looked through every eighth step only.
  bodies() {
    const g = this.g, L = this.bod, st = g.statics, k = ++this._bk;
    const put = (o, x, y) => { if (st.onSidewalk(x, y)) return; let B = null; for (const q of L) if (q.o === o) { B = q; break; } if (!B) L.push((B = { o, x, y, ax: x, ay: y, t0: -1, cr: 0, k }));
      B.x = x; B.y = y; B.k = k; if (Math.abs(x - B.ax) > 1 || Math.abs(y - B.ay) > 1) { B.ax = x; B.ay = y; B.t0 = -1; B.cr = 0; } };
    const lying = (p) => { const r = fallenHalfLength(p); put(p, p.x + Math.cos(p.h) * r, p.y + Math.sin(p.h) * r); };      // drawn tipped over about his feet, head towards h (a ragdoll or a doll keeps fall at 0 and x, y at the hips)
    for (const p of g.peds.list) if (p.state === 'down') lying(p);
    const S = g.crowd && g.crowd.sim; if (S && S.agents) { const D = this._dn; if (--this._dnT <= 0) { this._dnT = 8; D.length = 0; for (const a of S.agents) if (a && !a.gone && a.state === 'down') D.push(a); } for (const a of D) if (!a.gone && a.state === 'down') lying(a); }
    const PH = g.__pedhit; if (PH && PH.list) for (const R of PH.list) if (R.fig && R.fig.crowd && R.P && R.P.hips.p.y < 1.1) put(R, R.P.hips.p.x, -R.P.hips.p.z);      // (one lying on a bonnet or a roof is not in the road)
    const BD = g.combat && g.combat.bodies; if (BD && BD.live) for (const b of BD.live) if (b.doll && b.blob && b.blob.visible) put(b, b.blob.position.x, -b.blob.position.z);
    for (let i = L.length - 1; i >= 0; i--) if (L[i].k !== k) L.splice(i, 1);
  }
  // Is there room for car c to run with its lane offset at `lo` (metres to the right of its lane; negative: left) from here to past the person
  // B, fB metres ahead of its middle? Not onto the pavement, not into a wall, a post or a parked car, not where one of the player's cars or another
  // car in traffic is or will be (a car coming the other way is given six seconds), not over the player or another person lying there.
  sideRoom(c, lo, fB, B) {
    const g = this.g, st = g.statics, fx = Math.cos(c.h), fy = Math.sin(c.h), half = c.def.len / 2, hw = c.def.wid / 2, d = lo - c.lo, sg = d < 0 ? -1 : 1, far = Math.max(fB, 0) + half + 2.5;
    const cx = c.x + fy * d, cy = c.y - fx * d, ex = fy * sg * (hw + 0.2), ey = -fx * sg * (hw + 0.2);
    for (let a = 0; a <= far + half; a += 1.5) { const px = cx + fx * a, py = cy + fy * a; if (st.onSidewalk(px + ex, py + ey) || st.resolve(px, py, hw + 0.05, tmp2) > 0) return false; }
    for (const o of this.cars) { if (o === c) continue; const dx = o.x - c.x, dy = o.y - c.y; if (dx > 90 || dx < -90 || dy > 90 || dy < -90) continue; const f = dx * fx + dy * fy, r = dx * fy - dy * fx;
      if (Math.abs(r) < 0.9 || Math.abs(r - d) > hw + o.def.wid / 2 + 0.35) continue;      // in this car's own line (the queue), or clear of the way out
      const ol = o.def.len / 2, al = Math.cos(o.h - c.h);
      if (al < -0.3) { if (f > -half && f < far + ol + 6 + o.v * 6) return false; }
      else if (f > -(half + ol + 2 + (al > 0.3 ? o.v * 2 : 0)) && f < far + ol + 1) return false; }
    for (const v of g.vehicles) { const dx = v.x - c.x, dy = v.y - c.y; if (dx > 60 || dx < -60 || dy > 60 || dy < -60) continue; const f = dx * fx + dy * fy, r = dx * fy - dy * fx, m = v.def.len / 2 + 1 + Math.hypot(v.vx, v.vy) * 2.5;
      if (Math.abs(r - d) < hw + v.def.len / 2 + 0.35 && f > -(half + m) && f < far + m) return false; }
    const who = (x, y) => { const dx = x - c.x, dy = y - c.y, f = dx * fx + dy * fy; return f > -half && f < far && Math.abs(dx * fy - dy * fx - d) < hw + 0.65; };
    const pl = g.player; if (pl !== B.o && !pl.vehicle && who(pl.x, pl.y)) return false;
    for (const q of this.bod) if (q !== B && who(q.x, q.y)) return false;
    return true;
  }
  // Car c has the person B (an entry of this.bod, or this._pe for the player on foot) in its way and nothing nearer holds it. n: the lanes its way
  // on this block (0 in a junction). See the note at B_WAIT.
  round(c, B, n, t, dt) {
    if (c.v < 0.3) { if (B.t0 < 0) B.t0 = t; c.held += dt; } else if (c.v > 2.5) return;
    const g = this.g, R = g.roads;
    if (B.t0 < 0 || t - B.t0 < B_WAIT || c.bd || c.dbl || c.stun > 0 || ((g.frame | 0) + c.id) % 4) return;      // (looked at every fourth step: sideRoom is not free)
    // the next lane, as round a stalled car
    if (n > 1 && Math.abs(c.lo) < 0.1) for (const l2 of [c.li - 1, c.li + 1]) { if (l2 < 0 || l2 >= n || !this.laneFree(c, l2)) continue; c.lo = c.lo0 = R.laneOffset(c.e, c.dir, c.li) - R.laneOffset(c.e, c.dir, l2); c.li = l2; c.pass = B.o; c.passT = 6; c.held = 0; c.plan = null; if (c.nx) c.nx = undefined; return; }
    // out to the side of its lane, the side that needs less first
    const fx = Math.cos(c.h), fy = Math.sin(c.h), dx = B.x - c.x, dy = B.y - c.y, f = dx * fx + dy * fy, s = -dx * fy + dy * fx, half = c.def.len / 2, rb = B.o === g.player ? 0.5 : 0.45, need = c.def.wid / 2 + rb + 0.15;
    const aR = Math.max(0, need - s), aL = Math.max(0, need + s), room = f - half - rb;
    for (const a of aR <= aL ? [aR, -aL] : [-aL, aR]) { if (Math.abs(c.lo + a) > 3.4 || !this.sideRoom(c, c.lo + a, f, B)) continue;
      if (room < Math.abs(a) / B_TURN + 0.3 && c.held < B_GIVEUP && this.room) { c.backT = 0.2; c.backV = 1.2; return; }      // too close to turn out: back off first (while there is room behind)
      c.bd = B; c.bs = c.lo + a || 1e-4; c.bv = B_SLOW; c.pass = B.o; c.passT = 12; c.held = 0; return; }
    // no room on either side: the player is waited for; past anyone lying there the car crawls after B_GIVEUP seconds, as far over as it can get
    if (B.o === g.player || (c.held < B_GIVEUP && !B.cr)) return;      // (the cars behind the first that crawled past do not each wait again)
    let bs = 0, far = Math.abs(s) + 0.05; for (const k of [0.75, 0.5, 0.25]) for (const a of [aR * k, -aL * k]) { const d = Math.abs(s + a); if (d > far && this.sideRoom(c, c.lo + a, f, B)) { far = d; bs = c.lo + a; } }      // the offset that leaves him furthest from the car's middle
    if (!bs && c.held < B_GIVEUP) return;      // nothing to be gained to either side just now (the car ahead is still on its way round): not straight over him yet
    c.bd = B; c.bs = bs; c.bv = B_CREEP; c.pass = B.o; c.passT = 18; c.held = 0; B.cr = 1;
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
        if (c.junction && !c.junction.ch && gp > 1.5) continue;     /* (smooth joins: on a straight line across, which may now be 30 m long, the nose does point the way it goes) */     // turning: the nose points away from the way across; the arc is looked along in gapAhead
        if (gp < this._pg) this._pg = gp;
        if (v !== c.pass && gp - room < gap) { gap = gp - room; this._mb = v; }
      }
    }
    // A bumper can reach across the kerb. Keep the physical gap during jam recovery too.
    // A quadratic curve lies inside its three control points' bounding box.
    // Expand by the car's corner reach before testing individual curve samples.
    const turn = c.junction;
    let x0, x1, y0, y1;
    if (turn) {
      const reach = Math.hypot(half + 0.3, hw + 0.3 + Math.abs(c.lo || 0));
      x0 = Math.min(turn.p0x, turn.cx, turn.p1x) - reach;
      x1 = Math.max(turn.p0x, turn.cx, turn.p1x) + reach;
      y0 = Math.min(turn.p0y, turn.cy, turn.p1y) - reach;
      y1 = Math.max(turn.p0y, turn.cy, turn.p1y) + reach;
    }
    const scanPeople = (people) => {
      for (const person of people) {
        if (person.state === 'down') continue;
        const dx = person.x - c.x, dy = person.y - c.y;
        let clearance;
        if (turn) {
          if (person.x < x0 || person.x > x1 || person.y < y0 || person.y > y1) continue;
          clearance = Infinity;
          const end = Math.min(look, Math.max(0, (1-turn.u)*turn.len));
          for (let ds = 0; ; ds = Math.min(end, ds + 0.5)) {
            const u = turn.u + ds/turn.len, t = 1-u;
            const x = t*t*turn.p0x + 2*t*u*turn.cx + u*u*turn.p1x;
            const y = t*t*turn.p0y + 2*t*u*turn.cy + u*u*turn.p1y;
            const tx = t*(turn.cx-turn.p0x) + u*(turn.p1x-turn.cx);
            const ty = t*(turn.cy-turn.p0y) + u*(turn.p1y-turn.cy);
            const len = Math.hypot(tx,ty), px = person.x-x, py = person.y-y;
            if (len && Math.abs(px*tx + py*ty) <= (half+0.3)*len &&
                Math.abs(py*tx - px*ty + (c.lo || 0)*len) <= (hw+0.3)*len) {
              clearance = Math.max(0, ds-0.5);
              break;
            }
            if (ds >= end) break;
          }
        } else {
          const forward = dx*fx + dy*fy;
          if (forward <= 0 || forward > half + look + 0.3 ||
              Math.abs(dy*fx - dx*fy) >= hw + 0.3) continue;
          clearance = forward - half - 0.3;
        }
        this._pg = Math.min(this._pg, clearance);
        if (clearance < gap) { gap = clearance; this._mb = person; }
      }
    };
    scanPeople(g.peds.list);
    if (g.crowd?.on) {
      const sim = g.crowd.sim;
      if (turn || c.ghost > 0 || sim.fbWalls) scanPeople(sim.road);
      if (turn) {
        scanPeople(sim.kerbInBounds(x0, y0, x1, y1, 2));
      } else {
        const x = c.x + fx*(half+look+0.3), y = c.y + fy*(half+look+0.3);
        scanPeople(sim.kerbInBounds(Math.min(c.x,x), Math.min(c.y,y),
          Math.max(c.x,x), Math.max(c.y,y), hw + 1));
      }
    }
    return gap;
  }
  // how much further back traffic stops behind one of the player's cars: a car length in all when it stands still, the usual gap when it is driving
  roomFor(v) { return this.g.demo ? 0 : this.room * clamp(1.25 - Math.hypot(v.vx, v.vy) / 4, 0, 1); }
  // A stopped car backs away: from the player's car coming at its nose, from the player's car standing across the street close in front of
  // it (room to turn), or because the car in front of it is backing into it (backT, passed down the queue). Only as far as there is room
  blocksPedestrianMove(c, a, l, fx, fy, nx, ny) {
    const g = this.g, j = c.junction;
    const halfLength = c.def.len / 2 + 0.3, halfWidth = c.def.wid / 2 + 0.3;
    let turnX = nx, turnY = ny, turnFx = fx, turnFy = fy;
    if (j) {
      const u = j.u + a / j.len, t = 1 - u;
      const tx = t * (j.cx - j.p0x) + u * (j.p1x - j.cx);
      const ty = t * (j.cy - j.p0y) + u * (j.p1y - j.cy);
      const heading = Math.atan2(ty, tx);
      turnFx = Math.cos(heading); turnFy = Math.sin(heading);
      turnX = t*t*j.p0x + 2*t*u*j.cx + u*u*j.p1x + turnFy*c.lo;
      turnY = t*t*j.p0y + 2*t*u*j.cy + u*u*j.p1y - turnFx*c.lo;
    }
    const blocksMove = person => {
      const dx = person.x - c.x, dy = person.y - c.y;
      const along = dx * fx + dy * fy, right = dx * fy - dy * fx;
      const after = Math.max(Math.abs(along - a) - halfLength, Math.abs(right - l) - halfWidth);
      const limit = Math.min(0, Math.max(Math.abs(along) - halfLength, Math.abs(right) - halfWidth));
      if (after < limit) return true;
      if (!j) return false;
      const px = person.x - turnX, py = person.y - turnY;
      return Math.max(Math.abs(px*turnFx + py*turnFy) - halfLength,
        Math.abs(px*turnFy - py*turnFx) - halfWidth) < limit;
    };
    if (g.peds.list.some(blocksMove)) return true;
    if (g.crowd?.on) {
      const sim = g.crowd.sim, reach = Math.hypot(halfLength, halfWidth);
      if (sim.road.some(blocksMove) || sim.kerbInBounds(Math.min(nx, turnX), Math.min(ny, turnY),
        Math.max(nx, turnX), Math.max(ny, turnY), reach).some(blocksMove)) return true;
    }
    return false;
  }
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
        if (closing > 0.3 && closing < (this.rb ? 3.5 : 6) && best < 1.0 + closing * 1.3) want = Math.max(want, Math.min(3.2, closing + 0.5));     // (a car coming faster than 6 m/s is a crash, not a manoeuvre)
        else if (pg < 2.4 && Math.hypot(pv.vx, pv.vy) < 2.5 && Math.abs(Math.sin(pv.h - c.h)) > 0.35) want = Math.max(want, 1.1);
      }
    }
    if (this.rb && want > 0) { const r0 = c._rv || 0; if (want > r0) want = Math.min(want, r0 + 2.6 * dt); c._rv = want; }      // (real braking: it gathers its speed backwards at 2.6 m/s2; step zeroes _rv when it does not back)
    if (want <= 0 || c.backD > 8) return false;
    let rear = 1e9, fol = null;
    for (const o of this.cars) { if (o === c) continue; const dx = o.x - c.x, dy = o.y - c.y; if (Math.abs(dx) > 16 || Math.abs(dy) > 16) continue; const f = dx * fx + dy * fy; if (f > -0.5) continue;
      const rad = o.def.len * 0.42; if (Math.abs(-dx * fy + dy * fx) > 1.25 + rad * 0.6) continue; const gp = -f - half - rad; if (gp < rear) { rear = gp; fol = o; } }
    for (const v of g.vehicles) { if (v === pv) continue; const dx = v.x - c.x, dy = v.y - c.y; if (Math.abs(dx) > 16 || Math.abs(dy) > 16) continue; const f = dx * fx + dy * fy; if (f > -0.5) continue;
      const rad = v.def.len * 0.5; if (Math.abs(-dx * fy + dy * fx) > 1.25 + rad * 0.6) continue; const gp = -f - half - rad; if (gp < rear) { rear = gp; fol = null; } }
    // A queued driver can reverse even when a pedestrian has nowhere to step aside.
    const checkPeople = people => {
      for (const person of people) {
        const dx = person.x - c.x, dy = person.y - c.y;
        const behind = -dx * fx - dy * fy;
        if (behind <= 0 || Math.abs(dy * fx - dx * fy) > c.def.wid / 2 + 0.3) continue;
        const clearance = behind - half - 0.3;
        if (clearance < rear) { rear = clearance; fol = null; }
      }
    };
    checkPeople(g.peds.list);
    if (g.crowd?.on) {
      const sim = g.crowd.sim;
      checkPeople(sim.road);
      const reach = half + REAR + want * dt + 0.31;
      const x = c.x - fx * reach, y = c.y - fy * reach;
      checkPeople(sim.kerbInBounds(Math.min(c.x, x), Math.min(c.y, y),
        Math.max(c.x, x), Math.max(c.y, y), c.def.wid / 2 + 0.3));
    }
    if (fol && rear < REAR + 0.6 && fol.v < 0.5) { fol.backT = 0.3; fol.backV = want; }     // the car behind is asked to back up too
    if (rear < REAR + 0.01) return false;
    let d = Math.min(want * dt, rear - REAR);
    if (c.junction) { const j = c.junction; if (j.u <= 0.02) return false; d = Math.min(d, j.u * j.len);
      if (this.blocksPedestrianMove(c, -d, 0, fx, fy, c.x - fx*d, c.y - fy*d)) return false;
      j.u -= d / j.len; }
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
      if (this.blocksPedestrianMove(c, a, l, fx, fy, nx, ny)) return false;
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

  // Real braking (lead's helper traffic-fix, Nov 18; Matt: "cars stop dead just before he hits them ... let crashes happen"; off: ?realbrake=0).
  // A car in traffic brakes at 9 m/s2 at most, but the step below also cut its movement to the gap and set its speed to 0 the moment it would touch
  // one of the player's cars: 5 to 8 m/s gone in one step (200 to 300 m/s2 measured), so a car he drove in front of, or at, froze a hand's width
  // short and there was no crash, or he hit a car that had stopped by magic. Now, while HE IS DRIVING AND MOVING (over HIT_PV m/s) and the car is
  // still rolling faster than HIT_V, it gets no such stop: it goes on at the speed its brakes left it and the two bodies meet; game.collideCars and
  // ram.js then do what they do when he drives into a car (push apart, speed lost, the driver stunned, a hard blow throws the car). Kept as before:
  // a car creeping up to him (under HIT_V: it stops short as before, its speed running out at its brakes' rate), his car standing still, a car going round his, cars he has left, people, the demo. gapTo: the bare distance from this car's
  // bumper to one of the player's cars along its nose (gapMine's own test for one car). A standing car backing away from his car coming at it
  // (backOff) picked up 3.2 m/s in one step: it now gathers that at 2.6 m/s2, and only from a car coming at under BACK_MAX m/s (was 6).
  gapTo(c, v) {
    const fx = Math.cos(c.h), fy = Math.sin(c.h), half = c.def.len / 2, hw = c.def.wid / 2, r = v.def.wid / 2, vl = Math.max(0, v.def.len / 2 - r), n = vl > 1.9 * r ? 5 : 3, ux = Math.cos(v.h), uy = Math.sin(v.h); let best = 1e9;
    for (let i = 0; i < n; i++) { const o = vl * (2 * i / (n - 1) - 1), dx = v.x - c.x + ux * o, dy = v.y - c.y + uy * o, f = dx * fx + dy * fy; if (f <= 0) continue;
      const clear = Math.abs(-dx * fy + dy * fx) - hw; if (clear >= r + 0.3 || (clear >= r && f < half + 0.2)) continue; const gp = f - half - (clear < r ? Math.sqrt(r * r - Math.max(0, clear) ** 2) : 0); if (gp < best) best = gp; }
    return best;
  }
  step(dt, t) {
    const g = this.g, R = g.roads, px = g.focus.x, py = g.focus.y, pv = g.demo ? null : g.player.vehicle, RB = this.rb === undefined ? (this.rb = !(g.P && g.P.get('realbrake') === '0')) : this.rb, HIT_V = 1, HIT_PV = 1.5;
    if (this.bodyOn) this.bodies();
    this.spawnT -= dt; if (this.spawnT <= 0 && this.cars.length < this.target) { this.spawnT = 0.25; this.trySpawn(px, py); }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - px, c.y - py) > 420 || c.dead) { this.cars.splice(i, 1); continue; }
      if (c.stun > 0) { c.stun -= dt; c.v = Math.max(0, c.v - 12 * dt); }
      let limit = c.v0; const look = 8 + c.v * 2.2, v0 = c.v;
      // a car slipping through a jam (ghost) still stops for the player's cars: it used to drive through the car in front of it AND into the player's car
      let gap, blk; if (c.ghost > 0) { gap = this.gapMine(c, look); blk = this._mb; if (!blk) gap = 1e9; } else { gap = this.gapAhead(c, look); blk = this._blk; } const pg = this._pg;
      // a person in the way (B_WAIT): someone lying in the road, or the player standing in it (he counts as standing while he stays within a metre)
      let B = null; const gapB = gap; if (this.bodyOn && blk && c.ghost <= 0) { if (blk === g.player) { B = this._pe; const q = g.player; if (B.o !== q || Math.abs(q.x - B.ax) > 1 || Math.abs(q.y - B.ay) > 1) { B.o = q; B.ax = q.x; B.ay = q.y; B.t0 = -1; } B.x = q.x; B.y = q.y; } else if (this._be && this._be.o === blk) B = this._be; }
      // going round one: slowly, until the tail is a metre past him; then the offset eases back as after a lane change
      if (c.bd) { const D = c.bd, f = (D.x - c.x) * Math.cos(c.h) + (D.y - c.y) * Math.sin(c.h); if (f < -(c.def.len / 2 + 1) || c.pass !== D.o || c.passT <= dt) { c.bd = null; c.bs = 0; c.bv = 0; if (c.pass === D.o) { c.pass = null; c.passT = 0; } if (c.lo) c.lo0 = c.lo; } else limit = Math.min(limit, c.bv); }
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
        if (B && gap >= gapB - 0.01) this.round(c, B, n, t, dt);
        else if (blk && c.v < 0.6 && gap < 4 && !atLight && n > 1 && Math.abs(c.lo) < 0.1 && (blk.def ? (blk.vx !== undefined ? Math.hypot(blk.vx, blk.vy) < 0.3 : blk.stun > 0 || (blk.held > 2.5 && blk.pass === null && blk.e === c.e)) : false)) {
          c.held += dt;
          if (c.held > 1.6) { for (const l2 of [c.li - 1, c.li + 1]) { if (l2 < 0 || l2 >= n || !this.laneFree(c, l2)) continue; c.lo = c.lo0 = R.laneOffset(c.e, c.dir, c.li) - R.laneOffset(c.e, c.dir, l2); c.li = l2; c.pass = blk; c.passT = 6; c.held = 0; c.plan = null; if (c.nx) c.nx = undefined; break; } }
        } else if (c.v < 0.3 && !atLight && blk) c.held += dt; else c.held = 0;
      } else { limit = Math.min(limit, c.junction.vmax); if (B) this.round(c, B, 0, t, dt); }
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
      c.rev = 0; if (c.v > 1.5) c.backD = 0; if (c.v < 1 && (c.backT > 0 || (pv && Math.abs(c.x - pv.x) < 12 && Math.abs(c.y - pv.y) < 12)) && this.backOff(c, dt, pg)) c.v = 0; else c._rv = 0;
      let ds = c.v * dt; if (pg < 1e8 && ds > pg - 0.05 && !(RB && pv && c.v > HIT_V && c.stun < 1e8 && c.pass !== pv && Math.hypot(pv.vx, pv.vy) > HIT_PV && this.gapTo(c, pv) <= pg + 0.01)) { ds = Math.max(0, pg - 0.05); if (pg < 0.25 && !(RB && c.v <= HIT_V)) c.v = 0; }     // never into the body of one of the player's cars (real braking: unless he is driving it and both are moving: that is a crash)
      c.spin += ds / c.def.radius;
      const ph = c.h;
      if (c.junction) {
        const j = c.junction; j.u += ds / j.len;
        if (j.u >= 1) { c.avoid = null; c.e = j.next.e; c.dir = j.next.dir; c.li = j.next.li; c.s = j.s1 + (j.u - 1) * j.len; c.junction = null; c.plan = null; c.nx = undefined; c.v0 = (c.e.ave ? 11.5 : 8) * (0.85 + this.rand() * 0.3); if (this.sm) laneAt(R, c.e, c.dir, c.li, c.s, c); else R.lanePos(c.e, c.dir, c.li, c.s, c); if (c.lo) { c.x += Math.sin(c.h) * c.lo; c.y -= Math.cos(c.h) * c.lo; } }
        else if (this.sm) this.curveAt(c, ds);
        else { const u = j.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; c.x = a * j.p0x + b * j.cx + d * j.p1x; c.y = a * j.p0y + b * j.cy + d * j.p1y;
          const tx = 2 * (1 - u) * (j.cx - j.p0x) + 2 * u * (j.p1x - j.cx), ty = 2 * (1 - u) * (j.cy - j.p0y) + 2 * u * (j.p1y - j.cy); c.h = Math.atan2(ty, tx);
          if (c.lo || c.bs) { c.lo += c.bs ? clamp(c.bs - c.lo, -ds * B_TURN, ds * B_TURN) : -Math.sign(c.lo) * Math.min(Math.abs(c.lo), ds * 0.55); if (!c.bs && Math.abs(c.lo) < 0.02) c.lo = 0; c.x += Math.sin(c.h) * c.lo; c.y -= Math.cos(c.h) * c.lo; } }      // (only a car going round a person in the junction has an offset here)
      } else {
        c.s += ds; const L = c.e.len;
        if (!c.plan && c.s >= L - 12) c.plan = this.planFor(c);
        if (c.s >= L - 0.5 && !c.plan) { c.dead = true; continue; }
        if (c.plan && c.s >= c.plan.sEnt) { c.junction = c.plan; c.junction.u = (c.s - c.plan.sEnt) / c.plan.len; if (this.sm) this.curveAt(c, 0); else if (!c.bd) c.lo = 0; }      /* (smooth joins: placed on the curve in this step, and the lane offset is kept) */
        else {
          if (this.sm) laneAt(R, c.e, c.dir, c.li, c.s, c); else R.lanePos(c.e, c.dir, c.li, c.s, c);
          if (c.bs) {   // easing out round a person in the lane
            const d = clamp(c.bs - c.lo, -ds * B_TURN, ds * B_TURN); c.lo += d; c.x += Math.sin(c.h) * c.lo; c.y -= Math.cos(c.h) * c.lo; c.h -= Math.sign(c.bs) * 0.42 * Math.sin(Math.PI * clamp(c.lo / c.bs, 0, 1));
          } else if (c.lo) {   // sliding across from the lane it left
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
    this.g = game; this.slots = []; this.bodyReach = 0; const r = rng(99); const types = ['sedan', 'sedan', 'suv', 'suv', 'sedan', 'van', 'sedan', 'suv', 'sedan', 'suv', 'sedan', 'taxi', 'sedan', 'suv', 'van', 'sedan', 'sport'];
    const R = game.roads; let dropped = 0;
    for (const p of game.city.parked) {
      // a slot that stands in a travel lane (where two roadways run side by side, one road's kerb can lie in the other's lanes) is no
      // parking place: traffic and the route line would run straight through the car
      if (R.inLane(p[0], p[1], 0.75)) { dropped++; continue; }
      const type = types[p[3] % types.length], def = game.kit.cars[type] || game.kit.cars.sedan;
      const s = { x: p[0], y: p[1], h: p[2], type: def.type, def, color: type === 'taxi' ? 0xf2b90c : PAINTS[(p[3] * 7) % PAINTS.length], gone: false, circles: [] };
      const fx = Math.cos(s.h), fy = Math.sin(s.h), o = def.len * 0.27;
      s.circles.push(game.statics.addCircle(s.x + fx * o, s.y + fy * o, def.wid * 0.5, s), game.statics.addCircle(s.x - fx * o, s.y - fy * o, def.wid * 0.5, s));
      this.bodyReach = Math.max(this.bodyReach, Math.hypot(def.len, def.wid) / 2);
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
const nearbyParked = [];
function vehicleBlocksPath(game, pushingCar, x, y, toX, toY, radius, speedLimit = Infinity, bodyHeight) {
  const dx = (toX-x)/2, dy = (toY-y)/2, cx = x+dx, cy = y+dy;
  const pathReach = Math.abs(dx) + Math.abs(dy) + 2*radius;
  const blocks = car => {
    if (car === pushingCar ||
        Math.abs(cx-car.x) + Math.abs(cy-car.y) > car.def.len + car.def.wid + pathReach) return false;
    const c = Math.cos(car.h), s = Math.sin(car.h);
    const u = (cx-car.x)*c + (cy-car.y)*s, v = (cy-car.y)*c - (cx-car.x)*s;
    const du = dx*c + dy*s, dv = dy*c - dx*s;
    const length = car.def.len/2 + radius, width = car.def.wid/2 + radius;
    if (!segmentHitsBox(u, v, du, dv, length, width)) return false;
    if (bodyHeight !== undefined) {
      const start = game.statics.onSidewalk(x,y) ? 0.15 : 0;
      const end = game.statics.onSidewalk(toX,toY) ? 0.15 : 0;
      if (!overlapsVehicleHeight(car,Math.min(start,end),bodyHeight+Math.abs(start-end))) return false;
    }
    const epsilon = 8 * Number.EPSILON * Math.max(1, Math.abs(toX), Math.abs(toY), Math.abs(car.x), Math.abs(car.y));
    return !exitsNearestBoxFace(u-du, v-dv, u+du, v+dv, length, width, epsilon);
  };
  const ownedBlocks = speedLimit === Infinity ? blocks : car => {
    if (!blocks(car)) return false;
    const speed = car.vx === undefined ? Math.abs(car.v || 0) : Math.hypot(car.vx, car.vy);
    return speed < speedLimit;
  };
  if (game.vehicles?.some(ownedBlocks) || game.traffic?.cars?.some(blocks)) return true;
  const parked = game.parked;
  if (!parked?.bodyReach) return false;
  const reach = parked.bodyReach + radius*Math.SQRT2 + Math.hypot(dx, dy);
  return parked.near(cx, cy, reach, nearbyParked).some(blocks);
}
function insideVehicle(game, x, y, radius, speedLimit = Infinity, bodyHeight) {
  return overlapsVehicle(game.vehicles, x, y, radius, speedLimit, game.statics, bodyHeight) ||
    overlapsVehicle(game.traffic?.cars, x, y, radius, Infinity, game.statics, bodyHeight) ||
    (game.parked?.bodyReach && overlapsVehicle(game.parked.near(x, y,
      game.parked.bodyReach + radius * Math.SQRT2, nearbyParked), x, y, radius, Infinity, game.statics, bodyHeight));
}

function overlapsVehicle(cars, x, y, radius, speedLimit, statics, bodyHeight) {
  if (!cars) return false;
  for (const v of cars) {
    const dx = x - v.x, dy = y - v.y;
    if (Math.abs(dx) + Math.abs(dy) > v.def.len + v.def.wid ||
        (v.vx === undefined ? Math.abs(v.v) : Math.hypot(v.vx, v.vy)) >= speedLimit) continue;
    const c = Math.cos(v.h), s = Math.sin(v.h);
    if (Math.abs(dx*c + dy*s) < v.def.len/2 + radius &&
        Math.abs(dy*c - dx*s) < v.def.wid/2 + radius &&
        (bodyHeight === undefined || overlapsVehicleHeight(v, statics.onSidewalk(x,y) ? 0.15 : 0, bodyHeight))) return v;
  }
  return false;
}

function crossesPlayer(player, x, y, endX, endY) {
  const px = player.x-x, py = player.y-y, dx = endX-x, dy = endY-y;
  if (player.vehicle || Math.abs(px) > Math.abs(dx)+0.7 || Math.abs(py) > Math.abs(dy)+0.7) return false;
  const length2 = dx*dx+dy*dy;
  const t = length2 ? clamp((px*dx+py*dy)/length2, 0, 1) : 0;
  return Math.hypot(px-t*dx, py-t*dy) < Math.min(0.7, Math.hypot(px, py))-1e-9;
}

function sidewalkFurnitureCrossing(g, furniture, nearby, p, x, y, nx, ny, radius = 0.25, contact) {
  if (!furniture?.raisedTablesNear) return furnitureCrossing(furniture, nearby, x, y, nx, ny, undefined, radius, undefined, undefined, 0, contact);
  const start = g.statics.onSidewalk(x, y) ? 0.15 : 0;
  const end = g.statics.onSidewalk(nx, ny) ? 0.15 : 0;
  const head = Math.max(start, end) + 1.75 * (p.scale || 1);
  return furnitureCrossing(furniture, nearby, x, y, nx, ny, undefined, radius, Math.min(start, end), head - radius, 0, contact);
}

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
  sidewalkBuilding(x, y, fromX, fromY) {
    const g = this.g;
    this.inBuilding ||= buildingQuery(g.city, 2.5, 2.65);
    const floor = g.statics.onSidewalk(x, y) ? 0.15 : 0;
    const start = fromX === undefined ? floor : g.statics.onSidewalk(fromX, fromY) ? 0.15 : 0;
    return this.inBuilding(x, y, Math.max(start, floor) + 2.5, Math.min(start, floor), fromX, fromY);
  }
  furnitureGrid() {
    const g = this.g;
    if (g.crowd?.nav) return g.crowd.nav;
    const parts = g.streets?.parts;
    if (!parts?.furniture && !parts?.storefronts) return;
    if (!this.furniture || this.furniturePart !== parts.furniture || this.storefrontPart !== parts.storefronts || this.displacedFurnitureRevision !== parts.furniture?.displacedFurnitureRevision) {
      this.furniture = pedestrianFurniture(g);
      this.furniturePart = parts.furniture;
      this.displacedFurnitureRevision = parts.furniture?.displacedFurnitureRevision;
      this.storefrontPart = parts.storefronts;
    }
    return this.furniture;
  }
  underRaisedObstacle(furniture, x, y, height) {
    if (!furniture?.raisedTablesNear || furniture.hasRaisedTables === false) return false;
    const nearby = this._walkFurniture ||= [];
    nearby.length = 0;
    furniture.raisedTablesNear(x-.25, y-.25, x+.25, y+.25, nearby);
    if (!nearby.length) return false;
    const floor = this.g.statics.onSidewalk(x,y) ? .15 : 0;
    return nearby.some(table => floor < table.seatObstacle.top &&
      floor + height > table.seatObstacle.base && Math.hypot(x-table.x,y-table.y) < table.h + .25);
  }
  spawn(px, py, anywhere) {
    const furniture = this.furnitureGrid();
    const near = this.nearLoops(px, py);
    if (!near.length) return;
    for (let k = 0; k < 8; k++) {
      const l = near[Math.floor(this.rand() * near.length)], s = this.rand() * l.len; l.at(s, tmp);
      const d = Math.hypot(tmp.x - px, tmp.y - py); if (d > 120 || (!anywhere && d < 55)) continue; if (d < 6) continue;
      this.inBuilding ||= buildingQuery(this.g.city, 2.5, 2.65);
      const walls = this.g.P?.get('crowdwalls') !== '0' && this.g.P?.get('crowdfb') !== '0';
      const spawnHeight = 1.75 * 1.06;
      // Scale is assigned after placement. Reserve headroom for the tallest spawn.
      if ((walls ? this.sidewalkBuilding(tmp.x, tmp.y) : this.inBuilding(tmp.x, tmp.y)) || insideVehicle(this.g, tmp.x, tmp.y, 0.25, Infinity, walls ? spawnHeight : undefined) ||
          furniture?.push(tmp.x, tmp.y, 0.25, tmp2) ||
          this.g.statics.resolvePedestrian(tmp.x, tmp.y, 0.25, tmp2)) continue;
      if (walls && this.underRaisedObstacle(furniture,tmp.x,tmp.y,spawnHeight)) continue;
      const kind = this.kinds[Math.floor(this.rand() * this.kinds.length)];
      const p = { loop: l, s, dir: this.rand() < 0.5 ? 1 : -1, speed: 1.15 + this.rand() * 0.55, back: 1, x: tmp.x, y: tmp.y, h: 0, off: (this.rand() - 0.5) * 2.4, state: 'walk', t: 0, vis: this.visual(kind), scale: 0.94 + this.rand() * 0.12, phase: this.rand() * 10, fall: 0, vx: 0, vy: 0, onRoad: false };
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
    const checkWalls = this.list.length && g.P?.get('crowdwalls') !== '0' && g.P?.get('crowdfb') !== '0';
    const furniture = this.list.length ? this.furnitureGrid() : null;
    const car = g.player.vehicle; const cars = g.vehicles;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; const d = Math.hypot(p.x - px, p.y - py);
      if (d > 150 || (p.state === 'down' && p.t > 9)) { p.vis.used = false; p.vis.object.visible = false; this.list.splice(i, 1); continue; }
      p.t += dt;
      if (p.state === 'walk' || p.state === 'flee') {
        // a fast car close by and coming this way: get out of the way
        let threat = null;
        for (const v of cars) { const sp = Math.hypot(v.vx, v.vy); if (sp < 3) continue; const dx = p.x - v.x, dy = p.y - v.y, dd = Math.hypot(dx, dy); if (dd > 14) continue;
          const f = (dx * v.vx + dy * v.vy) / sp, side = Math.abs(dx * v.vy - dy * v.vx) / sp;
          if (f > -1 && f < 5 + sp * 1.1 && side < v.def.wid / 2 + 0.75) {
            if (checkWalls && !overlapsVehicleHeight(v, g.statics.onSidewalk(p.x, p.y) ? 0.15 : 0, 1.75 * (p.scale || 1))) continue;
            threat = v; break;
          }
        }
        if (threat && p.state === 'walk') { p.state = 'flee'; p.t = 0; const dx = p.x - threat.x, dy = p.y - threat.y, sp = Math.hypot(threat.vx, threat.vy) || 1; const side = (dx * -threat.vy + dy * threat.vx) > 0 ? 1 : -1; p.fx = (-threat.vy / sp) * side; p.fy = (threat.vx / sp) * side; this.setAnim(p, 'run'); }
        if (!checkWalls || p.state !== 'walk') p.wallExit = undefined;
        if (p.state === 'flee') {
          const height = checkWalls ? 1.75 * (p.scale || 1) : undefined;
          p.rejoinStart = undefined;
          const nx = p.x + p.fx * 4.6 * dt, ny = p.y + p.fy * 4.6 * dt;
          const contact = g.statics.resolvePedestrian(nx, ny, 0.3, tmp2);
          if (contact && g.statics.resolvePedestrian(p.x - p.fx*1e-4, p.y - p.fy*1e-4, 0.3, tmp) &&
              tmp.nx*tmp2.nx + tmp.ny*tmp2.ny < 0) {
            // A round obstacle loaded across the stride. Keep the approach-side contact.
            tmp2.x = tmp.x; tmp2.y = tmp.y;
          }
          if (contact && g.statics.raycast(p.x, p.y, tmp2.x, tmp2.y) < 1) {
            // A newly loaded fence can already touch the runner. Resolve from the approach side.
            let fromX = p.x, fromY = p.y;
            if (g.statics.raycast(fromX, fromY, tmp2.x, tmp2.y) === 0) {
              // Exactly on a streamed wall, recover the side the runner approached from.
              fromX -= p.fx * 1e-4;
              fromY -= p.fy * 1e-4;
            }
            g.statics.resolvePedestrian(fromX, fromY, 0.3, tmp2);
            if (g.statics.raycast(fromX, fromY, tmp2.x, tmp2.y) < 1) {
              tmp2.x = p.x; tmp2.y = p.y;
            }
          }
          if (furniture?.push(tmp2.x, tmp2.y, 0.3, tmp2)) {
            // A table loaded around the runner can put the next step across its center.
            if (furniture.push(p.x - p.fx*1e-4, p.y - p.fy*1e-4, 0.3, tmp) &&
                tmp.nx * tmp2.nx + tmp.ny * tmp2.ny < 0) {
              tmp2.x = tmp.x; tmp2.y = tmp.y;
            }
            // A furniture push beside a wall must still leave the runner on this side.
            if (g.statics.raycast(p.x, p.y, tmp2.x, tmp2.y) < 1 ||
                g.statics.resolvePedestrian(tmp2.x, tmp2.y, 0.3, tmp)) { tmp2.x = p.x; tmp2.y = p.y; }
          }
          if ((!checkWalls || (!staticPathBlocked(g.statics, p.x, p.y, tmp2.x, tmp2.y, true, undefined, undefined, 0.3) &&
              !vehicleBlocksPath(g, null, p.x, p.y, tmp2.x, tmp2.y, 0.3, 2.2, height) &&
              !sidewalkFurnitureCrossing(g, furniture, this._walkFurniture ||= [], p, p.x, p.y, tmp2.x, tmp2.y, 0.3))) &&
              !(checkWalls && this.sidewalkBuilding(tmp2.x, tmp2.y, p.x, p.y)) && !insideVehicle(g, tmp2.x, tmp2.y, 0.3, 2.2, height)) {
            p.x = tmp2.x; p.y = tmp2.y;
          }
          p.h = Math.atan2(p.fy, p.fx);
          if (p.t > 1.6 && !threat) { p.state = 'walk'; const pr = p.loop.project(p.x, p.y); p.s = pr.s; p.back = 1; this.setAnim(p, p.walk); }
        } else if (p.wallExit) {
          const height = 1.75 * (p.scale || 1);
          const {x,y} = p.wallExit;
          const dx = x-p.x, dy = y-p.y, distance = Math.hypot(dx,dy);
          if (crossesPlayer(g.player,p.x,p.y,x,y) || this.sidewalkBuilding(x,y,p.x,p.y) ||
              g.statics.raycast(p.x,p.y,x,y)<1 || staticPathBlocked(g.statics,p.x,p.y,x,y,true) ||
              vehicleBlocksPath(g,null,p.x,p.y,x,y,0.25, Infinity, height) || furniture?.push(x,y,0.25,tmp2) ||
              sidewalkFurnitureCrossing(g,furniture,this._walkFurniture ||= [],p,p.x,p.y,x,y) ||
              g.statics.resolvePedestrian(x,y,0.25-8*Number.EPSILON*Math.max(1,Math.abs(x),Math.abs(y)),tmp2)) {
            // A streamed wall can disappear while a different obstacle still blocks the exit.
            if (!g.statics.resolvePedestrian(p.x,p.y,0.25,tmp2) && !furniture?.push(p.x,p.y,0.25,tmp2) &&
                !this.underRaisedObstacle(furniture,p.x,p.y,height) &&
                !this.sidewalkBuilding(p.x,p.y,p.x,p.y) && !insideVehicle(g,p.x,p.y,0.25,Infinity,height)) {
              p.wallExit = undefined;
            }
          } else {
            const fraction = Math.min(1,p.speed*dt/(distance || 1));
            p.x += dx*fraction; p.y += dy*fraction;
            p.s = p.loop.project(p.x,p.y).s;
            p.loop.at(p.s,tmp);
            p.off = clamp(((p.x-tmp.x)*tmp.ty-(p.y-tmp.y)*tmp.tx)*p.dir,-1.2,1.2);
            if (fraction === 1) p.wallExit = undefined;
          }
        } else {
          const height = checkWalls ? 1.75 * (p.scale || 1) : undefined;
          const oldX = p.x, oldY = p.y, oldS = p.s;
          p.s += p.dir * p.speed * dt; if (p.s > p.loop.len) p.s -= p.loop.len; if (p.s < 0) p.s += p.loop.len;
          p.loop.at(p.s, tmp); const tx = tmp.tx * p.dir, ty = tmp.ty * p.dir; const gx = tmp.x + ty * p.off, gy = tmp.y - tx * p.off;
          const dx = gx - p.x, dy = gy - p.y, stride = p.speed * 1.3 * dt;
          // The offset lane changes sides of a vertex as its tangent turns.
          if (!p.back && dx*dx + dy*dy > stride*stride) p.rejoinStart = oldS;
          if (p.back || dx*dx + dy*dy > stride*stride) {
            const distance = Math.hypot(dx, dy);
            if (distance <= stride) { p.x = gx; p.y = gy; p.back = 0; }
            else { p.back = 1; p.x += dx / distance * stride; p.y += dy / distance * stride; }
            if (distance > 0) p.h = Math.atan2(dy, dx);
          }
          else { p.x = gx; p.y = gy; p.h += wrapPi(Math.atan2(ty, tx) - p.h) * Math.min(1, dt * 6); }
          // step around the player on foot
          const pl = g.player;
          if (!pl.vehicle) {
            const dx = p.x - pl.x, dy = p.y - pl.y, dd = Math.hypot(dx, dy);
            if (dd < 0.7 && dd > 1e-3) {
              const step = Math.min(0.7 - dd, stride);
              p.x += (dx / dd) * step;
              p.y += (dy / dd) * step;
            }
          }
          // A mapped route can graze a facade. Correct shallow contact before testing the stride.
          if (checkWalls && p.wallRejoined) {
            p.wallRejoined = !!g.statics.resolvePedestrian(p.x, p.y, 0.251, tmp2);
            if (p.wallRejoined && Math.hypot(tmp2.x - p.x, tmp2.y - p.y) <= 0.005) {
              p.x = tmp2.x; p.y = tmp2.y;
            }
          }
          // If furniture cuts across this lane, try one lateral stride before turning back.
          let furnitureBlocked = checkWalls && furniture && sidewalkFurnitureCrossing(g, furniture, this._walkFurniture ||= [], p, oldX, oldY, p.x, p.y, 0.25, tmp2);
          if (furnitureBlocked) {
            const lateralPush = (p.x-tmp2.x)*ty - (p.y-tmp2.y)*tx;
            const side = Math.abs(lateralPush)>1e-8 ? Math.sign(lateralPush) : (p.off < 0 ? -1 : 1);
            for (const sign of [side, -side]) {
              const off = clamp(p.off + sign * p.speed * dt, -1.2, 1.2);
              const shift = off - p.off, x = oldX + ty*shift, y = oldY - tx*shift;
              if (!shift || (!pl.vehicle && Math.hypot(x-pl.x,y-pl.y) < 0.7) ||
                  g.statics.raycast(oldX, oldY, x, y) < 1 || furniture.push(x, y, 0.25, tmp2) ||
                  sidewalkFurnitureCrossing(g, furniture, this._walkFurniture ||= [], p, oldX, oldY, x, y) ||
                  this.sidewalkBuilding(x, y, oldX, oldY) || g.statics.resolvePedestrian(x, y, 0.25, tmp2) ||
                  staticPathBlocked(g.statics, oldX, oldY, x, y, true) ||
                  vehicleBlocksPath(g, null, oldX, oldY, x, y, 0.25, Infinity, height)) continue;
              p.x = x; p.y = y; p.s = oldS; p.off = off;
              furnitureBlocked = false;
              break;
            }
          }
          // A prescribed sidewalk loop can cross a facade or a fence. Turn
          // back on the same side and ease onto the return lane from here.
          // Traffic stopped at a light has no parked-car circles.
          if ((checkWalls && (crossesPlayer(pl, oldX, oldY, p.x, p.y) || vehicleBlocksPath(g, null, oldX, oldY, p.x, p.y, 0.25, 2.2, height) ||
              staticPathBlocked(g.statics, oldX, oldY, p.x, p.y, true) || furnitureBlocked)) ||
              (checkWalls && this.sidewalkBuilding(p.x, p.y, oldX, oldY)) || insideVehicle(g, p.x, p.y, 0.25, 2.2, height) || furniture?.push(p.x, p.y, 0.25, tmp2) || g.statics.resolvePedestrian(p.x, p.y, 0.25, tmp2) ||
              g.statics.raycast(oldX, oldY, p.x, p.y) < 1) {
            p.x = oldX; p.y = oldY; p.s = p.rejoinStart ?? oldS; p.rejoinStart = undefined;
            p.dir = -p.dir; p.off = -p.off; p.back = 1;
            // When a walker cannot rejoin its offset lane, reverse along its
            // current lateral offset to avoid steering back into the obstruction.
            const repeated = oldX === p.blockedX && oldY === p.blockedY;
            if (checkWalls) { p.blockedX = oldX; p.blockedY = oldY; }
            if (checkWalls && (repeated || (p.off && Math.hypot(dx,dy)>stride))) {
              if (repeated) p.s = p.loop.project(oldX,oldY).s;
              p.loop.at(p.s, tmp);
              p.off = clamp(((oldX-tmp.x)*tmp.ty-(oldY-tmp.y)*tmp.tx)*p.dir,-1.2,1.2);
            }
            // A streamed obstacle may already overlap the previous position.
            if (furniture?.push(oldX - tx*1e-4, oldY - ty*1e-4, 0.25, tmp2) ||
                g.statics.resolvePedestrian(oldX - tx*1e-4, oldY - ty*1e-4, 0.25, tmp2)) {
              let fromX = oldX, fromY = oldY;
              // On the fence line the ray hits at zero in either direction. Use the approach side.
              if (g.statics.raycast(oldX, oldY, tmp2.x, tmp2.y) === 0) {
                fromX -= tx * 1e-4; fromY -= ty * 1e-4;
                g.statics.resolvePedestrian(fromX, fromY, 0.25, tmp2);
              }
              let x = tmp2.x, y = tmp2.y;
              const clear = () => {
                return !(checkWalls && (crossesPlayer(pl, oldX, oldY, x, y) || this.sidewalkBuilding(x, y, oldX, oldY))) && !furniture?.push(x, y, 0.25 - 1e-6, tmp) &&
                  g.statics.raycast(fromX, fromY, x, y) >= 1 &&
                  (!checkWalls || (!staticPathBlocked(g.statics, fromX, fromY, x, y, true) &&
                      !vehicleBlocksPath(g, null, oldX, oldY, x, y, 0.25, Infinity, height) &&
                      !sidewalkFurnitureCrossing(g, furniture, this._walkFurniture ||= [], p, oldX, oldY, x, y))) &&
                  !g.statics.resolvePedestrian(x, y, 0.25 - 8 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y)), tmp) &&
                  !insideVehicle(g, x, y, 0.25, Infinity, height);
              };
              // At a wall joint, resolving the second face can leave a small overlap on the first.
              for (let pass=0; checkWalls && pass<3; pass++) {
                if (!g.statics.resolvePedestrian(x, y, 0.25, tmp) ||
                    Math.hypot(tmp.x-x, tmp.y-y) > 0.001) break;
                x = tmp.x; y = tmp.y;
              }
              let recovered = clear();
              if (!recovered && checkWalls && furniture?.push(oldX, oldY, 0.25, tmp)) {
                // A fence or car can block the shortest way out of a streamed table.
                // Try either side of that path, checking the full displacement each time.
                const dx = x - oldX, dy = y - oldY;
                for (const side of [-1, 1]) {
                  x = oldX + dx - side*dy;
                  y = oldY + dy + side*dx;
                  if (clear()) { recovered = true; break; }
                }
              }
              // Closely spaced facade edges can push toward the interior. Try the exterior side.
              if (!recovered && checkWalls && this.sidewalkBuilding(x, y, oldX, oldY)) {
                const dx = x-oldX, dy = y-oldY;
                for (const side of [-1, 1]) {
                  x = oldX-side*dy*1.5; y = oldY+side*dx*1.5;
                  if (clear()) { recovered = true; break; }
                }
              }
              // Move tangentially to an existing facade contact without deepening it.
              if (!recovered && checkWalls && staticPathBlocked(g.statics, fromX, fromY, x, y, true)) {
                const st = g.statics, radius = 0.25;
                search: for (let i = Math.floor((oldX-radius)/st.cell); i <= Math.floor((oldX+radius)/st.cell); i++) {
                  for (let j = Math.floor((oldY-radius)/st.cell); j <= Math.floor((oldY+radius)/st.cell); j++) {
                    for (const edge of st.segs.get(st.key(i,j)) || []) {
                      if (edge.kind !== 'building') continue;
                      const ex = edge[2]-edge[0], ey = edge[3]-edge[1];
                      const t = clamp(((oldX-edge[0])*ex+(oldY-edge[1])*ey)/(ex*ex+ey*ey || 1), 0, 1);
                      const nx = oldX-edge[0]-t*ex, ny = oldY-edge[1]-t*ey, gap = Math.hypot(nx,ny);
                      if (gap >= radius || gap < 1e-8) continue;
                      for (const sign of [-1,1]) {
                        for (let step=1; step<=6; step++) {
                          const along = sign*step*0.2/gap;
                          x = oldX-ny*along; y = oldY+nx*along;
                          if (clear()) { recovered = true; break search; }
                        }
                      }
                    }
                  }
                }
              }
              // A narrow aisle can leave only the route tangent open.
              if (!recovered && checkWalls && furniture?.push(oldX, oldY, 0.25, tmp)) {
                for (const sign of [-1, 1]) {
                  for (let distance = 0.1; distance <= 1.21; distance += 0.1) {
                    x = oldX + sign*distance*tx; y = oldY + sign*distance*ty;
                    if (furniture.push(x, y, 0.25, tmp)) continue;
                    recovered = clear();
                    break;
                  }
                  if (recovered) break;
                }
              }
              if (recovered) {
                if (checkWalls && !furniture?.push(oldX, oldY, 0.25, tmp)) {
                  const dx = x-oldX, dy = y-oldY, distance = Math.hypot(dx,dy);
                  const limit = p.speed*dt;
                  if (distance > limit && fromX === oldX && fromY === oldY) {
                    p.wallExit = {x,y};
                    x = oldX+dx*limit/distance; y = oldY+dy*limit/distance;
                  }
                }
                p.x = x; p.y = y; p.s = p.loop.project(x, y).s;
                if (checkWalls) {
                  // Resume on the recovered side instead of steering back into the wall.
                  p.wallRejoined = true;
                  p.loop.at(p.s, tmp);
                  p.off = clamp(((x - tmp.x) * tmp.ty - (y - tmp.y) * tmp.tx) * p.dir, -1.2, 1.2);
                }
              }
            }
          }
        }
        if (!p.back) p.rejoinStart = undefined;
        // Traffic advances before peds. A car may have moved over the old position.
        const pushHeight = checkWalls ? 1.75 * (p.scale || 1) : undefined;
        const contact = g.traffic?.pushPlayer && overlapsVehicle(g.traffic.cars, p.x, p.y, 0.25, Infinity, g.statics, pushHeight);
        if (contact) {
          const x = p.x, y = p.y;
          const clear = () => !(checkWalls && this.sidewalkBuilding(p.x, p.y, x, y)) && g.statics.raycast(x, y, p.x, p.y) >= 1 &&
            !staticPathBlocked(g.statics, x, y, p.x, p.y, true) &&
            !g.statics.resolvePedestrian(p.x, p.y, 0.25, tmp2) &&
            !furniture?.push(p.x, p.y, 0.25, tmp2) &&
            !(checkWalls ? sidewalkFurnitureCrossing(g, furniture, this._shoveFurniture ||= [], p, x, y, p.x, p.y) :
              furnitureCrossing(furniture, this._shoveFurniture ||= [], x, y, p.x, p.y)) &&
            !insideVehicle(g, p.x, p.y, 0.25, Infinity, pushHeight) &&
            !vehicleBlocksPath(g, contact, x, y, p.x, p.y, 0.25, Infinity, pushHeight);
          g.traffic.pushPlayer(p, pushHeight);
          if (!clear()) {
            p.x = x; p.y = y;
            // Beside a bumper, a blocked forward push can still leave a short step to the side.
            const nx = -Math.sin(contact.h), ny = Math.cos(contact.h);
            const side = (x-contact.x)*nx + (y-contact.y)*ny;
            const step = contact.def.wid/2 + 0.30 - Math.abs(side);
            if (step > 0 && step <= 0.35) {
              p.x += nx * Math.sign(side || 1) * step;
              p.y += ny * Math.sign(side || 1) * step;
              if (!clear()) { p.x = x; p.y = y; }
            } else if (Math.abs(side) < 1e-6) {
              // On the centerline either side is equally close. Try the other door.
              p.x = x - nx * Math.sign(side || 1) * step;
              p.y = y - ny * Math.sign(side || 1) * step;
              if (!clear()) { p.x = x; p.y = y; }
            }
            if (p.x === x && p.y === y) {
              // Near a corner the bumper can be clear even when the side is blocked.
              const forward = (x-contact.x)*ny - (y-contact.y)*nx;
              const toEnd = contact.def.len/2 + 0.30 - Math.abs(forward);
              if (toEnd > 0 && toEnd <= 0.35) {
                p.x += ny * Math.sign(forward || 1) * toEnd;
                p.y -= nx * Math.sign(forward || 1) * toEnd;
                if (!clear()) { p.x = x; p.y = y; }
              }
            }
          }
          if (p.state === 'walk' && (p.x !== x || p.y !== y)) p.back = 1;
        }
        p.onRoad = !g.statics.onSidewalk(p.x, p.y);
        // struck by a car
        for (const v of cars) { const sp = Math.hypot(v.vx, v.vy); if (sp < 2.2) continue; const dx = p.x - v.x, dy = p.y - v.y, fx = Math.cos(v.h), fy = Math.sin(v.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx;
          if (Math.abs(f) < v.def.len / 2 + 0.3 && Math.abs(s) < v.def.wid / 2 + 0.25) {
            if (checkWalls && !overlapsVehicleHeight(v, p.onRoad ? 0 : 0.15, 1.75 * (p.scale || 1))) continue;
            if (g.P.get('ragdoll2') !== '0') {
            const speed = p.state === 'flee' ? 4.6 : (p.back ? -1 : 1) * (p.speed || 0);
            p.beforeHit = {x: Math.cos(p.h) * speed, y: Math.sin(p.h) * speed};
          }
          p.state = 'down'; p.t = 0; p.vx = v.vx * 0.9 + (-fy) * Math.sign(s || 1) * 2; p.vy = v.vy * 0.9 + fx * Math.sign(s || 1) * 2; p.fall = 0; g.onPedHit(p, v); delete p.beforeHit; if (p.vis.mixer) p.vis.mixer.timeScale = 0; break; } }
      } else if (p.state === 'down') {
        plainSlide(g, p, dt, checkWalls, furniture); const k = Math.exp(-3.5 * dt); p.vx *= k; p.vy *= k; p.fall = Math.min(1, p.fall + dt * 4);
      }
      const o = p.vis.object;
      const onSidewalk = p.state === 'walk' || p.state === 'flee' ? !p.onRoad : g.statics.onSidewalk(p.x, p.y);
      const z = onSidewalk ? 0.15 : 0;
      o.position.set(p.x, z + (p.state === 'down' ? 0.12 * p.fall : 0), -p.y); o.rotation.set(0, p.h, 0);
      if (p.state === 'down') { o.rotation.z = -p.fall * 1.5; }
      if (p.vis.mixer) { if (p.state !== 'down') p.vis.mixer.timeScale = (p.state === 'flee' ? 4.6 / p.scale / (p.vis.runSpeed || 5) : (p.back ? 1.3 : 1) * p.speed / p.scale / (p.walkSpeed || 1.45)); if (d < 90) p.vis.mixer.update(dt); }
      else if (p.state !== 'down') { o.position.y += Math.abs(Math.sin((p.t + p.phase) * 7)) * 0.03; }
    }
  }
}
