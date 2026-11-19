// surprises/busker-tune.js: the saxophone busker's solo (surprises lane, Nov 17). Our own line, written here for this game: two choruses of a slow
// twelve-bar blues in concert B flat, 12/8, one tenor saxophone alone, 86.4 s, made to loop. No recording, no sample, no real tune.
// The same list of notes drives the sound (soloRenderer) and the player's body (noteAt: fingers, the lean on long notes, the bell up on the high phrase).
//   soloRenderer(sr)   { d: Float32Array, len, done, step(ms) }: renders a few notes per call so that no frame pays for the whole tune
//   renderSolo(sr)     the whole buffer at once (node, tests)
// The tone: a wavetable per pitch built from a fixed formant curve (a conical bore: every harmonic, the body of the sound at 400-900 Hz and again near
// 1.3 kHz), a darker and a brighter table mixed by how hard the note is blown, breath noise riding on the note, a scoop into notes that start a phrase,
// a slide between slurred notes, vibrato that arrives late on held notes, a fall at the end of a phrase, a growl on the high wails, and a short street echo.
export const TT = 0.3;                // one triplet eighth, seconds (a beat is three of them: 0.9 s, 67 to the minute)
export const BAR = 12;                // triplet eighths in a bar
// [midi note, length in triplet eighths]; 0 = a rest. One row is one bar (each adds up to 12).
const BARS = [
  // ---- first chorus: low and unhurried, a phrase and its answer
  [[0, 1], [53, 1], [56, 1], [58, 5], [0, 1], [61, 1], [62, 2]],                              // B flat 7
  [[58, 2], [55, 1], [51, 5], [0, 4]],                                                        // E flat 7
  [[0, 1], [53, 1], [56, 1], [58, 2], [61, 1], [58, 1], [56, 1], [53, 4]],                    // B flat 7
  [[0, 3], [62, 1], [65, 2], [68, 4], [65, 1], [62, 1]],
  [[63, 6], [61, 1], [58, 2], [0, 3]],                                                        // E flat 7
  [[0, 1], [55, 1], [58, 1], [61, 3], [58, 1], [55, 1], [51, 2], [0, 2]],
  [[53, 1], [56, 1], [58, 1], [62, 6], [58, 1], [0, 2]],                                      // B flat 7
  [[0, 2], [59, 1], [62, 2], [65, 1], [67, 4], [65, 1], [62, 1]],                             // G 7
  [[63, 3], [60, 2], [55, 1], [58, 4], [0, 2]],                                               // C minor 7
  [[0, 1], [57, 1], [60, 1], [63, 3], [61, 1], [60, 1], [57, 1], [53, 3]],                    // F 7
  [[58, 5], [0, 1], [62, 1], [59, 1], [55, 2], [0, 2]],                                       // B flat 7, G 7
  [[60, 2], [63, 1], [67, 2], [65, 1], [63, 1], [60, 1], [57, 2], [0, 2]],                    // C minor 7, F 7
  // ---- second chorus: up the horn, harder, the long wails; then back down to the bottom B flat
  [[0, 1], [58, 1], [62, 1], [65, 3], [68, 1], [70, 5]],
  [[70, 1], [68, 1], [67, 1], [63, 3], [67, 1], [70, 1], [73, 4]],
  [[74, 3], [70, 1], [68, 1], [65, 1], [68, 4], [0, 2]],
  [[0, 2], [65, 1], [68, 1], [70, 1], [72, 1], [73, 6]],
  [[75, 7], [73, 1], [70, 2], [0, 2]],
  [[0, 1], [70, 1], [73, 1], [75, 2], [73, 1], [70, 1], [67, 1], [70, 3], [0, 1]],
  [[74, 5], [70, 1], [65, 1], [68, 1], [65, 1], [62, 3]],
  [[0, 2], [62, 1], [65, 1], [68, 1], [71, 1], [74, 4], [71, 1], [67, 1]],
  [[75, 2], [72, 1], [67, 3], [63, 1], [67, 1], [72, 4]],
  [[0, 1], [72, 1], [69, 1], [65, 2], [63, 1], [60, 1], [63, 1], [65, 4]],
  [[0, 1], [68, 1], [65, 1], [61, 1], [62, 2], [58, 6]],
  [[0, 2], [56, 1], [53, 1], [49, 1], [48, 1], [46, 4], [0, 2]],
];
export const LEN = BARS.length * BAR * TT;      // 86.4 s

// the notes with their times: a player who lays back a little, never twice the same
function build() {
  let s = 20261117; const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const flat = []; BARS.forEach((b, bi) => { let sum = 0; for (const [m, l] of b) { flat.push({ m, l, bar: bi, at: bi * BAR + sum }); sum += l; } if (sum !== BAR) throw new Error('busker tune: bar ' + (bi + 1) + ' adds up to ' + sum); });
  const N = [];
  for (let i = 0; i < flat.length; i++) { const f = flat[i]; if (!f.m) continue; const prev = flat[i - 1], next = flat[i + 1], first = !prev || !prev.m, last = !next || !next.m, ch2 = f.bar >= 12;
    const late = first ? 0.03 + 0.05 * rnd() : 0.012 + 0.03 * rnd(), t0 = f.at * TT + late, dur = f.l * TT;
    let lvl = (ch2 ? 0.8 : 0.58) + (f.l >= 3 ? 0.08 : 0) + (f.m >= 72 ? 0.1 : 0) + (rnd() - 0.5) * 0.08; if (f.bar === 23) lvl = 0.7; if (f.m <= 49) lvl += 0.1;
    N.push({ m: f.m, t0, t1: 0, l: f.l, bar: f.bar, first, last, long: f.l >= 3, lvl: Math.min(1, lvl), growl: ch2 && f.m >= 73 && f.l >= 4 ? 1 : 0, from: first ? 0 : prev.m, gap: last && next ? next.l : 0, dur, vr: 4.9 + rnd() * 0.7, ph: rnd() }); }
  // a slurred note sounds until the next one speaks; the last note of a phrase is let go a little early when it is short
  for (let i = 0; i < N.length; i++) { const n = N[i], nx = N[i + 1]; n.t1 = n.last ? n.t0 + n.dur - (n.l >= 3 ? 0.02 : 0.05) : nx.t0 + 0.022; }
  return N;
}
export const NOTES = build();
// the note sounding at tune time t (seconds, any value: the tune loops), or the one that comes next. out: { n: the note or null in a rest, next, u: 0..1 through it, s: seconds into it, rest: seconds until the next note }
let _hint = 0;
export function noteAt(t, out = {}) {
  t = ((t % LEN) + LEN) % LEN; let i = _hint; if (i >= NOTES.length || NOTES[i].t0 > t) i = 0; while (i + 1 < NOTES.length && NOTES[i + 1].t0 <= t) i++; _hint = i;
  const n = NOTES[i], on = t >= n.t0 && t < n.t1, nx = NOTES[(i + (t >= n.t0 ? 1 : 0)) % NOTES.length];
  out.n = on ? n : null; out.next = on ? NOTES[(i + 1) % NOTES.length] : nx; out.s = on ? t - n.t0 : 0; out.u = on ? (t - n.t0) / (n.t1 - n.t0) : 0; let r = out.next.t0 - t; if (r < 0) r += LEN; out.rest = on ? 0 : r; out.t = t; return out;
}
// a tune time at which a phrase starts (a note after a rest), at or after t: where he comes back in after an interruption
export function nextPhrase(t) { t = ((t % LEN) + LEN) % LEN; for (const n of NOTES) if (n.first && n.t0 >= t) return n.t0; return NOTES[0].t0 + LEN; }

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12), TAU = Math.PI * 2, TAB = 1024;
const gs = (f, c, w) => Math.exp(-((f - c) / w) * ((f - c) / w));
// the horn's own colour whatever the note: what a frequency is worth (dark = blown softly, bright = blown hard)
const env = (f, fc) => (f * f / (f * f + 170 * 170)) * (1 + 1.7 * gs(f, 560, 280) + 1.0 * gs(f, 1300, 420) + 0.4 * gs(f, 2700, 800)) / (1 + Math.pow(f / fc, 2.6));
const SIN = new Float32Array(TAB); for (let i = 0; i < TAB; i++) SIN[i] = Math.sin(TAU * i / TAB);
function table(m, fc, sr) { const f0 = hz(m), H = Math.max(1, Math.min(56, Math.floor(0.46 * sr / (f0 * 1.07)))), t = new Float32Array(TAB + 1); let e = 0;
  for (let h = 1; h <= H; h++) { const a = env(h * f0, fc) / Math.pow(h, 0.3), p = h === 1 ? 0 : Math.round(0.35 * h / TAU * TAB); for (let i = 0; i < TAB; i++) t[i] += a * SIN[(h * i + p) & (TAB - 1)]; e += a * a / 2; }
  const k = 1 / Math.sqrt(e || 1); for (let i = 0; i < TAB; i++) t[i] *= k; t[TAB] = t[0]; return t; }

export const GAIN = 0.2;
export function soloRenderer(sr) {
  const len = Math.round(LEN * sr), d = new Float32Array(len), tabs = new Map(), R = { d, len, sr, done: false, notes: 0, ms: 0 };
  const tab = (m, bright) => { const k = m * 2 + bright; let t = tabs.get(k); if (!t) tabs.set(k, (t = table(m, bright ? 3600 : 1300, sr))); return t; };
  let k = 0, cur = null, seed = 987654321, lp1 = 0, lp2 = 0;
  // one note into the buffer. Pitch and blowing are worked out every CR samples and run straight between (the ear cannot tell; it is six times cheaper)
  const CR = 16, SLICE = 8192;
  function note(n) {
    const A = tab(n.m, 0), B = tab(n.m, 1), f0 = hz(n.m) / sr, i0 = Math.round(n.t0 * sr), dur = n.t1 - n.t0, N = Math.round((dur + 0.07) * sr), slur = !n.first, att = slur ? 0.012 : n.m <= 51 ? 0.05 : 0.03, rel = n.last ? (n.l >= 3 ? 0.16 : 0.07) : 0.03;
    const bend0 = slur ? (n.from - n.m) * 100 : -(55 + 40 * n.ph), bendT = slur ? 0.016 : 0.055, fall = n.last && n.l >= 2 && n.gap >= 2 ? 70 + 60 * n.ph : 0, vibD = n.long ? (n.m >= 70 ? 26 : 19) : 0, air = (n.m <= 53 ? 0.085 : 0.045) * 9 * (1 + (n.growl ? 0.8 : 0)), swellT = Math.max(0.4, dur * 0.75);
    // at time t: the step of the phase per sample, how hard it is blown (the tongue, a swell through a held note, the let-go, the growl)
    const ctl = (t, o) => { let c = bend0 * Math.exp(-t / bendT) + 5 * Math.sin(TAU * 0.6 * t + n.ph * 9);
      if (vibD) { const v = (t - 0.32) / 0.5; if (v > 0) c += vibD * (v < 1 ? v * v * (3 - 2 * v) : 1) * Math.sin(TAU * n.vr * (t - 0.32)); }
      if (fall) { const q = (t - (dur - 0.2)) / 0.2; if (q > 0) c -= fall * q * q; }
      o.f = f0 * Math.pow(2, c / 1200);
      let e = t < att ? t / att : 1; e = e * e * (3 - 2 * e); if (slur) e = 0.72 + 0.28 * e; else if (t < 0.09) e *= 1 + 0.22 * Math.sin(Math.PI * t / 0.09);
      if (n.long) e *= 0.82 + 0.18 * Math.sin(Math.PI * 0.5 * Math.min(1, t / swellT)); const q = (t - dur + rel) / (rel + 0.05); if (q > 0) { const z = q >= 1 ? 0 : 1 - q; e *= z * z; }
      const blow = e * n.lvl; o.br = Math.min(1, Math.max(0, blow * 1.3 - 0.2)); o.a = GAIN * blow * (n.growl ? 1 + 0.42 * Math.sin(TAU * 29 * t) * Math.min(1, t / 0.25) : 1); };
    // (resumable: at most SLICE samples a call, so one long note never holds a frame)
    let ph = n.ph, i = 0; const c0 = { f: 0, br: 0, a: 0 }, c1 = { f: 0, br: 0, a: 0 }; ctl(0, c0);
    return () => { const stop = Math.min(N, i + SLICE);
      for (; i < stop; i += CR) { ctl((i + CR) / sr, c1); const m = Math.min(CR, N - i), df = (c1.f - c0.f) / CR, db = (c1.br - c0.br) / CR, da = (c1.a - c0.a) / CR; let f = c0.f, br = c0.br, a = c0.a, o = (i0 + i) % len;
        for (let j = 0; j < m; j++) { ph += f; if (ph >= 1) ph -= 1; const x = ph * TAB, xi = x | 0, fr = x - xi, s0 = A[xi] + (A[xi + 1] - A[xi]) * fr, s1 = B[xi] + (B[xi + 1] - B[xi]) * fr;
          seed = (Math.imul(seed, 1664525) + 1013904223) | 0; lp1 += (seed / 2147483648 - lp1) * 0.42; lp2 += (lp1 - lp2) * 0.07;      // breath: the hiss between about 600 Hz and 4 kHz
          d[o] += a * (s0 + (s1 - s0) * br + air * (lp1 - lp2)); if (++o >= len) o = 0; f += df; br += db; a += da; }
        c0.f = c1.f; c0.br = c1.br; c0.a = c1.a; }
      return i >= N; };
  }
  // the street: three short echoes off the far side, a little dulled; then a soft ceiling so that nothing can clip. Done in slices like the notes.
  let ek = -1, esrc = null, ez = 0;
  function echo(n) { if (ek < 0) { esrc = d.slice(); ek = 0; } const a = Math.round(0.131 * sr), b = Math.round(0.287 * sr), c = Math.round(0.512 * sr), end = Math.min(len, ek + n);
    let ia = (ek - a + len) % len, ib = (ek - b + len) % len, ic = (ek - c + len) % len;
    for (let i = ek; i < end; i++) { const e = 0.17 * esrc[ia] + 0.1 * esrc[ib] + 0.06 * esrc[ic]; ez += (e - ez) * 0.45; let x = d[i] + ez; if (x > 0.82) x = 0.82 + 0.16 * Math.tanh((x - 0.82) / 0.16); else if (x < -0.82) x = -0.82 + 0.16 * Math.tanh((x + 0.82) / 0.16); d[i] = x;
      if (++ia >= len) ia = 0; if (++ib >= len) ib = 0; if (++ic >= len) ic = 0; }
    ek = end; if (ek >= len) { esrc = null; return true; } return false; }
  // work for about `ms` milliseconds (always at least one slice of a note); true when the buffer is finished
  R.step = (ms = 2.5) => { if (R.done) return true; const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), t0 = now();
    while (k < NOTES.length || cur) { if (!cur) cur = note(NOTES[k++]); if (cur()) { cur = null; R.notes = k; } if (now() - t0 >= ms) { R.ms += now() - t0; return false; } }
    for (;;) { if (echo(16384)) break; if (now() - t0 >= ms) { R.ms += now() - t0; return false; } }
    R.done = true; R.ms += now() - t0; return true; };
  return R;
}
export function renderSolo(sr) { const R = soloRenderer(sr); while (!R.step(1e9)); return R.d; }
