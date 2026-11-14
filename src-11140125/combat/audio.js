// combat/audio.js: gun audio for the gameplay lane. No imports from the rest of the game.
// Every sound is rendered ONCE into an AudioBuffer by the DSP code below (layered synthesis: transient crack + muzzle blast + body +
// low thump + mechanical action, per weapon, several variants each), then played as a single BufferSource per event through:
//   voice (rate/gain jitter, distance low-pass, pan, delay)  ->  gun bus (soft-knee limiter) -> game.sound.out
//                                                           \->  ONE shared ConvolverNode (generated street-canyon impulse response:
//                                                                facade slapbacks + diffuse tail) -> gun bus
// No per-frame work. Voices are capped (oldest dropped with a short fade); tails live in the convolver, so they are never cut.
// The DSP is plain Float32Array maths (exported as _dsp) so it can also be rendered and measured outside a browser.

const SR = 48000, TAU = Math.PI * 2;
const NV = 8;            // variants per gunshot
const MAXV = 44;         // voices

// ---------- small DSP kit ----------
function mkrng(seed) { let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
const N = (secs) => Math.max(1, Math.ceil(secs * SR));
function noise(n, r) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; }
function biquad(x, type, f, q = 0.707, db = 0) {
  f = Math.min(Math.max(f, 10), SR * 0.45);
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), A = Math.pow(10, db / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'pk') { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else { const sq = 2 * Math.sqrt(A) * al, lo = type === 'ls' ? 1 : -1;      // shelves
    b0 = A * ((A + 1) - lo * (A - 1) * c + sq); b1 = lo * 2 * A * ((A - 1) - lo * (A + 1) * c); b2 = A * ((A + 1) - lo * (A - 1) * c - sq);
    a0 = (A + 1) + lo * (A - 1) * c + sq; a1 = -lo * 2 * ((A - 1) + lo * (A + 1) * c); a2 = (A + 1) + lo * (A - 1) * c - sq; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
// exponential decay from t0 (seconds), optional linear attack
function decay(x, tau, attack = 0) { const k = Math.exp(-1 / (tau * SR)), an = attack * SR; let e = 1; for (let i = 0; i < x.length; i++) { x[i] *= i < an ? e * (i / an) : e; e *= k; } return x; }
// two-pole low-pass whose cut-off glides from f0 to f1 (time constant tau): highs die first, like air and distance
function glideLP(x, f0, f1, tau) { let y1 = 0, y2 = 0; const k = Math.exp(-1 / (tau * SR)); let m = 1; for (let i = 0; i < x.length; i++) { const f = f1 + (f0 - f1) * m; m *= k; const a = 1 - Math.exp(-TAU * f / SR); y1 += a * (x[i] - y1); y2 += a * (y1 - y2); x[i] = y2; } return x; }
function add(dst, src, t0 = 0, g = 1) { const o = Math.round(t0 * SR), n = Math.min(src.length, dst.length - o); for (let i = Math.max(0, -o); i < n; i++) dst[o + i] += src[i] * g; return dst; }
function scale(x, g) { for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
function sat(x, drive) { const k = 1 / Math.tanh(drive); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) * k; return x; }
function peak(...xs) { let p = 0; for (const x of xs) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; }
function norm(xs, to = 0.97) { const p = peak(...xs) || 1; for (const x of xs) scale(x, to / p); return xs; }
function fadeOut(x, secs) { const n = Math.min(x.length, N(secs)); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; }
// damped sine partials starting at t0: [{f, tau, a}]
function modal(x, t0, parts, r) {
  const o = Math.round(t0 * SR);
  for (const p of parts) { const n = Math.min(x.length - o, N(p.tau * 7)), w = TAU * p.f / SR, k = Math.exp(-1 / (p.tau * SR)), ph = r ? r() * TAU : 0; let e = p.a;
    for (let i = 0; i < n; i++) { x[o + i] += e * Math.sin(w * i + ph) * (i < 12 ? i / 12 : 1); e *= k; } }
  return x;
}
// sine whose pitch glides f0 -> f1
function sweep(x, t0, f0, f1, tauF, tauA, amp, attack = 0.0005) {
  const o = Math.round(t0 * SR), n = Math.min(x.length - o, N(tauA * 7)), kf = Math.exp(-1 / (tauF * SR)), ka = Math.exp(-1 / (tauA * SR)), an = attack * SR; let m = 1, e = amp, ph = 0;
  for (let i = 0; i < n; i++) { ph += TAU * (f1 + (f0 - f1) * m) / SR; m *= kf; x[o + i] += e * Math.sin(ph) * (i < an ? i / an : 1); e *= ka; }
  return x;
}
// a filtered noise burst: the building block of cracks, blasts and ticks
function burst(r, secs, tau, type, f, q, attack = 0) { const b = noise(N(secs), r); if (type) biquad(b, type, f, q); return decay(b, tau, attack); }
// sparse random clicks through a resonant filter: debris, shards, crackle
function grains(r, secs, count, f, q, shape = 2) { const n = N(secs), x = new Float32Array(n); for (let k = 0; k < count; k++) { const u = Math.pow(r(), shape), i = Math.min(n - 1, Math.floor(u * n)); x[i] += (r() * 2 - 1) * (1 - u * 0.85); } return biquad(x, 'bp', f, q); }
// hand-on-metal slide noise
function scrape(r, secs, f, q = 1.2) { const b = biquad(noise(N(secs), r), 'bp', f, q), m = biquad(noise(b.length, r), 'lp', 180, 0.7); for (let i = 0; i < b.length; i++) { const u = i / b.length; b[i] *= Math.sin(Math.PI * u) * (0.55 + 6 * Math.abs(m[i])); } return b; }
// a mechanical clack: inharmonic metal partials + a tick + an optional low thud
function clack(x, t0, r, o) {
  const k = o.pitch || 1, parts = o.fs.map((f, i) => ({ f: f * k * (1 + (r() - 0.5) * 0.06), tau: (o.tau || 0.012) * (1 - i * 0.1) * (0.8 + r() * 0.4), a: (o.amp || 0.4) * (1 - i * 0.12) * (0.7 + r() * 0.6) / o.fs.length * 2.2 }));
  modal(x, t0, parts, r);
  add(x, burst(r, 0.03, o.tickTau || 0.0025, 'hp', o.tickHP || 2500, 0.7), t0, (o.tick == null ? 0.5 : o.tick) * (o.amp || 0.4));
  if (o.thud) sweep(x, t0, 240 * k, 120 * k, 0.01, 0.018, o.thud * (o.amp || 0.4));
  return x;
}
function stereo(secs) { const n = N(secs); return [new Float32Array(n), new Float32Array(n)]; }
function both(lr, fn) { fn(lr[0]); fn(lr[1]); return lr; }
function mid(lr, x, t0 = 0, g = 1, pan = 0) { add(lr[0], x, t0, g * Math.min(1, 1 - pan)); add(lr[1], x, t0, g * Math.min(1, 1 + pan)); }

// ---------- gunshots ----------
// crHP/crTau: crack (high-passed noise);  T: muzzle pressure pulse length;  body: band-passed blast;  th: low thump sweep;
// air: the short self-tail baked into the shot;  mech: action cycling after the shot;  drive: saturation;  gain: play level
const GUNS = {
  pistol:  { len: 0.60, crHP: 1700, crTau: 0.0036, crA: 1.00, T: 0.00030, pA: 0.9, bF: 560, bTau: 0.030, bA: 1.0, thF0: 135, thF1: 50, thTauF: 0.018, thTau: 0.030, thA: 0.95, airLP: 3000, airTau: 0.120, airA: 0.22, drive: 2.6, gain: 0.82, tail: 0.95,
             w: { cr: 0.5, punch: 0.9, body: 4, side: 2, chest: 2, th: 2.0, air: 7 }, eq: [['pk', 520, 0.6, 7], ['pk', 170, 1.0, -5], ['ls', 70, 0.7, 3], ['hs', 6000, 0.7, -2]],
             mech: [{ t: 0.030, fs: [2300, 3700, 5200, 7100], tau: 0.009, amp: 0.16 }, { t: 0.058, fs: [1500, 2900, 4300, 6400], tau: 0.011, amp: 0.20, thud: 0.4 }] },
  smg:     { len: 0.50, crHP: 2000, crTau: 0.0030, crA: 1.00, T: 0.00026, pA: 0.8, bF: 680, bTau: 0.024, bA: 0.9, thF0: 150, thF1: 58, thTauF: 0.015, thTau: 0.024, thA: 0.80, airLP: 3400, airTau: 0.085, airA: 0.20, drive: 2.4, gain: 0.72, tail: 0.55,
             w: { cr: 0.6, punch: 1.1, body: 4, side: 2, chest: 1.8, th: 1.7, air: 6 }, eq: [['pk', 600, 0.6, 6], ['pk', 180, 1.0, -4], ['ls', 75, 0.7, 2], ['pk', 3000, 1.0, 2]],
             mech: [{ t: 0.020, fs: [1900, 3300, 4700, 6800], tau: 0.008, amp: 0.20 }, { t: 0.043, fs: [1300, 2600, 4100, 5900], tau: 0.010, amp: 0.24, thud: 0.5 }] },
  shotgun: { len: 0.95, crHP: 900,  crTau: 0.0065, crA: 0.85, T: 0.00075, pA: 1.1, bF: 400, bTau: 0.075, bA: 1.2, thF0: 85,  thF1: 30, thTauF: 0.045, thTau: 0.075, thA: 1.20, airLP: 2400, airTau: 0.240, airA: 0.30, drive: 3.2, gain: 1.00, tail: 1.25,
             w: { cr: 0.5, punch: 0.9, body: 4, side: 2, chest: 2.4, th: 2.2, air: 7 }, eq: [['pk', 420, 0.6, 6], ['pk', 150, 1.0, -4], ['ls', 70, 0.7, 4], ['hs', 6000, 0.7, -3]],
             mech: [] },
  rifle:   { len: 0.70, crHP: 2400, crTau: 0.0028, crA: 1.15, T: 0.00034, pA: 1.0, bF: 520, bTau: 0.042, bA: 1.0, thF0: 100, thF1: 37, thTauF: 0.030, thTau: 0.042, thA: 1.05, airLP: 3000, airTau: 0.160, airA: 0.26, drive: 2.9, gain: 0.90, tail: 0.85,
             w: { cr: 0.7, punch: 1.2, body: 4, side: 2, chest: 2.2, th: 2.0, air: 7 }, eq: [['pk', 480, 0.6, 6], ['pk', 165, 1.0, -4], ['ls', 70, 0.7, 3], ['pk', 3200, 1.0, 2.5]],
             mech: [{ t: 0.026, fs: [1700, 3000, 4600, 6600], tau: 0.010, amp: 0.18 }, { t: 0.060, fs: [1100, 2300, 3700, 5600], tau: 0.012, amp: 0.20, thud: 0.5 }], spring: { f: 610, tau: 0.045, a: 0.04 } },
};
// Real recordings (CC0 Free Firearm Sound Library, see assets/combat/SOURCES.md), when preload() has fetched them: name -> [L, R].
// With them a shot is the real close-mic take (the crack and the action are the gun's own) made "hot" the way game audio is
// (saturated, narrowed), with the synthesized chest, thump and air under it. Without them the shot is fully synthesized.
let SMP = null;
function takes(kind, mic) { let n = 0; while (SMP && SMP.has(`${kind}.${mic}.${n}`)) n++; return n; }
function synthLow(lr, p, r, j, w) {
  const [L, R] = lr, bTau = j(p.bTau, 0.15), bF = j(p.bF, 0.1);
  const cM = burst(r, p.len, bTau * 1.3, 'bp', bF * 0.36, 0.6), cL = burst(r, p.len, bTau * 1.3, 'bp', bF * 0.33, 0.6), cR = burst(r, p.len, bTau * 1.3, 'bp', bF * 0.39, 0.6);
  mid(lr, cM, 0, p.bA * w.chest * 0.7); add(L, cL, 0, p.bA * w.chest * 0.4); add(R, cR, 0, p.bA * w.chest * 0.4);
  const th = new Float32Array(L.length); sweep(th, 0, j(p.thF0, 0.08), j(p.thF1, 0.08), p.thTauF, j(p.thTau, 0.12), 1, 0.0008); mid(lr, th, 0, j(p.thA, 0.08) * w.th);
  if (w.boom) mid(lr, burst(r, p.len, j(p.boomTau || 0.07, 0.15), 'bp', j(p.boomF || 150, 0.12), 0.9, 0.003), 0, w.boom);      // 100-200 Hz weight for ~100 ms, noise so it never rings at one pitch
  const aL = glideLP(decay(noise(L.length, r), j(p.airTau, 0.15), 0.004), p.airLP * 2, p.airLP * 0.25, p.airTau), aR = glideLP(decay(noise(L.length, r), j(p.airTau, 0.15), 0.004), p.airLP * 2, p.airLP * 0.25, p.airTau);
  const aM = glideLP(decay(noise(L.length, r), j(p.airTau, 0.15), 0.004), p.airLP * 2, p.airLP * 0.25, p.airTau);
  mid(lr, aM, 0, p.airA * w.air * 0.8); add(L, aL, 0, p.airA * w.air * 0.45); add(R, aR, 0, p.airA * w.air * 0.45);
}
// the first instants of a shot are dead centre; width only opens after them
function monoHead(lr, secs) { const [L, R] = lr, n = Math.min(L.length, N(secs)); for (let i = 0; i < n; i++) { const k = 0.15 + 0.85 * (i / n), m = (L[i] + R[i]) * 0.5, sd = (L[i] - R[i]) * 0.5 * k; L[i] = m + sd; R[i] = m - sd; } return lr; }
function narrow(lr, side) { const [L, R] = lr; for (let i = 0; i < L.length; i++) { const m = (L[i] + R[i]) * 0.5, sd = (L[i] - R[i]) * 0.5 * side; L[i] = m + sd; R[i] = m - sd; } return lr; }
function bakeShotReal(kind, v, nt) {
  const p = GUNS[kind], r = mkrng(hash(kind) + v * 977), j = (a, pct) => a * (1 + (r() * 2 - 1) * pct);
  const w = Object.assign({ smp: 1, sdrive: 6, side: 0.5, chest: 1.0, th: 1.2, boom: 2.6, air: 4.2, drive: 3.6 }, p.sw, _dsp.tune);
  const src = SMP.get(`${kind}.near.${v % nt}`), lr = stereo(Math.max(p.len, src[0].length / SR + 0.02)), [L, R] = lr;
  L.set(src[0]); R.set(src[1]); narrow(lr, w.side); norm(lr, 1); both(lr, (x) => sat(x, w.sdrive)); both(lr, (x) => scale(x, w.smp));
  synthLow(lr, p, r, j, w);
  norm(lr, 1); both(lr, (x) => sat(x, w.drive));
  for (const e of p.seq || []) both(lr, (x) => biquad(x, e[0], e[1], e[2], e[3]));
  const tHi = (r() * 2 - 1) * 1.5, tLo = (r() * 2 - 1) * 1.5; both(lr, (x) => { biquad(x, 'hs', 3000, 0.7, tHi); biquad(x, 'ls', 160, 0.7, tLo); });      // no two takes are voiced alike
  both(lr, (x) => { biquad(x, 'hp', 32, 0.7); fadeOut(x, 0.03); });
  monoHead(lr, 0.05);
  return norm(lr, 0.97);
}
// the same gun from down the block: the real mid-distance take (it carries its own ground and tree-line echoes) with a soft boom under it
function bakeFar(kind, v) {
  const nt = takes(kind, 'far'); if (!nt) return bakeShot(kind, v);
  const p = GUNS[kind], r = mkrng(hash(kind) + v * 331), src = SMP.get(`${kind}.far.${v % nt}`), lr = stereo(src[0].length / SR + 0.05), [L, R] = lr;
  L.set(src[0]); R.set(src[1]); narrow(lr, 0.6); norm(lr, 1); both(lr, (x) => sat(x, 2.2));
  const th = new Float32Array(L.length); sweep(th, 0.004, p.thF0 * 0.8, p.thF1, p.thTauF * 1.5, p.thTau * 1.6, 1, 0.004); mid(lr, th, 0, 0.35);
  both(lr, (x) => { biquad(x, 'hp', 40, 0.7); fadeOut(x, 0.05); });
  return norm(lr, 0.97);
}
function bakeShot(kind, v) {
  const nt = takes(kind, 'near'); if (nt) return bakeShotReal(kind, v, nt);
  const p = GUNS[kind], r = mkrng(hash(kind) + v * 977), j = (a, pct) => a * (1 + (r() * 2 - 1) * pct);
  const lr = stereo(p.len), [L, R] = lr;
  const w = Object.assign({ cr: 1, pu: 1, punch: 2, body: 2.2, side: 1.3, chest: 2.6, th: 0.42, air: 2.2 }, p.w, _dsp.tune);    // layer weights before the saturator
  // 1. crack: a few ms of high-passed noise, hard onset
  mid(lr, burst(r, 0.06, j(p.crTau, 0.2), 'hp', j(p.crHP, 0.12), 0.7), 0, j(p.crA, 0.1) * w.cr);
  // 2. muzzle pressure pulse (Friedlander: sharp rise, decay, shallow negative phase)
  const T = j(p.T, 0.15), pn = N(T * 8), pulse = new Float32Array(pn); for (let i = 0; i < pn; i++) { const u = i / SR / T; pulse[i] = (1 - u) * Math.exp(-u); }
  mid(lr, pulse, 0, j(p.pA, 0.1) * w.pu);
  // 3. body of the blast: three bands of noise (punch, body, chest), partly different in each ear (width)
  const bTau = j(p.bTau, 0.15), bF = j(p.bF, 0.1);
  mid(lr, burst(r, 0.2, bTau * 0.4, 'bp', j(p.pF || 2000, 0.1), 0.5), 0, p.bA * w.punch);
  const bM = burst(r, p.len, bTau, 'bp', bF, 0.45), bL = burst(r, p.len, bTau, 'bp', bF * 1.07, 0.45), bR = burst(r, p.len, bTau, 'bp', bF * 0.94, 0.45);
  mid(lr, bM, 0, p.bA * w.body); add(L, bL, 0, p.bA * w.side); add(R, bR, 0, p.bA * w.side);
  const cM = burst(r, p.len, bTau * 1.3, 'bp', bF * 0.36, 0.6), cL = burst(r, p.len, bTau * 1.3, 'bp', bF * 0.33, 0.6), cR = burst(r, p.len, bTau * 1.3, 'bp', bF * 0.39, 0.6);
  mid(lr, cM, 0, p.bA * w.chest * 0.7); add(L, cL, 0, p.bA * w.chest * 0.4); add(R, cR, 0, p.bA * w.chest * 0.4);
  // 4. low thump: a falling sine
  const th = new Float32Array(L.length); sweep(th, 0, j(p.thF0, 0.08), j(p.thF1, 0.08), p.thTauF, j(p.thTau, 0.12), 1, 0.0008); mid(lr, th, 0, j(p.thA, 0.08) * w.th);
  // 5. air: the blast spreading, highs dying first
  const aL = glideLP(decay(noise(L.length, r), j(p.airTau, 0.15), 0.004), p.airLP * 2, p.airLP * 0.25, p.airTau), aR = glideLP(decay(noise(L.length, r), j(p.airTau, 0.15), 0.004), p.airLP * 2, p.airLP * 0.25, p.airTau);
  add(L, aL, 0, p.airA * w.air); add(R, aR, 0, p.airA * w.air);
  // glue: saturate (the "recorded hot" sound), shape, level
  norm(lr, 1); both(lr, (x) => sat(x, p.drive));
  for (const e of p.eq) both(lr, (x) => biquad(x, e[0], e[1], e[2], e[3]));
  both(lr, (x) => biquad(x, 'hp', 32, 0.7));
  norm(lr, 0.92);
  // 6. the action cycling, kept clean on top
  const m = new Float32Array(L.length);
  for (const c of p.mech) clack(m, j(c.t, 0.08), r, { fs: c.fs, tau: c.tau, amp: j(c.amp, 0.25), thud: c.thud, pitch: j(1, 0.04) });
  if (p.spring) modal(m, 0.03, [{ f: j(p.spring.f, 0.03), tau: p.spring.tau, a: p.spring.a }, { f: j(p.spring.f * 2.76, 0.03), tau: p.spring.tau * 0.6, a: p.spring.a * 0.5 }], r);
  mid(lr, m, 0, 1, (r() - 0.5) * 0.2);
  both(lr, (x) => fadeOut(x, 0.03));
  return norm(lr, 0.97);
}

// ---------- the street: impulse response of a Manhattan canyon ----------
function bakeIR() {
  const r = mkrng(4242), len = 2.4, lr = stereo(len);
  // The shared convolver carries only the diffuse bed of the canyon: it swells in after the first slaps, is wide (each ear its own noise)
  // and darkens as it dies (8 kHz down to ~1 kHz). The discrete slaps off facades are NOT here: they are rendered per weapon in several
  // street patterns (bakeSlap) and picked per burst, so no two shots carry the same echo pattern.
  for (const ch of lr) { const bed = glideLP(decay(noise(ch.length, r), 0.30, 0.16), 8000, 1000, 0.40); biquad(bed, 'hp', 120, 0.7); add(ch, bed, 0.06, 1); fadeOut(ch, 0.3); }
  for (const t of [0.052, 0.083]) mid(lr, burst(r, 0.05, 0.004, 'lp', 5000, 0.6), t, 9, t < 0.06 ? -0.5 : 0.5);      // the nearest wall and the ground, common to every spot
  // energy-normalise so a send of 1.0 returns the shot's energy spread over the tail
  let e = 0; for (const ch of lr) for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i];
  const g = 1 / Math.sqrt(e / 2); both(lr, (x) => scale(x, g));
  return lr;
}
// Slapback echoes of one weapon in one of NP street patterns: six delayed copies of the shot itself, each darker and quieter than the
// last, thrown to alternating sides. Delays and levels are drawn per pattern (a different spot on the block each time).
const NP = 5;
function bakeSlap(kind, pat, get) {
  const r = mkrng(hash('slap' + kind) + pat * 7919), src = (get || bake)(`shot:${kind}:${pat % NV}`), n0 = Math.min(src[0].length, N(0.16)), lr = stereo(1.4);
  const m = new Float32Array(n0); for (let i = 0; i < n0; i++) m[i] = (src[0][i] + src[1][i]) * 0.5 * (i > n0 - 2400 ? (n0 - i) / 2400 : 1);
  const win = [[0.055, 0.095, -7, 7500], [0.110, 0.170, -10, 6000], [0.220, 0.330, -13, 4600], [0.370, 0.520, -17, 3600], [0.580, 0.790, -20, 2800], [0.840, 1.050, -24, 2200]];
  let side = r() < 0.5 ? 1 : -1;
  for (const [t0, t1, db, lp] of win) { if (r() < 0.12) continue; const c = Float32Array.from(m); biquad(c, 'lp', lp * (0.8 + r() * 0.4), 0.6); biquad(c, 'hp', 140 + r() * 80, 0.7);
    mid(lr, c, t0 + r() * (t1 - t0), Math.pow(10, (db + (r() * 5 - 2.5)) / 20), side * (0.45 + r() * 0.5)); side = -side; }
  return both(lr, (x) => fadeOut(x, 0.1));
}

// ---------- foley ----------
const KP = { pistol: 1.18, smg: 1.0, rifle: 0.86, shotgun: 0.8 };   // smaller guns click higher
// real foley takes (same sprite as the guns) where there is one for this stage; a weapon without its own take borrows a neighbour's
const BORROW = { smg: ['smg', 'rifle', 'pistol'], pistol: ['pistol', 'smg'], rifle: ['rifle', 'smg'], shotgun: ['shotgun', 'rifle'], x: ['x'] };
function foleyTake(name, kind, v) {
  for (const k of BORROW[kind] || [kind]) { const n = takes(`foley.${name}`, k); if (n) return SMP.get(`foley.${name}.${k}.${v % n}`); }
  return null;
}
function bakeFoley(name, kind, v = 0) {
  const t = SMP && foleyTake(name, kind, v);
  if (t) { const lr = [Float32Array.from(t[0]), Float32Array.from(t[1])]; both(lr, (y) => { biquad(y, 'hp', 90, 0.7); sat(y, 1.4); fadeOut(y, 0.02); }); return norm(lr, 0.9); }
  const r = mkrng(hash(name + kind) + v * 131), k = KP[kind] || 1, lr = stereo(name === 'pump' || name === 'rack' ? 0.5 : name === 'draw' || name === 'holster' ? 0.42 : 0.36), x = new Float32Array(lr[0].length);
  if (name === 'dry') { clack(x, 0, r, { fs: [3100, 4800, 7300, 9800], tau: 0.005, amp: 0.5, tick: 0.8, tickHP: 3500 }); clack(x, 0.011, r, { fs: [2100, 3900], tau: 0.006, amp: 0.18 }); }
  else if (name === 'out') { clack(x, 0, r, { fs: [3400, 5600, 8100], tau: 0.004, amp: 0.3, pitch: k }); add(x, scrape(r, 0.11, 2600 * k), 0.03, 0.16); clack(x, 0.145, r, { fs: [900, 1750, 2650, 4100], tau: 0.016, amp: 0.34, pitch: k, tick: 0.3 }); }
  else if (name === 'in') { add(x, scrape(r, 0.07, 2200 * k), 0, 0.14); clack(x, 0.075, r, { fs: [720, 1500, 2900, 4300, 6200], tau: 0.015, amp: 0.55, pitch: k, thud: 0.7 }); clack(x, 0.098, r, { fs: [3600, 6100], tau: 0.004, amp: 0.2, pitch: k }); }
  else if (name === 'rack') { const long = kind === 'rifle' || kind === 'smg', t1 = long ? 0.10 : 0.065, t2 = long ? 0.25 : 0.165;
    add(x, scrape(r, t1, 3000 * k), 0, 0.2); clack(x, t1, r, { fs: [1500, 2700, 4400, 6500], tau: 0.010, amp: 0.4, pitch: k });
    add(x, scrape(r, t2 - t1 - 0.02, 3600 * k), t1 + 0.015, 0.14); clack(x, t2, r, { fs: [1150, 2350, 3900, 6100, 8300], tau: 0.014, amp: 0.62, pitch: k, thud: 0.8 });
    if (long) modal(x, t2, [{ f: 540, tau: 0.06, a: 0.05 }, { f: 1490, tau: 0.04, a: 0.03 }], r); }
  else if (name === 'shell') { add(x, burst(r, 0.05, 0.008, 'lp', 2200, 0.7), 0, 0.35); modal(x, 0, [{ f: 610, tau: 0.012, a: 0.2 }, { f: 1130, tau: 0.009, a: 0.12 }], r); add(x, scrape(r, 0.06, 1900), 0.02, 0.15); clack(x, 0.088, r, { fs: [1900, 3300, 5200], tau: 0.007, amp: 0.34, thud: 0.4 }); }
  else if (name === 'pump') { add(x, scrape(r, 0.075, 2100), 0, 0.26); clack(x, 0.078, r, { fs: [820, 1700, 2900, 4100, 6000], tau: 0.014, amp: 0.6, thud: 0.9 });
    add(x, scrape(r, 0.07, 2500), 0.175, 0.24); clack(x, 0.245, r, { fs: [700, 1450, 2600, 3800, 5600, 7900], tau: 0.016, amp: 0.72, thud: 1.0 }); }
  else if (name === 'draw') { add(x, biquad(scrape(r, 0.2, 2400, 0.6), 'hp', 700, 0.7), 0, 0.2); clack(x, 0.17, r, { fs: [1300, 2500, 4200], tau: 0.008, amp: 0.26, pitch: k, thud: 0.5 }); clack(x, 0.205, r, { fs: [2900, 5100], tau: 0.005, amp: 0.1, pitch: k }); }
  else if (name === 'holster') { add(x, biquad(scrape(r, 0.24, 1700, 0.6), 'hp', 500, 0.7), 0, 0.22); sweep(x, 0.2, 170, 90, 0.02, 0.03, 0.22); add(x, burst(r, 0.05, 0.012, 'lp', 1400, 0.7), 0.2, 0.2); }
  biquad(x, 'hp', 90, 0.7); mid(lr, x);
  // a touch of room so it is not a dry click in the head
  for (let c = 0; c < 2; c++) { const w = new Float32Array(x.length); for (let i = 0; i < 6; i++) add(w, x, 0.006 + r() * 0.03, 0.09 * (r() < 0.5 ? -1 : 1)); add(lr[c], w); }
  both(lr, (y) => fadeOut(y, 0.02));
  return lr;
}
function bakeCasing(kind, surface, v) {
  const r = mkrng(hash('casing' + kind + surface) + v * 71), hull = kind === 'shotgun', lr = stereo(hull ? 0.7 : 0.85), x = new Float32Array(lr[0].length);
  const soft = surface === 'asphalt' ? 0.75 : surface === 'wood' ? 0.6 : surface === 'metal' ? 1.3 : 1;      // how long the ring survives the ground
  const base = hull ? 0 : kind === 'pistol' ? 5100 : kind === 'smg' ? 4800 : 3300;                              // small cases ring higher
  let t = 0, a = 1, gap = 0.10 + r() * 0.05; const nb = hull ? 4 : 7 + Math.floor(r() * 3);
  for (let b = 0; b < nb; b++) {
    if (hull) { add(x, burst(r, 0.04, 0.006, 'lp', 2600, 0.7), t, a * 0.5); modal(x, t, [{ f: 880 * (1 + r() * 0.2), tau: 0.008, a: a * 0.3 }, { f: 1500 * (1 + r() * 0.2), tau: 0.006, a: a * 0.2 }, { f: 3600 * (1 + r() * 0.1), tau: 0.012 * soft, a: a * 0.12 * (r() < 0.5 ? 1 : 0.2) }], r); }
    else { const f = base * (1 + (r() - 0.5) * 0.16);      // each landing rings a little differently (which end hit, how it was spinning)
      modal(x, t, [{ f, tau: 0.014 * soft * (0.6 + r()), a: a * 0.22 * (0.2 + r()) }, { f: f * (1.5 + r() * 0.2), tau: 0.011 * soft * (0.6 + r()), a: a * 0.20 * (0.2 + r()) }, { f: f * (2.1 + r() * 0.3), tau: 0.008 * soft, a: a * 0.16 * (0.2 + r()) }, { f: f * (2.8 + r() * 0.4), tau: 0.006 * soft, a: a * 0.10 * (0.2 + r()) }], r);
      add(x, burst(r, 0.02, 0.0012 + r() * 0.001, 'hp', 2500, 0.7), t, a * 0.6);
      if (surface === 'wood') sweep(x, t, 300, 200, 0.01, 0.015, a * 0.2); }
    t += gap; gap *= 0.62 + r() * 0.12; a *= 0.6 + r() * 0.12; if (gap < 0.012) { gap = 0.012; a *= 0.8; }
  }
  biquad(x, 'hp', hull ? 200 : 1200, 0.7); if (surface === 'asphalt') biquad(x, 'hs', 6000, 0.7, -4);
  mid(lr, x); return both(lr, (y) => fadeOut(y, 0.03));
}

// ---------- impacts ----------
function bakeImpact(mat, v) {
  const r = mkrng(hash('impact' + mat) + v * 53), lr = stereo(mat === 'metal' ? 0.8 : mat === 'tyre' ? 0.6 : 0.5), x = new Float32Array(lr[0].length), [L, R] = lr;
  const deb = (count, f, q, secs, g) => { add(L, grains(r, secs, count, f, q), 0.008, g); add(R, grains(r, secs, count, f * 1.1, q), 0.008, g); };
  if (mat === 'concrete' || mat === 'asphalt') { const c = mat === 'concrete';
    add(x, burst(r, 0.05, 0.004, 'hp', c ? 1400 : 900, 0.7), 0, 0.9); add(x, burst(r, 0.2, c ? 0.022 : 0.03, 'bp', c ? 780 : 460, 0.8), 0, 1.2); sweep(x, 0, 210, 90, 0.012, 0.03, 0.5);
    deb(c ? 26 : 14, c ? 3600 : 2300, 2.5, 0.3, c ? 1.1 : 0.8); deb(c ? 10 : 8, c ? 1500 : 1000, 3, 0.22, 0.8);
    const dust = glideLP(decay(noise(x.length, r), 0.09, 0.01), 7000, 900, 0.08); add(x, dust, 0, c ? 0.12 : 0.08); }
  else if (mat === 'metal') { add(x, burst(r, 0.03, 0.002, 'hp', 2500, 0.7), 0, 1.0);
    const f0 = 380 + r() * 260, parts = []; for (let i = 0; i < 9; i++) parts.push({ f: f0 * (1 + i * (1.37 + r() * 0.5)), tau: (0.16 - i * 0.012) * (0.6 + r() * 0.7), a: 0.24 * (0.4 + r()) / (1 + i * 0.25) });
    modal(x, 0, parts, r); sweep(x, 0, 320, 150, 0.01, 0.025, 0.5);
    if (v % 3 === 1) { const o = N(0.012), n = N(0.38), f1 = 3200 + r() * 1500; let ph = 0; for (let i = 0; i < n; i++) { const u = i / n, f = f1 * (1 - 0.6 * u) * (1 + 0.02 * Math.sin(TAU * 38 * i / SR)); ph += TAU * f / SR; const e = Math.pow(1 - u, 2) * Math.min(1, i / 200); L[o + i] += 0.13 * e * Math.sin(ph) * (1 - u * 0.7); R[o + i] += 0.13 * e * Math.sin(ph) * (0.3 + u * 0.7); } } }
  else if (mat === 'glass') { add(x, burst(r, 0.03, 0.002, 'hp', 4000, 0.7), 0, 1.0); const parts = []; for (let i = 0; i < 6; i++) parts.push({ f: 2600 + r() * 8500, tau: 0.012 + r() * 0.03, a: 0.2 * (0.4 + r()) }); modal(x, 0, parts, r);
    add(x, burst(r, 0.06, 0.01, 'bp', 1300, 1), 0, 0.5); deb(18, 6500, 6, 0.35, 0.9); deb(10, 9500, 8, 0.4, 0.6); }
  else if (mat === 'flesh') { add(x, burst(r, 0.12, 0.018, 'lp', 950, 0.7), 0, 1.3); sweep(x, 0, 150, 70, 0.015, 0.04, 0.8);
    const w = burst(r, 0.12, 0.028, 'bp', 1700 + r() * 500, 2.2, 0.004), m = biquad(noise(w.length, r), 'lp', 90, 0.7); for (let i = 0; i < w.length; i++) w[i] *= 0.4 + 10 * Math.abs(m[i]); add(x, w, 0.004, 0.45);
    add(x, burst(r, 0.02, 0.002, 'bp', 3200, 1), 0, 0.25); }
  else if (mat === 'wood') { add(x, burst(r, 0.04, 0.005, 'bp', 2600, 0.8), 0, 0.9); const f = 240 + r() * 80; modal(x, 0, [{ f, tau: 0.03, a: 0.5 }, { f: f * 2.1, tau: 0.024, a: 0.4 }, { f: f * 3.6, tau: 0.018, a: 0.3 }, { f: f * 5.9, tau: 0.012, a: 0.2 }], r); deb(12, 2800, 3, 0.2, 0.7); deb(6, 1300, 3, 0.16, 0.6); }
  else { /* tyre */ add(x, burst(r, 0.12, 0.028, 'lp', 520, 0.7), 0, 1.3); modal(x, 0, [{ f: 170 + r() * 30, tau: 0.045, a: 0.6 }, { f: 410, tau: 0.02, a: 0.2 }], r); add(x, burst(r, 0.02, 0.003, 'bp', 1800, 1), 0, 0.4);
    const hiss = biquad(decay(noise(x.length, r), 0.16, 0.025), 'bp', 4200 + r() * 1200, 0.9); add(L, hiss, 0.01, 0.2); add(R, hiss, 0.011, 0.2); }
  mid(lr, x); both(lr, (y) => { biquad(y, 'hp', 60, 0.7); sat(y, 1.5); fadeOut(y, 0.03); });
  return norm(lr, 0.9);
}
function bakeWhiz(v) {
  const r = mkrng(900 + v * 17), lr = stereo(0.34), n = lr[0].length, side = v % 2 ? 1 : -1;
  const src = noise(n, r), f0 = 5200 + r() * 2500, f1 = 900 + r() * 500; let lp = 0, bp = 0, ph = 0;
  for (let i = 0; i < n; i++) { const u = i / n, f = f1 + (f0 - f1) * Math.pow(1 - u, 2.2), w = 2 * Math.sin(Math.PI * f / SR), q = 0.22;   // state-variable band-pass, gliding down = the doppler drop
    lp += w * bp; const hp = src[i] - lp - q * bp; bp += w * hp;
    ph += TAU * f * 0.5 / SR; const e = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.45)), 2.2), s = (bp * 0.28 + Math.sin(ph) * 0.05) * e, pan = side * (1 - 2 * u);   // crosses the head
    lr[0][i] = s * Math.sqrt(0.5 * (1 - pan)); lr[1][i] = s * Math.sqrt(0.5 * (1 + pan)); }
  mid(lr, burst(r, 0.01, 0.0009, 'hp', 3000, 0.7), 0.045 + r() * 0.01, 0.5, side * 0.3);    // the supersonic snap as it passes
  return norm(lr, 0.8);
}
function bakeExplosion() {
  const body = SMP && SMP.get('explosion.0'), junk = SMP && SMP.get('explosion.1');
  if (body && !_dsp.inBoom) {      // the real blast for the roar, the synthesized crack/sub/debris for the punch, real mechanical wreckage on top
    _dsp.inBoom = true; const syn = bakeExplosion(); _dsp.inBoom = false; const lr = stereo(4.2), b = [Float32Array.from(body[0]), Float32Array.from(body[1])];
    narrow(b, 0.5); norm(b, 1); both(b, (x) => decay(x, 0.75)); add(lr[0], b[0], 0.005, 0.8); add(lr[1], b[1], 0.005, 0.8); add(lr[0], syn[0], 0, 0.85); add(lr[1], syn[1], 0, 0.85);
    if (junk) { add(lr[0], junk[0], 0.04, 0.3); add(lr[1], junk[1], 0.04, 0.3); }
    norm(lr, 1); both(lr, (x) => { sat(x, 1.6); fadeOut(x, 0.5); }); return norm(lr, 0.97);
  }
  const r = mkrng(31337), lr = stereo(4.2), [L, R] = lr, n = L.length, m = new Float32Array(n);
  add(m, burst(r, 0.2, 0.014, null), 0, 1.4);                                   // the crack
  sweep(m, 0, 95, 30, 0.12, 0.55, 1.6, 0.002); sweep(m, 0.02, 52, 22, 0.3, 0.95, 1.1, 0.01);   // the boom and the sub under it
  mid(lr, m);
  for (const ch of lr) { add(ch, glideLP(decay(noise(n, r), 0.42, 0.003), 9000, 220, 0.16), 0, 2.6);      // fireball body, darkening
    add(ch, decay(biquad(noise(n, r), 'lp', 130, 0.7), 1.1, 0.05), 0, 2.2);                              // ground rumble
    add(ch, decay(biquad(noise(n, r), 'bp', 520, 0.45), 0.30, 0.002), 0, 3.0);                           // the mid-range roar of the blast itself
    add(ch, decay(biquad(noise(n, r), 'bp', 520, 0.6), 0.75, 0.22), 0.05, 0.5);                           // the whoosh of fire after it
    add(ch, grains(r, 2.4, 70, 2800, 2.5, 1.6), 0.12, 1.3); add(ch, grains(r, 2.0, 30, 900, 3, 1.4), 0.2, 1.6); }   // debris raining down
  for (let i = 0; i < 6; i++) { const t = 0.25 + r() * 1.5, f = 500 + r() * 1400, c = new Float32Array(N(0.5)); modal(c, 0, [{ f, tau: 0.07, a: 0.2 }, { f: f * 2.3, tau: 0.05, a: 0.14 }, { f: f * 3.9, tau: 0.03, a: 0.1 }], r); add(c, burst(r, 0.02, 0.003, 'hp', 2000, 0.7), 0, 0.2); mid(lr, c, t, 0.9 / (1 + t), r() * 1.4 - 0.7); }   // car parts landing
  norm(lr, 1); both(lr, (x) => { sat(x, 4.5); biquad(x, 'ls', 90, 0.7, 4); biquad(x, 'hp', 24, 0.7); fadeOut(x, 0.5); });
  return norm(lr, 0.97);
}
function bakeGlassBreak(v) {
  const real = SMP && SMP.get('glass.0');
  if (real && !_dsp.inGlass) { _dsp.inGlass = true; const syn = bakeGlassBreak(v); _dsp.inGlass = false; const lr = stereo(1.5); add(lr[0], real[0]); add(lr[1], real[1]); norm(lr, 1); add(lr[0], syn[0], 0.01, 0.3); add(lr[1], syn[1], 0.01, 0.3); return norm(lr, 0.9); }   // the real pane, with extra shards falling
  const r = mkrng(555 + v * 29), lr = stereo(1.5), x = new Float32Array(lr[0].length);
  add(x, burst(r, 0.2, 0.03, 'hp', 2400, 0.7), 0, 1.0); add(x, burst(r, 0.1, 0.016, 'bp', 1200, 0.9), 0, 0.9); sweep(x, 0, 260, 120, 0.01, 0.02, 0.4); mid(lr, x);
  for (let i = 0; i < 90; i++) { const u = Math.pow(r(), 2.2), t = 0.015 + u * 1.15, f = 2400 + r() * 9500, c = new Float32Array(N(0.16)); modal(c, 0, [{ f, tau: 0.006 + r() * 0.03, a: 0.3 }, { f: f * (1.4 + r() * 0.5), tau: 0.005 + r() * 0.015, a: 0.18 }], r); c[0] += 0.2; mid(lr, c, t, (1 - u * 0.8) * (0.25 + r() * 0.5), r() * 1.6 - 0.8); }
  for (const ch of lr) { add(ch, grains(r, 0.9, 140, 7000, 4, 1.8), 0.01, 1.0); biquad(ch, 'hp', 500, 0.7); fadeOut(ch, 0.1); }
  return norm(lr, 0.9);
}
function bakeAlarm() {
  const lr = stereo(2.7), x = new Float32Array(lr[0].length), n = x.length; let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, c = (t % 0.27) / 0.27, f = 780 + 950 * c; ph += TAU * f / SR; const s = Math.sin(ph); x[i] = (Math.tanh(s * 6) * 0.6 + s * 0.4) * Math.min(1, t / 0.004); }
  biquad(x, 'bp', 2300, 0.9); biquad(x, 'hp', 600, 0.7); sat(x, 2); fadeOut(x, 0.12); mid(lr, x);
  return norm(lr, 0.6);
}

// ---------- the table of every sound ----------
const SURF = ['concrete', 'asphalt', 'metal', 'wood'], MATS = ['concrete', 'asphalt', 'metal', 'glass', 'flesh', 'wood', 'tyre'], KINDS = ['pistol', 'smg', 'shotgun', 'rifle'];
function bake(key, get) {
  const [a, b, c, d] = key.split(':');
  if (a === 'shot') return bakeShot(b, +c);
  if (a === 'far') return bakeFar(b, +c);
  if (a === 'slap') return bakeSlap(b, +c, get);
  if (a === 'ir') return bakeIR();
  if (a === 'casing') return bakeCasing(b, c, +d);
  if (a === 'impact') return bakeImpact(b, +c);
  if (a === 'whiz') return bakeWhiz(+b);
  if (a === 'explosion') return bakeExplosion();
  if (a === 'glass') return bakeGlassBreak(+b);
  if (a === 'alarm') return bakeAlarm();
  return bakeFoley(a, b, +c || 0);
}
function allKeys() {
  const k = ['ir'];
  for (const g of KINDS) for (let v = 0; v < NV; v++) k.push(`shot:${g}:${v}`);
  for (const g of KINDS) for (let v = 0; v < takes(g, 'far'); v++) k.push(`far:${g}:${v}`);
  for (const g of KINDS) for (let v = 0; v < NP; v++) k.push(`slap:${g}:${v}`);
  k.push('dry:x:0');
  for (const g of KINDS) for (const s of ['out', 'in', 'rack', 'draw']) for (let v = 0; v < 2; v++) k.push(`${s}:${g}:${v}`);
  for (let v = 0; v < 3; v++) k.push(`shell:shotgun:${v}`, `pump:shotgun:${v}`);
  k.push('holster:x:0', 'holster:x:1');
  for (const g of KINDS) for (let v = 0; v < 5; v++) k.push(`casing:${g}:concrete:${v}`);
  for (const m of MATS) for (let v = 0; v < 3; v++) k.push(`impact:${m}:${v}`);
  for (let v = 0; v < 4; v++) k.push(`whiz:${v}`);
  k.push('explosion', 'glass:0', 'glass:1', 'alarm');
  return k;
}
export const _dsp = { SR, bake, allKeys, GUNS, tune: null, setSamples(m) { SMP = m; }, takes };

// ---------- the player ----------
export class GunAudio {
  constructor(game) { this.g = game; this.data = new Map(); this.bufs = new Map(); this.voices = []; this.last = {}; this.burst = {}; this.ac = null; this._pre = null; }
  // Fetches and decodes the recordings, then renders every sound in small slices. Safe to call any time, any number of times; never throws.
  preload() { return this._pre || (this._pre = this._preload()); }
  async _preload() {
    try {
      if (!SMP && typeof fetch === 'function' && typeof OfflineAudioContext === 'function') {
        const base = new URL('../../assets/combat/audio/', import.meta.url);
        const [idx, raw] = await Promise.all([fetch(new URL('guns.json', base)).then((r) => (r.ok ? r.json() : null)), fetch(new URL('guns.opus', base)).then((r) => (r.ok ? r.arrayBuffer() : null))]);
        if (idx && raw) {
          const buf = await new OfflineAudioContext(2, 1, SR).decodeAudioData(raw), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, k = buf.sampleRate / idx.sr, m = new Map();
          for (const name in idx.clips) { const [o, n] = idx.clips[name], a = Math.round(o * k), e = Math.min(L.length, Math.round((o + n) * k)); if (e > a) m.set(name, [L.slice(a, e), R.slice(a, e)]); }
          /* input, Nov 13: a decode that gives silence (a broken decoder would leave every recorded gun mute) counts as a failed one, and both cases are named in the log */
          { let pk = 0; for (let j = 0; j < L.length; j += 97) { const x = Math.abs(L[j]); if (x > pk) pk = x; } if (!(pk > 1e-4)) throw new Error('they decoded to silence'); }
          if (buf.sampleRate !== SR || !m.size) console.log('[guns] recordings not used (decoded at ' + buf.sampleRate + ' Hz, ' + m.size + ' clips): the synthesized guns play');
          if (buf.sampleRate === SR && m.size) { SMP = m; for (const key of [...this.data.keys(), ...this.bufs.keys()]) if (/^(shot|far|slap|out|in|rack|pump|shell|glass|explosion)(:|$)/.test(key)) { this.data.delete(key); this.bufs.delete(key); } }
        }
      }
    } catch (e) { /* no recordings: the synthesized guns play instead */ try { console.log('[guns] recordings not used (' + (e && e.message) + '): the synthesized guns play'); } catch (e2) {} }
    /* perf, Nov 12: the sounds of guns the player does not have (this.kinds, set by combat.js: the SMG and the shotgun unless ?gall=1) are not rendered at load; one that is asked for anyway is rendered on first use, like anything missing. The guns in hand come first. */
    try { const has = this.kinds, skip = (k) => { const g = k.split(':')[1]; return !!has && KINDS.includes(g) && !has.includes(g); }; for (const k of allKeys().concat(this._more())) { if (skip(k)) continue; if (!this.bufs.has(k)) this._data(k); await new Promise((r) => setTimeout(r, 0)); } } catch (e) { /* anything missing is rendered on first use */ }
  }
  /* perf, Nov 12: a casing that lands on the road (asphalt) was rendered in the frame it landed, 2 to 4 ms each, five variants a gun: they are rendered at load with the rest */
  _more() { const k = []; for (const g of this.kinds || KINDS) for (let v = 0; v < 5; v++) k.push(`casing:${g}:asphalt:${v}`); return k; }
  /* perf, Nov 12: once sound is allowed (after Play): the bus (7 to 15 ms, it was built inside the first shot) and the AudioBuffers of the guns in hand, two per idle moment. True once started. */
  prime() { if (this._primed) return true; if (!this._ok()) return false; this._primed = true; const has = this.kinds || KINDS, keys = allKeys().concat(this._more()).filter((k) => { const g = k.split(':')[1]; return !KINDS.includes(g) || has.includes(g); });
    const idle = typeof requestIdleCallback === 'function' ? (f) => requestIdleCallback(f, { timeout: 1000 }) : (f) => setTimeout(f, 0), step = () => { let n = 0; while (keys.length && n < 2) { const k = keys.shift(); if (!this.bufs.has(k)) { try { this._buf(k); } catch (e) {} n++; } } if (keys.length) idle(step); }; idle(step); return true; }
  _data(key) { let d = this.data.get(key); if (!d) { d = bake(key, (k) => this.data.get(k) || bake(k)); this.data.set(key, d); } return d; }
  _irBuf(a) { if (a.sampleRate === SR) return this._buf('ir'); const d = this._data('ir'), k = SR / a.sampleRate, n = Math.max(1, Math.round(d[0].length / k)), b = a.createBuffer(2, n, a.sampleRate);
    for (let c = 0; c < 2; c++) { const src = d[c], o = b.getChannelData(c), m = src.length - 1; for (let i = 0; i < n; i++) { const x = i * k, j = Math.min(m, Math.floor(x)), f = x - j; o[i] = (src[j] + ((j < m ? src[j + 1] : 0) - src[j]) * f) * k; } }      /* linear resample; scaled by the rate ratio so the echo's level is the same */
    return b; }
  _buf(key) {
    let b = this.bufs.get(key);
    if (!b) { const d = this._data(key); b = this.ac.createBuffer(2, d[0].length, SR); b.copyToChannel(d[0], 0); b.copyToChannel(d[1], 1); this.bufs.set(key, b); this.data.delete(key); }      // the AudioBuffer holds its own copy
    return b;
  }
  // true when sound may be made; builds the bus on first use
  _ok() {
    const s = this.g && this.g.sound;
    if (!s || !s.on || !s.ac || !s.out || this.g.capture) return false;
    if (this.ac !== s.ac) {
      try {
        const a = (this.ac = s.ac); this.bufs = new Map(); this.voices = [];
        const bus = (this.bus = a.createGain()); bus.gain.value = 1;
        // The limiter: a soft-knee wave-shaper. Clean up to 0.6 of full scale, then a tanh shoulder that never passes 0.98, with no attack or
        // release to pump the tail or shave the crack (Chrome's DynamicsCompressorNode took ~6 dB off every shot's first milliseconds, measured).
        // Stacked shots saturate into it the way a hot recording chain does. The curve covers input up to 3x full scale.
        const lim = a.createWaveShaper(), cv = new Float32Array(4097); for (let i = 0; i < 4097; i++) { const x = (i / 2048 - 1) * 3, ax = Math.abs(x); cv[i] = Math.sign(x) * (ax < 0.6 ? ax : 0.6 + 0.38 * Math.tanh((ax - 0.6) / 0.38)); } lim.curve = cv; lim.oversample = '4x';
        const pre = a.createGain(); pre.gain.value = 1 / 3;
        const post = (this.post = a.createGain()); post.gain.value = 1;
        bus.connect(pre); pre.connect(lim); lim.connect(post); post.connect(s.out);
        /* perf, Nov 13 (THE CARBINE'S COST ON LAPTOP 2, and silent guns): a ConvolverNode only takes a buffer at the context's own sample rate. Ours is rendered at 48 kHz; on a machine whose output runs at another rate (44.1 kHz: many headsets, displays and Windows machines) this line threw, the bus was thrown away, NO gun sound played, and every later sound call built the bus and rendered the street echo again: 14 ms a call, two or three calls a shot. The echo is now resampled to the context's rate, and if the convolver still fails the guns play dry and the bus is kept. */
        let conv; try { conv = a.createConvolver(); conv.normalize = false; conv.buffer = this._irBuf(a); } catch (e) { conv = a.createGain(); conv.gain.value = 0; if (!this._irErr) { this._irErr = true; console.log('[guns] street echo off: ' + (e && e.message)); } } this.conv = conv;
        const wet = (this.wet = a.createGain()); wet.gain.value = 1; conv.connect(wet); wet.connect(bus);
        this.preload();      // if the game did not call it at load, start now (in the background)
      } catch (e) { this.ac = null; return false; }
    }
    return true;
  }
  // a different variant from last time
  _pick(group, n) { let v = Math.floor(Math.random() * n); if (n > 1 && v === this.last[group]) v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n; this.last[group] = v; return v; }
  // one voice: buffer -> [low-pass] -> gain -> pan -> bus, and a send to the street convolver
  _play(key, o = {}) {
    try {
      const a = this.ac, now = a.currentTime, t = now + (o.delay || 0), buf = this._buf(key);
      const src = a.createBufferSource(); src.buffer = buf; src.playbackRate.value = o.rate || 1;
      let node = src;
      if (o.lp && o.lp < 16000) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5; node.connect(f); node = f; }
      const g = a.createGain(); g.gain.value = o.gain == null ? 1 : o.gain; node.connect(g); node = g;
      if (o.pan && a.createStereoPanner) { const p = a.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
      node.connect(this.bus);
      let send = null; if (o.wet > 0.001) { send = a.createGain(); send.gain.value = o.wet; node.connect(send); send.connect(this.conv); }
      const v = { src, g, end: t + buf.duration / (o.rate || 1) };
      // drop the oldest voices over the cap (tails are in the convolver and keep ringing)
      while (this.voices.length >= MAXV) { const old = this.voices.shift(); try { old.g.gain.setTargetAtTime(0, now, 0.006); old.src.stop(now + 0.04); } catch (e) {} }
      this.voices.push(v);
      src.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); try { node.disconnect(); if (send) send.disconnect(); } catch (e) {} };
      src.start(t);
      return v;
    } catch (e) { return null; /* audio must never break the game */ }
  }
  // distance model shared by everything in the world: level, air/occlusion low-pass, travel time, and how much is street tail
  _far(o, ref = 14) {
    const d = Math.max(0, +o.dist || 0);
    return { d, gain: 1 / (1 + d / ref), lp: d < 3 ? 0 : Math.max(650, 19000 / Math.pow(1 + d / 22, 1.35)), delay: Math.min(1.5, d / 343), tail: 1 / (1 + d / 70), pan: +o.pan || 0 };
  }
  shot(kind, o = {}) {
    if (!this._ok()) return;
    if (!GUNS[kind]) kind = 'pistol';
    const p = GUNS[kind], f = this._far(o), now = this.ac.currentTime, own = f.d < 3;
    // a burst: the first shot is the fullest, the street pattern holds for the burst, and each new shot pushes the previous shot's echoes down
    // so the last shot's slaps ring out in the clear
    const b = own ? (this.burst[kind] || (this.burst[kind] = { t: -9, pat: 0, slap: null })) : null, first = !b || now - b.t > 0.3;
    if (b) { if (now - b.t > 0.6) b.pat = this._pick('pat' + kind, NP); else if (b.slap) { try { b.slap.g.gain.setTargetAtTime(b.slap.lvl * 0.4, now, 0.03); } catch (e) {} } b.t = now; }
    const jit = 1 + (Math.random() - 0.5) * 0.07, lvl = p.gain * (0.88 + Math.random() * 0.2) * (first ? 1.12 : 0.86), wet = (p.tail * f.tail) / Math.max(f.gain, 0.02) * (0.9 + Math.random() * 0.2) * 0.22;
    const nf = takes(kind, 'far'), wn = nf ? Math.max(0, Math.min(1, 1 - (f.d - 10) / 35)) : 1;      // close take fades into the distant take between 10 and 45 m
    if (wn > 0.04) {
      this._play(`shot:${kind}:${this._pick('shot' + kind, NV)}`, { gain: lvl * f.gain * wn, rate: jit, pan: f.pan, lp: f.lp && f.lp * (0.9 + Math.random() * 0.2), delay: f.delay, wet });
      const sl = lvl * f.gain * wn * p.tail * (0.85 + Math.random() * 0.3), v = this._play(`slap:${kind}:${b ? b.pat : this._pick('pat' + kind, NP)}`, { gain: sl, rate: 0.95 + Math.random() * 0.1, pan: f.pan * 0.5, lp: f.lp, delay: f.delay + Math.random() * 0.008, wet: wet * 0.5 });
      if (b && v) { v.lvl = sl; b.slap = v; }
    }
    if (wn < 0.96) this._play(`far:${kind}:${this._pick('far' + kind, nf)}`, { gain: lvl * f.gain * (1 - wn) * 1.1, rate: jit, pan: f.pan, lp: f.lp && Math.min(15000, f.lp * 1.7), delay: f.delay, wet: wet * 0.8 });
  }
  dry() { if (!this._ok()) return; this._play('dry:x:0', { gain: 0.3, rate: 0.96 + Math.random() * 0.08, wet: 0.03 }); }
  reload(kind, stage) {
    if (!this._ok()) return;
    if (!KP[kind]) kind = 'pistol';
    const two = stage === 'out' || stage === 'in' || stage === 'rack';
    if (!two && stage !== 'shell' && stage !== 'pump') return;
    const key = two ? `${stage}:${kind}:${this._pick(stage + kind, 2)}` : `${stage}:shotgun:${this._pick(stage, 3)}`;
    this._play(key, { gain: stage === 'pump' || stage === 'rack' ? 0.28 : stage === 'shell' ? 0.2 : 0.22, rate: 0.96 + Math.random() * 0.08, wet: 0.04 });
  }
  draw(kind) { if (!this._ok()) return; if (!KP[kind]) kind = 'pistol'; this._play(`draw:${kind}:${this._pick('draw', 2)}`, { gain: 0.26, rate: 0.95 + Math.random() * 0.1, wet: 0.03 }); }
  holster() { if (!this._ok()) return; this._play(`holster:x:${this._pick('holster', 2)}`, { gain: 0.22, rate: 0.95 + Math.random() * 0.1, wet: 0.03 }); }
  casing(kind, surface = 'concrete') {
    if (!this._ok()) return;
    if (!KP[kind]) kind = 'pistol'; if (!SURF.includes(surface)) surface = 'concrete';
    this._play(`casing:${kind}:${surface}:${this._pick('casing' + kind, 5)}`, { gain: 0.16 + Math.random() * 0.1, rate: 0.84 + Math.random() * 0.32, pan: (Math.random() < 0.8 ? 1 : -1) * (0.2 + Math.random() * 0.4), wet: 0.05 });
  }
  impact(material, o = {}) {
    if (!this._ok()) return;
    if (!MATS.includes(material)) material = 'concrete';
    const f = this._far(o, 9);
    this._play(`impact:${material}:${this._pick('imp' + material, 3)}`, { gain: 0.6 * f.gain * (0.85 + Math.random() * 0.3), rate: 0.9 + Math.random() * 0.2, pan: f.pan, lp: f.lp, delay: f.delay, wet: 0.25 * f.tail / Math.max(f.gain, 0.05) });
  }
  whiz(o = {}) { if (!this._ok()) return; this._play(`whiz:${this._pick('whiz', 4)}`, { gain: 0.5 + Math.random() * 0.2, rate: 0.85 + Math.random() * 0.35, pan: +o.pan || 0, wet: 0.1 }); }
  explosion(o = {}) {
    if (!this._ok()) return;
    const f = this._far(o, 30);
    this._play('explosion', { gain: 1.25 * f.gain, rate: 0.94 + Math.random() * 0.12, pan: f.pan * 0.6, lp: f.lp && f.lp * 1.5, delay: f.delay, wet: 0.35 * f.tail / Math.max(f.gain, 0.05) });
  }
  glassBreak(o = {}) { if (!this._ok()) return; const f = this._far(o, 10); this._play(`glass:${this._pick('glass', 2)}`, { gain: 0.7 * f.gain, rate: 0.92 + Math.random() * 0.16, pan: f.pan, lp: f.lp, delay: f.delay, wet: 0.2 * f.tail / Math.max(f.gain, 0.05) }); }
  alarm(o = {}) { if (!this._ok()) return; const f = this._far(o, 12); this._play('alarm', { gain: 0.3 * f.gain, rate: 0.97 + Math.random() * 0.06, pan: f.pan, lp: f.lp, delay: f.delay, wet: 0.5 * f.tail / Math.max(f.gain, 0.05) }); }
}
