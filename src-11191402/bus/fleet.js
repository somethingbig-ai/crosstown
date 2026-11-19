// bus/fleet.js (bus lane, Nov 15): the buses themselves. Each is an ordinary entry of game.traffic.cars (type 'citybus'), so signals, queues,
// junction manners, the player's car and everything that reads traffic treat it as traffic. What is ours, all by wrapping (traffic.js is not edited):
//   chooseNext  a bus in service takes its route's next block (and a lane for it)
//   gapAhead    a bus that will serve the stop ahead sees a "wall" at the stop: it brakes gently to a stand with its front door at the pole
//   pickType    the random 'bus' of the kit's mix is not drawn any more (the scheduled buses replace it; the car target is untouched)
// At a stop: pull to the kerb (the file's own sideways offset c.bs / c.lo), kneel, doors, people off and on, doors, rise, signal, pull out.
// The timetable is simple on purpose: every line has a headway by the hour (from the real timetable, divided by TIME so a wait is a minute or
// two, not ten) and buses run it at an even pace; a bus becomes real when its place on the line comes within a few blocks of the player, out of
// sight, exactly as cars do, and is forgotten when it is far behind.
import { clamp, wrapPi } from '../geo.js';

export const DEF = { type: 'citybus', len: 12.2, wid: 2.59, hgt: 3.2, radius: 0.49, wheelbase: 7.2, body: [], wheels: [] };
export const SPEC = { top: 24, acc: 3.0, grip: 6.0 };
const A_STOP = 1.5, V_AVG = 5.2, T0 = 5000;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

export class Fleet {
  constructor(game, net, dims) {
    const g = (this.g = game), P = g.P; this.net = net; this.D = dims; this.buses = []; this.rand = mulberry(977); this.on = true;
    this.TIME = clamp(+(P && P.get('bustime')) || 5, 0.5, 60); this.MAX = clamp(+(P && P.get('busmax')) || 10, 0, 16); this.tick = 0; this.first = true; this.late = false; this.kn = { spawned: 0, stops: 0, skipped: 0, ended: 0, lost: 0, shortStop: 0 };
    Object.defineProperty(g.kit.cars, 'citybus', { value: DEF, enumerable: false, configurable: true, writable: true });      // found by name, not met by a loop over the kinds (the streets layer builds a model for every kind it lists)
    for (const L of net.lines) { L.phase = hash(L.key) * 997; L.used = new Set(); L.box = L.seq.reduce((a, q) => { const b = q.e.box; return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }, [1e9, 1e9, -1e9, -1e9]);
      const R = g.roads, t1 = {}, t2 = {}; L.seq.forEach((q, k) => { const n = L.seq[k + 1]; q.turn = n ? wrapPi(R.lanePos(n.e, n.dir, 0, 0, t2).h - R.lanePos(q.e, q.dir, 0, q.e.len, t1).h) : 0;
        const kl = this.kerbLane(q.e, q.dir); q.li = kl.li; q.lo = kl.lo; }); }
    this.placeStops();
    const T = g.traffic, self = this;
    const cn0 = T.chooseNext.bind(T); T.chooseNext = function (c) { const B = c.bus; if (!B || !B.line) return cn0(c); const n = B.line.seq[B.k + 1]; if (!n || c.e !== B.line.seq[B.k].e) { self.endService(B, n ? 'lost' : 'end'); return cn0(c); } return { e: n.e, dir: n.dir, li: self.laneFor(B.line, B.k + 1) }; };
    // (a bus does not brake for the rider standing inside it: he is taken off the map for the look ahead)
    const ga0 = T.gapAhead.bind(T); T.gapAhead = function (c, look) { const B = c.bus, pl = g.player, hide = B && B.aboard && !pl.vehicle; if (hide) pl.x += 1e6; let gp; try { gp = ga0(c, look); } finally { if (hide) pl.x -= 1e6; } if (B && B.gap < gp) { T._blk = null; T._be = null; return B.gap; } return gp; };
  }
  // is (x, y) on a sidewalk? As game.statics.onSidewalk, but the data's few giant outlines (whole districts drawn as one "block", which make the
  // roadway inside them read as sidewalk: 6th Avenue at 42nd, W 26th Street) are left out: a real block is no more than 300 m by 950 m
  walk(x, y) { const st = this.g.statics, a = st.blocks.get(st.key(Math.floor(x / 64), Math.floor(y / 64))); if (!a) return false;
    for (const b of a) { if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1 || (b.x1 - b.x0) * (b.y1 - b.y0) > 1.2e6 || (b.pv && !b.pv(x, y))) continue;     /* b.pv: streets handoff-paved2 (geo.js addBlock): an area's fill polygon is sidewalk only off the streets and inside its area */
      if (pip(x, y, b.poly.ext)) { let hole = false; for (const h of b.poly.holes || []) if (pip(x, y, h)) { hole = true; break; } if (!hole) return true; } } return false; }
  // metres from the middle of lane li to the kerb on its right, at s along a block (max when there is none within reach)
  kerbAt(e, dir, s, max = 9, li = -1) { const R = this.g.roads, p = this._kp || (this._kp = {}); R.lanePos(e, dir, li < 0 ? this.kerbLane(e, dir).li : li, s, p); const rx = Math.sin(p.h), ry = -Math.cos(p.h); for (let d = 0; d <= max; d += 0.1) if (this.walk(p.x + rx * d, p.y + ry * d)) return d; return max; }
  // the lane a bus runs in on a block, and how far it keeps to the left in it. The data's kerb lane is drawn for a car, and under a plaza (7th Avenue
  // and 42nd Street at Times Square) it is no roadway at all: where the kerb comes within a bus's half width of the lane's middle the bus keeps that
  // much left (to 1.3 m); where the lane's middle is itself under the sidewalk it takes the next lane.
  kerbLane(e, dir) { const c = e._busLane || (e._busLane = {}); if (c[dir]) return c[dir]; const R = this.g.roads, n = Math.max(1, R.laneCount(e, dir)), need = DEF.wid / 2 + 0.3; let out = null;
    for (let li = n - 1; li >= Math.max(0, n - 2) && !out; li--) { let rk = 9; for (let s = 10; s <= e.len - 10; s += 6) rk = Math.min(rk, this.kerbAt(e, dir, s, 2.6, li)); if (rk >= need - 1.3 || li === Math.max(0, n - 2)) out = { li, lo: rk >= need ? 0 : Math.max(-1.3, rk - need), rk }; }
    return (c[dir] = out || { li: n - 1, lo: 0, rk: 9 }); }
  // room to move a 12 m bus over into lane li (the game's own laneFree is sized for a car)
  laneFree(c, li) { const g = this.g; for (const o of g.traffic.cars) { if (o === c || o.junction || o.e !== c.e || o.dir !== c.dir || o.li !== li) continue; const ds = o.s - c.s; if (ds > -(13 + o.v * 2.2) && ds < 14 + c.v) return false; } const p = g.roads.lanePos(c.e, c.dir, li, c.s, this._lp || (this._lp = {})); for (const v of g.vehicles) if (Math.hypot(v.x - p.x, v.y - p.y) < 12) return false; return true; }
  // the lane a bus keeps on block k of its line: the right-hand one, unless it turns left at the block's end
  laneFor(L, k) { const q = L.seq[k]; return q.turn > 0.5 ? 0 : q.li; }

  // ------------------------------------------------------------------ the stops on the street: kerb, pole, where the bus stands
  placeStops() {
    const g = this.g, R = g.roads, st = g.statics, D = this.D, p = {}, doorX = D.doors.front.x, half = DEF.len / 2;
    for (const L of this.net.lines) for (const s of L.stops) {
      const q = L.seq[s.k], e = q.e, n = Math.max(1, R.laneCount(e, q.dir)), nd = R.nodes[R.endNode(e, q.dir)], n0 = R.nodes[R.startNode(e, q.dir)];
      // the bus's middle stands doorX behind the pole; never over the stop line ahead, never with its tail in the junction behind
      const hi = (nd.e.length >= 3 ? R.stopS(e, q.dir) : e.len - 1) - half - 0.5, lo = (n0.e.length >= 3 ? n0.r : 0) + half + 1.5;
      s.sc = hi < lo ? (hi + lo) / 2 : clamp(s.s - doorX, lo, hi); const sp = clamp(s.sc + doorX, 1, e.len - 1);
      R.lanePos(e, q.dir, q.li, sp, p); const rx = Math.sin(p.h), ry = -Math.cos(p.h); let dk = -1;
      for (let d = 0.5; d <= 9; d += 0.1) if (this.walk(p.x + rx * d, p.y + ry * d)) { dk = d; break; }
      s.kerb = dk > 0; if (dk < 0) dk = e.lw / 2 + 0.2;
      // the kerb is not always straight: the bus stands clear of its nearest point along the whole of its length (and the run in)
      let dmin = dk; if (s.kerb) for (let a = s.sc - half - 8; a <= s.sc + half + 0.5; a += 1.2) if (a > 2 && a < e.len - 2) dmin = Math.min(dmin, this.kerbAt(e, q.dir, a, dk, q.li));
      s.lo = clamp(dmin - DEF.wid / 2 - 0.3, -1.3, 5); s.h = p.h; s.kx = p.x + rx * dk; s.ky = p.y + ry * dk; s.px = p.x + rx * (dk + 0.55); s.py = p.y + ry * (dk + 0.55);
      const S = s.stop; if (S.kx === undefined || (s.kerb && !S.kerb)) { S.kx = s.kx; S.ky = s.ky; S.px = s.px; S.py = s.py; S.h = s.h; S.kerb = s.kerb; S.sel = S.sel || L.sel; S.x = s.px; S.y = s.py; } if (L.sel) S.sel = true;
    }
  }
  // parked cars standing in a bus stop are taken away (once, after every layer that lines the kerbs has loaded); double-parked ones too
  clearStops() {
    const g = this.g; let n = 0;
    for (const S of this.net.stops) { if (S.kx === undefined) continue; const fx = Math.cos(S.h), fy = Math.sin(S.h);
      for (const sl of g.parked.near(S.kx, S.ky, 30, [])) { const dx = sl.x - S.kx, dy = sl.y - S.ky, f = dx * fx + dy * fy, sd = dx * fy - dy * fx; if (f > -24 && f < 10 && sd > -4.5 && sd < 2.5) { g.parked.take(sl); n++; } }
      for (const c of g.traffic.cars) if (c.dbl) { const dx = c.x - S.kx, dy = c.y - S.ky, f = dx * fx + dy * fy, sd = dx * fy - dy * fx; if (f > -30 && f < 14 && sd > -7 && sd < 2.5) c.dead = true; } }
    this.kn.cleared = n;
  }
  // a car double-parked in a bus stop (the streets layer stands some along the avenues) is taken away when it appears: looked at once per car
  clearDouble() {
    const g = this.g; if (!this._sg) { this._sg = new Map(); for (const S of this.net.stops) { if (S.kx === undefined) continue; const k = Math.floor(S.kx / 64) * 65536 + Math.floor(S.ky / 64); let a = this._sg.get(k); if (!a) this._sg.set(k, (a = [])); a.push(S); } }
    for (const c of g.traffic.cars) { if (!c.dbl || c._busChk) continue; c._busChk = 1; const ci = Math.floor(c.x / 64), cj = Math.floor(c.y / 64);
      for (let i = ci - 1; i <= ci + 1 && !c.dead; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = this._sg.get(i * 65536 + j); if (!a) continue; for (const S of a) { const fx = Math.cos(S.h), fy = Math.sin(S.h), dx = c.x - S.kx, dy = c.y - S.ky, f = dx * fx + dy * fy, sd = dx * fy - dy * fx; if (f > -32 && f < 16 && sd > -7 && sd < 2.5) { c.dead = true; this.kn.dbl = (this.kn.dbl || 0) + 1; break; } } if (c.dead) break; } }
  }

  // ------------------------------------------------------------------ the timetable
  headway(L) { const N = this.g.night, h = Math.floor(N && isFinite(N.tod) ? N.tod : 13) % 24; let m = L.hw && L.hw[h]; if (!m) m = 30; return clamp(m, 3, 30) * 60 / this.TIME; }
  at(L, S, out) { let k = 0; const q = L.seq; while (k + 1 < q.length && q[k + 1].s0 <= S) k++; out.k = k; out.s = clamp(S - q[k].s0, 0, q[k].e.len); return out; }
  spawnTick() {
    const g = this.g, R = g.roads, T = g.traffic, fx = g.focus.x, fy = g.focus.y, now = g.t + T0, o = {}, p = {};
    let live = 0; for (const B of this.buses) if (B.c) live++;
    for (const L of this.net.lines) {
      if (live >= this.MAX) break; const b = L.box; if (fx < b[0] - 400 || fx > b[2] + 400 || fy < b[1] - 400 || fy > b[3] + 400) continue;
      const H = this.headway(L), i1 = Math.floor((now - L.phase) / H), i0 = Math.ceil((now - L.phase - L.len / V_AVG) / H);
      if (L.used.size > 40) for (const i of L.used) if (i < i0) L.used.delete(i);
      for (let i = i0; i <= i1; i++) {
        if (L.used.has(i)) continue; const S = (now - L.phase - i * H) * V_AVG; if (S < 8 || S > L.len - 30) continue;
        this.at(L, S, o); const q = L.seq[o.k]; if (o.s < 14 || o.s > q.e.len - 16 || q.e.s0 === undefined) continue;
        const li = this.laneFor(L, o.k); R.lanePos(q.e, q.dir, li, o.s, p); const d = Math.hypot(p.x - fx, p.y - fy);
        if (d > 385 || d < (this.first ? 45 : 150) || !g.bounds.in(p.x, p.y, -5)) continue;
        if (!this.first && d < 300 && g.statics.raycast(fx, fy, p.x, p.y) >= 1) continue;
        let ok = true; for (const c of T.cars) if (Math.abs(c.x - p.x) < 20 && Math.abs(c.y - p.y) < 20 && Math.hypot(c.x - p.x, c.y - p.y) < (c.bus ? 60 : 16)) { ok = false; break; } if (!ok) continue;
        for (const B of this.buses) if (B.line === L && Math.abs(B.S - S) < 140) { ok = false; break; } if (!ok) { L.used.add(i); continue; }
        if (!this.spawn(L, o.k, li, o.s)) continue;
        L.used.add(i); live++; break;
      }
    }
    this.first = false;
  }
  spawn(L, k, li, s) {
    const g = this.g, T = g.traffic, q = L.seq[k]; let c = null; for (let tr = 0; tr < 4 && !c; tr++) c = T.spawn(q.e, q.dir, li, s); if (!c) return null;
    c.type = 'citybus'; c.def = DEF; c.color = 0xf4f5f6; c.dbl = false; c._vv = null; c.v0 = this.cruise(q.e, L); c.v = c.v0 * 0.7; g.roads.lanePos(q.e, q.dir, c.li, s, c);
    // The traffic slot was checked with the seed car's dimensions.
    if (T.spawnOccupied(c)) { T.remove(c); return null; }
    const B = { id: ++this.kn.spawned, no: 4000 + Math.floor(this.rand() * 5800), c, v: null, line: L, k, ni: 0, state: 'run', t: 0, gap: 1e9, will: null, stopReq: false, kneel: 0, doorF: 0, doorR: 0, riders: 6 + Math.floor(this.rand() * 26), on: 0, off: 0, roll: 0, pitch: 0, vPrev: c.v, hPrev: c.h, S: q.s0 + s, x: c.x, y: c.y, h: c.h, z: 0, sign: L.signI === undefined ? -1 : L.signI, blink: 0, stopAt: null, last: null, hold: 0, slow: 0, acc: 0, yawV: 0 };
    while (B.ni < L.stops.length && L.stops[B.ni].S < B.S + 20) B.ni++;
    c.bus = B; this.buses.push(B); return B;
  }
  cruise(e, L) { return (e.ave ? 10.2 : 7.6) + (L && L.sel ? 0.8 : 0); }
  endService(B, why) { if (!B.line) return; B.last = B.line; B.line = null; B.sign = -1; B.gap = 1e9; B.will = null; B.state = 'run'; if (B.c) { B.c.bs = 0; if (B.c.lo) B.c.lo0 = B.c.lo; } this.kn[why === 'lost' ? 'lost' : 'ended']++; }
  // who is waiting at a stop (the people lane's line there, when it has one), and is the player
  waiting(st) { const g = this.g; let n = -1; try { if (this.count) n = this.count(st); } catch (e) {} const pl = g.player; const me = !pl.vehicle && !(pl.busy && pl.busy.bus) && Math.hypot(pl.x - st.px, pl.y - st.py) < 14; return { n, me }; }

  // ------------------------------------------------------------------ once a game step, before traffic moves
  update(dt) {
    const g = this.g, T = g.traffic, R = g.roads;
    if (!this.late) { this.late = true; this.clearStops();
      // the game's own car drawing (only when the streets layer is off) asks for a batch per kind. Made HERE, after every layer has loaded: the streets layer's vehicles walk game.batches at load and expect the game's own batches there
      try { if (g.batches && !('citybus' in g.batches)) g.batches.citybus = { begin() {}, add() {}, end() {}, meshes: [], wheelMeshes: [] }; } catch (e) {} const p0 = T.pickType.bind(T); T.pickType = function () { for (let k = 0; k < 6; k++) { const t = p0(); if (t !== 'bus') return t; } return 'sedan'; }; for (const c of T.cars) if (c.type === 'bus') c.dead = true; }
    this.tick -= dt; if (this.tick <= 0 && this.on) { this.tick = 0.5; this.spawnTick(); this.clearDouble(); }
    for (let i = this.buses.length - 1; i >= 0; i--) {
      const B = this.buses[i], c = B.c;
      if (!c) { if (!B.v || !g.vehicles.includes(B.v)) { if (B.keep) continue; this.buses.splice(i, 1); } else this.poseOf(B, B.v, dt); continue; }
      if (c.dead || c.bus !== B || !T.cars.includes(c)) { if (B.aboard) { B.c = null; B.keep = true; continue; } this.buses.splice(i, 1); continue; }
      const L = B.line; B.gap = 1e9; B.blink = 0;
      if (L) {
        // which block of the line it is on
        if (!c.junction && c.e !== L.seq[B.k].e) { let f = -1; for (let k = B.k + 1; k < Math.min(L.seq.length, B.k + 4); k++) if (L.seq[k].e === c.e && L.seq[k].dir === c.dir) { f = k; break; } if (f < 0) this.endService(B, 'lost'); else B.k = f; }
      }
      if (B.line) {
        const q = L.seq[B.k]; c.v0 = this.cruise(q.e, L); if (!c.junction) B.S = q.s0 + c.s;
        let st = L.stops[B.ni]; while (st && B.state === 'run' && st.S - doorBack(this.D) < B.S - 8) { B.ni++; B.will = null; st = L.stops[B.ni]; }
        const here = st && st.k === B.k && !c.junction, dS = st ? (here ? st.sc - c.s : st.S - this.D.doors.front.x - B.S) : 1e9;
        if (B.state === 'run' && !c.junction && !c.bd && !(B.outT > 0)) { const want = c.li === q.li ? q.lo : 0; if (want) c.bs = want; else if (c.bs && c.bs < 0) { c.bs = 0; if (c.lo) c.lo0 = c.lo; } }
        if (B.state === 'run') {
          if (st && B.will === null && dS < 110) { const w = this.waiting(st); B.will = B.stopReq || w.me || w.n > 0 || !!B.aboard && B.ni === L.stops.length - 1 || this.rand() < (w.n === 0 ? 0.35 : L.sel || L.ltd ? 0.95 : 0.8); if (!B.will) this.kn.skipped++; }
          if (st && B.will === false && dS < 60 && (B.stopReq || this.waiting(st).me)) B.will = true;
          if (st && B.will && here && dS < 34 && dS > -2) { B.state = 'in'; B.t = 0; B.slow = 0; }
          else if (st && here && dS < -2) { B.ni++; B.will = null; }
          // lane discipline: left lane before a left turn once the block's stops are done, else the right-hand lane
          if (!c.junction && Math.abs(c.lo) < 0.05 && !c.bd && (g.frame + B.id * 7) % 20 === 0) { const want = q.turn > 0.5 && !(st && st.k === B.k && B.will !== false) ? 0 : q.turn > 0.5 ? c.li : q.li;
            if (want !== c.li && c.s > 12 && c.s < q.e.len - 30) { const l2 = c.li + Math.sign(want - c.li); if (this.laneFree(c, l2)) { c.lo = c.lo0 = R.laneOffset(c.e, c.dir, c.li) - R.laneOffset(c.e, c.dir, l2); c.li = l2; c.plan = null; if (c.nx) c.nx = undefined; } } }
        }
        // don't block the box: a bus does not drive into a junction while another bus stands at a stop just beyond it with no room behind
        if (B.state === 'run' && !c.junction && c.plan && c.plan.next) { const nx = c.plan.next; for (const o of this.buses) { const oc = o.c; if (o === B || !oc || oc.junction || oc.e !== nx.e || oc.dir !== nx.dir || oc.v > 1.5 || (o.state !== 'dwell' && o.state !== 'in')) continue;
            if (oc.s - DEF.len / 2 < c.plan.s1 + DEF.len + 2.5) { const dLine = (c.plan.big ? R.stopS(c.e, c.dir) : c.plan.sEnt) - c.s - DEF.len / 2; if (dLine > -1) B.gap = Math.min(B.gap, 1.8 + Math.max(0, dLine) * (A_STOP / 4.5)); } } }
        // last resort, as the game's own for a car: a bus that has stood a long time on a green with nothing to wait for slips through what holds it (never through the player's cars)
        if (B.state === 'run' && c.v < 0.05 && B.gap > 1e8 && (c.junction || R.signal(R.endNode(c.e, c.dir), c.e, g.t) === 'g')) { B.standT = (B.standT || 0) + dt; if (B.standT > 24) { c.ghost = 2.5; B.standT = 12; this.kn.slipped = (this.kn.slipped || 0) + 1; } } else if (c.v > 1) B.standT = 0;
        if (B.state === 'in') {
          B.t += dt; B.blink = 1; c.held = 0;      // (it does not pull out to pass what stands at its own stop)
          // a bus already at this stop: this one draws up behind it, and opens its doors there
          let dQ = dS, behind = false; for (const o of this.buses) { const oc = o.c; if (o === B || !oc || oc.junction || oc.e !== c.e || oc.dir !== c.dir || oc.s <= c.s || (o.state !== 'dwell' && o.state !== 'in')) continue; const d = oc.s - DEF.len - 1.3 - c.s; if (d < dQ) { dQ = d; behind = true; } }
          // the kerb is reached from the kerb-side lane only: first into that lane, then over to the kerb
          if (c.li !== q.li && Math.abs(c.lo) < 0.05 && !c.bd && c.s > 6) { const l2 = c.li + Math.sign(q.li - c.li); if (this.laneFree(c, l2)) { c.lo = c.lo0 = R.laneOffset(c.e, c.dir, c.li) - R.laneOffset(c.e, c.dir, l2); c.li = l2; c.plan = null; if (c.nx) c.nx = undefined; } }
          if (Math.abs(st.lo) > 0.05 && !c.bd && dS < 8 + (behind ? DEF.len + 2 : 0) && c.li === q.li && Math.abs(c.lo - (c.bs || 0)) < 0.3 + Math.abs(st.lo)) c.bs = st.lo;
          B.gap = 1.8 + Math.max(0, dQ) * (A_STOP / 4.5) + (dQ > 6 ? 0.25 : 0);
          if (c.v < 0.06) B.slow += dt; else B.slow = 0;
          if ((c.v < 0.06 && dQ < 1.6) || B.slow > 9 && dS < 16) { if (dS >= 1.6) this.kn.shortStop++; B.state = 'dwell'; B.t = 0; B.stopAt = st; this.kn.stops++; this.arrive(B, st); }
          else if (dS < -4) { B.state = 'run'; B.ni++; B.will = null; c.bs = 0; if (c.lo) c.lo0 = c.lo; }
        }
        if (B.state === 'dwell') {
          B.t += dt; B.gap = 0; c.stun = Math.max(c.stun, 0.25); c.wait = 0; c.mvT = g.t; c.ghost = 0; c.v = 0; if (st && Math.abs(st.lo) > 0.05 && !c.bd) c.bs = st.lo;
          if (B.hold > 0) { B.hold -= dt; if (B.t > B.dwellT + 14) B.hold = 0; } const open = B.t > 0.5 && (B.t < B.dwellT || (B.hold > 0 && B.t < B.dwellT + 14));      /* the driver waits for someone coming for the door, but not for ever */
          B.kneel = clamp(B.kneel + (open ? dt / 1.1 : B.doorF < 0.05 ? -dt / 0.9 : 0), 0, 1);
          B.doorF = clamp(B.doorF + (open && B.kneel > 0.5 ? dt / 0.9 : !open ? -dt / 1.0 : 0), 0, 1);
          B.doorR = clamp(B.doorR + (open && B.kneel > 0.5 && (B.off > 0 || B.aboard || B.rearOpen) ? dt / 0.9 : !open ? -dt / 1.0 : 0), 0, 1);
          if (B.t > 0.5 && !open && B.doorF <= 0 && B.doorR <= 0 && B.kneel <= 0) { B.state = 'run'; B.ni++; B.will = null; B.stopReq = false; B.rearOpen = false; B.stopAt = null; c.bs = 0; if (c.lo) c.lo0 = c.lo; c.stun = 0; B.outT = 3; this.depart(B, st); }
        }
        if (B.outT > 0) { B.outT -= dt; B.blink = -1; }
      } else { B.doorF = Math.max(0, B.doorF - dt); B.doorR = Math.max(0, B.doorR - dt); B.kneel = Math.max(0, B.kneel - dt); if (c.bs && !c.bd) { c.bs = 0; if (c.lo) c.lo0 = c.lo; } }
      this.poseOf(B, c, dt);
    }
  }
  // what the bus's body does: where it is, and how it leans as it brakes, pulls away and turns (felt inside)
  poseOf(B, o, dt) {
    const v = o.v !== undefined && o.vx === undefined ? o.v : Math.hypot(o.vx || 0, o.vy || 0) * Math.sign(o.vf || 1); B.x = o.x; B.y = o.y; B.z = o.z || 0;
    const acc = clamp((v - B.vPrev) / Math.max(dt, 1e-3), -6, 4), yawV = clamp(wrapPi(o.h - B.hPrev) / Math.max(dt, 1e-3), -1, 1); B.vPrev = v; B.hPrev = o.h; B.h = o.h; B.v0 = v;
    B.acc += (acc - B.acc) * Math.min(1, dt * 5); B.yawV += (yawV - B.yawV) * Math.min(1, dt * 5);
    if (o.roll !== undefined && o.vx !== undefined) { B.roll = o.roll; B.pitch = o.pitch; } else { B.roll += (clamp(v * B.yawV * 0.011, -0.05, 0.05) - B.roll) * Math.min(1, dt * 3); B.pitch += (clamp(B.acc * 0.006, -0.02, 0.014) - B.pitch) * Math.min(1, dt * 3.5); }
    B.spin = o.spin || 0; B.steer = o.steer || 0; B.brake = o.brake !== undefined ? o.brake : !!o.braking;
  }
  // at the stop: how many get off and on, how long the doors stay open
  arrive(B, st) {
    const w = this.waiting(st); B.off = Math.min(B.riders, Math.floor(this.rand() * 4.5 * (B.riders / 30 + 0.3)) + (B.ni === B.line.stops.length - 1 ? B.riders : 0)); B.on = w.n >= 0 ? Math.min(w.n, 12) : Math.floor(this.rand() * 4);
    B.dwellT = clamp(3.6 + 1.1 * (B.on + Math.min(B.off, 8)), 5.5, 17); B.hold = 0; B.moved = false;
    if (this.onArrive) try { this.onArrive(B, st); } catch (e) {}
  }
  depart(B, st) { B.riders = clamp(B.riders - B.off + B.on, 0, 60); B.on = B.off = 0; if (this.onDepart) try { this.onDepart(B, st); } catch (e) {} }
  // the door points of a bus on the map: [x, y] of the middle of the doorway (at the body's side), and of a spot `out` metres outside it
  door(B, which, out = 0) { const d = this.D.doors[which], c = Math.cos(B.h), s = Math.sin(B.h), z = DEF.wid / 2 + out; return [B.x + c * d.x + s * z, B.y + s * d.x - c * z]; }
  // model frame (x forward, z right) -> map
  toMap(B, x, z, out) { const c = Math.cos(B.h), s = Math.sin(B.h); out[0] = B.x + c * x + s * z; out[1] = B.y + s * x - c * z; return out; }
  nextStop(B) { return B.line ? B.line.stops[B.ni] || null : null; }
  report() { return { lines: this.net.lines.length, stops: this.net.stops.length, live: this.buses.map((B) => (B.line ? B.line.key : 'out') + ' ' + B.state + ' k' + B.k + ' v' + (B.v0 || 0).toFixed(1) + (B.c && B.c.junction ? ' JN' : '')), kn: this.kn }; }
}
const doorBack = (D) => D.doors.front.x;
function pip(x, y, poly) { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) r = !r; } return r; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
