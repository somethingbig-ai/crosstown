// bus/sound_core.js (bus lane, stops+sound helper, Nov 15): the city bus's sound, made one sample at a time. Plain arithmetic, no WebAudio in here
// (as src/heli/sound/core.js and src/sfx/core.js are): the same code runs in the game's audio worklet (sound_worklet.js) and in node for the
// offline renders that are measured (tools/soundtest.mjs -> out/sound/*.wav). Nothing recorded, nothing copied.
// What is modelled, for up to NV buses at once (the nearest ones; sound.js picks them):
//   engine    a rear diesel of six cylinders behind a hybrid drive: firing tone with its half orders (the lope), combustion noise pulsing with the
//             firing, injector clatter at idle; revs follow speed and pull through four ratios; a 2-pole low-pass that opens with load
//   whine     the electric drive: a gliding tone that follows road speed, loud under pull or regeneration; the turbo's whistle under load
//   idle      the cooling fan and the engine's rumble standing at a stop
//   road      tyre hiss outside; inside (ins = 1) the low rumble of the floor, the engine muffled and close
//   air       the brake's sigh on stopping, the doors' air and their thunk, the kneeling beeper, and the stop-requested chime (two bell notes, ours)
// Parameters (k-rate, one set per voice): ON, GL, GR (gains after distance and pan), V (m/s), ACC (m/s2), INS (0..1 the listener is aboard),
// DIST (metres: far buses lose their highs), KNEEL (1 while the body is moving down or up: the beeper). Global: MASTER.
export const NV = 3, PV = 8, NP = NV * PV + 1;
export const I = { ON: 0, GL: 1, GR: 2, V: 3, ACC: 4, INS: 5, DIST: 6, KNEEL: 7, MASTER: NV * PV };
export const EV = { SIGH: 1, DOPEN: 2, DCLOSE: 3, DSHUT: 4, CHIME: 5 };
const TAU = Math.PI * 2, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DUR = [0, 1.4, 0.9, 0.7, 0.5, 1.9];
// the firing tone: [multiple of half the firing frequency, level, phase]. Half orders give a diesel its uneven beat.
const HARM = [[1, 0.42, 0.0], [2, 1.0, 0.4], [3, 0.36, 1.9], [4, 0.52, 0.7], [6, 0.26, 2.6], [8, 0.13, 0.3]];
const GEARS = [0, 4.2, 8.0, 12.5, 19];

class SVF {      // Chamberlin state-variable filter: bp/lp of noise; f = 2 sin(pi fc / sr), d = 1 / Q
  constructor() { this.l = 0; this.b = 0; this.f = 0.1; this.d = 1; }
  set(fc, q, sr) { this.f = 2 * Math.sin(Math.PI * clamp(fc, 20, sr * 0.15) / sr); this.d = 1 / q; }
  run(x) { this.l += this.f * this.b; const h = x - this.l - this.d * this.b; this.b += this.f * h; return this.b; }
}
class Voice {
  constructor(k) {
    this.k = k; this.ph = 0; this.wph = 0; this.kt = 0; this.kph = 0; this.rpm = 680; this.load = 0; this.v = 0; this.acc = 0; this.gL = 0; this.gR = 0; this.ins = 0; this.on = 0; this.kn = 0;
    this.e1 = 0; this.e2 = 0; this.c1 = 0; this.dl = 0; this.wob = 0; this.comb = new SVF(); this.turbo = new SVF(); this.fan = new SVF(); this.road = new SVF(); this.rumb = new SVF(); this.live = false;
  }
}
export class BusDSP {
  constructor(sr) {
    this.sr = sr; this.T = new Float32Array(NP); this.T[I.MASTER] = 1; this.master = 1; this.vo = []; for (let k = 0; k < NV; k++) this.vo.push(new Voice(k));
    this.shots = []; for (let k = 0; k < 8; k++) this.shots.push({ type: 0, t: 0, vo: 0, g: 1, f: new SVF(), lp: 0 });
    this.s1 = 0x2545f491; this.s2 = 0x9e3779b1; this.peak = 0;
  }
  // a one-shot: type (EV), which voice it belongs to (-1: the cabin, both ears alike), level 0..1
  event(type, vo = -1, g = 1) { let b = this.shots[0]; for (const s of this.shots) { if (!s.type) { b = s; break; } if (s.t > b.t) b = s; } b.type = type; b.t = 0; b.vo = vo; b.g = g; b.f.l = b.f.b = 0; b.lp = 0; }
  process(L, R, n) {
    const sr = this.sr, dt = 1 / sr, T = this.T, blk = n / sr; let s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
    const mT = T[I.MASTER], m0 = this.master, mS = (mT - m0) / n;
    for (const V of this.vo) {
      const b = V.k * PV, onT = T[b + I.ON] > 0.5 ? 1 : 0, gLT = onT * T[b + I.GL], gRT = onT * T[b + I.GR];
      if (!onT && V.gL < 1e-5 && V.gR < 1e-5) { V.live = false; V.gL = V.gR = 0; continue; }      // not heard: costs nothing
      if (!V.live) { V.live = true; V.v = T[b + I.V]; V.ins = T[b + I.INS]; V.rpm = 680; V.load = 0; V.e1 = V.e2 = V.c1 = V.dl = 0; }
      const v = Math.abs(T[b + I.V]), acc = T[b + I.ACC], insT = clamp(T[b + I.INS], 0, 1), dist = Math.max(0, T[b + I.DIST]);
      // revs: an automatic's four ratios; under pull the engine runs up each one, coasting it sits low, braking it falls to idle
      const pull = clamp(acc / 1.0, 0, 1), brk = clamp(-acc / 1.2, 0, 1); let gi = 1; while (gi < 4 && v > GEARS[gi]) gi++; const r = clamp((v - GEARS[gi - 1]) / (GEARS[gi] - GEARS[gi - 1]), 0, 1);
      let rpmT = v < 0.35 && pull < 0.08 ? 680 : 900 + r * 820 * (0.4 + 0.6 * pull) + 300 * pull - 140 * brk; if (v < 0.35 && pull >= 0.08) rpmT = 900 + 500 * pull;
      const a1 = 1 - Math.exp(-blk / 0.32), a2 = 1 - Math.exp(-blk / 0.16);
      const rpm0 = V.rpm, rpm1 = rpm0 + (rpmT - rpm0) * a1, load0 = V.load, load1 = load0 + (pull - load0) * a2, v0 = V.v, v1 = v0 + (v - v0) * a2, ins0 = V.ins, ins1 = ins0 + (insT - ins0) * a2;
      const acc1 = V.acc + (Math.abs(acc) - V.acc) * a2; V.acc = acc1;
      const gS = 1 - Math.exp(-blk / 0.05), gL0 = V.gL, gL1 = gL0 + (gLT - gL0) * gS, gR0 = V.gR, gR1 = gR0 + (gRT - gR0) * gS;
      const fFire = rpm1 / 60 * 3, stH = fFire * 0.5 * dt, idle = clamp((1000 - rpm1) / 320, 0, 1);
      const kE = 1 - Math.exp(-TAU * (150 + 620 * load1 + 0.12 * (rpm1 - 680)) * dt), kI = 1 - Math.exp(-TAU * (115 + 190 * load1) * dt), kD = 1 - Math.exp(-TAU * (11000 / (1 + dist / 22)) * dt);
      V.comb.set(300 + 0.16 * rpm1, 0.8, sr); V.turbo.set(2500 + 1.25 * rpm1, 14, sr); V.fan.set(620, 0.9, sr); V.road.set(900 + 28 * v1, 0.7, sr); V.rumb.set(95 + 5 * v1, 1.1, sr);
      const fW = 210 + 92 * v1, gW = clamp(v1 / 2.2, 0, 1) * (0.1 + 0.9 * clamp(acc1 / 1.1, 0, 1)) * 0.05, gTu = load1 * load1 * 0.5 * clamp((rpm1 - 900) / 500, 0, 1), rv = Math.pow(clamp(v1 / 13, 0, 1), 1.3);
      const eG = 0.5 + 0.5 * load1 + 0.1 * idle, kn = T[b + I.KNEEL] > 0.5; if (!kn) { V.kt = 0; }
      let ph = V.ph, wph = V.wph, e1 = V.e1, e2 = V.e2, c1 = V.c1, dl = V.dl, wob = V.wob, kt = V.kt, kph = V.kph;
      for (let i = 0; i < n; i++) {
        const u = i / n, gl = gL0 + (gL1 - gL0) * u, gr = gR0 + (gR1 - gR0) * u, ins = ins0 + (ins1 - ins0) * u;
        s1 ^= s1 << 13; s1 ^= s1 >>> 17; s1 ^= s1 << 5; const w1 = (s1 | 0) / 2147483648; s2 ^= s2 << 13; s2 ^= s2 >>> 17; s2 ^= s2 << 5; const w2 = (s2 | 0) / 2147483648;
        ph += stH; if (ph >= 1) ph -= 1; const a = TAU * ph;
        wob += (w2 - wob) * 0.0006;      // the engine never fires twice alike
        let tone = 0; for (let h = 0; h < 6; h++) { const H = HARM[h]; tone += H[1] * Math.sin(H[0] * a + H[2]); }
        const pu = Math.max(0, Math.sin(2 * a)), p2 = pu * pu, p4 = p2 * p2;
        const cb = V.comb.run(w1) * (0.25 + 0.75 * p4) * (0.45 + load1);
        const raw = (tone * 0.34 * (1 + 9 * wob) + cb * 2.2) * eG;
        e1 += (raw - e1) * kE; e2 += (e1 - e2) * kE;                                       // outside: opens with load
        c1 += (raw - c1) * kI;                                                             // inside: the rear engine through the floor
        const clat = (w1 - e1 * 0.0) * p4 * p4 * (0.035 + 0.05 * idle);
        wph += fW * dt; if (wph >= 1) wph -= 1; const wh = (Math.sin(TAU * wph) + 0.34 * Math.sin(2 * TAU * wph + 1.0) + 0.12 * Math.sin(3 * TAU * wph + 0.5)) * gW;
        const tu = V.turbo.run(w2) * gTu, fan = V.fan.run(w2) * 0.05, rd = V.road.run(w1) * rv * 0.17, rm = V.rumb.run(w2) * (0.25 + 0.75 * rv) * 0.5;
        let out = (e2 * 0.62 + clat + wh + tu + fan + rd) * 0.22; dl += (out - dl) * kD; out = dl;
        const inn = (c1 * 0.95 + wh * 0.8 + tu * 0.25 + fan * 0.3 + rm * rv + rd * 0.12) * 0.3;
        let x = out + (inn - out) * ins;
        if (kn) { kt += dt; kph += 1870 * dt; if (kph >= 1) kph -= 1; const c = kt % 0.46, g = c < 0.22 ? Math.min(1, c / 0.004, (0.22 - c) / 0.004) : 0; if (g > 0) { const sq = Math.sin(TAU * kph); x += (sq + 0.3 * Math.sin(3 * TAU * kph)) * 0.012 * g; } }
        L[i] += x * gl; R[i] += x * gr;
      }
      V.ph = ph; V.wph = wph; V.e1 = e1; V.e2 = e2; V.c1 = c1; V.dl = dl; V.wob = wob; V.kt = kt; V.kph = kph; V.rpm = rpm1; V.load = load1; V.v = v1; V.ins = ins1; V.gL = gL1; V.gR = gR1;
    }
    // the one-shots: air and doors (through their bus's gains), the chime (the cabin)
    for (const S of this.shots) {
      if (!S.type) continue; const ty = S.type, V = S.vo >= 0 ? this.vo[S.vo] : null, gl = (V ? V.gL : 1) * S.g, gr = (V ? V.gR : 1) * S.g, ins = V ? V.ins : 1, dur = DUR[ty]; let t = S.t;
      if (V && gl < 1e-5 && gr < 1e-5) { S.t += blk; if (S.t > dur) S.type = 0; continue; }
      const F = S.f;
      for (let i = 0; i < n && t < dur; i++, t += dt) {
        s1 ^= s1 << 13; s1 ^= s1 >>> 17; s1 ^= s1 << 5; const w = (s1 | 0) / 2147483648; let x = 0;
        if (ty === EV.SIGH) {            // the brake valve lets go: a rush that falls in pitch and dies away, a soft chuff at its start
          if ((i & 31) === 0) F.set(2300 + 2900 * Math.exp(-t / 0.22), 0.7, sr);
          x = F.run(w) * (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.27) * 0.34 + Math.sin(TAU * 130 * t) * Math.exp(-t / 0.03) * 0.05;
        } else if (ty === EV.DOPEN) {    // air into the door engine, the leaves unlatch
          if ((i & 31) === 0) F.set(3300 - 600 * t, 0.9, sr); const tk = t - 0.05;
          x = F.run(w) * (1 - Math.exp(-t / 0.02)) * Math.exp(-Math.max(0, t - 0.3) / 0.13) * 0.17 + (tk > 0 ? Math.sin(TAU * 150 * tk) * Math.exp(-tk / 0.035) * 0.12 + w * Math.exp(-tk / 0.004) * 0.07 : 0);
        } else if (ty === EV.DCLOSE) {   // air out
          if ((i & 31) === 0) F.set(2700 + 500 * t, 0.9, sr);
          x = F.run(w) * (1 - Math.exp(-t / 0.015)) * Math.exp(-Math.max(0, t - 0.2) / 0.1) * 0.15;
        } else if (ty === EV.DSHUT) {    // the leaves meet: a low thunk, the rubber edges a moment after
          S.lp += (w - S.lp) * 0.08; const t2 = t - 0.085;
          x = Math.sin(TAU * (96 - 60 * t) * t) * Math.exp(-t / 0.06) * 0.3 + S.lp * Math.exp(-t / 0.014) * 0.9 + (t2 > 0 ? Math.sin(TAU * 128 * t2) * Math.exp(-t2 / 0.03) * 0.11 : 0);
        } else if (ty === EV.CHIME) {    // stop requested: two bell notes, a falling fourth, close together (ours)
          for (let q = 0; q < 2; q++) { const tq = t - q * 0.2; if (tq < 0) continue; const f = q ? 1480 : 1975.5, at = 1 - Math.exp(-tq / 0.002);
            x += at * (Math.sin(TAU * f * tq) * Math.exp(-tq / 0.42) * 0.1 + Math.sin(TAU * f * 2.0 * tq) * Math.exp(-tq / 0.16) * 0.028 + Math.sin(TAU * f * 3.01 * tq) * Math.exp(-tq / 0.07) * 0.014 + Math.sin(TAU * f * 0.5 * tq) * Math.exp(-tq / 0.5) * 0.012); }
        }
        if (ty !== EV.CHIME) x *= 0.4 * (1 - 0.35 * ins);      // from a seat the air is behind panels
        L[i] += x * gl; R[i] += x * gr;
      }
      S.t = t; if (t >= dur) S.type = 0;
    }
    // master, and a soft ceiling so nothing we make can clip whatever is asked of it
    let pk = this.peak;
    for (let i = 0; i < n; i++) { const m = m0 + mS * i; let l = L[i] * m, r = R[i] * m; const al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > 0.6) l = (l < 0 ? -1 : 1) * (0.6 + 0.3 * Math.tanh((al - 0.6) / 0.3)); if (ar > 0.6) r = (r < 0 ? -1 : 1) * (0.6 + 0.3 * Math.tanh((ar - 0.6) / 0.3)); L[i] = l; R[i] = r; if (al > pk) pk = al; }
    this.master = mT; this.peak = pk; this.s1 = s1; this.s2 = s2;
  }
}
