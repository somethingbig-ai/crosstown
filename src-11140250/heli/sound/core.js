// core.js: the helicopter's sound, made one sample at a time (no WebAudio in here: plain arithmetic, so the same code runs in the
// game's audio worklet and in node for the offline renders that are measured against real recordings).
//
// What is modelled, each from the flight state in params.js:
//   main rotor   every blade is a moving source: its sound is squeezed toward a listener it is swinging at (the sharp pulse once a
//                blade pass that makes the beat and its comb of harmonics), plus broadband blade noise that swishes with each pass,
//                plus blade slap (short bangs when a blade cuts a vortex: descents, hard turns, the vortex ring);
//   tail rotor   its own comb at 69.5 Hz, built harmonic by harmonic (each comes and goes on its own), louder with anti-torque;
//   engine       the gas generator's compressor whine and gear tones following N1, the exhaust's roar following power, the
//                starter, the igniters' ticking and the light-off on a start;
//   gearbox      mesh tones that follow the rotor;
//   air          wind on the listener; the path to the listener (delay, so Doppler; 1/r; highs lost with distance; the bounce off
//                the ground that combs a fly-past; the echo of a street canyon);
//   cabin        the same machine heard from inside: muffled, the gearbox and turbine close, the beat felt through the frame,
//                the warning horns;
//   contacts     skids, hull scrapes, blade strikes.
import { I, NP, STEP } from './params.js';

const TAU = Math.PI * 2, C0 = 343;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class BQ {      // biquad, transposed direct form 2
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, sr) {
    const w = TAU * clamp(f, 5, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (type === 0) { this.b0 = (1 - cs) / 2 / a0; this.b1 = (1 - cs) / a0; this.b2 = this.b0; }            // low-pass
    else if (type === 1) { this.b0 = (1 + cs) / 2 / a0; this.b1 = -(1 + cs) / a0; this.b2 = this.b0; }      // high-pass
    else { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }                                             // band-pass, 0 dB at the centre
    this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0; return this;
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}

// gain slots (each ramps linearly across a block: no zipper noise)
const G = { thump: 0, bbA: 1, bbB: 2, slap: 3, tail: 4, whine: 5, gear: 6, exh: 7, hiss: 8, cThump: 9, cBB: 10, cSlap: 11, cTail: 12, cWhine: 13, cGear: 14, cExh: 15, bbC: 33, modA: 34, tick: 35,
  cVib: 16, cRumble: 17, cWind: 18, wind: 19, horn: 20, fail: 21, starter: 22, out: 23, cab: 24, refl: 25, send: 26, panL: 27, panR: 28, load: 29, tailN: 30, modB: 31, cHiss: 32, N: 36 };

// engine and gearbox tones. [multiple of the shaft's own frequency, level]. The gas generator turns 868 Hz at 100 % N1 (52 100 rpm):
// the two strong tones at 11 and 13 times that are the ones measured in the reference recordings (6.5 and 7.7 kHz at ground idle,
// 9 and 10.6 kHz in flight; lanes/heli/ref/sound/SOURCES.md). The gearbox tones are in Hz at 100 % rotor speed (our own choice).
export const TONES = {
  n1: [[1, 0.05], [2, 0.03], [3.21, 0.10], [6.42, 0.05], [7.37, 0.12], [11, 0.30], [13, 0.10]],
  gear: [[652, 0.16], [1304, 0.07], [1956, 0.20], [2610, 0.09], [3912, 0.05], [5220, 0.01]],
};

// levels and shapes, tuned against the reference recordings
export const TUNE = { sharp: 1.6, thump: 0.06, load: 0.085, modV: 2.0, hiV: 18, bbA: 1.8, bbB: 0.5, bbC: 0.06, beat0: 0.13, beatL: 0.12, beatV: 3.0, beatHi: 1.7, tick: 0.9, aHP: 140, aLP: 330, bF: 600, bQ: 0.5, bLP: 1600, cHP: 2500,
  tSharp: 1.9, tail: 0.55, tailN: 0.05, whine: 0.09, hiss: 0.03, master: 3.2, exh: 0.4, gear: 0.03, wander: 1, tickS: 1.2, slap: 1.5, slap0: 0.3, refl: 0.65 };

export class HeliDSP {
  constructor(sr, o = {}) {
    this.K = Object.assign({}, TUNE, o.tune);
    this.sr = sr; this.T = new Float32Array(NP); this.S = new Float64Array(NP); this.inited = false; this.quiet = 0;
    this.rev = (o.rpm || 390) / 60; this.tailRev = (o.tailRpm || 2086) / 60; this.R = o.R || 5.345; this.tipM = this.rev * TAU * this.R / C0;
    this.tailTipM = this.tailRev * TAU * (o.tailR || 0.93) / C0;
    this.g = new Float64Array(G.N); this.gt = new Float64Array(G.N); this.gd = new Float64Array(G.N);
    this.seed = 0x9e3779b9 | 0; this.ou = new Float64Array(64); this.hf = new Float64Array(11).fill(1);
    this.NH = 11; this.ha = new Float64Array(this.NH); this.hq = new Float64Array(this.NH); this.hp0 = new Float64Array(this.NH); for (let k = 0; k < this.NH; k++) this.hp0[k] = 2.399963 * k * k; this.hcs = this.hp0.map(Math.cos); this.hsn = this.hp0.map(Math.sin); this.hl = new Float64Array(this.NH); for (let k = 0; k < this.NH; k++) this.hl[k] = (0.5 + 0.3 * k) * (0.6 + 0.9 * Math.abs(Math.sin(k * 12.9898 + 4.1)));
    // rotor
    this.ph = 0; this.tph = 0; this.az = 0; this.bladeA = new Float64Array([1, 0.94, 1.05]); this.bladeR = new Float64Array([1, 1, 1]); this.slapR = new Float64Array([1, 1, 1]);
    this.bladeOff = [0, TAU / 3 + 0.012, 2 * TAU / 3 - 0.019]; this.bc = this.bladeOff.map(Math.cos); this.bs = this.bladeOff.map(Math.sin); this.lastSeg = 0;
    this.fA = new BQ(); this.fA2 = new BQ(); this.fB = new BQ(); this.fB2 = new BQ(); this.fC = new BQ(); this.fTn = new BQ(); this.hpT = new BQ().set(1, 9, 0.7, sr); this.fSlap = new BQ().set(1, 110, 0.7, sr); this.fTick = new BQ().set(2, 900, 0.5, sr); this.tickR = new Float64Array([1, 1, 1]); this.fCrack = new BQ().set(1, 450, 0.6, sr);
    // engine
    this.nT = TONES.n1.length; this.gT = TONES.gear.length; this.tc = new Float64Array(this.nT + this.gT).fill(1); this.tsn = new Float64Array(this.nT + this.gT); this.trc = new Float64Array(this.nT + this.gT); this.trs = new Float64Array(this.nT + this.gT); this.tam = new Float64Array(this.nT + this.gT).fill(1); this.tl = new Float64Array(this.nT + this.gT);
    this.jitN1 = 0; this.jitNr = 0; this.fEx = new BQ(); this.fEx2 = new BQ().set(1, 70, 0.7, sr); this.fExR = new BQ().set(2, 38, 1.2, sr); this.fHiss = new BQ(); this.fHiss2 = new BQ();
    this.stp = 0; this.ignT = 0; this.ignE = 0; this.fIgn = new BQ().set(2, 3400, 2.5, sr); this.lit = false; this.whump = 0; this.fWh = new BQ().set(0, 160, 0.8, sr);
    // air
    this.thP = 0; this.ckl = 0; this.hfR = new Float64Array([0.5, 0.5, 0.5]); this.n1S = 0; this.loadS = 0; this.loadSS = 0; this.tlP = 0; this.w1 = 0; this.w2 = 0; this.gust = 0; this.fShud = new BQ().set(2, 6.5, 1.5, sr);
    this.dl = new Float32Array(1 << 18); this.dm = (1 << 18) - 1; this.wi = 0; this.d1 = 0; this.d2 = 0; this.e1 = 0; this.e2 = 0; this.dOld = 0; this.eOld = 0; this.xf = 0; this.xfN = Math.round(sr * 0.06); this.jump = -1;
    this.kd = 1 - Math.exp(-1 / (sr * 0.05)); this.a1 = 0; this.a2 = 0; this.rl = 0;
    // canyon echo: four delay lines feeding each other
    this.rvN = [0.0531, 0.0797, 0.1129, 0.1673].map((s) => Math.round(s * sr)); this.rv = this.rvN.map((n) => new Float32Array(n)); this.rvI = [0, 0, 0, 0]; this.rvL = [0, 0, 0, 0]; this.rvOn = 0;
    // cabin
    this.cb1 = new BQ(); this.cb2 = new BQ(); this.fRum = new BQ().set(0, 150, 0.7, sr); this.fRum2 = new BQ().set(1, 35, 0.7, sr); this.fCW = new BQ(); this.cw1 = 0; this.cw2 = 0;
    this.hph = 0; this.fph = 0; this.ft = 0; this.fHorn = new BQ().set(0, 2400, 0.7, sr);
    // contacts: a few voices of struck metal
    this.NV = 6; this.vE = new Float64Array(this.NV); this.vD = new Float64Array(this.NV); this.vLP = new Float64Array(this.NV); this.vLk = new Float64Array(this.NV); this.vA = new Float64Array(this.NV);
    this.mY1 = new Float64Array(this.NV * 3); this.mY2 = new Float64Array(this.NV * 3); this.mC = new Float64Array(this.NV * 3); this.mR = new Float64Array(this.NV * 3); this.mG = new Float64Array(this.NV * 3);
    this.vNext = 0; this.hitCool = new Float64Array(3); this.hitLive = 0; this.time = 0;
    // limiter
    this.env = 0; this.lim = 1; this.atk = 1 - Math.exp(-1 / (sr * 0.0005)); this.rel = 1 - Math.exp(-1 / (sr * 0.18)); this.lb = new Float32Array(2 * Math.round(sr * 0.0025)); this.li = 0;
  }
  // a slow random wander with unit spread and time constant tau (s): nothing in a real recording holds still
  wander(i, tau, n) { const a = n / (this.sr * tau), o = this.ou; o[i] += -o[i] * a + Math.sqrt(2 * a) * 1.732 * this.rnd(); return o[i]; }
  rnd() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return s * 4.656612873077393e-10; }      // -1..1

  // a contact: kind 0 skid, 1 hull, 2 rotor; speed m/s
  hit(kind, speed) {
    if (this.time < this.hitCool[kind]) return; this.hitCool[kind] = this.time + (kind === 0 ? 0.12 : kind === 1 ? 0.07 : 0.09);
    const v = this.vNext; this.vNext = (v + 1) % this.NV; const sr = this.sr, j = () => 1 + this.rnd() * 0.07;
    const D = (ms) => Math.exp(-1 / (sr * ms / 1000 / 6.9));      // per-sample factor for a 60 dB fall in ms
    let amp, nd, lp, modes;
    if (kind === 0) { amp = clamp(speed / 5, 0.12, 1.1); nd = 120; lp = 260; modes = [[92, 260, 1.5], [410, 420, 0.5], [1030, 300, 0.3]]; }
    else if (kind === 1) { amp = clamp(speed / 5, 0.2, 1.5); nd = 420; lp = 1500; modes = [[240, 500, 0.6], [760, 380, 0.5], [1900, 260, 0.35]]; }
    else { amp = clamp(speed / 5, 0.6, 2.0); nd = 160; lp = 5200; modes = [[163, 1300, 0.7], [468, 1000, 0.7], [1320, 700, 0.5]]; }
    this.vE[v] = 1; this.vD[v] = D(nd); this.vLk[v] = 1 - Math.exp(-TAU * lp / sr); this.vA[v] = amp;
    for (let m = 0; m < 3; m++) { const f = modes[m][0] * j(), r = D(modes[m][1]); this.mC[v * 3 + m] = 2 * r * Math.cos(TAU * f / sr); this.mR[v * 3 + m] = r * r; this.mG[v * 3 + m] = modes[m][2] * (1 - r) * 6; }
    this.hitLive = Math.round(sr * 2.2);
  }

  tap(d) {      // the delay line, d samples back, cubic between samples
    const p = this.wi - d, i = Math.floor(p), t = p - i, m = this.dm, b = this.dl;
    const y0 = b[(i - 1) & m], y1 = b[i & m], y2 = b[(i + 1) & m], y3 = b[(i + 2) & m];
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
  }

  process(L, R, n) {
    const T = this.T, S = this.S, sr = this.sr, g = this.g, gt = this.gt, gd = this.gd;
    if (!this.inited) { for (let i = 0; i < NP; i++) S[i] = T[i]; this.inited = true; this.az = Math.atan2(S[I.AZS], S[I.AZC]); this.d1 = this.d2 = Math.min(S[I.DIST], 1300) / C0 * sr; this.e1 = this.e2 = S[I.GDELAY] * sr; this.jump = S[I.JUMP]; }
    const ks = 1 - Math.exp(-n / (sr * 0.035)); for (let i = 0; i < NP; i++) S[i] += (T[i] - S[i]) * ks; for (const i of STEP) S[i] = T[i];
    this.n1S += (S[I.N1] - this.n1S) * Math.min(1, n / (sr * 0.5)); const nr = S[I.NR], n1 = this.n1S, eng = S[I.ENG], air = S[I.AIR];
    // nothing turning, nothing ringing, or muted: silence, for free
    if (S[I.MUTE] > 0.5 || (nr < 0.002 && n1 < 0.004 && eng === 0 && this.hitLive <= 0 && this.quiet > sr * 3)) {
      if (S[I.MUTE] > 0.5) { g.fill(0); } else this.quiet += n; for (let i = 0; i < n; i++) { L[i] = 0; R[i] = 0; } this.time += n / sr; return;
    }
    if (nr < 0.002 && n1 < 0.004 && eng === 0) this.quiet += n; else this.quiet = 0;
    this.time += n / sr; if (this.hitLive > 0) this.hitLive -= n;

    // ---------------------------------------------------------------- once a block: what each part should be doing
    this.loadS += (S[I.LOAD] - this.loadS) * Math.min(1, n / (sr * 0.45));
    const K = this.K, load = this.loadS, aload = Math.abs(load), tq = S[I.TORQUE], pw = S[I.POWER], ias = S[I.IAS], vrs = S[I.VRS], inside = S[I.INSIDE], door = S[I.DOOR];
    const dist = S[I.DIST], sinEl = clamp(S[I.SINEL], -1, 1), cosEl = Math.sqrt(1 - sinEl * sinEl);
    const azN = Math.hypot(S[I.AZC], S[I.AZS]) || 1, azc = S[I.AZC] / azN, azs = S[I.AZS] / azN, side = Math.abs(S[I.SIDE]);
    const outside = 1 - inside, ahead = azc * cosEl, behind = 0.5 - 0.5 * ahead, below = clamp(-sinEl, 0, 1);
    // slow wanderings: the air between (the level never sits still), shaft speeds, gusts
    const far = clamp(dist / 120, 0.6, 1.5), dB = 0.1151 * K.wander;
    const wob = Math.exp(dB * 1.6 * far * this.wander(0, 1.1, n)), wA = Math.exp(dB * 2.2 * this.wander(1, 0.7, n)), wB = Math.exp(dB * 2.4 * this.wander(2, 0.45, n)), wC = Math.exp(dB * 2.6 * this.wander(3, 0.35, n));
    const wH = Math.exp(dB * 2.6 * this.wander(13, 1.0, n)), wT = Math.exp(dB * 3.0 * this.wander(4, 0.8, n)), wP = Math.exp(dB * 2.5 * this.wander(5, 0.9, n)), wW = wH * Math.exp(dB * 3.5 * this.wander(10, 1.5, n)), wS = Math.exp(dB * 3.0 * this.wander(11, 0.5, n));
    this.loadSS += (S[I.LOAD] - this.loadSS) * Math.min(1, n / (sr * 1.6));
    // the rotor never holds its speed exactly: the governor hunts, and the speed sags as load comes on and recovers
    this.jitNr = 0.006 * this.wander(6, 1.1, n) - 0.02 * clamp(S[I.LOAD] - this.loadSS, -1, 1); this.jitN1 = (0.003 + 0.002 * clamp(aload, 0, 1)) * this.wander(7, 2.0, n) + 0.005 * this.wander(12, 0.04, n); this.gust = clamp(this.wander(8, 1.4, n), -2, 2) * 0.5;
    const reflW = 1 + 0.12 * clamp(this.wander(9, 2.5, n), -2.5, 2.5) + 0.07 * clamp(this.wander(44, 0.35, n), -2.5, 2.5);
    const nr2 = nr * nr, nr25 = nr2 * Math.sqrt(nr), nr3 = nr2 * nr;

    // main rotor. The pulse sharpens with the blade's speed toward the listener: in the rotor's plane and ahead of a fast machine it
    // cracks, above and below it is a soft thud.
    const mFly = ias / C0, mTip = this.tipM * nr;
    const Me = clamp((mTip * (0.52 + 0.48 * cosEl) + mFly * ahead * 0.9) * K.sharp * (1 + 0.012 * clamp(this.wander(15, 0.7, n), -2, 2)), 0, 0.99), Me2 = Me * Me, om = 1 - Me2, Mm = clamp(mTip * (0.35 + 0.65 * cosEl) * 1.3 + K.modV * mFly, 0, 0.86), Mm2 = Mm * Mm, omm = 1 - Mm2;
    const pk3 = 1 / ((1 - Me) * (1 - Me) * (1 - Me)), mean3 = (2 + Me2) / (2 * om * om * Math.sqrt(om)), n3 = 1 / Math.max(pk3 - mean3, 1e-3) * clamp(Me * 8, 0, 1);
    const mean2 = 1 / (omm * Math.sqrt(omm)), mean4 = (2 + 3 * Mm2) / (2 * omm * omm * omm * Math.sqrt(omm));
    const q = clamp(0.75 * this.R / Math.max(dist * cosEl, 1), 0, 0.72) * outside, q2 = 1 + q * q, qn = (1 + q) / (1 - q) * (1 - q) * (1 - q);      // nearness of each blade as it comes round
    const nA = 1 / (3 * mean2), nB = 1 / (3 * mean4);
    gt[G.thump] = K.thump * nr2 * (0.7 * Math.pow(mTip / 0.64, 3) + 1.0 * clamp(aload, 0, 2)) * (0.55 + 0.45 * cosEl) * wob * wP;
    gt[G.load] = K.load * nr2 * clamp(aload, 0, 2) * (0.3 + 0.7 * sinEl * sinEl) * (1 + 6 * mFly) * wob * wP;
    const bb = nr25 * (0.2 + 0.8 * clamp(aload, 0, 2)) * (1 + 0.9 * vrs) * (0.7 + 0.3 * Math.abs(sinEl)) * wob;
    const hiV = 1 + K.hiV * mFly; gt[G.bbA] = K.bbA * bb * wA; gt[G.bbB] = K.bbB * bb * wB * wH * Math.sqrt(hiV); gt[G.bbC] = K.bbC * bb * wC * wH * hiV;
    const beat = clamp(K.beat0 + 0.2 * (1 - clamp(aload, 0, 1)) + K.beatL * clamp(aload, 0, 1.6) + K.beatV * mFly * (0.5 + 0.5 * Math.abs(ahead)), 0, 0.95); gt[G.modB] = clamp(beat * K.beatHi, 0, 0.97); gt[G.modA] = beat;
    const fs = 0.2 + 0.8 * nr; this.fA.set(1, K.aHP * fs, 0.6, sr); this.fA2.set(0, K.aLP * fs, 0.55, sr); this.fB.set(2, K.bF * fs, K.bQ, sr); this.fB2.set(0, K.bLP * fs, 0.6, sr); this.fC.set(1, K.cHP * fs, 0.6, sr);
    // blade slap
    const gam = Math.atan2(-S[I.VS], Math.max(ias, 1)) * 57.3, desc = Math.exp(-((gam - 6) / 4.5) * ((gam - 6) / 4.5)) * clamp((ias - 10) / 14, 0, 1) * clamp(load, 0, 1.5);
    const turn = clamp((S[I.GLOAD] - 1.2) / 0.6, 0, 1) * clamp(ias / 25, 0, 1), hov = K.slap0 * clamp(load, 0, 1.5) * clamp(1.2 - ias / 30, 0.25, 1), slapLv = (clamp(desc + turn + vrs * 0.8 + hov, 0, 1.3) * air + 0.8 * K.slap0 * (1 - clamp(aload, 0, 1))) * nr3;
    gt[G.slap] = K.slap * slapLv * (0.3 + 0.7 * clamp(0.5 + 0.5 * azc, 0, 1) * (0.55 + 0.45 * below)) * wob * wS; gt[G.cSlap] = 0.55 * slapLv;
    // at speed, and whenever it slaps, each pass also cracks: a very short burst across the whole band
    const imp = clamp(Math.max(desc, turn) + 0.9 * clamp((ias - 16) / 22, 0, 1) * clamp(load, 0, 1.3), 0, 1.2);
    gt[G.tick] = K.tickS * imp * nr3 * air * (0.45 + 0.55 * Math.max(below, clamp(azc, 0, 1))) * wob * wS;
    // tail rotor
    const anti = clamp(0.75 * tq + 0.6 * Math.abs(S[I.PEDAL]), 0, 1.4), inPl = Math.sqrt(Math.max(0, 1 - side * side));
    const Mt = clamp(this.tailTipM * nr * (0.75 + 0.25 * inPl) * K.tSharp * (0.6 + 0.4 * clamp(anti * 3.3, 0, 1)) * (1 + 0.035 * clamp(this.wander(14, 0.9, n), -2, 2)), 0, 0.965), Mt2 = Mt * Mt, omt = 1 - Mt2;
    const tLv = 0.045 + 0.62 * Math.tanh(1.6 * anti * Math.sqrt(clamp(anti * 2.5, 0, 1))); gt[G.tail] = K.tail * nr25 * (0.8 + 0.2 * side) * wob * wT; gt[G.tailN] = K.tailN * nr25 * (0.4 + 0.6 * anti) * (0.5 + 0.5 * side);
    this.fTn.set(2, 200 + 1300 * nr, 0.5, sr);
    // the tail rotor's comb, harmonic by harmonic: each has its own level that comes and goes, the upper ones answer a little later
    { const rho = Mt / (1 + Math.sqrt(omt)), NH = this.NH, ha = this.ha; let mx = 1e-9, pw = rho;
      for (let k = 1; k <= NH; k++) { const sh = Math.pow(k, 1.3) * pw; pw *= rho; this.hq[k - 1] = sh; if (sh > mx) mx = sh; }
      for (let k = 0; k < NH; k++) { const tgt = tLv * this.hq[k] / mx * Math.exp(dB * 4 * clamp(this.wander(16 + k, 2.4 + 0.25 * k, n), -2.5, 2)); ha[k] += (tgt - ha[k]) * Math.min(1, n / (sr * this.hl[k])); this.hf[k] = Math.exp(dB * 2.5 * clamp(this.wander(48 + k, 0.09 + 0.01 * k, n), -2.5, 2));
        const hp = this.hp0[k] + 1.3 * this.wander(32 + k, 0.3 + 0.03 * k, n); this.hcs[k] = Math.cos(hp); this.hsn[k] = Math.sin(hp); } }
    // engine
    const starting = eng === 1, lit = n1 > 0.1 && (eng === 1 || eng === 2);
    if (starting && lit && !this.lit) this.whump = 1; this.lit = lit; if (eng === 0 || eng === 3) this.lit = false;
    const n12 = n1 * n1, fire = eng === 1 || eng === 2 ? 1 : clamp(n1 * 1.6, 0, 1);       // run-down: the fire is out, the air still whistles through
    gt[G.whine] = K.whine * n12 * (0.25 + 0.75 * behind) * (0.5 + 0.5 * fire) * wW * (1.15 - 0.45 * clamp(pw * 1.6, 0, 1));
    gt[G.hiss] = K.hiss * n12 * n1 * (0.5 + 0.5 * behind) * (0.4 + 0.6 * fire) * wH;
    gt[G.exh] = K.exh * (0.5 * n12 + 0.5 * pw) * (lit || eng === 2 ? 1 : 0) * (0.3 + 0.7 * behind);
    gt[G.gear] = K.gear * nr2 * (0.5 + 0.5 * clamp(tq, 0, 1.2)) * (0.6 + 0.4 * cosEl);
    gt[G.starter] = starting ? 0.028 * clamp(n1 * 12, 0, 1) * clamp((0.55 - n1) / 0.2, 0, 1) : 0;
    this.fEx.set(0, 500 + 1500 * n1 - 900 * clamp(pw * 1.5, 0, 1), 0.55, sr); this.fHiss.set(2, 2500 + 4200 * n1, 0.5, sr); this.fHiss2.set(1, 1200, 0.7, sr);
    const ignOn = starting && n1 < 0.55;
    // wind
    const ls = S[I.LSPEED], wv = Math.max(ias, 0), gs = 1 + 0.35 * this.gust;
    gt[G.wind] = 0.5 * clamp((ls / 60) * (ls / 60), 0, 1.5) * outside * gs; gt[G.cWind] = 0.42 * clamp((wv / 62) * (wv / 62), 0, 1.6) * gs;
    const kw = 1 - Math.exp(-TAU * (90 + 7 * (inside > 0.5 ? wv : ls)) / sr); this.fCW.set(2, 700 + 30 * wv, 0.4, sr);
    // cabin: the outside comes through the skin and the open door, the machinery through the frame
    const dop = clamp(door, 0, 1); this.cb1.set(0, 300 + 3200 * dop, 0.6, sr); this.cb2.set(0, 520 + 5000 * dop, 0.6, sr);
    const cg = 0.5 + 0.5 * dop;
    gt[G.cThump] = 0.55 * nr2 * (0.3 + 0.7 * clamp(aload, 0, 2)) * cg; gt[G.cBB] = 1.6 * bb * cg; gt[G.cTail] = 0.10 * nr25 * (0.3 + 0.7 * anti) * cg;
    gt[G.cWhine] = 0.17 * n12 * (0.5 + 0.5 * fire); gt[G.cHiss] = 0.10 * n12 * n1 * (0.4 + 0.6 * fire); gt[G.cGear] = 0.30 * nr2 * (0.45 + 0.55 * clamp(tq, 0, 1.2)); gt[G.cExh] = 0.62 * (0.3 * n12 + 0.7 * pw) * (lit || eng === 2 ? 1 : 0);
    gt[G.cVib] = 0.24 * nr2 * (0.25 + 0.45 * clamp(aload, 0, 2) + 0.5 * clamp(ias / 65, 0, 1.2) + 1.3 * vrs + 0.5 * slapLv); gt[G.cRumble] = 0.42 * nr2 * (0.5 + 0.5 * clamp(aload, 0, 2) + vrs);
    const hornOn = air > 0.5 && nr < 0.9 && (eng === 1 || eng === 2), failOn = (eng === 3 || eng === 0) && air > 0.5 && nr > 0.25;
    gt[G.horn] = hornOn ? 0.085 : 0; gt[G.fail] = failOn ? 0.075 : 0;
    // the path
    const gOut = outside * K.master * 13 / (Math.max(dist, 6) + 4); gt[G.out] = gOut; gt[G.cab] = inside;
    gt[G.refl] = S[I.GGAIN] * K.refl * outside; gt[G.send] = S[I.CANYON] * 0.55 * outside;
    const pan = clamp(S[I.PAN], -1, 1) * 0.8, pa = (pan + 1) * Math.PI / 4; gt[G.panL] = Math.cos(pa) * 1.4142; gt[G.panR] = Math.sin(pa) * 1.4142;
    const absK = 1 - Math.exp(-TAU * Math.min(20000, 2.0e6 / Math.max(dist, 1)) / sr);
    const inv = 1 / n; for (let i = 0; i < G.N; i++) gd[i] = (gt[i] - g[i]) * inv;
    const live = gOut > 1e-5 || g[G.out] > 1e-5, cabin = inside > 1e-4 || g[G.cab] > 1e-4, rvOn = gt[G.send] > 1e-4 || this.rvOn > 0;
    if (gt[G.send] > 1e-4) this.rvOn = Math.round(sr * 2.5); else if (this.rvOn > 0) this.rvOn -= n;
    if (S[I.JUMP] !== this.jump) { this.jump = S[I.JUMP]; this.dOld = this.d2; this.eOld = this.e2; this.xf = this.xfN; this.d1 = this.d2 = Math.min(T[I.DIST], 1300) / C0 * sr; this.e1 = this.e2 = T[I.GDELAY] * sr; S[I.DIST] = T[I.DIST]; S[I.GDELAY] = T[I.GDELAY]; }
    const dT = Math.min(T[I.DIST], 1300) / C0 * sr, eT = T[I.GDELAY] * sr * reflW, kd = this.kd, maxD = this.dm - 8;

    // rotor phases for this block
    const dph = TAU * this.rev * nr * (1 + this.jitNr) / sr, dtp = TAU * this.tailRev * nr * (1 + this.jitNr) / sr;
    const az1 = Math.atan2(azs, azc); let daz = az1 - this.az; if (daz > Math.PI) daz -= TAU; else if (daz < -Math.PI) daz += TAU;
    const th0 = this.ph - this.az, dth = dph - daz * inv; this.az = az1;
    let pc = Math.cos(th0), ps = Math.sin(th0); const rc = Math.cos(dth), rs = Math.sin(dth);
    let tc = Math.cos(this.tph), ts = Math.sin(this.tph); const trc = Math.cos(dtp), trs = Math.sin(dtp);
    let c3 = Math.cos(3 * this.ph), s3 = Math.sin(3 * this.ph); const r3c = Math.cos(3 * dph), r3s = Math.sin(3 * dph);
    for (let b = 0; b < 3; b++) { const o = this.bladeOff[b] + 0.02 * clamp(this.wander(28 + b, 0.25, n), -2.5, 2.5); this.bc[b] = Math.cos(o); this.bs[b] = Math.sin(o); }
    let ph = this.ph; const bc = this.bc, bs = this.bs, bA = this.bladeA, bR = this.bladeR, sR = this.slapR, tR = this.tickR, bo = this.bladeOff;
    const slapOn = slapLv > 1e-4 || g[G.slap] > 1e-5 || g[G.cSlap] > 1e-5 || gt[G.tick] > 1e-5 || g[G.tick] > 1e-5, SW = 1 / 0.034;
    // tone phases
    const nT = this.nT, gT = this.gT, tcs = this.tc, tsn = this.tsn, qc = this.trc, qs = this.trs, tam = this.tam, tl = this.tl, wN1 = TAU * 868 * n1 * (1 + this.jitN1) / sr, wG = TAU * nr * (1 + this.jitNr) / sr;
    for (let k = 0; k < nT + gT; k++) {
      { const a = n / (sr * 0.8); tam[k] = clamp(tam[k] + (1 - tam[k]) * a + Math.sqrt(2 * a) * 0.6 * this.rnd(), 0.08, 2.2); } tl[k] = (k < nT ? TONES.n1[k][1] : TONES.gear[k - nT][1]) * tam[k];
      const w = k < nT ? wN1 * TONES.n1[k][0] : wG * TONES.gear[k - nT][0], m = 1 / Math.hypot(tcs[k], tsn[k]); tcs[k] *= m; tsn[k] *= m; qc[k] = Math.cos(w); qs[k] = w < 3 ? Math.sin(w) : 0;
    }
    const tonesOn = n1 > 0.01 || nr > 0.01, wSt = TAU * (240 + 2900 * n1) / sr;
    const kWh = Math.exp(-1 / (sr * 0.12)), kIg = Math.exp(-1 / (sr * 0.0016));
    const fdb = 0.60, vibMod = 1.4 * vrs;
    let thP = this.thP, ckl = this.ckl; const ckK = 1 - Math.exp(-TAU * 1300 / sr), hR = this.hfR; const NH = this.NH, ha = this.ha, hf = this.hf, hcs = this.hcs, hsn = this.hsn; const dK = sr / (TAU * 45);
    let w1 = this.w1, w2 = this.w2, cw1 = this.cw1, cw2 = this.cw2, a1 = this.a1, a2 = this.a2, rl = this.rl, env = this.env, lim = this.lim;
    const NV = this.NV, hitsOn = this.hitLive > 0;

    for (let i = 0; i < n; i++) {
      for (let k = 0; k < G.N; k++) g[k] += gd[k];
      const wa = this.rnd(), wb = this.rnd(), wc = this.rnd(), wd = this.rnd();
      // ---- main rotor
      let th = 0, mA = 0, mB = 0;
      for (let b = 0; b < 3; b++) {
        const c = pc * bc[b] - ps * bs[b], s = ps * bc[b] + pc * bs[b];
        const D = 1 / (1 - Me * s), a = bA[b] * bR[b], E = 1 / (1 - Mm * s), E2 = E * E;
        th += a * (D * D * D - mean3); mA += a * E2 * qn / (q2 - 2 * q * c); mB += tR[b] * E2 * E2;
      }
      const t0 = pc * rc - ps * rs; ps = ps * rc + pc * rs; pc = t0;
      ph += dph; if (ph >= TAU) ph -= TAU;
      // which third of the turn: when a blade goes by the tail its next pass gets a new strength (no two passes alike)
      const seg = (ph * 0.477464829) | 0; if (seg !== this.lastSeg) { this.lastSeg = seg; const b = seg % 3; bR[b] = 1 + this.rnd() * 0.35; sR[b] = 0.8 + 0.4 * Math.abs(this.rnd()); tR[b] = 0.3 + 1.2 * Math.abs(this.rnd()) * Math.abs(this.rnd()) + 0.5 * Math.abs(this.rnd()); const h = this.rnd(); hR[b] = 1.6 * h * h * h * h + 0.05; }
      const thr = th * n3, thump = this.hpT.run((thr - thP) * dK + 0.25 * thr); thP = thr;
      const u3 = c3 * r3c - s3 * r3s; s3 = s3 * r3c + c3 * r3s; c3 = u3;
      const s6 = 2 * s3 * c3, c6 = c3 * c3 - s3 * s3, s9 = s6 * c3 + c6 * s3, c9 = c6 * c3 - s6 * s3, s12 = s9 * c3 + c9 * s3, c12 = c9 * c3 - s9 * s3, s15 = s12 * c3 + c12 * s3, loadH = s3 + 0.75 * c6 - 0.55 * s9 + 0.4 * c12 + 0.3 * s15;
      mA = 1 + g[G.modA] * (mA * nA - 1); mB = 1 + g[G.modB] * (mB * nB - 1);
      // the shudder of the vortex ring: the blades thrash through their own wake, unevenly
      let shud = 1; if (vrs > 0.01) { shud = 1 + vibMod * clamp(this.fShud.run(wc) * 9, -0.65, 1.2); }
      const nzA = this.fA2.run(this.fA.run(wa)) * mA * shud, nzB = this.fB2.run(this.fB.run(wb)) * mB * shud, nzC = this.fC.run(wd) * mB * shud;
      let slap = 0, tick = 0, crack = 0, crackH = 0;
      if (slapOn) {
        for (let b = 0; b < 3; b++) {
          let x = ph + bo[b]; if (x >= TAU) x -= TAU; if (x >= TAU) x -= TAU; x = (x - 1.9) * SW;
          if (x > -9 && x < 9) { tick += tR[b] * Math.exp(-x * x * 0.08); } if (x > -3.5 && x < 3.5) { const e = Math.exp(-x * x); slap += sR[b] * 2.33 * x * e; crack += tR[b] * e; crackH += tR[b] * hR[b] * e; } else { x -= 3.6; if (x > -3.5 && x < 3.5) slap -= sR[b] * 1.1 * x * Math.exp(-x * x); }
        }
        slap = this.fSlap.run(slap) + K.tick * tick * this.fTick.run(wd); { const cx = this.fCrack.run(wa); ckl += (cx - ckl) * ckK; crack = crack * ckl * 1.4 + crackH * (cx - ckl); }
      }
      // ---- tail rotor: two blades, half a turn apart
      const E1 = 1 / (1 - Mt * ts), E2 = 1 / (1 + Mt * ts), E12 = E1 * E1, E22 = E2 * E2;
      let tail = 0; { const c1 = tc * tc - ts * ts, s1 = 2 * ts * tc; let ck = c1, sk = s1; for (let k = 0; k < NH; k++) { tail += ha[k] * hf[k] * (hcs[k] * sk + hsn[k] * ck); const u = ck * c1 - sk * s1; sk = sk * c1 + ck * s1; ck = u; } tail *= 0.24 * (0.75 + 0.25 * mA); }
      const tailN = this.fTn.run(wc) * (E12 + E22) * omt * Math.sqrt(omt) * 0.5;
      const t1 = tc * trc - ts * trs; ts = ts * trc + tc * trs; tc = t1;
      // ---- engine and gearbox
      let whine = 0, gear = 0;
      if (tonesOn) {
        for (let k = 0; k < nT; k++) { const c = tcs[k], s = tsn[k]; tcs[k] = c * qc[k] - s * qs[k]; tsn[k] = s * qc[k] + c * qs[k]; whine += tl[k] * s; }
        const fm = 0.6 * thump;      // the drive train winds up a little with every blade pass: sidebands on the mesh tones
        for (let k = nT; k < nT + gT; k++) { const c = tcs[k], s = tsn[k]; tcs[k] = c * qc[k] - s * qs[k]; tsn[k] = s * qc[k] + c * qs[k]; gear += tl[k] * (s + fm * c); }
      }
      const ex0 = this.fEx2.run(this.fEx.run(wc)), exh = ex0 * (1 + 2.5 * this.fExR.run(wa)) * 3.4 * (0.75 + 0.25 * mB);
      const hiss = this.fHiss2.run(this.fHiss.run(wb)) * 2.2;
      let extra = 0;
      if (g[G.starter] > 1e-5) { this.stp += wSt; if (this.stp > TAU) this.stp -= TAU; const sp = this.stp; extra += g[G.starter] * (Math.sin(sp) + 0.35 * Math.sin(2 * sp + 1) + 0.12 * Math.sin(3 * sp + 2)) * (1 + 0.5 * wb); }
      if (ignOn) { this.ignT -= 1; if (this.ignT <= 0) { this.ignT = sr * (0.2 + 0.035 * this.rnd()); this.ignE = 1; } }
      if (this.ignE > 1e-4) { extra += this.fIgn.run(wa * this.ignE) * 0.3; this.ignE *= kIg; }
      if (this.whump > 1e-4) { extra += this.fWh.run(wb) * this.whump * 0.9; this.whump *= kWh; }
      // ---- contacts
      let hits = 0;
      if (hitsOn) {
        for (let v = 0; v < NV; v++) {
          const e = this.vE[v]; let x = 0; if (e > 1e-5) { this.vLP[v] += (wc * e - this.vLP[v]) * this.vLk[v]; x = this.vLP[v]; this.vE[v] = e * this.vD[v]; hits += x * this.vA[v] * 2.2; }
          for (let m = v * 3; m < v * 3 + 3; m++) { const y = x * this.mG[m] + this.mC[m] * this.mY1[m] - this.mR[m] * this.mY2[m] + 1e-20; this.mY2[m] = this.mY1[m]; this.mY1[m] = y; hits += y * this.vA[v]; }
        }
      }
      // ---- wind (on whoever listens)
      w1 += (wa - w1) * kw; w2 += (w1 - w2) * kw; const wind = w2 * 9;

      // ---- to an outside listener: down the path
      let oL = 0, oR = 0;
      const src = g[G.thump] * thump + g[G.load] * loadH + g[G.bbA] * nzA + g[G.bbB] * nzB + g[G.bbC] * nzC + g[G.slap] * slap + g[G.tick] * crack + g[G.tail] * tail + g[G.tailN] * tailN + g[G.whine] * whine * (0.55 + 0.45 * mA) + g[G.gear] * gear + g[G.exh] * exh + g[G.hiss] * hiss + extra + hits;
      this.dl[this.wi] = src;
      this.d1 += (dT - this.d1) * kd; this.d2 += (this.d1 - this.d2) * kd; this.e1 += (eT - this.e1) * kd; this.e2 += (this.e1 - this.e2) * kd;
      if (live) {
        const dd = this.d2 < maxD ? this.d2 : maxD; let x = this.tap(dd), y = 0;
        if (g[G.refl] > 1e-4) { const de = dd + this.e2; y = this.tap(de < maxD ? de : maxD); }
        if (this.xf > 0) { const k = this.xf / this.xfN; this.xf--; x = x * (1 - k) + this.tap(this.dOld < maxD ? this.dOld : maxD) * k; if (g[G.refl] > 1e-4) y = y * (1 - k) + this.tap(Math.min(this.dOld + this.eOld, maxD)) * k; }
        rl += (y - rl) * 0.55; x += g[G.refl] * rl;         // the ground takes the top off what it sends back
        a1 += (x - a1) * absK; a2 += (a1 - a2) * absK;      // the air takes the highs with distance
        x = a2 * g[G.out] + g[G.wind] * wind;
        oL = x * g[G.panL]; oR = x * g[G.panR];
        if (rvOn) {
          const rv = this.rv, ri = this.rvI, rn = this.rvN, lpf = this.rvL, inp = a2 * g[G.out] * g[G.send];
          const r0 = rv[0][ri[0]], r1 = rv[1][ri[1]], r2 = rv[2][ri[2]], r3 = rv[3][ri[3]], sum = (r0 + r1 + r2 + r3) * 0.5;
          lpf[0] += ((r0 - sum) * fdb - lpf[0]) * 0.45; lpf[1] += ((r1 - sum) * fdb - lpf[1]) * 0.45; lpf[2] += ((r2 - sum) * fdb - lpf[2]) * 0.45; lpf[3] += ((r3 - sum) * fdb - lpf[3]) * 0.45;
          rv[0][ri[0]] = inp + lpf[0] + 1e-20; rv[1][ri[1]] = inp + lpf[1]; rv[2][ri[2]] = lpf[2] - inp; rv[3][ri[3]] = lpf[3] + inp;
          if (++ri[0] >= rn[0]) ri[0] = 0; if (++ri[1] >= rn[1]) ri[1] = 0; if (++ri[2] >= rn[2]) ri[2] = 0; if (++ri[3] >= rn[3]) ri[3] = 0;
          oL += r0 + r2 * 0.7; oR += r1 + r3 * 0.7;
        }
      }
      this.wi = (this.wi + 1) & this.dm;
      // ---- in the cabin
      if (cabin) {
        const thru = this.cb2.run(this.cb1.run(g[G.cThump] * thump + g[G.cBB] * (K.bbA * nzA + K.bbB * nzB) + g[G.cSlap] * slap + 0.5 * g[G.tick] * crack + g[G.cTail] * tail + g[G.cExh] * exh + 0.5 * extra + 0.8 * hits));
        const vib = (s3 + 0.7 * c6 + 0.45 * c9 + 0.3 * (2 * s6 * c6)) * shud;
        const rum = this.fRum2.run(this.fRum.run(wb)) * 7;
        cw1 += (wc - cw1) * kw; cw2 += (cw1 - cw2) * kw; const cwind = cw2 * 7 + this.fCW.run(wa) * 0.5;
        let horn = 0;
        if (g[G.horn] > 1e-5) { this.hph += TAU * 310 / sr; if (this.hph > TAU) this.hph -= TAU; const h = this.hph; horn += g[G.horn] * (Math.sin(h) + 0.6 * Math.sin(3 * h) + 0.35 * Math.sin(5 * h) + 0.2 * Math.sin(7 * h)); }
        if (g[G.fail] > 1e-5) { this.ft += 1 / sr; const hi = (this.ft * 2.4) % 1 < 0.5; this.fph += TAU * (hi ? 780 : 585) / sr; if (this.fph > TAU) this.fph -= TAU; const h = this.fph; horn += g[G.fail] * (Math.sin(h) + 0.4 * Math.sin(2 * h) + 0.25 * Math.sin(3 * h)); }
        const mono = thru + g[G.cGear] * gear + g[G.cWhine] * whine + g[G.cHiss] * hiss * 0.5 + g[G.cVib] * vib + this.fHorn.run(horn);
        const c = g[G.cab]; oL += c * (mono + g[G.cRumble] * rum + g[G.cWind] * cwind); oR += c * (mono + g[G.cRumble] * rum * 0.6 + g[G.cWind] * (cw1 * 5 - cwind * 0.3) + g[G.cRumble] * 0.5 * thru);
      }
      // ---- the bus limiter: loud close up, never clipped
      // (it looks 2.5 ms ahead, so the gain is already down when a peak arrives: no clipped slap, no pumping click)
      const aL = oL < 0 ? -oL : oL, aR = oR < 0 ? -oR : oR, pkv = aL > aR ? aL : aR; env = pkv > env ? pkv : env + (pkv - env) * this.rel;
      let want = 1; if (env > 0.4) { want = (0.4 + (env - 0.4) * 0.3) / env; if (want * env > 0.92) want = 0.92 / env; }
      lim += (want - lim) * (want < lim ? this.atk : this.rel);
      const li = this.li, lb = this.lb; lb[li] = oL; lb[li + 1] = oR; const lj = (li + 2) % lb.length; oL = lb[lj] * lim; oR = lb[lj + 1] * lim; this.li = lj;
      if (oL > 0.8) oL = 0.8 + 0.19 * Math.tanh((oL - 0.8) * 5.26); else if (oL < -0.8) oL = -0.8 - 0.19 * Math.tanh((-oL - 0.8) * 5.26);
      if (oR > 0.8) oR = 0.8 + 0.19 * Math.tanh((oR - 0.8) * 5.26); else if (oR < -0.8) oR = -0.8 - 0.19 * Math.tanh((-oR - 0.8) * 5.26);
      L[i] = oL; R[i] = oR;
    }
    for (let k = 0; k < G.N; k++) g[k] = gt[k];
    this.thP = thP; this.ckl = ckl; this.ph = ph; this.tph = Math.atan2(ts, tc); this.w1 = w1; this.w2 = w2; this.cw1 = cw1; this.cw2 = cw2; this.a1 = a1; this.a2 = a2; this.rl = rl; this.env = env; this.lim = lim;
  }
}
