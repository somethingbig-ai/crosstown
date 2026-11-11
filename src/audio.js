// audio.js: all sound is synthesised (WebAudio): engine, tyres, city bed, and a few one-shots. Starts on the first key or click.
export class Sound {
  constructor(game) { this.g = game; this.on = false; this.muted = false; }
  unlock() {
    if (this.on || this.g.capture) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const a = (this.ac = new AC()); this.on = true; const out = (this.out = a.createGain()); out.gain.value = 0.8; out.connect(a.destination);
    const noise = (secs, brown) => { const b = a.createBuffer(1, a.sampleRate * secs, a.sampleRate), d = b.getChannelData(0); let l = 0, s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; const w = s / 2147483648 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; } return b; };
    this.white = noise(2, false);
    // engine: two detuned saws through a low-pass, pitch from speed inside a gear
    const eg = (this.eg = a.createGain()); eg.gain.value = 0; const lp = (this.elp = a.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 2; lp.connect(eg); eg.connect(out);
    this.o1 = a.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = a.createOscillator(); this.o2.type = 'square'; const g2 = a.createGain(); g2.gain.value = 0.35; this.o1.connect(lp); this.o2.connect(g2); g2.connect(lp); this.o1.start(); this.o2.start();
    // tyres
    const ts = a.createBufferSource(); ts.buffer = this.white; ts.loop = true; const tb = a.createBiquadFilter(); tb.type = 'bandpass'; tb.frequency.value = 1900; tb.Q.value = 5; const tg = (this.tg = a.createGain()); tg.gain.value = 0; ts.connect(tb); tb.connect(tg); tg.connect(out); ts.start();
    // city bed and road rumble
    const cs = a.createBufferSource(); cs.buffer = noise(4, true); cs.loop = true; const cg = (this.cg = a.createGain()); cg.gain.value = 0.07; const cf = a.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 380; cf.Q.value = 0.5; cs.connect(cf); cf.connect(cg); cg.connect(out); cs.start();     /* public feedback Nov 11, twice ("a constant white noise sound like tv static", "low quality white noise"): the city bed was raw noise at full band, always on; it is now a low rumble (under 380 Hz) at less than half the level */
    const rs = a.createBufferSource(); rs.buffer = noise(3, true); rs.loop = true; const rf = a.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 260; const rg = (this.rg = a.createGain()); rg.gain.value = 0; rs.connect(rf); rf.connect(rg); rg.connect(out); rs.start();
    this.hornT = 3;
  }
  toggle() { this.muted = !this.muted; if (this.out) this.out.gain.value = this.muted ? 0 : 0.8; }
  shot(freq, dur, type = 'sine', vol = 0.2, slide = 0) { if (!this.on) return; const a = this.ac, o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(freq, a.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur); g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur); o.connect(g); g.connect(this.out); o.start(); o.stop(a.currentTime + dur + 0.02); }
  burst(dur, vol, freq) { if (!this.on) return; const a = this.ac, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = this.white; f.type = 'lowpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur); s.connect(f); f.connect(g); g.connect(this.out); s.start(); s.stop(a.currentTime + dur + 0.02); }
  crash(f) { this.burst(0.35, Math.min(0.9, 0.15 + f * 0.05), 900); this.shot(70, 0.25, 'triangle', 0.4, -30); }
  thud() { this.burst(0.18, 0.4, 400); }
  door() { this.burst(0.09, 0.35, 700); this.shot(110, 0.08, 'triangle', 0.25, -40); }
  blip() { this.shot(880, 0.12, 'sine', 0.18); setTimeout(() => this.shot(1320, 0.16, 'sine', 0.18), 110); }
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.shot(f, 0.3, 'triangle', 0.2), i * 110)); }
  fail() { this.shot(220, 0.5, 'sawtooth', 0.15, -110); }
  update(dt) {
    if (!this.on) return; const g = this.g, v = g.player.vehicle, a = this.ac, now = a.currentTime;
    if (v) { const sp = Math.abs(v.vf), top = v.spec.top, gears = [0, 0.16, 0.3, 0.46, 0.66, 1.01].map((x) => x * top); let gi = 1; while (gi < 5 && sp > gears[gi]) gi++; const r = (sp - gears[gi - 1]) / (gears[gi] - gears[gi - 1]); const thr = g.input.throttle;
      const f = 48 + r * 95 + gi * 4; this.o1.frequency.setTargetAtTime(f, now, 0.05); this.o2.frequency.setTargetAtTime(f * 0.502, now, 0.05); this.elp.frequency.setTargetAtTime(350 + r * 900 + thr * 700, now, 0.08); this.eg.gain.setTargetAtTime(0.05 + thr * 0.07 + r * 0.02, now, 0.08);
      this.tg.gain.setTargetAtTime(Math.min(0.22, Math.max(0, v.slip - 2.2) * 0.05), now, 0.05); this.rg.gain.setTargetAtTime(Math.min(0.5, sp * 0.014), now, 0.2); }
    else { this.eg.gain.setTargetAtTime(0, now, 0.15); this.tg.gain.setTargetAtTime(0, now, 0.1); this.rg.gain.setTargetAtTime(0, now, 0.2); }
    this.hornT -= dt; if (this.hornT <= 0) { this.hornT = 5 + ((g.frame * 7919) % 900) / 100; const f = 380 + ((g.frame * 31) % 60); this.shot(f, 0.5, 'square', 0.018); this.shot(f * 1.26, 0.5, 'square', 0.014); }
  }
}
