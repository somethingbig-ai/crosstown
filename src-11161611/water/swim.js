// water/swim.js (water lane, Nov 15; Matt: "SWIMMING: the player can jump or fall in and swim, and it must feel realistic (surface swim, bob in
// the waves, splash in and out, climb out at ladders and piers; a car or bike that goes in sinks)").
//   install(game, W) is called at the end of water/install.js.   ?swim=0: nothing here is wrapped.
// What a player gets:
//   in     Space toward the water at the sea wall, or a sprint held against it, takes him over the coping and into the river (splash, a dip under).
//          Space at the helm of a boat: over the side. Walking against the wall stops him as before.
//   swim   W A S D by the camera, Shift = front crawl; breaststroke otherwise; keys released = treading water upright. He floats on W.surf (waves and
//          wakes lift him), boats push him aside, a fast one hurts.
//   out    F (or swimming into it) at a ladder: a 1.6 s climb to the street. F beside a boat: aboard (W.board). Ladders: one instanced mesh, every
//          60 m of sea wall inside the playable box and one beside every berth.
//   cars   the player's car or motorcycle that meets the sea wall at 45 km/h or more, within about 45 degrees of square, goes over: it flies, lands
//          with a big splash, floats a few seconds going down by the nose and sinks; the driver is put in the water beside it. Slower: the wall.
// The top of this file (down to "the game's side") is plain arithmetic and runs in node: lanes/water/tools/swimsim.mjs.
// The game's own code is wrapped, never edited: step, stepBusy, syncVisuals, camTarget, placeCamera, nearestCar, hud.draw.
// QA: game.swim (state, stats, ladders, errs); game.swim.vault() throws him in from where he stands; game.swim.put(x, y) sets him afloat there.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, k) => a + (b - a) * k, TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export const TUNE = {
  g: 12.7,            // m/s2 in the air (the jump's own feel: a little heavier than the real thing)
  cope: 0.47,         // m, the top of the sea wall's coping above the street (streets/water.js COPE_TOP 0.45)
  copeW: 1.2,         // m, the coping's width: the wall the game stops you at stands this far inland of the shore line
  line: 1.42,         // m from the feet to the water line of a man treading water (chin just clear)
  wade: 0.55,         // m of leg under the surface at which a fall becomes a splash
  K: 13, C: 4.2,      // the float: spring to the surface and its damping (a 1.7 s bob, settles in two)
  swim: 1.25, sprint: 2.35,   // m/s: breaststroke, front crawl
  turn: 3.2,          // 1/s: how fast the heading follows the stick
  acc: 2.2, drag: 2.4,        // 1/s: getting up to pace; slowing when the keys are let go
  off: 0.45,          // m kept between the swimmer and the wall
  rBreast: 0.62, rCrawl: 1.05, rTread: 0.8,     // strokes a second
  minOut: 3.0,        // m/s out from the wall that any way in is given at least
  vaultUp: 5.4, vaultOut: 3.6,                  // the run-up vault: up and out
  runHold: 0.18,      // s of sprinting square against the wall before he goes over
  climb: 1.6,         // s on the ladder
  carMin: 12.5,       // m/s (45 km/h): slower than this the wall holds a car
  carSquare: 0.7,     // share of the speed that must point at the water (within about 45 degrees of square-on)
  carKick: 2.4,       // m/s up as the wheels ride over the coping
  floatT: 3.6, bikeFloatT: 1.3, draft: 0.5, deep: 6.5,   // a car afloat: seconds, metres of it under at first; metres under at which it is gone
  ejectT: 1.1,        // s after the splash at which the driver is out and swimming
};

// ---------------------------------------------------------------------------------------------- the shore line, exactly (the field is good to a metre)
// lines: polylines [[x, y], ...] with the LAND ON THE LEFT of their direction (city.water[].shore). near() gives the nearest piece within reach:
// d = metres from the line, + on the water side; (nx, ny) = unit normal toward the water; (px, py) = the nearest point on the line.
export class ShoreIndex {
  constructor(lines, cell = 32) {
    this.cell = cell; this.m = new Map(); this.n = 0; this.len = 0;
    for (const L of lines || []) for (let i = 0; i + 1 < L.length; i++) { const a = L[i], b = L[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-3) continue; const s = [a[0], a[1], b[0], b[1], (b[1] - a[1]) / l, -(b[0] - a[0]) / l]; this.n++; this.len += l;
      for (let u = 0; u <= l; u += cell * 0.5) this._put(a[0] + (b[0] - a[0]) * u / l, a[1] + (b[1] - a[1]) * u / l, s); this._put(b[0], b[1], s); }
  }
  _put(x, y, s) { const k = Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell); let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); if (a.indexOf(s) < 0) a.push(s); }
  near(x, y, out, R = 24) {
    const c = this.cell, i0 = Math.floor((x - R) / c), i1 = Math.floor((x + R) / c), j0 = Math.floor((y - R) / c), j1 = Math.floor((y + R) / c); let best = R, hit = null, bx = 0, by = 0;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.m.get(i * 100003 + j); if (!a) continue;
      for (const s of a) { const dx = s[2] - s[0], dy = s[3] - s[1], t = clamp(((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy), 0, 1), px = s[0] + dx * t, py = s[1] + dy * t, d = Math.hypot(x - px, y - py); if (d < best) { best = d; hit = s; bx = px; by = py; } } }
    if (!hit) return null; const side = (x - hit[0]) * hit[4] + (y - hit[1]) * hit[5];
    out.d = side >= 0 ? best : -best; out.nx = hit[4]; out.ny = hit[5]; out.px = bx; out.py = by; return out;
  }
}

// ---------------------------------------------------------------------------------------------- who goes in
// a car (x, y, vx, vy; len, wid) near the wall w (from ShoreIndex.near): does it go over this step?
export function carGoesIn(v, w, dt, T = TUNE) {
  if (!w || w.d >= 0) return false; const sp = Math.hypot(v.vx, v.vy), vn = v.vx * w.nx + v.vy * w.ny; if (sp < T.carMin || vn < sp * T.carSquare) return false;
  const left = -w.d - (T.copeW + (v.len || 4.5) * 0.3 + (v.wid || 1.8) * 0.5);      // metres before its front circle meets the wall
  return left < vn * dt * 2 + 0.7;
}
// a man on foot at the wall. s: { air (in a jump), vx, vy (his speed in the air), h (heading), run (sprinting, keys held), hold (seconds he has been pressing) }
export function footGoesIn(s, w, T = TUNE) {
  if (!w || w.d >= 0) return false; const face = Math.cos(s.h) * w.nx + Math.sin(s.h) * w.ny;
  if (s.air) return w.d > -(T.copeW + 1.1) && (s.vx * w.nx + s.vy * w.ny > 1.2 || (face > 0.6 && w.d > -(T.copeW + 0.6)));
  return !!s.run && w.d > -(T.copeW + 0.6) && face > 0.75 && s.hold >= T.runHold;
}

// ---------------------------------------------------------------------------------------------- the strokes (pure: phase in, where the hands and ankles go out)
// Arms: out = [ahead, to the side (outward), up] from the shoulder, in arm lengths. Legs: out = [reach along the leg line (leg lengths), toward the belly, outward (m)].
const key = (K, u, out) => { u -= Math.floor(u); let i = 1; while (i < K.length - 1 && K[i][0] < u) i++; const a = K[i - 1], b = K[i], k = sm((u - a[0]) / (b[0] - a[0] || 1)); for (let j = 0; j < 3; j++) out[j] = lerp(a[j + 1], b[j + 1], k); return out; };
const BREAST_ARM = [[0, 0.95, 0.12, -0.1], [0.3, 0.95, 0.12, -0.1], [0.55, 0.45, 0.82, -0.3], [0.72, 0.3, 0.25, -0.5], [0.86, 0.5, 0.12, -0.3], [1, 0.95, 0.12, -0.1]];      // glide, sweep out, sweep in under the chest, shoot forward
const BREAST_LEG = [[0, 0.97, 0, 0.07], [0.5, 0.97, 0, 0.07], [0.72, 0.56, 0.2, 0.3], [0.84, 0.82, 0.06, 0.5], [0.95, 0.97, 0, 0.1], [1, 0.97, 0, 0.07]];                  // straight, heels drawn up, whipped out, snapped together
export function armCrawl(ph, side, out) { const a = TAU * (ph + (side < 0 ? 0.5 : 0)), s = Math.sin(a); out[0] = 0.92 * Math.cos(a); out[1] = 0.12 + 0.2 * Math.max(0, -s); out[2] = -s * (s > 0 ? 0.8 : 0.5) - 0.08; return out; }      // side +1 right, -1 left: half a stroke apart; under the water going back (s > 0), over it coming forward
export function armBreast(ph, out) { return key(BREAST_ARM, ph, out); }
export function armTread(t, side, out) { const w = TAU * TUNE.rTread * t + (side < 0 ? 1.3 : 0); out[0] = 0.34 + 0.1 * Math.cos(w); out[1] = 0.72 + 0.2 * Math.sin(w); out[2] = -0.3 + 0.05 * Math.sin(2 * w); return out; }
export function legCrawl(ph, side, out) { out[0] = 0.96; out[1] = 0.13 * Math.sin(TAU * 3 * ph + (side < 0 ? Math.PI : 0)); out[2] = 0.03; return out; }      // six beats to the stroke
export function legBreast(ph, out) { return key(BREAST_LEG, ph, out); }
export function legTread(t, side, out) { const w = TAU * TUNE.rTread * t + (side < 0 ? Math.PI : 0); out[0] = 0.8 + 0.08 * Math.sin(w); out[1] = 0.16 + 0.12 * Math.cos(w); out[2] = 0.14 + 0.1 * Math.sin(w); return out; }
// how hard the breaststroke drives through its cycle (mean 1): the pull, then the kick; the glide between loses way
const hump = (u, a, b) => (u > a && u < b ? Math.sin(Math.PI * (u - a) / (b - a)) ** 2 : 0);
export const breastDrive = (ph) => { ph -= Math.floor(ph); return (0.75 + 0.35 * hump(ph, 0.36, 0.72) + 0.5 * hump(ph, 0.82, 1.0)) / 0.858; };

// ---------------------------------------------------------------------------------------------- the swimmer
// env: surf(x, y) -> the surface's height; wall(x, y, out) -> ShoreIndex.near or null; open(x, y) -> may he be here (afloat).
// States: 'off', 'air' (over the wall and falling), 'swim', 'climb' (a ladder), 'land' (out: the game has him again).
// In the air and on the ladder zf is the height of his feet; in the water z is his water line (TUNE.line above the feet, upright) and rides on the spring.
export class Swimmer {
  constructor(env, T = TUNE) { this.env = env; this.T = T; this.state = 'off'; this.x = this.y = this.h = 0; this.z = this.zf = this.vz = 0; this.vx = this.vy = 0; this.sp = 0; this.kx = this.ky = 0; this.lie = 0; this.crawl = 0; this.phase = 0; this.t = 0; this.wetT = 0; this.ev = {}; this.L = null; this.ct = 0; this.strokes = 0; this.moving = false; this._w = {}; }
  // over the wall: from (x, y), feet at zf, at this speed. n = the wall there (ShoreIndex.near), or null out on the water (off a boat)
  enter(x, y, zf, vx, vy, vz, h, n) {
    const T = this.T; if (n) { const vn = vx * n.nx + vy * n.ny; if (vn < T.minOut) { vx += n.nx * (T.minOut - vn); vy += n.ny * (T.minOut - vn); } }
    Object.assign(this, { state: 'air', x, y, zf, vx, vy, vz, h, ps: undefined, sp: 0, kx: 0, ky: 0, lie: 0, crawl: 0, t: 0, wetT: 0, L: null }); this.ev = {};
  }
  // straight into the water at (x, y): beside a car that went in. under = metres below floating he starts
  afloat(x, y, h, under = 0.5) { Object.assign(this, { state: 'swim', x, y, h, z: this.env.surf(x, y) - under, vz: 0.4, ps: undefined, sp: 0, kx: 0, ky: 0, lie: 0, crawl: 0, t: 0, wetT: 0, L: null }); this.ev = {}; }
  rootZ() { return this.state === 'swim' ? this.z - this.T.line : this.zf; }
  under() { return this.state === 'swim' && this.z + 0.16 < this.env.surf(this.x, this.y); }      // mouth and nose below the surface
  startClimb(L) { if (this.state !== 'swim') return false; this.state = 'climb'; this.L = L; this.ct = 0; this.zf = this.z - this.T.line; this.cx = this.x; this.cy = this.y; this.cz = this.zf; this.ch = this.h; this.sp = 0; return true; }
  step(dt, inp) {
    const T = this.T, E = this.env; this.ev = {}; this.t += dt;
    if (this.state === 'air') {
      this.vz -= T.g * dt; this.zf += this.vz * dt; this.x += this.vx * dt; this.y += this.vy * dt;
      const w = E.wall(this.x, this.y, this._w), over = w && w.d < 0.25;
      if (over && w.d > -T.copeW && this.zf < T.cope) { this.zf = T.cope; if (this.vz < 0) this.vz = 0; }      // across the coping, never through it
      const s = E.surf(this.x, this.y);
      if (!over && this.zf + T.wade < s) { const hs = Math.hypot(this.vx, this.vy); this.ev.splash = Math.hypot(this.vz, hs * 0.5); this.state = 'swim'; this.z = this.zf + T.line; this.vz *= 0.62; this.sp = Math.min(hs * 0.45, T.sprint); this.ps = s; if (hs > 0.5) this.h = Math.atan2(this.vy, this.vx); this.wetT = 0; }
      return;
    }
    if (this.state === 'climb') {
      const L = this.L; this.ct += dt; const k = this.ct / T.climb, a = sm(k / 0.2), b = sm((k - 0.12) / 0.63), c = sm((k - 0.75) / 0.25);
      const fx = L.x + L.nx * 0.3, fy = L.y + L.ny * 0.3; this.x = lerp(lerp(this.cx, fx, a), L.lx, c); this.y = lerp(lerp(this.cy, fy, a), L.ly, c);
      this.zf = lerp(lerp(this.cz, T.cope, b), L.lz || 0, c) + Math.sin(c * Math.PI) * 0.12; this.h = this.ch + wrapPi(Math.atan2(-L.ny, -L.nx) - this.ch) * a;
      if (k >= 1) { this.state = 'land'; this.x = L.lx; this.y = L.ly; this.zf = L.lz || 0; this.ev.out = true; }
      return;
    }
    if (this.state !== 'swim') return;
    this.wetT += dt;
    // the float: his water line follows the surface on a spring, so the swell lifts him a moment late and a wake rocks him
    const s = E.surf(this.x, this.y), vs = this.ps === undefined || !(dt > 0) ? 0 : clamp((s - this.ps) / dt, -3, 3); this.ps = s; this.vz += (T.K * (s - this.z) + T.C * (vs - this.vz)) * dt; this.z += this.vz * dt;      // (the damping is against the water's own rise and fall: he goes up with a swell, not through it)
    // the stick
    const mx = inp ? inp.mx || 0 : 0, my = inp ? inp.my || 0 : 0, m = Math.hypot(mx, my), go = m > 0.1, run = go && !!(inp && inp.run); this.moving = go;
    if (go) { const a = inp.yaw + Math.atan2(mx, my), dh = wrapPi(a - this.h); this.h = wrapPi(this.h + dh * Math.min(1, dt * T.turn)); const want = (run ? T.sprint : T.swim) * Math.min(1, m) * Math.max(0, Math.cos(dh)); this.sp += (want - this.sp) * Math.min(1, dt * T.acc); }
    else this.sp *= Math.exp(-T.drag * dt);
    this.lie += ((go ? 1 : 0) - this.lie) * Math.min(1, dt * (go ? 3.2 : 2.4)); this.crawl += ((run ? 1 : 0) - this.crawl) * Math.min(1, dt * 3.5);
    const p0 = this.phase; this.phase += dt * lerp(T.rBreast, T.rCrawl, this.crawl) * (go ? 1 : 0.35); if (this.phase >= 1) { this.phase -= 1; this.strokes++; this.ev.stroke = 1; } if ((p0 < 0.5) !== (this.phase < 0.5)) this.ev.hand = this.phase < 0.5 ? 1 : -1;      // a hand goes in: right at 0, left at a half
    const v = this.sp * lerp(breastDrive(this.phase), 1 + 0.05 * Math.sin(TAU * 2 * this.phase), this.crawl); this.v = v;
    const kd = Math.exp(-3 * dt); this.kx *= kd; this.ky *= kd;
    this.move(this.x + (Math.cos(this.h) * v + this.kx) * dt, this.y + (Math.sin(this.h) * v + this.ky) * dt);
  }
  // to (nx, ny), kept off the wall and in the water
  move(nx, ny) {
    const T = this.T, E = this.env, w = E.wall(nx, ny, this._w); this.touch = false;
    if (w && w.d < T.off) { nx += w.nx * (T.off - w.d); ny += w.ny * (T.off - w.d); this.touch = true; }
    if (!E.open(nx, ny)) { if (E.open(nx, this.y)) ny = this.y; else if (E.open(this.x, ny)) nx = this.x; else { nx = this.x; ny = this.y; } this.sp *= 0.6; this.touch = true; }
    this.x = nx; this.y = ny;
  }
}

// ---------------------------------------------------------------------------------------------- a car (or a motorcycle) that goes in
// States: 'fly' (over the coping and through the air), 'float' (down by the nose, bubbling), 'sink', 'gone'. z = the height of its wheels' ground.
export class Sinker {
  constructor(env, T = TUNE) { this.env = env; this.T = T; this.state = 'off'; this._w = {}; this.ev = {}; }
  start(x, y, h, vx, vy, len = 4.5, bike = false) { Object.assign(this, { state: 'fly', x, y, h, vx, vy, z: 0, vz: this.T.carKick, pitch: 0, roll: 0, t: 0, len, bike, vs: 0, wob: Math.random() * 6 }); this.ev = {}; }
  step(dt) {
    const T = this.T, E = this.env; this.ev = {}; this.t += dt; if (this.state === 'off' || this.state === 'gone') return;
    this.x += this.vx * dt; this.y += this.vy * dt; const s = E.surf(this.x, this.y);
    if (this.state === 'fly') {
      const w = E.wall(this.x, this.y, this._w), on = w && w.d < this.len * 0.2;      // the wheels still have wall under them
      this.vz -= 9.81 * dt; this.z += this.vz * dt; if (on && this.z < 0.12) { this.z = 0.12; if (this.vz < 0) this.vz = 0; }
      this.pitch += (on ? 0.25 : -0.85) * dt * (this.bike ? 1.6 : 1);
      if (!on && this.z + 0.3 < s) { this.ev.splash = Math.hypot(this.vx, this.vy, this.vz); this.state = 'float'; this.t = 0; this.vx *= 0.38; this.vy *= 0.38; this.vz *= 0.25; }
      return;
    }
    const kd = Math.exp(-2.2 * dt); this.vx *= kd; this.vy *= kd;
    if (this.state === 'float') {
      const F = this.bike ? T.bikeFloatT : T.floatT, k = this.t / F, want = s - T.draft - 0.9 * k * k; this.vz += (16 * (want - this.z) - 4.5 * this.vz) * dt; this.z += this.vz * dt;
      this.pitch += (-0.42 * (0.35 + 0.65 * k) - this.pitch) * Math.min(1, dt * 2.2); this.roll = 0.05 * Math.sin(this.t * 1.9 + this.wob) * (1 - 0.5 * k); this.ev.bubbles = 0.4 + 0.6 * k;
      if (this.t >= F) { this.state = 'sink'; this.t = 0; this.vs = Math.max(0.15, -this.vz); }
      return;
    }
    this.vs = Math.min(1.7, this.vs + 1.0 * dt); this.z -= this.vs * dt; this.pitch += (-0.95 - this.pitch) * Math.min(1, dt * 0.9); this.roll *= Math.exp(-dt); this.ev.bubbles = Math.max(0, 1 - this.t / 4);
    if (this.z < s - T.deep) this.state = 'gone';
  }
}

// where ladders go along shore lines: every `gap` metres, each { x, y (on the line), nx, ny (toward the water) }. ok(p) filters.
export function ladderSpots(lines, gap = 60, ok = null) {
  const out = []; for (const L of lines || []) { let run = gap * 0.5;
    for (let i = 0; i + 1 < L.length; i++) { const a = L[i], b = L[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-3) continue; const tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
      while (run <= l) { const p = { x: a[0] + tx * run, y: a[1] + ty * run, nx: ty, ny: -tx }; if (!ok || ok(p)) { out.push(p); run += gap; } else run += 6; }
      run -= l; } }
  return out;
}

// ================================================================================================ the game's side
export async function install(game, W) {
  const g = game, P = g && g.P; if (!g || !W || !W.surf) return null; if (g.swim) return g.swim; if (P && P.get('swim') === '0') return null;
  const THREE = await import('three'); let EntryRig = null; try { EntryRig = (await import('../entry/rig.js')).EntryRig; } catch (e) {}
  const pl = g.player, st = g.statics, world = g.world, city = g.city, T = TUNE, AMBER = '#ffb52e';
  const S = (g.swim = W.swim = { on: true, core: null, ladders: [], sinkers: [], errs: {}, stats: { ins: 0, vaults: 0, jumps: 0, offBoat: 0, climbs: 0, boards: 0, cars: 0, bikes: 0, sunk: 0, hits: 0, strokes: 0 }, hold: 0, space: 0, dive: false, reach: null, reachT: 0, seenT: 0, hint: null, helpT: 0, rig: null, ph: 0, tune: T });
  const err = (k, e) => { if (S.errs[k]) return; S.errs[k] = String((e && (e.stack || e.message)) || e).slice(0, 500); console.log('[swim] ' + k + ': ' + S.errs[k]); };
  const lines = (city.water || []).filter((w) => w.shore && w.shore.length > 1).map((w) => w.shore), shore = (S.shore = new ShoreIndex(lines));
  const env = { surf: W.surf, wall: (x, y, o) => shore.near(x, y, o), open: (x, y) => W.afloat(x, y) };
  const core = (S.core = new Swimmer(env)), _w = {}, _w2 = {}, _o = {};
  const kerb = (x, y) => (st && st.onSidewalk(x, y) ? 0.15 : 0);
  const heliBusy = () => { const h = g.heli; return !!(h && (h.piloted || h.busy)); };
  const dead = () => !!(g.combat && g.combat.dead);

  // ---------------------------------------------------------------- ladders
  const play = city.meta.play || [-city.meta.px, -city.meta.py, city.meta.px, city.meta.py], inPlay = (x, y, m) => x > play[0] + m && x < play[2] - m && y > play[1] + m && y < play[3] - m;
  function ladderAt(p) {      // p on the shore line with its normal: a ladder there if a man can stand behind it and float in front of it
    if (!inPlay(p.x, p.y, 5) || !W.afloat(p.x + p.nx * 1.5, p.y + p.ny * 1.5) || !W.afloat(p.x + p.nx * 4, p.y + p.ny * 4)) return null;
    for (const back of [2.0, 2.5]) { const lx = p.x - p.nx * back, ly = p.y - p.ny * back; if (W.afloat(lx, ly)) continue; if (st) { st.resolve(lx, ly, 0.34, _o); if (Math.hypot(_o.x - lx, _o.y - ly) > 0.35) continue; if (shore.near(_o.x, _o.y, _w2) && _w2.d > -1.3) continue; }
      return { x: p.x, y: p.y, nx: p.nx, ny: p.ny, lx, ly, lz: kerb(lx, ly) }; }
    return null;
  }
  try {
    for (const q of W.berths || []) { if (!shore.near(q.lx, q.ly, _w, 12)) continue; const tx = -_w.ny, ty = _w.nx, px = _w.px, py = _w.py; let L = null;
      for (const k of [6.5, -6.5, 9, -9, 0]) { const w = shore.near(px + tx * k, py + ty * k, _w2, 4); if (!w) continue; L = ladderAt({ x: w.px, y: w.py, nx: w.nx, ny: w.ny }); if (L) break; }
      if (L) { L.berth = q.name; S.ladders.push(L); } }
    const nb = S.ladders.length;
    for (const p of ladderSpots(lines, +(P && P.get('laddergap')) || 60, (p) => !!ladderAt(p))) { if (S.ladders.some((o, i) => i < nb && Math.hypot(o.x - p.x, o.y - p.y) < 25)) continue; S.ladders.push(ladderAt(p)); }
    if (S.ladders.length) {
      // one ladder: x along the wall, y up from the street, z out over the water. Rails from under the water to hand height above the coping, hooped back to the land.
      const pos = [], nor = [], col = [], idx = [], lo = W.level - 1.3, top = 1.38, YEL = [0.8, 0.58, 0.07], STL = [0.56, 0.58, 0.6];
      const box = (cx, cy, cz, sx, sy, sz, c) => { const b = new THREE.BoxGeometry(sx, sy, sz), p = b.attributes.position, n = b.attributes.normal, base = pos.length / 3; for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + cx, p.getY(i) + cy, p.getZ(i) + cz); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c[0], c[1], c[2]); } for (let i = 0; i < b.index.count; i++) idx.push(b.index.getX(i) + base); b.dispose(); };
      for (const sx of [-0.22, 0.22]) { box(sx, (lo + top) / 2, 0.11, 0.05, top - lo, 0.05, YEL); box(sx, top, -0.24, 0.05, 0.05, 0.75, YEL); box(sx, (top + 0.45) / 2, -0.6, 0.05, top - 0.45, 0.05, YEL); for (const y of [0.2, -1.1, -2.2]) box(sx, y, 0.045, 0.04, 0.04, 0.09, STL); }
      for (let y = lo + 0.25; y <= 0.36; y += 0.3) box(0, y, 0.11, 0.44, 0.035, 0.04, STL);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }), S.ladders.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      S.ladders.forEach((L, i) => { q.setFromAxisAngle(UPV, Math.atan2(L.nx, -L.ny)); M.compose(v.set(L.x, 0, -L.y), q, one); mesh.setMatrixAt(i, M); });
      mesh.instanceMatrix.needsUpdate = true; mesh.name = 'swim_ladders'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; world.scene.add(mesh); S.ladderMesh = mesh; S.ladderTris = (idx.length / 3) * S.ladders.length;
    }
  } catch (e) { err('ladders', e); }

  // ---------------------------------------------------------------- sounds and spray
  const snd = (fn) => { try { const s = g.sound; if (s && s.on) fn(s); } catch (e) {} };
  const splashSound = (k) => snd((s) => { s.burst(0.35 + 0.5 * k, 0.16 + 0.34 * k, 1300 + 1500 * k); s.shot(120 - 50 * k, 0.22 + 0.2 * k, 'sine', 0.12 + 0.2 * k, -40); });
  const strokeSound = (k) => snd((s) => s.burst(0.14, 0.025 + 0.035 * k, 2600));
  const spray = W.spray, emit = (x, up, y, vx, vup, vy, life, size) => { if (spray) spray.emit(x, up, -y, vx, vup, -vy, life, size); };      // (map x, height, map y)
  function splash(x, y, k, dirx = 0, diry = 0) {      // k 0..1 a man, to 3 a car: a crown thrown up and out, and a column in the middle
    const s = W.surf(x, y), n = Math.round(26 + 60 * k), R = 0.25 + 0.5 * k;
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * R, out = (1.2 + 2.6 * Math.random()) * (0.6 + 0.5 * k), up = (2.2 + 3.4 * Math.random()) * (0.55 + 0.45 * k); emit(x + Math.cos(a) * r, s + 0.05, y + Math.sin(a) * r, Math.cos(a) * out + dirx * 0.35, up, Math.sin(a) * out + diry * 0.35, 0.55 + 0.6 * Math.random(), (0.09 + 0.13 * Math.random()) * (0.8 + 0.3 * k)); }
    for (let i = 0; i < 8 + 10 * k; i++) emit(x + (Math.random() - 0.5) * R, s + 0.1, y + (Math.random() - 0.5) * R, dirx * 0.2, (4 + 3 * Math.random()) * (0.6 + 0.5 * k), diry * 0.2, 0.7 + 0.4 * Math.random(), 0.14 + 0.09 * k);
    splashSound(clamp(k, 0.15, 1)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.12 * k);
  }
  const froth = (x, y, r, n, size) => { const s = W.surf(x, y); for (let i = 0; i < n; i++) { const a = Math.random() * TAU, q = Math.sqrt(Math.random()) * r; emit(x + Math.cos(a) * q, s + 0.02, y + Math.sin(a) * q, (Math.random() - 0.5) * 0.5, 0.5 + 0.9 * Math.random(), (Math.random() - 0.5) * 0.5, 0.35 + 0.35 * Math.random(), size * (0.6 + 0.8 * Math.random())); } };

  // ---------------------------------------------------------------- in and out of the water
  const busyOf = () => ({ swim: true, kind: 'swim', t: 0, z: core.rootZ() });
  function goIn(x, y, zf, vx, vy, vz, h, n, why) { core.enter(x, y, zf, vx, vy, vz, h, n); pl.busy = busyOf(); pl.x = x; pl.y = y; g.cam.mode = 'foot'; S.stats.ins++; S.stats[why] = (S.stats[why] || 0) + 1; S.seenT = 0; S.hold = 0; try { g.playerAnim('idle'); if (pl.vis.mixer) pl.vis.mixer.timeScale = 1; } catch (e) {} }
  function release() { if (pl.busy && pl.busy.swim) pl.busy = null; core.state = 'off'; S.reach = null; S.hint = null; try { if (S.rig) S.rig.restHips(); g.playerAnim('idle'); } catch (e) {} }
  const lands = (w, far) => W.afloat(w.px + w.nx * far, w.py + w.ny * far) && W.afloat(w.px + w.nx * 1.2, w.py + w.ny * 1.2);
  S.vault = () => { const w = shore.near(pl.x, pl.y, _w, 40); if (!w || pl.busy || pl.vehicle) return false; if (w.d < 0) { pl.x = w.px - w.nx * 1.6; pl.y = w.py - w.ny * 1.6; } pl.h = Math.atan2(w.ny, w.nx); goIn(pl.x, pl.y, kerb(pl.x, pl.y), w.nx * T.vaultOut, w.ny * T.vaultOut, T.vaultUp, pl.h, w, 'vaults'); return true; };
  S.put = (x, y) => { if (!W.afloat(x, y)) return false; if (pl.vehicle) return false; core.afloat(x, y, pl.h, 0.2); pl.busy = busyOf(); pl.x = x; pl.y = y; g.cam.mode = 'foot'; return true; };
  addEventListener('keydown', (e) => { if (e.code !== 'Space' || e.repeat || !S.on) return; const B = pl.busy; if (B && B.boat && B.kind === 'helm') S.dive = true; else if (!B && !pl.vehicle) S.space = 0.2; });

  // on foot, each step (nothing but two compares unless he is sprinting or in the air)
  function footWatch(dt) {
    const J = g.jump, jc = J && J.on && J.core, air = !!(jc && jc.own && !jc.grounded), I = g.input, run = !!I.run && Math.hypot(I.mx, I.my) > 0.1; if (S.space > 0) S.space -= dt;
    if (!air && !run && !(S.space > 0 && !(J && J.on))) { S.hold = 0; return; }
    if (heliBusy() || (g.fly && g.fly.on) || g.demo || dead()) return;
    const x = air ? jc.x : pl.x, y = air ? jc.y : pl.y, w = shore.near(x, y, _w, 6); if (!w) { S.hold = 0; return; }
    const spaced = S.space > 0 && !(J && J.on), face = Math.cos(pl.h) * w.nx + Math.sin(pl.h) * w.ny;
    if (air) { if (!footGoesIn({ air: true, vx: jc.vx, vy: jc.vy, h: pl.h }, w) || !lands(w, 2.2)) return; const z = jc.z, vz = jc.vz, vx = jc.vx, vy = jc.vy; jc.release(); J.phase = ''; goIn(x, y, z, vx, vy, vz, pl.h, w, 'jumps'); return; }
    if (spaced && w.d > -(T.copeW + 0.8) && face > 0.5 && lands(w, 2.2)) { S.space = 0; goIn(x, y, kerb(x, y), w.nx * T.vaultOut, w.ny * T.vaultOut, T.vaultUp, pl.h, w, 'vaults'); return; }
    S.hold = run && face > 0.75 && w.d > -(T.copeW + 0.6) ? S.hold + dt : 0;
    if (footGoesIn({ air: false, run, h: pl.h, hold: S.hold }, w) && lands(w, 2.2)) { const c = Math.cos(pl.h), s = Math.sin(pl.h); goIn(x, y, kerb(x, y), c * T.vaultOut, s * T.vaultOut, T.vaultUp, pl.h, w, 'vaults'); }
  }
  // off the boat he steers: over the side that has more water
  function offBoat() {
    const B = pl.busy, b = B && B.b; S.dive = false; if (!b || !B.boat || B.kind !== 'helm') return;
    const c = Math.cos(b.h), s = Math.sin(b.h), far = b.spec.beam / 2 + 1.6; let side = 0, best = -1e9; for (const k of [1, -1]) { const x = pl.x - s * k * far, y = pl.y + c * k * far; if (!W.afloat(x, y)) continue; const d = W.shoreDist(x, y); if (d > best) { best = d; side = k; } }
    if (!side) { W.note = { text: 'No room to jump here', t: 0 }; return; }
    W.mine = null; W.on = false; b.moored = true; b.mx = b.x; b.my = b.y; b.mh = b.h; b.thr = 0; const zf = B.z || b.z;
    goIn(pl.x, pl.y, zf, (b.vx || 0) * 0.6 - s * side * 3.3, (b.vy || 0) * 0.6 + c * side * 3.3, 3.6, Math.atan2(c * side, -s * side), null, 'offBoat');
  }

  // boats against a swimmer: pushed off the hull, knocked by a moving one, hurt by a fast one
  function boatsPush(dt) {
    for (const list of [W.boats, W.others]) for (const b of list) { const dx = core.x - b.x, dy = core.y - b.y, R = b.spec.len / 2 + 2; if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      const c = Math.cos(b.h), s = Math.sin(b.h), hl = Math.max(0, b.spec.len / 2 - b.spec.beam / 2), f = clamp(dx * c + dy * s, -hl, hl), ex = dx - c * f, ey = dy - s * f, d = Math.hypot(ex, ey) || 1e-3, r = b.spec.beam / 2 + 0.4; if (d >= r) continue;
      const nx = ex / d, ny = ey / d, vn = (b.vx || 0) * nx + (b.vy || 0) * ny - (Math.cos(core.h) * core.sp * nx + Math.sin(core.h) * core.sp * ny);
      core.move(core.x + nx * (r - d), core.y + ny * (r - d)); if (vn > 0.5) { core.kx = nx * vn * 0.9; core.ky = ny * vn * 0.9; }
      if (vn > 4.5 && (S.hitT || 0) <= 0) { S.hitT = 1.2; S.stats.hits++; snd((q) => q.thud ? q.thud() : q.burst(0.18, 0.4, 400)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.4); core.vz -= 2.2; try { if (g.combat && typeof g.combat.hurt === 'function' && typeof g.combat.health === 'number') g.combat.hurt(Math.min(60, (vn - 3) * 6)); } catch (e) {} } }
    if (S.hitT > 0) S.hitT -= dt;
  }
  // what F would do now: the nearest ladder within reach, else a boat alongside
  function findReach() {
    let best = null, bd = 1e9; for (const L of S.ladders) { const d = Math.hypot(L.x - core.x, L.y - core.y); if (d < bd) { bd = d; best = L; } } S.near = best; S.nearD = bd;
    if (best && bd < 2.1) return { ladder: best };
    for (const b of W.boats) { if (Math.abs(b.vf) > 2.5) continue; const dx = core.x - b.x, dy = core.y - b.y, c = Math.cos(b.h), s = Math.sin(b.h), hl = b.spec.len / 2 - b.spec.beam / 2, f = clamp(dx * c + dy * s, -hl, hl), d = Math.hypot(dx - c * f, dy - s * f) - b.spec.beam / 2; if (d < 1.7) return { boat: b }; }
    return null;
  }
  function swimStep(dt, B) {
    const I = g.input; B.t += dt;
    if (Math.hypot(pl.x - core.x, pl.y - core.y) > 4 || pl.vehicle) { release(); return; }      // someone put him elsewhere (a respawn, a job, a test): theirs
    const was = core.state; core.step(dt, dead() ? null : { mx: I.mx, my: I.my, run: I.run, yaw: g.cam.yaw });
    if (core.state === 'swim') {
      boatsPush(dt);
      if (core.ev.splash) { splash(core.x, core.y, clamp(core.ev.splash / 9, 0.3, 1), core.vx, core.vy); S.helpT = 0; }
      if (core.ev.stroke) { S.stats.strokes++; if (core.moving) strokeSound(core.crawl); }
      if ((S.reachT -= dt) <= 0) { S.reachT = 0.15; S.reach = findReach(); }
      const R = S.reach; let go = !!I.use && !dead();
      if (R && R.ladder && !go && core.moving && core.touch) { const L = R.ladder; if (Math.hypot(L.x - core.x, L.y - core.y) < 1.1 && -(Math.cos(core.h) * L.nx + Math.sin(core.h) * L.ny) > 0.4) { S.intoT = (S.intoT || 0) + dt; if (S.intoT > 0.3) go = true; } else S.intoT = 0; } else if (!go) S.intoT = 0;
      if (go && R && R.ladder) { core.startClimb(R.ladder); S.stats.climbs++; S.intoT = 0; froth(core.x, core.y, 0.5, 14, 0.1); splashSound(0.2); }
      else if (go && R && R.boat && typeof W.board === 'function') { const z = core.rootZ(); pl.x = core.x; pl.y = core.y; core.state = 'off'; pl.busy = null; S.stats.boards++; try { if (S.rig) S.rig.restHips(); } catch (e) {} W.board(R.boat); if (pl.busy && pl.busy.boat) pl.busy.z0 = pl.busy.z = z; froth(core.x, core.y, 0.5, 14, 0.1); splashSound(0.2); I.use = false; return; }
      S.helpT += dt;
      // "where is a ladder": none ahead for 20 s
      if ((S.viewT = (S.viewT || 0) - dt) <= 0) { S.viewT = 0.3; const L = S.near; let seen = false; if (L && S.nearD < 70) { const cy = g.cam.yaw; seen = (Math.cos(cy) * (L.x - core.x) + Math.sin(cy) * (L.y - core.y)) > 0.45 * S.nearD || S.nearD < 6; } S.seenT = seen ? 0 : S.seenT + 0.3; S.hint = S.seenT >= 20 && L ? L : null; }
    } else { S.reach = null; S.hint = null; }
    I.use = false; pl.x = core.x; pl.y = core.y; pl.h = core.h; pl.speed = core.sp; B.z = core.rootZ(); B.kind = core.state;
    if (core.state === 'land') { pl.busy = null; core.state = 'off'; g.cam.mode = 'foot'; if (st) { st.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; } try { if (S.rig) S.rig.restHips(); g.playerAnim('idle'); } catch (e) {} }
    else if (was === 'off') release();
  }

  // ---------------------------------------------------------------- cars and motorcycles that go in
  function plunge(v, w) {
    const K = new Sinker(env), bike = !!v.moto, sp = Math.hypot(v.vx, v.vy); K.start(v.x, v.y, v.h, v.vx, v.vy, v.def.len, bike);
    const rec = { v, K, aboard: !bike && pl.vehicle === v, own: Object.prototype.hasOwnProperty.call(v, 'step') ? v.step : null }; v.step = function () {}; v._sinking = true; S.sinkers.push(rec); S.stats[bike ? 'bikes' : 'cars']++;
    snd((s) => s.crash && s.crash(Math.min(14, sp * 0.5))); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.5);
    if (bike && pl.vehicle === v) {      // the rider leaves the saddle at the wall and goes in ahead of the machine
      pl.vehicle = null; pl.vis.object.visible = true; try { g.missions.onExit(v); } catch (e) {} try { if (g.moto) { g.moto.camK = 0; g.moto.wantOff = false; } } catch (e) {}
      goIn(v.x, v.y, 0.75, v.vx * 0.85, v.vy * 0.85, 4.2, v.h, null, 'thrown'); }
  }
  function eject(rec) {
    const v = rec.v; rec.aboard = false; if (pl.vehicle !== v) return; pl.vehicle = null; pl.vis.object.visible = true; g.cam.mode = 'foot'; try { g.missions.onExit(v); } catch (e) {}
    const lx = -Math.sin(v.h), ly = Math.cos(v.h), far = v.def.wid / 2 + 0.9; let x = v.x + lx * far, y = v.y + ly * far; if (!W.afloat(x, y)) { x = v.x - lx * far; y = v.y - ly * far; } if (!W.afloat(x, y)) { x = v.x; y = v.y; }
    core.afloat(x, y, v.h, 0.55); pl.busy = busyOf(); pl.x = x; pl.y = y; S.stats.ins++; S.seenT = 0; S.helpT = 0; froth(x, y, 0.5, 16, 0.1); try { g.playerAnim('idle'); if (pl.vis.mixer) pl.vis.mixer.timeScale = 1; } catch (e) {}
  }
  function stepSinkers(dt) {
    for (let i = S.sinkers.length - 1; i >= 0; i--) { const rec = S.sinkers[i], v = rec.v, K = rec.K; K.step(dt);
      v.x = K.x; v.y = K.y; v.vx = K.vx; v.vy = K.vy; v.vf = Math.hypot(K.vx, K.vy); v.z = K.z; v.pitch = K.pitch; v.roll = K.roll; v.yawV = 0; v.steer = (v.steer || 0) * 0.95; v.slip = 0; v.vs = 0; v.acc = 0; v.braking = false;
      if (K.bike) { v.zf = K.z + Math.sin(K.pitch) * 0.72; v.zr = K.z - Math.sin(K.pitch) * 0.72; if (K.state !== 'fly') v.lean = (v.lean || 0) + (1.25 - (v.lean || 0)) * Math.min(1, dt * 2); }
      if (K.ev.splash) { const c = Math.cos(K.h), s = Math.sin(K.h), k = K.bike ? 1.3 : 2.6; splash(K.x + c * K.len * 0.25, K.y + s * K.len * 0.25, k, K.vx * 2, K.vy * 2); if (!K.bike) splash(K.x - c * K.len * 0.25, K.y - s * K.len * 0.25, k * 0.7, K.vx, K.vy); }
      if (K.ev.bubbles && Math.random() < dt * 34 * K.ev.bubbles) { const c = Math.cos(K.h), s = Math.sin(K.h), a = (Math.random() - 0.3) * K.len * 0.5, q = (Math.random() - 0.5) * 1.4; froth(K.x + c * a - s * q, K.y + s * a + c * q, 0.25, 2, 0.07 + 0.05 * K.ev.bubbles); if (Math.random() < 0.08) snd((o) => o.burst(0.1, 0.03, 500 + 600 * Math.random())); }
      if (rec.aboard) { if (pl.vehicle !== v) rec.aboard = false; else if (K.state !== 'fly' && (K.state !== 'float' || K.t > T.ejectT)) eject(rec); }
      if (K.state === 'gone') { S.sinkers.splice(i, 1); if (pl.vehicle === v) eject(rec); const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); if (rec.own) v.step = rec.own; else delete v.step; v.gone = true; S.stats.sunk++; } }
  }
  function carWatch(dt) {
    const v = pl.vehicle; if (!v || v._sinking || !v.def) return; if (Math.abs(v.vx) + Math.abs(v.vy) < T.carMin) return;
    const w = shore.near(v.x, v.y, _w, 16); if (!w) return; const q = { x: v.x, y: v.y, vx: v.vx, vy: v.vy, len: v.def.len, wid: v.def.wid };
    if (carGoesIn(q, w, dt) && lands(w, 4) && lands(w, 9)) plunge(v, w);
  }

  // ---------------------------------------------------------------- the wrappers
  const step0 = g.step.bind(g); g.step = function (dt) {
    if (!S.on) return step0(dt); const d = dt > 0 ? dt : 0;
    try { if (pl.vehicle) { carWatch(d); if (pl.vehicle && pl.vehicle._sinking) g.input.use = false; } } catch (e) { err('car', e); }
    step0(dt);
    try { if (S.sinkers.length) stepSinkers(d); } catch (e) { err('sink', e); }
    try { if (S.dive) offBoat(); else if (!pl.vehicle && !pl.busy) footWatch(d); } catch (e) { err('foot', e); }
  };
  const sb0 = g.stepBusy.bind(g); g.stepBusy = function (dt) { const B = pl.busy; if (B && B.swim) { try { swimStep(dt, B); } catch (e) { err('swim', e); release(); } } else sb0(dt); };
  if (typeof g.nearestCar === 'function') { const nc0 = g.nearestCar.bind(g); g.nearestCar = function (d) { const n = nc0(d); return n && n.kind === 'veh' && n.v && n.v._sinking ? null : n; }; }      // a car going down is not got into
  const ct0 = g.camTarget.bind(g); g.camTarget = function () {
    const B = pl.busy; if (!(B && B.swim) || pl.vehicle) return ct0();
    if (core.state === 'swim') return { x: pl.x, y: pl.y, z: W.surf(pl.x, pl.y) + 0.32, dist: 3.5 + core.sp * 0.25, height: 0.32, fov: 52, yaw: pl.h, auto: core.sp > 0.3 ? 1.0 : 0 };      // low behind him; the swell lifts the view
    return { x: pl.x, y: pl.y, z: Math.max(core.zf + 1.35, W.level + 0.4), dist: 3.9, height: 0.4, fov: 52, yaw: pl.h, auto: core.state === 'climb' ? 1.4 : 0 };
  };
  // the game keeps its camera 0.4 m above the street; the water is 1.6 m below it. While he swims the floor is the water under the camera.
  const pc0 = g.placeCamera.bind(g), _cd = new THREE.Vector3(); g.placeCamera = function (dt) {
    pc0(dt); const B = pl.busy; if (!(B && B.swim) || pl.vehicle || (g.heli && g.heli.hasCamera) || (g.fly && g.fly.on)) return;
    try { const C = g.cam, cam = world.camera, pitch = Math.max(-0.25, C.pitch), d = Math.min(C.dist, C.clip === undefined ? C.dist : C.clip), cz = C.tz + C.h + d * Math.sin(pitch); if (cz >= 0.4) return;
      const y = Math.max(cz, W.surf(cam.position.x, -cam.position.z) + 0.28); if (Math.abs(y - cam.position.y) < 1e-4) return; cam.position.y = y; cam.lookAt(C.tx, C.tz + 0.15, -C.ty);
      const extra = -0.25 - C.pitch; if (extra > 0) { cam.getWorldDirection(_cd); const hl = Math.hypot(_cd.x, _cd.z) || 1, e = Math.min(1.4, Math.asin(clamp(_cd.y, -1, 1)) + extra); cam.lookAt(cam.position.x + _cd.x / hl * Math.cos(e) * 10, cam.position.y + Math.sin(e) * 10, cam.position.z + _cd.z / hl * Math.cos(e) * 10); } } catch (e) { err('camera', e); }
  };

  // ---------------------------------------------------------------- the figure: the strokes, laid over the idle clip
  const V = () => new THREE.Vector3(), _f = V(), _l = V(), _r = V(), _hp = V(), _s = V(), _t = V(), _pole = V(), _ax = V(), _nf = V(), _ld = V(), _look = V(), UP = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
  const a3 = [0, 0, 0], b3 = [0, 0, 0], c3 = [0, 0, 0];
  function pose(dt) {
    const vis = pl.vis; if (!EntryRig || !vis || !vis.mixer) return; const rig = (S.rig ||= new EntryRig(vis, vis.name || 'player')); if (!rig.ok) return;
    const h = pl.h, ch = Math.cos(h), sh = Math.sin(h); _f.set(ch, 0, -sh); _l.set(-sh, 0, -ch); _r.set(sh, 0, ch); vis.object.updateMatrixWorld(true);
    const arm = (sd, sg, fwd, lat, up, w) => { rig.pos('upper_arm_' + sd, _s); const R = rig.armLen; _t.copy(_s).addScaledVector(_f, fwd * R).addScaledVector(_r, sg * lat * R).addScaledVector(UP, up * R); const hi = sm(up * 2.5 + 0.2); _pole.set(0, 0, 0).addScaledVector(UP, lerp(-0.6, 1, hi)).addScaledVector(_r, sg * 0.8).addScaledVector(_f, -0.3); rig.arm(sd, _t, _pole, w); return _t; };
    if (core.state === 'air') {      // over the wall: a shallow dive, arms going out ahead
      const k = sm(core.t / 0.5), dn = clamp(-core.vz / 9, 0, 1); rig.tilt(_q.setFromAxisAngle(_l, 0.15 + 0.45 * dn * k));
      for (const [sd, sg] of [['L', -1], ['R', 1]]) arm(sd, sg, 0.8, 0.12, 0.5 - 0.25 * dn, 0.9 * k); return; }
    if (core.state === 'climb') {      // hand over hand, foot over foot, until he steps over the coping
      const k = core.ct / T.climb, w = sm(k / 0.15) * (1 - sm((k - 0.78) / 0.2)), ph = k * 4.2; rig.tilt(_q.setFromAxisAngle(_l, 0.14 * w)); const LL = (rig.thigh + rig.shin);
      for (const [sd, sg] of [['L', -1], ['R', 1]]) { const u = Math.sin(TAU * ph + (sg < 0 ? Math.PI : 0)); arm(sd, sg, 0.62, 0.02, 0.2 + 0.22 * u, w); rig.pos('thigh_' + sd, _s); _t.copy(_s).addScaledVector(_f, 0.24).addScaledVector(UP, -LL * (0.74 + 0.13 * u)).addScaledVector(_r, sg * 0.06); _pole.copy(_f).addScaledVector(_r, sg * 0.3); rig.leg(sd, _t, _pole, _f, -0.25, w); }
      return; }
    if (core.state !== 'swim') return;
    const lie = core.lie, cr = core.crawl, ph = core.phase, t = core.t, wT = 1 - lie, wB = lie * (1 - cr), wC = lie * cr;
    const th = lerp(0.12, lerp(1.16, 1.3, cr), lie), roll = wC * 0.3 * Math.sin(TAU * ph), bob = wT * 0.025 * Math.sin(TAU * T.rTread * 2 * t);
    // hips: under the water line, the body laid forward from them, rolled toward the pulling arm
    _hp.set(pl.x - ch * 0.32 * lie, core.z - lerp(rig.shoulderUp - 0.05, 0.2, lie) + bob - wB * 0.05 * breastDrive(ph), -(pl.y - sh * 0.32 * lie)); rig.hips(_hp, 1);
    rig.tilt(_q.setFromAxisAngle(_l, th)); _ax.copy(_f).multiplyScalar(Math.sin(th)).addScaledVector(UP, Math.cos(th)); if (Math.abs(roll) > 1e-3) rig.tilt(_q.setFromAxisAngle(_ax, roll));
    rig.bend(_l, -0.3 * lie); _look.copy(_f).addScaledVector(UP, 0.08).addScaledVector(_r, -roll * 0.5); rig.look(_look, 0.9);
    const LL = rig.thigh + rig.shin, thL = lerp(0.04, th - 0.14, lie); _ld.copy(_f).multiplyScalar(-Math.sin(thL)).addScaledVector(UP, -Math.cos(thL)); _nf.copy(_f).multiplyScalar(Math.cos(thL)).addScaledVector(UP, -Math.sin(thL));
    for (const [sd, sg] of [['L', -1], ['R', 1]]) {
      armTread(t, sg, a3); armBreast(ph, b3); armCrawl(ph, sg, c3); const hand = arm(sd, sg, a3[0] * wT + b3[0] * wB + c3[0] * wC, a3[1] * wT + b3[1] * wB + c3[1] * wC, a3[2] * wT + b3[2] * wB + c3[2] * wC, 1);
      if (core.ev.hand === sg && cr > 0.6 && core.moving) { for (let i = 0; i < 5; i++) emit(hand.x + (Math.random() - 0.5) * 0.2, W.surf(hand.x, -hand.z) + 0.04, -hand.z + (Math.random() - 0.5) * 0.2, ch * core.sp * 0.5 + (Math.random() - 0.5), 0.9 + 1.2 * Math.random(), sh * core.sp * 0.5 + (Math.random() - 0.5), 0.3 + 0.25 * Math.random(), 0.1 + 0.1 * Math.random()); }
      legTread(t, sg, a3); legBreast(ph, b3); legCrawl(ph, sg, c3); const ext = a3[0] * wT + b3[0] * wB + c3[0] * wC, kn = a3[1] * wT + b3[1] * wB + c3[1] * wC, lt = a3[2] * wT + b3[2] * wB + c3[2] * wC;
      rig.pos('thigh_' + sd, _s); _t.copy(_s).addScaledVector(_ld, LL * ext).addScaledVector(_nf, kn).addScaledVector(_r, sg * lt); _pole.copy(_nf).addScaledVector(_r, sg * (0.25 + 1.2 * wB * (b3[2] - 0.07)));
      rig.leg(sd, _t, _pole, _f, -(Math.PI / 2 + thL) * 0.88, 1); }
  }
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) {
    sv0(dt); const B = pl.busy; if (!(B && B.swim) || pl.vehicle) return;
    try { pose(dt); } catch (e) { err('pose', e); }
  };

  // ---------------------------------------------------------------- the HUD
  if (g.hud && typeof g.hud.draw === 'function') { const hd0 = g.hud.draw.bind(g.hud); g.hud.draw = function () { hd0(); const B = pl.busy; if (B && B.swim) { try { drawHud(this); } catch (e) { err('hud', e); } } }; }
  function drawHud(hud) {
    const c = hud.ctx, k = hud.k || 1, Wd = hud.w / k, H = hud.h / k; if (g.demo || g.capture || !hud.w || core.state !== 'swim') return; /* the HUD is drawn in 1080-high units: hud.k */ const F = g.menu && g.menu.keyName ? g.menu.keyName('KeyF') : 'F', R = S.reach;
    if (R) { const txt = R.ladder ? 'Climb out' : 'Climb aboard'; hud.panel(Wd / 2 - 130, H * 0.62, 260, 44, 22); hud.text(F, Wd / 2 - 96, H * 0.62 + 30, 20, AMBER, 'center', 800); hud.text(txt, Wd / 2 + 14, H * 0.62 + 29, 17, '#fff', 'center', 600); }
    else if (S.hint) { const L = S.hint, a = Math.atan2(L.y - core.y, L.x - core.x) - g.cam.yaw, d = Math.round(Math.hypot(L.x - core.x, L.y - core.y)); hud.panel(Wd / 2 - 130, H * 0.62, 260, 44, 22);
      c.save(); c.translate(Wd / 2 - 96, H * 0.62 + 22); c.rotate(-a); c.fillStyle = AMBER; c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 8); c.lineTo(0, 3); c.lineTo(-8, 8); c.closePath(); c.fill(); c.restore();
      hud.text('Ladder  ' + d + ' m', Wd / 2 + 14, H * 0.62 + 29, 17, '#fff', 'center', 600); }
    if (S.helpT < 9) { c.globalAlpha = clamp(9 - S.helpT, 0, 1); hud.panel(Wd / 2 - 300, H - 58, 600, 40, 6); hud.text('W A S D  swim     Shift  crawl     ' + F + '  climb out at a ladder or onto a boat', Wd / 2, H - 31, 15, '#fff', 'center', 600, 1); c.globalAlpha = 1; }
  }
  console.log('[swim] on: ' + S.ladders.length + ' ladders along ' + Math.round(shore.len) + ' m of shore line (' + shore.n + ' pieces)' + (EntryRig ? '' : '; no rig: the figure is not posed') + (Object.keys(S.errs).length ? '; faults: ' + Object.keys(S.errs).join(', ') : ''));
  return S;
}
