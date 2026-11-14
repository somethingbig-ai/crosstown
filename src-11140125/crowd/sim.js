// crowd/sim.js: the crowd's behaviour. A cheap CPU sim of a few hundred agents on the walking network of nav.js.
//  - walkers keep to the right half of the sidewalk band, pass slower people and stand-still obstacles, and steer with a turn-rate limit
//    (velocity always along the heading, pace = the walk clip's own speed, so feet do not slide and corners are arcs);
//  - at a junction they plan a few ways ahead towards their own direction of travel: go round the corner, or cross on the walk phase
//    of the game's signal (roads.signal) when no car is coming, else wait at the kerb in a loose bunch;
//  - pairs and threes walk abreast; some people stand (by the wall, at the kerb, on the plazas), alone or facing each other;
//  - the population is fixed in the world: each way has its own density; people are added and taken away only where the camera
//    cannot see them (behind it, behind a building, or far off; at distance also at the building line, as from a doorway);
//  - the player's car: people in its path run aside (Jog), one that is struck goes down and is reported to game.onPedHit.
// Public feedback, Nov 11 (people/crowd-fb; each has its own off switch in the address, ?crowdfb=0 turns all of them off):
//   ?crowdcars=0   people no longer keep out of the player's standing or creeping cars (they walk round them, a car that stops on people is left)
//   ?crowdwalls=0  people who run (from a car, from shots) no longer follow walls, and go back to a walk in a straight line through anything
//   ?crowdtwins=0  nobody minds their double: the same body is put within 14 m of itself, the same top colour side by side
// No three.js here: render.js reads the agents' public fields (x y z h scale fall char clip ph clipB phB blend tint acc).
import { clamp, wrapPi, rng, TAU } from '../geo.js';
import { bandAt } from './nav.js';
import { plainSlide } from '../move/plainfall.js';

const RP = 230, R_NEAR = 45, R_BACK = 95, BACK_F = 0.25, CELL = 2.5, GN = 216, TURN = 2.7, REF_WEIGHT = 2900;
const B = { lo: 0, hi: 0 }, B2 = { lo: 0, hi: 0 }, _o = {};
const srgb = (c) => (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);
const NO_TINT = 0xffffff;

export class CrowdSim {
  constructor(game, nav, opts = {}) {
    this.g = game; this.nav = nav; this.rand = rng(opts.seed || 90210); this.agents = []; this.road = []; this.frame = 0; this.popT = 0; this.nextId = 1;
    this.setCount(opts.count || 450);
    const cast = opts.cast || { characters: [{ name: 'a', height: 1.75 }], clips: { Walk: { speed: 1.36, duration: 1.1 }, IdleShift: { speed: 0, duration: 6.8 } } };
    this.chars = cast.characters; this.clipNames = Object.keys(cast.clips); this.clips = this.clipNames.map((n, i) => Object.assign({ i, name: n }, cast.clips[n]));
    const need = cast.clip_accessory || {}, by = (re) => this.clips.find((c) => re.test(c.name));
    for (const c of this.clips) c.needs = need[c.name] || (/^carrybox/i.test(c.name) ? 'box' : null);
    // plain walks: any looping clip that covers ground at a walking pace and needs nothing in the hands
    this.walks = this.clips.filter((c) => c.speed > 0.4 && c.speed < 2.3 && !c.needs && !/jog|run|carry/i.test(c.name));
    this.idles = this.clips.filter((c) => /^idle/i.test(c.name) && !c.seat); if (!this.idles.length) this.idles = [this.clips[0]];
    this.waitClip = by(/^wait/i); this.talkA = by(/^talka$/i); this.talkB = by(/^talkb$/i);
    this.jog = by(/^jog$/i) || by(/^run$/i) || this.walks.reduce((a, b) => (a.speed > b.speed ? a : b));
    // what a thing in the hand does to the walk and to the standing pose: {phone: {walk, stand}, ...}
    this.held = {}; for (const c of this.clips) if (c.needs && !c.seat) { const h = this.held[c.needs] || (this.held[c.needs] = { stands: [] }); if (c.speed > 0.4) h.walk = c; else { h.stands.push(c); if (/look/i.test(c.name)) h.stands.push(c, c); h.stand = c; } }
    // sitting: single clips, and pairs captured together (partner / partner_at in the cast file)
    this.sits = this.clips.filter((c) => c.seat && !c.partner); this.sitPairs = this.clips.filter((c) => c.seat && c.partner && this.clips.some((d) => d.name === c.partner) && c.name < c.partner).map((c) => [c, this.clips.find((d) => d.name === c.partner)]);
    this.seats = (opts.seats || []).map((q, i) => Object.assign({ who: null, u: (Math.sin(q.x * 12.9898 + q.y * 78.233) * 43758.5453) % 1 }, q)); for (const q of this.seats) { q.u = Math.abs(q.u); const t = Math.sin(Math.round(q.x / 2.8) * 91.7 + Math.round(q.y / 2.8) * 37.3) * 43758.5453; q.ut = Math.abs(t % 1); }
    this.acc = cast.accessories || {}; this.accNames = Object.keys(this.acc);
    // which hand each carried thing is in (from its bone); things on the body go with anything
    this.accHand = this.accNames.map((n) => (/hand_l/i.test(this.acc[n].bone || '') ? 'L' : /hand_r/i.test(this.acc[n].bone || '') ? 'R' : null));
    this.kids = []; this.adults = []; this.chars.forEach((c, i) => ((c.height || 1.75) < 1.45 ? this.kids : this.adults).push(i)); if (!this.adults.length) this.adults = this.chars.map((c, i) => i);
    this.head = new Int16Array(GN * GN); this.nxt = new Int16Array(4096); this.cells = []; this.gx0 = 0; this.gy0 = 0;
    this.cx = 1e9; this.cy = 1e9; this.fx = 1; this.fy = 0; this.cosCone = 0.5; this.cosSee = 0.5; this.waysNear = [];
    { const P = opts.P || (game && game.P), on = (k) => !(P && P.get && (P.get(k) === '0' || P.get('crowdfb') === '0')); this.fbCars = on('crowdcars'); this.fbWalls = on('crowdwalls'); this.fbTwins = on('crowdtwins'); }
    this.still = []; this._stillPool = []; this._nb = []; this.twinI = 0; this.fb = { carPush: 0, carMoved: 0, wallTurn: 0, wallStop: 0, wallHold: 0, lost: 0, recast: 0, twinPick: 0, topPick: 0 };
    this.keepOut = opts.keepOut ?? 6.5; this.nStand = 0; this.spawned = 0; this.retired = 0; this.hits = 0; this.ms = 0;
    for (const w of nav.ways) { w.agents = []; w.pop = 0; w.frac = this.rand(); w.wait = [[], []]; w.clearT = -1; w.clear = true; }
    for (const s of nav.spots) s.who = null;
  }

  // the target count: people alive around the camera at a busy corner. It scales every way's density; quiet streets get fewer.
  setCount(n) { this.count = n; this.k = n / REF_WEIGHT; this.cap = Math.round(n * 1.6) + 40; }
  // ------------------------------------------------------------------ who is where, for the camera
  view() {
    const cam = this.g.world.camera; cam.updateMatrixWorld(); const e = cam.matrixWorld.elements; this.cx = cam.position.x; this.cy = -cam.position.z;
    let fx = -e[8], fy = e[10]; const L = Math.hypot(fx, fy); if (L > 0.05) { this.fx = fx / L; this.fy = fy / L; }
    const hf = Math.atan(Math.tan((cam.fov || 55) * Math.PI / 360) * (cam.aspect || 1.78));
    this.cosCone = Math.cos(Math.min(Math.PI * 0.95, hf + 0.45)); this.cosSee = Math.cos(Math.min(Math.PI * 0.9, hf + 0.1));
  }
  // how much of its density a place gets: all of it near and where the camera looks, part of it behind, none far off
  imp(x, y) {
    const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy); if (d > RP) return 0; if (d < R_NEAR) return 1;
    if (dx * this.fx + dy * this.fy > d * this.cosCone) return 1; return d < R_BACK ? BACK_F : 0;
  }
  // the few metres in front of a camera that is standing or moving slowly: crowd members keep out of it (walkers steer round, nobody
  // is put there), so nobody is a head-and-shoulders close-up; a moving camera (driving) has no such zone
  inFront(x, y, r = this.keepOut) { if (!this.slow) return false; const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy); return d < r && dx * this.fx + dy * this.fy > d * this.cosSee; }
  // can the camera not see this spot? (outside its cone, far off, or behind a building)
  unseen(x, y) {
    const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy); if (d > 165) return true; if (d < 3) return false;
    if (dx * this.fx + dy * this.fy < d * this.cosSee) return d > 9;
    return d > 22 && this.g.statics.raycast(this.cx, this.cy, x, y) < 0.985;
  }

  // ------------------------------------------------------------------ making and removing people
  make(w, s, l, d, kid, at) {
    const r = this.rand, pool = kid && this.kids.length ? this.kids : this.adults; let ci = pool[Math.floor(r() * pool.length) % pool.length];
    const px = at ? at.x : w.ax + w.ux * s + w.nx * l, py = at ? at.y : w.ay + w.uy * s + w.ny * l; if (this.fbTwins) ci = this.castFor(pool, ci, px, py, null);
    const ch = this.chars[ci], scale = 0.955 + r() * 0.09;
    const a = { id: this.nextId++, char: ci, scale, tall: ((ch.height || 1.75) * scale) / 1.78, x: w.ax + w.ux * s + w.nx * l, y: w.ay + w.uy * s + w.ny * l, z: 0.15, h: Math.atan2(w.uy * d, w.ux * d), v: 0, v0: 1.3, vcap: 9,
      w, d, s, l, lt: l, la: 0, lane: 0.25 + r() * 0.7, state: 'walk', t: 0, clip: 0, ph: r(), clipB: 0, phB: 0, blend: 0, rate: 1, rateB: 1, fall: 0, slowT: 0,
      gx: w.ux * d, gy: w.uy * d, path: null, lead: null, fol: null, off: 0, back: 0, tx: 0, ty: 0, th: 0, standT: 0, trip: 150 + r() * 700, onRoad: false, tint: [NO_TINT, NO_TINT, NO_TINT], acc: 0, accT: new Array(this.accNames.length).fill(NO_TINT), female: !!ch.female, spot: null, vx: 0, vy: 0, tk: Math.floor(r() * 3), wq: null, walkClip: null, door: 0 };
    const pick = (p) => (p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT);
    a.tint = [pick(ch.top), pick(ch.bottom), pick(ch.hair)]; if (this.fbTwins) this.topFor(a, ch, px, py);
    // what they carry (kinds, hands and palettes from the cast file): something on the back or shoulder for a third of them, and one
    // thing at most in each hand
    const q = r(), q2 = r(), q3 = r(), F = a.female;
    if (q < 0.15) this.give(a, 'backpack'); else if (q < 0.34) this.give(a, 'bag_shoulder');
    if (q2 < 0.07) this.give(a, 'tote'); else if (q2 < (F ? 0.21 : 0.09)) this.give(a, 'handbag'); else if (q2 < (F ? 0.27 : 0.16)) this.give(a, 'coffee');
    if (q3 < 0.1) this.give(a, 'phone'); else if (q3 < 0.18) this.give(a, 'shopping');
    this.hands(a);
    { const u = r(); this.pace(a, u < 0.16 ? 0.86 + r() * 0.26 : u < 0.78 ? 1.2 + r() * 0.36 : u < 0.975 ? 1.58 + r() * 0.38 : 2.5 + r() * 0.4); }
    w.agents.push(a); this.agents.push(a); this.spawned++; a.home = w; w.pop++; return a;
  }
  // Public feedback ("you can easily see duplicates"): 25 bodies dress 900 people, so the same body is always somewhere in view; what reads
  // as a clone is the same body twice close together, or two of the same top side by side. Who is within 14 m of a place is listed once
  // (_nb: char, squared distance, top colour); a body already there is passed over for one that is not (or, if every body of the pool is
  // there, the one whose double is farthest off).
  castFor(pool, ci, x, y, self) {
    const N = this._nb; N.length = 0; let hit = false;
    for (const o of this.agents) { if (o === self) continue; const dx = o.x - x, dy = o.y - y; if (dx > 14 || dx < -14 || dy > 14 || dy < -14) continue; const d2 = dx * dx + dy * dy; if (d2 > 196) continue; N.push(o.char, d2, o.tint[0]); if (o.char === ci) hit = true; }
    if (!hit) return ci;
    const D = this._cd || (this._cd = new Float32Array(this.chars.length)); D.fill(1e9); for (let k = 0; k < N.length; k += 3) if (N[k + 1] < D[N[k]]) D[N[k]] = N[k + 1];
    let free = 0; for (const c of pool) if (D[c] > 1e8) free++;
    if (free) { let k = Math.floor(this.rand() * free) % free; for (const c of pool) if (D[c] > 1e8 && k-- === 0) { this.fb.twinPick++; return c; } }
    let b = ci; for (const c of pool) if (D[c] > D[b]) b = c; if (b !== ci) this.fb.twinPick++; return b;
  }
  // the top: not the colour of anyone's within 3.5 m, nor of this body's double within 14 m (castFor has just listed who is near)
  topFor(a, ch, x, y) {
    const N = this._nb, p = ch.top; if (!p || p.length < 2 || !N.length) return;
    const clash = (t) => { for (let k = 0; k < N.length; k += 3) { if (N[k + 1] > 12.25 && N[k] !== a.char) continue; const u = N[k + 2]; if (Math.abs((t >> 16) - (u >> 16)) + Math.abs(((t >> 8) & 255) - ((u >> 8) & 255)) + Math.abs((t & 255) - (u & 255)) < 56) return true; } return false; };
    for (let k = 0; k < 6 && clash(a.tint[0]); k++) { a.tint[0] = srgb(p[Math.floor(this.rand() * p.length) % p.length]); this.fb.topPick++; }
  }
  // another body for someone the camera cannot see (their double has come within 14 m): body, colours and the walk that fits the new legs
  recast(a, ci, keepColours) {
    const ch = this.chars[ci], r = this.rand, pk = (p) => (p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT);
    a.char = ci; a.female = !!ch.female; a.tall = ((ch.height || 1.75) * a.scale) / 1.78; if (!keepColours) { a.tint = [pk(ch.top), pk(ch.bottom), pk(ch.hair)]; this.topFor(a, ch, a.x, a.y); }
    if (a.walkClip) { const was = a.clip, walking = was === a.walkClip.i; this.pace(a, a.v0); if (!walking) a.clip = was; }
    this.fb.recast++;
  }
  // a walking pace, and the mocap walk whose own speed is nearest it (so the clip plays at close to its captured rate)
  pace(a, want) {
    const r = this.rand; if (want > 2.2 && this.jog && !a.lead) { const nat = this.jog.speed * a.tall; a.walkClip = this.jog; a.v0 = clamp(want, nat * 0.92, nat * 1.08); a.clip = this.jog.i; return; }
    want = clamp(want, 0.8, 2.0); let best = null, bd = 9; const ok = [];
    for (const c of this.walks) { const d = Math.abs(Math.log(want / (c.speed * a.tall))); if (d < 0.12) ok.push(c); if (d < bd) { bd = d; best = c; } }
    let c = ok.length ? ok[Math.floor(r() * ok.length)] : best;
    if (a.hand && a.hand.walk && !a.lead && !a.fol) { c = a.hand.walk; want = c.speed * a.tall * (0.95 + r() * 0.1); }     // phone, coffee, a heavy bag: that clip, at its own pace
    a.walkClip = c; const nat = c.speed * a.tall; a.v0 = clamp(want, nat * 0.9, nat * 1.1); a.clip = c.i;
  }
  // hand someone a thing (its tint from that kind's palette); anything already in the same hand goes
  give(a, name) {
    const N = this.accNames, i = N.indexOf(name); if (i < 0) return false; const h = this.accHand[i];
    if (h) for (let k = 0; k < N.length; k++) if (this.accHand[k] === h) a.acc &= ~(1 << k);
    a.acc |= 1 << i; const p = this.acc[name].tint, r = this.rand; a.accT[i] = p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT; return true;
  }
  // the clips that go with what is in the hands: a phone first, then a coffee, then a heavy bag
  hands(a) {
    a.hand = null; for (const n of ['phone', 'coffee', 'tote']) { const i = this.accNames.indexOf(n); if (i >= 0 && (a.acc & (1 << i)) && this.held[n]) { a.hand = this.held[n]; break; } }
    a.idle = (a.hand && a.hand.stands && a.hand.stands.length ? a.hand.stands[Math.floor(this.rand() * a.hand.stands.length) % a.hand.stands.length] : null) || this.idles[Math.floor(this.rand() * this.idles.length) % this.idles.length];
  }
  hold(a, name) { if (name) this.give(a, name); else for (const n of ['phone', 'coffee']) { const i = this.accNames.indexOf(n); if (i >= 0) a.acc &= ~(1 << i); } this.hands(a); }
  remove(a) {
    const i = this.agents.indexOf(a); if (i >= 0) { this.agents[i] = this.agents[this.agents.length - 1]; this.agents.pop(); }
    if (a.w) { const j = a.w.agents.indexOf(a); if (j >= 0) a.w.agents.splice(j, 1); } if (a.home) { a.home.pop--; a.home = null; }
    if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } if (a.spot) { a.spot.who = null; a.spot = null; }
    if (a.state === 'stand') this.nStand--;
    if (a.lead) { const f = a.lead.fol; if (f) { const k = f.indexOf(a); if (k >= 0) f.splice(k, 1); } a.lead = null; }
    if (a.fol) { for (const f of a.fol) { f.lead = null; f.state = f.state === 'stand' ? 'stand' : 'walk'; } a.fol = null; }
    a.gone = true; this.retired++;
  }
  // one person, a pair or three abreast, appearing at s on way w
  spawnOn(w, s, warm, door, dir) {
    const r = this.rand; bandAt(w, s, B); if (B.hi <= 0) return null; const d = dir || (r() < 0.5 ? 1 : -1), wd = B.hi - B.lo;
    const rightIsHi = (w.uy * d) * w.nx + (-w.ux * d) * w.ny > 0;
    const q = r(), kid = this.kids.length > 0 && r() < 0.045, n = q < 0.06 && wd > 2.3 ? 3 : (q < 0.27 || kid) && wd > 1.5 ? 2 : 1, lane = 0.2 + r() * 0.75;
    const laneL = (u) => { const half = (B.lo + B.hi) / 2; return rightIsHi ? half + (B.hi - half) * u : half - (half - B.lo) * u; };
    let l = laneL(lane * (n > 1 ? 0.6 : 1)); if (n > 1) l = clamp(l, B.lo + 0.4, B.hi - 0.4);
    const x = w.ax + w.ux * s + w.nx * l, y = w.ay + w.uy * s + w.ny * l;
    if (this.crowded(x, y, n > 1 ? 1.2 : 0.8) || Math.hypot(x - this.cx, y - this.cy) < 2.2 || this.inFront(x, y, this.keepOut + 2.5)) return null;
    const a = this.make(w, s, door ? B.hi + 0.25 : l, d); a.lt = l; a.lane = lane; if (door) { a.door = 1; a.h = Math.atan2(-w.ny + w.uy * d, -w.nx + w.ux * d); }
    if (warm) a.v = a.v0;
    if (n > 1) {
      a.fol = []; this.pace(a, kid ? 1.05 : a.v0 * 0.9);
      for (let k = 1; k < n; k++) { const f = this.make(w, s, l, d, kid && k === 1); f.lead = a; if (kid && k === 1) f.kid = true; f.off = (k === 1 ? 1 : -1) * (0.7 + r() * 0.14) * (n === 2 && r() < 0.5 ? -1 : 1); f.back = 0.05 + r() * 0.3; f.x = a.x + Math.sin(a.h) * f.off; f.y = a.y - Math.cos(a.h) * f.off;
        if (f.char === a.char && this.adults.length > 1 && !kid) { do { f.char = this.adults[Math.floor(r() * this.adults.length) % this.adults.length]; } while (f.char === a.char); const ch = this.chars[f.char]; f.female = !!ch.female; f.tall = ((ch.height || 1.75) * f.scale) / 1.78; const pk = (p) => (p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT); f.tint = [pk(ch.top), pk(ch.bottom), pk(ch.hair)]; }
        this.hold(f, null); this.pace(f, a.v0);
        if (f.walkClip === a.walkClip) { const alt = this.walks.filter((c) => c !== a.walkClip && Math.abs(Math.log(a.v0 / (c.speed * f.tall))) < 0.2); if (alt.length) { f.walkClip = alt[Math.floor(r() * alt.length)]; f.clip = f.walkClip.i; } }
        f.ph = (a.ph + 0.27 + r() * 0.46) % 1; if ((f.acc & a.acc) !== 0) { f.acc &= ~a.acc; this.hands(f); } if (f.kid) { f.acc = 0; this.hands(f); f.off *= 0.72; }
        f.v = a.v; a.fol.push(f); }
    }
    return a;
  }
  crowded(x, y, r) {
    for (const q of this.agents) if (Math.abs(q.x - x) < r && Math.abs(q.y - y) < r) return true;
    for (const q of this.still) { const dx = x - q.x, dy = y - q.y; if (Math.abs(dx * q.c + dy * q.s) < q.hl + 0.3 && Math.abs(-dx * q.s + dy * q.c) < q.hw + 0.3) return true; }
    return this.g.statics.resolve(x, y, 0.3, _o) > 0 || this.nav.blocked(x, y, 0.35);
  }
  populate(dt, warm) {
    const near = this.nav.near(this.cx, this.cy, RP + 20, this.waysNear), r = this.rand; let budget = warm ? 1e9 : 24; this.lastWant = this.sumWant || 1e9; this.sumWant = 0; this.homed = 0; for (const a of this.agents) if (a.home) this.homed++;
    for (const w of near) {
      if (w.kind === 'cross' || w.rho <= 0) continue;
      let f = 0; for (const u of [1 / 6, 0.5, 5 / 6]) f += this.imp(w.ax + w.ux * w.len * u, w.ay + w.uy * w.len * u); f /= 3;
      const want = Math.floor(this.k * w.rho * w.len * f + w.frac); w.want = want; const have = w.pop; this.sumWant += want;
      if (have < want && this.agents.length < this.cap && budget > 0 && (warm || this.homed < this.lastWant * 1.12 + 8)) {
        for (let n = 0, tries = 0; n < want - have && tries < (warm ? 40 : 4); tries++) {
          const s = r() * w.len, l0 = 1.5, x = w.ax + w.ux * s + w.nx * l0, y = w.ay + w.uy * s + w.ny * l0, fi = this.imp(x, y);
          if (fi <= 0 || r() > fi) continue; let door = false;
          if (!warm && !this.unseen(x, y)) { const d = Math.hypot(x - this.cx, y - this.cy); bandAt(w, s, B); if (d > 80 && B.hi < 11 && r() < 0.35) door = true; else continue; }
          const a = this.spawnOn(w, s, true, door); if (!a) continue; n += 1 + (a.fol ? a.fol.length : 0); budget--; this.homed += 1 + (a.fol ? a.fol.length : 0);
          if (!door && r() < 0.4) for (let q = 1 + Math.floor(r() * 2.5); q > 0 && n < want - have + 2; q--) { const s2 = s + (r() - 0.5) * (8 + r() * 14); if (s2 < 0.5 || s2 > w.len - 0.5) continue; const b = this.spawnOn(w, s2, true, false, r() < 0.7 ? a.d : -a.d); if (b) { const m = 1 + (b.fol ? b.fol.length : 0); n += m; this.homed += m; if (warm) b.ph = r(); } }
          // some of them are standing about rather than walking
          if (!door && !a.fol && r() < 0.17) this.stand(a, 20 + r() * 80, true); else if (!door && a.fol && !a.fol.some((f) => f.kid) && r() < 0.18) this.stand(a, 25 + r() * 90, true);
          if (warm) a.ph = r();
        }
      } else if (have > want + 1 + want * 0.3) {
        let n = 0; for (let i = w.agents.length - 1; i >= 0 && n < 2; i--) { const a = w.agents[i]; if (!a || a.lead || a.state === 'down' || a.state === 'flee') continue; if (!a.fol && a.trip < 1e8) a.trip = -1; if (this.imp(a.x, a.y) < 1 && this.unseen(a.x, a.y) && (!a.fol || a.fol.every((f) => this.unseen(f.x, f.y)))) { for (const f of (a.fol || []).slice()) this.remove(f); this.remove(a); n++; } }
      }
    }
    // people standing on the plazas
    for (const s of this.nav.spots) {
      const f = this.imp(s.x, s.y);
      if (!s.who) { if (f > 0 && !this.inFront(s.x, s.y, this.keepOut + 1.5) && this.agents.length < this.cap && r() < (warm ? 1 : 0.3) * Math.min(1, this.k * 0.9) * f && (warm || this.unseen(s.x, s.y)) && !this.crowded(s.x, s.y, 0.8)) this.plazaStander(s); }
      else if (f <= 0 || (s.who.t > s.who.standT && this.unseen(s.x, s.y))) { const a = s.who; for (const q of (a.fol || []).slice()) this.remove(q); this.remove(a); }
    }
    // people sitting: a fixed share of the chairs and benches (the same seats every time one passes), more in a busier city
    if (this.sits.length) { const share = 0.62, tables = 0.17;      // about a tenth of the seats: one table in six, most of its chairs
      for (const q of this.seats) {
        if (q.who) { if (q.who.gone) q.who = null; else if (this.imp(q.x, q.y) <= 0 || (warm && (Math.hypot(q.x - this.cx, q.y - this.cy) < 3.5 || this.inFront(q.x, q.y, this.keepOut + 1)))) { const a = q.who; for (const f of (a.fol || []).slice()) this.remove(f); this.remove(a); q.who = null; } continue; }
        if (q.ut > tables || q.u > share || this.agents.length >= this.cap || this.imp(q.x, q.y) <= 0 || !(warm || this.unseen(q.x, q.y)) || Math.hypot(q.x - this.cx, q.y - this.cy) < 3.5 || this.inFront(q.x, q.y, this.keepOut + 1)) continue;
        this.sit(q);
      } }
    // anyone left where nothing is kept
    for (let i = this.agents.length - 1; i >= 0; i--) { const a = this.agents[i]; if (!a || a.lead) continue; const d = Math.hypot(a.x - this.cx, a.y - this.cy);
      if (d > RP + 25 || (a.state === 'down' && a.t > 9 && this.unseen(a.x, a.y)) || (a.state === 'down' && a.t > 30) || (a.lost && a.state === 'stand' && a.t > 2 && this.unseen(a.x, a.y))) { for (const f of (a.fol || []).slice()) this.remove(f); this.remove(a); } }
    // People mix after they are put down. Someone whose double has come within 14 m changes body where that cannot be seen: outside the
    // camera's view or behind a building (new colours too), or in view but past the distance where everyone is drawn with one of the few
    // stand-in bodies (render.js tells the sim which: farOf, farR): there the body changes among those that share the stand-in and the
    // colours stay, so nothing on screen changes. A few people are looked at each time (all of them in about 8 s).
    if (this.fbTwins && !warm) { const A = this.agents; for (let k = Math.min(24, A.length); k > 0; k--) { const a = A[this.twinI++ % A.length]; if (!a || a.gone || a.state === 'sit' || a.state === 'down' || a.state === 'flee' || a.kid || this.kids.includes(a.char)) continue;
      let pool = this.adults, far = false; if (!this.unseen(a.x, a.y)) { if (!this.farOf || Math.hypot(a.x - this.cx, a.y - this.cy) < this.farR + 4) continue; far = true; const F = this._fp || (this._fp = {}), key = this.farOf[a.char]; pool = F[key] || (F[key] = this.adults.filter((c) => this.farOf[c] === key)); if (pool.length < 2) continue; }
      const ci = this.castFor(pool, a.char, a.x, a.y, a); if (ci !== a.char) this.recast(a, ci, far); else if (!far) this.topFor(a, this.chars[a.char], a.x, a.y);      /* unseen: also out of a neighbour's top colour */ } }
  }
  plazaStander(s) {
    const r = this.rand, w = this.nav.ways[0], a = this.make(w, 0, 0, 1, false, s); w.agents.pop(); a.w = null; w.pop--; a.home = null;
    a.x = s.x; a.y = s.y; a.z = s.z; a.h = s.h; a.state = 'stand'; this.nStand++; a.standT = 60 + r() * 240; a.tx = s.x; a.ty = s.y; a.th = s.h; a.spot = s; s.who = a; a.v = 0; { const q = r(); this.hold(a, q < 0.4 ? 'phone' : q < 0.6 ? 'coffee' : null); } this.setClip(a, a.idle, true); a.ph = r();
    if (r() < 0.45 && !this.crowded(s.x + Math.cos(s.h) * 1.0, s.y + Math.sin(s.h) * 1.0, 0.5)) {    // someone to talk to
      const b = this.make(w, 0, 0, 1, false, s); w.agents.pop(); b.w = null; w.pop--; b.home = null; b.z = s.z; b.state = 'stand'; this.nStand++; b.standT = 1e9; b.lead = a; a.fol = [b]; b.v = 0; this.talkPlace(a, b, s.x, s.y, s.h); a.x = a.tx; a.y = a.ty; a.h = a.th; b.x = b.tx; b.y = b.ty; b.h = b.th; this.setClip(a, a.talk, true); this.setClip(b, b.talk, true); b.ph = a.ph;
    }
  }
  seated(q, x, y, h, clip) {
    const r = this.rand, w = this.nav.ways[0], a = this.make(w, 0, 0, 1, false, { x, y }); w.agents.pop(); a.w = null; w.pop--; a.home = null;
    // hips on the seat: the clip holds them at its own seat height (scaled with the sitter), the seat is where it is
    a.x = x; a.y = y; a.h = h; { const ch = this.chars[a.char], hip = ch.leg && clip.seat_height_leg ? clip.seat_height_leg * ch.leg * a.scale : (clip.seat_height || 0.52) * a.tall; a.z = q.z + q.seat + 0.085 - hip; } a.state = 'sit'; a.v = 0; a.standT = 1e9; a.seatOf = q;
    const tote = this.accNames.indexOf('tote'), shop = this.accNames.indexOf('shopping'), hb = this.accNames.indexOf('handbag'), bp = this.accNames.indexOf('backpack'); for (const i of [tote, shop, hb, bp]) if (i >= 0) a.acc &= ~(1 << i);
    this.hands(a); a.clip = clip.i; a.blend = 0; a.ph = r(); return a;
  }
  sit(q) {
    const r = this.rand, c = Math.cos(q.h), sn = Math.sin(q.h);
    if (q.bench && this.sitPairs.length && q.u < 0.2) { const P = this.sitPairs[Math.floor(r() * this.sitPairs.length) % this.sitPairs.length], at = P[0].partner_at || [0, -0.45, 0];
      const ax = q.x - sn * (at[1] / 2), ay = q.y + c * (at[1] / 2) * 1, a = this.seated(q, q.x + sn * (at[1] / 2), q.y - c * (at[1] / 2), q.h, P[0]);
      const b = this.seated(q, a.x + c * at[0] - sn * at[1], a.y + sn * at[0] + c * at[1], q.h + at[2] * Math.PI / 180, P[1]); b.ph = a.ph; b.lead = a; a.fol = [b]; q.who = a; return; }
    const cl = this.sits[Math.floor(r() * this.sits.length) % this.sits.length]; q.who = this.seated(q, q.x, q.y, q.h, cl);
  }
  // stop and stand for a while: alone by the wall or at the kerb, or (a pair) facing each other
  stand(a, secs, now) {
    const w = a.w, r = this.rand; if (!w || w.kind !== 'strip' || w.len < 8 || a.state !== 'walk') return false; bandAt(w, a.s, B); if (B.hi <= 0 || B.hi - B.lo < 2.0) return false;
    const wall = r() < 0.7, l = wall ? B.hi - 0.05 + (B.hi < 11 ? 0.15 : 0) : Math.max(0.55, B.lo - 0.55), s = clamp(a.s + a.d * (now ? 0 : 1.5 + r() * 2), 1, w.len - 1);
    const x = w.ax + w.ux * s + w.nx * l, y = w.ay + w.uy * s + w.ny * l;
    if (this.inFront(x, y, this.keepOut + 1.5) || !this.g.statics.onSidewalk(x, y) || this.nav.blocked(x, y, 0.4) || (a.fol && a.fol.length && this.nav.blocked(x + w.ux * 0.6, y + w.uy * 0.6, 0.4))) return false;
    for (const q of w.agents) if (q !== a && q.lead !== a && q.lead !== a.lead && q.state === 'stand' && Math.hypot(q.tx - x, q.ty - y) < 3.4 + (q.id % 5)) return false;
    const face = Math.atan2(w.ny, w.nx) + (wall ? Math.PI : 0) + (r() - 0.5) * 1.2;   // by the wall: back to it, looking out; at the kerb: looking in
    a.state = 'stand'; this.nStand++; a.t = 0; a.standT = secs; a.tx = x; a.ty = y; a.th = face; a.path = null;
    if (a.fol && a.fol.length) { const f = a.fol[0]; this.talkPlace(a, f, x - w.ux * 0.5, y - w.uy * 0.5, Math.atan2(w.uy, w.ux)); f.state = 'stand'; this.nStand++; f.standT = 1e9; f.t = 0; if (now) { f.x = f.tx; f.y = f.ty; f.h = f.th; f.v = 0; this.setClip(f, f.talk, true); }
      const g = a.fol[1]; if (g) { const mx = (a.tx + f.tx) / 2, my = (a.ty + f.ty) / 2, sd = r() < 0.5 ? 1 : -1, ox = -w.uy * sd, oy = w.ux * sd, dd = 0.85 + r() * 0.3, jx = (r() - 0.5) * 0.4; g.tx = mx + ox * dd + w.ux * jx; g.ty = my + oy * dd + w.uy * jx; g.th = Math.atan2(my - g.ty, mx - g.tx) + (r() - 0.5) * 0.5; g.state = 'stand'; this.nStand++; g.standT = 1e9; g.t = 0; g.talk = null; if (now) { g.x = g.tx; g.y = g.ty; g.h = g.th; g.v = 0; this.setClip(g, g.idle, true); } } }
    if (!a.fol) { const q = r(); this.hold(a, q < 0.4 ? 'phone' : q < 0.6 ? 'coffee' : null); }
    if (now) { a.x = a.tx; a.y = a.ty; a.h = a.th; a.v = 0; this.setClip(a, a.fol ? a.talk : a.idle, true); if (a.fol) a.fol[0].ph = a.ph; }
    return true;
  }

  // two people talking: the pair of clips was captured together, so the second stands where the capture had them and both run on one clock
  talkPlace(a, b, x, y, h) {
    const A = this.talkA, Bc = this.talkB, at = (A && A.partner_at) || [0.95, 0, 180], c = Math.cos(h), sn = Math.sin(h);
    a.tx = x; a.ty = y; a.th = h; b.tx = x + c * at[0] - sn * at[1]; b.ty = y + sn * at[0] + c * at[1]; b.th = h + at[2] * Math.PI / 180;
    a.talk = A || a.idle; b.talk = Bc || b.idle;
  }
  // ------------------------------------------------------------------ animation
  setClip(a, c, snap) {
    if (a.clip === c.i) return; if (snap) { a.clip = c.i; a.blend = 0; a.ph = c.speed > 0 ? a.ph : this.rand(); return; }
    a.clipB = a.clip; a.phB = a.ph; a.rateB = a.rate; a.blend = 1; a.clip = c.i; if (!(c.speed > 0)) a.ph = this.rand(); else if (!(this.clips[a.clipB].speed > 0)) a.ph = this.rand() < 0.5 ? 0.02 : 0.52;
  }
  animate(a, dt) {
    const c = this.clips[a.clip]; a.rate = c.speed > 0 ? clamp(a.v / (c.speed * a.tall), 0, 1.6) : 1;
    a.ph += (dt * a.rate) / c.duration; if (a.ph >= 1) a.ph -= Math.floor(a.ph);
    if (a.blend > 0) { const cb = this.clips[a.clipB]; a.phB += (dt * (cb.speed > 0 ? Math.min(a.rateB, a.rate + 0.3) : 1)) / cb.duration; if (a.phB >= 1) a.phB -= Math.floor(a.phB); a.blend = Math.max(0, a.blend - dt / 0.32); }
  }
  // walking clip while moving, the standing clip once stopped for a moment
  gait(a, dt, idle) {
    if (a.v < 0.12) { a.slowT += dt; if (a.slowT > 0.3) this.setClip(a, idle || a.idle); } else { a.slowT = 0; if (a.v > 0.22) this.setClip(a, a.walkClip); }
  }

  // ------------------------------------------------------------------ the neighbour grid
  grid() {
    const H = this.head; H.fill(-1); this.gx0 = this.cx - GN * CELL / 2; this.gy0 = this.cy - GN * CELL / 2; const C = this.cells; C.length = 0;
    const put = (q) => { const i = Math.floor((q.x - this.gx0) / CELL), j = Math.floor((q.y - this.gy0) / CELL); if (i < 0 || j < 0 || i >= GN || j >= GN || C.length >= 4096) return; const k = j * GN + i; this.nxt[C.length] = H[k]; H[k] = C.length; C.push(q); };
    for (const a of this.agents) put(a);
    // the game's own pedestrians and the player on foot are in the way too
    const g = this.g; if (g.peds) for (const p of g.peds.list) { if (p.state === 'down') continue; p.v = p.speed || 1.3; put(p); }
    // nobody walks through the camera either (a free or a fixed camera at eye height stands in the street like a person)
    const cam = g.world.camera; if (cam.position.y < 3) { this._cam = this._cam || { ext: true, h: 0, v: 0 }; this._cam.x = this.cx; this._cam.y = this.cy; put(this._cam); }
    const pl = g.player; if (pl && !pl.vehicle) { this._pl = this._pl || { ext: true }; Object.assign(this._pl, { x: pl.x, y: pl.y, h: pl.h, v: pl.speed || 0 }); put(this._pl); }
  }

  // ------------------------------------------------------------------ steering round people and things
  avoid(a, w, band) {
    const hx = Math.cos(a.h), hy = Math.sin(a.h), C = this.cells, H = this.head; let sR = 0, sL = 0, cap = 9;
    const see = (qx, qy, qf, need, soft) => {
      const dx = qx - a.x, dy = qy - a.y, f = dx * hx + dy * hy; if (f < -0.35 || f > 3.6) return; const gg = -dx * hy + dy * hx, ag = Math.abs(gg); if (ag > need + 0.25) return;
      const closing = a.v0 - qf; if (closing < 0.12 && f > 0.75) return;
      // right behind someone going the same way: their pace. Someone standing there: slow, and weave past
      if (f < 0.8 && ag < 0.42 && f > 0.05 && qf > -0.1) cap = Math.min(cap, qf > 0.15 ? qf : 0.5);
      const over = need - ag; if (over <= 0) return; const urg = clamp(1.5 - f / 2.4, 0.25, 1.2) * over;
      let right = gg >= 0; if (ag < 0.12) right = qf < -0.2 ? true : (a.id & 1) === 0;
      if (right) sR = Math.max(sR, urg); else sL = Math.max(sL, urg);
      if (f < 2.2 && closing > 0.1 && qf > -0.1) a._blk = Math.min(a._blk, qf > 0.15 ? qf : 0.5);
    };
    a._blk = 9;
    const ci = Math.floor((a.x + hx * 1.2 - this.gx0) / CELL), cj = Math.floor((a.y + hy * 1.2 - this.gy0) / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
      for (let k = H[j * GN + i]; k >= 0; k = this.nxt[k]) { const q = C[k]; if (q === a || q.lead === a || (a.lead && (q === a.lead || q.lead === a.lead))) continue; if (q.state === 'down') continue;
        see(q.x, q.y, (q.v || 0) * (Math.cos(q.h) * hx + Math.sin(q.h) * hy), 0.74, false); }
    }
    if (this.slow && w) {       // round the space in front of the camera: a big thing to pass on the side one is already on
      const dx = this.zx - a.x, dy = this.zy - a.y, f = dx * hx + dy * hy, gg = -dx * hy + dy * hx, R = 3.6;
      if (f > -R && f < R + 7 && Math.abs(gg) < R) { const urg = (1 - Math.abs(gg) / R) * 1.6 + 0.3; if (gg >= 0) sR = Math.max(sR, urg); else sL = Math.max(sL, urg); }
    }
    if (w) for (const o of w.obs) { if (Math.abs(o.x - a.x) > 4 || Math.abs(o.y - a.y) > 4) continue; see(o.x, o.y, 0, o.r + 0.45, false); }
    // the player's standing cars: three circles along the body, passed like street furniture
    for (const q of this.still) { const dx = q.x - a.x, dy = q.y - a.y; if (dx > 8 || dx < -8 || dy > 8 || dy < -8) continue; const e = q.hl - q.hw, n = q.hw + 0.3; see(q.x, q.y, 0, n, false); if (e > 0.3) { see(q.x + q.c * e, q.y + q.s * e, 0, n, false); see(q.x - q.c * e, q.y - q.s * e, 0, n, false); } }
    if (w && band) {
      const rn = hy * w.nx - hx * w.ny, room = band.hi - band.lo; let sh = (sR - sL) * 0.55;
      if (sR > 0 && sL > 0) cap = Math.min(cap, a._blk);     // someone on either side: fall in behind
      let la = a.la + sh * rn; const tgt = a.lt + la, cl = clamp(tgt, band.lo, band.hi);
      if (cl !== tgt) { la = cl - a.lt; if (sh !== 0 && room < 1.6) cap = Math.min(cap, a._blk); }
      if (sh === 0) la *= 0.93; a.la = clamp(la, -3, 3);
    }
    // held up for a while (a narrow walk, someone standing in it): shuffle past rather than queue for ever
    if (cap < 0.3 && a.state === 'walk') { a.stuck = (a.stuck || 0) + 0.05; if (a.stuck > 2.2) cap = 0.7; if (a.stuck > 4.5) a.stuck = 0; } else if (a.stuck > 0) a.stuck = Math.max(0, a.stuck - 0.02);
    a.vcap = cap;
  }

  // ------------------------------------------------------------------ the way ahead at a junction
  plan(a) {
    const w = a.w, v = a.d > 0 ? w.b : w.a, r = this.rand; let best = null; const opts = [];
    const walk = (vert, from, depth, len, first, path) => {
      for (const inc of vert.inc) {
        const w2 = inc.w; if (w2 === from || path.some((p) => p.w === w2)) continue; const d2 = inc.end === 0 ? 1 : -1, far = d2 > 0 ? w2.b : w2.a;
        bandAt(w2, d2 > 0 ? 0 : w2.len, B2); if (w2.kind !== 'cross' && B2.hi <= 0) continue;
        const p2 = path.concat([{ w: w2, d: d2 }]), L = len + w2.len;
        if (depth >= 4 || (w2.kind === 'strip' && w2.len > 9) || L > 45 || far.inc.length < 2) {
          const ex = far.x - v.x, ey = far.y - v.y, el = Math.hypot(ex, ey) || 1; let sc = (ex * a.gx + ey * a.gy) / Math.max(el, L * 0.8) ;
          for (const p of p2) if (p.w.kind === 'cross') sc -= 0.12 + (this.canWalk(p.w, a, 0) ? 0 : 0.22);
          if (this.fbTwins) { const c0 = p2.find((p) => p.w.kind === 'cross'); if (c0) for (const q of c0.w.agents) if (q.char === a.char && q !== a && q.lead !== a) { sc -= 0.45; break; } }      /* people/crowd-fb: their double is already at that crossing (waiting or on it): rather another way */
          if (far.inc.length < 2) sc -= 0.8;
          if (w2.kind !== 'cross') { sc += 0.22 * clamp(Math.log((w2.rho + 0.05) / (w.rho + 0.05)), -1.5, 1.5); if (w2.pop > w2.want * 1.5 + 4) sc -= 0.3; }
          opts.push({ path: p2, sc });
        } else walk(far, w2, depth + 1, L, first, p2);
      }
    };
    walk(v, w, 0, 0, null, []);
    if (!opts.length) { a.path = null; return; }
    let tot = 0; for (const o of opts) { o.wt = Math.exp(3.2 * o.sc); tot += o.wt; }
    let x = r() * tot; for (const o of opts) { x -= o.wt; if (x <= 0) { best = o; break; } } best = best || opts[0];
    a.path = best.path;
    // a turn taken is the new way to go
    const last = best.path[best.path.length - 1], lx = last.w.ux * last.d, ly = last.w.uy * last.d; if (lx * a.gx + ly * a.gy < 0.5 && last.w.kind === 'strip') { a.gx = lx; a.gy = ly; }
    this.laneFor(a, a.path[0]);
  }
  // where across the next way this walker will go: the right-hand side of its band, as far over as is their habit
  laneFor(a, p) {
    const w = p.w; bandAt(w, p.d > 0 ? Math.min(2, w.len) : Math.max(0, w.len - 2), B2); const rightIsHi = (w.uy * p.d) * w.nx + (-w.ux * p.d) * w.ny > 0, half = (B2.lo + B2.hi) / 2;
    let lane = a.lane; if (a.fol && a.fol.length) lane *= 0.55;
    p.lt = rightIsHi ? half + (B2.hi - half) * lane : half - (half - B2.lo) * lane; if (a.fol && a.fol.length) p.lt = clamp(p.lt, B2.lo + 0.45, Math.max(B2.lo + 0.45, B2.hi - 0.45));
  }
  enter(a, p) {
    const w0 = a.w, j = w0.agents.indexOf(a); if (j >= 0) w0.agents.splice(j, 1); p.w.agents.push(a);
    a.w = p.w; a.d = p.d; a.lt = p.lt; a.la = 0; a.path.shift(); if (p.w.kind !== 'cross') for (const q of a.fol ? [a, ...a.fol] : [a]) { if (q.home) q.home.pop--; q.home = p.w; p.w.pop++; } if (a.path.length) this.laneFor(a, a.path[0]); else a.path = null;
    if (a.fol) for (const f of a.fol) { const k = w0.agents.indexOf(f); if (k >= 0) w0.agents.splice(k, 1); p.w.agents.push(f); f.w = p.w; f.d = p.d; }
    if (p.w.kind === 'cross') {
      const end = p.d > 0 ? 0 : 1; a.state = 'wait'; a.t = 0; { const S = p.w.wait[end]; let k = 0; while (k < S.length && S[k]) k++; S[k] = 1; a.wq = { w: p.w, end, n: k, go: -1 }; }
      // a place in the bunch at the kerb: across the width of the crossing, in loose rows back from the kerb
      const w = p.w, n = a.wq.n, row = Math.floor(n / 5), back = 0.7 + row * 0.78 + this.rand() * 0.3, lat = clamp(((n % 5) - 2) * 0.86 + (row % 2) * 0.4 + (this.rand() - 0.5) * 0.3, -2.1, 2.1), s = p.d > 0 ? -back : w.len + back;
      a.tx = w.ax + w.ux * s + w.nx * lat; a.ty = w.ay + w.uy * s + w.ny * lat; this.g.statics.resolve(a.tx, a.ty, 0.38, _o);
      if (this.g.statics.onSidewalk(_o.x, _o.y) && Math.hypot(_o.x - a.tx, _o.y - a.ty) < 0.8 && !this.nav.blocked(_o.x, _o.y, 0.3)) { a.tx = _o.x; a.ty = _o.y; } else { const s1 = p.d > 0 ? -0.7 : w.len + 0.7, l1 = clamp(lat, -1.2, 1.2); a.tx = w.ax + w.ux * s1 + w.nx * l1; a.ty = w.ay + w.uy * s1 + w.ny * l1; }
      a.th = Math.atan2(w.uy * p.d, w.ux * p.d);
    }
  }
  // may one start over this crossing now? The walk phase is the red of the road being crossed, with time left to get over, and no car coming.
  canWalk(w, a, margin = 1) {
    const g = this.g, R = g.roads, nd = R.nodes[w.node];
    if (nd.sig) { if (R.signal(w.node, w.e, g.t) !== 'r') return false; const left = R.toGreen(w.node, w.e, g.t); if (left < w.len / ((a ? a.v0 : 1.3) * (a && a.fol ? 0.95 : 1.1)) + margin + 1.5) return false; }
    if (w.clearT !== this.frame) {
      w.clearT = this.frame; w.clear = true; const mx = w.ax + w.ux * w.len / 2, my = w.ay + w.uy * w.len / 2;
      const test = (x, y, vx, vy) => { const sp = Math.hypot(vx, vy); if (sp < 1.2 || Math.abs(x - mx) > 34 || Math.abs(y - my) > 34) return; for (let t = 0; t <= 3.6; t += 0.4) { const px = x + vx * t - w.ax, py = y + vy * t - w.ay, s = px * w.ux + py * w.uy, l = px * w.nx + py * w.ny; if (s > -1 && s < w.len + 1 && Math.abs(l) < 3.4) { w.clear = false; return; } } };
      for (const c of g.traffic.cars) { if (!w.clear) break; test(c.x, c.y, Math.cos(c.h) * c.v, Math.sin(c.h) * c.v); }
      for (const c of g.vehicles) { if (!w.clear) break; test(c.x, c.y, c.vx, c.vy); }
    }
    return w.clear;
  }

  // ------------------------------------------------------------------ one agent, one step
  steer(a, tx, ty, dt, want) {
    const dh = wrapPi(Math.atan2(ty - a.y, tx - a.x) - a.h), ad = Math.abs(dh); a.h += clamp(dh, -TURN * dt, TURN * dt);
    const tgt = Math.min(want, a.vcap) * (ad > 1.3 ? 0.45 : ad > 0.7 ? 0.75 : 1); a.v += clamp(tgt - a.v, -3.2 * dt, 1.6 * dt); if (a.v < 0.02 && tgt <= 0) a.v = 0;
    a.x += Math.cos(a.h) * a.v * dt; a.y += Math.sin(a.h) * a.v * dt;
  }
  walkOn(a, dt, think) {
    const w = a.w, dx = a.x - w.ax, dy = a.y - w.ay; a.s = dx * w.ux + dy * w.uy; a.l = dx * w.nx + dy * w.ny;
    const prog = a.d > 0 ? a.s : w.len - a.s, remain = w.len - prog, cross = w.kind === 'cross';
    if (!a.path && remain < 7 && a.noPlan !== w) { this.plan(a); if (!a.path) a.noPlan = w; }
    bandAt(w, clamp(a.s + a.d * 1.5, 0, w.len), B);
    if (think) this.avoid(a, w, B);
    // about to walk into the close-up space of a camera that stands still, and no room to go round: turn back before it
    if (think && this.slow && !cross && !a.lead && a.state === 'walk' && !this.inFront(a.x, a.y) && (this.inFront(a.x + Math.cos(a.h) * 2.2, a.y + Math.sin(a.h) * 2.2) || this.inFront(a.x + w.ux * a.d * 3.5, a.y + w.uy * a.d * 3.5, this.keepOut - 1))) {
      a.d = -a.d; a.gx = -a.gx; a.gy = -a.gy; a.path = null; a.noPlan = null; a.lt = clamp(B.lo + B.hi - a.lt, B.lo, B.hi); a.la = 0; }
    if (a.path) {
      const p = a.path[0], w2 = p.w, u1x = w.ux * a.d, u1y = w.uy * a.d, u2x = w2.ux * p.d, u2y = w2.uy * p.d, det = u1x * u2y - u1y * u2x;
      let go = remain <= 0.05;
      if (Math.abs(det) > 0.25 && remain < 9) { const rx = w2.ax + w2.nx * p.lt - a.x, ry = w2.ay + w2.ny * p.lt - a.y, t = (rx * u2y - ry * u2x) / det; if (t < 0.4 + a.v * 0.15) go = true; }
      if (go) { this.enter(a, p); return; }
    } else if (remain <= 0.4) {     // the end of the walkable way: turn back (or leave, if no one is looking)
      if (this.unseen(a.x, a.y) && !a.fol) { this.remove(a); return; }
      a.d = -a.d; a.gx = -a.gx; a.gy = -a.gy; a.lt = clamp(B.lo + B.hi - a.lt, B.lo, B.hi); a.la = 0; a.noPlan = null;
    }
    const look = 1.3 + a.v * 0.7, s2 = a.s + a.d * look; let lt = clamp(a.lt + a.la, B.lo, Math.max(B.lo, B.hi));
    if (a.door) { if (a.l < B.hi - 0.2) a.door = 0; }
    if (a.carT > 0) { a.carT -= dt; lt = a.carL; if (!cross && !this.g.statics.onSidewalk(a.x, a.y)) a.carRoad = true; else a.carRoad = false; } else if (a.carRoad) a.carRoad = false;
    if (a.fbBack > 0 && a.s > 0.2 && a.s < w.len - 0.2 && a.l > B.lo - 0.2 && a.l < B.hi + 0.2) a.fbBack = 0;      /* back on the walk itself (not merely level with it past its end) */
    let hurry = cross ? 1.1 : 1;
    if (cross && a.onRoad) { const nd = this.g.roads.nodes[w.node]; if (nd.sig) { const left = this.g.roads.signal(w.node, w.e, this.g.t) === 'r' ? this.g.roads.toGreen(w.node, w.e, this.g.t) : 0; if (left < remain / a.v0 + 1.5) hurry = 1.5; } }     // the light is about to change: step out
    this.steer(a, w.ax + w.ux * s2 + w.nx * lt, w.ay + w.uy * s2 + w.ny * lt, dt, a.v0 * hurry);
    if (cross) { a.onRoad = prog > 0.2 && remain > 0.2; a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12); } else { a.onRoad = !!a.carRoad; const up = !a.carRoad && (a.l > 0.45 || this.g.statics.onSidewalk(a.x, a.y)); a.z += ((up ? 0.15 : 0) - a.z) * Math.min(1, dt * 12); }
    this.gait(a, dt);
    a.trip -= a.v * dt;
  }
  follow(a, dt, think) {
    const L = a.lead, hx = Math.cos(L.h), hy = Math.sin(L.h); let off = a.off, back = a.back; const w = L.w;
    if (w && w.kind !== 'cross') { bandAt(w, clamp(L.s, 0, w.len), B); const rn = hy * w.nx - hx * w.ny, l = L.l + off * rn; if (l < B.lo - 0.1 || l > B.hi + 0.25) { off *= 0.25; back += 0.85; } }
    const sx = L.x + hy * off - hx * back, sy = L.y - hx * off - hy * back, ex = sx - a.x, ey = sy - a.y, fe = ex * hx + ey * hy;
    if (think) { this.avoid(a, null, null); }
    if (L.v < 0.08 && Math.hypot(ex, ey) < 0.35) { a.v = Math.max(0, a.v - 3 * dt); a.h += clamp(wrapPi(L.h - a.h), -TURN * dt, TURN * dt); }
    else this.steer(a, sx + hx * 1.4, sy + hy * 1.4, dt, clamp(L.v + fe * 1.6, 0, a.v0 * 1.25));
    a.onRoad = L.onRoad; a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12); a.s = L.s; a.l = L.l;
    this.gait(a, dt);
  }
  standStill(a, dt, clip) {
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    if (d > 0.22 && a.t < 12) { a.vcap = 9; this.steer(a, a.tx, a.ty, dt, Math.min(a.v0, 0.5 + d * 1.2)); this.gait(a, dt, clip); return false; }
    a.v = Math.max(0, a.v - 4 * dt); a.h += clamp(wrapPi(a.th - a.h), -2.2 * dt, 2.2 * dt); a.slowT += dt; if (a.v < 0.1) this.setClip(a, clip); return true;
  }
  // the player's cars: run from one bearing down, go down if struck (as the game's own pedestrians do)
  cars(a, dt) {
    const g = this.g;
    for (const v of g.vehicles) {
      const dx = a.x - v.x, dy = a.y - v.y; if (Math.abs(dx) > 16 || Math.abs(dy) > 16) continue; const sp = Math.hypot(v.vx, v.vy);
      if (sp > 2.2) { const fx = Math.cos(v.h), fy = Math.sin(v.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx;
        if (Math.abs(f) < v.def.len / 2 + 0.3 && Math.abs(s) < v.def.wid / 2 + 0.25) { this.leaveGroup(a); if (a.state === 'stand') this.nStand--; if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } a.state = 'down'; a.t = 0; a.vx = v.vx * 0.9 - fy * Math.sign(s || 1) * 2; a.vy = v.vy * 0.9 + fx * Math.sign(s || 1) * 2; a.v = 0; this.hits++; try { g.onPedHit(a, v); } catch (e) {} return true; } }
      if (sp > 3 && a.state !== 'flee') { const dd = Math.hypot(dx, dy); if (dd > 14) continue; const f = (dx * v.vx + dy * v.vy) / sp, side = Math.abs(dx * v.vy - dy * v.vx) / sp;
        if (f > -1 && f < 5 + sp * 1.1 && side < v.def.wid / 2 + 0.75) { const sg = (dx * -v.vy + dy * v.vx) > 0 ? 1 : -1; this.leaveGroup(a); if (a.state === 'stand') this.nStand--; if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } a.state = 'flee'; a.t = 0; a.vx = (-v.vy / sp) * sg; a.vy = (v.vx / sp) * sg; this.setClip(a, this.jog); } }
    }
    return false;
  }
  leaveGroup(a) { if (a.lead) { const f = a.lead.fol; if (f) { const k = f.indexOf(a); if (k >= 0) f.splice(k, 1); if (!f.length) a.lead.fol = null; } a.lead = null; } if (a.fol) { for (const f of a.fol) f.lead = null; a.fol = null; } if (a.spot) { a.spot.who = null; a.spot = null; } }
  // Public feedback ("the pedestrians clip through the car if the car is on the sidewalk"): the player's cars that stand or creep
  // (this.still, listed each step; cars() has the ones that move). Nobody stands or walks inside one: a place to stand that a car now
  // covers moves to beside it, a body inside is moved out at a walking pace (faster as the car creeps), sideways unless a bumper is
  // much nearer or a wall is hard against that side; a walker then keeps the line it was put on until it is past (carT, carL in walkOn).
  offCars(a, dt, think) {
    for (const q of this.still) {
      const dx = a.x - q.x, dy = a.y - q.y; if (dx > q.R || dx < -q.R || dy > q.R || dy < -q.R) continue;
      if (think && (a.state === 'stand' || a.state === 'wait')) { const ux = a.tx - q.x, uy = a.ty - q.y, f = ux * q.c + uy * q.s, s = -ux * q.s + uy * q.c;
        if (Math.abs(f) < q.hl + 0.12 && Math.abs(s) < q.hw + 0.12) { let sd = s >= 0 ? 1 : -1; if (sd > 0 ? !q.okL && q.okR : !q.okR && q.okL) sd = -sd; const pf = q.hl - Math.abs(f), ps = q.hw - s * sd;
          if (q.sp < 0.3 && pf < ps * 0.7) { const m = (pf + 0.3) * (f >= 0 ? 1 : -1); a.tx += q.c * m; a.ty += q.s * m; } else { const m = (ps + 0.3) * sd; a.tx += -q.s * m; a.ty += q.c * m; }
          // they walk there (standStill only walks in its first 12 s)
          if (a.t > 8) { const k = a.t - 8; a.t = 8; if (a.standT < 1e8) a.standT -= k; if (a.wq && a.wq.go >= 0) a.wq.go -= k; } this.fb.carMoved++; } }
      const f = dx * q.c + dy * q.s, s = -dx * q.s + dy * q.c, pf = q.hl - Math.abs(f), ps0 = q.hw - Math.abs(s); if (pf <= 0 || ps0 <= 0) continue;
      let sd = s >= 0 ? 1 : -1; if (Math.abs(s) < 0.12) sd = a.id & 1 ? 1 : -1; if (sd > 0 ? !q.okL && q.okR : !q.okR && q.okL) sd = -sd;
      const rate = (1.5 + q.sp * 1.6 + (a.v || 0)) * dt, ps = q.hw - s * sd, walker = (a.state === 'walk' || a.state === 'cross') && !a.lead && a.w; let px = 0, py = 0;
      if (q.sp < 0.3 && pf < ps * 0.7) { const sg = f >= 0 ? 1 : -1, m = Math.min(pf, rate); px = q.c * sg * m; py = q.s * sg * m;
        // walking on into a bumper: step across towards the nearer side as well, until past the corner
        if (walker && (Math.cos(a.h) * q.c + Math.sin(a.h) * q.s) * sg < -0.2) { const m2 = Math.min(ps, 1.2 * dt); px += -q.s * sd * m2; py += q.c * sd * m2; } }
      else { const m = Math.min(ps, rate); px = -q.s * sd * m; py = q.c * sd * m; }
      a.x += px; a.y += py; this.fb.carPush++;
      if (walker) { const w = a.w, pn = px * w.nx + py * w.ny; a.carT = 0.45; a.carL = (a.x - w.ax) * w.nx + (a.y - w.ay) * w.ny + (pn > 1e-4 ? 0.15 : pn < -1e-4 ? -0.15 : 0); }
    }
  }
  // A seated person gets up (public feedback: "people sitting down dont run"). Nothing in the crowd calls this: it is for whoever frightens
  // them (combat.js leaves sitters alone today, because until now they could not stand up). With a direction they run that way like anyone
  // set running; with none they walk off to the nearest way. The seat is given back (a bench partner keeps it).
  rise(a, vx, vy) {
    if (!a || a.gone || a.state !== 'sit') return false; const q = a.seatOf, mate = a.lead || (a.fol && a.fol[0]);
    this.leaveGroup(a); if (q) { if (q.who === a) q.who = mate && !mate.gone && mate.state === 'sit' ? mate : null; a.z = q.z; a.x += Math.cos(a.h) * 0.35; a.y += Math.sin(a.h) * 0.35; } a.seatOf = null; a.t = 0; a.standT = 0;
    if (vx !== undefined) { const L = Math.hypot(vx, vy) || 1; a.state = 'flee'; a.vx = vx / L; a.vy = vy / L; this.setClip(a, this.jog); } else { a.state = 'walk'; this.rejoin(a); }
    return true;
  }
  // nowhere to walk to from here without a wall between: stay, standing, until the camera cannot see (populate then takes them away)
  strand(a) {
    if (this.unseen(a.x, a.y)) { this.remove(a); return; } if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; }
    if (a.state !== 'stand') this.nStand++; a.state = 'stand'; a.t = 0; a.standT = 1e9; a.tx = a.x; a.ty = a.y; a.th = a.h; a.v = 0; a.lost = true; a.talk = null; a.fbBack = 0; this.fb.lost++;
  }
  // back onto the network after running or being let go: the nearest way (with ?crowdwalls on: the nearest that can be walked to without
  // a wall between; with none in reach they stay where they are, standing, and are taken away once the camera cannot see them)
  rejoin(a) {
    const W = this.fbWalls, st = this.g.statics;
    let best = null, bd = 1e9; for (const w of this.nav.near(a.x, a.y, 30, [])) { if (w.kind === 'cross') continue; const dx = a.x - w.ax, dy = a.y - w.ay, s = clamp(dx * w.ux + dy * w.uy, 0, w.len), l = dx * w.nx + dy * w.ny; bandAt(w, s, B); if (B.hi <= 0) continue; const px = w.ax + w.ux * s + w.nx * clamp(l, B.lo, B.hi), py = w.ay + w.uy * s + w.ny * clamp(l, B.lo, B.hi), d = Math.hypot(a.x - px, a.y - py); if (d < bd) { if (W && d > 0.5 && st.raycast(a.x, a.y, px, py) < 1) continue; bd = d; best = w; } }
    if (!best && W) { this.strand(a); return; }
    if (!best) { this.remove(a); return; }
    if (W) { a.lost = false; a.fbBack = 40; a.fbT = 0; a.fbN = 0; a.fbx = a.x; a.fby = a.y; }
    if (a.w) { const j = a.w.agents.indexOf(a); if (j >= 0) a.w.agents.splice(j, 1); } best.agents.push(a); a.w = best; if (a.home) a.home.pop--; a.home = best; best.pop++; a.d = (best.ux * a.gx + best.uy * a.gy) >= 0 ? 1 : -1; a.path = null; a.state = 'walk'; a.la = 0; bandAt(best, clamp((a.x - best.ax) * best.ux + (a.y - best.ay) * best.uy, 0, best.len), B); a.lt = (B.lo + B.hi) / 2; this.setClip(a, a.walkClip);
  }

  step(dt) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0, g = this.g; this.frame++;
    const ox = this.cx, oy = this.cy; this.view(); { const sp = Math.hypot(this.cx - ox, this.cy - oy) / Math.max(dt, 1e-3); this.camV = sp > 50 ? 0 : (this.camV || 0) + (sp - (this.camV || 0)) * 0.05; this.slow = this.keepOut > 0 && this.camV < 0.35 && this.g.world.camera.position.y < 3; this.zx = this.cx + this.fx * 3.4; this.zy = this.cy + this.fy * 3.4; }
    const jump = Math.hypot(this.cx - ox, this.cy - oy) > 60;
    if (jump) { this.populate(dt, true); this.popT = 0.2; } else { this.popT -= dt; if (this.popT <= 0) { this.popT = 0.2; this.populate(dt, false); } }
    this.grid(); this.road.length = 0;
    const A = this.agents, pl = g.player, st0 = g.statics, SC = this.still; SC.length = 0;
    // the player's cars that stand or creep; a side with a wall hard against it is no way out (probed when the car has moved)
    if (this.fbCars) for (const v of g.vehicles) { const sp = Math.hypot(v.vx || 0, v.vy || 0); if (sp > 2.2 || !v.def || Math.abs(v.x - this.cx) > 130 || Math.abs(v.y - this.cy) > 130) continue;
      const q = this._stillPool[SC.length] || (this._stillPool[SC.length] = {}); q.x = v.x; q.y = v.y; q.c = Math.cos(v.h); q.s = Math.sin(v.h); q.hl = v.def.len / 2 + 0.27; q.hw = v.def.wid / 2 + 0.27; q.sp = sp; q.R = q.hl + 0.75;
      if (q.v !== v || q.px !== v.x || q.py !== v.y || q.ph !== v.h) { q.v = v; q.px = v.x; q.py = v.y; q.ph = v.h; q.okL = q.okR = true; for (const sd of [1, -1]) for (const u of [-0.6, 0, 0.6]) { if (st0.resolve(v.x + q.c * q.hl * u - q.s * (q.hw + 0.25) * sd, v.y + q.s * q.hl * u + q.c * (q.hw + 0.25) * sd, 0.24, _o, true) > 0) { if (sd > 0) q.okL = false; else q.okR = false; } } }
      SC.push(q); }
    for (let i = A.length - 1; i >= 0; i--) {
      const a = A[i]; if (!a || a.gone) continue; a.t += dt; const think = (this.frame + a.tk) % 3 === 0;
      if (a.state !== 'down' && g.vehicles.length && this.cars(a, dt)) { /* struck */ }
      switch (a.state) {
        case 'walk':
          if (a.lead) { if (a.lead.gone) { a.lead = null; break; } this.follow(a, dt, think); break; }
          this.walkOn(a, dt, think);
          if (think && !a.gone && a.state === 'walk' && a.w.kind === 'strip' && !a.path) {
            // now and then someone stops for a while; a trip that is over ends at a doorway when no one is near to watch
            const q = this.rand();
            if (q < 0.0004 && this.nStand < this.agents.length * 0.2 && (!a.fol || !a.fol.some((f) => f.kid))) this.stand(a, 15 + this.rand() * 70, false);
            else if (q < 0.0009 && !a.fol && !this.inFront(a.x, a.y, this.keepOut + 1.5)) { if (this.rand() < 0.5) this.hold(a, 'phone'); a.state = 'stand'; this.nStand++; a.t = 0; a.standT = 3 + this.rand() * 8; a.tx = a.x; a.ty = a.y; a.th = a.h + (this.rand() - 0.5) * 1.4; }
            else if (a.trip < 0 && !a.fol && a.w.pop > a.w.want && Math.hypot(a.x - this.cx, a.y - this.cy) > 80) { bandAt(a.w, a.s, B); if (B.hi < 11) { a.lt = B.hi + 0.5; a.door = 2; } a.trip = 1e9; }
          }
          if (a.door === 2 && !a.gone) { bandAt(a.w, clamp(a.s, 0, a.w.len), B); a.la = 0; if (a.l > B.hi - 0.15) { if (Math.hypot(a.x - this.cx, a.y - this.cy) > 70 || this.unseen(a.x, a.y)) this.remove(a); else { a.door = 0; a.lt = (B.lo + B.hi) / 2; a.trip = 200; } } }
          break;
        case 'wait': {
          const w = a.w, q = a.wq; if (a.lead) { this.follow(a, dt, think); a.state = a.lead.state === 'wait' ? 'wait' : a.lead.state === 'cross' ? 'cross' : 'walk'; break; }
          this.standStill(a, dt, (a.hand && a.hand.stand) || this.waitClip || a.idle);
          if (q.go < 0) { if (think && this.canWalk(w, a)) q.go = a.t + 0.15 + this.rand() * 1.1 + q.n * 0.12; else if (a.t > 75 && think) { /* stuck at a crossing that never clears: give it up */ w.wait[q.end][q.n] = 0; a.wq = null; a.d = -a.d; this.rejoin(a); } }
          else if (a.t >= q.go) { if (this.canWalk(w, a, 0)) { w.wait[q.end][q.n] = 0; a.wq = null; a.state = 'cross'; a.lt = clamp((a.x - w.ax) * w.nx + (a.y - w.ay) * w.ny, -1.8, 1.8); a.la = 0; if (a.fol) for (const f of a.fol) f.state = 'cross'; } else q.go = -1; }
          break; }
        case 'cross': {
          if (a.lead) { this.follow(a, dt, think); if (a.lead.state !== 'cross' && a.lead.state !== 'wait') a.state = 'walk'; break; }
          const w = a.w; this.walkOn(a, dt, think); if (a.gone) break;
          if (a.w !== w || a.w.kind !== 'cross') { if (a.state === 'cross') a.state = 'walk'; if (a.fol) for (const f of a.fol) if (f.state === 'cross') f.state = 'walk'; }
          else if (think) {     // traffic that is moving on the crossing: do not step in front of it, get clear of it
            if (w.carsT !== this.frame) { w.carsT = this.frame; const L = w.cars || (w.cars = []); L.length = 0; const mx = w.ax + w.ux * w.len / 2, my = w.ay + w.uy * w.len / 2; for (const c of g.traffic.cars) if (Math.abs(c.x - mx) < 24 && Math.abs(c.y - my) < 24) L.push(c); }
            for (const c of w.cars) { const dx = a.x - c.x, dy = a.y - c.y; if (Math.abs(dx) > 9 || Math.abs(dy) > 9) continue; const fx = Math.cos(c.h), fy = Math.sin(c.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx, hw = c.def.wid / 2;
              if (Math.abs(f) < c.def.len / 2 + 0.4 && Math.abs(s) < hw + 0.4) { const push = hw + 0.4 - Math.abs(s), sg = Math.sign(s || 1); a.x += -fy * sg * push * 0.5; a.y += fx * sg * push * 0.5; a.vcap = Math.min(a.vcap, 0.6); }
              else if (c.v > 1.5 && f > 0 && f < c.def.len / 2 + 1.5 + c.v * 1.3) { const ns = s + (-Math.cos(a.h) * fy + Math.sin(a.h) * fx) * a.v0 * 1.2; if (Math.abs(s) > hw + 0.5 && Math.abs(ns) < hw + 0.6) a.vcap = 0; } }
          }
          break; }
        case 'stand': {
          this.standStill(a, dt, a.talk && (a.fol || a.lead) ? a.talk : a.idle); a.onRoad = false; if (a.lead && a.talk && a.clip === a.talk.i && a.lead.clip === a.lead.talk.i) a.ph = a.lead.ph;
          if (a.t > a.standT && !a.lead && a.w) { a.state = 'walk'; this.nStand--; a.path = null; bandAt(a.w, clamp(a.s, 0, a.w.len), B); a.lt = clamp((B.lo + B.hi) / 2 + (this.rand() - 0.5), B.lo, B.hi); a.la = 0; if (a.fol) for (const f of a.fol) { f.state = 'walk'; this.nStand--; f.talk = null; } a.talk = null; }
          break; }
        case 'flee': {
          const sp = Math.min(4.2, this.jog.speed * a.tall * 1.25); a.v = sp;
          if (!this.fbWalls) { g.statics.resolve(a.x + a.vx * sp * dt, a.y + a.vy * sp * dt, 0.3, _o, true); a.x = _o.x; a.y = _o.y; }
          else {
            // Public feedback ("when I shoot at people sometimes they walk through buildings"): a run used to keep ONE direction for its whole
            // length, pressed into whatever wall was there. Now a wall met turns the run along it (the way they were leaning; head-on, to one
            // side by who they are), a step that would cross a wall is not taken, and a run that gets nowhere (a corner) turns away from the wall.
            if (st0.resolve(a.x + a.vx * sp * dt, a.y + a.vy * sp * dt, 0.3, _o, true)) {
              const nx = _o.nx, ny = _o.ny, tx = -ny, ty = nx, along = tx * a.vx + ty * a.vy; a.wnx = nx; a.wny = ny;
              if (a.vx * nx + a.vy * ny < -0.05) { const sg = Math.abs(along) > 0.15 ? Math.sign(along) : a.id & 1 ? 1 : -1, k = Math.min(1, dt * 8); a.vx += (tx * sg - a.vx) * k; a.vy += (ty * sg - a.vy) * k; const L = Math.hypot(a.vx, a.vy) || 1; a.vx /= L; a.vy /= L; this.fb.wallTurn++; }
              if (st0.raycast(a.x, a.y, _o.x, _o.y) < 1) { _o.x = a.x; _o.y = a.y; a.vx = -a.vx; a.vy = -a.vy; this.fb.wallStop++; }
            }
            a.x = _o.x; a.y = _o.y;
            a.fq = (a.fq || 0) + dt; if (a.fq > 0.7 || a.fpx === undefined) { if (a.fpx !== undefined && a.fq < 2 && Math.hypot(a.x - a.fpx, a.y - a.fpy) < 1.1 && a.wnx !== undefined) { const u = (a.id & 1 ? 0.6 : -0.6), L = Math.hypot(a.wnx - a.wny * u, a.wny + a.wnx * u) || 1; a.vx = (a.wnx - a.wny * u) / L; a.vy = (a.wny + a.wnx * u) / L; } a.fq = 0; a.fpx = a.x; a.fpy = a.y; }
          }
          a.h += clamp(wrapPi(Math.atan2(a.vy, a.vx) - a.h), -9 * dt, 9 * dt);
          a.onRoad = !g.statics.onSidewalk(a.x, a.y); a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12);
          if (a.t > 1.6) { let threat = false; for (const v of g.vehicles) if (Math.hypot(v.vx, v.vy) > 3 && Math.hypot(a.x - v.x, a.y - v.y) < 9) threat = true; if (!threat) this.rejoin(a); }
          break; }
        case 'sit': a.onRoad = false; if (a.lead && !a.lead.gone) a.ph = a.lead.ph; break;
        case 'down':
          plainSlide(g, a, dt); { const k = Math.exp(-3.5 * dt); a.vx *= k; a.vy *= k; } a.fall = Math.min(1, a.fall + dt * 4); a.onRoad = !g.statics.onSidewalk(a.x, a.y); a.z = (a.onRoad ? 0 : 0.15) + 0.12 * a.fall; a.rate = 0; continue;
      }
      if (a.gone) continue;
      // give way to the player on foot
      if (pl && !pl.vehicle && a.state !== 'sit') { const dx = a.x - pl.x, dy = a.y - pl.y, dd = Math.hypot(dx, dy); if (dd < 0.7 && dd > 1e-3) { a.x += (dx / dd) * (0.7 - dd); a.y += (dy / dd) * (0.7 - dd); } }
      if (this._cam && a.state !== 'sit') { const dx = a.x - this.cx, dy = a.y - this.cy, dd = dx * dx + dy * dy; if (dd < 3.2 && dd > 1e-4 && g.world.camera.position.y < 3) { const d = Math.sqrt(dd); a.x += (dx / d) * (1.8 - d) * 0.12; a.y += (dy / d) * (1.8 - d) * 0.12; } }
      if (SC.length && a.state !== 'sit') this.offCars(a, dt, think);
      // on the way back to a walk after a run: not through a wall; pressed against one and getting nowhere, look again for a way, then give up and stand
      if (a.fbBack > 0) { a.fbBack -= dt; if (st0.resolve(a.x, a.y, 0.3, _o, true)) { a.x = _o.x; a.y = _o.y; }
        if ((a.fbT += dt) > 1.2) { if (a.state === 'walk' && !a.lead && a.vcap > 0.4 && Math.hypot(a.x - a.fbx, a.y - a.fby) < 0.35) { const n = a.fbN || 0; if (n > 0) { this.leaveGroup(a); this.strand(a); } else { this.rejoin(a); a.fbN = n + 1; } } a.fbT = 0; a.fbx = a.x; a.fby = a.y; } }
      // and within 70 m of the camera nobody on the move passes through a wall at all (the bands are sampled every 2.5 m and cut a building's corner here
      // and there: without a shot fired, 87 of 3000 people were more than 0.6 m inside a building at some moment of a minute): looked at on think steps
      else if (this.fbWalls && think && a.v > 0.05 && a.state !== 'flee' && a.state !== 'cross') { const dx = a.x - this.cx, dy = a.y - this.cy; if (dx * dx + dy * dy < 4900 && st0.resolve(a.x, a.y, 0.26, _o, true)) { a.x = _o.x; a.y = _o.y; this.fb.wallHold++; } }
      if (a.gone) continue;
      if (a.onRoad) this.road.push(a);
      this.animate(a, dt);
    }
    if (t0) this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  stats() {
    const s = { n: this.agents.length, walk: 0, stand: 0, sit: 0, wait: 0, cross: 0, flee: 0, down: 0, groups: 0, road: this.road.length, spawned: this.spawned, retired: this.retired, want: this.sumWant, ms: +this.ms.toFixed(3) };
    for (const a of this.agents) { s[a.state]++; if (a.fol && a.fol.length) s.groups++; } return s;
  }
}
