// radio/synth.js: the radio's music. Every note is made here, in the page, by WebAudio oscillators and noise: no recordings, nothing downloaded.
// Fetched the first time the radio is switched on (radio.js). Five invented stations, each a small composer: it picks a key, a tempo and a chord
// loop, writes a tune over it and plays it as "tracks" with invented titles; between tracks the station's own line shows on the HUD (text only).
// makeTuner(ac, dest) -> { stations, tune(i), stop(), now() }.

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11] };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

// ------------------------------------------------------------------ invented names (stations, titles, acts). None is a real station, song or act.
const TA = ['Third', 'Late', 'Steam', 'Double', 'Empty', 'Yellow', 'Slow', 'Corner', 'Night', 'Paper', 'Cold', 'Green', 'Local', 'Last', 'Wet', 'Low', 'Borrowed', 'Rooftop', 'Midtown', 'Side'];
const TB = ['Rail', 'Crosstown', 'Vent', 'Parking', 'Platform', 'Light', 'Transfer', 'Deli', 'Shift', 'Umbrella', 'Coffee', 'Signal', 'Express', 'Stop', 'Pavement', 'Bridge', 'Quarter', 'Pigeons', 'Hours', 'Street'];
const ACTS = ['The Alternate Sides', 'Low Bridge', 'Fire Escape Garden', 'Deli Flowers', 'Hydrant Summer', 'The Double Parkers', 'Uptown Local', 'Stoop Committee', 'Second Avenue Static', 'Bodega Cat Orchestra', 'Meter Maids of Honor', 'Night Owl Transfer'];

export const STATIONS = [
  { id: 'curb', name: 'Curbside 88.2', tag: 'slow beats for slow traffic', style: 'lofi', lines: ['Curbside 88.2. Nobody is going anywhere fast.', 'You are double parked with Curbside 88.2.', 'Curbside. Beats to sit at a red light to.'] },
  { id: 'bus', name: 'Night Bus 96.6', tag: 'synths until sunrise', style: 'wave', lines: ['Night Bus 96.6: every stop, all night.', 'Stand clear of the closing doors. This is Night Bus.', 'Night Bus 96.6. Next stop, the chorus.'] },
  { id: 'uptown', name: 'Uptown After Hours 91.4', tag: 'a trio in a basement', style: 'jazz', lines: ['Uptown After Hours 91.4. The band never goes home.', 'That was the house trio. So is this.', 'After Hours, 91.4. Two drink minimum, no cover.'] },
  { id: 'stoop', name: 'The Stoop 104.4', tag: 'block party, every block', style: 'house', lines: ['The Stoop 104.4: turn it up, the neighbours already called.', 'You are on The Stoop. Mind the hydrant.', 'The Stoop 104.4. Windows down.'] },
  { id: 'res', name: 'Reservoir 99.0', tag: 'quiet, for once', style: 'calm', lines: ['Reservoir 99.0. Breathe out.', 'This is Reservoir. Nothing is urgent.', 'Reservoir 99.0: the quiet part of town.'] },
];

export function makeTuner(ac, dest) {
  const master = ac.createGain(); master.gain.value = 0.7; master.connect(dest);
  // shared sound sources
  const white = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); { const d = white.getChannelData(0); let s = 22222; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; } }
  const crackle = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate); { const d = crackle.getChannelData(0), r = rng(77); for (let i = 0; i < d.length; i++) d[i] = (r() - 0.5) * 0.02; for (let k = 0; k < 70; k++) { const p = Math.floor(r() * (d.length - 200)), a = 0.3 + r() * 0.7; for (let j = 0; j < 90; j++) d[p + j] += a * Math.exp(-j / 14) * (r() - 0.5) * 2; } }
  const hall = ac.createBuffer(2, ac.sampleRate * 2.2, ac.sampleRate); { const r = rng(4242); for (let c = 0; c < 2; c++) { const d = hall.getChannelData(c); for (let i = 0; i < d.length; i++) { const t = i / ac.sampleRate; d[i] = (r() * 2 - 1) * Math.exp(-t * 3.2) * (t < 0.012 ? t / 0.012 : 1); } } }

  let cur = null;      // the playing station: { def, bus, timer, ... }

  function start(def) {
    const S = { def, r: rng((Math.random() * 1e9) | 0), nodes: [], n: 0, track: null, nowTitle: '', onTrack: null };
    const bus = (S.bus = ac.createGain()); bus.gain.value = 0; bus.gain.setTargetAtTime(1, ac.currentTime, 0.08);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.006; comp.release.value = 0.18;
    const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = def.style === 'lofi' ? 3600 : def.style === 'jazz' ? 7500 : 12000;
    comp.connect(tone); tone.connect(bus); bus.connect(master);
    S.dry = ac.createGain(); S.dry.connect(comp);
    S.wet = ac.createGain(); S.wet.connect(S.dry); const cv = ac.createConvolver(); cv.buffer = hall; const cg = ac.createGain(); cg.gain.value = { lofi: 0.22, wave: 0.42, jazz: 0.2, house: 0.2, calm: 0.75 }[def.style]; S.wet.connect(cv); cv.connect(cg); cg.connect(comp);
    S.duck = ac.createGain(); S.duck.connect(S.wet);      // pads and bass that give way to the kick
    S.echo = ac.createGain(); const dl = ac.createDelay(1.5), fb = ac.createGain(), eg = ac.createGain(); fb.gain.value = 0.38; eg.gain.value = 0.3; S.echo.connect(S.wet); S.echo.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(eg); eg.connect(S.wet); S.delay = dl;
    S.all = [bus, comp, tone, S.dry, S.wet, cv, cg, S.duck, S.echo, dl, fb, eg];
    if (def.style === 'lofi') { const c = ac.createBufferSource(); c.buffer = crackle; c.loop = true; const g = ac.createGain(); g.gain.value = 0.16; const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900; c.connect(hp); hp.connect(g); g.connect(bus); c.start(); S.bed = c; S.all.push(g, hp); }
    S.next = ac.currentTime + 0.12; S.step = 0; newTrack(S);
    S.timer = setInterval(() => pump(S), 50); pump(S);
    return S;
  }
  function halt(S) { clearInterval(S.timer); const t = ac.currentTime; S.bus.gain.cancelScheduledValues(t); S.bus.gain.setTargetAtTime(0, t, 0.04); setTimeout(() => { try { if (S.bed) S.bed.stop(); for (const n of S.all) n.disconnect(); } catch (e) {} }, 500); }

  // ------------------------------------------------------------------ voices
  const V = {
    kick(S, t, v = 1, lo = 46) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(lo * 3.4, t); o.frequency.exponentialRampToValueAtTime(lo, t + 0.11); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + 0.34); o.connect(g); g.connect(S.dry); o.start(t); o.stop(t + 0.36); },
    noise(S, t, dur, v, type, f, q, out) { const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = white; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(fl); fl.connect(g); g.connect(out || S.dry); s.start(t, (S.n++ * 0.137) % 1.5, dur + 0.05); },
    snare(S, t, v = 1, big) { V.noise(S, t, big ? 0.3 : 0.16, 0.5 * v, 'bandpass', 1900, 0.8, big ? S.wet : S.dry); const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08); g.gain.setValueAtTime(0.35 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.connect(g); g.connect(S.dry); o.start(t); o.stop(t + 0.13); },
    clap(S, t, v = 1) { for (let i = 0; i < 3; i++) V.noise(S, t + i * 0.011, i === 2 ? 0.2 : 0.03, 0.4 * v, 'bandpass', 1300, 1.2, S.wet); },
    hat(S, t, v = 1, open) { V.noise(S, t, open ? 0.26 : 0.045, 0.2 * v, 'highpass', 7800, 0.7); },
    rim(S, t, v = 1) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = 820; g.gain.setValueAtTime(0.16 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03); o.connect(g); g.connect(S.wet); o.start(t); o.stop(t + 0.04); },
    ride(S, t, v = 1) { V.noise(S, t, 0.5, 0.075 * v, 'highpass', 6200, 0.5); V.noise(S, t, 0.06, 0.1 * v, 'bandpass', 9000, 3); },
    brush(S, t, v = 1) { V.noise(S, t, 0.12, 0.09 * v, 'bandpass', 3200, 0.6); },
    // a plain tone with an envelope and a filter that closes: bass, plucks, leads
    tone(S, t, m, dur, o) { const os = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter(); os.type = o.type || 'sawtooth'; os.frequency.value = mtof(m); if (o.det) os.detune.value = o.det;
      if (o.glide) { os.frequency.setValueAtTime(mtof(m + o.glide), t); os.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.05); }
      f.type = 'lowpass'; f.Q.value = o.q || 1; const f0 = o.cut || 1200, f1 = o.cutEnd || f0; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + (o.cutT || dur));
      const a = o.a || 0.004, v = o.v || 0.2; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(v * (o.sus === undefined ? 0.6 : o.sus), t + a, (o.d || 0.2) / 3); g.gain.setTargetAtTime(0, t + dur, (o.rel || 0.06) / 3);
      if (o.vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5.2; lg.gain.value = o.vib; l.connect(lg); lg.connect(os.detune); l.start(t + 0.12); l.stop(t + dur + 0.3); }
      os.connect(f); f.connect(g); g.connect(o.out || S.dry); os.start(t); os.stop(t + dur + (o.rel || 0.06) * 2 + 0.02); },
    // electric piano: a sine with a bell on top that dies quickly (one modulator), a little tremolo left out to save nodes
    keys(S, t, m, dur, v = 0.12, out) { const c = ac.createOscillator(), md = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain(), fr = mtof(m); c.frequency.value = fr; md.frequency.value = fr * 4; mg.gain.setValueAtTime(fr * 1.6 * Math.min(1, v * 8), t); mg.gain.exponentialRampToValueAtTime(fr * 0.05, t + 0.35); md.connect(mg); mg.connect(c.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.setTargetAtTime(v * 0.25, t + 0.006, 0.5); g.gain.setTargetAtTime(0, t + dur, 0.07); c.connect(g); g.connect(out || S.wet); c.start(t); md.start(t); c.stop(t + dur + 0.4); md.stop(t + dur + 0.4); },
    // acoustic-ish piano: three partials, quick strike, long fall
    piano(S, t, m, dur, v = 0.14, out) { const g = ac.createGain(), fr = mtof(m), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(9000, fr * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.min(9000, fr * 2.5), t + 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.setTargetAtTime(v * 0.12, t + 0.004, 0.45 + 30 / fr); g.gain.setTargetAtTime(0, t + dur, 0.09);
      for (const [h, a, ty] of [[1, 1, 'triangle'], [2.003, 0.32, 'sine'], [3.01, 0.12, 'sine']]) { const o = ac.createOscillator(), og = ac.createGain(); o.type = ty; o.frequency.value = fr * h; og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.5); }
      lp.connect(g); g.connect(out || S.wet); },
    pad(S, t, notes, dur, v = 0.035, cut = 900, out) { const f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(cut * 0.6, t); f.frequency.linearRampToValueAtTime(cut, t + dur * 0.5); f.Q.value = 0.6;
      const a = Math.min(0.6, dur * 0.3); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(0, t + dur - 0.05, 0.25);
      for (const m of notes) for (const d of [-7, 7]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; o.connect(f); o.start(t); o.stop(t + dur + 1.2); }
      f.connect(g); g.connect(out || S.duck); },
    upright(S, t, m, dur, v = 0.3) { V.tone(S, t, m, dur, { type: 'triangle', v, cut: 900, cutEnd: 260, cutT: 0.25, d: 0.5, sus: 0.35, rel: 0.08, glide: -0.4 }); V.tone(S, t, m, dur * 0.8, { type: 'sine', v: v * 0.8, cut: 400, d: 0.6, sus: 0.4 }); },
    pump(S, t, depth = 0.35, len = 0.26) { const g = S.duck.gain; g.setValueAtTime(depth, t); g.linearRampToValueAtTime(1, t + len); },
  };

  // ------------------------------------------------------------------ a track: key, tempo, chords, tune
  const STYLE = {
    lofi: { bpm: [68, 86], spb: 16, swing: 0.16, scales: ['dorian', 'major', 'minor'], progs: { major: [[1, 4, 0, 5], [3, 2, 1, 0], [0, 5, 1, 4]], dorian: [[0, 3, 0, 4], [0, 6, 3, 4], [3, 0, 1, 4]], minor: [[0, 3, 5, 4], [5, 6, 0, 0], [0, 5, 3, 6]] }, bars: [28, 40] },
    wave: { bpm: [96, 114], spb: 16, swing: 0, scales: ['minor'], progs: { minor: [[0, 5, 2, 6], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 5, 6], [0, 5, 3, 4]] }, bars: [40, 56] },
    house: { bpm: [116, 124], spb: 16, swing: 0.05, scales: ['dorian', 'minor'], progs: { dorian: [[0, 0, 3, 4], [0, 2, 3, 3], [1, 4, 0, 0]], minor: [[0, 2, 5, 4], [5, 6, 0, 0], [0, 0, 5, 6]] }, bars: [48, 64] },
    jazz: { bpm: [118, 156], spb: 12, swing: 0, scales: ['major'], progs: { major: [[1, 4, 0, 0], [1, 4, 0, 5], [2, 5, 1, 4], [0, 5, 1, 4]] }, bars: [32, 48] },
    calm: { bpm: [52, 64], spb: 16, swing: 0, scales: ['lydian', 'major'], progs: { lydian: [[0, 1, 0, 4], [0, 4, 1, 0]], major: [[0, 4, 5, 3], [0, 3, 0, 4], [5, 3, 0, 4]] }, bars: [20, 28] },
  };
  function newTrack(S) {
    const r = S.r, st = STYLE[S.def.style], scn = pick(r, st.scales), T = { st, scale: SCALES[scn], root: 45 + Math.floor(r() * 12), prog: pick(r, st.progs[scn]), bpm: Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0])), r };
    T.bars = 4 * Math.round((st.bars[0] + r() * (st.bars[1] - st.bars[0])) / 4); T.sd = 60 / T.bpm / (st.spb / 4); T.seed = (r() * 1e9) | 0;
    T.title = pick(r, TA) + ' ' + pick(r, TB) + ' No. ' + (2 + Math.floor(r() * 38)); /* the number keeps a chance pair of words from being a real song's title */ T.act = pick(r, ACTS); T.kickPat = Math.floor(r() * 3); T.bassPat = Math.floor(r() * 3); T.arpPat = Math.floor(r() * 3); T.keyShift = [0, 5, -2, 0];
    // a two-bar motif in scale steps: [step in the two bars, degree offset from the chord root, length in steps]
    const mr = rng(T.seed), mot = []; let d = pick(mr, [0, 2, 4]); const spb = st.spb, grid = spb === 12 ? [0, 2, 3, 5, 6, 8, 9, 11] : [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14];
    for (let b = 0; b < 2; b++) for (const g of grid) { if (mr() < (S.def.style === 'calm' ? 0.22 : 0.42)) { d += pick(mr, [-2, -1, -1, 1, 1, 2, 0]); d = Math.max(-3, Math.min(8, d)); mot.push([b * spb + g, d, 1 + Math.floor(mr() * 3)]); } }
    T.motif = mot; S.track = T; S.bar0 = S.step; S.nowTitle = T.title; S.nowAct = T.act; S.delay.delayTime.value = Math.min(1.4, T.sd * (st.spb === 12 ? 3 : 3)); S.trackN = (S.trackN || 0) + 1;
    if (S.onTrack) try { S.onTrack(S); } catch (e) {}
  }
  const deg = (T, d, oct = 0, shift = 0) => { const n = T.scale.length, k = ((d % n) + n) % n; return T.root + shift + 12 * (oct + Math.floor(d / n)) + T.scale[k]; };
  const chordAt = (T, bar) => T.prog[Math.floor(bar / (T.st === STYLE.calm ? 2 : 1)) % T.prog.length];
  const shiftAt = (T, bar) => (T.st === STYLE.jazz ? T.keyShift[Math.floor(bar / 8) % 4] : 0);

  function pump(S) {
    const now = ac.currentTime; if (S.next < now - 0.05) S.next = now + 0.05;      // a sleeping tab: pick up from now, do not play the backlog
    while (S.next < now + 0.22) {
      const T = S.track, st = T.st, local = S.step - S.bar0, bar = Math.floor(local / st.spb), s = local % st.spb;
      if (bar >= T.bars) { S.next += 1.4; newTrack(S); continue; }
      const t = S.next + (st.swing && s % 2 ? st.swing * T.sd : 0);
      try { PLAY[S.def.style](S, T, bar, s, t); } catch (e) { if (!S.err) { S.err = 1; console.warn('[radio] ' + (e && e.message)); } }
      S.next += T.sd; S.step++;
    }
  }

  const hsh = (a, b, c) => { let x = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0; x = ((x ^ (x >>> 13)) * 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const tune = (S, T, bar, s, fn) => { const sp = T.st.spb, pos = (bar % 2) * sp + s; for (const m of T.motif) if (m[0] === pos) fn(m[1] + chordAt(T, bar) + (bar % 8 >= 6 ? 1 : 0), m[2]); };
  const PLAY = {
    lofi(S, T, bar, s, t) {
      const c = chordAt(T, bar), sd = T.sd, intro = bar < 2, outro = bar >= T.bars - 2, brk = bar % 16 === 15;
      if (!intro && !outro) { const kp = [[0, 7, 10], [0, 6, 10], [0, 10, 11]][T.kickPat]; if (kp.includes(s) && !(brk && s > 4)) V.kick(S, t, 0.8, 50);
        if (s === 4 || s === 12) { V.snare(S, t, 0.55); V.rim(S, t, 0.6); }
        if (s % 2 === 0) V.hat(S, t, 0.35 + 0.25 * hsh(T.seed, bar, s)); else if (hsh(T.seed, bar, s) < 0.2) V.hat(S, t, 0.2);
        if (brk && s >= 12) V.snare(S, t, 0.3 + 0.1 * (s - 12)); }
      if (s === 0) { const notes = [deg(T, c, 1), deg(T, c + 2, 1), deg(T, c + 4, 1), deg(T, c + 6, 1), deg(T, c + 8, 1)]; notes.forEach((m, i) => V.keys(S, t + i * 0.018, m, sd * 13, 0.075)); }
      if (s === 10 && hsh(T.seed, bar, 99) < 0.5) { for (const m of [deg(T, c + 2, 1), deg(T, c + 6, 1)]) V.keys(S, t, m, sd * 4, 0.05); }
      if (!intro) { const bp = [[0, 7, 10], [0, 10], [0, 6, 11]][T.bassPat]; if (bp.includes(s)) V.tone(S, t, deg(T, c, -1) + (s === 10 ? 7 : 0), sd * (s === 0 ? 5 : 2.5), { type: 'sine', v: 0.34, cut: 500, d: 0.5, sus: 0.7, rel: 0.1 }); }
      if (bar >= 4 && !outro && Math.floor(bar / 4) % 3 !== 2) tune(S, T, bar, s, (d, len) => V.tone(S, t, deg(T, d, 2), sd * len * 1.5, { type: 'triangle', v: 0.1, cut: 2200, cutEnd: 700, d: 0.3, sus: 0.3, rel: 0.2, out: S.echo }));
    },
    wave(S, T, bar, s, t) {
      const c = chordAt(T, bar), sd = T.sd, intro = bar < 4, outro = bar >= T.bars - 4, sec = Math.floor(bar / 8), brk = !intro && sec % 4 === 3 && bar % 8 < 4, drums = !intro && !outro && !brk;
      if (drums) { if (s % 4 === 0) { V.kick(S, t, 0.9); V.pump(S, t, 0.4, sd * 3); } if (s === 4 || s === 12) V.snare(S, t, 0.8, true); if (s % 2 === 0) V.hat(S, t, s % 4 === 2 ? 0.6 : 0.3, s === 14 && bar % 4 === 3); else V.hat(S, t, 0.18);
        if (bar % 8 === 7 && s >= 12) V.snare(S, t, 0.4 + 0.12 * (s - 12), true); }
      if (s === 0) V.pad(S, t, [deg(T, c, 1), deg(T, c + 2, 1), deg(T, c + 4, 1), deg(T, c + 6, 1)], sd * 16, 0.03, brk ? 1800 : 1100);
      if (!intro && s % 2 === 0) V.tone(S, t, deg(T, c, -1) + (s === 14 ? 12 : 0), sd * 1.6, { v: 0.22, cut: 900, cutEnd: 220, cutT: sd * 1.5, q: 3, d: 0.15, sus: 0.5, out: S.duck });
      if (bar >= 2 && !outro) { const ap = [[0, 2, 4, 7, 4, 2], [0, 4, 7, 9, 7, 4, 2, 4], [7, 4, 2, 0]][T.arpPat], d = ap[(bar * 16 + s) % ap.length]; V.tone(S, t, deg(T, c + d, 2), sd * 0.9, { type: 'square', v: 0.045 + (brk ? 0.02 : 0), cut: 2600, cutEnd: 500, cutT: sd, q: 2, d: 0.1, sus: 0.2, out: S.echo }); }
      if (!intro && !outro && sec % 2 === 1) tune(S, T, bar, s, (d, len) => V.tone(S, t, deg(T, d, 2), sd * (len + 1.5), { v: 0.085, cut: 3200, cutEnd: 1400, a: 0.02, d: 0.4, sus: 0.7, rel: 0.25, vib: 9, out: S.echo }));
    },
    house(S, T, bar, s, t) {
      const c = chordAt(T, bar), sd = T.sd, intro = bar < 4, outro = bar >= T.bars - 4, sec = Math.floor(bar / 8), brk = !intro && sec % 4 === 2 && bar % 8 >= 4, full = !intro && !outro && !brk;
      if (!brk) { if (s % 4 === 0) { V.kick(S, t, 0.95, 50); V.pump(S, t, 0.3, sd * 2.6); } }
      if (full || (intro && bar >= 2)) { if (s === 4 || s === 12) V.clap(S, t, 0.8); if (s % 4 === 2) V.hat(S, t, 0.7, true); else V.hat(S, t, 0.22); if (hsh(T.seed, bar, s) < 0.08) V.rim(S, t, 0.5); }
      if (brk && bar % 4 === 3 && s >= 8) V.snare(S, t, 0.25 + 0.08 * (s - 8));
      if (!intro) { const bp = [[0, 3, 6, 10, 14], [0, 3, 8, 11, 14], [2, 6, 10, 14]][T.bassPat]; if (bp.includes(s)) V.tone(S, t, deg(T, c, -1) + (s % 8 === 6 || s === 14 ? 12 : 0), sd * 1.5, { v: 0.26, type: 'sawtooth', cut: 700, cutEnd: 180, cutT: sd * 1.6, q: 4, d: 0.12, sus: 0.5, out: S.duck }); }
      const stab = [[0, 3, 6, 11], [2, 6, 10], [0, 6, 9, 14]][T.kickPat];
      if (bar >= 2 && stab.includes(s)) { for (const d of [2, 4, 6, 8]) V.keys(S, t, deg(T, c + d, 1), sd * 1.2, 0.055 + (brk ? 0.02 : 0), S.echo); }
      if (s === 0 && (brk || sec % 2 === 1)) V.pad(S, t, [deg(T, c, 1), deg(T, c + 4, 1), deg(T, c + 6, 1)], sd * 16, 0.022, 1500);
      if (full && sec % 4 === 1) tune(S, T, bar, s, (d, len) => V.tone(S, t, deg(T, d, 2), sd * len, { type: 'square', v: 0.06, cut: 2400, cutEnd: 900, d: 0.15, sus: 0.4, rel: 0.1, out: S.echo }));
    },
    jazz(S, T, bar, s, t) {
      const sh = shiftAt(T, bar), c = chordAt(T, bar), cn = chordAt(T, bar + 1), shn = shiftAt(T, bar + 1), sd = T.sd, beat = s / 3, head = bar < 8 || bar >= T.bars - 8, h = hsh(T.seed, bar, s);
      if ([0, 3, 5, 6, 9, 11].includes(s)) V.ride(S, t, s === 3 || s === 9 ? 1 : s % 3 ? 0.55 : 0.8); if (s === 3 || s === 9) V.hat(S, t, 0.5);
      if (h < 0.07 && s % 3 === 2) V.brush(S, t, 1); if (h > 0.965) V.kick(S, t, 0.35, 55);
      if (s % 3 === 0) { let m; const root = deg(T, c, -1, sh), nextRoot = deg(T, cn, -1, shn);
        if (beat === 0) m = root; else if (beat === 3) m = nextRoot + (hsh(T.seed, bar, 7) < 0.5 ? 1 : -1); else m = deg(T, c + pick(T.r, beat === 1 ? [2, 1, 4] : [4, 2, 6, 3]), -1, sh);
        while (m < 36) m += 12; while (m > 55) m -= 12; V.upright(S, t, m, sd * 2.6, 0.3); }
      const cp = [[0, 8], [5], [2, 9], [5, 11], [0, 5]][Math.floor(hsh(T.seed, bar, 50) * 5)];
      if (cp.includes(s)) for (const d of [2, 6, 8]) V.piano(S, t, deg(T, c + d, d === 8 ? 0 : 1, sh), sd * (s === 0 ? 4 : 1.6), 0.07);
      // the right hand: the written tune on the first and last eight bars, made-up lines between (a walk along the chord's scale, rests between phrases)
      if (head) tune(S, T, bar, s, (d, len) => V.piano(S, t, deg(T, d, 2, sh), sd * len * 1.3, 0.15));
      else if (s % 3 !== 1 && hsh(T.seed, Math.floor(bar / 2), 31) < 0.8) { const ph = hsh(T.seed, bar, s + 60); if (ph < (s % 3 === 0 ? 0.62 : 0.45)) { S.line = Math.max(0, Math.min(11, (S.line === undefined ? 4 : S.line) + pick(T.r, [-2, -1, -1, 1, 1, 2, 3, -3]))); let d = S.line; if (s % 6 === 0 && d % 2) d += 1; V.piano(S, t, deg(T, c + d, 1, sh) + (ph < 0.04 ? -1 : 0), sd * (ph < 0.1 ? 3 : 1.3), 0.12 + 0.05 * hsh(T.seed, s, bar)); } }
    },
    calm(S, T, bar, s, t) {
      const c = chordAt(T, bar), sd = T.sd, h = hsh(T.seed, bar, s);
      if (s === 0 && bar % 2 === 0) { V.pad(S, t, [deg(T, c, 0), deg(T, c + 4, 0), deg(T, c + 2, 1), deg(T, c + 6, 1)], sd * 34, 0.03, 700, S.wet); V.tone(S, t, deg(T, c, -1), sd * 30, { type: 'sine', v: 0.16, cut: 300, a: 0.8, d: 2, sus: 0.8, rel: 1.5 }); }
      if (s % 2 === 0 && h < 0.5) { const d = pick(T.r, [0, 2, 4, 4, 6, 7, 8, 9, 11]); V.piano(S, t + h * 0.02, deg(T, c + d, 1), sd * 6, 0.07 + 0.07 * hsh(T.seed, s, bar), S.echo); }
      tune(S, T, bar, s, (d, len) => V.piano(S, t, deg(T, d, 2), sd * (len + 3), 0.1, S.echo));
    },
  };

  return {
    stations: STATIONS,
    tune(i, onTrack) { if (cur) { halt(cur); cur = null; } const def = STATIONS[i]; if (!def) return null; cur = start(def); cur.onTrack = onTrack || null; if (onTrack) try { onTrack(cur); } catch (e) {} return cur; },
    stop() { if (cur) { halt(cur); cur = null; } },
    // a burst of tuning noise between stations
    static_(v = 0.2) { const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = white; f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(4200, t + 0.2); f.Q.value = 1.5; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24); s.connect(f); f.connect(g); g.connect(master); s.start(t, 0.3, 0.3); },
    now() { return cur ? { station: cur.def.name, title: cur.nowTitle, act: cur.nowAct, tracks: cur.trackN, step: cur.step } : null; },
    get playing() { return !!cur; },
  };
}
