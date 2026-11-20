// core.js: the car and street sounds, all synthesised, no samples and no download. Plain arithmetic with no browser calls, so the
// same code runs on the audio thread in the game (worklet.js) and in node for measuring (lanes/gameplay/sound-state/tools/render.mjs).
//   engine   one combustion pulse per firing (cylinder count, uneven cylinders, a little jitter) through the exhaust, body and intake
//            resonances, with intake noise and diesel clatter; rpm comes from the car's speed through a gearbox that lives here (rpm
//            falls on an upshift, kicks down under the foot, flares at launch); the pulse sharpens and the tone opens with load
//   tyres    roll noise and wind by speed, squeal by sideways slip and the handbrake, kerb thumps, a scrape along a wall
//   impacts  car, wall, pole, glass, a person, a door: a broadband blow, damped metal modes, crunch grains, glass tinkles
//   street   up to NV passing cars (level by distance, pitch by the closing speed), a city bed that is generated and never loops,
//            a far horn now and then, the player's footsteps by speed
// What the game sends once a drawn frame: T[] (see I); one-off events through ev().
// SAMPLES (Nov 14, after Matt heard the synthesis: "I don't think either are really good"): setSamples() takes recorded or generated clips by name
// (assets/sfx/sfx.json, loaded by samples.js). Where a clip is there it is played in place of the synthesis: the engine as four loops per car kind,
// each resampled to the rpm the gearbox here wants and crossfaded by rpm (and with the off-load loops by throttle); roll, squeal, scrape and the city
// bed as loops; crashes, kerbs, doors, steps and the start as one-shots with variations. Every sound without a clip keeps its synthesis.
export const NV = 4;
export const I = { INCAR: 0, TYPE: 1, SPEED: 2, TOP: 3, THR: 4, BRAKE: 5, HB: 6, SLIP: 7, SCRAPE: 8, FOOT: 9, BED: 10, WALK: 11, PASS: 12, VENG: 12 + 5 * NV, VAMB: 13 + 5 * NV };      // PASS + 5k: DIST, VR, PAN, SPD, BIG. VENG, VAMB: the settings menu's Engine and Ambience sliders, 0..1
export const NP = I.PASS + 5 * NV + 2;
export const ONE = [I.BED, I.VENG, I.VAMB];      // numbers that stand at 1 until the game says otherwise
export const EV = { CAR: 0, WALL: 1, POLE: 2, GLASS: 3, BODY: 4, DOOR: 5, KERB: 6, BIKE: 7 };
export const TYPES = ['sedan', 'taxi', 'suv', 'van', 'sport', 'bus'];
// per car kind: cylinders, idle and red-line rpm, pulse width in seconds off and on load, how unequal the cylinders are, the three
// resonances [Hz, Q, gain] (exhaust, body, intake), intake noise, diesel clatter, level, and the speed each gear reaches at the red line
// (as a share of the car's top speed)
const ENG = [
  { cyl: 4, idle: 820, red: 6200, w0: 0.0052, w1: 0.0016, pat: [1, 0.84, 0.95, 0.8], res: [[108, 2.6, 1], [345, 2.2, 0.55], [980, 1.6, 0.2]], intake: 0.5, clat: 0, lvl: 1, gears: [0.2, 0.36, 0.55, 0.78, 1.18] },
  { cyl: 8, idle: 680, red: 5200, w0: 0.006, w1: 0.002, pat: [1, 0.8, 0.92, 0.72, 0.97, 0.78, 0.9, 0.7], res: [[84, 3, 1.05], [270, 2.2, 0.5], [820, 1.5, 0.16]], intake: 0.4, clat: 0, lvl: 0.88, gears: [0.24, 0.44, 0.7, 1.2] },
  { cyl: 6, idle: 720, red: 5800, w0: 0.0058, w1: 0.0018, pat: [1, 0.86, 0.94, 0.82, 0.97, 0.8], res: [[88, 3, 1.1], [285, 2.2, 0.55], [860, 1.5, 0.18]], intake: 0.5, clat: 0, lvl: 1.05, gears: [0.2, 0.36, 0.55, 0.78, 1.18] },
  { cyl: 4, idle: 780, red: 4200, w0: 0.003, w1: 0.0015, pat: [1, 0.8, 0.93, 0.76], res: [[96, 3, 1], [315, 2.6, 0.65], [1350, 2, 0.26]], intake: 0.3, clat: 0.6, lvl: 1.05, gears: [0.18, 0.33, 0.52, 0.76, 1.15] },
  { cyl: 8, idle: 950, red: 7600, w0: 0.0042, w1: 0.0011, pat: [1, 0.58, 0.9, 0.7, 0.97, 0.62, 0.86, 0.74], res: [[132, 4, 1.2], [425, 3, 0.75], [1260, 2, 0.34]], intake: 0.8, clat: 0, lvl: 0.78, gears: [0.16, 0.27, 0.4, 0.56, 0.76, 1.1] },
  { cyl: 6, idle: 620, red: 2500, w0: 0.0034, w1: 0.0017, pat: [1, 0.82, 0.94, 0.78, 0.96, 0.8], res: [[66, 3, 1.2], [215, 2.6, 0.65], [1120, 2, 0.24]], intake: 0.3, clat: 0.8, lvl: 1.15, gears: [0.16, 0.3, 0.48, 0.72, 1.12] },
];
const TAU = Math.PI * 2, clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const SMP_AS = { van: 'taxi', bus: 'taxi', suv: 'taxi' }, SMP_LVL = [1, 1, 1, 1.7, 1, 1.7];      /* lead, Nov 15 (Matt's report 202702-87a7b3, in the Tucson: 'the sound for this vehicle (not others) is obscenely annoying'): the SUV's own low and mid loops carry 29 % and 36 % of their energy above 1.5 kHz with a narrow peak at 2.4-2.7 kHz (the taxi's: 4 %), and have no high loop, so the mid one is pitched up under load; SUVs now play the taxi's loops at their own firing rate, as vans and buses do. Way back: remove suv here. */
//      // lead: which kind's sampled loops a kind plays, and at what level (see setSamples)
const STARTS = ['petrol', 'v8', 'petrol', 'diesel', 'v8', 'diesel'];      // which start-up clip each car kind uses
// a sample read between its points (four-point Hermite), wrapping: for loops
function herm(d, n, p) { const i = p | 0, f = p - i, a = d[i > 0 ? i - 1 : n - 1], b = d[i], c = d[i + 1 < n ? i + 1 : i + 1 - n], e = d[i + 2 < n ? i + 2 : i + 2 - n]; const c1 = 0.5 * (c - a), c2 = a - 2.5 * b + 2 * c - 0.5 * e, c3 = 0.5 * (e - a) + 1.5 * (b - c); return ((c3 * f + c2) * f + c1) * f + b; }
// a loop being played: its place in the clip; step() moves on by `st` source samples and gives left (and .r right)
class LoopV { constructor(c) { this.c = c; this.p = 0; this.r = 0; } step(st) { const c = this.c, n = c.n; let p = this.p + st; if (p >= n) p -= n; if (p >= n) p = 0; this.p = p; const l = herm(c.L, n, p); this.r = c.R ? herm(c.R, n, p) : l; return l; } }

// a state-variable filter (trapezoid form): stays stable when its frequency moves every block
class SVF {
  constructor() { this.a = 0; this.b = 0; this.g = 0; this.k = 1; this.d = 1; this.lp = 0; this.bp = 0; this.hp = 0; }
  set(f, q, sr) { const g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr); this.g = g; this.k = 1 / q; this.d = 1 / (1 + g * (g + this.k)); return this; }
  tick(x) { const g = this.g, hp = (x - (g + this.k) * this.a - this.b) * this.d, v1 = g * hp, bp = v1 + this.a; this.a = bp + v1; const v2 = g * bp, lp = v2 + this.b; this.b = lp + v2; this.hp = hp; this.bp = bp; this.lp = lp; return lp; }
}

export class CarDSP {
  constructor(sr, opts = {}) {
    this.sr = sr; this.T = new Float32Array(NP); for (const i of ONE) this.T[i] = 1; this.T[I.TOP] = 40; this.seed = (opts.seed || 2463534242) >>> 0; this.t = 0; this.level = opts.level === undefined ? 1 : opts.level;
    this.only = opts.only || null;      // measuring: one bus on its own ('eng', 'tyre', 'hit', 'pass', 'bed', 'step')
    // engine
    this.type = -1; this.E = ENG[0]; this.gear = 0; this.rpm = 0; this.shiftT = 0; this.sinceShift = 9; this.load = 0; this.thr = 0; this.on = 0; this.ph = 0; this.cylI = -1; this.cylA = 1; this.idleW = 0; this.startT = 9;
    this.fc = 0; this.ld = 0; this.eg = 0; this.res = [new SVF(), new SVF(), new SVF()]; this.rg = [1, 0.5, 0.2]; this.dc = 0; this.elp1 = 0; this.elp2 = 0; this.ecut = 0.1; this.inF = new SVF(); this.clF = new SVF(); this.pS = 0;
    // tyres
    this.roll = new SVF(); this.sing = new SVF().set(950, 1.2, sr); this.wind = new SVF(); this.rumb = new SVF().set(110, 0.8, sr); this.sp = 0; this.gRoll = 0; this.gSing = 0; this.gWind = 0; this.gRumb = 0;
    this.sq1 = new SVF(); this.sq2 = new SVF(); this.sq = 0; this.sqG = 0; this.sqPh = 0; this.sqW = 0; this.sqF = 900; this.sqTone = 0;
    this.scr = [new SVF().set(1150, 3, sr), new SVF().set(2700, 4, sr), new SVF().set(4300, 3, sr), new SVF().set(280, 0.7, sr)]; this.sc = 0; this.scG = 0; this.scR = 0;
    // one-shots: decaying sines (modes) and noise grains
    const NM = 72, NG = 40; this.NM = NM; this.NG = NG;
    this.mC = new Float64Array(NM); this.mR2 = new Float64Array(NM); this.mY1 = new Float64Array(NM); this.mY2 = new Float64Array(NM); this.mD = new Int32Array(NM); this.mN = new Int32Array(NM); this.mA = new Float64Array(NM); this.mP = new Float32Array(NM); this.mW = new Float64Array(NM);
    this.gA = new Float64Array(NG); this.gK = new Float64Array(NG); this.gD = new Int32Array(NG); this.gN = new Int32Array(NG); this.gP = new Float32Array(NG); this.gM = new Int8Array(NG); this.gS = new Float64Array(NG); this.gF = []; this.gFr = new Float64Array(NG); this.gQ = new Float64Array(NG); this.gAt = new Float64Array(NG);
    for (let i = 0; i < NG; i++) this.gF.push(new SVF());
    this.lastHit = -1;
    // passing cars
    this.pv = []; for (let k = 0; k < NV; k++) this.pv.push({ g: 0, g1: 0, dop: 1, dop1: 1, pan: 0, f: new SVF(), ph: 0, lp: 0, cut: 0.5, fe: 60, eg: 0, tg: 0, seed: (this.seed ^ (0x9e3779b9 * (k + 1))) >>> 0 || 1, d: 99, vr: 0, spd: 0 });
    // city bed
    this.bl = 0; this.br = 0; this.bfl = new SVF().set(300, 0.6, sr); this.bfr = new SVF().set(300, 0.6, sr); this.bm = new SVF().set(720, 0.5, sr); this.w1 = 0; this.w2 = 0; this.w3 = 0; this.wt = 0; this.wa = 0; this.wb = 0; this.wc = 0; this.bedG = 0;
    this.hornT = 6 + this.rnd() * 8; this.hN = 0; this.hLen = 0; this.hF = 400; this.hPh1 = 0; this.hPh2 = 0; this.hA = 0; this.hPan = 0; this.hLp = 0; this.hLp2 = 0; this.dl = new Float32Array(Math.ceil(sr * 0.4)); this.dli = 0; this.dlN = Math.round(sr * 0.23);
    // footsteps
    this.stepPh = 0.6; this.foot = 0; this.side = 1;
    // meters, for the measuring tools
    this.peak = 0;
    this.smp = null; this.sEng = []; this.sOne = {}; this.sL = {}; this.sv = []; for (let i = 0; i < 14; i++) this.sv.push({ c: null, p: 0, st: 1, gl: 0, gr: 0, d: 0 }); this.hbK = 0; this.bedI = 0; this.bedN = 0; this.bedX = 0; this.sStat = { shots: 0, eng: 0 };
  }
  /* clips: { name: { L: Float32Array, R: Float32Array or null, sr, loop: bool, f0: firing rate in Hz (engine loops) } }. null: synthesis only. */
  setSamples(m) {
    this.smp = m && Object.keys(m).length ? m : null; this.sEng = []; this.sOne = {}; this.sL = {}; if (!this.smp) return;
    for (const k in m) { const c = m[k]; c.n = c.L.length; c.k = c.sr / this.sr; }
    /* lead, Nov 14 (Matt on his private link: "The sound on the trucks you drive is incredibly annoying it's way worse than the cars"): measured, the van / truck
       loops put as much sound at 1 to 6 kHz as under 200 Hz (centre of the spectrum 1,600 Hz against the sedan's 310 Hz; the bus 740 Hz). Trucks, vans and
       buses now play the taxi's engine loops, which the engine model reads at their own lower firing rate (so a lower pitch), a little quieter (SMP_LVL). */
    TYPES.forEach((t0, ti) => { const t = SMP_AS[t0] || t0; const on = [], off = []; for (const r of ['idle', 'low', 'mid', 'high']) { const c = m['eng.' + t + '.' + r], o = m['eng.' + t + '.' + r + '.off']; if (c && c.f0 > 5 && c.n > 2000) on.push(new LoopV(c)); if (o && o.f0 > 5 && o.n > 2000) off.push(new LoopV(o)); }
      on.sort((a, b) => a.c.f0 - b.c.f0); off.sort((a, b) => a.c.f0 - b.c.f0); this.sEng[ti] = on.length >= 2 ? { on, off } : null; });      // fewer than two usable loops: that car kind keeps the synthesised engine
    for (const k in m) { if (m[k].loop) continue; const b = k.replace(/\.\d+$/, ''); (this.sOne[b] ||= []).push(m[k]); }      // one-shots: name.0, name.1 ... are variations
    const lp = (k) => (m[k] && m[k].loop && m[k].n > 2000 ? new LoopV(m[k]) : null);
    const roll = [lp('roll.slow') || lp('roll.mid'), lp('roll.mid') || lp('roll.fast') || lp('roll.slow'), lp('roll.fast') || lp('roll.mid')];      /* a missing speed borrows its neighbour's loop (its own play position) */ this.sL = { roll: roll[0] && roll[1] && roll[2] ? roll : null, sq: lp('squeal.a'), skid: lp('squeal.b'), scrape: lp('scrape'), bed: ['city.a', 'city.b', 'city.c'].map(lp).filter(Boolean) };
  }
  /* play a one-shot clip by base name; false if there is none (the caller then synthesises) */
  shot(base, gain = 1, pan = 0, rate = 1, delay = 0) {
    const a = this.sOne[base]; if (!a || !a.length) return false; const c = a[(this.rnd() * a.length) | 0]; let v = this.sv[0]; for (const q of this.sv) { if (!q.c) { v = q; break; } if (q.c.n - q.p < v.c.n - v.p) v = q; }
    v.c = c; v.p = 0; v.st = c.k * rate * (0.96 + 0.08 * this.rnd()); const g = gain * (0.9 + 0.2 * this.rnd()); v.gl = g * Math.sqrt((1 - pan) * 0.5) * 1.4142; v.gr = g * Math.sqrt((1 + pan) * 0.5) * 1.4142; v.d = Math.round(delay * this.sr); this.sStat.shots++; return true;
  }
  rnd() { let s = this.seed; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; this.seed = s; return s / 4294967296; }

  // ------------------------------------------------------------------ one-shots
  mode(f, amp, secs, delay = 0, pan = 0) {      // a sine that dies away by 60 dB in `secs`
    const sr = this.sr; if (f > sr * 0.45) return; let j = -1, least = 1e9; for (let i = 0; i < this.NM; i++) { if (this.mN[i] <= 0) { j = i; break; } if (this.mN[i] < least) { least = this.mN[i]; j = i; } }
    const n = Math.max(8, Math.round(secs * sr)), r = Math.pow(0.001, 1 / n), w = TAU * f / sr;
    this.mC[j] = 2 * r * Math.cos(w); this.mR2[j] = r * r; this.mY1[j] = 0; this.mY2[j] = 0; this.mW[j] = Math.sin(w) * r; this.mA[j] = amp; this.mD[j] = Math.round(delay * sr); this.mN[j] = n; this.mP[j] = pan;
  }
  grain(kind, f, q, amp, secs, delay = 0, pan = 0, sweep = 1, attack = 0) {      // a burst of filtered noise: kind 0 low-pass, 1 band-pass, 2 high-pass; sweep: where the filter ends up (x its start)
    const sr = this.sr; let j = -1, least = 1e9; for (let i = 0; i < this.NG; i++) { if (this.gN[i] <= 0) { j = i; break; } if (this.gN[i] < least) { least = this.gN[i]; j = i; } }
    const n = Math.max(16, Math.round(secs * sr));
    this.gA[j] = amp; this.gK[j] = Math.pow(0.001, 1 / n); this.gD[j] = Math.round(delay * sr); this.gN[j] = n; this.gP[j] = pan; this.gM[j] = kind; this.gFr[j] = f; this.gQ[j] = q; this.gS[j] = sweep === 1 ? 1 : Math.pow(sweep, 64 / n); this.gAt[j] = attack > 0 ? 1 / (attack * sr) : 1;
    const F = this.gF[j]; F.a = 0; F.b = 0; F.set(f, q, sr); F.env = attack > 0 ? 0 : 1; F.up = attack > 0;
  }
  /* kind: EV.*; force: the closing speed in m/s (a door and a kerb: 0..1 and the car's speed); pan -1..1 */
  ev(kind, force = 8, pan = 0) {
    const R = () => this.rnd(), k = clamp(force / 18, 0.12, 1), k2 = Math.sqrt(k) * 0.75;
    if (this.smp) {      // a clip for this blow? level by the closing speed (a clip is stored at the level of a hard hit)
      const g = clamp(Math.pow(force / 16, 0.7), 0.25, 1.25); let done = false;
      if (kind === EV.CAR || kind === EV.WALL || kind === EV.POLE) { if (this.t - this.lastHit < 0.07) return; const nm = kind === EV.WALL ? 'crash.wall' : kind === EV.POLE ? 'crash.pole' : force < 8 && this.sOne['crash.car.light'] ? 'crash.car.light' : 'crash.car.heavy';
        done = this.shot(nm, nm === 'crash.car.light' ? clamp(force / 6, 0.4, 1.2) : g, pan); if (done) { this.lastHit = this.t; if (kind !== EV.POLE && k > 0.6 && !this.shot('crash.glass', 0.8, pan, 1, 0.05)) this.ev(EV.GLASS, force * 0.6, pan); } }
      else if (kind === EV.GLASS) done = this.shot('crash.glass', g, pan); else if (kind === EV.BODY) done = this.shot('crash.body', g, pan); else if (kind === EV.DOOR) done = this.shot('door.close', clamp(force, 0.3, 1.2), pan);
      else if (kind === EV.KERB) { const a = clamp(force / 12, 0.3, 1); done = this.shot('kerb', a, pan); if (done) this.shot('kerb', a * 0.8, pan, 0.94, clamp(2.7 / Math.max(force, 1), 0.06, 0.4)); }
      if (done) return;
    }
    if (kind === EV.CAR || kind === EV.WALL || kind === EV.POLE) {
      if (this.t - this.lastHit < 0.07) return; this.lastHit = this.t;
      const wall = kind === EV.WALL, pole = kind === EV.POLE;
      this.grain(0, wall ? 2400 : 3800, 0.7, 0.95 * k2, 0.1 + 0.12 * k, 0, pan, wall ? 0.2 : 0.22);                 // the blow: bright at first, closing down
      this.grain(1, wall ? 700 : 1900, 0.9, 0.45 * k2, 0.035 + 0.03 * k, 0, pan);
      this.mode(wall ? 54 : 68, 0.75 * k2, wall ? 0.34 : 0.26, 0, pan); this.mode(wall ? 92 : 118, 0.4 * k2, 0.16, 0, pan);      // the weight of it
      const nm = wall ? 3 : pole ? 3 : 7; for (let i = 0; i < nm; i++) this.mode(150 + 800 * R() * R() + (wall ? 0 : 60 * i), (0.2 + 0.14 * R()) * k2, 0.07 + 0.2 * R(), 0.002 * i, pan);      // sheet metal: many modes, heavily damped
      const nc = Math.round((wall ? 5 : 4) + 11 * k); for (let i = 0; i < nc; i++) this.grain(1, wall ? 500 + 1900 * R() : 900 + 3400 * R(), 1.6 + 2 * R(), (0.1 + 0.2 * R()) * k2, 0.012 + 0.03 * R(), 0.015 + (wall ? 0.5 : 0.36) * R() * R() * (0.5 + k), pan + (R() - 0.5) * 0.3);      // crumple / rubble
      if (pole) { const f0 = 290 + 150 * R(), part = [1, 2.76, 5.4, 8.93], dec = [0.75, 0.5, 0.3, 0.18], am = [0.3, 0.24, 0.15, 0.08]; for (let i = 0; i < 4; i++) this.mode(f0 * part[i] * (1 + 0.01 * (R() - 0.5)), am[i] * k2, dec[i] * (0.7 + 0.3 * k), 0.001, pan); }      // the pole rings: a tube's partials
      if (!pole && k > 0.6) this.ev(EV.GLASS, force * 0.6, pan);
    } else if (kind === EV.GLASS) {
      this.grain(2, 2600, 0.8, 0.5 * k2, 0.04, 0, pan); this.grain(1, 5200, 1.5, 0.3 * k2, 0.09, 0.004, pan);
      const n = Math.round(10 + 26 * k); for (let i = 0; i < n; i++) { const d = 0.03 + 0.85 * Math.pow(R(), 1.7) * (0.5 + 0.5 * k); this.mode(2300 + 7200 * R() * R(), (0.05 + 0.11 * R()) * k2 * (1 - d * 0.6), 0.02 + 0.07 * R(), d, clamp(pan + (R() - 0.5) * 0.9, -1, 1)); }
      for (let i = 0; i < 5; i++) this.grain(2, 3500 + 3000 * R(), 1, 0.07 * k2, 0.02 + 0.03 * R(), 0.05 + 0.5 * R(), pan + (R() - 0.5) * 0.6);
    } else if (kind === EV.BODY) {
      this.mode(84, 0.6 * k2, 0.2, 0, pan); this.mode(236 + 40 * R(), 0.16 * k2, 0.11, 0, pan); this.grain(0, 620, 0.7, 0.55 * k2, 0.07, 0, pan); this.grain(1, 310, 1, 0.3 * k2, 0.09, 0.002, pan);
    } else if (kind === EV.BIKE) {      // a bicycle struck by a car, or coming down on the road (riders.js, ?cychit): the blow on thin tube, the frame's partials ringing short, then chain, spokes and mudguard rattling
      const f0 = 520 + 260 * R(), part = [1, 1.47, 2.09, 2.76, 3.9];
      this.grain(0, 3400, 0.7, 0.85 * k2, 0.05 + 0.05 * k, 0, pan, 0.3); this.mode(118, 0.3 * k2, 0.11, 0, pan);
      for (let i = 0; i < 5; i++) this.mode(f0 * part[i] * (1 + 0.02 * (R() - 0.5)), (0.3 - 0.045 * i) * k2, 0.1 + 0.16 * R(), 0.001 * i, pan);
      const nr = Math.round(4 + 8 * k); for (let i = 0; i < nr; i++) { const d = 0.02 + 0.45 * R() * R() * (0.5 + k); this.grain(1, 1800 + 4200 * R(), 2.5 + 3 * R(), (0.14 + 0.2 * R()) * k2 * (1 - d), 0.01 + 0.025 * R(), d, pan + (R() - 0.5) * 0.4); if (i % 3 === 0) this.mode(1400 + 2600 * R(), 0.1 * k2, 0.05 + 0.08 * R(), d, pan); }
    } else if (kind === EV.DOOR) {
      const a = clamp(force, 0.2, 1.2);
      this.mode(92 + 10 * R(), 0.34 * a, 0.14, 0, pan); this.mode(228 + 20 * R(), 0.1 * a, 0.1, 0, pan); this.mode(392 + 30 * R(), 0.06 * a, 0.08, 0, pan);
      this.grain(0, 1500, 0.7, 0.3 * a, 0.035, 0, pan); this.grain(1, 3200, 3, 0.1 * a, 0.008, 0, pan); this.grain(1, 2700, 3, 0.07 * a, 0.01, 0.034, pan);
    } else if (kind === EV.KERB) {
      const a = clamp(force / 12, 0.25, 1), gap = clamp(2.7 / Math.max(force, 1), 0.06, 0.4);
      for (let i = 0; i < 2; i++) { const d = i * gap, b = a * (i ? 0.8 : 1); this.mode(58 + 8 * R(), 0.5 * b, 0.19, d, pan); this.mode(104 + 12 * R(), 0.2 * b, 0.1, d, pan); this.grain(0, 520, 0.7, 0.34 * b, 0.05, d, pan); this.grain(1, 1500, 1.2, 0.07 * b, 0.02, d + 0.004, pan); }
    }
  }

  // ------------------------------------------------------------------ the block
  process(L, R, n) {
    const sr = this.sr, T = this.T, dtb = n / sr, inv = 1 / n, only = this.only; this.t += dtb;
    const kS = (tau) => 1 - Math.exp(-dtb / tau);
    for (let i = 0; i < NP; i++) { const x = T[i]; if (!(x === x)) T[i] = 0; else if (x > 1e4) T[i] = 1e4; else if (x < -1e4) T[i] = -1e4; }      // nothing the game sends can make this produce a NaN
    // ---- gearbox and engine state (once a block)
    const inCar = T[I.INCAR] > 0.5, ty = clamp(Math.round(T[I.TYPE]), 0, ENG.length - 1);
    if (ty !== this.type) { this.type = ty; const E = (this.E = ENG[ty]); for (let i = 0; i < 3; i++) { this.res[i].set(E.res[i][0], E.res[i][1], sr); this.rg[i] = E.res[i][2]; } this.gear = 0; this.clF.set(E.clat ? 2300 : 2000, 2, sr); }
    const E = this.E, top = Math.max(5, T[I.TOP]) * 0.75      /* the game's cars run out of push at a little over half the top speed their table gives (drag): the gears are spread over the speeds they really reach */, v = Math.abs(T[I.SPEED]), thrIn = clamp(T[I.THR], 0, 1);
    this.thr += (thrIn - this.thr) * kS(0.045);
    if (inCar && this.on < 0.02 && this.startT > 2) { this.startT = 0; this.rpm = E.idle * 0.5; this.gear = 0; this.sStart = this.smp && (!only || only === 'eng') ? this.shot('start.' + STARTS[ty], 1, 0) : false; }      // getting in: the engine catches and settles
    this.startT += dtb; this.sinceShift += dtb; if (this.shiftT > 0) this.shiftT -= dtb;
    const G = E.gears, nG = G.length, rG = (g) => E.red * v / (top * G[g]);
    if (this.sinceShift > 0.32) {
      if (this.gear < nG - 1 && rG(this.gear) > E.red * (0.46 + 0.46 * this.thr)) { this.gear++; this.shiftT = 0.2; this.sinceShift = 0; }
      else if (this.gear > 0 && rG(this.gear) < E.red * (0.2 + 0.25 * this.thr) && rG(this.gear - 1) < E.red * 0.9) { this.gear--; this.shiftT = 0.12; this.sinceShift = 0.14; }
    }
    this.idleW += ((this.rnd() - 0.5) * 2 - this.idleW) * kS(0.5);
    const idle = E.idle * (1 + 0.025 * this.idleW), flare = this.gear === 0 ? idle + this.thr * 0.3 * (E.red - idle) * clamp(1.15 - v / (top * G[0] * 0.8), 0, 1) : idle;      // pulling away: the revs lead the car
    let want = rG(this.gear); want = Math.sqrt(Math.sqrt(want * want * want * want + flare * flare * flare * flare)); want = Math.min(want, E.red * 1.02);
    if (this.startT < 0.5) want = idle * (1 + 0.55 * Math.sin(Math.PI * this.startT / 0.5));
    const rpm0 = this.rpm; this.rpm += (want - this.rpm) * kS(this.shiftT > 0 ? 0.075 : want > this.rpm ? 0.085 : 0.13);
    const rN = clamp((this.rpm - E.idle) / (E.red - E.idle), 0, 1), loadW = this.thr * (this.shiftT > 0 ? 0.25 : 1), ld0 = this.load; this.load += (loadW - this.load) * kS(0.03);
    const on0 = this.on; this.on += ((inCar ? 1 : 0) - this.on) * kS(inCar ? (this.sStart && this.startT < 1.2 ? 0.7 : 0.12) : 0.18);      /* with a start-up clip the running engine comes in under it */ if (this.on < 1e-4 && !inCar) this.on = 0;
    const engOn = this.on > 0 && only !== 'noeng' && (!only || only === 'eng');
    const fcA = rpm0 / 120 / sr, fcB = this.rpm / 120 / sr, cyl = E.cyl;
    // sampled engine: the two loops either side of the wanted firing rate, each resampled to that rate, crossfaded; off-load loop by throttle
    const SE = engOn && this.smp ? this.sEng[ty] : null; let eA = null, eB = null, eO = null, wA = 1, wB = 0, wOn = 1, wOff = 0, stA0 = 0, stA1 = 0, stB0 = 0, stB1 = 0, stO0 = 0, stO1 = 0, sgA = 0, sgB = 0;
    if (SE) { const f0 = rpm0 * cyl / 120, f1 = this.rpm * cyl / 120, on = SE.on; let i = 0; while (i < on.length - 2 && f1 > on[i + 1].c.f0) i++; eA = on[i]; eB = on[i + 1];
      const x = clamp(Math.log(f1 / eA.c.f0) / Math.log(eB.c.f0 / eA.c.f0), 0, 1); wA = Math.cos(x * Math.PI / 2); wB = Math.sin(x * Math.PI / 2);
      const rt = (c, f) => c.k * clamp(f / c.f0, 0.45, 2.2); stA0 = rt(eA.c, f0); stA1 = rt(eA.c, f1); stB0 = rt(eB.c, f0); stB1 = rt(eB.c, f1);
      if (SE.off.length) { eO = SE.off[0]; for (const o of SE.off) if (Math.abs(Math.log(f1 / o.c.f0)) < Math.abs(Math.log(f1 / eO.c.f0))) eO = o; stO0 = rt(eO.c, f0); stO1 = rt(eO.c, f1); const l = clamp(this.load * 1.5, 0, 1) * (1 - x * 0) ; wOn = Math.sqrt(Math.max(l, x < 0.02 ? 1 : 0)); wOff = Math.sqrt(1 - wOn * wOn); }
      sgA = this.sEg === undefined ? 0 : this.sEg; const up = clamp(Math.log(f1 / on[0].c.f0) / Math.log(on[1].c.f0 / on[0].c.f0), 0, 1);      /* the idle loop is recorded off load and the others on load: only above idle does lifting the foot take level and brightness off */
      sgB = this.on * (SE.off.length ? 1 : 1 - up * (1 - (0.4 + 0.6 * Math.pow(this.load, 0.8)))); this.sUp = SE.off.length ? 0 : up * (1 - this.load); this.sEg = sgB; this.sStat.eng++; } else this.sEg = 0;
    const egB = this.on * E.lvl * 0.2 * (0.36 + 0.64 * Math.pow(this.load, 0.8)) * (0.62 + 0.38 * rN), egA = this.eg; this.eg = egB;
    const cutB = 1 - Math.exp(-TAU * (520 + 900 * rN + 3600 * this.load * (0.35 + 0.65 * rN)) / sr), cutA = this.ecut; this.ecut = cutB;
    const drive = 0.9 + 1.5 * this.load, rasp = 0.9 * this.load * (0.3 + 0.7 * rN), driveN = 1 / Math.tanh(drive * 0.6), jit = 0.1 - 0.06 * this.load, intk = E.intake * (0.02 + this.load * this.load) * (0.4 + 0.6 * rN) * 0.9, clat = E.clat * (0.45 + 0.55 * this.load) * 0.4;
    if (engOn) this.inF.set(520 + 950 * rN, 1.1, sr);
    // ---- tyres
    const sp = v, slipIn = Math.max(T[I.SLIP], T[I.HB] > 0.5 && sp > 2.5 ? Math.min(6, 1.4 + sp * 0.28) : 0), carK = inCar ? 1 : 0;
    this.sp += (sp - this.sp) * kS(0.06);
    const s = this.sp, gRollB = carK * 0.3 * Math.pow(clamp(s / 32, 0, 1.6), 1.25), gSingB = carK * 0.03 * Math.pow(clamp(s / 32, 0, 1.6), 1.6), gWindB = carK * 0.07 * Math.pow(clamp(s / 45, 0, 1.3), 2.4), gRumbB = carK * (T[I.WALK] > 0.5 ? 0.22 : 0.05) * clamp(s / 10, 0, 1);
    const gRollA = this.gRoll, gSingA = this.gSing, gWindA = this.gWind, gRumbA = this.gRumb; this.gRoll = gRollB; this.gSing = gSingB; this.gWind = gWindB; this.gRumb = gRumbB;
    const tyreOn = (gRollA + gRollB + gWindA + gWindB + gRumbA + gRumbB) > 1e-5 && (!only || only === 'tyre' || only === 'noeng');
    if (tyreOn) { this.roll.set(240 + 24 * s, 0.6, sr); this.wind.set(1800 + 45 * s, 0.6, sr); }
    const sqW = carK * clamp((slipIn - 1.7) / 4.2, 0, 1); this.sq += (sqW - this.sq) * kS(sqW > this.sq ? 0.035 : 0.11);
    const sqB = this.sq * this.sq * 0.1 + this.sq * 0.02, sqA = this.sqG; this.sqG = sqB; const sqOn = (sqA + sqB) > 1e-5 && (!only || only === 'tyre' || only === 'noeng');
    if (sqOn) { this.sqW += ((this.rnd() - 0.5) * 2 - this.sqW) * kS(0.12); this.sqF = (760 + 330 * this.sq + 6 * Math.min(s, 30)) * (1 + 0.07 * this.sqW); this.sq1.set(this.sqF, 14, sr); this.sq2.set(this.sqF * 1.53, 10, sr); this.sqTone = clamp((s - 3) / 9, 0, 1) * 0.6; }
    const scW = carK * clamp(T[I.SCRAPE] / 14, 0, 1); this.sc += (scW - this.sc) * kS(scW > this.sc ? 0.02 : 0.09); const scB = Math.sqrt(this.sc) * 0.055, scA = this.scG; this.scG = scB; const scOn = (scA + scB) > 1e-5 && (!only || only === 'tyre' || only === 'noeng' || only === 'hit');
    const sqInc = this.sqF / sr;
    const SL = this.smp ? this.sL : null, sRoll = SL && SL.roll && tyreOn ? SL.roll : null, sSq = SL && SL.sq && sqOn ? SL.sq : null, sSkid = SL && SL.skid && sqOn ? SL.skid : null, sScr = SL && SL.scrape && scOn ? SL.scrape : null;
    let rw0 = 0, rw1 = 0, rw2 = 0; if (sRoll) { const v0 = 8.3, v1 = 16.7, v2 = 30.5; if (s < v0) rw0 = Math.pow(s / v0, 1.5); else if (s < v1) { const x = (s - v0) / (v1 - v0); rw0 = Math.cos(x * Math.PI / 2); rw1 = Math.sin(x * Math.PI / 2); } else { const x = clamp((s - v1) / (v2 - v1), 0, 1); rw1 = Math.cos(x * Math.PI / 2); rw2 = Math.sin(x * Math.PI / 2); } rw0 *= carK; rw1 *= carK; rw2 *= carK; }
    const rwA = this.rwP || [0, 0, 0]; this.rwP = [rw0, rw1, rw2];
    this.hbK += ((T[I.HB] > 0.5 && sSkid ? 1 : 0) - this.hbK) * kS(0.08); const sqS0 = this.sqSg || 0, sqS1 = Math.pow(this.sq, 1.2); this.sqSg = sqS1; const sqRate = 0.92 + 0.16 * this.sq + 0.03 * this.sqW, scS0 = this.scSg || 0, scS1 = Math.sqrt(this.sc); this.scSg = scS1;
    // ---- passing cars
    const passOn = !only || only === 'pass' || only === 'noeng'; let anyPass = false;
    for (let k = 0; k < NV; k++) {
      const P = this.pv[k], o = I.PASS + 5 * k, d = Math.max(1.5, T[o]), spd = Math.abs(T[o + 3]), big = T[o + 4] > 0.5;
      const lv = d > 0 && T[o] > 0 ? (0.25 + 0.75 * Math.pow(clamp(spd / 12, 0, 2), 1.3)) / (1 + (d / 7) * (d / 7)) : 0;
      P.g1 = P.g; P.g += (lv * (big ? 1.5 : 1) - P.g) * kS(0.05); P.dop1 = P.dop; P.dop += (343 / (343 - clamp(T[o + 1], -70, 70)) - P.dop) * kS(0.06); P.pan += (clamp(T[o + 2], -1, 1) - P.pan) * kS(0.05);
      P.act = passOn && (P.g + P.g1) > 2e-4; if (!P.act) continue; anyPass = true;
      P.f.set((big ? 620 : 980) * P.dop * (0.85 + 0.03 * Math.min(spd, 20)), 0.9, sr); P.cut = 1 - Math.exp(-TAU * (6500 / (1 + d / 22)) / sr); P.fe = (big ? 30 : 46) * (1 + spd * 0.09) * P.dop / sr;
      P.eg = 0.5 / (0.4 + spd * 0.12); P.tg = 0.3 + clamp(spd / 10, 0, 1.2);
    }
    // ---- city bed, far horn
    const vE = clamp(T[I.VENG], 0, 1.5), vA = clamp(T[I.VAMB], 0, 1.5);
    const bedB = clamp(T[I.BED], 0, 2) * 0.07 * vA, bedA = this.bedG; this.bedG = bedB; const bedOn = (bedA + bedB) > 1e-6 && (!only || only === 'bed');
    if (bedOn) {
      this.wt -= dtb; if (this.wt <= 0) { this.wt = 2 + 5 * this.rnd(); this.wa = this.rnd() * 2 - 1; this.wb = this.rnd() * 2 - 1; this.wc = this.rnd() * 2 - 1; }      /* the bed breathes: each side and the mid band drift to a new level every few seconds */
      this.w1 += (this.wa - this.w1) * kS(1.6); this.w2 += (this.wb - this.w2) * kS(1.6); this.w3 += (this.wc - this.w3) * kS(1.2);
      this.hornT -= dtb; if (this.hornT <= 0 && this.hN <= 0) { this.hornT = 9 + 22 * this.rnd(); this.hLen = Math.round((0.25 + 0.7 * this.rnd() * this.rnd()) * sr); this.hN = this.hLen + Math.round(0.3 * sr); this.hF = (340 + 130 * this.rnd()); this.hA = 0.012 + 0.02 * this.rnd(); this.hPan = (this.rnd() - 0.5) * 1.4; }
    }
    const sBed = this.smp && this.sL.bed && this.sL.bed.length && bedOn ? this.sL.bed : null, bedFade = Math.round(4 * sr), bedLen = sBed ? Math.round(sBed[this.bedI].c.n / sBed[this.bedI].c.k) : 0;      // a bed clip plays once through, then fades over four seconds into the next
    const wv1 = 1 + 0.4 * this.w1, wv2 = 1 + 0.4 * this.w2, wv3 = clamp(1 + 0.9 * this.w3, 0.1, 2);
    // ---- footsteps
    const foot = !inCar ? T[I.FOOT] : 0; this.foot += (foot - this.foot) * kS(0.08);
    if (this.foot > 0.35 && (!only || only === 'step')) {
      this.stepPh += dtb * (1.45 + 0.29 * this.foot);
      if (this.stepPh >= 1) { this.stepPh -= 1; this.side = -this.side; const run = clamp((this.foot - 2) / 3, 0, 1), a = (0.75 + 0.5 * this.rnd()) * (0.2 + 0.16 * run), p = this.side * 0.1, f = 1 + 0.25 * (this.rnd() - 0.5);
        if (this.smp && this.shot(run > 0.5 ? 'step.run' : 'step.walk', 0.8 + 0.4 * run, p)) { /* a recorded step */ } else {
        this.grain(0, 950 * f, 0.7, a, 0.03 + 0.012 * run, 0, p); this.mode(118 * f, a * 0.55, 0.06, 0, p); this.grain(1, 2500 * f, 1, a * 0.32, 0.016, 0, p);      // heel
        this.grain(1, 1900 * f, 0.8, a * 0.3, 0.035, 0.085 - 0.04 * run, p, 1, 0.006); } }                                                                     // the sole coming down
    } else if (this.foot <= 0.35) this.stepPh = 0.75;

    const sUp = (this.sUp || 0) * 0.8;
    let seed = this.seed, ph = this.ph, cylI = this.cylI, cylA = this.cylA, dc = this.dc, l1 = this.elp1, l2 = this.elp2, pS = this.pS, sqPh = this.sqPh, scR = this.scR, bl = this.bl, br = this.br, peak = this.peak;
    const r0 = this.res[0], r1 = this.res[1], r2 = this.res[2], g0 = this.rg[0], g1 = this.rg[1], g2 = this.rg[2], pat = E.pat, inF = this.inF, clF = this.clF, w0 = E.w0, w1 = E.w1;
    const NM = this.NM, NG = this.NG, mN = this.mN, mD = this.mD, gN = this.gN, gD = this.gD, hitOn = !only || only === 'hit' || only === 'step' || only === 'noeng', lvl = this.level;
    const nz = 4.656612873e-10 * Math.sqrt(sr / 48000);      /* white noise carries the same power per Hz at any output rate, so every filtered noise is as loud on a 44.1 kHz output as on a 48 kHz one */
    const kDc = 1 - Math.exp(-TAU * 22 / sr), kP = 1 - Math.exp(-1 / (0.0015 * sr)), kScr = 1 - Math.exp(-TAU * 38 / sr), kB = 1 - Math.exp(-TAU * 70 / sr), kH = 1 - Math.exp(-TAU * 900 / sr);
    for (let i = 0; i < n; i++) {
      const a = i * inv; let m = 0, sl = 0, sr_ = 0;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const wn = (seed | 0) * nz;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const wn2 = (seed | 0) * nz;
      // engine
      if (SE) { const stA = stA0 + (stA1 - stA0) * a, stB = stB0 + (stB1 - stB0) * a; let y = (wA > 0.001 ? eA.step(stA) * wA : 0) + (wB > 0.001 ? eB.step(stB) * wB : 0);
        if (eO) y = y * wOn + (wOff > 0.001 ? eO.step(stO0 + (stO1 - stO0) * a) * wOff : 0); l1 += (y - l1) * 0.12; m += (y + (l1 - y) * sUp) * 1.6 * SMP_LVL[ty] * (sgA + (sgB - sgA) * a); }
      else if (engOn) {
        const fc = fcA + (fcB - fcA) * a, ld = ld0 + (this.load - ld0) * a; ph += fc; if (ph >= 1) ph -= 1;
        const x = ph * cyl, ci = x | 0, tf = 1 / (fc * cyl * sr + 1e-9), t = (x - ci) * tf;
        if (ci !== cylI) { cylI = ci; cylA = pat[ci % pat.length] * (1 + jit * wn2); }
        let w = w0 + (w1 - w0) * ld; if (w > 0.9 * tf) w = 0.9 * tf;
        let p = 0, ck = 0; if (t < w) { const u = t / w, u2 = 1 - (1 - u) * (1 - u), sn = Math.sin(Math.PI * u2); p = sn * sn * cylA; } if (clat && t < 0.0022) ck = Math.exp(-t * 1800) * cylA;
        dc += (p - dc) * kDc; const src = p - dc; pS += (p - pS) * kP;
        r0.tick(src); r1.tick(src); r2.tick(src);
        let y = src * 0.5 + r0.bp * g0 * 1.5 + r1.bp * g1 * 1.5 + r2.bp * g2 * 1.5;
        y += inF.tick(wn) * 0 + inF.bp * intk * (0.2 + 1.6 * pS);
        clF.tick(wn2); y += clF.bp * (ck * clat + pS * rasp);
        y = Math.tanh(y * drive * 0.6) * driveN;
        const cut = cutA + (cutB - cutA) * a; l1 += (y - l1) * cut; l2 += (l1 - l2) * cut;
        m += l2 * (egA + (egB - egA) * a);
      }
      // tyres, wind, squeal, scrape
      if (sRoll) { this.wind.tick(wn2); this.rumb.tick(wn2); const g0 = rwA[0] + (rw0 - rwA[0]) * a, g1 = rwA[1] + (rw1 - rwA[1]) * a, g2 = rwA[2] + (rw2 - rwA[2]) * a; m += (g0 > 0.001 ? sRoll[0].step(sRoll[0].c.k) * g0 : 0) + (g1 > 0.001 ? sRoll[1].step(sRoll[1].c.k) * g1 : 0) + (g2 > 0.001 ? sRoll[2].step(sRoll[2].c.k) * g2 : 0) + this.rumb.lp * 3 * (gRumbA + (gRumbB - gRumbA) * a); }
      else if (tyreOn) { this.roll.tick(wn); this.sing.tick(wn); this.wind.tick(wn2); this.rumb.tick(wn2); m += this.roll.lp * (gRollA + (gRollB - gRollA) * a) + this.sing.bp * (gSingA + (gSingB - gSingA) * a) + this.wind.bp * (gWindA + (gWindB - gWindA) * a) + this.rumb.lp * 3 * (gRumbA + (gRumbB - gRumbA) * a); }
      if (sSq) { const g = sqS0 + (sqS1 - sqS0) * a, hb = this.hbK; m += (hb < 0.999 ? sSq.step(sSq.c.k * sqRate) * (1 - hb) : 0) * g + (hb > 0.001 && sSkid ? sSkid.step(sSkid.c.k) * hb * g : 0); }
      else if (sqOn) { this.sq1.tick(wn); this.sq2.tick(wn2); sqPh += sqInc * (1 + 0.02 * this.sq1.bp); if (sqPh >= 1) sqPh -= 1; const tone = Math.sin(TAU * sqPh), q = this.sq1.bp * 2.2 * (1 - this.sqTone * 0.5) + this.sq2.bp * 0.9 + tone * this.sqTone * (0.55 + 0.45 * Math.abs(this.sq1.bp) * 3); m += Math.tanh(q * 1.6) * 0.62 * (sqA + (sqB - sqA) * a); }
      if (sScr) m += sScr.step(sScr.c.k) * (scS0 + (scS1 - scS0) * a);
      else if (scOn) { scR += (Math.abs(wn2) - scR) * kScr; const e = wn * (0.25 + 2.4 * scR), S = this.scr; S[0].tick(e); S[1].tick(e); S[2].tick(e); S[3].tick(e); m += (S[0].bp + S[1].bp * 0.8 + S[2].bp * 0.5 + S[3].lp * 1.6) * (scA + (scB - scA) * a); }
      m *= vE; sl = m; sr_ = m;
      if (this.smp && hitOn) { const SV = this.sv; for (let j = 0; j < 14; j++) { const v = SV[j], c = v.c; if (!c) continue; if (v.d > 0) { v.d--; continue; } const p = v.p, i0 = p | 0; if (i0 >= c.n - 1) { v.c = null; continue; } const f = p - i0, y = c.L[i0] + (c.L[i0 + 1] - c.L[i0]) * f; v.p = p + v.st; sl += y * v.gl; sr_ += y * v.gr; } }
      // one-shots
      if (hitOn) {
        for (let j = 0; j < NM; j++) { if (mN[j] <= 0) continue; if (mD[j] > 0) { if (--mD[j] === 0) this.mY1[j] = this.mW[j] * this.mA[j]; else continue; } else if (this.mY1[j] === 0 && this.mY2[j] === 0) this.mY1[j] = this.mW[j] * this.mA[j];
          const y = this.mC[j] * this.mY1[j] - this.mR2[j] * this.mY2[j]; this.mY2[j] = this.mY1[j]; this.mY1[j] = y; mN[j]--; const pn = this.mP[j]; sl += y * (1 - pn) * 0.5 * 1.4142; sr_ += y * (1 + pn) * 0.5 * 1.4142; }
        for (let j = 0; j < NG; j++) { if (gN[j] <= 0) continue; if (gD[j] > 0) { gD[j]--; continue; }
          const F = this.gF[j]; if (F.up) { F.env += this.gAt[j]; if (F.env >= 1) { F.env = 1; F.up = false; } } else this.gA[j] *= this.gK[j];
          if (this.gS[j] !== 1 && (gN[j] & 63) === 0) { this.gFr[j] *= this.gS[j]; F.set(this.gFr[j], this.gQ[j], sr); }
          F.tick((j & 1) ? wn : wn2); const md = this.gM[j], y = (md === 0 ? F.lp : md === 1 ? F.bp : F.hp) * this.gA[j] * F.env; gN[j]--; const pn = this.gP[j]; sl += y * (1 - pn) * 0.5 * 1.4142; sr_ += y * (1 + pn) * 0.5 * 1.4142; }
      }
      // passing cars
      if (anyPass) for (let k = 0; k < NV; k++) { const P = this.pv[k]; if (!P.act) continue; let s2 = P.seed; s2 ^= s2 << 13; s2 ^= s2 >>> 17; s2 ^= s2 << 5; P.seed = s2; const w = (s2 | 0) * nz;
        P.f.tick(w); P.ph += P.fe; if (P.ph >= 1) P.ph -= 1; const th = TAU * P.ph, en = Math.sin(th) + 0.5 * Math.sin(2 * th + 0.7) + 0.3 * Math.sin(3 * th + 1.9) + 0.16 * Math.sin(4 * th + 0.4);
        let y = (P.f.bp * 0.75 + P.f.lp * 0.35) * P.tg + en * P.eg * 0.5; P.lp += (y - P.lp) * P.cut; y = P.lp * (P.g1 + (P.g - P.g1) * a) * 0.32 * vA; const pn = P.pan; sl += y * Math.sqrt((1 - pn) * 0.5) * 1.4142; sr_ += y * Math.sqrt((1 + pn) * 0.5) * 1.4142; }
      // city bed (two independent rumbles, a little mid air) and the far horn with one echo
      if (sBed) { const bg = (bedA + (bedB - bedA) * a) * 14.2857, c = sBed[this.bedI], x = this.bedX; let yl = c.step(c.c.k), yr = c.r; this.bedN++;      /* (the bed's number is 0.07 at full: a clip is stored at its level) */
        if (sBed.length > 1 && this.bedN > bedLen) { const nx = sBed[(this.bedI + 1) % sBed.length], w = x / bedFade, l2_ = nx.step(nx.c.k); yl = yl * Math.cos(w * Math.PI / 2) + l2_ * Math.sin(w * Math.PI / 2); yr = yr * Math.cos(w * Math.PI / 2) + nx.r * Math.sin(w * Math.PI / 2); if (++this.bedX >= bedFade) { this.bedX = 0; this.bedN = 0; this.bedI = (this.bedI + 1) % sBed.length; } }
        sl += yl * bg; sr_ += yr * bg; }
      else if (bedOn) { const bg = bedA + (bedB - bedA) * a; bl += (wn * 3.4 - bl) * kB; br += (wn2 * 3.4 - br) * kB; this.bfl.tick(bl); this.bfr.tick(br); this.bm.tick(wn + wn2);
        const mid = this.bm.bp * 0.07 * wv3; sl += (this.bfl.lp * wv1 + mid) * bg; sr_ += (this.bfr.lp * wv2 + mid) * bg;
        let h = 0; if (this.hN > 0) { const k = this.hLen + Math.round(0.3 * sr) - this.hN, env = k < 0.03 * sr ? k / (0.03 * sr) : k < this.hLen ? 1 : Math.max(0, 1 - (k - this.hLen) / (0.25 * sr)); this.hN--;
          this.hPh1 += this.hF / sr; if (this.hPh1 >= 1) this.hPh1 -= 1; this.hPh2 += this.hF * 1.26 / sr; if (this.hPh2 >= 1) this.hPh2 -= 1; h = ((this.hPh1 * 2 - 1) + (this.hPh2 * 2 - 1)) * env * this.hA; }
        this.hLp += (h - this.hLp) * kH; this.hLp2 += (this.hLp - this.hLp2) * kH; const dl = this.dl, di = this.dli, ech = dl[(di + dl.length - this.dlN) % dl.length]; dl[di] = this.hLp2 + ech * 0.35; this.dli = (di + 1) % dl.length;
        const hh = (this.hLp2 + ech * 0.6) * bg * 20; sl += hh * (1 - this.hPan * 0.6); sr_ += hh * (1 + this.hPan * 0.6); }
      // the way out: a soft knee from 0.6, never past 1
      sl *= lvl; sr_ *= lvl;
      const al = sl < 0 ? -sl : sl, ar = sr_ < 0 ? -sr_ : sr_; if (al > 0.6) sl = (sl < 0 ? -1 : 1) * (0.6 + 0.4 * Math.tanh((al - 0.6) * 2.5)); if (ar > 0.6) sr_ = (sr_ < 0 ? -1 : 1) * (0.6 + 0.4 * Math.tanh((ar - 0.6) * 2.5));
      if (al > peak) peak = al; if (ar > peak) peak = ar;
      L[i] = sl; R[i] = sr_;
    }
    this.seed = seed >>> 0 || 1; this.ph = ph; this.cylI = cylI; this.cylA = cylA; this.dc = dc; this.elp1 = l1; this.elp2 = l2; this.pS = pS; this.sqPh = sqPh; this.scR = scR; this.bl = bl; this.br = br; this.peak = peak;
  }
  /* for the tools: what the gearbox is doing */
  state() { return { clips: this.smp ? Object.keys(this.smp).length : 0, sampledEngine: !!(this.smp && this.sEng[this.type]), shots: this.sStat.shots, gear: this.gear + 1, rpm: Math.round(this.rpm), load: +this.load.toFixed(2), on: +this.on.toFixed(2), peak: +this.peak.toFixed(3) }; }
}
