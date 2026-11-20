// demo.js: the autopilot. Plays the game through the same inputs a person has: walks to the car, gets in, drives the job route.
// It drives like a competent, slightly quick New Yorker: keeps its lane, sets up early for turns, holds the green wave, stops for reds,
// waits for a gap before crossing other traffic, follows at a sane distance and changes lane to pass slow cars.
import { clamp, wrapPi, lerp } from './geo.js';
import { STOP_R } from './mission.js';

const STEP = 2;                 // metres between path points
const CRUISE_AVE = 15.2, CRUISE_ST = 11.5, CRUISE_WIDE = 13.5;   // m/s: avenues, side streets, wide two-way streets
const A_LAT = 2.9;              // m/s2 sideways in a bend
const A_GO = 3.3, B_EASY = 3.2; // m/s2 pulling away, and braking without drama
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Autopilot {
  constructor(game) { this.g = game; this.path = null; this.id = -1; this.i = 0; this.stuck = 0; this.rev = 0; this.shift = 0; this.off = 0; this.shiftT = 0; this.thr = 0; this.brk = 0; this.steer = 0; this.note = ''; this.goNode = -1; this.held = 0; }

  // ---------------------------------------------------------------- the line to drive: lane centres, lane changes, junction arcs
  build(route) {
    const g = this.g, R = g.roads, v = g.player.vehicle, segs = route.segs, K = segs.length, pts = [];
    const n = segs.map((sg) => R.laneCount(sg.e, sg.dir)), offOf = (k, li) => R.laneOffset(segs[k].e, segs[k].dir, li);
    const nearLane = (k, off) => { let b = 0, bd = 1e9; for (let i = 0; i < n[k]; i++) { const d = Math.abs(offOf(k, i) - off); if (d < bd) { bd = d; b = i; } } return b; };
    const turn = (k) => wrapPi(R.lanePos(segs[k + 1].e, segs[k + 1].dir, 0, 0, {}).h - R.lanePos(segs[k].e, segs[k].dir, 0, segs[k].e.len, {}).h);
    // lane wanted at the end of each block (left turns from the left lane, right turns from the right), carried back across short blocks
    const out = new Array(K).fill(-1), need = new Array(K).fill(-1), lin = new Array(K).fill(0), lout = new Array(K).fill(0);
    for (let k = K - 1; k >= 0; k--) {
      if (k === K - 1) out[k] = route.end && route.end.li !== undefined ? Math.min(n[k] - 1, route.end.li) : -1;
      else { const t = turn(k); out[k] = t > 0.5 ? 0 : t < -0.5 ? n[k] - 1 : need[k + 1] >= 0 ? nearLane(k, offOf(k + 1, need[k + 1])) : -1; }
      need[k] = out[k] >= 0 && segs[k].e.len < 70 ? out[k] : -1;
    }
    const at0 = (segs[0].dir > 0 ? segs[0].e.line : segs[0].e.rev).at(route.s0 || 0, {});
    const lat0 = v ? (v.x - at0.x) * at0.ty - (v.y - at0.y) * at0.tx : 0;     // where the car is now, metres right of the centre line
    for (let k = 0; k < K; k++) {
      if (k === 0) lin[k] = nearLane(0, lat0);
      else { const t = turn(k - 1); lin[k] = need[k] >= 0 ? need[k] : t > 0.5 ? 0 : t < -0.5 ? n[k] - 1 : nearLane(k, offOf(k - 1, lout[k - 1])); }
      lout[k] = out[k] >= 0 ? out[k] : lin[k];
    }
    const stops = []; let S = 0;
    const push = (x, y, k, o) => { const q = pts[pts.length - 1]; if (q) { const d = Math.hypot(x - q.x, y - q.y); if (d < 0.05) return q; S += d; } const p = Object.assign({ x, y, s: S, k, e: segs[k].e, ave: segs[k].e.ave, lo: 0, hi: 0, jn: false }, o); pts.push(p); return p; };
    for (let k = 0; k < K; k++) {
      const sg = segs[k], e = sg.e, L = e.len, ln = sg.dir > 0 ? e.line : e.rev;
      const a = R.nodes[R.startNode(e, sg.dir)], b = R.nodes[R.endNode(e, sg.dir)];
      let sA = k === 0 ? Math.min(route.s0 || 0, L) : Math.min(L * 0.5, a.e.length >= 3 ? a.r : 0.5);
      let sB = k === K - 1 ? Math.min(L, route.end ? route.end.s : L) : L - (b.e.length >= 3 ? b.r : 0.5);
      if (sB < sA) { if (k === 0) sB = sA; else sA = sB = (sA + sB) / 2; }
      const oIn = offOf(k, lin[k]), oOut = offOf(k, lout[k]), span = Math.min(sB - sA, 20 + 12 * Math.abs(lin[k] - lout[k]));
      // lane change: done early on a short block, otherwise finished ~35 m before the corner so the turn is set up
      const cB = Math.max(sA + span, Math.min(sB - 35, sA + 60 + span)), cA = cB - span;
      const m = Math.max(1, Math.ceil((sB - sA) / STEP)), t = {}; let first = null;
      for (let q = 0; q <= m; q++) {
        const s = sA + ((sB - sA) * q) / m; ln.at(s, t);
        let o = oIn === oOut ? oIn : lerp(oIn, oOut, smooth((s - cA) / Math.max(span, 1e-3)));
        let fixed = oIn !== oOut && s > cA - 6 && s < cB + 2;
        if (k === 0 && v) { const u = smooth((s - sA) / 22); o = lerp(lat0, o, u); if (u < 1) fixed = true; }     // pull out from where the car stands
        if (out[k] >= 0 && s > sB - 45) fixed = true;                                                         // set up for the corner or the stop
        const p = push(t.x + t.ty * o, t.y - t.tx * o, k, { lo: fixed ? 0 : offOf(k, 0) - o, hi: fixed ? 0 : offOf(k, n[k] - 1) - o, cruise: e.ave ? CRUISE_AVE : e.lanes >= 4 ? CRUISE_WIDE : CRUISE_ST, dlat: oIn === oOut ? 0 : lerp(0, oOut - oIn, smooth((s - cA) / Math.max(span, 1e-3))), chg: oOut - oIn, seg: k });
        if (!first) first = p;
      }
      const lastP = pts[pts.length - 1]; for (let q = pts.length - 1; q >= 0 && pts[q].seg === k; q--) pts[q].endI = pts.length - 1;
      if (k < K - 1) {
        if (R.stops(e, sg.dir)) stops.push({ s: lastP.s - (sB - R.stopS(e, sg.dir)) - 0.9, node: R.endNode(e, sg.dir), nd: b, e, sig: !!b.sig });
        // across the junction to the next block: an arc for a turn, a straight run otherwise
        const nx = segs[k + 1], an = R.nodes[R.startNode(nx.e, nx.dir)], s1 = Math.min(nx.e.len * 0.5, an.e.length >= 3 ? an.r : 0.5);
        const p1 = R.lanePos(nx.e, nx.dir, lin[k + 1], s1, {}), h0 = Math.atan2(t.ty, t.tx), d0x = Math.cos(h0), d0y = Math.sin(h0), d1x = Math.cos(p1.h), d1y = Math.sin(p1.h), den = d0x * d1y - d0y * d1x;
        let cx = (lastP.x + p1.x) / 2, cy = (lastP.y + p1.y) / 2;
        if (Math.abs(den) > 0.2) { const tt = ((p1.x - lastP.x) * d1y - (p1.y - lastP.y) * d1x) / den; if (tt > 0 && tt < 60) { cx = lastP.x + d0x * tt; cy = lastP.y + d0y * tt; } }
        const len = Math.hypot(cx - lastP.x, cy - lastP.y) + Math.hypot(p1.x - cx, p1.y - cy), mm = Math.max(2, Math.ceil(len / STEP)), x0 = lastP.x, y0 = lastP.y;
        for (let q = 1; q < mm; q++) { const u = q / mm, A = (1 - u) * (1 - u), B = 2 * u * (1 - u), C = u * u; push(A * x0 + B * cx + C * p1.x, A * y0 + B * cy + C * p1.y, k, { jn: true, turn: Math.abs(den) > 0.2, cruise: Math.abs(den) > 0.2 ? 8 : (e.ave ? CRUISE_AVE : CRUISE_ST) }); }
      }
    }
    const N = pts.length;
    // going straight over a junction the lanes carry on: sideways room there is what both blocks allow (none in a turn)
    for (let i = 1; i < N - 1; i++) { if (!pts[i].jn || pts[i].turn) continue; let a = i - 1, b = i; while (b < N - 1 && pts[b].jn) b++; for (let q = i; q < b; q++) { pts[q].lo = Math.max(pts[a].lo, pts[b].lo); pts[q].hi = Math.min(pts[a].hi, pts[b].hi); if (pts[q].lo > pts[q].hi) pts[q].lo = pts[q].hi = 0; } i = b; }
    // take the kinks of the mapped centre lines out of the line (the ends stay put)
    for (let it = 0; it < 3; it++) { let px = pts[0].x, py = pts[0].y; for (let i = 1; i < N - 1; i++) { const x = (px + 2 * pts[i].x + pts[i + 1].x) / 4, y = (py + 2 * pts[i].y + pts[i + 1].y) / 4; px = pts[i].x; py = pts[i].y; pts[i].x = x; pts[i].y = y; } }
    S = 0; pts[0].s = 0; for (let i = 1; i < N; i++) { S += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); pts[i].s0 = pts[i].s; pts[i].s = S; }
    for (const st of stops) { let i = 1; while (i < N - 1 && pts[i].s0 < st.s) i++; st.s += pts[i].s - pts[i].s0; }
    // heading, right-hand normal, bend, and the speed each point allows
    for (let i = 0; i < N; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)], h = Math.atan2(b.y - a.y, b.x - a.x); pts[i].h = h; pts[i].rx = Math.sin(h); pts[i].ry = -Math.cos(h); }
    for (let i = 0; i < N; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)]; pts[i].kap = Math.abs(wrapPi(b.h - a.h)) / Math.max(1, b.s - a.s); }
    for (let i = 0; i < N; i++) { const p = pts[i]; p.vlim = Math.min(p.cruise, Math.sqrt(A_LAT / Math.max(p.kap, 1e-4))); }
    // braking envelope, back to front, so a bend or the stop is slowed for in good time
    for (let i = N - 2; i >= 0; i--) pts[i].venv = Math.min(pts[i].vlim, Math.sqrt((pts[i + 1].venv ?? pts[i + 1].vlim) ** 2 + 2 * 2.4 * (pts[i + 1].s - pts[i].s)));
    pts[N - 1].venv = pts[N - 1].vlim;
    this.path = pts; this.stops = stops; this.i = 0; this.shift = 0; this.off = 0; this.len = S; this.goNode = -1; this.hold = false; this.holdK = 0;
  }

  // path coordinates of a point: distance along, metres to the right of the line (searched near the car only)
  where(x, y, i0, i1) {
    const P = this.path; let bi = -1, bd = 1e18;
    for (let i = i0; i < i1; i++) { const dx = x - P[i].x, dy = y - P[i].y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return null; const p = P[bi], dx = x - p.x, dy = y - p.y, c = Math.cos(p.h), s = Math.sin(p.h);
    return { i: bi, s: p.s + dx * c + dy * s, lat: dx * p.rx + dy * p.ry, d: Math.sqrt(bd) };
  }

  drive(dt, I) {
    const g = this.g, pl = g.player, M = g.missions, T = M.target;
    I.steer = 0; I.throttle = 0; I.brake = 0; I.handbrake = false; I.mx = 0; I.my = 0; I.run = false;
    if (!pl.vehicle) {
      if (!T || pl.busy) return;
      // on foot: head for the driver's door of the car
      const c = g.vehicles.find((v) => v.mission) || M.car; const lx = -Math.sin(c.h), ly = Math.cos(c.h);
      let gx = c.x + lx * 1.5, gy = c.y + ly * 1.5; if (!g.statics.onSidewalk(gx, gy) && g.statics.onSidewalk(c.x - lx * 1.9, c.y - ly * 1.9)) { gx = c.x - lx * 1.5; gy = c.y - ly * 1.5; }
      const dx = gx - pl.x, dy = gy - pl.y, d = Math.hypot(dx, dy), want = Math.atan2(dy, dx), rel = want - g.cam.yaw;
      if (Math.hypot(c.x - pl.x, c.y - pl.y) < 2.7 || d < 0.5) { I.use = g.frame % 20 === 0; return; }
      I.mx = Math.sin(rel); I.my = Math.cos(rel); I.run = d > 9 && g.t > 3.5; return;
    }
    const v = pl.vehicle, sp = Math.hypot(v.vx, v.vy), R = g.roads, vf = v.vf;
    const pedals = (a) => this.pedals(a, v, I, dt);
    if (!T || !T.e || !M.route) { this.note = 'wait'; pedals(sp > 0.3 ? -3 : -1); this.path = null; this.id = -1; return; }
    if (this.id !== M.route.id || !this.path) { this.id = M.route.id; this.build(M.route); }
    const P = this.path, N = P.length; if (N < 2) { pedals(-3); return; }
    const me = this.where(v.x, v.y, Math.max(0, this.i - 4), Math.min(N, this.i + 40));
    this.i = me.i; const here = P[me.i];
    if (me.d > 25) { M.route = null; this.path = null; return; }
    const half = v.def.len / 2, sMe = me.s;

    // ---- steering: aim at a point on the line a little way ahead, shifted sideways when changing lane
    this.shiftT -= dt; this.off += clamp(this.shift - this.off, -1.25 * dt, 1.25 * dt);
    const look = 3.4 + sp * 0.42; let ti = me.i; while (ti < N - 1 && P[ti].s - sMe < look) ti++;
    const tp = P[ti], o = this.off - this.holdK * (tp.dlat || 0);
    let tx = tp.x + tp.rx * o, ty = tp.y + tp.ry * o;
    if (ti === N - 1) { const ex = look - (tp.s - sMe); tx += Math.cos(tp.h) * ex; ty += Math.sin(tp.h) * ex; }    // run straight on to the stop
    const dx = tx - v.x, dy = ty - v.y, alpha = wrapPi(Math.atan2(dy, dx) - v.h), Ld = Math.max(2.5, Math.hypot(dx, dy));
    const delta = Math.atan2(2 * v.def.wheelbase * Math.sin(alpha), Ld), maxSteer = lerp(0.62, 0.10, clamp(Math.abs(vf) / 42, 0, 1) ** 0.7);
    this.steer += (clamp(delta / maxSteer, -1, 1) - this.steer) * Math.min(1, dt * 9);
    I.steer = this.steer;

    // ---- speed: the road, then everything that could be in the way; `acc` is the acceleration asked for
    // the road's own speed (bends, turns) is read a little ahead of the car, so the braking for a corner is finished at the corner
    let vi = me.i; while (vi < N - 1 && P[vi].s - sMe < vf * 0.7) vi++;
    let acc = clamp((Math.min(here.venv, P[vi].venv) - vf) * 1.8, -B_EASY, A_GO * (vf < 9 ? 1 : 0.75)); this.note = '';
    // a thing ahead on our line, `gap` metres from the nose and moving at vL: keep a following distance, brake in time
    const follow = (gap, vL, why, s0 = 2.4, T = 0.85) => {
      const dv = vf - vL, want = s0 + Math.max(0, vf * T + (vf * dv) / (2 * Math.sqrt(A_GO * B_EASY)));
      const a = gap <= 0.3 ? -9 : clamp(A_GO * (1 - (want / gap) ** 2), -9, A_GO); if (a < acc) { acc = a; this.note = why; }
    };
    // something to stop for, d metres ahead of the nose: leave it late enough to keep moving, then one steady brake down to it
    const halt = (d, why, b = 2.5) => { const need = (vf * vf) / (2 * Math.max(d, 0.25)); let a = 9; if (d < 0.4) a = vf > 0.3 ? -Math.max(3, need) : -2; else if (need > b) a = -Math.min(9, need * 1.04); else if (vf < 2.5 && d < 6) a = clamp((Math.sqrt(2 * 1.2 * d) - vf) * 2, -2, 1.2); if (a < acc) { acc = a; this.note = why; } };
    // the stop itself
    const dEnd = this.len - sMe, dT = Math.hypot(T.x - v.x, T.y - v.y);
    halt(Math.max(0, dEnd), 'stop');
    const arrived = dEnd < 1.2 || (dT < STOP_R - 2.5 && sp < 0.5 && dEnd < 16);

    // other road users, in path coordinates
    const i0 = Math.max(0, me.i - 8), i1 = Math.min(N, me.i + 70), others = [], myLat = me.lat;
    const add = (x, y, h, sv, len, wid, c) => { if (Math.abs(x - v.x) > 150 || Math.abs(y - v.y) > 150) return; const w = this.where(x, y, i0, i1); if (!w || w.d > 30) return; w.c = c; w.v = sv; w.h = h; w.len = len; w.wid = wid; w.x = x; w.y = y; w.along = sv * Math.cos(wrapPi(h - P[w.i].h)); others.push(w); };
    for (const c of g.traffic.cars) add(c.x, c.y, c.h, c.v, c.def.len, c.def.wid, c);
    for (const c of g.vehicles) if (c !== v) add(c.x, c.y, c.h, Math.hypot(c.vx, c.vy), c.def.len, c.def.wid, null);
    for (const q of g.peds.list) if (q.onRoad && q.state !== 'down') add(q.x, q.y, q.h, 0, 0.6, 0.7, null);
    // the car ahead: anything inside the strip we are about to sweep (where we are now and where the lane change is taking us)
    let lead = null;
    for (const w of others) {
      const ds = w.s - sMe; if (ds < 0.5 || ds > 14 + vf * 4.5) continue;
      const clear = (v.def.wid + w.wid) / 2 + 0.35, lat = w.lat, near = Math.min(1, ds / 14);
      const mine = lerp(myLat, this.off - this.holdK * (P[w.i].dlat || 0), near);     // close in, what counts is where the car is; further out, where it is going
      if (Math.abs(lat - mine) > clear && !(ds < 7 && Math.abs(lat - myLat) < clear)) continue;
      const gap = ds - half - w.len / 2; if (!lead || gap < lead.gap) lead = { gap, v: Math.max(0, w.along), w };
    }
    if (lead) follow(lead.gap, lead.v, 'lead');

    // signals and junctions ahead
    for (const st of this.stops) {
      const d = st.s - (sMe + half); if (d < -3 || d > 20 + vf * 6) continue;
      if (st.sig) {
        const sig = R.signal(st.node, st.e, g.t); if (sig === 'g') continue;
        if (this.goNode === st.node) continue;
        const need = (vf * vf) / (2 * Math.max(d, 0.1));
        if (d < 0 || (sig === 'y' && need > 3.6)) { this.goNode = st.node; continue; }   // too late to stop for a yellow: carry on
        // a red that will have changed before we get there is no reason to brake; one that will not is timed, the way a cabbie
        // rolls up to the lights so as to arrive as they change; and close in, it is simply a stop
        const tg = R.toGreen(st.node, st.e, g.t), eta = d / Math.max(vf, 1);
        if (sig === 'r' && eta > tg + 1.3) continue;
        if (sig === 'r' && d > 14 && tg < 12) { const vt = Math.max(4, (d - 3) / (tg + 1.3)); if (vf > vt) { const a = clamp((vt - vf) * 1.3, -B_EASY, 0); if (a < acc) { acc = a; this.note = 'timing'; } } if ((vf * vf) / (2 * d) < 3) continue; }
        halt(Math.max(0, d - 0.6), sig === 'r' ? 'red' : 'yellow');
      }
    }
    // crossing traffic: someone whose line meets ours at about the time we get there. Wait short of the crossing point.
    {
      const horizon = Math.min(N - 1, me.i + Math.ceil((18 + vf * 3.2) / STEP)); let tt = 0, vv = Math.max(vf, 1.5), hit = null;
      for (let i = me.i + 1; i <= horizon && !hit; i++) {
        const p = P[i], ds = p.s - P[i - 1].s; vv = Math.min(p.vlim, Math.sqrt(vv * vv + 2 * 2.2 * ds)); tt += ds / vv;
        const d = p.s - sMe; if (d < half + 0.5) continue;
        for (const w of others) {
          if (w.v < 1.2) continue; const dh = Math.abs(wrapPi(w.h - p.h)); if (dh < 0.45) continue;      // same way as us: that is following, above
          const ex = p.x + p.rx * this.off - w.x, ey = p.y + p.ry * this.off - w.y, c = Math.cos(w.h), s = Math.sin(w.h), f = ex * c + ey * s, side = Math.abs(-ex * s + ey * c);
          if (f < -w.len / 2 - 1 || side > (v.def.wid + w.wid) / 2 + 0.5) continue;
          let reach = 1e9; const tc = w.c;      // a car held by its own red light will not come through
          if (tc && !tc.junction && tc.e) { const nodeT = R.endNode(tc.e, tc.dir); if (R.nodes[nodeT].e.length >= 3 && R.signal(nodeT, tc.e, g.t) !== 'g') reach = R.stopS(tc.e, tc.dir) - tc.s - w.len / 2; }
          if (f > reach + 1) continue;
          const tw = Math.max(0, f - w.len / 2 - half) / Math.max(w.v, 2), tw2 = (f + w.len / 2 + half + 1) / Math.max(w.v, 2);
          if (tt > tw - 1.2 && tt < tw2 + 0.8) { hit = { d, w }; break; }
        }
      }
      if (hit) { const stopAt = hit.d - half - 3.2, need = (vf * vf) / (2 * Math.max(stopAt, 0.1)); if (stopAt > 0.5 && need < 7.5) halt(stopAt, 'yield', 2.6); else if (hit.d - half > 1 && vf < 3.5) halt(0.1, 'yield'); }     // creeping up to the crossing point: hold there, do not nose out into it
    }
    // pulling out or changing lane: let whoever is coming up behind in that lane, and gaining on us, go first
    const moving = Math.abs(this.off - myLat) > 1.1 || (here.k === 0 && Math.abs(myLat) > 1.1);
    if (moving && vf < 7) for (const w of others) { const ds = w.s - sMe; if (ds > -2 || ds < -30 || w.along < 2 || w.along < vf + 1.2) continue; if (Math.abs(w.lat - this.off) > 1.9) continue; if (-ds - half - w.len / 2 < (w.along - vf) * 2.2 + 3 && Math.abs(myLat - this.off) > 2.2) { acc = Math.min(acc, vf > 0.5 ? -B_EASY : -1); this.note = 'merge'; } }

    // ---- the lane changes drawn into the line (setting up for a turn or the stop): made only into a gap. If a car is alongside or
    // coming up in that lane, hold the lane we are in (the line is followed with the change taken back out), let it by, and slow for
    // the gap if the corner is getting close.
    {
      const chg = here.jn ? 0 : here.chg || 0;
      if (!chg) { this.hold = false; }
      else {
        const done = Math.abs((here.dlat || 0) * (1 - this.holdK)) > Math.abs(chg) * 0.55;       // more than half way over: finish it
        let starts = Math.abs(here.dlat || 0) > 0.1; if (!starts) { const q = P[Math.min(N - 1, me.i + Math.ceil((8 + vf * 1.3) / STEP))]; starts = q.seg === here.seg && !q.jn && Math.abs(q.dlat || 0) > 0.1; }
        if (done) this.hold = false;
        else if (starts) {
          let clear = true;
          for (const w of others) { const q = P[w.i]; if (q.jn || q.seg !== here.seg) continue; if (Math.abs(w.lat - (chg - (q.dlat || 0))) > 2.2) continue; const ds = w.s - sMe; if (ds > -(8 + Math.max(0, w.along - vf) * 2.6) && ds < 9 + Math.max(0, vf - w.along) * 1.5) { clear = false; break; } }
          this.hold = !clear;
        }
        if (this.hold) { const dMust = P[here.endI].s - sMe - 24; if (dMust < 12 + vf * 2.6) halt(Math.max(0, dMust), 'gap', 2.2); }
      }
      this.holdK += clamp((this.hold ? 1 : 0) - this.holdK, -0.42 * dt, 2.5 * dt);
    }

    // ---- lane choice: pass a slow car when the next lane is open; come back when the line needs it
    const lw = 3.3, ahead = P[Math.min(N - 1, me.i + Math.ceil((30 + vf * 2.5) / STEP))];
    const free = (L, far) => { for (const w of others) { if (Math.abs(w.lat - L) > 2.5) continue; const ds = w.s - sMe; if (ds > -(7 + Math.max(0, w.along - vf) * 2.5) && ds < 9 + Math.max(0, vf - w.along) * 1.6) return false; if (far && ds > 0 && ds < far && w.along < vf - 1.5) return false; } return true; };
    if (this.shift < ahead.lo - 0.1 || this.shift > ahead.hi + 0.1 || this.shift < here.lo - 0.1 || this.shift > here.hi + 0.1) {
      const back = clamp(this.shift, Math.max(ahead.lo, here.lo), Math.max(Math.max(ahead.lo, here.lo), Math.min(ahead.hi, here.hi)));
      if (free(back) || Math.abs(this.shift - back) < 1) this.shift = back;
      else {   // someone is in the way in that lane: drop in behind a car that is ahead of us, but carry on past one we are overtaking
        let aheadOfUs = false, closing = false; for (const w of others) { if (Math.abs(w.lat - back) > 2.5) continue; const ds = w.s - sMe; if (ds > 1 && ds < 14 + vf * 1.5) aheadOfUs = true; else if (ds <= 1 && ds > -25 && w.along > vf + 0.5) closing = true; }
        if (aheadOfUs) { acc = Math.min(acc, -1.6); this.note = 'merge back'; } else if (closing) { acc = Math.min(acc, -0.6); this.note = 'merge back'; } else this.note = this.note || 'passing';
      }
    } else if (lead && lead.w.c && this.shiftT <= 0 && vf > 2.5 && dEnd > 170 && lead.gap < 10 + vf * 2.2 && lead.v < Math.min(here.venv, here.cruise) - 2.5 && Math.abs(this.off - this.shift) < 0.4) {
      for (const d of [-lw, lw]) { const L = this.shift + d; if (L < Math.max(here.lo, ahead.lo) - 0.1 || L > Math.min(here.hi, ahead.hi) + 0.1) continue; if (!free(L, lead.gap + 25)) continue; this.shift = L; this.shiftT = 3; break; }
    }

    if (arrived && sp < 0.3) acc = -2;
    pedals(acc);
    // wedged against something with nothing in front: back out
    if (this.rev > 0) { this.rev -= dt; I.throttle = 0; I.brake = 0.7; I.steer = -I.steer * 0.6; return; }
    if (sp < 0.25 && acc > 0.8) { this.stuck += dt; if (this.stuck > 2.5) { this.rev = 1.2; this.stuck = 0; } } else this.stuck = 0;
  }

  // turn the acceleration wanted into pedal positions for this car, eased so the body does not nod
  pedals(a, v, I, dt) {
    const vf = v.vf, spc = v.spec, drag = 0.12 * vf + 0.0042 * vf * Math.abs(vf);
    let thr = 0, brk = 0;
    if (vf < 0.7 && a <= 0) { I.handbrake = true; }      // the brake pedal is also reverse at a standstill: hold the car on the handbrake
    else if (a + drag > 0.05) thr = clamp((a + drag) / (spc.acc * Math.max(0.05, 1 - (vf / spc.top) ** 2) * (vf < 8 ? 1.15 : 1)), 0, 1);
    else if (a < -drag - 0.5 - 0.05) brk = clamp((-a - drag) / 15, 0, 1);
    else { thr = 0.02; }       // feather: neither pedal would give engine braking beyond what was asked
    const k = Math.min(1, dt * (brk > this.brk ? 14 : 7)); this.thr += (thr - this.thr) * Math.min(1, dt * 6); this.brk += (brk - this.brk) * k;
    if (brk > 0) this.thr = 0; if (thr > 0.02) this.brk *= 0.8;
    I.throttle = this.thr < 0.015 ? 0 : this.thr; I.brake = this.brk < 0.01 ? 0 : this.brk;
  }
}
